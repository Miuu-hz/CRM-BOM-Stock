import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Printer, Ban, Plus, ArrowRightLeft, Banknote, Wallet, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { printBill } from '../../utils/printBill'
import salesService, {
  type CustomerBuyback,
  type CustomerCredit,
  type CustomerOffset,
  type OpenInvoice,
} from '../../services/sales.service'
import { BuybackModal, type BuybackCustomer } from './BuybackModal'
import { CancelReasonModal, OffsetModal, RefundModal } from './OffsetRefundModal'

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
const fmtMoney = (n: number) => `฿${round2(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('th-TH') : '-')

export function CustomerCreditsTab({
  customer,
  onChanged,
}: {
  customer: BuybackCustomer
  onChanged?: () => void
}) {
  const { t } = useTranslation()
  const [credits, setCredits] = useState<CustomerCredit[]>([])
  const [buybacks, setBuybacks] = useState<CustomerBuyback[]>([])
  const [offsets, setOffsets] = useState<CustomerOffset[]>([])
  const [openInvoices, setOpenInvoices] = useState<OpenInvoice[]>([])
  const [loading, setLoading] = useState(true)

  const [showBuyback, setShowBuyback] = useState(false)
  const [offsetCreditId, setOffsetCreditId] = useState<string | null>(null)
  const [showOffset, setShowOffset] = useState(false)
  const [refundCreditId, setRefundCreditId] = useState<string | null>(null)
  const [showRefund, setShowRefund] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<{ kind: 'buyback' | 'offset'; id: string; number: string } | null>(null)

  const loadCredits = useCallback(async () => {
    setLoading(true)
    try {
      const res = await salesService.getCustomerCredits(customer.id, true)
      setCredits(res.credits)
      setBuybacks(res.buybacks)
      setOffsets(res.offsets)
      setOpenInvoices(res.openInvoices)
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t('crm.creditsTab.toast.loadFailed', { defaultValue: 'โหลดข้อมูลเครดิตไม่สำเร็จ' }))
    } finally {
      setLoading(false)
    }
  }, [customer.id, t])

  useEffect(() => {
    loadCredits()
  }, [loadCredits])

  const handleSaved = () => {
    loadCredits()
    onChanged?.()
  }

  const activeCredits = useMemo(() => credits.filter((c) => Number(c.balance) > 0.005), [credits])
  const totalBalance = useMemo(
    () => round2(activeCredits.reduce((s, c) => s + (Number(c.balance) || 0), 0)),
    [activeCredits],
  )

  const handlePrintBuyback = (bb: CustomerBuyback) => {
    printBill('bb', salesService.getBuyback(bb.id), 'a4').catch((err: any) => {
      toast.error(err?.message || 'พิมพ์ใบรับซื้อคืนไม่สำเร็จ')
    })
  }

  const handlePrintOffset = (off: CustomerOffset) => {
    printBill('of', salesService.getCustomerOffset(off.id), 'a4').catch((err: any) => {
      toast.error(err?.message || 'พิมพ์ใบหักกลบไม่สำเร็จ')
    })
  }

  const handleConfirmCancel = async (reason: string) => {
    if (!cancelTarget) return
    if (cancelTarget.kind === 'buyback') {
      await salesService.cancelBuyback(cancelTarget.id, reason)
      toast.success(t('crm.creditsTab.toast.buybackCancelled', { defaultValue: 'ยกเลิกใบรับซื้อคืนแล้ว' }))
    } else {
      await salesService.cancelCustomerOffset(cancelTarget.id, reason)
      toast.success(t('crm.creditsTab.toast.offsetCancelled', { defaultValue: 'ยกเลิกใบหักกลบแล้ว' }))
    }
    handleSaved()
  }

  return (
    <div className="space-y-5">
      {/* สรุปยอดเครดิต + ปุ่มดำเนินการ */}
      <div className="phopy-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-phopy-indigo/15 text-[var(--primary)] flex items-center justify-center shrink-0">
            <Wallet className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-[var(--fg-3)]">
              {t('crm.creditsTab.totalBalance', { defaultValue: 'ยอดเครดิตคงเหลือของลูกค้า' })}
            </p>
            <p className="text-xl font-bold text-[var(--primary)]">{fmtMoney(totalBalance)}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowBuyback(true)}
            className="phopy-btn-primary text-xs px-3 py-2 flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            {t('crm.creditsTab.actions.buyback', { defaultValue: 'รับซื้อคืน' })}
          </button>
          <button
            type="button"
            disabled={activeCredits.length === 0 || openInvoices.length === 0}
            onClick={() => { setOffsetCreditId(activeCredits[0]?.id || null); setShowOffset(true) }}
            className="phopy-btn-secondary text-xs px-3 py-2 flex items-center gap-1.5 disabled:opacity-40"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            {t('crm.creditsTab.actions.offset', { defaultValue: 'หักบิล' })}
          </button>
          <button
            type="button"
            disabled={activeCredits.length === 0}
            onClick={() => { setRefundCreditId(activeCredits[0]?.id || null); setShowRefund(true) }}
            className="phopy-btn-secondary text-xs px-3 py-2 flex items-center gap-1.5 disabled:opacity-40"
          >
            <Banknote className="w-3.5 h-3.5" />
            {t('crm.creditsTab.actions.refund', { defaultValue: 'จ่ายเงินคืน' })}
          </button>
          <button
            type="button"
            onClick={loadCredits}
            title="รีเฟรช"
            className="p-2 rounded-lg border border-[var(--border)] text-[var(--fg-3)] hover:text-[var(--fg-1)]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-center text-sm text-[var(--fg-3)] py-8">กำลังโหลดข้อมูล...</p>
      ) : (
        <>
          {/* ยอดเครดิตคงเหลือ */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-[var(--fg-1)]">
              {t('crm.creditsTab.creditsTitle', { defaultValue: 'เครดิตคงเหลือแยกตามเอกสาร' })}
            </h4>
            {credits.length === 0 ? (
              <p className="text-xs text-[var(--fg-4)] phopy-card p-4 text-center">ยังไม่มีรายการเครดิต</p>
            ) : (
              <div className="space-y-2">
                {credits.map((c) => {
                  const hasBal = Number(c.balance) > 0.005
                  return (
                    <div key={c.id} className="phopy-card p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                            c.source_type === 'BUYBACK' ? 'bg-teal-500/15 text-teal-400' : 'bg-orange-500/15 text-orange-400'
                          }`}>
                            {c.source_type === 'BUYBACK' ? 'รับซื้อคืน' : 'ใบลดหนี้'}
                          </span>
                          <span className="font-mono text-xs font-semibold text-[var(--fg-1)]">{c.source_number}</span>
                          <span className="text-[11px] text-[var(--fg-4)]">{fmtDate(c.created_at)}</span>
                        </div>
                        <p className="text-xs text-[var(--fg-3)] mt-1">
                          ตั้งต้น {fmtMoney(c.amount)} · คงเหลือ{' '}
                          <strong className={hasBal ? 'text-success' : 'text-[var(--fg-4)]'}>{fmtMoney(c.balance)}</strong>
                        </p>
                      </div>
                      {hasBal && (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={openInvoices.length === 0}
                            onClick={() => { setOffsetCreditId(c.id); setShowOffset(true) }}
                            className="px-2.5 py-1 rounded-lg bg-phopy-indigo/15 text-[var(--primary)] text-xs hover:bg-phopy-indigo/25 disabled:opacity-40"
                          >
                            หักบิล
                          </button>
                          <button
                            type="button"
                            onClick={() => { setRefundCreditId(c.id); setShowRefund(true) }}
                            className="px-2.5 py-1 rounded-lg bg-[var(--surface-2)] text-[var(--fg-2)] border border-[var(--border)] text-xs hover:text-[var(--fg-1)]"
                          >
                            จ่ายเงินคืน
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* รายการรับซื้อคืน */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-[var(--fg-1)]">
              {t('crm.creditsTab.buybacksTitle', { defaultValue: 'ประวัติใบรับซื้อคืนสินค้า' })}
            </h4>
            {buybacks.length === 0 ? (
              <p className="text-xs text-[var(--fg-4)] phopy-card p-4 text-center">ยังไม่มีประวัติรับซื้อคืน</p>
            ) : (
              <div className="space-y-2">
                {buybacks.map((bb) => {
                  const isCancelled = bb.status === 'CANCELLED'
                  return (
                    <div key={bb.id} className="phopy-card p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-semibold text-[var(--fg-1)]">{bb.bb_number}</span>
                          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                            isCancelled ? 'bg-[var(--danger-soft)] text-danger' : 'bg-[var(--success-soft)] text-success'
                          }`}>
                            {isCancelled ? 'ยกเลิก' : 'ยืนยันแล้ว'}
                          </span>
                          <span className="text-[11px] text-[var(--fg-4)]">{fmtDate(bb.buyback_date)}</span>
                          {bb.seller_vat ? (
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">
                              VAT {bb.tax_invoice_number ? `· ${bb.tax_invoice_number}` : ''}
                            </span>
                          ) : (
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--surface-2)] text-[var(--fg-4)]">ไม่มี VAT</span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--fg-3)] mt-1">
                          ยอดสุทธิ <strong className="text-[var(--fg-1)]">{fmtMoney(bb.total_amount)}</strong>
                          {bb.notes ? ` · ${bb.notes}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handlePrintBuyback(bb)}
                          className="px-2.5 py-1 rounded-lg border border-[var(--border)] text-xs text-[var(--fg-2)] hover:text-[var(--fg-1)] flex items-center gap-1"
                        >
                          <Printer className="w-3.5 h-3.5" /> พิมพ์
                        </button>
                        {!isCancelled && (
                          <button
                            type="button"
                            onClick={() => setCancelTarget({ kind: 'buyback', id: bb.id, number: bb.bb_number })}
                            className="px-2.5 py-1 rounded-lg bg-[var(--danger-soft)] text-danger text-xs hover:bg-red-500/20 flex items-center gap-1"
                          >
                            <Ban className="w-3.5 h-3.5" /> ยกเลิก
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* รายการหักกลบ / คืนเงิน */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-[var(--fg-1)]">
              {t('crm.creditsTab.offsetsTitle', { defaultValue: 'ประวัติการหักกลบ / จ่ายเงินคืน' })}
            </h4>
            {offsets.length === 0 ? (
              <p className="text-xs text-[var(--fg-4)] phopy-card p-4 text-center">ยังไม่มีรายการหักกลบหรือคืนเงิน</p>
            ) : (
              <div className="space-y-2">
                {offsets.map((off) => {
                  const isCancelled = off.status === 'CANCELLED'
                  return (
                    <div key={off.id} className="phopy-card p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-semibold text-[var(--fg-1)]">{off.offset_number}</span>
                          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                            off.kind === 'REFUND' ? 'bg-purple-500/15 text-purple-400' : 'bg-blue-500/15 text-blue-400'
                          }`}>
                            {off.kind === 'REFUND' ? 'จ่ายเงินคืน' : 'หักกลบบิล'}
                          </span>
                          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                            isCancelled ? 'bg-[var(--danger-soft)] text-danger' : 'bg-[var(--success-soft)] text-success'
                          }`}>
                            {isCancelled ? 'ยกเลิก' : 'ยืนยันแล้ว'}
                          </span>
                          <span className="text-[11px] text-[var(--fg-4)]">{fmtDate(off.offset_date)}</span>
                        </div>
                        <p className="text-xs text-[var(--fg-3)] mt-1">
                          ยอดรวม <strong className="text-[var(--fg-1)]">{fmtMoney(off.total_amount)}</strong>
                          {off.lines && off.lines.length > 0 && (
                            <> · {off.lines.map((l) => `${l.invoice_number || l.invoice_id} (${fmtMoney(l.amount)})`).join(', ')}</>
                          )}
                          {off.kind === 'REFUND' && off.payment_method ? ` · ${off.payment_method}` : ''}
                        </p>
                        {isCancelled && off.cancelled_reason && (
                          <p className="text-[11px] text-danger mt-0.5">เหตุผลยกเลิก: {off.cancelled_reason}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handlePrintOffset(off)}
                          className="px-2.5 py-1 rounded-lg border border-[var(--border)] text-xs text-[var(--fg-2)] hover:text-[var(--fg-1)] flex items-center gap-1"
                        >
                          <Printer className="w-3.5 h-3.5" /> พิมพ์
                        </button>
                        {!isCancelled && (
                          <button
                            type="button"
                            onClick={() => setCancelTarget({ kind: 'offset', id: off.id, number: off.offset_number })}
                            className="px-2.5 py-1 rounded-lg bg-[var(--danger-soft)] text-danger text-xs hover:bg-red-500/20 flex items-center gap-1"
                          >
                            <Ban className="w-3.5 h-3.5" /> ยกเลิก
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      {showBuyback && (
        <BuybackModal
          customer={customer}
          openInvoices={openInvoices}
          onClose={() => setShowBuyback(false)}
          onSaved={handleSaved}
        />
      )}

      {showOffset && (
        <OffsetModal
          customerId={customer.id}
          customerName={customer.name}
          initialCreditId={offsetCreditId || undefined}
          credits={activeCredits}
          openInvoices={openInvoices}
          onClose={() => setShowOffset(false)}
          onSaved={handleSaved}
        />
      )}

      {showRefund && (
        <RefundModal
          customerId={customer.id}
          customerName={customer.name}
          initialCreditId={refundCreditId || undefined}
          credits={activeCredits}
          onClose={() => setShowRefund(false)}
          onSaved={handleSaved}
        />
      )}

      {cancelTarget && (
        <CancelReasonModal
          title={cancelTarget.kind === 'buyback' ? 'ยกเลิกใบรับซื้อคืนสินค้า' : 'ยกเลิกใบหักกลบลบหนี้'}
          docNumber={cancelTarget.number}
          onClose={() => setCancelTarget(null)}
          onConfirm={handleConfirmCancel}
        />
      )}
    </div>
  )
}

export default CustomerCreditsTab
