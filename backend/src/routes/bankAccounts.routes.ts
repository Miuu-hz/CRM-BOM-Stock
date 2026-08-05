import { Router, Request, Response } from 'express'
import { authenticate, requireRole } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { ACC, ACC_META } from '../config/accountCodes'

const router = Router()
router.use(authenticate)

// Ensure the parent "1102 เงินฝากธนาคาร" account exists for this tenant and return its id.
function getOrCreateBankParentAccount(tenantId: string): { id: string; code: string } {
  const existing = db.prepare('SELECT id, code FROM accounts WHERE tenant_id = ? AND code = ?').get(tenantId, ACC.BANK) as any
  if (existing) return existing
  const meta = ACC_META[ACC.BANK]!
  const id = generateId()
  db.prepare(`INSERT INTO accounts (id, tenant_id, code, name, type, category, normal_balance, level, is_active, is_system)
    VALUES (?, ?, ?, ?, ?, ?, ?, 2, 1, 1)`)
    .run(id, tenantId, ACC.BANK, meta.name, meta.type, meta.category, meta.normalBalance)
  return { id, code: ACC.BANK }
}

// Mint the next free "1102-NN" sub-account code for this tenant.
function nextBankSubAccountCode(tenantId: string): string {
  const rows = db.prepare(
    `SELECT code FROM accounts WHERE tenant_id = ? AND code LIKE ?`
  ).all(tenantId, `${ACC.BANK}-%`) as { code: string }[]
  let max = 0
  for (const r of rows) {
    const n = parseInt(r.code.split('-')[1] || '0', 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return `${ACC.BANK}-${String(max + 1).padStart(2, '0')}`
}

// GET /api/bank-accounts — list (with linked GL account code/name)
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const rows = db.prepare(`
      SELECT ba.*, a.code as gl_code, a.name as gl_name
      FROM bank_accounts ba
      JOIN accounts a ON ba.account_id = a.id
      WHERE ba.tenant_id = ? AND ba.is_active = 1
      ORDER BY ba.is_default DESC, ba.created_at
    `).all(tenantId)
    res.json({ success: true, data: rows })
  } catch (error: any) {
    console.error('List bank accounts error:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// POST /api/bank-accounts — create bank account + auto-create linked GL sub-account
router.post('/', requireRole('ADMIN', 'MANAGER', 'MASTER'), async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { bankName, accountName, accountNumber, qrCodeBase64, isDefault } = req.body

    if (!bankName || !accountName || !accountNumber) {
      return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อธนาคาร ชื่อบัญชี และเลขบัญชี' })
    }

    const now = new Date().toISOString()
    const id = generateId()

    const result = db.transaction(() => {
      const parent = getOrCreateBankParentAccount(tenantId)
      const subCode = nextBankSubAccountCode(tenantId)
      const glId = generateId()
      const bankMeta = ACC_META[ACC.BANK]!
      db.prepare(`INSERT INTO accounts (id, tenant_id, code, name, type, category, parent_id, level, is_active, is_system, normal_balance)
        VALUES (?, ?, ?, ?, ?, ?, ?, 3, 1, 0, ?)`)
        .run(glId, tenantId, subCode, `${bankMeta.name} - ${bankName} ${String(accountNumber).slice(-4)}`, bankMeta.type, bankMeta.category, parent.id, bankMeta.normalBalance)

      if (isDefault) {
        db.prepare('UPDATE bank_accounts SET is_default = 0 WHERE tenant_id = ?').run(tenantId)
      }

      db.prepare(`INSERT INTO bank_accounts (id, tenant_id, bank_name, account_name, account_number, qr_code_base64, account_id, is_default, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
        .run(id, tenantId, bankName, accountName, accountNumber, qrCodeBase64 || null, glId, isDefault ? 1 : 0, now, now)

      return glId
    })()

    const created = db.prepare(`
      SELECT ba.*, a.code as gl_code, a.name as gl_name
      FROM bank_accounts ba JOIN accounts a ON ba.account_id = a.id
      WHERE ba.id = ? AND ba.tenant_id = ?
    `).get(id, tenantId)

    res.status(201).json({ success: true, data: created })
  } catch (error: any) {
    console.error('Create bank account error:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// PUT /api/bank-accounts/:id — edit name/number/QR/default (account_id is fixed at creation)
router.put('/:id', requireRole('ADMIN', 'MANAGER', 'MASTER'), async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const existing = db.prepare('SELECT * FROM bank_accounts WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!existing) return res.status(404).json({ success: false, message: 'ไม่พบบัญชีธนาคารนี้' })

    const { bankName, accountName, accountNumber, qrCodeBase64, isDefault } = req.body
    const now = new Date().toISOString()

    db.transaction(() => {
      if (isDefault) {
        db.prepare('UPDATE bank_accounts SET is_default = 0 WHERE tenant_id = ?').run(tenantId)
      }
      db.prepare(`
        UPDATE bank_accounts SET bank_name = ?, account_name = ?, account_number = ?, qr_code_base64 = ?, is_default = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run(
        bankName ?? existing.bank_name,
        accountName ?? existing.account_name,
        accountNumber ?? existing.account_number,
        qrCodeBase64 !== undefined ? qrCodeBase64 : existing.qr_code_base64,
        typeof isDefault === 'boolean' ? (isDefault ? 1 : 0) : existing.is_default,
        now, req.params.id, tenantId
      )
    })()

    const updated = db.prepare(`
      SELECT ba.*, a.code as gl_code, a.name as gl_name
      FROM bank_accounts ba JOIN accounts a ON ba.account_id = a.id
      WHERE ba.id = ? AND ba.tenant_id = ?
    `).get(req.params.id, tenantId)
    res.json({ success: true, data: updated })
  } catch (error: any) {
    console.error('Update bank account error:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// DELETE /api/bank-accounts/:id — block if referenced by any payment, else soft-delete
router.delete('/:id', requireRole('ADMIN', 'MANAGER', 'MASTER'), async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const existing = db.prepare('SELECT * FROM bank_accounts WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!existing) return res.status(404).json({ success: false, message: 'ไม่พบบัญชีธนาคารนี้' })

    const inUse = (
      (db.prepare('SELECT COUNT(*) as c FROM receipts WHERE bank_account_id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any).c +
      (db.prepare('SELECT COUNT(*) as c FROM supplier_payments WHERE bank_account_id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any).c +
      (db.prepare('SELECT COUNT(*) as c FROM pos_payments WHERE bank_account_id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any).c
    )
    if (inUse > 0) {
      return res.status(400).json({ success: false, message: 'บัญชีนี้มีประวัติการรับ/จ่ายเงินแล้ว ไม่สามารถลบได้ — ปิดใช้งานแทน' })
    }

    db.prepare('UPDATE bank_accounts SET is_active = 0, updated_at = ? WHERE id = ? AND tenant_id = ?')
      .run(new Date().toISOString(), req.params.id, tenantId)
    res.json({ success: true, message: 'ลบบัญชีธนาคารแล้ว' })
  } catch (error: any) {
    console.error('Delete bank account error:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

export default router
