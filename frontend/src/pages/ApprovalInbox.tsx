import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShieldCheck, Clock, CheckCircle2, XCircle, AlertCircle,
  RefreshCw, X, ChevronRight, Inbox, FileCheck,
} from 'lucide-react'
import api from '../services/api'

type Decision = 'APPROVED' | 'REJECTED'
type Status = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED'

interface ApprovalRequest {
  id: string
  request_number: string
  module_type: string
  reference_type: string
  reference_id: string
  reference_number?: string
  requester_name: string
  requester_role: string
  amount: number
  description: string
  status: Status
  approver_1_decision?: string
  approver_2_decision?: string
  created_at: string
  updated_at: string
}

const STATUS_CONFIG: Record<Status, { label: string; bg: string; text: string; icon: React.ElementType }> = {
  PENDING:  { label: 'รออนุมัติ',     bg: 'bg-amber-500/10',  text: 'text-amber-400',  icon: Clock },
  APPROVED: { label: 'อนุมัติแล้ว',   bg: 'bg-green-500/10',  text: 'text-green-400',  icon: CheckCircle2 },
  REJECTED: { label: 'ปฏิเสธแล้ว',   bg: 'bg-red-500/10',    text: 'text-red-400',    icon: XCircle },
  EXECUTED: { label: 'ดำเนินการแล้ว', bg: 'bg-blue-500/10',   text: 'text-blue-400',   icon: FileCheck },
}

const MODULE_LABELS: Record<string, string> = {
  PURCHASE:     'จัดซื้อ',
  SALES:        'ขาย',
  STOCK_ADJUST: 'ปรับสต็อก',
  WORK_ORDER:   'Work Order',
  PAYMENT:      'ชำระเงิน',
  RECEIPT:      'ใบรับสินค้า',
}

function fmt(amount: number) {
  if (!amount) return '—'
  return '฿' + amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'เมื่อกี้'
  if (m < 60) return `${m} นาทีที่แล้ว`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ชั่วโมงที่แล้ว`
  return `${Math.floor(h / 24)} วันที่แล้ว`
}

function StatusBadge({ status }: { status: Status }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.PENDING
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
      <Icon className="w-3.5 h-3.5" />
      {cfg.label}
    </span>
  )
}

interface RejectModalProps {
  request: ApprovalRequest
  level: 1 | 2
  onConfirm: (comment: string) => void
  onCancel: () => void
  loading: boolean
}

function RejectModal({ request, onConfirm, onCancel, loading }: RejectModalProps) {
  const [comment, setComment] = useState('')
  return (
    <motion.div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={e => e.target === e.currentTarget && onCancel()}
    >
      <motion.div
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-2xl"
        initial={{ scale: 0.95, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center">
              <XCircle className="w-4 h-4 text-red-400" />
            </div>
            <h3 className="font-semibold text-[var(--fg-1)]">ยืนยันการปฏิเสธ</h3>
          </div>
          <button onClick={onCancel} className="text-[var(--fg-3)] hover:text-[var(--fg-1)] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-[var(--surface-2)] rounded-lg p-3 text-sm">
            <p className="text-[var(--fg-3)] text-xs mb-1">เอกสาร</p>
            <p className="font-semibold text-[var(--fg-1)]">{request.request_number}</p>
            <p className="text-[var(--fg-2)] text-xs mt-0.5">{MODULE_LABELS[request.module_type] ?? request.module_type}</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--fg-3)] mb-1.5">
              เหตุผลการปฏิเสธ <span className="text-red-400">*</span>
            </label>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={3}
              className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--fg-1)] focus:outline-none focus:border-red-400 resize-none placeholder:text-[var(--fg-4)]"
              placeholder="ระบุเหตุผล..."
              autoFocus
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={onCancel}
              className="flex-1 py-2 text-sm border border-[var(--border)] rounded-lg text-[var(--fg-2)] hover:text-[var(--fg-1)] transition-colors"
            >
              ยกเลิก
            </button>
            <button
              onClick={() => onConfirm(comment)}
              disabled={loading || !comment.trim()}
              className="flex-1 py-2 text-sm bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors disabled:opacity-50 font-semibold"
            >
              {loading ? 'กำลังส่ง...' : 'ยืนยันปฏิเสธ'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

export default function ApprovalInbox() {
  const [tab, setTab] = useState<'pending' | 'mine'>('pending')
  const [pendingList, setPendingList] = useState<ApprovalRequest[]>([])
  const [myList, setMyList] = useState<ApprovalRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<{ req: ApprovalRequest; level: 1 | 2 } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [pendingRes, myRes] = await Promise.all([
        api.get('/approval/pending').catch(() => ({ data: { data: [] } })),
        api.get('/approval/my-requests').catch(() => ({ data: { data: [] } })),
      ])
      setPendingList(Array.isArray(pendingRes.data.data) ? pendingRes.data.data : [])
      setMyList(Array.isArray(myRes.data.data) ? myRes.data.data : [])
    } catch (e: any) {
      setError(e.response?.data?.message ?? 'โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleDecision = async (req: ApprovalRequest, decision: Decision, comment = '', level: 1 | 2 = 1) => {
    setActionLoading(req.id)
    try {
      await api.put(`/approval/requests/${req.id}/decision`, { decision, comment, level })
      await load()
      setRejectTarget(null)
    } catch (e: any) {
      setError(e.response?.data?.message ?? 'ดำเนินการไม่สำเร็จ')
    } finally {
      setActionLoading(null)
    }
  }

  const activeList = tab === 'pending' ? pendingList : myList

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-1)] flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-[var(--primary)]" />
            การอนุมัติ
          </h1>
          <p className="text-sm text-[var(--fg-3)] mt-1">จัดการคำขออนุมัติในระบบ</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm border border-[var(--border)] rounded-lg text-[var(--fg-2)] hover:text-[var(--fg-1)] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          รีเฟรช
        </button>
      </motion.div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-400 flex items-center justify-between">
          <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4" />{error}</span>
          <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
        </div>
      )}

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <div className="flex gap-2 border-b border-[var(--border)]">
          <button
            onClick={() => setTab('pending')}
            className={`relative flex items-center gap-2 px-4 py-3 text-sm font-semibold transition-colors ${
              tab === 'pending'
                ? 'text-[var(--primary)] border-b-2 border-[var(--primary)]'
                : 'text-[var(--fg-3)] hover:text-[var(--fg-2)]'
            }`}
          >
            <Inbox className="w-4 h-4" />
            รออนุมัติจากฉัน
            {pendingList.length > 0 && (
              <span className="px-1.5 py-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full leading-none">
                {pendingList.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab('mine')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold transition-colors ${
              tab === 'mine'
                ? 'text-[var(--primary)] border-b-2 border-[var(--primary)]'
                : 'text-[var(--fg-3)] hover:text-[var(--fg-2)]'
            }`}
          >
            <FileCheck className="w-4 h-4" />
            คำขอของฉัน
            {myList.length > 0 && (
              <span className="px-1.5 py-0.5 bg-[var(--surface-2)] text-[var(--fg-3)] text-[10px] font-bold rounded-full leading-none border border-[var(--border)]">
                {myList.length}
              </span>
            )}
          </button>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
        {loading ? (
          <div className="py-20 text-center text-[var(--fg-3)]">
            <div className="w-8 h-8 border-2 border-[var(--primary)]/30 border-t-[var(--primary)] rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm">กำลังโหลด...</p>
          </div>
        ) : activeList.length === 0 ? (
          <div className="py-20 text-center text-[var(--fg-3)]">
            <ShieldCheck className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium text-[var(--fg-2)]">
              {tab === 'pending' ? 'ไม่มีรายการรออนุมัติ' : 'ยังไม่มีคำขอ'}
            </p>
            <p className="text-sm mt-1">
              {tab === 'pending' ? 'ทุกอย่างเรียบร้อยดี' : 'คำขอที่คุณสร้างจะแสดงที่นี่'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {activeList.map((req, i) => (
                <motion.div
                  key={req.id}
                  layout
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8 }}
                  transition={{ delay: i * 0.03 }}
                  className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 hover:border-[var(--border-strong)] transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-mono text-xs font-bold text-[var(--primary)] bg-[var(--primary-soft)] px-2 py-0.5 rounded">
                          {req.request_number}
                        </span>
                        <span className="text-xs px-2 py-0.5 bg-[var(--surface-2)] border border-[var(--border)] rounded text-[var(--fg-3)]">
                          {MODULE_LABELS[req.module_type] ?? req.module_type}
                        </span>
                        <StatusBadge status={req.status} />
                      </div>
                      {req.description && (
                        <p className="text-sm text-[var(--fg-2)] mt-1 mb-2 line-clamp-2">{req.description}</p>
                      )}
                      <div className="flex items-center gap-4 text-xs text-[var(--fg-3)] flex-wrap">
                        <span className="flex items-center gap-1">
                          <span className="w-4 h-4 rounded-full bg-[var(--surface-2)] border border-[var(--border)] inline-flex items-center justify-center text-[9px] font-bold">
                            {req.requester_name?.charAt(0)?.toUpperCase()}
                          </span>
                          {req.requester_name}
                        </span>
                        {req.amount > 0 && (
                          <span className="font-semibold text-[var(--fg-1)]">{fmt(req.amount)}</span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {timeAgo(req.created_at)}
                        </span>
                      </div>
                    </div>

                    {tab === 'pending' && req.status === 'PENDING' && (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => setRejectTarget({ req, level: 1 })}
                          disabled={actionLoading === req.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-all disabled:opacity-40"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          ปฏิเสธ
                        </button>
                        <button
                          onClick={() => handleDecision(req, 'APPROVED', '', 1)}
                          disabled={actionLoading === req.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 border border-green-500/20 transition-all disabled:opacity-40"
                        >
                          {actionLoading === req.id ? (
                            <div className="w-3.5 h-3.5 border border-green-400 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          )}
                          อนุมัติ
                        </button>
                      </div>
                    )}
                    {tab === 'mine' && (
                      <ChevronRight className="w-4 h-4 text-[var(--fg-4)] flex-shrink-0 mt-1" />
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </motion.div>

      <AnimatePresence>
        {rejectTarget && (
          <RejectModal
            request={rejectTarget.req}
            level={rejectTarget.level}
            onConfirm={(comment) => handleDecision(rejectTarget.req, 'REJECTED', comment, rejectTarget.level)}
            onCancel={() => setRejectTarget(null)}
            loading={actionLoading === rejectTarget.req.id}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
