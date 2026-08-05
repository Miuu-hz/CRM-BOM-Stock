import { Router, Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import db from '../db/sqlite'

// ====================================================================
// PUBLIC receipt viewer — no auth. Reached only via an unguessable
// token (see utils/receiptToken.ts). Must return ONLY the single
// document that token maps to, and ONLY customer-facing fields
// (no cost/margin/supplier/internal-notes data). See security review
// notes in the PR description before touching this file.
// ====================================================================

const router = Router()

// ponytail: token entropy (192-bit random, see receiptToken.ts) is the real
// defense against guessing — this limiter is defense-in-depth against scripted
// scraping of a single leaked/shared link, not the primary control.
const receiptLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
})
router.use(receiptLimiter)

function esc(s: unknown): string {
  if (s === null || s === undefined) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
const money = (n: number) => (Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const thDate = (s?: string | null) => {
  if (!s) return '-'
  const d = new Date(s)
  return isNaN(d.getTime()) ? '-' : d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
}

const PAGE_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Sarabun, sans-serif; background: #F0ECE2; color: #1E1B16; }
  .receipt { max-width: 420px; margin: 0 auto; padding: 20px 16px 40px; }
  .shop { font-size: 18px; font-weight: 800; text-align: center; }
  .sub { font-size: 12px; color: #6B6658; text-align: center; margin-top: 2px; }
  h1 { font-size: 15px; font-weight: 700; text-align: center; margin: 16px 0 2px; color: #3949E5; }
  .docno { font-size: 13px; font-weight: 600; text-align: center; font-family: monospace; color: #383426; margin-bottom: 14px; }
  .meta { background: #F8F5EE; border: 1px solid #DEDACF; border-radius: 10px; padding: 10px 14px; margin-bottom: 14px; }
  .meta div { display: flex; justify-content: space-between; font-size: 13px; padding: 3px 0; }
  .meta label { color: #6B6658; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 12px; }
  th { text-align: left; font-size: 11px; color: #6B6658; border-bottom: 1.5px solid #CFCAB8; padding: 4px 4px; }
  th.r, td.r { text-align: right; }
  td { padding: 7px 4px; border-bottom: 1px dashed #E8E3D4; vertical-align: top; }
  .note { font-size: 11px; color: #A8A294; }
  .totals { background: #F8F5EE; border: 1px solid #DEDACF; border-radius: 10px; padding: 10px 14px; }
  .totals > div { display: flex; justify-content: space-between; font-size: 13px; padding: 3px 0; }
  .totals .grand { font-size: 16px; font-weight: 800; color: #3949E5; border-top: 1.5px solid #CFCAB8; margin-top: 4px; padding-top: 8px; }
  .totals .balance { color: #DC2626; font-weight: 700; }
  .foot { text-align: center; font-size: 11px; color: #A8A294; margin-top: 20px; }
  .notfound { text-align: center; font-size: 15px; color: #6B6658; margin-top: 60px; }
`

function renderPage(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>${PAGE_CSS}</style>
</head><body><div class="receipt">${bodyHtml}</div></body></html>`
}

function sendPage(res: Response, status: number, title: string, bodyHtml: string) {
  res.status(status).set('Cache-Control', 'no-store').type('html').send(renderPage(title, bodyHtml))
}

function notFound(res: Response) {
  sendPage(res, 404, 'ไม่พบใบเสร็จ', `<p class="notfound">ไม่พบใบเสร็จนี้ หรือลิงก์หมดอายุแล้ว</p>`)
}

router.get('/:token', (req: Request, res: Response) => {
  const { token } = req.params

  // Cheap shape guard before touching the DB — real tokens are base64url, 24+ chars.
  if (!token || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return notFound(res)

  const share = db.prepare(
    `SELECT tenant_id, doc_type, doc_id, expires_at FROM receipt_tokens WHERE token = ?`
  ).get(token) as { tenant_id: string; doc_type: string; doc_id: string; expires_at: string | null } | undefined

  if (!share) return notFound(res)
  if (share.expires_at && new Date(share.expires_at) < new Date()) return notFound(res)

  if (share.doc_type === 'pos_bill') return renderPosBill(res, share.doc_id, share.tenant_id)
  if (share.doc_type === 'invoice') return renderInvoice(res, share.doc_id, share.tenant_id)
  return notFound(res)
})

// ── POS bill (scoped strictly by id + tenant_id from the token row) ──
function renderPosBill(res: Response, billId: string, tenantId: string) {
  const bill = db.prepare(`
    SELECT bill_number, display_name, customer_name, status, opened_at, closed_at,
           subtotal, tax_rate, tax_amount, service_charge_rate, service_charge_amount,
           discount_amount, total_amount
    FROM pos_running_bills WHERE id = ? AND tenant_id = ?
  `).get(billId, tenantId) as any
  if (!bill) return notFound(res)

  const items = db.prepare(`
    SELECT product_name, quantity, unit_price, total_price, special_instructions
    FROM pos_bill_items WHERE bill_id = ? ORDER BY added_at ASC
  `).all(billId) as any[]

  const company = db.prepare(`SELECT name, address FROM company_settings WHERE tenant_id = ?`).get(tenantId) as any

  const rows = items.map(it => `
    <tr>
      <td>${esc(it.product_name)}${it.special_instructions ? `<div class="note">${esc(it.special_instructions)}</div>` : ''}</td>
      <td class="r">${esc(it.quantity)}</td>
      <td class="r">${money(it.unit_price)}</td>
      <td class="r">${money(it.total_price)}</td>
    </tr>`).join('')

  const body = `
    <div class="shop">${esc(company?.name || '')}</div>
    ${company?.address ? `<div class="sub">${esc(company.address)}</div>` : ''}
    <h1>ใบเสร็จรับเงิน</h1>
    <div class="docno">${esc(bill.bill_number)}</div>
    <div class="meta">
      ${bill.customer_name ? `<div><label>ลูกค้า</label><span>${esc(bill.customer_name)}</span></div>` : ''}
      <div><label>วันที่</label><span>${thDate(bill.closed_at || bill.opened_at)}</span></div>
    </div>
    <table>
      <thead><tr><th>รายการ</th><th class="r">จำนวน</th><th class="r">ราคา</th><th class="r">รวม</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div><span>ยอดรวม</span><span>${money(bill.subtotal)}</span></div>
      ${bill.service_charge_amount ? `<div><span>Service Charge ${bill.service_charge_rate}%</span><span>${money(bill.service_charge_amount)}</span></div>` : ''}
      ${bill.discount_amount ? `<div><span>ส่วนลด</span><span>-${money(bill.discount_amount)}</span></div>` : ''}
      ${bill.tax_amount ? `<div><span>VAT ${bill.tax_rate}%</span><span>${money(bill.tax_amount)}</span></div>` : ''}
      <div class="grand"><span>รวมทั้งสิ้น</span><span>${money(bill.total_amount)}</span></div>
    </div>
    <div class="foot">ใบเสร็จอิเล็กทรอนิกส์ · ${esc(bill.bill_number)}</div>
  `
  sendPage(res, 200, `ใบเสร็จ ${bill.bill_number}`, body)
}

// ── Sales invoice (scoped strictly by id + tenant_id from the token row) ──
function renderInvoice(res: Response, invoiceId: string, tenantId: string) {
  const invoice = db.prepare(`
    SELECT i.invoice_number, i.invoice_date, i.due_date, i.subtotal, i.discount_amount,
           i.tax_rate, i.tax_amount, i.total_amount, i.paid_amount, i.balance_amount,
           i.payment_status, c.name as customer_name
    FROM invoices i
    LEFT JOIN customers c ON i.customer_id = c.id
    WHERE i.id = ? AND i.tenant_id = ?
  `).get(invoiceId, tenantId) as any
  if (!invoice) return notFound(res)

  const items = db.prepare(`
    SELECT p.name as product_name, ii.quantity, ii.unit_price, ii.total_price
    FROM invoice_items ii
    LEFT JOIN products p ON ii.product_id = p.id
    WHERE ii.invoice_id = ?
  `).all(invoiceId) as any[]

  const company = db.prepare(`SELECT name, address, tax_id FROM company_settings WHERE tenant_id = ?`).get(tenantId) as any

  const PAYMENT_STATUS_TH: Record<string, string> = {
    PAID: 'ชำระแล้ว', UNPAID: 'ค้างชำระ', PARTIAL: 'ชำระบางส่วน', OVERDUE: 'เกินกำหนด',
  }

  const rows = items.map(it => `
    <tr>
      <td>${esc(it.product_name || '-')}</td>
      <td class="r">${esc(it.quantity)}</td>
      <td class="r">${money(it.unit_price)}</td>
      <td class="r">${money(it.total_price)}</td>
    </tr>`).join('')

  const body = `
    <div class="shop">${esc(company?.name || '')}</div>
    ${company?.address ? `<div class="sub">${esc(company.address)}</div>` : ''}
    ${company?.tax_id ? `<div class="sub">เลขผู้เสียภาษี: ${esc(company.tax_id)}</div>` : ''}
    <h1>ใบแจ้งหนี้ / ใบกำกับภาษี</h1>
    <div class="docno">${esc(invoice.invoice_number)}</div>
    <div class="meta">
      ${invoice.customer_name ? `<div><label>ลูกค้า</label><span>${esc(invoice.customer_name)}</span></div>` : ''}
      <div><label>วันที่ออก</label><span>${thDate(invoice.invoice_date)}</span></div>
      ${invoice.due_date ? `<div><label>ครบกำหนด</label><span>${thDate(invoice.due_date)}</span></div>` : ''}
      <div><label>สถานะชำระ</label><span>${esc(PAYMENT_STATUS_TH[invoice.payment_status] || invoice.payment_status)}</span></div>
    </div>
    <table>
      <thead><tr><th>รายการ</th><th class="r">จำนวน</th><th class="r">ราคา</th><th class="r">รวม</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div><span>มูลค่าก่อนภาษี</span><span>${money(invoice.subtotal)}</span></div>
      ${invoice.discount_amount ? `<div><span>ส่วนลด</span><span>-${money(invoice.discount_amount)}</span></div>` : ''}
      ${invoice.tax_amount ? `<div><span>VAT ${invoice.tax_rate}%</span><span>${money(invoice.tax_amount)}</span></div>` : ''}
      <div class="grand"><span>รวมทั้งสิ้น</span><span>${money(invoice.total_amount)}</span></div>
      ${invoice.paid_amount ? `<div><span>ชำระแล้ว</span><span>-${money(invoice.paid_amount)}</span></div>` : ''}
      ${invoice.balance_amount ? `<div class="balance"><span>ยอดคงค้าง</span><span>${money(invoice.balance_amount)}</span></div>` : ''}
    </div>
    <div class="foot">เอกสารอิเล็กทรอนิกส์ · ${esc(invoice.invoice_number)}</div>
  `
  sendPage(res, 200, `ใบแจ้งหนี้ ${invoice.invoice_number}`, body)
}

export default router
