import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, X, AlertCircle, Sparkles, CheckCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { useModalClose } from '../../hooks/useModalClose'
import { calcVat } from '../../utils/vat'
import { normalizeUnit } from '../../utils/unitNormalize'
import { SearchableDropdown } from '../common/SearchableDropdown'
import { UnitPicker } from '../common/UnitPicker'
import { getCachedCompanySettings } from '../../services/companySettings.service'
import stockService, { type StockItem } from '../../services/stock'
import salesService, { type OpenInvoice } from '../../services/sales.service'

export interface BuybackCustomer {
  id: string
  code?: string
  name: string
  taxId?: string | null
  tax_id?: string | null
}

export interface BuybackModalProps {
  customer: BuybackCustomer
  openInvoices?: OpenInvoice[]
  onClose: () => void
  onSaved: () => void
}

interface BuybackLine {
  _key: string
  stockItemId: string
  quantity: number
  unit: string
  unitPrice: number
  condition: 'GOOD' | 'DAMAGED'
  priceEdited?: boolean
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
const fmtMoney = (n: number) => `฿${round2(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function todayBangkokStr(): string {
  try {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
  } catch {
    return new Date().toLocaleDateString('sv-SE')
  }
}

/** ค่าเริ่มต้นผู้ขายจด VAT: true เมื่อเลขผู้เสียภาษีลูกค้าครบ 13 หลักและขึ้นต้นด้วย 0 */
export function defaultSellerVat(taxId?: string | null): boolean {
  const clean = String(taxId ?? '').trim()
  return /^0\d{12}$/.test(clean)
}

let lineSeq = 0
const nextLineKey = () => `bb-line-${++lineSeq}`

const isServiceStockItem = (s: StockItem) =>
  String(s.category ?? '').trim().toUpperCase() === 'SERVICE'

export function BuybackModal({ customer, openInvoices: initialInvoices, onClose, onSaved }: BuybackModalProps) {
  const { t } = useTranslation()
  useModalClose(onClose)

  const customerTaxId = String(customer.taxId ?? customer.tax_id ?? '').trim()
  const has13DigitTaxId = /^\d{13}$/.test(customerTaxId)
  const tenantVatRegistered = (() => {
    const v = getCachedCompanySettings()?.vat_registered
    return v !== 0 && v !== false
  })()

  const [date, setDate] = useState(todayBangkokStr)
  const [sellerVat, setSellerVat] = useState(() => defaultSellerVat(customerTaxId))
  const [taxInvoiceNumber, setTaxInvoiceNumber] = useState('')
  const [taxInvoiceDate, setTaxInvoiceDate] = useState(todayBangkokStr)
  const [taxRate, setTaxRate] = useState('7')
  const [vatInclusive, setVatInclusive] = useState(false)
  const [approvedBy, setApprovedBy] = useState('')
  const [sellerIdDoc, setSellerIdDoc] = useState('')
  const [notes, setNotes] = useState('')

  const [stockItems, setStockItems] = useState<StockItem[]>([])
  const [loadingStock, setLoadingStock] = useState(true)
  const [invoices, setInvoices] = useState<OpenInvoice[]>(initialInvoices ?? [])
  const [loadingInvoices, setLoadingInvoices] = useState(initialInvoices === undefined)

  const [items, setItems] = useState<BuybackLine[]>(() => [
    { _key: nextLineKey(), stockItemId: '', quantity: 1, unit: '', unitPrice: 0, condition: 'GOOD' },
  ])
  const [applyMap, setApplyMap] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    setLoadingStock(true)
    stockService.getAll()
      .then((list) => {
        if (!alive) return
        setStockItems((list || []).filter((s) => !isServiceStockItem(s)))
      })
      .catch(() => { if (alive) setStockItems([]) })
      .finally(() => { if (alive) setLoadingStock(false) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (initialInvoices !== undefined) {
      setInvoices(initialInvoices)
      setLoadingInvoices(false)
      return
    }
    let alive = true
    setLoadingInvoices(true)
    salesService.getCustomerCredits(customer.id)
      .then((res) => { if (alive) setInvoices(res.openInvoices || []) })
      .catch(() => { if (alive) setInvoices([]) })
      .finally(() => { if (alive) setLoadingInvoices(false) })
    return () => { alive = false }
  }, [customer.id, initialInvoices])

  const stockOptions = useMemo(
    () => stockItems.map((s) => ({
      id: s.id,
      label: s.sku ? `${s.sku} · ${s.name}` : s.name,
      searchText: `${s.sku || ''} ${s.name}`,
    })),
    [stockItems],
  )
  const stockById = useMemo(() => new Map(stockItems.map((s) => [s.id, s])), [stockItems])

  const updateItem = (idx: number, patch: Partial<BuybackLine>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      { _key: nextLineKey(), stockItemId: '', quantity: 1, unit: '', unitPrice: 0, condition: 'GOOD' },
    ])
  }

  const removeItem = (idx: number) => {
    setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev))
  }

  const rateNum = sellerVat ? (parseFloat(taxRate) || 0) : 0
  const lineSum = useMemo(
    () => round2(items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0)),
    [items],
  )
  const totals = useMemo(
    () => calcVat(lineSum, { rate: rateNum, inclusive: sellerVat ? vatInclusive : false }),
    [lineSum, rateNum, sellerVat, vatInclusive],
  )

  const appliedTotal = useMemo(
    () => round2(invoices.reduce((s, inv) => s + (parseFloat(applyMap[inv.id] || '0') || 0), 0)),
    [invoices, applyMap],
  )
  const remainingCredit = round2(Math.max(0, totals.totalAmount - appliedTotal))

  const handleAutoFill = () => {
    const sorted = [...invoices].sort((a, b) =>
      String(a.invoice_date || '').localeCompare(String(b.invoice_date || '')),
    )
    let remaining = totals.totalAmount
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

  const handleApplyInput = (inv: OpenInvoice, raw: string) => {
    if (raw === '') {
      setApplyMap((prev) => {
        const next = { ...prev }
        delete next[inv.id]
        return next
      })
      return
    }
    const v = parseFloat(raw)
    if (!Number.isFinite(v) || v < 0) return
    setApplyMap((prev) => ({ ...prev, [inv.id]: raw }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!date) {
      toast.error(t('crm.creditsTab.validation.dateRequired', { defaultValue: 'กรุณาระบุวันที่รับซื้อคืน' }))
      return
    }
    if (sellerVat) {
      if (!has13DigitTaxId) {
        toast.error(t('crm.creditsTab.validation.customerTaxId13', { defaultValue: 'ลูกค้าต้องมีเลขผู้เสียภาษี 13 หลักเมื่อเลือกผู้ขายคืนจด VAT' }))
        return
      }
      if (!taxInvoiceNumber.trim() || !taxInvoiceDate) {
        toast.error(t('crm.creditsTab.validation.taxInvoiceRequired', { defaultValue: 'กรุณาระบุเลขที่และวันที่ใบกำกับภาษีของผู้ขายคืน' }))
        return
      }
      if (!(rateNum > 0)) {
        toast.error(t('crm.creditsTab.validation.taxRatePositive', { defaultValue: 'อัตรา VAT ต้องมากกว่า 0%' }))
        return
      }
    } else {
      if (!approvedBy.trim() || !sellerIdDoc.trim()) {
        toast.error(t('crm.creditsTab.validation.nonVatEvidenceRequired', { defaultValue: 'กรุณาระบุผู้อนุมัติและหลักฐานประจำตัวผู้รับเงิน' }))
        return
      }
    }

    const validItems = items.filter((it) => it.stockItemId)
    if (validItems.length === 0) {
      toast.error(t('crm.creditsTab.validation.itemRequired', { defaultValue: 'กรุณาเลือกสินค้าอย่างน้อย 1 รายการ' }))
      return
    }
    for (const it of validItems) {
      const qty = Number(it.quantity)
      const price = Number(it.unitPrice)
      if (!(qty > 0) || !(price >= 0) || !(qty * price > 0) || !it.unit) {
        toast.error(t('crm.creditsTab.validation.itemInvalid', { defaultValue: 'กรุณากรอกจำนวน หน่วย และราคาสินค้าให้ถูกต้อง (มูลค่าต้องมากกว่า 0)' }))
        return
      }
    }

    const applyTo: Array<{ invoiceId: string; amount: number }> = []
    for (const inv of invoices) {
      const raw = applyMap[inv.id]
      if (!raw) continue
      const amt = round2(parseFloat(raw) || 0)
      if (amt <= 0) continue
      if (amt > (Number(inv.balance_amount) || 0) + 0.005) {
        toast.error(t('crm.creditsTab.validation.applyExceedsBalance', {
          invoice: inv.invoice_number,
          defaultValue: `ยอดหักกลบบิล ${inv.invoice_number} เกินยอดค้างชำระ`,
        }))
        return
      }
      applyTo.push({ invoiceId: inv.id, amount: amt })
    }
    if (appliedTotal > totals.totalAmount + 0.005) {
      toast.error(t('crm.creditsTab.validation.applyExceedsTotal', { defaultValue: 'ยอดรวมหักกลบบิลเกินยอดรับซื้อคืน' }))
      return
    }

    setSaving(true)
    try {
      await salesService.createBuyback({
        customerId: customer.id,
        date,
        sellerVat,
        taxInvoiceNumber: sellerVat ? taxInvoiceNumber.trim() : undefined,
        taxInvoiceDate: sellerVat ? taxInvoiceDate : undefined,
        taxRate: sellerVat ? rateNum : 0,
        vatInclusive: sellerVat ? vatInclusive : false,
        approvedBy: !sellerVat ? approvedBy.trim() : undefined,
        sellerIdDoc: !sellerVat ? sellerIdDoc.trim() : undefined,
        notes: notes.trim() || undefined,
        items: validItems.map((it) => ({
          stockItemId: it.stockItemId,
          quantity: Number(it.quantity),
          unit: it.unit,
          unitPrice: Number(it.unitPrice),
          condition: it.condition,
        })),
        applyTo: applyTo.length > 0 ? applyTo : undefined,
      })
      toast.success(t('crm.creditsTab.toast.buybackCreated', { defaultValue: 'บันทึกรับซื้อคืนสำเร็จ' }))
      onSaved()
      onClose()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t('crm.creditsTab.toast.buybackCreateFailed', { defaultValue: 'บันทึกรับซื้อคืนไม่สำเร็จ' }))
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
        aria-label={t('crm.creditsTab.buybackModal.title', { defaultValue: 'รับซื้อคืนสินค้าจากลูกค้า' })}
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-t-2xl sm:rounded-2xl w-full max-w-3xl flex flex-col max-h-[calc(100dvh-0.5rem)] sm:max-h-[calc(100vh-2rem)] shadow-2xl"
      >
        <div className="px-4 py-3 sm:px-5 sm:py-4 border-b border-[var(--border)] flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-bold text-[var(--fg-1)] truncate">
              {t('crm.creditsTab.buybackModal.title', { defaultValue: 'รับซื้อคืนสินค้าจากลูกค้า' })}
            </h2>
            <p className="text-xs text-[var(--fg-3)] truncate">
              {customer.name}{customer.code ? ` (${customer.code})` : ''}
              {customerTaxId ? ` · เลขภาษี ${customerTaxId}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            className="p-2 rounded-lg hover:bg-[var(--bg)] text-[var(--fg-3)] hover:text-[var(--fg-1)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="overflow-y-auto px-4 py-4 sm:px-5 space-y-4 flex-1 min-h-0">
            {/* วันที่ + สถานะ VAT ผู้ขายคืน */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[var(--fg-3)] mb-1">
                  {t('crm.creditsTab.buybackModal.dateLabel', { defaultValue: 'วันที่รับซื้อคืน' })}
                </label>
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
                <label className="block text-xs text-[var(--fg-3)] mb-1">
                  {t('crm.creditsTab.buybackModal.sellerVatLabel', { defaultValue: 'สถานะ VAT ของผู้ขายคืน (ลูกค้า)' })}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSellerVat(true)}
                    className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                      sellerVat
                        ? 'bg-phopy-indigo/15 border-phopy-indigo text-[var(--primary)]'
                        : 'bg-[var(--bg)] border-[var(--border)] text-[var(--fg-3)]'
                    }`}
                  >
                    {t('crm.creditsTab.buybackModal.sellerVatYes', { defaultValue: 'ผู้ขายจด VAT' })}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSellerVat(false)}
                    className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                      !sellerVat
                        ? 'bg-phopy-indigo/15 border-phopy-indigo text-[var(--primary)]'
                        : 'bg-[var(--bg)] border-[var(--border)] text-[var(--fg-3)]'
                    }`}
                  >
                    {t('crm.creditsTab.buybackModal.sellerVatNo', { defaultValue: 'ผู้ขายไม่จด VAT' })}
                  </button>
                </div>
              </div>
            </div>

            {/* คำอธิบายเอกสารที่ต้องใช้ */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)]/70 p-3 text-xs text-[var(--fg-2)] space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-[var(--primary)] shrink-0 mt-0.5" />
                <div>
                  {sellerVat ? (
                    <p>
                      {t('crm.creditsTab.buybackModal.docGuideVat', {
                        defaultValue:
                          'เอกสารที่ต้องใช้: ลูกค้าผู้ขายคืนต้องออกใบกำกับภาษีขาย/ใบส่งของให้ร้าน พร้อมเลขประจำตัวผู้เสียภาษี 13 หลักเพื่อบันทึกภาษีซื้อ',
                      })}
                    </p>
                  ) : (
                    <p>
                      {t('crm.creditsTab.buybackModal.docGuideNoVat', {
                        defaultValue:
                          'เอกสารที่ต้องใช้: ออกใบสำคัญรับเงินให้ผู้ขายคืนลงนาม และแนบสำเนา/บันทึกหลักฐานบัตรประชาชนผู้รับเงินพร้อมชื่อผู้อนุมัติ (ไม่มี VAT)',
                      })}
                    </p>
                  )}
                  {sellerVat && !tenantVatRegistered && (
                    <p className="text-warning mt-1">
                      {t('crm.creditsTab.buybackModal.tenantNotVatWarning', {
                        defaultValue: 'หมายเหตุ: ร้านยังไม่จด VAT — ภาษีซื้อจะถูกรวมเป็นต้นทุนสินค้า (ขอคืนไม่ได้)',
                      })}
                    </p>
                  )}
                  {sellerVat && !has13DigitTaxId && (
                    <p className="text-danger mt-1">
                      {t('crm.creditsTab.buybackModal.missingTaxIdWarning', {
                        defaultValue: `เลขผู้เสียภาษีลูกค้าปัจจุบัน (${customerTaxId || 'ไม่มี'}) ไม่ครบ 13 หลัก — กรุณาอัปเดตข้อมูลลูกค้าก่อน หรือสลับเป็น "ผู้ขายไม่จด VAT"`,
                      })}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* ช่องเอกสารตามโหมด sellerVat */}
            {sellerVat ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1">
                    {t('crm.creditsTab.buybackModal.taxInvoiceNumber', { defaultValue: 'เลขที่ใบกำกับภาษีผู้ขาย *' })}
                  </label>
                  <input
                    type="text"
                    value={taxInvoiceNumber}
                    onChange={(e) => setTaxInvoiceNumber(e.target.value)}
                    placeholder="เช่น INV-..."
                    className="phopy-input w-full"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1">
                    {t('crm.creditsTab.buybackModal.taxInvoiceDate', { defaultValue: 'วันที่ใบกำกับภาษี *' })}
                  </label>
                  <input
                    type="date"
                    value={taxInvoiceDate}
                    max={todayBangkokStr()}
                    onChange={(e) => setTaxInvoiceDate(e.target.value)}
                    className="phopy-input w-full"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1">
                    {t('crm.creditsTab.buybackModal.vatMode', { defaultValue: 'รูปแบบราคา VAT' })}
                  </label>
                  <select
                    value={vatInclusive ? 'INCLUSIVE' : 'EXCLUSIVE'}
                    onChange={(e) => setVatInclusive(e.target.value === 'INCLUSIVE')}
                    className="phopy-input w-full"
                  >
                    <option value="EXCLUSIVE">บวก VAT เพิ่ม (แยกนอก)</option>
                    <option value="INCLUSIVE">ราคารวม VAT แล้ว</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1">
                    {t('crm.creditsTab.buybackModal.taxRate', { defaultValue: 'อัตรา VAT (%)' })}
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={taxRate}
                    onChange={(e) => setTaxRate(e.target.value)}
                    className="phopy-input w-full"
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1">
                    {t('crm.creditsTab.buybackModal.approvedBy', { defaultValue: 'ผู้อนุมัติรับซื้อคืน *' })}
                  </label>
                  <input
                    type="text"
                    value={approvedBy}
                    onChange={(e) => setApprovedBy(e.target.value)}
                    placeholder="ชื่อผู้อนุมัติ"
                    className="phopy-input w-full"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1">
                    {t('crm.creditsTab.buybackModal.sellerIdDoc', { defaultValue: 'บันทึกหลักฐานผู้รับเงิน (บัตรประชาชน/เอกสาร) *' })}
                  </label>
                  <input
                    type="text"
                    value={sellerIdDoc}
                    onChange={(e) => setSellerIdDoc(e.target.value)}
                    placeholder="เช่น บัตร ปชช. ลงท้าย XXXX แนบสำเนาลงนาม"
                    className="phopy-input w-full"
                    required
                  />
                </div>
              </div>
            )}

            {/* รายการสินค้ารับซื้อคืน */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-[var(--fg-2)] uppercase tracking-wider">
                  {t('crm.creditsTab.buybackModal.itemsLabel', { defaultValue: 'รายการสินค้าที่รับซื้อคืน' })}
                </label>
                <button
                  type="button"
                  onClick={addItem}
                  className="text-xs text-[var(--primary)] hover:underline flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t('crm.creditsTab.buybackModal.addItem', { defaultValue: 'เพิ่มรายการ' })}
                </button>
              </div>

              {loadingStock ? (
                <p className="text-xs text-[var(--fg-4)] py-2">กำลังโหลดรายการสินค้า...</p>
              ) : (
                <div className="space-y-2">
                  {items.map((row, idx) => {
                    const selectedStock = stockById.get(row.stockItemId)
                    const lineAmount = round2((Number(row.quantity) || 0) * (Number(row.unitPrice) || 0))
                    return (
                      <div key={row._key} className="bg-[var(--surface-2)] border border-[var(--border)]/60 rounded-xl p-3 space-y-2">
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                          <div className="sm:col-span-5">
                            <label className="block text-[11px] text-[var(--fg-4)] mb-1">สินค้าในสต็อก *</label>
                            <SearchableDropdown
                              value={row.stockItemId}
                              onChange={(id) => {
                                const st = stockById.get(id)
                                const unit = st ? normalizeUnit(st.baseUnit || st.unit || '') : ''
                                const defaultPrice = !row.priceEdited && st ? Number(st.unitPrice ?? st.unitCost ?? 0) || 0 : row.unitPrice
                                updateItem(idx, {
                                  stockItemId: id,
                                  unit: unit || row.unit,
                                  unitPrice: defaultPrice,
                                })
                              }}
                              options={stockOptions}
                              placeholder="ค้นหาสินค้า..."
                            />
                          </div>
                          <div className="grid grid-cols-2 sm:contents gap-2">
                            <div className="sm:col-span-2">
                              <label className="block text-[11px] text-[var(--fg-4)] mb-1">จำนวน</label>
                              <input
                                type="number"
                                min="0.01"
                                step="any"
                                value={row.quantity}
                                onChange={(e) => updateItem(idx, { quantity: parseFloat(e.target.value) || 0 })}
                                className="phopy-input w-full text-sm"
                              />
                            </div>
                            <div className="sm:col-span-2">
                              <label className="block text-[11px] text-[var(--fg-4)] mb-1">หน่วย</label>
                              <UnitPicker
                                value={row.unit}
                                onChange={(u) => updateItem(idx, { unit: u })}
                                materialId={row.stockItemId || null}
                                baseUnit={selectedStock?.baseUnit || selectedStock?.unit}
                                restrict="warn"
                                size="sm"
                                hideUnreachableHint
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 sm:contents gap-2">
                            <div className="sm:col-span-2">
                              <label className="block text-[11px] text-[var(--fg-4)] mb-1">ราคา/หน่วย</label>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={row.unitPrice}
                                onChange={(e) => updateItem(idx, { unitPrice: parseFloat(e.target.value) || 0, priceEdited: true })}
                                className="phopy-input w-full text-sm"
                              />
                            </div>
                            <div className="sm:col-span-1 flex justify-end">
                              {items.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removeItem(idx)}
                                  aria-label="ลบรายการ"
                                  className="p-2 text-danger hover:bg-[var(--danger-soft)] rounded-lg"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[var(--border)]/40">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-[var(--fg-4)]">สภาพสินค้า:</span>
                            <button
                              type="button"
                              onClick={() => updateItem(idx, { condition: 'GOOD' })}
                              className={`px-2 py-0.5 rounded border text-xs ${
                                row.condition === 'GOOD'
                                  ? 'bg-[var(--success-soft)] border-success/40 text-success font-medium'
                                  : 'bg-[var(--bg)] border-[var(--border)] text-[var(--fg-3)]'
                              }`}
                            >
                              สภาพดี (เข้าสต็อก)
                            </button>
                            <button
                              type="button"
                              onClick={() => updateItem(idx, { condition: 'DAMAGED' })}
                              className={`px-2 py-0.5 rounded border text-xs ${
                                row.condition === 'DAMAGED'
                                  ? 'bg-[var(--warning-soft)] border-warning/40 text-warning font-medium'
                                  : 'bg-[var(--bg)] border-[var(--border)] text-[var(--fg-3)]'
                              }`}
                            >
                              ชำรุด (ไม่เข้าสต็อก)
                            </button>
                          </div>
                          <span className="text-xs text-[var(--fg-2)] font-semibold">
                            รวมรายการ: {fmtMoney(lineAmount)}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* สรุปยอดจาก calcVat */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 space-y-1 text-sm">
              <div className="flex justify-between text-[var(--fg-3)]">
                <span>มูลค่าสินค้า{sellerVat ? ' (ก่อน VAT)' : ''}</span>
                <span>{fmtMoney(totals.subtotal)}</span>
              </div>
              {sellerVat && (
                <div className="flex justify-between text-[var(--fg-3)]">
                  <span>VAT {rateNum}%</span>
                  <span>{fmtMoney(totals.taxAmount)}</span>
                </div>
              )}
              <div className="flex justify-between text-[var(--fg-1)] font-bold border-t border-[var(--border)] pt-1.5">
                <span>ยอดรับซื้อคืนสุทธิ</span>
                <span className="text-[var(--primary)]">{fmtMoney(totals.totalAmount)}</span>
              </div>
            </div>

            {/* หักกลบบิลค้างชำระทันที (ไม่บังคับ) */}
            <div className="rounded-xl border border-[var(--border)] p-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--fg-1)]">
                    {t('crm.creditsTab.buybackModal.applyInvoicesTitle', { defaultValue: 'หักกลบใบแจ้งหนี้ค้างชำระทันที (ถ้ามี)' })}
                  </h3>
                  <p className="text-xs text-[var(--fg-4)]">
                    {t('crm.creditsTab.buybackModal.applyInvoicesDesc', { defaultValue: 'ยอดที่ไม่หักจะเก็บเป็นเครดิตคงเหลือของลูกค้า' })}
                  </p>
                </div>
                {invoices.length > 0 && totals.totalAmount > 0 && (
                  <button
                    type="button"
                    onClick={handleAutoFill}
                    className="px-3 py-1.5 rounded-lg bg-phopy-indigo/15 text-[var(--primary)] border border-phopy-indigo/30 hover:bg-phopy-indigo/25 text-xs font-medium flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    เติมอัตโนมัติ
                  </button>
                )}
              </div>

              {loadingInvoices ? (
                <p className="text-xs text-[var(--fg-4)] py-2">กำลังโหลดใบแจ้งหนี้ค้างชำระ...</p>
              ) : invoices.length === 0 ? (
                <p className="text-xs text-[var(--fg-4)] py-1">ไม่มีใบแจ้งหนี้ค้างชำระ — ยอดทั้งหมดจะเป็นเครดิตคงเหลือของลูกค้า</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
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
                        <div className="flex items-center gap-2 shrink-0">
                          <label className="text-[11px] text-[var(--fg-4)]">หัก:</label>
                          <input
                            type="number"
                            min="0"
                            max={bal}
                            step="0.01"
                            value={applyMap[inv.id] ?? ''}
                            onChange={(e) => handleApplyInput(inv, e.target.value)}
                            placeholder="0.00"
                            aria-label={`หักบิล ${inv.invoice_number}`}
                            className="w-28 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2 py-1 text-right text-sm text-[var(--fg-1)]"
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--border)]/60 text-xs">
                <span className="text-[var(--fg-3)]">
                  หักบิลรอบนี้: <strong className="text-[var(--fg-1)]">{fmtMoney(appliedTotal)}</strong>
                </span>
                <span className="text-[var(--fg-3)]">
                  เครดิตคงเหลือ:{' '}
                  <strong className="text-success" data-testid="remaining-credit">
                    {fmtMoney(remainingCredit)}
                  </strong>
                </span>
              </div>
              {appliedTotal > totals.totalAmount + 0.005 && (
                <p className="text-xs text-danger">ยอดรวมหักกลบบิลเกินยอดรับซื้อคืน</p>
              )}
            </div>

            <div>
              <label className="block text-xs text-[var(--fg-3)] mb-1">หมายเหตุ</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="หมายเหตุเพิ่มเติม (ถ้ามี)..."
                className="phopy-input w-full resize-none"
              />
            </div>
          </div>

          <div className="px-4 py-3 sm:px-5 sm:py-4 border-t border-[var(--border)] shrink-0 flex flex-wrap justify-end gap-2 bg-[var(--surface)]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--fg-3)] hover:text-[var(--fg-1)]"
            >
              {t('common.cancel', { defaultValue: 'ยกเลิก' })}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="phopy-btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50"
            >
              {saving
                ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                : <CheckCircle className="w-4 h-4" />}
              {saving ? 'กำลังบันทึก...' : 'บันทึกรับซื้อคืน'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default BuybackModal
