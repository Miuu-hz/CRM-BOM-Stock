import { useState, type ReactNode } from 'react'
import {
  AlertTriangle, ArrowRight, Boxes, Check, ChevronLeft, ChevronRight, Factory, Home, Minus, Package,
  PackageCheck, Plus, RotateCcw, RotateCw, Truck, Warehouse,
} from 'lucide-react'
import { CATEGORY_LABEL, DO_STATUS, shortDate, type TwinData, type TwinOutbound } from './twin'

// แผงลอยรอบฉาก 3D — สไตล์เดียวกันทุกใบ: การ์ดขาวโปร่ง ขอบบาง เงานุ่ม
export const card = 'bg-white/95 backdrop-blur-md border border-slate-200/80 rounded-2xl shadow-[0_8px_30px_-12px_rgba(30,41,90,0.25)]'
const ACCENT = '#2D5BE3'

export function KpiCard({ icon, label, value, sub, tone = 'blue' }: {
  icon: ReactNode; label: string; value: string; sub: string; tone?: 'blue' | 'green' | 'amber'
}) {
  const toneCls = { blue: 'bg-blue-50 text-[#2D5BE3]', green: 'bg-emerald-50 text-emerald-600', amber: 'bg-amber-50 text-amber-600' }[tone]
  return (
    <div className={`${card} flex items-center gap-3 px-3.5 py-2.5 min-w-[170px]`}>
      <div className={`w-9 h-9 rounded-xl grid place-items-center ${toneCls}`}>{icon}</div>
      <div className="leading-tight">
        <div className="text-[11px] font-medium text-slate-500">{label}</div>
        <div className="text-lg font-bold text-slate-900 tabular-nums">{value}</div>
        <div className="text-[10.5px] text-slate-400">{sub}</div>
      </div>
    </div>
  )
}

export function MapToolbar({ onZoomIn, onZoomOut, onRotL, onRotR, onHome }: Record<'onZoomIn' | 'onZoomOut' | 'onRotL' | 'onRotR' | 'onHome', () => void>) {
  const btn = 'w-9 h-9 grid place-items-center text-slate-600 hover:text-[#2D5BE3] hover:bg-blue-50 active:scale-95 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2D5BE3] rounded-xl'
  return (
    <div className={`${card} flex flex-col p-1 gap-0.5`} role="toolbar" aria-label="ควบคุมมุมกล้อง">
      <button className={btn} onClick={onZoomIn} aria-label="ซูมเข้า"><Plus className="w-4 h-4" /></button>
      <button className={btn} onClick={onZoomOut} aria-label="ซูมออก"><Minus className="w-4 h-4" /></button>
      <div className="h-px bg-slate-100 mx-1.5 my-0.5" />
      <button className={btn} onClick={onRotL} aria-label="หมุนซ้าย"><RotateCcw className="w-4 h-4" /></button>
      <button className={btn} onClick={onRotR} aria-label="หมุนขวา"><RotateCw className="w-4 h-4" /></button>
      <button className={btn} onClick={onHome} aria-label="กลับมุมเริ่มต้น"><Home className="w-4 h-4" /></button>
    </div>
  )
}

const Section = ({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) => (
  <section className="px-4 py-3 border-t border-slate-100">
    <div className="flex items-center justify-between mb-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
      {action}
    </div>
    {children}
  </section>
)

const CAT_ICON: Record<string, ReactNode> = {
  raw: <Boxes className="w-4 h-4 text-amber-600" />,
  wip: <Factory className="w-4 h-4 text-indigo-500" />,
  finished: <PackageCheck className="w-4 h-4 text-emerald-600" />,
}

export function SitePanel({ data, highlight, onOpen }: {
  data: TwinData; highlight: 'rack' | 'production' | null
  onOpen: (path: string, state?: object) => void
}) {
  const { stock, outbound, production } = data
  const pct = stock.sku ? Math.round((stock.inStock / stock.sku) * 100) : 0
  const busy = outbound.ready + outbound.shipped + production.active > 0
  const ring = (k: 'rack' | 'production') => (highlight === k ? 'ring-2 ring-[#2D5BE3]/40 bg-blue-50/40' : '')
  return (
    <>
      <header className="px-4 pt-4 pb-3 flex items-start gap-3">
        <div className="w-11 h-11 rounded-xl bg-[#2D5BE3] grid place-items-center text-white shadow-md shadow-blue-600/25">
          <Warehouse className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h2 className="font-bold text-slate-900 truncate">{data.site.name || 'คลังหลัก'}</h2>
          <p className="text-[11px] text-slate-500 truncate">{data.site.address || 'ตั้งที่อยู่ได้ที่ ตั้งค่าบริษัท'}</p>
          <span className={`inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${busy ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${busy ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
            {busy ? 'กำลังปฏิบัติงาน' : 'ไม่มีงานค้าง'}
          </span>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 px-4 pb-3">
        <div className={`rounded-xl border border-slate-100 p-2.5 transition ${ring('rack')}`}>
          <div className="text-[10.5px] text-slate-500">SKU ที่มีของ</div>
          <div className="text-base font-bold text-slate-900 tabular-nums">{stock.inStock.toLocaleString()}<span className="text-xs font-medium text-slate-400"> / {stock.sku.toLocaleString()}</span></div>
          <div className="h-1.5 mt-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-[#2D5BE3] transition-[width] duration-700" style={{ width: `${pct}%` }} /></div>
        </div>
        <div className="rounded-xl border border-slate-100 p-2.5">
          <div className="text-[10.5px] text-slate-500">ขาออกวันนี้</div>
          <div className="text-base font-bold text-slate-900 tabular-nums">{outbound.ready + outbound.shipped}<span className="text-xs font-medium text-slate-400"> คัน</span></div>
          <div className="text-[10.5px] text-emerald-600 font-medium">ส่งถึงแล้ว {outbound.deliveredToday}</div>
        </div>
      </div>

      {stock.value != null && (
        <div className="px-4 pb-3 -mt-1 text-[11px] text-slate-500">มูลค่าสต็อก <b className="text-slate-800 tabular-nums">฿{stock.value.toLocaleString()}</b></div>
      )}

      <Section title="สินค้าคงคลัง" action={<button onClick={() => onOpen('/stock')} className="text-[11px] font-semibold text-[#2D5BE3] hover:underline">ดูทั้งหมด</button>}>
        <ul className={`space-y-1 rounded-xl transition ${ring('rack')}`}>
          {stock.categories.length === 0 && <li className="text-xs text-slate-400">ยังไม่มีสินค้าในคลัง</li>}
          {stock.categories.map(c => (
            <li key={c.category} className="flex items-center gap-2.5 py-1">
              <span className="w-7 h-7 rounded-lg bg-slate-50 grid place-items-center">{CAT_ICON[c.category] ?? <Package className="w-4 h-4 text-slate-500" />}</span>
              <span className="flex-1 text-xs text-slate-700">{CATEGORY_LABEL[c.category] ?? c.category}</span>
              <span className="text-xs font-semibold text-slate-900 tabular-nums">{c.inStock}<span className="text-slate-400 font-normal">/{c.sku}</span></span>
            </li>
          ))}
        </ul>
      </Section>

      {stock.low > 0 && (
        <Section title={`ใกล้หมด · ${stock.low}`}>
          <ul className="space-y-1">
            {stock.lowItems.map(it => (
              <li key={it.id}>
                <button onClick={() => onOpen('/stock', { openType: 'stock', openId: it.id, openItem: { name: it.name, sku: it.sku } })}
                  className="w-full flex items-center gap-2 text-left py-1 px-1.5 -mx-1.5 rounded-lg hover:bg-amber-50/70 transition">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span className="flex-1 text-xs text-slate-700 truncate">{it.name}</span>
                  <span className="text-[11px] tabular-nums text-amber-700 font-semibold">{it.quantity}/{it.minStock}</span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={`สายผลิต · ${production.active}`} action={<button onClick={() => onOpen('/work-orders')} className="text-[11px] font-semibold text-[#2D5BE3] hover:underline">ใบผลิต</button>}>
        <ul className={`space-y-2 rounded-xl transition ${ring('production')}`}>
          {production.list.length === 0 && <li className="text-xs text-slate-400">ไม่มีใบผลิตที่กำลังทำ</li>}
          {production.list.map(wo => {
            const p = wo.quantity ? Math.min(100, Math.round((wo.completed / wo.quantity) * 100)) : 0
            return (
              <li key={wo.id}>
                <button onClick={() => onOpen('/work-orders', { openType: 'work_order', openId: wo.id })} className="w-full text-left group">
                  <div className="flex justify-between text-xs"><span className="font-semibold text-slate-800 group-hover:text-[#2D5BE3]">{wo.number}</span><span className="tabular-nums text-slate-500">{p}%</span></div>
                  <div className="text-[10.5px] text-slate-400 truncate">{wo.product || '-'} · {wo.completed}/{wo.quantity}</div>
                  <div className="h-1 mt-1 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-indigo-500 rounded-full" style={{ width: `${p}%` }} /></div>
                </button>
              </li>
            )
          })}
        </ul>
      </Section>
    </>
  )
}

type DockTab = 'docks' | 'inbound'

export function DocksPanel({ data, tab, onTab, selectedId, onSelect, onOpen }: {
  data: TwinData; tab: DockTab; onTab: (t: DockTab) => void; selectedId: string | null
  onSelect: (kind: 'shipment' | 'inbound', id: string) => void; onOpen: (path: string, state?: object) => void
}) {
  const ready = data.outbound.list.filter(d => d.status === 'READY')
  const rowCls = (id?: string) => `w-full grid grid-cols-[68px_1fr_auto] items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs transition ${id && id === selectedId ? 'bg-blue-50 ring-1 ring-[#2D5BE3]/30' : 'hover:bg-slate-50'}`
  const tabBtn = (t: DockTab, label: string) => (
    <button onClick={() => onTab(t)} className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${tab === t ? 'bg-[#2D5BE3] text-white shadow-sm' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}`} role="tab" aria-selected={tab === t}>{label}</button>
  )
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-3 pt-3 pb-2" role="tablist">
        {tabBtn('docks', `ท่าโหลด ${Math.min(ready.length, 3)}/3`)}
        {tabBtn('inbound', `ขาเข้า ${data.inbound.open}`)}
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {tab === 'docks' && [0, 1, 2].map(i => {
          const d = ready[i]
          return (
            <button key={i} className={rowCls(d?.id)} onClick={() => d && onSelect('shipment', d.id)} disabled={!d}>
              <span><b className="text-slate-800">ท่า {i + 1}</b><br /><span className="text-[10px] text-slate-400">ขาออก</span></span>
              {d ? <span className="truncate"><span className="inline-block w-1.5 h-1.5 rounded-full bg-[#2D5BE3] mr-1.5 align-middle" />{d.number} · <span className="text-slate-500">{d.party || '-'}</span></span>
                : <span className="text-slate-400">ว่าง — ไม่มีรถเทียบท่า</span>}
              <span className="text-[10.5px] text-slate-400">{d?.plate || ''}</span>
            </button>
          )
        })}
        {tab === 'inbound' && (data.inbound.list.length === 0
          ? <p className="text-xs text-slate-400 px-2 py-3">ไม่มีใบสั่งซื้อรอรับของ</p>
          : data.inbound.list.map(po => (
            <button key={po.id} className={rowCls(po.id)} onClick={() => onSelect('inbound', po.id)} onDoubleClick={() => onOpen('/purchase', { openType: 'PURCHASE_ORDER', openId: po.id })}>
              <span><b className="text-slate-800">{po.number}</b><br /><span className="text-[10px] text-slate-400">{po.status === 'PARTIAL' ? 'รับบางส่วน' : 'รอรับของ'}</span></span>
              <span className="truncate text-slate-600">{po.party || 'ไม่ระบุผู้ขาย'}</span>
              <span className="text-[10.5px] text-slate-400">ETA {shortDate(po.eta)}</span>
            </button>
          )))}
      </div>
    </div>
  )
}

const STEPS = ['ขึ้นของ', 'กำลังส่ง', 'ส่งถึง']

export function ShipmentTracker({ list, selectedId, onSelect, onOpen }: {
  list: TwinOutbound[]; selectedId: string | null; onSelect: (id: string) => void; onOpen: () => void
}) {
  const [fallback, setFallback] = useState(0)
  if (list.length === 0) {
    return (
      <div className="flex items-center gap-3 p-4 text-xs text-slate-500">
        <Truck className="w-5 h-5 text-slate-300" />
        ยังไม่มีใบส่งของที่พร้อมส่ง — ตั้งสถานะใบส่งของเป็น “พร้อมส่ง” แล้วรถจะเทียบท่าในฉาก
      </div>
    )
  }
  const idx = Math.max(0, list.findIndex(d => d.id === selectedId))
  const cur = list[selectedId ? idx : Math.min(fallback, list.length - 1)]
  const step = DO_STATUS[cur.status]?.step ?? 0
  const go = (d: number) => {
    const i = (list.indexOf(cur) + d + list.length) % list.length
    setFallback(i)
    onSelect(list[i].id)
  }
  return (
    <div className="flex flex-col md:flex-row items-stretch gap-3 p-3">
      <ol className="flex items-start flex-1 min-w-0 pt-1" aria-label="สถานะการส่ง">
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1 flex flex-col items-center relative">
            {i > 0 && <span className={`absolute top-4 right-1/2 w-full h-0.5 -z-0 ${i <= step ? 'bg-[#2D5BE3]' : 'bg-slate-200'}`} />}
            <span className={`relative z-10 w-8 h-8 rounded-full grid place-items-center border-2 transition ${i < step ? 'bg-[#2D5BE3] border-[#2D5BE3] text-white' : i === step ? 'bg-white border-[#2D5BE3] text-[#2D5BE3] shadow-[0_0_0_4px_rgba(45,91,227,0.15)]' : 'bg-white border-slate-200 text-slate-300'}`}>
              {i < step ? <Check className="w-4 h-4" /> : i === 1 ? <Truck className="w-4 h-4" /> : i === 0 ? <Package className="w-4 h-4" /> : <PackageCheck className="w-4 h-4" />}
            </span>
            <span className={`mt-1 text-[11px] font-semibold ${i <= step ? 'text-slate-800' : 'text-slate-400'}`}>{s}</span>
            <span className="text-[10px] text-slate-400">{i === step ? shortDate(cur.updatedAt || cur.eta) : i === 2 ? `นัด ${shortDate(cur.eta)}` : ''}</span>
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-2 md:w-[260px] rounded-xl bg-slate-50/80 border border-slate-100 p-2.5">
        <button onClick={() => go(-1)} aria-label="ใบก่อนหน้า" className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white"><ChevronLeft className="w-4 h-4" /></button>
        <button onClick={onOpen} className="flex-1 min-w-0 text-left group">
          <div className="text-xs font-bold text-slate-900 group-hover:text-[#2D5BE3] flex items-center gap-1">#{cur.number}<ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition" /></div>
          <div className="text-[11px] text-slate-500 truncate">ถึง {cur.party || '-'}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold" style={{ background: 'rgba(45,91,227,0.1)', color: ACCENT }}>{DO_STATUS[cur.status]?.label ?? cur.status}</span>
            <span className="text-[10px] text-slate-400 truncate">{[cur.plate, cur.driver].filter(Boolean).join(' · ')}</span>
          </div>
        </button>
        <button onClick={() => go(1)} aria-label="ใบถัดไป" className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white"><ChevronRight className="w-4 h-4" /></button>
      </div>
    </div>
  )
}
