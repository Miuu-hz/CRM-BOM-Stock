// ============================================================
// Purchase Print Utility — A4 + Thermal 80mm
// printDocument(type, data, format) handles all document types
// ============================================================

export type PrintFormat = 'a4' | 'thermal'
export type DocType = 'pr' | 'po' | 'gr' | 'pi' | 'payment' | 'return'

// ── shared helpers ────────────────────────────────────────────
const fmt = (n: number) => new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2 }).format(n || 0)
const fmtDate = (s?: string) => {
  if (!s) return '-'
  const d = new Date(s)
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
}
const STATUS_TH: Record<string, string> = {
  DRAFT: 'ร่าง', SUBMITTED: 'รออนุมัติ', APPROVED: 'อนุมัติแล้ว',
  CONFIRMED: 'ยืนยันแล้ว', RECEIVED: 'รับแล้ว', PARTIAL: 'รับบางส่วน',
  CANCELLED: 'ยกเลิก', ISSUED: 'ออกแล้ว', PAID: 'จ่ายแล้ว', UNPAID: 'ค้างชำระ',
}

// ── XSS helpers ───────────────────────────────────────────────
function escapeHtml(s: unknown): unknown {
  if (typeof s !== 'string') return s
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
function deepEscape(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(deepEscape)
  if (obj !== null && typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(obj)) out[k] = deepEscape((obj as Record<string, unknown>)[k])
    return out
  }
  return escapeHtml(obj)
}
function safeImageUrl(url: unknown): string {
  if (typeof url !== 'string') return ''
  const lower = url.trim().toLowerCase()
  if (lower.startsWith('http://') || lower.startsWith('https://')) return url
  if (/^data:image\/(png|jpeg|jpg|gif|webp);base64,/.test(lower)) return url
  return ''
}

// ── CSS base ──────────────────────────────────────────────────
const CSS_A4 = `:root {
    --primary: #3949E5;
    --primary-soft: #EEF0FE;
    --success: #16A34A;
    --warning: #F5A524;
    --danger: #DC2626;
    --info: #3949E5;
    --fg-1: #1E1B16;
    --fg-2: #383426;
    --fg-3: #6B6658;
    --fg-4: #A8A294;
    --fg-on-brand: #FFFFFF;
    --border: #DEDACF;
    --border-strong: #CFCAB8;
    --border-subtle: #E8E3D4;
    --surface: #F8F5EE;
    --surface-2: #E8E3D4;
    --bg: #F0ECE2;
  }
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;600;700;800&display=swap');
  @page { size: A4 portrait; margin: 12mm 15mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Sarabun', sans-serif; font-size: 10pt; color: var(--fg-1); background: var(--fg-on-brand); }
  .page { max-width: 175mm; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2.5px solid var(--primary); padding-bottom: 6mm; margin-bottom: 5mm; }
  .company-block { font-size: 9pt; color: var(--fg-2); line-height: 1.65; }
  .company-name { font-size: 13pt; font-weight: 800; color: var(--fg-1); margin-bottom: 1mm; }
  .doc-title { text-align: right; padding: 4mm 5mm; background: var(--primary-soft); border: 1.5px solid var(--primary-soft); border-radius: 6px; min-width: 52mm; }
  .doc-title h1 { font-size: 15pt; font-weight: 800; color: var(--primary); }
  .doc-title .doc-number { font-size: 11pt; font-weight: 600; color: var(--fg-1); margin-top: 1.5mm; font-family: monospace; }
  .doc-title .doc-date { font-size: 8.5pt; color: var(--fg-3); margin-top: 1mm; }
  .info-row { display: flex; gap: 5mm; margin-bottom: 4mm; }
  .info-box { flex: 1; border: 1px solid var(--border); border-radius: 5px; padding: 2.5mm 3.5mm; background: var(--surface); }
  .info-box label { font-size: 7pt; color: var(--fg-4); text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 1mm; font-weight: 600; }
  .info-box .value { font-size: 9.5pt; font-weight: 700; color: var(--fg-1); }
  .info-box .sub { font-size: 8pt; color: var(--fg-3); margin-top: 0.5mm; }
  table { width: 100%; border-collapse: collapse; margin-top: 4mm; }
  table th { background: var(--primary); color: var(--fg-on-brand); font-size: 8pt; font-weight: 700; padding: 2.5mm 3mm; text-align: left; }
  table th.right, table td.right { text-align: right; }
  table th.center, table td.center { text-align: center; }
  table td { font-size: 9pt; padding: 2mm 3mm; border-bottom: 1px solid var(--border-subtle); vertical-align: top; }
  table tr:nth-child(even) td { background: var(--surface); }
  table tr:last-child td { border-bottom: 2px solid var(--border-strong); }
  .totals { margin-top: 3mm; display: flex; justify-content: flex-end; }
  .totals-box { width: 72mm; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
  .totals-row { display: flex; justify-content: space-between; padding: 2mm 3.5mm; font-size: 9.5pt; border-bottom: 1px solid var(--border-subtle); color: var(--fg-2); }
  .totals-row:last-child { border-bottom: none; }
  .totals-row.grand { font-size: 11.5pt; font-weight: 800; color: var(--fg-on-brand); background: var(--primary); padding: 3mm 3.5mm; border-bottom: none; }
  .totals-row.balance { color: var(--danger); font-weight: 700; }
  .notes-box { margin-top: 4mm; padding: 3mm 4mm; border: 1px solid var(--border); border-radius: 5px; background: var(--surface); }
  .notes-box label { font-size: 7pt; color: var(--fg-4); text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 1mm; font-weight: 600; }
  .journal-box { margin-top: 4mm; padding: 3mm 4mm; border: 1px solid var(--primary-soft); border-left: 3px solid var(--primary); border-radius: 5px; font-size: 8.5pt; color: var(--fg-2); line-height: 1.7; background: var(--primary-soft); }
  .status-badge { display: inline-block; padding: 1mm 3mm; border-radius: 3px; font-size: 8pt; font-weight: 600; }
  .badge-draft { background: var(--surface-2); color: var(--fg-2); }
  .badge-approved { background: var(--success-soft); color: var(--success); }
  .badge-pending { background: var(--warning-soft); color: var(--warning); }
  .sig-row { display: flex; gap: 8mm; margin-top: 12mm; }
  .sig-box { flex: 1; text-align: center; border-top: 1px solid var(--border-strong); padding-top: 2mm; font-size: 8.5pt; color: var(--fg-3); }
  .footer { margin-top: 7mm; padding-top: 3mm; border-top: 1px dashed var(--border); font-size: 7.5pt; color: var(--fg-4); text-align: center; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } table th { background: var(--primary) !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; } .totals-row.grand { background: var(--primary) !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`

const CSS_THERMAL = `:root {
    --primary: #3949E5;
    --primary-soft: #EEF0FE;
    --success: #16A34A;
    --warning: #F5A524;
    --danger: #DC2626;
    --info: #3949E5;
    --fg-1: #1E1B16;
    --fg-2: #383426;
    --fg-3: #6B6658;
    --fg-4: #A8A294;
    --fg-on-brand: #FFFFFF;
    --border: #DEDACF;
    --border-strong: #CFCAB8;
    --border-subtle: #E8E3D4;
    --surface: #F8F5EE;
    --surface-2: #E8E3D4;
    --bg: #F0ECE2;
  }
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap');
  @page { size: 80mm auto; margin: 2mm 3mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Sarabun', sans-serif; font-size: 8pt; color: var(--fg-1); background: var(--fg-on-brand); width: 72mm; }
  .center { text-align: center; }
  .right { text-align: right; }
  .bold { font-weight: 700; }
  .company-name { font-size: 12pt; font-weight: 800; }
  .doc-type { font-size: 9pt; font-weight: 700; margin: 1mm 0; }
  .doc-no { font-size: 9pt; font-weight: 600; font-family: monospace; }
  .divider { border: none; border-top: 1px dashed var(--fg-1); margin: 2mm 0; }
  .divider-solid { border: none; border-top: 1.5px solid var(--fg-1); margin: 2mm 0; }
  .row { display: flex; justify-content: space-between; font-size: 8pt; margin: 0.8mm 0; }
  .row label { color: var(--fg-2); flex-shrink: 0; }
  .row span { text-align: right; }
  table { width: 100%; border-collapse: collapse; font-size: 7.5pt; }
  table th { font-weight: 700; border-top: 1px solid var(--fg-1); border-bottom: 1px solid var(--fg-1); padding: 1mm; }
  table td { padding: 1mm; vertical-align: top; border-bottom: 1px dashed var(--border-strong); }
  table td.right { text-align: right; }
  .total-line { font-size: 11pt; font-weight: 800; }
  .sig-area { margin-top: 6mm; border-top: 1px solid var(--fg-1); padding-top: 2mm; text-align: center; font-size: 7.5pt; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`

// ── open print window ─────────────────────────────────────────
function openPrint(css: string, body: string, format: PrintFormat) {
  const w = window.open('', '_blank', format === 'a4' ? 'width=900,height=1200' : 'width=340,height=700')
  if (!w) { alert('กรุณาอนุญาต pop-up เพื่อพิมพ์เอกสาร'); return }
  w.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">
    <title>พิมพ์เอกสาร</title><style>${css}</style></head><body>${body}</body></html>`)
  w.document.close()
  w.focus()
  setTimeout(() => { w.print(); }, 600)
}

// ─────────────────────────────────────────────────────────────
// 1. PR — Purchase Request (A4 only)
// ─────────────────────────────────────────────────────────────
function templatePR_A4(d: any): string {
  const rows = (d.items || []).map((it: any, i: number) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td>${it.description || it.material_name || '-'}</td>
      <td class="center">${it.quantity}</td>
      <td class="center">${it.unit || '-'}</td>
      <td class="right">${fmt(it.estimated_unit_price)}</td>
      <td class="right">${fmt(it.estimated_total_price || it.quantity * it.estimated_unit_price)}</td>
    </tr>`).join('')
  const statusBadge = `<span class="status-badge ${d.status === 'APPROVED' ? 'badge-approved' : d.status === 'DRAFT' ? 'badge-draft' : 'badge-pending'}">${STATUS_TH[d.status] || d.status}</span>`
  return `<div class="page">
    <div class="header">
      <div class="company-block">
        <div class="company-name">${d._company || 'บริษัท'}</div>
        <div>${d._companyAddress || ''}</div>
        <div>เลขผู้เสียภาษี: ${d._companyTax || '-'}</div>
      </div>
      <div class="doc-title">
        <h1>ใบขอซื้อ</h1>
        <div class="doc-number">${d.pr_number}</div>
        <div class="doc-date">วันที่: ${fmtDate(d.request_date)}</div>
        <div style="margin-top:2mm">${statusBadge}</div>
      </div>
    </div>
    <div class="info-row">
      <div class="info-box"><label>ผู้ขอซื้อ</label><div class="value">${d.requester_name || '-'}</div></div>
      <div class="info-box"><label>แผนก</label><div class="value">${d.department || '-'}</div></div>
      <div class="info-box"><label>วันที่ต้องการ</label><div class="value">${fmtDate(d.required_date)}</div></div>
      <div class="info-box"><label>ความสำคัญ</label><div class="value">${d.priority === 'HIGH' ? 'สูง' : d.priority === 'LOW' ? 'ต่ำ' : 'ปกติ'}</div></div>
    </div>
    <table>
      <thead><tr>
        <th class="center" style="width:8mm">#</th>
        <th>รายการ</th>
        <th class="center" style="width:15mm">จำนวน</th>
        <th class="center" style="width:15mm">หน่วย</th>
        <th class="right" style="width:22mm">ราคาต่อหน่วย</th>
        <th class="right" style="width:24mm">รวม</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div class="totals-box">
        <div class="totals-row grand"><span>รวมประมาณการ</span><span>${fmt(d.total_amount)}</span></div>
      </div>
    </div>
    ${d.notes ? `<div class="notes-box"><label>หมายเหตุ</label>${d.notes}</div>` : ''}
    <div class="sig-row">
      <div class="sig-box">ผู้ขอ<br><br>${d.requester_name || ''}</div>
      <div class="sig-box">ผู้อนุมัติ<br><br>&nbsp;</div>
      <div class="sig-box">ฝ่ายจัดซื้อ<br><br>&nbsp;</div>
    </div>
    <div class="footer">พิมพ์เมื่อ ${new Date().toLocaleString('th-TH')}</div>
  </div>`
}

// ─────────────────────────────────────────────────────────────
// 2. PO — Purchase Order (A4 only)
// ─────────────────────────────────────────────────────────────
function templatePO_A4(d: any): string {
  const rows = (d.items || []).map((it: any, i: number) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td>${it.description || '-'}</td>
      <td class="center">${it.quantity}</td>
      <td class="center">${it.unit || '-'}</td>
      <td class="right">${fmt(it.unit_price)}</td>
      <td class="right">${fmt(it.total_price || it.quantity * it.unit_price)}</td>
    </tr>`).join('')
  return `<div class="page">
    <div class="header">
      <div class="company-block">
        <div class="company-name">${d._company || 'บริษัท'}</div>
        <div>${d._companyAddress || ''}</div>
        <div>เลขผู้เสียภาษี: ${d._companyTax || '-'}</div>
      </div>
      <div class="doc-title">
        <h1>ใบสั่งซื้อ</h1>
        <div class="doc-number">${d.po_number}</div>
        <div class="doc-date">วันที่สั่ง: ${fmtDate(d.order_date)}</div>
        <div class="doc-date">กำหนดรับ: ${fmtDate(d.expected_date)}</div>
      </div>
    </div>
    <div class="info-row">
      <div class="info-box" style="flex:2">
        <label>ผู้ขาย (Supplier)</label>
        <div class="value">${d.supplier_name || '-'}</div>
        <div class="sub">รหัส: ${d.supplier_code || '-'}</div>
        ${d.supplier_tax_id ? `<div class="sub">เลขผู้เสียภาษี: ${d.supplier_tax_id}</div>` : ''}
        ${d.supplier_phone ? `<div class="sub">โทร: ${d.supplier_phone}</div>` : ''}
      </div>
      <div class="info-box">
        <label>อ้างอิง PR</label>
        <div class="value">${d.linked_pr_number || '-'}</div>
      </div>
      <div class="info-box">
        <label>เครดิต (วัน)</label>
        <div class="value">${d.payment_terms || 30} วัน</div>
      </div>
    </div>
    <table>
      <thead><tr>
        <th class="center" style="width:8mm">#</th>
        <th>รายการ</th>
        <th class="center" style="width:14mm">จำนวน</th>
        <th class="center" style="width:12mm">หน่วย</th>
        <th class="right" style="width:22mm">ราคาต่อหน่วย</th>
        <th class="right" style="width:24mm">รวม (บาท)</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div class="totals-box">
        <div class="totals-row"><span>ราคาสินค้า</span><span>${fmt(d.subtotal)}</span></div>
        <div class="totals-row"><span>VAT ${d.tax_rate || 7}%</span><span>${fmt(d.tax_amount)}</span></div>
        <div class="totals-row grand"><span>รวมทั้งสิ้น</span><span>${fmt(d.total_amount)}</span></div>
      </div>
    </div>
    ${d.notes ? `<div class="notes-box"><label>เงื่อนไข / หมายเหตุ</label>${d.notes}</div>` : ''}
    <div class="sig-row">
      <div class="sig-box">ผู้จัดซื้อ<br><br>&nbsp;</div>
      <div class="sig-box">ผู้อนุมัติ<br><br>&nbsp;</div>
      <div class="sig-box">ผู้ขาย (รับทราบ)<br><br>&nbsp;</div>
    </div>
    <div class="footer">พิมพ์เมื่อ ${new Date().toLocaleString('th-TH')} · ${d.po_number}</div>
  </div>`
}

// ─────────────────────────────────────────────────────────────
// 3a. GR — A4 (Goods Receipt filing copy)
// ─────────────────────────────────────────────────────────────
function templateGR_A4(d: any): string {
  const rows = (d.items || []).map((it: any, i: number) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td>${it.description || it.material_name || '-'}</td>
      <td class="center">${it.ordered_qty ?? '-'}</td>
      <td class="center">${it.received_qty}</td>
      <td class="center">${it.unit || '-'}</td>
      <td class="center">${it.accepted_qty ?? it.received_qty}</td>
      <td class="center">${it.rejected_qty || 0}</td>
      <td class="center">${it.lot_number || '-'}</td>
      <td class="center">${it.location || '-'}</td>
    </tr>`).join('')
  return `<div class="page">
    <div class="header">
      <div class="company-block">
        <div class="company-name">${d._company || 'บริษัท'}</div>
        <div>${d._companyAddress || ''}</div>
      </div>
      <div class="doc-title">
        <h1>ใบรับสินค้า</h1>
        <div class="doc-number">${d.gr_number}</div>
        <div class="doc-date">วันที่รับ: ${fmtDate(d.receipt_date)}</div>
        <div style="margin-top:1mm"><span class="status-badge ${d.status === 'CONFIRMED' ? 'badge-approved' : 'badge-draft'}">${STATUS_TH[d.status] || d.status}</span></div>
      </div>
    </div>
    <div class="info-row">
      <div class="info-box" style="flex:2">
        <label>อ้างอิงใบสั่งซื้อ (PO)</label>
        <div class="value">${d.po_number || '-'}</div>
        <div class="sub">ผู้ขาย: ${d.supplier_name || '-'}</div>
      </div>
      <div class="info-box">
        <label>เลขที่ใบส่งของ</label>
        <div class="value">${d.delivery_note_no || '-'}</div>
      </div>
      <div class="info-box">
        <label>ผู้รับสินค้า</label>
        <div class="value">${d.received_by || '-'}</div>
      </div>
    </div>
    <table>
      <thead><tr>
        <th class="center" style="width:7mm">#</th>
        <th>รายการ</th>
        <th class="center" style="width:14mm">สั่ง</th>
        <th class="center" style="width:14mm">รับ</th>
        <th class="center" style="width:12mm">หน่วย</th>
        <th class="center" style="width:14mm">ผ่าน QC</th>
        <th class="center" style="width:12mm">ปฏิเสธ</th>
        <th class="center" style="width:16mm">Lot/Batch</th>
        <th class="center" style="width:16mm">ตำแหน่ง</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${d.notes ? `<div class="notes-box"><label>หมายเหตุ</label>${d.notes}</div>` : ''}
    <div class="sig-row">
      <div class="sig-box">ผู้ส่งของ<br><br>&nbsp;</div>
      <div class="sig-box">ผู้รับสินค้า<br><br>${d.received_by || ''}</div>
      <div class="sig-box">ผู้ตรวจรับ<br><br>&nbsp;</div>
    </div>
    <div class="footer">พิมพ์เมื่อ ${new Date().toLocaleString('th-TH')} · ${d.gr_number}</div>
  </div>`
}

// ─────────────────────────────────────────────────────────────
// 3b. GR — Thermal 80mm (ใบสลิปรับของ แปะกล่อง/ช่องรับ)
// ─────────────────────────────────────────────────────────────
function templateGR_Thermal(d: any): string {
  const rows = (d.items || []).map((it: any, i: number) => `
    <tr>
      <td>${i + 1}. ${it.description || it.material_name || '-'}${it.lot_number ? `<br><span style="font-size:7pt;color:var(--fg-3)">Lot: ${it.lot_number}</span>` : ''}</td>
      <td class="right">${it.received_qty}${it.unit || ''}<br><span style="font-size:7pt">${it.location || ''}</span></td>
    </tr>`).join('')
  return `<div class="center">
    <div class="company-name">${d._company || 'บริษัท'}</div>
    <div class="doc-type">ใบรับสินค้า</div>
    <div class="doc-no">${d.gr_number}</div>
  </div>
  <hr class="divider-solid">
  <div class="row"><label>วันที่รับ</label><span>${fmtDate(d.receipt_date)}</span></div>
  <div class="row"><label>PO อ้างอิง</label><span>${d.po_number || '-'}</span></div>
  <div class="row"><label>ผู้ขาย</label><span style="text-align:right;max-width:40mm">${d.supplier_name || '-'}</span></div>
  ${d.delivery_note_no ? `<div class="row"><label>ใบส่งของ</label><span>${d.delivery_note_no}</span></div>` : ''}
  <hr class="divider">
  <table>
    <thead><tr><th style="text-align:left">รายการ</th><th style="text-align:right">รับ</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <hr class="divider-solid">
  <div class="row bold"><label>รับโดย</label><span>${d.received_by || '-'}</span></div>
  <div class="sig-area">ลายเซ็นผู้รับ _______________<br><span style="font-size:7pt;color:var(--fg-3)">พิมพ์เมื่อ ${new Date().toLocaleString('th-TH')}</span></div>`
}

// ─────────────────────────────────────────────────────────────
// 4. PI — Purchase Invoice Record / ใบสำคัญรับใบแจ้งหนี้ (A4)
// ─────────────────────────────────────────────────────────────
function templatePI_A4(d: any): string {
  return `<div class="page">
    <div class="header">
      <div class="company-block">
        <div class="company-name">${d._company || 'บริษัท'}</div>
        <div>${d._companyAddress || ''}</div>
        <div>เลขผู้เสียภาษี: ${d._companyTax || '-'}</div>
      </div>
      <div class="doc-title">
        <h1>ใบสำคัญรับใบแจ้งหนี้</h1>
        <div class="doc-number">${d.pi_number}</div>
        <div class="doc-date">วันที่บันทึก: ${fmtDate(d.invoice_date)}</div>
        <div class="doc-date">วันครบกำหนด: ${fmtDate(d.due_date)}</div>
      </div>
    </div>
    <div class="info-row">
      <div class="info-box" style="flex:2">
        <label>ผู้ขาย (Supplier)</label>
        <div class="value">${d.supplier_name || '-'}</div>
        ${d.supplier_tax_id ? `<div class="sub">เลขผู้เสียภาษี: ${d.supplier_tax_id}</div>` : ''}
      </div>
      <div class="info-box">
        <label>เลขที่ใบแจ้งหนี้ของผู้ขาย</label>
        <div class="value">${d.supplier_invoice_number || '-'}</div>
      </div>
      <div class="info-box">
        <label>อ้างอิง PO</label>
        <div class="value">${d.po_number || '-'}</div>
        <div class="sub">GR: ${d.gr_number || '-'}</div>
      </div>
    </div>
    <table style="margin-top:6mm">
      <thead><tr>
        <th>รายการ</th>
        <th class="right" style="width:35mm">จำนวนเงิน (บาท)</th>
      </tr></thead>
      <tbody>
        <tr><td>ราคาสินค้า / บริการ</td><td class="right">${fmt(d.subtotal)}</td></tr>
        <tr><td>ภาษีมูลค่าเพิ่ม VAT ${d.tax_rate || 7}%</td><td class="right">${fmt(d.tax_amount)}</td></tr>
      </tbody>
    </table>
    <div class="totals">
      <div class="totals-box">
        <div class="totals-row grand"><span>รวมทั้งสิ้น</span><span>${fmt(d.total_amount)}</span></div>
        <div class="totals-row"><span>ชำระแล้ว</span><span>${fmt(d.paid_amount)}</span></div>
        <div class="totals-row" style="color:var(--danger)"><span>คงค้าง</span><span>${fmt(d.balance_amount)}</span></div>
      </div>
    </div>
    ${d.notes ? `<div class="notes-box"><label>หมายเหตุ</label>${d.notes}</div>` : ''}
    <div style="margin-top:5mm; padding:3mm 4mm; border:1px solid var(--border); border-radius:3px; font-size:8.5pt; color:var(--fg-3); line-height:1.6">
      <strong>รายการบัญชี (Auto Journal)</strong><br>
      Dr. 1107 สต็อกวัตถุดิบ &nbsp;&nbsp;&nbsp; ${fmt(d.subtotal)} บาท<br>
      ${d.tax_amount > 0 ? `Dr. 1110 ภาษีซื้อ &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${fmt(d.tax_amount)} บาท<br>` : ''}
      Cr. 2101 เจ้าหนี้การค้า &nbsp;&nbsp; ${fmt(d.total_amount)} บาท
    </div>
    <div class="sig-row">
      <div class="sig-box">ผู้บันทึก<br><br>&nbsp;</div>
      <div class="sig-box">ผู้ตรวจสอบ<br><br>&nbsp;</div>
      <div class="sig-box">ผู้อนุมัติ<br><br>&nbsp;</div>
    </div>
    <div class="footer">พิมพ์เมื่อ ${new Date().toLocaleString('th-TH')} · ${d.pi_number}</div>
  </div>`
}

// ─────────────────────────────────────────────────────────────
// 5. Payment Voucher — ใบสำคัญจ่าย (A4)
// ─────────────────────────────────────────────────────────────
function templatePayment_A4(d: any): string {
  const METHOD_TH: Record<string, string> = { CASH: 'เงินสด', TRANSFER: 'โอนเงิน', CHEQUE: 'เช็ค', OTHER: 'อื่นๆ' }
  return `<div class="page">
    <div class="header">
      <div class="company-block">
        <div class="company-name">${d._company || 'บริษัท'}</div>
        <div>${d._companyAddress || ''}</div>
        <div>เลขผู้เสียภาษี: ${d._companyTax || '-'}</div>
      </div>
      <div class="doc-title">
        <h1>ใบสำคัญจ่าย</h1>
        <div class="doc-number">${d.payment_number}</div>
        <div class="doc-date">วันที่จ่าย: ${fmtDate(d.payment_date)}</div>
      </div>
    </div>
    <div class="info-row">
      <div class="info-box" style="flex:2">
        <label>จ่ายให้</label>
        <div class="value">${d.supplier_name || '-'}</div>
      </div>
      <div class="info-box">
        <label>วิธีการชำระ</label>
        <div class="value">${METHOD_TH[d.payment_method] || d.payment_method}</div>
      </div>
      <div class="info-box">
        <label>เลขอ้างอิง / เช็คเลขที่</label>
        <div class="value">${d.payment_reference || '-'}</div>
      </div>
    </div>
    ${d.pi_number ? `
    <div class="info-row">
      <div class="info-box">
        <label>ชำระตามใบแจ้งหนี้เลขที่</label>
        <div class="value">${d.pi_number}</div>
        ${d.supplier_invoice_number ? `<div class="sub">เลขที่ผู้ขาย: ${d.supplier_invoice_number}</div>` : ''}
      </div>
    </div>` : ''}
    <table style="margin-top:6mm">
      <thead><tr>
        <th>รายการ</th>
        <th class="right" style="width:35mm">จำนวนเงิน (บาท)</th>
      </tr></thead>
      <tbody>
        <tr><td>จำนวนเงินที่จ่าย</td><td class="right">${fmt(d.amount)}</td></tr>
        ${d.withholding_tax > 0 ? `<tr><td>หัก ณ ที่จ่าย (WHT)</td><td class="right">(${fmt(d.withholding_tax)})</td></tr>` : ''}
      </tbody>
    </table>
    <div class="totals">
      <div class="totals-box">
        <div class="totals-row grand"><span>ยอดที่จ่ายจริง</span><span>${fmt(d.net_amount || (d.amount - (d.withholding_tax || 0)))}</span></div>
      </div>
    </div>
    <div style="margin-top:5mm; padding:3mm 4mm; border:1px solid var(--border); border-radius:3px; font-size:8.5pt; color:var(--fg-3); line-height:1.6">
      <strong>รายการบัญชี (Auto Journal)</strong><br>
      Dr. 2101 เจ้าหนี้การค้า &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${fmt(d.amount)} บาท<br>
      ${d.withholding_tax > 0 ? `Cr. 2180 ภาษีหัก ณ ที่จ่าย ${fmt(d.withholding_tax)} บาท<br>` : ''}
      Cr. 1101 เงินสด/เงินฝาก &nbsp;&nbsp;&nbsp; ${fmt(d.net_amount || (d.amount - (d.withholding_tax || 0)))} บาท
    </div>
    ${d.notes ? `<div class="notes-box"><label>หมายเหตุ</label>${d.notes}</div>` : ''}
    <div class="sig-row">
      <div class="sig-box">ผู้จ่ายเงิน<br><br>&nbsp;</div>
      <div class="sig-box">ผู้รับเงิน<br><br>&nbsp;</div>
      <div class="sig-box">ผู้อนุมัติ<br><br>&nbsp;</div>
    </div>
    <div class="footer">พิมพ์เมื่อ ${new Date().toLocaleString('th-TH')} · ${d.payment_number}</div>
  </div>`
}

// ─────────────────────────────────────────────────────────────
// 6. Return — ใบส่งคืนสินค้า (A4)
// ─────────────────────────────────────────────────────────────
function templateReturn_A4(d: any): string {
  const rows = (d.items || []).map((it: any, i: number) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td>${it.material_name || it.description || '-'}</td>
      <td class="center">${it.quantity}</td>
      <td class="center">${it.unit || '-'}</td>
      <td class="right">${fmt(it.unit_price)}</td>
      <td class="right">${fmt(it.total_price || it.quantity * it.unit_price)}</td>
      <td>${it.reason || '-'}</td>
    </tr>`).join('')
  return `<div class="page">
    <div class="header">
      <div class="company-block">
        <div class="company-name">${d._company || 'บริษัท'}</div>
        <div>${d._companyAddress || ''}</div>
      </div>
      <div class="doc-title">
        <h1>ใบส่งคืนสินค้า</h1>
        <div class="doc-number">${d.pr_number}</div>
        <div class="doc-date">วันที่คืน: ${fmtDate(d.return_date)}</div>
      </div>
    </div>
    <div class="info-row">
      <div class="info-box" style="flex:2">
        <label>ผู้ขาย (คืนให้)</label>
        <div class="value">${d.supplier_name || '-'}</div>
      </div>
      <div class="info-box">
        <label>อ้างอิง PO</label>
        <div class="value">${d.po_number || '-'}</div>
      </div>
      <div class="info-box">
        <label>เหตุผลหลัก</label>
        <div class="value">${d.reason || '-'}</div>
      </div>
    </div>
    <table>
      <thead><tr>
        <th class="center" style="width:8mm">#</th>
        <th>รายการ</th>
        <th class="center" style="width:14mm">จำนวน</th>
        <th class="center" style="width:12mm">หน่วย</th>
        <th class="right" style="width:20mm">ราคา/หน่วย</th>
        <th class="right" style="width:22mm">รวม</th>
        <th style="width:28mm">เหตุผล</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div class="totals-box">
        <div class="totals-row"><span>ราคาสินค้า</span><span>${fmt(d.subtotal)}</span></div>
        <div class="totals-row"><span>VAT ${d.tax_rate || 7}%</span><span>${fmt(d.tax_amount)}</span></div>
        <div class="totals-row grand"><span>รวมทั้งสิ้น</span><span>${fmt(d.total_amount)}</span></div>
      </div>
    </div>
    ${d.notes ? `<div class="notes-box"><label>หมายเหตุ</label>${d.notes}</div>` : ''}
    <div class="sig-row">
      <div class="sig-box">ผู้ส่งคืน<br><br>&nbsp;</div>
      <div class="sig-box">ผู้รับคืน (ผู้ขาย)<br><br>&nbsp;</div>
      <div class="sig-box">ผู้อนุมัติ<br><br>&nbsp;</div>
    </div>
    <div class="footer">พิมพ์เมื่อ ${new Date().toLocaleString('th-TH')} · ${d.pr_number}</div>
  </div>`
}

// ─────────────────────────────────────────────────────────────
// 7a. POS Receipt — A4 (ใบเสร็จรับเงิน / ใบกำกับภาษี)
// d._vatEnabled controls the title
// ─────────────────────────────────────────────────────────────
function templatePOS_A4(d: any): string {
  const isVat = !!d._vatEnabled
  const docTitle = isVat ? 'ใบเสร็จรับเงิน/ใบกำกับภาษี' : 'ใบเสร็จรับเงิน'
  const METHOD_TH: Record<string, string> = { CASH: 'เงินสด', QR_CODE: 'QR Code / พร้อมเพย์', CREDIT_CARD: 'บัตรเครดิต' }
  const rows = (d.items || []).map((it: any, i: number) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td>${it.product_name || it.name || '-'}${it.special_instructions ? `<br><span style="font-size:8pt;color:var(--fg-4)">${it.special_instructions}</span>` : ''}</td>
      <td class="center">${it.quantity}</td>
      <td class="right">${fmt(it.unit_price)}</td>
      <td class="right">${fmt(it.total_price || it.quantity * it.unit_price)}</td>
    </tr>`).join('')
  return `<div class="page" style="max-width:160mm">
    <div style="text-align:center;border-bottom:2px solid var(--fg-1);padding-bottom:5mm;margin-bottom:4mm">
      ${d._shopName ? `<div style="font-size:14pt;font-weight:700;color:var(--fg-1)">${d._shopName}</div>` : ''}
      ${d._shopAddress ? `<div style="font-size:8.5pt;color:var(--fg-3);margin-top:1mm">${d._shopAddress}</div>` : ''}
      ${d._shopPhone ? `<div style="font-size:8.5pt;color:var(--fg-3)">โทร: ${d._shopPhone}</div>` : ''}
      ${isVat && d._shopTaxId ? `<div style="font-size:8.5pt;color:var(--fg-3)">เลขผู้เสียภาษี: ${d._shopTaxId}</div>` : ''}
      <div style="margin-top:3mm;font-size:15pt;font-weight:700">${docTitle}</div>
      ${isVat ? '<div style="font-size:8pt;color:var(--fg-4)">(ต้นฉบับ)</div>' : ''}
    </div>
    <div class="info-row">
      <div class="info-box"><label>เลขที่บิล</label><div class="value">${d.bill_number}</div></div>
      <div class="info-box"><label>วันที่/เวลา</label><div class="value">${new Date(d.closed_at || d.created_at || Date.now()).toLocaleString('th-TH')}</div></div>
      ${d.customer_name ? `<div class="info-box"><label>ลูกค้า</label><div class="value">${d.customer_name}</div></div>` : ''}
    </div>
    <table>
      <thead><tr>
        <th class="center" style="width:8mm">#</th>
        <th>รายการ</th>
        <th class="center" style="width:14mm">จำนวน</th>
        <th class="right" style="width:24mm">ราคา/ชิ้น</th>
        <th class="right" style="width:26mm">รวม (บาท)</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div class="totals-box">
        <div class="totals-row"><span>ยอดรวมสินค้า</span><span>${fmt(d.subtotal)}</span></div>
        ${d._serviceEnabled && d.service_charge_amount > 0 ? `<div class="totals-row"><span>Service Charge (${d._serviceRate}%)</span><span>${fmt(d.service_charge_amount)}</span></div>` : ''}
        ${d._discountAmount > 0 ? `<div class="totals-row" style="color:var(--danger)"><span>ส่วนลด</span><span>-${fmt(d._discountAmount)}</span></div>` : ''}
        ${isVat ? `
        <div class="totals-row"><span>มูลค่าสินค้าก่อนภาษี</span><span>${fmt(d.subtotal - (d.tax_amount || 0))}</span></div>
        <div class="totals-row"><span>ภาษีมูลค่าเพิ่ม ${d._vatRate || 7}%</span><span>${fmt(d.tax_amount || 0)}</span></div>` : ''}
        <div class="totals-row grand"><span>รวมทั้งสิ้น</span><span>${fmt(d.total_amount)}</span></div>
        ${d._cashReceived > 0 ? `
        <div class="totals-row"><span>รับเงิน (${METHOD_TH[d._paymentMethod] || d._paymentMethod})</span><span>${fmt(d._cashReceived)}</span></div>
        <div class="totals-row"><span>เงินทอน</span><span>${fmt(Math.max(0, d._cashReceived - d.total_amount))}</span></div>` : `
        <div class="totals-row"><span>วิธีชำระ</span><span>${METHOD_TH[d._paymentMethod] || d._paymentMethod || '-'}</span></div>`}
      </div>
    </div>
    ${isVat ? `<div style="margin-top:4mm;padding:3mm 4mm;border:1px solid var(--border);border-radius:3px;font-size:8pt;color:var(--fg-3)">
      ผู้ซื้อสินค้า/บริการ: ${d.customer_name || '-'}<br>
      ที่อยู่: ____________________________________________________<br>
      เลขประจำตัวผู้เสียภาษี: ___________________________________
    </div>` : ''}
    ${d._shopFooter ? `<div style="text-align:center;margin-top:5mm;font-size:9pt;color:var(--fg-3);border-top:1px solid var(--border);padding-top:3mm">${d._shopFooter}</div>` : ''}
    ${d.receipt_qr ? `<div style="text-align:center;margin-top:5mm">
      <img src="${d.receipt_qr}" style="width:26mm;height:26mm" alt="QR">
      <div style="font-size:8pt;color:var(--fg-3);margin-top:1mm">สแกนดูใบเสร็จออนไลน์ / เก็บไว้แทนกระดาษ</div>
    </div>` : ''}
    <div class="footer">พิมพ์เมื่อ ${new Date().toLocaleString('th-TH')}</div>
  </div>`
}

// ─────────────────────────────────────────────────────────────
// 7b. POS Receipt — Thermal 80mm (ใบเสร็จฉบับย่อ)
// ─────────────────────────────────────────────────────────────
function templatePOS_Thermal(d: any): string {
  const isVat = !!d._vatEnabled
  const docTitle = 'ใบเสร็จฉบับย่อ'   // thermal is always short receipt, A4 is the tax invoice
  const METHOD_TH: Record<string, string> = { CASH: 'เงินสด', QR_CODE: 'QR Code', CREDIT_CARD: 'บัตรเครดิต' }
  const rows = (d.items || []).map((it: any) => `
    <tr>
      <td>${it.product_name || it.name || '-'}${it.special_instructions ? `<br><span style="font-size:6.5pt;color:var(--fg-3)">${it.special_instructions}</span>` : ''}</td>
      <td class="right">${it.quantity}×${fmt(it.unit_price)}</td>
      <td class="right">${fmt(it.total_price || it.quantity * it.unit_price)}</td>
    </tr>`).join('')
  return `<div class="center">
    ${d._shopName ? `<div class="company-name">${d._shopName}</div>` : ''}
    ${d._shopAddress ? `<div style="font-size:7.5pt">${d._shopAddress}</div>` : ''}
    ${d._shopPhone ? `<div style="font-size:7.5pt">โทร: ${d._shopPhone}</div>` : ''}
    <div class="doc-type" style="margin-top:1.5mm">${docTitle}</div>
    <div class="doc-no">${d.bill_number}</div>
  </div>
  <hr class="divider-solid">
  <div class="row"><label>วันที่</label><span>${new Date(d.closed_at || d.created_at || Date.now()).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</span></div>
  ${d.customer_name ? `<div class="row"><label>ลูกค้า</label><span>${d.customer_name}</span></div>` : ''}
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
  <div class="row"><label>ยอดรวม</label><span>${fmt(d.subtotal)}</span></div>
  ${d._serviceEnabled && d.service_charge_amount > 0 ? `<div class="row"><label>Service ${d._serviceRate}%</label><span>${fmt(d.service_charge_amount)}</span></div>` : ''}
  ${d._discountAmount > 0 ? `<div class="row" style="color:var(--fg-1)"><label>ส่วนลด</label><span>-${fmt(d._discountAmount)}</span></div>` : ''}
  ${isVat ? `<div class="row"><label>VAT ${d._vatRate || 7}%</label><span>${fmt(d.tax_amount || 0)}</span></div>` : ''}
  <hr class="divider">
  <div class="row total-line"><label>รวมสุทธิ</label><span>${fmt(d.total_amount)}</span></div>
  <hr class="divider">
  ${d._cashReceived > 0 ? `
  <div class="row"><label>รับเงิน</label><span>${fmt(d._cashReceived)}</span></div>
  <div class="row"><label>เงินทอน</label><span>${fmt(Math.max(0, d._cashReceived - d.total_amount))}</span></div>` : `
  <div class="row"><label>ชำระ</label><span>${METHOD_TH[d._paymentMethod] || d._paymentMethod || '-'}</span></div>`}
  ${d._shopFooter ? `<hr class="divider"><div class="center" style="font-size:8pt;line-height:1.6">${d._shopFooter}</div>` : ''}
  ${d.receipt_qr ? `<hr class="divider"><div class="center"><img src="${d.receipt_qr}" style="width:22mm;height:22mm" alt="QR"><div style="font-size:7pt;color:var(--fg-4)">สแกนดูใบเสร็จออนไลน์</div></div>` : ''}
  <div class="center" style="font-size:7pt;color:var(--fg-4);margin-top:2mm">${new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</div>`
}

// ─────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────
export function printDocument(type: DocType, data: any, format: PrintFormat = 'a4') {
  let html = ''
  const css = format === 'thermal' ? CSS_THERMAL : CSS_A4
  const safeData: any = data ? deepEscape(data) : {}
  safeData._companyLogo = safeImageUrl(data?._companyLogo)
  safeData.receipt_qr = safeImageUrl(data?.receipt_qr)

  if (type === 'pr') {
    html = templatePR_A4(safeData)                         // PR: A4 only
  } else if (type === 'po') {
    html = templatePO_A4(safeData)                         // PO: A4 only
  } else if (type === 'gr') {
    html = format === 'thermal' ? templateGR_Thermal(safeData) : templateGR_A4(safeData)
  } else if (type === 'pi') {
    html = templatePI_A4(safeData)                         // PI: A4 only
  } else if (type === 'payment') {
    html = templatePayment_A4(safeData)                    // Payment: A4 only
  } else if (type === 'return') {
    html = templateReturn_A4(safeData)                     // Return: A4 only
  }

  if (!html) return
  openPrint(css, html, format)
}

// ─────────────────────────────────────────────────────────────
// POS entry point — separate function keeps concerns clear
// ─────────────────────────────────────────────────────────────
export function printPOSReceipt(bill: any, format: PrintFormat = 'thermal') {
  const safeBill: any = bill ? deepEscape(bill) : {}
  safeBill._companyLogo = safeImageUrl(bill?._companyLogo)
  safeBill.receipt_qr = safeImageUrl(bill?.receipt_qr)
  const html = format === 'a4' ? templatePOS_A4(safeBill) : templatePOS_Thermal(safeBill)
  openPrint(format === 'a4' ? CSS_A4 : CSS_THERMAL, html, format)
}
