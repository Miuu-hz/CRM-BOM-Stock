import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  BookOpen,
  Building2,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Edit,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react'
import { accountsApi, reportsApi, ACCOUNT_TYPES, Account, AccountType } from '../../services/accounting'
import toast from 'react-hot-toast'

interface TreeNodeProps {
  account: Account & { children?: Account[] }
  level: number
  expandedIds: Set<string>
  onToggle: (id: string) => void
  onView: (account: Account) => void
  onEdit: (account: Account) => void
  onDelete: (account: Account) => void
}

const TreeNode = ({ account, level, expandedIds, onToggle, onView, onEdit, onDelete }: TreeNodeProps) => {
  const hasChildren = account.children && account.children.length > 0
  const isExpanded = expandedIds.has(account.id)
  
  // *-strong tokens keep text >=4.5:1 against their own *-soft background in
  // both themes (see index.css) — plain text-success/text-warning/text-danger
  // read fine on solid surfaces but fail contrast on their own pastel bg.
  const typeColors: Record<AccountType, string> = {
    ASSET:     'text-[var(--success-strong)] border-success/30           bg-[var(--success-soft)]',
    LIABILITY: 'text-[var(--danger-strong)]  border-danger/30            bg-[var(--danger-soft)]',
    EQUITY:    'text-[var(--equity-strong)]  border-[var(--equity)]/30   bg-[var(--equity-soft)]',
    REVENUE:   'text-[var(--primary)]        border-[var(--primary)]/30  bg-[var(--primary-soft)]',
    EXPENSE:   'text-[var(--warning-strong)] border-warning/30           bg-[var(--warning-soft)]',
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
        className={`group flex items-center gap-2 p-3 rounded-lg border ${
          level === 0 ? '' : 'hover:brightness-95'
        } ${typeColors[account.type]} mb-1`}
        style={{ marginLeft: `${level * 24}px` }}
      >
        {hasChildren ? (
          <button
            onClick={() => onToggle(account.id)}
            className="p-1 hover:bg-[var(--surface-2)] rounded"
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
        
        {/* Code/nameEn use explicit fg-3/fg-4 tokens rather than opacity on the
            inherited badge color — opacity on top of an already-tight-contrast
            badge color drops well below 4.5:1 in both themes. Matches the list
            view's treatment of the same fields. */}
        <span className="font-mono text-sm w-20 text-[var(--fg-3)]">{account.code}</span>

        <button
          type="button"
          onClick={() => onView(account)}
          className="flex-1 text-left font-medium hover:underline underline-offset-2 cursor-pointer"
          title="ดูข้อมูลโดยสังเขป"
        >
          {account.name}
        </button>

        {account.nameEn && (
          <span className="text-sm text-[var(--fg-4)] hidden md:block">{account.nameEn}</span>
        )}
        
        <span className={`text-xs px-2 py-1 rounded border ${typeColors[account.type]}`}>
          {ACCOUNT_TYPES.find(t => t.value === account.type)?.label}
        </span>
        
        {account.normalBalance === 'DEBIT' ? (
          <span className="text-xs text-[var(--fg-4)]">Dr</span>
        ) : (
          <span className="text-xs text-[var(--fg-4)]">Cr</span>
        )}
        
        {!account.isSystem && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => onEdit(account)}
              className="p-1.5 hover:bg-[var(--surface-2)] rounded-lg"
            >
              <Edit className="w-4 h-4" />
            </button>
            <button
              onClick={() => onDelete(account)}
              className="p-1.5 hover:bg-[var(--danger-soft)] rounded-lg text-[var(--danger-strong)]"
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
              onView={onView}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface LedgerTransaction {
  date: string
  entryNumber: string
  entryDescription: string
  referenceType?: string
  referenceId?: string
  debit: number
  credit: number
  lineDescription?: string
  balance: number
}

interface LedgerData {
  account: Account
  openingBalance: number
  transactions: LedgerTransaction[]
  closingBalance: number
}

const fmtMoney = (n: number) =>
  (n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Reconstructs month-end balance snapshots from the already-cumulative
// `balance` field on each transaction (server computes running balance from
// openingBalance forward) — avoids a second round of balance queries.
function monthlyTrendFrom(openingBalance: number, transactions: LedgerTransaction[], monthsBack = 6) {
  const today = new Date()
  let idx = 0
  let running = openingBalance
  const trend: { month: string; balance: number }[] = []
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    const isCurrentMonth = i === 0
    const cutoff = isCurrentMonth ? today : new Date(d.getFullYear(), d.getMonth() + 1, 0)
    while (idx < transactions.length && new Date(transactions[idx].date) <= cutoff) {
      running = transactions[idx].balance
      idx++
    }
    trend.push({ month: `${d.getMonth() + 1}/${d.getFullYear()}`, balance: running })
  }
  return trend
}

const LEDGER_TYPE_TEXT: Record<AccountType, string> = {
  ASSET: 'text-[var(--success-strong)]',
  LIABILITY: 'text-[var(--danger-strong)]',
  EQUITY: 'text-[var(--equity-strong)]',
  REVENUE: 'text-[var(--primary)]',
  EXPENSE: 'text-[var(--warning-strong)]',
}

interface AccountLedgerPanelProps {
  accountId: string
  onClose: () => void
}

// Slide-over "what's inside this account" summary: current balance, a 6-month
// trend, and the most recent journal lines — so users don't have to leave
// Chart of Accounts and hunt through Journal Entries to sanity-check a balance.
const AccountLedgerPanel = ({ accountId, onClose }: AccountLedgerPanelProps) => {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<LedgerData | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setData(null)
    const today = new Date()
    const startDate = new Date(today.getFullYear(), today.getMonth() - 5, 1).toISOString().slice(0, 10)
    reportsApi.getLedger(accountId, { startDate })
      .then((res: any) => { if (!cancelled) setData(res.data.data) })
      .catch(() => { if (!cancelled) toast.error('ไม่สามารถโหลดข้อมูลบัญชีได้') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId])

  const trend = data ? monthlyTrendFrom(data.openingBalance, data.transactions) : []
  const recentLines = data
    ? [...data.transactions].slice(-15).reverse().map(t => ({
        ...t,
        impact: data.account.normalBalance === 'DEBIT' ? t.debit - t.credit : t.credit - t.debit,
      }))
    : []

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-[var(--fg-1)]/50"
        onClick={onClose}
      />
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'tween', duration: 0.2 }}
        className="relative w-full max-w-md h-full bg-[var(--surface)] border-l border-[var(--border)] shadow-3 flex flex-col"
      >
        {loading || !data ? (
          <div className="flex-1 flex items-center justify-center">
            <RefreshCw className="w-6 h-6 animate-spin text-[var(--fg-4)]" />
          </div>
        ) : (
          <>
            <div className="p-5 border-b border-[var(--border)] flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-sm text-[var(--fg-3)]">{data.account.code}</p>
                <h3 className="text-lg font-bold text-[var(--fg-1)] truncate">{data.account.name}</h3>
                {data.account.nameEn && <p className="text-sm text-[var(--fg-4)] truncate">{data.account.nameEn}</p>}
              </div>
              <button onClick={onClose} className="p-1.5 hover:bg-[var(--surface-2)] rounded-lg text-[var(--fg-3)] shrink-0">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-5 overflow-y-auto phopy-scrollbar flex-1">
              <div>
                <p className="text-sm text-[var(--fg-3)]">ยอดคงเหลือปัจจุบัน</p>
                <p className={`text-3xl font-bold num ${LEDGER_TYPE_TEXT[data.account.type]}`}>
                  {fmtMoney(data.closingBalance)}
                  <span className="text-sm font-normal text-[var(--fg-4)] ml-2">
                    {data.account.normalBalance === 'DEBIT' ? 'เดบิต' : 'เครดิต'}
                  </span>
                </p>
              </div>

              <div>
                <p className="text-sm text-[var(--fg-3)] mb-2">แนวโน้ม 6 เดือนล่าสุด</p>
                <div className="h-28">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                      <defs>
                        <linearGradient id="ledgerTrendFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--fg-4)' }} axisLine={false} tickLine={false} />
                      <YAxis hide domain={['auto', 'auto']} />
                      <Tooltip
                        formatter={(v: number) => [fmtMoney(v), 'ยอดคงเหลือ']}
                        contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                      />
                      <Area type="monotone" dataKey="balance" stroke="var(--primary)" strokeWidth={2} fill="url(#ledgerTrendFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-[var(--fg-3)]">รายการล่าสุด</p>
                  {data.transactions.length > 0 && (
                    <p className="text-xs text-[var(--fg-4)]">{data.transactions.length} รายการ (6 เดือน)</p>
                  )}
                </div>
                {recentLines.length === 0 ? (
                  <p className="text-sm text-[var(--fg-4)] text-center py-8">ไม่มีรายการในช่วง 6 เดือนที่ผ่านมา</p>
                ) : (
                  <div className="space-y-2">
                    {recentLines.map((t, i) => (
                      <div key={i} className="p-3 rounded-lg bg-[var(--surface-2)] flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-[var(--fg-1)] truncate">{t.lineDescription || t.entryDescription}</p>
                          <p className="text-xs text-[var(--fg-4)]">{t.entryNumber} • {t.date}</p>
                        </div>
                        <p className="text-sm font-semibold shrink-0 num text-[var(--fg-1)]">
                          {t.impact >= 0 ? '+' : '−'}{fmtMoney(Math.abs(t.impact))}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-[var(--border)]">
              <button
                onClick={() => navigate('/accounting/journal-entries')}
                className="phopy-btn-secondary w-full flex items-center justify-center gap-2"
              >
                ดูสมุดรายวันทั้งหมด
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </>
        )}
      </motion.div>
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
  const [viewingAccountId, setViewingAccountId] = useState<string | null>(null)
  
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
      const data = error.response?.data
      const msg = data?.message || 'ลบบัญชีไม่สำเร็จ'
      if (data?.canDeactivate) {
        const yes = confirm(
          `${msg}\n\n` +
          `การปิดใช้งานบัญชี "${account.name}" (${account.code}) จะมีผลดังนี้:\n` +
          `• ไม่สามารถเลือกบัญชีนี้ในรายการบันทึกบัญชีใหม่ได้\n` +
          `• รายการเก่าที่ผ่านมาแล้วจะยังคงแสดงบัญชีนี้ตามเดิม\n` +
          `• สามารถเปิดใช้งานคืนได้ภายหลัง\n\n` +
          `ต้องการปิดใช้งานบัญชีนี้หรือไม่?`
        )
        if (yes) {
          try {
            await accountsApi.update(account.id, { isActive: false })
            toast.success(`ปิดใช้งานบัญชี "${account.name}" แล้ว`)
            fetchAccounts()
          } catch {
            toast.error('ปิดใช้งานบัญชีไม่สำเร็จ')
          }
        }
      } else {
        toast.error(msg)
      }
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
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-phopy-indigo" />
      </div>
    )
  }

  // Empty state - no accounts
  if (accounts.length === 0) {
    return (
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[var(--fg-1)] flex items-center gap-2">
            <BookOpen className="w-8 h-8 text-[var(--primary)]" />
            ผังบัญชี (Chart of Accounts)
          </h1>
          <p className="text-[var(--fg-3)] mt-1">จัดการผังบัญชีตามประมวลบัญชีไทย</p>
        </div>

        <div className="phopy-card p-12 text-center">
          <BookOpen className="w-16 h-16 text-[var(--fg-4)] mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-[var(--fg-2)] mb-2">
            ยังไม่มีผังบัญชี
          </h3>
          <p className="text-[var(--fg-4)] mb-6 max-w-md mx-auto">
            ระบบจะสร้างผังบัญชีมาตรฐานตามประมวลบัญชีไทยให้อัตโนมัติ
          </p>
          <button
            onClick={() => setShowInitConfirm(true)}
            disabled={initializing}
            className="phopy-btn-primary flex items-center gap-2 mx-auto"
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
          <div className="fixed inset-0 bg-[var(--fg-1)]/50 flex items-center justify-center z-50 p-4">
            <div className="phopy-card max-w-md w-full p-6">
              <div className="flex items-center gap-3 mb-4">
                <AlertCircle className="w-8 h-8 text-[var(--warning-strong)]" />
                <h3 className="text-lg font-bold text-[var(--fg-1)]">ยืนยันการสร้างผังบัญชี</h3>
              </div>
              <ul className="space-y-2 text-sm text-[var(--fg-2)] mb-6">
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-[var(--success-strong)]" />
                  บัญชีสินทรัพย์ (1xxxx) - เงินสด ลูกหนี้ สต็อก
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-[var(--danger-strong)]" />
                  บัญชีหนี้สิน (2xxxx) - เจ้าหนี้ เงินกู้
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-[var(--equity-strong)]" />
                  บัญชีส่วนของผู้ถือหุ้น (3xxxx)
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-[var(--primary)]" />
                  บัญชีรายได้ (4xxxx) - รายได้ขาย รายได้อื่น
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-[var(--warning-strong)]" />
                  บัญชีค่าใช้จ่าย (5xxxx) - ต้นทุน ค่าใช้จ่ายดำเนินงาน
                </li>
              </ul>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowInitConfirm(false)}
                  className="px-4 py-2 border border-[var(--border)] rounded-lg text-[var(--fg-2)] hover:bg-[var(--bg)]"
                >
                  ยกเลิก
                </button>
                <button
                  onClick={handleInit}
                  disabled={initializing}
                  className="phopy-btn-primary"
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
          <h1 className="text-2xl font-bold text-[var(--fg-1)] flex items-center gap-2">
            <BookOpen className="w-8 h-8 text-[var(--primary)]" />
            ผังบัญชี (Chart of Accounts)
          </h1>
          <p className="text-[var(--fg-3)] mt-1">
            {accounts.length} บัญชี • ตามประมวลบัญชีไทย
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={() => setViewMode(viewMode === 'tree' ? 'list' : 'tree')}
            className="px-4 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-2)] hover:border-phopy-indigo transition-colors"
          >
            {viewMode === 'tree' ? 'มุมมองรายการ' : 'มุมมองต้นไม้'}
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="phopy-btn-primary flex items-center gap-2"
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
              className={`phopy-card p-4 cursor-pointer transition-all ${
                selectedType === type.value ? 'ring-2 ring-phopy-indigo' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${type.bgColor}`}>
                  {type.value === 'ASSET' && <Wallet className={`w-5 h-5 ${type.color}`} />}
                  {type.value === 'LIABILITY' && <ArrowLeftRight className={`w-5 h-5 ${type.color}`} />}
                  {type.value === 'EQUITY' && <Building2 className={`w-5 h-5 ${type.color}`} />}
                  {type.value === 'REVENUE' && <TrendingUp className={`w-5 h-5 ${type.color}`} />}
                  {type.value === 'EXPENSE' && <TrendingDown className={`w-5 h-5 ${type.color}`} />}
                </div>
                <div>
                  <p className={`text-2xl font-bold ${type.color}`}>{count}</p>
                  <p className="text-xs text-[var(--fg-4)]">{type.label}</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Filters */}
      <div className="phopy-card p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--fg-3)]" />
            <input
              type="text"
              placeholder="ค้นหาบัญชี (รหัส ชื่อ หรือชื่ออังกฤษ)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="phopy-input pl-10 w-full"
            />
          </div>
          
          {viewMode === 'tree' && (
            <div className="flex gap-2">
              <button
                onClick={expandAll}
                className="px-4 py-2 border border-[var(--border)] rounded-lg text-[var(--fg-2)] hover:bg-[var(--bg)]"
              >
                ขยายทั้งหมด
              </button>
              <button
                onClick={collapseAll}
                className="px-4 py-2 border border-[var(--border)] rounded-lg text-[var(--fg-2)] hover:bg-[var(--bg)]"
              >
                ยุบทั้งหมด
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Accounts Tree/List */}
      <div className="phopy-card p-4">
        {viewMode === 'tree' ? (
          <div className="space-y-1">
            {treeData.map(account => (
              <TreeNode
                key={account.id}
                account={account}
                level={0}
                expandedIds={expandedIds}
                onToggle={toggleExpand}
                onView={(acc) => setViewingAccountId(acc.id)}
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
            <table className="phopy-table w-full">
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
                    <td className="font-mono text-[var(--fg-3)]">{account.code}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setViewingAccountId(account.id)}
                          className="text-[var(--fg-1)] hover:underline underline-offset-2 cursor-pointer text-left"
                          title="ดูข้อมูลโดยสังเขป"
                        >
                          {account.name}
                        </button>
                        {account.isSystem && (
                          <span className="text-xs bg-[var(--surface-2)] text-[var(--fg-3)] border border-[var(--border)] px-2 py-0.5 rounded">
                            ระบบ
                          </span>
                        )}
                      </div>
                      {account.nameEn && (
                        <div className="text-sm text-[var(--fg-4)]">{account.nameEn}</div>
                      )}
                    </td>
                    <td>
                      <span className={`text-sm ${ACCOUNT_TYPES.find(t => t.value === account.type)?.color}`}>
                        {ACCOUNT_TYPES.find(t => t.value === account.type)?.label}
                      </span>
                    </td>
                    <td className="text-center">
                      <span className="text-sm text-[var(--fg-3)]">
                        {account.normalBalance === 'DEBIT' ? 'เดบิต' : 'เครดิต'}
                      </span>
                    </td>
                    <td className="text-center">
                      <span className="text-sm text-[var(--fg-4)]">{account.level}</span>
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
                            className="p-1.5 hover:bg-[var(--primary-soft)] rounded-lg"
                          >
                            <Edit className="w-4 h-4 text-[var(--primary)]" />
                          </button>
                          <button
                            onClick={() => handleDelete(account)}
                            className="p-1.5 hover:bg-[var(--danger-soft)] rounded-lg"
                          >
                            <Trash2 className="w-4 h-4 text-[var(--danger-strong)]" />
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
            <Search className="w-12 h-12 text-[var(--fg-4)] mx-auto mb-4" />
            <p className="text-[var(--fg-3)]">ไม่พบบัญชีที่ค้นหา</p>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {(showCreateModal || editingAccount) && (
        <div className="fixed inset-0 bg-[var(--fg-1)]/50 flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="phopy-card w-full max-w-lg max-h-[90vh] overflow-auto"
          >
            <div className="p-6 border-b border-[var(--border)]">
              <h2 className="text-xl font-bold text-[var(--fg-1)]">
                {editingAccount ? 'แก้ไขบัญชี' : 'เพิ่มบัญชีใหม่'}
              </h2>
            </div>
            
            <form onSubmit={editingAccount ? handleUpdate : handleCreate} className="p-6 space-y-4">
              {!editingAccount && (
                <>
                  <div>
                    <label className="block text-sm text-[var(--fg-3)] mb-1">รหัสบัญชี</label>
                    <input
                      type="text"
                      value={formData.code || ''}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                      placeholder="เช่น 1101"
                      className="phopy-input w-full"
                      required
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-[var(--fg-3)] mb-1">ประเภท</label>
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
                        className="phopy-input w-full"
                      >
                        {ACCOUNT_TYPES.map(t => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                    
                    <div>
                      <label className="block text-sm text-[var(--fg-3)] mb-1">ด้านปกติ</label>
                      <select
                        value={formData.normalBalance}
                        onChange={(e) => setFormData({ ...formData, normalBalance: e.target.value as 'DEBIT' | 'CREDIT' })}
                        className="phopy-input w-full"
                      >
                        <option value="DEBIT">เดบิต (Debit)</option>
                        <option value="CREDIT">เครดิต (Credit)</option>
                      </select>
                    </div>
                  </div>
                </>
              )}
              
              <div>
                <label className="block text-sm text-[var(--fg-3)] mb-1">ชื่อบัญชี (ไทย)</label>
                <input
                  type="text"
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="phopy-input w-full"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm text-[var(--fg-3)] mb-1">ชื่อบัญชี (อังกฤษ)</label>
                <input
                  type="text"
                  value={formData.nameEn || ''}
                  onChange={(e) => setFormData({ ...formData, nameEn: e.target.value })}
                  className="phopy-input w-full"
                />
              </div>
              
              <div>
                <label className="block text-sm text-[var(--fg-3)] mb-1">รายละเอียด</label>
                <textarea
                  value={formData.description || ''}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  className="phopy-input w-full"
                />
              </div>
              
              {editingAccount && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isActive"
                    checked={formData.isActive}
                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                    className="w-4 h-4 rounded border-[var(--border)] bg-[var(--bg)]"
                  />
                  <label htmlFor="isActive" className="text-[var(--fg-2)]">ใช้งาน</label>
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
                  className="px-4 py-2 border border-[var(--border)] rounded-lg text-[var(--fg-2)] hover:bg-[var(--bg)]"
                >
                  ยกเลิก
                </button>
                <button type="submit" className="phopy-btn-primary">
                  {editingAccount ? 'บันทึก' : 'สร้าง'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      <AnimatePresence>
        {viewingAccountId && (
          <AccountLedgerPanel
            key={viewingAccountId}
            accountId={viewingAccountId}
            onClose={() => setViewingAccountId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

export default ChartOfAccounts
