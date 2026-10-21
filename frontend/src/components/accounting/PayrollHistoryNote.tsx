import { useEffect, useState } from 'react'
import { AlertTriangle, History } from 'lucide-react'
import { journalApi, type PayrollHistory } from '../../services/accounting'

// ประวัติเงินเดือนรายคนสำหรับฟอร์มบันทึกเงินเดือน — autocomplete ชื่อ + "คนนี้เคยรับไปแล้วเท่าไร"

export const normName = (s: string) => s.trim().replace(/\s+/g, ' ')
const keyOf = (name: string, period: string) => `${normName(name).toLowerCase()}|${period}`
const HISTORY_DEBOUNCE_MS = 400

const fmt = (n: number) => (n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (s: string) => new Date(s).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
export const periodLabel = (p: string) => { const [y, m] = p.split('-'); return `${Number(m)}/${y}` }

// ชื่อที่เคยบันทึก — โหลดครั้งเดียวตอนเปิดฟอร์ม ใช้กับ <datalist> (ponytail: ไม่ต้องมี combobox lib)
export function useEmployeeNames(): string[] {
  const [names, setNames] = useState<string[]>([])
  useEffect(() => {
    journalApi.payrollEmployees()
      .then(r => { if (r.data.success) setNames(r.data.data.map((e: { name: string }) => e.name)) })
      .catch(() => setNames([]))
  }, [])
  return names
}

// ดึงประวัติเฉพาะชื่อที่ยังไม่เคยถามในงวดนี้ หน่วงไว้ให้พิมพ์จบก่อน
export function usePayrollHistory(names: string[], period: string) {
  const [cache, setCache] = useState<Record<string, PayrollHistory>>({})
  const wanted = [...new Set(names.map(normName).filter(Boolean))]
  const missing = wanted.filter(n => !(keyOf(n, period) in cache)).join('\n')

  useEffect(() => {
    if (!missing || !/^\d{4}-\d{2}$/.test(period)) return
    const t = setTimeout(() => {
      for (const name of missing.split('\n')) {
        journalApi.payrollHistory(name, period)
          .then(r => { if (r.data.success) setCache(c => ({ ...c, [keyOf(name, period)]: r.data.data })) })
          .catch(() => { /* ประวัติเป็นตัวช่วย — โหลดไม่ได้ก็ยังบันทึกได้ */ })
      }
    }, HISTORY_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [missing, period])

  return (name: string): PayrollHistory | undefined => cache[keyOf(name, period)]
}

export function PayrollHistoryNote({ history }: { history?: PayrollHistory }) {
  if (!history || history.recent.length === 0) return null
  const dup = history.samePeriod.count > 0
  return (
    <div className={`rounded-md px-2.5 py-1.5 text-xs space-y-0.5 ${dup ? 'bg-[var(--warning-soft)] text-warning' : 'bg-[var(--bg)] text-[var(--fg-3)]'}`}>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
        {dup ? (
          <span className="inline-flex items-center gap-1 font-medium">
            <AlertTriangle className="w-3.5 h-3.5" />
            งวด {periodLabel(history.period ?? '')} จ่ายแล้ว {history.samePeriod.count} ครั้ง สุทธิ ฿{fmt(history.samePeriod.net)}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1"><History className="w-3.5 h-3.5" /> งวดนี้ยังไม่เคยจ่าย</span>
        )}
        <span>ปี {history.year}: {history.yearToDate.count} ครั้ง สุทธิ ฿{fmt(history.yearToDate.net)}</span>
      </p>
      <p className="text-[var(--fg-4)] font-mono">
        {history.recent.map(r => `${fmtDate(r.payDate)} · ${periodLabel(r.period)} · ฿${fmt(r.net)} · ${r.entryNumber}${r.isPosted ? '' : ' (ร่าง)'}`).join('   |   ')}
      </p>
    </div>
  )
}
