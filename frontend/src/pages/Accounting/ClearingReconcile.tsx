import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, RefreshCw, Store, Landmark, Package, Truck } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'

// ==================== Types (ตรงกับ backend GET /api/clearing/reconcile) ====================

interface ClearingItem {
  id: string
  docNumber: string
  date: string | null
  party: string
  quantity?: number
  value: number
}

interface ClearingBucket {
  code: string
  name: string
  title: string
  zeroWhen: string
  balance: number
  itemCount: number
  itemsTotal: number
  mismatch: boolean
  items: ClearingItem[]
}

// ==================== Helpers ====================

const fmt = (n: number) => `฿${(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : '-')

// ไอคอนต่อบัญชีพัก ใช้แยกแยะด้วยสายตาโดยไม่ต้องอ่านรหัสบัญชี
const ICONS: Record<string, React.ElementType> = {
  '1180': Store,
  '1181': Landmark,
  '1112': Truck,
  '2109': Package,
}

// ==================== Main Component ====================

export default function ClearingReconcile() {
  const [buckets, setBuckets] = useState<ClearingBucket[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCode, setSelectedCode] = useState<string | null>(null)

  const fetchData = async () => {
    try {
      setLoading(true)
      const res = await api.get('/clearing/reconcile')
      if (res.data.success) {
        const data: ClearingBucket[] = res.data.data
        setBuckets(data)
        // เลือกบัญชีที่ค้างอยู่ตัวแรกให้อัตโนมัติ ถ้าไม่มีเลยก็เลือกตัวแรกสุด
        setSelectedCode((prev) => prev && data.some((b) => b.code === prev) ? prev : (data.find((b) => b.itemCount > 0)?.code || data[0]?.code || null))
      }
    } catch {
      toast.error('โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  const selected = buckets.find((b) => b.code === selectedCode) || null
  const anyMismatch = buckets.some((b) => b.mismatch)

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-1)]">บัญชีตรงกับของหรือยัง</h1>
          <p className="text-[var(--fg-3)] mt-1 text-sm">
            รายการที่ยังไม่จบ — ของหรือเงินออกจากมือไปแล้วแต่รอปิดงาน
          </p>
        </div>
        <button
          onClick={fetchData}
          className="p-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--fg-3)] hover:text-[var(--fg-1)]"
        >
          <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* แถบเตือนยอดไม่ตรง */}
      {anyMismatch && (
        <div className="w-full flex items-start gap-3 p-4 bg-danger/10 border border-danger/30 rounded-xl text-sm">
          <AlertTriangle className="w-5 h-5 text-danger shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-[var(--fg-1)]">ยอดบัญชีกับรายการเอกสารไม่ตรงกัน</p>
            <p className="text-[var(--fg-3)] mt-1 leading-relaxed">
              บางบัญชีพัก ยอดในสมุดบัญชีกับผลรวมของเอกสารที่ค้างจริงต่างกันเกิน ฿1
              แปลว่ามีรายการที่ลงบัญชีไปแล้วแต่เอกสารไม่สะท้อน (หรือกลับกัน) ควรตรวจสอบทีละใบในตารางด้านล่าง
            </p>
          </div>
        </div>
      )}

      {/* การ์ด 4 บัญชีพัก */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {buckets.map((b) => {
          const Icon = ICONS[b.code] || Package
          const isZero = Math.abs(b.balance) < 1 && b.itemCount === 0
          const isSelected = selectedCode === b.code
          return (
            <button
              key={b.code}
              onClick={() => setSelectedCode(b.code)}
              className={`text-left p-5 rounded-xl border transition-colors ${
                isSelected ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--fg-4)]'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <Icon className={`w-5 h-5 ${isZero ? 'text-[var(--fg-4)]' : 'text-warning'}`} />
                {b.mismatch && <AlertTriangle className="w-4 h-4 text-danger" />}
                {!b.mismatch && isZero && <CheckCircle2 className="w-4 h-4 text-success" />}
              </div>
              <p className="text-xs text-[var(--fg-3)] leading-snug mb-2 min-h-[2.2em]">{b.title}</p>
              <p className={`text-2xl font-bold ${isZero ? 'text-success' : 'text-[var(--fg-1)]'}`}>{fmt(Math.abs(b.balance))}</p>
              <p className="text-xs text-[var(--fg-4)] mt-1">
                {b.itemCount > 0 ? `${b.itemCount} รายการ` : `ศูนย์แล้ว · ${b.zeroWhen}`}
              </p>
            </button>
          )
        })}
      </div>

      {/* ตารางรายการค้างของบัญชีที่เลือก */}
      {selected && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
            <h2 className="font-semibold text-[var(--fg-1)]">{selected.title}</h2>
            {selected.mismatch && (
              <span className="text-xs text-danger flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> ยอดบัญชี {fmt(Math.abs(selected.balance))} ≠ ผลรวมเอกสาร {fmt(selected.itemsTotal)}
              </span>
            )}
          </div>

          {selected.items.length === 0 ? (
            <div className="p-10 text-center">
              <CheckCircle2 className="w-14 h-14 mx-auto mb-3 text-success" />
              <p className="text-[var(--fg-1)] font-medium">ไม่มีรายการค้าง</p>
              <p className="text-[var(--fg-4)] text-sm mt-1">ศูนย์เมื่อ {selected.zeroWhen}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--fg-3)] text-xs uppercase tracking-wide">
                    <th className="text-left px-5 py-3 font-medium">เอกสาร</th>
                    <th className="text-left px-5 py-3 font-medium">วันที่</th>
                    <th className="text-left px-5 py-3 font-medium">คู่ค้า / รายละเอียด</th>
                    <th className="text-right px-5 py-3 font-medium">มูลค่า</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {selected.items.map((it) => (
                    <tr key={it.id} className="hover:bg-[var(--bg)]/30">
                      <td className="px-5 py-3 text-[var(--fg-1)] font-medium">{it.docNumber}</td>
                      <td className="px-5 py-3 text-[var(--fg-3)]">{fmtDate(it.date)}</td>
                      <td className="px-5 py-3 text-[var(--fg-3)]">
                        {it.party}
                        {typeof it.quantity === 'number' && <span className="text-[var(--fg-4)]"> · {it.quantity.toLocaleString('th-TH')}</span>}
                      </td>
                      <td className="px-5 py-3 text-right text-[var(--fg-1)] font-medium">{fmt(it.value)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-[var(--border)] font-semibold">
                    <td className="px-5 py-3 text-[var(--fg-1)]" colSpan={3}>รวม</td>
                    <td className="px-5 py-3 text-right text-[var(--fg-1)]">{fmt(selected.itemsTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
