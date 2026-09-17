import { z } from 'zod'
import db from '../../db/sqlite'
import { IMcpServer } from '../sdk-compat'
import { randomUUID } from 'crypto'
import { ok } from './shared'
import { applyStockMovement, movementGateAmount } from '../../services/stockMovement.service'
import { gateOrCreate, recordAutoAction, CreateRequestArgs } from '../../services/approvalGate.service'

export function registerStockTools(server: IMcpServer, tenantId: string, userId: string, callerName: string, callerRole: string): void {
  // ── 7. record_stock_movement ────────────────────────────────────────────────
  server.tool(
    'record_stock_movement',
    `ปรับยอดสต็อกให้ตรงกับของที่นับได้จริง / Adjust stock quantity to the counted amount.
ใช้เมื่อนับของแล้วไม่ตรงกับในระบบ เช่น ของเสีย ของหาย นับผิดรอบก่อน
ตัวอย่าง: "นับหมูสับได้ 8 กก. แต่ระบบว่ามี 10" → record_stock_movement(stock_item_id="...", quantity=8, unit="kg", adjust_reason="ของเสีย/หมดอายุ")
quantity คือ "ยอดหลังปรับ" ไม่ใช่ส่วนต่าง · ระบบแปลงหน่วยให้อัตโนมัติ
ลงบัญชีและเข้าทะเบียนการปรับสต็อกให้ครบ และผ่านประตูอนุมัติเหมือนหน้าเว็บ

รับของเข้าคลังให้ทำผ่านใบสั่งซื้อ/ใบรับสินค้า · ตัดของออกให้ทำผ่านใบขายหรือใบสั่งผลิต
เครื่องมือนี้ทำ 2 อย่างนั้นไม่ได้แล้ว เพราะของจะขยับโดยบัญชีไม่ขยับตาม`,
    {
      stock_item_id: z.string().describe('ID ของ stock item (หรือใช้ sku ถ้าระบุ sku)'),
      type: z.enum(['IN', 'OUT', 'ADJUST']).optional().describe('รองรับเฉพาะ ADJUST (ปรับยอด) — IN/OUT ถูกปิดแล้ว'),
      quantity: z.number().describe('ยอดสต็อกหลังปรับ (ในหน่วยที่ระบุ) ไม่ใช่ส่วนต่าง'),
      adjust_reason: z.string().optional().describe('เหตุผล: ของเสีย/หมดอายุ · ของหาย · แตก/ชำรุด · นับผิดรอบก่อน · รับเพิ่มไม่ผ่านใบ · เบิกใช้ไม่ได้บันทึก'),
      unit: z.string().optional().describe('หน่วย (ถ้าไม่ระบุจะใช้หน่วยของ stock item)'),
      reference: z.string().optional().describe('เลขที่อ้างอิง เช่น PO-2024-00001'),
      notes: z.string().optional().describe('หมายเหตุ'),

    },
    async (args) => {
      const { stock_item_id, type, quantity, unit, reference, notes, adjust_reason } = args

      // ของเข้าจริงมีทางของมันคือใบรับสินค้า ของออกจริงมาจากขาย/ผลิต
      // ปล่อยให้ MCP ยิง IN/OUT ได้ = ประตูหลังที่ขยับของโดยบัญชีไม่ขยับ (ปุ่มบนเว็บถูกลบไปแล้วด้วยเหตุผลเดียวกัน)
      if (type && type !== 'ADJUST') {
        return ok({
          success: false,
          message: 'เครื่องมือนี้ปรับยอดสต็อกได้อย่างเดียว — รับของเข้าให้ทำผ่านใบสั่งซื้อ/ใบรับสินค้า ตัดของออกให้ทำผ่านใบขายหรือใบสั่งผลิต',
        })
      }

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
      const movementUnit = unit || baseUnit

      // ประตูอนุมัติตัวเดียวกับหน้าเว็บ — เกินวงเงินของ role นี้ต้องรอคนอนุมัติ ของยังไม่ขยับ
      const gateArgs: CreateRequestArgs = {
        tenantId,
        user: { userId, email: callerName, role: callerRole },
        category: 'stock_adjust',
        refType: 'stock_items',
        refId: stockItemId,
        amount: movementGateAmount(tenantId, item, 'ADJUST', Number(quantity), movementUnit),
        description: `ปรับยอด ${item.name} เป็น ${quantity} ${movementUnit}${adjust_reason ? ' เนื่องจาก ' + adjust_reason : ''}`,
        payload: { stockItemId, type: 'ADJUST', quantity, unit: movementUnit, reference, notes, adjustReason: adjust_reason },
      }
      const pending = gateOrCreate(gateArgs)
      if (pending) {
        return ok({
          success: true,
          pending_approval: true,
          request_number: pending.request_number,
          message: `ส่งคำขออนุมัติแล้ว (${pending.request_number}) สต็อกจะเปลี่ยนเมื่อผู้อนุมัติยืนยัน`,
        })
      }

      try {
        // service กลางตัวเดียวกับหน้าเว็บ — ลง journal + เขียนทะเบียนการปรับสต็อกให้ในตัว
        // (ของเดิมตรงนี้ UPDATE quantity + INSERT stock_movements เอง บัญชีจึงไม่เคยขยับตาม)
        const updated = applyStockMovement(tenantId, callerName || userId, {
          stockItemId,
          type: 'ADJUST',
          quantity: Number(quantity),
          unit: movementUnit,
          reference,
          notes,
          adjustReason: adjust_reason,
        })
        recordAutoAction(gateArgs)
        return ok({
          success: true,
          type: 'ADJUST',
          stockItem: { id: stockItemId, name: item.name, sku: item.sku, quantity: updated.quantity, unit: baseUnit },
          message: `ปรับยอด ${item.name} เป็น ${updated.quantity} ${baseUnit} สำเร็จ`,
        })
      } catch (e: any) {
        return ok({ success: false, message: e?.message || 'ปรับยอดสต็อกไม่สำเร็จ' })
      }
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
