import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { CreditCard, ExternalLink, RefreshCw, Check, CalendarClock } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'

// ราคาทั้งหมดมาจาก backend (billing.catalog.ts) — หน้านี้แค่คำนวณยอดโชว์ Stripe คิดเงินจริงเอง
interface CatalogPlan {
  code: string
  name: string
  monthly: number
  includedPacks: number | 'all'
  canBuyPacks: boolean
  extraUser: { price: number; maxExtra: number }
  addons: Record<string, number>
}
type Preview =
  | { kind: 'checkout' }
  | { kind: 'trial' }
  | { kind: 'change'; credit: number; charge: number; tax: number; total: number; nextBilling: string | null }
  | { kind: 'downgrade'; effectiveAt: string; blocked: string | null }

interface BillingData {
  current: {
    planCode: string
    planName: string
    status: string
    cycle: 'monthly' | 'yearly' | null
    currentPeriodEnd: string | null
    packs: string[]
    addons: Record<string, number>
    hasSubscription: boolean
    hasCustomer: boolean
    cancelAt: string | null
    pendingChange: { plan: string; planName: string; cycle: 'monthly' | 'yearly'; packs: string[]; effectiveAt: string } | null
  }
  trialEligible: boolean
  catalog: { yearlyMonths: number; packPrice: number; vatPercent: number; packs: string[]; plans: CatalogPlan[] }
}

const PACK_LABEL: Record<string, string> = {
  shop: 'Shop — KDS, ปิดกะไม่จำกัด',
  online: 'Online — กระทบยอด Shopee/Lazada',
  maker: 'Maker — BOM, ใบสั่งผลิต, QC',
  accounting: 'Accounting — บัญชี, VAT, WHT',
}
const ADDON_LABEL: Record<string, string> = {
  backup: 'สำรองข้อมูลขึ้น Google Drive',
  smart_unit: 'Smart Unit แปลงหน่วยอัตโนมัติ',
  multi_currency: 'Multi-Currency หลายสกุลเงิน',
  subcontract: 'Subcontract จ้างผลิตภายนอก',
  api_access: 'API & Webhook',
}
const baht = (n: number) => `฿${n.toLocaleString('th-TH', { maximumFractionDigits: 2 })}`
// รายปีคิด yearlyMonths เดือน (10) — โชว์เป็น "ราคา 1 ปีที่ลดแล้ว" เทียบกับจ่ายรายเดือน 12 เดือน
const yearlyDiscountPct = (yearlyMonths: number) => Math.round((1 - yearlyMonths / 12) * 100)
const thDate = (iso: string) => new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })

export default function Billing() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState<BillingData | null>(null)
  const [cycle, setCycle] = useState<'monthly' | 'yearly'>('monthly')
  const [plan, setPlan] = useState('business')
  const [packs, setPacks] = useState<string[]>([])
  const [addons, setAddons] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)

  const load = async () => {
    const res = await api.get('/billing')
    const d: BillingData = res.data.data
    setData(d)
    const wanted = params.get('plan')
    if (wanted && d.catalog.plans.some(p => p.code === wanted)) {
      setPlan(wanted)
      if (params.get('cycle') === 'yearly') setCycle('yearly')
    } else if (d.catalog.plans.some(p => p.code === d.current.planCode)) {
      setPlan(d.current.planCode)
      setPacks(d.current.packs)
      setAddons(d.current.addons)
      if (d.current.cycle) setCycle(d.current.cycle)
    }
    return d
  }

  useEffect(() => {
    load().catch(() => toast.error('โหลดข้อมูลแพ็กเกจไม่สำเร็จ'))
    const status = params.get('status')
    if (status) {
      const next = new URLSearchParams(params)
      next.delete('status')
      setParams(next, { replace: true })
    }
    if (status === 'cancel') toast('ยกเลิกการชำระเงินแล้ว ยังไม่มีการตัดเงิน')
    if (status === 'success') {
      toast.success('ชำระเงินสำเร็จ กำลังเปิดสิทธิ์ให้…')
      // webhook จาก Stripe อาจมาช้ากว่าการ redirect กลับ — รอดูสถานะอีกสักครู่
      let tries = 0
      const timer = setInterval(async () => {
        tries++
        const d = await load().catch(() => null)
        if (tries >= 6 || d?.current.hasSubscription) clearInterval(timer)
      }, 3000)
      return () => clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selected = data?.catalog.plans.find(p => p.code === plan)

  const pricing = useMemo(() => {
    if (!data || !selected) return null
    const mult = cycle === 'yearly' ? data.catalog.yearlyMonths : 1
    const included = selected.includedPacks === 'all' ? Infinity : selected.includedPacks
    const extraPacks = selected.includedPacks === 'all' ? 0 : Math.max(0, packs.length - included)
    let monthly = selected.monthly + extraPacks * data.catalog.packPrice
    monthly += (addons.extra_users ?? 0) * selected.extraUser.price
    for (const [k, v] of Object.entries(addons)) if (k !== 'extra_users' && v > 0) monthly += selected.addons[k] ?? 0
    const sub = monthly * mult
    const vat = Math.round(sub * data.catalog.vatPercent) / 100
    const yearlySaving = cycle === 'yearly' ? monthly * 12 - sub : 0
    return { sub, vat, total: sub + vat, extraPacks, yearlySaving }
  }, [data, selected, cycle, packs, addons])

  // มีแพ็กอยู่แล้ว + เลือกต่างจากเดิม → ถาม Stripe ว่าต้องจ่ายเท่าไร (หักมูลค่าแพ็กเดิมที่ยังไม่ได้ใช้แล้ว)
  const selectionKey = JSON.stringify({ plan, cycle, packs: [...packs].sort(), addons })
  useEffect(() => {
    setPreview(null)
    if (!data?.current.hasSubscription) return
    const timer = setTimeout(() => {
      api.post('/billing/preview', { plan, cycle, packs, addons })
        .then(res => setPreview(res.data.data))
        .catch(() => setPreview(null))
    }, 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, data?.current.hasSubscription])

  const choosePlan = (code: string) => {
    const p = data?.catalog.plans.find(x => x.code === code)
    if (!p) return
    setPlan(code)
    // ล้างตัวเลือกที่แพ็กใหม่ซื้อไม่ได้ ไม่งั้น backend ปฏิเสธ
    setPacks(prev => (p.includedPacks === 'all' || !p.canBuyPacks ? [] : prev))
    setAddons(prev => {
      const next: Record<string, number> = {}
      if (prev.extra_users) next.extra_users = Math.min(prev.extra_users, p.extraUser.maxExtra)
      for (const k of Object.keys(p.addons)) if (prev[k]) next[k] = 1
      return next
    })
  }

  const submit = async () => {
    setBusy(true)
    try {
      const res = await api.post('/billing/checkout', { plan, cycle, packs, addons })
      if (res.data.data.url) {
        window.location.href = res.data.data.url
        return
      }
      if (res.data.data.scheduled) toast.success(`ตั้งเวลาเปลี่ยนแพ็กแล้ว มีผล ${thDate(res.data.data.effectiveAt)}`)
      else toast.success('เปลี่ยนแพ็กเกจแล้ว ใช้งานได้ทันที')
      await load()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'ดำเนินการไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const cancelPending = async () => {
    setBusy(true)
    try {
      await api.post('/billing/cancel-pending')
      toast.success('ยกเลิกการเปลี่ยนแพ็กแล้ว ใช้แพ็กปัจจุบันต่อตามปกติ')
      await load()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'ยกเลิกไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const openPortal = async () => {
    setBusy(true)
    try {
      const res = await api.post('/billing/portal')
      window.location.href = res.data.data.url
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'เปิดหน้าจัดการการชำระเงินไม่สำเร็จ')
      setBusy(false)
    }
  }

  if (user && !['ADMIN', 'MASTER'].includes(user.role)) {
    return <div className="phopy-card p-6 text-[var(--fg-2)]">เฉพาะผู้ดูแลบริษัท (ADMIN) เท่านั้นที่จัดการแพ็กเกจได้</div>
  }
  if (!data || !selected || !pricing) {
    return <div className="flex items-center gap-2 text-[var(--fg-3)] p-6"><RefreshCw className="w-4 h-4 animate-spin" /> กำลังโหลด…</div>
  }

  const { current, catalog, trialEligible } = data
  const isCurrent = current.hasSubscription && current.planCode === plan && current.cycle === cycle &&
    JSON.stringify([...current.packs].sort()) === JSON.stringify([...packs].sort()) &&
    JSON.stringify(current.addons) === JSON.stringify(addons)
  const submitLabel = current.hasSubscription ? 'เปลี่ยนแพ็กเกจ'
    : current.status === 'TRIAL' ? (trialEligible ? 'สมัครแพ็กนี้ (ยังไม่ตัดเงินจนครบช่วงทดลอง)' : 'ไปชำระเงิน')
    : trialEligible ? 'เริ่มทดลองใช้ฟรี 30 วัน' : 'ไปชำระเงิน'

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-1)]">แพ็กเกจและการชำระเงิน</h1>
          <p className="text-sm text-[var(--fg-3)] mt-1">
            ตอนนี้ใช้ <b className="text-[var(--fg-1)]">{current.planName}</b>
            {current.packs.length > 0 && <> · Pack: {current.packs.join(', ')}</>}
            {current.currentPeriodEnd && current.status === 'ACTIVE' && <> · ใช้ได้ถึง {new Date(current.currentPeriodEnd).toLocaleDateString('th-TH')}</>}
            {current.currentPeriodEnd && current.status === 'TRIAL' && <b className="text-[var(--warning)]"> · ทดลองใช้ฟรีถึง {new Date(current.currentPeriodEnd).toLocaleDateString('th-TH')} (ไม่สมัครต่อ = กลับเป็น Free ข้อมูลอยู่ครบ)</b>}
            {current.status === 'EXPIRED' && <b className="text-[var(--danger)]"> · หมดอายุแล้ว</b>}
            {current.cancelAt && <b className="text-[var(--danger)]"> · ยกเลิกแล้ว ใช้ได้ถึง {thDate(current.cancelAt)} (ไม่ต่ออายุ)</b>}
          </p>
        </div>
        {current.hasCustomer && (
          <button onClick={openPortal} disabled={busy}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] text-sm disabled:opacity-50">
            <CreditCard className="w-4 h-4" /> บัตร · ใบเสร็จ · ยกเลิก <ExternalLink className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {current.pendingChange && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--warning)]/40 bg-[var(--warning-soft)] p-4" role="status">
          <CalendarClock className="w-5 h-5 text-warning flex-shrink-0" />
          <p className="flex-1 text-sm text-[var(--fg-1)]">
            ตั้งเวลาเปลี่ยนเป็น <b>{current.pendingChange.planName}</b> ({current.pendingChange.cycle === 'yearly' ? 'รายปี' : 'รายเดือน'})
            {current.pendingChange.packs.length > 0 && <> · Pack: {current.pendingChange.packs.join(', ')}</>}
            {' '}มีผล <b>{thDate(current.pendingChange.effectiveAt)}</b> — ถึงวันนั้นยังใช้แพ็กปัจจุบันได้ครบ
          </p>
          <button onClick={cancelPending} disabled={busy}
            className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50">
            ยกเลิกการเปลี่ยน
          </button>
        </div>
      )}

      <div className="inline-flex rounded-lg border border-[var(--border)] p-1 bg-[var(--surface-2)]" role="radiogroup" aria-label="รอบบิล">
        {(['monthly', 'yearly'] as const).map(c => (
          <button key={c} role="radio" aria-checked={cycle === c} onClick={() => setCycle(c)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${cycle === c ? 'bg-[var(--surface)] text-[var(--fg-1)] shadow-sm' : 'text-[var(--fg-3)]'}`}>
            {c === 'monthly' ? 'รายเดือน' : <>รายปี <span className="text-[var(--success)]">ลด {yearlyDiscountPct(catalog.yearlyMonths)}%</span></>}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" role="radiogroup" aria-label="แพ็กเกจ">
        {catalog.plans.map(p => {
          const active = p.code === plan
          const price = cycle === 'yearly' ? p.monthly * catalog.yearlyMonths : p.monthly
          return (
            <button key={p.code} role="radio" aria-checked={active} onClick={() => choosePlan(p.code)}
              className={`text-left p-4 rounded-xl border-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${active ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]'}`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[var(--fg-1)]">{p.name}</span>
                {active && <Check className="w-4 h-4 text-[var(--primary)]" />}
              </div>
              <div className="text-xl font-bold text-[var(--fg-1)] mt-1 tabular-nums">{baht(price)}</div>
              {cycle === 'yearly' && (
                <div className="text-xs tabular-nums">
                  <s className="text-[var(--fg-4)]">{baht(p.monthly * 12)}</s>{' '}
                  <span className="text-[var(--success)]">ประหยัด {baht(p.monthly * 12 - price)}</span>
                </div>
              )}
              <div className="text-xs text-[var(--fg-3)]">/{cycle === 'yearly' ? 'ปี' : 'เดือน'} · {p.includedPacks === 'all' ? 'ครบ 4 Pack' : p.includedPacks ? `${p.includedPacks} Pack` : 'ไม่มี Pack'}</div>
              {current.planCode === p.code && <div className="text-xs mt-1 text-[var(--success)]">แพ็กปัจจุบัน</div>}
            </button>
          )
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {selected.includedPacks !== 'all' && selected.canBuyPacks && (
            <fieldset className="phopy-card p-5">
              <legend className="sr-only">เลือก Pack</legend>
              <h2 className="font-semibold text-[var(--fg-1)]">เลือก Pack</h2>
              <p className="text-xs text-[var(--fg-3)] mb-3">รวมในแพ็ก {selected.includedPacks} Pack · เกินจากนี้ Pack ละ {baht(catalog.packPrice)}/เดือน</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {catalog.packs.map(code => (
                  <label key={code} className="flex items-center gap-2 text-sm text-[var(--fg-2)] cursor-pointer">
                    <input type="checkbox" checked={packs.includes(code)}
                      onChange={() => setPacks(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code])} />
                    {PACK_LABEL[code] ?? code}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset className="phopy-card p-5 space-y-3">
            <legend className="sr-only">Add-on</legend>
            <h2 className="font-semibold text-[var(--fg-1)]">Add-on</h2>
            <label className="flex items-center gap-2 text-sm text-[var(--fg-2)]">
              ผู้ใช้เพิ่ม
              <input type="number" min={0} max={selected.extraUser.maxExtra} value={addons.extra_users ?? 0}
                onChange={e => {
                  const n = Math.max(0, Math.min(selected.extraUser.maxExtra, Math.floor(Number(e.target.value) || 0)))
                  setAddons(prev => ({ ...prev, extra_users: n }))
                }}
                className="w-20 px-2 py-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-1)]" />
              คน <span className="text-xs text-[var(--fg-4)]">({baht(selected.extraUser.price)}/คน/เดือน · สูงสุด {selected.extraUser.maxExtra})</span>
            </label>
            {Object.entries(selected.addons).map(([code, price]) => (
              <label key={code} className="flex items-center gap-2 text-sm text-[var(--fg-2)] cursor-pointer">
                <input type="checkbox" checked={(addons[code] ?? 0) > 0}
                  onChange={e => setAddons(prev => ({ ...prev, [code]: e.target.checked ? 1 : 0 }))} />
                {ADDON_LABEL[code] ?? code} <span className="text-xs text-[var(--fg-4)]">+{baht(price)}/เดือน</span>
              </label>
            ))}
            {Object.keys(selected.addons).length === 0 && (
              <p className="text-xs text-[var(--fg-4)]">Add-on โมดูลรวมอยู่ในแพ็กนี้แล้ว</p>
            )}
          </fieldset>
        </div>

        <aside className="phopy-card p-5 h-fit space-y-3 lg:sticky lg:top-4">
          <h2 className="font-semibold text-[var(--fg-1)]">สรุปยอดต่อ{cycle === 'yearly' ? 'ปี' : 'เดือน'}</h2>
          <dl className="text-sm space-y-1.5">
            <div className="flex justify-between"><dt className="text-[var(--fg-3)]">ก่อน VAT</dt><dd className="tabular-nums">{baht(pricing.sub)}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--fg-3)]">VAT {catalog.vatPercent}%</dt><dd className="tabular-nums">{baht(pricing.vat)}</dd></div>
            <div className="flex justify-between font-bold text-[var(--fg-1)] border-t border-[var(--border)] pt-2"><dt>รวม</dt><dd className="tabular-nums">{baht(pricing.total)}</dd></div>
          </dl>
          {pricing.yearlySaving > 0 && (
            <p className="text-xs text-[var(--success)]">ประหยัด {baht(pricing.yearlySaving)}/ปี เทียบกับจ่ายรายเดือน (ก่อน VAT)</p>
          )}
          {trialEligible && !current.hasSubscription && (
            <p className="text-xs text-[var(--success)]">ทดลองใช้ฟรี 30 วัน ไม่ต้องใส่บัตร — ถ้าไม่ใส่บัตรก่อนครบ ระบบจะกลับเป็นแพ็ก Free อัตโนมัติ</p>
          )}
          {current.hasSubscription && !isCurrent && preview?.kind === 'trial' && (
            <p className="text-xs text-[var(--success)]">อยู่ในช่วงทดลอง เปลี่ยนแพ็กได้ทันที ยังไม่ตัดเงิน</p>
          )}
          {current.hasSubscription && !isCurrent && preview?.kind === 'change' && (
            <div className="rounded-lg bg-[var(--surface-2)] p-3 text-sm space-y-1">
              <p className="font-semibold text-[var(--fg-1)]">ถ้าเปลี่ยนตอนนี้</p>
              <div className="flex justify-between"><span className="text-[var(--fg-3)]">แพ็กใหม่ 1 รอบเต็ม</span><span className="tabular-nums">{baht(preview.charge)}</span></div>
              <div className="flex justify-between"><span className="text-[var(--fg-3)]">หักมูลค่าแพ็กเดิมที่ยังไม่ได้ใช้</span><span className="tabular-nums text-[var(--success)]">−{baht(preview.credit)}</span></div>
              <div className="flex justify-between"><span className="text-[var(--fg-3)]">VAT</span><span className="tabular-nums">{baht(preview.tax)}</span></div>
              <div className="flex justify-between font-bold text-[var(--fg-1)] border-t border-[var(--border)] pt-1"><span>จ่ายวันนี้</span><span className="tabular-nums">{baht(preview.total)}</span></div>
              {preview.nextBilling && <p className="text-xs text-[var(--fg-3)]">รอบบิลใหม่เริ่มวันนี้ ต่ออายุครั้งถัดไป {new Date(preview.nextBilling).toLocaleDateString('th-TH')}</p>}
              {current.pendingChange && <p className="text-xs text-warning">การลดแพ็กที่ตั้งเวลาไว้จะถูกยกเลิก</p>}
            </div>
          )}
          {current.hasSubscription && !isCurrent && preview?.kind === 'downgrade' && (
            preview.blocked
              ? <p className="rounded-lg bg-[var(--danger-soft)] p-3 text-sm text-danger" role="alert">{preview.blocked}</p>
              : (
                <div className="rounded-lg bg-[var(--surface-2)] p-3 text-sm space-y-1">
                  <p className="font-semibold text-[var(--fg-1)]">ลดแพ็ก — มีผล {thDate(preview.effectiveAt)}</p>
                  <p className="text-xs text-[var(--fg-3)]">ใช้แพ็กปัจจุบันได้ครบจนถึงวันนั้น (จ่ายไว้แล้ว) ไม่มีการคืนเงิน แล้วเริ่มตัดราคาใหม่ {baht(pricing.total)} ในวันนั้น · ยกเลิกการเปลี่ยนได้ก่อนถึงวัน</p>
                </div>
              )
          )}
          <button onClick={submit} disabled={busy || isCurrent || (preview?.kind === 'downgrade' && !!preview.blocked)}
            className="w-full phopy-btn-primary flex items-center justify-center gap-2 py-2.5 rounded-lg disabled:opacity-50">
            {busy && <RefreshCw className="w-4 h-4 animate-spin" />}
            {isCurrent ? 'แพ็กปัจจุบัน'
              : preview?.kind === 'change' ? `จ่าย ${baht(preview.total)} และเปลี่ยนแพ็ก`
              : preview?.kind === 'downgrade' ? `ตั้งเวลาลดแพ็ก (มีผล ${thDate(preview.effectiveAt)})`
              : submitLabel}
          </button>
          <p className="text-[11px] text-[var(--fg-4)]">ชำระเงินผ่าน Stripe · ออกใบเสร็จ/ใบกำกับภาษีให้ทางอีเมล</p>
          <a href="https://phopy.net/compare/" target="_blank" rel="noopener noreferrer" className="block text-xs text-[var(--primary)] underline underline-offset-2">ดูตารางเปรียบเทียบว่าแต่ละแพ็กได้อะไรบ้าง</a>
        </aside>
      </div>
    </div>
  )
}
