import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, CheckCircle, Sparkles, Ban } from 'lucide-react'
import toast from 'react-hot-toast'
import { useModalClose } from '../../hooks/useModalClose'
import bankAccountsService, { type BankAccount } from '../../services/bankAccounts.service'
import salesService, { type CustomerCredit, type OpenInvoice } from '../../services/sales.service'
import { todayBangkokStr } from './BuybackModal'

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
const fmtMoney = (n: number) => `฿${round2(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const sourceLabel = (c: CustomerCredit) =>
  `${c.source_type === 'BUYBACK' ? 'รับซื้อคืน' : 'ใบลดหนี้'} ${c.source_number} (คงเหลือ ${fmtMoney(c.balance)})`

// ─── OffsetModal ──────────────────────────────────────────────────────────────
export function OffsetModal({
  customerId,
  customerName,
  initialCreditId,
  credits: propCredits,
  openInvoices: propInvoices,
  onClose,
  onSaved,
}: {
  customerId: string
  customerName?: string
  initialCreditId?: string
  credits?: CustomerCredit[]
  openInvoices?: OpenInvoice[]
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  useModalClose(onClose)

  const [credits, setCredits] = useState<CustomerCredit[]>(propCredits ?? [])
  const [invoices, setInvoices] = useState<OpenInvoice[]>(propInvoices ?? [])
  const [loading, setLoading] = useState(propCredits === undefined || propInvoices === undefined)

  const [creditId, setCreditId] = useState(initialCreditId || '')
  const [date, setDate] = useState(todayBangkokStr)
  const [notes, setNotes] = useState('')
  const [applyMap, setApplyMap] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (propCredits !== undefined && propInvoices !== undefined) {
      setCredits(propCredits.filter((c) => Number(c.balance) > 0.005))
      setInvoices(propInvoices)
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    salesService.getCustomerCredits(customerId)
      .then((res) => {
        if (!alive) return
        setCredits((res.credits || []).filter((c) => Number(c.balance) > 0.005))
        setInvoices(res.openInvoices || [])
      })
      .catch(() => { if (alive) { setCredits([]); setInvoices([]) } })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [customerId, propCredits, propInvoices])

  useEffect(() => {
    if (!creditId && credits.length > 0) {
      setCreditId(credits[0].id)
    }
  }, [creditId, credits])

  const selectedCredit = useMemo(() => credits.find((c) => c.id === creditId), [credits, creditId])
  const creditBalance = round2(Number(selectedCredit?.balance ?? 0))

  const appliedTotal = useMemo(
    () => round2(invoices.reduce((s, inv) => s + (parseFloat(applyMap[inv.id] || '0') || 0), 0)),
    [invoices, applyMap],
  )
  const remainingCredit = round2(Math.max(0, creditBalance - appliedTotal))

  const handleAutoFill = () => {
    const sorted = [...invoices].sort((a, b) =>
      String(a.invoice_date || '').localeCompare(String(b.invoice_date || '')),
    )
    let remaining = creditBalance
    const next: Record<string, string> = {}
    for (const inv of sorted) {
      if (remaining <= 0.005) break
      const bal = Math.max(0, Number(inv.balance_amount) || 0)
      if (bal <= 0) continue
      const take = round2(Math.min(bal, remaining))
      if (take > 0) {
        next[inv.id] = String(take)
        remaining = round2(remaining - take)
      }
    }
    setApplyMap(next)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!creditId || !selectedCredit) {
      toast.error(t('crm.creditsTab.validation.creditRequired', { defaultValue: 'กรุณาเลือกรายการเครดิต' }))
      return
    }
    const lines: Array<{ invoiceId: string; amount: number }> = []
    for (const inv of invoices) {
      const raw = applyMap[inv.id]
      if (!raw) continue
      const amt = round2(parseFloat(raw) || 0)
      if (amt <= 0) continue
      if (amt > (Number(inv.balance_amount) || 0) + 0.005) {
        toast.error(`ยอดหักบิล ${inv.invoice_number} เกินยอดค้างชำระ`)
        return
      }
      lines.push({ invoiceId: inv.id, amount: amt })
    }
    if (lines.length === 0) {
      toast.error(t('crm.creditsTab.validation.offsetLinesRequired', { defaultValue: 'กรุณาระบุยอดหักอย่างน้อย 1 ใบแจ้งหนี้' }))
      return
    }
    if (appliedTotal > creditBalance + 0.005) {
      toast.error(t('crm.creditsTab.validation.offsetExceedsBalance', { defaultValue: 'ยอดหักรวมเกินเครดิตคงเหลือ' }))
      return
    }

    setSaving(true)
    try {
      await salesService.applyCustomerOffset({
        creditId,
        date,
        lines,
        notes: notes.trim() || undefined,
      })
      toast.success(t('crm.creditsTab.toast.offsetCreated', { defaultValue: 'หักกลบบิลสำเร็จ' }))
      onSaved()
      onClose()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t('crm.creditsTab.toast.offsetFailed', { defaultValue: 'หักกลบบิลไม่สำเร็จ' }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="หักกลบใบแจ้งหนี้ด้วยเครดิตลูกค้า"
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-t-2xl sm:rounded-2xl w-full max-w-2xl flex flex-col max-h-[calc(100dvh-0.5rem)] sm:max-h-[calc(100vh-2rem)] shadow-2xl"
      >
        <div className="px-4 py-3 sm:px-5 sm:py-4 border-b border-[var(--border)] flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-bold text-[var(--fg-1)] truncate">หักกลบใบแจ้งหนี้ด้วยเครดิต</h2>
            {customerName && <p className="text-xs text-[var(--fg-3)] truncate">{customerName}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="close" className="p-2 rounded-lg hover:bg-[var(--bg)] text-[var(--fg-3)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="overflow-y-auto px-4 py-4 sm:px-5 space-y-4 flex-1 min-h-0">
            {loading ? (
              <p className="text-center text-xs text-[var(--fg-4)] py-6">กำลังโหลดข้อมูล...</p>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--fg-3)] mb-1">แหล่งเครดิต *</label>
                    <select
                      value={creditId}
                      onChange={(e) => { setCreditId(e.target.value); setApplyMap({}) }}
                      className="phopy-input w-full"
                      required
                    >
                      <option value="">-- เลือกเครดิต --</option>
                      {credits.map((c) => (
                        <option key={c.id} value={c.id}>{sourceLabel(c)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--fg-3)] mb-1">วันที่หักกลบ *</label>
                    <input
                      type="date"
                      value={date}
                      max={todayBangkokStr()}
                      onChange={(e) => setDate(e.target.value)}
                      className="phopy-input w-full"
                      required
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--border)] p-3 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-[var(--fg-1)]">
                      ใบแจ้งหนี้ค้างชำระ (เครดิตที่ใช้ได้: {fmtMoney(creditBalance)})
                    </span>
                    {invoices.length > 0 && creditBalance > 0 && (
                      <button
                        type="button"
                        onClick={handleAutoFill}
                        className="px-3 py-1.5 rounded-lg bg-phopy-indigo/15 text-[var(--primary)] border border-phopy-indigo/30 hover:bg-phopy-indigo/25 text-xs font-medium flex items-center gap-1.5"
                      >
                        <Sparkles className="w-3.5 h-3.5" /> เติมอัตโนมัติ
                      </button>
                    )}
                  </div>

                  {invoices.length === 0 ? (
                    <p className="text-xs text-[var(--fg-4)] py-2">ไม่มีใบแจ้งหนี้ค้างชำระ</p>
                  ) : (
                    <div className="space-y-2 max-h-56 overflow-y-auto">
                      {invoices.map((inv) => {
                        const bal = Math.max(0, Number(inv.balance_amount) || 0)
                        return (
                          <div key={inv.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-lg bg-[var(--surface-2)]/60 border border-[var(--border)]/50">
                            <div className="min-w-0">
                              <p className="text-xs font-mono font-semibold text-[var(--fg-1)]">{inv.invoice_number}</p>
                              <p className="text-[11px] text-[var(--fg-4)]">
                                วันที่ {inv.invoice_date?.slice(0, 10) || '-'} · ค้างชำระ {fmtMoney(bal)}
                              </p>
                            </div>
                            <input
                              type="number"
                              min="0"
                              max={bal}
                              step="0.01"
                              value={applyMap[inv.id] ?? ''}
                              onChange={(e) => {
                                const v = e.target.value
                                if (v === '' || (Number.isFinite(parseFloat(v)) && parseFloat(v) >= 0)) {
                                  setApplyMap((prev) => ({ ...prev, [inv.id]: v }))
                                }
                              }}
                              placeholder="0.00"
                              className="w-28 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2 py-1 text-right text-sm text-[var(--fg-1)]"
                            />
                          </div>
                        )
                      })}
                    </div>
                  )}

                  <div className="flex flex-wrap justify-between gap-2 pt-2 border-t border-[var(--border)]/60 text-xs">
                    <span className="text-[var(--fg-3)]">รวมยอดหักบิล: <strong className="text-[var(--fg-1)]">{fmtMoney(appliedTotal)}</strong></span>
                    <span className="text-[var(--fg-3)]">เครดิตคงเหลือหลังหัก: <strong className="text-success">{fmtMoney(remainingCredit)}</strong></span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1">หมายเหตุ</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="หมายเหตุ (ถ้ามี)"
                    className="phopy-input w-full"
                  />
                </div>
              </>
            )}
          </div>

          <div className="px-4 py-3 sm:px-5 sm:py-4 border-t border-[var(--border)] shrink-0 flex flex-wrap justify-end gap-2 bg-[var(--surface)]">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--fg-3)]">
              {t('common.cancel', { defaultValue: 'ยกเลิก' })}
            </button>
            <button
              type="submit"
              disabled={saving || loading || credits.length === 0 || invoices.length === 0}
              className="phopy-btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50"
            >
              {saving ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              {saving ? 'กำลังบันทึก...' : 'ยืนยันหักกลบ'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── RefundModal ──────────────────────────────────────────────────────────────
export function RefundModal({
  customerId,
  customerName,
  initialCreditId,
  credits: propCredits,
  onClose,
  onSaved,
}: {
  customerId: string
  customerName?: string
  initialCreditId?: string
  credits?: CustomerCredit[]
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  useModalClose(onClose)

  const [credits, setCredits] = useState<CustomerCredit[]>(propCredits ?? [])
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [loading, setLoading] = useState(propCredits === undefined)

  const [creditId, setCreditId] = useState(initialCreditId || '')
  const [date, setDate] = useState(todayBangkokStr)
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('TRANSFER')
  const [bankAccountId, setBankAccountId] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    bankAccountsService.list().then((rows) => { if (alive) setBankAccounts(rows || []) }).catch(() => {})
    if (propCredits !== undefined) {
      setCredits(propCredits.filter((c) => Number(c.balance) > 0.005))
      setLoading(false)
      return () => { alive = false }
    }
    setLoading(true)
    salesService.getCustomerCredits(customerId)
      .then((res) => { if (alive) setCredits((res.credits || []).filter((c) => Number(c.balance) > 0.005)) })
      .catch(() => { if (alive) setCredits([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [customerId, propCredits])

  useEffect(() => {
    if (!creditId && credits.length > 0) {
      setCreditId(credits[0].id)
      setAmount(String(round2(Number(credits[0].balance))))
    } else if (creditId && !amount) {
      const found = credits.find((c) => c.id === creditId)
      if (found) setAmount(String(round2(Number(found.balance))))
    }
  }, [creditId, credits, amount])

  const selectedCredit = credits.find((c) => c.id === creditId)
  const maxBalance = round2(Number(selectedCredit?.balance ?? 0))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!creditId || !selectedCredit) {
      toast.error('กรุณาเลือกรายการเครดิต')
      return
    }
    const amt = round2(parseFloat(amount) || 0)
    if (!(amt > 0)) {
      toast.error('จำนวนเงินต้องมากกว่า 0')
      return
    }
    if (amt > maxBalance + 0.005) {
      toast.error('จำนวนเงินคืนเกินยอดเครดิตคงเหลือ')
      return
    }

    setSaving(true)
    try {
      await salesService.refundCustomerCredit({
        creditId,
        date,
        amount: amt,
        paymentMethod,
        bankAccountId: paymentMethod === 'CASH' ? undefined : (bankAccountId || undefined),
        notes: notes.trim() || undefined,
      })
      toast.success(t('crm.creditsTab.toast.refundCreated', { defaultValue: 'บันทึกจ่ายเงินคืนสำเร็จ' }))
      onSaved()
      onClose()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t('crm.creditsTab.toast.refundFailed', { defaultValue: 'บันทึกจ่ายเงินคืนไม่สำเร็จ' }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="จ่ายเงินคืนเครดิตลูกค้า"
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-t-2xl sm:rounded-2xl w-full max-w-lg flex flex-col max-h-[calc(100dvh-0.5rem)] sm:max-h-[calc(100vh-2rem)] shadow-2xl"
      >
        <div className="px-4 py-3 sm:px-5 sm:py-4 border-b border-[var(--border)] flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-bold text-[var(--fg-1)] truncate">จ่ายเงินคืนลูกค้า</h2>
            {customerName && <p className="text-xs text-[var(--fg-3)] truncate">{customerName}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="close" className="p-2 rounded-lg hover:bg-[var(--bg)] text-[var(--fg-3)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="overflow-y-auto px-4 py-4 sm:px-5 space-y-4 flex-1 min-h-0">
            {loading ? (
              <p className="text-center text-xs text-[var(--fg-4)] py-6">กำลังโหลดข้อมูล...</p>
            ) : (
              <>
                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1">แหล่งเครดิต *</label>
                  <select
                    value={creditId}
                    onChange={(e) => {
                      const id = e.target.value
                      setCreditId(id)
                      const c = credits.find((x) => x.id === id)
                      if (c) setAmount(String(round2(Number(c.balance))))
                    }}
                    className="phopy-input w-full"
                    required
                  >
                    <option value="">-- เลือกเครดิต --</option>
                    {credits.map((c) => (
                      <option key={c.id} value={c.id}>{sourceLabel(c)}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--fg-3)] mb-1">วันที่จ่ายคืน *</label>
                    <input
                      type="date"
                      value={date}
                      max={todayBangkokStr()}
                      onChange={(e) => setDate(e.target.value)}
                      className="phopy-input w-full"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--fg-3)] mb-1">จำนวนเงินคืน (สูงสุด {fmtMoney(maxBalance)}) *</label>
                    <input
                      type="number"
                      min="0.01"
                      max={maxBalance || undefined}
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="phopy-input w-full"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--fg-3)] mb-1">วิธีจ่ายเงิน *</label>
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                      className="phopy-input w-full"
                    >
                      <option value="CASH">เงินสด</option>
                      <option value="TRANSFER">โอนเงิน</option>
                      <option value="CHEQUE">เช็ค</option>
                      <option value="CREDIT_CARD">บัตรเครดิต</option>
                    </select>
                  </div>
                  {paymentMethod !== 'CASH' && (
                    <div>
                      <label className="block text-xs text-[var(--fg-3)] mb-1">บัญชีธนาคารที่จ่ายออก</label>
                      <select
                        value={bankAccountId}
                        onChange={(e) => setBankAccountId(e.target.value)}
                        className="phopy-input w-full"
                      >
                        <option value="">บัญชีตั้งต้นของระบบ</option>
                        {bankAccounts.filter((b) => b.is_active).map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.bank_name} · {b.account_number}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1">หมายเหตุ</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="หมายเหตุ (ถ้ามี)"
                    className="phopy-input w-full"
                  />
                </div>
              </>
            )}
          </div>

          <div className="px-4 py-3 sm:px-5 sm:py-4 border-t border-[var(--border)] shrink-0 flex flex-wrap justify-end gap-2 bg-[var(--surface)]">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--fg-3)]">
              {t('common.cancel', { defaultValue: 'ยกเลิก' })}
            </button>
            <button
              type="submit"
              disabled={saving || loading || credits.length === 0}
              className="phopy-btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50"
            >
              {saving ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              {saving ? 'กำลังบันทึก...' : 'ยืนยันจ่ายเงินคืน'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── CancelReasonModal (ใช้ซ้ำสำหรับยกเลิกใบรับซื้อคืน และใบหักกลบ) ────────────
export function CancelReasonModal({
  title,
  docNumber,
  onClose,
  onConfirm,
}: {
  title: string
  docNumber: string
  onClose: () => void
  onConfirm: (reason: string) => Promise<void>
}) {
  useModalClose(onClose)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!reason.trim()) {
      toast.error('กรุณาระบุเหตุผลการยกเลิก')
      return
    }
    setSaving(true)
    try {
      await onConfirm(reason.trim())
      onClose()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'ยกเลิกเอกสารไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-t-2xl sm:rounded-2xl w-full max-w-md flex flex-col shadow-2xl"
      >
        <div className="px-4 py-3 sm:px-5 sm:py-4 border-b border-[var(--border)] flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-[var(--fg-1)] truncate">{title}</h3>
            <p className="text-xs font-mono text-[var(--fg-4)]">{docNumber}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="close" className="p-2 rounded-lg hover:bg-[var(--bg)] text-[var(--fg-3)]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4">
          <div>
            <label className="block text-xs text-[var(--fg-3)] mb-1">เหตุผลการยกเลิก *</label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="ระบุเหตุผลการยกเลิก..."
              className="phopy-input w-full resize-none"
              autoFocus
              required
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--fg-3)]">
              ปิด
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-500 disabled:opacity-50 flex items-center gap-1.5"
            >
              {saving ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Ban className="w-4 h-4" />}
              ยืนยันยกเลิก
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
