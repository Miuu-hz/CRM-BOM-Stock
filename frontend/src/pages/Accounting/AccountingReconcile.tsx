import { useSearchParams, Link } from 'react-router-dom'
import { Landmark } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useSubscription } from '../../contexts/SubscriptionContext'
import { isMenuLocked } from '../../config/menuPermissions'
import ClearingReconcile from './ClearingReconcile'
import PlatformSettlement from './PlatformSettlement'

export default function AccountingReconcile() {
  const { isMaster } = useAuth()
  const { subscription } = useSubscription()
  const [params, setParams] = useSearchParams()

  const platformLocked = isMenuLocked('/accounting/platform-settlement', subscription?.features, isMaster)

  const tabs: { key: string; label: string }[] = [
    { key: 'clearing', label: 'บัญชีพัก' },
    ...(!platformLocked ? [{ key: 'platform', label: 'แพลตฟอร์ม' }] : []),
    { key: 'bank', label: 'ธนาคาร' },
  ]

  const tabParam = params.get('tab')
  const activeTab = (!platformLocked && tabParam === 'platform')
    ? 'platform'
    : tabParam === 'bank'
    ? 'bank'
    : 'clearing'

  return (
    <div className="space-y-6">
      <div className="flex gap-1 border-b border-[var(--border)]" role="tablist">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            role="tab"
            aria-selected={activeTab === key}
            onClick={() => setParams(key === 'clearing' ? {} : { tab: key }, { replace: true })}
            className={`px-4 py-2 -mb-px text-sm font-semibold border-b-2 transition-colors ${
              activeTab === key
                ? 'border-[var(--primary)] text-[var(--primary)]'
                : 'border-transparent text-[var(--fg-3)] hover:text-[var(--fg-1)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'clearing' && <ClearingReconcile />}
      {activeTab === 'platform' && <PlatformSettlement />}
      {activeTab === 'bank' && (
        <div className="phopy-card p-8 max-w-xl mx-auto text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-[var(--primary-soft)] text-[var(--primary)] flex items-center justify-center mx-auto">
            <Landmark className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-[var(--fg-1)]">กระทบยอดธนาคาร</h2>
          <p className="text-sm text-[var(--fg-3)]">กระทบยอดธนาคารกับ statement ทำในรอบปิดเดือน</p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link
              to="/accounting/period-closing"
              className="phopy-btn-primary px-4 py-2 text-sm inline-flex items-center gap-2"
            >
              รอบปิดงวดบัญชี
            </Link>
            <Link
              to="/settings?tab=bank-accounts"
              className="px-4 py-2 text-sm border border-[var(--border)] rounded-lg text-[var(--fg-2)] hover:text-[var(--fg-1)] hover:border-[var(--primary)] transition-colors inline-flex items-center gap-2"
            >
              ตั้งค่าบัญชีธนาคาร
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
