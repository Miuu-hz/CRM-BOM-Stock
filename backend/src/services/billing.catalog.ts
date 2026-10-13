import { PACK_FEATURES, ADDON_FEATURES, EXTRA_USERS } from './subscription.features'

// ราคาขายผ่าน Stripe — ตาม Phopy_Price.xlsx ชีต "แพ็กเกจ v2" + "Add-ons" (บาท/เดือน ไม่รวม VAT)
// ตารางนี้คือที่เดียวที่กำหนดว่าแพ็กไหนซื้ออะไรเพิ่มได้ราคาเท่าไร:
// scripts/stripeSetup สร้าง Price ใน Stripe จากตารางนี้ และ /api/billing/checkout ตรวจคำสั่งซื้อกับตารางนี้
// แก้ราคา = แก้ที่นี่ แล้วรัน `node dist/scripts/stripeSetup.js` ใหม่ (ลูกค้าเดิมยังจ่ายราคาเดิมจนกว่าจะเปลี่ยนแพ็ก)

export type Cycle = 'monthly' | 'yearly'
export type AddonModule = typeof ADDON_FEATURES[number]

// จ่ายรายปี = 10 เดือน — ใช้กับทุกรายการ เพราะ Stripe บังคับให้ทุก item ใน subscription มีรอบบิลเดียวกัน
export const YEARLY_MONTHS = 10
export const PACK_PRICE = 390
export const VAT_PERCENT = 7

interface PlanPricing {
  name: string
  monthly: number
  includedPacks: number | 'all'
  canBuyPacks: boolean
  extraUser: { price: number; maxExtra: number }
  addons: Partial<Record<AddonModule, number>>  // ไม่มีในนี้ = รวมในแพ็กแล้ว หรือไม่ขายให้แพ็กนี้
}

export const PLAN_PRICING: Record<string, PlanPricing> = {
  solo: {
    name: 'Solo', monthly: 299, includedPacks: 0, canBuyPacks: false,
    extraUser: { price: 190, maxExtra: 1 }, addons: { backup: 99 },
  },
  business: {
    name: 'Business', monthly: 690, includedPacks: 2, canBuyPacks: true,
    extraUser: { price: 150, maxExtra: 2 }, addons: { backup: 99, smart_unit: 290 },
  },
  business_plus: {
    name: 'Business+', monthly: 990, includedPacks: 3, canBuyPacks: true,
    extraUser: { price: 150, maxExtra: 5 }, addons: { subcontract: 290 },
  },
  pro: {
    name: 'Pro', monthly: 1950, includedPacks: 'all', canBuyPacks: false,
    extraUser: { price: 120, maxExtra: 100 }, addons: { api_access: 590 },
  },
  enterprise_ai: {
    name: 'Enterprise AI', monthly: 3490, includedPacks: 'all', canBuyPacks: false,
    extraUser: { price: 100, maxExtra: 100 }, addons: {},
  },
}

export interface Selection {
  plan: string
  cycle: Cycle
  packs: string[]
  addons: Record<string, number>
}

export interface LineItem { lookupKey: string; quantity: number }

export class BillingError extends Error {}

const ALL_PACKS = Object.keys(PACK_FEATURES)

export const lookupKey = {
  plan: (plan: string, cycle: Cycle) => `phopy_plan_${plan}_${cycle}`,
  pack: (cycle: Cycle) => `phopy_pack_${cycle}`,
  user: (plan: string, cycle: Cycle) => `phopy_user_${plan}_${cycle}`,
  addon: (addon: string, cycle: Cycle) => `phopy_addon_${addon}_${cycle}`,
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// ตรวจคำสั่งซื้อจาก client (ไม่เชื่ออะไรเลย) แล้วคืน Selection ที่ normalize แล้ว
export function parseSelection(input: unknown): Selection {
  if (!isRecord(input)) throw new BillingError('ข้อมูลคำสั่งซื้อไม่ถูกต้อง')
  const { plan, cycle } = input
  if (typeof plan !== 'string' || !Object.prototype.hasOwnProperty.call(PLAN_PRICING, plan)) {
    throw new BillingError('ไม่พบแพ็กเกจที่เลือก')
  }
  if (cycle !== 'monthly' && cycle !== 'yearly') throw new BillingError('รอบบิลต้องเป็นรายเดือนหรือรายปี')
  const pricing = PLAN_PRICING[plan]

  const rawPacks = input.packs ?? []
  if (!Array.isArray(rawPacks) || rawPacks.some(p => typeof p !== 'string' || !ALL_PACKS.includes(p))) {
    throw new BillingError(`Pack ต้องเป็น ${ALL_PACKS.join(' / ')}`)
  }
  // Pro/Enterprise AI ได้ครบทุก Pack อยู่แล้ว ไม่ต้องเลือก
  const packs = pricing.includedPacks === 'all' ? [] : [...new Set(rawPacks as string[])]
  if (pricing.includedPacks !== 'all') {
    if (!pricing.canBuyPacks && packs.length > 0) throw new BillingError(`แพ็ก ${pricing.name} เลือก Pack ไม่ได้ ต้องอัปเกรดเป็น Business`)
    if (packs.length < pricing.includedPacks) throw new BillingError(`แพ็ก ${pricing.name} ต้องเลือก ${pricing.includedPacks} Pack`)
  }

  const rawAddons = input.addons ?? {}
  if (!isRecord(rawAddons)) throw new BillingError('Add-on ไม่ถูกต้อง')
  const addons: Record<string, number> = {}
  for (const [key, value] of Object.entries(rawAddons)) {
    if (!Number.isInteger(value) || (value as number) < 0) throw new BillingError(`จำนวน ${key} ต้องเป็นจำนวนเต็มไม่ติดลบ`)
    const qty = value as number
    if (qty === 0) continue
    if (key === EXTRA_USERS) {
      if (qty > pricing.extraUser.maxExtra) throw new BillingError(`แพ็ก ${pricing.name} เพิ่มผู้ใช้ได้ไม่เกิน ${pricing.extraUser.maxExtra} คน`)
      addons[key] = qty
      continue
    }
    if (!Object.prototype.hasOwnProperty.call(pricing.addons, key)) throw new BillingError(`แพ็ก ${pricing.name} ซื้อ Add-on "${key}" ไม่ได้`)
    if (qty !== 1) throw new BillingError(`Add-on "${key}" ซื้อได้ 1 ชุด`)
    addons[key] = 1
  }
  // จ้างผลิตภายนอกต้องมีระบบผลิต (Pack Maker) ก่อน — Pro มี Maker อยู่แล้ว
  if (addons.subcontract && pricing.includedPacks !== 'all' && !packs.includes('maker')) {
    throw new BillingError('Add-on Subcontract ต้องเลือก Pack Maker ด้วย')
  }

  return { plan, cycle, packs, addons }
}

export function lineItems(sel: Selection): LineItem[] {
  const pricing = PLAN_PRICING[sel.plan]
  const items: LineItem[] = [{ lookupKey: lookupKey.plan(sel.plan, sel.cycle), quantity: 1 }]
  const included = pricing.includedPacks === 'all' ? ALL_PACKS.length : pricing.includedPacks
  const extraPacks = Math.max(0, sel.packs.length - included)
  if (extraPacks > 0) items.push({ lookupKey: lookupKey.pack(sel.cycle), quantity: extraPacks })
  for (const [key, qty] of Object.entries(sel.addons)) {
    items.push({
      lookupKey: key === EXTRA_USERS ? lookupKey.user(sel.plan, sel.cycle) : lookupKey.addon(key, sel.cycle),
      quantity: qty,
    })
  }
  return items
}

// ยอดก่อน VAT ต่อรอบบิล (บาท) — ไว้โชว์ในหน้าเลือกแพ็ก, Stripe คิดเงินจริงจาก Price ที่สร้างจากตารางเดียวกัน
export function subtotal(sel: Selection): number {
  return lineItems(sel).reduce((sum, item) => sum + unitPrice(item.lookupKey) * item.quantity, 0)
}

export interface PriceDef {
  lookupKey: string
  productId: string
  productName: string
  unitAmountBaht: number
  cycle: Cycle
  metadata: Record<string, string>
}

const perCycle = (monthly: number, cycle: Cycle) => (cycle === 'yearly' ? monthly * YEARLY_MONTHS : monthly)

// ทุก Price ที่ต้องมีใน Stripe — product id กำหนดเองได้ จึงรันซ้ำแล้วไม่สร้างของซ้ำ
export function priceDefinitions(): PriceDef[] {
  const defs: PriceDef[] = []
  for (const cycle of ['monthly', 'yearly'] as const) {
    defs.push({
      lookupKey: lookupKey.pack(cycle), productId: 'phopy_pack', productName: 'Phopy Pack เพิ่ม',
      unitAmountBaht: perCycle(PACK_PRICE, cycle), cycle, metadata: { kind: 'pack' },
    })
    const addonPrices = new Map<string, number>()
    for (const [plan, p] of Object.entries(PLAN_PRICING)) {
      defs.push({
        lookupKey: lookupKey.plan(plan, cycle), productId: `phopy_plan_${plan}`, productName: `Phopy ${p.name}`,
        unitAmountBaht: perCycle(p.monthly, cycle), cycle, metadata: { kind: 'plan', plan },
      })
      defs.push({
        lookupKey: lookupKey.user(plan, cycle), productId: 'phopy_extra_user', productName: 'Phopy ผู้ใช้เพิ่ม',
        unitAmountBaht: perCycle(p.extraUser.price, cycle), cycle, metadata: { kind: 'user', plan },
      })
      for (const [addon, price] of Object.entries(p.addons)) {
        const seen = addonPrices.get(addon)
        if (seen !== undefined && seen !== price) throw new Error(`ราคา add-on ${addon} ต่างกันระหว่างแพ็ก — lookupKey.addon ต้องแยกตามแพ็ก`)
        addonPrices.set(addon, price as number)
      }
    }
    for (const [addon, price] of addonPrices) {
      defs.push({
        lookupKey: lookupKey.addon(addon, cycle), productId: `phopy_addon_${addon}`, productName: `Phopy Add-on ${addon}`,
        unitAmountBaht: perCycle(price, cycle), cycle, metadata: { kind: 'addon', addon },
      })
    }
  }
  return defs
}

const PRICE_BY_KEY = new Map(priceDefinitions().map(d => [d.lookupKey, d.unitAmountBaht]))
function unitPrice(key: string): number {
  const price = PRICE_BY_KEY.get(key)
  if (price === undefined) throw new Error(`ไม่มีราคาสำหรับ ${key}`)
  return price
}

// ส่งให้หน้าเลือกแพ็กวาด UI — ไม่ต้องเขียนราคาซ้ำฝั่ง frontend
export function publicCatalog() {
  return {
    yearlyMonths: YEARLY_MONTHS,
    packPrice: PACK_PRICE,
    vatPercent: VAT_PERCENT,
    packs: ALL_PACKS,
    plans: Object.entries(PLAN_PRICING).map(([code, p]) => ({ code, ...p })),
  }
}

// ราคารวมต่อเดือนแบบไม่คิดส่วนลดรายปี — ใช้เทียบว่าการเปลี่ยนแพ็กเป็นขึ้นหรือลง
export const monthlyValue = (sel: Selection): number => subtotal({ ...sel, cycle: 'monthly' })

// อัปเกรด = มีผลทันที (เก็บส่วนต่าง) · ดาวน์เกรด = มีผลวันครบรอบ ไม่คืนเงิน (ลูกค้าใช้ของที่จ่ายแล้วจนครบ)
// - รายปี → รายเดือน นับเป็นดาวน์เกรดเสมอ (จ่ายล่วงหน้าทั้งปีไปแล้ว)
// - ราคาเท่าเดิม (เช่นสลับ Pack) = มีผลทันที
export function classifyChange(current: Selection, next: Selection): 'upgrade' | 'downgrade' {
  if (current.cycle === 'yearly' && next.cycle === 'monthly') return 'downgrade'
  return monthlyValue(next) >= monthlyValue(current) ? 'upgrade' : 'downgrade'
}
