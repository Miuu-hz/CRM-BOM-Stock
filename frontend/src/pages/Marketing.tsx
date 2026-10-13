import { useState, useEffect, useCallback, useMemo } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import api from '../services/api'
import HintBanner from '../components/common/HintBanner'

// ============================================================
// เฟส 4: แดชบอร์ดกำไรรายสินค้า + KPI 4 หมวด (อ่านอย่างเดียว)
// แทนที่หน้าเมตริกโฆษณายุค CSV เดิมทั้งหมด (marketing_metrics มี 0 แถวมาตลอด — ดู
// backend/src/routes/marketing.routes.ts คอมเมนต์ ponytail ที่ลบ /shops /metrics /analytics/summary)
// ============================================================

interface ShopInfo { platform: string; shopKey: string; months: string[] }

interface MonthPoint { month: string; hasData: boolean; sales_confirmed: number; ads_cost: number; profit: number; daily?: DayPoint[] }
interface DayPoint { date: string; sales_all: number; orders_all: number; sales_confirmed: number; orders_confirmed: number; visitors: number; clicks: number; cancelled_orders: number; cancelled_sales: number; buyers: number; new_buyers: number; existing_buyers: number; potential_buyers: number }

interface ProductRow {
  productId: string; name: string; qtyConfirmed: number; salesConfirmed: number; salesAll: number
  ordersAll: number; ordersConfirmed: number; costKnown: boolean; unitCost: number | null
  cogs: number; gp: number; ads: number; affiliate: number; shippingExcess: number; refunds: number
  profit: number; profitPerUnit: number | null; margin: number | null
}
interface CancelledRow { productId: string; name: string; ordersAll: number; ordersConfirmed: number; cancelRate: number; lostSales: number }

interface Dashboard {
  months: MonthPoint[]
  monthsWithData: number
  monthsInWindow: number
  kpis: {
    sales: { grossPrice: number; storeDiscount: number; netSales: number; profit: number; margin: number; aov: number; cancelRate: number }
    platformCost: { gpPercent: number; affiliate: number; shippingExcess: number }
    ads: { roas: number; tacos: number; ctr: number; cpl: number }
    customer: { cac: number; ar: number; crr: number; clv: number; clvCac: number }
  }
  products: ProductRow[]
  cancelled: CancelledRow[]
  estimates: string[]
}

const RANGES = [1, 3, 6, 12] as const
const money = (n: number) => `฿${(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}`
const num = (n: number) => (n || 0).toLocaleString('th-TH', { maximumFractionDigits: 1 })
const thMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('th-TH', { month: 'short', year: '2-digit' })
}

const COST_KEYS = [
  { key: 'cogs', label: 'ทุน' },
  { key: 'gp', label: 'GP แพลตฟอร์ม' },
  { key: 'ads', label: 'โฆษณา' },
  { key: 'affiliate', label: 'Affiliate' },
  { key: 'shippingExcess', label: 'ค่าส่งส่วนเกิน' },
  { key: 'refunds', label: 'คืนเงิน' },
] as const
type CostKey = typeof COST_KEYS[number]['key']

function KpiCard({ label, value, formula }: { label: string; value: string; formula: string }) {
  return (
    <div className="phopy-card p-3">
      <div className="text-xs text-[var(--fg-3)]">{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
      <div className="text-[10px] text-[var(--fg-4)] mt-1">{formula}</div>
    </div>
  )
}

function Marketing() {
  const [shops, setShops] = useState<ShopInfo[]>([])
  const [shopKey, setShopKey] = useState('')
  const [platform, setPlatform] = useState('')
  const [range, setRange] = useState<1 | 3 | 6 | 12>(1)
  const [endMonth, setEndMonth] = useState('')
  const [dash, setDash] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<'profit' | 'overview'>('overview')

  // คนละ-ค่าใช้จ่าย toggle (แท็บกำไรรายสินค้า)
  const [enabledCosts, setEnabledCosts] = useState<Record<CostKey, boolean>>({
    cogs: true, gp: true, ads: true, affiliate: true, shippingExcess: true, refunds: true,
  })
  const [showCostPercent, setShowCostPercent] = useState(false)
  const [whatIfCost, setWhatIfCost] = useState<Record<string, number>>({})
  const [sortKey, setSortKey] = useState<'salesConfirmed' | 'profit' | 'margin'>('salesConfirmed')

  useEffect(() => {
    api.get('/marketing/platform-dashboard/shops').then((r) => {
      const list: ShopInfo[] = r.data.data || []
      setShops(list)
      if (list.length > 0) {
        setPlatform(list[0].platform)
        setShopKey(list[0].shopKey)
        const latest = [...list[0].months].sort().slice(-1)[0]
        setEndMonth(latest)
      }
    }).catch(() => {})
  }, [])

  const load = useCallback(() => {
    if (!platform || !shopKey || !endMonth) return
    setLoading(true)
    api.get('/marketing/platform-dashboard', { params: { platform, shop_key: shopKey, end_month: endMonth, range } })
      .then((r) => setDash(r.data.data))
      .catch(() => setDash(null))
      .finally(() => setLoading(false))
  }, [platform, shopKey, endMonth, range])

  useEffect(() => { load() }, [load])

  const windowLabel = useMemo(() => {
    if (!dash || dash.months.length === 0) return ''
    return `${thMonth(dash.months[0].month)} – ${thMonth(dash.months[dash.months.length - 1].month)}`
  }, [dash])

  // กำไรรายสินค้าคำนวณฝั่งหน้าเว็บจาก toggle + what-if cost (ไม่บันทึกอะไรเลย)
  const productsComputed = useMemo(() => {
    if (!dash) return []
    return dash.products.map((p) => {
      const cogs = !p.costKnown && whatIfCost[p.productId] != null ? whatIfCost[p.productId] * p.qtyConfirmed : p.cogs
      const costs: Record<CostKey, number> = { cogs, gp: p.gp, ads: p.ads, affiliate: p.affiliate, shippingExcess: p.shippingExcess, refunds: p.refunds }
      const totalCost = COST_KEYS.reduce((s, c) => s + (enabledCosts[c.key] ? costs[c.key] : 0), 0)
      const profit = p.salesConfirmed - totalCost
      return { ...p, displayCogs: cogs, displayProfit: profit, displayMargin: p.salesConfirmed > 0 ? (profit / p.salesConfirmed) * 100 : 0, costs }
    }).sort((a, b) => (b[sortKey === 'margin' ? 'displayMargin' : sortKey === 'profit' ? 'displayProfit' : 'salesConfirmed'] || 0) - (a[sortKey === 'margin' ? 'displayMargin' : sortKey === 'profit' ? 'displayProfit' : 'salesConfirmed'] || 0))
  }, [dash, enabledCosts, whatIfCost, sortKey])

  const topProfit = useMemo(() => [...productsComputed].sort((a, b) => b.displayProfit - a.displayProfit).slice(0, 5), [productsComputed])
  const bottomProfit = useMemo(() => [...productsComputed].sort((a, b) => (a.qtyConfirmed > 0 ? a.displayProfit / a.qtyConfirmed : a.displayProfit) - (b.qtyConfirmed > 0 ? b.displayProfit / b.qtyConfirmed : b.displayProfit)).slice(0, 5), [productsComputed])

  const waterfall = useMemo(() => {
    if (!dash) return []
    const sales = dash.kpis.sales
    const totalCosts = COST_KEYS.filter((c) => enabledCosts[c.key]).map((c) => ({
      label: c.label,
      value: -(c.key === 'gp' ? (dash.kpis.platformCost.gpPercent / 100) * sales.netSales
        : c.key === 'affiliate' ? dash.kpis.platformCost.affiliate
        : c.key === 'shippingExcess' ? dash.kpis.platformCost.shippingExcess
        : c.key === 'cogs' ? productsComputed.reduce((s, p) => s + p.displayCogs, 0)
        : c.key === 'ads' ? dash.months.reduce((s, m) => s + (m.ads_cost || 0), 0)
        : productsComputed.reduce((s, p) => s + p.refunds, 0)),
    }))
    const steps = [
      { label: 'ราคาเต็ม', value: sales.grossPrice },
      { label: 'ส่วนลดร้าน', value: -sales.storeDiscount },
      { label: 'ยอดขายสุทธิ', value: sales.netSales, isSubtotal: true },
      ...totalCosts,
    ]
    let running = 0
    const bars = steps.map((s) => {
      const base = s.isSubtotal ? 0 : running
      running = s.isSubtotal ? s.value : running + s.value
      return { name: s.label, base: s.isSubtotal ? 0 : Math.min(base, running), delta: Math.abs(s.value), value: s.value }
    })
    bars.push({ name: 'กำไร', base: 0, delta: Math.abs(running), value: running })
    return bars
  }, [dash, enabledCosts, productsComputed])

  if (!shops.length) {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-2xl font-bold">แดชบอร์ดแพลตฟอร์ม</h1>
        <HintBanner id="marketing-mcp-import" title="ยังไม่มีข้อมูลรอบเดือน">
          คุยกับ AI ผู้ช่วยแล้วแนบรายงานรอบเดือนจากแพลตฟอร์ม (เช่น Shopee) ผ่านเครื่องมือ platform_submit_file
          บอกแพลตฟอร์ม ร้านค้า และเดือนของรอบ ระบบจะนำเข้าข้อมูลให้อัตโนมัติ
        </HintBanner>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">แดชบอร์ดแพลตฟอร์ม</h1>
        <div className="flex gap-2 items-center flex-wrap">
          <select className="phopy-input" value={`${platform}:${shopKey}`} onChange={(e) => {
            const s = shops.find((x) => `${x.platform}:${x.shopKey}` === e.target.value)
            if (s) { setPlatform(s.platform); setShopKey(s.shopKey); setEndMonth([...s.months].sort().slice(-1)[0]) }
          }}>
            {shops.map((s) => <option key={`${s.platform}:${s.shopKey}`} value={`${s.platform}:${s.shopKey}`}>{s.platform} · {s.shopKey}</option>)}
          </select>
          <input type="month" className="phopy-input" value={endMonth} onChange={(e) => setEndMonth(e.target.value)} />
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button key={r} onClick={() => setRange(r)} className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${range === r ? 'bg-[var(--primary)] text-white' : 'bg-[var(--surface-2)] text-[var(--fg-3)]'}`}>{r} เดือน</button>
            ))}
          </div>
        </div>
      </div>

      {dash && (
        <div className="text-sm text-[var(--fg-3)]">
          ช่วง {windowLabel} · มีข้อมูล {dash.monthsWithData}/{dash.monthsInWindow} เดือน
        </div>
      )}

      <div className="flex gap-2 phopy-card p-1 w-fit">
        <button onClick={() => setTab('overview')} className={`px-4 py-2 rounded-lg font-semibold ${tab === 'overview' ? 'bg-[var(--primary)] text-white' : 'text-[var(--fg-3)]'}`}>ภาพรวม</button>
        <button onClick={() => setTab('profit')} className={`px-4 py-2 rounded-lg font-semibold ${tab === 'profit' ? 'bg-[var(--primary)] text-white' : 'text-[var(--fg-3)]'}`}>กำไรรายสินค้า</button>
      </div>

      {loading && <div className="text-sm text-[var(--fg-3)]">กำลังโหลด...</div>}

      {!loading && dash && dash.monthsWithData === 0 && (
        <HintBanner id="marketing-mcp-import" title="ยังไม่มีข้อมูลในช่วงนี้">
          ไม่มีรอบเดือนที่มีข้อมูลในช่วงที่เลือก — ลองเลือกช่วงเดือนอื่น หรือส่งไฟล์รอบเดือนผ่าน AI ผู้ช่วย (platform_submit_file)
        </HintBanner>
      )}

      {!loading && dash && dash.monthsWithData > 0 && tab === 'overview' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KpiCard label="ยอดขายสุทธิ" value={money(dash.kpis.sales.netSales)} formula="Σ sales_confirmed" />
            <KpiCard label="กำไร" value={money(dash.kpis.sales.profit)} formula="ยอดขาย − ต้นทุนทั้งหมด" />
            <KpiCard label="มาร์จิ้น" value={`${num(dash.kpis.sales.margin)}%`} formula="กำไร / ยอดขาย" />
            <KpiCard label="AOV" value={money(dash.kpis.sales.aov)} formula="ยอดขาย / ออเดอร์สำเร็จ" />
            <KpiCard label="%ยกเลิก" value={`${num(dash.kpis.sales.cancelRate)}%`} formula="ยกเลิก / ออเดอร์ทั้งหมด" />
            <KpiCard label="GP%" value={`${num(dash.kpis.platformCost.gpPercent)}%`} formula="ค่าธรรมเนียม / รายได้รวม" />
            <KpiCard label="Affiliate" value={money(dash.kpis.platformCost.affiliate)} formula="|ams_commission|" />
            <KpiCard label="ค่าส่งส่วนเกิน" value={money(dash.kpis.platformCost.shippingExcess)} formula="−(รับ+subsidy+เก็บ+คืน)" />
            <KpiCard label="ROAS" value={num(dash.kpis.ads.roas)} formula="ยอดขายจากโฆษณา / ค่าโฆษณา" />
            <KpiCard label="TACoS" value={`${num(dash.kpis.ads.tacos)}%`} formula="ค่าโฆษณา / ยอดขาย" />
            <KpiCard label="CTR" value={`${num(dash.kpis.ads.ctr)}%`} formula="คลิก / การมองเห็น" />
            <KpiCard label="CPL" value={money(dash.kpis.ads.cpl)} formula="ค่าโฆษณา / ผู้มุ่งหวัง" />
            <KpiCard label="CAC" value={money(dash.kpis.customer.cac)} formula="(โฆษณา+Affiliate) / ลูกค้าใหม่" />
            <KpiCard label="AR ทิ้งตะกร้า" value={`${num(dash.kpis.customer.ar)}%`} formula="1 − ซื้อสำเร็จ/เข้าตะกร้า" />
            <KpiCard label="CRR" value={`${num(dash.kpis.customer.crr)}%`} formula="ถ่วงน้ำหนักตามผู้ซื้อ" />
            <KpiCard label="CLV" value={money(dash.kpis.customer.clv)} formula="AOV×กำไรขั้นต้น/(1−CRR)" />
            <KpiCard label="CLV:CAC" value={num(dash.kpis.customer.clvCac)} formula="CLV / CAC" />
          </div>

          <div className="phopy-card p-4">
            <h3 className="font-semibold mb-2">แนวโน้ม</h3>
            <ResponsiveContainer width="100%" height={260}>
              {range === 1 && dash.months[0]?.daily ? (
                <BarChart data={dash.months[0].daily}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="sales_confirmed" name="ยอดขาย" fill="var(--primary)" />
                </BarChart>
              ) : (
                <BarChart data={dash.months}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tickFormatter={thMonth} tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip labelFormatter={thMonth} />
                  <Bar dataKey="sales_confirmed" name="ยอดขาย">
                    {dash.months.map((m, i) => <Cell key={i} fill="var(--primary)" fillOpacity={m.hasData ? 1 : 0.15} stroke={m.hasData ? undefined : 'var(--fg-4)'} strokeDasharray={m.hasData ? undefined : '3 3'} />)}
                  </Bar>
                  <Bar dataKey="ads_cost" name="ค่าโฆษณา" fill="var(--warning)" />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>

          {dash.cancelled.length > 0 && (
            <div className="phopy-card p-4 overflow-x-auto">
              <h3 className="font-semibold mb-2">สินค้าที่ถูกยกเลิกบ่อย</h3>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[var(--fg-3)]"><th>สินค้า</th><th>%ยกเลิก</th><th>ยอดขายที่เสียไป</th></tr></thead>
                <tbody>
                  {dash.cancelled.map((c) => (
                    <tr key={c.productId} className="border-t border-[var(--border)]">
                      <td className="py-1">{c.name}</td>
                      <td>{num(c.cancelRate)}%</td>
                      <td>{money(c.lostSales)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {!loading && dash && dash.monthsWithData > 0 && tab === 'profit' && (
        <>
          <div className="phopy-card p-3 flex flex-wrap gap-3 items-center">
            {COST_KEYS.map((c) => (
              <label key={c.key} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={enabledCosts[c.key]} onChange={(e) => setEnabledCosts((prev) => ({ ...prev, [c.key]: e.target.checked }))} />
                {c.label}
              </label>
            ))}
            <label className="flex items-center gap-1.5 text-sm ml-auto">
              <input type="checkbox" checked={showCostPercent} onChange={(e) => setShowCostPercent(e.target.checked)} />
              เทียบค่าใช้จ่ายกับรายได้
            </label>
          </div>

          <div className="phopy-card p-4">
            <h3 className="font-semibold mb-2">Waterfall: ราคาเต็ม → กำไร</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={waterfall}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: any, k: any, p: any) => money(p.payload.value)} />
                <Bar dataKey="base" stackId="w" fill="transparent" />
                <Bar dataKey="delta" stackId="w">
                  {waterfall.map((b, i) => <Cell key={i} fill={b.value < 0 ? 'var(--danger)' : 'var(--success)'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {dash.estimates.length > 0 && (
              <div className="text-[10px] text-[var(--fg-4)] mt-1">* โฆษณา/Affiliate/ค่าส่งเกิน/คืนเงินต่อสินค้าเป็นค่าประมาณจากสัดส่วนยอดขาย ไม่ใช่ตัวเลขจริงต่อชิ้น</div>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="phopy-card p-4">
              <h3 className="font-semibold mb-2 flex items-center gap-1"><TrendingUp className="w-4 h-4 text-[var(--success)]" /> ทำกำไรรวมมากที่สุด</h3>
              {topProfit.map((p) => <div key={p.productId} className="flex justify-between text-sm py-1 border-t border-[var(--border)]"><span>{p.name}</span><span className="font-semibold">{money(p.displayProfit)}</span></div>)}
            </div>
            <div className="phopy-card p-4">
              <h3 className="font-semibold mb-2 flex items-center gap-1"><TrendingDown className="w-4 h-4 text-[var(--danger)]" /> ขาดทุน/กำไรต่อชิ้นต่ำสุด</h3>
              {bottomProfit.map((p) => <div key={p.productId} className="flex justify-between text-sm py-1 border-t border-[var(--border)]"><span>{p.name}</span><span className={`font-semibold ${p.displayProfit < 0 ? 'text-[var(--danger)]' : ''}`}>{p.qtyConfirmed > 0 ? money(p.displayProfit / p.qtyConfirmed) + '/ชิ้น' : money(p.displayProfit)}</span></div>)}
            </div>
          </div>

          <div className="phopy-card p-4 overflow-x-auto">
            <h3 className="font-semibold mb-2">สินค้าทั้งหมด</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--fg-3)]">
                  <th>สินค้า</th>
                  <th className="cursor-pointer" onClick={() => setSortKey('salesConfirmed')}>ยอดขาย</th>
                  <th>จำนวน</th>
                  <th>ทุน/หน่วย</th>
                  <th className="cursor-pointer" onClick={() => setSortKey('profit')}>กำไร</th>
                  <th className="cursor-pointer" onClick={() => setSortKey('margin')}>มาร์จิ้น</th>
                  {showCostPercent && <th>%ค่าใช้จ่าย/รายได้</th>}
                </tr>
              </thead>
              <tbody>
                {productsComputed.map((p) => (
                  <tr key={p.productId} className={`border-t border-[var(--border)] ${p.displayProfit < 0 ? 'bg-[var(--danger)]/10' : ''}`}>
                    <td className="py-1">{p.name}</td>
                    <td>{money(p.salesConfirmed)}</td>
                    <td>{num(p.qtyConfirmed)}</td>
                    <td>
                      {p.costKnown ? money(p.unitCost || 0) : (
                        <input type="number" placeholder="ไม่มีทุน — กรอกสมมติ" className="phopy-input w-28 text-xs"
                          value={whatIfCost[p.productId] ?? ''} onChange={(e) => setWhatIfCost((prev) => ({ ...prev, [p.productId]: Number(e.target.value) || 0 }))} />
                      )}
                    </td>
                    <td className={p.displayProfit < 0 ? 'text-[var(--danger)] font-semibold' : ''}>{money(p.displayProfit)}</td>
                    <td>{num(p.displayMargin)}%</td>
                    {showCostPercent && <td>{num((p.salesConfirmed > 0 ? (p.salesConfirmed - p.displayProfit) / p.salesConfirmed : 0) * 100)}%</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

export default Marketing
