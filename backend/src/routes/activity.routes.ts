import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { randomUUID } from 'crypto'
import { parseDueDate, DueDateError } from '../utils/id'

const router = Router()

const DOC_TABLES: Record<string, string> = {
  INVOICE: 'invoices',
  SALES_ORDER: 'sales_orders',
  QUOTATION: 'quotations',
}

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
      SELECT a.*,
        COALESCE(i.invoice_number, so.so_number, q.quotation_number) AS doc_number
      FROM activity_logs a
      LEFT JOIN invoices i ON a.doc_type = 'INVOICE' AND a.doc_id = i.id AND i.tenant_id = a.tenant_id
      LEFT JOIN sales_orders so ON a.doc_type = 'SALES_ORDER' AND a.doc_id = so.id AND so.tenant_id = a.tenant_id
      LEFT JOIN quotations q ON a.doc_type = 'QUOTATION' AND a.doc_id = q.id AND q.tenant_id = a.tenant_id
      WHERE a.customer_id = ? AND a.tenant_id = ?
      ORDER BY a.created_at DESC, a.rowid DESC
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
    const { customerId, type, note, docType, docId, nextFollowDate } = req.body
    const tenantId = req.user!.tenantId
    const createdBy = req.user!.email
    
    // ponytail: redact customer note to protect customer PII in logs
    console.log('Create activity:', { customerId, type, note: '[REDACTED]', tenantId, createdBy })
    
    if (!customerId || !type || !note) {
      return res.status(400).json({ 
        success: false, 
        message: 'กรุณากรอกข้อมูลให้ครบ',
        received: { customerId, type, note: '[REDACTED]' }
      })
    }

    const VALID_TYPES = ['CALL', 'EMAIL', 'MEETING', 'NOTE']
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({
        success: false,
        message: `ประเภทกิจกรรมไม่ถูกต้อง ต้องเป็นหนึ่งใน ${VALID_TYPES.join(', ')}`
      })
    }

    const parsedNextFollowDate = parseDueDate(nextFollowDate)

    const hasDocType = docType !== undefined && docType !== null && docType !== ''
    const hasDocId = docId !== undefined && docId !== null && docId !== ''
    if (hasDocId && !hasDocType) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุประเภทเอกสาร (docType)' })
    }
    if (hasDocType) {
      const table = Object.keys(DOC_TABLES).includes(docType) ? DOC_TABLES[docType] : undefined
      if (!table) {
        return res.status(400).json({
          success: false,
          message: 'ประเภทเอกสารไม่ถูกต้อง ต้องเป็น INVOICE, SALES_ORDER หรือ QUOTATION',
        })
      }
      if (!hasDocId || typeof docId !== 'string') {
        return res.status(400).json({ success: false, message: 'กรุณาระบุเลขที่อ้างอิงเอกสาร (docId)' })
      }
      const doc = db.prepare(`SELECT customer_id FROM ${table} WHERE id = ? AND tenant_id = ?`).get(docId, tenantId) as { customer_id: string } | undefined
      if (!doc || doc.customer_id !== customerId) {
        return res.status(400).json({ success: false, message: 'ไม่พบเอกสารในกิจการนี้หรือเอกสารไม่ได้เป็นของลูกค้ารายนี้' })
      }
    }
    
    // ตรวจสอบว่า customer เป็นของ tenant นี้
    const customer = db.prepare('SELECT id FROM customers WHERE id = ? AND tenant_id = ?').get(customerId, tenantId)
    if (!customer) {
      return res.status(404).json({ success: false, message: 'ไม่พบลูกค้า' })
    }
    
    const id = randomUUID().replace(/-/g, '').substring(0, 25)
    const now = new Date().toISOString()
    
    db.prepare(`
      INSERT INTO activity_logs (id, customer_id, type, note, doc_type, doc_id, next_follow_date, created_by, tenant_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, customerId, type, note, hasDocType ? docType : null, hasDocType ? docId : null, parsedNextFollowDate ?? null, createdBy, tenantId, now)
    
    const activity = db.prepare('SELECT * FROM activity_logs WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    
    res.status(201).json({ success: true, data: activity })
  } catch (error) {
    if (error instanceof DueDateError) {
      return res.status(400).json({ success: false, code: 'INVALID_DUE_DATE', message: error.message })
    }
    console.error('Create activity error:', error)
    res.status(500).json({ success: false, message: 'ไม่สามารถบันทึกกิจกรรมได้' })
  }
})

export default router
