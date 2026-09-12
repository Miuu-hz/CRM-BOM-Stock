import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShieldCheck, Clock, CheckCircle2, XCircle, AlertCircle,
  RefreshCw, X, ChevronRight, ChevronLeft, Inbox, FileCheck,
  History, Zap, Package, ShoppingCart, Receipt,
} from 'lucide-react'
import approvalService, { type ApprovalRequest, type ApprovalStatus, decidedBy } from '../services/approval.service'
import PurchaseOrderCompare from '../components/approval/PurchaseOrderCompare'

type Decision = 'APPROVED' | 'REJECTED'
type Tab = 'pending' | 'mine' | 'history'
type Preset = 'today' | '7d' | '30d' | 'custom'

const STATUS_CONFIG: Record<ApprovalStatus, { label: string; bg: string; text: string; icon: React.ElementType }> = {
  PENDING:  { label: 'รออนุมัติ',     bg: 'bg-amber-500/10',  text: 'text-amber-400',  icon: Clock },
  APPROVED: { label: 'อนุมัติแล้ว',   bg: 'bg-green-500/10',  text: 'text-green-400',  icon: CheckCircle2 },
  REJECTED: { label: 'ปฏิเสธแล้ว',   bg: 'bg-red-500/10',    text: 'text-red-400',    icon: XCircle },
  EXECUTED: { label: 'ดำเนินการแล้ว', bg: 'bg-blue-500/10',   text: 'text-blue-400',   icon: FileCheck },
  AUTO:     { label: 'ทำอัตโนมัติ',   bg: 'bg-purple-500/10', text: 'text-purple-400', icon: Zap },
}

// คีย์ต้องตรงกับ approval_requests.module_type ที่ backend เขียนจริง (ตัวพิมพ์เล็ก)
const MODULE_LABELS: Record<string, string> = {
  stock_adjust:      'ปรับ/เปลี่ยนสต็อก',
  pos_void:          'ยกเลิกบิล POS',
  doc_edit:          'แก้ไขเอกสารที่ออกแล้ว',
  purchase_request:  'ใบขอซื้อ',
  purchase_order:    'ใบสั่งซื้อ',
  sales_order:       'คำสั่งขาย',
  work_orders:       'ใบสั่งผลิต',
  stock_adjustments: 'ปรับสต็อก',
}

function fmt(amount: number) {
  if (!amount) return '—'
  return '฿' + amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(dateStr?: string) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
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

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function presetRange(preset: Preset): { from: string; to: string } {
  const to = todayStr()
  if (preset === 'today') return { from: to, to }
  const days = preset === '7d' ? 7 : 30
  const from = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10)
  return { from, to }
}

function StatusBadge({ status }: { status: ApprovalStatus }) {
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
  onConfirm: (comment: string) => void
  onCancel: () => void
  loading: boolean
}

function RejectModal({ request, onConfirm, onCancel, loading }: RejectModalProps) {
  const [comment, setComment] = useState('')
  return (
    <motion.div
      className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
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

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] text-[var(--fg-4)] uppercase tracking-wide">{label}</p>
      <p className="text-sm text-[var(--fg-1)] font-medium truncate">{value ?? '—'}</p>
    </div>
  )
}

/**
 * เอกสารต้นทางแบบอ่านอย่างเดียว — ไม่ได้ยกโค้ด render ของ Purchase.tsx มาใช้ซ้ำ
 * (ตัวนั้นผูกกับ state/handler ในไฟล์นั้นแน่นมาก และ Purchase.tsx อยู่นอกขอบเขตที่แก้ได้ในงานนี้)
 * ใช้ endpoint เดิมที่มีอยู่แล้วแทน: GET /purchase-orders/:id, /stock/:id, /pos/bills/:id
 */
function DocumentCard({ referenceType, doc }: { referenceType: string; doc: any }) {
  if (!doc) return null

  if (referenceType === 'purchase_orders') {
    return (
      <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 text-[var(--fg-2)]">
          <ShoppingCart className="w-4 h-4" />
          <span className="text-sm font-semibold text-[var(--fg-1)]">{doc.po_number}</span>
          <span className="text-xs px-2 py-0.5 bg-[var(--surface)] border border-[var(--border)] rounded text-[var(--fg-3)]">{doc.status}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Fact label="ผู้ขาย" value={doc.supplier_name} />
          <Fact label="วันที่สั่ง" value={doc.order_date?.slice(0, 10)} />
          <Fact label="กำหนดส่ง" value={doc.expected_date?.slice(0, 10)} />
          <Fact label="ยอดก่อนภาษี" value={fmt(doc.subtotal)} />
          <Fact label="ภาษี" value={fmt(doc.tax_amount)} />
          <Fact label="ยอดรวม" value={fmt(doc.total_amount)} />
        </div>
        {Array.isArray(doc.items) && doc.items.length > 0 && (
          <div className="border-t border-[var(--border)] pt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[var(--fg-4)] text-left">
                  <th className="pb-1 pr-2">รายการ</th>
                  <th className="pb-1 pr-2 text-right">จำนวน</th>
                  <th className="pb-1 pr-2 text-right">ราคา/หน่วย</th>
                  <th className="pb-1 text-right">รวม</th>
                </tr>
              </thead>
              <tbody>
                {doc.items.map((it: any) => (
                  <tr key={it.id} className="border-t border-[var(--border)]/50">
                    <td className="py-1 pr-2 text-[var(--fg-1)]">{it.description}</td>
                    <td className="py-1 pr-2 text-right text-[var(--fg-2)]">{it.quantity} {it.unit}</td>
                    <td className="py-1 pr-2 text-right text-[var(--fg-2)]">{fmt(it.unit_price)}</td>
                    <td className="py-1 text-right text-[var(--fg-1)] font-medium">{fmt(it.total_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  if (referenceType === 'stock_items' || referenceType === 'stock_adjustments') {
    return (
      <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 text-[var(--fg-2)]">
          <Package className="w-4 h-4" />
          <span className="text-sm font-semibold text-[var(--fg-1)]">{doc.name}</span>
          <span className="text-xs px-2 py-0.5 bg-[var(--surface)] border border-[var(--border)] rounded text-[var(--fg-3)]">{doc.sku}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Fact label="หมวดหมู่" value={doc.category} />
          <Fact label="คงเหลือ" value={`${doc.quantity} ${doc.unit}`} />
          <Fact label="สถานที่เก็บ" value={doc.location} />
          <Fact label="สต็อกต่ำสุด" value={doc.minStock} />
          <Fact label="ต้นทุน/หน่วย" value={fmt(doc.unitCost)} />
          <Fact label="ราคาขาย" value={fmt(doc.unitPrice)} />
        </div>
      </div>
    )
  }

  if (referenceType === 'pos_running_bills') {
    return (
      <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 text-[var(--fg-2)]">
          <Receipt className="w-4 h-4" />
          <span className="text-sm font-semibold text-[var(--fg-1)]">{doc.bill_number}</span>
          <span className="text-xs px-2 py-0.5 bg-[var(--surface)] border border-[var(--border)] rounded text-[var(--fg-3)]">{doc.status}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Fact label="ชื่อบิล" value={doc.display_name} />
          <Fact label="ลูกค้า" value={doc.customer_name} />
          <Fact label="ยอดรวม" value={fmt(doc.total_amount)} />
        </div>
        {Array.isArray(doc.items) && doc.items.length > 0 && (
          <div className="border-t border-[var(--border)] pt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[var(--fg-4)] text-left">
                  <th className="pb-1 pr-2">รายการ</th>
                  <th className="pb-1 pr-2 text-right">จำนวน</th>
                  <th className="pb-1 text-right">รวม</th>
                </tr>
              </thead>
              <tbody>
                {doc.items.map((it: any) => (
                  <tr key={it.id} className="border-t border-[var(--border)]/50">
                    <td className="py-1 pr-2 text-[var(--fg-1)]">{it.product_name}</td>
                    <td className="py-1 pr-2 text-right text-[var(--fg-2)]">{it.quantity}</td>
                    <td className="py-1 text-right text-[var(--fg-1)] font-medium">{fmt(it.total_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  return null
}

function fmtDiffValue(v: any): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function buildDiff(before: any, payload: any): { field: string; before: string; after: string }[] {
  if (!before && !payload) return []
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(payload || {})])
  const rows: { field: string; before: string; after: string }[] = []
  keys.forEach(k => {
    const b = before?.[k]
    const a = payload?.[k]
    if (JSON.stringify(b) === JSON.stringify(a)) return
    rows.push({ field: k, before: fmtDiffValue(b), after: fmtDiffValue(a) })
  })
  return rows
}

interface DetailModalProps {
  req: ApprovalRequest
  onApprove: () => void
  onReject: () => void
  actionLoading: boolean
  onClose: () => void
}

function DetailModal({ req, onApprove, onReject, actionLoading, onClose }: DetailModalProps) {
  const [loadingDetail, setLoadingDetail] = useState(true)
  const [payload, setPayload] = useState<any>(null)
  const [before, setBefore] = useState<any>(null)
  const [doc, setDoc] = useState<any>(null)

  useEffect(() => {
    let alive = true
    setLoadingDetail(true)
    Promise.all([
      approvalService.getDetail(req.id),
      approvalService.getSourceDocument(req.reference_type, req.reference_id),
    ]).then(([detail, document]) => {
      if (!alive) return
      setPayload(detail?.payload ?? null)
      setBefore(detail?.before ?? null)
      setDoc(document)
    }).finally(() => { if (alive) setLoadingDetail(false) })
    return () => { alive = false }
  }, [req.id, req.reference_type, req.reference_id])

  const diffRows = buildDiff(before, payload)
  // เทียบเต็มใบได้เฉพาะคำขอแก้เอกสาร — ปรับสต็อก/ยกเลิกบิลเป็น "การกระทำ" ไม่มีของเดิมให้เทียบ
  const isPoEdit = req.reference_type === 'purchase_orders' && !!before?.header && !!payload
  const decided = decidedBy(req)

  return (
    <motion.div
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-2xl"
        initial={{ scale: 0.95, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] sticky top-0 bg-[var(--surface)] z-10">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="font-mono text-xs font-bold text-[var(--primary)] bg-[var(--primary-soft)] px-2 py-0.5 rounded">
              {req.request_number}
            </span>
            <span className="text-xs px-2 py-0.5 bg-[var(--surface-2)] border border-[var(--border)] rounded text-[var(--fg-3)]">
              {MODULE_LABELS[req.module_type] ?? req.module_type}
            </span>
            <StatusBadge status={req.status} />
          </div>
          <button onClick={onClose} className="text-[var(--fg-3)] hover:text-[var(--fg-1)] transition-colors flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Fact label="ผู้ขอ" value={req.requester_name} />
            <Fact label="ตำแหน่ง" value={req.requester_role} />
            <Fact label="สร้างเมื่อ" value={fmtDate(req.created_at)} />
            {req.amount > 0 && <Fact label="จำนวนเงิน" value={fmt(req.amount)} />}
            {req.status !== 'PENDING' && decided.name && (
              <Fact label={req.status === 'AUTO' ? 'ทำโดย' : 'ผู้ตัดสินใจ'} value={`${decided.name}${decided.at ? ' · ' + fmtDate(decided.at) : ''}`} />
            )}
          </div>

          {req.description && (
            <p className="text-sm text-[var(--fg-2)] leading-relaxed bg-[var(--surface-2)] rounded-lg p-3">{req.description}</p>
          )}

          {loadingDetail ? (
            <div className="py-8 text-center text-[var(--fg-3)] text-sm">
              <div className="w-6 h-6 border-2 border-[var(--primary)]/30 border-t-[var(--primary)] rounded-full animate-spin mx-auto mb-2" />
              กำลังโหลดรายละเอียด...
            </div>
          ) : (
            <>
              {isPoEdit ? (
                /* ใบสั่งซื้อที่ขอแก้ไข: วาดใบเดียว (ฉบับหลังอนุมัติ) แล้วมาร์กจุดที่ต่าง
                   ในตัวเอกสารเลย — อ่านง่ายกว่าลิสต์ชื่อฟิลด์ดิบ ๆ และดูบนมือถือได้ */
                <PurchaseOrderCompare
                  poNumber={doc?.po_number || before?.header?.po_number}
                  before={before}
                  update={payload}
                />
              ) : (
                <DocumentCard referenceType={req.reference_type} doc={doc} />
              )}

              {!isPoEdit && diffRows.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wide">การเปลี่ยนแปลงที่ขอ</p>
                  <div className="border border-[var(--border)] rounded-lg overflow-hidden">
                    {diffRows.map((row, i) => (
                      <div key={row.field} className={`flex flex-wrap items-center gap-2 px-3 py-2 text-xs ${i > 0 ? 'border-t border-[var(--border)]' : ''}`}>
                        <span className="text-[var(--fg-3)] font-medium w-28 flex-shrink-0">{row.field}</span>
                        <span className="text-[var(--fg-3)] line-through">{row.before}</span>
                        <ChevronRight className="w-3 h-3 text-[var(--fg-4)] flex-shrink-0" />
                        <span className="text-[var(--fg-1)] font-semibold">{row.after}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[var(--border)] sticky bottom-0 bg-[var(--surface)]">
          {req.status === 'PENDING' ? (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors">
                ปิด
              </button>
              <button
                onClick={onReject}
                disabled={actionLoading}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-all disabled:opacity-40"
              >
                <XCircle className="w-4 h-4" /> ปฏิเสธ
              </button>
              <button
                onClick={onApprove}
                disabled={actionLoading}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 border border-green-500/20 transition-all disabled:opacity-40"
              >
                <CheckCircle2 className="w-4 h-4" /> อนุมัติ
              </button>
            </>
          ) : (
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors">
              ปิด
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

interface RequestRowProps {
  req: ApprovalRequest
  index: number
  clickable: boolean
  onOpen: () => void
  showActions: boolean
  actionLoading: boolean
  onApprove: () => void
  onReject: () => void
}

function RequestRow({ req, index, clickable, onOpen, showActions, actionLoading, onApprove, onReject }: RequestRowProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8 }}
      transition={{ delay: index * 0.03 }}
      onClick={clickable ? onOpen : undefined}
      className={`bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 transition-colors ${
        clickable ? 'hover:border-[var(--border-strong)] cursor-pointer' : ''
      }`}
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

        {showActions && (
          <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
            <button
              onClick={onReject}
              disabled={actionLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-all disabled:opacity-40"
            >
              <XCircle className="w-3.5 h-3.5" />
              ปฏิเสธ
            </button>
            <button
              onClick={onApprove}
              disabled={actionLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 border border-green-500/20 transition-all disabled:opacity-40"
            >
              {actionLoading ? (
                <div className="w-3.5 h-3.5 border border-green-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
              อนุมัติ
            </button>
          </div>
        )}
        {clickable && !showActions && (
          <ChevronRight className="w-4 h-4 text-[var(--fg-4)] flex-shrink-0 mt-1" />
        )}
      </div>
    </motion.div>
  )
}

const HISTORY_LIMIT = 20

export default function ApprovalInbox() {
  const [tab, setTab] = useState<Tab>('pending')
  const [pendingList, setPendingList] = useState<ApprovalRequest[]>([])
  const [myList, setMyList] = useState<ApprovalRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<ApprovalRequest | null>(null)
  const [detailReq, setDetailReq] = useState<ApprovalRequest | null>(null)

  // ── History tab: filters + paging ──────────────────────────────────────
  const [preset, setPreset] = useState<Preset>('7d')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [moduleFilter, setModuleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(0)
  const [historyList, setHistoryList] = useState<ApprovalRequest[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [pending, mine] = await Promise.all([
        approvalService.getPending(),
        approvalService.getMyRequests(),
      ])
      setPendingList(pending)
      setMyList(mine)
    } catch (e: any) {
      setError(e.response?.data?.message ?? 'โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const range = preset === 'custom' ? { from: dateFrom, to: dateTo } : presetRange(preset)
      const { data, total } = await approvalService.getHistory({
        from: range.from || undefined,
        to: range.to || undefined,
        moduleType: moduleFilter || undefined,
        status: statusFilter || undefined,
        limit: HISTORY_LIMIT,
        offset: page * HISTORY_LIMIT,
      })
      setHistoryList(data)
      setHistoryTotal(total)
    } finally {
      setHistoryLoading(false)
    }
  }, [preset, dateFrom, dateTo, moduleFilter, statusFilter, page])

  useEffect(() => { if (tab === 'history') loadHistory() }, [tab, loadHistory])
  // เปลี่ยนตัวกรองแล้วเด้งกลับหน้าแรกเสมอ กันเลื่อนหน้าค้างเกิน total ใหม่
  useEffect(() => { setPage(0) }, [preset, dateFrom, dateTo, moduleFilter, statusFilter])

  const handleDecision = async (req: ApprovalRequest, decision: Decision, comment = '') => {
    setActionLoading(req.id)
    try {
      await approvalService.decide(req.id, decision, comment)
      await load()
      if (tab === 'history') await loadHistory()
      setRejectTarget(null)
      setDetailReq(null)
    } catch (e: any) {
      setError(e.response?.data?.message ?? 'ดำเนินการไม่สำเร็จ')
    } finally {
      setActionLoading(null)
    }
  }

  const activeList = tab === 'pending' ? pendingList : tab === 'mine' ? myList : historyList
  const activeLoading = tab === 'history' ? historyLoading : loading

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
          onClick={() => (tab === 'history' ? loadHistory() : load())}
          disabled={activeLoading}
          className="flex items-center gap-2 px-3 py-2 text-sm border border-[var(--border)] rounded-lg text-[var(--fg-2)] hover:text-[var(--fg-1)] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${activeLoading ? 'animate-spin' : ''}`} />
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
        <div className="flex gap-2 border-b border-[var(--border)] overflow-x-auto">
          <button
            onClick={() => setTab('pending')}
            className={`relative flex items-center gap-2 px-4 py-3 text-sm font-semibold transition-colors whitespace-nowrap ${
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
            className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold transition-colors whitespace-nowrap ${
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
          <button
            onClick={() => setTab('history')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold transition-colors whitespace-nowrap ${
              tab === 'history'
                ? 'text-[var(--primary)] border-b-2 border-[var(--primary)]'
                : 'text-[var(--fg-3)] hover:text-[var(--fg-2)]'
            }`}
          >
            <History className="w-4 h-4" />
            ประวัติทั้งหมด
          </button>
        </div>
      </motion.div>

      {tab === 'history' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg p-1">
            {([
              { key: 'today', label: 'วันนี้' },
              { key: '7d', label: '7 วัน' },
              { key: '30d', label: '30 วัน' },
              { key: 'custom', label: 'กำหนดเอง' },
            ] as const).map(p => (
              <button
                key={p.key}
                onClick={() => setPreset(p.key)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  preset === p.key ? 'bg-[var(--primary)] text-white' : 'text-[var(--fg-3)] hover:text-[var(--fg-1)]'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {preset === 'custom' && (
            <div className="flex items-center gap-1.5 text-sm">
              <input
                type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)]"
              />
              <span className="text-[var(--fg-4)] text-xs">ถึง</span>
              <input
                type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
          )}

          <select
            value={moduleFilter}
            onChange={e => setModuleFilter(e.target.value)}
            className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--fg-2)] focus:outline-none focus:border-[var(--primary)]"
          >
            <option value="">ทุกประเภท</option>
            {Object.entries(MODULE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--fg-2)] focus:outline-none focus:border-[var(--primary)]"
          >
            <option value="">ทุกสถานะ</option>
            {(Object.keys(STATUS_CONFIG) as ApprovalStatus[]).map(s => (
              <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
            ))}
          </select>
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
        {activeLoading ? (
          <div className="py-20 text-center text-[var(--fg-3)]">
            <div className="w-8 h-8 border-2 border-[var(--primary)]/30 border-t-[var(--primary)] rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm">กำลังโหลด...</p>
          </div>
        ) : activeList.length === 0 ? (
          <div className="py-20 text-center text-[var(--fg-3)]">
            <ShieldCheck className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium text-[var(--fg-2)]">
              {tab === 'pending' ? 'ไม่มีรายการรออนุมัติ' : tab === 'mine' ? 'ยังไม่มีคำขอ' : 'ไม่พบรายการในช่วงที่เลือก'}
            </p>
            <p className="text-sm mt-1">
              {tab === 'pending' ? 'ทุกอย่างเรียบร้อยดี' : tab === 'mine' ? 'คำขอที่คุณสร้างจะแสดงที่นี่' : 'ลองปรับช่วงวันที่หรือตัวกรอง'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {activeList.map((req, i) => (
                <RequestRow
                  key={req.id}
                  req={req}
                  index={i}
                  clickable
                  onOpen={() => setDetailReq(req)}
                  showActions={tab === 'pending' && req.status === 'PENDING'}
                  actionLoading={actionLoading === req.id}
                  onApprove={() => handleDecision(req, 'APPROVED')}
                  onReject={() => setRejectTarget(req)}
                />
              ))}
            </AnimatePresence>
          </div>
        )}

        {tab === 'history' && historyTotal > 0 && (
          <div className="flex items-center justify-between mt-4 text-xs text-[var(--fg-3)]">
            <span>
              แสดง {page * HISTORY_LIMIT + 1}–{Math.min((page + 1) * HISTORY_LIMIT, historyTotal)} จาก {historyTotal} รายการ
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="p-1.5 border border-[var(--border)] rounded-lg text-[var(--fg-2)] hover:text-[var(--fg-1)] disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage(p => ((p + 1) * HISTORY_LIMIT < historyTotal ? p + 1 : p))}
                disabled={(page + 1) * HISTORY_LIMIT >= historyTotal}
                className="p-1.5 border border-[var(--border)] rounded-lg text-[var(--fg-2)] hover:text-[var(--fg-1)] disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </motion.div>

      <AnimatePresence>
        {rejectTarget && (
          <RejectModal
            request={rejectTarget}
            onConfirm={(comment) => handleDecision(rejectTarget, 'REJECTED', comment)}
            onCancel={() => setRejectTarget(null)}
            loading={actionLoading === rejectTarget.id}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {detailReq && (
          <DetailModal
            req={detailReq}
            actionLoading={actionLoading === detailReq.id}
            onApprove={() => handleDecision(detailReq, 'APPROVED')}
            onReject={() => setRejectTarget(detailReq)}
            onClose={() => setDetailReq(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
