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
    const {
      name, address, phone, email, tax_id, logo_base64, pos_bom_deduct,
      pos_vat_enabled, pos_vat_rate, pos_service_enabled, pos_service_rate
    } = req.body

    // Get existing settings to merge partial updates
    const existing = db.prepare(`SELECT * FROM company_settings WHERE tenant_id = ?`).get(tenantId) as any || {}

    const mergedName = name !== undefined ? (name || null) : existing.name
    const mergedAddress = address !== undefined ? (address || null) : existing.address
    const mergedPhone = phone !== undefined ? (phone || null) : existing.phone
    const mergedEmail = email !== undefined ? (email || null) : existing.email
    const mergedTaxId = tax_id !== undefined ? (tax_id || null) : existing.tax_id
    const mergedLogo = logo_base64 !== undefined ? (logo_base64 || null) : existing.logo_base64
    const mergedBomDeduct = pos_bom_deduct !== undefined
      ? (pos_bom_deduct === false || pos_bom_deduct === 0 ? 0 : 1)
      : (existing.pos_bom_deduct === 0 ? 0 : 1)
    const mergedVatEnabled = pos_vat_enabled !== undefined ? (pos_vat_enabled ? 1 : 0) : existing.pos_vat_enabled
    const mergedVatRate = pos_vat_rate !== undefined ? pos_vat_rate : existing.pos_vat_rate
    const mergedServiceEnabled = pos_service_enabled !== undefined ? (pos_service_enabled ? 1 : 0) : existing.pos_service_enabled
    const mergedServiceRate = pos_service_rate !== undefined ? pos_service_rate : existing.pos_service_rate

    db.prepare(`
      INSERT INTO company_settings (
        tenant_id, name, address, phone, email, tax_id, logo_base64,
        pos_bom_deduct, pos_vat_enabled, pos_vat_rate, pos_service_enabled, pos_service_rate, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(tenant_id) DO UPDATE SET
        name              = excluded.name,
        address           = excluded.address,
        phone             = excluded.phone,
        email             = excluded.email,
        tax_id            = excluded.tax_id,
        logo_base64       = excluded.logo_base64,
        pos_bom_deduct    = excluded.pos_bom_deduct,
        pos_vat_enabled   = excluded.pos_vat_enabled,
        pos_vat_rate      = excluded.pos_vat_rate,
        pos_service_enabled = excluded.pos_service_enabled,
        pos_service_rate  = excluded.pos_service_rate,
        updated_at        = datetime('now')
    `).run(
      tenantId, mergedName, mergedAddress, mergedPhone, mergedEmail, mergedTaxId, mergedLogo,
      mergedBomDeduct, mergedVatEnabled, mergedVatRate, mergedServiceEnabled, mergedServiceRate
    )

    const updated = db.prepare(`SELECT * FROM company_settings WHERE tenant_id = ?`).get(tenantId)
    res.json({ success: true, data: updated })
  } catch (error) {
    console.error('Error saving company settings:', error)
    res.status(500).json({ success: false, message: 'Failed to save company settings' })
  }
})

export default router
