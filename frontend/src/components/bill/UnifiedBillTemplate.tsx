import { forwardRef } from 'react'
import { useBill, BillType, BILL_CONFIGS } from './BillContext'
import './UnifiedBillTemplate.css'

// Utility functions
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

function formatCurrency(amount: number): string {
  return amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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

interface UnifiedBillTemplateProps {
  size?: 'A4' | 'A5' | 'THERMAL'
  showPrintButton?: boolean
  onPrint?: () => void
}

const UnifiedBillTemplate = forwardRef<HTMLDivElement, UnifiedBillTemplateProps>(
  ({ size = 'A4', showPrintButton = true, onPrint }, ref) => {
    const { config, data, loading, error, printBill } = useBill()
    
    const handlePrint = () => {
      if (onPrint) onPrint()
      else printBill()
    }
    
    if (loading) {
      return (
        <div className="bill-loading">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyber-primary"></div>
          <p>กำลังโหลดข้อมูล...</p>
        </div>
      )
    }
    
    if (error || !data) {
      return (
        <div className="bill-error">
          <p>❌ {error || 'ไม่พบข้อมูล'}</p>
        </div>
      )
    }
    
    return (
      <div className="unified-bill-container">
        {showPrintButton && (
          <div className="bill-toolbar no-print">
            <button onClick={handlePrint} className="cyber-btn-primary">
              🖨️ พิมพ์เอกสาร
            </button>
            <button className="cyber-btn-secondary">
              💾 บันทึก PDF
            </button>
            <button className="cyber-btn-secondary">
              📧 ส่งอีเมล
            </button>
          </div>
        )}
        
        <div
          ref={ref}
          className={`unified-bill-paper bill-${size.toLowerCase()}`}
          style={{ '--theme-color': config.themeColor } as React.CSSProperties}
        >
          {/* Header with Logo and Title */}
          <header className="bill-header" style={{ borderColor: config.themeColor }}>
            <div className="bill-company-section">
              <div className="bill-logo">
                <div className="bill-logo-box" style={{ borderColor: config.themeColor }}>
                  <span style={{ color: config.themeColor }}>BB</span>
                  <span>PILLOW</span>
                </div>
              </div>
              <div className="bill-company-info">
                <h2 className="bill-company-name">{data.seller.name}</h2>
                <p className="bill-company-address">{data.seller.address}</p>
                {data.seller.taxId && (
                  <p className="bill-tax-info">
                    เลขประจำตัวผู้เสียภาษี: {data.seller.taxId}
                    {data.seller.branch && ` (${data.seller.branch})`}
                  </p>
                )}
                {data.seller.tel && <p>โทร: {data.seller.tel}</p>}
              </div>
            </div>
            
            <div className="bill-title-section" style={{ backgroundColor: `${config.themeColor}15` }}>
              <h1 className="bill-title-th" style={{ color: config.themeColor }}>
                {config.title.th}
              </h1>
              <p className="bill-title-en">{config.title.en}</p>
              <div className="bill-status-badge" data-status={data.status}>
                {data.status === 'DRAFT' && 'ร่าง'}
                {data.status === 'CONFIRMED' && 'ยืนยันแล้ว'}
                {data.status === 'COMPLETED' && 'เสร็จสิ้น'}
                {data.status === 'CANCELLED' && 'ยกเลิก'}
              </div>
            </div>
          </header>
          
          {/* Document Info Grid */}
          <section className="bill-info-grid">
            {/* Left: Party Info (Buyer/Supplier/Department) */}
            <div className="bill-party-info">
              <h3 style={{ color: config.themeColor }}>
                {config.labels.buyer}
              </h3>
              {config.fields.showBuyerCode && data.buyer.code && (
                <p><strong>{config.labels.buyerCode}:</strong> {data.buyer.code}</p>
              )}
              <p className="bill-party-name">{data.buyer.name}</p>
              {data.buyer.address && <p>{data.buyer.address}</p>}
              {config.fields.showBuyerTaxId && data.buyer.taxId && (
                <p>เลขประจำตัวผู้เสียภาษี: {data.buyer.taxId}</p>
              )}
              
              {/* Contact Info */}
              <div className="bill-contact-grid">
                {data.buyer.contactName && (
                  <p>👤 {data.buyer.contactName}</p>
                )}
                {data.buyer.tel && (
                  <p>📞 {data.buyer.tel}</p>
                )}
                {data.buyer.email && (
                  <p>✉️ {data.buyer.email}</p>
                )}
              </div>
            </div>
            
            {/* Right: Document Info */}
            <div className="bill-doc-info" style={{ borderColor: config.themeColor }}>
              <div className="bill-info-row">
                <span className="bill-label">{config.labels.docNumber}</span>
                <span className="bill-value bill-doc-number">{data.docNumber}</span>
              </div>
              <div className="bill-info-row">
                <span className="bill-label">วันที่ออก</span>
                <span className="bill-value">{formatThaiDate(data.docDate)}</span>
              </div>
              {config.fields.showRefNumber && data.refNumber && (
                <div className="bill-info-row">
                  <span className="bill-label">{config.labels.refNumber}</span>
                  <span className="bill-value">{data.refNumber}</span>
                </div>
              )}
              {config.fields.showDueDate && data.dueDate && (
                <div className="bill-info-row">
                  <span className="bill-label">{config.type === 'QUOTATION' ? 'วันหมดอายุ' : 'กำหนดส่ง/ชำระ'}</span>
                  <span className="bill-value bill-due-date">{formatThaiDate(data.dueDate)}</span>
                </div>
              )}
              {config.fields.showPaymentTerms && data.paymentTerms && (
                <div className="bill-info-row">
                  <span className="bill-label">เงื่อนไขการชำระ</span>
                  <span className="bill-value">{data.paymentTerms}</span>
                </div>
              )}
            </div>
          </section>
          
          {/* Items Table */}
          <section className="bill-items-section">
            <table className="bill-items-table">
              <thead>
                <tr style={{ backgroundColor: `${config.themeColor}20` }}>
                  <th className="col-no">ลำดับ</th>
                  <th className="col-item">รายการ</th>
                  <th className="col-qty">จำนวน</th>
                  <th className="col-unit">หน่วย</th>
                  <th className="col-price">ราคา/หน่วย</th>
                  <th className="col-discount">ส่วนลด</th>
                  {data.vatTotal > 0 && <th className="col-vat">VAT</th>}
                  <th className="col-total">จำนวนเงิน</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td className="col-no">{item.no}</td>
                    <td className="col-item">
                      {item.name}
                      {item.description && <span className="item-desc">{item.description}</span>}
                    </td>
                    <td className="col-qty">{item.quantity}</td>
                    <td className="col-unit">{item.unit}</td>
                    <td className="col-price">{formatCurrency(item.price)}</td>
                    <td className="col-discount">
                      {item.discount > 0 ? formatCurrency(item.discount) : '-'}
                    </td>
                    {data.vatTotal > 0 && (
                      <td className="col-vat">
                        {item.vat > 0 ? formatCurrency(item.vat) : '-'}
                      </td>
                    )}
                    <td className="col-total">{formatCurrency(item.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          
          {/* Summary Section */}
          <section className="bill-summary-section">
            <div className="bill-summary-left">
              {/* Amount in words */}
              <div className="bill-amount-words" style={{ borderColor: config.themeColor }}>
                <p className="bill-words-label">จำนวนเงินเป็นตัวอักษร</p>
                <p className="bill-words-text">{numberToThaiText(data.total)}</p>
              </div>
              
              {/* Notes */}
              {data.notes && (
                <div className="bill-notes">
                  <p className="bill-notes-label">หมายเหตุ:</p>
                  <p>{data.notes}</p>
                </div>
              )}
              
              {/* Bank Info */}
              {config.fields.showBankInfo && data.bankName && (
                <div className="bill-bank-info">
                  <p className="bill-bank-label">ชำระเงินผ่านธนาคาร:</p>
                  <p>🏦 {data.bankName}</p>
                  <p>👤 ชื่อบัญชี: {data.bankAccountName}</p>
                  <p>🔢 เลขที่บัญชี: {data.bankAccountNumber}</p>
                </div>
              )}
              
              {/* Payment Method */}
              {data.paymentMethod && (
                <div className="bill-payment-method">
                  <p><strong>วิธีการชำระ:</strong> {data.paymentMethod}</p>
                </div>
              )}
            </div>
            
            <div className="bill-summary-right">
              <div className="bill-summary-box" style={{ borderColor: config.themeColor }}>
                <div className="summary-row">
                  <span>มูลค่ารวมก่อนภาษี</span>
                  <span>{formatCurrency(data.subtotal)}</span>
                </div>
                {data.discountTotal > 0 && (
                  <div className="summary-row discount">
                    <span>ส่วนลด</span>
                    <span>-{formatCurrency(data.discountTotal)}</span>
                  </div>
                )}
                {data.vatTotal > 0 && (
                  <div className="summary-row">
                    <span>ภาษีมูลค่าเพิ่ม 7%</span>
                    <span>{formatCurrency(data.vatTotal)}</span>
                  </div>
                )}
                <div className="summary-row total" style={{ backgroundColor: `${config.themeColor}20` }}>
                  <span style={{ color: config.themeColor }}>จำนวนเงินทั้งสิ้น</span>
                  <span style={{ color: config.themeColor }}>{formatCurrency(data.total)}</span>
                </div>
              </div>
            </div>
          </section>
          
          {/* Footer - QR Code & Signatures */}
          {config.fields.showSignatures && (
            <footer className="bill-footer">
              {config.fields.showQRCode && (
                <div className="bill-qr-section">
                  {data.qrCode ? (
                    <img src={data.qrCode} alt="QR Code" />
                  ) : (
                    <div className="bill-qr-placeholder">
                      <div className="qr-box">QR</div>
                      <p>สแกนเพื่อตรวจสอบ</p>
                    </div>
                  )}
                </div>
              )}
              
              <div className="bill-signatures">
                <div className="signature-box">
                  <div className="signature-line"></div>
                  <p className="signature-label">ผู้มีอำนาจลงนาม</p>
                  <p className="signature-date">วันที่ {formatThaiDate(data.docDate)}</p>
                </div>
                
                <div className="signature-box">
                  <div className="signature-line"></div>
                  <p className="signature-label">ผู้รับเอกสาร</p>
                  <p className="signature-date">วันที่ ____/____/______</p>
                </div>
                
                <div className="signature-box">
                  <div className="signature-line"></div>
                  <p className="signature-label">
                    {config.type === 'WORK_ORDER' ? 'ผู้รับงาน' : 'ผู้ส่งมอบสินค้า'}
                  </p>
                  <p className="signature-date">วันที่ ____/____/______</p>
                </div>
                
                {config.type !== 'WORK_ORDER' && (
                  <div className="signature-box">
                    <div className="signature-line"></div>
                    <p className="signature-label">ประทับตรารับสินค้า</p>
                  </div>
                )}
              </div>
            </footer>
          )}
          
          {/* Footer Info */}
          <div className="bill-footer-info">
            <p>เอกสารนี้ออกโดยระบบ BB PILLOW ERP</p>
            <p>เลขที่เอกสาร: {data.docNumber} | สร้างเมื่อ: {new Date(data.createdAt).toLocaleString('th-TH')}</p>
          </div>
        </div>
      </div>
    )
  }
)

UnifiedBillTemplate.displayName = 'UnifiedBillTemplate'

export default UnifiedBillTemplate
