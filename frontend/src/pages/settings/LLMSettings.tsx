import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Brain,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Send,
  Bot,
  Plus,
  Terminal,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  getKimiStatus,
  kimiChat,
  getMcpSettings,
  regenerateMcpKey,
  testMcpServer,
  type McpTestStep,
} from '../../services/llm'

export default function LLMSettings() {
  const [kimiVersion, setKimiVersion] = useState<string | null>(null)
  const [kimiOnline, setKimiOnline] = useState<boolean | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)

  const [chatMsg, setChatMsg] = useState('')
  const [chatReply, setChatReply] = useState('')
  const [chatLoading, setChatLoading] = useState(false)

  const [mcpKey, setMcpKey] = useState<string | null>(null)
  const [mcpRegenLoading, setMcpRegenLoading] = useState(false)
  const [mcpTestLoading, setMcpTestLoading] = useState(false)
  const [mcpTestSteps, setMcpTestSteps] = useState<McpTestStep[] | null>(null)
  const mcpUrl = mcpKey ? `${window.location.origin}/mcp/sse?key=${mcpKey}` : null

  useEffect(() => {
    checkKimiStatus()
    loadMcpSettings()
  }, [])

  const checkKimiStatus = async () => {
    setStatusLoading(true)
    try {
      const res = await getKimiStatus()
      setKimiOnline(res.success)
      setKimiVersion(res.version ?? null)
    } catch {
      setKimiOnline(false)
      setKimiVersion(null)
    } finally {
      setStatusLoading(false)
    }
  }

  const loadMcpSettings = async () => {
    try {
      const res = await getMcpSettings()
      if (res.success) setMcpKey(res.data.key)
    } catch { /* silent */ }
  }

  const handleMcpRegenerate = async () => {
    if (!confirm('สร้าง API Key ใหม่จะทำให้ URL เดิมใช้งานไม่ได้ ต้องการดำเนินการต่อ?')) return
    setMcpRegenLoading(true)
    setMcpTestSteps(null)
    try {
      const res = await regenerateMcpKey()
      if (res.success) {
        setMcpKey(res.data.key)
        toast.success('สร้าง API Key ใหม่แล้ว')
      }
    } catch {
      toast.error('สร้าง Key ไม่สำเร็จ')
    } finally {
      setMcpRegenLoading(false)
    }
  }

  const handleMcpTest = async () => {
    setMcpTestLoading(true)
    setMcpTestSteps(null)
    try {
      const res = await testMcpServer()
      setMcpTestSteps(res.steps)
    } catch {
      toast.error('ทดสอบไม่สำเร็จ')
    } finally {
      setMcpTestLoading(false)
    }
  }

  const handleChatSend = async () => {
    if (!chatMsg.trim()) return
    setChatLoading(true)
    setChatReply('')
    try {
      const res = await kimiChat(chatMsg)
      if (res.success) {
        setChatReply(res.reply)
      } else {
        toast.error(res.message || 'ส่งข้อความไม่สำเร็จ')
      }
    } catch {
      toast.error('เกิดข้อผิดพลาด')
    } finally {
      setChatLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-[var(--fg-1)] flex items-center gap-2">
          <Brain className="w-5 h-5 text-[var(--primary)]" />
          AI Assistant
        </h2>
        <p className="text-sm text-[var(--fg-3)]">Kimi Code CLI — ผู้ช่วย AI สำหรับระบบ ERP</p>
      </div>

      {/* Kimi Status */}
      <div className="phopy-card p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${kimiOnline ? 'bg-success/15' : kimiOnline === false ? 'bg-danger/15' : 'bg-[var(--surface-2)]'}`}>
              <Terminal className={`w-5 h-5 ${kimiOnline ? 'text-success' : kimiOnline === false ? 'text-danger' : 'text-[var(--fg-4)]'}`} />
            </div>
            <div>
              <p className="font-semibold text-[var(--fg-1)]">Kimi Code CLI</p>
              <p className="text-xs text-[var(--fg-3)]">
                {statusLoading
                  ? 'กำลังตรวจสอบ...'
                  : kimiOnline && kimiVersion
                    ? `v${kimiVersion} — พร้อมใช้งาน`
                    : kimiOnline === false
                      ? 'ไม่สามารถเชื่อมต่อได้'
                      : 'ยังไม่ได้ตรวจสอบ'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {kimiOnline !== null && (
              kimiOnline
                ? <CheckCircle className="w-5 h-5 text-success" />
                : <AlertCircle className="w-5 h-5 text-danger" />
            )}
            <button
              onClick={checkKimiStatus}
              disabled={statusLoading}
              className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-sm text-[var(--fg-2)] hover:border-phopy-indigo/50 hover:text-[var(--primary)] transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${statusLoading ? 'animate-spin' : ''}`} />
              ตรวจสอบ
            </button>
          </div>
        </div>
      </div>

      {/* Playground */}
      <div className="phopy-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-[var(--primary)]" />
          <div>
            <h3 className="text-lg font-bold text-[var(--fg-1)]">AI Playground</h3>
            <p className="text-xs text-[var(--fg-3)]">ทดสอบถามคำถามเกี่ยวกับข้อมูลในระบบ</p>
          </div>
        </div>

        <div className="flex gap-2">
          <textarea
            value={chatMsg}
            onChange={(e) => setChatMsg(e.target.value)}
            placeholder="เช่น หมูสับในสต็อกมีเท่าไหร่, ยอดขายเดือนนี้เป็นยังไงบ้าง..."
            className="phopy-input w-full resize-none"
            rows={3}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleChatSend()
              }
            }}
          />
          <button
            onClick={handleChatSend}
            disabled={chatLoading || !chatMsg.trim() || !kimiOnline}
            className="phopy-btn-primary px-4 flex flex-col items-center justify-center gap-1 disabled:opacity-50"
          >
            {chatLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            <span className="text-xs">ส่ง</span>
          </button>
        </div>

        <AnimatePresence>
          {chatReply && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="p-4 bg-[var(--surface-2)] rounded-xl border border-[var(--border)] space-y-2"
            >
              <div className="flex items-center gap-2 text-[var(--primary)] text-sm font-medium">
                <Bot className="w-4 h-4" />
                Kimi ตอบ
              </div>
              <div className="text-[var(--fg-2)] whitespace-pre-wrap text-sm leading-relaxed">
                {chatReply}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* MCP Server */}
      <div className="phopy-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-purple-400" />
          <div>
            <h3 className="text-lg font-bold text-[var(--fg-1)]">MCP Server</h3>
            <p className="text-xs text-[var(--fg-3)]">สำหรับ AI clients ที่รองรับ MCP protocol</p>
          </div>
        </div>

        {!mcpKey ? (
          <div className="text-center py-4 space-y-3">
            <p className="text-sm text-[var(--fg-3)]">ยังไม่มี API Key — สร้างเพื่อเปิดใช้งาน MCP</p>
            <button
              onClick={handleMcpRegenerate}
              disabled={mcpRegenLoading}
              className="phopy-btn-primary text-sm flex items-center gap-2 mx-auto"
            >
              {mcpRegenLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              สร้าง API Key
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-[var(--fg-3)] mb-1">MCP Server URL</label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={mcpUrl ?? ''}
                  className="phopy-input w-full text-xs font-mono text-[var(--fg-2)] select-all"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  onClick={() => {
                    if (mcpUrl) {
                      navigator.clipboard.writeText(mcpUrl)
                      toast.success('คัดลอก URL แล้ว')
                    }
                  }}
                  className="px-3 py-2 rounded-lg border border-[var(--border)] text-[var(--fg-3)] hover:text-[var(--primary)] hover:border-phopy-indigo/50 transition-colors text-sm whitespace-nowrap"
                >
                  Copy
                </button>
              </div>
            </div>

            <div className="flex gap-3 flex-wrap">
              <button
                onClick={handleMcpTest}
                disabled={mcpTestLoading}
                className="px-4 py-2 rounded-lg border border-phopy-indigo/50 text-[var(--primary)] hover:bg-phopy-indigo/10 transition-colors text-sm flex items-center gap-2"
              >
                {mcpTestLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                Test MCP
              </button>
              <button
                onClick={handleMcpRegenerate}
                disabled={mcpRegenLoading}
                className="px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--fg-3)] hover:text-danger hover:border-[var(--danger-soft)] transition-colors text-sm flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Regenerate Key
              </button>
            </div>

            {mcpTestSteps && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-[var(--surface-2)] rounded-xl border border-[var(--border)] space-y-2"
              >
                <p className="text-sm font-medium text-[var(--fg-2)] mb-2">ผลการทดสอบ MCP Server</p>
                {mcpTestSteps.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    {s.ok
                      ? <CheckCircle className="w-4 h-4 text-success flex-shrink-0" />
                      : <AlertCircle className="w-4 h-4 text-danger flex-shrink-0" />
                    }
                    <span className={s.ok ? 'text-[var(--fg-2)]' : 'text-danger'}>{s.step}</span>
                    {s.ms !== undefined && (
                      <span className="text-[var(--fg-4)] text-xs ml-auto">{s.ms}ms</span>
                    )}
                  </div>
                ))}
                {mcpTestSteps.every((s) => s.ok) && (
                  <p className="text-success text-sm font-medium pt-1">MCP Server พร้อมใช้งาน</p>
                )}
              </motion.div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
