// ============================================================
// ตัวสั่งพิมพ์เอกสารกลาง — แทนที่ salesPrint.ts + purchasePrint.ts
//
// ของเดิมเขียน template แยกกัน 17 ฟังก์ชันใน 2 ไฟล์ (1,492 บรรทัด) + CSS ก๊อป 2 ชุด
// แก้อะไรทีต้องไล่แก้ทุกใบ ซึ่งเป็นเหตุผลที่เลขภาษีผู้ซื้อไม่เคยถูกใส่ในใบกำกับภาษีเลย
//
// ตัวนี้แปลงข้อมูลดิบจาก API ให้เป็น BillData แล้วเรนเดอร์ <UnifiedBillTemplate/>
// เป็น HTML string ด้วย renderToStaticMarkup — คงลายเซ็นแบบสั่งพิมพ์ไว้เหมือนเดิม
// หน้า Sales/Purchase/Cashier จึงเปลี่ยนแค่ import
// ============================================================

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import UnifiedBillTemplate from '../components/bill/UnifiedBillTemplate'
import type { BillBranding, BillDocumentSettings } from '../components/bill/UnifiedBillTemplate'
import { BILL_CONFIGS } from '../components/bill/BillContext'
import type { BillType, BillData, BillItem, BillParty } from '../components/bill/BillContext'
import api from '../services/api'

export type PrintDocType =
  | 'qt' | 'so' | 'inv' | 'rc' | 'cn'
  | 'pr' | 'po' | 'gr' | 'pi' | 'payment' | 'return'
  | 'pos' | 'wo'
export type PrintFormat = 'a4' | 'a5' | 'thermal'

// ── ตารางเดียวคุมทุกชนิดเอกสาร แทนการเขียน template แยกกันทีละใบ ──────────
interface DocSpec {
  bill: BillType
  /** ชื่อฟิลด์ที่อาจเก็บเลขที่เอกสาร เรียงตามลำดับที่จะลอง */
  number: string[]
  date: string[]
  /** เอกสารอ้างอิง (ใบเสนอราคาที่มาจาก, PO ที่มาจาก ฯลฯ) */
  ref?: string[]
  /** วันครบกำหนด/วันหมดอายุ/วันส่ง */
  due?: string[]
  /** คู่ค้าอยู่ฝั่งไหน — sales ใช้ customer_*, purchase ใช้ supplier_* */
  party: 'customer' | 'supplier' | 'none'
}

const DOCS: Record<PrintDocType, DocSpec> = {
  qt:      { bill: 'QUOTATION',        number: ['quotation_number'], date: ['quotation_date'], due: ['expiry_date'], party: 'customer' },
  so:      { bill: 'SALE',             number: ['so_number'],        date: ['order_date'],     ref: ['quotation_number'], due: ['delivery_date'], party: 'customer' },
  inv:     { bill: 'INVOICE',          number: ['invoice_number'],   date: ['invoice_date'],   ref: ['so_number'],        due: ['due_date'],      party: 'customer' },
  rc:      { bill: 'RECEIPT',          number: ['receipt_number'],   date: ['receipt_date'],   ref: ['invoice_number', 'so_number'], party: 'customer' },
  cn:      { bill: 'CREDIT_NOTE',      number: ['cn_number'],        date: ['credit_date'],    ref: ['invoice_number'],   party: 'customer' },
  pr:      { bill: 'PURCHASE_REQUEST', number: ['pr_number'],        date: ['request_date'],   due: ['required_date'],    party: 'none' },
  po:      { bill: 'PURCHASE',         number: ['po_number'],        date: ['order_date'],     ref: ['linked_pr_number'], due: ['expected_date'], party: 'supplier' },
  gr:      { bill: 'GOODS_RECEIPT',    number: ['gr_number'],        date: ['receipt_date'],   ref: ['po_number'],        party: 'supplier' },
  pi:      { bill: 'PURCHASE_INVOICE', number: ['pi_number'],        date: ['invoice_date'],   ref: ['po_number', 'gr_number'], due: ['due_date'], party: 'supplier' },
  payment: { bill: 'PAYMENT',          number: ['payment_number'],   date: ['payment_date'],   ref: ['pi_number', 'supplier_invoice_number'], party: 'supplier' },
  return:  { bill: 'PURCHASE_RETURN',  number: ['return_number', 'rt_number', 'po_number'], date: ['return_date'], ref: ['po_number', 'pr_number'], party: 'supplier' },
  pos:     { bill: 'RECEIPT',          number: ['bill_number'],      date: ['closed_at', 'created_at'], party: 'customer' },
  wo:      { bill: 'WORK_ORDER',       number: ['wo_number'],        date: ['start_date', 'created_at'], due: ['due_date'], party: 'none' },
}

const pick = (d: any, keys?: string[]): string => {
  for (const k of keys || []) {
    const v = d?.[k]
    if (v !== undefined && v !== null && String(v) !== '') return String(v)
  }
  return ''
}
const n = (v: any): number => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

/** รูปภาพมาจาก DB — ยอมเฉพาะ data:image และ http(s) กัน scheme แปลกปลอมหลุดเข้าหน้าต่างพิมพ์ */
function safeImage(url: unknown): string {
  const s = String(url ?? '').trim()
  if (!s) return ''
  return /^data:image\/[a-z+]+;base64,/i.test(s) || /^https?:\/\//i.test(s) ? s : ''
}

function toItems(raw: any[]): BillItem[] {
  return (raw || []).map((it: any, i: number) => {
    const price = n(it.unit_price ?? it.estimated_unit_price ?? it.price)
    const qty = n(it.quantity ?? it.ordered_qty ?? it.received_qty ?? it.accepted_qty)
    const total = it.total_price ?? it.estimated_total_price ?? it.total
    return {
      id: String(it.id ?? i),
      no: i + 1,
      name: String(it.product_name || it.material_name || it.name || it.description || '-'),
      description: it.description && it.description !== it.product_name ? String(it.description) : undefined,
      sku: it.sku || it.code || undefined,
      quantity: qty,
      unit: String(it.unit || ''),
      price,
      discount: n(it.discount_amount ?? it.discount),
      vat: n(it.vat_amount ?? it.vat),
      total: total !== undefined && total !== null ? n(total) : price * qty,
      whtLabel: it.wht_label || undefined,
    }
  })
}

function sellerOf(d: any): BillParty {
  // POS ส่งมาเป็น _shop* ส่วนเอกสารอื่นส่ง _company*
  return {
    name: String(d._company || d._shopName || '-'),
    address: String(d._companyAddress || d._shopAddress || ''),
    taxId: String(d._companyTax || d._shopTaxId || ''),
    tel: String(d._companyPhone || d._shopPhone || ''),
    branch: d._companyBranch || undefined,
  }
}

function partyOf(d: any, side: DocSpec['party']): BillParty {
  // เอกสารที่ไม่มีคู่ค้า (ใบขอซื้อ/ใบสั่งผลิต) — ใช้แผนก/สินค้าที่ผลิตแทน ไม่ปล่อยว่าง
  if (side === 'none') return { name: String(d.department || d.product_name || d.wo_product_name || d.requester_name || '-') }
  const p = side === 'customer' ? 'customer' : 'supplier'
  return {
    code: d[`${p}_code`] || undefined,
    name: String(d[`${p}_name`] || '-'),
    address: String(d[`${p}_address`] || ''),
    taxId: String(d[`${p}_tax_id`] || ''),
    tel: String(d[`${p}_phone`] || ''),
    email: d[`${p}_email`] || undefined,
  }
}

export function toBillData(type: PrintDocType, d: any): BillData {
  const spec = DOCS[type]
  const items = toItems(d.items)
  const subtotal = d.subtotal !== undefined ? n(d.subtotal) : items.reduce((s, x) => s + x.total, 0)
  const total = n(d.total_amount ?? d.net_amount ?? d.amount ?? subtotal)
  return {
    id: String(d.id ?? ''),
    docNumber: pick(d, spec.number) || '-',
    docDate: pick(d, spec.date),
    refNumber: pick(d, spec.ref) || undefined,
    dueDate: pick(d, spec.due) || undefined,
    seller: sellerOf(d),
    buyer: partyOf(d, spec.party),
    items,
    subtotal,
    discountTotal: n(d.discount_amount ?? d._discountAmount),
    vatTotal: n(d.tax_amount),
    whtTotal: d.withholding_tax !== undefined ? n(d.withholding_tax) : undefined,
    total,
    paymentMethod: d.payment_method || d._paymentMethod || undefined,
    paymentTerms: d.payment_terms || undefined,
    bankName: d._bankName || undefined,
    bankAccountName: d._bankAccountName || undefined,
    bankAccountNumber: d._bankAccountNumber || undefined,
    notes: d.notes || d.reason || undefined,
    status: (d.status || 'CONFIRMED') as BillData['status'],
    qrCode: safeImage(d._bankQrImage || d.receipt_qr) || undefined,
    createdBy: String(d.created_by || d.requester_name || d.received_by || ''),
    createdAt: String(d.created_at || ''),
  }
}

// ── ค่าตั้งค่าเอกสารจาก Settings — ดึงครั้งเดียวแล้วจำไว้ ──────────────────
let settingsCache: (BillDocumentSettings & { branding?: BillBranding }) | null = null
let settingsPromise: Promise<void> | null = null

async function loadSettings() {
  if (settingsCache || settingsPromise) return settingsPromise ?? undefined
  settingsPromise = api.get('/settings/documents')
    .then((r: any) => { settingsCache = r?.data?.data ?? null })
    .catch(() => { settingsCache = null })   // โหลดไม่ได้ก็ใช้ค่าตั้งต้นใน template
  return settingsPromise
}

/** ล้างแคชเมื่อผู้ใช้กดบันทึกในหน้า Settings จะได้เห็นผลทันทีโดยไม่ต้อง refresh */
export function invalidateDocumentSettings() {
  settingsCache = null
  settingsPromise = null
}

const SIZE: Record<PrintFormat, 'A4' | 'A5' | 'THERMAL'> = { a4: 'A4', a5: 'A5', thermal: 'THERMAL' }

/**
 * สั่งพิมพ์เอกสาร — ลายเซ็นเดียวกับ printSalesDoc()/printDocument() เดิม
 * ไม่ต้อง await ก็ได้ (ผู้เรียกเป็น onClick) แต่ await ได้ถ้าอยากรอ
 */
export async function printBill(type: PrintDocType, data: any, format: PrintFormat = 'a4') {
  const spec = DOCS[type]
  if (!spec) return

  await loadSettings()
  const s: any = settingsCache || {}
  const size = SIZE[format] || 'A4'

  const branding: BillBranding = {
    logoBase64: safeImage(data?._companyLogo || s?.branding?.logoBase64) || undefined,
    isFreePlan: !!s?.branding?.isFreePlan,
  }

  const html = renderToStaticMarkup(
    createElement(UnifiedBillTemplate as any, {
      config: (BILL_CONFIGS as any)[spec.bill],
      data: toBillData(type, data || {}),
      size,
      branding,
      settings: settingsCache || undefined,
      showPrintButton: false,
    })
  )

  const w = window.open('', '_blank', size === 'THERMAL' ? 'width=340,height=700' : 'width=900,height=1200')
  if (!w) { alert('กรุณาอนุญาต pop-up เพื่อพิมพ์เอกสาร'); return }
  // CSS ติดมากับ output ของ template เองแล้ว (<style>{BILL_CSS}</style>) ไม่ต้องใส่ซ้ำ
  w.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>พิมพ์เอกสาร</title></head><body>${html}</body></html>`)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 600)
}

/** ลายเซ็นเดิมของ printPOSReceipt() — Cashier.tsx เรียกแบบไม่มี type */
export function printPOSReceipt(bill: any, format: PrintFormat = 'thermal') {
  return printBill('pos', bill, format)
}

export default printBill
