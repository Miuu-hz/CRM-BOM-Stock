import { useState } from 'react'
import { motion } from 'framer-motion'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Calendar, Info, X, Scale, Receipt, Wallet, AlertTriangle } from 'lucide-react'
import type { AgingBuckets, AgingDetail, CogsAnalysis, PosSales, CashDrawer, DrawerCategory, EarlyWarning } from '../../services/phopyBoard'

// การ์ดของ Phopy Board ที่ต้องอธิบายที่มาของตัวเลข — ต้นทุนขาย 2 มุม, ยอดขาย POS, เงินสดลิ้นชัก, อายุหนี้, สัญญาณเตือน

const fade = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, delay },
})

const fmt = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const baht = (n: number) => `${n < 0 ? '−' : ''}฿${fmt(Math.abs(n))}`
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}฿${fmt(Math.abs(n))}`

const CARD = 'bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5'
const H2 = 'text-sm font-semibold text-[var(--fg-2)] mb-3 flex items-center gap-2'

function Row({ label, value, sub, strong, tone }: { label: string; value: string; sub?: string; strong?: boolean; tone?: 'danger' | 'success' | 'muted' }) {
  const color = tone === 'danger' ? 'text-[color:var(--danger)]' : tone === 'success' ? 'text-[color:var(--success,#22c55e)]' : tone === 'muted' ? 'text-[var(--fg-3)]' : 'text-[var(--fg-1)]'
  return (
    <div className={`flex items-start justify-between gap-3 py-1.5 ${strong ? 'border-t border-[var(--border)] mt-1 pt-2' : ''}`}>
      <div className="min-w-0">
        <p className={`text-sm ${strong ? 'font-semibold text-[var(--fg-1)]' : 'text-[var(--fg-2)]'}`}>{label}</p>
        {sub && <p className="text-xs text-[var(--fg-4)] leading-snug">{sub}</p>}
      </div>
      <p className={`text-sm tabular-nums flex-none ${strong ? 'font-bold' : 'font-medium'} ${color}`}>{value}</p>
    </div>
  )
}

// ── ต้นทุนขาย 2 มุม ───────────────────────────────────────────────────────

export function CogsAnalysisCard({ a, revenue }: { a: CogsAnalysis; revenue: number }) {
  const pct = (n: number) => revenue > 0 ? `${((n / revenue) * 100).toFixed(1)}% ของรายได้` : ''
  const sysDiff = a.systemStock.diff
  return (
    <motion.div {...fade(0.24)} className={CARD}>
      <h2 className={H2}><Scale className="w-4 h-4 text-[var(--primary)]" /> ต้นทุนขาย 2 มุม — ตามสูตร vs ตามการเปลี่ยนแปลงสต็อก</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="rounded-lg bg-[var(--surface-2)] p-3">
          <p className="text-xs text-[var(--fg-3)]">(ก) ตามสูตร — ตัดสต็อกตอนขาย</p>
          <p className="text-xl font-bold text-[var(--fg-1)] tabular-nums">{baht(a.recipe)}</p>
          <p className="text-xs text-[var(--fg-4)]">{pct(a.recipe)}</p>
        </div>
        <div className="rounded-lg bg-[var(--surface-2)] p-3">
          <p className="text-xs text-[var(--fg-3)]">(ข) ตามสต็อก — ต้นงวด + ซื้อ − ปลายงวด</p>
          <p className="text-xl font-bold text-[var(--fg-1)] tabular-nums">{baht(a.stock.cogs)}</p>
          <p className="text-xs text-[var(--fg-4)]">{pct(a.stock.cogs)}</p>
        </div>
        <div className={`rounded-lg p-3 ${Math.abs(a.variance) >= 1 ? 'bg-[var(--danger-soft)]' : 'bg-[var(--surface-2)]'}`}>
          <p className="text-xs text-[var(--fg-3)]">ส่วนต่าง (ข − ก)</p>
          <p className={`text-xl font-bold tabular-nums ${a.variance > 0 ? 'text-[color:var(--danger)]' : 'text-[var(--fg-1)]'}`}>{signed(a.variance)}</p>
          <p className="text-xs text-[var(--fg-4)]">ของเสีย / สูญหาย / ใช้โดยไม่ผ่านบิล / ซื้อใช้ตรง</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-4">
        <div>
          <p className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wide mb-1">(ข) คิดจากสต็อกในบัญชี</p>
          <Row label="มูลค่าสต็อกต้นงวด" sub="บัญชีหมวดสินค้าคงเหลือ (1106/1107…) ก่อนวันแรกของงวด" value={baht(a.stock.opening)} />
          <Row label="+ ซื้อเข้าสต็อกในงวด" sub="รับของ / ใบแจ้งหนี้ซื้อ หักของไม่นับสต็อกที่ย้ายออก" value={baht(a.stock.purchasesToStock)} />
          <Row label="+ ซื้อแล้วใช้ตรง ไม่ผ่านสต็อก" sub="บรรทัดซื้อ skip_stock ที่ลงต้นทุนวัตถุดิบ 5102" value={baht(a.stock.directPurchase)} />
          <Row label="− มูลค่าสต็อกปลายงวด" sub="บัญชีหมวดสินค้าคงเหลือ ณ วันสุดท้ายของงวด" value={baht(a.stock.closing)} />
          <Row label="= ต้นทุนขายตามสต็อก (ข)" value={baht(a.stock.cogs)} strong />
        </div>
        <div>
          <p className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wide mb-1">ต้นทุนขายในบัญชี (ใช้ใน P&L)</p>
          <Row label="ตามสูตรตอนขาย (ก)" sub="POS_COGS / ต้นทุนขายส่ง หักยกเลิกบิล" value={baht(a.recipe)} />
          <Row label="+ ปรับยอด / นับสต็อก ลงต้นทุน" sub="นับแล้วของหาย เช่น เบิกใช้ไม่ได้บันทึก → บัญชี 5101/5102" value={baht(a.stockAdjust)} />
          <Row label="+ ซื้อแล้วใช้ตรง" value={baht(a.directPurchase)} />
          <Row label="= ต้นทุนขายในบัญชี" value={baht(a.ledger)} strong />
          {Math.abs(a.notInLedgerCogs) >= 1 && (
            <Row label="ต่างจาก (ข)" tone="muted" value={signed(a.notInLedgerCogs)}
              sub="ปรับเพิ่มสต็อกที่ลงบัญชีอื่น (5902 ปรับปรุงสต็อก / 2102 เจ้าหนี้อื่น) จึงไม่ได้ลดต้นทุนขาย" />
          )}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-[var(--border)] p-3 text-xs text-[var(--fg-2)] leading-relaxed space-y-1.5">
        <p className="font-semibold text-[var(--fg-1)]">มูลค่าสต็อกถูกเอามาหักจากการขายไหม?</p>
        <p>
          หักเฉพาะส่วนที่ "ถูกใช้ไปแล้ว" เท่านั้น: ตามสูตรตอนขาย {baht(a.recipe)} + ส่วนที่นับสต็อกแล้วพบว่าหาย/ใช้ไป {baht(a.varianceCount)} (สุทธิ)
          {' '}ส่วนสต็อกที่ยังเหลือ {baht(a.stock.closing)} เป็น <b>สินทรัพย์</b> ไม่ใช่ต้นทุน — ถ้าของจริงบนชั้นน้อยกว่านี้ ส่วนที่ขาดคือต้นทุนที่ยังไม่ได้รับรู้ กำไรจะสูงเกินจริงเท่านั้นจนกว่าจะนับสต็อกแล้วปรับยอด
        </p>
        {a.systemStock.value !== null && sysDiff !== null && (
          <p className={Math.abs(sysDiff) >= 100 ? 'text-[color:var(--danger)]' : ''}>
            มูลค่าสต็อกตามจำนวนในระบบตอนนี้ {baht(a.systemStock.value)} {Math.abs(sysDiff) < 1 ? 'ตรงกับบัญชี' : `${sysDiff > 0 ? 'สูงกว่า' : 'ต่ำกว่า'}บัญชี ${baht(Math.abs(sysDiff))}`}
            {Math.abs(sysDiff) >= 100 && ' — จำนวน/ราคาทุนในระบบกับบัญชีไม่ตรงกัน ควรนับสต็อกจริงทั้งร้านแล้วปรับยอด ตัวเลข (ข) จะแม่นเท่ากับการนับครั้งล่าสุด'}
          </p>
        )}
      </div>
    </motion.div>
  )
}

// ── ยอดขาย POS ────────────────────────────────────────────────────────────

export function PosSalesCard({ p }: { p: PosSales }) {
  const max = Math.max(1, ...p.byMethod.map(m => m.amount))
  return (
    <motion.div {...fade(0.26)} className={CARD}>
      <h2 className={H2}><Receipt className="w-4 h-4 text-[var(--primary)]" /> รายได้จากการขาย POS (หน้าร้าน)</h2>
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[['ยอดขาย POS', baht(p.revenue)], ['จำนวนบิล', fmt(p.bills)], ['เฉลี่ย/บิล', baht(p.avgBill)]].map(([l, v]) => (
          <div key={l}>
            <p className="text-xs text-[var(--fg-3)]">{l}</p>
            <p className="text-lg font-bold text-[var(--fg-1)] tabular-nums">{v}</p>
          </div>
        ))}
      </div>
      {p.byMethod.length > 0 && (
        <div className="space-y-2 mb-4">
          {p.byMethod.map(m => (
            <div key={m.method}>
              <div className="flex justify-between text-xs text-[var(--fg-2)] mb-0.5">
                <span>{m.label} · {m.count} รายการ</span><span className="tabular-nums">{baht(m.amount)}</span>
              </div>
              <div className="h-1.5 bg-[var(--surface-2)] rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${(m.amount / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wide mb-1">กระทบยอดกับบัญชี</p>
      <Row label="บิลชำระแล้ว (POS)" value={baht(p.revenue)} sub={p.discount > 0 ? `หลังส่วนลด ${baht(p.discount)}` : undefined} />
      <Row label="ขาย POS ในบัญชี (POS_SALE)" value={baht(p.ledger.sales)} />
      {p.ledger.cancels !== 0 && <Row label="ยกเลิกบิลที่ลงบัญชีแล้ว (POS_CANCEL)" value={signed(p.ledger.cancels)} sub="รวมบิลงวดก่อนที่มายกเลิกในงวดนี้" />}
      {p.ledger.other !== 0 && <Row label="รายได้หน้าร้านอื่น" value={signed(p.ledger.other)} />}
      <Row label="รายได้หน้าร้านในบัญชี" value={baht(p.ledger.net)} strong />
      <Row label="ผลต่าง (บัญชี − บิล)" value={Math.abs(p.diff) < 0.01 ? 'ตรงกัน' : signed(p.diff)} tone={Math.abs(p.diff) < 0.01 ? 'success' : 'danger'} />
      {p.cancelled.bills > 0 && (
        <p className="mt-2 text-xs text-[color:var(--warning,#f59e0b)] flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 flex-none mt-0.5" />
          บิลถูกยกเลิก {p.cancelled.bills} ใบ มูลค่า {baht(p.cancelled.amount)} ในงวดนี้ — ตรวจว่ายกเลิกถูกต้อง (ไม่นับเป็นรายได้)
        </p>
      )}
    </motion.div>
  )
}

// ── เงินสดลิ้นชัก ─────────────────────────────────────────────────────────

const DRAWER_LABELS: Record<DrawerCategory, string> = {
  EXPENSE: 'จ่ายเป็นค่าใช้จ่าย', PURCHASE: 'ซื้อของ (รอจับคู่บิลซื้อ)', OWNER: 'เจ้าของถอน', CASH_IN: 'เงินเข้าลิ้นชัก', OTHER: 'อื่นๆ',
}

export function CashDrawerCard({ d }: { d: CashDrawer }) {
  const cats = (Object.keys(DRAWER_LABELS) as DrawerCategory[]).filter(k => d.totals[k] !== 0)
  const gapTotal = d.untrackedGaps.reduce((s, g) => s + g.amount, 0)
  return (
    <motion.div {...fade(0.28)} className={CARD}>
      <h2 className={H2}><Wallet className="w-4 h-4 text-[var(--primary)]" /> เงินสดที่ออกจากลิ้นชัก และเงินขาด/เกิน</h2>
      {cats.length === 0 && d.untrackedGaps.length === 0 && <p className="text-sm text-[var(--fg-4)] py-2">ไม่มีเงินออกจากลิ้นชักในงวดนี้</p>}
      {cats.map(k => <Row key={k} label={DRAWER_LABELS[k]} value={baht(d.totals[k])} />)}
      {d.unposted.count > 0 && (
        <Row label={`ยังไม่ลงบัญชี ${d.unposted.count} รายการ`} tone="danger" value={baht(d.unposted.amount)}
          sub="มีใน POS แต่ journal ยังไม่ post — ยังไม่อยู่ในค่าใช้จ่าย/กำไร ไปยืนยันที่สมุดรายวัน" />
      )}
      {d.untrackedGaps.length > 0 && (
        <Row label="เงินหายระหว่างกะ (ไม่มีบันทึก)" tone="danger" value={baht(gapTotal)}
          sub={d.untrackedGaps.map(g => `${g.previousShift} ปิด → ${g.shiftNumber} เปิด ${signed(-g.amount)}`).join(' · ') + ' — ยอดนับตอนปิดกะไม่เท่าเงินตั้งต้นกะถัดไป (เจ้าของหยิบ/นำฝาก/หาย)'} />
      )}
      <p className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wide mt-3 mb-1">เงินขาด/เกินจากการนับเงินปิดกะ</p>
      <Row label="เงินเกิน" value={signed(d.overShort.over)} tone={d.overShort.over > 0 ? 'success' : 'muted'} />
      <Row label="เงินขาด" value={signed(d.overShort.short)} tone={d.overShort.short < 0 ? 'danger' : 'muted'} />
      <Row label="สุทธิ (บัญชี 5901 เงินขาด/เงินเกิน)" value={signed(d.overShort.ledger)} strong
        sub={Math.abs(d.overShort.ledger - d.overShort.net) >= 0.01 ? `ตามกะ ${signed(d.overShort.net)} ไม่ตรงบัญชี` : 'เงินเกิน = รายได้อื่น ทำให้ช่อง "ปรับปรุง" ของหน้าร้านติดลบ'} />
      {d.movements.length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-[var(--primary)] font-medium">ดูรายการ ({d.movements.length})</summary>
          <ul className="mt-2 space-y-1">
            {d.movements.map((m, i) => (
              <li key={i} className="flex justify-between gap-2 text-[var(--fg-2)]">
                <span className="truncate">{m.date.substring(0, 10)} · {m.shiftNumber} · {m.reason || m.type} <span className="text-[var(--fg-4)]">({m.accountCode} {m.accountName}){!m.posted && ' · ยังไม่ลงบัญชี'}</span></span>
                <span className="tabular-nums flex-none">{baht(m.amount)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </motion.div>
  )
}

// ── อายุหนี้ ──────────────────────────────────────────────────────────────

const AGING_KEYS: Array<[keyof AgingBuckets, string, string]> = [
  ['current', '0-30 วัน', '#22c55e'], ['days30', '31-60 วัน', '#6366f1'], ['days60', '61-90 วัน', '#f59e0b'],
  ['days90', '91-120 วัน', '#f97316'], ['over90', '120+ วัน', '#ef4444'],
]

export function AgingCard({ title, source, detail, ledgerLabels }: { title: string; source: string; detail: AgingDetail; ledgerLabels: Record<string, string> }) {
  const b = detail.buckets
  const chartData = [Object.fromEntries(AGING_KEYS.map(([k]) => [k, b[k]]))]
  const visible = AGING_KEYS.filter(([k]) => b[k] > 0)
  return (
    <motion.div {...fade(0.35)} className={CARD}>
      <h2 className="text-sm font-semibold text-[var(--fg-2)] mb-1 flex items-center gap-2">
        <Calendar className="w-4 h-4 text-[var(--primary)]" /> {title}
      </h2>
      <p className="text-xs text-[var(--fg-3)] mb-3">
        ค้าง {baht(detail.total)} · {detail.count} ใบ{detail.overdue > 0 && <span className="text-[color:var(--danger)]"> · เกินกำหนด {baht(detail.overdue)}</span>} · {source}
      </p>
      {detail.total > 0 ? (
        <ResponsiveContainer width="100%" height={56}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <XAxis type="number" hide domain={[0, detail.total]} />
            <YAxis type="category" hide />
            <Tooltip formatter={(v: number, k: string) => [baht(v), AGING_KEYS.find(x => x[0] === k)?.[1] || k]} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }} />
            {/* สีของแต่ละช่องผูกกับ key ของช่องนั้นโดยตรง — ตรงกับ legend ด้านล่างเสมอ */}
            {visible.map(([k, , color], i) => (
              <Bar key={k} dataKey={k} stackId="a" fill={color} isAnimationActive={false}
                radius={visible.length === 1 ? [4, 4, 4, 4] : i === 0 ? [4, 0, 0, 4] : i === visible.length - 1 ? [0, 4, 4, 0] : [0, 0, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-sm text-[color:var(--success,#22c55e)] py-3">ไม่มียอดค้าง</p>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {AGING_KEYS.map(([k, label, color]) => (
          <span key={k} className={`flex items-center gap-1 text-xs ${b[k] > 0 ? 'text-[var(--fg-2)] font-medium' : 'text-[var(--fg-4)]'}`}>
            <span className="w-2 h-2 rounded-full flex-none" style={{ background: color }} />{label} {b[k] > 0 && baht(b[k])}
          </span>
        ))}
      </div>
      <div className="mt-3 pt-2 border-t border-[var(--border)]">
        {Object.entries(ledgerLabels).map(([k, label]) => (
          <div key={k} className="flex justify-between text-xs text-[var(--fg-3)] py-0.5">
            <span>{label}</span><span className="tabular-nums">{baht(detail.ledger[k] || 0)}</span>
          </div>
        ))}
      </div>
    </motion.div>
  )
}

// ── สัญญาณเตือน (พลิกการ์ดดูคำอธิบาย) ──────────────────────────────────────

const STATUS_TEXT = { ok: 'text-[color:var(--success,#22c55e)]', warn: 'text-[color:var(--warning,#f59e0b)]', danger: 'text-[color:var(--danger)]' }
const STATUS_BOX = { ok: 'border-[var(--border)] bg-[var(--surface-2)]', warn: 'border-[var(--warning)]/30 bg-[var(--warning)]/5', danger: 'border-[var(--danger)]/30 bg-[var(--danger-soft)]' }
const STATUS_DOT = { ok: 'bg-[color:var(--success,#22c55e)]', warn: 'bg-[color:var(--warning,#f59e0b)]', danger: 'bg-[color:var(--danger)]' }

export function WarningCard({ w }: { w: EarlyWarning }) {
  const [flipped, setFlipped] = useState(false)
  return (
    <div className={`relative rounded-xl p-4 border ${STATUS_BOX[w.status]}`}>
      <button type="button" onClick={() => setFlipped(f => !f)} aria-expanded={flipped} aria-label={flipped ? 'ปิดคำอธิบาย' : `คำอธิบาย ${w.label}`}
        className="absolute top-2 right-2 p-1 rounded-md text-[var(--fg-3)] hover:text-[var(--primary)] hover:bg-[var(--surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)]">
        {flipped ? <X className="w-3.5 h-3.5" /> : <Info className="w-3.5 h-3.5" />}
      </button>
      {!flipped ? (
        <>
          <div className="flex items-center gap-2 mb-2 pr-5">
            <span className={`inline-block w-2.5 h-2.5 rounded-full flex-none ${STATUS_DOT[w.status]}`} />
            <p className="text-xs font-semibold text-[var(--fg-2)] leading-tight">{w.label}</p>
          </div>
          <p className={`text-lg font-bold ${STATUS_TEXT[w.status]}`}>{w.value}</p>
          <p className="text-xs text-[var(--fg-4)] mt-1 leading-tight">{w.detail}</p>
        </>
      ) : (
        <div className="text-xs text-[var(--fg-2)] space-y-1.5 pr-4 leading-snug">
          <p><b>คืออะไร:</b> {w.hint.what}</p>
          <p><b>คำนวณ:</b> {w.hint.calc}</p>
          <p><b>เกณฑ์:</b> {w.hint.thresholds}</p>
          <p><b>ถ้าแดง:</b> {w.hint.action}</p>
        </div>
      )}
    </div>
  )
}
