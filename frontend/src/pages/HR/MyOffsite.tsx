import { useState, useEffect, useCallback } from 'react'
import { MapPin, Plus, RefreshCw, Ban, AlertCircle, CheckCircle2, X, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import hrService, { OffsiteRequest, OffsiteStatus } from '../../services/hr.service'

// ponytail: local-time date string YYYY-MM-DD
const getTodayStr = () => {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const STATUS_LABELS: Record<OffsiteStatus, string> = {
  PENDING: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ไม่อนุมัติ',
  CANCELLED: 'ยกเลิกแล้ว',
}

const STATUS_BADGE: Record<OffsiteStatus, string> = {
  PENDING: 'bg-[var(--warning-soft)] text-[var(--warning-strong)]',
  APPROVED: 'bg-[var(--success-soft)] text-[var(--success)]',
  REJECTED: 'bg-[var(--danger-soft)] text-[var(--danger)]',
  CANCELLED: 'bg-[var(--surface-2)] text-[var(--fg-3)]',
}

interface MyOffsiteProps {
  className?: string
  defaultOpen?: boolean
}

export default function MyOffsite({ className, defaultOpen = false }: MyOffsiteProps) {
  const [requests, setRequests] = useState<OffsiteRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(defaultOpen)
  const [submitting, setSubmitting] = useState(false)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [modalError, setModalError] = useState<string | null>(null)
  const [cardError, setCardError] = useState<string | null>(null)
  const [successBanner, setSuccessBanner] = useState<string | null>(null)

  const [form, setForm] = useState({
    start_date: getTodayStr(),
    end_date: getTodayStr(),
    place: '',
    reason: '',
  })

  const loadRequests = useCallback(async () => {
    setLoading(true)
    try {
      const data = await hrService.getOffsiteRequests({ mine: 1 })
      setRequests(Array.isArray(data) ? data : [])
    } catch {
      setRequests([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadRequests()
  }, [loadRequests])

  const handleStartDateChange = (val: string) => {
    setForm((prev) => ({
      ...prev,
      start_date: val,
      // ponytail: if end_date before start_date or tracked start_date, advance it
      end_date: prev.end_date === prev.start_date || prev.end_date < val ? val : prev.end_date,
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setModalError(null)

    const placeTrimmed = form.place.trim()
    if (!placeTrimmed) {
      setModalError('กรุณาระบุสถานที่')
      return
    }

    if (form.start_date && form.end_date && form.start_date > form.end_date) {
      setModalError('วันเริ่มต้นต้องไม่มากกว่าวันสิ้นสุด')
      return
    }

    setSubmitting(true)
    try {
      await hrService.createOffsiteRequest({
        start_date: form.start_date,
        end_date: form.end_date || form.start_date,
        place: placeTrimmed,
        reason: form.reason.trim() || undefined,
      })
      setShowModal(false)
      const successMsg = 'ส่งคำขอแล้ว รอหัวหน้าอนุมัติ'
      setSuccessBanner(successMsg)
      toast.success(successMsg)
      setForm({
        start_date: getTodayStr(),
        end_date: getTodayStr(),
        place: '',
        reason: '',
      })
      await loadRequests()
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'ส่งคำขอไม่สำเร็จ'
      setModalError(msg)
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleCancel = async (id: string) => {
    if (!confirm('ต้องการยกเลิกคำขอนี้ใช่หรือไม่?')) return
    setCardError(null)
    setCancellingId(id)
    try {
      await hrService.cancelOffsiteRequest(id)
      toast.success('ยกเลิกคำขอเรียบร้อยแล้ว')
      await loadRequests()
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'ยกเลิกคำขอไม่สำเร็จ'
      setCardError(msg)
      toast.error(msg)
    } finally {
      setCancellingId(null)
    }
  }

  const handleCloseModal = () => {
    setShowModal(false)
    setModalError(null)
  }

  return (
    <>
      <div className={`bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 sm:p-6 shadow-sm space-y-4 ${className || ''}`}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
            <MapPin className="w-4 h-4 text-[var(--primary)]" />
            <span>ทำงานนอกสถานที่</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setModalError(null)
              setShowModal(true)
            }}
            className="phopy-btn-primary px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold flex items-center gap-1.5 min-h-[36px]"
          >
            <Plus className="w-4 h-4" />
            <span>ขอทำงานนอกสถานที่</span>
          </button>
        </div>

        {/* Success Banner */}
        {successBanner && (
          <div className="p-3.5 rounded-xl bg-[var(--success-soft)] border border-[var(--border)] text-[var(--success-strong)] text-xs sm:text-sm font-semibold text-center flex items-center justify-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successBanner}</span>
          </div>
        )}

        {/* Card Error Banner */}
        {cardError && (
          <div className="p-3.5 rounded-xl bg-[var(--danger-soft)] border border-[var(--border)] text-[var(--danger)] text-xs sm:text-sm font-medium flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{cardError}</span>
          </div>
        )}

        {/* Requests List */}
        <div className="space-y-3 pt-3 border-t border-[var(--border)]">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-[var(--fg-3)]">รายการคำขอของฉัน</div>
            {loading && <RefreshCw className="w-3.5 h-3.5 animate-spin text-[var(--fg-3)]" />}
          </div>

          {requests.length > 0 ? (
            <div className="space-y-2.5">
              {requests.map((req) => {
                const statusBadge = STATUS_BADGE[req.status] || 'bg-[var(--surface-2)] text-[var(--fg-3)]'
                const statusLabel = STATUS_LABELS[req.status] || req.status
                const canCancel = req.status === 'PENDING'

                return (
                  <div
                    key={req.id}
                    className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)]/30 space-y-2 text-xs sm:text-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-[var(--fg)]">
                        {req.place}
                      </div>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadge}`}>
                        {statusLabel}
                      </span>
                    </div>

                    <div className="text-[var(--fg-2)] flex flex-wrap gap-x-3 gap-y-1">
                      <span>
                        {req.start_date === req.end_date
                          ? req.start_date
                          : `${req.start_date} ถึง ${req.end_date}`}
                      </span>
                      {req.reason && (
                        <>
                          <span>·</span>
                          <span className="text-[var(--fg-3)] italic">"{req.reason}"</span>
                        </>
                      )}
                    </div>

                    {canCancel && (
                      <div className="pt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleCancel(req.id)}
                          disabled={cancellingId === req.id}
                          className="px-2.5 py-1 rounded-lg text-xs border border-[var(--border)] text-[var(--danger)] hover:bg-[var(--danger-soft)] transition flex items-center gap-1 min-h-[32px] disabled:opacity-50"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          <span>ยกเลิก</span>
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="py-4 text-center text-xs text-[var(--fg-3)]">
              ยังไม่มีคำขอทำงานนอกสถานที่
            </div>
          )}
        </div>
      </div>

      {/* Request Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/60 overflow-y-auto p-4 flex items-center justify-center">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 w-full max-w-md space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h3 className="font-bold text-base sm:text-lg text-[var(--fg)] flex items-center gap-2">
                <MapPin className="w-5 h-5 text-[var(--primary)]" />
                <span>ขอทำงานนอกสถานที่</span>
              </h3>
              <button
                type="button"
                onClick={handleCloseModal}
                className="p-1 rounded-lg text-[var(--fg-3)] hover:text-[var(--fg)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="p-3.5 rounded-xl bg-[var(--danger-soft)] border border-[var(--border)] text-[var(--danger)] text-xs sm:text-sm font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="offsite-start-date" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                    วันเริ่ม <span className="text-[var(--danger)]">*</span>
                  </label>
                  <input
                    id="offsite-start-date"
                    type="date"
                    value={form.start_date}
                    onChange={(e) => handleStartDateChange(e.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--fg)]"
                  />
                </div>
                <div>
                  <label htmlFor="offsite-end-date" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                    วันสิ้นสุด <span className="text-[var(--danger)]">*</span>
                  </label>
                  <input
                    id="offsite-end-date"
                    type="date"
                    value={form.end_date}
                    min={form.start_date}
                    onChange={(e) => setForm((prev) => ({ ...prev, end_date: e.target.value }))}
                    required
                    className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--fg)]"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="offsite-place" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  สถานที่ <span className="text-[var(--danger)]">*</span>
                </label>
                <input
                  id="offsite-place"
                  type="text"
                  value={form.place}
                  onChange={(e) => setForm((prev) => ({ ...prev, place: e.target.value }))}
                  placeholder="เช่น ไซต์งานลูกค้า A, ประชุมนอกสถานที่"
                  className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--fg)]"
                />
              </div>

              <div>
                <label htmlFor="offsite-reason" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  เหตุผล
                </label>
                <textarea
                  id="offsite-reason"
                  rows={2}
                  value={form.reason}
                  onChange={(e) => setForm((prev) => ({ ...prev, reason: e.target.value }))}
                  placeholder="ระบุเหตุผล (ถ้ามี)"
                  className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--fg)]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-4 py-2 rounded-xl text-sm border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="phopy-btn-primary px-5 py-2 rounded-xl text-sm font-semibold flex items-center gap-2"
                >
                  {submitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>กำลังส่ง...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>ส่งคำขอ</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
