import { useEffect, useState } from 'react'
import { Settings2, CheckCircle2, X, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'

// ==================== Types (ตรงกับ backend /api/platform-settlement) ====================

interface FeeMappingRow {
  id: string
  targetField: string // GROSS_SALES | VAT | COGS | PAYOUT | PERIOD_START | PERIOD_END | FEE
  feeType: string | null
  accountCode: string | null
  label: string
  columnAliases: string[]
  isActive: boolean
}

interface ComputedFee {
  feeType: string
  amount: number
}

/** แถวประวัติจาก GET /platform-settlement — คืนคอลัมน์ดิบของตาราง platform_settlements */
interface SettlementRow {
  id: string
  platform: string
  period_start: string
  period_end: string
  gross_sales: number
  fees_json: string | null
  payout_amount: number | null
  status: 'PENDING_PAYOUT' | 'COMPLETED'
}

const PLATFORMS = ['SHOPEE', 'LAZADA', 'TIKTOK'] as const

// ==================== Helpers ====================

const fmt = (n: number) => `฿${(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** "ควรได้รับ" ของรอบที่ลงไว้แล้ว = ยอดเต็ม − ค่าธรรมเนียมที่หักตอนขั้น 2 (คิดแบบเดียวกับฝั่ง service) */
const receivableOf = (s: SettlementRow): number => {
  let fees: Array<{ amount: number }> = []
  try { fees = JSON.parse(s.fees_json || '[]') } catch { fees = [] }
  return Number(s.gross_sales) - fees.reduce((t, f) => t + (Number(f.amount) || 0), 0)
}

// ==================== Main Component ====================

export default function PlatformSettlement() {
  const [platform, setPlatform] = useState<(typeof PLATFORMS)[number]>('SHOPEE')
  const [confirming, setConfirming] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  // ฟอร์มยืนยัน — กรอกเองทุกช่อง (เลิกอ่านจากไฟล์ CSV แล้ว)
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [grossSales, setGrossSales] = useState('')
  const [vatAmount, setVatAmount] = useState('')
  const [cogsAmount, setCogsAmount] = useState('')
  const [payoutAmount, setPayoutAmount] = useState('')
  const [fees, setFees] = useState<ComputedFee[]>([])

  const [feeMappings, setFeeMappings] = useState<FeeMappingRow[]>([])
  const feeTypeOptions = feeMappings.filter((m) => m.targetField === 'FEE')

  const [settlements, setSettlements] = useState<SettlementRow[]>([])
  const [payoutEdit, setPayoutEdit] = useState<Record<string, string>>({})
  const [payoutSaving, setPayoutSaving] = useState<string | null>(null)

  const loadFeeMappings = async () => {
    try {
      const res = await api.get('/platform-settlement/fee-mappings')
      if (res.data.success) setFeeMappings(res.data.data)
    } catch {
      toast.error('โหลดการผูกค่าธรรมเนียมไม่สำเร็จ')
    }
  }

  const loadSettlements = async () => {
    try {
      const res = await api.get('/platform-settlement')
      if (res.data.success) setSettlements(res.data.data)
    } catch {
      // ประวัติโหลดไม่ได้ ไม่ควรขวางการลงรอบใหม่ — เงียบไว้
    }
  }

  useEffect(() => { loadFeeMappings(); loadSettlements() }, [])

  const resetForm = () => {
    setPeriodStart('')
    setPeriodEnd('')
    setGrossSales('')
    setVatAmount('')
    setCogsAmount('')
    setPayoutAmount('')
    setFees([])
  }

  const totalFees = fees.reduce((s, f) => s + (Number(f.amount) || 0), 0)
  const gross = Number(grossSales) || 0
  const receivable = gross - totalFees
  const payout = payoutAmount === '' ? null : Number(payoutAmount)
  const diff = payout != null ? receivable - payout : 0

  const handleConfirm = async () => {
    if (!periodStart || !periodEnd || !(gross > 0)) {
      toast.error('กรอกช่วงวันที่และยอดขายเต็มให้ครบก่อน')
      return
    }
    try {
      setConfirming(true)
      const res = await api.post('/platform-settlement/confirm', {
        platform,
        periodStart,
        periodEnd,
        grossSales: gross,
        vatAmount: vatAmount === '' ? undefined : Number(vatAmount),
        cogsAmount: cogsAmount === '' ? undefined : Number(cogsAmount),
        fees: fees.filter((f) => f.feeType && f.amount),
        payoutAmount: payout ?? undefined,
      })
      if (res.data.success) {
        toast.success('ยืนยันรอบโอนแล้ว ลงบัญชีเรียบร้อย')
        resetForm()
        loadSettlements()
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'ลงบัญชีไม่สำเร็จ')
    } finally {
      setConfirming(false)
    }
  }

  // ขั้น 3 ที่มาทีหลัง — แพลตฟอร์มส่งรายงานก่อน แล้วโอนเงินอีกเป็นสัปดาห์
  // ไม่มีปุ่มนี้ บัญชีพัก 1181 จะค้างตลอดกาล ปิดรอบไม่ได้
  const handlePayout = async (id: string) => {
    const amount = Number(payoutEdit[id])
    if (!(amount >= 0)) {
      toast.error('กรอกยอดที่โอนเข้าจริงก่อน')
      return
    }
    try {
      setPayoutSaving(id)
      const res = await api.post(`/platform-settlement/${id}/payout`, { payoutAmount: amount })
      if (res.data.success) {
        toast.success('บันทึกเงินโอนแล้ว ปิดยอดลูกหนี้การค้า-แพลตฟอร์มเรียบร้อย')
        setPayoutEdit({ ...payoutEdit, [id]: '' })
        loadSettlements()
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'บันทึกเงินโอนไม่สำเร็จ')
    } finally {
      setPayoutSaving(null)
    }
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-1)]">บัญชีขายผ่านแพลตฟอร์ม</h1>
          <p className="text-[var(--fg-3)] mt-1 text-sm">Shopee / Lazada / TikTok Shop — ลงยอดเต็มเสมอ ไม่ลงยอดสุทธิ</p>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="p-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--fg-3)] hover:text-[var(--fg-1)]"
          title="ตั้งค่าผูกค่าธรรมเนียมกับบัญชี"
        >
          <Settings2 className="w-5 h-5" />
        </button>
      </div>

      {/* เลือกแพลตฟอร์ม + อัพโหลดไฟล์ */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map((p) => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                platform === p
                  ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--fg-1)]'
                  : 'border-[var(--border)] text-[var(--fg-3)] hover:text-[var(--fg-1)]'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <p className="text-xs text-[var(--fg-4)]">
          กรอกสรุปยอดของรอบนี้เอง — ข้อมูลรายเดือนจากแพลตฟอร์ม (Shopee ฯลฯ) ตอนนี้เข้าทาง AI ผู้ช่วย (MCP) แล้ว
        </p>
      </div>

      {/* สรุปยอด — เห็นแต่เงิน ไม่เห็นรหัสบัญชี */}
      {(
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="ช่วงวันที่เริ่ม" value={periodStart} onChange={setPeriodStart} type="date" />
            <Field label="ช่วงวันที่สิ้นสุด" value={periodEnd} onChange={setPeriodEnd} type="date" />
          </div>

          <Field label="ยอดขายเต็ม ก่อนหักอะไรทั้งสิ้น" value={grossSales} onChange={setGrossSales} type="number" bold />
          <Field label="ภาษีขาย (VAT) — เว้นว่างให้คำนวณอัตโนมัติ 7%" value={vatAmount} onChange={setVatAmount} type="number" />
          <Field label="ต้นทุนสินค้าที่ขายไปรอบนี้ — เว้นว่าง = ยังไม่รับรู้ต้นทุนรอบนี้" value={cogsAmount} onChange={setCogsAmount} type="number" />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-[var(--fg-1)]">ค่าธรรมเนียมที่แพลตฟอร์มหัก</p>
              <button
                onClick={() => setFees([...fees, { feeType: feeTypeOptions[0]?.feeType || '', amount: 0 }])}
                className="text-xs flex items-center gap-1 text-[var(--primary)] hover:underline"
              >
                <Plus className="w-3.5 h-3.5" /> เพิ่มรายการ
              </button>
            </div>
            {fees.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={f.feeType}
                  onChange={(e) => setFees(fees.map((x, xi) => (xi === i ? { ...x, feeType: e.target.value } : x)))}
                  className="flex-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--fg-1)] text-sm"
                >
                  {feeTypeOptions.map((opt) => (
                    <option key={opt.feeType!} value={opt.feeType!}>{opt.label}</option>
                  ))}
                </select>
                <input
                  type="number"
                  value={f.amount}
                  onChange={(e) => setFees(fees.map((x, xi) => (xi === i ? { ...x, amount: Number(e.target.value) } : x)))}
                  className="w-32 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--fg-1)] text-sm text-right"
                />
                <button onClick={() => setFees(fees.filter((_, xi) => xi !== i))} className="p-2 text-[var(--fg-4)] hover:text-danger">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          {/* สรุปเป็นภาษาเงิน */}
          <div className="border-t border-[var(--border)] pt-4 space-y-1.5 text-sm">
            <Row label="ยอดขายเต็ม" value={fmt(gross)} bold />
            {fees.filter((f) => f.feeType && f.amount).map((f, i) => (
              <Row key={i} label={`  ${feeTypeOptions.find((o) => o.feeType === f.feeType)?.label || f.feeType}`} value={`−${fmt(f.amount)}`} muted />
            ))}
            <Row label="ควรได้รับ" value={fmt(receivable)} bold border />
          </div>

          <Field label="แพลตฟอร์มโอนเข้าจริง (เว้นว่างถ้ายังไม่ถึงรอบโอน)" value={payoutAmount} onChange={setPayoutAmount} type="number" />

          {payout != null && (
            <Row
              label="ส่วนต่าง"
              value={fmt(Math.abs(diff))}
              bold
              className={Math.abs(diff) < 0.01 ? 'text-success' : 'text-danger'}
            />
          )}

          <button
            onClick={handleConfirm}
            disabled={confirming || !periodStart || !periodEnd || !(gross > 0)}
            className="w-full py-3 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] font-semibold disabled:opacity-50"
          >
            {confirming ? 'กำลังลงบัญชี...' : 'ยืนยันรอบโอนนี้'}
          </button>
        </div>
      )}

      {/* ประวัติรอบที่ลงบัญชีแล้ว + ปุ่มบันทึกเงินโอนของรอบที่ยังรอเงิน */}
      {settlements.length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-[var(--fg-1)]">ประวัติรอบที่ลงบัญชีแล้ว</h2>
          {settlements.map((s) => {
            const receivable = receivableOf(s)
            return (
              <div key={s.id} className="border border-[var(--border)] rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <p className="text-sm font-medium text-[var(--fg-1)]">{s.platform} · {s.period_start} ถึง {s.period_end}</p>
                    <p className="text-xs text-[var(--fg-3)]">ยอดเต็ม {fmt(Number(s.gross_sales))} · ควรได้รับ {fmt(receivable)}</p>
                  </div>
                  {s.status === 'COMPLETED' ? (
                    <span className="flex items-center gap-1 text-xs text-success">
                      <CheckCircle2 className="w-4 h-4" /> รับเงินแล้ว {fmt(Number(s.payout_amount))}
                    </span>
                  ) : (
                    <span className="text-xs text-warning">รอเงินโอน</span>
                  )}
                </div>

                {s.status === 'PENDING_PAYOUT' && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={payoutEdit[s.id] ?? ''}
                      onChange={(e) => setPayoutEdit({ ...payoutEdit, [s.id]: e.target.value })}
                      placeholder="ยอดที่โอนเข้าจริง"
                      className="flex-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--fg-1)] text-sm text-right"
                    />
                    <button
                      onClick={() => handlePayout(s.id)}
                      disabled={payoutSaving === s.id}
                      className="px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-sm font-medium disabled:opacity-50 shrink-0"
                    >
                      {payoutSaving === s.id ? 'กำลังบันทึก...' : 'บันทึกเงินโอน'}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Settings modal: ผูกค่าธรรมเนียม ↔ บัญชี */}
      {showSettings && (
        <FeeMappingSettings
          mappings={feeMappings}
          onClose={() => setShowSettings(false)}
          onSaved={() => { loadFeeMappings(); setShowSettings(false) }}
        />
      )}
    </div>
  )
}

// ==================== Small pieces ====================

function Field({ label, value, onChange, type, bold }: { label: string; value: string; onChange: (v: string) => void; type: string; bold?: boolean }) {
  return (
    <div>
      <label className="block text-xs text-[var(--fg-3)] mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--fg-1)] ${bold ? 'font-semibold text-lg' : 'text-sm'}`}
      />
    </div>
  )
}

function Row({ label, value, bold, muted, border, className }: { label: string; value: string; bold?: boolean; muted?: boolean; border?: boolean; className?: string }) {
  return (
    <div className={`flex items-center justify-between ${border ? 'pt-2 border-t border-[var(--border)]' : ''}`}>
      <span className={`${muted ? 'text-[var(--fg-3)]' : 'text-[var(--fg-1)]'} ${bold ? 'font-semibold' : ''}`}>{label}</span>
      <span className={`${bold ? 'font-semibold' : ''} ${className || 'text-[var(--fg-1)]'}`}>{value}</span>
    </div>
  )
}

function FeeMappingSettings({ mappings, onClose, onSaved }: { mappings: FeeMappingRow[]; onClose: () => void; onSaved: () => void }) {
  const feeRows = mappings.filter((m) => m.targetField === 'FEE')
  const [edits, setEdits] = useState<Record<string, { accountCode: string; aliasesText: string }>>(
    Object.fromEntries(feeRows.map((r) => [r.id, { accountCode: r.accountCode || '', aliasesText: r.columnAliases.join(', ') }]))
  )
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    try {
      setSaving(true)
      const updates = feeRows.map((r) => ({
        id: r.id,
        accountCode: edits[r.id].accountCode,
        columnAliases: edits[r.id].aliasesText.split(',').map((s) => s.trim()).filter(Boolean),
      }))
      const res = await api.put('/platform-settlement/fee-mappings', { updates })
      if (res.data.success) {
        toast.success('บันทึกการผูกค่าธรรมเนียมแล้ว')
        onSaved()
      }
    } catch {
      toast.error('บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="font-semibold text-[var(--fg-1)]">ผูกค่าธรรมเนียม ↔ บัญชี</h2>
          <button onClick={onClose} className="text-[var(--fg-3)] hover:text-[var(--fg-1)]"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-[var(--fg-4)]">
            ค่าธรรมเนียมแต่ละประเภทลงบัญชีที่ไหนตั้งไว้ล่วงหน้าแล้ว แก้ได้เฉพาะรหัสบัญชีปลายทาง กับชื่อคอลัมน์
            ในไฟล์จริงของแพลตฟอร์ม (ยังไม่มีไฟล์จริง — เจอชื่อคอลัมน์จริงเมื่อไหร่ค่อยเพิ่มทีละชื่อ คั่นด้วยจุลภาค)
          </p>
          {feeRows.map((r) => (
            <div key={r.id} className="border border-[var(--border)] rounded-lg p-3 space-y-2">
              <p className="text-sm font-medium text-[var(--fg-1)]">{r.label}</p>
              <div className="flex items-center gap-2">
                <label className="text-xs text-[var(--fg-3)] w-24 shrink-0">รหัสบัญชี</label>
                <input
                  value={edits[r.id]?.accountCode || ''}
                  onChange={(e) => setEdits({ ...edits, [r.id]: { ...edits[r.id], accountCode: e.target.value } })}
                  className="w-28 px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--fg-1)] text-sm font-mono"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-[var(--fg-3)] w-24 shrink-0">ชื่อคอลัมน์</label>
                <input
                  value={edits[r.id]?.aliasesText || ''}
                  onChange={(e) => setEdits({ ...edits, [r.id]: { ...edits[r.id], aliasesText: e.target.value } })}
                  placeholder="เช่น Commission Fee, ค่าคอมมิชชั่น"
                  className="flex-1 px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--fg-1)] text-sm"
                />
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 py-4 border-t border-[var(--border)] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--fg-3)] text-sm">ยกเลิก</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-sm font-medium disabled:opacity-50">
            {saving ? 'กำลังบันทึก...' : <span className="flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> บันทึก</span>}
          </button>
        </div>
      </div>
    </div>
  )
}
