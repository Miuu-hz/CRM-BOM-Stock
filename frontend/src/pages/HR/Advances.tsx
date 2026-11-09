import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Plus, X } from 'lucide-react'
import toast from 'react-hot-toast'
import hrService, {
  EmployeeAdvance,
  EmployeeAdvanceDetail,
  AdvanceKind,
  AdvanceStatus,
  Employee,
} from '../../services/hr.service'
import { accountsApi, Account } from '../../services/accounting'

type FilterStatus = 'ALL' | 'PENDING' | 'APPROVED' | 'ACTIVE' | 'CLOSED' | 'REJECTED_CANCELLED'

const STATUS_CHIPS: Array<{ key: FilterStatus; label: string }> = [
  { key: 'ALL', label: 'ทั้งหมด' },
  { key: 'PENDING', label: 'รออนุมัติ' },
  { key: 'APPROVED', label: 'อนุมัติแล้ว-รอจ่าย' },
  { key: 'ACTIVE', label: 'กำลังหัก' },
  { key: 'CLOSED', label: 'ปิดแล้ว' },
  { key: 'REJECTED_CANCELLED', label: 'ไม่อนุมัติ/ยกเลิก' },
]

const STATUS_LABELS: Record<AdvanceStatus, string> = {
  PENDING: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว-รอจ่าย',
  ACTIVE: 'กำลังหัก',
  CLOSED: 'ปิดแล้ว',
  REJECTED: 'ไม่อนุมัติ',
  CANCELLED: 'ยกเลิก',
}

const STATUS_BADGE: Record<AdvanceStatus, string> = {
  PENDING: 'bg-amber-500/15 text-amber-600',
  APPROVED: 'bg-blue-500/15 text-blue-600',
  ACTIVE: 'bg-indigo-500/15 text-indigo-600',
  CLOSED: 'bg-[var(--success-soft)] text-[var(--success)]',
  REJECTED: 'bg-[var(--danger-soft)] text-danger',
  CANCELLED: 'bg-[var(--surface-2)] text-[var(--fg-3)]',
}

const fmt = (n: number | undefined | null) =>
  Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const todayStr = () => new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD เวลาเครื่อง (toISOString เพี้ยนเป็นเมื่อวานช่วงตี 0–7)

function nextMonthPeriod(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  if (m === 12) {
    return `${y + 1}-01`
  }
  return `${y}-${String(m + 1).padStart(2, '0')}`
}

export default function Advances() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [advances, setAdvances] = useState<EmployeeAdvance[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('ALL')
  const [filterEmployeeId, setFilterEmployeeId] = useState('')

  // Create Modal State
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [newEmpId, setNewEmpId] = useState('')
  const [newKind, setNewKind] = useState<AdvanceKind>('ADVANCE')
  const [newAmount, setNewAmount] = useState('')
  const [newInstallments, setNewInstallments] = useState('3')
  const [newInterestRate, setNewInterestRate] = useState('0')
  const [defaultLoanInterestRate, setDefaultLoanInterestRate] = useState(0)
  const [newStartPeriod, setNewStartPeriod] = useState(nextMonthPeriod())
  const [newReason, setNewReason] = useState('')
  const [creating, setCreating] = useState(false)

  // Disburse Modal State
  const [disburseModalOpen, setDisburseModalOpen] = useState(false)
  const [disbursingAdvance, setDisbursingAdvance] = useState<EmployeeAdvance | null>(null)
  const [disburseDate, setDisburseDate] = useState(todayStr())
  const [payAccountId, setPayAccountId] = useState('')
  const [assetAccounts, setAssetAccounts] = useState<Account[]>([])
  const [disbursing, setDisbursing] = useState(false)

  // Repay Cash Modal State
  const [repayCashModalOpen, setRepayCashModalOpen] = useState(false)
  const [repayingAdvance, setRepayingAdvance] = useState<EmployeeAdvance | null>(null)
  const [repayAmount, setRepayAmount] = useState('')
  const [repayDate, setRepayDate] = useState(todayStr())
  const [repayPayAccountId, setRepayPayAccountId] = useState('')
  const [repaying, setRepaying] = useState(false)

  // Cancel Modal State
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [cancellingAdvance, setCancellingAdvance] = useState<EmployeeAdvance | null>(null)
  const [cancelling, setCancelling] = useState(false)

  // Detail Modal / Side Panel State
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [selectedDetail, setSelectedDetail] = useState<EmployeeAdvanceDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Load baseline active employees and asset accounts
  useEffect(() => {
    hrService
      .getEmployees({ status: 'ACTIVE' })
      .then((emps) => setEmployees(emps || []))
      .catch(() => {})

    accountsApi
      .getAll({ active: true })
      .then((res) => {
        const all: Account[] = res.data?.data || res.data || []
        const bankList = all.filter(
          (a: Account) => a.code.startsWith('111') || a.code === '1110' || a.type === 'ASSET'
        )
        setAssetAccounts(bankList)
      })
      .catch(() => {})

    hrService
      .getSettings()
      .then((s) => {
        const rate = s?.loanInterestRatePct ?? 0
        setDefaultLoanInterestRate(rate)
        setNewInterestRate((prev) => (prev === '0' || prev === '' ? String(rate) : prev))
      })
      .catch(() => {
        setDefaultLoanInterestRate(0)
      })
  }, [])

  // Load Advances list
  const loadAdvances = useCallback(async () => {
    setLoading(true)
    try {
      const params: { employee_id?: string; status?: AdvanceStatus } = {}
      if (filterEmployeeId) params.employee_id = filterEmployeeId
      if (filterStatus !== 'ALL' && filterStatus !== 'REJECTED_CANCELLED') {
        params.status = filterStatus as AdvanceStatus
      }
      const list = await hrService.getAdvances(params)
      let rows = list || []
      if (filterStatus === 'REJECTED_CANCELLED') {
        rows = rows.filter((r) => r.status === 'REJECTED' || r.status === 'CANCELLED')
      }
      if (filterEmployeeId) {
        rows = rows.filter((r) => r.employee_id === filterEmployeeId)
      }
      setAdvances(rows)
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'โหลดรายการเบิกล่วงหน้า/เงินยืมไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [filterStatus, filterEmployeeId])

  useEffect(() => {
    loadAdvances()
  }, [loadAdvances])

  // Live preview for LOAN: interest and installment with interest
  const loanCalc = useMemo(() => {
    const amt = parseFloat(newAmount)
    const inst = parseInt(newInstallments, 10)
    const rate = parseFloat(newInterestRate)
    const safeRate = isNaN(rate) || rate < 0 ? 0 : rate
    if (!amt || isNaN(amt) || !inst || isNaN(inst) || inst <= 0) {
      return { interest: 0, installment: 0 }
    }
    const interest = Math.round(((amt * safeRate) / 100) * (inst / 12) * 100) / 100
    const installment = Math.ceil(Math.round((amt + interest) * 100) / inst) / 100
    return { interest, installment }
  }, [newAmount, newInstallments, newInterestRate])

  // Repayment running balance calculation for detail modal
  const repaymentsWithBalance = useMemo(() => {
    if (!selectedDetail) return []
    const list = [...(selectedDetail.repayments || [])]
    list.sort((a, b) => a.period.localeCompare(b.period))
    // ponytail: total starting debt includes interest when set
    let remaining = Math.round(((selectedDetail.amount || 0) + (selectedDetail.interest_amount || 0)) * 100) / 100
    return list.map((item) => {
      remaining = Math.max(0, Math.round((remaining - item.amount) * 100) / 100)
      return {
        ...item,
        runningBalance: remaining,
      }
    })
  }, [selectedDetail])

  const openCreateModal = () => {
    setNewEmpId('')
    setNewKind('ADVANCE')
    setNewAmount('')
    setNewInstallments('3')
    setNewInterestRate(String(defaultLoanInterestRate))
    setNewStartPeriod(nextMonthPeriod())
    setNewReason('')
    setCreateModalOpen(true)
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newEmpId) {
      toast.error('กรุณาเลือกพนักงาน')
      return
    }
    const amt = parseFloat(newAmount)
    if (isNaN(amt) || amt <= 0) {
      toast.error('กรุณากรอกยอดเงินที่ถูกต้อง')
      return
    }
    const inst = newKind === 'LOAN' ? parseInt(newInstallments, 10) : 1
    if (newKind === 'LOAN' && (isNaN(inst) || inst < 1 || inst > 24)) {
      toast.error('จำนวนงวดต้องอยู่ระหว่าง 1 ถึง 24 งวด')
      return
    }
    let interestRate: number | undefined = undefined
    if (newKind === 'LOAN') {
      const rate = parseFloat(newInterestRate)
      if (isNaN(rate) || rate < 0 || rate > 15) {
        toast.error('ดอกเบี้ยต้องอยู่ระหว่าง 0–15% ต่อปี')
        return
      }
      interestRate = rate
    }
    if (!newStartPeriod) {
      toast.error('กรุณาระบุงวดเริ่มต้น')
      return
    }

    setCreating(true)
    try {
      const payload: any = {
        employee_id: newEmpId,
        kind: newKind,
        amount: amt,
        installments: inst,
        start_period: newStartPeriod,
        reason: newReason.trim() || undefined,
      }
      if (newKind === 'LOAN') {
        payload.interest_rate = interestRate ?? 0
      }
      await hrService.createAdvance(payload)
      toast.success('ส่งคำขอแล้ว รออนุมัติในกล่องอนุมัติ')
      setCreateModalOpen(false)
      loadAdvances()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || 'สร้างคำขอไม่สำเร็จ')
    } finally {
      setCreating(false)
    }
  }

  const openRepayCashModal = async (adv: EmployeeAdvance) => {
    setRepayingAdvance(adv)
    setRepayAmount(String(adv.outstanding))
    setRepayDate(todayStr())
    let bankList = assetAccounts
    if (bankList.length === 0) {
      try {
        const res = await accountsApi.getAll({ active: true })
        const all: Account[] = res.data?.data || res.data || []
        bankList = all.filter(
          (a: Account) => a.code.startsWith('111') || a.code === '1110' || a.type === 'ASSET'
        )
        setAssetAccounts(bankList)
      } catch {
        // ignore account loading failure
      }
    }
    if (bankList.length > 0) {
      const preferred = bankList.find((a: Account) => a.code === '1112' || a.code === '1111') || bankList[0]
      setRepayPayAccountId(preferred.id)
    }
    setRepayCashModalOpen(true)
  }

  const handleRepayCash = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!repayingAdvance) return
    const amt = parseFloat(repayAmount)
    if (isNaN(amt) || amt <= 0 || amt > repayingAdvance.outstanding) {
      toast.error('ยอดเงินต้องมากกว่า 0 และไม่เกินยอดคงค้าง')
      return
    }
    if (!repayPayAccountId) {
      toast.error('กรุณาเลือกบัญชีรับเงิน')
      return
    }
    if (!repayDate) {
      toast.error('กรุณาระบุวันที่รับเงิน')
      return
    }
    setRepaying(true)
    try {
      await hrService.repayCashAdvance(repayingAdvance.id, {
        amount: amt,
        date: repayDate,
        pay_account_id: repayPayAccountId,
      })
      toast.success('บันทึกรับคืนแล้ว')
      setRepayCashModalOpen(false)
      setRepayingAdvance(null)
      loadAdvances()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || 'บันทึกรับคืนไม่สำเร็จ')
    } finally {
      setRepaying(false)
    }
  }

  const openDisburseModal = async (adv: EmployeeAdvance) => {
    setDisbursingAdvance(adv)
    setDisburseDate(todayStr())
    let bankList = assetAccounts
    if (bankList.length === 0) {
      try {
        const res = await accountsApi.getAll({ active: true })
        const all: Account[] = res.data?.data || res.data || []
        // ponytail: match Payroll.tsx asset account filtering pattern
        bankList = all.filter(
          (a: Account) => a.code.startsWith('111') || a.code === '1110' || a.type === 'ASSET'
        )
        setAssetAccounts(bankList)
      } catch {
        // ignore account loading failure
      }
    }
    if (bankList.length > 0) {
      const preferred = bankList.find((a: Account) => a.code === '1112' || a.code === '1111') || bankList[0]
      setPayAccountId(preferred.id)
    }
    setDisburseModalOpen(true)
  }

  const handleDisburse = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!disbursingAdvance) return
    if (!payAccountId) {
      toast.error('กรุณาเลือกบัญชีจ่ายเงิน')
      return
    }
    setDisbursing(true)
    try {
      await hrService.disburseAdvance(disbursingAdvance.id, {
        pay_account_id: payAccountId,
        date: disburseDate,
      })
      toast.success('บันทึกการจ่ายเงินแล้ว')
      setDisburseModalOpen(false)
      setDisbursingAdvance(null)
      loadAdvances()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || 'บันทึกจ่ายเงินไม่สำเร็จ')
    } finally {
      setDisbursing(false)
    }
  }

  const openCancelModal = (adv: EmployeeAdvance) => {
    setCancellingAdvance(adv)
    setCancelModalOpen(true)
  }

  const handleCancel = async () => {
    if (!cancellingAdvance) return
    setCancelling(true)
    try {
      await hrService.cancelAdvance(cancellingAdvance.id)
      toast.success('ยกเลิกคำขอแล้ว')
      setCancelModalOpen(false)
      setCancellingAdvance(null)
      loadAdvances()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || 'ยกเลิกคำขอไม่สำเร็จ')
    } finally {
      setCancelling(false)
    }
  }

  const openDetail = async (id: string) => {
    setLoadingDetail(true)
    setDetailModalOpen(true)
    try {
      const data = await hrService.getAdvance(id)
      setSelectedDetail(data)
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'โหลดรายละเอียดไม่สำเร็จ')
      setDetailModalOpen(false)
    } finally {
      setLoadingDetail(false)
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[var(--fg-1)]">เบิกล่วงหน้า / เงินยืม</h1>
          <p className="text-xs text-[var(--fg-3)] mt-0.5">
            จัดการคำขอเบิกค่าจ้างล่วงหน้าและเงินยืมพนักงาน พร้อมติดตามการหักชำระ
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="phopy-btn-primary px-3 py-2 text-sm rounded-lg font-semibold flex items-center gap-1.5 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          สร้างคำขอ
        </button>
      </div>

      {/* Info note */}
      <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-xs text-[var(--fg-2)]">
        <span>การพิจารณาอนุมัติคำขอเบิก/เงินยืม ดำเนินการผ่านระบบอนุมัติเอกสาร</span>
        <Link to="/approvals" className="text-blue-600 dark:text-blue-400 hover:underline font-medium">
          ไปยังกล่องอนุมัติ →
        </Link>
      </div>

      {/* Filters */}
      <div className="phopy-card p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Status filter chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_CHIPS.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => setFilterStatus(chip.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filterStatus === chip.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-[var(--surface-2)] text-[var(--fg-2)] hover:bg-[var(--surface-3,var(--surface-2))] border border-[var(--border)]'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* Employee filter */}
        <div className="flex items-center gap-2">
          <select
            value={filterEmployeeId}
            onChange={(e) => setFilterEmployeeId(e.target.value)}
            aria-label="กรองตามพนักงาน"
            className="px-3 py-1.5 text-xs rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--fg-1)]"
          >
            <option value="">พนักงานทุกคน</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.code} - {emp.first_name} {emp.last_name || ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="phopy-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="phopy-table w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[var(--fg-3)]">
                <th className="py-3 px-3">พนักงาน</th>
                <th className="py-3 px-3">ประเภท</th>
                <th className="py-3 px-3 text-right">ยอด</th>
                <th className="py-3 px-3">วิธีหัก</th>
                <th className="py-3 px-3 text-right">หักแล้ว</th>
                <th className="py-3 px-3 text-right">คงค้าง</th>
                <th className="py-3 px-3 text-center">สถานะ</th>
                <th className="py-3 px-3 text-right">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-[var(--fg-3)]">
                    กำลังโหลดข้อมูล...
                  </td>
                </tr>
              ) : advances.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-[var(--fg-3)]">
                    ไม่พบรายการเบิกล่วงหน้าหรือเงินยืม
                  </td>
                </tr>
              ) : (
                advances.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => openDetail(r.id)}
                    className="cursor-pointer hover:bg-[var(--surface-2)]/60 transition-colors"
                  >
                    <td className="py-3 px-3">
                      <div className="font-semibold text-[var(--fg-1)]">{r.employee_name}</div>
                      <div className="text-[11px] font-mono text-[var(--fg-3)]">{r.employee_code}</div>
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                          r.kind === 'ADVANCE'
                            ? 'bg-purple-500/10 text-purple-600'
                            : 'bg-blue-500/10 text-blue-600'
                        }`}
                      >
                        {r.kind === 'ADVANCE' ? 'เบิกล่วงหน้า' : 'เงินยืม'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-medium text-[var(--fg-1)]">
                      <div>{fmt(r.amount)}</div>
                      {Number(r.interest_amount || 0) > 0 && (
                        <div className="text-[11px] font-normal text-[var(--fg-3)]">
                          ดอกเบี้ย {r.interest_rate}% ({fmt(r.interest_amount)})
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3 text-[var(--fg-2)]">
                      {r.kind === 'ADVANCE'
                        ? `หักงวด ${r.start_period} ครั้งเดียว`
                        : `ผ่อน ${r.installments} งวด × ${fmt(r.installment_amount)} เริ่ม ${r.start_period}`}
                    </td>
                    <td className="py-3 px-3 text-right text-[var(--fg-2)]">{fmt(r.repaid)}</td>
                    <td className="py-3 px-3 text-right font-medium text-[var(--fg-1)]">
                      {fmt(r.outstanding)}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${
                          STATUS_BADGE[r.status] || ''
                        }`}
                      >
                        {STATUS_LABELS[r.status] || r.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        {r.status === 'APPROVED' && (
                          <button
                            type="button"
                            onClick={() => openDisburseModal(r)}
                            className="phopy-btn-primary px-2.5 py-1 rounded text-xs font-medium"
                          >
                            จ่ายเงิน
                          </button>
                        )}
                        {r.status === 'ACTIVE' && (
                          <button
                            type="button"
                            onClick={() => openRepayCashModal(r)}
                            className="px-2.5 py-1 rounded text-xs font-medium border border-blue-500/40 text-blue-600 hover:bg-blue-500/10"
                          >
                            รับคืนเงินสด
                          </button>
                        )}
                        {(r.status === 'PENDING' || r.status === 'APPROVED') && (
                          <button
                            type="button"
                            onClick={() => openCancelModal(r)}
                            className="px-2.5 py-1 rounded text-xs font-medium border border-red-500/40 text-red-600 hover:bg-red-500/10"
                          >
                            ยกเลิก
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 bg-[var(--surface-2)]/50 border-t border-[var(--border)] text-xs text-[var(--fg-3)]">
          หักในรอบเงินเดือนให้อัตโนมัติ · เงินยืมหักไม่เกิน 10% ของค่าจ้างต่องวด (ม.76) · เบิกค่าจ้างที่ทำแล้วไม่นับเพดานนี้
        </div>
      </div>

      {/* Modal 1: สร้างคำขอ */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="phopy-card w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="text-base font-bold text-[var(--fg-1)]">สร้างคำขอเบิก / เงินยืม</h2>
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                className="p-1 rounded-lg hover:bg-[var(--surface-2)]"
              >
                <X className="w-4 h-4 text-[var(--fg-3)]" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4 text-xs">
              <div>
                <label htmlFor="create-advance-employee" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  พนักงาน *
                </label>
                <select
                  id="create-advance-employee"
                  required
                  value={newEmpId}
                  onChange={(e) => setNewEmpId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                >
                  <option value="">-- เลือกพนักงาน --</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.code} - {emp.first_name} {emp.last_name || ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">ประเภท *</label>
                <div className="grid grid-cols-2 gap-3">
                  <label
                    className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer text-xs transition-colors ${
                      newKind === 'ADVANCE'
                        ? 'border-blue-600 bg-blue-500/10 text-[var(--fg-1)]'
                        : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-2)]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="advance-kind"
                      value="ADVANCE"
                      checked={newKind === 'ADVANCE'}
                      onChange={() => setNewKind('ADVANCE')}
                      aria-label="เบิกล่วงหน้า"
                    />
                    <div>
                      <div className="font-semibold">เบิกล่วงหน้า (ADVANCE)</div>
                      <div className="text-[11px] text-[var(--fg-3)]">หักงวดเดียว</div>
                    </div>
                  </label>
                  <label
                    className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer text-xs transition-colors ${
                      newKind === 'LOAN'
                        ? 'border-blue-600 bg-blue-500/10 text-[var(--fg-1)]'
                        : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-2)]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="advance-kind"
                      value="LOAN"
                      checked={newKind === 'LOAN'}
                      onChange={() => setNewKind('LOAN')}
                      aria-label="เงินยืม"
                    />
                    <div>
                      <div className="font-semibold">เงินยืม (LOAN)</div>
                      <div className="text-[11px] text-[var(--fg-3)]">ผ่อนชำระหลายงวด</div>
                    </div>
                  </label>
                </div>
              </div>

              <div>
                <label htmlFor="create-advance-amount" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  ยอดเงิน (บาท) *
                </label>
                <input
                  id="create-advance-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  placeholder="0.00"
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              {newKind === 'LOAN' && (
                <div>
                  <label
                    htmlFor="create-advance-installments"
                    className="block text-xs font-medium text-[var(--fg-2)] mb-1"
                  >
                    จำนวนงวดผ่อน (1–24 งวด) *
                  </label>
                  <input
                    id="create-advance-installments"
                    type="number"
                    min="1"
                    max="24"
                    step="1"
                    required
                    value={newInstallments}
                    onChange={(e) => setNewInstallments(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                </div>
              )}

              {newKind === 'LOAN' && (
                <div>
                  <label
                    htmlFor="create-advance-interest-rate"
                    className="block text-xs font-medium text-[var(--fg-2)] mb-1"
                  >
                    ดอกเบี้ย (% ต่อปี)
                  </label>
                  <input
                    id="create-advance-interest-rate"
                    type="number"
                    min="0"
                    max="15"
                    step="any"
                    value={newInterestRate}
                    onChange={(e) => setNewInterestRate(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                </div>
              )}

              {newKind === 'LOAN' && (
                <div className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-xs text-[var(--fg-2)] flex items-center justify-between">
                  <span>ประมาณการผ่อน:</span>
                  <span className="font-bold text-blue-600 dark:text-blue-400">
                    ดอกเบี้ยรวม {fmt(loanCalc.interest)} บาท · ผ่อนงวดละ {fmt(loanCalc.installment)} บาท
                  </span>
                </div>
              )}

              <div>
                <label
                  htmlFor="create-advance-start-period"
                  className="block text-xs font-medium text-[var(--fg-2)] mb-1"
                >
                  งวดเริ่มต้นที่หัก *
                </label>
                <input
                  id="create-advance-start-period"
                  type="month"
                  required
                  value={newStartPeriod}
                  onChange={(e) => setNewStartPeriod(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              <div>
                <label htmlFor="create-advance-reason" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  เหตุผลความจำเป็น
                </label>
                <textarea
                  id="create-advance-reason"
                  rows={2}
                  placeholder="ระบุเหตุผล (ถ้ามี)"
                  value={newReason}
                  onChange={(e) => setNewReason(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              <div className="pt-3 border-t border-[var(--border)] flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="phopy-btn-primary px-4 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 disabled:opacity-50"
                >
                  {creating ? 'กำลังส่งคำขอ...' : 'ส่งคำขอ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: จ่ายเงิน */}
      {disburseModalOpen && disbursingAdvance && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="phopy-card w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="text-base font-bold text-[var(--fg-1)]">บันทึกจ่ายเงิน</h2>
              <button
                type="button"
                onClick={() => {
                  setDisburseModalOpen(false)
                  setDisbursingAdvance(null)
                }}
                className="p-1 rounded-lg hover:bg-[var(--surface-2)]"
              >
                <X className="w-4 h-4 text-[var(--fg-3)]" />
              </button>
            </div>

            <div className="p-3 rounded-lg bg-[var(--surface-2)] space-y-1 text-xs">
              <div>
                <span className="text-[var(--fg-3)]">พนักงาน:</span>{' '}
                <span className="font-semibold text-[var(--fg-1)]">
                  {disbursingAdvance.employee_name} ({disbursingAdvance.employee_code})
                </span>
              </div>
              <div>
                <span className="text-[var(--fg-3)]">ประเภท:</span>{' '}
                <span className="font-medium text-[var(--fg-1)]">
                  {disbursingAdvance.kind === 'ADVANCE' ? 'เบิกล่วงหน้า' : 'เงินยืม'}
                </span>
              </div>
              <div>
                <span className="text-[var(--fg-3)]">ยอดเงินที่ต้องจ่าย:</span>{' '}
                <span className="font-bold text-blue-600 dark:text-blue-400">
                  {fmt(disbursingAdvance.amount)} บาท
                </span>
              </div>
            </div>

            <form onSubmit={handleDisburse} className="space-y-4 text-xs">
              <div>
                <label htmlFor="disburse-date" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  วันที่จ่ายเงิน *
                </label>
                <input
                  id="disburse-date"
                  type="date"
                  required
                  value={disburseDate}
                  onChange={(e) => setDisburseDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              <div>
                <label htmlFor="disburse-account" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  บัญชีจ่ายเงิน (เงินสด / เงินฝากธนาคาร - สินทรัพย์) *
                </label>
                <select
                  id="disburse-account"
                  required
                  value={payAccountId}
                  onChange={(e) => setPayAccountId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                >
                  <option value="">-- เลือกบัญชีสินทรัพย์ --</option>
                  {assetAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.code} - {acc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-3 border-t border-[var(--border)] flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDisburseModalOpen(false)
                    setDisbursingAdvance(null)
                  }}
                  className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={disbursing}
                  className="phopy-btn-primary px-4 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 disabled:opacity-50"
                >
                  {disbursing ? 'กำลังบันทึก...' : 'ยืนยันจ่ายเงิน'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 3: ยืนยันยกเลิก */}
      {cancelModalOpen && cancellingAdvance && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="phopy-card w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="text-base font-bold text-[var(--fg-1)]">ยืนยันยกเลิกคำขอ</h2>
              <button
                type="button"
                onClick={() => {
                  setCancelModalOpen(false)
                  setCancellingAdvance(null)
                }}
                className="p-1 rounded-lg hover:bg-[var(--surface-2)]"
              >
                <X className="w-4 h-4 text-[var(--fg-3)]" />
              </button>
            </div>

            <div className="text-xs text-[var(--fg-2)] space-y-2">
              <p>คุณต้องการยกเลิกคำขอเบิก/เงินยืมนี้ใช่หรือไม่?</p>
              <div className="p-3 rounded-lg bg-[var(--surface-2)] space-y-1">
                <div>
                  <span className="text-[var(--fg-3)]">พนักงาน:</span>{' '}
                  <span className="font-semibold text-[var(--fg-1)]">
                    {cancellingAdvance.employee_name} ({cancellingAdvance.employee_code})
                  </span>
                </div>
                <div>
                  <span className="text-[var(--fg-3)]">ประเภท:</span>{' '}
                  <span className="text-[var(--fg-1)]">
                    {cancellingAdvance.kind === 'ADVANCE' ? 'เบิกล่วงหน้า' : 'เงินยืม'}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--fg-3)]">ยอด:</span>{' '}
                  <span className="font-bold text-[var(--fg-1)]">{fmt(cancellingAdvance.amount)} บาท</span>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-[var(--border)] flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCancelModalOpen(false)
                  setCancellingAdvance(null)
                }}
                className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] text-xs"
              >
                ปิด
              </button>
              <button
                type="button"
                disabled={cancelling}
                onClick={handleCancel}
                className="px-4 py-1.5 rounded-lg font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 text-xs"
              >
                {cancelling ? 'กำลังยกเลิก...' : 'ยืนยันยกเลิก'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 4: รายละเอียด & ประวัติการหัก */}
      {detailModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="phopy-card w-full max-w-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="text-base font-bold text-[var(--fg-1)]">รายละเอียดเบิกล่วงหน้า / เงินยืม</h2>
              <button
                type="button"
                onClick={() => {
                  setDetailModalOpen(false)
                  setSelectedDetail(null)
                }}
                className="p-1 rounded-lg hover:bg-[var(--surface-2)]"
              >
                <X className="w-4 h-4 text-[var(--fg-3)]" />
              </button>
            </div>

            {loadingDetail || !selectedDetail ? (
              <div className="py-8 text-center text-xs text-[var(--fg-3)]">กำลังโหลด...</div>
            ) : (
              <div className="space-y-4 text-xs">
                {/* Header Info */}
                <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-[var(--surface-2)]">
                  <div>
                    <span className="text-[var(--fg-3)]">พนักงาน:</span>{' '}
                    <span className="font-semibold text-[var(--fg-1)]">
                      {selectedDetail.employee_name} ({selectedDetail.employee_code})
                    </span>
                  </div>
                  <div>
                    <span className="text-[var(--fg-3)]">สถานะ:</span>{' '}
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full font-semibold ${
                        STATUS_BADGE[selectedDetail.status] || ''
                      }`}
                    >
                      {STATUS_LABELS[selectedDetail.status] || selectedDetail.status}
                    </span>
                  </div>
                  <div>
                    <span className="text-[var(--fg-3)]">ประเภท:</span>{' '}
                    <span className="font-medium text-[var(--fg-1)]">
                      {selectedDetail.kind === 'ADVANCE' ? 'เบิกล่วงหน้า' : 'เงินยืม'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[var(--fg-3)]">ยอดทั้งหมด:</span>{' '}
                    <span className="font-bold text-[var(--fg-1)]">{fmt(selectedDetail.amount)} บาท</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-[var(--fg-3)]">วิธีหัก:</span>{' '}
                    <span className="text-[var(--fg-2)]">
                      {selectedDetail.kind === 'ADVANCE'
                        ? `หักงวด ${selectedDetail.start_period} ครั้งเดียว`
                        : `ผ่อน ${selectedDetail.installments} งวด × ${fmt(selectedDetail.installment_amount)} เริ่ม ${selectedDetail.start_period}`}
                    </span>
                  </div>
                  <div>
                    <span className="text-[var(--fg-3)]">หักแล้ว:</span>{' '}
                    <span className="text-[var(--fg-2)]">{fmt(selectedDetail.repaid)} บาท</span>
                  </div>
                  <div>
                    <span className="text-[var(--fg-3)]">คงค้าง:</span>{' '}
                    <span className="font-semibold text-blue-600 dark:text-blue-400">
                      {fmt(selectedDetail.outstanding)} บาท
                    </span>
                  </div>
                  {Number(selectedDetail.interest_amount || 0) > 0 && (
                    <div>
                      <span className="text-[var(--fg-3)]">ดอกเบี้ย:</span>{' '}
                      <span className="text-[var(--fg-1)]">
                        {selectedDetail.interest_rate}% ({fmt(selectedDetail.interest_amount)} บาท)
                      </span>
                    </div>
                  )}
                  {selectedDetail.reason && (
                    <div className="col-span-2">
                      <span className="text-[var(--fg-3)]">เหตุผล:</span>{' '}
                      <span className="text-[var(--fg-2)]">{selectedDetail.reason}</span>
                    </div>
                  )}
                  {selectedDetail.disbursed_on && (
                    <div>
                      <span className="text-[var(--fg-3)]">วันที่จ่ายเงิน:</span>{' '}
                      <span className="text-[var(--fg-2)]">{selectedDetail.disbursed_on}</span>
                    </div>
                  )}
                  {selectedDetail.created_at && (
                    <div>
                      <span className="text-[var(--fg-3)]">วันที่สร้างคำขอ:</span>{' '}
                      <span className="text-[var(--fg-2)]">{selectedDetail.created_at.slice(0, 10)}</span>
                    </div>
                  )}
                </div>

                {/* Repayment History Table */}
                <div className="space-y-2">
                  <h3 className="font-semibold text-sm text-[var(--fg-1)]">ประวัติการหักในรอบเงินเดือน</h3>
                  {repaymentsWithBalance.length === 0 ? (
                    <div className="p-4 rounded-lg bg-[var(--surface-2)]/50 text-center text-[var(--fg-3)]">
                      ยังไม่มีรายการหักในรอบเงินเดือน
                    </div>
                  ) : (
                    <div className="border border-[var(--border)] rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-[var(--surface-2)] text-left text-[var(--fg-3)]">
                          <tr className="border-b border-[var(--border)]">
                            <th className="py-2 px-3">งวด</th>
                            <th className="py-2 px-3">ช่องทาง</th>
                            <th className="py-2 px-3 text-right">หัก</th>
                            <th className="py-2 px-3 text-right">ดอกเบี้ย</th>
                            <th className="py-2 px-3 text-right">คงค้างหลังหัก</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-subtle)]">
                          {repaymentsWithBalance.map((item, idx) => (
                            <tr key={item.run_id || idx} className="hover:bg-[var(--surface-2)]/40">
                              <td className="py-2 px-3 font-medium text-[var(--fg-1)]">{item.period}</td>
                              <td className="py-2 px-3 text-[var(--fg-2)]">
                                {item.source === 'CASH' ? 'รับคืนเงินสด' : 'หักเงินเดือน'}
                              </td>
                              <td className="py-2 px-3 text-right text-[var(--fg-2)]">{fmt(item.amount)}</td>
                              <td className="py-2 px-3 text-right text-[var(--fg-2)]">{fmt(item.interest)}</td>
                              <td className="py-2 px-3 text-right font-medium text-[var(--fg-1)]">
                                {fmt(item.runningBalance)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-[var(--border)] flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setDetailModalOpen(false)
                      setSelectedDetail(null)
                    }}
                    className="px-4 py-1.5 rounded-lg border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
                  >
                    ปิด
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal 5: รับคืนเงินสด */}
      {repayCashModalOpen && repayingAdvance && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="phopy-card w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="text-base font-bold text-[var(--fg-1)]">บันทึกรับคืนเงินสด</h2>
              <button
                type="button"
                onClick={() => {
                  setRepayCashModalOpen(false)
                  setRepayingAdvance(null)
                }}
                className="p-1 rounded-lg hover:bg-[var(--surface-2)]"
              >
                <X className="w-4 h-4 text-[var(--fg-3)]" />
              </button>
            </div>

            <div className="p-3 rounded-lg bg-[var(--surface-2)] space-y-1 text-xs">
              <div>
                <span className="text-[var(--fg-3)]">พนักงาน:</span>{' '}
                <span className="font-semibold text-[var(--fg-1)]">
                  {repayingAdvance.employee_name} ({repayingAdvance.employee_code})
                </span>
              </div>
              <div>
                <span className="text-[var(--fg-3)]">ประเภท:</span>{' '}
                <span className="font-medium text-[var(--fg-1)]">
                  {repayingAdvance.kind === 'ADVANCE' ? 'เบิกล่วงหน้า' : 'เงินยืม'}
                </span>
              </div>
              <div>
                <span className="text-[var(--fg-3)]">ยอดคงค้าง:</span>{' '}
                <span className="font-bold text-blue-600 dark:text-blue-400">
                  {fmt(repayingAdvance.outstanding)} บาท
                </span>
              </div>
            </div>

            <form onSubmit={handleRepayCash} className="space-y-4 text-xs">
              <div>
                <label htmlFor="repay-amount" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  ยอดเงินรับคืน (บาท) *
                </label>
                <input
                  id="repay-amount"
                  type="number"
                  min="0.01"
                  max={repayingAdvance.outstanding}
                  step="0.01"
                  required
                  value={repayAmount}
                  onChange={(e) => setRepayAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              <div>
                <label htmlFor="repay-date" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  วันที่รับเงิน *
                </label>
                <input
                  id="repay-date"
                  type="date"
                  required
                  value={repayDate}
                  onChange={(e) => setRepayDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              <div>
                <label htmlFor="repay-account" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  บัญชีรับเงิน (เงินสด / เงินฝากธนาคาร - สินทรัพย์) *
                </label>
                <select
                  id="repay-account"
                  required
                  value={repayPayAccountId}
                  onChange={(e) => setRepayPayAccountId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                >
                  <option value="">-- เลือกบัญชีสินทรัพย์ --</option>
                  {assetAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.code} - {acc.name}
                    </option>
                  ))}
                </select>
              </div>

              <p className="text-[11px] text-[var(--fg-3)]">
                ใช้เมื่อพนักงานคืนเงินเองหรือยกเลิกหลังจ่ายแล้ว · ลงบัญชี Dr เงินสด / Cr ลูกหนี้พนักงาน (+ ดอกเบี้ยรับ)
              </p>

              <div className="pt-3 border-t border-[var(--border)] flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setRepayCashModalOpen(false)
                    setRepayingAdvance(null)
                  }}
                  className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={repaying}
                  className="phopy-btn-primary px-4 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 disabled:opacity-50"
                >
                  {repaying ? 'กำลังบันทึก...' : 'บันทึกรับคืน'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
