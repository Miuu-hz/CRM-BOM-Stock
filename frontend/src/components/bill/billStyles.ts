// ═══════════════════════════════════════════════════════════════
// Phopy ERP — Unified Bill Template stylesheet
// SINGLE SOURCE OF TRUTH for print CSS.
//
// UnifiedBillTemplate.tsx renders this as an inline <style> tag so the
// component works both:
//   1) mounted normally in the app (BillViewer / BillPreviewDemo), and
//   2) rendered via ReactDOMServer.renderToStaticMarkup() into a bare
//      print-window HTML string (no bundler CSS, no hydration) — this is
//      how Sales/Purchase/Cashier print buttons will consume it.
//
// Do NOT duplicate this into a separate .css file — that was the exact
// problem this phase was asked to fix (17 hand-written print templates +
// 2 copies of CSS). Edit only here.
// ═══════════════════════════════════════════════════════════════
export const BILL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap');

/* ── Screen wrapper ── */
.unified-bill-container {
  padding: 28px;
  background: var(--bg, #F0ECE2);
  min-height: 100vh;
  font-family: 'Sarabun', 'IBM Plex Sans Thai', system-ui, sans-serif;
}

.bill-toolbar {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
  padding: 14px 18px;
  background: var(--surface, #F8F5EE);
  border-radius: 12px;
  border: 1px solid var(--border, #DEDACF);
  flex-wrap: wrap;
  align-items: center;
}

/* ═══════════════════════════════════
   PAPER BASE
═══════════════════════════════════ */
.unified-bill-paper {
  background: #ffffff;
  color: #1f2430;
  margin: 0 auto;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.06),
    0 4px 24px rgba(0, 0, 0, 0.10),
    0 12px 48px rgba(0, 0, 0, 0.06);
  font-family: 'Sarabun', 'IBM Plex Sans Thai', system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.55;
  position: relative;
}

.bill-a4 { width: 210mm; min-height: 297mm; padding: 13mm; }
.bill-a5 { width: 148mm; min-height: 210mm; padding: 10mm; }
.bill-thermal {
  width: 80mm;
  padding: 6mm 5mm;
  font-size: 11px;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.08),
    0 4px 16px rgba(0, 0, 0, 0.12);
}

/* ═══════════════════════════════════
   HEADER — โลโก้ซ้าย / ชื่อเอกสารขวา
═══════════════════════════════════ */
.bill-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
  margin-bottom: 14px;
}

.bill-brand { display: flex; align-items: center; gap: 11px; }
.bill-logo-img,
.bill-logo-box {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  display: block;
  object-fit: contain;
  flex-shrink: 0;
}
.bill-logo-box {
  border: 2px solid var(--theme-color, #3949E5);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 18px;
  color: var(--theme-color, #3949E5);
  background: color-mix(in oklab, var(--theme-color, #3949E5) 7%, white);
}
.bill-brand-text { line-height: 1.3; }
.bill-brand-name { font-weight: 800; font-size: 16px; color: #1f2430; }
.bill-free-tag {
  display: inline-block;
  background: #eef1ff;
  color: #3949E5;
  border: 1px solid #ccd3ff;
  border-radius: 5px;
  padding: 1px 7px;
  font-size: 10px;
  font-weight: 700;
  margin-top: 3px;
}

.bill-title-block { text-align: right; }
.bill-draft-label { color: #7b8394; font-size: 11px; }
.bill-title-th {
  font-size: 26px;
  font-weight: 800;
  letter-spacing: .3px;
  color: var(--theme-color, #3949E5);
  margin-top: 2px;
  white-space: nowrap;
}
.bill-title-en {
  font-size: 10px;
  color: #888888;
  margin-top: 2px;
  text-transform: uppercase;
  letter-spacing: 2px;
}
.bill-status-badge {
  margin-top: 6px;
  padding: 2px 10px;
  border-radius: 20px;
  font-size: 10.5px;
  font-weight: 600;
  display: inline-block;
}
.bill-status-badge[data-status="DRAFT"]       { background: var(--warning-soft); color: var(--warning); }
.bill-status-badge[data-status="CONFIRMED"]   { background: var(--success-soft); color: var(--success); }
.bill-status-badge[data-status="COMPLETED"]   { background: var(--info-soft); color: var(--info); }
.bill-status-badge[data-status="CANCELLED"]   { background: var(--danger-soft); color: var(--danger); }
.bill-status-badge[data-status="PLANNED"]     { background: var(--info-soft); color: var(--info); }
.bill-status-badge[data-status="IN_PROGRESS"] { background: var(--warning-soft); color: var(--warning); }
.bill-status-badge[data-status="ON_HOLD"]     { background: var(--warning-soft); color: var(--warning); }

/* ═══════════════════════════════════
   HEAD GRID — ผู้ขาย | คู่ค้า | ข้อมูลเอกสาร
═══════════════════════════════════ */
.bill-head-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 250px;
  gap: 14px;
  align-items: start;
  margin-bottom: 18px;
}

.bill-party-col { font-size: 12px; }
.bill-party-col .party-row { display: grid; grid-template-columns: 62px 1fr; gap: 6px; margin-bottom: 3px; }
.bill-party-col .k { color: #7b8394; }
.bill-party-col .nm { font-weight: 700; color: #1f2430; }

.bill-meta-col {
  background: #f7f8fb;
  border: 1px solid #e3e6ec;
  border-radius: 10px;
  padding: 11px 13px;
  font-size: 12px;
}
.bill-meta-col .meta-row { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 4px; }
.bill-meta-col .k { color: #7b8394; }
.bill-meta-col .v { font-weight: 600; text-align: right; color: #1f2430; }
.bill-meta-col hr { border: 0; border-top: 1px solid #e3e6ec; margin: 9px 0; }

/* ═══════════════════════════════════
   ITEMS TABLE
═══════════════════════════════════ */
.bill-items-section { margin-bottom: 18px; }

.bill-items-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

.bill-items-table th {
  padding: 9px 8px;
  text-align: right;
  font-size: 11px;
  font-weight: 600;
  color: #ffffff;
  white-space: nowrap;
  border-bottom: none;
}
.bill-items-table thead tr th:first-child { text-align: left; border-radius: 6px 0 0 6px; }
.bill-items-table thead tr th:last-child  { border-radius: 0 6px 6px 0; }

.bill-items-table td {
  padding: 9px 8px;
  border-bottom: 1px solid #f3f3f3;
  vertical-align: top;
  color: #1a1a1a;
  text-align: right;
}
.bill-items-table td.col-item { text-align: left; }
.bill-items-table tbody tr:nth-child(even) td { background: #fafafa; }
.bill-items-table tbody tr:last-child td   { border-bottom: 2px solid #e5e7eb; }

.col-item  { min-width: 170px; }
.col-qty   { width: 58px; }
.col-unit  { width: 50px; text-align: center !important; }
.col-price, .col-discount, .col-vat, .col-total, .col-wht { width: 84px; }
.col-total { font-weight: 600; }
.col-wht   { width: 60px; }

.item-nm { font-weight: 600; }
.item-desc {
  display: block;
  font-size: 10.5px;
  color: #999999;
  margin-top: 2px;
}

/* ═══════════════════════════════════
   SUMMARY
═══════════════════════════════════ */
.bill-summary-section {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 20px;
  margin-bottom: 0;
  align-items: start;
}

.bill-summary-left { font-size: 12px; }
.summary-line { display: grid; grid-template-columns: 1fr auto; gap: 12px; padding: 4px 0; }
.summary-line .lbl { color: #4a5262; }
.summary-line.discount { color: #dc2626; }
.summary-line.words { font-weight: 600; color: #1f2430; }

.bill-notes {
  margin-top: 8px;
  padding: 10px 14px;
  background: #fafafa;
  border-radius: 7px;
  border: 1px solid #eeeeee;
  font-size: 12px;
  color: #444444;
}
.bill-notes-label { font-weight: 700; margin-bottom: 3px; color: #333333; }

.bill-payment-method {
  margin-top: 10px;
  padding: 9px 14px;
  background: #eff6ff;
  border-radius: 7px;
  border-left: 3px solid #3949E5;
  font-size: 12px;
}

.bill-summary-box {
  background: #f7f8fb;
  border: 1px solid #e3e6ec;
  border-radius: 10px;
  padding: 13px 15px;
}
.summary-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 6px;
  font-size: 12px;
  color: #4a5262;
}
.summary-row:last-child { margin-bottom: 0; }
.summary-row .big { font-size: 21px; font-weight: 800; }
.summary-row .small { font-size: 12px; color: #4a5262; }
.summary-row.total {
  padding: 8px 10px;
  margin: 6px -10px -6px;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 800;
}

/* ═══════════════════════════════════
   PAYMENT INFO + QR — ใต้ยอดรวม ก่อนหมายเหตุ
═══════════════════════════════════ */
.bill-pay-section {
  display: grid;
  grid-template-columns: 1fr 132px;
  gap: 16px;
  margin-top: 16px;
  background: #f7f8fb;
  border: 1px solid #e3e6ec;
  border-radius: 10px;
  padding: 13px 15px;
}
.bill-section-heading { font-weight: 700; font-size: 12px; margin-bottom: 7px; color: #1f2430; }
.pay-row { display: flex; align-items: center; gap: 8px; font-size: 12px; margin-bottom: 3px; }
.pay-row .k { color: #7b8394; flex: 1 1 auto; }
.pay-row .v { font-weight: 600; color: #1f2430; flex: 0 0 auto; text-align: right; }
.pay-row .pay-account { font-size: 15px; font-weight: 800; letter-spacing: .5px; }

.bill-pay-qr { text-align: center; }
.bill-pay-qr img {
  width: 112px; height: 112px; display: block; margin: 0 auto;
  border: 5px solid #fff; outline: 1px solid #e3e6ec; border-radius: 6px;
}
.qr-box {
  width: 96px; height: 96px;
  border: 2px dashed #d1d5db;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px; color: #aaaaaa; margin: 0 auto; border-radius: 8px;
}
.pay-qr-cap { font-size: 10px; color: #7b8394; margin-top: 4px; }

/* ═══════════════════════════════════
   NOTES / SIGNATURES
═══════════════════════════════════ */
.bill-notes-block { margin-top: 18px; font-size: 12px; }

.bill-footer { border-top: none; padding-top: 0; margin-top: 18px; font-size: 12px; }
.bill-signatures {
  display: grid;
  gap: 14px;
  margin-top: 10px;
  align-items: end;
}
.signature-box { text-align: center; }
.signature-line { border-bottom: 1px dotted #aab; height: 40px; margin-bottom: 6px; }
.signature-label { font-size: 11px; color: #7b8394; }
.signature-date  { font-size: 10px; color: #aaaaaa; margin-top: 3px; }

.bill-footer-info {
  text-align: center;
  margin-top: 20px;
  padding-top: 10px;
  border-top: 1px dashed #e0e0e0;
  font-size: 10.5px;
  color: #bbbbbb;
  line-height: 1.8;
}

/* ═══════════════════════════════════
   THERMAL 80mm — RECEIPT LAYOUT (ไม่ใช้ head-grid/table แบบ A4)
═══════════════════════════════════ */
.receipt-center { text-align: center; }
.receipt-logo { width: 44px; height: 44px; border-radius: 10px; margin: 0 auto 5px; display: block; }
.receipt-logo.bill-logo-box { display: flex; }
.receipt-name { font-weight: 800; font-size: 13px; }
.receipt-free-tag { font-size: 9.5px; }
.receipt-divider { border-top: 1px dashed #9aa; margin: 7px 0; }
.receipt-row { display: flex; justify-content: space-between; gap: 8px; }
.receipt-item { margin-bottom: 5px; }
.receipt-total-row { font-size: 14px; font-weight: 800; }
.receipt-pay { background: #f2f4f8; border-radius: 6px; padding: 6px 8px; margin: 7px 0; font-size: 10.5px; }
.receipt-qr { width: 96px; height: 96px; display: block; margin: 5px auto 0; }
.receipt-qr-placeholder {
  width: 80px; height: 80px; margin: 5px auto 0;
  border: 2px dashed #d1d5db; display: flex; align-items: center; justify-content: center;
  color: #aaaaaa; font-size: 16px; border-radius: 6px;
}

/* ═══════════════════════════════════
   PRINT MEDIA
═══════════════════════════════════ */
@media print {
  .no-print { display: none !important; }
  .unified-bill-container { padding: 0; background: white; min-height: unset; }
  .unified-bill-paper { box-shadow: none; margin: 0; }
  .bill-a4 { width: 100%; max-width: 210mm; padding: 13mm; }
  @page { size: A4 portrait; margin: 7mm; }
  .bill-items-table tbody tr:nth-child(even) td,
  .summary-row.total,
  .wo-progress-fill,
  .wo-materials-table th,
  .wo-materials-table tbody tr:nth-child(even) td,
  .wo-summary-card.highlight {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
@media print and (max-width: 82mm) {
  @page { size: 80mm auto; margin: 3mm; }
  .unified-bill-paper { width: 80mm; box-shadow: none; }
}

/* ═══════════════════════════════════
   RESPONSIVE (screen preview < 768px)
═══════════════════════════════════ */
@media screen and (max-width: 768px) {
  .unified-bill-container { padding: 12px; }
  .bill-a4, .bill-a5 { width: 100%; padding: 16px; }
  .bill-header { flex-direction: column; gap: 14px; }
  .bill-head-grid, .bill-summary-section, .bill-pay-section { grid-template-columns: 1fr; }
  .bill-signatures { grid-template-columns: repeat(2, 1fr) !important; }
}

/* ═══════════════════════════════════════════════════════════════
   ใบสั่งงาน / WORK ORDER — ใช้คู่กับ bill-a4/a5/thermal ตามปกติ
═══════════════════════════════════════════════════════════════ */
.wo-priority {
  display: inline-block; padding: 2px 10px; border-radius: 20px;
  font-size: 10.5px; font-weight: 700; letter-spacing: 0.3px;
}
.wo-priority[data-priority="URGENT"] { background: var(--danger-soft); color: var(--danger); }
.wo-priority[data-priority="HIGH"]   { background: var(--warning-soft); color: var(--warning); }
.wo-priority[data-priority="NORMAL"] { background: var(--info-soft); color: var(--info); }
.wo-priority[data-priority="LOW"]    { background: var(--surface-2); color: var(--fg-3); }

.wo-summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
.wo-summary-card { padding: 12px 14px; border: 1.5px solid #e5e7eb; border-radius: 8px; text-align: center; background: #fafafa; }
.wo-summary-card.highlight {
  border-color: color-mix(in oklab, var(--theme-color, #3949E5) 30%, white);
  background: color-mix(in oklab, var(--theme-color, #3949E5) 5%, white);
}
.wo-summary-label { font-size: 9.5px; color: #888888; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 5px; }
.wo-summary-value { font-size: 20px; font-weight: 800; color: var(--theme-color, #3949E5); line-height: 1; }
.wo-summary-unit { font-size: 10.5px; color: #777777; margin-top: 3px; }

.wo-progress-container { margin-bottom: 18px; }
.wo-progress-label { display: flex; justify-content: space-between; font-size: 11px; color: #666666; margin-bottom: 5px; }
.wo-progress-bar { height: 10px; background: var(--surface-2); border-radius: 5px; overflow: hidden; }
.wo-progress-fill { height: 100%; border-radius: 5px; background: var(--theme-color, #3949E5); }
.wo-progress-fill[data-complete="true"] { background: var(--success); }

.wo-materials-section { margin-bottom: 20px; }
.wo-materials-section > h3 {
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;
  color: var(--theme-color, #3949E5); margin: 0 0 10px 0; padding-bottom: 6px; border-bottom: 1.5px solid #eeeeee;
}
.wo-materials-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.wo-materials-table th {
  padding: 8px 10px; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #ffffff; white-space: nowrap;
}
.wo-materials-table thead tr th:first-child { border-radius: 5px 0 0 5px; }
.wo-materials-table thead tr th:last-child  { border-radius: 0 5px 5px 0; }
.wo-materials-table td { padding: 9px 10px; border-bottom: 1px solid #f0f0f0; vertical-align: middle; color: #1a1a1a; }
.wo-materials-table tbody tr:nth-child(even) td { background: #fafafa; }
.wo-materials-table tbody tr:last-child td { border-bottom: 2px solid #e5e7eb; }

.wo-col-no     { width: 32px; text-align: center; }
.wo-col-name   { text-align: left; min-width: 150px; }
.wo-col-req    { width: 80px; text-align: right; }
.wo-col-unit   { width: 56px; text-align: center; }
.wo-col-stock  { width: 96px; text-align: center; }
.wo-col-issued { width: 80px; text-align: center; }
.wo-col-check  { width: 48px; text-align: center; }

.wo-stock-ok       { color: #16a34a; font-weight: 600; }
.wo-stock-short    { color: #dc2626; font-weight: 600; }
.wo-stock-mismatch { color: #d97706; }
.wo-stock-unknown  { color: #9ca3af; }

.wo-check-box { width: 16px; height: 16px; border: 1.5px solid #999999; border-radius: 3px; display: inline-block; vertical-align: middle; }

.wo-instructions {
  padding: 12px 14px; background: #fffbeb; border: 1.5px solid #fcd34d;
  border-left-width: 4px; border-left-color: #f59e0b; border-radius: 8px; margin-bottom: 16px;
}
.wo-instructions-label { font-size: 10px; font-weight: 700; color: #92400e; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 5px; }
.wo-instructions-text { font-size: 12.5px; color: #444444; line-height: 1.7; white-space: pre-line; }

/* ── Thermal 80mm overrides for WORK_ORDER fallback (ตารางย่อ ไม่ใช่ receipt layout) ── */
.bill-thermal .bill-header { flex-direction: column; align-items: center; text-align: center; }
.bill-thermal .bill-title-th { font-size: 15px; }
.bill-thermal .bill-head-grid { grid-template-columns: 1fr; }
.bill-thermal .wo-summary-grid { grid-template-columns: repeat(2, 1fr); gap: 6px; margin-bottom: 10px; }
.bill-thermal .wo-summary-card { padding: 7px 9px; border-radius: 5px; border-width: 1px; }
.bill-thermal .wo-summary-value { font-size: 15px; }
.bill-thermal .wo-col-stock, .bill-thermal .wo-col-issued { display: none; }

/* ═══════════════════════════════════════════════════════════════
   THERMAL 80mm — ความเข้ม (รอบ 2: พิมพ์จริงแล้วยังจาง)
   เครื่องพิมพ์ความร้อนจิ้มจุดหรือไม่จิ้มเท่านั้น ไม่มีเฉดเทา
   ตัวอักษรบางหรือสีเทาจะถูก dither เป็นจุดห่าง ๆ = อ่านแทบไม่ออก
   วิธีที่ได้ผลจริงคือ "เพิ่มจำนวนพิกเซลดำต่อตัวอักษร":
     ดำสนิท + ตัวหนา + ตัวใหญ่ขึ้น + ปิด anti-alias + เต็มหน้ากระดาษ
   ใช้เฉพาะ .bill-thermal — A4/A5 ที่พิมพ์เลเซอร์ไม่กระทบ
═══════════════════════════════════════════════════════════════ */
.bill-thermal,
.bill-thermal * {
  color: #000000 !important;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
  /* ปิด anti-alias: ขอบตัวอักษรแบบไล่เฉดเทาคือสิ่งที่ถูก dither จนจาง */
  -webkit-font-smoothing: none;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: geometricPrecision;
}

/* ใช้พื้นที่กระดาษให้เต็ม — ยิ่งตัวใหญ่ ยิ่งมีพิกเซลดำต่อตัวอักษรมาก */
.bill-thermal {
  padding: 3mm 2mm;
  font-size: 13.5px;
  font-weight: 700;
  line-height: 1.45;
  letter-spacing: 0.1px;
}

/* ถมตัวอักษรให้หนาขึ้นอีกด้วยเงาทับตำแหน่งเดิม — ได้ผลกับ print pipeline
   ที่ไม่สน -webkit-text-stroke (ใช้ทั้งคู่เพื่อกินทุกเบราว์เซอร์) */
.bill-thermal * {
  text-shadow: 0 0 0.01px #000000;
  -webkit-text-stroke: 0.28px #000000;
}

.bill-thermal .receipt-name { font-weight: 900; font-size: 17px; letter-spacing: 0.3px; }
.bill-thermal .receipt-row { font-weight: 700; }
.bill-thermal .receipt-item { font-weight: 800; margin-bottom: 6px; }
.bill-thermal .receipt-free-tag { font-weight: 700; font-size: 11px; }

.bill-thermal .receipt-total-row {
  font-weight: 900;
  font-size: 18px;
  -webkit-text-stroke: 0.55px #000000;
  border-top: 3px solid #000000;
  border-bottom: 3px solid #000000;
  padding: 5px 0;
  margin: 7px 0;
}

/* เส้นคั่น: จุดไข่ปลาสีเทาแทบไม่ติดกระดาษ ใช้เส้นทึบดำหนา */
.bill-thermal .receipt-divider {
  border-top: 2.5px solid #000000;
  margin: 8px 0;
}

/* กล่องวิธีชำระเงิน: พื้นเทาอ่อนไม่ติดกระดาษความร้อน ใช้กรอบดำหนาแทน */
.bill-thermal .receipt-pay {
  background: transparent !important;
  border: 2.5px solid #000000;
  border-radius: 3px;
  padding: 6px 8px;
  font-size: 13px;
  font-weight: 800;
}

.bill-thermal .receipt-qr-placeholder { border: 3px solid #000000; font-weight: 800; }
/* QR 2 ตัวเรียงข้างกัน (โอนเงิน + ดูใบเสร็จ) — มีตัวเดียวก็อยู่กลางเอง */
.receipt-qr-pair { display: flex; justify-content: center; gap: 8px; margin-top: 6px; }
.receipt-qr-cell { text-align: center; }
.receipt-qr-label { font-size: 10px; margin-top: 2px; }
.bill-thermal .receipt-qr { width: 126px; height: 126px; margin: 0 auto; }
.bill-thermal .receipt-qr-label { font-size: 11px; font-weight: 800; }
.bill-thermal .receipt-qr-pair { gap: 6px; }
.bill-thermal .receipt-logo { width: 40px; height: 40px; }

/* ══════════════════════════════════════════════════════════════════════
   A5 — เลย์เอาต์ทั้งใบออกแบบไว้สำหรับ A4 (210mm) ไม่เคยมีกฎย่อสำหรับ A5
   หัวเอกสารใช้ grid 1fr 1fr 250px คอลัมน์ขวาคงที่ 66mm ทั้งที่ A5 เหลือ
   พื้นที่แค่ 128mm ของเลยล้นขอบขวาออกไป 25 จุด (วัดจากของจริงในเบราว์เซอร์)
   ══════════════════════════════════════════════════════════════════════ */
.bill-a5 .bill-head-grid { grid-template-columns: 1fr 1fr; gap: 10px; }
.bill-a5 .bill-meta-col  { grid-column: 1 / -1; }
.bill-a5 .bill-items-table { font-size: 10.5px; }
.bill-a5 .bill-items-table th,
.bill-a5 .bill-items-table td { padding: 5px 6px; }
.bill-a5 .bill-summary-section,
.bill-a5 .bill-pay-section { gap: 10px; }

/* ══════════════════════════════════════════════════════════════════════
   หน้าต่างพิมพ์ได้รับแค่ BILL_CSS ก้อนนี้ (renderToStaticMarkup แล้วยัดเข้า
   window.open) ไม่มี Tailwind ไม่มี reset ใด ๆ ทั้งสิ้น สองอย่างนี้จึงต้อง
   ประกาศเองที่นี่ ไม่งั้นพังเฉพาะตอนพิมพ์ แต่ดูบนจอปกติดี:

   1. box-sizing — ค่าตั้งต้นของเบราว์เซอร์คือ content-box ทำให้
      .bill-a4 { width: 100%; padding: 13mm } กินพื้นที่ 100% + 26mm
      ล้นขอบกระดาษ ขอบขวาเลยโดนตัดหายไปทั้งแถบ
   2. ยูทิลิตี้ของ Tailwind ที่เทมเพลตเรียกใช้ (flex/items-center/gap/w-h ของไอคอน)
      ถ้าไม่มี .flex แถวข้อมูลธนาคารจะกลับไปใช้ grid ของ .pay-row แล้วไอคอน
      ไปกินช่องแรก ดันค่าตกลงบรรทัดใหม่
   ══════════════════════════════════════════════════════════════════════ */
.unified-bill-container,
.unified-bill-paper,
.unified-bill-paper *,
.unified-bill-paper *::before,
.unified-bill-paper *::after { box-sizing: border-box; }

.unified-bill-paper .flex            { display: flex; }
.unified-bill-paper .items-center    { align-items: center; }
.unified-bill-paper .justify-between { justify-content: space-between; }
.unified-bill-paper .gap-1           { gap: 4px; }
.unified-bill-paper .gap-1\\.5         { gap: 6px; }
.unified-bill-paper .gap-2           { gap: 8px; }
.unified-bill-paper .w-3\\.5           { width: 14px; }
.unified-bill-paper .h-3\\.5           { height: 14px; }
.unified-bill-paper .w-4             { width: 16px; }
.unified-bill-paper .h-4             { height: 16px; }
.unified-bill-paper .w-5             { width: 20px; }
.unified-bill-paper .h-5             { height: 20px; }
.unified-bill-paper .mt-1            { margin-top: 4px; }
.unified-bill-paper .text-success    { color: #16a34a; }
/* ไอคอน lucide ไม่มีคลาสกำหนดขนาดจะกางเป็น 24px ดันเลย์เอาต์ทั้งแถว */
.unified-bill-paper svg              { flex: 0 0 auto; }

/* ── หน้ากระดาษแยกตามชนิดเอกสาร ────────────────────────────────────────
   @page ธรรมดาไม่ผูกกับ class ตัวที่ประกาศท้ายสุดชนะทุกงานพิมพ์ ถ้าตั้ง
   80mm ไว้ลอย ๆ ใบ A4/A5 จะถูกลากไปพิมพ์บนกระดาษ 80mm ด้วย
   จึงต้องตั้งชื่อหน้าแล้วผูกกับ .bill-* ทีละชนิด
   ── */
/* ── เอกสารยาวข้ามหน้า ─────────────────────────────────────────────────
   ไม่เคยมีกฎ page-break เลย ใบแจ้งหนี้ที่รายการเกินหนึ่งหน้าจึงถูกตัดกลางแถว
   และหัวตารางหายตั้งแต่หน้าสอง (อ่านไม่ออกว่าคอลัมน์ไหนคืออะไร)
   ── */
@media print {
  /* หัวตารางซ้ำทุกหน้า — มาตรฐานของเอกสารที่มีรายการยาว */
  .bill-items-table thead,
  .wo-materials-table thead { display: table-header-group; }
  /* ห้ามตัดกลางแถวสินค้า */
  .bill-items-table tr,
  .wo-materials-table tr { break-inside: avoid; page-break-inside: avoid; }
  /* ก้อนสรุปยอด/ช่องจ่ายเงิน/ช่องเซ็น ต้องอยู่ครบก้อน ไม่ใช่หัวอยู่หน้าหนึ่งท้ายอยู่อีกหน้า */
  .bill-summary-section,
  .bill-pay-section,
  .bill-signatures,
  .wo-summary-grid { break-inside: avoid; page-break-inside: avoid; }
  /* หัวเอกสารต้องไม่ค้างท้ายหน้าโดยไม่มีเนื้อหาตาม */
  .bill-header { break-after: avoid; page-break-after: avoid; }
}

@page a4page    { size: A4 portrait; margin: 7mm; }
@page a5page    { size: A5 portrait; margin: 6mm; }
@page thermal80 { size: 80mm auto;   margin: 2mm; }

@media print {
  .bill-a4      { page: a4page; }
  .bill-a5      { page: a5page; width: 100%; max-width: 148mm; padding: 10mm; }
  .bill-thermal { page: thermal80; box-shadow: none !important; }
}
`
