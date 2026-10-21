import { createHash, randomBytes, randomUUID } from 'crypto'
import db from '../db/sqlite'
import { getLoyaltySettings } from './loyaltySettings'

// ลูกค้าทั่วไป (ยังไม่เป็นสมาชิก) ที่กดยินยอมให้เครื่องจำรายการอาหารที่เคยสั่ง
// เก็บเฉพาะ token_hash ในฐานข้อมูลเหมือน posMember.service.ts · ไม่เก็บชื่อหรือเบอร์โทร · ลบได้ทุกเมื่อตาม PDPA

export const GUEST_COOKIE = 'phq_guest'
export const GUEST_DAYS = 180

const mintGuestToken = (): string => randomBytes(32).toString('base64url')
const hash = (token: string) => createHash('sha256').update(token).digest('hex')

export interface GuestOrderItem {
  menuId: string
  name: string
  qty: number
}

export interface GuestDevice {
  id: string
  tenant_id: string
  consent_at: string
  visits: number
  spent: number
  item_counts: string
  last_order: string
  last_visit_at: string | null
  created_at: string
  expires_at: string
}

/** ลบแถวลูกค้าทั่วไปที่หมดอายุแล้วแบบ opportunistic เพื่อไม่ให้ค้างในระบบ */
function pruneExpired(tenantId: string, nowIso: string): void {
  const expired = db.prepare('SELECT id FROM pos_guest_devices WHERE tenant_id = ? AND expires_at <= ?')
    .all(tenantId, nowIso) as { id: string }[]
  if (!expired.length) return
  const delItems = db.prepare('DELETE FROM pos_guest_bill_items WHERE tenant_id = ? AND guest_id = ?')
  const delGuest = db.prepare('DELETE FROM pos_guest_devices WHERE id = ? AND tenant_id = ?')
  for (const g of expired) {
    delItems.run(tenantId, g.id)
    delGuest.run(g.id, tenantId)
  }
}

export function getGuest(tenantId: string, token: unknown): GuestDevice | null {
  if (typeof token !== 'string' || !token || token.length > 100) return null
  const now = new Date()
  const nowIso = now.toISOString()
  pruneExpired(tenantId, nowIso)
  const row = db.prepare(`
    SELECT id, tenant_id, consent_at, visits, spent, item_counts, last_order, last_visit_at, created_at, expires_at
    FROM pos_guest_devices
    WHERE tenant_id = ? AND token_hash = ? AND expires_at > ?
  `).get(tenantId, hash(token), nowIso) as GuestDevice | undefined
  if (!row) return null
  const nextExpires = new Date(now.getTime() + GUEST_DAYS * 86400_000).toISOString()
  db.prepare('UPDATE pos_guest_devices SET expires_at = ? WHERE id = ? AND tenant_id = ?').run(nextExpires, row.id, tenantId)
  row.expires_at = nextExpires
  return row
}

export function createGuest(tenantId: string): { id: string; token: string } {
  const now = new Date()
  const nowIso = now.toISOString()
  pruneExpired(tenantId, nowIso)
  const id = randomUUID().replace(/-/g, '').substring(0, 25)
  const token = mintGuestToken()
  const expires = new Date(now.getTime() + GUEST_DAYS * 86400_000).toISOString()
  db.prepare(`
    INSERT INTO pos_guest_devices (id, tenant_id, token_hash, consent_at, visits, spent, item_counts, last_order, last_visit_at, created_at, expires_at)
    VALUES (?, ?, ?, ?, 0, 0, '{}', '[]', NULL, ?, ?)
  `).run(id, tenantId, hash(token), nowIso, nowIso, expires)
  return { id, token }
}

/** ผูกรายการในบิลที่สั่งผ่าน QR เข้ากับเครื่องลูกค้าทั่วไป (เฉพาะของบิลนี้, created_by = 'QR', และยังไม่ถูกผูก) */
export function linkItems(tenantId: string, guestId: string, billId: string, itemIds: unknown): number {
  if (!Array.isArray(itemIds) || !itemIds.length || !guestId || !billId) return 0
  const ids = [...new Set(itemIds.map(x => String(x ?? '')).filter(Boolean))].slice(0, 100)
  if (!ids.length) return 0
  const validItems = db.prepare(`
    SELECT id FROM pos_bill_items
    WHERE tenant_id = ? AND bill_id = ? AND created_by = 'QR'
      AND id IN (${ids.map(() => '?').join(',')})
      AND NOT EXISTS (SELECT 1 FROM pos_guest_bill_items gbi WHERE gbi.bill_item_id = pos_bill_items.id)
  `).all(tenantId, billId, ...ids) as { id: string }[]
  if (!validItems.length) return 0
  const ins = db.prepare(`
    INSERT OR IGNORE INTO pos_guest_bill_items (bill_item_id, guest_id, tenant_id, bill_id)
    VALUES (?, ?, ?, ?)
  `)
  let linked = 0
  db.transaction(() => {
    for (const it of validItems) {
      linked += ins.run(it.id, guestId, tenantId, billId).changes
    }
  })()
  return linked
}

export function forgetGuest(tenantId: string, token: unknown): void {
  if (typeof token !== 'string' || !token || token.length > 100) return
  const h = hash(token)
  db.transaction(() => {
    const row = db.prepare('SELECT id FROM pos_guest_devices WHERE tenant_id = ? AND token_hash = ?')
      .get(tenantId, h) as { id: string } | undefined
    if (!row) return
    db.prepare('DELETE FROM pos_guest_bill_items WHERE tenant_id = ? AND guest_id = ?').run(tenantId, row.id)
    db.prepare('DELETE FROM pos_guest_devices WHERE id = ? AND tenant_id = ?').run(row.id, tenantId)
  })()
}

/** คำนวณแต้มย้อนหลังเมื่อลูกค้าทั่วไปสมัครสมาชิก: min(cap, floor(spent / earnRate)) */
export function retroPoints(tenantId: string, guest: { spent?: number } | null | undefined): number {
  if (!guest) return 0
  const loyalty = getLoyaltySettings(tenantId)
  if (!loyalty.enabled || loyalty.retroCap <= 0 || loyalty.earnRate <= 0) return 0
  const spent = Math.max(0, Number(guest.spent) || 0)
  return Math.min(loyalty.retroCap, Math.floor(spent / loyalty.earnRate))
}

/**
 * เรียกใน payTx ตอนบิลชำระเงิน:
 * อัปเดต visits+1, last_visit_at, รวม item_counts ตาม pos_menu_id, บันทึก last_order ของบิลนี้
 * และบวกยอดรายการของเครื่องนั้นเข้า spent เฉพาะเมื่อบิลไม่มีสมาชิก (กันนับแต้มซ้ำกับสมาชิกที่ผูกบิล)
 */
export function recordPaidBill(tenantId: string, billId: string, billHasMember: boolean): void {
  const nowIso = new Date().toISOString()
  pruneExpired(tenantId, nowIso)
  const rows = db.prepare(`
    SELECT gbi.guest_id, bi.pos_menu_id, bi.product_name, bi.quantity, bi.total_price
    FROM pos_guest_bill_items gbi
    JOIN pos_bill_items bi ON bi.id = gbi.bill_item_id AND bi.bill_id = gbi.bill_id AND bi.tenant_id = gbi.tenant_id
    WHERE gbi.tenant_id = ? AND gbi.bill_id = ?
    ORDER BY bi.added_at ASC, bi.rowid ASC
  `).all(tenantId, billId) as {
    guest_id: string
    pos_menu_id: string | null
    product_name: string
    quantity: number
    total_price: number
  }[]
  if (!rows.length) return

  const byGuest = new Map<string, typeof rows>()
  for (const r of rows) {
    const list = byGuest.get(r.guest_id) || []
    list.push(r)
    byGuest.set(r.guest_id, list)
  }

  const getGuestRow = db.prepare('SELECT id, visits, spent, item_counts FROM pos_guest_devices WHERE id = ? AND tenant_id = ?')
  const updateGuestRow = db.prepare(`
    UPDATE pos_guest_devices
    SET visits = ?, spent = ?, item_counts = ?, last_order = ?, last_visit_at = ?
    WHERE id = ? AND tenant_id = ?
  `)

  for (const [guestId, items] of byGuest.entries()) {
    const guest = getGuestRow.get(guestId, tenantId) as { id: string; visits: number; spent: number; item_counts: string } | undefined
    if (!guest) continue

    let counts: Record<string, number> = {}
    try {
      const parsed = JSON.parse(guest.item_counts || '{}')
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) counts = parsed
    } catch { counts = {} }

    const orderMap = new Map<string, GuestOrderItem>()
    let guestSpent = 0
    for (const it of items) {
      const qty = Number(it.quantity) || 0
      if (qty <= 0) continue
      guestSpent += Number(it.total_price) || 0
      if (!it.pos_menu_id) continue
      counts[it.pos_menu_id] = (Number(counts[it.pos_menu_id]) || 0) + qty
      const prev = orderMap.get(it.pos_menu_id)
      if (prev) {
        prev.qty += qty
      } else {
        orderMap.set(it.pos_menu_id, { menuId: it.pos_menu_id, name: it.product_name, qty })
      }
    }

    const lastOrder = [...orderMap.values()]
    const nextVisits = (Number(guest.visits) || 0) + 1
    const nextSpent = (Number(guest.spent) || 0) + (billHasMember ? 0 : guestSpent)

    updateGuestRow.run(
      nextVisits,
      nextSpent,
      JSON.stringify(counts),
      JSON.stringify(lastOrder),
      nowIso,
      guestId,
      tenantId
    )
  }
}

/** ข้อมูลสำหรับส่งให้หน้า QR ใน GET /session (กรองเฉพาะเมนูที่ยังเปิดขายในร้าน พร้อมสถานะ available และเมนูที่สั่งบ่อยสุด) */
export function guestView(tenantId: string, guest: GuestDevice | null) {
  if (!guest) return null
  const menus = db.prepare(`
    SELECT pmc.id, COALESCE(si.name, si.sku, 'เมนู') AS name, pmc.is_available, pmc.is_pos_enabled
    FROM pos_menu_configs pmc
    LEFT JOIN stock_items si ON si.id = pmc.product_id
    WHERE pmc.tenant_id = ?
  `).all(tenantId) as { id: string; name: string; is_available: number; is_pos_enabled: number }[]
  const menuById = new Map(menus.map(m => [m.id, m]))

  let rawLast: GuestOrderItem[] = []
  try {
    const parsed = JSON.parse(guest.last_order || '[]')
    if (Array.isArray(parsed)) rawLast = parsed
  } catch { rawLast = [] }

  const lastOrder = rawLast
    .filter(it => {
      if (!it || !it.menuId) return false
      const m = menuById.get(it.menuId)
      return Boolean(m && m.is_pos_enabled === 1)
    })
    .map(it => {
      const m = menuById.get(it.menuId)!
      return {
        menuId: it.menuId,
        name: m.name || it.name,
        qty: Number(it.qty) || 1,
        available: m.is_available === 1,
      }
    })

  let counts: Record<string, number> = {}
  try {
    const parsed = JSON.parse(guest.item_counts || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) counts = parsed
  } catch { counts = {} }

  let favorite: string | null = null
  let maxCount = 0
  for (const [menuId, rawCount] of Object.entries(counts)) {
    const c = Number(rawCount) || 0
    if (c > maxCount) {
      const m = menuById.get(menuId)
      const fallbackName = rawLast.find(x => x?.menuId === menuId)?.name
      const name = m?.name || fallbackName || null
      if (name) {
        maxCount = c
        favorite = name
      }
    }
  }

  return {
    visits: Number(guest.visits) || 0,
    lastOrder,
    favorite,
    retroPoints: retroPoints(tenantId, guest),
  }
}
