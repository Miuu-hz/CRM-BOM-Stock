import { forwardRef } from 'react'
import { Printer, Download, Mail, User, Landmark, Hash, Check, AlertTriangle } from 'lucide-react'
import type { BillConfig, BillData } from './BillContext'
import { BILL_CSS } from './billStyles'
import { unitLabel } from '../../hooks/useUnits'

// ═══════════════════════════════════════════════════════════════
// UnifiedBillTemplate — เรนเดอร์จาก props ล้วนๆ เท่านั้น
//
// ห้ามใช้ useBill()/BillContext/BillProvider ที่นี่: หน้า Sales/Purchase/
// Cashier จะเรียก ReactDOMServer.renderToStaticMarkup(<UnifiedBillTemplate .../>)
// เพื่อได้ HTML string ไปเปิดหน้าต่างพิมพ์ตรงๆ (ไม่มี bundler CSS, ไม่มี
// hydration, ไม่มี effect ใดๆ รันเลย) — ต้องเรนเดอร์ถูกต้องจาก props เพียว
// ในรอบเดียว ไม่พึ่ง state/effect ที่ต้อง "รอ" ถึงจะมีเนื้อหา
//
// BillViewer.tsx / BillPreviewDemo.tsx คือตัว "ห่อ" ที่ใช้ BillContext ดึง/
// เก็บ state แล้วส่ง config+data เข้ามาเป็น props ให้ component นี้อีกที
// ═══════════════════════════════════════════════════════════════

// ── Utility functions (pure, ไม่แตะ window/document) ──
function numberToThaiText(num: number): string {
  const thaiNumbers = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า']
  const thaiPlaces = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน']

  if (num === 0) return 'ศูนย์บาทถ้วน'

  let result = ''
  const numStr = Math.floor(num).toString()
  const len = numStr.length

  for (let i = 0; i < len; i++) {
    const digit = parseInt(numStr[i])
    const place = len - i - 1

    if (digit !== 0) {
      if (place === 1 && digit === 1) {
        result += 'สิบ'
      } else if (place === 1 && digit === 2) {
        result += 'ยี่สิบ'
      } else if (place === 0 && digit === 1 && len > 1) {
        result += 'เอ็ด'
      } else {
        result += thaiNumbers[digit] + thaiPlaces[place % 6]
      }
    }

    if (place === 6 && i !== len - 1) {
      result += 'ล้าน'
    }
  }

  const decimal = Math.round((num % 1) * 100)
  if (decimal > 0) {
    const satangStr = decimal.toString().padStart(2, '0')
    const satangTen = parseInt(satangStr[0])
    const satangOne = parseInt(satangStr[1])

    result += 'บาท'

    if (satangTen === 1) {
      result += 'สิบ'
    } else if (satangTen === 2) {
      result += 'ยี่สิบ'
    } else if (satangTen > 0) {
      result += thaiNumbers[satangTen] + 'สิบ'
    }

    if (satangOne === 1 && satangTen > 0) {
      result += 'เอ็ด'
    } else if (satangOne > 0) {
      result += thaiNumbers[satangOne]
    }

    result += 'สตางค์'
  } else {
    result += 'บาทถ้วน'
  }

  return result
}

// ข้อมูลจากเอกสารจริงมีฟิลด์ตัวเลขหายได้ (เช่นรายการที่ไม่ได้กรอกส่วนลด/VAT)
// ถ้าไม่กันไว้ทั้งใบจะ throw แล้วพิมพ์ออกมาเป็นหน้าขาว — ยอมโชว์ 0.00 ดีกว่าไม่ได้เอกสาร
function formatCurrency(amount: number | null | undefined): string {
  const n = Number(amount)
  return (Number.isFinite(n) ? n : 0)
    .toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatThaiDate(dateStr: string): string {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  const thaiMonths = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
  const day = date.getDate()
  const month = thaiMonths[date.getMonth()]
  const year = date.getFullYear() + 543
  return `${day.toString().padStart(2, '0')} ${month} ${year}`
}

function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase()
  return letters || '—'
}

// ═══════════════════════════════════════════════
// Public config types — รับจาก prop เท่านั้น ห้าม fetch เอง
// ═══════════════════════════════════════════════
export interface BillBranding {
  /** true = tenant ใช้แพ็กเกจฟรี ต้องใช้โลโก้ Phopy บังคับ ใส่โลโก้ตัวเองไม่ได้ */
  isFreePlan?: boolean
  /** โลโก้ของกิจการ (data URL / base64) — ใช้เมื่อ isFreePlan ไม่ true */
  logoBase64?: string
}

export interface BillColumnSettings {
  discount?: boolean
  vat?: boolean
  wht?: boolean
  sku?: boolean
}

export interface BillDocumentSettings {
  brandColor?: string
  marginMm?: number
  fontSizePt?: number
  columns?: BillColumnSettings
  showBankInfo?: boolean
  showPaymentQr?: boolean
  signatureSlots?: string[]
  footerNote?: string
}

const DEFAULT_COLUMNS: Required<BillColumnSettings> = {
  discount: true,
  vat: true,
  wht: true,
  sku: true,
}

interface UnifiedBillTemplateProps {
  config: BillConfig
  data: BillData
  size?: 'A4' | 'A5' | 'THERMAL'
  showPrintButton?: boolean
  onPrint?: () => void
  branding?: BillBranding
  settings?: BillDocumentSettings
}

// ── Logo block — ที่มาของโลโก้ตัดสินจาก prop เท่านั้น ──
function BrandLogo({ branding, sellerName, themeColor, thermal }: { branding?: BillBranding; sellerName: string; themeColor: string; thermal?: boolean }) {
  const boxClass = thermal ? 'receipt-logo' : 'bill-logo-img'

  if (branding?.isFreePlan) {
    return <img src="/brand/phopy-mark.png" alt="Phopy" className={boxClass} />
  }
  if (branding?.logoBase64) {
    return <img src={branding.logoBase64} alt={sellerName} className={boxClass} />
  }
  return (
    <div className={`${boxClass} bill-logo-box`} style={{ borderColor: themeColor, color: themeColor }}>
      <span>{initialsOf(sellerName)}</span>
    </div>
  )
}

// ═══════════════════════════════════════════════
// Main component — pure function of props
// ═══════════════════════════════════════════════
const UnifiedBillTemplate = forwardRef<HTMLDivElement, UnifiedBillTemplateProps>(
  ({ config, data, size = 'A4', showPrintButton = true, onPrint, branding, settings }, ref) => {
    if (!data) return null

    const handlePrint = () => {
      if (onPrint) onPrint()
      else if (typeof window !== 'undefined') window.print()
    }

    // ── รวม settings ที่รับมากับค่าตั้งต้น (ห้าม fetch เอง) ──
    const columns: Required<BillColumnSettings> = { ...DEFAULT_COLUMNS, ...settings?.columns }
    const themeColor = settings?.brandColor || config.themeColor
    const showBank = config.fields.showBankInfo && settings?.showBankInfo !== false
    const showQr = config.fields.showQRCode && settings?.showPaymentQr !== false
    const signatureSlots = settings?.signatureSlots?.length ? settings.signatureSlots : config.defaultSignatureSlots
    const footerNote = settings?.footerNote

    const paperStyle: React.CSSProperties = {
      '--theme-color': themeColor,
      ...(settings?.marginMm != null ? { padding: `${settings.marginMm}mm` } : {}),
      ...(settings?.fontSizePt != null ? { fontSize: `${settings.fontSizePt}pt` } : {}),
    } as React.CSSProperties

    const isThermalReceipt = size === 'THERMAL' && config.type !== 'WORK_ORDER'

    return (
      <div className="unified-bill-container">
        <style>{BILL_CSS}</style>

        {showPrintButton && (
          <div className="bill-toolbar no-print">
            <button onClick={handlePrint} className="phopy-btn-primary flex items-center gap-2">
              <Printer className="w-4 h-4" /> พิมพ์เอกสาร
            </button>
            <button className="phopy-btn-secondary flex items-center gap-2">
              <Download className="w-4 h-4" /> บันทึก PDF
            </button>
            <button className="phopy-btn-secondary flex items-center gap-2">
              <Mail className="w-4 h-4" /> ส่งอีเมล
            </button>
          </div>
        )}

        <div
          ref={ref}
          className={`unified-bill-paper bill-${size.toLowerCase()}`}
          style={paperStyle}
        >
          {isThermalReceipt ? (
            // ═══════════════════ THERMAL 80mm — receipt layout ═══════════════════
            <>
              <div className="receipt-center">
                <BrandLogo branding={branding} sellerName={data.seller.name} themeColor={themeColor} thermal />
                <div className="receipt-name">{data.seller.name}</div>
                {branding?.isFreePlan && <div className="bill-free-tag receipt-free-tag">ออกโดยระบบ Phopy ERP</div>}
                {data.seller.address && <div>{data.seller.address}</div>}
                {data.seller.taxId && <div>เลขภาษี {data.seller.taxId}</div>}
                {data.seller.tel && <div>โทร {data.seller.tel}</div>}
              </div>
              <div className="receipt-divider" />
              <div className="receipt-center"><b>{config.title.th}</b></div>
              <div className="receipt-divider" />
              <div className="receipt-row"><span>เลขที่</span><span>{data.docNumber}</span></div>
              <div className="receipt-row"><span>วันที่</span><span>{formatThaiDate(data.docDate)}</span></div>
              {data.buyer?.name && <div className="receipt-row"><span>{config.labels.buyer}</span><span>{data.buyer.name}</span></div>}
              {config.fields.showBuyerTaxId && data.buyer.taxId && (
                <div className="receipt-row"><span>เลขภาษี</span><span>{data.buyer.taxId}</span></div>
              )}
              <div className="receipt-divider" />

              {data.items.map(item => (
                <div key={item.id} className="receipt-item">
                  <div>{item.name}</div>
                  <div className="receipt-row">
                    <span>{item.quantity} {unitLabel(item.unit)} × {formatCurrency(item.price)}</span>
                    <span>{formatCurrency(item.total)}</span>
                  </div>
                </div>
              ))}

              <div className="receipt-divider" />
              <div className="receipt-row"><span>มูลค่าก่อน VAT</span><span>{formatCurrency(data.subtotal)}</span></div>
              {columns.vat && data.vatTotal > 0 && (
                <div className="receipt-row"><span>VAT 7%</span><span>{formatCurrency(data.vatTotal)}</span></div>
              )}
              <div className="receipt-row receipt-total-row"><span>รวมทั้งสิ้น</span><span>{formatCurrency(data.total)}</span></div>
              {data.paymentMethod && (
                <div className="receipt-row"><span>{data.paymentMethod}</span><span>{formatCurrency(data.total)}</span></div>
              )}

              {(showBank || showQr) && (
                <div className="receipt-pay">
                  <b>ชำระเงิน / โอนเข้าบัญชี</b>
                  {showBank && data.bankName && (
                    <>
                      <div className="receipt-row"><span>ธนาคาร</span><span>{data.bankName}</span></div>
                      <div className="receipt-row"><span>ชื่อบัญชี</span><span>{data.bankAccountName}</span></div>
                      <div className="receipt-row"><span>เลขบัญชี</span><span>{data.bankAccountNumber}</span></div>
                    </>
                  )}
                  {showQr && (
                    data.qrCode
                      ? <img className="receipt-qr" src={data.qrCode} alt="QR ชำระเงิน" />
                      : <div className="receipt-qr-placeholder">QR</div>
                  )}
                </div>
              )}

              {footerNote && <div className="receipt-center" style={{ marginTop: 6 }}>{footerNote}</div>}
              <div className="receipt-center" style={{ marginTop: 4 }}>ขอบคุณที่ใช้บริการ</div>
            </>
          ) : (
            // ═══════════════════ A4 / A5 / THERMAL(WORK_ORDER fallback) ═══════════════════
            <>
              {/* Header — โลโก้ซ้าย / ชื่อเอกสารขวา */}
              <header className="bill-header">
                <div className="bill-brand">
                  <BrandLogo branding={branding} sellerName={data.seller.name} themeColor={themeColor} />
                  <div className="bill-brand-text">
                    <div className="bill-brand-name">{data.seller.name}</div>
                    {branding?.isFreePlan && <div className="bill-free-tag">ใช้โลโก้ Phopy — อัปเกรดเพื่อใส่โลโก้ตัวเอง</div>}
                  </div>
                </div>
                <div className="bill-title-block">
                  <div className="bill-draft-label">(ต้นฉบับ)</div>
                  <div className="bill-title-th" style={{ color: themeColor }}>{config.title.th}</div>
                  <div className="bill-title-en">{config.title.en}</div>
                  <div className="bill-status-badge" data-status={data.status}>
                    {data.status === 'DRAFT' && 'ร่าง'}
                    {data.status === 'CONFIRMED' && 'ยืนยันแล้ว'}
                    {data.status === 'COMPLETED' && 'เสร็จสิ้น'}
                    {data.status === 'CANCELLED' && 'ยกเลิก'}
                    {data.status === 'PLANNED' && 'วางแผนแล้ว'}
                    {data.status === 'IN_PROGRESS' && 'กำลังผลิต'}
                    {data.status === 'ON_HOLD' && 'พักงาน'}
                  </div>
                </div>
              </header>

              {/* Head grid — ผู้ขาย | ลูกค้า/คู่ค้า | ข้อมูลเอกสาร */}
              <section className="bill-head-grid">
                <div className="bill-party-col">
                  <div className="party-row"><span className="k">ผู้ขาย :</span><span className="nm">{data.seller.name}</span></div>
                  {data.seller.address && <div className="party-row"><span className="k">ที่อยู่ :</span><span>{data.seller.address}</span></div>}
                  {data.seller.taxId && (
                    <div className="party-row"><span className="k">เลขภาษี :</span><span>{data.seller.taxId}{data.seller.branch && ` (${data.seller.branch})`}</span></div>
                  )}
                  {data.seller.tel && <div className="party-row"><span className="k">โทร :</span><span>{data.seller.tel}</span></div>}
                </div>

                <div className="bill-party-col">
                  <div className="party-row"><span className="k">{config.labels.buyer} :</span><span className="nm">{data.buyer.name}</span></div>
                  {data.buyer.address && <div className="party-row"><span className="k">ที่อยู่ :</span><span>{data.buyer.address}</span></div>}
                  {config.fields.showBuyerTaxId && data.buyer.taxId && (
                    <div className="party-row"><span className="k">เลขภาษี :</span><span>{data.buyer.taxId}{data.buyer.branch && ` (${data.buyer.branch})`}</span></div>
                  )}
                  {config.fields.showBuyerCode && data.buyer.code && (
                    <div className="party-row"><span className="k">{config.labels.buyerCode} :</span><span>{data.buyer.code}</span></div>
                  )}
                  {data.buyer.contactName && <div className="party-row"><span className="k">ผู้ติดต่อ :</span><span>{data.buyer.contactName}</span></div>}
                  {data.buyer.tel && <div className="party-row"><span className="k">โทร :</span><span>{data.buyer.tel}</span></div>}
                  {data.buyer.email && <div className="party-row"><span className="k">อีเมล :</span><span>{data.buyer.email}</span></div>}
                </div>

                <div className="bill-meta-col">
                  <div className="meta-row"><span className="k">{config.labels.docNumber}</span><span className="v">{data.docNumber}</span></div>
                  <div className="meta-row"><span className="k">วันที่ออก</span><span className="v">{formatThaiDate(data.docDate)}</span></div>
                  {config.fields.showDueDate && data.dueDate && (
                    <div className="meta-row">
                      <span className="k">{config.type === 'QUOTATION' ? 'ยืนราคาถึง' : 'ครบกำหนดชำระ'}</span>
                      <span className="v">{formatThaiDate(data.dueDate)}</span>
                    </div>
                  )}
                  {config.fields.showRefNumber && data.refNumber && (
                    <div className="meta-row"><span className="k">{config.labels.refNumber}</span><span className="v">{data.refNumber}</span></div>
                  )}
                  {config.fields.showPaymentTerms && data.paymentTerms && (
                    <>
                      <hr />
                      <div className="meta-row"><span className="k">เงื่อนไข</span><span className="v">{data.paymentTerms}</span></div>
                    </>
                  )}
                </div>
              </section>

              {/* ══ WORK ORDER BODY ══ */}
              {config.type === 'WORK_ORDER' ? (
                <>
                  <div className="wo-summary-grid">
                    <div className="wo-summary-card highlight">
                      <p className="wo-summary-label">สินค้าที่ผลิต</p>
                      <p className="wo-summary-value" style={{ fontSize: '14px', color: themeColor }}>
                        {data.woProductName || data.buyer.name}
                      </p>
                    </div>
                    <div className="wo-summary-card highlight">
                      <p className="wo-summary-label">จำนวนสั่งผลิต</p>
                      <p className="wo-summary-value" style={{ color: themeColor }}>{data.woQty ?? '-'}</p>
                      <p className="wo-summary-unit">หน่วย</p>
                    </div>
                    <div className="wo-summary-card">
                      <p className="wo-summary-label">ผลิตแล้ว</p>
                      <p className="wo-summary-value text-success">{data.woCompletedQty ?? 0}</p>
                      <p className="wo-summary-unit">หน่วย</p>
                    </div>
                    <div className="wo-summary-card">
                      <p className="wo-summary-label">ระดับความสำคัญ</p>
                      <span className="wo-priority flex items-center gap-1.5" data-priority={data.priority || 'NORMAL'}>
                        <span className={`inline-block w-2.5 h-2.5 rounded-full ${
                          data.priority === 'URGENT' ? 'bg-danger'
                          : data.priority === 'HIGH' ? 'bg-warning'
                          : data.priority === 'NORMAL' ? 'bg-info'
                          : 'bg-[var(--fg-4)]'
                        }`} />
                        {data.priority === 'URGENT' ? 'เร่งด่วนมาก'
                         : data.priority === 'HIGH' ? 'เร่งด่วน'
                         : data.priority === 'NORMAL' ? 'ปกติ'
                         : 'ไม่เร่งด่วน'}
                      </span>
                    </div>
                  </div>

                  {(data.woQty ?? 0) > 0 && (
                    <div className="wo-progress-container">
                      <div className="wo-progress-label">
                        <span>ความคืบหน้าการผลิต</span>
                        <span>{data.woCompletedQty ?? 0} / {data.woQty} หน่วย
                          ({Math.round(((data.woCompletedQty ?? 0) / (data.woQty ?? 1)) * 100)}%)
                        </span>
                      </div>
                      <div className="wo-progress-bar">
                        <div
                          className="wo-progress-fill"
                          style={{ width: `${Math.round(((data.woCompletedQty ?? 0) / (data.woQty ?? 1)) * 100)}%` }}
                          data-complete={(data.woCompletedQty ?? 0) >= (data.woQty ?? 1) ? 'true' : 'false'}
                        />
                      </div>
                    </div>
                  )}

                  <section className="wo-materials-section">
                    <h3 style={{ color: themeColor }}>รายการวัตถุดิบที่ต้องใช้</h3>
                    <table className="wo-materials-table">
                      <thead>
                        <tr style={{ backgroundColor: themeColor }}>
                          <th className="wo-col-no">#</th>
                          <th className="wo-col-name">ชื่อวัตถุดิบ</th>
                          <th className="wo-col-req">ต้องการ</th>
                          <th className="wo-col-unit">หน่วย</th>
                          <th className="wo-col-stock">สต็อก</th>
                          <th className="wo-col-issued">จ่ายแล้ว</th>
                          <th className="wo-col-check">รับแล้ว</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.items.map((item) => (
                          <tr key={item.id}>
                            <td className="wo-col-no">{item.no}</td>
                            <td className="wo-col-name">
                              {item.name}
                              {item.description && <span className="item-desc">{item.description}</span>}
                            </td>
                            <td className="wo-col-req" style={{ textAlign: 'right', fontWeight: 600 }}>
                              {item.quantity}
                            </td>
                            <td className="wo-col-unit">{unitLabel(item.unit)}</td>
                            <td className="wo-col-stock">
                              {item.stockStatus === 'ok' && (
                                <span className="wo-stock-ok flex items-center gap-1"><Check className="w-3.5 h-3.5" /> {item.stockQty} {item.stockUnit}</span>
                              )}
                              {item.stockStatus === 'short' && (
                                <span className="wo-stock-short flex items-center gap-1">
                                  <AlertTriangle className="w-3.5 h-3.5" /> {item.stockQty} {item.stockUnit}<br/>
                                  <small>ขาด {((item.quantity) - (item.stockQty ?? 0)).toFixed(2)}</small>
                                </span>
                              )}
                              {item.stockStatus === 'mismatch' && (
                                <span className="wo-stock-mismatch">{item.stockQty} {item.stockUnit}</span>
                              )}
                              {(!item.stockStatus || item.stockStatus === 'unknown') && (
                                <span className="wo-stock-unknown">-</span>
                              )}
                            </td>
                            <td className="wo-col-issued" style={{ textAlign: 'center' }}>
                              {item.issuedQty ?? 0}
                            </td>
                            <td className="wo-col-check">
                              <span className="wo-check-box" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                </>
              ) : (
                <>
                  {/* ══ STANDARD DOCUMENT BODY ══ */}
                  <section className="bill-items-section">
                    <table className="bill-items-table">
                      <thead>
                        <tr style={{ backgroundColor: themeColor }}>
                          <th className="col-item">คำอธิบาย</th>
                          <th className="col-qty">จำนวน</th>
                          <th className="col-unit">หน่วย</th>
                          <th className="col-price">ราคา/หน่วย</th>
                          {columns.discount && <th className="col-discount">ส่วนลด</th>}
                          {columns.vat && data.vatTotal > 0 && <th className="col-vat">VAT</th>}
                          <th className="col-total">มูลค่าก่อนภาษี</th>
                          {columns.wht && <th className="col-wht">WHT</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {data.items.map((item) => (
                          <tr key={item.id}>
                            <td className="col-item">
                              <div className="item-nm">{item.no}. {item.name}</div>
                              {columns.sku && item.sku && <span className="item-desc">{item.sku}</span>}
                              {item.description && <span className="item-desc">{item.description}</span>}
                            </td>
                            <td className="col-qty">{item.quantity}</td>
                            <td className="col-unit">{unitLabel(item.unit)}</td>
                            <td className="col-price">{formatCurrency(item.price)}</td>
                            {columns.discount && (
                              <td className="col-discount">{item.discount > 0 ? formatCurrency(item.discount) : '0.00'}</td>
                            )}
                            {columns.vat && data.vatTotal > 0 && (
                              <td className="col-vat">{item.vat > 0 ? formatCurrency(item.vat) : '-'}</td>
                            )}
                            <td className="col-total">{formatCurrency(item.total)}</td>
                            {columns.wht && <td className="col-wht">{item.whtLabel || 'ไม่มี'}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>

                  <section className="bill-summary-section">
                    <div className="bill-summary-left">
                      <div className="summary-line">
                        <span className="lbl">มูลค่ารายการที่ยังไม่รวมภาษีมูลค่าเพิ่ม 7%</span>
                        <span>{formatCurrency(data.subtotal)} บาท</span>
                      </div>
                      {data.discountTotal > 0 && (
                        <div className="summary-line discount">
                          <span className="lbl">ส่วนลดรวม</span>
                          <span>-{formatCurrency(data.discountTotal)} บาท</span>
                        </div>
                      )}
                      {columns.vat && data.vatTotal > 0 && (
                        <div className="summary-line">
                          <span className="lbl">ภาษีมูลค่าเพิ่ม</span>
                          <span>{formatCurrency(data.vatTotal)} บาท</span>
                        </div>
                      )}
                      {columns.wht && (data.whtTotal ?? 0) > 0 && (
                        <div className="summary-line discount">
                          <span className="lbl">หัก ณ ที่จ่าย</span>
                          <span>-{formatCurrency(data.whtTotal ?? 0)} บาท</span>
                        </div>
                      )}
                      <div className="summary-line words">
                        <span className="lbl">จำนวนเงินทั้งสิ้น</span>
                        <span>{numberToThaiText(data.total)}</span>
                      </div>
                      {data.notes && (
                        <div className="bill-notes">
                          <p className="bill-notes-label">หมายเหตุ:</p>
                          <p>{data.notes}</p>
                        </div>
                      )}
                      {data.paymentMethod && (
                        <div className="bill-payment-method">
                          <p><strong>วิธีการชำระ:</strong> {data.paymentMethod}</p>
                        </div>
                      )}
                    </div>
                    <div className="bill-summary-right">
                      <div className="bill-summary-box" style={{ borderColor: themeColor }}>
                        <div className="summary-row">
                          <span className="small">จำนวนเงินทั้งสิ้น</span>
                          <span className="big" style={{ color: themeColor }}>{formatCurrency(data.total)}</span>
                        </div>
                        {columns.wht && (data.whtTotal ?? 0) > 0 && (
                          <div className="summary-row">
                            <span className="small">หัก ณ ที่จ่าย</span>
                            <span>{formatCurrency(data.whtTotal ?? 0)}</span>
                          </div>
                        )}
                        <div className="summary-row total" style={{ backgroundColor: `${themeColor}20` }}>
                          <span style={{ color: themeColor }}>จำนวนเงินที่ต้องชำระ</span>
                          <span style={{ color: themeColor }}>{formatCurrency(data.total - (data.whtTotal ?? 0))}</span>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* กล่องข้อมูลการชำระเงิน + QR — ใต้ยอดรวม ก่อนหมายเหตุ */}
                  {(showBank || showQr) && (
                    <section className="bill-pay-section">
                      <div>
                        <div className="bill-section-heading">ข้อมูลการชำระเงิน</div>
                        {showBank && data.bankName && (
                          <>
                            <div className="pay-row flex items-center gap-1.5"><Landmark className="w-3.5 h-3.5" /><span className="k">ธนาคาร</span><span className="v">{data.bankName}</span></div>
                            <div className="pay-row flex items-center gap-1.5"><User className="w-3.5 h-3.5" /><span className="k">ชื่อบัญชี</span><span className="v">{data.bankAccountName}</span></div>
                            <div className="pay-row flex items-center gap-1.5"><Hash className="w-3.5 h-3.5" /><span className="k">เลขที่บัญชี</span><span className="v pay-account">{data.bankAccountNumber}</span></div>
                            {data.bankAccountType && <div className="pay-row"><span className="k">ประเภท</span><span className="v">{data.bankAccountType}</span></div>}
                          </>
                        )}
                        <div className="pay-row"><span className="k">อ้างอิง</span><span className="v">{data.docNumber}</span></div>
                      </div>
                      {showQr && (
                        <div className="bill-pay-qr">
                          {data.qrCode
                            ? <img src={data.qrCode} alt="QR ชำระเงิน" />
                            : <div className="qr-box">QR</div>}
                          <p className="pay-qr-cap">สแกนเพื่อโอนเงิน</p>
                        </div>
                      )}
                    </section>
                  )}
                </>
              )}

              {/* หมายเหตุเพิ่มเติมจาก settings (footerNote) */}
              {footerNote && (
                <section className="bill-notes-block">
                  <div className="bill-section-heading">หมายเหตุ</div>
                  <div>{footerNote}</div>
                </section>
              )}

              {/* รับรอง / ช่องเซ็น */}
              {config.fields.showSignatures && (
                <footer className="bill-footer">
                  <div className="bill-section-heading">รับรอง</div>
                  <div className="bill-signatures" style={{ gridTemplateColumns: `repeat(${signatureSlots.length}, 1fr)` }}>
                    {signatureSlots.map((label, i) => (
                      <div className="signature-box" key={`${label}-${i}`}>
                        <div className="signature-line" />
                        <p className="signature-label">{label}</p>
                        {i === 0 && <p className="signature-date">วันที่ {formatThaiDate(data.docDate)}</p>}
                      </div>
                    ))}
                  </div>
                </footer>
              )}

              <div className="bill-footer-info">
                <p>เอกสารนี้ออกโดยระบบ Phopy ERP</p>
                <p>เลขที่เอกสาร: {data.docNumber} | สร้างเมื่อ: {new Date(data.createdAt).toLocaleString('th-TH')}</p>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }
)

UnifiedBillTemplate.displayName = 'UnifiedBillTemplate'

export default UnifiedBillTemplate
