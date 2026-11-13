import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, X, Pencil, Trash2, FileText } from 'lucide-react'
import toast from 'react-hot-toast'
import hrService, { Employee } from '../../services/hr.service'
import hrDocumentService, {
  EmployeeDocument, DocTemplate, DocType, TemplateKind, DOC_TYPE_LABEL, TEMPLATE_KIND_LABEL,
} from '../../services/hrDocument.service'
import { PaymentAttachments } from '../../components/common/PaymentAttachments'
import { PRINT_KEY } from './DocumentPrint'

type TabKey = 'expiring' | 'documents' | 'templates'
type ExpiringRow = { key: string; employee_name: string; kind: string; title: string; expires_on: string; days_left: number }

function pill(days: number) {
  const cls = days <= 7 ? 'bg-red-500/15 text-red-600' : days <= 30 ? 'bg-amber-500/15 text-amber-600' : 'bg-green-500/15 text-green-600'
  const label = days < 0 ? `หมดแล้ว ${Math.abs(days)} วัน` : `เหลือ ${days} วัน`
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${cls}`}>{label}</span>
}

const errMsg = (e: any, fallback: string) => e?.response?.data?.message || fallback
const empName = (e: Employee) => `${e.code} ${e.first_name} ${e.last_name || ''}`.trim()

export default function Documents() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<TabKey>('expiring')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [expiring, setExpiring] = useState<ExpiringRow[]>([])
  const [docs, setDocs] = useState<EmployeeDocument[]>([])
  const [templates, setTemplates] = useState<DocTemplate[]>([])

  // เอกสาร modal
  const [docForm, setDocForm] = useState<{ id?: string; employee_id: string; doc_type: DocType; title: string; issued_on: string; expires_on: string; notes: string } | null>(null)
  // แม่แบบ modal
  const [tplForm, setTplForm] = useState<{ id?: string; kind: TemplateKind; name: string; body: string } | null>(null)
  const [genTpl, setGenTpl] = useState<DocTemplate | null>(null)
  const [genEmp, setGenEmp] = useState('')

  const load = useCallback(async () => {
    try {
      const [emps, ed, tr, d, t] = await Promise.all([
        hrService.getEmployees({ status: 'ACTIVE' }),
        hrDocumentService.getExpiring(60),
        hrService.getExpiringTraining(60),
        hrDocumentService.getDocuments(),
        hrDocumentService.getTemplates(),
      ])
      setEmployees(emps || [])
      const rows: ExpiringRow[] = [
        ...(ed || []).map(r => ({ key: `d-${r.id}`, employee_name: r.employee_name, kind: DOC_TYPE_LABEL[r.doc_type] || r.doc_type, title: r.title, expires_on: r.expires_on, days_left: r.days_left })),
        ...(tr || []).filter(r => r.expires_on && r.days_left !== null && r.days_left !== undefined).map(r => ({ key: `t-${r.id}`, employee_name: r.employee_name, kind: 'อบรม', title: r.course_name, expires_on: r.expires_on as string, days_left: r.days_left as number })),
      ].sort((a, b) => a.days_left - b.days_left)
      setExpiring(rows)
      setDocs(d || [])
      setTemplates(t || [])
    } catch (e: any) {
      toast.error(errMsg(e, 'โหลดข้อมูลไม่สำเร็จ'))
    }
  }, [])

  useEffect(() => { load() }, [load])

  const saveDoc = async () => {
    if (!docForm) return
    if (!docForm.employee_id || !docForm.title.trim()) return toast.error('กรุณาเลือกพนักงานและระบุชื่อเอกสาร')
    try {
      const body = {
        doc_type: docForm.doc_type,
        title: docForm.title.trim(),
        issued_on: docForm.issued_on || null,
        notes: docForm.notes || null,
        // ทดลองงานที่เว้นวันหมดอายุตอนสร้าง ให้ระบบคำนวณเอง
        ...(docForm.expires_on || docForm.id ? { expires_on: docForm.expires_on || null } : {}),
      }
      if (docForm.id) await hrDocumentService.updateDocument(docForm.id, body)
      else await hrDocumentService.createDocument({ employee_id: docForm.employee_id, ...body })
      toast.success('บันทึกแล้ว')
      setDocForm(null)
      load()
    } catch (e: any) {
      toast.error(errMsg(e, 'บันทึกไม่สำเร็จ'))
    }
  }

  const removeDoc = async (d: EmployeeDocument) => {
    if (!window.confirm(`ลบเอกสาร "${d.title}" ?`)) return
    try {
      await hrDocumentService.deleteDocument(d.id)
      toast.success('ลบแล้ว')
      load()
    } catch (e: any) {
      toast.error(errMsg(e, 'ลบไม่สำเร็จ'))
    }
  }

  const saveTpl = async () => {
    if (!tplForm) return
    if (!tplForm.name.trim()) return toast.error('กรุณาระบุชื่อแม่แบบ')
    try {
      const body = { kind: tplForm.kind, name: tplForm.name.trim(), body: tplForm.body }
      if (tplForm.id) await hrDocumentService.updateTemplate(tplForm.id, body)
      else await hrDocumentService.createTemplate(body)
      toast.success('บันทึกแล้ว')
      setTplForm(null)
      load()
    } catch (e: any) {
      toast.error(errMsg(e, 'บันทึกไม่สำเร็จ'))
    }
  }

  const removeTpl = async (t: DocTemplate) => {
    if (!window.confirm(`ลบแม่แบบ "${t.name}" ?`)) return
    try {
      await hrDocumentService.deleteTemplate(t.id)
      load()
    } catch (e: any) {
      toast.error(errMsg(e, 'ลบไม่สำเร็จ'))
    }
  }

  const generate = async () => {
    if (!genTpl || !genEmp) return toast.error('กรุณาเลือกพนักงาน')
    try {
      const text = await hrDocumentService.renderTemplate(genTpl.id, genEmp)
      try {
        sessionStorage.setItem(PRINT_KEY, text)
        sessionStorage.setItem('hr_document_print_tpl', genTpl.id)
        sessionStorage.setItem('hr_document_print_emp', genEmp)
      } catch { /* ignore */ }
      setGenTpl(null)
      navigate('/hr/documents/print')
    } catch (e: any) {
      toast.error(errMsg(e, 'สร้างเอกสารไม่สำเร็จ'))
    }
  }

  const downloadPdf = async () => {
    if (!genTpl || !genEmp) return toast.error('กรุณาเลือกพนักงาน')
    try {
      await hrDocumentService.downloadTemplatePdf(genTpl.id, genEmp)
    } catch (e: any) {
      toast.error(errMsg(e, 'ดาวน์โหลด PDF ไม่สำเร็จ'))
    }
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'expiring', label: 'ใกล้ครบกำหนด' },
    { key: 'documents', label: 'เอกสารพนักงาน' },
    { key: 'templates', label: 'แม่แบบ' },
  ]
  const input = 'w-full border rounded px-2 py-1 bg-[var(--surface-1)]'

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {tabs.map(t => (
          <button key={t.key} className={`phopy-btn ${tab === t.key ? 'font-bold' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {tab === 'expiring' && (
        <div className="phopy-card p-4 overflow-x-auto">
          <table className="phopy-table w-full">
            <thead><tr><th>พนักงาน</th><th>ประเภท</th><th>รายการ</th><th>วันหมดอายุ</th><th>สถานะ</th></tr></thead>
            <tbody>
              {expiring.length === 0 && <tr><td colSpan={5}>ไม่มีรายการใกล้ครบกำหนด</td></tr>}
              {expiring.map(r => (
                <tr key={r.key}><td>{r.employee_name}</td><td>{r.kind}</td><td>{r.title}</td><td>{r.expires_on}</td><td>{pill(r.days_left)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'documents' && (
        <div className="phopy-card p-4 overflow-x-auto">
          <button className="phopy-btn mb-3" onClick={() => setDocForm({ employee_id: '', doc_type: 'CONTRACT', title: '', issued_on: '', expires_on: '', notes: '' })}>
            <Plus size={16} /> เพิ่มเอกสาร
          </button>
          <table className="phopy-table w-full">
            <thead><tr><th>พนักงาน</th><th>ประเภท</th><th>ชื่อเอกสาร</th><th>วันหมดอายุ</th><th>สถานะ</th><th /></tr></thead>
            <tbody>
              {docs.length === 0 && <tr><td colSpan={6}>ยังไม่มีเอกสาร</td></tr>}
              {docs.map(d => (
                <tr key={d.id}>
                  <td>{d.employee_name}</td><td>{DOC_TYPE_LABEL[d.doc_type]}</td><td>{d.title}</td>
                  <td>{d.expires_on || '-'}</td>
                  <td>{d.days_left !== null ? pill(d.days_left) : '-'}</td>
                  <td className="whitespace-nowrap">
                    <button aria-label="แก้ไข" onClick={() => setDocForm({ id: d.id, employee_id: d.employee_id, doc_type: d.doc_type, title: d.title, issued_on: d.issued_on || '', expires_on: d.expires_on || '', notes: d.notes || '' })}><Pencil size={16} /></button>
                    <button aria-label="ลบ" className="ml-2" onClick={() => removeDoc(d)}><Trash2 size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'templates' && (
        <div className="phopy-card p-4 overflow-x-auto">
          <button className="phopy-btn mb-3" onClick={() => setTplForm({ kind: 'CONTRACT', name: '', body: '' })}>
            <Plus size={16} /> เพิ่มแม่แบบ
          </button>
          <table className="phopy-table w-full">
            <thead><tr><th>ประเภท</th><th>ชื่อแม่แบบ</th><th /></tr></thead>
            <tbody>
              {templates.length === 0 && <tr><td colSpan={3}>ยังไม่มีแม่แบบ</td></tr>}
              {templates.map(t => (
                <tr key={t.id}>
                  <td>{TEMPLATE_KIND_LABEL[t.kind]}</td><td>{t.name}</td>
                  <td className="whitespace-nowrap">
                    <button className="phopy-btn" onClick={() => { setGenTpl(t); setGenEmp('') }}><FileText size={16} /> สร้างเอกสาร</button>
                    <button aria-label="แก้ไข" className="ml-2" onClick={() => setTplForm({ id: t.id, kind: t.kind, name: t.name, body: t.body })}><Pencil size={16} /></button>
                    <button aria-label="ลบ" className="ml-2" onClick={() => removeTpl(t)}><Trash2 size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs mt-3 text-[var(--fg-3)]">
            ตัวแปรที่ใช้ได้: {'{{company_name}} {{employee_name}} {{employee_code}} {{position}} {{org_unit}} {{start_date}} {{base_wage}} {{national_id}} {{today}}'}
          </p>
        </div>
      )}

      {docForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="phopy-card p-5 w-full max-w-lg space-y-3 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between"><h3 className="font-bold">{docForm.id ? 'แก้ไขเอกสาร' : 'เพิ่มเอกสาร'}</h3><button aria-label="ปิด" onClick={() => setDocForm(null)}><X size={18} /></button></div>
            <label className="block">พนักงาน
              <select className={input} disabled={!!docForm.id} value={docForm.employee_id} onChange={e => setDocForm({ ...docForm, employee_id: e.target.value })}>
                <option value="">เลือกพนักงาน</option>
                {employees.map(e => <option key={e.id} value={e.id}>{empName(e)}</option>)}
              </select>
            </label>
            <label className="block">ประเภท
              <select className={input} value={docForm.doc_type} onChange={e => setDocForm({ ...docForm, doc_type: e.target.value as DocType })}>
                {(Object.keys(DOC_TYPE_LABEL) as DocType[]).map(k => <option key={k} value={k}>{DOC_TYPE_LABEL[k]}</option>)}
              </select>
            </label>
            <label className="block">ชื่อเอกสาร
              <input className={input} maxLength={200} value={docForm.title} onChange={e => setDocForm({ ...docForm, title: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">วันที่ออก<input type="date" className={input} value={docForm.issued_on} onChange={e => setDocForm({ ...docForm, issued_on: e.target.value })} /></label>
              <label className="block">วันหมดอายุ<input type="date" className={input} value={docForm.expires_on} onChange={e => setDocForm({ ...docForm, expires_on: e.target.value })} /></label>
            </div>
            <label className="block">หมายเหตุ
              <textarea className={input} maxLength={5000} value={docForm.notes} onChange={e => setDocForm({ ...docForm, notes: e.target.value })} />
            </label>
            {docForm.id && <PaymentAttachments refType={'EMPLOYEE_DOCUMENT' as any} refId={docForm.id} dense />}
            <div className="flex justify-end gap-2">
              <button className="phopy-btn" onClick={() => setDocForm(null)}>ยกเลิก</button>
              <button className="phopy-btn" onClick={saveDoc}>บันทึก</button>
            </div>
          </div>
        </div>
      )}

      {tplForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="phopy-card p-5 w-full max-w-2xl space-y-3 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between"><h3 className="font-bold">{tplForm.id ? 'แก้ไขแม่แบบ' : 'เพิ่มแม่แบบ'}</h3><button aria-label="ปิด" onClick={() => setTplForm(null)}><X size={18} /></button></div>
            <label className="block">ประเภท
              <select className={input} value={tplForm.kind} onChange={e => setTplForm({ ...tplForm, kind: e.target.value as TemplateKind })}>
                {(Object.keys(TEMPLATE_KIND_LABEL) as TemplateKind[]).map(k => <option key={k} value={k}>{TEMPLATE_KIND_LABEL[k]}</option>)}
              </select>
            </label>
            <label className="block">ชื่อแม่แบบ
              <input className={input} maxLength={200} value={tplForm.name} onChange={e => setTplForm({ ...tplForm, name: e.target.value })} />
            </label>
            <label className="block">เนื้อหา
              <textarea className={input} rows={14} maxLength={20000} value={tplForm.body} onChange={e => setTplForm({ ...tplForm, body: e.target.value })} />
            </label>
            <div className="flex justify-end gap-2">
              <button className="phopy-btn" onClick={() => setTplForm(null)}>ยกเลิก</button>
              <button className="phopy-btn" onClick={saveTpl}>บันทึก</button>
            </div>
          </div>
        </div>
      )}

      {genTpl && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="phopy-card p-5 w-full max-w-md space-y-3">
            <h3 className="font-bold">สร้างเอกสารจาก "{genTpl.name}"</h3>
            <label className="block">พนักงาน
              <select className={input} value={genEmp} onChange={e => setGenEmp(e.target.value)}>
                <option value="">เลือกพนักงาน</option>
                {employees.map(e => <option key={e.id} value={e.id}>{empName(e)}</option>)}
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <button className="phopy-btn" onClick={() => setGenTpl(null)}>ยกเลิก</button>
              <button className="phopy-btn" onClick={generate}>สร้างเอกสาร</button>
              <button className="phopy-btn" onClick={downloadPdf}>ดาวน์โหลด PDF</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
