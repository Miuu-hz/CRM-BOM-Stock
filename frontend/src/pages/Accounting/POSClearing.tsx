import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Wallet,
  Building2,
  Calendar,
  FileText,
  CheckCircle2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Receipt,
  ArrowDownToLine,
  Clock,
  Banknote,
  QrCode,
  CreditCard,
  X,
  Info,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import toast from 'react-hot-toast'
import posService from '../../services/pos.service'

// ==================== Types ====================

interface ClearingBalance {
  pending: { billCount: number; totalAmount: number }
  transferred: { transferCount: number; totalAmount: number }
  recentTransfers: ClearingTransfer[]
}

interface ClearingTransfer {
  id: string
  transfer_date: string
  total_amount: number
  cash_amount: number
  bank_amount: number
  reference?: string
  notes?: string
  created_by_name?: string
  created_at: string
  bill_count?: number
}

interface PendingBill {
  id: string
  bill_number: string
  display_name: string
  total_amount: number
  payment_method: string
  closed_at: string
}

// ==================== Helpers ====================

const fmt = (n: number) =>
  `฿${(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })

const fmtTime = (s: string) =>
  new Date(s).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })

const localDateStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const paymentIcon = (method: string) => {
  if (method === 'CASH') return <Banknote className="w-4 h-4 text-yellow-400" />
  if (method === 'QR_CODE') return <QrCode className="w-4 h-4 text-blue-400" />
  if (method === 'CREDIT_CARD') return <CreditCard className="w-4 h-4 text-purple-400" />
  return <Building2 className="w-4 h-4 text-cyan-400" />
}

const paymentLabel = (method: string) => {
  const m: Record<string, string> = {
    CASH: 'เงินสด',
    QR_CODE: 'QR/พร้อมเพย์',
    CREDIT_CARD: 'บัตรเครดิต',
    TRANSFER: 'โอนเงิน',
  }
  return m[method] || method
}

const isBankMethod = (method: string) =>
  method === 'QR_CODE' || method === 'CREDIT_CARD' || method === 'TRANSFER'

// ==================== Main Component ====================

export default function POSClearing() {
  const [balance, setBalance] = useState<ClearingBalance | null>(null)
  const [pendingBills, setPendingBills] = useState<PendingBill[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [selectedDate, setSelectedDate] = useState(localDateStr)

  const fetchData = useCallback(async (date: string) => {
    try {
      setLoading(true)
      const [balanceRes, billsRes] = await Promise.all([
        posService.getClearingBalance(),
        posService.getPendingClearingBills(date),
      ])
      if (balanceRes.success) setBalance(balanceRes.data)
      if (billsRes.success) setPendingBills(billsRes.data || [])
    } catch {
      toast.error('โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [])

  const shiftDate = (days: number) => {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + days)
    const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    setSelectedDate(s)
  }

  const dateLabel = () => {
    const today = localDateStr()
    const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()
    if (selectedDate === today) return 'วันนี้'
    if (selectedDate === yesterday) return 'เมื่อวาน'
    return new Date(selectedDate).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  }

  useEffect(() => { fetchData(selectedDate) }, [fetchData, selectedDate])

  // Group pending bills by payment method
  const cashBills = pendingBills.filter((b) => b.payment_method === 'CASH')
  const bankBills = pendingBills.filter((b) => isBankMethod(b.payment_method))
  const cashTotal = cashBills.reduce((s, b) => s + b.total_amount, 0)
  const bankTotal = bankBills.reduce((s, b) => s + b.total_amount, 0)
  const pendingTotal = balance?.pending?.totalAmount || 0

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">นำเงิน POS เข้าบัญชี</h1>
          <p className="text-gray-400 mt-1 text-sm">
            รับเงินจากลิ้นชักและ QR เข้าบัญชีเงินสด / ธนาคารประจำวัน
          </p>
        </div>
        <button
          onClick={() => fetchData(selectedDate)}
          className="p-2 rounded-lg bg-cyber-card border border-cyber-border text-gray-400 hover:text-white"
        >
          <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Date Selector */}
      <div className="flex items-center gap-2 bg-cyber-card border border-cyber-border rounded-xl px-3 py-2">
        <button
          onClick={() => shiftDate(-1)}
          className="p-1.5 rounded-lg hover:bg-cyber-dark text-gray-400 hover:text-white transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 flex items-center justify-center gap-3">
          <Calendar className="w-4 h-4 text-cyber-primary" />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-transparent text-white text-sm focus:outline-none cursor-pointer"
          />
          <span className="text-cyber-primary font-medium text-sm">
            {dateLabel()}
          </span>
        </div>
        <button
          onClick={() => shiftDate(1)}
          disabled={selectedDate >= localDateStr()}
          className="p-1.5 rounded-lg hover:bg-cyber-dark text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        {selectedDate !== localDateStr() && (
          <button
            onClick={() => setSelectedDate(localDateStr())}
            className="ml-1 text-xs px-2 py-1 rounded bg-cyber-primary/20 text-cyber-primary hover:bg-cyber-primary/30"
          >
            วันนี้
          </button>
        )}
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-5 bg-cyber-card border border-cyber-border rounded-xl"
        >
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">ยอดรอนำเข้า</p>
          <p className="text-3xl font-bold text-cyber-primary">{fmt(pendingTotal)}</p>
          <p className="text-sm text-gray-500 mt-1">{balance?.pending?.billCount || 0} บิล</p>
          {cashTotal > 0 && (
            <div className="flex items-center gap-1 mt-2 text-xs text-yellow-400">
              <Banknote className="w-3 h-3" /> เงินสด {fmt(cashTotal)}
            </div>
          )}
          {bankTotal > 0 && (
            <div className="flex items-center gap-1 text-xs text-blue-400">
              <QrCode className="w-3 h-3" /> โอน/QR {fmt(bankTotal)}
            </div>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="p-5 bg-cyber-card border border-cyber-border rounded-xl"
        >
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">นำเข้าแล้วรวม</p>
          <p className="text-3xl font-bold text-cyber-green">
            {fmt(balance?.transferred?.totalAmount || 0)}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            {balance?.transferred?.transferCount || 0} ครั้ง
          </p>
          <div className="mt-3">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="text-xs text-gray-500 hover:text-white flex items-center gap-1"
            >
              ดูประวัติ {showHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>
        </motion.div>
      </div>

      {/* CTA */}
      {pendingTotal > 0 && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          onClick={() => setShowModal(true)}
          className="w-full flex items-center justify-center gap-3 py-4 bg-gradient-to-r from-cyber-primary to-cyber-purple text-white font-semibold rounded-xl text-lg shadow-lg"
        >
          <ArrowDownToLine className="w-5 h-5" />
          นำเงิน {fmt(pendingTotal)} เข้าบัญชี
        </motion.button>
      )}

      {/* Pending Bills */}
      {pendingBills.length > 0 && (
        <div className="bg-cyber-card border border-cyber-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-cyber-border">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <Receipt className="w-4 h-4 text-cyber-primary" />
              บิลที่รอนำเงินเข้า ({pendingBills.length} บิล)
            </h2>
          </div>

          {/* Payment method groups */}
          {cashBills.length > 0 && (
            <BillGroup
              label="เงินสด"
              icon={<Banknote className="w-4 h-4 text-yellow-400" />}
              bills={cashBills}
              total={cashTotal}
              color="yellow"
            />
          )}
          {bankBills.length > 0 && (
            <BillGroup
              label="QR / โอนเงิน"
              icon={<QrCode className="w-4 h-4 text-blue-400" />}
              bills={bankBills}
              total={bankTotal}
              color="blue"
            />
          )}
        </div>
      )}

      {pendingBills.length === 0 && !loading && (
        <div className="bg-cyber-card border border-cyber-border rounded-xl p-10 text-center">
          <CheckCircle2 className="w-14 h-14 mx-auto mb-3 text-cyber-green" />
          <p className="text-white font-medium">ทุกยอดได้รับการนำเข้าบัญชีแล้ว</p>
          <p className="text-gray-500 text-sm mt-1">ไม่มีบิลค้างอยู่</p>
        </div>
      )}

      {/* History */}
      <AnimatePresence>
        {showHistory && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-cyber-card border border-cyber-border rounded-xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-cyber-border">
              <h2 className="font-semibold text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-gray-400" />
                ประวัติการนำเงินเข้าบัญชี
              </h2>
            </div>
            {!balance?.recentTransfers?.length ? (
              <div className="p-8 text-center text-gray-500 text-sm">ยังไม่มีประวัติ</div>
            ) : (
              <div className="divide-y divide-cyber-border">
                {balance.recentTransfers.map((t) => (
                  <div key={t.id} className="px-5 py-4 flex justify-between items-center">
                    <div>
                      <p className="text-sm font-medium text-white">{fmtDate(t.transfer_date)}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {t.bill_count ? `${t.bill_count} บิล · ` : ''}
                        {t.cash_amount > 0 && `เงินสด ${fmt(t.cash_amount)}`}
                        {t.cash_amount > 0 && t.bank_amount > 0 && ' · '}
                        {t.bank_amount > 0 && `ธนาคาร ${fmt(t.bank_amount)}`}
                        {t.reference && ` · ${t.reference}`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-cyber-green">{fmt(t.total_amount)}</p>
                      <p className="text-xs text-gray-500">โดย {t.created_by_name || 'System'}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Info note */}
      <div className="flex items-start gap-2 text-xs text-gray-600 px-1">
        <Info className="w-3 h-3 mt-0.5 shrink-0" />
        <span>ระบบจะบันทึกรายการบัญชีอัตโนมัติ (Dr. เงินสด/ธนาคาร, Cr. บัญชีพัก POS 1180)</span>
      </div>

      {/* Modal */}
      <DepositModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        cashBills={cashBills}
        bankBills={bankBills}
        cashTotal={cashTotal}
        bankTotal={bankTotal}
        allBills={pendingBills}
        defaultDate={selectedDate}
        onSuccess={() => { fetchData(selectedDate); setShowModal(false) }}
      />
    </div>
  )
}

// ==================== Bill Group ====================

function BillGroup({
  label,
  icon,
  bills,
  total,
  color,
}: {
  label: string
  icon: React.ReactNode
  bills: PendingBill[]
  total: number
  color: 'yellow' | 'blue'
}) {
  const [expanded, setExpanded] = useState(false)
  const borderColor = color === 'yellow' ? 'border-yellow-500/20' : 'border-blue-500/20'
  const bgColor = color === 'yellow' ? 'bg-yellow-500/5' : 'bg-blue-500/5'
  const textColor = color === 'yellow' ? 'text-yellow-400' : 'text-blue-400'

  return (
    <div className={`border-b last:border-b-0 ${borderColor}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full px-5 py-3 flex items-center justify-between hover:bg-cyber-dark/30 ${bgColor}`}
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className={`text-sm font-medium ${textColor}`}>{label}</span>
          <span className="text-xs text-gray-500">{bills.length} บิล</span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`font-semibold ${textColor}`}>{fmt(total)}</span>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
        </div>
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {bills.map((bill) => (
              <div key={bill.id} className="px-5 py-2.5 flex justify-between items-center border-t border-cyber-border/50 bg-cyber-dark/20">
                <div>
                  <p className="text-sm text-white">{bill.display_name || bill.bill_number}</p>
                  <p className="text-xs text-gray-500">
                    {bill.bill_number} · {fmtDate(bill.closed_at)} {fmtTime(bill.closed_at)}
                  </p>
                </div>
                <p className="text-sm font-medium text-white">{fmt(bill.total_amount)}</p>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ==================== Deposit Modal ====================

interface DepositModalProps {
  isOpen: boolean
  onClose: () => void
  cashBills: PendingBill[]
  bankBills: PendingBill[]
  cashTotal: number
  bankTotal: number
  allBills: PendingBill[]
  defaultDate: string
  onSuccess: () => void
}

function DepositModal({
  isOpen,
  onClose,
  cashBills,
  bankBills,
  cashTotal,
  bankTotal,
  allBills,
  defaultDate,
  onSuccess,
}: DepositModalProps) {
  const [transferDate, setTransferDate] = useState(defaultDate)
  const [cashAmount, setCashAmount] = useState('')
  const [bankAmount, setBankAmount] = useState('')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // Pre-fill on open
  useEffect(() => {
    if (isOpen) {
      setCashAmount(cashTotal > 0 ? cashTotal.toFixed(2) : '')
      setBankAmount(bankTotal > 0 ? bankTotal.toFixed(2) : '')
      setTransferDate(defaultDate)
      setReference('')
      setNotes('')
    }
  }, [isOpen, cashTotal, bankTotal, defaultDate])

  const enteredCash = parseFloat(cashAmount) || 0
  const enteredBank = parseFloat(bankAmount) || 0
  const totalEntered = enteredCash + enteredBank
  const grandTotal = cashTotal + bankTotal
  const difference = grandTotal - totalEntered

  const handleSubmit = async () => {
    if (totalEntered <= 0) {
      toast.error('กรุณาระบุจำนวนเงิน')
      return
    }
    // Allow difference — backend records it as over/short (account 5901)
    try {
      setSaving(true)
      const res = await posService.createClearingTransfer({
        transfer_date: transferDate,
        cash_amount: enteredCash,
        bank_amount: enteredBank,
        bill_ids: allBills.map((b) => b.id),
        reference: reference || undefined,
        notes: notes || undefined,
      })
      if (res.success) {
        toast.success('บันทึกการนำเงินเข้าบัญชีสำเร็จ')
        onSuccess()
      }
    } catch {
      toast.error('ไม่สามารถบันทึกได้')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-cyber-card border border-cyber-border rounded-2xl w-full max-w-md flex flex-col"
        style={{ maxHeight: 'calc(100vh - 2rem)' }}
      >
        {/* Header */}
        <div className="p-5 border-b border-cyber-border flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <ArrowDownToLine className="w-5 h-5 text-cyber-primary" />
              นำเงินเข้าบัญชี
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">{allBills.length} บิล · รวม {fmt(grandTotal)}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-cyber-dark text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-5 space-y-4">
          {/* Breakdown */}
          <div className="rounded-xl overflow-hidden border border-cyber-border">
            {cashTotal > 0 && (
              <div className="flex justify-between items-center px-4 py-3 bg-yellow-500/10 border-b border-cyber-border">
                <div className="flex items-center gap-2">
                  <Banknote className="w-4 h-4 text-yellow-400" />
                  <div>
                    <p className="text-sm font-medium text-yellow-400">เงินสดจากลิ้นชัก</p>
                    <p className="text-xs text-gray-500">{cashBills.length} บิล</p>
                  </div>
                </div>
                <p className="font-semibold text-yellow-400">{fmt(cashTotal)}</p>
              </div>
            )}
            {bankTotal > 0 && (
              <div className="flex justify-between items-center px-4 py-3 bg-blue-500/10">
                <div className="flex items-center gap-2">
                  <QrCode className="w-4 h-4 text-blue-400" />
                  <div>
                    <p className="text-sm font-medium text-blue-400">QR / โอนเงิน</p>
                    <p className="text-xs text-gray-500">{bankBills.length} บิล</p>
                  </div>
                </div>
                <p className="font-semibold text-blue-400">{fmt(bankTotal)}</p>
              </div>
            )}
          </div>

          {/* Date */}
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">วันที่บันทึก</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="date"
                value={transferDate}
                onChange={(e) => setTransferDate(e.target.value)}
                className="w-full pl-10 pr-3 py-2.5 bg-cyber-dark border border-cyber-border rounded-lg text-white focus:outline-none focus:border-cyber-primary"
              />
            </div>
          </div>

          {/* Amounts */}
          <div className="space-y-3">
            <label className="block text-sm text-gray-400">ยืนยันจำนวนเงิน</label>
            {cashTotal > 0 && (
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                  <Banknote className="w-4 h-4 text-yellow-400" />
                  <span className="text-xs text-gray-500">เงินสด</span>
                </div>
                <input
                  type="number"
                  value={cashAmount}
                  onChange={(e) => setCashAmount(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  placeholder="0.00"
                  className="w-full pl-24 pr-3 py-2.5 bg-cyber-dark border border-yellow-500/30 rounded-lg text-white focus:outline-none focus:border-yellow-400"
                />
              </div>
            )}
            {bankTotal > 0 && (
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                  <QrCode className="w-4 h-4 text-blue-400" />
                  <span className="text-xs text-gray-500">ธนาคาร</span>
                </div>
                <input
                  type="number"
                  value={bankAmount}
                  onChange={(e) => setBankAmount(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  placeholder="0.00"
                  className="w-full pl-24 pr-3 py-2.5 bg-cyber-dark border border-blue-500/30 rounded-lg text-white focus:outline-none focus:border-blue-400"
                />
              </div>
            )}

            {/* Match indicator */}
            <div className={`flex items-center justify-between px-4 py-2.5 rounded-lg text-sm ${
              Math.abs(difference) <= 0.01
                ? 'bg-cyber-green/10 border border-cyber-green/30'
                : difference > 0
                  ? 'bg-red-500/10 border border-red-500/30'
                  : 'bg-yellow-500/10 border border-yellow-500/30'
            }`}>
              <span className="text-gray-400">รวมที่กรอก</span>
              <div className="flex items-center gap-2">
                <span className={`font-semibold ${
                  Math.abs(difference) <= 0.01 ? 'text-cyber-green'
                  : difference > 0 ? 'text-red-400' : 'text-yellow-400'
                }`}>
                  {fmt(totalEntered)}
                </span>
                {Math.abs(difference) <= 0.01
                  ? <CheckCircle2 className="w-4 h-4 text-cyber-green" />
                  : <span className={`text-xs ${difference > 0 ? 'text-red-400' : 'text-yellow-400'}`}>
                      {difference > 0 ? `ขาด ${fmt(difference)}` : `เกิน ${fmt(-difference)}`}
                    </span>
                }
              </div>
            </div>
            {/* Over/short explanation */}
            {Math.abs(difference) > 0.01 && (
              <div className="flex items-start gap-2 px-3 py-2 bg-cyber-dark rounded-lg text-xs text-gray-400">
                <Info className="w-3 h-3 mt-0.5 shrink-0 text-gray-500" />
                <span>
                  ผลต่าง{' '}
                  <span className={difference > 0 ? 'text-red-400' : 'text-yellow-400'}>
                    {difference > 0 ? `เงินขาด ${fmt(difference)}` : `เงินเกิน ${fmt(-difference)}`}
                  </span>
                  {' '}จะถูกบันทึกเป็น บัญชี 5901 เงินขาด/เงินเกิน โดยอัตโนมัติ
                </span>
              </div>
            )}
          </div>

          {/* Reference */}
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">เลขที่อ้างอิง / สลิป (optional)</label>
            <div className="relative">
              <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="เช่น เลขสลิปโอน, เลขที่ใบนำฝาก"
                className="w-full pl-10 pr-3 py-2.5 bg-cyber-dark border border-cyber-border rounded-lg text-white focus:outline-none focus:border-cyber-primary"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1.5">หมายเหตุ (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2.5 bg-cyber-dark border border-cyber-border rounded-lg text-white focus:outline-none focus:border-cyber-primary resize-none text-sm"
              placeholder="บันทึกเพิ่มเติม..."
            />
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-cyber-border flex gap-3 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-gray-400 hover:text-white transition-colors text-sm"
          >
            ยกเลิก
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || totalEntered <= 0}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-cyber-primary to-cyber-purple text-white font-semibold rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                ยืนยัน นำเงิน {fmt(totalEntered)} เข้าบัญชี
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  )
}
