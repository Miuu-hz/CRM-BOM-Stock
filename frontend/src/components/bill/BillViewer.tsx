import { useRef, useState, useEffect } from 'react'
import { BillProvider, BillType, useBill } from './BillContext'
import UnifiedBillTemplate from './UnifiedBillTemplate'
import { FileText, ShoppingCart, Package, Wrench, Truck, Receipt, Printer, X, Eye, XCircle } from 'lucide-react'

interface BillViewerProps {
  type: BillType
  documentId: string
  onClose?: () => void
}

// Bill Type Selector
const billTypeOptions: { type: BillType; label: string; icon: any; color: string }[] = [
  { type: 'QUOTATION', label: 'ใบเสนอราคา', icon: FileText, color: '#EC4899' },
  { type: 'SALE', label: 'ใบสั่งขาย', icon: ShoppingCart, color: '#3949E5' },
  { type: 'INVOICE', label: 'ใบแจ้งหนี้/ใบกำกับภาษี', icon: FileText, color: '#c2410c' },
  { type: 'DELIVERY', label: 'ใบส่งของ', icon: Truck, color: '#0066ff' },
  { type: 'RECEIPT', label: 'ใบเสร็จ', icon: Receipt, color: '#047857' },
  { type: 'CREDIT_NOTE', label: 'ใบลดหนี้', icon: FileText, color: '#DC2626' },
  { type: 'PURCHASE_REQUEST', label: 'ใบขอซื้อ', icon: Package, color: '#7C3AED' },
  { type: 'PURCHASE', label: 'ใบสั่งซื้อ', icon: Package, color: '#9333EA' },
  { type: 'GOODS_RECEIPT', label: 'ใบรับสินค้า', icon: Package, color: '#0D9488' },
  { type: 'PURCHASE_INVOICE', label: 'ใบกำกับภาษีซื้อ', icon: Package, color: '#B45309' },
  { type: 'PAYMENT', label: 'ใบสำคัญจ่าย', icon: Package, color: '#059669' },
  { type: 'PURCHASE_RETURN', label: 'ใบคืนสินค้า', icon: Package, color: '#B91C1C' },
  { type: 'WORK_ORDER', label: 'ใบสั่งผลิต', icon: Wrench, color: '#F59E0B' },
]

// Inner component that uses the context — ทำหน้าที่ "ห่อ" ดึง config/data
// จาก BillContext แล้วส่งเป็น props ล้วนๆ ให้ UnifiedBillTemplate (pure component)
function BillViewerContent({ documentId, onClose }: { documentId: string; onClose?: () => void }) {
  const { config, data, loading, error, loadBillData } = useBill()
  const billRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<'A4' | 'A5' | 'THERMAL'>('A4')

  useEffect(() => {
    loadBillData(config.type, documentId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.type, documentId])

  const handlePrint = () => {
    window.print()
  }

  return (
    <div className="bill-viewer-overlay">
      <div className="bill-viewer-modal">
        {/* Header */}
        <div className="bill-viewer-header" style={{ borderColor: config.themeColor }}>
          <div className="bill-viewer-title">
            <span className="bill-type-icon" style={{ color: config.themeColor }}>
              {(() => {
                const TypeIcon = billTypeOptions.find(t => t.type === config.type)?.icon || FileText
                return <TypeIcon className="w-6 h-6" />
              })()}
            </span>
            <div>
              <h2 style={{ color: config.themeColor }}>{config.title.th}</h2>
              <p>{data?.docNumber}</p>
            </div>
          </div>

          <div className="bill-viewer-controls">
            {/* Size Selector */}
            <select
              value={size}
              onChange={(e) => setSize(e.target.value as any)}
              className="bill-size-select"
            >
              <option value="A4">A4 (ปกติ)</option>
              <option value="A5">A5 (ครึ่ง A4)</option>
              <option value="THERMAL">Thermal (80mm)</option>
            </select>

            <button onClick={handlePrint} className="phopy-btn-primary flex items-center gap-2">
              <Printer className="w-4 h-4" /> พิมพ์
            </button>
            {onClose && (
              <button onClick={onClose} className="phopy-btn-secondary flex items-center gap-2">
                <X className="w-4 h-4" /> ปิด
              </button>
            )}
          </div>
        </div>

        {/* Bill Content */}
        <div className="bill-viewer-content">
          {loading && (
            <div className="flex flex-col items-center justify-center gap-3 p-16 text-[var(--fg-3)]">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-phopy-indigo"></div>
              <p>กำลังโหลดข้อมูล...</p>
            </div>
          )}
          {!loading && (error || !data) && (
            <div className="flex items-center justify-center gap-2 p-16 text-danger">
              <XCircle className="w-5 h-5" />
              <p>{error || 'ไม่พบข้อมูล'}</p>
            </div>
          )}
          {!loading && data && (
            <UnifiedBillTemplate
              ref={billRef}
              config={config}
              data={data}
              size={size}
              showPrintButton={false}
              onPrint={handlePrint}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// Main Component with Provider
export default function BillViewer({ type, documentId, onClose }: BillViewerProps) {
  return (
    <BillProvider initialType={type}>
      <BillViewerContent documentId={documentId} onClose={onClose} />
    </BillProvider>
  )
}

// Demo/Preview Component
export function BillDemo() {
  const [selectedType, setSelectedType] = useState<BillType>('SALE')
  const [showViewer, setShowViewer] = useState(false)

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold text-[var(--fg-1)]">ระบบพิมพ์เอกสาร (Bill Printing System)</h2>

      {/* Type Selector */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {billTypeOptions.map(({ type, label, icon: Icon, color }) => (
          <button
            key={type}
            onClick={() => setSelectedType(type)}
            className={`p-4 rounded-xl border-2 transition-all ${
              selectedType === type
                ? 'border-phopy-indigo bg-phopy-indigo/10'
                : 'border-[var(--border)] hover:border-phopy-indigo/50'
            }`}
            style={selectedType === type ? { borderColor: color } : {}}
          >
            <Icon className="w-8 h-8 mx-auto mb-2" style={{ color }} />
            <p className="text-[var(--fg-2)] text-sm">{label}</p>
          </button>
        ))}
      </div>

      {/* Preview Button */}
      <button
        onClick={() => setShowViewer(true)}
        className="phopy-btn-primary w-full py-4 text-lg flex items-center justify-center gap-2"
      >
        <Eye className="w-5 h-5" /> ดูตัวอย่าง {billTypeOptions.find(t => t.type === selectedType)?.label}
      </button>

      {/* Bill Viewer Modal */}
      {showViewer && (
        <BillViewer
          type={selectedType}
          documentId="DEMO-001"
          onClose={() => setShowViewer(false)}
        />
      )}
    </div>
  )
}

// Quick Print Button for use in other pages
interface QuickPrintButtonProps {
  type: BillType
  documentId: string
  label?: string
  className?: string
}

export function QuickPrintButton({ type, documentId, label, className = '' }: QuickPrintButtonProps) {
  const [showViewer, setShowViewer] = useState(false)
  const opt = billTypeOptions.find(t => t.type === type)
  const buttonLabel = label || `พิมพ์${opt?.label || 'เอกสาร'}`
  const color = opt?.color || '#3949E5'

  return (
    <>
      <button
        onClick={() => setShowViewer(true)}
        className={`phopy-btn-secondary flex items-center gap-2 ${className}`}
        style={{ borderColor: color, color }}
      >
        <Printer className="w-4 h-4" /> {buttonLabel}
      </button>

      {showViewer && (
        <BillViewer
          type={type}
          documentId={documentId}
          onClose={() => setShowViewer(false)}
        />
      )}
    </>
  )
}
