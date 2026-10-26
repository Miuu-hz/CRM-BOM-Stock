import { useState, useEffect } from 'react'
import { phopyBoardApi, TrendGrain, TrendResponse } from '../../../services/phopyBoard'
import CandleChart, { TrendPeriod } from '../../../components/charts/CandleChart'

export function formatTrendLabel(p: TrendPeriod): string {
  const key = p.key
  const THAI_MONTHS = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
  const mMatch = key.match(/^(\d{4})-(\d{2})$/)
  if (mMatch) {
    const y = parseInt(mMatch[1], 10), m = parseInt(mMatch[2], 10)
    const beYear2 = String((y + 543) % 100).padStart(2, '0')
    return `${THAI_MONTHS[m]} ${beYear2}`
  }
  const qMatch = key.match(/^(\d{4})-Q([1-4])$/)
  if (qMatch) {
    const y = parseInt(qMatch[1], 10), q = qMatch[2]
    const beYear2 = String((y + 543) % 100).padStart(2, '0')
    return `Q${q}/${beYear2}`
  }
  const yMatch = key.match(/^(\d{4})$/)
  if (yMatch) {
    const y = parseInt(yMatch[1], 10)
    return `${y + 543}`
  }
  return key
}

interface BoardTrendCardProps {
  startDate: string
  endDate: string
  isLongPeriod?: boolean
}

export function BoardTrendCard({ startDate, endDate, isLongPeriod }: BoardTrendCardProps) {
  const [grain, setGrain] = useState<TrendGrain>(isLongPeriod ? 'quarter' : 'month')
  const [data, setData] = useState<TrendResponse | null>(null)
  const [loading, setLoading] = useState(false)

  // ถ้าเปลี่ยนเป็นช่วงไม่ยาว แต่ grain เป็น year ให้ปรับกลับเป็น month
  useEffect(() => {
    if (!isLongPeriod && grain === 'year') {
      setGrain('month')
    }
  }, [isLongPeriod, grain])

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true)
      try {
        // กราฟดูทิศทาง: ช่วงสั้น (เดือน/ไตรมาส/ปี) ใช้ประวัติย้อนหลังตามค่าเริ่มของ backend (12 เดือน / 8 ไตรมาส / 5 ปี)
        // ที่จบที่ endDate — ส่ง from = ต้นงวดจะเหลือแท่งเดียว · ช่วงยาว (3/5 ปี) ใช้ต้นช่วงที่เลือก
        const res = await phopyBoardApi.getTrend(isLongPeriod ? { grain, from: startDate, to: endDate } : { grain, to: endDate })
        if (active) setData(res.data.data)
      } catch (err) {
        console.error('Failed to load trend:', err)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [grain, startDate, endDate, isLongPeriod])

  const grains: Array<{ id: TrendGrain; label: string }> = [
    { id: 'month', label: 'รายเดือน' },
    { id: 'quarter', label: 'รายไตรมาส' },
    ...(isLongPeriod ? [{ id: 'year' as TrendGrain, label: 'รายปี' }] : []),
  ]

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--fg-1)]">
            รายรับ · รายจ่าย · เงินคงเหลือ · ทิศทางระยะยาว
          </h3>
          <p className="text-xs text-[var(--fg-3)]">
            แท่งละ 1 งวด หน่วยเป็นบาทต่อวัน
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5" role="group" aria-label="ขนาดแท่ง">
          {grains.map(g => (
            <button
              key={g.id}
              type="button"
              onClick={() => setGrain(g.id)}
              aria-pressed={grain === g.id}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                grain === g.id
                  ? 'bg-[var(--surface)] text-[var(--primary)] shadow-sm'
                  : 'text-[var(--fg-3)] hover:text-[var(--fg-1)]'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {data?.note && (
        <div className="text-xs text-[color:var(--warning,#f59e0b)] bg-[var(--warning)]/10 border border-[var(--warning,#f59e0b)]/30 rounded-lg px-3 py-2 font-medium">
          {data.note}
        </div>
      )}

      {loading && !data ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-[var(--primary)]/30 border-t-[var(--primary)] rounded-full animate-spin" />
        </div>
      ) : data ? (
        <CandleChart
          periods={data.periods}
          visibleFrom={data.warmup}
          ma={data.ma}
          labelOf={formatTrendLabel}
        />
      ) : null}
    </div>
  )
}
