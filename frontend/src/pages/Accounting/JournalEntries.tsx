import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  FileText,
  Plus,
  Search,
  CheckCircle,
  Lock,
  Unlock,
  Trash2,
  Calculator,
} from 'lucide-react'
import { journalApi, accountsApi, JournalEntry, Account } from '../../services/accounting'
import toast from 'react-hot-toast'

const JournalEntries = () => {
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [dateRange, setDateRange] = useState({ start: '', end: '' })
  const [showModal, setShowModal] = useState(false)
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null)

  // Form state
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    description: '',
    notes: '',
    lines: [{ accountId: '', description: '', debit: 0, credit: 0 }],
  })

  const fetchEntries = async () => {
    try {
      setLoading(true)
      const params: any = {}
      if (dateRange.start) params.startDate = dateRange.start
      if (dateRange.end) params.endDate = dateRange.end

      const response = await journalApi.getAll(params)
      if (response.data.success) {
        setEntries(response.data.data)
      }
    } catch (error) {
      toast.error('ไม่สามารถโหลดข้อมูลสมุดรายวันได้')
    } finally {
      setLoading(false)
    }
  }

  const fetchAccounts = async () => {
    try {
      const response = await accountsApi.getAll({ active: true })
      if (response.data.success) {
        // Filter only level 2 accounts (actual posting accounts, not headers)
        const postingAccounts = response.data.data.list.filter((a: Account) => a.level >= 2)
        setAccounts(postingAccounts)
      }
    } catch (error) {
      toast.error('ไม่สามารถโหลดข้อมูลบัญชีได้')
    }
  }

  useEffect(() => {
    fetchEntries()
  }, [dateRange])

  // Load accounts when modal opens
  useEffect(() => {
    if (showModal) {
      fetchAccounts()
    }
  }, [showModal])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()

    const totalDebit = formData.lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0)
    const totalCredit = formData.lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0)

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      toast.error(`ยอดไม่สมดุล: เดบิต ${totalDebit} ≠ เครดิต ${totalCredit}`)
      return
    }

    try {
      const response = await journalApi.create({
        date: formData.date,
        description: formData.description,
        notes: formData.notes,
        lines: formData.lines.filter(l => l.accountId && (l.debit || l.credit)),
      })

      if (response.data.success) {
        toast.success('สร้างรายการสำเร็จ')
        setShowModal(false)
        setFormData({
          date: new Date().toISOString().split('T')[0],
          description: '',
          notes: '',
          lines: [{ accountId: '', description: '', debit: 0, credit: 0 }],
        })
        fetchEntries()
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'สร้างรายการไม่สำเร็จ')
    }
  }

  const handlePost = async (id: string) => {
    try {
      const response = await journalApi.post(id)
      if (response.data.success) {
        toast.success('ยืนยันรายการสำเร็จ')
        fetchEntries()
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'ยืนยันรายการไม่สำเร็จ')
    }
  }

  const handleDelete = async (id: string, isPosted: boolean) => {
    if (isPosted) {
      toast.error('ไม่สามารถลบรายการที่ยืนยันแล้ว')
      return
    }

    if (!confirm('ต้องการลบรายการนี้?')) return

    try {
      const response = await journalApi.delete(id)
      if (response.data.success) {
        toast.success('ลบรายการสำเร็จ')
        fetchEntries()
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'ลบรายการไม่สำเร็จ')
    }
  }

  const addLine = () => {
    setFormData({
      ...formData,
      lines: [...formData.lines, { accountId: '', description: '', debit: 0, credit: 0 }],
    })
  }

  const updateLine = (index: number, field: string, value: any) => {
    const newLines = [...formData.lines]
    newLines[index] = { ...newLines[index], [field]: value }
    setFormData({ ...formData, lines: newLines })
  }

  const removeLine = (index: number) => {
    if (formData.lines.length <= 2) {
      toast.error('ต้องมีอย่างน้อย 2 รายการ')
      return
    }
    setFormData({
      ...formData,
      lines: formData.lines.filter((_, i) => i !== index),
    })
  }

  const filteredEntries = entries.filter(e =>
    e.entryNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.description.toLowerCase().includes(searchTerm.toLowerCase())
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyber-primary" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <FileText className="w-8 h-8 text-cyber-primary" />
            สมุดรายวัน (Journal Entries)
          </h1>
          <p className="text-gray-400 mt-1">
            บันทึกรายการคู่ (Double Entry) - {entries.length} รายการ
          </p>
        </div>

        <button
          onClick={() => setShowModal(true)}
          className="cyber-btn-primary flex items-center gap-2"
        >
          <Plus className="w-5 h-5" />
          บันทึกรายการ
        </button>
      </div>

      {/* Filters */}
      <div className="cyber-card p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="ค้นหาเลขที่ หรือคำอธิบาย..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="cyber-input pl-10 w-full"
            />
          </div>

          <div className="flex gap-2">
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
              className="cyber-input"
            />
            <span className="text-gray-400 self-center">-</span>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
              className="cyber-input"
            />
          </div>
        </div>
      </div>

      {/* Entries Table */}
      <div className="cyber-card overflow-hidden">
        <table className="cyber-table w-full">
          <thead>
            <tr>
              <th>เลขที่</th>
              <th>วันที่</th>
              <th>คำอธิบาย</th>
              <th className="text-right">เดบิต</th>
              <th className="text-right">เครดิต</th>
              <th className="text-center">สถานะ</th>
              <th className="text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {filteredEntries.map(entry => (
              <tr
                key={entry.id}
                className="cursor-pointer hover:bg-cyber-dark/30"
                onClick={() => setSelectedEntry(entry)}
              >
                <td className="font-mono text-cyber-primary">{entry.entryNumber}</td>
                <td>{new Date(entry.date).toLocaleDateString('th-TH')}</td>
                <td>
                  <div className="max-w-xs truncate">{entry.description}</div>
                  {entry.referenceType && (
                    <div className="text-xs text-gray-500">{entry.referenceType}</div>
                  )}
                </td>
                <td className="text-right">{entry.totalDebit.toLocaleString()}</td>
                <td className="text-right">{entry.totalCredit.toLocaleString()}</td>
                <td className="text-center">
                  {entry.isPosted ? (
                    <span className="inline-flex items-center gap-1 text-green-400">
                      <Lock className="w-4 h-4" />
                      ยืนยันแล้ว
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-yellow-400">
                      <Unlock className="w-4 h-4" />
                      รอดำเนินการ
                    </span>
                  )}
                </td>
                <td className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {!entry.isPosted && (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handlePost(entry.id)
                          }}
                          className="p-1.5 hover:bg-green-500/20 rounded-lg text-green-400"
                          title="ยืนยัน"
                        >
                          <CheckCircle className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDelete(entry.id, entry.isPosted)
                          }}
                          className="p-1.5 hover:bg-red-500/20 rounded-lg text-red-400"
                          title="ลบ"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredEntries.length === 0 && (
          <div className="text-center py-12">
            <FileText className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400">ไม่พบรายการ</p>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="cyber-card w-full max-w-3xl max-h-[90vh] overflow-auto"
          >
            <div className="p-6 border-b border-cyber-border">
              <h2 className="text-xl font-bold text-white">บันทึกรายการคู่</h2>
            </div>

            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">วันที่</label>
                  <input
                    type="date"
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    className="cyber-input w-full"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">คำอธิบาย</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="cyber-input w-full"
                  required
                />
              </div>

              {/* Journal Lines */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-gray-400">รายละเอียดบัญชี</label>
                  <button
                    type="button"
                    onClick={addLine}
                    className="text-sm text-cyber-primary hover:underline"
                  >
                    + เพิ่มรายการ
                  </button>
                </div>

                <div className="space-y-2">
                  {formData.lines.map((line, index) => (
                    <div key={index} className="grid grid-cols-12 gap-2 p-3 bg-cyber-dark rounded-lg">
                      <div className="col-span-4">
                        <select
                          value={line.accountId}
                          onChange={(e) => updateLine(index, 'accountId', e.target.value)}
                          className="cyber-input w-full text-sm"
                          required
                          disabled={accounts.length === 0}
                        >
                          <option value="">
                            {accounts.length === 0 ? 'กำลังโหลดบัญชี...' : 'เลือกบัญชี'}
                          </option>
                          {/* Group by account type */}
                          {['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].map(type => {
                            const typeAccounts = accounts.filter(a => a.type === type)
                            if (typeAccounts.length === 0) return null
                            return (
                              <optgroup key={type} label={
                                type === 'ASSET' ? 'สินทรัพย์' :
                                  type === 'LIABILITY' ? 'หนี้สิน' :
                                    type === 'EQUITY' ? 'ส่วนของผู้ถือหุ้น' :
                                      type === 'REVENUE' ? 'รายได้' : 'ค่าใช้จ่าย'
                              }>
                                {typeAccounts.map(acc => (
                                  <option key={acc.id} value={acc.id}>
                                    {acc.code} - {acc.name}
                                  </option>
                                ))}
                              </optgroup>
                            )
                          })}
                        </select>
                      </div>
                      <div className="col-span-3">
                        <input
                          type="text"
                          placeholder="รายละเอียด"
                          value={line.description}
                          onChange={(e) => updateLine(index, 'description', e.target.value)}
                          className="cyber-input w-full text-sm"
                        />
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number"
                          placeholder="เดบิต"
                          value={line.debit || ''}
                          onChange={(e) => updateLine(index, 'debit', parseFloat(e.target.value) || 0)}
                          className="cyber-input w-full text-sm"
                        />
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number"
                          placeholder="เครดิต"
                          value={line.credit || ''}
                          onChange={(e) => updateLine(index, 'credit', parseFloat(e.target.value) || 0)}
                          className="cyber-input w-full text-sm"
                        />
                      </div>
                      <div className="col-span-1 flex items-center justify-center">
                        <button
                          type="button"
                          onClick={() => removeLine(index)}
                          className="p-1 hover:bg-red-500/20 rounded text-red-400"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Balance Check */}
                <div className="flex justify-between items-center p-3 bg-cyber-dark/50 rounded-lg">
                  <span className="text-sm text-gray-400">
                    ยอดรวม: เดบิต {formData.lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0).toLocaleString()}
                    {' = '}
                    เครดิต {formData.lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0).toLocaleString()}
                  </span>
                  <span className="text-sm">
                    {Math.abs(
                      formData.lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0) -
                      formData.lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0)
                    ) < 0.01 ? (
                      <span className="text-green-400 flex items-center gap-1">
                        <Calculator className="w-4 h-4" />
                        สมดุล
                      </span>
                    ) : (
                      <span className="text-red-400">ไม่สมดุล</span>
                    )}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">หมายเหตุ</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={2}
                  className="cyber-input w-full"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border border-cyber-border rounded-lg text-gray-300 hover:bg-cyber-dark"
                >
                  ยกเลิก
                </button>
                <button type="submit" className="cyber-btn-primary">
                  บันทึกรายการ
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Detail Modal */}
      {selectedEntry && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="cyber-card w-full max-w-2xl"
          >
            <div className="p-6 border-b border-cyber-border flex justify-between items-start">
              <div>
                <h2 className="text-xl font-bold text-white">
                  {selectedEntry.entryNumber}
                </h2>
                <p className="text-gray-400">
                  {new Date(selectedEntry.date).toLocaleDateString('th-TH')}
                </p>
              </div>
              <button
                onClick={() => setSelectedEntry(null)}
                className="text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-gray-300">{selectedEntry.description}</p>

              <table className="w-full">
                <thead>
                  <tr className="border-b border-cyber-border">
                    <th className="text-left py-2 text-gray-400">บัญชี</th>
                    <th className="text-right py-2 text-gray-400">เดบิต</th>
                    <th className="text-right py-2 text-gray-400">เครดิต</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedEntry.lines?.map((line, idx) => (
                    <tr key={idx} className="border-b border-cyber-border/50">
                      <td className="py-2">
                        <div className="text-white">{line.accountName}</div>
                        <div className="text-xs text-gray-500">{line.accountCode}</div>
                      </td>
                      <td className="text-right">
                        {line.debit > 0 ? line.debit.toLocaleString() : '-'}
                      </td>
                      <td className="text-right">
                        {line.credit > 0 ? line.credit.toLocaleString() : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-bold">
                    <td className="py-2">รวม</td>
                    <td className="text-right">{selectedEntry.totalDebit.toLocaleString()}</td>
                    <td className="text-right">{selectedEntry.totalCredit.toLocaleString()}</td>
                  </tr>
                </tfoot>
              </table>

              {selectedEntry.notes && (
                <div className="pt-4 border-t border-cyber-border">
                  <span className="text-gray-500">หมายเหตุ: </span>
                  <span className="text-gray-300">{selectedEntry.notes}</span>
                </div>
              )}

              {selectedEntry.isPosted && (
                <div className="flex items-center gap-2 text-green-400 pt-4">
                  <CheckCircle className="w-5 h-5" />
                  <span>ยืนยันโดย {selectedEntry.postedBy} เมื่อ {new Date(selectedEntry.postedAt!).toLocaleString('th-TH')}</span>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}

export default JournalEntries
