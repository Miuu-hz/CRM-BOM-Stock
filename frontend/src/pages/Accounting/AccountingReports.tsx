import { useSearchParams } from 'react-router-dom'
import FinancialReports from './FinancialReports'
import BudgetVsActual from './BudgetVsActual'

export default function AccountingReports() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'budget' ? 'budget' : 'financial'

  const tabs = [
    { key: 'financial', label: 'งบการเงิน' },
    { key: 'budget', label: 'งบประมาณเทียบจริง' },
  ] as const

  return (
    <div className="space-y-6">
      <div className="flex gap-1 border-b border-[var(--border)]" role="tablist">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setParams(key === 'financial' ? {} : { tab: key }, { replace: true })}
            className={`px-4 py-2 -mb-px text-sm font-semibold border-b-2 transition-colors ${
              tab === key
                ? 'border-[var(--primary)] text-[var(--primary)]'
                : 'border-transparent text-[var(--fg-3)] hover:text-[var(--fg-1)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'budget' ? <BudgetVsActual /> : <FinancialReports />}
    </div>
  )
}
