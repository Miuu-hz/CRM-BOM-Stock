import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowRightLeft,
  Wallet,
  Building2,
  Calendar,
  FileText,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Receipt,
  TrendingUp,
  DollarSign,
} from 'lucide-react'
import toast from 'react-hot-toast'
import posService from '../../services/pos.service'

// ==================== Types ====================

interface ClearingBalance {
  pending: {
    billCount: number
    totalAmount: number
  }
  transferred: {
    transferCount: number
    totalAmount: number
  }
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
}

interface PendingBill {
  id: string
  bill_number: string
  display_name: string
  total_amount: number
  payment_method: string
  closed_at: string
}

// ==================== Component ====================

export default function POSClearing() {
  const [balance, setBalance] = useState<ClearingBalance | null>(null)
  const [pendingBills, setPendingBills] = useState<PendingBill[]>([])
  const [loading, setLoading] = useState(true)
  const [showTransferModal, setShowTransferModal] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const [balanceRes, billsRes] = await Promise.all([
        posService.getClearingBalance(),
        posService.getPendingClearingBills(),
      ])

      if (balanceRes.success) setBalance(balanceRes.data)
      if (billsRes.success) setPendingBills(billsRes.data || [])
    } catch (error) {
      toast.error('Failed to load clearing data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const formatCurrency = (amount: number) => {
    return `฿${(amount || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">POS Clearing</h1>
          <p className="text-gray-400 mt-1">
            จัดการยอดค้างในระบบ POS และโอนเข้าบัญชีเงินสด/ธนาคาร
          </p>
        </div>
        <button
          onClick={fetchData}
          className="p-2 rounded-lg bg-cyber-card border border-cyber-border text-gray-400 hover:text-white"
        >
          <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Pending Amount */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 bg-cyber-card border border-cyber-border rounded-xl"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">ยอดค้างใน Clearing</p>
              <p className="text-3xl font-bold text-cyber-primary mt-1">
                {formatCurrency(balance?.pending?.totalAmount || 0)}
              </p>
              <p className="text-sm text-gray-500 mt-1">
                {balance?.pending?.billCount || 0} บิล
              </p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-cyber-primary/20 flex items-center justify-center">
              <Wallet className="w-6 h-6 text-cyber-primary" />
            </div>
          </div>
        </motion.div>

        {/* Transferred Amount */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="p-6 bg-cyber-card border border-cyber-border rounded-xl"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">โอนแล้วสะสม</p>
              <p className="text-3xl font-bold text-cyber-green mt-1">
                {formatCurrency(balance?.transferred?.totalAmount || 0)}
              </p>
              <p className="text-sm text-gray-500 mt-1">
                {balance?.transferred?.transferCount || 0} ครั้ง
              </p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-cyber-green/20 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-cyber-green" />
            </div>
          </div>
        </motion.div>

        {/* Action */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="p-6 bg-gradient-to-br from-cyber-primary/20 to-cyber-purple/20 border border-cyber-primary/30 rounded-xl"
        >
          <div className="flex flex-col h-full justify-between">
            <div>
              <p className="text-sm text-cyber-primary">ดำเนินการ</p>
              <p className="text-lg font-semibold text-white mt-1">
                โอนยอดสิ้นวัน
              </p>
            </div>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowTransferModal(true)}
              disabled={!balance?.pending?.totalAmount}
              className="mt-4 flex items-center justify-center gap-2 px-4 py-2 bg-cyber-primary text-white rounded-lg hover:bg-cyber-primary/80 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ArrowRightLeft className="w-4 h-4" />
              สร้างรายการโอน
            </motion.button>
          </div>
        </motion.div>
      </div>

      {/* Pending Bills List */}
      <div className="bg-cyber-card border border-cyber-border rounded-xl overflow-hidden">
        <div className="p-4 border-b border-cyber-border flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Receipt className="w-5 h-5 text-cyber-primary" />
            บิลที่รอโอน ({pendingBills.length})
          </h2>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <div className="w-8 h-8 border-2 border-cyber-primary border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : pendingBills.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-cyber-green" />
            <p>ไม่มีบิลที่รอโอน</p>
            <p className="text-sm mt-1">ทุกยอดขายได้รับการโอนแล้ว</p>
          </div>
        ) : (
          <div className="divide-y divide-cyber-border">
            {pendingBills.map((bill) => (
              <div
                key={bill.id}
                className="p-4 flex items-center justify-between hover:bg-cyber-dark/50"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-cyber-primary/20 flex items-center justify-center">
                    <Receipt className="w-5 h-5 text-cyber-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-white">{bill.display_name}</p>
                    <p className="text-sm text-gray-500">
                      {bill.bill_number} • {formatDate(bill.closed_at)}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-white">
                    {formatCurrency(bill.total_amount)}
                  </p>
                  <span className="text-xs px-2 py-0.5 rounded bg-cyber-dark text-gray-400">
                    {bill.payment_method}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Transfers */}
      <div className="bg-cyber-card border border-cyber-border rounded-xl overflow-hidden">
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="w-full p-4 border-b border-cyber-border flex items-center justify-between hover:bg-cyber-dark/30"
        >
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-cyber-green" />
            ประวัติการโอน
          </h2>
          {showHistory ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </button>

        <AnimatePresence>
          {showHistory && (
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: 'auto' }}
              exit={{ height: 0 }}
              className="overflow-hidden"
            >
              {balance?.recentTransfers?.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <p>ยังไม่มีประวัติการโอน</p>
                </div>
              ) : (
                <div className="divide-y divide-cyber-border">
                  {balance?.recentTransfers?.map((transfer) => (
                    <div
                      key={transfer.id}
                      className="p-4 flex items-center justify-between hover:bg-cyber-dark/50"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-cyber-green/20 flex items-center justify-center">
                          <CheckCircle2 className="w-5 h-5 text-cyber-green" />
                        </div>
                        <div>
                          <p className="font-medium text-white">
                            โอนยอด {formatDate(transfer.transfer_date)}
                          </p>
                          <p className="text-sm text-gray-500">
                            เงินสด: {formatCurrency(transfer.cash_amount)} • ธนาคาร:{' '}
                            {formatCurrency(transfer.bank_amount)}
                            {transfer.reference && ` • Ref: ${transfer.reference}`}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-cyber-green">
                          {formatCurrency(transfer.total_amount)}
                        </p>
                        <p className="text-xs text-gray-500">
                          โดย {transfer.created_by_name || 'System'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Transfer Modal */}
      <TransferModal
        isOpen={showTransferModal}
        onClose={() => setShowTransferModal(false)}
        pendingAmount={balance?.pending?.totalAmount || 0}
        pendingBills={pendingBills}
        onSuccess={fetchData}
      />
    </div>
  )
}

// ==================== Transfer Modal ====================

interface TransferModalProps {
  isOpen: boolean
  onClose: () => void
  pendingAmount: number
  pendingBills: PendingBill[]
  onSuccess: () => void
}

function TransferModal({
  isOpen,
  onClose,
  pendingAmount,
  pendingBills,
  onSuccess,
}: TransferModalProps) {
  const [transferDate, setTransferDate] = useState(
    new Date().toISOString().split('T')[0]
  )
  const [cashAmount, setCashAmount] = useState('')
  const [bankAmount, setBankAmount] = useState('')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const totalEntered =
    (parseFloat(cashAmount) || 0) + (parseFloat(bankAmount) || 0)
  const difference = pendingAmount - totalEntered

  const handleSubmit = async () => {
    if (totalEntered <= 0) {
      toast.error('กรุณาระบุจำนวนเงิน')
      return
    }

    if (Math.abs(difference) > 0.01) {
      toast.error(`ยอดไม่ตรงกัน: ต่างกัน ฿${Math.abs(difference).toFixed(2)}`)
      return
    }

    try {
      setSaving(true)
      const res = await posService.createClearingTransfer({
        transfer_date: transferDate,
        cash_amount: parseFloat(cashAmount) || 0,
        bank_amount: parseFloat(bankAmount) || 0,
        bill_ids: pendingBills.map((b) => b.id),
        reference: reference || undefined,
        notes: notes || undefined,
      })

      if (res.success) {
        toast.success('โอนยอดสำเร็จ')
        onSuccess()
        onClose()
      }
    } catch (error) {
      toast.error('ไม่สามารถโอนยอดได้')
    } finally {
      setSaving(false)
    }
  }

  const setAutoAmount = () => {
    // Auto split: assume cash is 60%, bank is 40% if not specified
    if (!cashAmount && !bankAmount) {
      const cash = Math.round(pendingAmount * 0.6)
      const bank = pendingAmount - cash
      setCashAmount(cash.toString())
      setBankAmount(bank.toString())
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-cyber-card border border-cyber-border rounded-2xl w-full max-w-lg"
      >
        {/* Header */}
        <div className="p-6 border-b border-cyber-border">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5 text-cyber-primary" />
              โอนยอด Clearing
            </h2>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-cyber-dark text-gray-400 hover:text-white"
            >
              ×
            </button>
          </div>
          <p className="text-gray-400 text-sm mt-1">
            โอนยอดจากลูกหนี้การค้า-POS (1180) เข้าบัญชีเงินสด/ธนาคาร
          </p>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {/* Pending Amount Display */}
          <div className="p-4 bg-cyber-primary/10 border border-cyber-primary/30 rounded-lg">
            <p className="text-sm text-cyber-primary">ยอดที่ต้องโอน</p>
            <p className="text-2xl font-bold text-white">
              ฿{pendingAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
            </p>
            <p className="text-sm text-gray-400">{pendingBills.length} บิล</p>
          </div>

          {/* Date */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">วันที่โอน</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="date"
                value={transferDate}
                onChange={(e) => setTransferDate(e.target.value)}
                className="w-full pl-10 pr-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white focus:outline-none focus:border-cyber-primary"
              />
            </div>
          </div>

          {/* Amount Split */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1 flex items-center gap-1">
                <Wallet className="w-3 h-3" />
                เงินสด
              </label>
              <input
                type="number"
                value={cashAmount}
                onChange={(e) => setCashAmount(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white focus:outline-none focus:border-cyber-primary"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1 flex items-center gap-1">
                <Building2 className="w-3 h-3" />
                ธนาคาร
              </label>
              <input
                type="number"
                value={bankAmount}
                onChange={(e) => setBankAmount(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white focus:outline-none focus:border-cyber-primary"
              />
            </div>
          </div>

          {/* Auto-fill button */}
          <button
            onClick={setAutoAmount}
            className="text-sm text-cyber-primary hover:underline"
          >
            กำหนดอัตโนมัติ (60% เงินสด, 40% ธนาคาร)
          </button>

          {/* Difference warning */}
          {Math.abs(difference) > 0.01 && totalEntered > 0 && (
            <div
              className={`p-3 rounded-lg flex items-center gap-2 ${
                difference > 0 ? 'bg-red-500/10 text-red-400' : 'bg-yellow-500/10 text-yellow-400'
              }`}
            >
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">
                {difference > 0
                  ? `ขาดอีก ฿${difference.toFixed(2)}`
                  : `เกิน ฿${Math.abs(difference).toFixed(2)}`}
              </span>
            </div>
          )}

          {/* Total entered */}
          <div className="p-3 bg-cyber-dark rounded-lg">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">ยอดที่ระบุ:</span>
              <span className="text-white font-medium">
                ฿{totalEntered.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Reference & Notes */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">เลขที่อ้างอิง (optional)</label>
            <div className="relative">
              <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="เช่น สลิปโอน, เลขที่เอกสาร"
                className="w-full pl-10 pr-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white focus:outline-none focus:border-cyber-primary"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">หมายเหตุ (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white focus:outline-none focus:border-cyber-primary resize-none"
              placeholder="บันทึกเพิ่มเติม..."
            />
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-cyber-border flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
          >
            ยกเลิก
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || Math.abs(difference) > 0.01 || totalEntered <= 0}
            className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-cyber-primary to-cyber-purple text-white rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {saving ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                กำลังบันทึก...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                ยืนยันการโอน
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  )
}
