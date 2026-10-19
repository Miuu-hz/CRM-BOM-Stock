import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { hasFeature } from './subscription.service'

// เฟส 3–4 ของ QR สั่งที่โต๊ะ: โปรโมชัน, แลกแต้มเป็นของแถม, Pop-up โฆษณา (add-on qr_ad)

/** วันที่/เวลาตอนนี้ตามเวลาไทย — ช่วงโปร/โฆษณาตั้งเป็นเวลาร้าน ไม่ใช่ UTC */
export function thaiNow(d = new Date()): { date: string; time: string } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map(x => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }
}

const inDateRange = (date: string, from?: string | null, to?: string | null) => (!from || date >= from) && (!to || date <= to)

export function activePromotions(tenantId: string, isMember: boolean) {
  const { date } = thaiNow()
  return (db.prepare(`
    SELECT p.id, p.title, p.description, p.pos_menu_id AS menuId, p.members_only, p.starts_on, p.ends_on,
           pmc.is_available AS menu_available, pmc.is_pos_enabled AS menu_enabled
    FROM pos_promotions p LEFT JOIN pos_menu_configs pmc ON pmc.id = p.pos_menu_id AND pmc.tenant_id = p.tenant_id
    WHERE p.tenant_id = ? AND p.is_active = 1 ORDER BY p.sort_order, p.created_at
  `).all(tenantId) as any[])
    .filter(p => inDateRange(date, p.starts_on, p.ends_on))
    .map(p => ({
      id: p.id, title: p.title, description: p.description || '', endsOn: p.ends_on || null, membersOnly: p.members_only === 1,
      // ปุ่ม "สั่งเลย" เฉพาะเมนูที่ยังขายอยู่ และโปรสมาชิกต้องเป็นสมาชิกก่อน
      menuId: p.menuId && p.menu_enabled === 1 && p.menu_available === 1 && (!p.members_only || isMember) ? p.menuId : null,
    }))
}

export function activeRewards(tenantId: string) {
  return (db.prepare(`
    SELECT r.id, r.name, r.points_cost AS points, pmc.is_available AS available
    FROM pos_rewards r JOIN pos_menu_configs pmc ON pmc.id = r.pos_menu_id AND pmc.tenant_id = r.tenant_id
    WHERE r.tenant_id = ? AND r.is_active = 1 AND pmc.is_pos_enabled = 1 ORDER BY r.sort_order, r.points_cost
  `).all(tenantId) as any[]).map(r => ({ ...r, available: r.available === 1 }))
}

/** แต้มที่จองไว้กับบิลที่ยังเปิดอยู่ (ยังไม่ตัดจริง) — แต้มที่ใช้ได้ = loyalty_points − ตัวนี้ */
export function reservedPoints(tenantId: string, customerId: string): number {
  return (db.prepare(`
    SELECT COALESCE(SUM(r.points), 0) AS n FROM pos_redemptions r
    JOIN pos_running_bills b ON b.id = r.bill_id AND b.status = 'OPEN'
    JOIN pos_bill_items bi ON bi.id = r.bill_item_id
    WHERE r.tenant_id = ? AND r.customer_id = ? AND r.status = 'RESERVED'
  `).get(tenantId, customerId) as any).n
}

export class RewardError extends Error {}

/**
 * แลกแต้มตอนส่งออเดอร์: ของแถมเข้าบิลราคา 0 + จองแต้มไว้ (ต้องเรียกใน transaction เดียวกับการลงรายการ)
 * คืน bill_item_id ที่สร้าง เพื่อส่งครัวพร้อมรายการอื่น
 */
export function reserveRewards(tenantId: string, billId: string, customerId: string, rewardIds: string[]): string[] {
  if (!rewardIds.length) return []
  const member = db.prepare('SELECT loyalty_points FROM customers WHERE id = ? AND tenant_id = ?').get(customerId, tenantId) as any
  let available = Math.floor(member?.loyalty_points || 0) - reservedPoints(tenantId, customerId)
  const now = new Date().toISOString()
  const ids: string[] = []
  for (const rewardId of rewardIds) {
    const r = db.prepare(`
      SELECT r.id, r.name, r.points_cost, r.pos_menu_id, pmc.is_available, pmc.is_pos_enabled
      FROM pos_rewards r JOIN pos_menu_configs pmc ON pmc.id = r.pos_menu_id AND pmc.tenant_id = r.tenant_id
      WHERE r.id = ? AND r.tenant_id = ? AND r.is_active = 1
    `).get(rewardId, tenantId) as any
    if (!r || r.is_pos_enabled !== 1 || r.is_available !== 1) throw new RewardError('ของรางวัลนี้แลกไม่ได้แล้ว')
    if (r.points_cost > available) throw new RewardError(`แต้มไม่พอแลก ${r.name} (ขาดอีก ${r.points_cost - available} แต้ม)`)
    available -= r.points_cost
    const itemId = generateId()
    db.prepare(`INSERT INTO pos_bill_items (id, tenant_id, bill_id, pos_menu_id, product_name, quantity, unit_price, total_price,
        special_instructions, created_by) VALUES (?, ?, ?, ?, ?, 1, 0, 0, ?, 'QR')`)
      .run(itemId, tenantId, billId, r.pos_menu_id, `🎁 ${r.name}`, `แลก ${r.points_cost} แต้ม`)
    db.prepare(`INSERT INTO pos_redemptions (id, tenant_id, bill_id, customer_id, reward_id, bill_item_id, points, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'RESERVED', ?)`).run(generateId(), tenantId, billId, customerId, r.id, itemId, r.points_cost, now)
    ids.push(itemId)
  }
  return ids
}

/** ก่อนรับชำระ: ของแถมที่จองแต้มไว้ต้องเป็นของสมาชิกคนเดียวกับที่ผูกบิลอยู่ (แคชเชียร์อาจเปลี่ยน/ถอดสมาชิกไปแล้ว) */
export function billRewardConflict(tenantId: string, billId: string, customerId: string | null): string | null {
  const other = db.prepare(`
    SELECT 1 FROM pos_redemptions r JOIN pos_bill_items bi ON bi.id = r.bill_item_id
    WHERE r.tenant_id = ? AND r.bill_id = ? AND r.status = 'RESERVED' AND r.customer_id IS NOT ?
  `).get(tenantId, billId, customerId)
  return other ? 'บิลนี้มีของแถมแลกแต้มของสมาชิกที่ไม่ได้ผูกกับบิลอยู่ — ผูกสมาชิกคนเดิมกลับ หรือลบรายการของแถมก่อนรับชำระ' : null
}

/** ตอนรับชำระ (ใน transaction ของการจ่าย): ตัดแต้มของแถมที่ยังอยู่ในบิล · รายการที่ถูกลบไปแล้ว = คืนแต้ม คืนจำนวนแต้มที่ตัด */
export function useBillRewards(tenantId: string, billId: string): number {
  const rows = db.prepare(`
    SELECT r.id, r.points, bi.id AS item_id FROM pos_redemptions r LEFT JOIN pos_bill_items bi ON bi.id = r.bill_item_id
    WHERE r.tenant_id = ? AND r.bill_id = ? AND r.status = 'RESERVED'
  `).all(tenantId, billId) as any[]
  let used = 0
  for (const r of rows) {
    db.prepare('UPDATE pos_redemptions SET status = ? WHERE id = ?').run(r.item_id ? 'USED' : 'RETURNED', r.id)
    if (r.item_id) used += r.points
  }
  return used
}

/** Pop-up โฆษณาที่ควรขึ้นตอนนี้ — ต้องซื้อ add-on qr_ad, เปิดอยู่, ไม่ถูกระงับ, อยู่ในช่วงวัน/เวลาที่ตั้ง */
export function activeAd(tenantId: string) {
  if (!hasFeature(tenantId, 'qr_ad')) return null
  const a = db.prepare('SELECT * FROM pos_ad_slots WHERE tenant_id = ?').get(tenantId) as any
  if (!a || !a.image_url || a.is_enabled !== 1 || a.suspended_at) return null
  const { date, time } = thaiNow()
  if (!inDateRange(date, a.starts_on, a.ends_on)) return null
  if (a.daily_start && a.daily_end) {
    // ช่วงข้ามเที่ยงคืน (22:00–02:00) ก็ใช้ได้
    const inWindow = a.daily_start <= a.daily_end ? time >= a.daily_start && time < a.daily_end : time >= a.daily_start || time < a.daily_end
    if (!inWindow) return null
  }
  return { image: a.image_url, link: a.link_type || 'none', menuId: a.link_type === 'menu' ? a.link_menu_id : null, version: a.updated_at }
}
