import db from '../db/sqlite'
import { randomUUID } from 'crypto'
import { PlatformMonthError } from './platformMonth.service'
import { findPlatformAlias, upsertPlatformAlias, deletePlatformAlias, StockItemRefError, isServiceItem } from './stockItem.service'
import { resolveMenuBomId } from './pos-stock.service'
import { autoUnpackIfNeeded } from './unitConversion.service'
import { roundQty } from '../utils/qty'
import { ACC } from '../config/accountCodes'

// ============================================================
// เฟส 2: จับคู่ SKU (ชื่อรอง stock_item_aliases, source_ref = '<PLATFORM>:<variant_id>' หรือ
// '<PLATFORM>:P<product_id>') + ยืนยันการขาย (ตัดสต็อกจริง) — ไม่ลงบัญชีเลยในเฟสนี้
// (เฟส 3 ค่อยลง JV จาก cogs_amount/cogs_breakdown ที่เก็บไว้ตรงนี้)
// ============================================================

const id25 = () => randomUUID().replace(/-/g, '').slice(0, 25)

export function sourceRefOf(platform: string, row: { product_id?: string | null; variant_id?: string | null }): string {
  const p = String(platform || '').toUpperCase()
  if (row.variant_id) return `${p}:${row.variant_id}`
  return `${p}:P${row.product_id}`
}

function getMonthRow(tenantId: string, monthId: string): any {
  const row = db.prepare(`SELECT * FROM platform_months WHERE id = ? AND tenant_id = ?`).get(monthId, tenantId) as any
  if (!row) throw new PlatformMonthError('ไม่พบรอบเดือนนี้')
  return row
}

/**
 * แถวที่ "ต้องมีการจับคู่ SKU" ของรอบนี้ — ตัวเลือก (variant) ที่ขายได้ (qty_confirmed > 0) ทุกตัว
 * บวกสินค้าที่ไม่มีตัวเลือกเลย (parent ที่ขายได้ แต่ไม่มีแถว variant ของสินค้านั้นในรอบเดียวกัน)
 */
function neededRows(monthId: string): any[] {
  // ponytail: ใช้ NOT EXISTS (correlated) แทน NOT IN — NOT IN กับเซ็ตย่อยที่มี NULL (variant
  // บางแถว product_id เป็น NULL) จะกลาย NULL ทั้งนิพจน์ตาม 3-value logic ของ SQL ทำ parent
  // ที่ไม่มีตัวเลือกทุกตัวหลุดจากรายการเงียบๆ ไม่ใช่แค่ตัวที่ product_id ชนกับ NULL
  return db.prepare(`
    SELECT * FROM platform_month_products p
    WHERE p.month_id = ? AND (
      (p.level = 'variant' AND p.qty_confirmed > 0)
      OR (p.level = 'parent' AND p.qty_confirmed > 0 AND NOT EXISTS (
        SELECT 1 FROM platform_month_products v
        WHERE v.month_id = p.month_id AND v.level = 'variant' AND v.product_id = p.product_id
      ))
    )
  `).all(monthId) as any[]
}

export interface MappingRow {
  sourceRef: string
  productId: string | null
  variantId: string | null
  level: 'parent' | 'variant'
  productName: string | null
  variantName: string | null
  qtyConfirmed: number
  mapped: boolean
  stockItemId: string | null
  sku: string | null
  stockItemName: string | null
  unit: string | null
  unitCost: number | null
  quantity: number | null
  hasBom: boolean
  factor: number | null
  proposed: boolean
  proposedStockItemId: string | null
  proposedSku: string | null
  proposedStockItemName: string | null
  proposedFactor: number | null
}

export function getMappingRows(tenantId: string, monthId: string): MappingRow[] {
  const month = getMonthRow(tenantId, monthId)
  const rows = neededRows(monthId)

  return rows.map((r) => {
    const sourceRef = sourceRefOf(month.platform, r)
    const alias = findPlatformAlias(tenantId, sourceRef)
    const proposal = db.prepare(`SELECT * FROM platform_sku_proposals WHERE tenant_id = ? AND source_ref = ?`).get(tenantId, sourceRef) as any

    let stockItem: any = null
    if (alias) stockItem = db.prepare(`SELECT id, sku, name, unit, base_unit, unit_cost, quantity FROM stock_items WHERE id = ? AND tenant_id = ?`).get(alias.stockItemId, tenantId)
    let proposedItem: any = null
    if (proposal) proposedItem = db.prepare(`SELECT id, sku, name FROM stock_items WHERE id = ? AND tenant_id = ?`).get(proposal.stock_item_id, tenantId)

    return {
      sourceRef,
      productId: r.product_id,
      variantId: r.variant_id,
      level: r.level,
      productName: r.product_name,
      variantName: r.variant_name,
      qtyConfirmed: Number(r.qty_confirmed) || 0,
      mapped: !!stockItem,
      stockItemId: stockItem?.id ?? null,
      sku: stockItem?.sku ?? null,
      stockItemName: stockItem?.name ?? null,
      unit: stockItem ? (stockItem.base_unit || stockItem.unit) : null,
      unitCost: stockItem ? Number(stockItem.unit_cost) || 0 : null,
      quantity: stockItem ? Number(stockItem.quantity) || 0 : null,
      hasBom: stockItem ? !!resolveMenuBomId(tenantId, null, stockItem.id) : false,
      factor: alias?.factor ?? null,
      proposed: !!proposal && !stockItem,
      proposedStockItemId: proposedItem?.id ?? null,
      proposedSku: proposedItem?.sku ?? null,
      proposedStockItemName: proposedItem?.name ?? null,
      proposedFactor: proposal ? Number(proposal.factor) : null,
    }
  })
}

export function getMonthsList(tenantId: string, platform?: string): any[] {
  return db.prepare(`
    SELECT id, platform, shop_key, month, status, period_start, period_end, cogs_amount, sale_confirmed_at
    FROM platform_months WHERE tenant_id = ? ${platform ? 'AND platform = ?' : ''}
    ORDER BY month DESC
  `).all(...(platform ? [tenantId, platform] : [tenantId])) as any[]
}

/** สรุปจำนวนผูกแล้ว/มีข้อเสนอรอยืนยัน/ยังไม่ผูก — ใช้ขยาย platform_month_status ของ MCP */
export function getMappingSummary(tenantId: string, monthId: string): { mapped: number; proposed: number; unmapped: number; total: number } {
  const rows = getMappingRows(tenantId, monthId)
  const mapped = rows.filter((r) => r.mapped).length
  const proposed = rows.filter((r) => r.proposed).length
  return { mapped, proposed, unmapped: rows.length - mapped - proposed, total: rows.length }
}

// ── MCP เสนอคู่ (ไม่ผูกจริง) ───────────────────────────────────────────────────────────────
export interface ProposePair {
  variantId?: string | null
  productId?: string | null
  sku?: string
  stockItemId?: string
  factor: number
}

export function proposeSkuMapping(
  tenantId: string,
  input: { platform: string; shopKey: string; month: string; pairs: ProposePair[] },
  userId: string,
): { accepted: number; rejected: Array<{ pair: ProposePair; reason: string }> } {
  const month = db.prepare(`SELECT * FROM platform_months WHERE tenant_id = ? AND platform = ? AND shop_key = ? AND month = ?`)
    .get(tenantId, input.platform, input.shopKey, input.month) as any
  if (!month) throw new PlatformMonthError('ไม่พบรอบเดือนนี้ — ส่งไฟล์ products เข้ารอบนี้ก่อน')

  let accepted = 0
  const rejected: Array<{ pair: ProposePair; reason: string }> = []
  const now = new Date().toISOString()

  for (const pair of input.pairs) {
    try {
      const sourceRef = sourceRefOf(input.platform, { product_id: pair.productId, variant_id: pair.variantId })
      let stockItemId = pair.stockItemId
      if (!stockItemId && pair.sku) {
        const found = db.prepare(`SELECT id FROM stock_items WHERE tenant_id = ? AND sku = ?`).get(tenantId, pair.sku) as any
        if (!found) throw new PlatformMonthError(`ไม่พบ SKU "${pair.sku}" ในคลัง`)
        stockItemId = found.id
      }
      if (!stockItemId) throw new PlatformMonthError('ต้องระบุ sku หรือ stock_item_id')
      if (!db.prepare(`SELECT 1 FROM stock_items WHERE id = ? AND tenant_id = ?`).get(stockItemId, tenantId)) {
        throw new PlatformMonthError('ไม่พบสินค้าในคลังของเทแนนต์นี้')
      }
      const factor = Number(pair.factor) || 1
      db.prepare(`
        INSERT INTO platform_sku_proposals (id, tenant_id, source_ref, stock_item_id, factor, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, source_ref) DO UPDATE SET stock_item_id = excluded.stock_item_id, factor = excluded.factor, created_by = excluded.created_by, created_at = excluded.created_at
      `).run(id25(), tenantId, sourceRef, stockItemId, factor, userId, now)
      accepted++
    } catch (err: any) {
      rejected.push({ pair, reason: err?.message || String(err) })
    }
  }
  return { accepted, rejected }
}

// ── คนยืนยันคู่ ─────────────────────────────────────────────────────────────────────────────
function rowNameOf(tenantId: string, monthId: string, sourceRef: string): string {
  const platform = getMonthRow(tenantId, monthId).platform
  const row = neededRows(monthId).find((r) => sourceRefOf(platform, r) === sourceRef)
  return row ? [row.product_name, row.variant_name].filter(Boolean).join(' · ') : sourceRef
}

export function confirmMapping(
  tenantId: string,
  input: { monthId: string; sourceRef: string; stockItemId: string; factor: number },
  userId: string,
): void {
  const name = rowNameOf(tenantId, input.monthId, input.sourceRef)
  const item = db.prepare(`SELECT COALESCE(NULLIF(base_unit, ''), unit) AS base FROM stock_items WHERE id = ? AND tenant_id = ?`).get(input.stockItemId, tenantId) as any
  if (!item) throw new StockItemRefError('ไม่พบสินค้าในคลัง')
  upsertPlatformAlias(tenantId, { sourceRef: input.sourceRef, name, stockItemId: input.stockItemId, unit: item.base, factor: Number(input.factor) || 1 }, userId)
  db.prepare(`DELETE FROM platform_sku_proposals WHERE tenant_id = ? AND source_ref = ?`).run(tenantId, input.sourceRef)
}

export function acceptAllProposals(tenantId: string, monthId: string, userId: string): { accepted: number } {
  const rows = getMappingRows(tenantId, monthId)
  let accepted = 0
  for (const r of rows) {
    if (r.proposed && r.proposedStockItemId) {
      confirmMapping(tenantId, { monthId, sourceRef: r.sourceRef, stockItemId: r.proposedStockItemId, factor: r.proposedFactor || 1 }, userId)
      accepted++
    }
  }
  return { accepted }
}

export function deleteMapping(tenantId: string, sourceRef: string): void {
  deletePlatformAlias(tenantId, sourceRef)
}

// ── ยืนยันการขาย (ตัดสต็อกจริง) ────────────────────────────────────────────────────────────
export interface CogsLine {
  stockItemId: string
  stockItemName: string
  qty: number
  unitCost: number
  amount: number
  inventoryAccount: string
}

const REF_PREFIX = 'PLATFORM_MONTH:'

export function confirmSale(tenantId: string, monthId: string, userId: string): { cogsAmount: number; breakdown: CogsLine[] } {
  const month = getMonthRow(tenantId, monthId)
  // #1: เดิมเช็คแค่ === 'SALE_CONFIRMED' ไม่กัน POSTED — ยืนยันซ้ำหลังโพสต์แล้วตัดสต็อกซ้ำ
  // + ย้อนสถานะกลับ SALE_CONFIRMED ทั้งที่ posted_at/journal_ids ยังอยู่ (JV ลอยค้าง GL)
  if (month.status !== 'COLLECTING') throw new PlatformMonthError(`ยืนยันการขายไม่ได้ — รอบนี้อยู่ในสถานะ ${month.status} แล้ว`)

  const rows = neededRows(monthId)
  if (rows.length === 0) throw new PlatformMonthError('รอบนี้ไม่มีรายการขายที่ต้องตัดสต็อก')

  // ── เช็คว่าผูก SKU ครบทุกแถวก่อน ไม่ครบห้ามตัดสต็อกเลยสักรายการ ──
  const unmapped: string[] = []
  const lines: Array<{ sourceRef: string; qty: number; alias: ReturnType<typeof findPlatformAlias> }> = []
  for (const r of rows) {
    const sourceRef = sourceRefOf(month.platform, r)
    const alias = findPlatformAlias(tenantId, sourceRef)
    if (!alias) {
      unmapped.push([r.product_name, r.variant_name].filter(Boolean).join(' · ') || sourceRef)
      continue
    }
    lines.push({ sourceRef, qty: Number(r.qty_confirmed) || 0, alias })
  }
  if (unmapped.length > 0) {
    throw new PlatformMonthError(`ยืนยันการขายไม่ได้ — ยังไม่ผูก SKU ${unmapped.length} รายการ: ${unmapped.slice(0, 10).join(', ')}${unmapped.length > 10 ? ' ...' : ''}`)
  }

  const setting = db.prepare('SELECT allow_negative_stock FROM company_settings WHERE tenant_id = ?').get(tenantId) as any
  const allowNegativeStock = !!setting && setting.allow_negative_stock === 1

  return db.transaction(() => {
    // #10: ไม่แตก BOM แล้ว — ขายผ่านแพลตฟอร์มคือใบสั่งขายทางหนึ่ง (platform sale ≈ SO) และ
    // deductStockForSO (routes/sales/shared.ts) ก็ไม่แตก BOM เหมือนกัน ตัดสต็อกตัวที่ผูกไว้
    // ตรงๆ เสมอ — เทแนนต์นี้ผลิตของสำเร็จเข้าสต็อกผ่าน WO ก่อนขาย แตก BOM ตรงนี้จะตัดวัตถุดิบ
    // ซ้ำสอง (ของสำเร็จถูกตัดออกจาก WO ไปแล้วตอนผลิต) โดยสต็อกของสำเร็จที่ขายจริงไม่ลดเลย
    // (#4 — หน่วยสูตร/หน่วยสต็อกไม่ตรงกันตอนแตก BOM — จึงตกไปด้วยเพราะไม่มีการแตก BOM ให้แปลงหน่วยแล้ว)
    // ของเดียวกันโผล่หลายรายการ (คนละ source_ref ชี้ของตัวเดียวกัน) → รวมเป็นยอดเดียว
    const deduction = new Map<string, number>()
    for (const line of lines) {
      const qty = line.qty * (line.alias!.factor || 1)
      if (qty <= 0) continue
      deduction.set(line.alias!.stockItemId, (deduction.get(line.alias!.stockItemId) || 0) + qty)
    }

    const now = new Date().toISOString()
    // #8: created_at เดิมเป็นเวลาคลิก (now) ไม่ใช่วันที่ในรอบ — ใบส่งของ/รายงานสต็อกรายเดือนนับ
    // เดือนผิดถ้ากดยืนยันข้ามเดือน ใช้ปลายรอบ (period_end) แทนเหมือนใบส่งของอื่นๆ ที่ลงวันที่เอกสาร
    const createdAt = month.period_end ? `${month.period_end}T23:59:59.999Z` : now
    const reference = `${REF_PREFIX}${monthId}`
    const breakdown: CogsLine[] = []
    const shortfalls: string[] = []

    for (const [stockItemId, qty] of deduction) {
      const item = db.prepare('SELECT id, name, category, quantity, sealed_qty, base_unit, unit, display_unit, unit_cost FROM stock_items WHERE id = ? AND tenant_id = ?').get(stockItemId, tenantId) as any
      if (!item) { shortfalls.push(`ไม่พบสินค้า ${stockItemId} ในคลัง`); continue }
      // #8: ค่าขนส่ง/ค่าแพ็ค (SERVICE) ไม่มีของให้ตัด — เหมือน deductStockForSO/POS
      if (isServiceItem(item)) continue

      const roundedQty = Math.round(qty * 10000) / 10000

      // #8: แกะแพ็คอัตโนมัติถ้าของพอดีรวมที่ปิดผนึกอยู่ แบบเดียวกับ deductStockForSO
      let quantity = item.quantity
      let sealedQty = item.sealed_qty
      if (quantity < roundedQty && (sealedQty ?? 0) > 0) {
        const unpack = autoUnpackIfNeeded({ ...item, quantity, sealed_qty: sealedQty }, roundedQty, tenantId)
        if (unpack && unpack.unpackedPacks > 0) {
          const released = roundQty(unpack.unpackedPacks * unpack.packFactor)
          db.prepare('UPDATE stock_items SET quantity = ?, sealed_qty = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
            .run(unpack.quantity, unpack.sealed_qty, now, stockItemId, tenantId)
          db.prepare(`
            INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by)
            VALUES (?, ?, ?, 'UNPACK', ?, ?, ?, ?, ?, ?, ?)
          `).run(id25(), tenantId, stockItemId, released, item.display_unit || null, unpack.unpackedPacks, reference,
            `แกะอัตโนมัติ (รอบ ${month.platform} ${month.month}) ${unpack.unpackedPacks} ${item.display_unit || ''} → +${released} ${item.base_unit || item.unit}`, now, userId)
          quantity = unpack.quantity
          sealedQty = unpack.sealed_qty
        }
      }

      if (quantity < roundedQty && !allowNegativeStock) {
        shortfalls.push(`${item.name}: มี ${quantity} ต้องตัด ${roundedQty} ${item.base_unit || item.unit}`)
        continue
      }
      // #9: ใช้ stock_items.unit_cost เหมือน POS (deductStockOnPayment)/dashboard — ไม่ใช่
      // getCostBasis().weightedAvg (เฉลี่ยถ่วงน้ำหนักตลอดชีพจากประวัติรับของ) ซึ่งเป็นคนละตัวเลข
      const unitCost = Number(item.unit_cost) || 0
      const amount = Math.round(roundedQty * unitCost * 100) / 100
      const inventoryAccount = ['FINISHED', 'WIP'].includes(String(item.category || '').toUpperCase()) ? ACC.INVENTORY : ACC.RAW_MATERIAL

      db.prepare('UPDATE stock_items SET quantity = quantity - ?, updated_at = ? WHERE id = ? AND tenant_id = ?').run(roundedQty, now, stockItemId, tenantId)
      db.prepare(`
        INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by)
        VALUES (?, ?, ?, 'OUT', ?, ?, ?, ?, ?, ?, ?)
      `).run(id25(), tenantId, stockItemId, roundedQty, item.base_unit || item.unit, roundedQty, reference,
        `ยืนยันการขายรอบ ${month.platform} ${month.month}`, createdAt, userId)

      breakdown.push({ stockItemId, stockItemName: item.name, qty: roundedQty, unitCost, amount, inventoryAccount })
    }

    if (shortfalls.length > 0) {
      throw new PlatformMonthError(`สต็อกไม่พอ (allow_negative_stock ปิดอยู่): ${shortfalls.join('; ')}`)
    }

    const cogsAmount = Math.round(breakdown.reduce((s, b) => s + b.amount, 0) * 100) / 100
    // #1: ทำ transition สถานะเป็นเงื่อนไขของ UPDATE เดียวกัน (WHERE status = 'COLLECTING') แล้วเช็ค
    // changes — ถ้ามีคำขออื่นแทรกเปลี่ยนสถานะไปก่อนแล้ว (race) แถวนี้จะไม่ถูกแก้และ throw ทำให้
    // ทรานแซกชันทั้งก้อน (รวมที่ตัดสต็อกไปแล้วข้างบน) rollback หมด ไม่มีสต็อกถูกตัดลอยค้าง
    const upd = db.prepare(`
      UPDATE platform_months SET status = 'SALE_CONFIRMED', cogs_amount = ?, cogs_breakdown = ?,
        sale_confirmed_at = ?, sale_confirmed_by = ?, updated_at = ? WHERE id = ? AND status = 'COLLECTING'
    `).run(cogsAmount, JSON.stringify(breakdown), now, userId, now, monthId)
    if (upd.changes !== 1) throw new PlatformMonthError('ยืนยันการขายไม่ได้ — รอบนี้ถูกยืนยัน/เปลี่ยนสถานะไปแล้วจากคำขออื่นพร้อมกัน')

    return { cogsAmount, breakdown }
  })()
}

export function cancelSale(tenantId: string, monthId: string, userId: string): void {
  const month = getMonthRow(tenantId, monthId)
  if (month.status === 'POSTED') throw new PlatformMonthError('รอบนี้ลงบัญชีไปแล้ว — ต้องยกเลิกการลงบัญชี (เฟส 3) ก่อน จึงยกเลิกการยืนยันการขายได้')
  if (month.status !== 'SALE_CONFIRMED') throw new PlatformMonthError('รอบนี้ยังไม่ได้ยืนยันการขาย')

  const reference = `${REF_PREFIX}${monthId}`
  const now = new Date().toISOString()

  db.transaction(() => {
    // เอาเฉพาะ OUT ที่ยังไม่เคยถูกคืน — ยืนยัน→ยกเลิก→ยืนยันใหม่ใช้ reference เดิม ถ้าไม่กรอง ยกเลิกรอบสองจะคืนสต็อกซ้ำ
    // ponytail: จับคู่ผ่าน notes "(<id OUT>)" ของแถว IN ที่คืนไปแล้ว — ถ้าเปลี่ยนรูปแบบ notes ต้องแก้ตรงนี้ด้วย
    const movements = db.prepare(`
      SELECT m.* FROM stock_movements m
      WHERE m.tenant_id = ? AND m.reference = ? AND m.type = 'OUT'
        AND NOT EXISTS (
          SELECT 1 FROM stock_movements r
          WHERE r.tenant_id = m.tenant_id AND r.reference = m.reference AND r.type = 'IN'
            AND r.notes LIKE '%(' || m.id || ')'
        )
    `).all(tenantId, reference) as any[]
    for (const m of movements) {
      db.prepare('UPDATE stock_items SET quantity = quantity + ?, updated_at = ? WHERE id = ? AND tenant_id = ?').run(m.quantity, now, m.stock_item_id, tenantId)
      db.prepare(`
        INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by)
        VALUES (?, ?, ?, 'IN', ?, ?, ?, ?, ?, ?, ?)
      `).run(id25(), tenantId, m.stock_item_id, m.quantity, m.movement_unit, m.movement_quantity, reference,
        `ยกเลิกยืนยันการขาย คืนสต็อก (${m.id})`, now, userId)
    }
    // #1: การ์ดเดียวกัน — อะตอมมิกด้วย WHERE เดียว + เช็ค posted_at/journal_ids ว่างด้วย (ไม่ใช่เชื่อ
    // แค่ status) กันพลาดถ้าบั๊กอื่นในอนาคตทำให้ status ย้อนมาเป็น SALE_CONFIRMED ทั้งที่โพสต์ไปแล้ว
    const upd = db.prepare(`
      UPDATE platform_months SET status = 'COLLECTING', cogs_amount = 0, cogs_breakdown = NULL,
        sale_confirmed_at = NULL, sale_confirmed_by = NULL, updated_at = ?
      WHERE id = ? AND status = 'SALE_CONFIRMED' AND (posted_at IS NULL OR posted_at = '') AND (journal_ids IS NULL OR journal_ids = '')
    `).run(now, monthId)
    if (upd.changes !== 1) throw new PlatformMonthError('ยกเลิกการยืนยันการขายไม่ได้ — รอบนี้ไม่ได้อยู่ในสถานะยืนยันการขาย หรือมีการลงบัญชีค้างอยู่')
  })()
}
