import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import { Copy, Plus, QrCode, X } from 'lucide-react'
import hrRecruitService, { Applicant, ApplicantStage, JobPosting } from '../../services/hrRecruit.service'

const COLUMNS: { stage: ApplicantStage; label: string; next?: ApplicantStage }[] = [
  { stage: 'APPLIED', label: 'สมัคร', next: 'INTERVIEW' },
  { stage: 'INTERVIEW', label: 'สัมภาษณ์', next: 'TRIAL' },
  { stage: 'TRIAL', label: 'ทดลองงาน' },
  { stage: 'HIRED', label: 'รับแล้ว' },
]

const errMsg = (e: any, fallback: string) => e?.response?.data?.message || fallback

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="phopy-card w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
          <h2 className="text-base font-bold">{title}</h2>
          <button type="button" aria-label="ปิด" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

const inputCls = 'w-full rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm'

export default function Recruit() {
  const [postings, setPostings] = useState<JobPosting[]>([])
  const [applicants, setApplicants] = useState<Applicant[]>([])
  const [postingFilter, setPostingFilter] = useState('')
  const [newPosting, setNewPosting] = useState<{ title: string; description: string } | null>(null)
  const [qr, setQr] = useState<{ title: string; url: string; qr: string } | null>(null)
  const [interview, setInterview] = useState<{ a: Applicant; at: string; note: string } | null>(null)
  const [hire, setHire] = useState<{ a: Applicant; code: string; type: 'MONTHLY' | 'DAILY' | 'HOURLY'; wage: string; start: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([hrRecruitService.getPostings(), hrRecruitService.getApplicants(postingFilter ? { posting_id: postingFilter } : undefined)])
      setPostings(p)
      setApplicants(a)
    } catch (e) {
      toast.error(errMsg(e, 'โหลดข้อมูลไม่สำเร็จ'))
    }
  }, [postingFilter])
  useEffect(() => { load() }, [load])

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      toast.success(ok)
      await load()
      return true
    } catch (e) {
      toast.error(errMsg(e, 'ทำรายการไม่สำเร็จ'))
      return false
    }
  }

  const copyLink = async (p: JobPosting) => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/apply/${p.public_token}`)
      toast.success('คัดลอกลิงก์แล้ว')
    } catch { toast.error('คัดลอกไม่สำเร็จ') }
  }

  const showQr = async (p: JobPosting) => {
    try {
      const d = await hrRecruitService.getPostingQr(p.id)
      setQr({ title: p.title, ...d })
    } catch (e) { toast.error(errMsg(e, 'สร้าง QR ไม่สำเร็จ')) }
  }

  return (
    <div className="space-y-6">
      <div className="phopy-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-bold">ตำแหน่งที่เปิดรับ</h1>
          <button className="phopy-btn" onClick={() => setNewPosting({ title: '', description: '' })}><Plus className="w-4 h-4 inline" /> เพิ่มตำแหน่ง</button>
        </div>
        <table className="phopy-table w-full text-sm">
          <thead><tr><th>ตำแหน่ง</th><th>ผู้สมัคร</th><th>สถานะ</th><th></th></tr></thead>
          <tbody>
            {postings.map(p => (
              <tr key={p.id}>
                <td>{p.title}</td>
                <td>{p.applicant_count}</td>
                <td>{p.is_open ? 'เปิดรับ' : 'ปิดรับ'}</td>
                <td className="space-x-2 text-right">
                  <button onClick={() => copyLink(p)}><Copy className="w-4 h-4 inline" /> คัดลอกลิงก์</button>
                  <button onClick={() => showQr(p)}><QrCode className="w-4 h-4 inline" /> QR ใบสมัคร</button>
                  <button onClick={() => run(() => hrRecruitService.updatePosting(p.id, { is_open: !p.is_open }), 'บันทึกแล้ว')}>{p.is_open ? 'ปิดรับ' : 'เปิดรับ'}</button>
                </td>
              </tr>
            ))}
            {postings.length === 0 && <tr><td colSpan={4}>ยังไม่มีตำแหน่ง</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="space-y-3">
        <select className={inputCls + ' max-w-xs'} aria-label="กรองตำแหน่ง" value={postingFilter} onChange={e => setPostingFilter(e.target.value)}>
          <option value="">ทุกตำแหน่ง</option>
          {postings.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {COLUMNS.map(col => (
            <div key={col.stage} className="phopy-card p-3 space-y-2">
              <h3 className="font-bold text-sm">{col.label} ({applicants.filter(a => a.stage === col.stage).length})</h3>
              {applicants.filter(a => a.stage === col.stage).map(a => (
                <div key={a.id} className="border border-[var(--border)] rounded-lg p-2 text-sm space-y-1">
                  <div className="font-medium">{a.full_name}</div>
                  <div className="text-xs text-[var(--fg-3)]">{a.phone} · {a.posting_title}</div>
                  {a.interview_at && <div className="text-xs">นัด {a.interview_at.replace('T', ' ')}</div>}
                  {a.interview_note && <div className="text-xs whitespace-pre-wrap">{a.interview_note}</div>}
                  {a.stage !== 'HIRED' && (
                    <div className="flex flex-wrap gap-2 text-xs">
                      {col.next && <button onClick={() => run(() => hrRecruitService.updateApplicant(a.id, { stage: col.next }), 'ย้ายขั้นแล้ว')}>ไปขั้นถัดไป</button>}
                      <button onClick={() => setInterview({ a, at: a.interview_at || '', note: a.interview_note || '' })}>นัดสัมภาษณ์/บันทึก</button>
                      <button onClick={() => setHire({ a, code: '', type: 'MONTHLY', wage: '', start: new Date().toISOString().slice(0, 10) })}>รับเข้าทำงาน</button>
                      <button onClick={() => { if (window.confirm(`ไม่รับ ${a.full_name}?`)) run(() => hrRecruitService.updateApplicant(a.id, { stage: 'REJECTED' }), 'บันทึกแล้ว') }}>ไม่รับ</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {newPosting && (
        <Modal title="เพิ่มตำแหน่ง" onClose={() => setNewPosting(null)}>
          <label className="block text-sm">ชื่อตำแหน่ง
            <input className={inputCls} value={newPosting.title} maxLength={200} onChange={e => setNewPosting({ ...newPosting, title: e.target.value })} />
          </label>
          <label className="block text-sm">รายละเอียด
            <textarea className={inputCls} rows={4} value={newPosting.description} maxLength={5000} onChange={e => setNewPosting({ ...newPosting, description: e.target.value })} />
          </label>
          <button className="phopy-btn" disabled={!newPosting.title.trim()} onClick={async () => {
            if (await run(() => hrRecruitService.createPosting({ title: newPosting.title, description: newPosting.description }), 'เพิ่มตำแหน่งแล้ว')) setNewPosting(null)
          }}>บันทึก</button>
        </Modal>
      )}

      {qr && (
        <Modal title="QR ใบสมัคร" onClose={() => setQr(null)}>
          {/* พิมพ์เฉพาะการ์ด QR: ซ่อนทุกอย่างยกเว้น #qr-print */}
          <style>{`@media print { body * { visibility: hidden } #qr-print, #qr-print * { visibility: visible } #qr-print { position: fixed; inset: 0; margin: auto; text-align: center } }`}</style>
          <div id="qr-print" className="text-center space-y-2">
            <div className="text-lg font-bold">{qr.title}</div>
            <img src={qr.qr} alt="QR ใบสมัคร" className="mx-auto w-64 h-64" />
            <div className="text-xs break-all select-all">{qr.url}</div>
          </div>
          <button className="phopy-btn" onClick={() => window.print()}>พิมพ์</button>
        </Modal>
      )}

      {interview && (
        <Modal title={`นัดสัมภาษณ์ ${interview.a.full_name}`} onClose={() => setInterview(null)}>
          <label className="block text-sm">วัน-เวลานัด
            <input type="datetime-local" className={inputCls} value={interview.at} onChange={e => setInterview({ ...interview, at: e.target.value })} />
          </label>
          <label className="block text-sm">บันทึกผล
            <textarea className={inputCls} rows={3} value={interview.note} maxLength={5000} onChange={e => setInterview({ ...interview, note: e.target.value })} />
          </label>
          <button className="phopy-btn" onClick={async () => {
            if (await run(() => hrRecruitService.updateApplicant(interview.a.id, { interview_at: interview.at || null, interview_note: interview.note || null }), 'บันทึกแล้ว')) setInterview(null)
          }}>บันทึก</button>
        </Modal>
      )}

      {hire && (
        <Modal title={`รับเข้าทำงาน ${hire.a.full_name}`} onClose={() => setHire(null)}>
          <label className="block text-sm">รหัสพนักงาน
            <input className={inputCls} value={hire.code} maxLength={50} onChange={e => setHire({ ...hire, code: e.target.value })} />
          </label>
          <label className="block text-sm">ประเภทการจ้าง
            <select className={inputCls} value={hire.type} onChange={e => setHire({ ...hire, type: e.target.value as any })}>
              <option value="MONTHLY">รายเดือน</option><option value="DAILY">รายวัน</option><option value="HOURLY">รายชั่วโมง</option>
            </select>
          </label>
          <label className="block text-sm">ค่าจ้าง
            <input type="number" min={0} className={inputCls} value={hire.wage} onChange={e => setHire({ ...hire, wage: e.target.value })} />
          </label>
          <label className="block text-sm">วันที่เริ่มงาน
            <input type="date" className={inputCls} value={hire.start} onChange={e => setHire({ ...hire, start: e.target.value })} />
          </label>
          <button className="phopy-btn" disabled={!hire.code.trim()} onClick={async () => {
            if (await run(() => hrRecruitService.hire(hire.a.id, { code: hire.code, employment_type: hire.type, base_wage: Number(hire.wage) || 0, start_date: hire.start }), 'รับเข้าทำงานแล้ว')) setHire(null)
          }}>ยืนยันรับเข้าทำงาน</button>
        </Modal>
      )}
    </div>
  )
}
