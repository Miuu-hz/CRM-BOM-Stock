import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import {
  Database, UploadCloud, Download, Trash2, RefreshCw,
  CheckCircle, XCircle, Clock, AlertTriangle, Info,
} from 'lucide-react'
import api from '../../services/api'
import toast from 'react-hot-toast'

interface BackupLog {
  id: string
  filename: string
  file_size: number | null
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED'
  cloud_url: string | null
  error: string | null
  created_at: string
  completed_at: string | null
}

function fmtSize(bytes: number | null) {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(2)} MB`
}

function fmtDate(iso: string | null) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })
}

export default function BackupSettings() {
  const { t } = useTranslation()
  const [backups, setBackups] = useState<BackupLog[]>([])
  const [driveConfigured, setDriveConfigured] = useState(false)
  const [lastBackup, setLastBackup] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [triggering, setTriggering] = useState(false)
  const [testingDrive, setTestingDrive] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = async () => {
    try {
      const res = await api.get('/backup')
      setBackups(res.data.data.backups)
      setDriveConfigured(res.data.data.driveConfigured)
      setLastBackup(res.data.data.lastBackup)
    } catch {
      toast.error(t('settings.backup.toast.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleTrigger = async () => {
    setTriggering(true)
    try {
      const res = await api.post('/backup/trigger')
      setBackups(res.data.data.backups)
      toast.success(t('settings.backup.toast.success'))
    } catch (err: any) {
      toast.error(err.response?.data?.message || t('settings.backup.toast.failed'))
    } finally {
      setTriggering(false)
    }
  }

  const handleTestDrive = async () => {
    setTestingDrive(true)
    try {
      const res = await api.post('/backup/test-drive')
      if (res.data.success) toast.success(res.data.message)
      else toast.error(res.data.message)
    } finally {
      setTestingDrive(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(t('settings.backup.toast.deleteConfirm'))) return
    setDeletingId(id)
    try {
      await api.delete(`/backup/${id}`)
      setBackups(prev => prev.filter(b => b.id !== id))
      toast.success(t('settings.backup.toast.deleteSuccess'))
    } catch (err: any) {
      toast.error(err.response?.data?.message || t('settings.backup.toast.deleteFailed'))
    } finally {
      setDeletingId(null)
    }
  }

  const handleDownload = (id: string, filename: string) => {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token') || ''
    const a = document.createElement('a')
    a.href = `/api/backup/download/${id}`
    fetch(`/api/backup/download/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        a.href = URL.createObjectURL(blob)
        a.download = filename
        a.click()
        URL.revokeObjectURL(a.href)
      })
      .catch(() => toast.error(t('settings.backup.toast.downloadFailed')))
  }

  const nextBackup = lastBackup
    ? new Date(new Date(lastBackup).getTime() + 3 * 24 * 60 * 60 * 1000)
    : null

  const getStatusConfig = (status: BackupLog['status']) => {
    switch (status) {
      case 'SUCCESS': return { label: t('settings.backup.status.SUCCESS'), icon: CheckCircle, color: 'text-success', bg: 'bg-[var(--success-soft)]' }
      case 'PARTIAL': return { label: t('settings.backup.status.PARTIAL'), icon: AlertTriangle, color: 'text-warning', bg: 'bg-[var(--warning-soft)]' }
      case 'FAILED': return { label: t('settings.backup.status.FAILED'), icon: XCircle, color: 'text-danger', bg: 'bg-[var(--danger-soft)]' }
      case 'RUNNING': return { label: t('settings.backup.status.RUNNING'), icon: RefreshCw, color: 'text-[var(--primary)]', bg: 'bg-[var(--primary-soft)]' }
      default: return { label: t('settings.backup.status.PENDING'), icon: Clock, color: 'text-[var(--fg-3)]', bg: 'bg-[var(--surface-2)]' }
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[var(--fg-1)] flex items-center gap-2">
            <Database className="w-5 h-5 text-[var(--primary)]" />
            {t('settings.backup.title')}
          </h2>
          <p className="text-sm text-[var(--fg-3)] mt-1">
            {t('settings.backup.subtitle')}
          </p>
        </div>
        <button
          onClick={handleTrigger}
          disabled={triggering}
          className="phopy-btn-primary flex items-center gap-2 disabled:opacity-60"
        >
          {triggering
            ? <RefreshCw className="w-4 h-4 animate-spin" />
            : <Database className="w-4 h-4" />}
          {triggering ? t('settings.backup.backingUp') : t('settings.backup.backupNow')}
        </button>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="phopy-card p-4 space-y-1">
          <p className="text-xs text-[var(--fg-3)]">{t('settings.backup.latest')}</p>
          <p className="font-semibold text-[var(--fg-1)]">{fmtDate(lastBackup)}</p>
        </div>
        <div className="phopy-card p-4 space-y-1">
          <p className="text-xs text-[var(--fg-3)]">{t('settings.backup.next')}</p>
          <p className="font-semibold text-[var(--fg-1)]">{nextBackup ? fmtDate(nextBackup.toISOString()) : t('settings.backup.never')}</p>
        </div>
        <div className="phopy-card p-4 space-y-1">
          <p className="text-xs text-[var(--fg-3)]">{t('settings.backup.googleDrive')}</p>
          <div className="flex items-center gap-2">
            {driveConfigured
              ? <><CheckCircle className="w-4 h-4 text-success" /><span className="text-success font-semibold text-sm">{t('settings.backup.configured')}</span></>
              : <><XCircle className="w-4 h-4 text-danger" /><span className="text-danger font-semibold text-sm">{t('settings.backup.notConfigured')}</span></>}
          </div>
        </div>
      </div>

      {/* Google Drive setup guide */}
      {!driveConfigured && (
        <div className="phopy-card p-5 border border-warning/30 bg-[var(--warning-soft)]">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
            <div className="space-y-3 text-sm">
              <p className="font-semibold text-[var(--fg-1)]">{t('settings.backup.setupTitle')}</p>
              <ol className="space-y-1.5 text-[var(--fg-2)] list-decimal ml-4">
                <li dangerouslySetInnerHTML={{ __html: t('settings.backup.setupSteps.0', { consoleUrl: '<span class="font-mono text-[var(--primary)]">console.cloud.google.com</span>' }) }} />
                <li dangerouslySetInnerHTML={{ __html: t('settings.backup.setupSteps.1', { driveApi: '<strong>Google Drive API</strong>' }) }} />
                <li dangerouslySetInnerHTML={{ __html: t('settings.backup.setupSteps.2', { serviceAccount: '<strong>Service Account</strong>' }) }} />
                <li>{t('settings.backup.setupSteps.3')}</li>
                <li>{t('settings.backup.setupSteps.4')}</li>
                <li dangerouslySetInnerHTML={{ __html: t('settings.backup.setupSteps.5', { folderUrl: '<span class="font-mono text-xs bg-[var(--surface)] px-1 rounded">drive.google.com/drive/folders/<strong>FOLDER_ID</strong></span>' }) }} />
                <li dangerouslySetInnerHTML={{ __html: t('settings.backup.setupSteps.6', { envFile: '<code class="font-mono text-xs bg-[var(--surface)] px-1 rounded">backend/.env</code>' }) }} />
              </ol>
              <pre className="bg-[var(--surface)] rounded-lg p-3 text-xs font-mono text-[var(--fg-2)] overflow-x-auto">
{`GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"...","private_key":"...","client_email":"...",...}'
GOOGLE_DRIVE_FOLDER_ID=1AbCdEfGhIjKlMnOpQrStUvWxYz`}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Test Drive button */}
      {driveConfigured && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleTestDrive}
            disabled={testingDrive}
            className="phopy-btn-secondary flex items-center gap-2 text-sm"
          >
            {testingDrive
              ? <RefreshCw className="w-4 h-4 animate-spin" />
              : <UploadCloud className="w-4 h-4" />}
            {t('settings.backup.testDrive')}
          </button>
          <p className="text-xs text-[var(--fg-3)]">{t('settings.backup.testDriveHint')}</p>
        </div>
      )}

      {/* Backup history table */}
      <div className="phopy-card overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between">
          <p className="font-semibold text-[var(--fg-1)] text-sm">{t('settings.backup.historyTitle')}</p>
          <button onClick={load} className="p-1.5 text-[var(--fg-3)] hover:text-[var(--fg-1)] hover:bg-[var(--surface-2)] rounded transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <RefreshCw className="w-6 h-6 animate-spin text-[var(--primary)]" />
          </div>
        ) : backups.length === 0 ? (
          <div className="text-center py-12 text-[var(--fg-3)]">
            <Database className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p>{t('settings.backup.empty')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left px-5 py-3 text-[var(--fg-3)] font-medium">{t('settings.backup.table.file')}</th>
                  <th className="text-left px-4 py-3 text-[var(--fg-3)] font-medium">{t('settings.backup.table.size')}</th>
                  <th className="text-left px-4 py-3 text-[var(--fg-3)] font-medium">{t('settings.backup.table.status')}</th>
                  <th className="text-left px-4 py-3 text-[var(--fg-3)] font-medium">{t('settings.backup.table.date')}</th>
                  <th className="text-center px-4 py-3 text-[var(--fg-3)] font-medium">{t('settings.backup.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {backups.map(b => {
                  const cfg = getStatusConfig(b.status)
                  const Icon = cfg.icon
                  return (
                    <tr key={b.id} className="border-b border-[var(--border)]/30 hover:bg-[var(--surface-2)] transition-colors">
                      <td className="px-5 py-3">
                        <p className="font-mono text-xs text-[var(--fg-2)] truncate max-w-[220px]">{b.filename}</p>
                        {b.cloud_url && (
                          <a href={b.cloud_url} target="_blank" rel="noreferrer"
                            className="text-xs text-[var(--primary)] flex items-center gap-1 mt-0.5 hover:underline">
                            <UploadCloud className="w-3 h-3" /> Drive
                          </a>
                        )}
                        {b.error && <p className="text-xs text-danger mt-0.5 truncate max-w-[220px]">{b.error}</p>}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-[var(--fg-2)]">{fmtSize(b.file_size)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color} ${cfg.bg}`}>
                          <Icon className={`w-3 h-3 ${b.status === 'RUNNING' ? 'animate-spin' : ''}`} />
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--fg-3)]">{fmtDate(b.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          {b.status === 'SUCCESS' || b.status === 'PARTIAL' ? (
                            <button
                              onClick={() => handleDownload(b.id, b.filename)}
                              className="p-1.5 text-[var(--primary)] hover:bg-[var(--primary-soft)] rounded transition-colors"
                              title={t('settings.backup.table.download')}
                            >
                              <Download className="w-4 h-4" />
                            </button>
                          ) : null}
                          <button
                            onClick={() => handleDelete(b.id)}
                            disabled={deletingId === b.id}
                            className="p-1.5 text-danger hover:bg-[var(--danger-soft)] rounded transition-colors disabled:opacity-40"
                            title={t('common.delete')}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-[var(--fg-4)] text-center">
        {t('settings.backup.footer')}
      </p>
    </motion.div>
  )
}
