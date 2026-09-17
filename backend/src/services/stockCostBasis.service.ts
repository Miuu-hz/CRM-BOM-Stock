import db from '../db/sqlite'

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
         gri.stock_qty AS baseQty
    FROM goods_receipt_items gri
    JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
    JOIN purchase_order_items poi ON poi.id = gri.purchase_order_item_id
    LEFT JOIN suppliers s ON s.id = gr.supplier_id
   WHERE gri.stock_item_id = ? AND gri.tenant_id = ? AND gr.status = 'CONFIRMED'
   ORDER BY gr.receipt_date DESC, gr.gr_number DESC
`

export function getCostBasis(tenantId: string, stockItemId: string): CostBasis {
  const item = db.prepare('SELECT unit_cost, base_unit, unit FROM stock_items WHERE id = ? AND tenant_id = ?')
    .get(stockItemId, tenantId) as any
  const baseUnit = item ? (item.base_unit || item.unit || null) : null

  const rows = db.prepare(SOURCE_SQL).all(stockItemId, tenantId) as any[]

  // แถวที่ไม่มี stock_qty แปลงกลับเป็นหน่วยฐานไม่ได้ ถ้าเอามารวมจะทำให้ตัวหารเพี้ยน
  // (ของจริงมี 47 แถว null + 11 แถว 0 จาก 197 แถว) — ตัดออกแล้วรายงานจำนวนที่ตัด
  const usable = rows.filter(r => Number(r.baseQty) > 0)
  const sources: CostSource[] = usable.map(r => ({
    supplier: r.supplier ?? null,
    doc: r.doc,
    date: r.date,
    qty: Number(r.qty) || 0,
    unit: r.unit ?? null,
    unitPrice: Number(r.unitPrice) || 0,
    baseQty: Number(r.baseQty),
    value: (Number(r.qty) || 0) * (Number(r.unitPrice) || 0),
  }))

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
    skipped: rows.length - usable.length,
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
           soi.quantity AS qty, soi.unit, soi.unit_price AS price
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
      price: Number(r.price) || 0, kind: 'sale' as const,
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
    qty: s.qty, unit: s.unit, price: s.unitPrice, kind: 'sale' as const,
  }))
}
