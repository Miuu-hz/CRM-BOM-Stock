import { useRef, useState } from 'react'
import { BillProvider, BillType, useBill } from './BillContext'
import UnifiedBillTemplate from './UnifiedBillTemplate'
import { FileText, ShoppingCart, Package, Wrench, Truck, Receipt } from 'lucide-react'

interface BillViewerProps {
  type: BillType
  documentId: string
  onClose?: () => void
}

// Bill Type Selector
const billTypeOptions: { type: BillType; label: string; icon: any; color: string }[] = [
  { type: 'QUOTATION', label: 'ใบเสนอราคา', icon: FileText, color: '#ff00ff' },
  { type: 'SALE', label: 'ใบสั่งขาย', icon: ShoppingCart, color: '#00f0ff' },
  { type: 'DELIVERY', label: 'ใบส่งของ', icon: Truck, color: '#0066ff' },
  { type: 'RECEIPT', label: 'ใบเสร็จ', icon: Receipt, color: '#00f0ff' },
  { type: 'PURCHASE', label: 'ใบสั่งซื้อ', icon: Package, color: '#9d00ff' },
  { type: 'WORK_ORDER', label: 'ใบสั่งผลิต', icon: Wrench, color: '#00ff88' },
]

// Inner component that uses the context
function BillViewerContent({ onClose }: { onClose?: () => void }) {
  const { config, data, loading, loadBillData } = useBill()
  const billRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<'A4' | 'A5' | 'THERMAL'>('A4')
  
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
            
            <button onClick={handlePrint} className="cyber-btn-primary">
              🖨️ พิมพ์
            </button>
            {onClose && (
              <button onClick={onClose} className="cyber-btn-secondary">
                ✕ ปิด
              </button>
            )}
          </div>
        </div>
        
        {/* Bill Content */}
        <div className="bill-viewer-content">
          <UnifiedBillTemplate
            ref={billRef}
            size={size}
            showPrintButton={false}
            onPrint={handlePrint}
          />
        </div>
      </div>
    </div>
  )
}

// Main Component with Provider
export default function BillViewer({ type, documentId, onClose }: BillViewerProps) {
  return (
    <BillProvider initialType={type}>
      <BillViewerContent onClose={onClose} />
    </BillProvider>
  )
}

// Demo/Preview Component
export function BillDemo() {
  const [selectedType, setSelectedType] = useState<BillType>('SALE')
  const [showViewer, setShowViewer] = useState(false)
  
  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold text-gray-100">ระบบพิมพ์เอกสาร (Bill Printing System)</h2>
      
      {/* Type Selector */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {billTypeOptions.map(({ type, label, icon: Icon, color }) => (
          <button
            key={type}
            onClick={() => setSelectedType(type)}
            className={`p-4 rounded-xl border-2 transition-all ${
              selectedType === type
                ? 'border-cyber-primary bg-cyber-primary/10'
                : 'border-cyber-border hover:border-cyber-primary/50'
            }`}
            style={selectedType === type ? { borderColor: color } : {}}
          >
            <Icon className="w-8 h-8 mx-auto mb-2" style={{ color }} />
            <p className="text-gray-300 text-sm">{label}</p>
          </button>
        ))}
      </div>
      
      {/* Preview Button */}
      <button
        onClick={() => setShowViewer(true)}
        className="cyber-btn-primary w-full py-4 text-lg"
      >
        👁️ ดูตัวอย่าง {billTypeOptions.find(t => t.type === selectedType)?.label}
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
  const config = {
    SALE: { label: 'พิมพ์ใบสั่งขาย', color: '#00f0ff' },
    PURCHASE: { label: 'พิมพ์ใบสั่งซื้อ', color: '#9d00ff' },
    WORK_ORDER: { label: 'พิมพ์ใบสั่งผลิต', color: '#00ff88' },
    QUOTATION: { label: 'พิมพ์ใบเสนอราคา', color: '#ff00ff' },
    DELIVERY: { label: 'พิมพ์ใบส่งของ', color: '#0066ff' },
    RECEIPT: { label: 'พิมพ์ใบเสร็จ', color: '#00f0ff' },
  }[type]
  
  return (
    <>
      <button
        onClick={() => setShowViewer(true)}
        className={`cyber-btn-secondary flex items-center gap-2 ${className}`}
        style={{ borderColor: config.color, color: config.color }}
      >
        🖨️ {label || config.label}
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
