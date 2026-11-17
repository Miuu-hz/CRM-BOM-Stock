import { useState, useEffect, useCallback } from 'react'
import { MapPin } from 'lucide-react'
import toast from 'react-hot-toast'
import hrService, { OffsiteRequest, OffsiteStatus } from '../../services/hr.service'

const STATUS_LABELS: Record<OffsiteStatus, string> = {
  PENDING: 'รออนุมัติ',
  APPROVED: 'อนุมัติ',
  REJECTED: 'ไม่อนุมัติ',
  CANCELLED: 'ยกเลิก',
}

const STATUS_BADGE: Record<OffsiteStatus, string> = {
  PENDING: 'bg-[var(--warning-soft)] text-[var(--warning-strong)]',
  APPROVED: 'bg-[var(--success-soft)] text-[var(--success)]',
  REJECTED: 'bg-[var(--danger-soft)] text-[var(--danger)]',
  CANCELLED: 'bg-[var(--surface-2)] text-[var(--fg-3)]',
}

const FILTER_OPTIONS: Array<{ value: '' | OffsiteStatus; label: string }> = [
  { value: '', label: 'ทั้งหมด' },
  { value: 'PENDING', label: 'รออนุมัติ' },
  { value: 'APPROVED', label: 'อนุมัติ' },
  { value: 'REJECTED', label: 'ไม่อนุมัติ' },
  { value: 'CANCELLED', label: 'ยกเลิก' },
]

export default function OffsiteList() {
  const [requests, setRequests] = useState<OffsiteRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [filterStatus, setFilterStatus] = useState<string>('')

  const loadRequests = useCallback(async () => {
    setLoading(true)
    try {
      const params = filterStatus ? { status: filterStatus as OffsiteStatus } : {}
      const list = await hrService.getOffsiteRequests(params)
      setRequests(Array.isArray(list) ? list : [])
    } catch {
      setRequests([])
    } finally {
      setLoading(false)
    }
  }, [filterStatus])

  useEffect(() => {
    loadRequests()
  }, [loadRequests])

  const handleCancel = async (id: string) => {
    if (!window.confirm('ยืนยันยกเลิกคำขอนี้?')) return
    try {
      await hrService.cancelOffsiteRequest(id)
      toast.success('ยกเลิกคำขอสำเร็จ')
      loadRequests()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'ยกเลิกคำขอไม่สำเร็จ')
    }
  }

  return (
    <div className="space-y-4 pt-6 border-t border-[var(--border)]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[var(--primary-soft)] text-[var(--primary)]">
            <MapPin className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-[var(--fg)]">ทำงานนอกสถานที่</h2>
            <p className="text-sm text-[var(--fg-3)]">
              รายการคำขอทำงานนอกสถานที่ของพนักงานทั้งร้าน
            </p>
          </div>
        </div>
      </div>

      {/* Filter */}
      <div className="phopy-card p-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-[var(--fg-3)] mr-1">สถานะ:</span>
        {FILTER_OPTIONS.map((opt) => {
          const active = filterStatus === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={active}
              onClick={() => setFilterStatus(opt.value)}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium transition ${
                active
                  ? 'bg-[var(--primary)] text-white'
                  : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)] border border-[var(--border)]'
              }`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>

      {/* Table */}
      <div className="phopy-card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--fg-3)]">กำลังโหลดรายการ...</div>
        ) : requests.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--fg-3)]">ยังไม่มีคำขอ</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="phopy-table w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[var(--fg-3)]">
                  <th className="py-2.5 px-3">พนักงาน</th>
                  <th className="py-2.5 px-3">ช่วงวัน</th>
                  <th className="py-2.5 px-3">สถานที่</th>
                  <th className="py-2.5 px-3">เหตุผล</th>
                  <th className="py-2.5 px-3 text-center">สถานะ</th>
                  <th className="py-2.5 px-3 text-center">การกระทำ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {requests.map((r) => (
                  <tr key={r.id} className="hover:bg-[var(--surface-2)]/60">
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-[var(--fg-1)]">{r.employee_name}</div>
                      <div className="text-[11px] text-[var(--fg-3)]">{r.employee_code}</div>
                    </td>
                    <td className="py-2.5 px-3 text-[var(--fg-2)] font-mono">
                      {r.start_date === r.end_date ? r.start_date : `${r.start_date} ถึง ${r.end_date}`}
                    </td>
                    <td className="py-2.5 px-3 text-[var(--fg-2)]">{r.place}</td>
                    <td className="py-2.5 px-3 text-[var(--fg-2)] max-w-xs truncate" title={r.reason || ''}>
                      {r.reason || '-'}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${
                          STATUS_BADGE[r.status] || 'bg-[var(--surface-2)] text-[var(--fg-3)]'
                        }`}
                      >
                        {STATUS_LABELS[r.status] || r.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      {r.status === 'PENDING' || r.status === 'APPROVED' ? (
                        <button
                          type="button"
                          onClick={() => handleCancel(r.id)}
                          className="text-xs text-[var(--danger)] hover:underline font-medium"
                        >
                          ยกเลิก
                        </button>
                      ) : (
                        <span className="text-[var(--fg-3)]">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export { OffsiteList }
