import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Mail, Lock, ArrowRight, ArrowLeft, Loader2, X, KeyRound,
  Building2, User, Phone, CheckCircle2, UserPlus,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'
import { stripNonAscii, EMAIL_REGEX } from '../utils/email'

type Mode = 'login' | 'signup' | 'submitted'

interface SignupForm {
  email: string
  business: string
  name: string
  phone: string
  password: string
  website: string // honeypot — must stay empty
}
const EMPTY_SIGNUP: SignupForm = { email: '', business: '', name: '', phone: '', password: '', website: '' }

// One field per step (Google-style slide-through)
const STEPS: { key: keyof SignupForm; label: string; hint?: string; type: string; placeholder: string; icon: any }[] = [
  { key: 'email',    label: 'อีเมลของคุณ',   hint: 'ใช้เป็นชื่อผู้ใช้สำหรับเข้าระบบ', type: 'email',    placeholder: 'you@example.com',  icon: Mail },
  { key: 'business', label: 'ชื่อธุรกิจ/ร้าน', hint: 'ชื่อกิจการที่จะแสดงในระบบ',      type: 'text',     placeholder: 'เช่น ร้านกาแฟ ABC', icon: Building2 },
  { key: 'name',     label: 'ชื่อของคุณ',     hint: 'ผู้ดูแลหลักของบัญชีนี้',          type: 'text',     placeholder: 'ชื่อ-นามสกุล',      icon: User },
  { key: 'phone',    label: 'เบอร์ติดต่อ',    hint: 'ทีมงานจะติดต่อกลับเพื่อยืนยันการเปิดใช้', type: 'tel', placeholder: '08x-xxx-xxxx',    icon: Phone },
  { key: 'password', label: 'ตั้งรหัสผ่าน',   hint: 'อย่างน้อย 8 ตัวอักษร',            type: 'password', placeholder: '••••••••',        icon: Lock },
]

function Login() {
  const { t } = useTranslation()
  const { login } = useAuth()

  const [mode, setMode] = useState<Mode>('login')

  // ── Login state ──
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // ── Signup wizard state ──
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)
  const [su, setSu] = useState<SignupForm>(EMPTY_SIGNUP)
  const [suErr, setSuErr] = useState('')
  const [suBusy, setSuBusy] = useState(false)

  // ── Reset-password modal state ──
  const [showReset, setShowReset] = useState(false)
  const [rToken, setRToken] = useState('')
  const [rNewPw, setRNewPw] = useState('')
  const [rConfirm, setRConfirm] = useState('')
  const [rBusy, setRBusy] = useState(false)
  const [rMsg, setRMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const result = await login(email, password)
    if (!result.success) setError(result.message || t('login.error'))
    setLoading(false)
  }

  // ── Signup wizard logic ──
  const openSignup = () => { setMode('signup'); setStep(0); setDir(1); setSu(EMPTY_SIGNUP); setSuErr('') }
  const backToLogin = () => { setMode('login'); setError('') }

  const stepValid = (): string | null => {
    const cur = STEPS[step]
    const val = su[cur.key].trim()
    if (cur.key === 'email') {
      if (!EMAIL_REGEX.test(val)) return 'รูปแบบอีเมลไม่ถูกต้อง (ใช้ตัวอักษรภาษาอังกฤษเท่านั้น)'
    } else if (cur.key === 'password') {
      if (val.length < 8) return 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'
    } else if (!val) {
      return 'กรุณากรอกข้อมูล'
    }
    return null
  }

  const goNext = () => {
    if (suBusy) return
    const err = stepValid()
    if (err) { setSuErr(err); return }
    setSuErr('')
    if (step < STEPS.length - 1) { setDir(1); setStep(s => Math.min(s + 1, STEPS.length - 1)) }
    else submitSignup()
  }
  const goPrev = () => { setSuErr(''); if (step > 0) { setDir(-1); setStep(s => Math.max(0, s - 1)) } }

  const submitSignup = async () => {
    setSuBusy(true); setSuErr('')
    try {
      const res = await api.post('/auth/register', {
        businessName: su.business.trim(),
        adminName: su.name.trim(),
        email: su.email.trim(),
        password: su.password,
        phone: su.phone.trim(),
        website: su.website, // honeypot
      })
      if (res.data?.success) setMode('submitted')
      else setSuErr(res.data?.message || 'สมัครไม่สำเร็จ')
    } catch (err: any) {
      setSuErr(err?.response?.data?.message || 'สมัครไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setSuBusy(false)
    }
  }

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setRMsg(null)
    if (rNewPw.length < 8) return setRMsg({ ok: false, text: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร' })
    if (rNewPw !== rConfirm) return setRMsg({ ok: false, text: 'รหัสผ่านใหม่และการยืนยันไม่ตรงกัน' })
    setRBusy(true)
    try {
      const res = await api.post('/auth/reset-password', { token: rToken.trim(), newPassword: rNewPw })
      setRMsg({ ok: true, text: res.data?.message || 'ตั้งรหัสผ่านใหม่สำเร็จ' })
      setRToken(''); setRNewPw(''); setRConfirm('')
    } catch (err: any) {
      setRMsg({ ok: false, text: err?.response?.data?.message || 'ตั้งรหัสผ่านใหม่ไม่สำเร็จ' })
    } finally {
      setRBusy(false)
    }
  }

  const slide = {
    enter: (d: number) => ({ x: d > 0 ? 48 : -48, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (d: number) => ({ x: d > 0 ? -48 : 48, opacity: 0 }),
  }

  // Defensive: never let an out-of-range step crash the render.
  const cur = STEPS[Math.min(Math.max(step, 0), STEPS.length - 1)] ?? STEPS[0]

  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-6 relative overflow-hidden">
      {/* Subtle Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-phopy-indigo/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-phopy-mango/5 rounded-full blur-[120px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="phopy-card p-8 w-full max-w-md relative z-10"
      >
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-phopy-indigo to-phopy-indigo-700 rounded-2xl flex items-center justify-center shadow-2 mb-4">
            <span className="text-white font-extrabold text-2xl">P</span>
          </div>
          <h1 className="text-3xl font-bold text-[var(--fg-1)]">{t('app.name')}</h1>
          <p className="text-[var(--fg-3)] mt-2">
            {mode === 'login' ? t('app.tagline') : mode === 'signup' ? 'สมัครใช้งานฟรี เริ่มต้นใน 1 นาที' : ''}
          </p>
        </div>

        {/* ==================== LOGIN ==================== */}
        {mode === 'login' && (
          <>
            {error && (
              <div className="mb-6 p-3 bg-[var(--danger-soft)] border border-danger/30 rounded-lg text-danger text-sm">
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-[var(--fg-2)] mb-2">{t('login.emailLabel')}</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--fg-3)]" />
                  <input type="text" value={email} onChange={(e) => setEmail(stripNonAscii(e.target.value))}
                    placeholder={t('login.emailPlaceholder')} className="phopy-input pl-10 w-full" required />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--fg-2)] mb-2">{t('login.passwordLabel')}</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--fg-3)]" />
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••" className="phopy-input pl-10 w-full" required />
                </div>
              </div>
              <div className="flex items-center justify-end">
                <button type="button" onClick={() => { setShowReset(true); setRMsg(null) }}
                  className="text-sm text-[var(--primary)] hover:text-phopy-indigo-600 transition-colors">
                  {t('login.forgotPassword')}
                </button>
              </div>
              <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} type="submit" disabled={loading}
                className="w-full phopy-btn-primary flex items-center justify-center gap-2 group disabled:opacity-50">
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                  <><span>{t('login.submit')}</span><ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" /></>
                )}
              </motion.button>
            </form>

            <div className="mt-6 pt-6 border-t border-[var(--border)] text-center">
              <p className="text-sm text-[var(--fg-3)]">
                ยังไม่มีบัญชี?{' '}
                <button type="button" onClick={openSignup}
                  className="text-[var(--primary)] font-semibold hover:underline inline-flex items-center gap-1">
                  <UserPlus className="w-4 h-4" /> สมัครใช้ฟรี
                </button>
              </p>
            </div>
          </>
        )}

        {/* ==================== SIGNUP WIZARD ==================== */}
        {mode === 'signup' && (
          <div>
            {/* progress dots */}
            <div className="flex items-center justify-center gap-2 mb-6">
              {STEPS.map((_, i) => (
                <div key={i} className={'h-1.5 rounded-full transition-all duration-300 ' +
                  (i === step ? 'w-6 bg-[var(--primary)]' : i < step ? 'w-2 bg-[var(--primary)]/50' : 'w-2 bg-[var(--surface-2)]')} />
              ))}
            </div>

            {suErr && (
              <div className="mb-4 p-3 bg-[var(--danger-soft)] border border-danger/30 rounded-lg text-danger text-sm">{suErr}</div>
            )}

            {/* honeypot — hidden from real users */}
            <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
              value={su.website} onChange={e => setSu(s => ({ ...s, website: e.target.value }))}
              style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }} />

            <div className="relative overflow-hidden">
              <AnimatePresence mode="wait" custom={dir} initial={false}>
                <motion.div key={step} custom={dir} variants={slide} initial="enter" animate="center" exit="exit"
                  transition={{ duration: 0.25, ease: 'easeInOut' }}>
                  <label className="block text-lg font-semibold text-[var(--fg-1)] mb-1">{cur.label}</label>
                  {cur.hint && <p className="text-sm text-[var(--fg-3)] mb-3">{cur.hint}</p>}
                  <div className="relative">
                    <cur.icon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--fg-3)]" />
                    <input
                      autoFocus
                      type={cur.type}
                      value={su[cur.key]}
                      onChange={e => setSu(s => ({ ...s, [cur.key]: cur.key === 'email' ? stripNonAscii(e.target.value) : e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); goNext() } }}
                      placeholder={cur.placeholder}
                      className="phopy-input pl-10 w-full text-lg"
                      autoComplete={cur.key === 'password' ? 'new-password' : cur.key === 'email' ? 'email' : 'off'}
                    />
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="flex items-center gap-3 mt-6">
              <button type="button" onClick={step === 0 ? backToLogin : goPrev}
                className="flex items-center justify-center gap-1 px-4 py-3 rounded-lg border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-all text-sm">
                <ArrowLeft className="w-4 h-4" /> {step === 0 ? 'ยกเลิก' : 'ย้อนกลับ'}
              </button>
              <motion.button whileTap={{ scale: 0.98 }} type="button" onClick={goNext} disabled={suBusy}
                className="flex-1 phopy-btn-primary flex items-center justify-center gap-2 disabled:opacity-50">
                {suBusy ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                  <>
                    <span>{step === STEPS.length - 1 ? 'สมัครใช้ฟรี' : 'ถัดไป'}</span>
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </motion.button>
            </div>

            <p className="text-xs text-[var(--fg-4)] text-center mt-4">
              ขั้นที่ {step + 1} / {STEPS.length} · มีบัญชีอยู่แล้ว?{' '}
              <button type="button" onClick={backToLogin} className="text-[var(--primary)] hover:underline">เข้าสู่ระบบ</button>
            </p>
          </div>
        )}

        {/* ==================== SUBMITTED ==================== */}
        {mode === 'submitted' && (
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
            <div className="w-16 h-16 rounded-full bg-[var(--success-soft)] flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-8 h-8 text-[var(--success)]" />
            </div>
            <h2 className="text-xl font-bold text-[var(--fg-1)] mb-2">ส่งคำขอสมัครแล้ว 🎉</h2>
            <p className="text-sm text-[var(--fg-3)] leading-relaxed mb-2">
              ทีมงานจะตรวจสอบและติดต่อกลับที่เบอร์ <b className="text-[var(--fg-1)]">{su.phone || '-'}</b> เพื่อยืนยันการเปิดใช้งาน
            </p>
            <p className="text-xs text-[var(--fg-4)] mb-6">
              เมื่อได้รับการอนุมัติ คุณจะเข้าสู่ระบบได้ทันทีด้วยอีเมล <b>{su.email}</b> และรหัสผ่านที่ตั้งไว้
            </p>
            <button type="button" onClick={backToLogin} className="w-full phopy-btn-primary flex items-center justify-center gap-2">
              <ArrowLeft className="w-4 h-4" /> กลับไปหน้าเข้าสู่ระบบ
            </button>
          </motion.div>
        )}

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-xs text-[var(--fg-4)]">© 2024 Phopy ERP. All rights reserved.</p>
        </div>
      </motion.div>

      {/* Forgot / Reset Password Modal */}
      <AnimatePresence>
        {showReset && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/50" onClick={() => setShowReset(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="phopy-card p-6 w-full max-w-md relative" onClick={(e) => e.stopPropagation()}>
              <button type="button" onClick={() => setShowReset(false)}
                className="absolute top-4 right-4 text-[var(--fg-3)] hover:text-[var(--fg-1)]"><X className="w-5 h-5" /></button>
              <h3 className="text-lg font-semibold text-[var(--fg-1)] mb-2 flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-[var(--primary)]" /> ตั้งรหัสผ่านใหม่
              </h3>
              <p className="text-sm text-[var(--fg-3)] mb-4">
                ขอ<b>รหัสรีเซ็ต (reset code)</b> จากผู้ดูแลระบบ (Admin) ของบริษัทคุณ แล้วนำมากรอกด้านล่างเพื่อตั้งรหัสผ่านใหม่ด้วยตัวเอง (รหัสมีอายุ 30 นาที)
              </p>
              <form onSubmit={submitReset} className="space-y-4">
                {rMsg && (
                  <div className={`p-3 rounded-lg text-sm ${rMsg.ok ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--danger-soft)] text-danger'}`}>{rMsg.text}</div>
                )}
                <div>
                  <label className="block text-sm font-medium text-[var(--fg-2)] mb-1">รหัสรีเซ็ต</label>
                  <input value={rToken} onChange={e => setRToken(e.target.value)} className="phopy-input w-full" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--fg-2)] mb-1">รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)</label>
                  <input type="password" value={rNewPw} onChange={e => setRNewPw(e.target.value)} className="phopy-input w-full" autoComplete="new-password" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--fg-2)] mb-1">ยืนยันรหัสผ่านใหม่</label>
                  <input type="password" value={rConfirm} onChange={e => setRConfirm(e.target.value)} className="phopy-input w-full" autoComplete="new-password" required />
                </div>
                <button type="submit" disabled={rBusy} className="w-full phopy-btn-primary flex items-center justify-center gap-2 disabled:opacity-50">
                  {rBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                  {rBusy ? 'กำลังบันทึก...' : 'ตั้งรหัสผ่านใหม่'}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default Login
