import { Router, Request, Response } from 'express'
import db from '../../db/sqlite'
import { generateId, formatDocumentNumber } from '../../utils/id'

const router = Router()

// GET all quotations
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const quotations = db.prepare(`
      SELECT q.*, c.name as customer_name, c.code as customer_code,
        (SELECT COUNT(*) FROM quotation_items WHERE quotation_id = q.id) as item_count
      FROM quotations q
      LEFT JOIN customers c ON q.customer_id = c.id
      WHERE q.tenant_id = ?
      ORDER BY q.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: quotations })
  } catch (error) {
    console.error('Get quotations error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch quotations' })
  }
})

// GET single quotation
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const quotation = db.prepare(`
      SELECT q.*, c.name as customer_name, c.code as customer_code, c.email as customer_email, c.phone as customer_phone
      FROM quotations q
      LEFT JOIN customers c ON q.customer_id = c.id
      WHERE q.id = ? AND q.tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!quotation) {
      return res.status(404).json({ success: false, message: 'Quotation not found' })
    }

    const items = db.prepare(`
      SELECT qi.*, p.name as product_name, p.code as product_code
      FROM quotation_items qi
      LEFT JOIN products p ON qi.product_id = p.id
      WHERE qi.quotation_id = ?
    `).all(req.params.id)

    res.json({ success: true, data: { ...quotation, items } })
  } catch (error) {
    console.error('Get quotation error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch quotation' })
  }
})

// POST create quotation
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { customerId, expiryDate, notes, items, taxRate, discountAmount, templateId } = req.body
    
    if (!customerId) {
      return res.status(400).json({ success: false, message: 'Customer is required' })
    }

    const id = generateId()
    const quotationNumber = formatDocumentNumber('QT', tenantId, 'QUOTATION', new Date().getFullYear(), 5)
    const now = new Date().toISOString()

    // Calculate totals
    let subtotal = 0
    if (items && items.length > 0) {
      subtotal = items.reduce((sum: number, item: any) => {
        const itemTotal = item.quantity * item.unitPrice * (1 - (item.discountPercent || 0) / 100)
        return sum + itemTotal
      }, 0)
    }
    const discount = discountAmount || 0
    const tax = taxRate || 0
    const afterDiscount = subtotal - discount
    const taxAmount = afterDiscount * (tax / 100)
    const totalAmount = afterDiscount + taxAmount

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO quotations (id, tenant_id, quotation_number, customer_id, quotation_date, expiry_date,
          subtotal, discount_amount, tax_rate, tax_amount, total_amount, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)
      `).run(id, tenantId, quotationNumber, customerId, now, expiryDate || null,
        subtotal, discount, tax, taxAmount, totalAmount, notes || '', now, now)

      if (items && items.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO quotation_items (id, tenant_id, quotation_id, stock_item_id, product_id, product_name, quantity, unit, unit_price, discount_percent, total_price, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of items) {
          const itemTotal = item.quantity * item.unitPrice * (1 - (item.discountPercent || 0) / 100)
          insertItem.run(generateId(), tenantId, id,
            item.productId || null, null, item.productName || null,
            item.quantity, item.unit || '', item.unitPrice, item.discountPercent || 0, itemTotal, item.notes || '')
        }
      }
    })

    transaction()

    const quotation = db.prepare('SELECT * FROM quotations WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    const quotationItems = db.prepare('SELECT * FROM quotation_items WHERE quotation_id = ?').all(id)

    res.status(201).json({ success: true, data: { ...quotation, items: quotationItems } })
  } catch (error) {
    console.error('Create quotation error:', error)
    res.status(500).json({ success: false, message: 'Failed to create quotation' })
  }
})

// PUT update quotation content (DRAFT/SENT only)
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { customerId, expiryDate, notes, items, taxRate, discountAmount } = req.body
    const now = new Date().toISOString()

    const existing = db.prepare('SELECT * FROM quotations WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!existing) return res.status(404).json({ success: false, message: 'Quotation not found' })
    if (!['DRAFT', 'SENT'].includes(existing.status)) {
      return res.status(400).json({ success: false, message: `ไม่สามารถแก้ไขได้ — สถานะ ${existing.status}` })
    }

    let subtotal = 0
    if (items && items.length > 0) {
      subtotal = items.reduce((sum: number, item: any) => {
        return sum + item.quantity * item.unitPrice * (1 - (item.discountPercent || 0) / 100)
      }, 0)
    }
    const discount = discountAmount || 0
    const tax = taxRate ?? existing.tax_rate ?? 0
    const afterDiscount = subtotal - discount
    const taxAmount = afterDiscount * (tax / 100)
    const totalAmount = afterDiscount + taxAmount

    const transaction = db.transaction(() => {
      db.prepare(`
        UPDATE quotations
        SET customer_id = COALESCE(?, customer_id), expiry_date = ?,
            subtotal = ?, discount_amount = ?, tax_rate = ?, tax_amount = ?, total_amount = ?,
            notes = COALESCE(?, notes), updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run(customerId || null, expiryDate || null, subtotal, discount, tax, taxAmount, totalAmount, notes ?? null, now, req.params.id, tenantId)

      if (items) {
        db.prepare('DELETE FROM quotation_items WHERE quotation_id = ?').run(req.params.id)
        const ins = db.prepare(`
          INSERT INTO quotation_items (id, tenant_id, quotation_id, stock_item_id, product_id, product_name, quantity, unit, unit_price, discount_percent, total_price, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of items) {
          const itemTotal = item.quantity * item.unitPrice * (1 - (item.discountPercent || 0) / 100)
          ins.run(generateId(), tenantId, req.params.id,
            item.productId || null, null, item.productName || null,
            item.quantity, item.unit || '', item.unitPrice, item.discountPercent || 0, itemTotal, item.notes || '')
        }
      }
    })
    transaction()

    const quotation = db.prepare('SELECT * FROM quotations WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    const quotationItems = db.prepare('SELECT * FROM quotation_items WHERE quotation_id = ?').all(req.params.id)
    res.json({ success: true, data: { ...quotation, items: quotationItems } })
  } catch (error) {
    console.error('Update quotation error:', error)
    res.status(500).json({ success: false, message: 'Failed to update quotation' })
  }
})

// PUT update quotation status
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { status } = req.body
    const validStatuses = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED']
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' })
    }

    const existing = db.prepare('SELECT id FROM quotations WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Quotation not found' })
    }

    const now = new Date().toISOString()
    db.prepare("UPDATE quotations SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(status, now, req.params.id, tenantId)

    const quotation = db.prepare('SELECT * FROM quotations WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    res.json({ success: true, data: quotation })
  } catch (error) {
    console.error('Update quotation status error:', error)
    res.status(500).json({ success: false, message: 'Failed to update status' })
  }
})

// DELETE quotation (DRAFT only)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const qt = db.prepare('SELECT status FROM quotations WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!qt) {
      return res.status(404).json({ success: false, message: 'Quotation not found' })
    }
    if (qt.status !== 'DRAFT') {
      return res.status(400).json({ success: false, message: 'ลบได้เฉพาะใบเสนอราคาสถานะ DRAFT เท่านั้น' })
    }
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM quotation_items WHERE quotation_id = ?').run(req.params.id)
      db.prepare('DELETE FROM quotations WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantId)
    })
    tx()
    res.json({ success: true, message: 'Quotation deleted' })
  } catch (error) {
    console.error('Delete quotation error:', error)
    res.status(500).json({ success: false, message: 'Failed to delete quotation' })
  }
})

export default router
