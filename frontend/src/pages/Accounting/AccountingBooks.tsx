import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import JournalEntries from './JournalEntries'
import ChartOfAccounts from './ChartOfAccounts'

export default function AccountingBooks() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'chart' ? 'chart' : 'journal'

  const tabs = [
    { key: 'journal', label: t('sidebar.journalEntries') },
    { key: 'chart', label: t('sidebar.chartOfAccounts') },
  ] as const

  return (
    <div className="space-y-6">
      <div className="flex gap-1 border-b border-[var(--border)]" role="tablist">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setParams(key === 'journal' ? {} : { tab: key }, { replace: true })}
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

      {tab === 'chart' ? <ChartOfAccounts /> : <JournalEntries />}
    </div>
  )
}
