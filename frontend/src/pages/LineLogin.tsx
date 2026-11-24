import { useEffect, useState } from 'react'

/**
 * ปลายทางของลิงก์ใช้ครั้งเดียวจาก LINE (/line-login?t=...)
 * แลกเป็น token ที่ใช้ได้เฉพาะหน้า "ของฉัน" แล้วเปิดหน้านั้น — ไม่ใช้ axios client กลางเพราะมัน refresh/เด้ง login เมื่อ 401
 */
const TARGETS: Record<string, string> = {
  trips: '/hr/me/trips',
  trips_stop: '/hr/me/trips?action=stop',
  trips_history: '/hr/me/trips?tab=history',
}

export default function LineLogin() {
  const [error, setError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get('t') || ''
    const to = params.get('to') || ''
    const destination = Object.prototype.hasOwnProperty.call(TARGETS, to) ? TARGETS[to] : '/hr/me'
    fetch('/api/auth/line-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t }) })
      .then(async r => ({ ok: r.ok, body: await r.json().catch(() => null) }))
      .then(({ ok, body }) => {
        if (!ok || !body?.success) throw new Error(body?.message || 'ลิงก์ใช้ไม่ได้')
        const { user, token } = body.data
        // ล้าง session เดิมของเบราว์เซอร์นี้ทั้งหมดก่อน — ห้ามเหลือ refresh token ของบัญชีอื่นไว้ต่ออายุ token จำกัดสิทธิ์
        for (const k of ['crm_refresh_token', 'crm_original_tenant']) localStorage.removeItem(k)
        localStorage.setItem('crm_user', JSON.stringify(user))
        localStorage.setItem('crm_token', token)
        localStorage.setItem('crm_tenant', JSON.stringify({ code: user.tenant_id, name: user.tenant_id }))
        localStorage.setItem('crm_last_activity', String(Date.now()))
        window.location.replace(destination)
      })
      .catch(e => setError(e.message || 'ลิงก์ใช้ไม่ได้'))
  }, [])

  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-6 text-center">
      {error
        ? <div><p className="text-[var(--fg)] font-semibold">{error}</p><p className="text-sm text-[var(--fg-3)] mt-2">กลับไปที่ LINE แล้วพิมพ์ "ของฉัน" เพื่อขอลิงก์ใหม่</p></div>
        : <p className="text-[var(--fg-3)]">กำลังเข้าสู่ระบบ…</p>}
    </div>
  )
}
