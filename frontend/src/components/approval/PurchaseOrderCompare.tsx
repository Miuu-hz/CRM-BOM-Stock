import { useEffect, useState } from 'react'
import api from '../../services/api'

// ═══════════════════════════════════════════════════════════════
// ใบสั่งซื้อในโหมดเทียบ — วาดใบเดียว (ฉบับที่จะเป็นหลังอนุมัติ)
// แล้วมาร์กจุดที่ต่างจากของเดิมในตัวเอกสารเลย ผู้บริหารอ่านบนมือถือได้
//
// ฝั่งเก่าเป็นแถวดิบจาก DB (material_id / unit_price) ฝั่งใหม่เป็น body ที่
// หน้าจัดซื้อส่งมา (materialId / unitPrice) — ต้อง normalize ก่อนถึงจะเทียบได้
// ═══════════════════════════════════════════════════════════════

interface Line {
  key: string
  name: string
  unit: string
  qty: number
  price: number
  total: number
}

interface Normalized {
  supplierId: string
  expectedDate: string
  taxRate: number
  notes: string
  lines: Line[]
}

const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const str = (v: any) => (v === undefined || v === null ? '' : String(v))

function lineOf(raw: any, isBefore: boolean): Line {
  const materialId = str(isBefore ? raw.material_id : raw.materialId)
  const price = num(isBefore ? raw.unit_price : raw.unitPrice)
  const qty = num(raw.quantity)
  return {
    key: materialId || str(raw.description) || Math.random().toString(36).slice(2),
    name: str(raw.description) || materialId || '—',
    unit: str(raw.unit),
    qty,
    price,
    total: isBefore && raw.total_price !== undefined ? num(raw.total_price) : qty * price,
  }
}

function normalize(before: any, update: any): { old: Normalized; next: Normalized } {
  const h = before?.header || {}
  return {
    old: {
      supplierId: str(h.supplier_id),
      expectedDate: str(h.expected_date),
      taxRate: num(h.tax_rate),
      notes: str(h.notes),
      lines: (before?.items || []).map((i: any) => lineOf(i, true)),
    },
    next: {
      supplierId: str(update?.supplierId),
      expectedDate: str(update?.expectedDate),
      taxRate: num(update?.taxRate),
      notes: str(update?.notes),
      lines: (update?.items || []).map((i: any) => lineOf(i, false)),
    },
  }
}

const fmtQty = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 4 })
const fmtBaht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (s: string) => {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
}

/** ค่าเดิมขีดฆ่า → ค่าใหม่ตัวหนา บนพื้นเหลืองอ่อน */
function Changed({ from, to }: { from: string; to: string }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-1.5 rounded px-1.5 py-0.5 bg-[var(--warning)]/12">
      <span className="text-[var(--fg-4)] line-through">{from}</span>
      <span className="text-[var(--fg-4)]">→</span>
      <span className="font-bold text-[var(--fg-1)]">{to}</span>
    </span>
  )
}

const ROW_TONE = {
  added: 'bg-[var(--success)]/8',
  removed: 'bg-[var(--danger)]/8 text-[var(--fg-4)] line-through',
  changed: 'bg-[var(--warning)]/8',
  same: '',
} as const

type RowKind = keyof typeof ROW_TONE

export default function PurchaseOrderCompare({
  poNumber, before, update,
}: { poNumber?: string; before: any; update: any }) {
  const { old, next } = normalize(before, update)
  const [supplierNames, setSupplierNames] = useState<Record<string, string>>({})

  const supplierChanged = old.supplierId !== next.supplierId
  useEffect(() => {
    // ponytail: ดึงรายชื่อผู้ขายเฉพาะตอนที่ผู้ขายถูกเปลี่ยนจริง ๆ ส่วนใหญ่ไม่เปลี่ยน
    if (!supplierChanged) return
    api.get('/suppliers')
      .then((r: any) => {
        const map: Record<string, string> = {}
        for (const s of r?.data?.data || []) map[s.id] = s.name
        setSupplierNames(map)
      })
      .catch(() => { /* ไม่มีชื่อก็โชว์ id ไปก่อน ดีกว่าหน้าพัง */ })
  }, [supplierChanged])

  const supplierLabel = (id: string) => supplierNames[id] || id || '—'

  // จับคู่รายการเก่า-ใหม่ด้วย key (material_id ไม่มีค่อยใช้ชื่อ)
  const oldByKey = new Map(old.lines.map(l => [l.key, l]))
  const nextByKey = new Map(next.lines.map(l => [l.key, l]))
  const rows: { kind: RowKind; o?: Line; n?: Line }[] = []
  for (const n of next.lines) {
    const o = oldByKey.get(n.key)
    if (!o) rows.push({ kind: 'added', n })
    else rows.push({ kind: (o.qty !== n.qty || o.price !== n.price) ? 'changed' : 'same', o, n })
  }
  for (const o of old.lines) if (!nextByKey.has(o.key)) rows.push({ kind: 'removed', o })

  const oldSub = old.lines.reduce((s, l) => s + l.total, 0)
  const nextSub = next.lines.reduce((s, l) => s + l.total, 0)
  const oldTotal = oldSub * (1 + old.taxRate / 100)
  const nextTotal = nextSub * (1 + next.taxRate / 100)

  const dateChanged = old.expectedDate !== next.expectedDate
  const notesChanged = old.notes !== next.notes
  const taxChanged = old.taxRate !== next.taxRate
  const lineChanges = rows.filter(r => r.kind !== 'same').length
  const changeCount = lineChanges + [supplierChanged, dateChanged, notesChanged, taxChanged].filter(Boolean).length
  const diffTotal = nextTotal - oldTotal

  if (changeCount === 0) {
    return (
      <div className="border border-[var(--border)] rounded-xl p-4 text-sm text-[var(--fg-3)] text-center">
        ไม่พบความแตกต่างจากเอกสารเดิม
      </div>
    )
  }

  return (
    <div className="border border-[var(--border)] rounded-xl overflow-hidden">
      {/* สรุปบนสุด — ตอบคำถาม "เปลี่ยนอะไรบ้าง" ก่อนต้องอ่านทั้งใบ */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-[var(--warning)]/10 border-b border-[var(--border)]">
        <span className="text-sm font-semibold text-[var(--fg-1)]">
          มี {changeCount} จุดที่เปลี่ยน
        </span>
        {Math.abs(diffTotal) >= 0.01 && (
          <span className={`text-sm font-bold ${diffTotal > 0 ? 'text-[var(--danger)]' : 'text-success'}`}>
            ยอดรวม {diffTotal > 0 ? '+' : '−'}฿{fmtBaht(Math.abs(diffTotal))}
          </span>
        )}
      </div>

      <div className="p-4 space-y-4 bg-[var(--surface-2)]/30">
        <div className="text-center">
          <p className="text-base font-bold text-[var(--fg-1)]">ใบสั่งซื้อ</p>
          {poNumber && <p className="text-sm text-[var(--fg-3)]">{poNumber}</p>}
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div className="flex gap-2">
            <dt className="text-[var(--fg-3)] flex-shrink-0">ผู้ขาย</dt>
            <dd className="text-[var(--fg-1)] min-w-0">
              {supplierChanged
                ? <Changed from={supplierLabel(old.supplierId)} to={supplierLabel(next.supplierId)} />
                : supplierLabel(next.supplierId)}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-[var(--fg-3)] flex-shrink-0">กำหนดส่ง</dt>
            <dd className="text-[var(--fg-1)] min-w-0">
              {dateChanged
                ? <Changed from={fmtDate(old.expectedDate)} to={fmtDate(next.expectedDate)} />
                : fmtDate(next.expectedDate)}
            </dd>
          </div>
        </dl>

        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-sm min-w-[30rem]">
            <thead>
              <tr className="text-xs text-[var(--fg-3)] border-b border-[var(--border)]">
                <th className="text-left font-medium py-1.5">รายการ</th>
                <th className="text-right font-medium py-1.5 w-28">จำนวน</th>
                <th className="text-right font-medium py-1.5 w-28">ราคา/หน่วย</th>
                <th className="text-right font-medium py-1.5 w-28">รวม</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const l = r.n || r.o!
                return (
                  <tr key={i} className={`border-b border-[var(--border)]/60 ${ROW_TONE[r.kind]}`}>
                    <td className="py-1.5 pr-2 text-[var(--fg-1)]">
                      {l.name}
                      {r.kind === 'added' && <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-[var(--success)]/20 text-success no-underline">เพิ่มใหม่</span>}
                      {r.kind === 'removed' && <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-[var(--danger)]/20 text-[var(--danger)] no-underline">ลบออก</span>}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {r.kind === 'changed' && r.o!.qty !== r.n!.qty
                        ? <Changed from={fmtQty(r.o!.qty)} to={fmtQty(r.n!.qty)} />
                        : <>{fmtQty(l.qty)} <span className="text-[var(--fg-4)]">{l.unit}</span></>}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {r.kind === 'changed' && r.o!.price !== r.n!.price
                        ? <Changed from={fmtBaht(r.o!.price)} to={fmtBaht(r.n!.price)} />
                        : fmtBaht(l.price)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-[var(--fg-1)]">{fmtBaht(l.total)}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="py-1.5 text-right text-[var(--fg-3)] text-xs">รวมก่อนภาษี</td>
                <td className="py-1.5 text-right tabular-nums">
                  {Math.abs(oldSub - nextSub) >= 0.01
                    ? <Changed from={fmtBaht(oldSub)} to={fmtBaht(nextSub)} />
                    : fmtBaht(nextSub)}
                </td>
              </tr>
              <tr>
                <td colSpan={3} className="py-1.5 text-right text-[var(--fg-3)] text-xs">
                  ภาษี {taxChanged ? <Changed from={`${old.taxRate}%`} to={`${next.taxRate}%`} /> : `${next.taxRate}%`}
                </td>
                <td className="py-1.5 text-right tabular-nums">{fmtBaht(nextSub * next.taxRate / 100)}</td>
              </tr>
              <tr className="border-t border-[var(--border)]">
                <td colSpan={3} className="py-2 text-right font-semibold text-[var(--fg-1)]">ยอดรวมทั้งสิ้น</td>
                <td className="py-2 text-right tabular-nums font-bold text-[var(--fg-1)]">
                  {Math.abs(oldTotal - nextTotal) >= 0.01
                    ? <Changed from={fmtBaht(oldTotal)} to={fmtBaht(nextTotal)} />
                    : fmtBaht(nextTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {notesChanged && (
          <div className="text-sm">
            <p className="text-[var(--fg-3)] text-xs mb-1">หมายเหตุ</p>
            <Changed from={old.notes || '—'} to={next.notes || '—'} />
          </div>
        )}
      </div>
    </div>
  )
}
