import { Router } from 'express'
import db from '../db/sqlite'
import { authenticate } from '../middleware/auth.middleware'

const router = Router()
router.use(authenticate)

// GET /api/settings/company — ดึงข้อมูลบริษัท
router.get('/company', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const row = db.prepare(`SELECT * FROM company_settings WHERE tenant_id = ?`).get(tenantId) as any
    res.json({ success: true, data: row || { tenant_id: tenantId } })
  } catch (error) {
    console.error('Error fetching company settings:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch company settings' })
  }
})

// PUT /api/settings/company — บันทึกข้อมูลบริษัท
router.put('/company', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const { name, address, phone, email, tax_id, logo_base64 } = req.body

    db.prepare(`
      INSERT INTO company_settings (tenant_id, name, address, phone, email, tax_id, logo_base64, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(tenant_id) DO UPDATE SET
        name        = excluded.name,
        address     = excluded.address,
        phone       = excluded.phone,
        email       = excluded.email,
        tax_id      = excluded.tax_id,
        logo_base64 = excluded.logo_base64,
        updated_at  = datetime('now')
    `).run(tenantId, name || null, address || null, phone || null, email || null, tax_id || null, logo_base64 || null)

    const updated = db.prepare(`SELECT * FROM company_settings WHERE tenant_id = ?`).get(tenantId)
    res.json({ success: true, data: updated })
  } catch (error) {
    console.error('Error saving company settings:', error)
    res.status(500).json({ success: false, message: 'Failed to save company settings' })
  }
})

export default router
