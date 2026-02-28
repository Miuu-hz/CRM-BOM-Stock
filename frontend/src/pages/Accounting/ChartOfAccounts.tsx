import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  BookOpen,
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  Edit,
  Trash2,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  ArrowLeftRight,
  Building2,
  Wallet,
  TrendingUp,
  TrendingDown,
} from 'lucide-react'
import { accountsApi, ACCOUNT_TYPES, Account, AccountType } from '../../services/accounting'
import toast from 'react-hot-toast'

interface TreeNodeProps {
  account: Account & { children?: Account[] }
  level: number
  expandedIds: Set<string>
  onToggle: (id: string) => void
  onEdit: (account: Account) => void
  onDelete: (account: Account) => void
}

const TreeNode = ({ account, level, expandedIds, onToggle, onEdit, onDelete }: TreeNodeProps) => {
  const hasChildren = account.children && account.children.length > 0
  const isExpanded = expandedIds.has(account.id)
  
  const typeColors: Record<AccountType, string> = {
    ASSET: 'text-green-400 border-green-400/30 bg-green-400/10',
    LIABILITY: 'text-red-400 border-red-400/30 bg-red-400/10',
    EQUITY: 'text-purple-400 border-purple-400/30 bg-purple-400/10',
    REVENUE: 'text-cyan-400 border-cyan-400/30 bg-cyan-400/10',
    EXPENSE: 'text-orange-400 border-orange-400/30 bg-orange-400/10',
  }
  
  const typeIcons: Record<AccountType, any> = {
    ASSET: Wallet,
    LIABILITY: ArrowLeftRight,
    EQUITY: Building2,
    REVENUE: TrendingUp,
    EXPENSE: TrendingDown,
  }
  
  const TypeIcon = typeIcons[account.type]
  
  return (
    <div className="select-none">
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className={`flex items-center gap-2 p-3 rounded-lg border ${
          level === 0 ? 'bg-cyber-dark/50' : 'hover:bg-cyber-dark/30'
        } ${typeColors[account.type]} mb-1`}
        style={{ marginLeft: `${level * 24}px` }}
      >
        {hasChildren ? (
          <button
            onClick={() => onToggle(account.id)}
            className="p-1 hover:bg-white/10 rounded"
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
        ) : (
          <span className="w-6" />
        )}
        
        <TypeIcon className="w-4 h-4" />
        
        <span className="font-mono text-sm w-20 opacity-70">{account.code}</span>
        
        <span className="flex-1 font-medium">{account.name}</span>
        
        {account.nameEn && (
          <span className="text-sm opacity-50 hidden md:block">{account.nameEn}</span>
        )}
        
        <span className={`text-xs px-2 py-1 rounded border ${typeColors[account.type]}`}>
          {ACCOUNT_TYPES.find(t => t.value === account.type)?.label}
        </span>
        
        {account.normalBalance === 'DEBIT' ? (
          <span className="text-xs text-gray-500">Dr</span>
        ) : (
          <span className="text-xs text-gray-500">Cr</span>
        )}
        
        {!account.isSystem && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => onEdit(account)}
              className="p-1.5 hover:bg-white/10 rounded-lg"
            >
              <Edit className="w-4 h-4" />
            </button>
            <button
              onClick={() => onDelete(account)}
              className="p-1.5 hover:bg-red-500/20 rounded-lg text-red-400"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </motion.div>
      
      {hasChildren && isExpanded && (
        <div className="mt-1">
          {account.children!.map(child => (
            <TreeNode
              key={child.id}
              account={child}
              level={level + 1}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}

const ChartOfAccounts = () => {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [treeData, setTreeData] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [initializing, setInitializing] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedType, setSelectedType] = useState<AccountType | 'ALL'>('ALL')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<'tree' | 'list'>('tree')
  
  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showInitConfirm, setShowInitConfirm] = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  
  // Form state
  const [formData, setFormData] = useState<Partial<Account>>({
    type: 'ASSET',
    normalBalance: 'DEBIT',
  })

  const fetchAccounts = async () => {
    try {
      setLoading(true)
      const response = await accountsApi.getAll()
      if (response.data.success) {
        setAccounts(response.data.data.list)
        setTreeData(response.data.data.tree)
        
        // Auto-expand root accounts
        const rootIds = new Set<string>(response.data.data.tree.map((a: Account) => a.id))
        setExpandedIds(rootIds)
      }
    } catch (error: any) {
      if (error.response?.status === 404) {
        setAccounts([])
        setTreeData([])
      } else {
        toast.error('ไม่สามารถโหลดข้อมูลผังบัญชีได้')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAccounts()
  }, [])

  const handleInit = async () => {
    try {
      setInitializing(true)
      const response = await accountsApi.init()
      if (response.data.success) {
        toast.success(`สร้างผังบัญชีสำเร็จ ${response.data.data.created} รายการ`)
        fetchAccounts()
        setShowInitConfirm(false)
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'สร้างผังบัญชีไม่สำเร็จ')
    } finally {
      setInitializing(false)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const response = await accountsApi.create(formData)
      if (response.data.success) {
        toast.success('สร้างบัญชีสำเร็จ')
        setShowCreateModal(false)
        setFormData({ type: 'ASSET', normalBalance: 'DEBIT' })
        fetchAccounts()
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'สร้างบัญชีไม่สำเร็จ')
    }
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingAccount) return
    
    try {
      const response = await accountsApi.update(editingAccount.id, formData)
      if (response.data.success) {
        toast.success('อัปเดตบัญชีสำเร็จ')
        setEditingAccount(null)
        setFormData({ type: 'ASSET', normalBalance: 'DEBIT' })
        fetchAccounts()
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'อัปเดตบัญชีไม่สำเร็จ')
    }
  }

  const handleDelete = async (account: Account) => {
    if (!confirm(`ต้องการลบบัญชี "${account.name}" (${account.code})?`)) return
    
    try {
      const response = await accountsApi.delete(account.id)
      if (response.data.success) {
        toast.success('ลบบัญชีสำเร็จ')
        fetchAccounts()
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'ลบบัญชีไม่สำเร็จ')
    }
  }

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const newSet = new Set(prev)
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
      return newSet
    })
  }

  const expandAll = () => {
    const allIds = new Set(accounts.map(a => a.id))
    setExpandedIds(allIds)
  }

  const collapseAll = () => {
    const rootIds = new Set(treeData.map(a => a.id))
    setExpandedIds(rootIds)
  }

  const filteredAccounts = accounts.filter(account => {
    const matchesSearch = 
      account.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      account.code.includes(searchTerm) ||
      (account.nameEn?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false)
    
    const matchesType = selectedType === 'ALL' || account.type === selectedType
    
    return matchesSearch && matchesType
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyber-primary" />
      </div>
    )
  }

  // Empty state - no accounts
  if (accounts.length === 0) {
    return (
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <BookOpen className="w-8 h-8 text-cyber-primary" />
            ผังบัญชี (Chart of Accounts)
          </h1>
          <p className="text-gray-400 mt-1">จัดการผังบัญชีตามประมวลบัญชีไทย</p>
        </div>
        
        <div className="cyber-card p-12 text-center">
          <BookOpen className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-300 mb-2">
            ยังไม่มีผังบัญชี
          </h3>
          <p className="text-gray-500 mb-6 max-w-md mx-auto">
            ระบบจะสร้างผังบัญชีมาตรฐานตามประมวลบัญชีไทยให้อัตโนมัติ
          </p>
          <button
            onClick={() => setShowInitConfirm(true)}
            disabled={initializing}
            className="cyber-btn-primary flex items-center gap-2 mx-auto"
          >
            {initializing ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : (
              <Plus className="w-5 h-5" />
            )}
            สร้างผังบัญชีมาตรฐาน
          </button>
        </div>
        
        {/* Init Confirmation Modal */}
        {showInitConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="cyber-card max-w-md w-full p-6">
              <div className="flex items-center gap-3 mb-4">
                <AlertCircle className="w-8 h-8 text-yellow-400" />
                <h3 className="text-lg font-bold text-white">ยืนยันการสร้างผังบัญชี</h3>
              </div>
              <ul className="space-y-2 text-sm text-gray-300 mb-6">
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  บัญชีสินทรัพย์ (1xxxx) - เงินสด ลูกหนี้ สต็อก
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-red-400" />
                  บัญชีหนี้สิน (2xxxx) - เจ้าหนี้ เงินกู้
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-purple-400" />
                  บัญชีส่วนของผู้ถือหุ้น (3xxxx)
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-cyan-400" />
                  บัญชีรายได้ (4xxxx) - รายได้ขาย รายได้อื่น
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-orange-400" />
                  บัญชีค่าใช้จ่าย (5xxxx) - ต้นทุน ค่าใช้จ่ายดำเนินงาน
                </li>
              </ul>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowInitConfirm(false)}
                  className="px-4 py-2 border border-cyber-border rounded-lg text-gray-300 hover:bg-cyber-dark"
                >
                  ยกเลิก
                </button>
                <button
                  onClick={handleInit}
                  disabled={initializing}
                  className="cyber-btn-primary"
                >
                  {initializing ? 'กำลังสร้าง...' : 'ยืนยัน'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <BookOpen className="w-8 h-8 text-cyber-primary" />
            ผังบัญชี (Chart of Accounts)
          </h1>
          <p className="text-gray-400 mt-1">
            {accounts.length} บัญชี • ตามประมวลบัญชีไทย
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={() => setViewMode(viewMode === 'tree' ? 'list' : 'tree')}
            className="px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-gray-300 hover:border-cyber-primary transition-colors"
          >
            {viewMode === 'tree' ? 'มุมมองรายการ' : 'มุมมองต้นไม้'}
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="cyber-btn-primary flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            เพิ่มบัญชี
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {ACCOUNT_TYPES.map(type => {
          const count = accounts.filter(a => a.type === type.value).length
          return (
            <div
              key={type.value}
              onClick={() => setSelectedType(selectedType === type.value ? 'ALL' : type.value)}
              className={`cyber-card p-4 cursor-pointer transition-all ${
                selectedType === type.value ? 'ring-2 ring-cyber-primary' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${type.color.replace('text', 'bg').replace('400', '400/20')}`}>
                  {type.value === 'ASSET' && <Wallet className={`w-5 h-5 ${type.color}`} />}
                  {type.value === 'LIABILITY' && <ArrowLeftRight className={`w-5 h-5 ${type.color}`} />}
                  {type.value === 'EQUITY' && <Building2 className={`w-5 h-5 ${type.color}`} />}
                  {type.value === 'REVENUE' && <TrendingUp className={`w-5 h-5 ${type.color}`} />}
                  {type.value === 'EXPENSE' && <TrendingDown className={`w-5 h-5 ${type.color}`} />}
                </div>
                <div>
                  <p className={`text-2xl font-bold ${type.color}`}>{count}</p>
                  <p className="text-xs text-gray-500">{type.label}</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Filters */}
      <div className="cyber-card p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="ค้นหาบัญชี (รหัส ชื่อ หรือชื่ออังกฤษ)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="cyber-input pl-10 w-full"
            />
          </div>
          
          {viewMode === 'tree' && (
            <div className="flex gap-2">
              <button
                onClick={expandAll}
                className="px-4 py-2 border border-cyber-border rounded-lg text-gray-300 hover:bg-cyber-dark"
              >
                ขยายทั้งหมด
              </button>
              <button
                onClick={collapseAll}
                className="px-4 py-2 border border-cyber-border rounded-lg text-gray-300 hover:bg-cyber-dark"
              >
                ยุบทั้งหมด
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Accounts Tree/List */}
      <div className="cyber-card p-4">
        {viewMode === 'tree' ? (
          <div className="space-y-1">
            {treeData.map(account => (
              <TreeNode
                key={account.id}
                account={account}
                level={0}
                expandedIds={expandedIds}
                onToggle={toggleExpand}
                onEdit={(acc) => {
                  setEditingAccount(acc)
                  setFormData({
                    name: acc.name,
                    nameEn: acc.nameEn,
                    description: acc.description,
                    isActive: acc.isActive,
                  })
                }}
                onDelete={handleDelete}
              />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="cyber-table w-full">
              <thead>
                <tr>
                  <th className="text-left">รหัส</th>
                  <th className="text-left">ชื่อบัญชี</th>
                  <th className="text-left">ประเภท</th>
                  <th className="text-center">ด้าน</th>
                  <th className="text-center">ระดับ</th>
                  <th className="text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {filteredAccounts.map(account => (
                  <tr key={account.id} className="group">
                    <td className="font-mono text-gray-400">{account.code}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="text-white">{account.name}</span>
                        {account.isSystem && (
                          <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded">
                            ระบบ
                          </span>
                        )}
                      </div>
                      {account.nameEn && (
                        <div className="text-sm text-gray-500">{account.nameEn}</div>
                      )}
                    </td>
                    <td>
                      <span className={`text-sm ${ACCOUNT_TYPES.find(t => t.value === account.type)?.color}`}>
                        {ACCOUNT_TYPES.find(t => t.value === account.type)?.label}
                      </span>
                    </td>
                    <td className="text-center">
                      <span className="text-sm text-gray-400">
                        {account.normalBalance === 'DEBIT' ? 'เดบิต' : 'เครดิต'}
                      </span>
                    </td>
                    <td className="text-center">
                      <span className="text-sm text-gray-500">{account.level}</span>
                    </td>
                    <td className="text-right">
                      {!account.isSystem && (
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => {
                              setEditingAccount(account)
                              setFormData({
                                name: account.name,
                                nameEn: account.nameEn,
                                description: account.description,
                                isActive: account.isActive,
                              })
                            }}
                            className="p-1.5 hover:bg-cyber-primary/20 rounded-lg"
                          >
                            <Edit className="w-4 h-4 text-cyber-primary" />
                          </button>
                          <button
                            onClick={() => handleDelete(account)}
                            className="p-1.5 hover:bg-red-500/20 rounded-lg"
                          >
                            <Trash2 className="w-4 h-4 text-red-400" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        
        {filteredAccounts.length === 0 && (
          <div className="text-center py-12">
            <Search className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400">ไม่พบบัญชีที่ค้นหา</p>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {(showCreateModal || editingAccount) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="cyber-card w-full max-w-lg max-h-[90vh] overflow-auto"
          >
            <div className="p-6 border-b border-cyber-border">
              <h2 className="text-xl font-bold text-white">
                {editingAccount ? 'แก้ไขบัญชี' : 'เพิ่มบัญชีใหม่'}
              </h2>
            </div>
            
            <form onSubmit={editingAccount ? handleUpdate : handleCreate} className="p-6 space-y-4">
              {!editingAccount && (
                <>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">รหัสบัญชี</label>
                    <input
                      type="text"
                      value={formData.code || ''}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                      placeholder="เช่น 1101"
                      className="cyber-input w-full"
                      required
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">ประเภท</label>
                      <select
                        value={formData.type}
                        onChange={(e) => {
                          const type = e.target.value as AccountType
                          setFormData({
                            ...formData,
                            type,
                            normalBalance: type === 'ASSET' || type === 'EXPENSE' ? 'DEBIT' : 'CREDIT',
                          })
                        }}
                        className="cyber-input w-full"
                      >
                        {ACCOUNT_TYPES.map(t => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                    
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">ด้านปกติ</label>
                      <select
                        value={formData.normalBalance}
                        onChange={(e) => setFormData({ ...formData, normalBalance: e.target.value as 'DEBIT' | 'CREDIT' })}
                        className="cyber-input w-full"
                      >
                        <option value="DEBIT">เดบิต (Debit)</option>
                        <option value="CREDIT">เครดิต (Credit)</option>
                      </select>
                    </div>
                  </div>
                </>
              )}
              
              <div>
                <label className="block text-sm text-gray-400 mb-1">ชื่อบัญชี (ไทย)</label>
                <input
                  type="text"
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="cyber-input w-full"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm text-gray-400 mb-1">ชื่อบัญชี (อังกฤษ)</label>
                <input
                  type="text"
                  value={formData.nameEn || ''}
                  onChange={(e) => setFormData({ ...formData, nameEn: e.target.value })}
                  className="cyber-input w-full"
                />
              </div>
              
              <div>
                <label className="block text-sm text-gray-400 mb-1">รายละเอียด</label>
                <textarea
                  value={formData.description || ''}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  className="cyber-input w-full"
                />
              </div>
              
              {editingAccount && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isActive"
                    checked={formData.isActive}
                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                    className="w-4 h-4 rounded border-cyber-border bg-cyber-dark"
                  />
                  <label htmlFor="isActive" className="text-gray-300">ใช้งาน</label>
                </div>
              )}
              
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false)
                    setEditingAccount(null)
                    setFormData({ type: 'ASSET', normalBalance: 'DEBIT' })
                  }}
                  className="px-4 py-2 border border-cyber-border rounded-lg text-gray-300 hover:bg-cyber-dark"
                >
                  ยกเลิก
                </button>
                <button type="submit" className="cyber-btn-primary">
                  {editingAccount ? 'บันทึก' : 'สร้าง'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  )
}

export default ChartOfAccounts
