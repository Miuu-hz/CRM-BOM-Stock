import { z } from 'zod'
import db from '../../db/sqlite'
import { IMcpServer } from '../sdk-compat'
import { randomUUID } from 'crypto'
import { convertQuantityBidirectional, autoUnpackIfNeeded, normalizeUnit } from '../../services/unitConversion.service'
import { ok } from './shared'

export function registerStockTools(server: IMcpServer, tenantId: string, userId: string): void {
  // ── 7. record_stock_movement ────────────────────────────────────────────────
  server.tool(
    'record_stock_movement',
    `บันทึกการเคลื่อนไหวสต็อก (รับเข้า/เบิกออก/ปรับยอด) / Record stock movement IN, OUT, or ADJUST.
ใช้เมื่อผู้ใช้ต้องการรับสินค้าเข้าคลัง เบิกใช้ หรือปรับยอดสต็อก
ตัวอย่าง: "รับหมูสับเข้า 10 กก." → record_stock_movement(stock_item_id="...", type="IN", quantity=10, unit="kg", notes="รับจากซัพพลายเออร์ A")
"เบิกหมูสับไปทำกะเพรา 2 กก." → record_stock_movement(stock_item_id="...", type="OUT", quantity=2, unit="kg")
ระบบจะแปลงหน่วยอัตโนมัติและทำ auto-unpack ถ้าจำเป็น`,
    {
      stock_item_id: z.string().describe('ID ของ stock item (หรือใช้ sku ถ้าระบุ sku)'),
      type: z.enum(['IN', 'OUT', 'ADJUST']).describe('ประเภท: IN=รับเข้า, OUT=เบิกออก, ADJUST=ปรับยอด'),
      quantity: z.number().describe('จำนวน (ในหน่วยที่ระบุ)'),
      unit: z.string().optional().describe('หน่วย (ถ้าไม่ระบุจะใช้หน่วยของ stock item)'),
      reference: z.string().optional().describe('เลขที่อ้างอิง เช่น PO-2024-00001'),
      notes: z.string().optional().describe('หมายเหตุ'),
      unit_cost: z.number().optional().describe('ราคาต่อหน่วย (ใช้กับ type=IN เท่านั้น)'),
    },
    async (args) => {
      const { stock_item_id, type, quantity, unit, reference, notes, unit_cost } = args

      // Find stock item by ID or SKU
      let item = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(stock_item_id, tenantId) as any
      if (!item) {
        item = db.prepare('SELECT * FROM stock_items WHERE sku = ? AND tenant_id = ?').get(stock_item_id, tenantId) as any
      }
      if (!item) {
        return ok({ success: false, message: `ไม่พบ stock item: ${stock_item_id}` })
      }

      const stockItemId = item.id
      const baseUnit = item.base_unit || item.unit
      const movementUnit = unit || item.unit
      let convertedQuantity = Number(quantity)

      // Convert movement unit to base unit if different
      if (movementUnit !== baseUnit) {
        const conversion = convertQuantityBidirectional(Number(quantity), movementUnit, baseUnit, tenantId, stockItemId)
        if (!conversion) {
          return ok({
            success: false,
            message: `ไม่พบการแปลงหน่วยจาก "${movementUnit}" เป็น "${baseUnit}" กรุณาตั้งค่าการแปลงหน่วยใน Settings > การแปลงหน่วย`,
          })
        }
        convertedQuantity = conversion.converted
      }

      if (type === 'ADJUST' && convertedQuantity < 0) {
        return ok({ success: false, message: 'ปรับยอดสต็อกไม่ได้ — ค่าต้องไม่ติดลบ' })
      }

      let newQuantity = item.quantity
      let newSealedQty = item.sealed_qty ?? 0
      const now = new Date().toISOString()

      if (type === 'IN') {
        newQuantity += convertedQuantity
      } else if (type === 'OUT') {
        // auto-unpack if quantity insufficient but sealed_qty available
        if (item.quantity < convertedQuantity && (item.sealed_qty ?? 0) > 0) {
          const unpack = autoUnpackIfNeeded(item, convertedQuantity, tenantId)
          if (unpack && unpack.unpackedPacks > 0) {
            db.prepare(`
              INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
              VALUES (?, ?, ?, 'UNPACK', ?, ?, ?, ?, ?)
            `).run(
              randomUUID().replace(/-/g, '').substring(0, 25), tenantId, stockItemId,
              unpack.unpackedPacks, reference || 'AUTO',
              `แกะอัตโนมัติ ${unpack.unpackedPacks} ${item.display_unit || ''}`, now, userId
            )
            db.prepare('UPDATE stock_items SET sealed_qty = ?, updated_at = ? WHERE id = ?')
              .run(unpack.sealed_qty, now, stockItemId)
            newSealedQty = unpack.sealed_qty
            newQuantity = unpack.quantity
            item.quantity = unpack.quantity
          }
        }
        if (newQuantity < convertedQuantity) {
          return ok({ success: false, message: 'สต็อกไม่พอสำหรับเบิกออก' })
        }
        newQuantity -= convertedQuantity
      } else if (type === 'ADJUST') {
        newQuantity = convertedQuantity
      }

      if (type === 'IN' && unit_cost !== undefined && unit_cost !== null) {
        db.prepare('UPDATE stock_items SET quantity = ?, unit_cost = ?, updated_at = ? WHERE id = ?')
          .run(newQuantity, Number(unit_cost), now, stockItemId)
      } else {
        db.prepare('UPDATE stock_items SET quantity = ?, updated_at = ? WHERE id = ?')
          .run(newQuantity, now, stockItemId)
      }

      const movementId = randomUUID().replace(/-/g, '').substring(0, 25)
      db.prepare(`
        INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(movementId, tenantId, stockItemId, type, convertedQuantity, movementUnit, Number(quantity), reference || '', notes || '', now, userId)

      const updatedItem = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(stockItemId)
      return ok({
        success: true,
        movementId,
        type,
        stockItem: { id: stockItemId, name: item.name, sku: item.sku, quantity: newQuantity, unit: baseUnit },
        message: `บันทึก${type === 'IN' ? 'รับเข้า' : type === 'OUT' ? 'เบิกออก' : 'ปรับยอด'} ${quantity} ${movementUnit} สำเร็จ`,
      })
    }
  )

  // ── 15. manage_unit_conversion ──────────────────────────────────────────────
  server.tool(
    'manage_unit_conversion',
    `จัดการการแปลงหน่วย (Unit Conversion) / Create, update, or delete unit conversions.
ใช้เมื่อต้องการตั้งค่าหน่วยแปลงใหม่ แก้ไข หรือลบ
ตัวอย่าง:
  สร้าง: manage_unit_conversion(action="create", from_unit="kg", to_unit="g", conversion_factor=1000)
  แก้ไข: manage_unit_conversion(action="update", conversion_id="...", conversion_factor=1200)
  ลบ: manage_unit_conversion(action="delete", conversion_id="...")`,
    {
      action: z.enum(['create', 'update', 'delete']).describe('create | update | delete'),
      conversion_id: z.string().optional().describe('ID สำหรับ update/delete'),
      from_unit: z.string().optional().describe('หน่วยต้นทาง (สำหรับ create)'),
      to_unit: z.string().optional().describe('หน่วยปลายทาง (สำหรับ create)'),
      conversion_factor: z.number().optional().describe('ตัวคูณ (สำหรับ create/update)'),
      material_id: z.string().optional().describe('ID วัตถุดิบถ้าเป็น per-material (optional)'),
      notes: z.string().optional().describe('หมายเหตุ (สำหรับ create/update)'),
    },
    async (args) => {
      const { action, conversion_id, from_unit, to_unit, conversion_factor, material_id, notes } = args

      if (action === 'create') {
        if (!from_unit || !to_unit || conversion_factor == null) {
          return ok({ success: false, message: 'from_unit, to_unit, conversion_factor จำเป็นต้องระบุ' })
        }
        if (Number(conversion_factor) <= 0) {
          return ok({ success: false, message: 'conversion_factor ต้องมากกว่า 0' })
        }
        if (from_unit === to_unit) {
          return ok({ success: false, message: 'หน่วยต้นทางและปลายทางต้องไม่เหมือนกัน' })
        }

        try {
          const id = randomUUID().replace(/-/g, '').substring(0, 25)
          const now = new Date().toISOString()
          db.prepare(`
            INSERT INTO unit_conversions (id, tenant_id, material_id, from_unit, to_unit, conversion_factor, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(id, tenantId, material_id || null, from_unit, to_unit, Number(conversion_factor), notes || '', now, now)

          return ok({ success: true, conversionId: id, from_unit, to_unit, conversion_factor, message: `สร้างการแปลงหน่วย ${from_unit} → ${to_unit} สำเร็จ` })
        } catch (error: any) {
          if (error?.message?.includes('UNIQUE')) {
            return ok({ success: false, message: 'มีการแปลงหน่วยนี้อยู่แล้ว' })
          }
          return ok({ success: false, message: 'สร้างการแปลงหน่วยไม่สำเร็จ' })
        }
      }

      if (action === 'update') {
        if (!conversion_id) {
          return ok({ success: false, message: 'conversion_id จำเป็นต้องระบุ' })
        }
        if (conversion_factor != null && Number(conversion_factor) <= 0) {
          return ok({ success: false, message: 'conversion_factor ต้องมากกว่า 0' })
        }

        const existing = db.prepare('SELECT * FROM unit_conversions WHERE id = ? AND tenant_id = ?').get(conversion_id, tenantId) as any
        if (!existing) {
          return ok({ success: false, message: `ไม่พบ conversion: ${conversion_id}` })
        }

        const now = new Date().toISOString()
        db.prepare(`
          UPDATE unit_conversions SET conversion_factor = COALESCE(?, conversion_factor), notes = COALESCE(?, notes), updated_at = ?
          WHERE id = ? AND tenant_id = ?
        `).run(conversion_factor !== undefined ? Number(conversion_factor) : undefined, notes || undefined, now, conversion_id, tenantId)

        return ok({ success: true, conversionId: conversion_id, message: `อัปเดตการแปลงหน่วยสำเร็จ` })
      }

      if (action === 'delete') {
        if (!conversion_id) {
          return ok({ success: false, message: 'conversion_id จำเป็นต้องระบุ' })
        }
        const existing = db.prepare('SELECT * FROM unit_conversions WHERE id = ? AND tenant_id = ?').get(conversion_id, tenantId) as any
        if (!existing) {
          return ok({ success: false, message: `ไม่พบ conversion: ${conversion_id}` })
        }
        db.prepare('DELETE FROM unit_conversions WHERE id = ? AND tenant_id = ?').run(conversion_id, tenantId)
        return ok({ success: true, message: `ลบการแปลงหน่วยสำเร็จ` })
      }

      return ok({ success: false, message: 'action ไม่ถูกต้อง' })
    }
  )

  // ── 18. get_stock_movements ─────────────────────────────────────────────────
  server.tool(
    'get_stock_movements',
    `ดูประวัติการเคลื่อนไหวสต็อก / View stock movement history.
ใช้เมื่อถามว่า "หมูสับรับเข้าเมื่อไหร่" "เบิกออกไปเท่าไหร่" "ประวัติการเคลื่อนไหวเดือนนี้"
ต้องระบุ stock_item_id หรือใช้ search() หาก่อน`,
    {
      stock_item_id: z.string().describe('ID หรือ SKU ของ stock item'),
      type: z.enum(['IN', 'OUT', 'ADJUST', 'UNPACK']).optional().describe('กรองประเภท IN=รับเข้า OUT=เบิก ADJUST=ปรับ'),
      days: z.number().optional().describe('ย้อนหลังกี่วัน (default: 30)'),
    },
    async (args) => {
      const { stock_item_id, type, days = 30 } = args

      let item = db.prepare('SELECT id, name, sku, unit, quantity FROM stock_items WHERE id = ? AND tenant_id = ?').get(stock_item_id, tenantId) as any
      if (!item) {
        item = db.prepare('SELECT id, name, sku, unit, quantity FROM stock_items WHERE sku = ? AND tenant_id = ?').get(stock_item_id, tenantId) as any
      }
      if (!item) return ok({ success: false, message: `ไม่พบ stock item: ${stock_item_id}` })

      const typeFilter = type ? 'AND type = ?' : ''
      const queryParams: any[] = [item.id, `-${days} days`]
      if (type) queryParams.push(type)

      const movements = db.prepare(`
        SELECT type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by
        FROM stock_movements
        WHERE stock_item_id = ? AND created_at >= date('now', ?)
        ${typeFilter}
        ORDER BY created_at DESC LIMIT 50
      `).all(...queryParams)

      const totalIn = (movements as any[]).filter(m => m.type === 'IN').reduce((s, m) => s + m.quantity, 0)
      const totalOut = (movements as any[]).filter(m => m.type === 'OUT').reduce((s, m) => s + m.quantity, 0)

      return ok({
        item: { id: item.id, name: item.name, sku: item.sku, current_quantity: item.quantity, unit: item.unit },
        period_days: days,
        total_in: totalIn,
        total_out: totalOut,
        movements,
      })
    }
  )
}
