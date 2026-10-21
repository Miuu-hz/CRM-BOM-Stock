import { useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Banknote, Calculator, Check, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { journalApi, type Account } from '../../services/accounting'
import { useModalClose } from '../../hooks/useModalClose'
import { PayrollHistoryNote, normName, periodLabel, useEmployeeNames, usePayrollHistory } from './PayrollHistoryNote'

// บันทึกจ่ายเงินเดือนเป็น JE (reference_type PAYROLL) — ไม่มีโมดูล HR แยก ยอดรายคนเก็บที่ payroll_lines + memo ของรายการ
// บัญชีฝั่งค่าใช้จ่าย/หนี้สินถูกกำหนดที่ backend: Dr 5301 · Dr 5314 สมทบนายจ้าง · Cr 2106 ประกันสังคม · Cr 2105 ภาษีหัก ณ ที่จ่าย

interface Row { name: string; gross: string; ssEmployee: string; wht: string; otherDeduction: string }

const emptyRow = (name = ''): Row => ({ name, gross: '', ssEmployee: '', wht: '', otherDeduction: '' })
const num = (s: string) => parseFloat(s) || 0
const round2 = (n: number) => Math.round(n * 100) / 100
const netOf = (r: Row) => round2(num(r.gross) - num(r.ssEmployee) - num(r.wht) - num(r.otherDeduction))
const fmt = (n: number) => (n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const pad = (n: number) => String(n).padStart(2, '0')
const BUSINESS_UNITS = [
  ['', '— ไม่ระบุ —'], ['RETAIL', 'หน้าร้าน (POS)'], ['WHOLESALE', 'ขายส่ง / ใบแจ้งหนี้'], ['ONLINE', 'ขายออนไลน์ (แพลตฟอร์ม)'], ['OTHER', 'อื่น ๆ'],
] as const

const inputCls = 'w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo'
const cellCls = 'w-full px-2 py-1.5 bg-[var(--surface)] border border-[var(--border)] rounded-md text-[var(--fg-1)] text-sm font-mono text-right focus:outline-none focus:border-phopy-indigo'

export function PayrollModal({ accounts, onClose, onSuccess }: {
  accounts: Account[]
  onClose: () => void
  onSuccess: () => void
}) {
  useModalClose(onClose)
  const today = new Date()
  const cashAccounts = accounts.filter(a => a.type === 'ASSET' && /^110[12]/.test(a.code ?? ''))
  const payChoices = cashAccounts.length ? cashAccounts : accounts.filter(a => a.type === 'ASSET')
  const otherChoices = accounts.filter(a => a.type === 'ASSET' || a.type === 'LIABILITY' || a.type === 'REVENUE')

  const [period, setPeriod] = useState(`${today.getFullYear()}-${pad(today.getMonth() + 1)}`)
  const [payDate, setPayDate] = useState(`${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`)
  const [lump, setLump] = useState(false)
  const [rows, setRows] = useState<Row[]>([emptyRow()])
  const [lumpRow, setLumpRow] = useState<Row>(emptyRow('พนักงานทั้งหมด'))
  const [ssEmployerSame, setSsEmployerSame] = useState(true)
  const [ssEmployerInput, setSsEmployerInput] = useState('')
  const [payAccountId, setPayAccountId] = useState(() => (payChoices.find(a => a.code?.startsWith('1102')) ?? payChoices[0])?.id ?? '')
  const [otherAccountId, setOtherAccountId] = useState(() => accounts.find(a => a.code === '2102')?.id ?? '')
  const [businessUnit, setBusinessUnit] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const activeRows = lump ? [lumpRow] : rows
  const employeeNames = useEmployeeNames()
  const historyOf = usePayrollHistory(activeRows.map(r => r.name), period)
  // เตือนเฉย ๆ ไม่บล็อก — บางร้านจ่ายเดือนละ 2 รอบ
  const paidThisPeriod = activeRows.map(r => historyOf(r.name)).filter(h => h && h.samePeriod.count > 0)
  const total = (k: keyof Omit<Row, 'name'>) => round2(activeRows.reduce((s, r) => s + num(r[k]), 0))
  const gross = total('gross')
  const ssEe = total('ssEmployee')
  const wht = total('wht')
  const other = total('otherDeduction')
  const ssEr = ssEmployerSame ? ssEe : round2(num(ssEmployerInput))
  const net = round2(gross - ssEe - wht - other)
  const totalDebit = round2(gross + ssEr)
  const totalCredit = round2(net + ssEe + ssEr + wht + other)

  const rowError = (r: Row, i: number): string | null => {
    const label = r.name.trim() || `แถวที่ ${i + 1}`
    if (!r.name.trim()) return `${label}: กรุณากรอกชื่อ`
    if ([r.gross, r.ssEmployee, r.wht, r.otherDeduction].some(v => num(v) < 0)) return `${label}: ห้ามติดลบ`
    if (num(r.gross) <= 0) return `${label}: กรุณากรอกเงินเดือน`
    if (netOf(r) < 0) return `${label}: ยอดหักเกินเงินเดือน`
    return null
  }
  const error = activeRows.map(rowError).find(Boolean)
    ?? (ssEr < 0 ? 'เงินสมทบนายจ้างห้ามติดลบ' : null)
    ?? (!payAccountId ? 'กรุณาเลือกบัญชีที่จ่ายเงิน' : null)
    ?? (other > 0 && !otherAccountId ? 'กรุณาเลือกบัญชีรับยอดหักอื่นๆ' : null)
    ?? (Math.abs(totalDebit - totalCredit) > 0.001 ? 'ยอดไม่สมดุล' : null)

  const updateRow = (i: number, patch: Partial<Row>) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r))

  const handleSubmit = async () => {
    if (error) { toast.error(error); return }
    setSaving(true)
    try {
      const res = await journalApi.createPayroll({
        period, payDate,
        employees: activeRows.map(r => ({
          name: normName(r.name), gross: num(r.gross), ssEmployee: num(r.ssEmployee), wht: num(r.wht), otherDeduction: num(r.otherDeduction),
        })),
        ssEmployer: ssEr,
        payAccountId,
        otherDeductionAccountId: other > 0 ? otherAccountId : undefined,
        businessUnit: businessUnit || undefined,
        notes: notes.trim() || undefined,
      })
      if (res.data.success) {
        toast.success(`บันทึกเงินเดือนแล้ว (${res.data.data.entryNumber}) — รอกดยืนยันรายการ`)
        for (const w of res.data.data.warnings ?? []) toast(w)
        onSuccess()
      }
    } catch (err: any) { toast.error(err.response?.data?.message || 'บันทึกเงินเดือนไม่สำเร็จ') }
    finally { setSaving(false) }
  }

  const payAccount = accounts.find(a => a.id === payAccountId)
  const otherAccount = accounts.find(a => a.id === otherAccountId)
  const ssoExpense = accounts.find(a => a.code === '5314')
  const preview: Array<{ side: 'Dr' | 'Cr'; label: string; amount: number }> = [
    { side: 'Dr' as const, label: '5301 เงินเดือนและค่าจ้าง', amount: gross },
    { side: 'Dr' as const, label: ssoExpense ? `5314 ${ssoExpense.name}` : '5301 เงินสมทบนายจ้าง (ไม่พบบัญชี 5314)', amount: ssEr },
    { side: 'Cr' as const, label: `${payAccount?.code ?? ''} ${payAccount?.name ?? 'บัญชีจ่าย'} (สุทธิ)`, amount: net },
    { side: 'Cr' as const, label: '2106 ประกันสังคม (ลูกจ้าง+นายจ้าง)', amount: round2(ssEe + ssEr) },
    { side: 'Cr' as const, label: '2105 ภาษีหัก ณ ที่จ่าย', amount: wht },
    { side: 'Cr' as const, label: `${otherAccount?.code ?? ''} ${otherAccount?.name ?? 'หักอื่นๆ'}`, amount: other },
  ].filter(l => l.amount > 0)

  const amountInputs = (r: Row, set: (p: Partial<Row>) => void) => (['gross', 'ssEmployee', 'wht', 'otherDeduction'] as const).map(k => (
    <input key={k} type="number" min={0} inputMode="decimal" placeholder="0" value={r[k]}
      onChange={e => set({ [k]: e.target.value })} onFocus={e => e.target.select()} className={cellCls}
      aria-label={{ gross: 'เงินเดือน', ssEmployee: 'ประกันสังคมลูกจ้าง', wht: 'ภาษีหัก ณ ที่จ่าย', otherDeduction: 'หักอื่นๆ' }[k]} />
  ))

  const gridCols = 'grid grid-cols-[minmax(120px,1.4fr)_repeat(4,minmax(84px,1fr))_96px_32px] gap-2 items-center'

  return (
    <div className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-4xl flex flex-col"
        style={{ maxHeight: 'calc(100vh - 2rem)' }}>
        <div className="p-5 border-b border-[var(--border)] flex items-center justify-between shrink-0">
          <h2 className="text-lg font-bold text-[var(--fg-1)] flex items-center gap-2">
            <Banknote className="w-5 h-5 text-[var(--primary)]" /> บันทึกเงินเดือน
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg)] text-[var(--fg-3)] hover:text-[var(--fg-1)]"><X className="w-5 h-5" /></button>
        </div>

        <div className="overflow-y-auto p-5 space-y-5">
          {/* งวด + วันที่จ่าย + บัญชีจ่าย */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <label className="block text-xs text-[var(--fg-3)]">งวดเดือน *
              <input type="month" value={period} onChange={e => setPeriod(e.target.value)} className={`${inputCls} mt-1.5`} />
            </label>
            <label className="block text-xs text-[var(--fg-3)]">วันที่จ่าย *
              <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className={`${inputCls} mt-1.5`} />
            </label>
            <label className="block text-xs text-[var(--fg-3)]">จ่ายจากบัญชี *
              <select value={payAccountId} onChange={e => setPayAccountId(e.target.value)} className={`${inputCls} mt-1.5`}>
                <option value="">— เลือกบัญชี —</option>
                {payChoices.map(a => <option key={a.id} value={a.id}>{a.code} – {a.name}</option>)}
              </select>
            </label>
            <label className="block text-xs text-[var(--fg-3)]">หน่วยธุรกิจ
              <select value={businessUnit} onChange={e => setBusinessUnit(e.target.value)} className={`${inputCls} mt-1.5`}>
                {BUSINESS_UNITS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </label>
          </div>

          {/* โหมดกรอก */}
          <div className="flex rounded-lg overflow-hidden border border-[var(--border)] text-sm w-fit">
            {([[false, 'กรอกรายคน'], [true, 'ยอดรวมก้อนเดียว']] as const).map(([v, label]) => (
              <button key={label} type="button" onClick={() => setLump(v)}
                className={`px-4 py-2 transition-colors ${lump === v ? 'bg-phopy-indigo text-white font-medium' : 'bg-[var(--bg)] text-[var(--fg-3)] hover:text-[var(--fg-1)]'}`}>
                {label}
              </button>
            ))}
          </div>

          {/* ตารางพนักงาน */}
          <div className="overflow-x-auto -mx-1 px-1">
            <div className="min-w-[680px] space-y-2">
              <div className={`${gridCols} text-xs text-[var(--fg-4)]`}>
                <span>{lump ? 'รายละเอียด' : 'ชื่อพนักงาน'}</span>
                <span className="text-right">เงินเดือน/ค่าจ้าง</span>
                <span className="text-right">ประกันสังคม</span>
                <span className="text-right">ภาษีหัก ณ ที่จ่าย</span>
                <span className="text-right">หักอื่นๆ</span>
                <span className="text-right">สุทธิ</span>
                <span />
              </div>
              {lump ? (
                <div className="space-y-1"><div className={gridCols}>
                  <input value={lumpRow.name} onChange={e => setLumpRow(r => ({ ...r, name: e.target.value }))} list="payroll-employee-names"
                    placeholder="เช่น พนักงาน 5 คน" className={`${cellCls} font-sans text-left`} />
                  {amountInputs(lumpRow, p => setLumpRow(r => ({ ...r, ...p })))}
                  <span className={`text-right font-mono text-sm ${netOf(lumpRow) < 0 ? 'text-danger' : 'text-[var(--fg-1)]'}`}>{fmt(netOf(lumpRow))}</span>
                  <span />
                </div>
                <PayrollHistoryNote history={historyOf(lumpRow.name)} /></div>
              ) : rows.map((r, i) => (
                <div key={i} className="space-y-1"><div className={gridCols}>
                  <input value={r.name} onChange={e => updateRow(i, { name: e.target.value })} list="payroll-employee-names"
                    placeholder={`พนักงาน ${i + 1}`} className={`${cellCls} font-sans text-left`} />
                  {amountInputs(r, p => updateRow(i, p))}
                  <span className={`text-right font-mono text-sm ${netOf(r) < 0 ? 'text-danger' : 'text-[var(--fg-1)]'}`}>{fmt(netOf(r))}</span>
                  <button type="button" onClick={() => setRows(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev)}
                    disabled={rows.length <= 1} aria-label="ลบแถว"
                    className="p-1.5 rounded-lg text-[var(--fg-4)] hover:text-danger hover:bg-[var(--danger-soft)] disabled:opacity-30">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <PayrollHistoryNote history={historyOf(r.name)} /></div>
              ))}
              <datalist id="payroll-employee-names">
                {employeeNames.map(n => <option key={n} value={n} />)}
              </datalist>
              <div className={`${gridCols} pt-2 border-t border-[var(--border)] text-sm font-mono font-semibold text-[var(--fg-1)]`}>
                <span className="font-sans text-xs text-[var(--fg-3)]">รวม</span>
                <span className="text-right">{fmt(gross)}</span>
                <span className="text-right">{fmt(ssEe)}</span>
                <span className="text-right">{fmt(wht)}</span>
                <span className="text-right">{fmt(other)}</span>
                <span className="text-right text-[var(--primary)]">{fmt(net)}</span>
                <span />
              </div>
            </div>
          </div>
          {!lump && (
            <button type="button" onClick={() => setRows(prev => [...prev, emptyRow()])}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-[var(--border)] rounded-lg text-xs text-[var(--fg-3)] hover:text-[var(--primary)] hover:border-phopy-indigo">
              <Plus className="w-3.5 h-3.5" /> เพิ่มพนักงาน
            </button>
          )}

          {/* สมทบนายจ้าง + บัญชีหักอื่นๆ */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="rounded-lg border border-[var(--border)] p-3 space-y-2">
              <p className="text-xs text-[var(--fg-3)]">เงินสมทบประกันสังคมส่วนนายจ้าง</p>
              <label className="flex items-center gap-2 text-sm text-[var(--fg-2)] cursor-pointer">
                <input type="checkbox" checked={ssEmployerSame} onChange={e => setSsEmployerSame(e.target.checked)} className="accent-[var(--primary)]" />
                เท่ากับส่วนลูกจ้าง (฿{fmt(ssEe)})
              </label>
              {!ssEmployerSame && (
                <input type="number" min={0} inputMode="decimal" placeholder="0" value={ssEmployerInput}
                  onChange={e => setSsEmployerInput(e.target.value)} className={`${inputCls} font-mono`} />
              )}
            </div>
            {other > 0 && (
              <label className="block rounded-lg border border-[var(--border)] p-3 text-xs text-[var(--fg-3)]">
                ยอดหักอื่นๆ ลงบัญชี * <span className="text-[var(--fg-4)]">(ค่าเริ่มต้น 2102 เจ้าหนี้อื่น · เงินเบิกล่วงหน้าใช้ 1105 ลูกหนี้อื่น)</span>
                <select value={otherAccountId} onChange={e => setOtherAccountId(e.target.value)} className={`${inputCls} mt-1.5`}>
                  <option value="">— เลือกบัญชี —</option>
                  {otherChoices.map(a => <option key={a.id} value={a.id}>{a.code} – {a.name}</option>)}
                </select>
              </label>
            )}
          </div>

          {paidThisPeriod.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-[var(--warning-soft)] px-3 py-2 text-xs text-warning">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                งวด {periodLabel(period)} มีรายการเงินเดือนของ {paidThisPeriod.map(h => `${h!.employee} (${h!.samePeriod.count} ครั้ง ฿${fmt(h!.samePeriod.net)})`).join(', ')} อยู่แล้ว
                — ถ้าเป็นการจ่ายรอบที่สองของเดือนบันทึกต่อได้ ถ้าไม่ใช่ตรวจก่อนว่าไม่ได้บันทึกซ้ำ
              </span>
            </div>
          )}

          {/* Preview รายการบัญชี */}
          <div className="rounded-lg border border-[var(--border)] overflow-hidden text-sm">
            <div className="px-3 py-1.5 border-b border-[var(--border)] bg-[var(--bg)] text-xs text-[var(--fg-4)] font-medium">รายการที่จะบันทึก (ร่าง)</div>
            <div className="px-3 py-2 space-y-1">
              {preview.length === 0 && <p className="text-xs text-[var(--fg-4)]">กรอกเงินเดือนเพื่อดูรายการ</p>}
              {preview.map(l => (
                <div key={l.label} className={`flex items-center gap-2 ${l.side === 'Cr' ? 'pl-5' : ''}`}>
                  <span className={`font-mono text-xs w-6 ${l.side === 'Dr' ? 'text-warning' : 'text-[var(--primary)]'}`}>{l.side}</span>
                  <span className="flex-1 truncate text-[var(--fg-2)] text-xs">{l.label}</span>
                  <span className="font-mono text-xs text-[var(--fg-1)]">{fmt(l.amount)}</span>
                </div>
              ))}
            </div>
            <div className={`flex items-center justify-between px-3 py-2 border-t text-xs ${error ? 'border-danger/30 bg-[var(--danger-soft)] text-danger' : 'border-success/30 bg-success/10 text-success'}`}>
              <span className="flex items-center gap-1.5">
                <Calculator className="w-3.5 h-3.5" />
                {error ?? <><Check className="w-3.5 h-3.5 inline" /> สมดุล — พร้อมบันทึก</>}
              </span>
              <span className="font-mono">Dr. {fmt(totalDebit)} / Cr. {fmt(totalCredit)}</span>
            </div>
          </div>

          <label className="block text-xs text-[var(--fg-3)]">หมายเหตุ (optional)
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={`${inputCls} mt-1.5 resize-none`} />
          </label>
        </div>

        <div className="p-5 border-t border-[var(--border)] flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-[var(--fg-3)] hover:text-[var(--fg-1)] text-sm">ยกเลิก</button>
          <button onClick={handleSubmit} disabled={saving || !!error}
            className="flex items-center gap-2 px-6 py-2.5 bg-phopy-indigo text-white font-semibold rounded-lg hover:bg-phopy-indigo/80 disabled:opacity-40 disabled:cursor-not-allowed text-sm">
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Banknote className="w-4 h-4" />}
            บันทึกเงินเดือน
          </button>
        </div>
      </motion.div>
    </div>
  )
}
