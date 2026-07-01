import { Router, Request, Response } from 'express'
import db from '../../db/sqlite'
import { generateId, formatDocumentNumber } from '../../utils/id'

const router = Router()

// GET all quotation templates
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const templates = db.prepare(`
      SELECT qt.*, 
        (SELECT COUNT(*) FROM quotation_template_items WHERE template_id = qt.id) as item_count
      FROM quotation_templates qt
      WHERE qt.tenant_id = ?
      ORDER BY qt.is_default DESC, qt.name ASC
    `).all(tenantId)

    res.json({ success: true, data: templates })
  } catch (error) {
    console.error('Get quotation templates error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch quotation templates' })
  }
})

// GET single quotation template
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const template = db.prepare(`
      SELECT * FROM quotation_templates WHERE id = ? AND tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' })
    }

    const items = db.prepare(`
      SELECT qti.*, p.name as product_name, p.code as product_code
      FROM quotation_template_items qti
      LEFT JOIN products p ON qti.product_id = p.id
      WHERE qti.template_id = ?
      ORDER BY qti.sort_order ASC
    `).all(req.params.id)

    res.json({ success: true, data: { ...template, items } })
  } catch (error) {
    console.error('Get quotation template error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch quotation template' })
  }
})

// POST create quotation template
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { name, description, expirationDays, headerText, footerText, termsConditions, isDefault, items } = req.body
    
    if (!name) {
      return res.status(400).json({ success: false, message: 'Template name is required' })
    }

    const id = generateId()
    const now = new Date().toISOString()

    const transaction = db.transaction(() => {
      // If setting as default, unset other defaults
      if (isDefault) {
        db.prepare('UPDATE quotation_templates SET is_default = 0 WHERE tenant_id = ?').run(tenantId)
      }

      db.prepare(`
        INSERT INTO quotation_templates (id, tenant_id, name, description, expiration_days, header_text, footer_text, terms_conditions, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, tenantId, name, description || '', expirationDays || 30, headerText || '', footerText || '', termsConditions || '', isDefault ? 1 : 0, now, now)

      if (items && items.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO quotation_template_items (id, tenant_id, template_id, product_id, quantity, unit_price, discount_percent, sort_order, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        items.forEach((item: any, index: number) => {
          insertItem.run(generateId(), tenantId, id, item.productId, item.quantity || 1,
            item.unitPrice || 0, item.discountPercent || 0, index, item.notes || '')
        })
      }
    })

    transaction()

    const template = db.prepare('SELECT * FROM quotation_templates WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    res.status(201).json({ success: true, data: template })
  } catch (error) {
    console.error('Create quotation template error:', error)
    res.status(500).json({ success: false, message: 'Failed to create quotation template' })
  }
})

// PUT update quotation template
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { name, description, expirationDays, headerText, footerText, termsConditions, isDefault } = req.body
    
    const existing = db.prepare('SELECT id FROM quotation_templates WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Template not found' })
    }

    const now = new Date().toISOString()

    const transaction = db.transaction(() => {
      if (isDefault) {
        db.prepare('UPDATE quotation_templates SET is_default = 0 WHERE tenant_id = ?').run(tenantId)
      }

      db.prepare(`
        UPDATE quotation_templates SET
          name = COALESCE(?, name),
          description = COALESCE(?, description),
          expiration_days = COALESCE(?, expiration_days),
          header_text = COALESCE(?, header_text),
          footer_text = COALESCE(?, footer_text),
          terms_conditions = COALESCE(?, terms_conditions),
          is_default = COALESCE(?, is_default),
          updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run(name, description, expirationDays, headerText, footerText, termsConditions, isDefault !== undefined ? (isDefault ? 1 : 0) : undefined, now, req.params.id, tenantId)
    })

    transaction()

    const template = db.prepare('SELECT * FROM quotation_templates WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    res.json({ success: true, data: template })
  } catch (error) {
    console.error('Update quotation template error:', error)
    res.status(500).json({ success: false, message: 'Failed to update quotation template' })
  }
})

// DELETE quotation template
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const existing = db.prepare('SELECT id FROM quotation_templates WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Template not found' })
    }

    db.prepare('DELETE FROM quotation_templates WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantId)

    res.json({ success: true, message: 'Template deleted' })
  } catch (error) {
    console.error('Delete quotation template error:', error)
    res.status(500).json({ success: false, message: 'Failed to delete template' })
  }
})

// POST create quotation from template
router.post('/from-template', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { templateId, customerId, expiryDate, notes } = req.body
    
    if (!templateId || !customerId) {
      return res.status(400).json({ success: false, message: 'Template and customer are required' })
    }

    // Get template
    const template = db.prepare('SELECT * FROM quotation_templates WHERE id = ? AND tenant_id = ?').get(templateId, tenantId) as any
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' })
    }

    // Get template items
    const templateItems = db.prepare('SELECT * FROM quotation_template_items WHERE template_id = ?').all(templateId) as any[]

    const id = generateId()
    const quotationNumber = formatDocumentNumber('QT', tenantId, 'QUOTATION', new Date().getFullYear(), 5)
    const now = new Date().toISOString()
    const expiry = expiryDate || new Date(Date.now() + (template.expiration_days * 24 * 60 * 60 * 1000)).toISOString()

    // Calculate totals
    let subtotal = 0
    for (const item of templateItems) {
      const itemTotal = item.quantity * item.unit_price * (1 - (item.discount_percent || 0) / 100)
      subtotal += itemTotal
    }
    const taxRate = 7
    const taxAmount = subtotal * (taxRate / 100)
    const totalAmount = subtotal + taxAmount

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO quotations (id, tenant_id, quotation_number, customer_id, quotation_date, expiry_date,
          subtotal, discount_amount, tax_rate, tax_amount, total_amount, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)
      `).run(id, tenantId, quotationNumber, customerId, now, expiry,
        subtotal, 0, taxRate, taxAmount, totalAmount, notes || template.header_text, now, now)

      const insertItem = db.prepare(`
        INSERT INTO quotation_items (id, tenant_id, quotation_id, product_id, quantity, unit_price, discount_percent, total_price, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const item of templateItems) {
        const itemTotal = item.quantity * item.unit_price * (1 - (item.discount_percent || 0) / 100)
        insertItem.run(generateId(), tenantId, id, item.product_id, item.quantity,
          item.unit_price, item.discount_percent || 0, itemTotal, item.notes || '')
      }
    })

    transaction()

    const quotation = db.prepare('SELECT * FROM quotations WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    const quotationItems = db.prepare('SELECT * FROM quotation_items WHERE quotation_id = ?').all(id)

    res.status(201).json({ success: true, data: { ...quotation, items: quotationItems } })
  } catch (error) {
    console.error('Create quotation from template error:', error)
    res.status(500).json({ success: false, message: 'Failed to create quotation from template' })
  }
})

export default router
