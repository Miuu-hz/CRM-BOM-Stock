import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, LayoutPanelLeft, Loader2, RefreshCw, Search, Truck, Warehouse, X, PackageOpen } from 'lucide-react'
import { DigitalTwinScene, type TwinSceneHandle } from './DigitalTwinScene'
import { card, DocksPanel, KpiCard, MapToolbar, ShipmentTracker, SitePanel } from './twin-panels'
import { useTwinData, type TwinPick } from './twin'
import { getCachedCompanySettings } from '../../services/companySettings.service'

const ZOOM_STEP = 1.2
const ROTATE_STEP = Math.PI / 4
const MAX_RESULTS = 8

interface SearchHit { key: string; label: string; sub: string; run: () => void }

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

export default function DigitalTwinApp() {
  const navigate = useNavigate()
  const { data, error, loading, reload } = useTwinData()
  const sceneRef = useRef<TwinSceneHandle>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [highlight, setHighlight] = useState<'rack' | 'production' | null>(null)
  const [dockTab, setDockTab] = useState<'docks' | 'inbound'>('docks')
  const [query, setQuery] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)
  const now = useClock()
  const brandName = data?.site.name || getCachedCompanySettings().name || 'Phopy'

  const open = (path: string, state?: object) => navigate(path, state ? { state } : undefined)

  const handlePick = (p: TwinPick) => {
    setHighlight(null)
    if (p.kind === 'shipment') { setSelectedId(p.id); setDockTab('docks') }
    else if (p.kind === 'inbound') { setSelectedId(p.id); setDockTab('inbound') }
    else { setSelectedId(null); setHighlight(p.kind === 'site' ? null : p.kind); setPanelOpen(true) }
  }

  // คีย์ลัด: / ค้นหา · Esc ล้าง · +/- ซูม
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = document.activeElement === searchRef.current
      if (e.key === 'Escape') { setQuery(''); setSelectedId(null); setHighlight(null); searchRef.current?.blur() }
      if (typing) return
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus() }
      if (e.key === '+' || e.key === '=') sceneRef.current?.zoom(ZOOM_STEP)
      if (e.key === '-') sceneRef.current?.zoom(1 / ZOOM_STEP)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const hits = useMemo<SearchHit[]>(() => {
    const q = query.trim().toLowerCase()
    if (!data || q.length < 2) return []
    const has = (...xs: (string | null | undefined)[]) => xs.some(x => x?.toLowerCase().includes(q))
    return [
      ...data.outbound.list.filter(d => has(d.number, d.party, d.plate)).map(d => ({
        key: d.id, label: d.number, sub: `ใบส่งของ · ${d.party || '-'}`,
        run: () => { setSelectedId(d.id); setDockTab('docks') },
      })),
      ...data.inbound.list.filter(p => has(p.number, p.party)).map(p => ({
        key: p.id, label: p.number, sub: `ใบสั่งซื้อรอรับ · ${p.party || '-'}`,
        run: () => { setSelectedId(p.id); setDockTab('inbound') },
      })),
      ...data.production.list.filter(w => has(w.number, w.product)).map(w => ({
        key: w.id, label: w.number, sub: `ใบผลิต · ${w.product || '-'}`,
        run: () => { setHighlight('production'); setPanelOpen(true) },
      })),
      ...data.stock.lowItems.filter(i => has(i.name, i.sku)).map(i => ({
        key: i.id, label: i.name, sub: `ใกล้หมด · ${i.sku}`,
        run: () => open('/stock', { openType: 'stock', openId: i.id, openItem: { name: i.name, sku: i.sku } }),
      })),
    ].slice(0, MAX_RESULTS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, data])

  const isEmpty = data && !data.outbound.list.length && !data.inbound.open && !data.production.active
  const updatedAt = data ? new Date(data.generatedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '--:--'

  return (
    <div className="relative w-full h-[calc(100vh-4rem)] overflow-hidden bg-[#EEF1F6] text-slate-800">
      <DigitalTwinScene ref={sceneRef} data={data} brandName={brandName} selectedId={selectedId} onPick={handlePick} />

      {/* ── แถบบน: ค้นหา · ไซต์ · สด ── */}
      <div className="absolute top-3 left-3 right-3 z-20 flex items-center gap-2 pointer-events-none">
        <div className={`${card} pointer-events-auto relative flex-1 max-w-xl flex items-center gap-2 px-3 py-2 focus-within:ring-2 focus-within:ring-[#2D5BE3]/30`}>
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            ref={searchRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && hits[0]) { hits[0].run(); setQuery('') } }}
            placeholder="ค้นหาใบส่งของ ใบสั่งซื้อ ใบผลิต สินค้าใกล้หมด…"
            aria-label="ค้นหาในคลัง"
            className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
          {query
            ? <button onClick={() => setQuery('')} aria-label="ล้างคำค้น" className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
            : <kbd className="hidden sm:block text-[10px] font-mono px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-slate-400">/</kbd>}
          {query.trim().length >= 2 && (
            <ul className={`${card} absolute left-0 right-0 top-full mt-2 p-1.5 max-h-80 overflow-auto`} role="listbox">
              {hits.length === 0 && <li className="px-3 py-2 text-xs text-slate-400">ไม่พบในงานที่กำลังเคลื่อนไหว</li>}
              {hits.map(h => (
                <li key={h.key}>
                  <button onClick={() => { h.run(); setQuery('') }} className="w-full text-left px-3 py-2 rounded-xl hover:bg-blue-50 transition">
                    <div className="text-sm font-semibold text-slate-800">{h.label}</div>
                    <div className="text-[11px] text-slate-500">{h.sub}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button onClick={() => { setHighlight(null); setPanelOpen(v => !v) }}
          className={`${card} pointer-events-auto hidden sm:flex items-center gap-2.5 px-3 py-1.5 hover:border-[#2D5BE3]/40 transition`}>
          <span className="px-1.5 py-1 rounded-lg bg-[#2D5BE3] text-white text-[10px] font-bold">WH</span>
          <span className="text-left leading-tight">
            <span className="block text-xs font-semibold text-slate-800 max-w-[160px] truncate">{brandName}</span>
            <span className="block text-[10.5px] text-slate-500">{data ? `มีของ ${data.stock.inStock}/${data.stock.sku} SKU · ท่า ${Math.min(data.outbound.ready, 3)}/3` : 'กำลังโหลด…'}</span>
          </span>
        </button>

        <div className={`${card} pointer-events-auto ml-auto flex items-center gap-2 px-3 py-2`} title={`อัปเดตล่าสุด ${updatedAt}`}>
          <span className={`w-2 h-2 rounded-full ${error ? 'bg-rose-500' : 'bg-emerald-500 animate-pulse'}`} />
          <span className={`text-xs font-semibold ${error ? 'text-rose-600' : 'text-emerald-700'}`}>{error ? 'ออฟไลน์' : 'Live'}</span>
          <span className="text-xs font-mono tabular-nums text-slate-600">{now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</span>
          <button onClick={reload} aria-label="โหลดข้อมูลใหม่" className="text-slate-400 hover:text-[#2D5BE3]">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* ── KPI มุมซ้ายบน ── */}
      {data && (
        <div className="absolute top-[68px] left-3 z-10 flex flex-wrap gap-2 max-w-[calc(100%-80px)] lg:max-w-[calc(100%-420px)]">
          <KpiCard icon={<Truck className="w-4 h-4" />} label="รถขาเข้ารอรับของ" value={data.inbound.open.toLocaleString()} sub={`ตรวจรับแล้ววันนี้ ${data.inbound.receivedToday}`} />
          <KpiCard icon={<Clock className="w-4 h-4" />} tone="green" label="ส่งตรงเวลา" value={data.outbound.onTimePct == null ? '—' : `${data.outbound.onTimePct}%`} sub="30 วันล่าสุด" />
          <KpiCard icon={<PackageOpen className="w-4 h-4" />} tone="amber" label="รอขึ้นรถ" value={data.outbound.ready.toLocaleString()} sub={`กำลังวิ่ง ${data.outbound.shipped}`} />
        </div>
      )}

      {/* ── ปุ่มกล้อง ── */}
      <div className="absolute z-10 top-[68px] right-3 lg:right-[324px]">
        <MapToolbar
          onZoomIn={() => sceneRef.current?.zoom(ZOOM_STEP)}
          onZoomOut={() => sceneRef.current?.zoom(1 / ZOOM_STEP)}
          onRotL={() => sceneRef.current?.rotate(-ROTATE_STEP)}
          onRotR={() => sceneRef.current?.rotate(ROTATE_STEP)}
          onHome={() => sceneRef.current?.reset()}
        />
      </div>

      {/* ── แผงไซต์ (ขวา) — จอเล็กเปิดจากปุ่ม ── */}
      {data && (
        <aside className={`${card} ${panelOpen ? 'flex' : 'hidden'} lg:flex flex-col absolute z-20 overflow-y-auto
          left-3 right-3 bottom-3 max-h-[60%] lg:left-auto lg:right-3 lg:top-[68px] lg:bottom-[214px] lg:max-h-none lg:w-[300px]`}>
          <button onClick={() => setPanelOpen(false)} className="lg:hidden absolute top-3 right-3 text-slate-400" aria-label="ปิดแผง"><X className="w-4 h-4" /></button>
          <SitePanel data={data} highlight={highlight} onOpen={open} />
        </aside>
      )}
      <button onClick={() => setPanelOpen(true)} className={`${card} lg:hidden absolute z-10 right-3 top-[260px] p-2.5 text-slate-600`} aria-label="เปิดข้อมูลคลัง">
        <LayoutPanelLeft className="w-4 h-4" />
      </button>

      {/* ── ท่าโหลด/ขาเข้า (ขวาล่าง) ── */}
      {data && (
        <div className={`${card} hidden lg:block absolute z-10 right-3 bottom-3 w-[300px] h-[198px]`}>
          <DocksPanel data={data} tab={dockTab} onTab={setDockTab} selectedId={selectedId}
            onSelect={(_, id) => setSelectedId(id)} onOpen={open} />
        </div>
      )}

      {/* ── ติดตามการส่ง (ซ้ายล่าง) ── */}
      {data && (
        <div className={`${card} absolute z-10 left-3 bottom-3 hidden md:block w-[calc(100%-24px)] lg:w-[calc(100%-340px)] max-w-[720px]`}>
          <ShipmentTracker list={data.outbound.list} selectedId={selectedId} onSelect={setSelectedId} onOpen={() => open('/sales')} />
        </div>
      )}

      {/* ── สถานะโหลด/ว่าง ── */}
      {!data && (
        <div className="absolute inset-0 z-30 grid place-items-center pointer-events-none">
          <div className={`${card} px-5 py-4 flex items-center gap-3 text-sm pointer-events-auto`}>
            {error
              ? <><Warehouse className="w-5 h-5 text-rose-500" /><span className="text-slate-700">{error}</span><button onClick={reload} className="text-[#2D5BE3] font-semibold">ลองใหม่</button></>
              : <><Loader2 className="w-5 h-5 animate-spin text-[#2D5BE3]" /><span className="text-slate-600">กำลังโหลดสถานะคลัง…</span></>}
          </div>
        </div>
      )}
      {isEmpty && (
        <div className={`${card} absolute z-10 left-1/2 -translate-x-1/2 top-[150px] px-4 py-3 max-w-sm text-center text-xs text-slate-600 hidden md:block`}>
          ตอนนี้ยังไม่มีรถเข้า-ออก — อนุมัติใบสั่งซื้อ หรือตั้งใบส่งของเป็น “พร้อมส่ง” แล้วรถจะขึ้นในฉากภายใน 30 วินาที
        </div>
      )}
    </div>
  )
}
