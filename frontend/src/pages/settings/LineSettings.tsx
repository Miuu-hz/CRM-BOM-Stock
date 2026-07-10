import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  Check,
  CheckCircle,
  Copy,
  Link,
  MessageSquare,
  RefreshCw,
  Save,
  Unlink,
  UserCheck,
  Users,
} from 'lucide-react'
import { getLineConfig, updateLineConfig, testLineMessage, generateLinkToken, getLinkStatus, unlinkLine, getLinkedUsers, unlinkUserLine, LineConfig } from '../../services/lineBot'
import { useAuth } from '../../contexts/AuthContext'

export default function LineSettings() {
  const { t } = useTranslation()
  const { isMaster } = useAuth()
  const [config, setConfig] = useState<Partial<LineConfig>>({
    channel_name: '',
    channel_secret: '',
    channel_access_token: '',
    is_active: true
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Account Linking state
  const [linkStatus, setLinkStatus] = useState<{ linked: boolean; linkedAt: string | null } | null>(null)
  const [linkToken, setLinkToken] = useState('')
  const [generatingToken, setGeneratingToken] = useState(false)
  const [tokenCopied, setTokenCopied] = useState(false)
  const [unlinking, setUnlinking] = useState(false)

  // Linked users list (master only)
  const [linkedUsers, setLinkedUsers] = useState<any[]>([])
  const [unlinkingUserId, setUnlinkingUserId] = useState<string | null>(null)

  useEffect(() => {
    loadConfig()
    loadLinkStatus()
    if (isMaster) loadLinkedUsers()
  }, [])

  const loadLinkedUsers = async () => {
    try {
      const res = await getLinkedUsers()
      if (res.success) setLinkedUsers(res.data)
    } catch { /* ignore */ }
  }

  const loadLinkStatus = async () => {
    try {
      const res = await getLinkStatus()
      if (res.success) setLinkStatus(res.data)
    } catch { /* ignore */ }
  }

  const handleGenerateToken = async () => {
    try {
      setGeneratingToken(true)
      setLinkToken('')
      const res = await generateLinkToken()
      if (res.success) {
        setLinkToken(res.data.token)
        setTimeout(loadLinkStatus, 500)
      }
    } catch { /* ignore */ } finally {
      setGeneratingToken(false)
    }
  }

  const handleUnlink = async () => {
    try {
      setUnlinking(true)
      await unlinkLine()
      setLinkStatus({ linked: false, linkedAt: null })
      setLinkToken('')
      loadLinkedUsers()
    } catch { /* ignore */ } finally {
      setUnlinking(false)
    }
  }

  const handleUnlinkUser = async (userId: string) => {
    try {
      setUnlinkingUserId(userId)
      await unlinkUserLine(userId)
      setLinkedUsers(prev => prev.filter(u => u.user_id !== userId))
    } catch { /* ignore */ } finally {
      setUnlinkingUserId(null)
    }
  }

  const copyToken = () => {
    navigator.clipboard.writeText(t('settings.line.accountLinking.tokenPrefix', { token: linkToken }))
    setTokenCopied(true)
    setTimeout(() => setTokenCopied(false), 2000)
  }

  const loadConfig = async () => {
    try {
      setLoading(true)
      const res = await getLineConfig()
      if (res.success && res.data) {
        setConfig({
          ...res.data,
          channel_secret: '',
          channel_access_token: ''
        })
      }
    } catch (err: any) {
      setError(t('settings.line.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isMaster) return

    try {
      setSaving(true)
      setError('')
      setSuccess('')

      const payload: Partial<LineConfig> = { ...config }
      if (config.id) {
        if (!payload.channel_secret) delete payload.channel_secret
        if (!payload.channel_access_token) delete payload.channel_access_token
      }

      const res = await updateLineConfig(payload)
      if (res.success) {
        setSuccess(t('settings.line.saveSuccess'))
        setTimeout(() => setSuccess(''), 3000)
        loadConfig()
      } else {
        setError(res.message || t('settings.line.saveFailed'))
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || t('settings.line.error'))
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    try {
      setTesting(true)
      setError('')
      setSuccess('')

      const res = await testLineMessage()
      if (res.success) {
        setSuccess(t('settings.line.testSuccess'))
        setTimeout(() => setSuccess(''), 3000)
      } else {
        setError(res.message || t('settings.line.testFailed'))
      }
    } catch (err: any) {
      setError(t('settings.line.error'))
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <div className="phopy-card p-12 text-center">
        <RefreshCw className="w-8 h-8 text-[var(--primary)] mx-auto animate-spin mb-4" />
        <p className="text-[var(--fg-3)]">{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="phopy-card p-6 border-l-4 border-phopy-indigo">
        <h3 className="text-lg font-semibold text-[var(--fg-1)] mb-2 flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-[var(--primary)]" />
          {t('settings.line.title')}
        </h3>
        <p className="text-[var(--fg-3)] text-sm mb-6">
          {t('settings.line.subtitle')}{' '}
          {t('settings.line.webhookUrlLabel')}{' '}
          <span className="font-mono text-[var(--primary)] px-2 py-1 bg-phopy-indigo/10 rounded">https://crm.phopy.net/api/line/webhook</span>
        </p>

        {error && (
          <div className="mb-6 p-4 bg-[var(--danger-soft)] border border-danger/30 rounded-lg flex items-center gap-3 text-danger">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-success/10 border border-success/30 rounded-lg flex items-center gap-3 text-success">
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
            <p>{success}</p>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-5 max-w-2xl">
          <div>
            <label className="block text-sm text-[var(--fg-3)] mb-2 flex items-center gap-2">
              {t('settings.line.channelName.label')}
            </label>
            <input
              type="text"
              value={config.channel_name}
              onChange={(e) => setConfig({ ...config, channel_name: e.target.value })}
              className="phopy-input w-full"
              placeholder={t('settings.line.channelName.placeholder')}
              disabled={!isMaster}
            />
          </div>

          <div>
            <label className="block text-sm text-[var(--fg-3)] mb-2">
              {t('settings.line.channelSecret.label')}
            </label>
            <input
              type="password"
              value={config.channel_secret}
              onChange={(e) => setConfig({ ...config, channel_secret: e.target.value })}
              className="phopy-input w-full"
              placeholder={config.id ? t('settings.line.channelSecret.placeholderEdit') : t('settings.line.channelSecret.placeholderCreate')}
              required={!config.id}
              disabled={!isMaster}
            />
          </div>

          <div>
            <label className="block text-sm text-[var(--fg-3)] mb-2">
              {t('settings.line.channelToken.label')}
            </label>
            <textarea
              value={config.channel_access_token}
              onChange={(e) => setConfig({ ...config, channel_access_token: e.target.value })}
              className="phopy-input w-full h-24"
              placeholder={config.id ? t('settings.line.channelToken.placeholderEdit') : t('settings.line.channelToken.placeholderCreate')}
              required={!config.id}
              disabled={!isMaster}
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <input
              type="checkbox"
              id="is_active"
              checked={config.is_active}
              onChange={(e) => setConfig({ ...config, is_active: e.target.checked })}
              className="rounded bg-[var(--bg)] border-[var(--border)] text-[var(--primary)] focus:ring-phopy-indigo"
              disabled={!isMaster}
            />
            <label htmlFor="is_active" className="text-[var(--fg-2)]">
              {t('settings.line.active')}
            </label>
          </div>

          <div className="pt-6 border-t border-[var(--border)] flex items-center gap-4">
            {isMaster && (
              <button
                type="submit"
                disabled={saving}
                className="phopy-btn-primary flex items-center gap-2"
              >
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {t('settings.line.save')}
              </button>
            )}

            <button
              type="button"
              onClick={handleTest}
              disabled={testing || !config.id}
              className="px-4 py-2 bg-[var(--bg)] border border-[var(--border)] text-[var(--fg-2)] rounded-lg font-medium hover:bg-[var(--bg)]/80 hover:text-[var(--fg-1)] transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {testing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
              {t('settings.line.testMessage')}
            </button>
          </div>
        </form>
      </div>
      {/* Account Linking */}
      <div className="phopy-card p-6 border-l-4 border-success">
        <h3 className="text-lg font-semibold text-[var(--fg-1)] mb-1 flex items-center gap-2">
          <UserCheck className="w-5 h-5 text-success" />
          {t('settings.line.accountLinking.title')}
        </h3>
        <p className="text-[var(--fg-3)] text-sm mb-5">
          {t('settings.line.accountLinking.subtitle')}
        </p>

        {/* Status */}
        {linkStatus && (
          <div className={`mb-4 p-3 rounded-lg flex items-center justify-between gap-3 text-sm ${
            linkStatus.linked
              ? 'bg-success/10 border border-success/30 text-success'
              : 'bg-[var(--warning-soft)] border border-warning/30 text-warning'
          }`}>
            <span className="flex items-center gap-2">
              {linkStatus.linked
                ? <><CheckCircle className="w-4 h-4 flex-shrink-0" /> {t('settings.line.accountLinking.linked')}{linkStatus.linkedAt ? t('settings.line.accountLinking.linkedOn', { date: new Date(linkStatus.linkedAt).toLocaleDateString('th-TH') }) : ''}</>
                : <><AlertCircle className="w-4 h-4 flex-shrink-0" /> {t('settings.line.accountLinking.notLinked')}</>
              }
            </span>
            {linkStatus.linked && (
              <button
                onClick={handleUnlink}
                disabled={unlinking}
                className="flex items-center gap-1 px-2 py-1 rounded border border-danger/40 text-danger hover:bg-[var(--danger-soft)] text-xs transition-all"
              >
                {unlinking ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Unlink className="w-3 h-3" />}
                {t('settings.line.accountLinking.unlink')}
              </button>
            )}
          </div>
        )}

        {/* Steps */}
        <div className="bg-[var(--surface-2)] rounded-lg p-4 mb-4 text-sm space-y-2 text-[var(--fg-2)]">
          <p className="font-medium text-[var(--fg-2)] mb-2">{t('settings.line.accountLinking.stepsTitle')}</p>
          <p>{t('settings.line.accountLinking.step1')}</p>
          <p>{t('settings.line.accountLinking.step2')}</p>
          <p className="text-[var(--fg-4)] text-xs">{t('settings.line.accountLinking.tokenExpiry')}</p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleGenerateToken}
            disabled={generatingToken}
            className="phopy-btn-primary flex items-center gap-2 text-sm"
          >
            {generatingToken
              ? <RefreshCw className="w-4 h-4 animate-spin" />
              : <Link className="w-4 h-4" />
            }
            {t('settings.line.accountLinking.generateToken')}
          </button>

          {linkToken && (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="flex-1 font-mono text-sm bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--primary)] select-all">
                {t('settings.line.accountLinking.tokenPrefix', { token: linkToken })}
              </div>
              <button
                onClick={copyToken}
                className="flex items-center gap-1 px-3 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--fg-2)] hover:text-[var(--fg-1)] hover:border-phopy-indigo transition-all whitespace-nowrap"
              >
                <Copy className="w-3.5 h-3.5" />
                {tokenCopied ? <>{t('settings.line.accountLinking.copied')} <Check className="w-3.5 h-3.5 inline" /></> : t('settings.line.accountLinking.copyToken')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Linked Users List (master only) */}
      {isMaster && (
        <div className="phopy-card p-6 border-l-4 border-phopy-indigo/50">
          <h3 className="text-lg font-semibold text-[var(--fg-1)] mb-1 flex items-center gap-2">
            <Users className="w-5 h-5 text-[var(--primary)]" />
            {t('settings.line.linkedUsers.title')}
          </h3>
          <p className="text-[var(--fg-3)] text-sm mb-4">{t('settings.line.linkedUsers.subtitle')}</p>

          {linkedUsers.length === 0 ? (
            <p className="text-[var(--fg-4)] text-sm">{t('settings.line.linkedUsers.none')}</p>
          ) : (
            <div className="space-y-2">
              {linkedUsers.map(u => (
                <div key={u.user_id} className="flex items-center justify-between p-3 bg-[var(--surface-2)] rounded-lg border border-[var(--border)]">
                  <div>
                    <p className="text-[var(--fg-2)] text-sm font-medium">
                      {u.user_name || u.user_id}
                      <span className="ml-2 text-xs text-[var(--fg-4)]">{u.role}</span>
                    </p>
                    {u.user_email && <p className="text-[var(--fg-4)] text-xs">{u.user_email}</p>}
                    <p className="text-[var(--fg-4)] text-xs mt-0.5">
                      {t('settings.line.linkedUsers.linkedAt', { date: u.linked_at ? new Date(u.linked_at).toLocaleDateString('th-TH') : '-' })}
                    </p>
                  </div>
                  <button
                    onClick={() => handleUnlinkUser(u.user_id)}
                    disabled={unlinkingUserId === u.user_id}
                    className="flex items-center gap-1 px-2 py-1 rounded border border-danger/40 text-danger hover:bg-[var(--danger-soft)] text-xs transition-all"
                  >
                    {unlinkingUserId === u.user_id
                      ? <RefreshCw className="w-3 h-3 animate-spin" />
                      : <Unlink className="w-3 h-3" />
                    }
                    {t('settings.line.accountLinking.unlink')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
