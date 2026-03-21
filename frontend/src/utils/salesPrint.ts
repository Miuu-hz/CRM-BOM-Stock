// ============================================================
// Sales Print Utility — A4 + Thermal 80mm
// printSalesDoc(type, data, format) handles QT / SO / INV / RC / CN
// ============================================================

export type SalesPrintFormat = 'a4' | 'thermal'
export type SalesDocType = 'qt' | 'so' | 'inv' | 'rc' | 'cn'

// ── helpers ───────────────────────────────────────────────────
const fmt = (n: number) => new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2 }).format(n || 0)
const fmtDate = (s?: string) => {
  if (!s) return '-'
  const d = new Date(s)
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
}
const STATUS_TH: Record<string, string> = {
  DRAFT: 'ร่าง', SENT: 'ส่งแล้ว', ACCEPTED: 'อนุมัติ', REJECTED: 'ปฏิเสธ',
  CONFIRMED: 'ยืนยัน', PROCESSING: 'กำลังเตรียม', READY: 'พร้อมส่ง',
  DELIVERED: 'ส่งแล้ว', COMPLETED: 'เสร็จสิ้น', CANCELLED: 'ยกเลิก',
  ISSUED: 'ออกใบแล้ว', PAID: 'ชำระแล้ว', UNPAID: 'ค้างชำระ',
  PARTIAL: 'บางส่วน', OVERDUE: 'เกินกำหนด',
}
const METHOD_TH: Record<string, string> = {
  CASH: 'เงินสด', TRANSFER: 'โอนเงิน', CHEQUE: 'เช็ค', CREDIT_CARD: 'บัตรเครดิต', OTHER: 'อื่นๆ',
}

// ── CSS A4 ────────────────────────────────────────────────────
const CSS_A4 = `
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;600;700&display=swap');
  @page { size: A4 portrait; margin: 12mm 15mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Sarabun', sans-serif; font-size: 10pt; color: #111; background: #fff; }
  .page { max-width: 175mm; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1a1a2e; padding-bottom: 6mm; margin-bottom: 5mm; }
  .company-block { font-size: 9pt; color: #444; }
  .company-name { font-size: 13pt; font-weight: 700; color: #1a1a2e; }
  .doc-title { text-align: right; }
  .doc-title h1 { font-size: 16pt; font-weight: 700; color: #1a1a2e; }
  .doc-title .doc-number { font-size: 11pt; font-weight: 600; color: #333; margin-top: 2mm; }
  .doc-title .doc-date { font-size: 9pt; color: #666; margin-top: 1mm; }
  .info-row { display: flex; gap: 6mm; margin-bottom: 4mm; }
  .info-box { flex: 1; border: 1px solid #ddd; border-radius: 3px; padding: 3mm 4mm; }
  .info-box label { font-size: 7.5pt; color: #888; display: block; margin-bottom: 1mm; }
  .info-box .value { font-size: 9.5pt; font-weight: 600; }
  .info-box .sub { font-size: 8pt; color: #666; margin-top: 0.5mm; }
  table { width: 100%; border-collapse: collapse; margin-top: 4mm; }
  table th { background: #1a1a2e; color: #fff; font-size: 8.5pt; font-weight: 600; padding: 2mm 3mm; text-align: left; }
  table th.right, table td.right { text-align: right; }
  table th.center, table td.center { text-align: center; }
  table td { font-size: 9pt; padding: 2mm 3mm; border-bottom: 1px solid #eee; vertical-align: top; }
  table tr:nth-child(even) td { background: #fafafa; }
  .totals { margin-top: 3mm; display: flex; justify-content: flex-end; }
  .totals-box { width: 72mm; }
  .totals-row { display: flex; justify-content: space-between; padding: 1.5mm 0; font-size: 9.5pt; border-bottom: 1px solid #eee; }
  .totals-row.grand { font-size: 12pt; font-weight: 700; color: #1a1a2e; border-top: 2px solid #1a1a2e; border-bottom: none; padding-top: 2mm; }
  .totals-row.balance { color: #dc2626; font-weight: 700; }
  .notes-box { margin-top: 5mm; padding: 3mm 4mm; border: 1px solid #ddd; border-radius: 3px; }
  .notes-box label { font-size: 7.5pt; color: #888; display: block; margin-bottom: 1mm; }
  .sig-row { display: flex; gap: 8mm; margin-top: 12mm; }
  .sig-box { flex: 1; text-align: center; border-top: 1px solid #333; padding-top: 2mm; font-size: 8.5pt; color: #555; }
  .journal-box { margin-top: 5mm; padding: 3mm 4mm; border: 1px solid #ddd; border-radius: 3px; font-size: 8.5pt; color: #555; line-height: 1.6; }
  .footer { margin-top: 8mm; padding-top: 3mm; border-top: 1px solid #ddd; font-size: 7.5pt; color: #999; text-align: center; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`

// ── CSS Thermal ───────────────────────────────────────────────
const CSS_THERMAL = `
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap');
  @page { size: 80mm auto; margin: 2mm 3mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Sarabun', sans-serif; font-size: 8pt; color: #000; background: #fff; width: 72mm; }
  .center { text-align: center; }
  .right { text-align: right; }
  .bold { font-weight: 700; }
  .company-name { font-size: 11pt; font-weight: 700; }
  .doc-type { font-size: 9pt; font-weight: 600; margin: 1mm 0; }
  .doc-no { font-size: 9pt; font-weight: 700; }
  .divider { border: none; border-top: 1px dashed #000; margin: 2mm 0; }
  .divider-solid { border: none; border-top: 1px solid #000; margin: 2mm 0; }
  .row { display: flex; justify-content: space-between; font-size: 8pt; margin: 0.8mm 0; }
  .row label { color: #444; flex-shrink: 0; }
  .row span { text-align: right; }
  table { width: 100%; border-collapse: collapse; font-size: 7.5pt; }
  table th { font-weight: 700; border-bottom: 1px solid #000; padding: 1mm; }
  table td { padding: 1mm; vertical-align: top; border-bottom: 1px dashed #ccc; }
  table td.right { text-align: right; }
  .total-line { font-size: 10pt; font-weight: 700; }
  .sig-area { margin-top: 6mm; border-top: 1px solid #000; padding-top: 2mm; text-align: center; font-size: 7.5pt; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`

// ── open window ───────────────────────────────────────────────
function openPrint(css: string, body: string, format: SalesPrintFormat) {
  const w = window.open('', '_blank', format === 'a4' ? 'width=900,height=1200' : 'width=340,height=700')
  if (!w) { alert('กรุณาอนุญาต pop-up เพื่อพิมพ์เอกสาร'); return }
  w.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">
    <title>พิมพ์เอกสาร</title><style>${css}</style></head><body>${body}</body></html>`)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 600)
}

// ─────────────────────────────────────────────────────────────
// 1. QT — ใบเสนอราคา A4
// ─────────────────────────────────────────────────────────────
function templateQT_A4(d: any): string {
  const rows = (d.items || []).map((it: any, i: number) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td>${it.product_name || it.productName || '-'}</td>
      <td class="center">${it.quantity}</td>
      <td class="center">${it.unit || '-'}</td>
      <td class="right">${fmt(it.unit_price)}</td>
      <td class="right">${it.discount_percent > 0 ? `${it.discount_percent}%` : '-'}</td>
      <td class="right">${fmt(it.total_price)}</td>
    </tr>`).join('')
  const expiryColor = d.expiry_date && new Date(d.expiry_date) < new Date() ? 'color:#dc2626' : 'color:#111'
  return `<div class="page">
    <div class="header">
      <div class="company-block">
        ${d._companyLogo ? `<img src="${d._companyLogo}" style="height:14mm;margin-bottom:2mm;object-fit:contain;display:block">` : ''}
        <div class="company-name">${d._company || '-'}</div>
        ${d._companyAddress ? `<div style="white-space:pre-line">${d._companyAddress}</div>` : ''}
        ${d._companyPhone ? `<div>โทร: ${d._companyPhone}</div>` : ''}
        ${d._companyTax ? `<div>เลขผู้เสียภาษี: ${d._companyTax}</div>` : ''}
      </div>
      <div class="doc-title">
        <h1>ใบเสนอราคา</h1>
        <div class="doc-number">${d.quotation_number}</div>
        <div class="doc-date">วันที่: ${fmtDate(d.quotation_date)}</div>
        <div class="doc-date" style="${expiryColor}">หมดอายุ: ${fmtDate(d.expiry_date)}</div>
        <div style="margin-top:2mm"><span style="display:inline-block;padding:1mm 3mm;background:#f3f4f6;border-radius:2px;font-size:8pt;font-weight:600">${STATUS_TH[d.status] || d.status}</span></div>
      </div>
    </div>
    <div class="info-row">
      <div class="info-box" style="flex:2">
        <label>ลูกค้า</label>
        <div class="value">${d.customer_name || '-'}</div>
        ${d.customer_code ? `<div class="sub">รหัส: ${d.customer_code}</div>` : ''}
        ${d.customer_address ? `<div class="sub">${d.customer_address}</div>` : ''}
        ${d.customer_phone ? `<div class="sub">โทร: ${d.customer_phone}</div>` : ''}
      </div>
      <div class="info-box">
        <label>ภาษีมูลค่าเพิ่ม</label>
        <div class="value">${d.tax_rate || 0}%</div>
      </div>
    </div>
    <table>
      <thead><tr>
        <th class="center" style="width:8mm">#</th>
        <th>รายการสินค้า</th>
        <th class="center" style="width:18mm">จำนวน</th>
        <th class="center" style="width:14mm">หน่วย</th>
        <th class="right" style="width:24mm">ราคา/หน่วย</th>
        <th class="right" style="width:16mm">ส่วนลด</th>
        <th class="right" style="width:26mm">รวม (บาท)</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div class="totals-box">
        <div class="totals-row"><span>ราคาสินค้า</span><span>${fmt(d.subtotal)}</span></div>
        ${(d.discount_amount || 0) > 0 ? `<div class="totals-row" style="color:#dc2626"><span>ส่วนลดรวม</span><span>-${fmt(d.discount_amount)}</span></div>` : ''}
        ${(d.tax_amount || 0) > 0 ? `<div class="totals-row"><span>VAT ${d.tax_rate}%</span><span>${fmt(d.tax_amount)}</span></div>` : ''}
        <div class="totals-row grand"><span>รวมทั้งสิ้น</span><span>${fmt(d.total_amount)}</span></div>
      </div>
    </div>
    ${d.notes ? `<div class="notes-box"><label>เงื่อนไข / หมายเหตุ</label>${d.notes}</div>` : ''}
    <div class="sig-row">
      <div class="sig-box">ฝ่ายขาย<br><br>&nbsp;</div>
      <div class="sig-box">ลูกค้า (ตอบรับ)<br><br>&nbsp;</div>
      <div class="sig-box">ผู้อนุมัติ<br><br>&nbsp;</div>
    </div>
    <div class="footer">ใบเสนอราคา ${d.quotation_number} · พิมพ์เมื่อ ${new Date().toLocaleString('th-TH')}</div>
  </div>`
}

// ─────────────────────────────────────────────────────────────
// 1b. QT — Thermal (สำเนาสั้น)
// ─────────────────────────────────────────────────────────────
function templateQT_Thermal(d: any): string {
  const rows = (d.items || []).map((it: any, i: number) => `
    <tr>
      <td>${i + 1}. ${it.product_name || it.productName || '-'}</td>
      <td class="right">${it.quantity}×${fmt(it.unit_price)}</td>
      <td class="right">${fmt(it.total_price)}</td>
    </tr>`).join('')
  return `<div class="center">
    <div class="company-name">${d._company || '-'}</div>
    <div class="doc-type">ใบเสนอราคา</div>
    <div class="doc-no">${d.quotation_number}</div>
  </div>
  <hr class="divider-solid">
  <div class="row"><label>ลูกค้า</label><span style="text-align:right;max-width:40mm">${d.customer_name}</span></div>
  <div class="row"><label>วันที่</label><span>${fmtDate(d.quotation_date)}</span></div>
  <div class="row"><label>หมดอายุ</label><span>${fmtDate(d.expiry_date)}</span></div>
  <div class="row"><label>สถานะ</label><span>${STATUS_TH[d.status] || d.status}</span></div>
  <hr class="divider">
  <table>
    <thead><tr>
      <th style="text-align:left">รายการ</th>
      <th style="text-align:right">จำนวน×ราคา</th>
      <th style="text-align:right">รวม</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <hr class="divider-solid">
  ${(d.discount_amount || 0) > 0 ? `<div class="row"><label>ส่วนลด</label><span>-${fmt(d.discount_amount)}</span></div>` : ''}
  ${(d.tax_amount || 0) > 0 ? `<div class="row"><label>VAT ${d.tax_rate}%</label><span>${fmt(d.tax_amount)}</span></div>` : ''}
  <div class="row total-line"><label>รวมสุทธิ</label><span>${fmt(d.total_amount)}</span></div>
  <div class="center" style="font-size:7pt;color:#888;margin-top:3mm">พิมพ์เมื่อ ${new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</div>`
}

// ─────────────────────────────────────────────────────────────
// 2. SO — ใบยืนยันคำสั่งขาย A4
// ─────────────────────────────────────────────────────────────
function templateSO_A4(d: any): string {
  const rows = (d.items || []).map((it: any, i: number) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td>${it.product_name || '-'}</td>
      <td class="center">${it.quantity}</td>
      <td class="center">${it.unit || '-'}</td>
      <td class="right">${fmt(it.unit_price)}</td>
      <td class="right">${it.discount_percent > 0 ? `${it.discount_percent}%` : '-'}</td>
      <td class="right">${fmt(it.total_price)}</td>
    </tr>`).join('')
  const isLate = d.delivery_date && new Date(d.delivery_date) < new Date() && !['DELIVERED', 'COMPLETED'].includes(d.status)
  return `<div class="page">
    <div class="header">
      <div class="company-block">
        ${d._companyLogo ? `<img src="${d._companyLogo}" style="height:14mm;margin-bottom:2mm;object-fit:contain;display:block">` : ''}
        <div class="company-name">${d._company || '-'}</div>
        ${d._companyAddress ? `<div style="white-space:pre-line">${d._companyAddress}</div>` : ''}
        ${d._companyPhone ? `<div>โทร: ${d._companyPhone}</div>` : ''}
        ${d._companyTax ? `<div>เลขผู้เสียภาษี: ${d._companyTax}</div>` : ''}
      </div>
      <div class="doc-title">
        <h1>ใบยืนยันคำสั่งขาย</h1>
        <div class="doc-number">${d.so_number}</div>
        <div class="doc-date">วันที่สั่ง: ${fmtDate(d.order_date)}</div>
        <div class="doc-date" style="${isLate ? 'color:#dc2626;font-weight:600' : ''}">กำหนดส่ง: ${fmtDate(d.delivery_date)}${isLate ? ' ⚠' : ''}</div>
        <div style="margin-top:2mm"><span style="display:inline-block;padding:1mm 3mm;background:#f3f4f6;border-radius:2px;font-size:8pt;font-weight:600">${STATUS_TH[d.status] || d.status}</span></div>
      </div>
    </div>
    <div class="info-row">
      <div class="info-box" style="flex:2">
        <label>ลูกค้า</label>
        <div class="value">${d.customer_name || '-'}</div>
        ${d.customer_code ? `<div class="sub">รหัส: ${d.customer_code}</div>` : ''}
        ${d.customer_address ? `<div class="sub">${d.customer_address}</div>` : ''}
        ${d.customer_phone ? `<div class="sub">โทร: ${d.customer_phone}</div>` : ''}
      </div>
      ${d.quotation_number ? `
      <div class="info-box">
        <label>อ้างอิงใบเสนอราคา</label>
        <div class="value">${d.quotation_number}</div>
      </div>` : ''}
      <div class="info-box">
        <label>ภาษีมูลค่าเพิ่ม</label>
        <div class="value">${d.tax_rate || 0}%</div>
      </div>
    </div>
    <table>
      <thead><tr>
        <th class="center" style="width:8mm">#</th>
        <th>รายการสินค้า</th>
        <th class="center" style="width:18mm">จำนวน</th>
        <th class="center" style="width:14mm">หน่วย</th>
        <th class="right" style="width:24mm">ราคา/หน่วย</th>
        <th class="right" style="width:16mm">ส่วนลด</th>
        <th class="right" style="width:26mm">รวม (บาท)</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div class="totals-box">
        <div class="totals-row"><span>ราคาสินค้า</span><span>${fmt(d.subtotal)}</span></div>
        ${(d.discount_amount || 0) > 0 ? `<div class="totals-row" style="color:#dc2626"><span>ส่วนลดรวม</span><span>-${fmt(d.discount_amount)}</span></div>` : ''}
        ${(d.tax_amount || 0) > 0 ? `<div class="totals-row"><span>VAT ${d.tax_rate}%</span><span>${fmt(d.tax_amount)}</span></div>` : ''}
        <div class="totals-row grand"><span>รวมทั้งสิ้น</span><span>${fmt(d.total_amount)}</span></div>
      </div>
    </div>
    ${d.notes ? `<div class="notes-box"><label>เงื่อนไข / หมายเหตุ</label>${d.notes}</div>` : ''}
    <div class="sig-row">
      <div class="sig-box">ฝ่ายขาย<br><br>&nbsp;</div>
      <div class="sig-box">ลูกค้า (รับทราบ)<br><br>&nbsp;</div>
      <div class="sig-box">ผู้อนุมัติ<br><br>&nbsp;</div>
    </div>
    <div class="footer">คำสั่งขาย ${d.so_number} · พิมพ์เมื่อ ${new Date().toLocaleString('th-TH')}</div>
  </div>`
}

// ─────────────────────────────────────────────────────────────
// 3. INV — ใบแจ้งหนี้ / ใบกำกับภาษี A4
// ─────────────────────────────────────────────────────────────
function templateINV_A4(d: any): string {
  const rows = (d.items || []).map((it: any, i: number) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td>${it.product_name || '-'}</td>
      <td class="center">${it.quantity}</td>
      <td class="right">${fmt(it.unit_price)}</td>
      <td class="right">${fmt(it.total_price)}</td>
    </tr>`).join('')
  const isOverdue = d.payment_status === 'OVERDUE'
  const netRevenue = (d.total_amount || 0) - (d.tax_amount || 0)
  return `<div class="page">
    <div class="header">
      <div class="company-block">
        ${d._companyLogo ? `<img src="${d._companyLogo}" style="height:14mm;margin-bottom:2mm;object-fit:contain;display:block">` : ''}
        <div class="company-name">${d._company || '-'}</div>
        ${d._companyAddress ? `<div style="white-space:pre-line">${d._companyAddress}</div>` : ''}
        ${d._companyPhone ? `<div>โทร: ${d._companyPhone}</div>` : ''}
        ${d._companyTax ? `<div>เลขผู้เสียภาษี: ${d._companyTax}</div>` : ''}
      </div>
      <div class="doc-title">
        <h1>ใบแจ้งหนี้ / ใบกำกับภาษี</h1>
        <div class="doc-number">${d.invoice_number}</div>
        <div class="doc-date">วันที่ออกใบ: ${fmtDate(d.invoice_date)}</div>
        <div class="doc-date" style="${isOverdue ? 'color:#dc2626;font-weight:600' : ''}">ครบกำหนด: ${fmtDate(d.due_date)}${isOverdue ? ' ⚠ เกินกำหนด' : ''}</div>
      </div>
    </div>
    <div class="info-row">
      <div class="info-box" style="flex:2">
        <label>ออกให้</label>
        <div class="value">${d.customer_name || '-'}</div>
        ${d.customer_code ? `<div class="sub">รหัส: ${d.customer_code}</div>` : ''}
        ${d.customer_address ? `<div class="sub">${d.customer_address}</div>` : ''}
        ${d.customer_phone ? `<div class="sub">โทร: ${d.customer_phone}</div>` : ''}
        ${d.customer_email ? `<div class="sub">อีเมล: ${d.customer_email}</div>` : ''}
      </div>
      <div class="info-box">
        <label>อ้างอิง SO</label>
        <div class="value">${d.so_number || '-'}</div>
      </div>
      <div class="info-box">
        <label>สถานะชำระ</label>
        <div class="value" style="${isOverdue ? 'color:#dc2626' : ''}">${STATUS_TH[d.payment_status] || d.payment_status}</div>
      </div>
    </div>
    <table>
      <thead><tr>
        <th class="center" style="width:8mm">#</th>
        <th>รายการ</th>
        <th class="center" style="width:18mm">จำนวน</th>
        <th class="right" style="width:28mm">ราคา/หน่วย</th>
        <th class="right" style="width:28mm">รวม (บาท)</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div class="totals-box">
        ${(d.tax_amount || 0) > 0 ? `
        <div class="totals-row"><span>มูลค่าสินค้าก่อนภาษี</span><span>${fmt(netRevenue)}</span></div>
        <div class="totals-row"><span>VAT ${d.tax_rate || 7}%</span><span>${fmt(d.tax_amount)}</span></div>` : ''}
        ${(d.discount_amount || 0) > 0 ? `<div class="totals-row" style="color:#dc2626"><span>ส่วนลด</span><span>-${fmt(d.discount_amount)}</span></div>` : ''}
        <div class="totals-row grand"><span>รวมทั้งสิ้น</span><span>${fmt(d.total_amount)}</span></div>
        ${(d.paid_amount || 0) > 0 ? `<div class="totals-row" style="color:#059669"><span>ชำระแล้ว</span><span>-${fmt(d.paid_amount)}</span></div>` : ''}
        ${(d.balance_amount || 0) > 0 ? `<div class="totals-row balance"><span>ยอดคงค้าง</span><span>${fmt(d.balance_amount)}</span></div>` : ''}
      </div>
    </div>
    <div class="journal-box">
      <strong>รายการบัญชีอัตโนมัติ (JV)</strong><br>
      Dr. 1180 ลูกหนี้การค้า &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${fmt(d.total_amount)} บาท<br>
      Cr. 4100 รายได้จากการขาย &nbsp; ${fmt(netRevenue)} บาท${(d.tax_amount || 0) > 0 ? `<br>Cr. 2210 ภาษีขายค้างจ่าย &nbsp;&nbsp;&nbsp; ${fmt(d.tax_amount)} บาท` : ''}
    </div>
    ${d.notes ? `<div class="notes-box"><label>หมายเหตุ</label>${d.notes}</div>` : ''}
    <div class="sig-row">
      <div class="sig-box">ผู้ออกใบแจ้งหนี้<br><br>&nbsp;</div>
      <div class="sig-box">ลูกค้า (ยืนยัน)<br><br>&nbsp;</div>
      <div class="sig-box">ผู้อนุมัติ<br><br>&nbsp;</div>
    </div>
    <div class="footer">ใบแจ้งหนี้ ${d.invoice_number} · SO: ${d.so_number || '-'} · พิมพ์เมื่อ ${new Date().toLocaleString('th-TH')}</div>
  </div>`
}

// ─────────────────────────────────────────────────────────────
// 3b. INV — Thermal (สลิปแจ้งหนี้)
// ─────────────────────────────────────────────────────────────
function templateINV_Thermal(d: any): string {
  const rows = (d.items || []).map((it: any, i: number) => `
    <tr>
      <td>${i + 1}. ${it.product_name || '-'}</td>
      <td class="right">${it.quantity}×${fmt(it.unit_price)}</td>
      <td class="right">${fmt(it.total_price)}</td>
    </tr>`).join('')
  return `<div class="center">
    <div class="company-name">${d._company || '-'}</div>
    <div class="doc-type">ใบแจ้งหนี้</div>
    <div class="doc-no">${d.invoice_number}</div>
  </div>
  <hr class="divider-solid">
  <div class="row"><label>ลูกค้า</label><span style="text-align:right;max-width:38mm">${d.customer_name}</span></div>
  <div class="row"><label>SO</label><span>${d.so_number || '-'}</span></div>
  <div class="row"><label>วันที่ออก</label><span>${fmtDate(d.invoice_date)}</span></div>
  <div class="row"><label>ครบกำหนด</label><span>${fmtDate(d.due_date)}</span></div>
  <hr class="divider">
  <table>
    <thead><tr>
      <th style="text-align:left">รายการ</th>
      <th style="text-align:right">จำนวน×ราคา</th>
      <th style="text-align:right">รวม</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <hr class="divider-solid">
  ${(d.tax_amount || 0) > 0 ? `<div class="row"><label>VAT ${d.tax_rate}%</label><span>${fmt(d.tax_amount)}</span></div>` : ''}
  <div class="row total-line"><label>รวมสุทธิ</label><span>${fmt(d.total_amount)}</span></div>
  ${(d.paid_amount || 0) > 0 ? `<div class="row"><label>ชำระแล้ว</label><span>${fmt(d.paid_amount)}</span></div>
  <div class="row bold"><label>ยอดค้าง</label><span>${fmt(d.balance_amount)}</span></div>` : ''}
  <div class="center" style="font-size:7pt;color:#888;margin-top:3mm">พิมพ์เมื่อ ${new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</div>`
}

// ─────────────────────────────────────────────────────────────
// 4. RC — ใบเสร็จรับเงิน A4
// ─────────────────────────────────────────────────────────────
function templateRC_A4(d: any): string {
  return `<div class="page">
    <div class="header">
      <div class="company-block">
        ${d._companyLogo ? `<img src="${d._companyLogo}" style="height:14mm;margin-bottom:2mm;object-fit:contain;display:block">` : ''}
        <div class="company-name">${d._company || '-'}</div>
        ${d._companyAddress ? `<div style="white-space:pre-line">${d._companyAddress}</div>` : ''}
        ${d._companyPhone ? `<div>โทร: ${d._companyPhone}</div>` : ''}
        ${d._companyTax ? `<div>เลขผู้เสียภาษี: ${d._companyTax}</div>` : ''}
      </div>
      <div class="doc-title">
        <h1>ใบเสร็จรับเงิน</h1>
        <div class="doc-number">${d.receipt_number}</div>
        <div class="doc-date">วันที่รับเงิน: ${fmtDate(d.receipt_date)}</div>
      </div>
    </div>
    <div class="info-row">
      <div class="info-box" style="flex:2">
        <label>รับเงินจาก</label>
        <div class="value">${d.customer_name || '-'}</div>
        ${d.customer_code ? `<div class="sub">รหัส: ${d.customer_code}</div>` : ''}
      </div>
      <div class="info-box">
        <label>ชำระตามใบแจ้งหนี้</label>
        <div class="value">${d.invoice_number || '-'}</div>
        ${d.so_number ? `<div class="sub">SO: ${d.so_number}</div>` : ''}
      </div>
      <div class="info-box">
        <label>วิธีชำระเงิน</label>
        <div class="value">${METHOD_TH[d.payment_method] || d.payment_method || '-'}</div>
        ${d.payment_reference ? `<div class="sub">อ้างอิง: ${d.payment_reference}</div>` : ''}
      </div>
    </div>
    <table style="margin-top:6mm">
      <thead><tr>
        <th>รายการ</th>
        <th class="right" style="width:40mm">จำนวนเงิน (บาท)</th>
      </tr></thead>
      <tbody>
        <tr><td>รับชำระเงินค่าสินค้า/บริการ</td><td class="right">${fmt(d.amount)}</td></tr>
      </tbody>
    </table>
    <div class="totals">
      <div class="totals-box">
        <div class="totals-row grand"><span>รวมรับทั้งสิ้น</span><span>${fmt(d.amount)}</span></div>
      </div>
    </div>
    <div class="journal-box">
      <strong>รายการบัญชีอัตโนมัติ (JV)</strong><br>
      Dr. ${d.payment_method === 'TRANSFER' || d.payment_method === 'CHEQUE' ? '1102 เงินฝากธนาคาร' : '1101 เงินสด'} &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${fmt(d.amount)} บาท<br>
      Cr. 1180 ลูกหนี้การค้า &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${fmt(d.amount)} บาท
    </div>
    ${d.notes ? `<div class="notes-box"><label>หมายเหตุ</label>${d.notes}</div>` : ''}
    <div class="sig-row">
      <div class="sig-box">ผู้รับเงิน<br><br>&nbsp;</div>
      <div class="sig-box">ผู้จ่ายเงิน<br><br>&nbsp;</div>
    </div>
    <div class="footer">ใบเสร็จ ${d.receipt_number} · INV: ${d.invoice_number || '-'} · พิมพ์เมื่อ ${new Date().toLocaleString('th-TH')}</div>
  </div>`
}

// ─────────────────────────────────────────────────────────────
// 4b. RC — Thermal
// ─────────────────────────────────────────────────────────────
function templateRC_Thermal(d: any): string {
  return `<div class="center">
    <div class="company-name">${d._company || '-'}</div>
    <div class="doc-type">ใบเสร็จรับเงิน</div>
    <div class="doc-no">${d.receipt_number}</div>
  </div>
  <hr class="divider-solid">
  <div class="row"><label>ลูกค้า</label><span style="text-align:right;max-width:38mm">${d.customer_name}</span></div>
  <div class="row"><label>INV</label><span>${d.invoice_number || '-'}</span></div>
  <div class="row"><label>วันที่รับ</label><span>${fmtDate(d.receipt_date)}</span></div>
  <div class="row"><label>วิธีชำระ</label><span>${METHOD_TH[d.payment_method] || d.payment_method || '-'}</span></div>
  ${d.payment_reference ? `<div class="row"><label>อ้างอิง</label><span>${d.payment_reference}</span></div>` : ''}
  <hr class="divider-solid">
  <div class="row total-line"><label>รับชำระ</label><span>${fmt(d.amount)}</span></div>
  <div class="sig-area">ลายเซ็นผู้รับ _______________<br><span style="font-size:7pt;color:#666">พิมพ์เมื่อ ${new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</span></div>`
}

// ─────────────────────────────────────────────────────────────
// 5. CN — ใบลดหนี้ A4
// ─────────────────────────────────────────────────────────────
function templateCN_A4(d: any): string {
  const rows = (d.items || []).map((it: any, i: number) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td>${it.product_name || '-'}</td>
      <td class="center">${it.quantity}</td>
      <td class="right">${fmt(it.unit_price)}</td>
      <td class="right">${fmt(it.total_price)}</td>
    </tr>`).join('')
  return `<div class="page">
    <div class="header">
      <div class="company-block">
        ${d._companyLogo ? `<img src="${d._companyLogo}" style="height:14mm;margin-bottom:2mm;object-fit:contain;display:block">` : ''}
        <div class="company-name">${d._company || '-'}</div>
        ${d._companyAddress ? `<div style="white-space:pre-line">${d._companyAddress}</div>` : ''}
        ${d._companyPhone ? `<div>โทร: ${d._companyPhone}</div>` : ''}
        ${d._companyTax ? `<div>เลขผู้เสียภาษี: ${d._companyTax}</div>` : ''}
      </div>
      <div class="doc-title">
        <h1>ใบลดหนี้</h1>
        <div class="doc-number">${d.cn_number}</div>
        <div class="doc-date">วันที่: ${fmtDate(d.credit_date)}</div>
        <div style="margin-top:2mm"><span style="display:inline-block;padding:1mm 3mm;background:#fee2e2;color:#991b1b;border-radius:2px;font-size:8pt;font-weight:600">${STATUS_TH[d.status] || d.status}</span></div>
      </div>
    </div>
    <div class="info-row">
      <div class="info-box" style="flex:2">
        <label>ลูกค้า</label>
        <div class="value">${d.customer_name || '-'}</div>
        ${d.customer_code ? `<div class="sub">รหัส: ${d.customer_code}</div>` : ''}
      </div>
      <div class="info-box">
        <label>อ้างอิงใบแจ้งหนี้</label>
        <div class="value">${d.invoice_number || '-'}</div>
      </div>
    </div>
    <div style="margin-bottom:4mm;padding:3mm 4mm;border:1px solid #fecaca;border-radius:3px;background:#fff5f5">
      <label style="font-size:7.5pt;color:#888;display:block;margin-bottom:1mm">เหตุผลการลดหนี้</label>
      <div style="font-size:9.5pt;font-weight:600;color:#111">${d.reason || '-'}</div>
    </div>
    ${rows ? `
    <table>
      <thead><tr>
        <th class="center" style="width:8mm">#</th>
        <th>รายการ</th>
        <th class="center" style="width:18mm">จำนวน</th>
        <th class="right" style="width:28mm">ราคา/หน่วย</th>
        <th class="right" style="width:28mm">รวม (บาท)</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>` : ''}
    <div class="totals">
      <div class="totals-box">
        <div class="totals-row grand" style="color:#dc2626"><span>ยอดลดหนี้ทั้งสิ้น</span><span>-${fmt(d.total_amount)}</span></div>
      </div>
    </div>
    ${d.notes ? `<div class="notes-box"><label>หมายเหตุ</label>${d.notes}</div>` : ''}
    <div class="sig-row">
      <div class="sig-box">ฝ่ายขาย<br><br>&nbsp;</div>
      <div class="sig-box">ลูกค้า (รับทราบ)<br><br>&nbsp;</div>
      <div class="sig-box">ผู้อนุมัติ<br><br>&nbsp;</div>
    </div>
    <div class="footer">ใบลดหนี้ ${d.cn_number} · INV: ${d.invoice_number || '-'} · พิมพ์เมื่อ ${new Date().toLocaleString('th-TH')}</div>
  </div>`
}

// ─────────────────────────────────────────────────────────────
// Main entry
// ─────────────────────────────────────────────────────────────
export function printSalesDoc(type: SalesDocType, data: any, format: SalesPrintFormat = 'a4') {
  let html = ''
  const css = format === 'thermal' ? CSS_THERMAL : CSS_A4

  switch (type) {
    case 'qt':
      html = format === 'thermal' ? templateQT_Thermal(data) : templateQT_A4(data); break
    case 'so':
      html = templateSO_A4(data); break
    case 'inv':
      html = format === 'thermal' ? templateINV_Thermal(data) : templateINV_A4(data); break
    case 'rc':
      html = format === 'thermal' ? templateRC_Thermal(data) : templateRC_A4(data); break
    case 'cn':
      html = templateCN_A4(data); break
  }
  if (!html) return
  openPrint(css, html, format)
}
