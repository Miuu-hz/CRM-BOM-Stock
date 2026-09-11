import { useEffect, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Upload, Eye, Trash2, X, ImageIcon, FileText, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import { AuthImage } from './AuthImage'

export type AttachmentRefType = 'RECEIPT' | 'SUPPLIER_PAYMENT' | 'INVOICE'

interface AttachmentRow {
  id: string
  original_name: string
  file_size: number
  created_at: string
}

function isPdf(name: string) {
  return /\.pdf$/i.test(name || '')
}

function formatSize(bytes: number) {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// Shared upload/list/delete/preview UI for payment_attachments (POST/GET
// /api/attachments/:refType/:refId, DELETE /api/attachments/:id, file via
// GET /api/attachments/:id/file — see backend/src/routes/attachments.routes.ts).
// One component so supplier payment slips (Purchase.tsx) and sales
// receipts/invoices (Sales.tsx) don't each reimplement upload + PDF handling.
export function PaymentAttachments({ refType, refId, readOnly = false }: { refType: AttachmentRefType; refId: string; readOnly?: boolean }) {
  const { t } = useTranslation()
  const [items, setItems] = useState<AttachmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [previewId, setPreviewId] = useState<string | null>(null)

  const load = () => {
    api.get(`/attachments/${refType}/${refId}`)
      .then(r => setItems(r.data?.data || []))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [refType, refId])

  const handleUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { toast.error(t('attachments.fileTooLarge')); return }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      await api.post(`/attachments/${refType}/${refId}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      toast.success(t('attachments.uploadSuccess'))
      load()
    } catch { toast.error(t('attachments.uploadFailed')) }
    finally { setUploading(false); e.target.value = '' }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(t('attachments.confirmDelete'))) return
    try {
      await api.delete(`/attachments/${id}`)
      toast.success(t('attachments.deleteSuccess'))
      load()
    } catch { toast.error(t('attachments.deleteFailed')) }
  }

  // PDF can't render via <img>/AuthImage — fetch the blob through the
  // authenticated axios instance and hand the browser an object URL instead.
  const openFile = async (id: string) => {
    try {
      const res = await api.get(`/attachments/${id}/file`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch { toast.error(t('attachments.openFailed')) }
  }

  if (loading) return null

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wide">{t('attachments.title')}</p>
          {items.length > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--success-soft)] text-success">
              {t('attachments.hasEvidence')}
            </span>
          )}
        </div>
        {!readOnly && (
          <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${uploading ? 'bg-[var(--bg)] text-[var(--fg-4)]' : 'bg-[var(--primary-soft)] text-[var(--primary)] hover:bg-phopy-indigo/30'}`}>
            {uploading ? <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {uploading ? t('attachments.uploading') : t('attachments.add')}
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={handleUpload} disabled={uploading} />
          </label>
        )}
      </div>
      {items.length === 0 ? (
        <div className="border-2 border-dashed border-[var(--border)]/50 rounded-xl p-4 text-center text-[var(--fg-4)] text-sm">
          <ImageIcon className="w-6 h-6 mx-auto mb-1 opacity-30" />
          {t('attachments.none')}
        </div>
      ) : (
        <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
          {items.map(att => (
            <div key={att.id} className="rounded-xl overflow-hidden border border-[var(--border)]/50 bg-[var(--surface-2)] flex flex-col">
              <div className="relative group aspect-square">
                {isPdf(att.original_name) ? (
                  <button type="button" onClick={() => openFile(att.id)} className="w-full h-full flex flex-col items-center justify-center gap-1">
                    <FileText className="w-6 h-6 text-[var(--fg-4)]" />
                    <span className="text-[9px] text-[var(--fg-4)]">PDF</span>
                  </button>
                ) : (
                  <AuthImage attachmentId={att.id} alt={att.original_name} className="w-full h-full object-cover cursor-pointer" onClick={() => setPreviewId(att.id)} />
                )}
                <div className="absolute inset-0 bg-[var(--fg-1)]/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  {isPdf(att.original_name) ? (
                    <button onClick={() => openFile(att.id)} className="p-1.5 bg-[var(--surface-2)] rounded-lg hover:bg-[var(--surface-2)]">
                      <Download className="w-3.5 h-3.5 text-[var(--fg-1)]" />
                    </button>
                  ) : (
                    <button onClick={() => setPreviewId(att.id)} className="p-1.5 bg-[var(--surface-2)] rounded-lg hover:bg-[var(--surface-2)]">
                      <Eye className="w-3.5 h-3.5 text-[var(--fg-1)]" />
                    </button>
                  )}
                  {!readOnly && (
                    <button onClick={() => handleDelete(att.id)} className="p-1.5 bg-[var(--danger-soft)] rounded-lg hover:bg-red-500/50">
                      <Trash2 className="w-3.5 h-3.5 text-danger" />
                    </button>
                  )}
                </div>
              </div>
              <div className="px-1.5 py-1">
                <p className="text-[10px] text-[var(--fg-2)] truncate" title={att.original_name}>{att.original_name}</p>
                <p className="text-[9px] text-[var(--fg-4)] truncate">{formatSize(att.file_size)} · {(att.created_at || '').split('T')[0]}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {previewId && (
        <div className="fixed inset-0 bg-[var(--fg-1)]/90 z-[60] flex items-center justify-center p-4" onClick={() => setPreviewId(null)}>
          <button className="absolute top-4 right-4 p-2 bg-[var(--surface-2)] rounded-lg text-[var(--fg-1)] hover:bg-[var(--surface-2)]">
            <X className="w-5 h-5" />
          </button>
          <AuthImage attachmentId={previewId} alt="preview" className="max-w-full max-h-full rounded-xl object-contain" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}
