import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { generateId, formatDocumentNumber } from '../utils/id'

const router = Router()
router.use(authenticate)

const VALID_SECTIONS = ['40(2)', '40(3)', '40(4)', '40(6)', '40(7)', '40(8)']

// Additive table: WHT certificate (หนังสือรับรองหัก ณ ที่จ่าย 50 ทวิ) — an immutable snapshot
// taken at issue time from the WHT tax_transaction + company_settings + supplier. Created here
// (not in schema.ts/migrations.ts) following the same self-contained "ensure on module load"
// pattern tax.routes.ts uses for its wht_form column — keeps this feature additive/localized.
function ensureWhtCertificatesTable() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS wht_certificates (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        cert_number TEXT NOT NULL,
        tax_transaction_id TEXT NOT NULL,
        issue_date TEXT NOT NULL,
        payer_name TEXT,
        payer_tax_id TEXT,
        payer_address TEXT,
        payee_name TEXT,
        payee_tax_id TEXT,
        payee_address TEXT,
        income_type TEXT,
        income_section TEXT,
        wht_form TEXT,
        base_amount REAL DEFAULT 0,
        tax_rate REAL DEFAULT 0,
        tax_amount REAL DEFAULT 0,
        status TEXT DEFAULT 'ISSUED',
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, cert_number),
        FOREIGN KEY (tax_transaction_id) REFERENCES tax_transactions(id)
      );
      CREATE INDEX IF NOT EXISTS idx_wht_cert_tenant ON wht_certificates(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_wht_cert_txn ON wht_certificates(tax_transaction_id);
      CREATE INDEX IF NOT EXISTS idx_wht_cert_issue ON wht_certificates(tenant_id, issue_date);
    `)
  } catch (error) {
    console.error('Failed to ensure wht_certificates table:', error)
  }
}
ensureWhtCertificatesTable()

function toYMD(dateValue: string | null | undefined): string {
  const str = dateValue ? String(dateValue) : new Date().toISOString()
  return str.includes('T') ? str.split('T')[0] : str
}

// Create a certificate snapshot from a WHT tax_transaction. Certificates are immutable —
// no edit endpoint; cancel + reissue instead.
router.post('/from-transaction/:taxTransactionId', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const userName = req.user!.email
    const { incomeType, incomeSection, issueDate } = req.body

    if (!incomeType || typeof incomeType !== 'string' || !incomeType.trim()) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุประเภทเงินได้' })
    }
    if (!VALID_SECTIONS.includes(incomeSection)) {
      return res.status(400).json({ success: false, message: 'มาตราประเภทเงินได้ไม่ถูกต้อง' })
    }

    const txn = db.prepare(
      `SELECT * FROM tax_transactions WHERE id = ? AND tenant_id = ? AND transaction_type = 'WHT'`
    ).get(req.params.taxTransactionId, tenantId) as any

    if (!txn) {
      return res.status(404).json({ success: false, message: 'ไม่พบรายการภาษีหัก ณ ที่จ่ายที่ต้องการ' })
    }

    const existing = db.prepare(
      `SELECT id FROM wht_certificates WHERE tenant_id = ? AND tax_transaction_id = ? AND status != 'CANCELLED'`
    ).get(tenantId, txn.id)
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'รายการนี้มีหนังสือรับรองหัก ณ ที่จ่ายอยู่แล้ว กรุณายกเลิกฉบับเดิมก่อนออกฉบับใหม่',
      })
    }

    const company = db.prepare('SELECT * FROM company_settings WHERE tenant_id = ?').get(tenantId) as any
    const supplier = txn.partner_id
      ? (db.prepare('SELECT address FROM suppliers WHERE id = ? AND tenant_id = ?').get(txn.partner_id, tenantId) as { address: string } | undefined)
      : undefined

    const issue = toYMD(issueDate) || toYMD(txn.document_date)
    const buddhistYear = Number(issue.split('-')[0]) + 543
    const certNumber = formatDocumentNumber('WHT', tenantId, 'WHT_CERT', buddhistYear, 4)
    const id = generateId()
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO wht_certificates (
        id, tenant_id, cert_number, tax_transaction_id, issue_date,
        payer_name, payer_tax_id, payer_address,
        payee_name, payee_tax_id, payee_address,
        income_type, income_section, wht_form,
        base_amount, tax_rate, tax_amount, status, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ISSUED', ?, ?, ?)
    `).run(
      id, tenantId, certNumber, txn.id, issue,
      company?.name ?? null, company?.tax_id ?? null, company?.address ?? null,
      txn.partner_name ?? null, txn.partner_tax_id ?? null, supplier?.address ?? null,
      incomeType.trim(), incomeSection, txn.wht_form ?? null,
      txn.base_amount ?? 0, txn.wht_rate ?? txn.tax_rate ?? 0, txn.tax_amount ?? 0,
      userName, now, now
    )

    const created = db.prepare('SELECT * FROM wht_certificates WHERE id = ?').get(id)
    res.json({ success: true, message: `ออกหนังสือรับรอง ${certNumber} เรียบร้อยแล้ว`, data: created })
  } catch (error: any) {
    console.error('Create WHT certificate error:', error)
    res.status(500).json({ success: false, message: error.message || 'เกิดข้อผิดพลาดในการออกหนังสือรับรอง' })
  }
})

router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { year, form, status } = req.query

    let query = 'SELECT * FROM wht_certificates WHERE tenant_id = ?'
    const params: any[] = [tenantId]

    if (year) {
      query += ' AND issue_date LIKE ?'
      params.push(`${year}%`)
    }
    if (form) {
      query += ' AND wht_form = ?'
      params.push(form)
    }
    if (status) {
      query += ' AND status = ?'
      params.push(status)
    }

    query += ' ORDER BY issue_date DESC, cert_number DESC'

    const certs = db.prepare(query).all(...params)
    res.json({ success: true, data: certs })
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
})

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const cert = db.prepare('SELECT * FROM wht_certificates WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!cert) return res.status(404).json({ success: false, message: 'ไม่พบหนังสือรับรอง' })
    res.json({ success: true, data: cert })
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
})

router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const cert = db.prepare('SELECT * FROM wht_certificates WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!cert) return res.status(404).json({ success: false, message: 'ไม่พบหนังสือรับรอง' })
    if (cert.status === 'CANCELLED') {
      return res.status(400).json({ success: false, message: 'หนังสือรับรองนี้ถูกยกเลิกไปแล้ว' })
    }

    db.prepare(`UPDATE wht_certificates SET status = 'CANCELLED', updated_at = datetime('now') WHERE id = ?`).run(cert.id)
    res.json({ success: true, message: `ยกเลิกหนังสือรับรอง ${cert.cert_number} เรียบร้อยแล้ว` })
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
})

export default router
