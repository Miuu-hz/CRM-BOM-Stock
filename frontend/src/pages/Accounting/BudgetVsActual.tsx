import { Fragment, useState, useEffect, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Wallet, Save, RefreshCw, Pencil, Eye, TrendingUp, TrendingDown } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'

interface BudgetRow {
  id: string
  year: number
  month: number
  amount: number
  account_id: string
  account_code: string
  account_name: string
  account_type: 'REVENUE' | 'EXPENSE' | 'COGS'
}

interface MonthVariance {
  month: number
  budget: number
  actual: number
  variance: number
  variancePct: number | null
}

interface AccountVsActual {
  accountId: string
  code: string
  name: string
  type: string
  months: MonthVariance[]
  totalBudget: number
  totalActual: number
  variance: number
  variancePct: number | null
}

interface VsActualData {
  year: number
  accounts: AccountVsActual[]
  monthlyTotals: MonthVariance[]
  typeTotals: { type: string; budget: number; actual: number; variance: number; variancePct: number | null }[]
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)
const TYPE_LABEL: Record<string, string> = { REVENUE: 'รายได้', EXPENSE: 'ค่าใช้จ่าย', COGS: 'ต้นทุนขาย' }

const fmt = (n: number) => (n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function BudgetVsActual() {
  const [year, setYear] = useState(new Date().getFullYear())
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [budgetRows, setBudgetRows] = useState<BudgetRow[]>([])
  const [accounts, setAccounts] = useState<any[]>([])
  const [draft, setDraft] = useState<Record<string, Record<number, number>>>({}) // accountId -> month -> amount

  const [vsActual, setVsActual] = useState<VsActualData | null>(null)
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null)

  const loadEditData = useCallback(async () => {
    setLoading(true)
    try {
      const [accRes, budgetRes] = await Promise.all([
        api.get('/accounts'),
        api.get(`/budgets/${year}`),
      ])
      const budgetableAccounts = (accRes.data.data || []).filter((a: any) =>
        ['REVENUE', 'EXPENSE', 'COGS'].includes(a.type) && a.is_active !== 0
      )
      setAccounts(budgetableAccounts)
      setBudgetRows(budgetRes.data.data || [])

      const nextDraft: Record<string, Record<number, number>> = {}
      for (const a of budgetableAccounts) nextDraft[a.id] = {}
      for (const row of (budgetRes.data.data || []) as BudgetRow[]) {
        if (!nextDraft[row.account_id]) nextDraft[row.account_id] = {}
        nextDraft[row.account_id][row.month] = row.amount
      }
      setDraft(nextDraft)
    } catch {
      toast.error('ไม่สามารถโหลดข้อมูลงบประมาณได้')
    } finally {
      setLoading(false)
    }
  }, [year])

  const loadVsActual = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get(`/budgets/${year}/vs-actual`)
      setVsActual(res.data.data)
    } catch {
      toast.error('ไม่สามารถโหลดข้อมูลเปรียบเทียบได้')
    } finally {
      setLoading(false)
    }
  }, [year])

  useEffect(() => {
    if (mode === 'edit') loadEditData()
    else loadVsActual()
  }, [mode, year, loadEditData, loadVsActual])

  const setAmount = (accountId: string, month: number, value: number) => {
    setDraft((prev) => ({ ...prev, [accountId]: { ...prev[accountId], [month]: value } }))
  }

  const spreadAcrossYear = (accountId: string, annualTotal: number) => {
    const perMonth = Math.round((annualTotal / 12) * 100) / 100
    const months: Record<number, number> = {}
    for (const m of MONTHS) months[m] = perMonth
    setDraft((prev) => ({ ...prev, [accountId]: months }))
  }

  const rowTotal = (accountId: string) =>
    MONTHS.reduce((s, m) => s + (draft[accountId]?.[m] || 0), 0)

  const handleSave = async () => {
    const items: { accountId: string; month: number; amount: number }[] = []
    for (const accountId of Object.keys(draft)) {
      for (const m of MONTHS) {
        const amount = draft[accountId]?.[m]
        if (amount !== undefined && amount !== null) {
          items.push({ accountId, month: m, amount: Number(amount) || 0 })
        }
      }
    }
    if (items.length === 0) {
      toast.error('ไม่มีข้อมูลงบประมาณให้บันทึก')
      return
    }
    setSaving(true)
    try {
      await api.put(`/budgets/${year}`, { items })
      toast.success('บันทึกงบประมาณเรียบร้อยแล้ว')
      await loadEditData()
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'บันทึกงบประมาณไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const grouped = useMemo(() => {
    const groups: Record<string, any[]> = { REVENUE: [], EXPENSE: [], COGS: [] }
    for (const a of accounts) {
      if (groups[a.type]) groups[a.type].push(a)
    }
    return groups
  }, [accounts])

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-1)] flex items-center gap-2">
            <Wallet className="w-6 h-6 text-[var(--primary)]" />
            งบประมาณเทียบผลจริง
          </h1>
          <p className="text-[var(--fg-3)]">ตั้งงบประมาณรายเดือนต่อบัญชี และเปรียบเทียบกับผลจริงที่ผ่านรายการแล้ว</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="phopy-input">
            {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
            <button
              onClick={() => setMode('view')}
              className={`px-3 py-2 text-sm flex items-center gap-1.5 ${mode === 'view' ? 'bg-[var(--primary-soft)] text-[var(--primary)]' : 'text-[var(--fg-3)] hover:bg-[var(--surface-2)]'}`}
            >
              <Eye className="w-4 h-4" /> ดูเปรียบเทียบ
            </button>
            <button
              onClick={() => setMode('edit')}
              className={`px-3 py-2 text-sm flex items-center gap-1.5 ${mode === 'edit' ? 'bg-[var(--primary-soft)] text-[var(--primary)]' : 'text-[var(--fg-3)] hover:bg-[var(--surface-2)]'}`}
            >
              <Pencil className="w-4 h-4" /> ตั้งงบประมาณ
            </button>
          </div>
          <button
            onClick={() => (mode === 'edit' ? loadEditData() : loadVsActual())}
            className="phopy-btn-secondary flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" /> รีเฟรช
          </button>
        </div>
      </div>

      {loading ? (
        <div className="phopy-card p-12 text-center text-[var(--fg-4)]">กำลังโหลด...</div>
      ) : mode === 'edit' ? (
        <div className="phopy-card p-6 space-y-6">
          <div className="flex justify-end">
            <button onClick={handleSave} disabled={saving} className="phopy-btn-primary flex items-center gap-2 disabled:opacity-50">
              <Save className="w-4 h-4" /> {saving ? 'กำลังบันทึก...' : 'บันทึกงบประมาณ'}
            </button>
          </div>

          {(['REVENUE', 'EXPENSE', 'COGS'] as const).map((type) =>
            grouped[type].length === 0 ? null : (
              <div key={type} className="space-y-2">
                <h3 className="text-sm font-semibold text-[var(--fg-2)]">{TYPE_LABEL[type]}</h3>
                <div className="overflow-x-auto">
                  <table className="phopy-table w-full text-sm">
                    <thead>
                      <tr>
                        <th className="text-left">บัญชี</th>
                        {MONTHS.map((m) => <th key={m} className="text-right">{m}</th>)}
                        <th className="text-right">รวมทั้งปี</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {grouped[type].map((a) => (
                        <tr key={a.id}>
                          <td className="whitespace-nowrap">{a.code} {a.name}</td>
                          {MONTHS.map((m) => (
                            <td key={m} className="text-right">
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                value={draft[a.id]?.[m] ?? ''}
                                onChange={(e) => setAmount(a.id, m, parseFloat(e.target.value) || 0)}
                                onFocus={(e) => e.target.select()}
                                className="phopy-input w-24 text-right px-2 py-1 text-xs"
                              />
                            </td>
                          ))}
                          <td className="text-right font-medium">{fmt(rowTotal(a.id))}</td>
                          <td className="text-right">
                            <button
                              type="button"
                              title="ใส่ทั้งปีแล้วเฉลี่ย /12"
                              onClick={() => {
                                const annual = prompt('งบประมาณทั้งปี (บาท)', String(rowTotal(a.id) || 0))
                                if (annual === null) return
                                const n = parseFloat(annual)
                                if (!Number.isFinite(n) || n < 0) return toast.error('จำนวนเงินไม่ถูกต้อง')
                                spreadAcrossYear(a.id, n)
                              }}
                              className="text-xs text-[var(--primary)] hover:underline whitespace-nowrap"
                            >
                              /12
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          )}

          {accounts.length === 0 && (
            <p className="text-center text-[var(--fg-4)] py-8">ไม่พบบัญชีรายได้/ค่าใช้จ่าย/ต้นทุนขายในผังบัญชี</p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {vsActual?.typeTotals && vsActual.typeTotals.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {vsActual.typeTotals.map((t) => (
                <div key={t.type} className="phopy-card p-4">
                  <p className="text-sm text-[var(--fg-3)]">{TYPE_LABEL[t.type] || t.type}</p>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-lg font-bold text-[var(--fg-1)]">{fmt(t.actual)}</span>
                    <span className="text-xs text-[var(--fg-4)]">/ {fmt(t.budget)}</span>
                  </div>
                  <div className={`flex items-center gap-1 text-xs mt-1 ${t.variance >= 0 ? (t.type === 'REVENUE' ? 'text-success' : 'text-danger') : (t.type === 'REVENUE' ? 'text-danger' : 'text-success')}`}>
                    {t.variance >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                    {t.variancePct !== null ? `${t.variancePct > 0 ? '+' : ''}${t.variancePct}%` : '-'}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="phopy-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="phopy-table w-full">
                <thead>
                  <tr>
                    <th className="text-left">บัญชี</th>
                    <th className="text-right">งบทั้งปี</th>
                    <th className="text-right">ผลจริงสะสม</th>
                    <th className="text-right">ผลต่าง</th>
                    <th className="text-right">%ใช้ไป</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(vsActual?.accounts || []).length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-8 text-[var(--fg-4)]">ยังไม่ได้ตั้งงบประมาณสำหรับปีนี้</td></tr>
                  ) : (
                    vsActual!.accounts.map((a) => {
                      const usedPct = a.totalBudget > 0 ? Math.min(100, Math.round((a.totalActual / a.totalBudget) * 100)) : (a.totalActual > 0 ? 100 : 0)
                      const isOver = a.totalBudget > 0 && a.totalActual > a.totalBudget
                      const isExpanded = expandedAccount === a.accountId
                      return (
                        <Fragment key={a.accountId}>
                          <tr>
                            <td>{a.code} {a.name}</td>
                            <td className="text-right">{fmt(a.totalBudget)}</td>
                            <td className="text-right">{fmt(a.totalActual)}</td>
                            <td className={`text-right ${a.variance >= 0 ? (a.type === 'REVENUE' ? 'text-success' : 'text-danger') : (a.type === 'REVENUE' ? 'text-danger' : 'text-success')}`}>
                              {a.variance >= 0 ? '+' : ''}{fmt(a.variance)}
                            </td>
                            <td className="text-right w-40">
                              <div className="flex items-center gap-2 justify-end">
                                <span className="text-xs">{usedPct}%</span>
                                <div className="w-20 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden">
                                  <div
                                    className={`h-full ${isOver ? 'bg-danger' : 'bg-[var(--primary)]'}`}
                                    style={{ width: `${usedPct}%` }}
                                  />
                                </div>
                              </div>
                            </td>
                            <td className="text-right">
                              <button
                                onClick={() => setExpandedAccount(isExpanded ? null : a.accountId)}
                                className="text-xs text-[var(--primary)] hover:underline"
                              >
                                {isExpanded ? 'ซ่อน' : 'รายเดือน'}
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan={6} className="bg-[var(--surface-2)]/40 p-3">
                                <div className="overflow-x-auto">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="text-[var(--fg-4)]">
                                        {MONTHS.map((m) => <th key={m} className="text-right px-2 py-1">{m}</th>)}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      <tr>
                                        {a.months.map((m) => (
                                          <td key={m.month} className="text-right px-2 py-1">
                                            <div>{fmt(m.actual)}</div>
                                            <div className="text-[var(--fg-4)]">/{fmt(m.budget)}</div>
                                          </td>
                                        ))}
                                      </tr>
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  )
}
