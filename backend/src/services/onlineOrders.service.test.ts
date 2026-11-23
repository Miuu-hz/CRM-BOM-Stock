import { describe, it, expect, afterEach } from 'vitest'
import db from '../db/sqlite'
import { piiDb, deleteTenantPii } from '../db/piiConnection'
import { generateId } from '../utils/id'
import { submitFile } from './platformMonth.service'
import { sourceRefOf } from './platformMonthSale.service'
import {
  submitOnlineOrders,
  getOnlineSummary,
  listOnlineOrders,
  getUnlinkedLines,
  confirmOnlineMapping,
  proposeOnlineMapping,
  acceptAllOnlineProposals,
  listReturnEvents,
  restockReturnEvents,
  getUnattributedReturns,
  statusGroupOf,
  parseOrderDateThai,
  OnlineOrderError,
  type OnlineOrderInputRow,
} from './onlineOrders.service'

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    deleteTenantPii(t)
    const monthIds = (db.prepare(`SELECT id FROM platform_months WHERE tenant_id = ?`).all(t) as any[]).map((r) => r.id)
    for (const id of monthIds) {
      db.prepare(`DELETE FROM platform_month_products WHERE month_id = ?`).run(id)
      db.prepare(`DELETE FROM platform_days WHERE month_id = ?`).run(id)
    }
    for (const tbl of [
      'online_order_lines',
      'online_orders',
      'online_import_batches',
      'online_return_events',
      'stock_movements',
      'platform_sku_proposals',
      'stock_item_aliases',
      'stock_items',
      'platform_months',
    ]) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch {}
    }
  }
})

function newTenant() {
  const t = 'test_online_' + generateId()
  tenants.push(t)
  return t
}

function makeStockItem(tenantId: string, opts: { sku?: string; name: string; quantity: number; unitCost: number; category?: string }) {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, sealed_qty, unit, base_unit, unit_cost, location, status)
    VALUES (?, ?, ?, ?, ?, ?, 0, 'pcs', 'pcs', ?, 'WH1', 'ACTIVE')
  `).run(id, tenantId, opts.sku || id, opts.name, opts.category || 'FINISHED', opts.quantity, opts.unitCost)
  return id
}

function sampleRow(overrides: Partial<OnlineOrderInputRow> = {}): OnlineOrderInputRow {
  return {
    orderNo: '261015ABC001',
    orderTime: '2026-10-15 14:30',
    status: 'สำเร็จ',
    buyerName: 'ธัชพงษ์',
    buyerPhone: '081-234-5678',
    fullAddress: 'เลขที่ 858/7 หมู่ที่ 4 หมู่บ้าน บ้านฟิวเจอร์โซน ตำบลรอบเมือง อำเภอเมืองชัยภูมิ จังหวัดชัยภูมิ 36000',
    province: 'ชัยภูมิ',
    district: 'เมืองชัยภูมิ',
    postalCode: '36000',
    productName: 'หมอนยางพารา',
    variantName: 'ลายดอกไม้',
    qty: 2,
    qtyReturned: 0,
    listPrice: 600,
    netPrice: 500,
    trackingNo: 'TH0123456',
    paymentMethod: 'ShopeePay',
    shippingOption: 'Standard Delivery',
    ...overrides,
  }
}

describe('onlineOrders.service — ออเดอร์ออนไลน์รายออเดอร์', () => {
  it('statusGroupOf แปลงสถานะ SHOPEE ถูกต้อง และ throw สำหรับ platform ที่ยังไม่รองรับ', () => {
    expect(statusGroupOf('SHOPEE', 'ยกเลิกแล้ว', 0)).toBe('CANCELLED')
    expect(statusGroupOf('SHOPEE', 'ที่ต้องชำระ', 0)).toBe('UNPAID')
    expect(statusGroupOf('SHOPEE', 'คำขอคืนเงิน/คืนสินค้า', 0)).toBe('RETURNED')
    expect(statusGroupOf('SHOPEE', 'สำเร็จ', 1)).toBe('RETURNED')
    expect(statusGroupOf('SHOPEE', 'สำเร็จ', 0)).toBe('COMPLETED')
    expect(statusGroupOf('SHOPEE', 'ที่ต้องจัดส่ง', 0)).toBe('ACTIVE')
    expect(() => statusGroupOf('LAZADA', 'สำเร็จ', 0)).toThrow(OnlineOrderError)
    expect(() => statusGroupOf('LAZADA', 'สำเร็จ', 0)).toThrow(/ยังไม่รองรับ/)
  })

  it('parseOrderDateThai คำนวณวันที่และเดือนตามเวลาไทย Asia/Bangkok', () => {
    expect(parseOrderDateThai('2026-10-15 14:30')).toEqual({ orderDate: '2026-10-15', month: '2026-10' })
    // 18:30 UTC = 01:30 น. วันถัดไปในเวลาไทย (+07:00)
    expect(parseOrderDateThai('2026-10-15T18:30:00Z')).toEqual({ orderDate: '2026-10-16', month: '2026-10' })
    expect(parseOrderDateThai('2026-10-31T17:30:00Z')).toEqual({ orderDate: '2026-11-01', month: '2026-11' })
    expect(() => parseOrderDateThai('2026-02-30 10:00')).toThrow(OnlineOrderError)
  })

  it('PII ดิบลงเฉพาะ pii.db เท่านั้น ห้ามหลุดลงทุกคอลัมน์ของตารางใหม่ในฐานหลัก + ไม่สร้างแถวบัญชี/สต็อก/SO', () => {
    const t = newTenant()
    const rawName = 'ธัชพงษ์'
    const rawPhone = '081-234-5678'
    const rawHouse = '858/7'

    const res = submitOnlineOrders(t, { platform: 'SHOPEE', shopKey: 'bebozch', rows: [sampleRow()] }, 'tester')
    expect(res.ordersInserted).toBe(1)
    expect(res.ordersUpdated).toBe(0)

    // 1) ตรวจทุกคอลัมน์ของทั้ง 4 ตารางใหม่ในฐานหลัก — ห้ามมี PII ดิบโผล่แม้แต่ช่องเดียว
    for (const tbl of ['online_orders', 'online_order_lines', 'online_import_batches', 'online_return_events']) {
      const rows = db.prepare(`SELECT * FROM ${tbl} WHERE tenant_id = ?`).all(t) as any[]
      const serialized = JSON.stringify(rows)
      expect(serialized, `${tbl} ห้ามมีชื่อดิบ`).not.toContain(rawName)
      expect(serialized, `${tbl} ห้ามมีเบอร์ดิบ`).not.toContain(rawPhone)
      expect(serialized, `${tbl} ห้ามมีบ้านเลขที่ดิบ`).not.toContain(rawHouse)
    }

    const orderRow = db.prepare(`SELECT * FROM online_orders WHERE tenant_id = ?`).get(t) as any
    expect(orderRow.buyer_name_masked).toBe('ธัชพxxx')
    expect(orderRow.buyer_phone_masked).toBe('081-234-5xxx')
    expect(orderRow.address_masked).toContain('เลขที่ xxx หมู่ที่ 4')
    expect(orderRow.province).toBe('ชัยภูมิ')
    expect(orderRow.district).toBe('เมืองชัยภูมิ')
    expect(orderRow.postal_code).toBe('36000')

    // 2) PII ดิบอยู่ใน pii.db
    const piiRow = piiDb.prepare(`SELECT * FROM online_order_pii WHERE tenant_id = ? AND order_no = ?`).get(t, '261015ABC001') as any
    expect(piiRow).toBeDefined()
    expect(piiRow.buyer_name).toBe(rawName)
    expect(piiRow.buyer_phone).toBe(rawPhone)
    expect(piiRow.full_address).toContain(rawHouse)

    // 3) ห้ามเขียนลง journal_entries / stock_movements / sales_orders
    expect((db.prepare(`SELECT COUNT(*) AS c FROM journal_entries WHERE tenant_id = ?`).get(t) as any).c).toBe(0)
    expect((db.prepare(`SELECT COUNT(*) AS c FROM stock_movements WHERE tenant_id = ?`).get(t) as any).c).toBe(0)
    expect((db.prepare(`SELECT COUNT(*) AS c FROM sales_orders WHERE tenant_id = ?`).get(t) as any).c).toBe(0)
  })

  it('ส่งออเดอร์เดิมซ้ำ → อัปเดตไม่สร้างซ้ำ + เปลี่ยนสถานะเป็นยกเลิกอัปเดต status_group', () => {
    const t = newTenant()
    const first = submitOnlineOrders(t, {
      platform: 'SHOPEE',
      shopKey: 'bebozch',
      rows: [
        sampleRow({ orderNo: 'ORD-DUP', status: 'ที่ต้องจัดส่ง', productName: 'สินค้า A', qty: 1, netPrice: 100 }),
        sampleRow({ orderNo: 'ORD-DUP', status: 'ที่ต้องจัดส่ง', productName: 'สินค้า B', qty: 2, netPrice: 200 }),
      ],
    })
    expect(first.ordersInserted).toBe(1)
    expect(first.ordersUpdated).toBe(0)

    // ส่งซ้ำด้วยสถานะยกเลิก
    const second = submitOnlineOrders(t, {
      platform: 'SHOPEE',
      shopKey: 'bebozch',
      rows: [
        sampleRow({ orderNo: 'ORD-DUP', status: 'ยกเลิกแล้ว', productName: 'สินค้า A', qty: 1, netPrice: 100 }),
      ],
    })
    expect(second.ordersInserted).toBe(0)
    expect(second.ordersUpdated).toBe(1)

    const orders = db.prepare(`SELECT * FROM online_orders WHERE tenant_id = ?`).all(t) as any[]
    expect(orders).toHaveLength(1)
    expect(orders[0].status_group).toBe('CANCELLED')

    const lines = db.prepare(`SELECT * FROM online_order_lines WHERE order_id = ?`).all(orders[0].id) as any[]
    expect(lines).toHaveLength(1)
    expect(lines[0].product_name).toBe('สินค้า A')
  })

  it('qty_returned เพิ่มขึ้น → สร้าง online_return_events ตามส่วนต่าง (ส่งซ้ำค่าเดิมไม่สร้างซ้ำ)', () => {
    const t = newTenant()
    submitOnlineOrders(t, {
      platform: 'SHOPEE',
      shopKey: 'bebozch',
      rows: [sampleRow({ orderNo: 'ORD-RET', qty: 3, qtyReturned: 0, status: 'สำเร็จ' })],
    })
    expect(listReturnEvents(t)).toHaveLength(0)

    // คืนเพิ่ม 1 ชิ้น
    const upd1 = submitOnlineOrders(t, {
      platform: 'SHOPEE',
      shopKey: 'bebozch',
      rows: [sampleRow({ orderNo: 'ORD-RET', qty: 3, qtyReturned: 1, status: 'สำเร็จ' })],
    })
    expect(upd1.returnEvents).toBe(1)

    // ส่งซ้ำค่าเดิม (qty_returned ยังเป็น 1) → ไม่สร้าง event ซ้ำ
    const upd2 = submitOnlineOrders(t, {
      platform: 'SHOPEE',
      shopKey: 'bebozch',
      rows: [sampleRow({ orderNo: 'ORD-RET', qty: 3, qtyReturned: 1, status: 'สำเร็จ' })],
    })
    expect(upd2.returnEvents).toBe(0)

    // คืนเพิ่มอีก 2 ชิ้น (รวมเป็น 3 → delta = 2)
    const upd3 = submitOnlineOrders(t, {
      platform: 'SHOPEE',
      shopKey: 'bebozch',
      rows: [sampleRow({ orderNo: 'ORD-RET', qty: 3, qtyReturned: 3, status: 'คำขอคืนเงิน/คืนสินค้า' })],
    })
    expect(upd3.returnEvents).toBe(1)

    const events = listReturnEvents(t)
    expect(events).toHaveLength(2)
    expect(events.map((e) => e.qtyDelta).sort()).toEqual([1, 2])
    expect(events.every((e) => e.status === 'PENDING')).toBe(true)
  })

  it('restockReturnEvents: สร้าง stock_movements IN 1 แถวต่อ event ที่รอบยืนยันขายแล้ว และ SKIP รอบที่ยังไม่ยืนยัน (ไม่ลงบัญชี)', () => {
    const t = newTenant()
    const stockId = makeStockItem(t, { name: 'หมอนยางพารา', quantity: 10, unitCost: 120 })

    // สร้างรอบเดือน 2026-09 (ยืนยันขายแล้ว) และ 2026-10 (ยังไม่ยืนยัน)
    const mSep = generateId()
    const mOct = generateId()
    db.prepare(`
      INSERT INTO platform_months (id, tenant_id, platform, shop_key, month, status, sale_confirmed_at, sale_confirmed_by)
      VALUES (?, ?, 'SHOPEE', 'bebozch', '2026-09', 'SALE_CONFIRMED', '2026-10-01T00:00:00Z', 'tester')
    `).run(mSep, t)
    db.prepare(`
      INSERT INTO platform_months (id, tenant_id, platform, shop_key, month, status, sale_confirmed_at)
      VALUES (?, ?, 'SHOPEE', 'bebozch', '2026-10', 'COLLECTING', NULL)
    `).run(mOct, t)

    // ส่งออเดอร์ทั้งสองเดือนก่อน แล้วค่อยอัปเดต qty_returned เพื่อสร้าง return event
    submitOnlineOrders(t, {
      platform: 'SHOPEE',
      shopKey: 'bebozch',
      rows: [
        sampleRow({ orderNo: 'ORD-SEP', orderTime: '2026-09-25 10:00', qty: 2, qtyReturned: 0 }),
        sampleRow({ orderNo: 'ORD-OCT', orderTime: '2026-10-10 10:00', qty: 2, qtyReturned: 0 }),
      ],
    })
    submitOnlineOrders(t, {
      platform: 'SHOPEE',
      shopKey: 'bebozch',
      rows: [
        sampleRow({ orderNo: 'ORD-SEP', orderTime: '2026-09-25 10:00', qty: 2, qtyReturned: 1 }),
        sampleRow({ orderNo: 'ORD-OCT', orderTime: '2026-10-10 10:00', qty: 2, qtyReturned: 1 }),
      ],
    })

    const events = listReturnEvents(t, 'PENDING')
    expect(events).toHaveLength(2)
    const sepEvent = events.find((e) => e.orderNo === 'ORD-SEP')!
    const octEvent = events.find((e) => e.orderNo === 'ORD-OCT')!
    expect(sepEvent.monthConfirmed).toBe(true)
    expect(octEvent.monthConfirmed).toBe(false)

    // ผูก alias ด้วย factor = 2 (แพ็ค 2 ชิ้น)
    confirmOnlineMapping(t, { sourceRef: sepEvent.sourceRef!, stockItemId: stockId, factor: 2 }, 'tester')

    const res = restockReturnEvents(t, [sepEvent.id, octEvent.id], 'tester')
    expect(res.restocked).toHaveLength(1)
    expect(res.restocked[0].id).toBe(sepEvent.id)
    expect(res.restocked[0].qtyIn).toBe(2) // qty_delta(1) × factor(2)
    expect(res.restocked[0].unitCost).toBe(120)
    expect(res.restocked[0].costAmount).toBe(240)

    expect(res.skipped).toHaveLength(1)
    expect(res.skipped[0].id).toBe(octEvent.id)
    expect(res.skipped[0].reason).toBe('จะหักในรอบเดือนนั้นเอง')

    // ตรวจ stock_movements — ต้องมี IN เพียง 1 แถวสำหรับ sepEvent เท่านั้น
    const movs = db.prepare(`SELECT * FROM stock_movements WHERE tenant_id = ?`).all(t) as any[]
    expect(movs).toHaveLength(1)
    expect(movs[0].type).toBe('IN')
    expect(movs[0].quantity).toBe(2)
    expect(movs[0].reference).toBe(`ONLINE_RETURN:${sepEvent.id}`)

    // ตรวจสต็อกเพิ่มจาก 10 → 12 และไม่ลงบัญชี
    const item = db.prepare(`SELECT quantity FROM stock_items WHERE id = ?`).get(stockId) as any
    expect(item.quantity).toBe(12)
    expect((db.prepare(`SELECT COUNT(*) AS c FROM journal_entries WHERE tenant_id = ?`).get(t) as any).c).toBe(0)

    // ตรวจสถานะ event
    const sepAfter = db.prepare(`SELECT status, stock_movement_id FROM online_return_events WHERE id = ?`).get(sepEvent.id) as any
    const octAfter = db.prepare(`SELECT status, stock_movement_id FROM online_return_events WHERE id = ?`).get(octEvent.id) as any
    expect(sepAfter.status).toBe('RESTOCKED')
    expect(sepAfter.stock_movement_id).toBe(movs[0].id)
    expect(octAfter.status).toBe('SKIPPED')
    expect(octAfter.stock_movement_id).toBeNull()

    // เรียกซ้ำต้องไม่สร้าง movement ซ้ำ
    const again = restockReturnEvents(t, [sepEvent.id], 'tester')
    expect(again.restocked).toHaveLength(0)
    expect((db.prepare(`SELECT COUNT(*) AS c FROM stock_movements WHERE tenant_id = ?`).get(t) as any).c).toBe(1)
  })

  it('getOnlineSummary คำนวณตัวเลข groupBy province / product / day ถูกต้อง (หัก returnsValue และไม่นับ CANCELLED/UNPAID)', () => {
    const t = newTenant()
    submitOnlineOrders(t, {
      platform: 'SHOPEE',
      shopKey: 'bebozch',
      rows: [
        // ออเดอร์ 1 (2 บรรทัด) จังหวัดชัยภูมิ วันที่ 2026-10-01
        sampleRow({ orderNo: 'O1', orderTime: '2026-10-01 09:00', province: 'ชัยภูมิ', productName: 'หมอน', variantName: 'A', qty: 2, qtyReturned: 0, netPrice: 400 }),
        sampleRow({ orderNo: 'O1', orderTime: '2026-10-01 09:00', province: 'ชัยภูมิ', productName: 'ผ้าห่ม', variantName: 'B', qty: 1, qtyReturned: 0, netPrice: 300 }),
        // ออเดอร์ 2 คืนบางส่วน (qty=2, qty_returned=1, netPrice=200 → returnsValue=100, netSales=100) จังหวัดราชบุรี วันที่ 2026-10-01
        sampleRow({ orderNo: 'O2', orderTime: '2026-10-01 15:00', province: 'ราชบุรี', productName: 'หมอน', variantName: 'A', qty: 2, qtyReturned: 1, netPrice: 200, status: 'สำเร็จ' }),
        // ออเดอร์ 3 วันที่ 2026-10-02 จังหวัดราชบุรี
        sampleRow({ orderNo: 'O3', orderTime: '2026-10-02 11:00', province: 'ราชบุรี', productName: 'ผ้าห่ม', variantName: 'B', qty: 1, qtyReturned: 0, netPrice: 300 }),
        // ออเดอร์ยกเลิกและยังไม่ชำระ — ต้องไม่ถูกนับในค่าเริ่มต้น
        sampleRow({ orderNo: 'O4', orderTime: '2026-10-02 12:00', province: 'ชัยภูมิ', productName: 'หมอน', qty: 5, netPrice: 1000, status: 'ยกเลิกแล้ว' }),
        sampleRow({ orderNo: 'O5', orderTime: '2026-10-02 13:00', province: 'ราชบุรี', productName: 'หมอน', qty: 3, netPrice: 600, status: 'ที่ต้องชำระ' }),
      ],
    })

    // groupBy province
    const byProv = getOnlineSummary(t, { from: '2026-10-01', to: '2026-10-31', groupBy: 'province' })
    expect(byProv).toHaveLength(2)
    const chaiyaphum = byProv.find((r) => r.key === 'ชัยภูมิ')!
    const ratchaburi = byProv.find((r) => r.key === 'ราชบุรี')!
    expect(chaiyaphum).toMatchObject({ orders: 1, qty: 3, qtyReturned: 0, sales: 700, returnsValue: 0, netSales: 700 })
    expect(ratchaburi).toMatchObject({ orders: 2, qty: 3, qtyReturned: 1, sales: 500, returnsValue: 100, netSales: 400 })

    // groupBy product
    const byProd = getOnlineSummary(t, { from: '2026-10-01', to: '2026-10-31', groupBy: 'product' })
    const pillow = byProd.find((r) => r.key === 'หมอน')!
    const blanket = byProd.find((r) => r.key === 'ผ้าห่ม')!
    expect(pillow).toMatchObject({ orders: 2, qty: 4, qtyReturned: 1, sales: 600, returnsValue: 100, netSales: 500 })
    expect(blanket).toMatchObject({ orders: 2, qty: 2, qtyReturned: 0, sales: 600, returnsValue: 0, netSales: 600 })

    // groupBy day
    const byDay = getOnlineSummary(t, { from: '2026-10-01', to: '2026-10-31', groupBy: 'day' })
    expect(byDay).toHaveLength(2)
    expect(byDay[0]).toMatchObject({ key: '2026-10-01', orders: 2, qty: 5, qtyReturned: 1, sales: 900, returnsValue: 100, netSales: 800 })
    expect(byDay[1]).toMatchObject({ key: '2026-10-02', orders: 1, qty: 1, qtyReturned: 0, sales: 300, returnsValue: 0, netSales: 300 })
  })

  it('tenant isolation: เทแนนต์ A ไม่เห็นข้อมูลของเทแนนต์ B และ restock ข้ามเทแนนต์ไม่ได้', () => {
    const tA = newTenant()
    const tB = newTenant()

    submitOnlineOrders(tA, { platform: 'SHOPEE', shopKey: 'shopA', rows: [sampleRow({ orderNo: 'A1', province: 'เชียงใหม่', netPrice: 100 })] })
    submitOnlineOrders(tB, { platform: 'SHOPEE', shopKey: 'shopB', rows: [sampleRow({ orderNo: 'B1', province: 'ภูเก็ต', netPrice: 999 })] })

    const sumA = getOnlineSummary(tA, { from: '2026-10-01', to: '2026-10-31', groupBy: 'province' })
    expect(sumA).toHaveLength(1)
    expect(sumA[0].key).toBe('เชียงใหม่')
    expect(sumA[0].sales).toBe(100)

    const listA = listOnlineOrders(tA)
    expect(listA.total).toBe(1)
    expect(listA.items[0].orderNo).toBe('A1')

    // สร้าง return event ของ tB แล้วให้ tA พยายาม restock → ต้องไม่ได้
    submitOnlineOrders(tB, { platform: 'SHOPEE', shopKey: 'shopB', rows: [sampleRow({ orderNo: 'B1', qty: 2, qtyReturned: 1 })] })
    const bEv = listReturnEvents(tB)[0]
    expect(listReturnEvents(tA)).toHaveLength(0)
    const cross = restockReturnEvents(tA, [bEv.id], 'hacker')
    expect(cross.restocked).toHaveLength(0)
    expect(cross.errors).toHaveLength(1)
  })

  it('relinkOnlineLines ทำงานอัตโนมัติเมื่อ submitFile(products) สำเร็จ + proposal/accept-all + unattributed-returns', () => {
    const t = newTenant()
    const stockId = makeStockItem(t, { sku: 'PILLOW-FL', name: 'หมอนลายดอก', quantity: 50, unitCost: 100 })

    // 1) ส่งออเดอร์ก่อนมีไฟล์ products → ได้ :N fallback source_ref
    submitOnlineOrders(t, {
      platform: 'SHOPEE',
      shopKey: 'bebozch',
      rows: [sampleRow({ orderNo: 'O-RELINK', orderTime: '2026-10-12 10:00', productName: 'หมอนยางพารา', variantName: 'ลายดอกไม้', qty: 3, qtyReturned: 1 })],
    })
    const beforeLine = db.prepare(`SELECT source_ref FROM online_order_lines WHERE tenant_id = ?`).get(t) as any
    expect(beforeLine.source_ref).toBe('SHOPEE:Nหมอนยางพารา||ลายดอกไม้')

    // 2) ส่งไฟล์ products ของเดือนเดียวกันผ่าน submitFile → relinkOnlineLines อัปเดตเป็น SHOPEE:V101 อัตโนมัติ
    submitFile(t, {
      platform: 'SHOPEE',
      shopKey: 'bebozch',
      month: '2026-10',
      fileType: 'products',
      data: {
        rows: [
          { level: 'parent', product_id: 'P100', product_name: 'หมอนยางพารา', qty_confirmed: 10, sales_confirmed: 2500 },
          { level: 'variant', product_id: 'P100', variant_id: 'V101', product_name: 'หมอนยางพารา', variant_name: 'ลายดอกไม้', qty_confirmed: 10, sales_confirmed: 2500 },
        ],
      },
    })
    const afterLine = db.prepare(`SELECT source_ref FROM online_order_lines WHERE tenant_id = ?`).get(t) as any
    expect(afterLine.source_ref).toBe(sourceRefOf('SHOPEE', { product_id: 'P100', variant_id: 'V101' }))

    // 3) เสนอคู่ + acceptAllOnlineProposals
    expect(getUnlinkedLines(t)).toHaveLength(1)
    const prop = proposeOnlineMapping(t, [{ sourceRef: 'SHOPEE:V101', sku: 'PILLOW-FL', factor: 1 }], 'mcp')
    expect(prop.accepted).toBe(1)
    expect(getUnlinkedLines(t)[0].proposed?.stockItemId).toBe(stockId)

    const accepted = acceptAllOnlineProposals(t, 'admin')
    expect(accepted.accepted).toBe(1)
    expect(getUnlinkedLines(t)).toHaveLength(0)

    // 4) ส่งไฟล์ orders รายเดือนที่มี qty_returned = 4 (รายออเดอร์มี 1) → คืนที่ไม่ระบุออเดอร์ = 3
    submitFile(t, {
      platform: 'SHOPEE',
      shopKey: 'bebozch',
      month: '2026-10',
      fileType: 'orders',
      data: {
        period_start: '2026-10-01',
        period_end: '2026-10-31',
        orders_total: 10,
        orders_cancelled: 0,
        rows: [
          { product_name: 'หมอนยางพารา', variant_name: 'ลายดอกไม้', qty_ordered: 10, qty_cancelled: 0, qty_unpaid: 0, qty_returned: 4, sales_net: 1500 },
        ],
      },
    })
    const unattr = getUnattributedReturns(t, 'SHOPEE', 'bebozch', '2026-10')
    expect(unattr).toHaveLength(1)
    expect(unattr[0]).toMatchObject({
      productName: 'หมอนยางพารา',
      variantName: 'ลายดอกไม้',
      monthlyQtyReturned: 4,
      onlineQtyReturned: 1,
      unattributedQty: 3,
    })
  })
})
