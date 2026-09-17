import { describe, it, expect } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { applyStockMovement } from './stockMovement.service'
import { getCostBasis } from './stockCostBasis.service'
import { createTestUser } from '../test/testAuth'

/**
 * ปรับสต็อกแตะเงินจริง ทั้งมูลค่าสินค้าคงเหลือและงบกำไรขาดทุน
 * เคสที่ต้องกันมากที่สุดคือ "ตีมูลค่าด้วยราคาผิดตัว" เพราะมันเงียบ ไม่มี error ให้เห็น
 *
 * กับดักหน่วยของจริง: ขนมจีนถูกซื้อมาเป็น g / kg / hg ปนกัน ราคา 0.05 / 25 / 4.75
 *   เฉลี่ย unit_price ตรง ๆ  -> ฿13.30 ต่ออะไรก็ไม่รู้  ผิดราว 470 เท่า
 *   หารด้วย stock_qty        -> ฿0.0281 ต่อกรัม        ถูก
 */
function seedItem(tenantId: string, qty: number, unitCost: number, baseUnit = 'g') {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
    VALUES (?, ?, ?, 'ของทดสอบ', 'raw', ?, ?, ?, ?, 'STOCK', 'ACTIVE')
  `).run(id, tenantId, 'SKU-' + id.slice(0, 8), qty, baseUnit, baseUnit, unitCost)
  return id
}

/** จำลองการรับของเข้าคลัง 1 ครั้ง ด้วยหน่วยซื้อที่อาจไม่ใช่หน่วยฐาน */
function seedReceipt(tenantId: string, stockItemId: string, buyQty: number, buyUnit: string, unitPrice: number, baseQty: number) {
  const supId = generateId()
  db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'ผู้ขาย', 'C')")
    .run(supId, tenantId, supId)
  const poId = generateId()
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_rate, tax_amount, total_amount, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'RECEIVED', 0, 7, 0, 0, ?, ?)`).run(poId, tenantId, 'PO-' + poId.slice(0, 6), supId, now, now)
  const poiId = generateId()
  db.prepare(`INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, quantity, unit, unit_price, total_price, received_qty)
    VALUES (?, ?, ?, ?, 'ของทดสอบ', ?, ?, ?, ?, ?)`)
    .run(poiId, tenantId, poId, stockItemId, buyQty, buyUnit, unitPrice, buyQty * unitPrice, buyQty)
  const grId = generateId()
  db.prepare(`INSERT INTO goods_receipts (id, tenant_id, gr_number, purchase_order_id, supplier_id, receipt_date, received_by, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'system', 'CONFIRMED', ?, ?)`)
    .run(grId, tenantId, 'GR-' + grId.slice(0, 6), poId, supId, now.slice(0, 10), now, now)
  db.prepare(`INSERT INTO goods_receipt_items (id, tenant_id, goods_receipt_id, purchase_order_item_id, material_id,
      ordered_qty, received_qty, accepted_qty, rejected_qty, stock_item_id, stock_qty, stock_factor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`)
    .run(generateId(), tenantId, grId, poiId, stockItemId, buyQty, buyQty, buyQty, stockItemId, baseQty, baseQty / buyQty)
  return grId
}

const journalOf = (tenantId: string, stockItemId: string) =>
  db.prepare("SELECT * FROM journal_entries WHERE tenant_id = ? AND reference_type = 'STOCK_ADJUST' AND reference_id = ? ORDER BY created_at DESC")
    .get(tenantId, stockItemId) as any

describe('ปรับสต็อก — ตีมูลค่าและลงบัญชี', () => {
  it('ค่ากลางต้องหารด้วยหน่วยฐาน ไม่ใช่หน่วยซื้อ (เคสซื้อคละหน่วย)', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const id = seedItem(user.tenantId, 5800, 25, 'g')
    seedReceipt(user.tenantId, id, 500, 'g', 0.05, 500)   // ฿25  -> 500 g
    seedReceipt(user.tenantId, id, 1, 'kg', 25, 1000)     // ฿25  -> 1000 g
    seedReceipt(user.tenantId, id, 1, 'kg', 25, 1000)     // ฿25  -> 1000 g
    seedReceipt(user.tenantId, id, 8, 'hg', 4.75, 800)    // ฿38  -> 800 g
    seedReceipt(user.tenantId, id, 2, 'kg', 25, 2000)     // ฿50  -> 2000 g
    seedReceipt(user.tenantId, id, 5, 'hg', 0, 500)       // ฿0   -> 500 g

    const cb = getCostBasis(user.tenantId, id)
    expect(cb.basis).toBe('weighted')
    expect(cb.totalValue).toBeCloseTo(163, 6)
    expect(cb.totalBaseQty).toBe(5800)
    expect(cb.weightedAvg).toBeCloseTo(163 / 5800, 9)   // ฿0.0281 ต่อกรัม

    // ถ้าหารผิดตัว (เฉลี่ย unit_price ดิบ) จะได้ราว ฿13.30 — ต่างกันหลักร้อยเท่า
    const naive = cb.sources.reduce((t, s) => t + s.unitPrice, 0) / cb.sources.length
    expect(naive / cb.weightedAvg).toBeGreaterThan(100)
  })

  it('ปรับลดของหาย ต้อง Dr ค่าใช้จ่ายปรับปรุงสต็อก / Cr สินค้าคงเหลือ ตามค่ากลาง', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const id = seedItem(user.tenantId, 1000, 999, 'g')   // unit_cost ตั้งไว้มั่ว ๆ ต้องไม่ถูกใช้
    seedReceipt(user.tenantId, id, 1, 'kg', 20, 1000)    // ค่ากลาง = 20/1000 = ฿0.02 ต่อกรัม

    applyStockMovement(user.tenantId, user.email, {
      stockItemId: id, type: 'ADJUST', quantity: 900, unit: 'g', adjustReason: 'ของหาย',
    })

    const je = journalOf(user.tenantId, id)
    expect(je).toBeTruthy()
    // ส่วนต่าง -100 g × ฿0.02 = ฿2 (ถ้าใช้ unit_cost เดิม 999 จะได้ ฿99,900)
    expect(je.total_debit).toBeCloseTo(2, 6)
    expect(je.total_credit).toBeCloseTo(2, 6)
    expect(je.is_posted).toBe(1)

    const lines = db.prepare('SELECT * FROM journal_lines WHERE journal_entry_id = ? ORDER BY line_number').all(je.id) as any[]
    expect(lines).toHaveLength(2)
    expect(lines[0].debit).toBeCloseTo(2, 6)    // Dr ค่าใช้จ่ายปรับปรุงสต็อก
    expect(lines[1].credit).toBeCloseTo(2, 6)   // Cr สินค้าคงเหลือ
  })

  it('ปรับเพิ่มของเกิน ต้อง Dr สินค้าคงเหลือ / Cr รายได้อื่น', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const id = seedItem(user.tenantId, 1000, 0, 'g')
    seedReceipt(user.tenantId, id, 1, 'kg', 20, 1000)

    applyStockMovement(user.tenantId, user.email, {
      stockItemId: id, type: 'ADJUST', quantity: 1100, unit: 'g', adjustReason: 'รับเพิ่มไม่ผ่านใบ',
    })

    const je = journalOf(user.tenantId, id)
    expect(je.total_debit).toBeCloseTo(2, 6)
    const lines = db.prepare('SELECT * FROM journal_lines WHERE journal_entry_id = ? ORDER BY line_number').all(je.id) as any[]
    expect(lines[0].debit).toBeCloseTo(2, 6)    // Dr สินค้าคงเหลือ
    expect(lines[1].credit).toBeCloseTo(2, 6)   // Cr รายได้อื่น
  })

  it('ไม่มีประวัติรับเข้าเลย ต้องไม่พัง — ใช้ต้นทุนที่บันทึกไว้แทน', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const id = seedItem(user.tenantId, 10, 7, 'pcs')

    const cb = getCostBasis(user.tenantId, id)
    expect(cb.basis).toBe('fallback')
    expect(cb.weightedAvg).toBe(7)

    applyStockMovement(user.tenantId, user.email, { stockItemId: id, type: 'ADJUST', quantity: 8, unit: 'pcs' })
    const je = journalOf(user.tenantId, id)
    expect(je.total_debit).toBeCloseTo(14, 6)   // ส่วนต่าง -2 × ฿7
  })

  it('ปรับสต็อกต้องมีทะเบียนให้ย้อนดูเสมอ (ตารางนี้เคย 0 แถวมาตลอด)', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const id = seedItem(user.tenantId, 100, 5, 'pcs')

    applyStockMovement(user.tenantId, user.email, {
      stockItemId: id, type: 'ADJUST', quantity: 80, unit: 'pcs', adjustReason: 'ของเสีย/หมดอายุ',
    })

    const adj = db.prepare('SELECT * FROM stock_adjustments WHERE tenant_id = ? AND stock_item_id = ?')
      .get(user.tenantId, id) as any
    expect(adj).toBeTruthy()
    expect(adj.adjustment_type).toBe('DECREASE')
    expect(adj.quantity_before).toBe(100)
    expect(adj.quantity_after).toBe(80)
    expect(adj.quantity_adjusted).toBe(-20)
    expect(adj.total_value).toBeCloseTo(100, 6)     // 20 × ฿5
    expect(adj.reason).toBe('ของเสีย/หมดอายุ')
    expect(adj.status).toBe('EXECUTED')
  })

  it('นับผิดรอบก่อนแล้วของครบพอดี — ไม่มี journal แต่ต้องมีทะเบียน', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const id = seedItem(user.tenantId, 50, 5, 'pcs')

    applyStockMovement(user.tenantId, user.email, {
      stockItemId: id, type: 'ADJUST', quantity: 50, unit: 'pcs', adjustReason: 'นับผิดรอบก่อน',
    })

    expect(journalOf(user.tenantId, id)).toBeFalsy()          // ส่วนต่าง 0 ไม่ต้องลงบัญชี
    const adj = db.prepare('SELECT * FROM stock_adjustments WHERE tenant_id = ? AND stock_item_id = ?')
      .get(user.tenantId, id) as any
    expect(adj).toBeTruthy()                                   // แต่ต้องมีร่องรอยว่ามีคนมานับ
    expect(adj.quantity_adjusted).toBe(0)
  })

  it('ปรับสต็อกครั้งเดียว ของต้องขยับครั้งเดียว ไม่ใช่สองเท่า', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const id = seedItem(user.tenantId, 100, 5, 'pcs')

    applyStockMovement(user.tenantId, user.email, { stockItemId: id, type: 'ADJUST', quantity: 60, unit: 'pcs' })

    const item = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(id) as any
    expect(item.quantity).toBe(60)
    const moves = db.prepare("SELECT COUNT(*) n FROM stock_movements WHERE stock_item_id = ? AND type = 'ADJUST'").get(id) as any
    expect(moves.n).toBe(1)
  })
})

/**
 * เดิมโค้ดดูแค่ทิศทาง: ลดเข้า 5902 เสมอ / เพิ่มเข้ารายได้อื่นเสมอ
 * "ของเสีย" กับ "นับผิดรอบก่อน" จึงจมอยู่ในบัญชีเดียวกัน แยกไม่ออกว่าร้านเสียของไปเท่าไร
 */
function debitCodeOf(tenantId: string, stockItemId: string) {
  return db.prepare(`
    SELECT a.code FROM journal_entries je
    JOIN journal_lines jl ON jl.journal_entry_id = je.id AND jl.debit > 0
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.tenant_id = ? AND je.reference_type = 'STOCK_ADJUST' AND je.reference_id = ?
    ORDER BY je.created_at DESC LIMIT 1
  `).get(tenantId, stockItemId) as any
}
function creditCodeOf(tenantId: string, stockItemId: string) {
  return db.prepare(`
    SELECT a.code FROM journal_entries je
    JOIN journal_lines jl ON jl.journal_entry_id = je.id AND jl.credit > 0
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.tenant_id = ? AND je.reference_type = 'STOCK_ADJUST' AND je.reference_id = ?
    ORDER BY je.created_at DESC LIMIT 1
  `).get(tenantId, stockItemId) as any
}

describe('ปรับสต็อก — เหตุผลพาเงินไปลงบัญชีคนละตัว', () => {
  const cases: Array<[string, string, string]> = [
    ['ของเสีย/หมดอายุ', '5903', 'ผลขาดทุนของเสีย'],
    ['แตก/ชำรุด', '5903', 'ผลขาดทุนของเสีย'],
    ['ของหาย', '5904', 'ผลขาดทุนสินค้าสูญหาย'],
    ['เบิกใช้ไม่ได้บันทึก', '5102', 'ต้นทุนวัตถุดิบใช้ไป'],
    ['นับผิดรอบก่อน', '5902', 'ค่าใช้จ่ายปรับปรุงสต็อก'],
  ]

  for (const [reason, code, name] of cases) {
    it(`ปรับลดเพราะ "${reason}" ต้อง Dr ${code} ${name}`, () => {
      const user = createTestUser({ role: 'ADMIN' })
      const id = seedItem(user.tenantId, 100, 10, 'ชิ้น')
      applyStockMovement(user.tenantId, user.email, {
        stockItemId: id, type: 'ADJUST', quantity: 90, unit: 'ชิ้น', adjustReason: reason,
      })
      expect(debitCodeOf(user.tenantId, id)?.code).toBe(code)
      expect(creditCodeOf(user.tenantId, id)?.code).toBe('1107')
    })
  }

  it('ไม่ระบุเหตุผล ตกมาที่ 5902 เหมือนพฤติกรรมเดิม', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const id = seedItem(user.tenantId, 100, 10, 'ชิ้น')
    applyStockMovement(user.tenantId, user.email, {
      stockItemId: id, type: 'ADJUST', quantity: 90, unit: 'ชิ้น',
    })
    expect(debitCodeOf(user.tenantId, id)?.code).toBe('5902')
  })

  it('ปรับเพิ่มเพราะนับผิดรอบก่อน = กลับรายการค่าปรับปรุงสต็อก ไม่ใช่รายได้อื่น', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const id = seedItem(user.tenantId, 100, 10, 'ชิ้น')
    applyStockMovement(user.tenantId, user.email, {
      stockItemId: id, type: 'ADJUST', quantity: 110, unit: 'ชิ้น', adjustReason: 'นับผิดรอบก่อน',
    })
    expect(debitCodeOf(user.tenantId, id)?.code).toBe('1107')
    expect(creditCodeOf(user.tenantId, id)?.code).toBe('5902')
  })

  it('ปรับเพิ่มเพราะรับเพิ่มไม่ผ่านใบ ยังเข้ารายได้อื่นตามเดิม', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const id = seedItem(user.tenantId, 100, 10, 'ชิ้น')
    applyStockMovement(user.tenantId, user.email, {
      stockItemId: id, type: 'ADJUST', quantity: 110, unit: 'ชิ้น', adjustReason: 'รับเพิ่มไม่ผ่านใบ',
    })
    expect(creditCodeOf(user.tenantId, id)?.code).toBe('4203')
  })
})
