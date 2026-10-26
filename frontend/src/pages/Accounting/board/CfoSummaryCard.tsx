import { TrendingUp, TrendingDown, ShieldCheck, ChevronRight } from 'lucide-react'
import type { CfoSummaryData, CfoKpi } from '../../../services/phopyBoard'

const fmt = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

function CfoKpiCard({ kpi }: { kpi: CfoKpi }) {
  const isBaht = kpi.format === 'baht'
  const displayVal = isBaht ? `${kpi.value < 0 ? '-' : ''}฿${fmt(Math.abs(kpi.value))}` : `${kpi.value.toFixed(1)}%`
  const hasDelta = kpi.deltaPct !== null && kpi.prev !== null
  const up = (kpi.deltaPct ?? 0) >= 0

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex flex-col justify-between gap-2 min-w-0">
      <div>
        <p className="text-xs text-[var(--fg-3)] font-semibold truncate">{kpi.label}</p>
        <p className="text-2xl font-bold text-[var(--fg-1)] mt-1 truncate">{displayVal}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-1 pt-2 border-t border-[var(--border)] text-xs">
        {hasDelta ? (
          <span className={`inline-flex items-center gap-0.5 font-semibold ${up ? 'text-[color:var(--success,#22c55e)]' : 'text-[color:var(--danger)]'}`}>
            {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {up ? '+' : ''}{kpi.deltaPct!.toFixed(1)}%
          </span>
        ) : (
          <span className="text-[var(--fg-4)]">ยังไม่มีข้อมูลเทียบ</span>
        )}
        {kpi.note && (
          <span className="text-[var(--fg-3)] font-medium">{kpi.note}</span>
        )}
      </div>
    </div>
  )
}

interface CfoSummaryCardProps {
  data: CfoSummaryData
  onNavigateChapter: (chapter: number) => void
}

export function CfoSummaryCard({ data, onNavigateChapter }: CfoSummaryCardProps) {
  return (
    <div className="space-y-4">
      {/* Confidence badge */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => onNavigateChapter(6)}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-[var(--surface-2)] text-[var(--fg-1)] border border-[var(--border)] hover:border-[var(--primary)] transition-colors"
          title="คลิกเพื่อไปที่บท 6 ความเสี่ยงและการควบคุม"
        >
          <ShieldCheck className="w-4 h-4 text-[var(--primary)]" />
          <span>ความน่าเชื่อถือข้อมูล {data.confidence.label}</span>
          <ChevronRight className="w-3.5 h-3.5 text-[var(--fg-3)]" />
        </button>
      </div>

      {/* 4 CFO KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {data.kpis.map(kpi => (
          <CfoKpiCard key={kpi.key} kpi={kpi} />
        ))}
      </div>

      {/* SWOT 3 Lists */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* จุดแข็ง */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-bold text-[var(--fg-1)] flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[color:var(--success,#22c55e)]" />
            จุดแข็ง
          </h3>
          {data.strengths.length === 0 ? (
            <p className="text-xs text-[var(--fg-4)]">ไม่มีรายการ</p>
          ) : (
            <ul className="space-y-3">
              {data.strengths.map((item, idx) => (
                <li key={idx} className="text-sm text-[var(--fg-2)]">
                  <p>{item.text}</p>
                  <span className="block text-xs text-[var(--fg-4)] mt-0.5">มาจาก: {item.from}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* จุดที่ต้องระวัง */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-bold text-[var(--fg-1)] flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[color:var(--danger)]" />
            จุดที่ต้องระวัง
          </h3>
          {data.cautions.length === 0 ? (
            <p className="text-xs text-[var(--fg-4)]">ไม่มีรายการ</p>
          ) : (
            <ul className="space-y-3">
              {data.cautions.map((item, idx) => (
                <li key={idx} className="text-sm text-[var(--fg-2)]">
                  <p>{item.text}</p>
                  <span className="block text-xs text-[var(--fg-4)] mt-0.5">มาจาก: {item.from}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ขอให้บอร์ดตัดสินใจ */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-bold text-[var(--fg-1)] flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--primary)]" />
            ขอให้บอร์ดตัดสินใจ
          </h3>
          {data.decisions.length === 0 ? (
            <p className="text-xs text-[var(--fg-4)]">ไม่มีรายการ</p>
          ) : (
            <ul className="space-y-3">
              {data.decisions.map((item, idx) => (
                <li key={idx} className="text-sm text-[var(--fg-2)]">
                  <p>{item.text}</p>
                  <span className="block text-xs text-[var(--fg-4)] mt-0.5">มาจาก: {item.from}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
