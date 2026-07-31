import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import {
  Brain,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Bot,
  Plus,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  getMcpSettings,
  regenerateMcpKey,
  testMcpServer,
  type McpTestStep,
} from '../../services/llm'

export default function LLMSettings() {
  const { t } = useTranslation()
  const [mcpKey, setMcpKey] = useState<string | null>(null)
  const [mcpRegenLoading, setMcpRegenLoading] = useState(false)
  const [mcpTestLoading, setMcpTestLoading] = useState(false)
  const [mcpTestSteps, setMcpTestSteps] = useState<McpTestStep[] | null>(null)
  const mcpUrl = mcpKey ? `${window.location.origin}/mcp/sse?key=${mcpKey}` : null

  useEffect(() => {
    loadMcpSettings()
  }, [])

  const loadMcpSettings = async () => {
    try {
      const res = await getMcpSettings()
      if (res.success) setMcpKey(res.data.key)
    } catch { /* silent */ }
  }

  const handleMcpRegenerate = async () => {
    if (!confirm(t('settings.llm.mcp.regenerateConfirm'))) return
    setMcpRegenLoading(true)
    setMcpTestSteps(null)
    try {
      const res = await regenerateMcpKey()
      if (res.success) {
        setMcpKey(res.data.key)
        toast.success(t('settings.llm.mcp.regenerateSuccess'))
      }
    } catch {
      toast.error(t('settings.llm.mcp.regenerateFailed'))
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
      toast.error(t('settings.llm.mcp.testFailed'))
    } finally {
      setMcpTestLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-[var(--fg-1)] flex items-center gap-2">
          <Brain className="w-5 h-5 text-[var(--primary)]" />
          {t('settings.llm.title')}
        </h2>
        <p className="text-sm text-[var(--fg-3)]">{t('settings.llm.subtitle')}</p>
      </div>

      {/* MCP Server */}
      <div className="phopy-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-purple-400" />
          <div>
            <h3 className="text-lg font-bold text-[var(--fg-1)]">{t('settings.llm.mcp.title')}</h3>
            <p className="text-xs text-[var(--fg-3)]">{t('settings.llm.mcp.subtitle')}</p>
          </div>
        </div>

        {!mcpKey ? (
          <div className="text-center py-4 space-y-3">
            <p className="text-sm text-[var(--fg-3)]">{t('settings.llm.mcp.noKey')}</p>
            <button
              onClick={handleMcpRegenerate}
              disabled={mcpRegenLoading}
              className="phopy-btn-primary text-sm flex items-center gap-2 mx-auto"
            >
              {mcpRegenLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {t('settings.llm.mcp.generateKey')}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-[var(--fg-3)] mb-1">{t('settings.llm.mcp.urlLabel')}</label>
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
                      toast.success(t('settings.llm.mcp.copied'))
                    }
                  }}
                  className="px-3 py-2 rounded-lg border border-[var(--border)] text-[var(--fg-3)] hover:text-[var(--primary)] hover:border-phopy-indigo/50 transition-colors text-sm whitespace-nowrap"
                >
                  {t('common.copy')}
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
                {t('settings.llm.mcp.test')}
              </button>
              <button
                onClick={handleMcpRegenerate}
                disabled={mcpRegenLoading}
                className="px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--fg-3)] hover:text-danger hover:border-[var(--danger-soft)] transition-colors text-sm flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                {t('settings.llm.mcp.regenerate')}
              </button>
            </div>

            {mcpTestSteps && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-[var(--surface-2)] rounded-xl border border-[var(--border)] space-y-2"
              >
                <p className="text-sm font-medium text-[var(--fg-2)] mb-2">{t('settings.llm.mcp.resultTitle')}</p>
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
                  <p className="text-success text-sm font-medium pt-1">{t('settings.llm.mcp.ready')}</p>
                )}
              </motion.div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
