// ============================================================
// ผังบัญชีมาตรฐานตามประมวลบัญชีไทย — แหล่งความจริงเดียวของทั้งระบบ
// 1 สินทรัพย์ / 2 หนี้สิน / 3 ส่วนของผู้ถือหุ้น / 4 รายได้ / 5 ค่าใช้จ่าย
//
// ย้ายออกจาก routes/accounts.routes.ts มาไว้ที่นี่ เพราะเดิมถูกขังอยู่ใน route
// เลยมีแค่ปุ่มใน UI ที่เรียกได้ — provisioning กับ migration เข้าไม่ถึง ทำให้
// tenant ใหม่เกิดมาโดยไม่มีผังบัญชี แล้วปล่อยให้ getOrCreateAccount() ปั้นบัญชี
// เดี่ยวๆ ทิ้งไว้ระหว่างทาง จนสุดท้าย /accounts/init ตีกลับว่า "initialized แล้ว"
// ทั้งที่มีอยู่แค่ 2 บัญชี → ตันถาวร ดู carbontome.md session 8 ก.ย. 2026
// ============================================================

import db from '../db/sqlite'
import { generateId } from '../utils/id'
import type { ChartOfAccountRow } from '../types'

export const DEFAULT_CHART_OF_ACCOUNTS = [
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
  { code: '1112', name: 'วัตถุดิบที่ผู้รับจ้างช่วง', type: 'ASSET', category: 'INVENTORY', level: 2, parent_code: '11', normal_balance: 'DEBIT' },

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
  { code: '5106', name: 'ค่าจ้างเหมาช่วง', type: 'EXPENSE', category: 'COGS', level: 2, parent_code: '51', normal_balance: 'DEBIT' },

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

  // ========== รหัสที่โค้ดเรียกใช้จริงแต่เดิมไม่มีในผัง ==========
  // ทั้ง 3 ตัวนี้เดิมถูก getOrCreateAccount() ปั้นสดตอนมีธุรกรรม จึงได้ level 0
  // ไม่มี parent และชื่อแล้วแต่ call site ไหนมาถึงก่อน — ย้ายมาอยู่ในผังให้จบ
  { code: '1180', name: 'ลูกหนี้การค้า-POS', type: 'ASSET', category: 'RECEIVABLE', level: 2, parent_code: '11', normal_balance: 'DEBIT' },
  { code: '5901', name: 'เงินขาด/เงินเกิน', type: 'EXPENSE', category: 'OTHER_EXPENSE', level: 2, parent_code: '54', normal_balance: 'DEBIT' },
  // แยกจาก 5901 เพราะเดิม stock.routes.ts ใช้ '5901' ร่วมกับเงินขาด/เงินเกินของ POS
  // ทั้งที่คนละเรื่อง ชื่อบัญชีเลยขึ้นกับว่าธุรกรรมไหนเกิดก่อน
  { code: '5902', name: 'ค่าใช้จ่ายปรับปรุงสต็อก', type: 'EXPENSE', category: 'OTHER_EXPENSE', level: 2, parent_code: '54', normal_balance: 'DEBIT' },
] as const satisfies ChartOfAccountRow[]

/**
 * สร้างผังบัญชีให้ tenant — idempotent: ใส่เฉพาะรหัสที่ยังไม่มี
 *
 * เดิม /accounts/init ตีกลับทันทีถ้ามีบัญชีอยู่แล้วแม้แต่ตัวเดียว ทำให้ tenant ที่
 * โดน getOrCreateAccount() ปั้นบัญชีทิ้งไว้ก่อนติดล็อกถาวร — ที่นี่เติมเฉพาะที่ขาด
 * ของเดิมไม่แตะ (ทั้งชื่อที่ผู้ใช้แก้เอง และบัญชีย่อยธนาคาร 1102-NN)
 *
 * คืนค่าจำนวนบัญชีที่สร้างเพิ่ม
 */
export function seedChartOfAccounts(tenantId: string): number {
  const rows = DEFAULT_CHART_OF_ACCOUNTS as readonly ChartOfAccountRow[]

  const insertAccount = db.prepare(`
    INSERT INTO accounts (id, tenant_id, code, name, type, category, parent_id, level,
                          is_active, is_system, normal_balance, tax_related, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 1, 1, ?, ?, ?, ?)
  `)
  // ตั้ง level พร้อม parent ด้วย เพราะบัญชีกำพร้าที่ getOrCreateAccount ปั้นไว้เป็น level 0 ทั้งหมด
  const updateParent = db.prepare(
    'UPDATE accounts SET parent_id = ?, level = ? WHERE id = ? AND (parent_id IS NULL OR level <> ?)')

  return db.transaction(() => {
    const now = new Date().toISOString()
    // รหัส → id ของทุกบัญชีที่มีอยู่ (ทั้งเก่าและที่เพิ่งสร้าง) ใช้ผูก parent รอบสอง
    const codeToId: Record<string, string> = {}
    for (const r of db.prepare('SELECT id, code FROM accounts WHERE tenant_id = ?').all(tenantId) as { id: string; code: string }[]) {
      codeToId[r.code] = r.id
    }

    let created = 0
    for (const acc of rows) {
      if (codeToId[acc.code]) continue
      const id = generateId()
      insertAccount.run(id, tenantId, acc.code, acc.name, acc.type, acc.category, acc.level,
                        acc.normal_balance, acc.tax_related ? 1 : 0, now, now)
      codeToId[acc.code] = id
      created++
    }

    // ผูก parent ทีหลังเสมอ เพราะลูกอาจถูก insert ก่อนแม่ในรอบแรก
    // เงื่อนไข parent_id IS NULL ทำให้บัญชีเก่าที่เคยกำพร้า (level 0 ไม่มีแม่)
    // ถูกจับกลับเข้าที่ให้ด้วย โดยไม่ไปย้ายบัญชีที่ผูกถูกอยู่แล้ว
    for (const acc of rows) {
      const parentCode = acc.parent_code
      if (!parentCode) continue
      const parentId = codeToId[parentCode]
      const selfId = codeToId[acc.code]
      if (parentId && selfId) updateParent.run(parentId, acc.level, selfId, acc.level)
    }

    return created
  })()
}

/**
 * เติมผังบัญชีที่ขาดให้ทุก tenant ที่มีอยู่ — เรียกตอน server start
 * แก้ย้อนหลังให้ tenant ที่เกิดก่อนมีการ seed ตอน provision (เช่น tenant ที่มีแค่
 * 1101 กับ 4200 ที่ getOrCreateAccount ปั้นทิ้งไว้ แล้ว /accounts/init ตันไปแล้ว)
 */
export function backfillChartOfAccounts(): void {
  // เฉพาะ tenant ที่มีผู้ใช้จริง — company_settings ที่ไม่มี user เลยคือแถวขยะ
  // (เช่นที่ test suite เคยทิ้งไว้ตอนยังวิ่งใส่ dev.db) ไม่ควรหว่านผังบัญชี 93 บัญชีให้
  // tenant ที่ provision ปกติมี ADMIN ตั้งแต่แรกเสมอ จึงไม่มีทางตกหล่น
  const tenants = db.prepare(
    'SELECT tenant_id FROM company_settings WHERE EXISTS (SELECT 1 FROM users u WHERE u.tenant_id = company_settings.tenant_id)'
  ).all() as { tenant_id: string }[]
  let touched = 0
  for (const { tenant_id } of tenants) {
    const created = seedChartOfAccounts(tenant_id)
    if (created > 0) {
      console.log(`✅ Migration: seeded ${created} accounts for tenant ${tenant_id}`)
      touched++
    }
  }
  if (touched === 0) console.log('✅ Migration: chart of accounts complete for all tenants')
}
