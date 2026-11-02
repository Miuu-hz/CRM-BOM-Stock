import { useEffect, useState, useCallback } from 'react'
import {
  Banknote,
  Plus,
  CheckCircle2,
  BookOpen,
  CreditCard,
  Ban,
  Trash2,
  Download,
  FileSpreadsheet,
  Printer,
  X,
  Save,
} from 'lucide-react'
import toast from 'react-hot-toast'
import hrService, {
  PayrollRun,
  PayrollRunLine,
  PayrollRunLineInputs,
  PayrollRunStatus,
  OTKind,
  OtEntry,
  ExtraPayItemInput,
  OtherDeductionInput,
  AdvanceDeduction,
  EmploymentType,
  EmployeePayItem,
} from '../../services/hr.service'
import { accountsApi, Account } from '../../services/accounting'
import PayslipPrint from './PayslipPrint'

const STATUS_LABELS: Record<PayrollRunStatus, string> = {
  DRAFT: 'ร่าง (DRAFT)',
  APPROVED: 'อนุมัติแล้ว (APPROVED)',
  POSTED: 'ตั้งค้างจ่ายแล้ว (POSTED)',
  PAID: 'จ่ายเงินแล้ว (PAID)',
  VOID: 'ยกเลิก (VOID)',
}

const STATUS_BADGE: Record<PayrollRunStatus, string> = {
  DRAFT: 'bg-[var(--surface-2)] text-[var(--fg-2)]',
  APPROVED: 'bg-amber-500/15 text-amber-600',
  POSTED: 'bg-blue-500/15 text-blue-600',
  PAID: 'bg-[var(--success-soft)] text-[var(--success)]',
  VOID: 'bg-[var(--danger-soft)] text-danger',
}

const EMP_TYPE_LABELS: Record<EmploymentType, string> = {
  MONTHLY: 'รายเดือน',
  DAILY: 'รายวัน',
  HOURLY: 'รายชม.',
}

const OT_KIND_LABELS: Record<OTKind, string> = {
  WORKDAY_OT: 'OT วันทำงานปกติ (1.5x)',
  HOLIDAY_WORK: 'ทำงานวันหยุด (1x / 2x)',
  HOLIDAY_OT: 'OT วันหยุด (3x)',
}

const fmt = (n: number | undefined | null) =>
  Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const defaultPeriod = () => new Date().toISOString().slice(0, 7)

function periodEndDate(period: string): string {
  const [y, m] = period.split('-').map(Number)
  if (!y || !m) return new Date().toISOString().slice(0, 10)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
}

function downloadCsv(filename: string, csvText: string) {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function Payroll() {
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [currentRun, setCurrentRun] = useState<PayrollRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [newPeriod, setNewPeriod] = useState(defaultPeriod())
  const [creating, setCreating] = useState(false)
  const [acting, setActing] = useState(false)

  // Side panel state for editing a line
  const [selectedLine, setSelectedLine] = useState<PayrollRunLine | null>(null)
  const [editInputs, setEditInputs] = useState<PayrollRunLineInputs>({})
  const [empRecurringItems, setEmpRecurringItems] = useState<EmployeePayItem[]>([])
  const [savingLine, setSavingLine] = useState(false)

  // Post modal state
  const [postModalOpen, setPostModalOpen] = useState(false)
  const [payDate, setPayDate] = useState('')
  const [payAccountId, setPayAccountId] = useState('')
  const [otherDeductionAccountId, setOtherDeductionAccountId] = useState('')
  const [payNow, setPayNow] = useState(true)
  const [assetAccounts, setAssetAccounts] = useState<Account[]>([])
  const [allAccounts, setAllAccounts] = useState<Account[]>([])

  // Print state
  const [printSlips, setPrintSlips] = useState<PayrollRunLine[] | null>(null)

  const loadRunDetail = useCallback(async (runId: string) => {
    try {
      const detail = await hrService.getPayrollRun(runId)
      setCurrentRun(detail)
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'โหลดรายละเอียดรอบเงินเดือนไม่สำเร็จ')
    }
  }, [])

  const loadRuns = useCallback(
    async (selectId?: string) => {
      setLoading(true)
      try {
        const list = await hrService.getPayrollRuns()
        setRuns(list || [])
        const targetId = selectId || (list && list.length > 0 ? list[0].id : '')
        if (targetId) {
          await loadRunDetail(targetId)
        } else {
          setCurrentRun(null)
        }
      } catch (err: any) {
        toast.error(err?.response?.data?.error || 'โหลดรายการรอบเงินเดือนไม่สำเร็จ')
      } finally {
        setLoading(false)
      }
    },
    [loadRunDetail]
  )

  useEffect(() => {
    loadRuns()
  }, [loadRuns])

  const handleCreateRun = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newPeriod) return
    setCreating(true)
    try {
      const created = await hrService.createPayrollRun(newPeriod)
      toast.success(`สร้างรอบเงินเดือน ${newPeriod} แล้ว`)
      setRuns((prev) => [created, ...prev.filter((r) => r.id !== created.id)])
      setCurrentRun(created)
      setSelectedLine(null)
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'สร้างรอบเงินเดือนไม่สำเร็จ')
    } finally {
      setCreating(false)
    }
  }

  const openLineEditor = (line: PayrollRunLine) => {
    setSelectedLine(line)
    const inp = line.inputs || {}
    setEditInputs({
      daysWorked: inp.daysWorked ?? 0,
      hoursWorked: inp.hoursWorked ?? 0,
      unpaidLeaveDays: inp.unpaidLeaveDays ?? 0,
      lateMinutes: inp.lateMinutes ?? 0,
      disabledPayItemIds: [...(inp.disabledPayItemIds || [])],
      ot: [...(inp.ot || [])],
      extraPayItems: [...(inp.extraPayItems || [])],
      otherDeductions: [...(inp.otherDeductions || [])],
      advanceDeductions: inp.advanceDeductions ? inp.advanceDeductions.map((a) => ({ ...a })) : [],
    })
    setEmpRecurringItems([])
    if (hrService.getEmployeePayItems) {
      hrService
        .getEmployeePayItems(line.employee_id)
        .then((items) => setEmpRecurringItems(items || []))
        .catch(() => {})
    }
  }

  const handleSaveLine = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentRun || !selectedLine) return
    setSavingLine(true)
    try {
      const updatedLine = await hrService.updatePayrollRunLine(currentRun.id, selectedLine.id, editInputs)
      setCurrentRun((prev) =>
        prev
          ? {
              ...prev,
              lines: (prev.lines || []).map((l: PayrollRunLine) => (l.id === selectedLine.id ? updatedLine : l)),
            }
          : prev
      )
      setSelectedLine(updatedLine)
      toast.success('คำนวณและบันทึกรายการแล้ว')
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'บันทึกรายการไม่สำเร็จ')
    } finally {
      setSavingLine(false)
    }
  }

  const handleApprove = async () => {
    if (!currentRun) return
    setActing(true)
    try {
      const updated = await hrService.approvePayrollRun(currentRun.id)
      setCurrentRun(updated)
      setRuns((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)))
      setSelectedLine(null)
      toast.success('อนุมัติรอบเงินเดือนแล้ว')
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'อนุมัติไม่สำเร็จ')
    } finally {
      setActing(false)
    }
  }

  const openPostDialog = async () => {
    if (!currentRun) return
    setPayDate(currentRun.pay_date || periodEndDate(currentRun.period))
    setPayNow(true)
    setPostModalOpen(true)
    try {
      const res = await accountsApi.getAll({ active: true })
      const all: Account[] = res.data?.data || res.data || []
      const bankList = all.filter(
        (a: Account) => a.code.startsWith('111') || a.code === '1110' || a.type === 'ASSET'
      )
      setAssetAccounts(bankList)
      setAllAccounts(all)
      if (!payAccountId && bankList.length > 0) {
        const preferred = bankList.find((a: Account) => a.code === '1112' || a.code === '1111') || bankList[0]
        setPayAccountId(preferred.id)
      }
      if (!otherDeductionAccountId && all.length > 0) {
        const fallback = all.find((a: Account) => a.code === '2107' || a.code.startsWith('21')) || all[0]
        setOtherDeductionAccountId(fallback.id)
      }
    } catch {
      // ignore if accounts fail to load in test
    }
  }

  const handlePostRun = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentRun) return
    if (!payDate || !payAccountId) {
      toast.error('กรุณาเลือกวันที่จ่ายและบัญชีจ่ายเงิน')
      return
    }
    const totalOtherDed = (currentRun.lines || []).reduce((s, l) => s + Number(l.other_deduction || 0), 0)
    if (totalOtherDed > 0 && !otherDeductionAccountId) {
      toast.error('กรุณาเลือกบัญชีสำหรับรายการหักอื่นๆ')
      return
    }
    setActing(true)
    try {
      const updated = await hrService.postPayrollRun(currentRun.id, {
        payDate,
        payAccountId,
        otherDeductionAccountId: totalOtherDed > 0 ? otherDeductionAccountId : undefined,
        payNow,
      })
      setCurrentRun(updated)
      setRuns((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)))
      setPostModalOpen(false)
      if (updated.warnings && updated.warnings.length > 0) {
        toast.success(`ลงบัญชีสำเร็จ (${updated.warnings.join(', ')})`)
      } else {
        toast.success(payNow ? 'ลงบัญชีและบันทึกจ่ายเงินสำเร็จ' : 'ลงบัญชีตั้งค้างจ่ายสำเร็จ')
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'ลงบัญชีไม่สำเร็จ')
    } finally {
      setActing(false)
    }
  }

  const handlePayRun = async () => {
    if (!currentRun) return
    setActing(true)
    try {
      const updated = await hrService.payPayrollRun(currentRun.id)
      setCurrentRun(updated)
      setRuns((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)))
      toast.success('บันทึกจ่ายเงินเดือนแล้ว')
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'บันทึกจ่ายเงินไม่สำเร็จ')
    } finally {
      setActing(false)
    }
  }

  const handleVoidRun = async () => {
    if (!currentRun) return
    setActing(true)
    try {
      const updated = await hrService.voidPayrollRun(currentRun.id)
      setCurrentRun(updated)
      setRuns((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)))
      toast.success('ยกเลิกรอบเงินเดือนและกลับรายการบัญชีแล้ว')
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'ยกเลิกรอบไม่สำเร็จ')
    } finally {
      setActing(false)
    }
  }

  const handleDeleteRun = async () => {
    if (!currentRun) return
    setActing(true)
    try {
      await hrService.deletePayrollRun(currentRun.id)
      toast.success('ลบรอบเงินเดือนร่างแล้ว')
      const remaining = runs.filter((r) => r.id !== currentRun.id)
      setRuns(remaining)
      setSelectedLine(null)
      if (remaining.length > 0) {
        await loadRunDetail(remaining[0].id)
      } else {
        setCurrentRun(null)
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'ลบรอบเงินเดือนไม่สำเร็จ')
    } finally {
      setActing(false)
    }
  }

  const handleExportSso = async () => {
    if (!currentRun) return
    try {
      const csv = await hrService.exportSsoCsv(currentRun.id)
      downloadCsv(`sso-${currentRun.period}.csv`, csv)
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'ส่งออก สปส. ไม่สำเร็จ')
    }
  }

  const handleExportPnd1 = async () => {
    if (!currentRun) return
    try {
      const csv = await hrService.getPnd1Csv(currentRun.period)
      downloadCsv(`pnd1-${currentRun.period}.csv`, csv)
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'ส่งออก ภ.ง.ด.1 ไม่สำเร็จ')
    }
  }

  const lines = currentRun?.lines || []
  const isDraft = currentRun?.status === 'DRAFT'

  // Calculate column totals
  const totals = lines.reduce(
    (acc, l) => {
      const res = l.result
      const basePay = Number(res?.basePay ?? 0)
      const otTotal = Number(res?.otPay ?? 0)
      const payItemsTotal = Number(res?.payItemsTotal ?? 0)
      const gross = Number(l.gross || 0)
      const sso = Number(l.sso_employee || 0)
      const wht = Number(l.wht || 0)
      const otherAndLate = Number(l.late || 0) + Number(l.other_deduction || 0)
      const net = Number(l.net || 0)
      return {
        basePay: acc.basePay + basePay,
        otTotal: acc.otTotal + otTotal,
        payItemsTotal: acc.payItemsTotal + payItemsTotal,
        gross: acc.gross + gross,
        sso: acc.sso + sso,
        wht: acc.wht + wht,
        otherAndLate: acc.otherAndLate + otherAndLate,
        net: acc.net + net,
      }
    },
    { basePay: 0, otTotal: 0, payItemsTotal: 0, gross: 0, sso: 0, wht: 0, otherAndLate: 0, net: 0 }
  )

  return (
    <div className="p-6 space-y-6">
      {/* Header & Create Run */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--primary-soft)] flex items-center justify-center">
            <Banknote className="w-5 h-5 text-[var(--primary)]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[var(--fg-1)]">ทำจ่ายเงินเดือน (Payroll Runs)</h1>
            <p className="text-xs text-[var(--fg-3)]">
              คำนวณเงินเดือน ค่าล่วงเวลา สวัสดิการ ประกันสังคม ภ.ง.ด.1 และลงบัญชีแยกตามหน่วยธุรกิจ
            </p>
          </div>
        </div>

        <form onSubmit={handleCreateRun} className="flex items-center gap-2">
          <input
            type="month"
            value={newPeriod}
            onChange={(e) => setNewPeriod(e.target.value)}
            aria-label="งวดเดือน"
            className="px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
          />
          <button
            type="submit"
            disabled={creating}
            className="phopy-btn-primary px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            สร้างรอบ
          </button>
        </form>
      </div>

      {/* Runs selector strip */}
      {runs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {runs.map((r) => {
            const active = currentRun?.id === r.id
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  setSelectedLine(null)
                  loadRunDetail(r.id)
                }}
                className={`px-3 py-2 rounded-xl text-xs font-medium border transition-colors flex items-center gap-2 ${
                  active
                    ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--fg-1)]'
                    : 'border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)] hover:bg-[var(--surface-2)]'
                }`}
              >
                <span className="font-bold">งวด {r.period}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] ${STATUS_BADGE[r.status] || ''}`}>
                  {STATUS_LABELS[r.status] || r.status}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {loading ? (
        <div className="phopy-card p-8 text-center text-sm text-[var(--fg-3)]">กำลังโหลดข้อมูลเงินเดือน...</div>
      ) : !currentRun ? (
        <div className="phopy-card p-8 text-center text-sm text-[var(--fg-3)]">
          ยังไม่มีรอบเงินเดือน เลือกเดือนด้านบนแล้วกด &ldquo;สร้างรอบ&rdquo; เพื่อเริ่มต้น
        </div>
      ) : (
        <div className="space-y-4">
          {/* Action bar */}
          <div className="phopy-card p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-base font-bold text-[var(--fg-1)]">งวดประจำเดือน {currentRun.period}</span>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[currentRun.status]}`}>
                {STATUS_LABELS[currentRun.status]}
              </span>
              <span className="text-xs text-[var(--fg-3)]">พนักงาน {lines.length} คน</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {currentRun.status === 'DRAFT' && (
                <>
                  <button
                    type="button"
                    onClick={handleApprove}
                    disabled={acting}
                    className="phopy-btn-primary px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    อนุมัติ
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteRun}
                    disabled={acting}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-500/40 text-red-600 hover:bg-red-500/10 flex items-center gap-1.5"
                  >
                    <Trash2 className="w-4 h-4" />
                    ลบ
                  </button>
                </>
              )}

              {currentRun.status === 'APPROVED' && (
                <button
                  type="button"
                  onClick={openPostDialog}
                  disabled={acting}
                  className="phopy-btn-primary px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                >
                  <BookOpen className="w-4 h-4" />
                  ลงบัญชี
                </button>
              )}

              {currentRun.status === 'POSTED' && (
                <button
                  type="button"
                  onClick={handlePayRun}
                  disabled={acting}
                  className="phopy-btn-primary px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                >
                  <CreditCard className="w-4 h-4" />
                  บันทึกจ่ายแล้ว
                </button>
              )}

              {(currentRun.status === 'POSTED' || currentRun.status === 'PAID') && (
                <button
                  type="button"
                  onClick={handleVoidRun}
                  disabled={acting}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-500/40 text-red-600 hover:bg-red-500/10 flex items-center gap-1.5"
                >
                  <Ban className="w-4 h-4" />
                  ยกเลิกรอบ
                </button>
              )}

              <button
                type="button"
                onClick={handleExportSso}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                SSO CSV
              </button>

              <button
                type="button"
                onClick={handleExportPnd1}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] flex items-center gap-1.5"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                ภ.ง.ด.1
              </button>

              <button
                type="button"
                onClick={() => setPrintSlips(lines)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] flex items-center gap-1.5"
              >
                <Printer className="w-3.5 h-3.5" />
                พิมพ์ทั้งหมด
              </button>
            </div>
          </div>

          {/* Run Detail Table */}
          <div className="phopy-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="phopy-table w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[var(--fg-3)]">
                    <th className="py-3 px-3">พนักงาน</th>
                    <th className="py-3 px-3">แผนก</th>
                    <th className="py-3 px-3">ประเภท</th>
                    <th className="py-3 px-3 text-right">ค่าจ้าง</th>
                    <th className="py-3 px-3 text-right">OT</th>
                    <th className="py-3 px-3 text-right">สวัสดิการ</th>
                    <th className="py-3 px-3 text-right">รวมได้</th>
                    <th className="py-3 px-3 text-right">สปส.</th>
                    <th className="py-3 px-3 text-right">ภาษี</th>
                    <th className="py-3 px-3 text-right">หักอื่น</th>
                    <th className="py-3 px-3 text-right">สุทธิ</th>
                    <th className="py-3 px-3 text-right">สลิป</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {lines.map((line) => {
                    const res = line.result
                    const basePay = Number(res?.basePay ?? 0)
                    const otTotal = Number(res?.otPay ?? 0)
                    const payItemsTotal = Number(res?.payItemsTotal ?? 0)
                    const otherAndLate = Number(line.late || 0) + Number(line.other_deduction || 0)
                    const isSelected = selectedLine?.id === line.id

                    return (
                      <tr
                        key={line.id}
                        onClick={() => openLineEditor(line)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-[var(--primary-soft)]/50' : 'hover:bg-[var(--surface-2)]/60'
                        }`}
                      >
                        <td className="py-3 px-3">
                          <div className="font-semibold text-[var(--fg-1)]">
                            {line.first_name} {line.last_name || ''}
                          </div>
                          <div className="text-[11px] font-mono text-[var(--fg-3)]">
                            {line.code || line.employee_code}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-[var(--fg-2)]">{line.org_unit_name || '-'}</td>
                        <td className="py-3 px-3 text-[var(--fg-2)]">
                          {line.employment_type ? EMP_TYPE_LABELS[line.employment_type] || line.employment_type : '-'}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-[var(--fg-1)]">{fmt(basePay)}</td>
                        <td className="py-3 px-3 text-right font-mono text-[var(--fg-1)]">{fmt(otTotal)}</td>
                        <td className="py-3 px-3 text-right font-mono text-[var(--fg-1)]">{fmt(payItemsTotal)}</td>
                        <td className="py-3 px-3 text-right font-mono font-semibold text-[var(--fg-1)]">
                          {fmt(line.gross)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-[var(--fg-2)]">
                          {fmt(line.sso_employee)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-[var(--fg-2)]">{fmt(line.wht)}</td>
                        <td className="py-3 px-3 text-right font-mono text-[var(--fg-2)]">{fmt(otherAndLate)}</td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-[var(--primary)]">
                          {fmt(line.net)}
                        </td>
                        <td
                          className="py-3 px-3 text-right"
                          onClick={(e) => {
                            e.stopPropagation()
                            setPrintSlips([line])
                          }}
                        >
                          <button
                            type="button"
                            title="พิมพ์สลิป"
                            className="p-1.5 rounded hover:bg-[var(--surface-2)] text-[var(--fg-2)]"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--border)] bg-[var(--surface-2)]/50 font-bold text-[var(--fg-1)]">
                    <td colSpan={3} className="py-3 px-3">
                      รวมทั้งสิ้น ({lines.length} คน)
                    </td>
                    <td className="py-3 px-3 text-right font-mono" data-testid="total-base">
                      {fmt(totals.basePay)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono" data-testid="total-ot">
                      {fmt(totals.otTotal)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono" data-testid="total-payitems">
                      {fmt(totals.payItemsTotal)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono" data-testid="total-gross">
                      {fmt(totals.gross)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono" data-testid="total-sso">
                      {fmt(totals.sso)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono" data-testid="total-wht">
                      {fmt(totals.wht)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono" data-testid="total-other">
                      {fmt(totals.otherAndLate)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-[var(--primary)]" data-testid="total-net">
                      {fmt(totals.net)}
                    </td>
                    <td className="py-3 px-3" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Side Panel: Line Editor */}
      {selectedLine && (
        <div className="fixed inset-y-0 right-0 z-40 w-full max-w-md bg-[var(--surface)] border-l border-[var(--border)] shadow-2xl overflow-y-auto p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
            <div>
              <h3 className="text-base font-bold text-[var(--fg-1)]">
                {selectedLine.first_name} {selectedLine.last_name || ''}
              </h3>
              <p className="text-xs text-[var(--fg-3)]">
                {selectedLine.code || selectedLine.employee_code} ·{' '}
                {selectedLine.employment_type
                  ? EMP_TYPE_LABELS[selectedLine.employment_type]
                  : ''}{' '}
                · ฐาน {fmt(selectedLine.base_wage)} ฿
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedLine(null)}
              className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-[var(--fg-3)]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSaveLine} className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[var(--fg-2)] mb-1">จำนวนวันทำงาน (daysWorked)</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  disabled={!isDraft}
                  value={editInputs.daysWorked ?? 0}
                  onChange={(e) => setEditInputs({ ...editInputs, daysWorked: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 rounded bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>
              <div>
                <label className="block text-[var(--fg-2)] mb-1">ชั่วโมงทำงาน (hoursWorked)</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  disabled={!isDraft}
                  value={editInputs.hoursWorked ?? 0}
                  onChange={(e) => setEditInputs({ ...editInputs, hoursWorked: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 rounded bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>
              <div>
                <label className="block text-[var(--fg-2)] mb-1">วันลาไม่รับค่าจ้าง (unpaidLeaveDays)</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  disabled={!isDraft}
                  value={editInputs.unpaidLeaveDays ?? 0}
                  onChange={(e) => setEditInputs({ ...editInputs, unpaidLeaveDays: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 rounded bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>
              <div>
                <label className="block text-[var(--fg-2)] mb-1">นาทีมาสาย (lateMinutes)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  disabled={!isDraft}
                  value={editInputs.lateMinutes ?? 0}
                  onChange={(e) => setEditInputs({ ...editInputs, lateMinutes: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 rounded bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>
            </div>

            {/* Recurring Pay Items Checkboxes */}
            {empRecurringItems.length > 0 && (
              <div className="border-t border-[var(--border)] pt-3 space-y-2">
                <div className="font-semibold text-[var(--fg-2)]">
                  สวัสดิการประจำของพนักงาน (ติ๊กออกหากงวดนี้ไม่ได้รับ เช่น เบี้ยขยัน)
                </div>
                <div className="space-y-1.5">
                  {empRecurringItems.map((item) => {
                    const disabledList = editInputs.disabledPayItemIds || []
                    const isEnabled = !disabledList.includes(item.pay_item_id)
                    return (
                      <label
                        key={item.pay_item_id}
                        className="flex items-center justify-between p-2 rounded bg-[var(--surface-2)] border border-[var(--border)] cursor-pointer"
                      >
                        <span className="flex items-center gap-2 text-[var(--fg-1)]">
                          <input
                            type="checkbox"
                            disabled={!isDraft}
                            checked={isEnabled}
                            onChange={(e) => {
                              const nextDisabled = e.target.checked
                                ? disabledList.filter((id: string) => id !== item.pay_item_id)
                                : [...disabledList, item.pay_item_id]
                              setEditInputs({ ...editInputs, disabledPayItemIds: nextDisabled })
                            }}
                          />
                          <span>{item.name}</span>
                        </span>
                        <span className="font-mono text-[var(--fg-2)]">
                          {fmt(item.effective_amount)} ฿ {item.calc === 'PER_DAY' ? '/ วัน' : '/ เดือน'}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}

            {/* OT Rows */}
            <div className="border-t border-[var(--border)] pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[var(--fg-2)]">ค่าล่วงเวลา (OT)</span>
                {isDraft && (
                  <button
                    type="button"
                    onClick={() =>
                      setEditInputs({
                        ...editInputs,
                        ot: [...(editInputs.ot || []), { kind: 'WORKDAY_OT', hours: 1 }],
                      })
                    }
                    className="text-[var(--primary)] font-semibold flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> เพิ่ม OT
                  </button>
                )}
              </div>
              {(editInputs.ot || []).map((row: OtEntry, idx: number) => (
                <div key={idx} className="flex items-center gap-2">
                  <select
                    disabled={!isDraft}
                    value={row.kind}
                    onChange={(e) => {
                      const next = [...(editInputs.ot || [])]
                      next[idx] = { ...row, kind: e.target.value as OTKind }
                      setEditInputs({ ...editInputs, ot: next })
                    }}
                    className="flex-1 px-2 py-1.5 rounded bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  >
                    {(Object.keys(OT_KIND_LABELS) as OTKind[]).map((k) => (
                      <option key={k} value={k}>
                        {OT_KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    disabled={!isDraft}
                    value={row.hours}
                    onChange={(e) => {
                      const next = [...(editInputs.ot || [])]
                      next[idx] = { ...row, hours: Number(e.target.value) }
                      setEditInputs({ ...editInputs, ot: next })
                    }}
                    className="w-20 px-2 py-1.5 text-right rounded bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                  {isDraft && (
                    <button
                      type="button"
                      onClick={() =>
                        setEditInputs({
                          ...editInputs,
                          ot: (editInputs.ot || []).filter((_: OtEntry, i: number) => i !== idx),
                        })
                      }
                      className="p-1 text-[var(--fg-3)] hover:text-red-500"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Extra Pay Items */}
            <div className="border-t border-[var(--border)] pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[var(--fg-2)]">เงินได้พิเศษเฉพาะงวดนี้</span>
                {isDraft && (
                  <button
                    type="button"
                    onClick={() =>
                      setEditInputs({
                        ...editInputs,
                        extraPayItems: [
                          ...(editInputs.extraPayItems || []),
                          { name: '', amount: 0, taxable: true, ssoable: false },
                        ],
                      })
                    }
                    className="text-[var(--primary)] font-semibold flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> เพิ่มเงินได้พิเศษ
                  </button>
                )}
              </div>
              {(editInputs.extraPayItems || []).map((item: ExtraPayItemInput, idx: number) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="ชื่อรายการ"
                    disabled={!isDraft}
                    value={item.name}
                    onChange={(e) => {
                      const next = [...(editInputs.extraPayItems || [])]
                      next[idx] = { ...item, name: e.target.value }
                      setEditInputs({ ...editInputs, extraPayItems: next })
                    }}
                    className="flex-1 px-2 py-1.5 rounded bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={!isDraft}
                    value={item.amount}
                    onChange={(e) => {
                      const next = [...(editInputs.extraPayItems || [])]
                      next[idx] = { ...item, amount: Number(e.target.value) }
                      setEditInputs({ ...editInputs, extraPayItems: next })
                    }}
                    className="w-24 px-2 py-1.5 text-right rounded bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                  {isDraft && (
                    <button
                      type="button"
                      onClick={() =>
                        setEditInputs({
                          ...editInputs,
                          extraPayItems: (editInputs.extraPayItems || []).filter((_: ExtraPayItemInput, i: number) => i !== idx),
                        })
                      }
                      className="p-1 text-[var(--fg-3)] hover:text-red-500"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Other Deductions */}
            <div className="border-t border-[var(--border)] pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[var(--fg-2)]">รายการหักอื่นๆ</span>
                {isDraft && (
                  <button
                    type="button"
                    onClick={() =>
                      setEditInputs({
                        ...editInputs,
                        otherDeductions: [...(editInputs.otherDeductions || []), { name: '', amount: 0 }],
                      })
                    }
                    className="text-[var(--primary)] font-semibold flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> เพิ่มรายการหัก
                  </button>
                )}
              </div>
              {(editInputs.otherDeductions || []).map((ded: OtherDeductionInput, idx: number) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="เช่น เบิกล่วงหน้า"
                    disabled={!isDraft}
                    value={ded.name}
                    onChange={(e) => {
                      const next = [...(editInputs.otherDeductions || [])]
                      next[idx] = { ...ded, name: e.target.value }
                      setEditInputs({ ...editInputs, otherDeductions: next })
                    }}
                    className="flex-1 px-2 py-1.5 rounded bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={!isDraft}
                    value={ded.amount}
                    onChange={(e) => {
                      const next = [...(editInputs.otherDeductions || [])]
                      next[idx] = { ...ded, amount: Number(e.target.value) }
                      setEditInputs({ ...editInputs, otherDeductions: next })
                    }}
                    className="w-24 px-2 py-1.5 text-right rounded bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                  {isDraft && (
                    <button
                      type="button"
                      onClick={() =>
                        setEditInputs({
                          ...editInputs,
                          otherDeductions: (editInputs.otherDeductions || []).filter((_: OtherDeductionInput, i: number) => i !== idx),
                        })
                      }
                      className="p-1 text-[var(--fg-3)] hover:text-red-500"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Advance Deductions */}
            {Boolean(editInputs.advanceDeductions && editInputs.advanceDeductions.length > 0) && (
              <div className="border-t border-[var(--border)] pt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[var(--fg-2)]">หักเบิก/เงินยืม</span>
                </div>
                {editInputs.advanceDeductions!.map((adv: AdvanceDeduction, idx: number) => (
                  <div key={adv.advance_id || idx} className="flex items-center gap-2">
                    <div className="flex-1 px-2 py-1.5 rounded bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)] flex items-center justify-between text-xs sm:text-sm">
                      <span>{adv.name}</span>
                      <span className="text-[10px] text-[var(--fg-3)] px-1.5 py-0.5 rounded bg-[var(--surface)]">
                        {adv.kind === 'ADVANCE' ? 'เบิกล่วงหน้า' : 'เงินยืม'}
                      </span>
                    </div>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      disabled={!isDraft}
                      value={adv.amount}
                      onChange={(e) => {
                        const next = [...(editInputs.advanceDeductions || [])]
                        next[idx] = { ...adv, amount: Number(e.target.value) }
                        setEditInputs({ ...editInputs, advanceDeductions: next })
                      }}
                      className="w-24 px-2 py-1.5 text-right rounded bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                    />
                  </div>
                ))}
              </div>
            )}

            {isDraft && (
              <div className="pt-3 border-t border-[var(--border)] flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedLine(null)}
                  className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--fg-2)]"
                >
                  ปิด
                </button>
                <button
                  type="submit"
                  disabled={savingLine}
                  className="phopy-btn-primary px-4 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  {savingLine ? 'กำลังคำนวณ...' : 'คำนวณและบันทึก'}
                </button>
              </div>
            )}
          </form>
        </div>
      )}

      {/* Post to Accounting Modal */}
      {postModalOpen && currentRun && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="phopy-card w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="text-base font-bold text-[var(--fg-1)]">
                ลงบัญชีเงินเดือน งวด {currentRun.period}
              </h2>
              <button onClick={() => setPostModalOpen(false)} className="p-1 rounded-lg hover:bg-[var(--surface-2)]">
                <X className="w-4 h-4 text-[var(--fg-3)]" />
              </button>
            </div>

            <form onSubmit={handlePostRun} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">วันที่จ่ายเงินเดือน *</label>
                <input
                  type="date"
                  required
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  บัญชีจ่ายเงิน (เงินสด / เงินฝากธนาคาร - หมวดสินทรัพย์) *
                </label>
                <select
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

              {(currentRun.lines || []).some((l) => Number(l.other_deduction || 0) > 0) && (
                <div>
                  <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                    บัญชีสำหรับรายการหักอื่นๆ *
                  </label>
                  <select
                    required
                    value={otherDeductionAccountId}
                    onChange={(e) => setOtherDeductionAccountId(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  >
                    <option value="">-- เลือกบัญชี --</option>
                    {allAccounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.code} - {acc.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <label className="flex items-center gap-2 text-xs text-[var(--fg-2)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={payNow}
                  onChange={(e) => setPayNow(e.target.checked)}
                />
                <span>บันทึกจ่ายเงินทันทีในขั้นตอนเดียว (สร้างทั้งใบสำคัญตั้งค้างจ่ายและใบสำคัญจ่าย)</span>
              </label>

              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setPostModalOpen(false)}
                  className="px-4 py-2 text-xs rounded-lg border border-[var(--border)] text-[var(--fg-2)]"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={acting}
                  className="phopy-btn-primary px-4 py-2 text-xs rounded-lg font-semibold disabled:opacity-50"
                >
                  {acting ? 'กำลังลงบัญชี...' : 'ยืนยันลงบัญชี'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Payslip Print Modal */}
      {printSlips && currentRun && (
        <PayslipPrint
          slips={printSlips}
          period={currentRun.period}
          payDate={currentRun.pay_date}
          onClose={() => setPrintSlips(null)}
        />
      )}
    </div>
  )
}
