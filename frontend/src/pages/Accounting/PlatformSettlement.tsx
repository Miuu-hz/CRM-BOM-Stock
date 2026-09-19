import { useEffect, useState } from 'react'
import { Upload, Settings2, AlertTriangle, CheckCircle2, X, Plus, Trash2 } from 'lucide-react'
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

interface PreviewColumn {
  header: string
  targetField: string | null
  feeType: string | null
  matchedTotal: number | null
}

interface ComputedFee {
  feeType: string
  amount: number
}

interface PreviewResult {
  rowCount: number
  headers: string[]
  columns: PreviewColumn[]
  unknownHeaders: string[]
  computed: {
    platform?: string
    periodStart?: string
    periodEnd?: string
    grossSales?: number
    vatAmount?: number
    cogsAmount?: number
    payoutAmount?: number
    fees?: ComputedFee[]
  }
}

const PLATFORMS = ['SHOPEE', 'LAZADA', 'TIKTOK'] as const

// ==================== Helpers ====================

const fmt = (n: number) => `฿${(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// ==================== Main Component ====================

export default function PlatformSettlement() {
  const [platform, setPlatform] = useState<(typeof PLATFORMS)[number]>('SHOPEE')
  const [file, setFile] = useState<File | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  // ฟอร์มยืนยัน — เติมจาก preview.computed ให้อัตโนมัติ แต่แก้มือได้เสมอ เพราะไฟล์จริงของ
  // แต่ละแพลตฟอร์มยังไม่เคยเห็น คอลัมน์ที่แม็ปไม่ได้ต้องให้คนกรอกเองไปก่อน
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [grossSales, setGrossSales] = useState('')
  const [vatAmount, setVatAmount] = useState('')
  const [cogsAmount, setCogsAmount] = useState('')
  const [payoutAmount, setPayoutAmount] = useState('')
  const [fees, setFees] = useState<ComputedFee[]>([])

  const [feeMappings, setFeeMappings] = useState<FeeMappingRow[]>([])
  const feeTypeOptions = feeMappings.filter((m) => m.targetField === 'FEE')

  const loadFeeMappings = async () => {
    try {
      const res = await api.get('/platform-settlement/fee-mappings')
      if (res.data.success) setFeeMappings(res.data.data)
    } catch {
      toast.error('โหลดการผูกค่าธรรมเนียมไม่สำเร็จ')
    }
  }

  useEffect(() => { loadFeeMappings() }, [])

  const resetForm = () => {
    setPreview(null)
    setPeriodStart('')
    setPeriodEnd('')
    setGrossSales('')
    setVatAmount('')
    setCogsAmount('')
    setPayoutAmount('')
    setFees([])
  }

  const handlePreview = async () => {
    if (!file) { toast.error('เลือกไฟล์ก่อน'); return }
    try {
      setPreviewing(true)
      const formData = new FormData()
      formData.append('file', file)
      formData.append('platform', platform)
      const res = await api.post('/platform-settlement/preview', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      if (res.data.success) {
        const data: PreviewResult = res.data.data
        setPreview(data)
        setPeriodStart(data.computed.periodStart || '')
        setPeriodEnd(data.computed.periodEnd || '')
        setGrossSales(data.computed.grossSales != null ? String(data.computed.grossSales) : '')
        setVatAmount(data.computed.vatAmount != null ? String(data.computed.vatAmount) : '')
        setCogsAmount(data.computed.cogsAmount != null ? String(data.computed.cogsAmount) : '')
        setPayoutAmount(data.computed.payoutAmount != null ? String(data.computed.payoutAmount) : '')
        setFees(data.computed.fees && data.computed.fees.length > 0 ? data.computed.fees : [])
        if (data.unknownHeaders.length > 0) {
          toast(`มีคอลัมน์ที่ยังไม่รู้จัก ${data.unknownHeaders.length} คอลัมน์ — ไปตั้งค่าผูกคอลัมน์ก่อน หรือกรอกยอดเองด้านล่าง`, { icon: '⚠️' })
        }
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'อ่านไฟล์ไม่สำเร็จ')
    } finally {
      setPreviewing(false)
    }
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
        sourceFilename: file?.name,
      })
      if (res.data.success) {
        toast.success('ยืนยันรอบโอนแล้ว ลงบัญชีเรียบร้อย')
        setFile(null)
        resetForm()
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'ลงบัญชีไม่สำเร็จ')
    } finally {
      setConfirming(false)
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

        <div className="flex items-center gap-3">
          <label className="flex-1 flex items-center gap-2 px-4 py-3 rounded-lg border border-dashed border-[var(--border)] text-[var(--fg-3)] cursor-pointer hover:border-[var(--fg-4)]">
            <Upload className="w-4 h-4 shrink-0" />
            <span className="text-sm truncate">{file ? file.name : 'เลือกไฟล์รายงานยอดขาย/ค่าธรรมเนียม (CSV)'}</span>
            <input type="file" accept=".csv" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
          <button
            onClick={handlePreview}
            disabled={!file || previewing}
            className="px-4 py-3 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-sm font-medium disabled:opacity-50"
          >
            {previewing ? 'กำลังอ่าน...' : 'ดูตัวอย่าง'}
          </button>
        </div>

        {preview && preview.unknownHeaders.length > 0 && (
          <div className="flex items-start gap-3 p-3 bg-warning/10 border border-warning/30 rounded-lg text-sm">
            <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-[var(--fg-1)]">คอลัมน์ที่ยังไม่รู้จัก {preview.unknownHeaders.length} คอลัมน์</p>
              <p className="text-[var(--fg-3)] mt-1">{preview.unknownHeaders.join(', ')}</p>
              <p className="text-[var(--fg-4)] mt-1">ไปผูกคอลัมน์เหล่านี้ที่ปุ่มตั้งค่า (มุมขวาบน) หรือกรอกยอดด้านล่างเองไปก่อน</p>
            </div>
          </div>
        )}
      </div>

      {/* สรุปยอด — เห็นแต่เงิน ไม่เห็นรหัสบัญชี */}
      {preview && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="ช่วงวันที่เริ่ม" value={periodStart} onChange={setPeriodStart} type="date" />
            <Field label="ช่วงวันที่สิ้นสุด" value={periodEnd} onChange={setPeriodEnd} type="date" />
          </div>

          <Field label={`ยอดขายเต็ม (${preview.rowCount} แถว)`} value={grossSales} onChange={setGrossSales} type="number" bold />
          <Field label="ภาษีขาย (VAT) — เว้นว่างให้คำนวณอัตโนมัติ 7%" value={vatAmount} onChange={setVatAmount} type="number" />
          <Field label="ต้นทุนสินค้าที่ขายไปรอบนี้" value={cogsAmount} onChange={setCogsAmount} type="number" />

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
            <Row label={`ยอดขายเต็ม (${preview.rowCount} ออเดอร์)`} value={fmt(gross)} bold />
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
            disabled={confirming}
            className="w-full py-3 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] font-semibold disabled:opacity-50"
          >
            {confirming ? 'กำลังลงบัญชี...' : 'ยืนยันรอบโอนนี้'}
          </button>
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
