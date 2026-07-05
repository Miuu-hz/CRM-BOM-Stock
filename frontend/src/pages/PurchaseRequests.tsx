import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
    ShoppingCart, RefreshCw, AlertCircle, CheckCircle, XCircle,
    Clock, ChevronRight, X, Check, MessageSquare, Package,
    FileText, Edit3, Loader2,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

// ─── Types ────────────────────────────────────────────────────────────────────
interface PRItem {
    id: string
    item_name: string
    material_id?: string
    quantity?: number
    unit?: string
    unit_price?: number
    sort_order: number
}

interface PR {
    id: string
    pr_number: string
    supplier_name: string
    status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED'
    source: string
    requester_name?: string
    requester_line_user_id?: string
    notes?: string
    rejection_reason?: string
    created_at: string
    updated_at: string
    items?: PRItem[]
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
    DRAFT:    'bg-[var(--surface-sunken)] text-[var(--fg-3)] border-[var(--border-strong)]',
    PENDING:  'bg-[var(--warning-soft)] text-warning border-warning/30',
    APPROVED: 'bg-[var(--success-soft)] text-success border-success/30',
    REJECTED: 'bg-[var(--danger-soft)] text-danger border-danger/30',
}

const STATUS_ICON: Record<string, JSX.Element> = {
    DRAFT:    <FileText className="w-3.5 h-3.5" />,
    PENDING:  <Clock className="w-3.5 h-3.5" />,
    APPROVED: <CheckCircle className="w-3.5 h-3.5" />,
    REJECTED: <XCircle className="w-3.5 h-3.5" />,
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function PurchaseRequests() {
    const { t } = useTranslation()
    const { user, isMaster } = useAuth()
    const canApprove = isMaster || user?.role === 'MANAGER'

    const statusLabelOf = (status: string) => {
        const labels: Record<string, string> = {
            DRAFT: t('purchaseRequests.status.draft'),
            PENDING: t('purchaseRequests.status.pending'),
            APPROVED: t('purchaseRequests.status.approved'),
            REJECTED: t('purchaseRequests.status.rejected'),
        }
        return labels[status] || status
    }

    const [list, setList]           = useState<PR[]>([])
    const [loading, setLoading]     = useState(true)
    const [tab, setTab]             = useState<string>('ALL')
    const [selected, setSelected]   = useState<PR | null>(null)
    const [detailLoading, setDetailLoading] = useState(false)

    // Detail form state
    const [items, setItems]           = useState<PRItem[]>([])
    const [rejectReason, setRejectReason] = useState('')
    const [showRejectForm, setShowRejectForm] = useState(false)
    const [submitting, setSubmitting] = useState(false)

    const TABS = ['ALL', 'DRAFT', 'PENDING', 'APPROVED', 'REJECTED']

    // ── Fetch list ────────────────────────────────────────────────────────────
    const fetchList = useCallback(async () => {
        setLoading(true)
        try {
            const params = tab !== 'ALL' ? `?status=${tab}` : ''
            const res = await api.get(`/purchase-requests${params}`)
            setList(res.data.data ?? [])
        } catch {
            toast.error(t('purchaseRequests.toast.loadFailed'))
        } finally {
            setLoading(false)
        }
    }, [tab])

    useEffect(() => { fetchList() }, [fetchList])

    // ── Open detail ───────────────────────────────────────────────────────────
    const openDetail = async (pr: PR) => {
        setSelected(pr)
        setShowRejectForm(false)
        setRejectReason('')
        setDetailLoading(true)
        try {
            const res = await api.get(`/purchase-requests/${pr.id}`)
            const full: PR = res.data.data
            setSelected(full)
            setItems((full.items ?? []).map(it => ({ ...it })))
        } catch {
            toast.error(t('purchaseRequests.toast.loadDetailFailed'))
        } finally {
            setDetailLoading(false)
        }
    }

    const closeDetail = () => {
        setSelected(null)
        setItems([])
        setShowRejectForm(false)
    }

    // ── Save items (DRAFT → PENDING) ──────────────────────────────────────────
    const handleSaveItems = async () => {
        if (!selected) return
        setSubmitting(true)
        try {
            await api.patch(`/purchase-requests/${selected.id}/items`, { items })
            toast.success(t('purchaseRequests.toast.submitSuccess'))
            closeDetail()
            fetchList()
        } catch (err: any) {
            toast.error(err?.response?.data?.message ?? t('purchaseRequests.toast.saveFailed'))
        } finally {
            setSubmitting(false)
        }
    }

    // ── Approve ───────────────────────────────────────────────────────────────
    const handleApprove = async () => {
        if (!selected) return
        setSubmitting(true)
        try {
            await api.post(`/purchase-requests/${selected.id}/approve`, {})
            toast.success(t('purchaseRequests.toast.approveSuccess'))
            closeDetail()
            fetchList()
        } catch (err: any) {
            toast.error(err?.response?.data?.message ?? t('purchaseRequests.toast.approveFailed'))
        } finally {
            setSubmitting(false)
        }
    }

    // ── Reject ────────────────────────────────────────────────────────────────
    const handleReject = async () => {
        if (!selected || !rejectReason.trim()) return
        setSubmitting(true)
        try {
            await api.post(`/purchase-requests/${selected.id}/reject`, { reason: rejectReason })
            toast.success(t('purchaseRequests.toast.rejectSuccess'))
            closeDetail()
            fetchList()
        } catch (err: any) {
            toast.error(err?.response?.data?.message ?? t('purchaseRequests.toast.rejectFailed'))
        } finally {
            setSubmitting(false)
        }
    }

    // ── Item helpers ──────────────────────────────────────────────────────────
    const updateItem = (idx: number, field: keyof PRItem, value: any) => {
        setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it))
    }

    const totalAmount = items.reduce((sum, it) => sum + ((it.quantity ?? 0) * (it.unit_price ?? 0)), 0)

    // ─────────────────────────────────────────────────────────────────────────
    return (
        <div className="space-y-6 p-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <ShoppingCart className="w-7 h-7 text-[var(--primary)]" />
                    <div>
                        <h1 className="text-2xl font-bold text-[var(--fg-1)]">{t('purchaseRequests.title')}</h1>
                        <p className="text-[var(--fg-3)] text-sm">{t('purchaseRequests.subtitle')}</p>
                    </div>
                </div>
                <button onClick={fetchList} className="phopy-btn-secondary flex items-center gap-2 text-sm">
                    <RefreshCw className="w-4 h-4" />
                    {t('purchaseRequests.refresh')}
                </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-[var(--surface-2)] rounded-lg p-1 w-fit">
                {TABS.map(tabKey => (
                    <button
                        key={tabKey}
                        onClick={() => setTab(tabKey)}
                        className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                            tab === tabKey
                                ? 'bg-phopy-indigo text-black'
                                : 'text-[var(--fg-3)] hover:text-[var(--fg-2)]'
                        }`}
                    >
                        {tabKey === 'ALL' ? t('purchaseRequests.tabs.all') : statusLabelOf(tabKey)}
                    </button>
                ))}
            </div>

            {/* List */}
            {loading ? (
                <div className="flex justify-center py-16">
                    <Loader2 className="w-8 h-8 text-[var(--primary)] animate-spin" />
                </div>
            ) : list.length === 0 ? (
                <div className="phopy-card p-12 text-center text-[var(--fg-4)]">
                    <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>{t('purchaseRequests.empty.title')}</p>
                </div>
            ) : (
                <div className="grid gap-3">
                    {list.map(pr => (
                        <motion.div
                            key={pr.id}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="phopy-card p-4 flex items-center justify-between cursor-pointer hover:border-phopy-indigo/50 transition-all"
                            onClick={() => openDetail(pr)}
                        >
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-lg bg-phopy-indigo/10 flex items-center justify-center">
                                    <MessageSquare className="w-5 h-5 text-[var(--primary)]" />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="font-semibold text-[var(--fg-1)]">{pr.pr_number}</span>
                                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs ${STATUS_COLOR[pr.status]}`}>
                                            {STATUS_ICON[pr.status]}
                                            {statusLabelOf(pr.status)}
                                        </span>
                                        {pr.source === 'LINE' && (
                                            <span className="px-1.5 py-0.5 rounded text-xs bg-[var(--success-soft)] text-success border border-green-500/30">LINE</span>
                                        )}
                                    </div>
                                    <p className="text-sm text-[var(--fg-3)] mt-0.5">
                                        {pr.supplier_name}
                                        {pr.requester_name ? ` · ${pr.requester_name}` : ''}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4 text-right">
                                <p className="text-xs text-[var(--fg-4)]">{new Date(pr.created_at).toLocaleDateString('th-TH')}</p>
                                <ChevronRight className="w-4 h-4 text-[var(--fg-4)]" />
                            </div>
                        </motion.div>
                    ))}
                </div>
            )}

            {/* Detail Drawer */}
            <AnimatePresence>
                {selected && (
                    <>
                        <motion.div
                            className="fixed inset-0 bg-[var(--fg-1)]/50 z-40"
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            onClick={closeDetail}
                        />
                        <motion.div
                            className="fixed right-0 top-0 h-full w-full max-w-xl bg-[var(--surface)] border-l border-[var(--border)] z-50 flex flex-col"
                            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
                            transition={{ type: 'tween', duration: 0.25 }}
                        >
                            {/* Drawer Header */}
                            <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
                                <div>
                                    <h2 className="font-bold text-[var(--fg-1)] text-lg">{selected.pr_number}</h2>
                                    <p className="text-sm text-[var(--fg-3)]">{selected.supplier_name}</p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs ${STATUS_COLOR[selected.status]}`}>
                                        {STATUS_ICON[selected.status]}
                                        {statusLabelOf(selected.status)}
                                    </span>
                                    <button onClick={closeDetail} className="text-[var(--fg-4)] hover:text-[var(--fg-2)] transition-colors">
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>

                            {/* Drawer Body */}
                            <div className="flex-1 overflow-y-auto p-5 space-y-5">
                                {detailLoading ? (
                                    <div className="flex justify-center py-12">
                                        <Loader2 className="w-7 h-7 text-[var(--primary)] animate-spin" />
                                    </div>
                                ) : (
                                    <>
                                        {/* Meta info */}
                                        <div className="grid grid-cols-2 gap-3 text-sm">
                                            {selected.requester_name && (
                                                <div className="bg-[var(--surface-2)] rounded-lg p-3 border border-[var(--border)]">
                                                    <p className="text-[var(--fg-4)] text-xs mb-1">{t('purchaseRequests.detail.requester')}</p>
                                                    <p className="text-[var(--fg-2)]">{selected.requester_name}</p>
                                                </div>
                                            )}
                                            <div className="bg-[var(--surface-2)] rounded-lg p-3 border border-[var(--border)]">
                                                <p className="text-[var(--fg-4)] text-xs mb-1">{t('purchaseRequests.detail.createdAt')}</p>
                                                <p className="text-[var(--fg-2)]">{new Date(selected.created_at).toLocaleDateString('th-TH')}</p>
                                            </div>
                                            <div className="bg-[var(--surface-2)] rounded-lg p-3 border border-[var(--border)]">
                                                <p className="text-[var(--fg-4)] text-xs mb-1">{t('purchaseRequests.detail.source')}</p>
                                                <p className="text-[var(--fg-2)]">{selected.source}</p>
                                            </div>
                                        </div>

                                        {/* Rejection reason */}
                                        {selected.status === 'REJECTED' && selected.rejection_reason && (
                                            <div className="p-3 bg-[var(--danger-soft)] border border-danger/30 rounded-lg text-sm text-danger flex gap-2">
                                                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                                <p>{t('purchaseRequests.detail.rejectionReason')} {selected.rejection_reason}</p>
                                            </div>
                                        )}

                                        {/* Items table */}
                                        <div>
                                            <div className="flex items-center gap-2 mb-3">
                                                <Edit3 className="w-4 h-4 text-[var(--primary)]" />
                                                <h3 className="font-medium text-[var(--fg-2)]">{t('purchaseRequests.detail.itemsTitle')}</h3>
                                                {['DRAFT', 'PENDING'].includes(selected.status) && (
                                                    <span className="text-xs text-[var(--fg-4)]">{t('purchaseRequests.detail.itemsHint')}</span>
                                                )}
                                            </div>

                                            <div className="space-y-2">
                                                {/* Column headers */}
                                                <div className="grid grid-cols-12 gap-1 text-xs text-[var(--fg-4)] px-1">
                                                    <span className="col-span-4">{t('purchaseRequests.detail.item')}</span>
                                                    <span className="col-span-2 text-center">{t('purchaseRequests.detail.quantity')}</span>
                                                    <span className="col-span-2 text-center">{t('purchaseRequests.detail.unit')}</span>
                                                    <span className="col-span-3 text-center">ราคา/{t('purchaseRequests.detail.unit')}</span>
                                                    <span className="col-span-1 text-right">รวม</span>
                                                </div>

                                                {items.map((it, idx) => {
                                                    const editable = ['DRAFT', 'PENDING'].includes(selected.status)
                                                    const lineTotal = (it.quantity ?? 0) * (it.unit_price ?? 0)
                                                    return (
                                                        <div key={it.id} className="grid grid-cols-12 gap-1 items-center bg-[var(--bg)]/30 rounded-lg p-2 border border-[var(--border)]/50">
                                                            <div className="col-span-4">
                                                                {editable ? (
                                                                    <input
                                                                        className="phopy-input w-full text-sm py-1 px-2"
                                                                        value={it.item_name}
                                                                        onChange={e => updateItem(idx, 'item_name', e.target.value)}
                                                                    />
                                                                ) : (
                                                                    <p className="text-[var(--fg-2)] text-sm truncate">{it.item_name}</p>
                                                                )}
                                                            </div>
                                                            <div className="col-span-2">
                                                                {editable ? (
                                                                    <input
                                                                        type="number" min="0"
                                                                        className="phopy-input w-full text-sm py-1 px-2 text-center"
                                                                        value={it.quantity ?? ''}
                                                                        onChange={e => updateItem(idx, 'quantity', e.target.value === '' ? undefined : Number(e.target.value))}
                                                                    />
                                                                ) : (
                                                                    <p className="text-center text-[var(--fg-2)] text-sm">{it.quantity ?? '-'}</p>
                                                                )}
                                                            </div>
                                                            <div className="col-span-2">
                                                                {editable ? (
                                                                    <input
                                                                        className="phopy-input w-full text-sm py-1 px-2 text-center"
                                                                        value={it.unit ?? ''}
                                                                        placeholder="{t('purchaseRequests.detail.unitPlaceholder')}"
                                                                        onChange={e => updateItem(idx, 'unit', e.target.value)}
                                                                    />
                                                                ) : (
                                                                    <p className="text-center text-[var(--fg-2)] text-sm">{it.unit ?? '-'}</p>
                                                                )}
                                                            </div>
                                                            <div className="col-span-3">
                                                                {editable ? (
                                                                    <input
                                                                        type="number" min="0"
                                                                        className="phopy-input w-full text-sm py-1 px-2 text-center"
                                                                        value={it.unit_price ?? ''}
                                                                        onChange={e => updateItem(idx, 'unit_price', e.target.value === '' ? undefined : Number(e.target.value))}
                                                                    />
                                                                ) : (
                                                                    <p className="text-center text-[var(--fg-2)] text-sm">{it.unit_price?.toLocaleString() ?? '-'}</p>
                                                                )}
                                                            </div>
                                                            <div className="col-span-1 text-right">
                                                                <p className="text-xs text-[var(--fg-3)]">
                                                                    {lineTotal > 0 ? lineTotal.toLocaleString() : '-'}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    )
                                                })}

                                                {/* Total */}
                                                {totalAmount > 0 && (
                                                    <div className="flex justify-end pt-2 border-t border-[var(--border)]">
                                                        <p className="text-sm text-[var(--fg-2)]">
                                                            {t('purchaseRequests.detail.totalAmount')} <span className="font-bold text-[var(--primary)] text-base ml-2">{totalAmount.toLocaleString()}{t('purchaseRequests.detail.currencySuffix')}</span>
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Reject form */}
                                        {showRejectForm && (
                                            <div className="space-y-2">
                                                <label className="text-sm text-[var(--fg-3)]">{t('purchaseRequests.rejectForm.title')}</label>
                                                <textarea
                                                    rows={3}
                                                    className="phopy-input w-full text-sm"
                                                    placeholder="{t('purchaseRequests.rejectForm.placeholder')}"
                                                    value={rejectReason}
                                                    onChange={e => setRejectReason(e.target.value)}
                                                />
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={handleReject}
                                                        disabled={!rejectReason.trim() || submitting}
                                                        className="flex-1 flex items-center justify-center gap-2 py-2 bg-[var(--danger-soft)] border border-danger/40 text-danger rounded-lg text-sm hover:bg-[var(--danger-soft)] transition-all disabled:opacity-50"
                                                    >
                                                        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                                                        {t('purchaseRequests.rejectForm.confirm')}
                                                    </button>
                                                    <button
                                                        onClick={() => setShowRejectForm(false)}
                                                        className="px-4 py-2 border border-[var(--border)] text-[var(--fg-3)] rounded-lg text-sm hover:text-[var(--fg-2)] transition-all"
                                                    >
                                                        {t('purchaseRequests.rejectForm.cancel')}
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>

                            {/* Drawer Footer */}
                            {!detailLoading && (
                                <div className="p-5 border-t border-[var(--border)] space-y-2">
                                    {/* DRAFT: fill items → submit for approval */}
                                    {selected.status === 'DRAFT' && (
                                        <button
                                            onClick={handleSaveItems}
                                            disabled={submitting}
                                            className="w-full phopy-btn-primary flex items-center justify-center gap-2"
                                        >
                                            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                            {t('purchaseRequests.actions.saveSubmit')}
                                        </button>
                                    )}

                                    {/* PENDING: update items or approve/reject */}
                                    {selected.status === 'PENDING' && (
                                        <>
                                            <button
                                                onClick={handleSaveItems}
                                                disabled={submitting}
                                                className="w-full flex items-center justify-center gap-2 py-2 border border-[var(--border)] text-[var(--fg-2)] rounded-lg text-sm hover:text-[var(--fg-1)] hover:border-phopy-indigo/50 transition-all disabled:opacity-50"
                                            >
                                                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Edit3 className="w-4 h-4" />}
                                                อัพเดท{t('purchaseRequests.detail.item')}
                                            </button>
                                            {canApprove && !showRejectForm && (
                                                <div className="grid grid-cols-2 gap-2">
                                                    <button
                                                        onClick={handleApprove}
                                                        disabled={submitting}
                                                        className="flex items-center justify-center gap-2 py-2.5 bg-[var(--success-soft)] border border-success/40 text-success rounded-lg text-sm hover:bg-success/30 transition-all disabled:opacity-50"
                                                    >
                                                        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                                        อนุมัติ
                                                    </button>
                                                    <button
                                                        onClick={() => setShowRejectForm(true)}
                                                        className="flex items-center justify-center gap-2 py-2.5 bg-[var(--danger-soft)] border border-danger/40 text-danger rounded-lg text-sm hover:bg-[var(--danger-soft)] transition-all"
                                                    >
                                                        <XCircle className="w-4 h-4" />
                                                        ปฏิเสธ
                                                    </button>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    )
}
