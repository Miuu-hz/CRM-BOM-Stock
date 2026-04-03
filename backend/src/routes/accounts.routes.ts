import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { randomUUID } from 'crypto'

const router = Router()

// Authentication required for all routes
router.use(authenticate)

function generateId() {
  return randomUUID().replace(/-/g, '').substring(0, 25)
}

// ============================================
// CHART OF ACCOUNTS - ผังบัญชี
// ============================================

/**
 * ผังบัญชีมาตรฐานตามประมวลบัญชีไทย
 * 1 - สินทรัพย์ (Assets)
 * 2 - หนี้สิน (Liabilities)
 * 3 - ส่วนของผู้ถือหุ้น (Equity)
 * 4 - รายได้ (Revenue)
 * 5 - ค่าใช้จ่าย (Expenses)
 */
const DEFAULT_CHART_OF_ACCOUNTS = [
  // ========== ASSETS (1xxxx) ==========
  { code: '1', name: 'สินทรัพย์', type: 'ASSET', category: 'ROOT', level: 0, normal_balance: 'DEBIT' },
  { code: '11', name: 'สินทรัพย์หมุนเวียน', type: 'ASSET', category: 'CURRENT_ASSET', level: 1, parent_code: '1', normal_balance: 'DEBIT' },
  { code: '1101', name: 'เงินสด', type: 'ASSET', category: 'CASH', level: 2, parent_code: '11', normal_balance: 'DEBIT' },
  { code: '1102', name: 'เงินฝากธนาคาร', type: 'ASSET', category: 'CASH', level: 2, parent_code: '11', normal_balance: 'DEBIT' },
  { code: '1103', name: 'เงินลงทุนชั่วคราว', type: 'ASSET', category: 'INVESTMENT', level: 2, parent_code: '11', normal_balance: 'DEBIT' },
  { code: '1104', name: 'ลูกหนี้การค้า', type: 'ASSET', category: 'RECEIVABLE', level: 2, parent_code: '11', normal_balance: 'DEBIT' },
  { code: '1105', name: 'ลูกหนี้อื่น', type: 'ASSET', category: 'RECEIVABLE', level: 2, parent_code: '11', normal_balance: 'DEBIT' },
  { code: '1106', name: 'สต็อกสินค้า', type: 'ASSET', category: 'INVENTORY', level: 2, parent_code: '11', normal_balance: 'DEBIT' },
  { code: '1107', name: 'สต็อกวัตถุดิบ', type: 'ASSET', category: 'INVENTORY', level: 2, parent_code: '11', normal_balance: 'DEBIT' },
  { code: '1108', name: 'สินค้าส่งเดิมเรียกคืน', type: 'ASSET', category: 'INVENTORY', level: 2, parent_code: '11', normal_balance: 'DEBIT' },
  { code: '1109', name: 'ค่าใช้จ่ายจ่ายล่วงหน้า', type: 'ASSET', category: 'PREPAID', level: 2, parent_code: '11', normal_balance: 'DEBIT' },
  { code: '1110', name: 'ภาษีซื้อ', type: 'ASSET', category: 'TAX', level: 2, parent_code: '11', normal_balance: 'DEBIT', tax_related: 1 },
  { code: '1111', name: 'เงินประกัน', type: 'ASSET', category: 'DEPOSIT', level: 2, parent_code: '11', normal_balance: 'DEBIT' },
  
  { code: '12', name: 'สินทรัพย์ไม่หมุนเวียน', type: 'ASSET', category: 'FIXED_ASSET', level: 1, parent_code: '1', normal_balance: 'DEBIT' },
  { code: '1201', name: 'ที่ดิน', type: 'ASSET', category: 'PROPERTY', level: 2, parent_code: '12', normal_balance: 'DEBIT' },
  { code: '1202', name: 'อาคาร', type: 'ASSET', category: 'PROPERTY', level: 2, parent_code: '12', normal_balance: 'DEBIT' },
  { code: '1203', name: 'ค่าเสื่อมอาคารสะสม', type: 'ASSET', category: 'ACCUM_DEPRECIATION', level: 2, parent_code: '12', normal_balance: 'CREDIT' },
  { code: '1204', name: 'เครื่องจักร', type: 'ASSET', category: 'EQUIPMENT', level: 2, parent_code: '12', normal_balance: 'DEBIT' },
  { code: '1205', name: 'ค่าเสื่อมเครื่องจักรสะสม', type: 'ASSET', category: 'ACCUM_DEPRECIATION', level: 2, parent_code: '12', normal_balance: 'CREDIT' },
  { code: '1206', name: 'เครื่องตัดและเย็บผ้า', type: 'ASSET', category: 'EQUIPMENT', level: 2, parent_code: '12', normal_balance: 'DEBIT' },
  { code: '1207', name: 'ค่าเสื่อมเครื่องตัดและเย็บผ้าสะสม', type: 'ASSET', category: 'ACCUM_DEPRECIATION', level: 2, parent_code: '12', normal_balance: 'CREDIT' },
  { code: '1208', name: 'เฟอร์นิเจอร์และอุปกรณ์สำนักงาน', type: 'ASSET', category: 'EQUIPMENT', level: 2, parent_code: '12', normal_balance: 'DEBIT' },
  { code: '1209', name: 'ค่าเสื่อมเฟอร์นิเจอร์และอุปกรณ์สำนักงานสะสม', type: 'ASSET', category: 'ACCUM_DEPRECIATION', level: 2, parent_code: '12', normal_balance: 'CREDIT' },
  { code: '1210', name: 'ยานพาหนะ', type: 'ASSET', category: 'VEHICLE', level: 2, parent_code: '12', normal_balance: 'DEBIT' },
  { code: '1211', name: 'ค่าเสื่อมยานพาหนะสะสม', type: 'ASSET', category: 'ACCUM_DEPRECIATION', level: 2, parent_code: '12', normal_balance: 'CREDIT' },
  { code: '1212', name: 'สินทรัพย์ไม่มีตัวตน', type: 'ASSET', category: 'INTANGIBLE', level: 2, parent_code: '12', normal_balance: 'DEBIT' },
  
  // ========== LIABILITIES (2xxxx) ==========
  { code: '2', name: 'หนี้สิน', type: 'LIABILITY', category: 'ROOT', level: 0, normal_balance: 'CREDIT' },
  { code: '21', name: 'หนี้สินหมุนเวียน', type: 'LIABILITY', category: 'CURRENT_LIABILITY', level: 1, parent_code: '2', normal_balance: 'CREDIT' },
  { code: '2101', name: 'เจ้าหนี้การค้า', type: 'LIABILITY', category: 'PAYABLE', level: 2, parent_code: '21', normal_balance: 'CREDIT' },
  { code: '2102', name: 'เจ้าหนี้อื่น', type: 'LIABILITY', category: 'PAYABLE', level: 2, parent_code: '21', normal_balance: 'CREDIT' },
  { code: '2103', name: 'เงินกู้ระยะสั้น', type: 'LIABILITY', category: 'LOAN', level: 2, parent_code: '21', normal_balance: 'CREDIT' },
  { code: '2104', name: 'ภาษีขาย', type: 'LIABILITY', category: 'TAX', level: 2, parent_code: '21', normal_balance: 'CREDIT', tax_related: 1 },
  { code: '2105', name: 'ภาษีหัก ณ ที่จ่าย', type: 'LIABILITY', category: 'TAX', level: 2, parent_code: '21', normal_balance: 'CREDIT', tax_related: 1 },
  { code: '2106', name: 'ประกันสังคม', type: 'LIABILITY', category: 'PAYABLE', level: 2, parent_code: '21', normal_balance: 'CREDIT' },
  { code: '2107', name: 'ค่าใช้จ่ายค้างจ่าย', type: 'LIABILITY', category: 'ACCRUED', level: 2, parent_code: '21', normal_balance: 'CREDIT' },
  { code: '2108', name: 'รายได้รับล่วงหน้า', type: 'LIABILITY', category: 'DEFERRED', level: 2, parent_code: '21', normal_balance: 'CREDIT' },
  
  { code: '22', name: 'หนี้สินไม่หมุนเวียน', type: 'LIABILITY', category: 'LONG_TERM_LIABILITY', level: 1, parent_code: '2', normal_balance: 'CREDIT' },
  { code: '2201', name: 'เงินกู้ระยะยาว', type: 'LIABILITY', category: 'LOAN', level: 2, parent_code: '22', normal_balance: 'CREDIT' },
  { code: '2202', name: 'ภาระผูกพันระยะยาว', type: 'LIABILITY', category: 'PROVISION', level: 2, parent_code: '22', normal_balance: 'CREDIT' },
  
  // ========== EQUITY (3xxxx) ==========
  { code: '3', name: 'ส่วนของผู้ถือหุ้น', type: 'EQUITY', category: 'ROOT', level: 0, normal_balance: 'CREDIT' },
  { code: '3101', name: 'ทุนจดทะเบียน', type: 'EQUITY', category: 'CAPITAL', level: 1, parent_code: '3', normal_balance: 'CREDIT' },
  { code: '3102', name: 'ทุนสำรอง', type: 'EQUITY', category: 'RESERVE', level: 1, parent_code: '3', normal_balance: 'CREDIT' },
  { code: '3103', name: 'กำไรสะสม', type: 'EQUITY', category: 'RETAINED_EARNINGS', level: 1, parent_code: '3', normal_balance: 'CREDIT' },
  { code: '3104', name: 'ขาดทุนสะสม', type: 'EQUITY', category: 'RETAINED_EARNINGS', level: 1, parent_code: '3', normal_balance: 'DEBIT' },
  { code: '3105', name: 'รายได้สะสมอื่น', type: 'EQUITY', category: 'OTHER_COMPREHENSIVE', level: 1, parent_code: '3', normal_balance: 'CREDIT' },
  
  // ========== REVENUE (4xxxx) ==========
  { code: '4', name: 'รายได้', type: 'REVENUE', category: 'ROOT', level: 0, normal_balance: 'CREDIT' },
  { code: '41', name: 'รายได้จากการขาย', type: 'REVENUE', category: 'SALES', level: 1, parent_code: '4', normal_balance: 'CREDIT' },
  { code: '4101', name: 'รายได้ขายสินค้า', type: 'REVENUE', category: 'PRODUCT_SALES', level: 2, parent_code: '41', normal_balance: 'CREDIT' },
  { code: '4102', name: 'รายได้ขายที่นอน', type: 'REVENUE', category: 'PRODUCT_SALES', level: 2, parent_code: '41', normal_balance: 'CREDIT' },
  { code: '4103', name: 'รายได้ขายหมอน', type: 'REVENUE', category: 'PRODUCT_SALES', level: 2, parent_code: '41', normal_balance: 'CREDIT' },
  { code: '4104', name: 'รายได้ขายผ้าปูที่นอน', type: 'REVENUE', category: 'PRODUCT_SALES', level: 2, parent_code: '41', normal_balance: 'CREDIT' },
  { code: '42', name: 'รายได้อื่น', type: 'REVENUE', category: 'OTHER_REVENUE', level: 1, parent_code: '4', normal_balance: 'CREDIT' },
  { code: '4201', name: 'รายได้ค่าบริการ', type: 'REVENUE', category: 'SERVICE', level: 2, parent_code: '42', normal_balance: 'CREDIT' },
  { code: '4202', name: 'รายได้ดอกเบี้ย', type: 'REVENUE', category: 'INTEREST', level: 2, parent_code: '42', normal_balance: 'CREDIT' },
  { code: '4203', name: 'รายได้อื่น', type: 'REVENUE', category: 'OTHER', level: 2, parent_code: '42', normal_balance: 'CREDIT' },
  
  // รายได้หัก (ลดรายได้)
  { code: '43', name: 'ส่วนลดและรับคืน', type: 'REVENUE', category: 'CONTRA_REVENUE', level: 1, parent_code: '4', normal_balance: 'DEBIT' },
  { code: '4301', name: 'ส่วนลดการขาย', type: 'REVENUE', category: 'DISCOUNT', level: 2, parent_code: '43', normal_balance: 'DEBIT' },
  { code: '4302', name: 'รับคืนสินค้า', type: 'REVENUE', category: 'SALES_RETURN', level: 2, parent_code: '43', normal_balance: 'DEBIT' },
  
  // ========== EXPENSES (5xxxx) ==========
  { code: '5', name: 'ค่าใช้จ่าย', type: 'EXPENSE', category: 'ROOT', level: 0, normal_balance: 'DEBIT' },
  { code: '51', name: 'ต้นทุนขาย', type: 'EXPENSE', category: 'COGS', level: 1, parent_code: '5', normal_balance: 'DEBIT' },
  { code: '5101', name: 'ต้นทุนสินค้าขาย', type: 'EXPENSE', category: 'COGS', level: 2, parent_code: '51', normal_balance: 'DEBIT' },
  { code: '5102', name: 'ต้นทุนวัตถุดิบใช้ไป', type: 'EXPENSE', category: 'COGS', level: 2, parent_code: '51', normal_balance: 'DEBIT' },
  { code: '5103', name: 'ค่าแรงงานตรง', type: 'EXPENSE', category: 'DIRECT_LABOR', level: 2, parent_code: '51', normal_balance: 'DEBIT' },
  { code: '5104', name: 'ค่าใช้จ่ายผลิตแปรผัน', type: 'EXPENSE', category: 'VARIABLE_OVERHEAD', level: 2, parent_code: '51', normal_balance: 'DEBIT' },
  { code: '5105', name: 'ค่าใช้จ่ายผลิตคงที่', type: 'EXPENSE', category: 'FIXED_OVERHEAD', level: 2, parent_code: '51', normal_balance: 'DEBIT' },
  
  { code: '52', name: 'ค่าใช้จ่ายในการขาย', type: 'EXPENSE', category: 'SELLING_EXPENSE', level: 1, parent_code: '5', normal_balance: 'DEBIT' },
  { code: '5201', name: 'ค่าโฆษณาและประชาสัมพันธ์', type: 'EXPENSE', category: 'MARKETING', level: 2, parent_code: '52', normal_balance: 'DEBIT' },
  { code: '5202', name: 'ค่าขนส่งสินค้า', type: 'EXPENSE', category: 'SHIPPING', level: 2, parent_code: '52', normal_balance: 'DEBIT' },
  { code: '5203', name: 'ค่าคอมมิชชั่น', type: 'EXPENSE', category: 'COMMISSION', level: 2, parent_code: '52', normal_balance: 'DEBIT' },
  { code: '5204', name: 'ค่าใช้จ่ายบรรจุภัณฑ์', type: 'EXPENSE', category: 'PACKAGING', level: 2, parent_code: '52', normal_balance: 'DEBIT' },
  { code: '5205', name: 'ค่าเสื่อมราคา', type: 'EXPENSE', category: 'DEPRECIATION', level: 2, parent_code: '52', normal_balance: 'DEBIT' },
  
  { code: '53', name: 'ค่าใช้จ่ายในการบริหาร', type: 'EXPENSE', category: 'ADMIN_EXPENSE', level: 1, parent_code: '5', normal_balance: 'DEBIT' },
  { code: '5301', name: 'เงินเดือนและค่าจ้าง', type: 'EXPENSE', category: 'SALARY', level: 2, parent_code: '53', normal_balance: 'DEBIT' },
  { code: '5302', name: 'ค่าเช่าอาคาร', type: 'EXPENSE', category: 'RENT', level: 2, parent_code: '53', normal_balance: 'DEBIT' },
  { code: '5303', name: 'ค่าไฟฟ้า', type: 'EXPENSE', category: 'UTILITIES', level: 2, parent_code: '53', normal_balance: 'DEBIT' },
  { code: '5304', name: 'ค่าน้ำประปา', type: 'EXPENSE', category: 'UTILITIES', level: 2, parent_code: '53', normal_balance: 'DEBIT' },
  { code: '5305', name: 'ค่าโทรศัพท์และอินเทอร์เน็ต', type: 'EXPENSE', category: 'UTILITIES', level: 2, parent_code: '53', normal_balance: 'DEBIT' },
  { code: '5306', name: 'ค่าวัสดุสำนักงาน', type: 'EXPENSE', category: 'SUPPLIES', level: 2, parent_code: '53', normal_balance: 'DEBIT' },
  { code: '5307', name: 'ค่าซ่อมแซมและบำรุงรักษา', type: 'EXPENSE', category: 'MAINTENANCE', level: 2, parent_code: '53', normal_balance: 'DEBIT' },
  { code: '5308', name: 'ค่าใช้จ่ายเดินทาง', type: 'EXPENSE', category: 'TRAVEL', level: 2, parent_code: '53', normal_balance: 'DEBIT' },
  { code: '5309', name: 'ค่าธรรมเนียมธนาคาร', type: 'EXPENSE', category: 'BANK_CHARGE', level: 2, parent_code: '53', normal_balance: 'DEBIT' },
  { code: '5310', name: 'ค่าบัญชีและตรวจสอบ', type: 'EXPENSE', category: 'PROFESSIONAL', level: 2, parent_code: '53', normal_balance: 'DEBIT' },
  { code: '5311', name: 'ค่าประกันภัย', type: 'EXPENSE', category: 'INSURANCE', level: 2, parent_code: '53', normal_balance: 'DEBIT' },
  { code: '5312', name: 'ภาษีอากร', type: 'EXPENSE', category: 'TAX', level: 2, parent_code: '53', normal_balance: 'DEBIT' },
  
  { code: '54', name: 'ค่าใช้จ่ายอื่น', type: 'EXPENSE', category: 'OTHER_EXPENSE', level: 1, parent_code: '5', normal_balance: 'DEBIT' },
  { code: '5401', name: 'ดอกเบี้ยจ่าย', type: 'EXPENSE', category: 'INTEREST', level: 2, parent_code: '54', normal_balance: 'DEBIT' },
  { code: '5402', name: 'ขาดทุนจากการขายสินทรัพย์', type: 'EXPENSE', category: 'LOSS', level: 2, parent_code: '54', normal_balance: 'DEBIT' },
  { code: '5403', name: 'ค่าใช้จ่ายอื่น', type: 'EXPENSE', category: 'OTHER', level: 2, parent_code: '54', normal_balance: 'DEBIT' },
]

// Initialize default chart of accounts for tenant
router.post('/init', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    // Check if accounts already exist
    const existingCount = (db.prepare('SELECT COUNT(*) as count FROM accounts WHERE tenant_id = ?').get(tenantId) as any).count
    
    if (existingCount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Chart of accounts already initialized for this tenant'
      })
    }

    const now = new Date().toISOString()
    const createdAccounts: any[] = []

    // Create accounts in order (parents first)
    const insertAccount = db.prepare(`
      INSERT INTO accounts (id, tenant_id, code, name, type, category, parent_id, level, 
                           is_active, is_system, normal_balance, tax_related, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)
    `)

    const insertTransaction = db.transaction(() => {
      const codeToId: Record<string, string> = {}
      
      // First pass: create all accounts without parent
      for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
        const id = generateId()
        codeToId[acc.code] = id
        
        insertAccount.run(
          id, tenantId, acc.code, acc.name, acc.type, acc.category, null, acc.level,
          acc.normal_balance, acc.tax_related ? 1 : 0, now, now
        )
        
        createdAccounts.push({ id, ...acc })
      }
      
      // Second pass: update parent_id
      const updateParent = db.prepare('UPDATE accounts SET parent_id = ? WHERE id = ?')
      
      for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
        if (acc.parent_code && codeToId[acc.parent_code]) {
          updateParent.run(codeToId[acc.parent_code], codeToId[acc.code])
        }
      }
    })

    insertTransaction()

    res.json({
      success: true,
      message: 'Chart of accounts initialized successfully',
      data: {
        created: createdAccounts.length,
        accounts: createdAccounts
      }
    })
  } catch (error: any) {
    console.error('Init chart of accounts error:', error)
    res.status(500).json({ success: false, message: error.message || 'Failed to initialize chart of accounts' })
  }
})

// Get all accounts (Chart of Accounts)
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { type, active } = req.query
    
    let query = `
      SELECT a.*, 
             p.code as parent_code, 
             p.name as parent_name,
             (SELECT COUNT(*) FROM journal_lines WHERE account_id = a.id) as transaction_count
      FROM accounts a
      LEFT JOIN accounts p ON a.parent_id = p.id
      WHERE a.tenant_id = ?
    `
    const params: any[] = [tenantId]
    
    if (type) {
      query += ' AND a.type = ?'
      params.push(type)
    }
    
    if (active === 'true') {
      query += ' AND a.is_active = 1'
    }
    
    query += ' ORDER BY a.code'
    
    const accounts = db.prepare(query).all(...params) as any[]
    
    // Build tree structure
    const buildTree = (parentId: string | null = null, level: number = 0): any[] => {
      return accounts
        .filter(a => a.parent_id === parentId)
        .map(a => ({
          ...a,
          children: buildTree(a.id, level + 1)
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
      SELECT a.*, p.code as parent_code, p.name as parent_name
      FROM accounts a
      LEFT JOIN accounts p ON a.parent_id = p.id
      WHERE a.id = ? AND a.tenant_id = ?
    `).get(req.params.id, tenantId) as any
    
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
    `).get(req.params.id) as any
    
    const balance = account.normal_balance === 'DEBIT' 
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
      const parent = db.prepare('SELECT level FROM accounts WHERE id = ? AND tenant_id = ?').get(parentId, tenantId) as any
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
  } catch (error: any) {
    console.error('Create account error:', error)
    res.status(500).json({ success: false, message: error.message || 'Failed to create account' })
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
  } catch (error: any) {
    console.error('Update account error:', error)
    res.status(500).json({ success: false, message: error.message || 'Failed to update account' })
  }
})

// Delete account (only if no transactions)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found' })
    }
    
    if (account.is_system) {
      return res.status(400).json({ success: false, message: 'Cannot delete system account' })
    }
    
    // Check for transactions
    const txCount = (db.prepare('SELECT COUNT(*) as count FROM journal_lines WHERE account_id = ?').get(req.params.id) as any).count
    if (txCount > 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot delete account with transactions. Deactivate instead.' 
      })
    }
    
    // Check for children
    const childCount = (db.prepare('SELECT COUNT(*) as count FROM accounts WHERE parent_id = ?').get(req.params.id) as any).count
    if (childCount > 0) {
      return res.status(400).json({ success: false, message: 'Cannot delete account with sub-accounts' })
    }
    
    db.prepare('DELETE FROM accounts WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantId)
    
    res.json({ success: true, message: 'Account deleted successfully' })
  } catch (error: any) {
    console.error('Delete account error:', error)
    res.status(500).json({ success: false, message: error.message || 'Failed to delete account' })
  }
})

export default router
