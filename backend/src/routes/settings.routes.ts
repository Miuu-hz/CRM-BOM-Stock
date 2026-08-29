import { Router } from 'express'
import db from '../db/sqlite'
import { authenticate } from '../middleware/auth.middleware'
import { getSubscription } from '../services/subscription.service'

const router = Router()
router.use(authenticate)

// GET /api/settings/company — ดึงข้อมูลบริษัท
router.get('/company', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const row = db.prepare(`SELECT * FROM company_settings WHERE tenant_id = ?`).get(tenantId) as any
    const sub = getSubscription(tenantId)
    res.json({
      success: true,
      data: {
        ...(row || { tenant_id: tenantId }),
        subscription_plan_code: sub.planCode,
        subscription_plan_name: sub.planName,
        subscription_status: sub.status,
        subscription_period_end: sub.currentPeriodEnd,
      },
    })
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
      pos_vat_enabled, pos_vat_rate, pos_service_enabled, pos_service_rate,
      qc_gate_enabled, show_subcon_stock_widget, allow_negative_stock, require_pos_shift
    } = req.body

    if (allow_negative_stock !== undefined || require_pos_shift !== undefined) {
      const callerRole = (req as any).user!.role
      if (callerRole !== 'ADMIN' && callerRole !== 'MASTER') {
        return res.status(403).json({ success: false, message: 'เฉพาะ Master และ Admin เท่านั้นที่เปลี่ยนการตั้งค่านี้ได้' })
      }
    }

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
    const mergedQcGateEnabled = qc_gate_enabled !== undefined
      ? (qc_gate_enabled ? 1 : 0)
      : (existing.qc_gate_enabled === 1 ? 1 : 0)
    const mergedShowSubconStockWidget = show_subcon_stock_widget !== undefined
      ? (show_subcon_stock_widget === false || show_subcon_stock_widget === 0 ? 0 : 1)
      : (existing.show_subcon_stock_widget === 0 ? 0 : 1)
    const mergedAllowNegativeStock = allow_negative_stock !== undefined
      ? (allow_negative_stock ? 1 : 0)
      : (existing.allow_negative_stock === 1 ? 1 : 0)
    const mergedRequirePosShift = require_pos_shift !== undefined
      ? (require_pos_shift ? 1 : 0)
      : (existing.require_pos_shift === 1 ? 1 : 0)

    db.prepare(`
      INSERT INTO company_settings (
        tenant_id, name, address, phone, email, tax_id, logo_base64,
        pos_bom_deduct, pos_vat_enabled, pos_vat_rate, pos_service_enabled, pos_service_rate,
        qc_gate_enabled, show_subcon_stock_widget, allow_negative_stock, require_pos_shift, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
        qc_gate_enabled   = excluded.qc_gate_enabled,
        show_subcon_stock_widget = excluded.show_subcon_stock_widget,
        allow_negative_stock = excluded.allow_negative_stock,
        require_pos_shift = excluded.require_pos_shift,
        updated_at        = datetime('now')
    `).run(
      tenantId, mergedName, mergedAddress, mergedPhone, mergedEmail, mergedTaxId, mergedLogo,
      mergedBomDeduct, mergedVatEnabled, mergedVatRate, mergedServiceEnabled, mergedServiceRate,
      mergedQcGateEnabled, mergedShowSubconStockWidget, mergedAllowNegativeStock, mergedRequirePosShift
    )

    const updated = db.prepare(`SELECT * FROM company_settings WHERE tenant_id = ?`).get(tenantId)
    res.json({ success: true, data: updated })
  } catch (error) {
    console.error('Error saving company settings:', error)
    res.status(500).json({ success: false, message: 'Failed to save company settings' })
  }
})

// ─── Document Number Formats (ADMIN/MASTER หรือแผนก IT/CEO) ───
const canManageDocFormats = (user: any): boolean => {
  if (['ADMIN', 'MASTER'].includes(user.role)) return true
  const depts: string[] = user.departments || []
  return depts.includes('IT') || depts.includes('CEO')
}

// GET /api/settings/document-formats
router.get('/document-formats', (req, res) => {
  try {
    const user = (req as any).user!
    if (!canManageDocFormats(user)) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }
    const rows = db.prepare('SELECT * FROM document_number_formats WHERE tenant_id = ?').all(user.tenantId)
    res.json({ success: true, data: rows })
  } catch (error) {
    console.error('Get document formats error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch formats' })
  }
})

// POST /api/settings/document-formats — upsert หลายรายการพร้อมกัน
router.post('/document-formats', (req, res) => {
  try {
    const user = (req as any).user!
    if (!canManageDocFormats(user)) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }
    const { formats } = req.body
    if (!Array.isArray(formats)) {
      return res.status(400).json({ success: false, message: 'formats array required' })
    }
    const now = new Date().toISOString()
    const upsert = db.prepare(`
      INSERT INTO document_number_formats (tenant_id, doc_type, enabled, prefix, padding, date_format, separator, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, doc_type) DO UPDATE SET
        enabled = excluded.enabled, prefix = excluded.prefix, padding = excluded.padding,
        date_format = excluded.date_format, separator = excluded.separator, updated_at = excluded.updated_at
    `)
    const tx = db.transaction(() => {
      for (const f of formats) {
        if (!f.doc_type || !f.prefix) continue
        const padding = Math.min(Math.max(Number(f.padding) || 3, 2), 8)
        const dateFormat = ['NONE', 'DDMMYY', 'YYMMDD', 'MMYY', 'YYYY'].includes(f.date_format) ? f.date_format : 'DDMMYY'
        upsert.run(user.tenantId, f.doc_type, f.enabled ? 1 : 0, String(f.prefix).slice(0, 10), padding,
          dateFormat === 'NONE' ? '' : dateFormat, f.separator === '/' ? '/' : '-', now)
      }
    })
    tx()
    const rows = db.prepare('SELECT * FROM document_number_formats WHERE tenant_id = ?').all(user.tenantId)
    res.json({ success: true, data: rows, message: 'บันทึกรูปแบบเลขเอกสารแล้ว' })
  } catch (error) {
    console.error('Save document formats error:', error)
    res.status(500).json({ success: false, message: 'Failed to save formats' })
  }
})

export default router
