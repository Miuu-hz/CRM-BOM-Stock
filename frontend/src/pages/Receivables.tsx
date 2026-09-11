import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import {
  AlertTriangle, ArrowDownCircle, ArrowUpCircle, ChevronDown, ChevronRight,
  Copy, Mail, Phone, RefreshCw, Wallet,
} from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import api from '../services/api'

// ---- Types ----
type Side = 'ar' | 'ap'
type BucketKey = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90plus'

interface Bucket { amount: number; count: number }
interface AgingDoc {
  id: string
  docNumber: string
  docDate: string | null
  dueDate: string | null
  totalAmount: number
  balance: number
  daysOverdue: number | null
  bucket: BucketKey
}
interface AgingParty {
  id: string
  name: string
  email: string | null
  phone: string | null
  total: number
  overdue: number
  oldestDays: number
  buckets: Record<BucketKey, Bucket>
  docs: AgingDoc[]
}
interface Aging {
  asOf: string
  totals: {
    outstanding: number; overdue: number; current: number; overduePercent: number
    docCount: number; overdueCount: number; partyCount: number; oldestDays: number
  }
  buckets: Record<BucketKey, Bucket>
  parties: AgingParty[]
}
interface CollectionPoint {
  month: string; invoiced: number; invoicedCount: number; collected: number; collectedCount: number
}

// ---- Constants ----
// เรียงจาก "ยังไม่ถึงกำหนด" ไป "ค้างนานที่สุด" — ลำดับนี้ใช้ทั้งแถบสีและตาราง
const BUCKET_ORDER: BucketKey[] = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90plus']
const BUCKET_COLOR: Record<BucketKey, string> = {
  current: 'var(--success)',
  d1_30: 'var(--warning)',
  d31_60: 'var(--brand-mango)',
  d61_90: 'var(--danger)',
  d90plus: 'var(--danger-strong)',
}
const COLLECTION_MONTHS = 6

// ---- Helpers ----
const fmtBaht = (n: number) => `฿${Math.round(n).toLocaleString('th-TH')}`
const fmtShort = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(0)}K`
  : `${Math.round(n)}`
const fmtDate = (s: string | null) => (s ? s.slice(0, 10) : '—')

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-[var(--surface-2)] rounded ${className}`} />
}

// ---- Sub-components ----

/** แถบเดียวที่บอกทั้งโครงสร้างอายุหนี้และสัดส่วน — จุดโฟกัสหลักของหน้านี้ */
function AgingBar({ buckets, total, t }: {
  buckets: Record<BucketKey, Bucket>; total: number; t: (k: string) => string
}) {
  if (total <= 0) {
    return <div className="h-3 rounded-full bg-[var(--surface-2)]" />
  }
  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden bg-[var(--surface-2)]">
        {BUCKET_ORDER.map(key => {
          const pct = (buckets[key].amount / total) * 100
          if (pct <= 0) return null
          return (
            <div
              key={key}
              className="h-full transition-all first:rounded-l-full last:rounded-r-full"
              style={{ width: `${pct}%`, background: BUCKET_COLOR[key] }}
              title={`${t(`receivables.bucket.${key}`)} · ${fmtBaht(buckets[key].amount)}`}
            />
          )
        })}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-2 mt-4">
        {BUCKET_ORDER.map(key => (
          <div key={key} className="flex items-start gap-2">
            <span className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: BUCKET_COLOR[key] }} />
            <div className="min-w-0">
              <p className="text-[11px] text-[var(--fg-4)] leading-tight">{t(`receivables.bucket.${key}`)}</p>
              <p className="text-sm font-bold text-[var(--fg-1)] tabular-nums">{fmtBaht(buckets[key].amount)}</p>
              <p className="text-[11px] text-[var(--fg-4)]">{buckets[key].count}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function DocRow({ doc, side, t }: { doc: AgingDoc; side: Side; t: (k: string, o?: any) => string }) {
  const overdue = doc.daysOverdue !== null && doc.daysOverdue > 0
  return (
    <tr className="border-t border-[var(--border-subtle)]">
      <td className="py-2 pl-11 pr-3 font-mono text-xs text-[var(--fg-2)]">{doc.docNumber}</td>
      <td className="py-2 px-3 text-xs text-[var(--fg-3)] tabular-nums">{fmtDate(doc.docDate)}</td>
      <td className="py-2 px-3 text-xs tabular-nums">
        <span className={overdue ? 'text-danger font-semibold' : 'text-[var(--fg-3)]'}>{fmtDate(doc.dueDate)}</span>
      </td>
      <td className="py-2 px-3 text-xs text-right tabular-nums">
        {overdue
          ? <span className="text-danger font-semibold">{t('receivables.daysOverdue', { days: doc.daysOverdue })}</span>
          : <span className="text-[var(--fg-4)]">{t('receivables.notDue')}</span>}
      </td>
      <td className="py-2 pl-3 pr-4 text-sm text-right font-semibold text-[var(--fg-1)] tabular-nums">{fmtBaht(doc.balance)}</td>
      <td className="py-2 pr-4 w-8">
        {side === 'ar' && <span className="sr-only">{t('receivables.arDoc')}</span>}
      </td>
    </tr>
  )
}

function PartyRow({ party, side, maxTotal, expanded, onToggle, onDun, t }: {
  party: AgingParty; side: Side; maxTotal: number; expanded: boolean
  onToggle: () => void; onDun: (p: AgingParty) => void; t: (k: string, o?: any) => string
}) {
  const share = maxTotal > 0 ? (party.total / maxTotal) * 100 : 0
  return (
    <>
      <tr
        className="group cursor-pointer hover:bg-[var(--surface-2)] transition-colors"
        onClick={onToggle}
      >
        <td className="py-3 pl-4 pr-3">
          <div className="flex items-center gap-2">
            {expanded
              ? <ChevronDown className="w-4 h-4 text-[var(--fg-4)] flex-shrink-0" />
              : <ChevronRight className="w-4 h-4 text-[var(--fg-4)] flex-shrink-0 group-hover:text-[var(--primary)] transition-colors" />}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--fg-1)] truncate">{party.name}</p>
              <p className="text-[11px] text-[var(--fg-4)]">{t('receivables.docCount', { count: party.docs.length })}</p>
            </div>
          </div>
        </td>
        <td className="py-3 px-3 hidden md:table-cell">
          <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden max-w-[160px]">
            <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${share}%` }} />
          </div>
        </td>
        <td className="py-3 px-3 text-right tabular-nums">
          {party.oldestDays > 0
            ? <span className="text-xs font-semibold text-danger">{t('receivables.daysOverdue', { days: party.oldestDays })}</span>
            : <span className="text-xs text-[var(--fg-4)]">{t('receivables.notDue')}</span>}
        </td>
        <td className="py-3 px-3 text-right text-sm font-semibold tabular-nums text-danger">
          {party.overdue > 0 ? fmtBaht(party.overdue) : <span className="text-[var(--fg-4)]">—</span>}
        </td>
        <td className="py-3 pl-3 pr-4 text-right text-base font-bold tabular-nums text-[var(--fg-1)]">{fmtBaht(party.total)}</td>
        <td className="py-3 pr-4 text-right">
          {side === 'ar' && party.overdue > 0 && (
            <button
              onClick={e => { e.stopPropagation(); onDun(party) }}
              className="px-2.5 py-1.5 rounded-md text-xs font-semibold bg-[var(--danger-soft)] text-danger hover:bg-danger hover:text-white transition-colors cursor-pointer whitespace-nowrap min-h-[32px]"
            >
              {t('receivables.dun')}
            </button>
          )}
        </td>
      </tr>
      {expanded && party.docs.map(doc => <DocRow key={doc.id} doc={doc} side={side} t={t} />)}
    </>
  )
}

/** ข้อความทวงหนี้ที่พร้อมส่ง — คัดลอก, ส่งอีเมล หรือโทรได้จากที่เดียว */
function DunModal({ party, onClose, t }: {
  party: AgingParty; onClose: () => void; t: (k: string, o?: any) => string
}) {
  const overdueDocs = party.docs.filter(d => (d.daysOverdue ?? 0) > 0)
  const message = useMemo(() => {
    const lines = overdueDocs.map(d =>
      `  • ${d.docNumber}  ครบกำหนด ${fmtDate(d.dueDate)}  ค้าง ${fmtBaht(d.balance)}  (เลยกำหนด ${d.daysOverdue} วัน)`
    )
    return [
      `เรียน ${party.name}`,
      '',
      'ขอเรียนแจ้งยอดค้างชำระตามรายการต่อไปนี้',
      ...lines,
      '',
      `รวมยอดค้างชำระ ${fmtBaht(party.overdue)}`,
      '',
      'รบกวนตรวจสอบและดำเนินการชำระเงินด้วยครับ/ค่ะ หากชำระเรียบร้อยแล้วขออภัยมา ณ ที่นี้',
      'ขอบพระคุณครับ/ค่ะ',
    ].join('\n')
  }, [party, overdueDocs])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message)
      toast.success(t('receivables.copied'))
    } catch {
      toast.error(t('receivables.copyFailed'))
    }
  }

  const subject = t('receivables.dunSubject', { name: party.name })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        className="phopy-card w-full max-w-lg p-5 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="font-bold text-[var(--fg-1)]">{t('receivables.dunTitle')}</h3>
        <p className="text-xs text-[var(--fg-4)] mt-1">
          {party.name} · {t('receivables.overdueAmount')} <span className="text-danger font-semibold">{fmtBaht(party.overdue)}</span>
        </p>

        <textarea
          readOnly
          value={message}
          rows={12}
          className="w-full mt-4 p-3 rounded-lg bg-[var(--surface-sunken)] border border-[var(--border)] text-xs font-mono text-[var(--fg-2)] resize-none"
        />

        <div className="flex flex-wrap gap-2 mt-4">
          <button
            onClick={copy}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--primary)] text-[var(--fg-on-brand)] text-sm font-semibold hover:bg-[var(--primary-hover)] transition-colors cursor-pointer min-h-[36px]"
          >
            <Copy className="w-4 h-4" /> {t('receivables.copy')}
          </button>
          {party.email && (
            <a
              href={`mailto:${party.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border)] text-sm font-medium text-[var(--fg-2)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors min-h-[36px]"
            >
              <Mail className="w-4 h-4" /> {t('receivables.sendEmail')}
            </a>
          )}
          {party.phone && (
            <a
              href={`tel:${party.phone}`}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border)] text-sm font-medium text-[var(--fg-2)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors min-h-[36px]"
            >
              <Phone className="w-4 h-4" /> {party.phone}
            </a>
          )}
          <button
            onClick={onClose}
            className="ml-auto px-3 py-2 rounded-lg text-sm text-[var(--fg-3)] hover:text-[var(--fg-1)] transition-colors cursor-pointer min-h-[36px]"
          >
            {t('receivables.close')}
          </button>
        </div>
        {!party.email && !party.phone && (
          <p className="text-[11px] text-[var(--fg-4)] mt-3">{t('receivables.noContact')}</p>
        )}
      </motion.div>
    </div>
  )
}

// ---- Page ----
export default function Receivables() {
  const { t } = useTranslation()
  const [side, setSide] = useState<Side>('ar')
  const [aging, setAging] = useState<Record<Side, Aging | null>>({ ar: null, ap: null })
  const [collections, setCollections] = useState<CollectionPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [dunParty, setDunParty] = useState<AgingParty | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [ar, ap, col] = await Promise.all([
        api.get('/receivables/ar-aging'),
        api.get('/receivables/ap-aging'),
        api.get(`/receivables/collections?months=${COLLECTION_MONTHS}`),
      ])
      setAging({ ar: ar.data.data, ap: ap.data.data })
      setCollections(col.data.data.series)
    } catch {
      toast.error(t('receivables.loadFailed'))
    }
    setLoading(false)
  }, [t])

  useEffect(() => { load() }, [load])

  const data = aging[side]
  const totals = data?.totals
  const parties = data?.parties ?? []
  const maxTotal = parties[0]?.total ?? 0

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  // สลับ AR/AP แล้วรายการที่กางไว้เป็นคนละชุด จึงยุบทั้งหมดเพื่อไม่ให้ค้าง
  const switchSide = (next: Side) => { setSide(next); setExpanded(new Set()) }

  const chartData = collections.map(p => ({ ...p, label: p.month.slice(2) }))
  const collectionGap = collections.reduce((sum, p) => sum + p.invoiced - p.collected, 0)

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-1)]">{t('receivables.title')}</h1>
          <p className="text-[var(--fg-4)] text-xs mt-1">
            {t('receivables.asOf', { date: data?.asOf ?? '—' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-[var(--surface-2)] border border-[var(--border)] rounded-lg overflow-hidden" role="group">
            {(['ar', 'ap'] as Side[]).map(s => (
              <button
                key={s}
                onClick={() => switchSide(s)}
                aria-pressed={side === s}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs transition-all cursor-pointer min-h-[36px] ${
                  side === s
                    ? 'bg-[var(--primary-soft)] text-[var(--primary)] font-semibold'
                    : 'font-medium text-[var(--fg-3)] hover:text-[var(--fg-2)]'
                }`}
              >
                {s === 'ar' ? <ArrowDownCircle className="w-3.5 h-3.5" /> : <ArrowUpCircle className="w-3.5 h-3.5" />}
                {t(`receivables.${s}`)}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            aria-label={t('receivables.refresh')}
            className="p-2 rounded-lg border border-[var(--border)] text-[var(--fg-3)] hover:text-[var(--primary)] transition-colors cursor-pointer min-h-[36px] min-w-[36px]"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Headline: ยอดค้าง + สัดส่วนที่เลยกำหนด */}
      <div className="phopy-card p-6">
        {loading || !totals ? (
          <div className="space-y-4"><Skeleton className="h-12 w-56" /><Skeleton className="h-3 w-full" /></div>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
              <div>
                <p className="text-xs text-[var(--fg-4)] uppercase tracking-wide">
                  {side === 'ar' ? t('receivables.totalReceivable') : t('receivables.totalPayable')}
                </p>
                <p className="text-4xl font-bold text-[var(--fg-1)] tabular-nums mt-1">{fmtBaht(totals.outstanding)}</p>
                <p className="text-xs text-[var(--fg-4)] mt-1">
                  {t('receivables.docsAcrossParties', { docs: totals.docCount, parties: totals.partyCount })}
                </p>
              </div>
              <div>
                <p className="text-xs text-[var(--fg-4)] uppercase tracking-wide">{t('receivables.overdue')}</p>
                <p className="text-3xl font-bold text-danger tabular-nums mt-1">{fmtBaht(totals.overdue)}</p>
                <p className="text-xs text-danger/70 mt-1">
                  {t('receivables.overdueShare', {
                    percent: totals.overduePercent.toFixed(1),
                    count: totals.overdueCount,
                  })}
                </p>
              </div>
              {totals.oldestDays > 0 && (
                <div>
                  <p className="text-xs text-[var(--fg-4)] uppercase tracking-wide">{t('receivables.oldest')}</p>
                  <p className="text-3xl font-bold text-[var(--fg-2)] tabular-nums mt-1">{totals.oldestDays}</p>
                  <p className="text-xs text-[var(--fg-4)] mt-1">{t('receivables.days')}</p>
                </div>
              )}
            </div>

            {totals.overduePercent >= 50 && (
              <div className="flex items-start gap-2 mt-5 p-3 rounded-lg bg-[var(--danger-soft)] border border-danger/20">
                <AlertTriangle className="w-4 h-4 text-danger flex-shrink-0 mt-0.5" />
                <p className="text-xs text-danger">
                  {t('receivables.overdueWarning', { percent: totals.overduePercent.toFixed(0) })}
                </p>
              </div>
            )}

            <div className="mt-6">
              <AgingBar buckets={data!.buckets} total={totals.outstanding} t={t} />
            </div>
          </>
        )}
      </div>

      {/* วางบิลไปเท่าไร เก็บได้จริงเท่าไร — เฉพาะฝั่งลูกหนี้ */}
      {side === 'ar' && (
        <div className="phopy-card p-5">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <Wallet className="w-4 h-4 text-[var(--primary)]" />
            <h3 className="font-bold text-[var(--fg-1)]">{t('receivables.collectionTitle')}</h3>
            <span className="text-xs text-[var(--fg-4)] ml-auto">
              {t('receivables.collectionGap', { amount: fmtBaht(collectionGap), months: COLLECTION_MONTHS })}
            </span>
          </div>
          {loading ? <Skeleton className="h-48" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: 'var(--fg-3)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--fg-3)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtShort} width={44} />
                <Tooltip
                  formatter={(v: number) => fmtBaht(v)}
                  cursor={{ fill: 'rgba(57,73,229,0.06)' }}
                  contentStyle={{
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 8, fontSize: 12, color: 'var(--fg-1)',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: 'var(--fg-3)' }} />
                <Bar dataKey="invoiced" name={t('receivables.invoiced')} fill="var(--primary)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="collected" name={t('receivables.collected')} fill="var(--success)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {/* ตารางรายคู่ค้า */}
      <div className="phopy-card overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <h3 className="font-bold text-[var(--fg-1)]">
            {side === 'ar' ? t('receivables.byCustomer') : t('receivables.bySupplier')}
          </h3>
        </div>
        {loading ? (
          <div className="p-4 space-y-2">{Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : parties.length === 0 ? (
          <p className="text-[var(--fg-4)] text-sm text-center py-12">{t('receivables.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-[var(--fg-4)] bg-[var(--surface-sunken)]">
                  <th className="py-2 pl-4 pr-3 text-left font-medium">
                    {side === 'ar' ? t('receivables.customer') : t('receivables.supplier')}
                  </th>
                  <th className="py-2 px-3 hidden md:table-cell" />
                  <th className="py-2 px-3 text-right font-medium">{t('receivables.oldest')}</th>
                  <th className="py-2 px-3 text-right font-medium">{t('receivables.overdue')}</th>
                  <th className="py-2 pl-3 pr-4 text-right font-medium">{t('receivables.balance')}</th>
                  <th className="py-2 pr-4" />
                </tr>
              </thead>
              <tbody>
                {parties.map(party => (
                  <PartyRow
                    key={party.id}
                    party={party}
                    side={side}
                    maxTotal={maxTotal}
                    expanded={expanded.has(party.id)}
                    onToggle={() => toggle(party.id)}
                    onDun={setDunParty}
                    t={t}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dunParty && <DunModal party={dunParty} onClose={() => setDunParty(null)} t={t} />}
    </motion.div>
  )
}
