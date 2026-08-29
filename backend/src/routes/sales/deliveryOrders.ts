import { Router, Request, Response } from 'express'
import db from '../../db/sqlite'
import { generateId, formatDocumentNumber } from '../../utils/id'
import { convertQuantityBidirectional, autoUnpackIfNeeded, normalizeUnit } from '../../services/unitConversion.service'
import { roundQty } from '../../utils/qty'

const router = Router()

// GET all delivery orders
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const deliveryOrders = db.prepare(`
      SELECT do.*, c.name as customer_name, c.code as customer_code,
        so.so_number, so.total_amount
      FROM delivery_orders do
      LEFT JOIN customers c ON do.customer_id = c.id
      LEFT JOIN sales_orders so ON do.sales_order_id = so.id
      WHERE do.tenant_id = ?
      ORDER BY do.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: deliveryOrders })
  } catch (error) {
    console.error('Get delivery orders error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch delivery orders' })
  }
})

// GET single delivery order
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const deliveryOrder = db.prepare(`
      SELECT do.*, c.name as customer_name, c.code as customer_code,
        so.so_number, so.total_amount
      FROM delivery_orders do
      LEFT JOIN customers c ON do.customer_id = c.id
      LEFT JOIN sales_orders so ON do.sales_order_id = so.id
      WHERE do.id = ? AND do.tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!deliveryOrder) {
      return res.status(404).json({ success: false, message: 'Delivery order not found' })
    }

    const items = db.prepare(`
      SELECT doi.*, p.name as product_name, p.code as product_code, soi.quantity as ordered_qty
      FROM delivery_order_items doi
      LEFT JOIN sales_order_items soi ON doi.sales_order_item_id = soi.id
      LEFT JOIN products p ON doi.product_id = p.id
      WHERE doi.delivery_order_id = ?
    `).all(req.params.id)

    res.json({ success: true, data: { ...deliveryOrder, items } })
  } catch (error) {
    console.error('Get delivery order error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch delivery order' })
  }
})

// POST create delivery order (with partial delivery support)
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { salesOrderId, deliveryDate, deliveryAddress, driverName, vehiclePlate, notes, items, isPartial } = req.body
    
    if (!salesOrderId) {
      return res.status(400).json({ success: false, message: 'Sales order is required' })
    }

    // Get customer from sales order
    const salesOrder = db.prepare('SELECT customer_id FROM sales_orders WHERE id = ? AND tenant_id = ?').get(salesOrderId, tenantId) as any
    if (!salesOrder) {
      return res.status(404).json({ success: false, message: 'Sales order not found' })
    }

    const id = generateId()
    const doNumber = formatDocumentNumber('DO', tenantId, 'DELIVERY_ORDER', new Date().getFullYear(), 5)
    const now = new Date().toISOString()

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO delivery_orders (id, tenant_id, do_number, sales_order_id, customer_id, delivery_date, delivery_address,
          driver_name, vehicle_plate, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)
      `).run(id, tenantId, doNumber, salesOrderId, salesOrder.customer_id, deliveryDate || now, 
        deliveryAddress || '', driverName || '', vehiclePlate || '', notes || '', now, now)

      if (items && items.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO delivery_order_items (id, tenant_id, delivery_order_id, sales_order_item_id, product_id, quantity, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of items) {
          insertItem.run(generateId(), tenantId, id, item.salesOrderItemId, item.productId, item.quantity, item.notes || '')
        }
      }

      // If partial delivery, update SO status to PARTIAL
      if (isPartial) {
        db.prepare("UPDATE sales_orders SET status = 'PARTIAL', updated_at = ? WHERE id = ? AND tenant_id = ?")
          .run(now, salesOrderId, tenantId)
      }
    })

    transaction()

    const deliveryOrder = db.prepare('SELECT * FROM delivery_orders WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    const deliveryOrderItems = db.prepare('SELECT * FROM delivery_order_items WHERE delivery_order_id = ?').all(id)

    res.status(201).json({ success: true, data: { ...deliveryOrder, items: deliveryOrderItems } })
  } catch (error) {
    console.error('Create delivery order error:', error)
    res.status(500).json({ success: false, message: 'Failed to create delivery order' })
  }
})

// PUT update delivery order status (and auto update stock)
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { status } = req.body
    const validStatuses = ['DRAFT', 'READY', 'SHIPPED', 'DELIVERED', 'CANCELLED']
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' })
    }

    const deliveryOrder = db.prepare('SELECT * FROM delivery_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!deliveryOrder) {
      return res.status(404).json({ success: false, message: 'Delivery order not found' })
    }

    const now = new Date().toISOString()

    // When delivered, deduct stock
    if (status === 'DELIVERED' && deliveryOrder.status !== 'DELIVERED') {
      const items = db.prepare('SELECT * FROM delivery_order_items WHERE delivery_order_id = ?').all(req.params.id) as any[]

      const transaction = db.transaction(() => {
        db.prepare("UPDATE delivery_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
          .run(status, now, req.params.id, tenantId)

        // Update sales order delivered quantity
        for (const item of items) {
          db.prepare('UPDATE sales_order_items SET delivered_qty = delivered_qty + ? WHERE id = ?')
            .run(item.quantity, item.sales_order_item_id)

          // Deduct stock (with unit conversion)
          const stockItem = db.prepare('SELECT * FROM stock_items WHERE product_id = ? AND tenant_id = ?').get(item.product_id, tenantId) as any
          if (stockItem) {
            const soItem = db.prepare('SELECT unit FROM sales_order_items WHERE id = ?').get(item.sales_order_item_id) as any
            const soUnit = soItem?.unit || ''
            // stock_items.quantity is stored in base_unit, not the legacy `unit` column —
            // fall back to `unit` only when base_unit is empty (old rows).
            const stockUnit = stockItem.base_unit || stockItem.unit || ''
            let deductQty = item.quantity
            let movementNotes = `Delivered to customer`

            if (soUnit && stockUnit && normalizeUnit(soUnit) !== normalizeUnit(stockUnit)) {
              const converted = convertQuantityBidirectional(Number(item.quantity), soUnit, stockUnit, tenantId, stockItem.id)
              if (!converted) {
                throw new Error(`ไม่พบการแปลงหน่วย ${soUnit} → ${stockUnit} สำหรับ "${stockItem.name}" กรุณาตั้งค่า Unit Conversion ก่อน`)
              }
              deductQty = converted.converted
              movementNotes = `Delivered to customer (converted: ${item.quantity} ${soUnit} → ${converted.converted.toFixed(4)} ${stockUnit}, factor: ${converted.factor})`
            }

            const needed = roundQty(Number(deductQty))
            // auto-unpack ถ้า quantity ไม่พอ
            if (stockItem.quantity < needed && (stockItem.sealed_qty ?? 0) > 0) {
              const unpack = autoUnpackIfNeeded(stockItem, needed, tenantId)
              if (unpack && unpack.unpackedPacks > 0) {
                // quantity ของ stock_movements ต้องเป็น base unit (ไม่ใช่จำนวนแพ็ค) —
                // ดู unitConversion.service.ts:autoUnpackIfNeeded และ stock.routes.ts /:id/unpack
                const gained = roundQty(unpack.unpackedPacks * unpack.packFactor)
                db.prepare('UPDATE stock_items SET sealed_qty = ?, quantity = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
                  .run(unpack.sealed_qty, unpack.quantity, now, stockItem.id, tenantId)
                db.prepare(`INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by)
                  VALUES (?, ?, ?, 'UNPACK', ?, ?, ?, ?, ?, ?, ?)`)
                  .run(generateId(), tenantId, stockItem.id, gained, stockItem.display_unit || null, unpack.unpackedPacks, `DO: ${deliveryOrder.do_number}`,
                    `แกะอัตโนมัติ ${unpack.unpackedPacks} ${stockItem.display_unit} → ${gained} ${stockUnit}`, now, req.user!.userId)
                stockItem.quantity = unpack.quantity
              }
            }

            db.prepare('UPDATE stock_items SET quantity = quantity - ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
              .run(needed, now, stockItem.id, tenantId)

            // Record stock movement
            db.prepare(`
              INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
              VALUES (?, ?, ?, 'OUT', ?, ?, ?, ?, ?)
            `).run(generateId(), tenantId, stockItem.id, needed, `DO: ${deliveryOrder.do_number}`,
              movementNotes, now, req.user!.userId)
          }
        }

        // Check if all items delivered and update sales order status
        const salesOrderItems = db.prepare('SELECT * FROM sales_order_items WHERE sales_order_id = ?').all(deliveryOrder.sales_order_id) as any[]
        const allDelivered = salesOrderItems.every((item: any) => item.delivered_qty >= item.quantity)
        if (allDelivered) {
          db.prepare("UPDATE sales_orders SET status = 'DELIVERED', updated_at = ? WHERE id = ?")
            .run(now, deliveryOrder.sales_order_id)
        }
      })

      transaction()
    } else {
      db.prepare("UPDATE delivery_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(status, now, req.params.id, tenantId)
    }

    const updatedDO = db.prepare('SELECT * FROM delivery_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    res.json({ success: true, data: updatedDO })
  } catch (error) {
    console.error('Update delivery order status error:', error)
    res.status(500).json({ success: false, message: 'Failed to update status' })
  }
})

// DELETE delivery order (DRAFT only)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const doc = db.prepare('SELECT status FROM delivery_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Delivery order not found' })
    }
    if (doc.status !== 'DRAFT') {
      return res.status(400).json({ success: false, message: 'ลบได้เฉพาะใบส่งของสถานะ DRAFT เท่านั้น' })
    }
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM delivery_order_items WHERE delivery_order_id = ?').run(req.params.id)
      db.prepare('DELETE FROM delivery_orders WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantId)
    })
    tx()
    res.json({ success: true, message: 'Delivery order deleted' })
  } catch (error) {
    console.error('Delete delivery order error:', error)
    res.status(500).json({ success: false, message: 'Failed to delete delivery order' })
  }
})

export default router
