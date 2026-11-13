import { useState, useEffect, useCallback } from 'react'
import { Plus, X, Pencil, Trash2, UserX, Unlink, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import hrService, { Employee, PayrollRun } from '../../services/hr.service'
import lifecycle, {
  ChecklistTemplate,
  ChecklistItem,
  ChecklistKind,
  AutoAction,
  FinalPay,
} from '../../services/hrLifecycle.service'

const KIND_LABEL: Record<ChecklistKind, string> = { ONBOARD: 'เข้างาน', OFFBOARD: 'ออกงาน' }
const AUTO_LABEL: Record<string, string> = {
  DISABLE_USER: 'ปิดบัญชีผู้ใช้อัตโนมัติ',
  UNLINK_LINE: 'ยกเลิกผูก LINE อัตโนมัติ',
}
const errMsg = (e: any) => e?.response?.data?.message || 'เกิดข้อผิดพลาด'
const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const inputCls = 'w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]'

function AutoIcon({ action }: { action: AutoAction }) {
  if (!action) return null
  const Icon = action === 'DISABLE_USER' ? UserX : Unlink
  return <span title={AUTO_LABEL[action]} aria-label={AUTO_LABEL[action]}><Icon className="w-4 h-4 text-amber-500" /></span>
}

export default function Lifecycle() {
  const [tab, setTab] = useState<'templates' | 'employees'>('templates')

  // ----- แม่แบบ -----
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([])
  const [modal, setModal] = useState<{ editing: ChecklistTemplate | null } | null>(null)
  const [fKind, setFKind] = useState<ChecklistKind>('ONBOARD')
  const [fTitle, setFTitle] = useState('')
  const [fAuto, setFAuto] = useState('')

  const loadTemplates = useCallback(async () => {
    try { setTemplates(await lifecycle.getTemplates()) } catch (e) { toast.error(errMsg(e)) }
  }, [])

  const openModal = (t: ChecklistTemplate | null) => {
    setFKind(t?.kind ?? 'ONBOARD')
    setFTitle(t?.title ?? '')
    setFAuto(t?.auto_action ?? '')
    setModal({ editing: t })
  }

  const saveTemplate = async (e: React.FormEvent) => {
    e.preventDefault()
    const input = { kind: fKind, title: fTitle.trim(), auto_action: (fAuto || null) as AutoAction }
    try {
      if (modal?.editing) await lifecycle.updateTemplate(modal.editing.id, input)
      else await lifecycle.createTemplate(input)
      toast.success('บันทึกแล้ว')
      setModal(null)
      loadTemplates()
    } catch (err) { toast.error(errMsg(err)) }
  }

  const removeTemplate = async (t: ChecklistTemplate) => {
    if (!window.confirm(`ลบข้อ "${t.title}" ?`)) return
    try { await lifecycle.deleteTemplate(t.id); toast.success('ลบแล้ว'); loadTemplates() } catch (err) { toast.error(errMsg(err)) }
  }

  const seed = async () => {
    try { await lifecycle.seedDefaults(); toast.success('ใส่ชุดตั้งต้นแล้ว'); loadTemplates() } catch (err) { toast.error(errMsg(err)) }
  }

  // ----- พนักงาน -----
  const [employees, setEmployees] = useState<Employee[]>([])
  const [empId, setEmpId] = useState('')
  const [kind, setKind] = useState<ChecklistKind>('OFFBOARD')
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [finalPay, setFinalPay] = useState<FinalPay | null>(null)
  const [draftRuns, setDraftRuns] = useState<PayrollRun[]>([])
  const [runId, setRunId] = useState('')
  const [applyNote, setApplyNote] = useState('')

  const loadItems = useCallback(async () => {
    if (!empId) { setItems([]); setFinalPay(null); return }
    try {
      setItems(await lifecycle.getChecklist(empId, kind))
      setFinalPay(kind === 'OFFBOARD' ? await lifecycle.getFinalPay(empId) : null)
      setApplyNote('')
      if (kind === 'OFFBOARD') {
        const drafts = (await hrService.getPayrollRuns()).filter((r) => r.status === 'DRAFT')
        setDraftRuns(drafts)
        setRunId(drafts[0]?.id ?? '')
      }
    } catch (e) { toast.error(errMsg(e)) }
  }, [empId, kind])

  useEffect(() => { loadTemplates() }, [loadTemplates])
  useEffect(() => {
    if (tab === 'employees' && employees.length === 0) {
      hrService.getEmployees().then(setEmployees).catch((e) => toast.error(errMsg(e)))
    }
  }, [tab, employees.length])
  useEffect(() => { loadItems() }, [loadItems])

  const start = async () => {
    try { const n = await lifecycle.startChecklist(empId, kind); toast.success(`เริ่มเช็กลิสต์ ${n} ข้อ`); loadItems() } catch (e) { toast.error(errMsg(e)) }
  }

  const toggle = async (it: ChecklistItem) => {
    const done = !it.done_at
    if (done && it.auto_action && !window.confirm(`ข้อนี้จะ${AUTO_LABEL[it.auto_action]} ยืนยันหรือไม่?`)) return
    try {
      const r = await lifecycle.setItemDone(it.id, done)
      toast.success(r.message || 'บันทึกแล้ว')
      loadItems()
    } catch (e) { toast.error(errMsg(e)) }
  }

  const applyFinalPay = async () => {
    if (!finalPay || !runId) return
    const lines = [
      finalPay.severanceAmount > 0 && `ค่าชดเชย ${baht(finalPay.severanceAmount)} บาท`,
      finalPay.leavePayout > 0 && `ค่าพักร้อนคงเหลือ ${baht(finalPay.leavePayout)} บาท`,
    ].filter(Boolean).join('\n')
    if (!window.confirm(`ส่งเข้ารอบเงินเดือน:\n${lines}\nยืนยันหรือไม่?`)) return
    try {
      const r = await lifecycle.applyFinalPay(empId, runId)
      toast.success('เพิ่มในรอบเงินเดือนแล้ว')
      setApplyNote(r.note)
    } catch (e) { toast.error(errMsg(e)) }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-[var(--fg-1)]">เข้า-ออกงาน</h1>
      <div className="flex gap-2">
        {([['templates', 'แม่แบบ'], ['employees', 'พนักงาน']] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`phopy-btn ${tab === k ? 'phopy-btn-primary' : ''}`}>{label}</button>
        ))}
      </div>

      {tab === 'templates' && (
        <div className="phopy-card p-4 space-y-3">
          <div className="flex gap-2 justify-end">
            {templates.length === 0 && <button type="button" className="phopy-btn" onClick={seed}>ใส่ชุดตั้งต้น</button>}
            <button type="button" className="phopy-btn phopy-btn-primary" onClick={() => openModal(null)}><Plus className="w-4 h-4" /> เพิ่มข้อ</button>
          </div>
          <table className="phopy-table w-full">
            <thead><tr><th>ประเภท</th><th>ข้อ</th><th>อัตโนมัติ</th><th /></tr></thead>
            <tbody>
              {templates.length === 0 && <tr><td colSpan={4} className="text-center text-[var(--fg-3)]">ยังไม่มีแม่แบบ</td></tr>}
              {templates.map((t) => (
                <tr key={t.id}>
                  <td>{KIND_LABEL[t.kind]}</td>
                  <td>{t.title}</td>
                  <td><AutoIcon action={t.auto_action} /></td>
                  <td className="text-right">
                    <button type="button" aria-label="แก้ไข" onClick={() => openModal(t)} className="p-1"><Pencil className="w-4 h-4" /></button>
                    <button type="button" aria-label="ลบ" onClick={() => removeTemplate(t)} className="p-1"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'employees' && (
        <div className="phopy-card p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <select aria-label="เลือกพนักงาน" value={empId} onChange={(e) => setEmpId(e.target.value)} className={inputCls}>
              <option value="">เลือกพนักงาน</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.code} {e.first_name} {e.last_name || ''}</option>)}
            </select>
            <select aria-label="ประเภทเช็กลิสต์" value={kind} onChange={(e) => setKind(e.target.value as ChecklistKind)} className={inputCls}>
              <option value="ONBOARD">เข้างาน</option>
              <option value="OFFBOARD">ออกงาน</option>
            </select>
            <button type="button" className="phopy-btn phopy-btn-primary" disabled={!empId} onClick={start}>เริ่มเช็กลิสต์</button>
          </div>

          {empId && items.length === 0 && <p className="text-sm text-[var(--fg-3)]">ยังไม่มีเช็กลิสต์</p>}
          <ul className="space-y-2">
            {items.map((it) => (
              <li key={it.id} className="flex items-center gap-2">
                <input type="checkbox" id={`item-${it.id}`} checked={!!it.done_at} onChange={() => toggle(it)} />
                <label htmlFor={`item-${it.id}`} className={it.done_at ? 'line-through text-[var(--fg-3)]' : ''}>{it.title}</label>
                <AutoIcon action={it.auto_action} />
                {it.done_at && <Check className="w-4 h-4 text-green-500" />}
              </li>
            ))}
          </ul>

          {empId && kind === 'OFFBOARD' && finalPay && (
            <div className="border border-[var(--border)] rounded-lg p-4 space-y-1 text-sm" data-testid="final-pay">
              <h3 className="font-bold text-[var(--fg-1)]">เงินงวดสุดท้าย (ตัวเลขแนะนำ)</h3>
              <div>ค่าจ้างต่อวัน: {baht(finalPay.dailyWage)} บาท · อายุงาน {finalPay.tenureDays} วัน</div>
              <div>ค่าชดเชย ({finalPay.severanceDays} วัน): {baht(finalPay.severanceAmount)} บาท</div>
              <div>พักร้อนคงเหลือ {finalPay.unusedAnnualLeaveDays} วัน: {baht(finalPay.leavePayout)} บาท</div>
              <div>ยอดเบิก/ยืมคงค้าง: {baht(finalPay.outstandingAdvances)} บาท</div>
              <div>
                ทรัพย์สินที่ยังไม่คืน:{' '}
                {finalPay.unreturnedAssets.length === 0 ? 'ไม่มี' : finalPay.unreturnedAssets.map((a) => `${a.code} ${a.name}`).join(', ')}
              </div>
              <p className="text-xs text-[var(--fg-3)]">เป็นตัวเลขแนะนำเท่านั้น ไม่ได้ลงบัญชีหรือเข้าเงินเดือน</p>
              {draftRuns.length === 0 ? (
                <p className="text-xs text-amber-600">ยังไม่มีรอบเงินเดือนที่เป็นร่าง สร้างรอบก่อนที่หน้าเงินเดือน</p>
              ) : (
                <div className="flex gap-2 items-center pt-1">
                  <select aria-label="รอบเงินเดือน" className={inputCls} value={runId} onChange={(e) => setRunId(e.target.value)}>
                    {draftRuns.map((r) => <option key={r.id} value={r.id}>งวด {r.period}</option>)}
                  </select>
                  <button type="button" className="btn-primary whitespace-nowrap" onClick={applyFinalPay}>ส่งเข้ารอบเงินเดือน</button>
                </div>
              )}
              {applyNote && <p className="text-xs text-amber-600" data-testid="apply-note">{applyNote}</p>}
            </div>
          )}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="phopy-card w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="text-base font-bold text-[var(--fg-1)]">{modal.editing ? 'แก้ไขข้อ' : 'เพิ่มข้อ'}</h2>
              <button type="button" aria-label="ปิด" onClick={() => setModal(null)} className="p-1"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={saveTemplate} className="space-y-4">
              <div>
                <label htmlFor="tpl-kind" className="block text-xs mb-1">ประเภท</label>
                <select id="tpl-kind" value={fKind} onChange={(e) => setFKind(e.target.value as ChecklistKind)} className={inputCls}>
                  <option value="ONBOARD">เข้างาน</option>
                  <option value="OFFBOARD">ออกงาน</option>
                </select>
              </div>
              <div>
                <label htmlFor="tpl-title" className="block text-xs mb-1">ชื่อข้อ *</label>
                <input id="tpl-title" required maxLength={200} value={fTitle} onChange={(e) => setFTitle(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label htmlFor="tpl-auto" className="block text-xs mb-1">ทำอัตโนมัติเมื่อติ๊ก</label>
                <select id="tpl-auto" value={fAuto} onChange={(e) => setFAuto(e.target.value)} className={inputCls}>
                  <option value="">ไม่มี</option>
                  <option value="DISABLE_USER">ปิดบัญชีผู้ใช้</option>
                  <option value="UNLINK_LINE">ยกเลิกผูก LINE</option>
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" className="phopy-btn" onClick={() => setModal(null)}>ยกเลิก</button>
                <button type="submit" className="phopy-btn phopy-btn-primary">บันทึก</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
