import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { randomUUID } from 'crypto'

const router = Router()

// ทุก Route ต้องมี Authentication
router.use(authenticate)

// Get all recommendations for a customer
router.get('/customer/:customerId', (req: Request, res: Response) => {
  try {
    const { customerId } = req.params
    const tenantId = req.user!.tenantId
    
    // ตรวจสอบว่า customer เป็นของ tenant นี้
    const customer = db.prepare('SELECT id FROM customers WHERE id = ? AND tenant_id = ?').get(customerId, tenantId)
    if (!customer) {
      return res.status(404).json({ success: false, message: 'ไม่พบลูกค้า' })
    }
    
    const recommendations = db.prepare(`
      SELECT * FROM customer_recommendations 
      WHERE customer_id = ? AND tenant_id = ?
      ORDER BY priority DESC, created_at DESC
    `).all(customerId, tenantId)
    
    res.json({ success: true, data: recommendations })
  } catch (error) {
    console.error('Get recommendations error:', error)
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลสินค้าแนะนำได้' })
  }
})

// Add new recommendation
router.post('/', (req: Request, res: Response) => {
  try {
    const { customerId, productId, productName, productCategory, reason, priority, notes } = req.body
    const tenantId = req.user!.tenantId
    const createdBy = req.user!.email
    
    if (!customerId || !productId || !productName) {
      return res.status(400).json({ 
        success: false, 
        message: 'กรุณากรอกข้อมูลให้ครบ (customerId, productId, productName)' 
      })
    }
    
    // ตรวจสอบว่า customer เป็นของ tenant นี้
    const customer = db.prepare('SELECT id FROM customers WHERE id = ? AND tenant_id = ?').get(customerId, tenantId)
    if (!customer) {
      return res.status(404).json({ success: false, message: 'ไม่พบลูกค้า' })
    }
    
    // ตรวจสอบว่ามี recommendation นี้อยู่แล้วหรือไม่
    const existing = db.prepare(`
      SELECT id FROM customer_recommendations 
      WHERE customer_id = ? AND product_id = ? AND tenant_id = ?
    `).get(customerId, productId, tenantId)
    
    if (existing) {
      return res.status(400).json({ success: false, message: 'สินค้านี้มีในรายการแนะนำแล้ว' })
    }
    
    const id = randomUUID().replace(/-/g, '').substring(0, 25)
    const now = new Date().toISOString()
    
    db.prepare(`
      INSERT INTO customer_recommendations 
      (id, tenant_id, customer_id, product_id, product_name, product_category, reason, priority, status, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, tenantId, customerId, productId, productName, productCategory || null, 
      reason || null, priority || 0, 'PENDING', notes || null, createdBy, now, now
    )
    
    const recommendation = db.prepare('SELECT * FROM customer_recommendations WHERE id = ?').get(id)
    
    res.status(201).json({ success: true, data: recommendation })
  } catch (error) {
    console.error('Create recommendation error:', error)
    res.status(500).json({ success: false, message: 'ไม่สามารถเพิ่มสินค้าแนะนำได้' })
  }
})

// Update recommendation status
router.put('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { status, notes } = req.body
    const tenantId = req.user!.tenantId
    
    const recommendation = db.prepare(`
      SELECT * FROM customer_recommendations WHERE id = ? AND tenant_id = ?
    `).get(id, tenantId)
    
    if (!recommendation) {
      return res.status(404).json({ success: false, message: 'ไม่พบรายการแนะนำ' })
    }
    
    const now = new Date().toISOString()
    const offeredAt = status === 'OFFERED' && recommendation.status !== 'OFFERED' ? now : recommendation.offered_at
    const offeredBy = status === 'OFFERED' && recommendation.status !== 'OFFERED' ? req.user!.email : recommendation.offered_by
    
    db.prepare(`
      UPDATE customer_recommendations 
      SET status = ?, notes = ?, offered_at = ?, offered_by = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(status || recommendation.status, notes || recommendation.notes, offeredAt, offeredBy, now, id, tenantId)
    
    const updated = db.prepare('SELECT * FROM customer_recommendations WHERE id = ?').get(id)
    
    res.json({ success: true, data: updated })
  } catch (error) {
    console.error('Update recommendation error:', error)
    res.status(500).json({ success: false, message: 'ไม่สามารถอัพเดทสถานะได้' })
  }
})

// Delete recommendation
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const tenantId = req.user!.tenantId
    
    const recommendation = db.prepare(`
      SELECT id FROM customer_recommendations WHERE id = ? AND tenant_id = ?
    `).get(id, tenantId)
    
    if (!recommendation) {
      return res.status(404).json({ success: false, message: 'ไม่พบรายการแนะนำ' })
    }
    
    db.prepare('DELETE FROM customer_recommendations WHERE id = ?').run(id)
    
    res.json({ success: true, message: 'ลบรายการแนะนำสำเร็จ' })
  } catch (error) {
    console.error('Delete recommendation error:', error)
    res.status(500).json({ success: false, message: 'ไม่สามารถลบรายการแนะนำได้' })
  }
})

// Search available products (from stock_items)
router.get('/products/search', (req: Request, res: Response) => {
  try {
    const { q } = req.query
    const tenantId = req.user!.tenantId
    
    if (!q || String(q).length < 2) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุคำค้นหาอย่างน้อย 2 ตัวอักษร' })
    }
    
    const searchTerm = `%${String(q).toLowerCase()}%`
    
    const products = db.prepare(`
      SELECT id, sku, name, category, unit 
      FROM stock_items 
      WHERE tenant_id = ? 
      AND status = 'ACTIVE'
      AND (LOWER(name) LIKE ? OR LOWER(sku) LIKE ?)
      ORDER BY name
      LIMIT 20
    `).all(tenantId, searchTerm, searchTerm)
    
    res.json({ success: true, data: products })
  } catch (error) {
    console.error('Search products error:', error)
    res.status(500).json({ success: false, message: 'ไม่สามารถค้นหาสินค้าได้' })
  }
})

export default router
