import { useEffect, useState, FormEvent } from 'react'

// หน้าสาธารณะ ไม่ล็อกอิน: ใช้ fetch ตรง ๆ (ไม่ใช้ api.ts เพราะมันเด้งไป /login เมื่อ error)
const token = () => window.location.pathname.split('/').filter(Boolean)[1] || ''

export default function ApplyPublic() {
  const [job, setJob] = useState<{ title: string; description: string; company_name: string } | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'notfound' | 'done'>('loading')
  const [form, setForm] = useState({ full_name: '', phone: '', email: '', note: '', consent: false, website: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch(`/api/public/jobs/${encodeURIComponent(token())}`)
      .then(async r => {
        if (!r.ok) throw new Error()
        setJob((await r.json()).data)
        setState('ready')
      })
      .catch(() => setState('notfound'))
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const r = await fetch(`/api/public/jobs/${encodeURIComponent(token())}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, email: form.email || undefined, note: form.note || undefined }),
      })
      if (r.ok) return setState('done')
      setError((await r.json().catch(() => null))?.message || 'ส่งใบสมัครไม่สำเร็จ')
    } catch {
      setError('ส่งใบสมัครไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const set = (k: string) => (e: any) => setForm(f => ({ ...f, [k]: e.target.value }))
  const input = 'w-full rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm'

  return (
    <div className="min-h-screen flex items-start justify-center p-4 bg-[var(--surface-2)]">
      <div className="phopy-card w-full max-w-lg p-6 space-y-4">
        {state === 'loading' && <p>กำลังโหลด...</p>}
        {state === 'notfound' && <p>ไม่พบตำแหน่งงานนี้ หรือปิดรับสมัครแล้ว</p>}
        {state === 'done' && <p>ขอบคุณที่สมัครงาน เราได้รับใบสมัครของคุณแล้ว</p>}
        {state === 'ready' && job && (
          <form onSubmit={submit} className="space-y-3">
            <p className="text-sm text-[var(--fg-3)]">{job.company_name}</p>
            <h1 className="text-lg font-bold">{job.title}</h1>
            {job.description && <p className="text-sm whitespace-pre-wrap">{job.description}</p>}
            <label className="block text-sm">ชื่อ-นามสกุล *
              <input className={input} value={form.full_name} onChange={set('full_name')} maxLength={120} required />
            </label>
            <label className="block text-sm">เบอร์โทร *
              <input className={input} value={form.phone} onChange={set('phone')} maxLength={20} required />
            </label>
            <label className="block text-sm">อีเมล
              <input className={input} type="email" value={form.email} onChange={set('email')} maxLength={200} />
            </label>
            <label className="block text-sm">ข้อความเพิ่มเติม
              <textarea className={input} rows={3} value={form.note} onChange={set('note')} maxLength={2000} />
            </label>
            {/* honeypot: ซ่อนจากคน บอทมักกรอก */}
            <div style={{ position: 'absolute', left: '-9999px' }} aria-hidden="true">
              <input tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={form.consent} onChange={e => setForm(f => ({ ...f, consent: e.target.checked }))} />
              <span>ข้าพเจ้ายินยอมให้เก็บข้อมูลใบสมัคร — ข้อมูลใบสมัครจะถูกลบภายใน 6 เดือนหากไม่ได้รับเข้าทำงาน</span>
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button type="submit" className="phopy-btn" disabled={busy || !form.consent}>ส่งใบสมัคร</button>
          </form>
        )}
      </div>
    </div>
  )
}
