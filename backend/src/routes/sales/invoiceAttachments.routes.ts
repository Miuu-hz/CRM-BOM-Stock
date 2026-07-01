import { Router, Request, Response } from 'express'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { invoiceUpload, invoiceUploadDir, isValidImageFile, sanitizeFilename } from './shared'
import path from 'path'
import fs from 'fs'

const router = Router()

// POST upload attachment
router.post('/:id/attachments', (req: Request, res: Response, next: any) => {
  invoiceUpload.single('image')(req, res, (err: any) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ success: false, message: 'ไฟล์ใหญ่เกินไป (สูงสุด 10MB)' })
    if (err) return res.status(400).json({ success: false, message: err.message })
    next()
  })
}, async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params
    const file = req.file
    if (!file) return res.status(400).json({ success: false, message: 'ไม่พบไฟล์' })

    const invoice = db.prepare('SELECT id FROM invoices WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' })

    // Reject files whose content does not match an allowed image type.
    const fullPath = path.join(invoiceUploadDir, file.filename)
    if (!isValidImageFile(fullPath)) {
      try { fs.unlinkSync(fullPath) } catch { /* ignore */ }
      return res.status(400).json({ success: false, message: 'Invalid image file' })
    }

    const attachmentId = generateId()
    const now = new Date().toISOString()
    const safeOriginalName = sanitizeFilename(file.originalname)
    db.prepare(`INSERT INTO invoice_attachments (id, tenant_id, invoice_id, file_path, original_name, file_size, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(attachmentId, tenantId, id, file.filename, safeOriginalName, file.size, now)

    res.json({ success: true, data: { id: attachmentId, file_path: file.filename, original_name: safeOriginalName, file_size: file.size, created_at: now } })
  } catch (error) {
    console.error('Upload attachment error:', error)
    res.status(500).json({ success: false, message: 'Upload failed' })
  }
})

// DELETE attachment
router.delete('/:id/attachments/:attachmentId', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { attachmentId } = req.params
    const row = db.prepare('SELECT * FROM invoice_attachments WHERE id = ? AND tenant_id = ?').get(attachmentId, tenantId) as any
    if (!row) return res.status(404).json({ success: false, message: 'Attachment not found' })

    const filePath = path.resolve(invoiceUploadDir, row.file_path)
    if (filePath.startsWith(path.resolve(invoiceUploadDir)) && fs.existsSync(filePath)) fs.unlinkSync(filePath)
    db.prepare('DELETE FROM invoice_attachments WHERE id = ?').run(attachmentId)

    res.json({ success: true })
  } catch (error) {
    console.error('Delete attachment error:', error)
    res.status(500).json({ success: false, message: 'Delete failed' })
  }
})

export default router
