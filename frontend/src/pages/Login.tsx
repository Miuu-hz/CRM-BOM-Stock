import { useState } from 'react'
import { motion } from 'framer-motion'
import { Zap, Mail, Lock, ArrowRight, Loader2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

function Login() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    
    const result = await login(email, password)
    
    if (!result.success) {
      setError(result.message || 'เข้าสู่ระบบไม่สำเร็จ')
    }
    
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-cyber-dark flex items-center justify-center p-6 relative overflow-hidden">
      {/* Background Effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyber-primary/10 rounded-full blur-[120px] animate-pulse-slow" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyber-purple/10 rounded-full blur-[120px] animate-pulse-slow" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 w-96 h-96 bg-cyber-green/5 rounded-full blur-[120px] animate-pulse-slow" style={{ animationDelay: '2s' }} />
      </div>

      {/* Login Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="cyber-card p-8 w-full max-w-md relative z-10"
      >
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <motion.div
            animate={{
              rotate: [0, 360],
            }}
            transition={{
              duration: 3,
              repeat: Infinity,
              ease: 'linear',
            }}
            className="w-16 h-16 bg-gradient-to-br from-cyber-primary via-cyber-purple to-cyber-green rounded-2xl flex items-center justify-center shadow-neon-strong mb-4"
          >
            <Zap className="w-8 h-8 text-white" />
          </motion.div>
          <h1 className="text-3xl font-bold neon-text font-['Orbitron']">
            CRM-BOM-STOCK
          </h1>
          <p className="text-gray-400 mt-2">Bedding Factory Management</p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Email Input */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Email / Username
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com หรือ BB-pillow"
                className="cyber-input pl-10 w-full"
                required
              />
            </div>
          </div>

          {/* Password Input */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="cyber-input pl-10 w-full"
                required
              />
            </div>
          </div>

          {/* Remember Me & Forgot Password */}
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-cyber-border bg-cyber-darker text-cyber-primary focus:ring-cyber-primary focus:ring-2"
              />
              <span className="text-sm text-gray-400">Remember me</span>
            </label>
            <button
              type="button"
              className="text-sm text-cyber-primary hover:text-cyber-secondary transition-colors"
            >
              Forgot Password?
            </button>
          </div>

          {/* Login Button */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={loading}
            className="w-full cyber-btn-primary flex items-center justify-center gap-2 group disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <span>Sign In</span>
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </motion.button>
        </form>

        {/* Divider */}
        <div className="flex items-center gap-4 my-6">
          <div className="flex-1 h-px bg-cyber-border"></div>
          <span className="text-sm text-gray-400">MASTER ACCOUNTS</span>
          <div className="flex-1 h-px bg-cyber-border"></div>
        </div>

        {/* Master Credentials */}
        <div className="space-y-3">
          <div className="p-3 rounded-lg bg-cyber-green/10 border border-cyber-green/30">
            <p className="text-sm text-cyber-green font-semibold">BB Pillow Master</p>
            <p className="text-xs text-gray-400 font-mono mt-1">
              User: BB-pillow
            </p>
            <p className="text-xs text-gray-400 font-mono">
              Pass: BB0918033688
            </p>
          </div>
          <div className="p-3 rounded-lg bg-cyber-primary/10 border border-cyber-primary/30">
            <p className="text-sm text-cyber-primary font-semibold">Kids House Master</p>
            <p className="text-xs text-gray-400 font-mono mt-1">
              User: Kidshosuecafe
            </p>
            <p className="text-xs text-gray-400 font-mono">
              Pass: Kids0834516669
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-xs text-gray-500">
            © 2024 CRM-BOM-Stock. All rights reserved.
          </p>
        </div>
      </motion.div>

      {/* Decorative Scan Lines */}
      <div className="fixed inset-0 pointer-events-none opacity-10">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="h-px bg-cyber-primary"
            style={{
              marginTop: `${i * 5}vh`,
              animation: `scan-line ${3 + i * 0.1}s linear infinite`,
              animationDelay: `${i * 0.2}s`,
            }}
          />
        ))}
      </div>
    </div>
  )
}

export default Login
