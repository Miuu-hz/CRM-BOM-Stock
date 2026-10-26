import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Wallet, ExternalLink } from 'lucide-react'
import { phopyBoardApi } from '../../../services/phopyBoard'

const fmt = (n: number) => (n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

interface AccountVsActual {
  accountId: string
  code: string
  name: string
  type: string
  totalBudget: number
  totalActual: number
  variance: number
  variancePct: number | null
}

interface VsActualData {
  year: number
  accounts: AccountVsActual[]
}

interface BudgetVsActualCardProps {
  endDate: string
}

export function BudgetVsActualCard({ endDate }: BudgetVsActualCardProps) {
  const year = parseInt(endDate.slice(0, 4), 10) || new Date().getFullYear()
  const [hasBudget, setHasBudget] = useState<boolean | null>(null)
  const [vsActual, setVsActual] = useState<VsActualData | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true)
      try {
        const budgetRes = await phopyBoardApi.getBudgets(year)
        const rows = budgetRes.data.data || []
        if (rows.length === 0) {
          if (active) {
            setHasBudget(false)
            setVsActual(null)
          }
        } else {
          if (active) setHasBudget(true)
          const vsRes = await phopyBoardApi.getBudgetVsActual(year)
          if (active) setVsActual(vsRes.data.data)
        }
      } catch (err) {
        console.error('Failed to load budget data:', err)
        if (active) setHasBudget(false)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [year])

  if (loading && hasBudget === null) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-4 border-[var(--primary)]/30 border-t-[var(--primary)] rounded-full animate-spin" />
      </div>
    )
  }

  // Invitation card when empty
  if (hasBudget === false) {
    return (
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-8 text-center space-y-4">
        <div className="w-12 h-12 mx-auto rounded-full bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center">
          <Wallet className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-bold text-[var(--fg-1)]">
            ยังไม่ได้ตั้งงบประมาณ
          </h3>
          <p className="text-sm text-[var(--fg-3)]">
            ยังไม่ได้ตั้งงบประมาณ — ตั้งได้ที่ บัญชี &gt; รายงาน &gt; งบประมาณเทียบจริง
          </p>
        </div>
        <div>
          <Link
            to="/accounting/reports?tab=budget"
            className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--primary)] text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
          >
            <span>ตั้งงบประมาณปี {year}</span>
            <ExternalLink className="w-4 h-4" />
          </Link>
        </div>
      </div>
    )
  }

  // Compact top-variance list
  const topAccounts = vsActual?.accounts
    ? [...vsActual.accounts]
        .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance))
        .slice(0, 10)
    : []

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-[var(--fg-1)]">
            งบประมาณเทียบจริง ปี {year}
          </h3>
          <p className="text-xs text-[var(--fg-3)]">
            รายการที่มีส่วนต่างสูงสุด (Top Variance)
          </p>
        </div>
        <Link
          to="/accounting/reports?tab=budget"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--surface-2)] text-[var(--primary)] hover:border-[var(--primary)] border border-[var(--border)] transition-colors"
        >
          <span>ดูรายงานฉบับเต็ม</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--border)] text-[var(--fg-3)]">
              <th className="py-2 text-left font-semibold">บัญชี</th>
              <th className="py-2 text-right font-semibold">งบประมาณ</th>
              <th className="py-2 text-right font-semibold">ใช้จริง</th>
              <th className="py-2 text-right font-semibold">ผลต่าง (จริง − งบ)</th>
              <th className="py-2 text-right font-semibold">%</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {topAccounts.map(acc => {
              const varColor = acc.variance > 0
                ? acc.type === 'REVENUE' ? 'text-[color:var(--success,#22c55e)]' : 'text-[color:var(--danger)]'
                : acc.type === 'REVENUE' ? 'text-[color:var(--danger)]' : 'text-[color:var(--success,#22c55e)]'
              return (
                <tr key={acc.accountId} className="hover:bg-[var(--surface-2)]">
                  <td className="py-2 font-medium text-[var(--fg-1)]">
                    <span className="text-[var(--fg-3)] font-mono mr-1.5">{acc.code}</span>
                    {acc.name}
                  </td>
                  <td className="py-2 text-right text-[var(--fg-2)]">฿{fmt(acc.totalBudget)}</td>
                  <td className="py-2 text-right text-[var(--fg-1)] font-medium">฿{fmt(acc.totalActual)}</td>
                  <td className={`py-2 text-right font-semibold ${varColor}`}>
                    {acc.variance > 0 ? '+' : ''}฿{fmt(acc.variance)}
                  </td>
                  <td className={`py-2 text-right font-medium ${varColor}`}>
                    {acc.variancePct !== null ? `${acc.variancePct > 0 ? '+' : ''}${acc.variancePct.toFixed(1)}%` : '–'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
