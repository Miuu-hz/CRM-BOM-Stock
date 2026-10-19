import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { BellRing, Clock, QrCode, Settings2, Smartphone } from 'lucide-react'
import api from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'
import TableManager from './TableManager'
import { printTableSlip } from './qrPrint'

export interface PosTable {
  id: string
  name: string
  bill_id: string | null
  bill_number: string | null
  total_amount: number | null
  opened_at: string | null
  customer_name: string | null
  bill_requested_at: string | null
  item_count: number
  qr_item_count: number
}
export interface QrSettings { mode: 'static' | 'rotate' }

type Props = {
  activeBillId?: string
  /** กะค้างข้ามวัน: เปิดโต๊ะใหม่ไม่ได้ แต่ยังเปิดบิลเดิมได้ */
  canOpenNew: boolean
  onOpenBill: (billId: string) => void
  /** เปิดโต๊ะ = สร้างบิลที่ผูกโต๊ะ (Cashier จัดการ error เรื่องกะเอง) คืน null ถ้าไม่สำเร็จ */
  createTableBill: (tableId: string) => Promise<{ id: string } | null>
}

const POLL_MS = 5000
const MANAGER_ROLES = ['ADMIN', 'MANAGER', 'MASTER']

// ผังโต๊ะหน้าแคชเชียร์ — ลูกค้าสั่งผ่าน QR เองได้ (frontend/public/qr) ออเดอร์เข้าบิลโต๊ะ + ครัวทันที
export default function TableBoard({ activeBillId, canOpenNew, onOpenBill, createTableBill }: Props) {
  const { user } = useAuth()
  const canManage = MANAGER_ROLES.includes(user?.role || '')
  const [tables, setTables] = useState<PosTable[] | null>(null)
  const [settings, setSettings] = useState<QrSettings>({ mode: 'static' })
  const [managing, setManaging] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const prev = useRef<Map<string, PosTable> | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await api.get('/pos/tables')
      const next: PosTable[] = res.data.data.tables
      // แจ้งแคชเชียร์เมื่อโต๊ะเรียกเช็คบิล / สั่งเพิ่มผ่าน QR (เทียบกับรอบ poll ก่อน — รอบแรกไม่แจ้ง)
      if (prev.current) {
        for (const t of next) {
          const p = prev.current.get(t.id)
          if (!p || !t.bill_id || p.bill_id !== t.bill_id) continue
          if (!p.bill_requested_at && t.bill_requested_at) toast(`โต๊ะ ${t.name} เรียกเช็คบิล`, { icon: '🔔', duration: 6000 })
          else if (t.qr_item_count > p.qr_item_count) toast(`โต๊ะ ${t.name} สั่งเพิ่มผ่าน QR`, { icon: '📱', duration: 5000 })
        }
      }
      prev.current = new Map(next.map(t => [t.id, t]))
      setTables(next)
      setSettings(res.data.data.settings)
    } catch (e: any) {
      if (!prev.current) toast.error(e?.response?.data?.message || 'โหลดผังโต๊ะไม่สำเร็จ', { id: 'tables-load' })
    }
  }, [])

  useEffect(() => {
    load()
    const tick = () => { if (document.visibilityState === 'visible') load() }
    const id = setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)  // สลับกลับมาที่จอนี้ = ดึงทันที
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [load])

  const openTable = async (t: PosTable) => {
    if (t.bill_id) { onOpenBill(t.bill_id); return }
    if (!canOpenNew) { toast.error('กะค้างจากวันก่อน ปิดกะเดิมก่อนแล้วค่อยเปิดโต๊ะใหม่'); return }
    // QR เปลี่ยนทุกรอบ = ต้องพิมพ์ใบให้ลูกค้า → เปิดหน้าต่างพิมพ์ก่อน await (ไม่งั้นเบราว์เซอร์บล็อก pop-up)
    const w = settings.mode === 'rotate' ? window.open('', '_blank', 'width=360,height=640') : null
    setBusy(t.id)
    try {
      const bill = await createTableBill(t.id)
      if (!bill) { w?.close(); return }
      if (w) await printTableSlip(w, t.id)
      await load()
      onOpenBill(bill.id)
    } finally {
      setBusy(null)
    }
  }

  const reprint = (t: PosTable) => {
    const w = window.open('', '_blank', 'width=360,height=640')
    if (w) printTableSlip(w, t.id)
    else toast.error('กรุณาอนุญาต pop-up เพื่อพิมพ์ใบ QR')
  }

  if (tables === null) {
    return <div className="text-center py-12"><div className="w-8 h-8 border-2 border-phopy-indigo border-t-transparent rounded-full animate-spin mx-auto" /></div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-[var(--fg-3)] flex items-center gap-1.5">
          <Smartphone className="w-4 h-4" />
          ลูกค้าสแกน QR สั่งเองได้ · {settings.mode === 'rotate' ? 'QR เปลี่ยนทุกรอบ' : 'QR ถาวรบนโต๊ะ'}
        </p>
        {canManage && (
          <button onClick={() => setManaging(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)] hover:border-phopy-indigo/50">
            <Settings2 className="w-4 h-4" /> จัดการโต๊ะ / QR
          </button>
        )}
      </div>

      {tables.length === 0 ? (
        <div className="text-center py-12 bg-[var(--surface)] border border-[var(--border)] rounded-xl">
          <QrCode className="w-12 h-12 mx-auto text-[var(--fg-4)] mb-3" />
          <p className="text-[var(--fg-2)] font-medium">ยังไม่มีโต๊ะ</p>
          <p className="text-sm text-[var(--fg-4)] mt-1">
            {canManage ? 'กด "จัดการโต๊ะ / QR" เพื่อเพิ่มโต๊ะและพิมพ์ QR วางบนโต๊ะ' : 'ให้ผู้จัดการร้านเพิ่มโต๊ะก่อน'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {tables.map(t => {
            const isOpen = !!t.bill_id
            const calling = !!t.bill_requested_at
            const tone = calling
              ? 'border-warning bg-[var(--warning-soft)]'
              : isOpen ? 'border-phopy-indigo/50 bg-[var(--primary-soft)]' : 'border-[var(--border)] bg-[var(--surface)]'
            return (
              <div key={t.id} className={`relative rounded-xl border-2 transition-all ${tone} ${activeBillId && t.bill_id === activeBillId ? 'ring-2 ring-phopy-indigo' : ''}`}>
                <button onClick={() => openTable(t)} disabled={busy === t.id}
                  className="w-full p-4 text-left disabled:opacity-60" aria-label={`โต๊ะ ${t.name} ${isOpen ? 'เปิดอยู่' : 'ว่าง'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xl font-bold text-[var(--fg-1)] truncate">{t.name}</span>
                    {t.qr_item_count > 0 && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--surface)] text-[var(--primary)] border border-phopy-indigo/30">QR</span>
                    )}
                  </div>
                  {isOpen ? (
                    <>
                      <p className={`text-xs mt-1 font-semibold ${calling ? 'text-[var(--warning-strong)]' : 'text-[var(--primary)]'}`}>
                        {calling ? <span className="inline-flex items-center gap-1"><BellRing className="w-3.5 h-3.5" /> เรียกเช็คบิล</span> : `เปิดอยู่ · ${t.item_count} รายการ`}
                      </p>
                      <p className="text-lg font-bold text-success mt-1">฿{(t.total_amount || 0).toLocaleString()}</p>
                      <p className="text-xs text-[var(--fg-4)] flex items-center gap-1 mt-1">
                        <Clock className="w-3 h-3" />
                        {t.opened_at ? new Date(t.opened_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '-'}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-[var(--fg-4)] mt-1">{busy === t.id ? 'กำลังเปิด…' : 'ว่าง · กดเพื่อเปิดโต๊ะ'}</p>
                  )}
                </button>
                {(isOpen || settings.mode === 'static') && (
                  <button onClick={() => reprint(t)} title="พิมพ์ใบ QR ของโต๊ะนี้" aria-label={`พิมพ์ใบ QR โต๊ะ ${t.name}`}
                    className="absolute bottom-2 right-2 p-1.5 rounded-lg text-[var(--fg-3)] hover:text-[var(--primary)] hover:bg-[var(--surface)]">
                    <QrCode className="w-4 h-4" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {managing && (
        <TableManager tables={tables} settings={settings} onClose={() => setManaging(false)} onChanged={load} />
      )}
    </div>
  )
}
