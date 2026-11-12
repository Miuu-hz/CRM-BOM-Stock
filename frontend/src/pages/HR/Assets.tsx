import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Package,
  Plus,
  Search,
  Pencil,
  RotateCcw,
  History,
  X,
  ArrowUpRight,
  User,
  Calendar,
  FileText,
  Clock,
  Filter,
} from 'lucide-react'
import toast from 'react-hot-toast'
import hrAssetService, {
  HrAsset,
  HrAssetLoan,
  AssetStatus,
} from '../../services/hrAsset.service'
import hrService, { Employee } from '../../services/hr.service'
import { PaymentAttachments } from '../../components/common/PaymentAttachments'

const todayStr = () => new Date().toISOString().slice(0, 10)

export function renderAssetStatusPill(status: AssetStatus) {
  switch (status) {
    case 'AVAILABLE':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          พร้อมให้ยืม
        </span>
      )
    case 'LOANED':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400">
          กำลังถูกยืม
        </span>
      )
    case 'RETIRED':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-500/15 text-gray-500 dark:text-gray-400">
          ตัดจำหน่าย
        </span>
      )
  }
}

export default function Assets() {
  const [assets, setAssets] = useState<HrAsset[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(false)

  // Filters
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')

  // Modal: Add / Edit Asset
  const [assetModalOpen, setAssetModalOpen] = useState(false)
  const [editingAsset, setEditingAsset] = useState<HrAsset | null>(null)
  const [assetCode, setAssetCode] = useState('')
  const [assetName, setAssetName] = useState('')
  const [assetCategory, setAssetCategory] = useState('')
  const [assetStatus, setAssetStatus] = useState<AssetStatus>('AVAILABLE')
  const [assetNotes, setAssetNotes] = useState('')
  const [savingAsset, setSavingAsset] = useState(false)

  // Modal: Loan Asset
  const [loanModalOpen, setLoanModalOpen] = useState(false)
  const [loaningAsset, setLoaningAsset] = useState<HrAsset | null>(null)
  const [loanEmployeeId, setLoanEmployeeId] = useState('')
  const [loanDate, setLoanDate] = useState(todayStr())
  const [loanNote, setLoanNote] = useState('')
  const [savingLoan, setSavingLoan] = useState(false)

  // Modal: Return Asset
  const [returnModalOpen, setReturnModalOpen] = useState(false)
  const [returningAsset, setReturningAsset] = useState<HrAsset | null>(null)
  const [returnDate, setReturnDate] = useState(todayStr())
  const [savingReturn, setSavingReturn] = useState(false)

  // Modal: Loan History
  const [historyModalOpen, setHistoryModalOpen] = useState(false)
  const [historyAsset, setHistoryAsset] = useState<HrAsset | null>(null)
  const [assetLoans, setAssetLoans] = useState<HrAssetLoan[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  // Load assets
  const loadAssets = useCallback(async () => {
    setLoading(true)
    try {
      const list = await hrAssetService.getAssets({
        status: filterStatus || undefined,
        q: searchQuery.trim() || undefined,
      })
      setAssets(list || [])
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'โหลดข้อมูลทรัพย์สินไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [filterStatus, searchQuery])

  // Load active employees
  const loadEmployees = useCallback(async () => {
    try {
      const list = await hrService.getEmployees({ status: 'ACTIVE' })
      setEmployees(list || [])
    } catch (err: any) {
      console.error('Failed to load employees:', err)
    }
  }, [])

  useEffect(() => {
    loadAssets()
  }, [loadAssets])

  useEffect(() => {
    loadEmployees()
  }, [loadEmployees])

  // Stats counters
  const counts = useMemo(() => {
    const total = assets.length
    const available = assets.filter((a) => a.status === 'AVAILABLE').length
    const loaned = assets.filter((a) => a.status === 'LOANED').length
    const retired = assets.filter((a) => a.status === 'RETIRED').length
    return { total, available, loaned, retired }
  }, [assets])

  // Handlers for Add/Edit Asset Modal
  const openAddAssetModal = () => {
    setEditingAsset(null)
    setAssetCode('')
    setAssetName('')
    setAssetCategory('')
    setAssetStatus('AVAILABLE')
    setAssetNotes('')
    setAssetModalOpen(true)
  }

  const openEditAssetModal = (asset: HrAsset) => {
    setEditingAsset(asset)
    setAssetCode(asset.code)
    setAssetName(asset.name)
    setAssetCategory(asset.category || '')
    setAssetStatus(asset.status)
    setAssetNotes(asset.notes || '')
    setAssetModalOpen(true)
  }

  const handleSaveAsset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!assetCode.trim()) {
      toast.error('กรุณาระบุรหัสทรัพย์สิน')
      return
    }
    if (!assetName.trim()) {
      toast.error('กรุณาระบุชื่อทรัพย์สิน')
      return
    }

    setSavingAsset(true)
    try {
      if (editingAsset) {
        await hrAssetService.updateAsset(editingAsset.id, {
          code: assetCode.trim(),
          name: assetName.trim(),
          category: assetCategory.trim() || null,
          status: editingAsset.status === 'LOANED' ? undefined : assetStatus,
          notes: assetNotes.trim() || null,
        })
        toast.success('แก้ไขทรัพย์สินเรียบร้อย')
      } else {
        await hrAssetService.createAsset({
          code: assetCode.trim(),
          name: assetName.trim(),
          category: assetCategory.trim() || null,
          notes: assetNotes.trim() || null,
        })
        toast.success('เพิ่มทรัพย์สินเรียบร้อย')
      }
      setAssetModalOpen(false)
      loadAssets()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'บันทึกทรัพย์สินไม่สำเร็จ')
    } finally {
      setSavingAsset(false)
    }
  }

  // Handlers for Loan Modal
  const openLoanModal = (asset: HrAsset) => {
    setLoaningAsset(asset)
    setLoanEmployeeId(employees[0]?.id || '')
    setLoanDate(todayStr())
    setLoanNote('')
    setLoanModalOpen(true)
  }

  const handleSaveLoan = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!loaningAsset) return
    if (!loanEmployeeId) {
      toast.error('กรุณาเลือกพนักงานที่ยืม')
      return
    }
    if (!loanDate) {
      toast.error('กรุณาระบุวันที่ยืม')
      return
    }

    setSavingLoan(true)
    try {
      await hrAssetService.loanAsset(loaningAsset.id, {
        employee_id: loanEmployeeId,
        loaned_on: loanDate,
        note: loanNote.trim() || null,
      })
      toast.success('บันทึกการให้ยืมเรียบร้อย')
      setLoanModalOpen(false)
      loadAssets()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'บันทึกการให้ยืมไม่สำเร็จ')
    } finally {
      setSavingLoan(false)
    }
  }

  // Handlers for Return Modal
  const openReturnModal = (asset: HrAsset) => {
    setReturningAsset(asset)
    setReturnDate(todayStr())
    setReturnModalOpen(true)
  }

  const handleSaveReturn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!returningAsset || !returningAsset.current_loan) return
    if (!returnDate) {
      toast.error('กรุณาระบุวันที่คืน')
      return
    }

    setSavingReturn(true)
    try {
      await hrAssetService.returnAssetLoan(returningAsset.current_loan.loan_id, {
        returned_on: returnDate,
      })
      toast.success('บันทึกรับคืนทรัพย์สินเรียบร้อย')
      setReturnModalOpen(false)
      loadAssets()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'บันทึกรับคืนไม่สำเร็จ')
    } finally {
      setSavingReturn(false)
    }
  }

  // Handlers for History Modal
  const openHistoryModal = async (asset: HrAsset) => {
    setHistoryAsset(asset)
    setHistoryModalOpen(true)
    setLoadingHistory(true)
    try {
      const list = await hrAssetService.getAssetLoans(asset.id)
      setAssetLoans(list || [])
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'โหลดประวัติการยืมไม่สำเร็จ')
    } finally {
      setLoadingHistory(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-blue-600/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
            <Package className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">ทรัพย์สินที่ให้ยืม</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              จัดการรายการทรัพย์สินของบริษัท ให้ยืม รับคืน และตรวจสอบประวัติการยืม
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={openAddAssetModal}
          className="phopy-btn-primary px-4 py-2 text-sm rounded-lg font-semibold flex items-center justify-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          เพิ่มทรัพย์สิน
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="phopy-card p-4">
          <div className="text-xs text-[var(--fg-3)]">ทรัพย์สินทั้งหมด</div>
          <div className="text-2xl font-bold text-[var(--fg-1)] mt-1">{counts.total}</div>
        </div>
        <div className="phopy-card p-4">
          <div className="text-xs text-emerald-600 dark:text-emerald-400">พร้อมให้ยืม</div>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{counts.available}</div>
        </div>
        <div className="phopy-card p-4">
          <div className="text-xs text-amber-600 dark:text-amber-400">กำลังถูกยืม</div>
          <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">{counts.loaned}</div>
        </div>
        <div className="phopy-card p-4">
          <div className="text-xs text-gray-500 dark:text-gray-400">ตัดจำหน่าย</div>
          <div className="text-2xl font-bold text-gray-500 dark:text-gray-400 mt-1">{counts.retired}</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setFilterStatus('')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              filterStatus === ''
                ? 'bg-blue-600 text-white'
                : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)] border border-[var(--border)]'
            }`}
          >
            ทั้งหมด
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus('AVAILABLE')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              filterStatus === 'AVAILABLE'
                ? 'bg-blue-600 text-white'
                : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)] border border-[var(--border)]'
            }`}
          >
            พร้อมให้ยืม
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus('LOANED')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              filterStatus === 'LOANED'
                ? 'bg-blue-600 text-white'
                : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)] border border-[var(--border)]'
            }`}
          >
            กำลังถูกยืม
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus('RETIRED')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              filterStatus === 'RETIRED'
                ? 'bg-blue-600 text-white'
                : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)] border border-[var(--border)]'
            }`}
          >
            ตัดจำหน่าย
          </button>
        </div>

        <div className="relative min-w-[240px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-3)]" />
          <input
            type="text"
            placeholder="ค้นหารหัส หรือชื่อทรัพย์สิน..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)] focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Main Asset Table */}
      <div className="phopy-card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--fg-3)]">กำลังโหลดข้อมูลทรัพย์สิน...</div>
        ) : assets.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--fg-3)]">ไม่พบรายการทรัพย์สิน</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="phopy-table w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[var(--fg-3)]">
                  <th className="py-2.5 px-3">รหัสทรัพย์สิน</th>
                  <th className="py-2.5 px-3">ชื่อทรัพย์สิน</th>
                  <th className="py-2.5 px-3">หมวดหมู่</th>
                  <th className="py-2.5 px-3 text-center">สถานะ</th>
                  <th className="py-2.5 px-3">ผู้ยืมปัจจุบัน</th>
                  <th className="py-2.5 px-3">หมายเหตุ</th>
                  <th className="py-2.5 px-3 text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {assets.map((asset) => (
                  <tr key={asset.id} className="hover:bg-[var(--surface-2)]/60 transition">
                    <td className="py-2.5 px-3 font-semibold text-[var(--fg-1)]">{asset.code}</td>
                    <td className="py-2.5 px-3 text-[var(--fg-1)]">{asset.name}</td>
                    <td className="py-2.5 px-3 text-[var(--fg-2)]">{asset.category || '-'}</td>
                    <td className="py-2.5 px-3 text-center">{renderAssetStatusPill(asset.status)}</td>
                    <td className="py-2.5 px-3 text-[var(--fg-2)]">
                      {asset.status === 'LOANED' && asset.current_loan ? (
                        <div className="flex flex-col">
                          <span className="font-medium text-[var(--fg-1)]">
                            {asset.current_loan.employee_name}
                          </span>
                          <span className="text-[11px] text-[var(--fg-3)] flex items-center gap-1 mt-0.5">
                            <Clock className="w-3 h-3" /> ยืมเมื่อ {asset.current_loan.loaned_on}
                          </span>
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-[var(--fg-3)] truncate max-w-xs">{asset.notes || '-'}</td>
                    <td className="py-2.5 px-3 text-right space-x-1.5 whitespace-nowrap">
                      {asset.status === 'AVAILABLE' && (
                        <button
                          type="button"
                          onClick={() => openLoanModal(asset)}
                          className="px-2.5 py-1 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700 font-medium inline-flex items-center gap-1"
                        >
                          <ArrowUpRight className="w-3.5 h-3.5" />
                          ให้ยืม
                        </button>
                      )}

                      {asset.status === 'LOANED' && (
                        <button
                          type="button"
                          onClick={() => openReturnModal(asset)}
                          className="px-2.5 py-1 text-xs rounded-md bg-amber-600 text-white hover:bg-amber-700 font-medium inline-flex items-center gap-1"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          รับคืน
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => openEditAssetModal(asset)}
                        className="px-2 py-1 text-xs rounded-md border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] inline-flex items-center gap-1"
                        title="แก้ไข"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        แก้ไข
                      </button>

                      <button
                        type="button"
                        onClick={() => openHistoryModal(asset)}
                        className="px-2 py-1 text-xs rounded-md border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] inline-flex items-center gap-1"
                        title="ประวัติการยืม"
                      >
                        <History className="w-3.5 h-3.5" />
                        ประวัติ
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal 1: เพิ่ม/แก้ไข ทรัพย์สิน */}
      {assetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="phopy-card bg-[var(--surface-1)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
              <h2 className="text-base font-semibold text-[var(--fg-1)]">
                {editingAsset ? 'แก้ไขทรัพย์สิน' : 'เพิ่มทรัพย์สิน'}
              </h2>
              <button
                type="button"
                onClick={() => setAssetModalOpen(false)}
                className="p-1 rounded-lg text-[var(--fg-3)] hover:text-[var(--fg-1)] hover:bg-[var(--surface-2)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveAsset} className="p-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--fg-2)] mb-1">
                  รหัสทรัพย์สิน <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={assetCode}
                  onChange={(e) => setAssetCode(e.target.value)}
                  placeholder="เช่น AST-001, LAP-04"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)] focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--fg-2)] mb-1">
                  ชื่อทรัพย์สิน <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={assetName}
                  onChange={(e) => setAssetName(e.target.value)}
                  placeholder="เช่น MacBook Pro 14, เครื่องวัดอุณหภูมิ"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)] focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--fg-2)] mb-1">
                  หมวดหมู่
                </label>
                <input
                  type="text"
                  value={assetCategory}
                  onChange={(e) => setAssetCategory(e.target.value)}
                  placeholder="เช่น คอมพิวเตอร์, อุปกรณ์ช่าง, ยานพาหนะ"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)] focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {editingAsset && (
                <div>
                  <label className="block text-xs font-semibold text-[var(--fg-2)] mb-1">
                    สถานะ
                  </label>
                  {editingAsset.status === 'LOANED' ? (
                    <div className="text-xs text-amber-600 bg-amber-500/10 p-2.5 rounded-lg border border-amber-500/20">
                      กำลังถูกยืม (ต้องบันทึกรับคืนก่อนเปลี่ยนสถานะ)
                    </div>
                  ) : (
                    <select
                      value={assetStatus}
                      onChange={(e) => setAssetStatus(e.target.value as AssetStatus)}
                      className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)] focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="AVAILABLE">พร้อมให้ยืม</option>
                      <option value="RETIRED">ตัดจำหน่าย</option>
                    </select>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-[var(--fg-2)] mb-1">
                  หมายเหตุ
                </label>
                <textarea
                  rows={3}
                  value={assetNotes}
                  onChange={(e) => setAssetNotes(e.target.value)}
                  placeholder="รายละเอียดเพิ่มเติม ซีเรียลนัมเบอร์ หรือเงื่อนไข..."
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)] focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setAssetModalOpen(false)}
                  className="px-4 py-2 text-sm rounded-lg border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={savingAsset}
                  className="phopy-btn-primary px-4 py-2 text-sm rounded-lg font-semibold disabled:opacity-50"
                >
                  {savingAsset ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: ให้ยืมทรัพย์สิน */}
      {loanModalOpen && loaningAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="phopy-card bg-[var(--surface-1)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
              <h2 className="text-base font-semibold text-[var(--fg-1)]">
                บันทึกการให้ยืมทรัพย์สิน
              </h2>
              <button
                type="button"
                onClick={() => setLoanModalOpen(false)}
                className="p-1 rounded-lg text-[var(--fg-3)] hover:text-[var(--fg-1)] hover:bg-[var(--surface-2)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveLoan} className="p-4 space-y-4">
              <div className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
                <div className="text-xs text-[var(--fg-3)]">ทรัพย์สินที่ยืม</div>
                <div className="font-semibold text-sm text-[var(--fg-1)] mt-0.5">
                  {loaningAsset.code} — {loaningAsset.name}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--fg-2)] mb-1">
                  พนักงานผู้ยืม <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={loanEmployeeId}
                  onChange={(e) => setLoanEmployeeId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)] focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                <label className="block text-xs font-semibold text-[var(--fg-2)] mb-1">
                  วันที่ยืม <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={loanDate}
                  onChange={(e) => setLoanDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)] focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--fg-2)] mb-1">
                  หมายเหตุการยืม
                </label>
                <textarea
                  rows={2}
                  value={loanNote}
                  onChange={(e) => setLoanNote(e.target.value)}
                  placeholder="วัตถุประสงค์ในการยืม หรืออุปกรณ์ที่ติดไปด้วย..."
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)] focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setLoanModalOpen(false)}
                  className="px-4 py-2 text-sm rounded-lg border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={savingLoan}
                  className="phopy-btn-primary px-4 py-2 text-sm rounded-lg font-semibold disabled:opacity-50"
                >
                  {savingLoan ? 'กำลังบันทึก...' : 'ยืนยันการให้ยืม'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 3: รับคืนทรัพย์สิน */}
      {returnModalOpen && returningAsset && returningAsset.current_loan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="phopy-card bg-[var(--surface-1)] border border-[var(--border)] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
              <h2 className="text-base font-semibold text-[var(--fg-1)]">
                บันทึกการรับคืนทรัพย์สิน
              </h2>
              <button
                type="button"
                onClick={() => setReturnModalOpen(false)}
                className="p-1 rounded-lg text-[var(--fg-3)] hover:text-[var(--fg-1)] hover:bg-[var(--surface-2)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveReturn} className="p-4 space-y-4">
              <div className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] space-y-1">
                <div className="flex justify-between items-center text-xs text-[var(--fg-3)]">
                  <span>ทรัพย์สิน:</span>
                  <span className="font-semibold text-[var(--fg-1)]">{returningAsset.code} — {returningAsset.name}</span>
                </div>
                <div className="flex justify-between items-center text-xs text-[var(--fg-3)]">
                  <span>ผู้ยืม:</span>
                  <span className="font-semibold text-[var(--fg-1)]">{returningAsset.current_loan.employee_name}</span>
                </div>
                <div className="flex justify-between items-center text-xs text-[var(--fg-3)]">
                  <span>วันที่ยืม:</span>
                  <span className="text-[var(--fg-2)]">{returningAsset.current_loan.loaned_on}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--fg-2)] mb-1">
                  วันที่คืน <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  min={returningAsset.current_loan.loaned_on}
                  value={returnDate}
                  onChange={(e) => setReturnDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)] focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Attachments via PaymentAttachments */}
              <div className="pt-2 border-t border-[var(--border)]">
                <label className="block text-xs font-semibold text-[var(--fg-2)] mb-1.5">
                  รูปถ่ายตอนส่งมอบ / รับคืน
                </label>
                <PaymentAttachments refType="ASSET_LOAN" refId={returningAsset.current_loan.loan_id} dense />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setReturnModalOpen(false)}
                  className="px-4 py-2 text-sm rounded-lg border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={savingReturn}
                  className="phopy-btn-primary px-4 py-2 text-sm rounded-lg font-semibold disabled:opacity-50"
                >
                  {savingReturn ? 'กำลังบันทึก...' : 'ยืนยันรับคืน'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 4: ประวัติการยืมของทรัพย์สิน */}
      {historyModalOpen && historyAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="phopy-card bg-[var(--surface-1)] border border-[var(--border)] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
              <div>
                <h2 className="text-base font-semibold text-[var(--fg-1)]">
                  ประวัติการยืมทรัพย์สิน
                </h2>
                <p className="text-xs text-[var(--fg-3)] mt-0.5">
                  {historyAsset.code} — {historyAsset.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryModalOpen(false)}
                className="p-1 rounded-lg text-[var(--fg-3)] hover:text-[var(--fg-1)] hover:bg-[var(--surface-2)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 max-h-[70vh] overflow-y-auto space-y-4">
              {loadingHistory ? (
                <div className="p-8 text-center text-sm text-[var(--fg-3)]">กำลังโหลดประวัติ...</div>
              ) : assetLoans.length === 0 ? (
                <div className="p-8 text-center text-sm text-[var(--fg-3)]">ยังไม่มีประวัติการยืม</div>
              ) : (
                <div className="space-y-3">
                  {assetLoans.map((loan) => (
                    <div
                      key={loan.id}
                      className="p-3.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] space-y-2.5"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-blue-500" />
                          <span className="font-semibold text-[var(--fg-1)]">
                            {loan.employee_name} ({loan.employee_code})
                          </span>
                        </div>
                        <div className="text-[var(--fg-3)]">
                          {loan.returned_on ? (
                            <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                              คืนแล้วเมื่อ {loan.returned_on}
                            </span>
                          ) : (
                            <span className="text-amber-600 dark:text-amber-400 font-medium">
                              กำลังยืมอยู่
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-[var(--fg-2)] pt-1 border-t border-[var(--border)]/50">
                        <div>
                          <span className="text-[var(--fg-3)]">วันที่ยืม:</span> {loan.loaned_on}
                        </div>
                        <div>
                          <span className="text-[var(--fg-3)]">หมายเหตุ:</span> {loan.note || '-'}
                        </div>
                      </div>

                      {/* Attached photos / evidence */}
                      <div className="pt-2 border-t border-[var(--border)]/50">
                        <label className="block text-[11px] font-semibold text-[var(--fg-3)] mb-1">
                          รูปถ่าย / หลักฐานส่งมอบ-รับคืน
                        </label>
                        <PaymentAttachments refType="ASSET_LOAN" refId={loan.id} dense />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end p-4 border-t border-[var(--border)]">
              <button
                type="button"
                onClick={() => setHistoryModalOpen(false)}
                className="px-4 py-2 text-sm rounded-lg border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
