import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mail, Lock, ArrowRight, Loader2, X, KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'

function Login() {
  const { t } = useTranslation()
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Forgot / reset-password modal state
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

    if (!result.success) {
      setError(result.message || t('login.error'))
    }

    setLoading(false)
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

  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-6 relative overflow-hidden">
      {/* Subtle Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-phopy-indigo/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-phopy-mango/5 rounded-full blur-[120px]" />
      </div>

      {/* Login Card */}
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
          <h1 className="text-3xl font-bold text-[var(--fg-1)]">
            {t('app.name')}
          </h1>
          <p className="text-[var(--fg-3)] mt-2">{t('app.tagline')}</p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-3 bg-[var(--danger-soft)] border border-danger/30 rounded-lg text-danger text-sm">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Email Input */}
          <div>
            <label className="block text-sm font-medium text-[var(--fg-2)] mb-2">
              {t('login.emailLabel')}
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--fg-3)]" />
              <input
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('login.emailPlaceholder')}
                className="phopy-input pl-10 w-full"
                required
              />
            </div>
          </div>

          {/* Password Input */}
          <div>
            <label className="block text-sm font-medium text-[var(--fg-2)] mb-2">
              {t('login.passwordLabel')}
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--fg-3)]" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="phopy-input pl-10 w-full"
                required
              />
            </div>
          </div>

          {/* Remember Me & Forgot Password */}
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-[var(--border)] bg-[var(--surface-2)] text-[var(--primary)] focus:ring-phopy-indigo focus:ring-2"
              />
              <span className="text-sm text-[var(--fg-3)]">{t('login.rememberMe')}</span>
            </label>
            <button
              type="button"
              onClick={() => { setShowReset(true); setRMsg(null) }}
              className="text-sm text-[var(--primary)] hover:text-phopy-indigo-600 transition-colors"
            >
              {t('login.forgotPassword')}
            </button>
          </div>

          {/* Login Button */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={loading}
            className="w-full phopy-btn-primary flex items-center justify-center gap-2 group disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <span>{t('login.submit')}</span>
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </motion.button>
        </form>

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-xs text-[var(--fg-4)]">
            © 2024 Phopy ERP. All rights reserved.
          </p>
        </div>
      </motion.div>

      {/* Forgot / Reset Password Modal */}
      <AnimatePresence>
        {showReset && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/50"
            onClick={() => setShowReset(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="phopy-card p-6 w-full max-w-md relative"
              onClick={(e) => e.stopPropagation()}
            >
              <button type="button" onClick={() => setShowReset(false)}
                className="absolute top-4 right-4 text-[var(--fg-3)] hover:text-[var(--fg-1)]">
                <X className="w-5 h-5" />
              </button>
              <h3 className="text-lg font-semibold text-[var(--fg-1)] mb-2 flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-[var(--primary)]" />
                ตั้งรหัสผ่านใหม่
              </h3>
              <p className="text-sm text-[var(--fg-3)] mb-4">
                ขอ<b>รหัสรีเซ็ต (reset code)</b> จากผู้ดูแลระบบ (Admin) ของบริษัทคุณ แล้วนำมากรอกด้านล่างเพื่อตั้งรหัสผ่านใหม่ด้วยตัวเอง (รหัสมีอายุ 30 นาที)
              </p>
              <form onSubmit={submitReset} className="space-y-4">
                {rMsg && (
                  <div className={`p-3 rounded-lg text-sm ${rMsg.ok ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--danger-soft)] text-danger'}`}>
                    {rMsg.text}
                  </div>
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
                <button type="submit" disabled={rBusy}
                  className="w-full phopy-btn-primary flex items-center justify-center gap-2 disabled:opacity-50">
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
