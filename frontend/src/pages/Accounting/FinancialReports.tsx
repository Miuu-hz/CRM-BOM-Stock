import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Calculator,
  Calendar,
  DollarSign,
  Download,
  FileText,
  PieChart,
  Scale,
  TrendingUp,
} from 'lucide-react'
import { reportsApi, TrialBalanceReport, BalanceSheetReport, ProfitLossReport } from '../../services/accounting'
import toast from 'react-hot-toast'

type ReportType = 'trial-balance' | 'balance-sheet' | 'profit-loss' | 'cash-flow'

const FinancialReports = () => {
  const [activeReport, setActiveReport] = useState<ReportType>('trial-balance')
  const [loading, setLoading] = useState(false)
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0],
    asOf: new Date().toISOString().split('T')[0],
  })
  
  // Report data
  const [trialBalance, setTrialBalance] = useState<TrialBalanceReport | null>(null)
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetReport | null>(null)
  const [profitLoss, setProfitLoss] = useState<ProfitLossReport | null>(null)

  const fetchReport = async () => {
    try {
      setLoading(true)
      
      switch (activeReport) {
        case 'trial-balance':
          const tbRes = await reportsApi.getTrialBalance({
            startDate: dateRange.start,
            endDate: dateRange.end,
          })
          setTrialBalance(tbRes.data.data)
          break
          
        case 'balance-sheet':
          const bsRes = await reportsApi.getBalanceSheet({
            asOfDate: dateRange.asOf,
          })
          setBalanceSheet(bsRes.data.data)
          break
          
        case 'profit-loss':
          const plRes = await reportsApi.getProfitLoss({
            startDate: dateRange.start,
            endDate: dateRange.end,
          })
          setProfitLoss(plRes.data.data)
          break
      }
    } catch (error) {
      toast.error('ไม่สามารถโหลดรายงานได้')
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const reports = [
    { id: 'trial-balance' as ReportType, label: 'งบทดลอง', icon: Calculator },
    { id: 'balance-sheet' as ReportType, label: 'งบดุล', icon: Scale },
    { id: 'profit-loss' as ReportType, label: 'งบกำไรขาดทุน', icon: TrendingUp },
    { id: 'cash-flow' as ReportType, label: 'งบกระแสเงินสด', icon: DollarSign },
  ]

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <BarChart3 className="w-8 h-8 text-[var(--primary)]" />
          รายงานทางการเงิน (Financial Reports)
        </h1>
        <p className="text-[var(--fg-3)] mt-1">
          งบทดลอง งบดุล งบกำไรขาดทุน และงบกระแสเงินสด
        </p>
      </div>

      {/* Report Type Tabs */}
      <div className="flex flex-wrap gap-2">
        {reports.map(report => {
          const Icon = report.icon
          return (
            <button
              key={report.id}
              onClick={() => setActiveReport(report.id)}
              className={`flex items-center gap-2 px-4 py-3 rounded-lg font-medium transition-all ${
                activeReport === report.id
                  ? 'bg-phopy-indigo text-white'
                  : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--fg-3)] hover:text-[var(--fg-1)]'
              }`}
            >
              <Icon className="w-4 h-4" />
              {report.label}
            </button>
          )
        })}
      </div>

      {/* Date Filters */}
      <div className="phopy-card p-4">
        <div className="flex flex-col md:flex-row gap-4 items-end">
          {activeReport === 'balance-sheet' ? (
            <div>
              <label className="block text-sm text-[var(--fg-3)] mb-1">ณ วันที่</label>
              <input
                type="date"
                value={dateRange.asOf}
                onChange={(e) => setDateRange({ ...dateRange, asOf: e.target.value })}
                className="phopy-input"
              />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm text-[var(--fg-3)] mb-1">ตั้งแต่</label>
                <input
                  type="date"
                  value={dateRange.start}
                  onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                  className="phopy-input"
                />
              </div>
              <div>
                <label className="block text-sm text-[var(--fg-3)] mb-1">ถึง</label>
                <input
                  type="date"
                  value={dateRange.end}
                  onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                  className="phopy-input"
                />
              </div>
            </>
          )}
          
          <button
            onClick={fetchReport}
            disabled={loading}
            className="phopy-btn-primary flex items-center gap-2"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-[var(--fg-1)]/30 border-t-[var(--fg-1)] rounded-full animate-spin" />
            ) : (
              <PieChart className="w-4 h-4" />
            )}
            ดูรายงาน
          </button>
          
          <button
            className="px-4 py-2 border border-[var(--border)] rounded-lg text-[var(--fg-2)] hover:bg-[var(--bg)] flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            ส่งออก
          </button>
        </div>
      </div>

      {/* Report Content */}
      <div className="phopy-card p-6">
        {activeReport === 'trial-balance' && trialBalance && (
          <div>
            <div className="text-center mb-6">
              <h2 className="text-xl font-bold text-white">งบทดลอง (Trial Balance)</h2>
              <p className="text-[var(--fg-3)]">
                ระหว่างวันที่ {new Date(dateRange.start).toLocaleDateString('th-TH')} ถึง {new Date(dateRange.end).toLocaleDateString('th-TH')}
              </p>
            </div>
            
            <div className="overflow-x-auto">
            <table className="phopy-table w-full">
              <thead>
                <tr>
                  <th className="text-left">รหัส</th>
                  <th className="text-left">ชื่อบัญชี</th>
                  <th className="text-right">ยอดยกมา (เดบิต)</th>
                  <th className="text-right">ยอดยกมา (เครดิต)</th>
                  <th className="text-right">เดบิต</th>
                  <th className="text-right">เครดิต</th>
                  <th className="text-right">ยอดคงเหลือ (เดบิต)</th>
                  <th className="text-right">ยอดคงเหลือ (เครดิต)</th>
                </tr>
              </thead>
              <tbody>
                {trialBalance.accounts.map(acc => (
                  <tr key={acc.id}>
                    <td className="font-mono text-[var(--fg-3)]">{acc.code}</td>
                    <td>{acc.name}</td>
                    <td className="text-right">{acc.openingDebit > 0 ? formatCurrency(acc.openingDebit) : '-'}</td>
                    <td className="text-right">{acc.openingCredit > 0 ? formatCurrency(acc.openingCredit) : '-'}</td>
                    <td className="text-right">{acc.debit > 0 ? formatCurrency(acc.debit) : '-'}</td>
                    <td className="text-right">{acc.credit > 0 ? formatCurrency(acc.credit) : '-'}</td>
                    <td className="text-right">{acc.endingDebit > 0 ? formatCurrency(acc.endingDebit) : '-'}</td>
                    <td className="text-right">{acc.endingCredit > 0 ? formatCurrency(acc.endingCredit) : '-'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-phopy-indigo">
                <tr className="font-bold text-[var(--primary)]">
                  <td colSpan={2}>รวม</td>
                  <td className="text-right">{formatCurrency(trialBalance.totals.openingDebit)}</td>
                  <td className="text-right">{formatCurrency(trialBalance.totals.openingCredit)}</td>
                  <td className="text-right">{formatCurrency(trialBalance.totals.debit)}</td>
                  <td className="text-right">{formatCurrency(trialBalance.totals.credit)}</td>
                  <td className="text-right">{formatCurrency(trialBalance.totals.endingDebit)}</td>
                  <td className="text-right">{formatCurrency(trialBalance.totals.endingCredit)}</td>
                </tr>
              </tfoot>
            </table>
            </div>
          </div>
        )}

        {activeReport === 'balance-sheet' && balanceSheet && (
          <div>
            <div className="text-center mb-6">
              <h2 className="text-xl font-bold text-white">งบดุล (Balance Sheet)</h2>
              <p className="text-[var(--fg-3)]">
                ณ วันที่ {new Date(balanceSheet.asOfDate).toLocaleDateString('th-TH')}
              </p>
            </div>
            
            <div className="grid md:grid-cols-2 gap-8">
              {/* Assets */}
              <div>
                <h3 className="text-lg font-bold text-success mb-4 flex items-center gap-2">
                  <ArrowUpRight className="w-5 h-5" />
                  สินทรัพย์
                </h3>
                
                {Object.entries(balanceSheet.assets.grouped).map(([category, items]) => (
                  <div key={category} className="mb-4">
                    <h4 className="text-sm text-[var(--fg-3)] mb-2">{category}</h4>
                    {items.map(item => (
                      <div key={item.id} className="flex justify-between py-1">
                        <span className="text-[var(--fg-2)]">{item.name}</span>
                        <span className="text-[var(--fg-2)]">{formatCurrency(item.balance)}</span>
                      </div>
                    ))}
                  </div>
                ))}
                
                <div className="border-t border-[var(--border)] pt-2 mt-4">
                  <div className="flex justify-between font-bold text-success">
                    <span>รวมสินทรัพย์</span>
                    <span>{formatCurrency(balanceSheet.assets.total)}</span>
                  </div>
                </div>
              </div>
              
              {/* Liabilities & Equity */}
              <div>
                <h3 className="text-lg font-bold text-danger mb-4 flex items-center gap-2">
                  <ArrowDownRight className="w-5 h-5" />
                  หนี้สิน
                </h3>
                
                {Object.entries(balanceSheet.liabilities.grouped).map(([category, items]) => (
                  <div key={category} className="mb-4">
                    <h4 className="text-sm text-[var(--fg-3)] mb-2">{category}</h4>
                    {items.map(item => (
                      <div key={item.id} className="flex justify-between py-1">
                        <span className="text-[var(--fg-2)]">{item.name}</span>
                        <span className="text-[var(--fg-2)]">{formatCurrency(item.balance)}</span>
                      </div>
                    ))}
                  </div>
                ))}
                
                <div className="border-t border-[var(--border)] pt-2">
                  <div className="flex justify-between font-bold text-danger">
                    <span>รวมหนี้สิน</span>
                    <span>{formatCurrency(balanceSheet.liabilities.total)}</span>
                  </div>
                </div>
                
                <h3 className="text-lg font-bold text-purple-400 mt-6 mb-4">
                  ส่วนของผู้ถือหุ้น
                </h3>
                
                {Object.entries(balanceSheet.equity.grouped).map(([category, items]) => (
                  <div key={category} className="mb-4">
                    <h4 className="text-sm text-[var(--fg-3)] mb-2">{category}</h4>
                    {items.map(item => (
                      <div key={item.id} className="flex justify-between py-1">
                        <span className="text-[var(--fg-2)]">{item.name}</span>
                        <span className="text-[var(--fg-2)]">{formatCurrency(item.balance)}</span>
                      </div>
                    ))}
                  </div>
                ))}
                
                <div className="border-t border-[var(--border)] pt-2">
                  <div className="flex justify-between font-bold text-purple-400">
                    <span>รวมส่วนของผู้ถือหุ้น</span>
                    <span>{formatCurrency(balanceSheet.equity.total)}</span>
                  </div>
                </div>
                
                <div className="border-t-2 border-phopy-indigo pt-2 mt-4">
                  <div className="flex justify-between font-bold text-[var(--primary)]">
                    <span>รวมหนี้สินและส่วนของผู้ถือหุ้น</span>
                    <span>{formatCurrency(balanceSheet.totalLiabilitiesAndEquity)}</span>
                  </div>
                </div>
              </div>
            </div>
            
            {!balanceSheet.balanced && (
              <div className="mt-6 p-4 bg-[var(--danger-soft)] border border-danger/50 rounded-lg text-danger text-center">
                <AlertTriangle className="w-4 h-4 inline" /> งบดุลไม่สมดุล! กรุณาตรวจสอบรายการ
              </div>
            )}
          </div>
        )}

        {activeReport === 'profit-loss' && profitLoss && (
          <div>
            <div className="text-center mb-6">
              <h2 className="text-xl font-bold text-white">งบกำไรขาดทุน (Profit & Loss)</h2>
              <p className="text-[var(--fg-3)]">
                ระหว่างวันที่ {new Date(profitLoss.period.startDate).toLocaleDateString('th-TH')} ถึง {new Date(profitLoss.period.endDate).toLocaleDateString('th-TH')}
              </p>
            </div>
            
            {/* Revenue */}
            <div className="mb-6">
              <h3 className="text-lg font-bold text-success mb-2">รายได้</h3>
              {Object.entries(profitLoss.revenue.grouped).map(([category, items]) => (
                <div key={category} className="ml-4">
                  {items.map(item => (
                    <div key={item.id} className="flex justify-between py-1">
                      <span className="text-[var(--fg-2)]">{item.name}</span>
                      <span className="text-[var(--fg-2)]">{formatCurrency(item.balance)}</span>
                    </div>
                  ))}
                </div>
              ))}
              <div className="flex justify-between font-bold text-success border-t border-[var(--border)] pt-2">
                <span>รวมรายได้</span>
                <span>{formatCurrency(profitLoss.revenue.total)}</span>
              </div>
            </div>
            
            {/* COGS */}
            {profitLoss.cogs.total > 0 && (
              <div className="mb-6">
                <h3 className="text-lg font-bold text-warning mb-2">ต้นทุนขาย</h3>
                {profitLoss.cogs.items.map(item => (
                  <div key={item.id} className="flex justify-between py-1 ml-4">
                    <span className="text-[var(--fg-2)]">{item.name}</span>
                    <span className="text-[var(--fg-2)]">{formatCurrency(item.balance)}</span>
                  </div>
                ))}
                <div className="flex justify-between font-bold text-warning border-t border-[var(--border)] pt-2">
                  <span>รวมต้นทุนขาย</span>
                  <span>{formatCurrency(profitLoss.cogs.total)}</span>
                </div>
              </div>
            )}
            
            {/* Gross Profit */}
            <div className="flex justify-between font-bold text-[var(--primary)] border-t-2 border-[var(--border)] pt-2 mb-6">
              <span>กำไรขั้นต้น</span>
              <span>{formatCurrency(profitLoss.grossProfit)}</span>
            </div>
            
            {/* Operating Expenses */}
            <div className="mb-6">
              <h3 className="text-lg font-bold text-danger mb-2">ค่าใช้จ่ายในการดำเนินงาน</h3>
              {Object.entries(profitLoss.operatingExpenses.grouped).map(([category, items]) => (
                <div key={category} className="ml-4 mb-2">
                  <h4 className="text-sm text-[var(--fg-3)]">{category}</h4>
                  {items.map(item => (
                    <div key={item.id} className="flex justify-between py-1">
                      <span className="text-[var(--fg-2)]">{item.name}</span>
                      <span className="text-[var(--fg-2)]">{formatCurrency(item.balance)}</span>
                    </div>
                  ))}
                </div>
              ))}
              <div className="flex justify-between font-bold text-danger border-t border-[var(--border)] pt-2">
                <span>รวมค่าใช้จ่าย</span>
                <span>{formatCurrency(profitLoss.operatingExpenses.total)}</span>
              </div>
            </div>
            
            {/* Operating Profit */}
            <div className="flex justify-between font-bold text-[var(--primary)] border-t-2 border-[var(--border)] pt-2 mb-6">
              <span>กำไรจากการดำเนินงาน</span>
              <span>{formatCurrency(profitLoss.operatingProfit)}</span>
            </div>
            
            {/* Net Profit */}
            <div className="flex justify-between font-bold text-2xl text-[var(--primary)] border-t-2 border-phopy-indigo pt-4">
              <span>กำไรสุทธิ</span>
              <span className={profitLoss.netProfit >= 0 ? 'text-success' : 'text-danger'}>
                {formatCurrency(profitLoss.netProfit)}
              </span>
            </div>
            
            <div className="text-right text-[var(--fg-3)] mt-2">
              อัตรากำไรสุทธิ: {profitLoss.margin}%
            </div>
          </div>
        )}

        {activeReport === 'cash-flow' && (
          <div className="text-center py-12">
            <DollarSign className="w-16 h-16 text-[var(--fg-4)] mx-auto mb-4" />
            <p className="text-[var(--fg-3)]">งบกระแสเงินสด - อยู่ระหว่างพัฒนา</p>
          </div>
        )}

        {!trialBalance && !balanceSheet && !profitLoss && !loading && (
          <div className="text-center py-12">
            <FileText className="w-16 h-16 text-[var(--fg-4)] mx-auto mb-4" />
            <p className="text-[var(--fg-3)] mb-4">เลือกช่วงวันที่และคลิก "ดูรายงาน"</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default FinancialReports
