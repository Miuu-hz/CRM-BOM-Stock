import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import type { Account, AccountBalanceTuple } from '../types'
import { seedChartOfAccounts } from '../config/chartOfAccounts'

const router = Router()

// Authentication required for all routes
router.use(authenticate)

// ============================================
// CHART OF ACCOUNTS - ผังบัญชี
// ============================================

// Initialize / repair chart of accounts for tenant — เติมเฉพาะรหัสที่ยังขาด
// (เดิมตีกลับ 400 ถ้ามีบัญชีอยู่แล้วแม้แต่ตัวเดียว ทำให้ tenant ที่มีบัญชีกำพร้า
//  จากธุรกรรมแรกติดล็อกถาวร เรียกซ้ำได้ปลอดภัย ของเดิมไม่ถูกแตะ)
router.post('/init', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const created = seedChartOfAccounts(tenantId)
    const total = (db.prepare('SELECT COUNT(*) as count FROM accounts WHERE tenant_id = ?').get(tenantId) as { count: number }).count

    res.json({
      success: true,
      message: created === 0
        ? 'ผังบัญชีครบอยู่แล้ว ไม่มีอะไรต้องเพิ่ม'
        : `เพิ่มบัญชีที่ขาดไป ${created} รายการ`,
      data: { created, total },
    })
  } catch (error) {
    console.error('Init chart of accounts error:', error)
    res.status(500).json({ success: false, message: (error as Error).message || 'Failed to initialize chart of accounts' })
  }
})

// Get all accounts (Chart of Accounts)
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { type, active } = req.query
    
    // a.* keeps the raw snake_case columns (some backend code still reads
    // those); the aliases below additionally expose camelCase so the
    // response matches the frontend's Account type — the frontend was
    // reading account.nameEn/isSystem/isActive/normalBalance which never
    // existed in the raw response, so Dr/Cr badges, nameEn, and the
    // system-account edit/delete gate were all silently broken.
    let query = `
      SELECT a.*,
             a.name_en as nameEn,
             a.parent_id as parentId,
             a.is_active as isActive,
             a.is_system as isSystem,
             a.normal_balance as normalBalance,
             a.tax_related as taxRelated,
             p.code as parent_code,
             p.name as parent_name,
             p.code as parentCode,
             p.name as parentName,
             (SELECT COUNT(*) FROM journal_lines WHERE account_id = a.id) as transaction_count
      FROM accounts a
      LEFT JOIN accounts p ON a.parent_id = p.id
      WHERE a.tenant_id = ?
    `
    const params: Array<string | number> = [tenantId]

    if (type) {
      query += ' AND a.type = ?'
      params.push(type as string)
    }
    
    if (active === 'true') {
      query += ' AND a.is_active = 1'
    }
    
    query += ' ORDER BY a.code'
    
    const accounts = db.prepare(query).all(...params) as Account[]

    // Build tree structure
    type AccountTreeNode = Account & { children: AccountTreeNode[] }
    const buildTree = (parentId: string | null = null): AccountTreeNode[] => {
      return accounts
        .filter(a => a.parent_id === parentId)
        .map(a => ({
          ...a,
          children: buildTree(a.id)
        }))
    }
    
    const tree = buildTree(null)
    
    res.json({
      success: true,
      data: {
        list: accounts,
        tree: tree
      }
    })
  } catch (error) {
    console.error('Get accounts error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch accounts' })
  }
})

// Get account by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const account = db.prepare(`
      SELECT a.*,
             a.name_en as nameEn,
             a.parent_id as parentId,
             a.is_active as isActive,
             a.is_system as isSystem,
             a.normal_balance as normalBalance,
             a.tax_related as taxRelated,
             p.code as parent_code,
             p.name as parent_name,
             p.code as parentCode,
             p.name as parentName
      FROM accounts a
      LEFT JOIN accounts p ON a.parent_id = p.id
      WHERE a.id = ? AND a.tenant_id = ?
    `).get(req.params.id, tenantId) as (Account & { normalBalance: 'DEBIT' | 'CREDIT' }) | undefined

    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found' })
    }

    // Get balance info
    const balanceInfo = db.prepare(`
      SELECT
        COALESCE(SUM(debit), 0) as total_debit,
        COALESCE(SUM(credit), 0) as total_credit
      FROM journal_lines jl
      JOIN journal_entries je ON jl.journal_entry_id = je.id
      WHERE jl.account_id = ? AND je.is_posted = 1
    `).get(req.params.id) as AccountBalanceTuple

    const balance = account.normalBalance === 'DEBIT'
      ? Number(balanceInfo.total_debit) - Number(balanceInfo.total_credit)
      : Number(balanceInfo.total_credit) - Number(balanceInfo.total_debit)
    
    res.json({
      success: true,
      data: {
        ...account,
        balance: {
          debit: balanceInfo.total_debit,
          credit: balanceInfo.total_credit,
          net: balance
        }
      }
    })
  } catch (error) {
    console.error('Get account error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch account' })
  }
})

// Create new account
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { code, name, nameEn, type, parentId, normalBalance, description, taxRelated } = req.body
    let { category } = req.body

    // default category from type when not provided
    if (!category) {
      const defaultCategory: Record<string, string> = {
        ASSET: 'CURRENT_ASSET', LIABILITY: 'CURRENT_LIABILITY',
        EQUITY: 'CAPITAL', REVENUE: 'SALES', EXPENSE: 'ADMIN_EXPENSE',
      }
      category = defaultCategory[type] ?? type
    }

    if (!code || !name || !type || !normalBalance) {
      return res.status(400).json({
        success: false,
        message: 'Code, name, type, and normalBalance are required'
      })
    }
    
    // Check for duplicate code
    const existing = db.prepare('SELECT id FROM accounts WHERE code = ? AND tenant_id = ?').get(code, tenantId)
    if (existing) {
      return res.status(400).json({ success: false, message: 'Account code already exists' })
    }
    
    // Calculate level
    let level = 0
    if (parentId) {
      const parent = db.prepare('SELECT level FROM accounts WHERE id = ? AND tenant_id = ?').get(parentId, tenantId) as { level: number } | undefined
      if (parent) {
        level = parent.level + 1
      }
    }
    
    const id = generateId()
    const now = new Date().toISOString()
    
    db.prepare(`
      INSERT INTO accounts (id, tenant_id, code, name, name_en, type, category, parent_id, level,
                           is_active, normal_balance, description, tax_related, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
    `).run(id, tenantId, code, name, nameEn || null, type, category, parentId || null, level,
           normalBalance, description || null, taxRelated ? 1 : 0, now, now)
    
    res.json({
      success: true,
      message: 'Account created successfully',
      data: { id, code, name, type }
    })
  } catch (error) {
    console.error('Create account error:', error)
    res.status(500).json({ success: false, message: (error as Error).message || 'Failed to create account' })
  }
})

// Update account
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { name, nameEn, isActive, description } = req.body
    
    const existing = db.prepare('SELECT * FROM accounts WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Account not found' })
    }
    
    const now = new Date().toISOString()
    
    db.prepare(`
      UPDATE accounts 
      SET name = COALESCE(?, name),
          name_en = COALESCE(?, name_en),
          is_active = COALESCE(?, is_active),
          description = COALESCE(?, description),
          updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(name, nameEn, isActive !== undefined ? (isActive ? 1 : 0) : undefined, description, now, req.params.id, tenantId)
    
    res.json({ success: true, message: 'Account updated successfully' })
  } catch (error) {
    console.error('Update account error:', error)
    res.status(500).json({ success: false, message: (error as Error).message || 'Failed to update account' })
  }
})

// Delete account (only if no transactions)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as Account | undefined
    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found' })
    }

    if (account.is_system) {
      return res.status(400).json({ success: false, message: 'ไม่สามารถลบบัญชีระบบได้' })
    }
    
    // Check for transactions
    const txCount = (db.prepare('SELECT COUNT(*) as count FROM journal_lines WHERE account_id = ?').get(req.params.id) as { count: number }).count
    if (txCount > 0) {
      return res.status(400).json({
        success: false,
        message: `ไม่สามารถลบบัญชีที่มีรายการบันทึก (${txCount} รายการ) — สามารถปิดใช้งานแทนได้`,
        canDeactivate: true
      })
    }

    // Check for children
    const childCount = (db.prepare('SELECT COUNT(*) as count FROM accounts WHERE parent_id = ?').get(req.params.id) as { count: number }).count
    if (childCount > 0) {
      return res.status(400).json({ success: false, message: 'ไม่สามารถลบบัญชีที่มีบัญชีย่อย กรุณาลบบัญชีย่อยก่อน' })
    }
    
    db.prepare('DELETE FROM accounts WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantId)
    
    res.json({ success: true, message: 'Account deleted successfully' })
  } catch (error) {
    console.error('Delete account error:', error)
    res.status(500).json({ success: false, message: (error as Error).message || 'Failed to delete account' })
  }
})

export default router
