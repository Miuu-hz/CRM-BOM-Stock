import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { randomUUID } from 'crypto'

const router = Router()

// ทุก Route ต้องมี Authentication
router.use(authenticate)

// Get activity logs for a customer
router.get('/customer/:customerId', (req: Request, res: Response) => {
  try {
    const { customerId } = req.params
    const tenantId = req.user!.tenantId
    
    // ตรวจสอบว่า customer เป็นของ tenant นี้
    const customer = db.prepare('SELECT id FROM customers WHERE id = ? AND tenant_id = ?').get(customerId, tenantId)
    if (!customer) {
      return res.status(404).json({ success: false, message: 'ไม่พบลูกค้า' })
    }
    
    const activities = db.prepare(`
      SELECT * FROM activity_logs 
      WHERE customer_id = ? AND tenant_id = ?
      ORDER BY created_at DESC
    `).all(customerId, tenantId)
    
    res.json({ success: true, data: activities })
  } catch (error) {
    console.error('Get activities error:', error)
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลกิจกรรมได้' })
  }
})

// Create activity log
router.post('/', (req: Request, res: Response) => {
  try {
    const { customerId, type, note } = req.body
    const tenantId = req.user!.tenantId
    const createdBy = req.user!.email
    
    if (!customerId || !type || !note) {
      return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบ' })
    }
    
    // ตรวจสอบว่า customer เป็นของ tenant นี้
    const customer = db.prepare('SELECT id FROM customers WHERE id = ? AND tenant_id = ?').get(customerId, tenantId)
    if (!customer) {
      return res.status(404).json({ success: false, message: 'ไม่พบลูกค้า' })
    }
    
    const id = randomUUID().replace(/-/g, '').substring(0, 25)
    const now = new Date().toISOString()
    
    db.prepare(`
      INSERT INTO activity_logs (id, customer_id, type, note, created_by, tenant_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, customerId, type, note, createdBy, tenantId, now)
    
    const activity = db.prepare('SELECT * FROM activity_logs WHERE id = ?').get(id)
    
    res.status(201).json({ success: true, data: activity })
  } catch (error) {
    console.error('Create activity error:', error)
    res.status(500).json({ success: false, message: 'ไม่สามารถบันทึกกิจกรรมได้' })
  }
})

// Delete activity log
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const tenantId = req.user!.tenantId
    
    // ตรวจสอบว่า activity เป็นของ tenant นี้
    const activity = db.prepare('SELECT id FROM activity_logs WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    if (!activity) {
      return res.status(404).json({ success: false, message: 'ไม่พบกิจกรรม' })
    }
    
    db.prepare('DELETE FROM activity_logs WHERE id = ?').run(id)
    
    res.json({ success: true, message: 'ลบกิจกรรมสำเร็จ' })
  } catch (error) {
    console.error('Delete activity error:', error)
    res.status(500).json({ success: false, message: 'ไม่สามารถลบกิจกรรมได้' })
  }
})

export default router
