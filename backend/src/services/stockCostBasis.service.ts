import db from '../db/sqlite'
import { convertQuantityBidirectional, normalizeUnit } from './unitConversion.service'

/**
 * ต้นทุนและประวัติราคาของสินค้าในคลัง
 *
 * ⚠️ กับดักหน่วยที่ต้องระวังตลอดไฟล์นี้:
 *   purchase_order_items.unit_price = ราคาต่อ "หน่วยซื้อ" (ลัง / kg / hg)
 *   stock_items.quantity            = จำนวนใน "หน่วยฐาน" (g / ชิ้น)
 *   goods_receipt_items.stock_qty   = จำนวนหน่วยฐานที่เข้าคลังจริงของครั้งนั้น
 *
 * ของจริงที่เจอ: ขนมจีนถูกซื้อมาเป็น g / kg / hg ปนกัน ราคา 0.05 / 25 / 4.75
 *   เฉลี่ย unit_price ตรง ๆ  -> ฿13.30 ต่อ (อะไรก็ไม่รู้)   ผิดราว 470 เท่า
 *   ถ่วงน้ำหนักด้วย stock_qty -> ฿0.0281 ต่อกรัม            ถูก (25 บ./กก. = 0.025/g)
 * หารผิดตัวเดียวมูลค่าเพี้ยนหลักร้อยเท่าโดยไม่มีอะไรเตือน
 */

export interface CostSource {
  supplier: string | null
  doc: string
  date: string
  /** จำนวนตามหน่วยที่ซื้อ เช่น 8 hg */
  qty: number
  unit: string | null
  /** ราคาต่อหน่วยซื้อ */
  unitPrice: number
  /** จำนวนหน่วยฐานที่เข้าคลังจริง เช่น 800 g */
  baseQty: number
  /** มูลค่าของครั้งนั้น = qty × unitPrice */
  value: number
  /** ชื่อบนบรรทัดใบสั่งซื้อ — ไม่ตรงชื่อ SKU = ซื้อมาด้วยชื่อเรียกแทน (ยี่ห้อ B) */
  name?: string | null
}

export interface CostBasis {
  sources: CostSource[]
  /** ต้นทุนถ่วงน้ำหนักต่อ 1 หน่วยฐาน */
  weightedAvg: number
  totalBaseQty: number
  totalValue: number
  /** weighted = คิดจากประวัติรับเข้าจริง · fallback = ไม่มีประวัติ เลยใช้ unit_cost ที่เก็บไว้ */
  basis: 'weighted' | 'fallback'
  baseUnit: string | null
  /** แถวที่ข้ามไปเพราะไม่มี stock_qty จึงแปลงเป็นหน่วยฐานไม่ได้ */
  skipped: number
}

const SOURCE_SQL = `
  SELECT s.name AS supplier, gr.gr_number AS doc, gr.receipt_date AS date,
         gri.accepted_qty AS qty, poi.unit AS unit, poi.unit_price AS unitPrice,
         gri.stock_qty AS baseQty, poi.description AS name
    FROM goods_receipt_items gri
    JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
    JOIN purchase_order_items poi ON poi.id = gri.purchase_order_item_id
    LEFT JOIN suppliers s ON s.id = gr.supplier_id
   WHERE gri.stock_item_id = ? AND gri.tenant_id = ? AND gr.status = 'CONFIRMED'
   ORDER BY gr.receipt_date DESC, gr.gr_number DESC
`

const BUYBACK_SOURCE_SQL = `
  SELECT c.name AS supplier, bb.bb_number AS doc, bb.buyback_date AS date,
         bbi.quantity AS qty, bbi.unit AS unit, bbi.unit_price AS unitPrice,
         bbi.base_qty AS baseQty, bbi.cost_value AS costValue, bbi.product_name AS name
    FROM customer_buyback_items bbi
    JOIN customer_buybacks bb ON bb.id = bbi.buyback_id AND bb.tenant_id = bbi.tenant_id
    LEFT JOIN customers c ON c.id = bb.customer_id AND c.tenant_id = bb.tenant_id
   WHERE bbi.stock_item_id = ? AND bbi.tenant_id = ? AND bb.status = 'POSTED' AND bbi.condition = 'GOOD'
   ORDER BY bb.buyback_date DESC, bb.bb_number DESC
`

export function getCostBasis(tenantId: string, stockItemId: string): CostBasis {
  const item = db.prepare('SELECT unit_cost, base_unit, unit FROM stock_items WHERE id = ? AND tenant_id = ?')
    .get(stockItemId, tenantId) as any
  const baseUnit = item ? (item.base_unit || item.unit || null) : null

  const rows = db.prepare(SOURCE_SQL).all(stockItemId, tenantId) as any[]

  // แถวที่ไม่มี stock_qty แปลงกลับเป็นหน่วยฐานไม่ได้ ถ้าเอามารวมจะทำให้ตัวหารเพี้ยน (ของจริงมี 47 แถว null + 11 แถว 0 จาก 197 แถว)
  // แต่ถ้ามีสูตรแปลงจาก r.unit (หน่วยซื้อบน PO) -> baseUnit ในปัจจุบัน ให้แปลงค่าเป็น baseQty ปัจจุบัน
  // เพื่อป้องกันกรณีสินค้ามีการเปลี่ยน base_unit ทีหลัง (เช่น เปลี่ยนจากขวดเป็นกรัม)
  const sources: CostSource[] = []
  let skipped = 0

  for (const r of rows) {
    let baseQty = Number(r.baseQty) || 0
    if (baseUnit && r.unit && normalizeUnit(baseUnit) !== normalizeUnit(r.unit)) {
      const conv = convertQuantityBidirectional(Number(r.qty) || 0, r.unit, baseUnit, tenantId, stockItemId, r.name)
      if (conv && conv.converted > 0) {
        baseQty = conv.converted
      }
    }
    if (baseQty <= 0) {
      skipped++
      continue
    }
    sources.push({
      supplier: r.supplier ?? null,
      doc: r.doc,
      date: r.date,
      qty: Number(r.qty) || 0,
      unit: r.unit ?? null,
      unitPrice: Number(r.unitPrice) || 0,
      baseQty,
      value: (Number(r.qty) || 0) * (Number(r.unitPrice) || 0),
      name: r.name ?? null,
    })
  }

  let bbRows: any[] = []
  try {
    bbRows = db.prepare(BUYBACK_SOURCE_SQL).all(stockItemId, tenantId) as any[]
  } catch { /* table may not exist in isolated raw tests before migration */ }

  for (const r of bbRows) {
    const baseQty = Number(r.baseQty) || 0
    if (baseQty <= 0) {
      skipped++
      continue
    }
    sources.push({
      supplier: r.supplier ?? null,
      doc: r.doc,
      date: r.date,
      qty: Number(r.qty) || 0,
      unit: r.unit ?? null,
      unitPrice: Number(r.unitPrice) || 0,
      baseQty,
      value: Number(r.costValue) || 0,
      name: r.name ?? null,
    })
  }

  if (bbRows.length > 0) {
    sources.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.doc).localeCompare(String(a.doc)))
  }

  const totalBaseQty = sources.reduce((t, r) => t + r.baseQty, 0)
  const totalValue = sources.reduce((t, r) => t + r.value, 0)

  if (totalBaseQty <= 0) {
    // ไม่เคยรับเข้าผ่านใบรับสินค้าเลย (ของที่ import เข้ามาตรง ๆ หรือตั้งต้นด้วยมือ)
    // ใช้ unit_cost ที่เก็บไว้แทน แต่บอกให้ชัดว่าเป็นค่าสำรอง คนอ่านจะได้ไม่เข้าใจผิด
    return {
      sources: [], weightedAvg: Number(item?.unit_cost) || 0,
      totalBaseQty: 0, totalValue: 0, basis: 'fallback', baseUnit,
      skipped: rows.length,
    }
  }

  return {
    sources,
    weightedAvg: totalValue / totalBaseQty,
    totalBaseQty,
    totalValue,
    basis: 'weighted',
    baseUnit,
    skipped,
  }
}

export interface PriceLogRow {
  date: string
  party: string | null
  doc: string
  qty: number
  unit: string | null
  /** ราคาต่อหน่วยในบรรทัดนั้น — null = เอกสารชนิดนี้ไม่ได้เก็บราคาไว้ */
  price: number | null
  /** เอาไว้ให้หน้าเว็บบอกผู้ใช้ว่าทำไมบางแถวไม่มีราคา */
  kind: 'sale' | 'pos' | 'production'
  /** ชื่อที่ใช้บนเอกสาร (ชื่อเรียกแทน SKU ถ้าไม่ตรงชื่อสินค้า) */
  name?: string | null
}

/**
 * ประวัติราคาขาย
 * มีเฉพาะ sales_order_items ที่เก็บราคาต่อหน่วยไว้จริง
 * ฝั่ง POS เก็บราคาที่ระดับ "เมนู" ไม่ใช่ระดับวัตถุดิบ (pos_stock_deductions ไม่มีคอลัมน์ราคาเลย)
 * ส่วนใบสั่งผลิตเป็นการโอนภายใน ไม่มีราคาขายตามนิยาม
 * สองอย่างหลังจึงคืน price = null แล้วให้หน้าเว็บอธิบายเอง ไม่ใช่เดาตัวเลขมาใส่
 */
export function getSellLog(tenantId: string, stockItemId: string, limit = 20): PriceLogRow[] {
  const sales = db.prepare(`
    SELECT so.order_date AS date, c.name AS party, so.so_number AS doc,
           soi.quantity AS qty, soi.unit, soi.unit_price AS price, soi.product_name AS name
      FROM sales_order_items soi
      JOIN sales_orders so ON so.id = soi.sales_order_id
      LEFT JOIN customers c ON c.id = so.customer_id
     WHERE soi.stock_item_id = ? AND soi.tenant_id = ? AND so.status != 'CANCELLED'
     ORDER BY so.order_date DESC LIMIT ?
  `).all(stockItemId, tenantId, limit) as any[]

  const pos = db.prepare(`
    SELECT psd.deducted_at AS date, NULL AS party, psd.bill_item_id AS doc,
           psd.quantity_deducted AS qty, NULL AS unit
      FROM pos_stock_deductions psd
     WHERE psd.stock_item_id = ? AND psd.tenant_id = ? AND (psd.returned IS NULL OR psd.returned = 0)
     ORDER BY psd.deducted_at DESC LIMIT ?
  `).all(stockItemId, tenantId, limit) as any[]

  const rows: PriceLogRow[] = [
    ...sales.map(r => ({
      date: r.date, party: r.party ?? null, doc: r.doc,
      qty: Number(r.qty) || 0, unit: r.unit ?? null,
      price: Number(r.price) || 0, kind: 'sale' as const, name: r.name ?? null,
    })),
    ...pos.map(r => ({
      date: r.date, party: null, doc: String(r.doc || '').slice(0, 12),
      qty: Number(r.qty) || 0, unit: null,
      price: null, kind: 'pos' as const,
    })),
  ]
  return rows.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, limit)
}

/** ประวัติราคาซื้อ — ใช้ชุดเดียวกับที่คิดต้นทุนถ่วงน้ำหนัก จะได้ไม่มีทางไม่ตรงกัน */
export function getBuyLog(tenantId: string, stockItemId: string, limit = 20): PriceLogRow[] {
  return getCostBasis(tenantId, stockItemId).sources.slice(0, limit).map(s => ({
    date: s.date, party: s.supplier, doc: s.doc,
    qty: s.qty, unit: s.unit, price: s.unitPrice, kind: 'sale' as const, name: s.name ?? null,
  }))
}

export interface ItemHistoryRow {
  side: 'buy' | 'sell'
  kind: 'gr' | 'so' | 'pos'
  date: string
  doc: string
  party: string | null
  qty: number
  unit: string | null
  price: number | null
}

export interface RecipeIngredientPrice {
  stockItemId: string
  name: string
  sku: string
  date: string | null
  unit: string | null
  price: number | null
}

export interface ItemHistory {
  item: { id: string; sku: string; name: string; quantity: number; unit: string } | null
  buys: ItemHistoryRow[]
  sells: ItemHistoryRow[]
  lines: ItemHistoryRow[]
  recipeIngredients?: RecipeIngredientPrice[]
}

// แปลงวันที่/timestamp เป็นวันไทย YYYY-MM-DD (SQLite CURRENT_TIMESTAMP เป็น UTC แบบไม่มี T/Z)
function toThaiDay(v: string | null | undefined): string {
  const s = String(v ?? '').trim()
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s) ? `${s.replace(' ', 'T')}Z` : s
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? new Date(ms + 7 * 3600_000).toISOString().slice(0, 10) : s.slice(0, 10)
}

function queryItemBuys(tenantId: string, stockItemId: string, limit: number): ItemHistoryRow[] {
  const buyRaw = db.prepare(`
    SELECT gr.receipt_date AS date, gr.gr_number AS doc, s.name AS party,
           gri.accepted_qty AS qty, poi.unit AS unit, poi.unit_price AS price
      FROM goods_receipt_items gri
      JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
      LEFT JOIN purchase_order_items poi ON poi.id = gri.purchase_order_item_id
      LEFT JOIN suppliers s ON s.id = gr.supplier_id
     WHERE COALESCE(NULLIF(gri.stock_item_id, ''), gri.material_id) = ?
       AND gr.tenant_id = ?
       AND gr.status = 'CONFIRMED'
     ORDER BY gr.receipt_date DESC, gr.gr_number DESC
     LIMIT ?
  `).all(stockItemId, tenantId, limit) as any[]

  return buyRaw.map(r => ({
    side: 'buy',
    kind: 'gr',
    date: toThaiDay(r.date),
    doc: r.doc,
    party: r.party ?? null,
    qty: Number(r.qty) || 0,
    unit: r.unit ?? null,
    price: r.price === null || r.price === undefined ? null : Number(r.price),
  }))
}

function activeBomOf(tenantId: string, productId: string): string | null {
  const row = db.prepare(`
    SELECT id FROM boms
     WHERE tenant_id = ? AND product_id = ? AND status = 'ACTIVE'
     ORDER BY created_at DESC, id DESC
     LIMIT 1
  `).get(tenantId, productId) as { id: string } | undefined
  return row?.id ?? null
}

function resolveRecipeBomId(tenantId: string, stockItemId: string): string | null {
  const menuBom = db.prepare(`
    SELECT b.id
      FROM pos_menu_configs pmc
      JOIN boms b ON b.id = pmc.bom_id AND b.tenant_id = pmc.tenant_id
     WHERE pmc.tenant_id = ? AND pmc.product_id = ?
       AND pmc.bom_id IS NOT NULL AND pmc.bom_id != ''
     LIMIT 1
  `).get(tenantId, stockItemId) as { id: string } | undefined
  if (menuBom?.id) return menuBom.id
  return activeBomOf(tenantId, stockItemId)
}

function getRecipeIngredientsWithLatestPrice(tenantId: string, stockItemId: string): RecipeIngredientPrice[] {
  const rootBomId = resolveRecipeBomId(tenantId, stockItemId)
  if (!rootBomId) return []

  const MAX_BOM_DEPTH = 4
  const seenItems = new Set<string>()
  const out: RecipeIngredientPrice[] = []
  const buyCache = new Map<string, ItemHistoryRow | null>()

  const latestBuy = (id: string): ItemHistoryRow | null => {
    if (!buyCache.has(id)) {
      buyCache.set(id, queryItemBuys(tenantId, id, 1)[0] ?? null)
    }
    return buyCache.get(id)!
  }

  const pushItem = (id: string, name: string, sku: string) => {
    if (!id || seenItems.has(id)) return
    seenItems.add(id)
    const b = latestBuy(id)
    out.push({
      stockItemId: id,
      name,
      sku,
      date: b ? b.date : null,
      unit: b ? b.unit : null,
      price: b ? b.price : null,
    })
  }

  const itemsStmt = db.prepare(`
    SELECT bi.item_type, bi.material_id, bi.child_bom_id,
           si.name AS mat_name, si.sku AS mat_sku,
           cb.id AS cb_valid_id, cb.product_id AS cb_product_id,
           csi.name AS cb_prod_name, csi.sku AS cb_prod_sku
      FROM bom_items bi
      LEFT JOIN stock_items si ON si.id = bi.material_id AND si.tenant_id = bi.tenant_id
      LEFT JOIN boms cb ON cb.id = bi.child_bom_id AND cb.tenant_id = bi.tenant_id
      LEFT JOIN stock_items csi ON csi.id = cb.product_id AND csi.tenant_id = cb.tenant_id
     WHERE bi.bom_id = ? AND bi.tenant_id = ?
     ORDER BY bi.sort_order ASC, bi.id ASC
  `)

  const walk = (bomId: string, depth: number, path: Set<string>): boolean => {
    if (path.has(bomId)) return false
    const nextPath = new Set(path)
    nextPath.add(bomId)

    const rows = itemsStmt.all(bomId, tenantId) as any[]
    let added = false

    for (const row of rows) {
      if (row.item_type === 'CHILD_BOM' && row.cb_valid_id) {
        if (depth < MAX_BOM_DEPTH && !nextPath.has(row.cb_valid_id)) {
          const subAdded = walk(row.cb_valid_id, depth + 1, nextPath)
          if (subAdded) {
            added = true
          } else if (row.cb_product_id && row.cb_prod_name) {
            pushItem(row.cb_product_id, row.cb_prod_name, row.cb_prod_sku ?? '')
            added = true
          }
        } else if (!nextPath.has(row.cb_valid_id) && row.cb_product_id && row.cb_prod_name) {
          pushItem(row.cb_product_id, row.cb_prod_name, row.cb_prod_sku ?? '')
          added = true
        }
      } else if (row.material_id && row.mat_name) {
        if (latestBuy(row.material_id)) {
          pushItem(row.material_id, row.mat_name, row.mat_sku ?? '')
          added = true
        } else {
          const subBomId = depth < MAX_BOM_DEPTH ? activeBomOf(tenantId, row.material_id) : null
          if (subBomId && !nextPath.has(subBomId)) {
            const subAdded = walk(subBomId, depth + 1, nextPath)
            if (subAdded) {
              added = true
            } else {
              pushItem(row.material_id, row.mat_name, row.mat_sku ?? '')
              added = true
            }
          } else {
            pushItem(row.material_id, row.mat_name, row.mat_sku ?? '')
            added = true
          }
        }
      }
    }
    return added
  }

  walk(rootBomId, 0, new Set())
  return out
}

/** ประวัติซื้อ-ขายของสินค้า 1 ตัว (อ่านอย่างเดียว) — ใช้กับคำสั่ง /สินค้า ใน LINE */
export function getItemHistory(tenantId: string, stockItemId: string): ItemHistory {
  const itemRow = db.prepare(`
    SELECT id, sku, name, quantity, COALESCE(NULLIF(base_unit, ''), unit) AS unit
      FROM stock_items
     WHERE id = ? AND tenant_id = ?
  `).get(stockItemId, tenantId) as any
  if (!itemRow) return { item: null, buys: [], sells: [], lines: [] }

  const item = {
    id: itemRow.id as string,
    sku: itemRow.sku as string,
    name: itemRow.name as string,
    quantity: Number(itemRow.quantity) || 0,
    unit: (itemRow.unit ?? '') as string,
  }

  // ฝั่งซื้อ: ใช้ gr.receipt_date (วันรับจริงต่างจากวัน movement ในข้อมูลจริง) และไม่ตัดแถวที่ไม่มี stock_qty ทิ้ง
  const buys = queryItemBuys(tenantId, stockItemId, 10)

  // ฝั่งขาย (ใบสั่งขาย): ไม่เอาใบที่ร่างหรือยกเลิก
  const soRaw = db.prepare(`
    SELECT so.order_date AS date, so.so_number AS doc, c.name AS party,
           soi.quantity AS qty, soi.unit AS unit, soi.unit_price AS price
      FROM sales_order_items soi
      JOIN sales_orders so ON so.id = soi.sales_order_id
      LEFT JOIN customers c ON c.id = so.customer_id
     WHERE soi.stock_item_id = ?
       AND so.tenant_id = ?
       AND so.status NOT IN ('CANCELLED', 'DRAFT')
     ORDER BY so.order_date DESC, so.so_number DESC
     LIMIT 10
  `).all(stockItemId, tenantId) as any[]

  const soRows: ItemHistoryRow[] = soRaw.map(r => ({
    side: 'sell',
    kind: 'so',
    date: toThaiDay(r.date),
    doc: r.doc,
    party: r.party ?? null,
    qty: Number(r.qty) || 0,
    unit: r.unit ?? null,
    price: r.price === null || r.price === undefined ? null : Number(r.price),
  }))

  // ฝั่งขาย (บิล POS): สินค้าตัวนี้เป็นเมนูเอง ราคาอยู่บนบิล รวมต่อวันไทย+ราคา
  const menuRaw = db.prepare(`
    SELECT COALESCE(b.closed_at, b.opened_at) AS date, i.quantity AS qty, i.unit_price AS price,
           COALESCE(NULLIF(c.sale_unit, ''), ?) AS unit
      FROM pos_menu_configs c
      JOIN pos_bill_items i ON i.pos_menu_id = c.id
      JOIN pos_running_bills b ON b.id = i.bill_id
     WHERE c.product_id = ?
       AND c.tenant_id = ?
       AND b.tenant_id = c.tenant_id
       AND b.status = 'PAID'
       AND (i.status IS NULL OR i.status NOT IN ('CANCELLED', 'VOID'))
  `).all(item.unit, stockItemId, tenantId) as any[]

  const menuByDay = new Map<string, ItemHistoryRow>()
  for (const r of menuRaw) {
    const day = toThaiDay(r.date)
    if (!day) continue
    const price = Number(r.price) || 0
    const key = `${day}|${price}`
    const row = menuByDay.get(key)
    if (row) row.qty += Number(r.qty) || 0
    else menuByDay.set(key, { side: 'sell', kind: 'pos', date: day, doc: 'POS', party: null, qty: Number(r.qty) || 0, unit: r.unit || null, price })
  }

  // ฝั่งขาย (POS ตัดเป็นวัตถุดิบของเมนูอื่น): รวมยอดที่ยังไม่คืนต่อวันไทย ไม่มีราคาระดับวัตถุดิบจึงคืน price = null เสมอ
  // ตัดรายการที่เป็นเมนูของตัวเองออก เพราะนับจากบิลข้างบนแล้ว
  const posRaw = db.prepare(`
    SELECT psd.deducted_at AS date, psd.quantity_deducted AS qty
      FROM pos_stock_deductions psd
     WHERE psd.stock_item_id = ?
       AND psd.tenant_id = ?
       AND (psd.returned IS NULL OR psd.returned = 0)
       AND NOT EXISTS (SELECT 1 FROM pos_bill_items i
                         JOIN pos_menu_configs c ON c.id = i.pos_menu_id
                        WHERE i.id = psd.bill_item_id AND c.product_id = psd.stock_item_id)
     ORDER BY psd.deducted_at DESC
  `).all(stockItemId, tenantId) as any[]

  const posByDay = new Map<string, number>()
  for (const r of posRaw) {
    const day = toThaiDay(r.date)
    if (!day) continue
    posByDay.set(day, (posByDay.get(day) ?? 0) + (Number(r.qty) || 0))
  }
  const posRows: ItemHistoryRow[] = [...posByDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 10)
    .map(([day, qty]) => ({
      side: 'sell',
      kind: 'pos',
      date: day,
      doc: 'POS',
      party: null,
      qty,
      unit: item.unit || null,
      price: null,
    }))

  const sells = [...soRows, ...menuByDay.values(), ...posRows]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10)

  // สูงสุด 10 บรรทัด: ซื้อได้ถึง 5 + ขายได้ถึง 5 ถ้าฝั่งหนึ่งน้อยกว่าให้เติมจากอีกฝั่ง
  const buyTake = Math.min(buys.length, Math.max(5, 10 - sells.length))
  const sellTake = Math.min(sells.length, 10 - buyTake)
  const lines = [...buys.slice(0, buyTake), ...sells.slice(0, sellTake)]
    .sort((a, b) => b.date.localeCompare(a.date))

  const recipeIngredients = buys.length === 0 ? getRecipeIngredientsWithLatestPrice(tenantId, stockItemId) : []

  return { item, buys, sells, lines, ...(recipeIngredients.length ? { recipeIngredients } : {}) }
}
