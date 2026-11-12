import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Scale,
  FileText,
  Plus,
  Search,
  X,
  Pencil,
  Trash2,
  Paperclip,
  UserCheck,
  Filter,
  ShieldAlert,
} from 'lucide-react'
import toast from 'react-hot-toast'
import hrService, { Employee } from '../../services/hr.service'
import hrDisciplineService, {
  DisciplinaryRecord,
  DisciplinaryLevel,
  WorkRule,
  DisciplinaryInput,
  DisciplinaryUpdate,
  WorkRuleInput,
} from '../../services/hrDiscipline.service'
import { PaymentAttachments } from '../../components/common/PaymentAttachments'

type TabKey = 'records' | 'rules'

const todayStr = () => new Date().toISOString().slice(0, 10)

export function renderDisciplinaryActivePill(active: boolean) {
  if (active) {
    return (
      <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        ยังมีผล
      </span>
    )
  }
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--surface-2)] text-[var(--fg-3)]">
      หมดผลแล้ว
    </span>
  )
}

export function renderAcknowledgedPill(record: DisciplinaryRecord) {
  if (record.acknowledged_via === 'SELF') {
    return (
      <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-500/15 text-blue-600 dark:text-blue-400">
        รับทราบแล้ว (ตนเอง)
      </span>
    )
  }
  if (record.acknowledged_via === 'WITNESS') {
    return (
      <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-purple-500/15 text-purple-600 dark:text-purple-400">
        รับทราบแล้ว (พยาน: {record.witness_name || '-'})
      </span>
    )
  }
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400">
      ยังไม่ได้รับทราบ
    </span>
  )
}

export function renderLevelPill(level: DisciplinaryLevel) {
  if (level === 'WRITTEN') {
    return (
      <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-500/15 text-red-600 dark:text-red-400">
        ตักเตือนเป็นหนังสือ
      </span>
    )
  }
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400">
      ตักเตือนด้วยวาจา
    </span>
  )
}

export default function Discipline() {
  const [activeTab, setActiveTab] = useState<TabKey>('records')

  // Shared master data
  const [employees, setEmployees] = useState<Employee[]>([])
  const [workRules, setWorkRules] = useState<WorkRule[]>([])

  // Records state
  const [records, setRecords] = useState<DisciplinaryRecord[]>([])
  const [loadingRecords, setLoadingRecords] = useState(false)
  const [filterEmployeeId, setFilterEmployeeId] = useState('')
  const [filterActive, setFilterActive] = useState<string>('all')
  const [filterAck, setFilterAck] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Work rules state
  const [loadingRules, setLoadingRules] = useState(false)
  const [ruleSearch, setRuleSearch] = useState('')

  // Modal 1: Create Disciplinary Record
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [formEmployeeId, setFormEmployeeId] = useState('')
  const [formIncidentDate, setFormIncidentDate] = useState(todayStr())
  const [formLevel, setFormLevel] = useState<DisciplinaryLevel>('WRITTEN')
  const [formCategory, setFormCategory] = useState('')
  const [formWorkRuleId, setFormWorkRuleId] = useState('')
  const [formDetail, setFormDetail] = useState('')
  const [savingRecord, setSavingRecord] = useState(false)

  // Modal 2: Edit Disciplinary Record
  const [editingRecord, setEditingRecord] = useState<DisciplinaryRecord | null>(null)
  const [editIncidentDate, setEditIncidentDate] = useState('')
  const [editLevel, setEditLevel] = useState<DisciplinaryLevel>('WRITTEN')
  const [editCategory, setEditCategory] = useState('')
  const [editWorkRuleId, setEditWorkRuleId] = useState('')
  const [editDetail, setEditDetail] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  // Modal 3: Witness Acknowledgment
  const [witnessModalRecord, setWitnessModalRecord] = useState<DisciplinaryRecord | null>(null)
  const [witnessName, setWitnessName] = useState('')
  const [savingWitness, setSavingWitness] = useState(false)

  // Modal 4: Details & Attachments
  const [detailModalRecord, setDetailModalRecord] = useState<DisciplinaryRecord | null>(null)

  // Modal 5: Work Rule Create/Edit
  const [ruleModalOpen, setRuleModalOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<WorkRule | null>(null)
  const [formClauseNo, setFormClauseNo] = useState('')
  const [formRuleTitle, setFormRuleTitle] = useState('')
  const [formRuleBody, setFormRuleBody] = useState('')
  const [formAnnouncedOn, setFormAnnouncedOn] = useState('')
  const [formRuleActive, setFormRuleActive] = useState(true)
  const [savingRule, setSavingRule] = useState(false)

  // Load master employees
  const loadEmployees = useCallback(async () => {
    try {
      const data = await hrService.getEmployees({ status: 'ACTIVE' })
      setEmployees(data)
    } catch (err: any) {
      console.error('Failed to load employees:', err)
    }
  }, [])

  // Load work rules
  const loadWorkRules = useCallback(async () => {
    try {
      setLoadingRules(true)
      const data = await hrDisciplineService.getWorkRules()
      setWorkRules(data)
    } catch (err: any) {
      console.error('Failed to load work rules:', err)
      toast.error('โหลดข้อบังคับการทำงานไม่สำเร็จ')
    } finally {
      setLoadingRules(false)
    }
  }, [])

  // Load disciplinary records
  const loadRecords = useCallback(async () => {
    try {
      setLoadingRecords(true)
      const params: { employee_id?: string } = {}
      if (filterEmployeeId) params.employee_id = filterEmployeeId
      const data = await hrDisciplineService.getDisciplinaryRecords(params)
      setRecords(data)
    } catch (err: any) {
      console.error('Failed to load disciplinary records:', err)
      toast.error('โหลดบันทึกวินัยไม่สำเร็จ')
    } finally {
      setLoadingRecords(false)
    }
  }, [filterEmployeeId])

  useEffect(() => {
    loadEmployees()
    loadWorkRules()
  }, [loadEmployees, loadWorkRules])

  useEffect(() => {
    loadRecords()
  }, [loadRecords])

  // Filtered records
  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (filterActive === 'active' && !r.active) return false
      if (filterActive === 'expired' && r.active) return false
      if (filterAck === 'acknowledged' && !r.acknowledged_via) return false
      if (filterAck === 'unacknowledged' && r.acknowledged_via) return false

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const empName = (r.employee_name || '').toLowerCase()
        const empCode = (r.employee_code || '').toLowerCase()
        const cat = (r.category || '').toLowerCase()
        const detail = (r.detail || '').toLowerCase()
        const clause = (r.clause_no || '').toLowerCase()
        if (
          !empName.includes(q) &&
          !empCode.includes(q) &&
          !cat.includes(q) &&
          !detail.includes(q) &&
          !clause.includes(q)
        ) {
          return false
        }
      }
      return true
    })
  }, [records, filterActive, filterAck, searchQuery])

  // Filtered work rules
  const filteredRules = useMemo(() => {
    if (!ruleSearch.trim()) return workRules
    const q = ruleSearch.toLowerCase().trim()
    return workRules.filter(
      (r) =>
        r.clause_no.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        (r.body && r.body.toLowerCase().includes(q))
    )
  }, [workRules, ruleSearch])

  // Handlers for Disciplinary Record Create
  const handleOpenCreateModal = () => {
    setFormEmployeeId(employees[0]?.id || '')
    setFormIncidentDate(todayStr())
    setFormLevel('WRITTEN')
    setFormCategory('')
    setFormWorkRuleId('')
    setFormDetail('')
    setCreateModalOpen(true)
  }

  const handleSaveCreateRecord = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formEmployeeId) {
      toast.error('กรุณาเลือกพนักงาน')
      return
    }
    if (!formIncidentDate) {
      toast.error('กรุณาระบุวันที่เกิดเหตุ')
      return
    }
    if (!formCategory.trim()) {
      toast.error('กรุณาระบุหมวดหมู่ความผิด')
      return
    }
    if (!formDetail.trim()) {
      toast.error('กรุณาระบุรายละเอียด')
      return
    }

    try {
      setSavingRecord(true)
      const payload: DisciplinaryInput = {
        employee_id: formEmployeeId,
        incident_date: formIncidentDate,
        level: formLevel,
        category: formCategory.trim(),
        detail: formDetail.trim(),
        work_rule_id: formWorkRuleId || null,
      }
      await hrDisciplineService.createDisciplinaryRecord(payload)
      toast.success('บันทึกวินัยเรียบร้อย')
      setCreateModalOpen(false)
      loadRecords()
    } catch (err: any) {
      console.error('Create record error:', err)
      toast.error(err?.response?.data?.message || 'บันทึกวินัยไม่สำเร็จ')
    } finally {
      setSavingRecord(false)
    }
  }

  // Handlers for Disciplinary Record Edit
  const handleOpenEditModal = (rec: DisciplinaryRecord) => {
    if (rec.acknowledged_at || rec.acknowledged_via) {
      toast.error('ไม่สามารถแก้ไขบันทึกที่รับทราบแล้ว')
      return
    }
    setEditingRecord(rec)
    setEditIncidentDate(rec.incident_date)
    setEditLevel(rec.level)
    setEditCategory(rec.category)
    setEditWorkRuleId(rec.work_rule_id || '')
    setEditDetail(rec.detail)
  }

  const handleSaveEditRecord = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingRecord) return
    if (!editIncidentDate) {
      toast.error('กรุณาระบุวันที่เกิดเหตุ')
      return
    }
    if (!editCategory.trim()) {
      toast.error('กรุณาระบุหมวดหมู่ความผิด')
      return
    }
    if (!editDetail.trim()) {
      toast.error('กรุณาระบุรายละเอียด')
      return
    }

    try {
      setSavingEdit(true)
      const payload: DisciplinaryUpdate = {
        incident_date: editIncidentDate,
        level: editLevel,
        category: editCategory.trim(),
        detail: editDetail.trim(),
        work_rule_id: editWorkRuleId || null,
      }
      await hrDisciplineService.updateDisciplinaryRecord(editingRecord.id, payload)
      toast.success('แก้ไขบันทึกวินัยเรียบร้อย')
      setEditingRecord(null)
      loadRecords()
    } catch (err: any) {
      console.error('Update record error:', err)
      toast.error(err?.response?.data?.message || 'แก้ไขบันทึกวินัยไม่สำเร็จ')
    } finally {
      setSavingEdit(false)
    }
  }

  // Handlers for Witness Acknowledgment
  const handleOpenWitnessModal = (rec: DisciplinaryRecord) => {
    if (rec.acknowledged_at || rec.acknowledged_via) {
      toast.error('บันทึกนี้รับทราบแล้ว')
      return
    }
    setWitnessModalRecord(rec)
    setWitnessName('')
  }

  const handleSaveWitness = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!witnessModalRecord) return
    if (!witnessName.trim()) {
      toast.error('กรุณาระบุชื่อพยาน')
      return
    }

    try {
      setSavingWitness(true)
      await hrDisciplineService.acknowledgeWitness(witnessModalRecord.id, witnessName.trim())
      toast.success('พยานลงชื่อรับทราบเรียบร้อย')
      setWitnessModalRecord(null)
      loadRecords()
    } catch (err: any) {
      console.error('Witness ack error:', err)
      toast.error(err?.response?.data?.message || 'บันทึกการรับทราบไม่สำเร็จ')
    } finally {
      setSavingWitness(false)
    }
  }

  // Handlers for Work Rule Create/Edit
  const handleOpenAddRule = () => {
    setEditingRule(null)
    setFormClauseNo('')
    setFormRuleTitle('')
    setFormRuleBody('')
    setFormAnnouncedOn('')
    setFormRuleActive(true)
    setRuleModalOpen(true)
  }

  const handleOpenEditRule = (rule: WorkRule) => {
    setEditingRule(rule)
    setFormClauseNo(rule.clause_no)
    setFormRuleTitle(rule.title)
    setFormRuleBody(rule.body || '')
    setFormAnnouncedOn(rule.announced_on || '')
    setFormRuleActive(rule.is_active)
    setRuleModalOpen(true)
  }

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formClauseNo.trim()) {
      toast.error('กรุณาระบุข้อที่/หมวดข้อบังคับ')
      return
    }
    if (!formRuleTitle.trim()) {
      toast.error('กรุณาระบุชื่อข้อบังคับ')
      return
    }

    try {
      setSavingRule(true)
      const payload: WorkRuleInput = {
        clause_no: formClauseNo.trim(),
        title: formRuleTitle.trim(),
        body: formRuleBody.trim() || null,
        announced_on: formAnnouncedOn || null,
        is_active: formRuleActive,
      }

      if (editingRule) {
        await hrDisciplineService.updateWorkRule(editingRule.id, payload)
        toast.success('แก้ไขข้อบังคับการทำงานเรียบร้อย')
      } else {
        await hrDisciplineService.createWorkRule(payload)
        toast.success('เพิ่มข้อบังคับการทำงานเรียบร้อย')
      }
      setRuleModalOpen(false)
      loadWorkRules()
    } catch (err: any) {
      console.error('Save work rule error:', err)
      toast.error(err?.response?.data?.message || 'บันทึกข้อบังคับไม่สำเร็จ')
    } finally {
      setSavingRule(false)
    }
  }

  const handleDeleteRule = async (rule: WorkRule) => {
    if (!confirm(`คุณต้องการปิดการใช้งานข้อบังคับ "${rule.clause_no} ${rule.title}" หรือไม่?`)) {
      return
    }
    try {
      await hrDisciplineService.deleteWorkRule(rule.id)
      toast.success('ปิดการใช้งานข้อบังคับเรียบร้อย')
      loadWorkRules()
    } catch (err: any) {
      console.error('Delete work rule error:', err)
      toast.error(err?.response?.data?.message || 'ดำเนินการไม่สำเร็จ')
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Scale className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[var(--fg-1)]">วินัยและข้อบังคับการทำงาน</h1>
            <p className="text-xs text-[var(--fg-3)]">
              บันทึกวินัย หนังสือเตือน และข้อบังคับการทำงานตามกฎหมายคุ้มครองแรงงาน
            </p>
          </div>
        </div>

        <div>
          {activeTab === 'records' ? (
            <button
              type="button"
              onClick={handleOpenCreateModal}
              className="phopy-btn-primary px-4 py-2 text-sm rounded-lg font-semibold flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              บันทึกวินัยใหม่
            </button>
          ) : (
            <button
              type="button"
              onClick={handleOpenAddRule}
              className="phopy-btn-primary px-4 py-2 text-sm rounded-lg font-semibold flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              เพิ่มข้อบังคับการทำงาน
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--border)] gap-2">
        <button
          type="button"
          onClick={() => setActiveTab('records')}
          className={`pb-3 px-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'records'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-semibold'
              : 'border-transparent text-[var(--fg-3)] hover:text-[var(--fg-1)]'
          }`}
        >
          <ShieldAlert className="w-4 h-4" />
          <span>บันทึกวินัย</span>
          <span className="px-1.5 py-0.5 rounded-full text-xs bg-[var(--surface-2)] text-[var(--fg-2)]">
            {records.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('rules')}
          className={`pb-3 px-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'rules'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-semibold'
              : 'border-transparent text-[var(--fg-3)] hover:text-[var(--fg-1)]'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>ข้อบังคับการทำงาน</span>
          <span className="px-1.5 py-0.5 rounded-full text-xs bg-[var(--surface-2)] text-[var(--fg-2)]">
            {workRules.length}
          </span>
        </button>
      </div>

      {/* Tab 1: บันทึกวินัย */}
      {activeTab === 'records' && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="phopy-card p-4 flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            <div className="flex flex-1 flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-3)]" />
                <input
                  type="text"
                  placeholder="ค้นหาชื่อพนักงาน, หมวดหมู่, รายละเอียด..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              <select
                value={filterEmployeeId}
                onChange={(e) => setFilterEmployeeId(e.target.value)}
                className="px-3 py-1.5 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
              >
                <option value="">พนักงานทั้งหมด</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.code} - {emp.first_name} {emp.last_name || ''}
                  </option>
                ))}
              </select>

              <select
                value={filterActive}
                onChange={(e) => setFilterActive(e.target.value)}
                className="px-3 py-1.5 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
              >
                <option value="all">ผลบังคับ: ทั้งหมด</option>
                <option value="active">ยังมีผล (ภายใน 1 ปี)</option>
                <option value="expired">หมดผลแล้ว</option>
              </select>

              <select
                value={filterAck}
                onChange={(e) => setFilterAck(e.target.value)}
                className="px-3 py-1.5 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
              >
                <option value="all">การรับทราบ: ทั้งหมด</option>
                <option value="acknowledged">รับทราบแล้ว</option>
                <option value="unacknowledged">ยังไม่ได้รับทราบ</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="phopy-card overflow-hidden">
            {loadingRecords ? (
              <div className="p-8 text-center text-sm text-[var(--fg-3)]">กำลังโหลดข้อมูล...</div>
            ) : filteredRecords.length === 0 ? (
              <div className="p-8 text-center text-sm text-[var(--fg-3)]">ไม่พบรายการบันทึกวินัย</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="phopy-table w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-[var(--fg-3)]">
                      <th className="py-2.5 px-3">วันที่เกิดเหตุ</th>
                      <th className="py-2.5 px-3">พนักงาน</th>
                      <th className="py-2.5 px-3">ระดับการลงโทษ</th>
                      <th className="py-2.5 px-3">หมวดหมู่ / รายละเอียด</th>
                      <th className="py-2.5 px-3">ข้อบังคับที่อ้างถึง</th>
                      <th className="py-2.5 px-3">วันหมดอายุ (ม.119)</th>
                      <th className="py-2.5 px-3">การรับทราบ</th>
                      <th className="py-2.5 px-3 text-center">หลักฐาน</th>
                      <th className="py-2.5 px-3 text-right">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecords.map((r) => (
                      <tr
                        key={r.id}
                        className="border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors"
                      >
                        <td className="py-2.5 px-3 whitespace-nowrap font-medium text-[var(--fg-1)]">
                          {r.incident_date}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="font-medium text-[var(--fg-1)]">{r.employee_name}</div>
                          <div className="text-[10px] text-[var(--fg-3)]">{r.employee_code}</div>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {renderLevelPill(r.level)}
                        </td>
                        <td className="py-2.5 px-3 max-w-xs">
                          <div className="font-semibold text-[var(--fg-1)] truncate">{r.category}</div>
                          <div className="text-[11px] text-[var(--fg-3)] truncate">{r.detail}</div>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {r.clause_no ? (
                            <span className="font-medium text-[var(--fg-2)]">
                              {r.clause_no} {r.work_rule_title ? `(${r.work_rule_title})` : ''}
                            </span>
                          ) : (
                            <span className="text-[var(--fg-3)]">-</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[var(--fg-2)]">{r.expires_on}</span>
                            {renderDisciplinaryActivePill(r.active)}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {renderAcknowledgedPill(r)}
                        </td>
                        <td className="py-2.5 px-3 text-center whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setDetailModalRecord(r)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-[var(--surface-2)] text-[var(--fg-2)] hover:bg-[var(--surface-3)]"
                          >
                            <Paperclip className="w-3 h-3" />
                            <span>{r.attachment_count || 0}</span>
                          </button>
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            {/* ดูรายละเอียดและไฟล์แนบ */}
                            <button
                              type="button"
                              onClick={() => setDetailModalRecord(r)}
                              title="ดูรายละเอียดและหลักฐาน"
                              className="p-1 rounded hover:bg-[var(--surface-2)] text-[var(--fg-3)] hover:text-[var(--fg-1)]"
                            >
                              <FileText className="w-3.5 h-3.5" />
                            </button>

                            {/* ปุ่มพยานลงชื่อ (ถ้ายังไม่รับทราบ) */}
                            {!r.acknowledged_via && (
                              <button
                                type="button"
                                onClick={() => handleOpenWitnessModal(r)}
                                title="พยานลงชื่อรับทราบ"
                                className="p-1 rounded hover:bg-[var(--surface-2)] text-purple-600 hover:text-purple-700"
                              >
                                <UserCheck className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {/* ปุ่มแก้ไข (ถ้ายังไม่รับทราบ) */}
                            {!r.acknowledged_via && (
                              <button
                                type="button"
                                onClick={() => handleOpenEditModal(r)}
                                title="แก้ไขบันทึกวินัย"
                                className="p-1 rounded hover:bg-[var(--surface-2)] text-[var(--fg-3)] hover:text-[var(--fg-1)]"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: ข้อบังคับการทำงาน */}
      {activeTab === 'rules' && (
        <div className="space-y-4">
          {/* Search bar */}
          <div className="phopy-card p-4">
            <div className="relative max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-3)]" />
              <input
                type="text"
                placeholder="ค้นหาข้อที่, ชื่อข้อบังคับ, เนื้อหา..."
                value={ruleSearch}
                onChange={(e) => setRuleSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
              />
            </div>
          </div>

          {/* Table */}
          <div className="phopy-card overflow-hidden">
            {loadingRules ? (
              <div className="p-8 text-center text-sm text-[var(--fg-3)]">กำลังโหลดข้อบังคับ...</div>
            ) : filteredRules.length === 0 ? (
              <div className="p-8 text-center text-sm text-[var(--fg-3)]">ยังไม่มีข้อบังคับการทำงาน</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="phopy-table w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-[var(--fg-3)]">
                      <th className="py-2.5 px-3">ข้อที่ / หมวด</th>
                      <th className="py-2.5 px-3">ชื่อข้อบังคับ</th>
                      <th className="py-2.5 px-3">เนื้อหา / รายละเอียด</th>
                      <th className="py-2.5 px-3">วันที่ประกาศใช้</th>
                      <th className="py-2.5 px-3">สถานะ</th>
                      <th className="py-2.5 px-3 text-right">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRules.map((rule) => (
                      <tr
                        key={rule.id}
                        className="border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors"
                      >
                        <td className="py-2.5 px-3 whitespace-nowrap font-bold text-[var(--fg-1)]">
                          {rule.clause_no}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap font-medium text-[var(--fg-1)]">
                          {rule.title}
                        </td>
                        <td className="py-2.5 px-3 max-w-md text-[var(--fg-2)]">
                          {rule.body ? (
                            <div className="line-clamp-2">{rule.body}</div>
                          ) : (
                            <span className="text-[var(--fg-3)]">-</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap text-[var(--fg-2)]">
                          {rule.announced_on || '-'}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {rule.is_active ? (
                            <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                              ใช้งาน
                            </span>
                          ) : (
                            <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--surface-2)] text-[var(--fg-3)]">
                              ยกเลิก
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => handleOpenEditRule(rule)}
                              title="แก้ไข"
                              className="p-1 rounded hover:bg-[var(--surface-2)] text-[var(--fg-3)] hover:text-[var(--fg-1)]"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            {rule.is_active && (
                              <button
                                type="button"
                                onClick={() => handleDeleteRule(rule)}
                                title="ปิดการใช้งาน"
                                className="p-1 rounded hover:bg-[var(--surface-2)] text-red-500 hover:text-red-600"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal 1: บันทึกวินัยใหม่ */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="phopy-card w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="text-base font-bold text-[var(--fg-1)]">บันทึกวินัยใหม่</h2>
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                className="p-1 rounded-lg hover:bg-[var(--surface-2)]"
              >
                <X className="w-4 h-4 text-[var(--fg-3)]" />
              </button>
            </div>

            <form onSubmit={handleSaveCreateRecord} className="space-y-4">
              <div>
                <label htmlFor="create-emp" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  พนักงาน *
                </label>
                <select
                  id="create-emp"
                  required
                  value={formEmployeeId}
                  onChange={(e) => setFormEmployeeId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                >
                  <option value="">-- เลือกพนักงาน --</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.code} - {emp.first_name} {emp.last_name || ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="create-incident-date" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                    วันที่เกิดเหตุ *
                  </label>
                  <input
                    id="create-incident-date"
                    type="date"
                    required
                    max={todayStr()}
                    value={formIncidentDate}
                    onChange={(e) => setFormIncidentDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                </div>

                <div>
                  <label htmlFor="create-level" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                    ระดับการลงโทษ *
                  </label>
                  <select
                    id="create-level"
                    value={formLevel}
                    onChange={(e) => setFormLevel(e.target.value as DisciplinaryLevel)}
                    className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  >
                    <option value="VERBAL">ตักเตือนด้วยวาจา (VERBAL)</option>
                    <option value="WRITTEN">ตักเตือนเป็นหนังสือ (WRITTEN)</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="create-category" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  หมวดหมู่ความผิด *
                </label>
                <input
                  id="create-category"
                  type="text"
                  required
                  placeholder="เช่น ขาดงานโดยไม่แจ้ง, ละทิ้งหน้าที่, ฝ่าฝืนระเบียบความปลอดภัย"
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              <div>
                <label htmlFor="create-rule" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  ข้อบังคับการทำงานที่เกี่ยวข้อง (ถ้ามี)
                </label>
                <select
                  id="create-rule"
                  value={formWorkRuleId}
                  onChange={(e) => setFormWorkRuleId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                >
                  <option value="">-- ไม่ระบุ --</option>
                  {workRules
                    .filter((r) => r.is_active)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.clause_no} {r.title}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label htmlFor="create-detail" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  รายละเอียดเหตุการณ์ *
                </label>
                <textarea
                  id="create-detail"
                  required
                  rows={4}
                  placeholder="ระบุข้อเท็จจริง พฤติการณ์ และผลกระทบที่เกิดขึ้น..."
                  value={formDetail}
                  onChange={(e) => setFormDetail(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              <div className="p-3 rounded-lg bg-blue-500/10 text-blue-700 dark:text-blue-300 text-xs">
                <p className="font-semibold">ผลบังคับตาม พ.ร.บ. คุ้มครองแรงงาน ม.119:</p>
                <p className="text-[11px] mt-0.5">
                  หนังสือเตือนมีผลบังคับได้ไม่เกิน 1 ปีนับแต่วันที่เกิดเหตุ ระบบจะคำนวณวันหมดอายุอัตโนมัติ
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium rounded-lg text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={savingRecord}
                  className="phopy-btn-primary px-4 py-2 text-xs rounded-lg font-semibold disabled:opacity-50"
                >
                  {savingRecord ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: แก้ไขบันทึกวินัย */}
      {editingRecord && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="phopy-card w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="text-base font-bold text-[var(--fg-1)]">แก้ไขบันทึกวินัย</h2>
              <button
                type="button"
                onClick={() => setEditingRecord(null)}
                className="p-1 rounded-lg hover:bg-[var(--surface-2)]"
              >
                <X className="w-4 h-4 text-[var(--fg-3)]" />
              </button>
            </div>

            <form onSubmit={handleSaveEditRecord} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  พนักงาน
                </label>
                <div className="px-3 py-2 text-xs rounded-lg bg-[var(--surface-3)] text-[var(--fg-1)]">
                  {editingRecord.employee_code} - {editingRecord.employee_name}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-incident-date" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                    วันที่เกิดเหตุ *
                  </label>
                  <input
                    id="edit-incident-date"
                    type="date"
                    required
                    max={todayStr()}
                    value={editIncidentDate}
                    onChange={(e) => setEditIncidentDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                </div>

                <div>
                  <label htmlFor="edit-level" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                    ระดับการลงโทษ *
                  </label>
                  <select
                    id="edit-level"
                    value={editLevel}
                    onChange={(e) => setEditLevel(e.target.value as DisciplinaryLevel)}
                    className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  >
                    <option value="VERBAL">ตักเตือนด้วยวาจา (VERBAL)</option>
                    <option value="WRITTEN">ตักเตือนเป็นหนังสือ (WRITTEN)</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="edit-category" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  หมวดหมู่ความผิด *
                </label>
                <input
                  id="edit-category"
                  type="text"
                  required
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              <div>
                <label htmlFor="edit-rule" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  ข้อบังคับการทำงานที่เกี่ยวข้อง (ถ้ามี)
                </label>
                <select
                  id="edit-rule"
                  value={editWorkRuleId}
                  onChange={(e) => setEditWorkRuleId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                >
                  <option value="">-- ไม่ระบุ --</option>
                  {workRules.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.clause_no} {r.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="edit-detail" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  รายละเอียดเหตุการณ์ *
                </label>
                <textarea
                  id="edit-detail"
                  required
                  rows={4}
                  value={editDetail}
                  onChange={(e) => setEditDetail(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setEditingRecord(null)}
                  className="px-4 py-2 text-xs font-medium rounded-lg text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="phopy-btn-primary px-4 py-2 text-xs rounded-lg font-semibold disabled:opacity-50"
                >
                  {savingEdit ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 3: พยานลงชื่อรับทราบ */}
      {witnessModalRecord && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="phopy-card w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="text-base font-bold text-[var(--fg-1)]">พยานลงชื่อรับทราบ</h2>
              <button
                type="button"
                onClick={() => setWitnessModalRecord(null)}
                className="p-1 rounded-lg hover:bg-[var(--surface-2)]"
              >
                <X className="w-4 h-4 text-[var(--fg-3)]" />
              </button>
            </div>

            <form onSubmit={handleSaveWitness} className="space-y-4">
              <p className="text-xs text-[var(--fg-2)]">
                บันทึกการรับทราบทางวินัยสำหรับ <strong>{witnessModalRecord.employee_name}</strong> โดยพยาน
                (กรณีพนักงานไม่ยินยอมลงนามด้วยตนเอง หรือลงนามต่อหน้าพยาน)
              </p>

              <div>
                <label htmlFor="witness-name-input" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  ชื่อพยาน / ผู้บันทึก *
                </label>
                <input
                  id="witness-name-input"
                  type="text"
                  required
                  placeholder="เช่น นายมานะ มั่นคง (หัวหน้าฝ่ายผลิต)"
                  value={witnessName}
                  onChange={(e) => setWitnessName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setWitnessModalRecord(null)}
                  className="px-4 py-2 text-xs font-medium rounded-lg text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={savingWitness}
                  className="phopy-btn-primary px-4 py-2 text-xs rounded-lg font-semibold disabled:opacity-50"
                >
                  {savingWitness ? 'กำลังบันทึก...' : 'ยืนยันการรับทราบ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 4: รายละเอียดและไฟล์แนบ */}
      {detailModalRecord && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="phopy-card w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="text-base font-bold text-[var(--fg-1)]">
                รายละเอียดบันทึกวินัย & หลักฐาน
              </h2>
              <button
                type="button"
                onClick={() => setDetailModalRecord(null)}
                className="p-1 rounded-lg hover:bg-[var(--surface-2)]"
              >
                <X className="w-4 h-4 text-[var(--fg-3)]" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-[var(--surface-2)]">
                <div>
                  <span className="text-[var(--fg-3)]">พนักงาน: </span>
                  <span className="font-semibold text-[var(--fg-1)]">
                    {detailModalRecord.employee_code} {detailModalRecord.employee_name}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--fg-3)]">ระดับ: </span>
                  {renderLevelPill(detailModalRecord.level)}
                </div>
                <div>
                  <span className="text-[var(--fg-3)]">วันที่เกิดเหตุ: </span>
                  <span className="font-medium text-[var(--fg-1)]">{detailModalRecord.incident_date}</span>
                </div>
                <div>
                  <span className="text-[var(--fg-3)]">วันหมดอายุ (ม.119): </span>
                  <span className="font-medium text-[var(--fg-1)]">{detailModalRecord.expires_on}</span>{' '}
                  {renderDisciplinaryActivePill(detailModalRecord.active)}
                </div>
                <div>
                  <span className="text-[var(--fg-3)]">หมวดหมู่: </span>
                  <span className="font-semibold text-[var(--fg-1)]">{detailModalRecord.category}</span>
                </div>
                <div>
                  <span className="text-[var(--fg-3)]">ข้อบังคับ: </span>
                  <span className="font-medium text-[var(--fg-1)]">
                    {detailModalRecord.clause_no
                      ? `${detailModalRecord.clause_no} ${detailModalRecord.work_rule_title || ''}`
                      : '-'}
                  </span>
                </div>
              </div>

              <div>
                <span className="block text-[var(--fg-3)] mb-1 font-medium">รายละเอียดเหตุการณ์:</span>
                <div className="p-3 rounded-lg bg-[var(--surface-2)] text-[var(--fg-1)] whitespace-pre-wrap">
                  {detailModalRecord.detail}
                </div>
              </div>

              <div>
                <span className="block text-[var(--fg-3)] mb-1 font-medium">สถานะการรับทราบ:</span>
                <div className="p-3 rounded-lg bg-[var(--surface-2)]">
                  {renderAcknowledgedPill(detailModalRecord)}
                  {detailModalRecord.acknowledged_at && (
                    <span className="text-[var(--fg-3)] ml-2 text-[11px]">
                      (เมื่อ {detailModalRecord.acknowledged_at.slice(0, 10)})
                    </span>
                  )}
                </div>
              </div>

              <div className="pt-2">
                <span className="block text-xs font-semibold text-[var(--fg-1)] mb-2">
                  ไฟล์หลักฐานเอกสาร (DISCIPLINARY_RECORD):
                </span>
                <PaymentAttachments
                  refType={'DISCIPLINARY_RECORD' as any}
                  refId={detailModalRecord.id}
                  dense
                />
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-[var(--border)]">
              <button
                type="button"
                onClick={() => setDetailModalRecord(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 5: เพิ่ม/แก้ไข ข้อบังคับการทำงาน */}
      {ruleModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="phopy-card w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="text-base font-bold text-[var(--fg-1)]">
                {editingRule ? 'แก้ไขข้อบังคับการทำงาน' : 'เพิ่มข้อบังคับการทำงาน'}
              </h2>
              <button
                type="button"
                onClick={() => setRuleModalOpen(false)}
                className="p-1 rounded-lg hover:bg-[var(--surface-2)]"
              >
                <X className="w-4 h-4 text-[var(--fg-3)]" />
              </button>
            </div>

            <form onSubmit={handleSaveRule} className="space-y-4">
              <div>
                <label htmlFor="rule-clause" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  ข้อที่ / หมวดข้อบังคับ *
                </label>
                <input
                  id="rule-clause"
                  type="text"
                  required
                  placeholder="เช่น หมวดที่ 4 ข้อ 12, ข้อ 5.1"
                  value={formClauseNo}
                  onChange={(e) => setFormClauseNo(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              <div>
                <label htmlFor="rule-title" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  ชื่อข้อบังคับ *
                </label>
                <input
                  id="rule-title"
                  type="text"
                  required
                  placeholder="เช่น การละทิ้งหน้าที่การงาน, วินัยความปลอดภัย"
                  value={formRuleTitle}
                  onChange={(e) => setFormRuleTitle(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              <div>
                <label htmlFor="rule-announced" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  วันที่ประกาศใช้ (ถ้ามี)
                </label>
                <input
                  id="rule-announced"
                  type="date"
                  value={formAnnouncedOn}
                  onChange={(e) => setFormAnnouncedOn(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              <div>
                <label htmlFor="rule-body" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  เนื้อหา / ข้อความข้อบังคับ
                </label>
                <textarea
                  id="rule-body"
                  rows={4}
                  placeholder="ระบุข้อความตามระเบียบข้อบังคับเกี่ยวกับการทำงาน..."
                  value={formRuleBody}
                  onChange={(e) => setFormRuleBody(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="rule-active"
                  checked={formRuleActive}
                  onChange={(e) => setFormRuleActive(e.target.checked)}
                  className="rounded border-[var(--border)]"
                />
                <label htmlFor="rule-active" className="text-xs font-medium text-[var(--fg-1)]">
                  เปิดใช้งานข้อบังคับนี้
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setRuleModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium rounded-lg text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={savingRule}
                  className="phopy-btn-primary px-4 py-2 text-xs rounded-lg font-semibold disabled:opacity-50"
                >
                  {savingRule ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
