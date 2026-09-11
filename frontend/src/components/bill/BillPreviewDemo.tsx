import { useEffect, useState } from 'react'
import { BillProvider, useBill, BillType, BILL_CONFIGS } from './BillContext'
import UnifiedBillTemplate, { BillBranding } from './UnifiedBillTemplate'

// ═══════════════════════════════════════════════════════════════
// BillPreviewDemo — หน้าตัวอย่างในตัวสำหรับเจ้าของกดดูดีไซน์เทียบ mockup
// ยังไม่ผูก route/เมนูใดๆ (ตามโจทย์) — แค่ mount ได้และ compile ผ่าน
//
// ตัว demo นี้ "ห่อ" ด้วย BillProvider/useBill() ได้อย่างอิสระ (มันไม่ใช่
// leaf component ที่ต้องไปผ่าน renderToStaticMarkup) แล้วส่ง config+data
// เป็น props ล้วนๆ ให้ UnifiedBillTemplate ตามสัญญาที่ template กำหนดไว้
// ═══════════════════════════════════════════════════════════════

const ALL_TYPES = Object.keys(BILL_CONFIGS) as BillType[]
const SIZES: { value: 'A4' | 'A5' | 'THERMAL'; label: string }[] = [
  { value: 'A4', label: 'A4 (ปกติ)' },
  { value: 'A5', label: 'A5 (ครึ่ง A4)' },
  { value: 'THERMAL', label: 'Thermal 80mm' },
]

function DemoBill({ size, branding }: { size: 'A4' | 'A5' | 'THERMAL'; branding: BillBranding }) {
  const { config, data, loading, error, loadBillData } = useBill()

  useEffect(() => {
    loadBillData(config.type, 'DEMO-001')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.type])

  if (loading || !data) {
    return <div className="flex items-center justify-center p-16 text-[var(--fg-3)]">กำลังโหลดตัวอย่าง...</div>
  }
  if (error) {
    return <div className="flex items-center justify-center p-16 text-danger">{error}</div>
  }

  return <UnifiedBillTemplate config={config} data={data} size={size} branding={branding} />
}

export default function BillPreviewDemo() {
  const [type, setType] = useState<BillType>('QUOTATION')
  const [size, setSize] = useState<'A4' | 'A5' | 'THERMAL'>('A4')
  const [isFreePlan, setIsFreePlan] = useState(false)

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-xl font-bold text-[var(--fg-1)]">ตัวอย่าง Template กลาง — เทียบกับ mockup ที่อนุมัติแล้ว</h2>

      {/* ── ชนิดเอกสาร ── */}
      <div className="flex flex-wrap gap-2">
        {ALL_TYPES.map(t => {
          const cfg = BILL_CONFIGS[t]
          const active = type === t
          return (
            <button
              key={t}
              onClick={() => setType(t)}
              className="px-3 py-1.5 rounded-lg border text-sm transition-colors"
              style={active
                ? { borderColor: cfg.themeColor, color: cfg.themeColor, background: `${cfg.themeColor}15` }
                : { borderColor: 'var(--border)', color: 'var(--fg-2)' }}
            >
              {cfg.title.th}
            </button>
          )
        })}
      </div>

      {/* ── ขนาดกระดาษ + แพ็กเกจ ── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-[var(--fg-3)]">ขนาดกระดาษ:</span>
        {SIZES.map(s => (
          <button
            key={s.value}
            onClick={() => setSize(s.value)}
            className={`px-3 py-1.5 rounded-lg border text-sm ${size === s.value ? 'bg-[var(--fg-1)] text-white border-[var(--fg-1)]' : 'border-[var(--border)] text-[var(--fg-2)]'}`}
          >
            {s.label}
          </button>
        ))}

        <span className="ml-4 text-sm text-[var(--fg-3)]">แพ็กเกจ:</span>
        <button
          onClick={() => setIsFreePlan(false)}
          className={`px-3 py-1.5 rounded-lg border text-sm ${!isFreePlan ? 'bg-[var(--fg-1)] text-white border-[var(--fg-1)]' : 'border-[var(--border)] text-[var(--fg-2)]'}`}
        >
          มีโลโก้เอง
        </button>
        <button
          onClick={() => setIsFreePlan(true)}
          className={`px-3 py-1.5 rounded-lg border text-sm ${isFreePlan ? 'bg-[var(--fg-1)] text-white border-[var(--fg-1)]' : 'border-[var(--border)] text-[var(--fg-2)]'}`}
        >
          ฟรี (Phopy)
        </button>
      </div>

      {/* key={type} บังคับ remount BillProvider ทุกครั้งที่เปลี่ยนชนิดเอกสาร */}
      <BillProvider key={type} initialType={type}>
        <DemoBill size={size} branding={{ isFreePlan }} />
      </BillProvider>
    </div>
  )
}
