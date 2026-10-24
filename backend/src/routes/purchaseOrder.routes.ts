import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { gateOrCreate, recordAutoAction, approvalDenyReason, CreateRequestArgs } from '../services/approvalGate.service'
import { applyPurchaseOrderUpdate, PurchaseOrderUpdateError, resolveSupplierId, resolveExpenseAccountId, poBlockingDocuments, receiptIssuesForItems, poNotReceivableMessage, resolveBankAccountId, isPoLocked, PO_LOCKED_MESSAGE } from '../services/purchaseOrderUpdate.service'
import { canDraftPurchase, canHandleBilling, isBasicUser, userCan } from '../services/rbac.service'
import { gatePurchaseCancel, pendingPurchaseCancelBody, PurchaseCancelError } from '../services/purchaseCancel.service'
import { resolveStockItemId, StockItemRefError } from '../services/stockItem.service'
import { randomUUID } from 'crypto'
import { formatDocumentNumber, docYear } from '../utils/id'
import { z } from 'zod'
import { calcVat } from '../utils/vat'
import { resolveVatInclusive } from '../utils/vatSettings'
import { rememberContactVatMode } from '../services/accounting.service'

// Additive multi-currency columns. Guarded so it only runs once per fresh DB, same
// pattern as tax.routes.ts's wht_form column.
function ensurePOCurrencyColumns() {
  try {
    const columns = db.prepare('PRAGMA table_info(purchase_orders)').all() as { name: string }[]
    const names = new Set(columns.map((c) => c.name))
    if (!names.has('currency_code')) db.exec("ALTER TABLE purchase_orders ADD COLUMN currency_code TEXT DEFAULT 'THB'")
    if (!names.has('exchange_rate')) db.exec('ALTER TABLE purchase_orders ADD COLUMN exchange_rate REAL DEFAULT 1')
    if (!names.has('foreign_amount')) db.exec('ALTER TABLE purchase_orders ADD COLUMN foreign_amount REAL')
  } catch (error) {
    console.error('Failed to ensure PO currency columns:', error)
  }
}
ensurePOCurrencyColumns()

const router = Router()

// ทุก Route ต้องมี Authentication
router.use(authenticate)

function generateId() {
  return randomUUID().replace(/-/g, '').substring(0, 25)
}

const round2 = (n: number) => Math.round(n * 100) / 100

// ดึงข้อความ error ตัวแรกจาก zod มาแปลงเป็นข้อความไทยที่บอกบรรทัดที่ผิด
function firstItemZodError(error: z.ZodError): string {
  const issue = error.issues[0]
  if (typeof issue.path[0] === 'number') {
    return `รายการที่ ${(issue.path[0] as number) + 1}: ${issue.message}`
  }
  return issue.message
}

// ตรวจจำนวน/ราคาต่อหน่วยของบรรทัดสินค้าในใบสั่งซื้อก่อนบันทึก — กันจำนวน/ราคาติดลบหรือ 0 หลุดเข้า DB ตรง ๆ
// unitPrice เป็นฟิลด์บังคับ (ไม่ optional เหมือนฝั่งใบขอซื้อ) เพราะ PO ผูกเงินจริงกับผู้ขายแล้ว
// และหน้าเว็บ/ทุกจุดที่เรียก endpoint นี้ส่ง unitPrice มาด้วยเสมอ — ราคา 0 อนุญาต (ของแถม) แต่ติดลบไม่ได้
const PurchaseOrderItemsSchema = z.array(
  z.object({
    quantity: z.coerce.number({ invalid_type_error: 'จำนวนต้องเป็นตัวเลข' }).positive('จำนวนต้องมากกว่า 0'),
    unitPrice: z.coerce.number({ invalid_type_error: 'ราคาต่อหน่วยต้องเป็นตัวเลข' }).min(0, 'ราคาต่อหน่วยต้องไม่ติดลบ'),
  }).passthrough()
).min(1, 'ต้องมีอย่างน้อย 1 รายการ')

// ส่งปีเหมือน MCP (create_draft_po) และ purchase.routes — เดิมส่ง undefined ทำให้บริษัทที่ไม่ได้ตั้งรูปแบบเลข
// ได้ PO-00025 จากเว็บแต่ PO-2026-00025 จาก MCP โดยนับคนละตัวนับ (ถังปี 0 กับถังปี 2026)
function generatePONumber(tenantId: string) {
  return formatDocumentNumber('PO', tenantId, 'PO', docYear(), 5)
}

const NO_DRAFT_RIGHT = { success: false, message: 'บัญชีแคชเชียร์สร้าง/แก้ใบสั่งซื้อไม่ได้' }

// สถานะที่ไปต่อได้จากหน้านี้ — ย้อนเป็นร่างใช้ /reopen, RECEIVED/PARTIAL ระบบตั้งตอนยืนยัน GR
// (เดิมไม่เช็คสถานะต้นทาง ใบที่ยกเลิกแล้วถูกปลุกกลับเป็น SUBMITTED/APPROVED ได้)
const PO_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['SUBMITTED', 'APPROVED', 'CANCELLED'],
  SUBMITTED: ['APPROVED', 'CANCELLED'],
  APPROVED: ['CANCELLED'],
}

/** ยกเลิกใบสั่งซื้อ — ใช้ทั้งตอนกดเองและตอนอนุมัติคำขอ purchase_cancel (เช็คเอกสารลูกซ้ำตอนรันจริง) */
export function cancelPurchaseOrderNow(tenantId: string, poId: string) {
  const po = db.prepare('SELECT status FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(poId, tenantId) as any
  if (!po) throw new PurchaseCancelError(404, 'Purchase order not found')
  if (!(PO_TRANSITIONS[po.status] || []).includes('CANCELLED')) {
    throw new PurchaseCancelError(409, `ใบสั่งซื้อสถานะ ${po.status} ยกเลิกไม่ได้`)
  }
  const blocking = poBlockingDocuments(tenantId, poId)
  if (blocking) throw new PurchaseCancelError(400, `ไม่สามารถยกเลิกใบสั่งซื้อได้ — ${blocking.message}`)
  db.prepare("UPDATE purchase_orders SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND tenant_id = ?")
    .run(new Date().toISOString(), poId, tenantId)
}

// GET all purchase orders
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const orders = db.prepare(`
      SELECT po.*, s.name as supplier_name, s.code as supplier_code,
        ba.bank_name, ba.account_number as bank_account_number,
        (SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = po.id) as item_count,
        (SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = po.id AND (material_id IS NULL OR material_id = '') AND COALESCE(skip_stock, 0) = 0) as unbound_count
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id AND s.tenant_id = po.tenant_id
      LEFT JOIN bank_accounts ba ON po.bank_account_id = ba.id AND ba.tenant_id = po.tenant_id
      WHERE po.tenant_id = ?
      ORDER BY po.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: orders })
  } catch (error) {
    console.error('Get POs error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch purchase orders' })
  }
})

// GET single PO with items
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const po = db.prepare(`
      SELECT po.*, s.name as supplier_name, s.code as supplier_code, s.email as supplier_email, s.phone as supplier_phone,
        s.tax_id as supplier_tax_id,
        ba.bank_name, ba.account_number as bank_account_number,
        (SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = po.id AND (material_id IS NULL OR material_id = '') AND COALESCE(skip_stock, 0) = 0) as unbound_count
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id AND s.tenant_id = po.tenant_id
      LEFT JOIN bank_accounts ba ON po.bank_account_id = ba.id AND ba.tenant_id = po.tenant_id
      WHERE po.id = ? AND po.tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!po) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' })
    }

    const items = db.prepare(`
      SELECT poi.*, ea.code as expense_account_code, ea.name as expense_account_name
      FROM purchase_order_items poi
      LEFT JOIN accounts ea ON ea.id = poi.expense_account_id
      WHERE poi.purchase_order_id = ?
    `).all(req.params.id)

    res.json({ success: true, data: { ...po, items } })
  } catch (error) {
    console.error('Get PO error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch purchase order' })
  }
})

// POST create PO
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { supplierId, expectedDate, notes, items, taxRate, discountAmount, linkedPrId, currencyCode, exchangeRate, paymentMethod, paymentReference } = req.body
    if (!canDraftPurchase(req.user!)) return res.status(403).json(NO_DRAFT_RIGHT)
    // "จ่ายแล้ว" ทำให้ออกใบแจ้งหนี้แล้วจ่ายเงินอัตโนมัติ — เชื่อเฉพาะคนที่มีสิทธิ์จ่ายเงิน
    const billing = canHandleBilling(req.user!, 'purchase')
    const isPaid = billing ? req.body.isPaid : 0
    const paidAmount = billing ? req.body.paidAmount : null

    const itemsCheck = PurchaseOrderItemsSchema.safeParse(items)
    if (!itemsCheck.success) {
      return res.status(400).json({ success: false, message: firstItemZodError(itemsCheck.error) })
    }

    // '' จากฟอร์ม = ไม่ได้เลือกผู้ขาย · ปล่อยผ่านแล้ว FK พังเป็น 500 เหมือนฝั่งแก้ไข
    let supplierIdSafe: string | null
    let bankAccountId: string | null
    try {
      supplierIdSafe = resolveSupplierId(tenantId, supplierId)
      bankAccountId = resolveBankAccountId(tenantId, req.body.bankAccountId)
      if (linkedPrId && !db.prepare('SELECT 1 FROM purchase_requests WHERE id = ? AND tenant_id = ?').get(linkedPrId, tenantId)) {
        throw new PurchaseOrderUpdateError('ไม่พบใบขอซื้อที่อ้างอิง')
      }
      for (const item of items || []) {
        item.materialId = resolveStockItemId(tenantId, item.materialId, item.description)
        item.resolvedExpenseAccountId = resolveExpenseAccountId(
          tenantId, item.expenseAccountId ?? item.expense_account_id, !!(item.skipStock || item.skip_stock)
        )
      }
    } catch (e) {
      if (e instanceof PurchaseOrderUpdateError || e instanceof StockItemRefError) {
        return res.status(400).json({ success: false, message: e.message })
      }
      throw e
    }

    const id = generateId()
    const poNumber = generatePONumber(tenantId)
    const now = new Date().toISOString()

    // Calculate totals (in whatever currency the items were entered in)
    let subtotal = 0
    if (items && items.length > 0) {
      subtotal = items.reduce((sum: number, item: any) => sum + (item.quantity * item.unitPrice), 0)
    }
    const tax = taxRate || 0
    // ส่วนลดหักออกจากฐานก่อนคิดภาษี (ม.79) — ฟอร์มมีช่องนี้มาตลอดแต่ไม่เคยถูกส่งมาถึงที่นี่
    const inclusive = resolveVatInclusive(tenantId, req.body.vatInclusive)
    const calc = calcVat(subtotal, { rate: tax, discountAmount, inclusive: !!inclusive })
    let taxAmount = calc.taxAmount
    let totalAmount = calc.totalAmount
    let discount = calc.discount
    // โหมดรวม VAT: subtotal ที่เก็บคือยอดก่อนภาษี ไม่ใช่ราคาที่กรอก
    subtotal = calc.subtotal

    // ponytail: only the document header (subtotal/tax/total) is converted to THB — line
    // items keep whatever unit price was entered. No ledger/stock changes here; THB (default)
    // path is untouched (currency_code stays 'THB', exchange_rate 1, foreign_amount null).
    let currency_code = 'THB'
    let exchange_rate = 1
    let foreign_amount: number | null = null
    if (currencyCode && currencyCode !== 'THB') {
      const currency = db.prepare('SELECT code FROM currencies WHERE tenant_id = ? AND code = ? AND is_active = 1')
        .get(tenantId, currencyCode) as { code: string } | undefined
      if (!currency) {
        return res.status(400).json({ success: false, message: 'ไม่พบสกุลเงินที่ระบุ หรือสกุลเงินถูกปิดใช้งาน' })
      }
      const rate = Number(exchangeRate)
      if (!Number.isFinite(rate) || rate <= 0) {
        return res.status(400).json({ success: false, message: 'อัตราแลกเปลี่ยนไม่ถูกต้อง' })
      }
      currency_code = currencyCode
      exchange_rate = rate
      foreign_amount = round2(totalAmount)
      subtotal = round2(subtotal * rate)
      taxAmount = round2(taxAmount * rate)
      totalAmount = round2(totalAmount * rate)
      discount = round2(discount * rate)
    }

    const insertPO = db.prepare(`
      INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, order_date, expected_date,
        subtotal, discount_amount, tax_rate, tax_amount, total_amount, vat_inclusive, notes, linked_pr_id, created_at, updated_at,
        currency_code, exchange_rate, foreign_amount, payment_method, payment_reference, bank_account_id, is_paid, paid_amount)
      VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertItem = db.prepare(`
      INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description,
        quantity, unit, unit_price, total_price, skip_stock, expense_account_id, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const transaction = db.transaction(() => {
      const isPaidInt = isPaid ? 1 : 0
      const paidAmt = paidAmount != null ? Number(paidAmount) : (isPaidInt ? totalAmount : 0)
      insertPO.run(id, tenantId, poNumber, supplierIdSafe, now, expectedDate || null,
        subtotal, discount, tax, taxAmount, totalAmount, inclusive, notes || '', linkedPrId || null, now, now,
        currency_code, exchange_rate, foreign_amount,
        paymentMethod || (isPaidInt ? 'TRANSFER' : null), paymentReference || null, bankAccountId || null, isPaidInt, paidAmt)

      if (items && items.length > 0) {
        for (const item of items) {
          insertItem.run(
            generateId(), tenantId, id, item.materialId || null, item.description || '',
            item.quantity, item.unit || '', item.unitPrice, item.quantity * item.unitPrice,
            // ของที่ตั้งใจไม่นับสต็อก (ของใช้สำนักงาน) ติ๊กมาจากหน้าเว็บ — ตัวนี้คือตัวที่ GR ใช้แยก
            // ว่าบรรทัดที่ไม่ผูกสินค้าเป็นของที่ตั้งใจ หรือลืมผูก
            (item.skipStock || item.skip_stock) ? 1 : 0,
            item.resolvedExpenseAccountId || null,
            item.notes || ''
          )
        }
      }
    })

    transaction()

    // จำโหมด VAT ของใบนี้ไว้กับผู้ขายรายนี้ — PO ถัดไปจะ default ให้ถูกโดยไม่ต้องเลือกใหม่
    rememberContactVatMode(tenantId, 'supplier', supplierIdSafe, tax, !!inclusive)

    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    const poItems = db.prepare(`
      SELECT poi.*, ea.code as expense_account_code, ea.name as expense_account_name
      FROM purchase_order_items poi
      LEFT JOIN accounts ea ON ea.id = poi.expense_account_id
      WHERE poi.purchase_order_id = ?
    `).all(id)

    res.status(201).json({ success: true, data: { ...po, items: poItems } })
  } catch (error) {
    console.error('Create PO error:', error)
    res.status(500).json({ success: false, message: 'Failed to create purchase order' })
  }
})

// POST ตรวจรายการในฟอร์มก่อนบันทึก — ฟอร์มเตือนได้ตั้งแต่ตอนแก้ ไม่ต้องรอไปพังตอนรับสินค้า
router.post('/receipt-check', (req: Request, res: Response) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : []
  const issues = receiptIssuesForItems(req.user!.tenantId, items.map((i: any) => ({
    material_id: typeof i?.materialId === 'string' ? i.materialId : null,
    unit: typeof i?.unit === 'string' ? i.unit : null,
    skip_stock: !!i?.skipStock,
    description: typeof i?.description === 'string' ? i.description : null,
  })))
  res.json({ success: true, data: { issues } })
})

// PUT update PO status
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { status } = req.body

    // Check PO exists and belongs to tenant
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!po) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' })
    }

    // ย้อนเป็นร่างมีประตูเดียวคือ POST /:id/reopen (เช็คสิทธิ์ + GR/ใบแจ้งหนี้ + ล้าง GR DRAFT)
    // RECEIVED/PARTIAL ระบบตั้งเองตอนยืนยันใบรับสินค้า — สาขาเดิมที่เพิ่มสต็อกเองถูกปิดไปแล้ว
    if (!(PO_TRANSITIONS[po.status] || []).includes(status)) {
      return res.status(400).json({ success: false, message: `เปลี่ยนสถานะใบสั่งซื้อจาก ${po.status} เป็น ${status} ไม่ได้` })
    }

    if (status === 'SUBMITTED' || status === 'APPROVED') {
      // D2: ผู้ใช้พื้นฐานทำได้แค่ร่าง · ส่งอนุมัติ = งานฝ่ายจัดซื้อ
      if (isBasicUser(req.user!) || (status === 'SUBMITTED' && !userCan(req.user!, 'purchase', 'write'))) {
        return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ส่งอนุมัติ/อนุมัติใบสั่งซื้อ — ต้องเป็นฝ่ายจัดซื้อ' })
      }
      const notReceivable = poNotReceivableMessage(tenantId, req.params.id)
      if (notReceivable) return res.status(400).json({ success: false, message: notReceivable })
    }

    // อนุมัติ PO ต้องผ่านเกณฑ์เดียวกับ POST /purchase-orders/:id/approve
    if (status === 'APPROVED') {
      const denied = approvalDenyReason(tenantId, req.user!, 'purchase_order', po.total_amount || 0, 'PO')
      if (denied) return res.status(403).json({ success: false, message: denied })
    }

    const now = new Date().toISOString()

    if (status === 'CANCELLED') {
      // ร่าง = ยังไม่ออกไปไหน ยกเลิกได้เหมือนลบร่าง · ใบที่ส่ง/อนุมัติแล้วต้องมีสิทธิ์แผนก ไม่งั้นขออนุมัติ (D3)
      if (po.status === 'DRAFT') {
        if (!canDraftPurchase(req.user!)) return res.status(403).json(NO_DRAFT_RIGHT)
        cancelPurchaseOrderNow(tenantId, po.id)
      } else {
        const { pending, gateArgs } = gatePurchaseCancel({
          tenantId, user: req.user!, kind: 'purchase_order', refId: po.id, docNumber: po.po_number, amount: po.total_amount,
        })
        if (pending) return res.status(202).json(pendingPurchaseCancelBody(pending, po.po_number))
        cancelPurchaseOrderNow(tenantId, po.id)
        recordAutoAction(gateArgs)
      }
    } else if (status === 'APPROVED') {
      db.prepare("UPDATE purchase_orders SET status = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(status, req.user!.userId, now, now, req.params.id, tenantId)
    } else {
      db.prepare("UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(status, now, req.params.id, tenantId)
    }

    const updatedPO = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    res.json({ success: true, data: updatedPO })
  } catch (error) {
    if (error instanceof PurchaseCancelError) return res.status(error.status).json({ success: false, message: error.message })
    console.error('Update PO status error:', error)
    res.status(500).json({ success: false, message: 'Failed to update status' })
  }
})

// PUT update PO
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { supplierId, expectedDate, notes, items, taxRate, paymentMethod, paymentReference, bankAccountId } = req.body
    if (!canDraftPurchase(req.user!)) return res.status(403).json(NO_DRAFT_RIGHT)
    // undefined = คงค่าเดิม — คนไม่มีสิทธิ์จ่ายเงินแก้ "จ่ายแล้ว" ไม่ได้ (ทำให้จ่ายอัตโนมัติตอนออกใบแจ้งหนี้)
    const billing = canHandleBilling(req.user!, 'purchase')
    const isPaid = billing ? req.body.isPaid : undefined
    const paidAmount = billing ? req.body.paidAmount : undefined

    // Check PO exists and belongs to tenant
    const existing = db.prepare('SELECT id, status, po_number FROM purchase_orders WHERE id = ? AND tenant_id = ?')
      .get(req.params.id, tenantId) as any
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' })
    }
    if (isPoLocked(existing.status)) return res.status(409).json({ success: false, message: PO_LOCKED_MESSAGE })
    if (items !== undefined) {
      const itemsCheck = PurchaseOrderItemsSchema.safeParse(items)
      if (!itemsCheck.success) return res.status(400).json({ success: false, message: firstItemZodError(itemsCheck.error) })
    }

    // ล็อกแข็ง: ใบที่รับของแล้วหรือวางบิลแล้ว แก้ไม่ได้ไม่ว่าใครหรือหมวดอนุมัติจะเปิดหรือปิด
    // เพราะการแก้ราคา/จำนวนย้อนหลังทำให้ใบรับของกับบัญชีเจ้าหนี้ไม่ตรงกับใบสั่งซื้ออีกต่อไป
    // (ต้องยกเลิกใบรับของ/ใบแจ้งหนี้ก่อน ซึ่งมีเส้นทางของมันอยู่แล้ว)
    const blockingGr = db.prepare(
      "SELECT gr_number FROM goods_receipts WHERE tenant_id = ? AND purchase_order_id = ? AND status != 'CANCELLED' LIMIT 1"
    ).get(tenantId, req.params.id) as any
    if (blockingGr) {
      return res.status(400).json({
        success: false,
        message: `แก้ไขไม่ได้ — ใบสั่งซื้อ ${existing.po_number} มีใบรับสินค้า ${blockingGr.gr_number} อ้างอิงอยู่ กรุณายกเลิกใบรับสินค้าก่อน`,
      })
    }
    const blockingInvoice = db.prepare(
      "SELECT pi_number FROM purchase_invoices WHERE tenant_id = ? AND purchase_order_id = ? AND status != 'CANCELLED' LIMIT 1"
    ).get(tenantId, req.params.id) as any
    if (blockingInvoice) {
      return res.status(400).json({
        success: false,
        message: `แก้ไขไม่ได้ — ใบสั่งซื้อ ${existing.po_number} มีใบแจ้งหนี้ ${blockingInvoice.pi_number} อ้างอิงอยู่ กรุณายกเลิกใบแจ้งหนี้ก่อน`,
      })
    }

    // หมวด "แก้ไขเอกสารที่ออกไปแล้ว" — เดิมเป็นโหมด "ปลดล็อกแล้วแก้เอง" ตอนนี้เปลี่ยนเป็น
    // draft เหมือนหมวดปรับสต็อก/ยกเลิกบิล POS: พนักงานกด save ตามปกติ ระบบเก็บ payload
    // (ค่าที่เสนอ + before snapshot ของจริงตอนนี้) ไว้รอเจ้าของกดอนุมัติค่อยรันจริง
    // (DRAFT ยังแก้ได้อิสระเหมือนเดิม — ใบยังไม่ออกไปไหน)
    let gateArgs: CreateRequestArgs | null = null
    if (existing.status !== 'DRAFT') {
      const before = {
        header: db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId),
        items: db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(req.params.id),
      }
      // มูลค่าที่ประตูอนุมัติใช้เทียบวงเงิน — เอา "มากสุดของก่อน/หลัง"
      // เทียบยอดเดิมอย่างเดียวไม่พอ: แก้ใบ ฿100 ให้กลายเป็น ฿100,000 ต้องถูกคุมด้วยยอดใหม่
      // สูตรเดียวกับ applyPurchaseOrderUpdate (subtotal + subtotal * taxRate/100)
      const beforeHeader = before.header as any
      const proposedSubtotal = Array.isArray(items)
        ? items.reduce((sum: number, it: any) => sum + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0)
        : Number(beforeHeader?.subtotal || 0)
      const proposedTax = Number(taxRate ?? beforeHeader?.tax_rate ?? 0) || 0
      const editAmount = Math.max(
        Number(beforeHeader?.total_amount || 0),
        proposedSubtotal + proposedSubtotal * (proposedTax / 100)
      )

      gateArgs = {
        tenantId,
        user: req.user! as any,
        category: 'doc_edit',
        refType: 'purchase_orders',
        refId: req.params.id,
        amount: editAmount,
        description: `แก้ไขใบสั่งซื้อ ${existing.po_number} (ยอด ฿${editAmount.toLocaleString('th-TH', { maximumFractionDigits: 2 })})`,
        payload: { before, update: { supplierId, expectedDate, notes, items, taxRate, discountAmount: req.body.discountAmount, vatInclusive: req.body.vatInclusive } },
      }
      const pending = gateOrCreate(gateArgs)
      if (pending) {
        return res.status(202).json({
          success: true,
          pending_approval: true,
          request_number: pending.request_number,
          message: `ส่งคำขออนุมัติแล้ว (${pending.request_number}) ใบสั่งซื้อจะถูกแก้ไขเมื่อผู้อนุมัติยืนยัน`,
        })
      }
    }

    const result = applyPurchaseOrderUpdate(tenantId, req.params.id, { supplierId, expectedDate, notes, items, taxRate, discountAmount: req.body.discountAmount, vatInclusive: req.body.vatInclusive, paymentMethod, paymentReference, bankAccountId, isPaid, paidAmount })
    if (gateArgs) recordAutoAction(gateArgs)
    res.json({ success: true, data: result })
  } catch (error) {
    // ข้อมูลที่กรอกไม่ผ่าน = ความผิดของคำขอ ต้องบอกให้คนแก้ได้ ไม่ใช่ 500 เงียบ ๆ
    if (error instanceof PurchaseOrderUpdateError) {
      return res.status(400).json({ success: false, message: error.message })
    }
    console.error('Update PO error:', error)
    res.status(500).json({ success: false, message: 'Failed to update purchase order' })
  }
})

// DELETE PO
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    if (!canDraftPurchase(req.user!)) return res.status(403).json(NO_DRAFT_RIGHT)
    
    const po = db.prepare('SELECT status FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!po) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' })
    }
    if (po.status !== 'DRAFT') {
      return res.status(400).json({ success: false, message: 'Can only delete draft purchase orders' })
    }

    // ได้เลขเอกสารไปแล้ว = ห้ามหาย → ยกเลิกแทนการลบ เก็บใบและรายการไว้ให้ตรวจย้อนได้ (เลขไม่ขาดช่วง)
    db.prepare("UPDATE purchase_orders SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(new Date().toISOString(), req.params.id, tenantId)
    res.json({ success: true, message: 'ยกเลิกใบสั่งซื้อแล้ว (เก็บเลขที่ไว้)' })
  } catch (error) {
    console.error('Delete PO error:', error)
    res.status(500).json({ success: false, message: 'Failed to delete purchase order' })
  }
})


// -- POST /api/purchase-orders/:id/reopen
// ย้อนคืน PO กลับเป็น DRAFT สำหรับ admin เมื่อ PO ค้างใน SUBMITTED/APPROVED
// และมี GR ที่ยังเป็น DRAFT อยู่ (ยังไม่ยืนยันรับของ) — GR DRAFT เหล่านั้นจะถูกลบทิ้ง
// บล็อกถ้ามี GR ที่ CONFIRMED อยู่ (รับของไปแล้วย้อนไม่ได้)
router.post('/:id/reopen', async (req: Request, res: Response) => {
  try {
    const { tenantId, role } = req.user!
    // ย้อนใบที่อนุมัติไปแล้วกลับมาแก้ = ลบร่องรอยการอนุมัติ (approved_by/at ถูกล้าง)
    // เจ้าของสั่ง 2026-09-18 ให้แคบกว่าการยกเลิก: เฉพาะ ADMIN กับ MASTER
    // (MANAGER/POWERUSER ยกเลิกใบได้ แต่ย้อนกลับมาแก้ไม่ได้)
    if (!['ADMIN', 'MASTER'].includes(role)) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ย้อนคืนใบสั่งซื้อ — ต้องเป็น ADMIN หรือ MASTER เท่านั้น' })
    }

    const po = db.prepare('SELECT id, po_number, status FROM purchase_orders WHERE id = ? AND tenant_id = ?')
      .get(req.params.id, tenantId) as any
    if (!po) return res.status(404).json({ success: false, message: 'ไม่พบใบสั่งซื้อ' })

    if (!['SUBMITTED', 'APPROVED'].includes(po.status)) {
      return res.status(400).json({
        success: false,
        message: `ย้อนคืนได้เฉพาะ PO ที่อยู่ในสถานะ SUBMITTED หรือ APPROVED เท่านั้น (ปัจจุบัน: ${po.status})`,
      })
    }

    // รับของจริง/วางบิลไปแล้วย้อนไม่ได้ — ตัวเช็คเดียวกับตอนยกเลิกใบ (รู้จักใบแจ้งหนี้รวมหลาย PO)
    // ฝั่งย้อนคืนเข้มกว่า: เคยเข้าใบแจ้งหนี้แล้วถือว่าหมดสิทธิ์ ถึงใบนั้นจะถูกยกเลิกไปแล้ว
    const blocking = poBlockingDocuments(tenantId, req.params.id, { anyInvoiceEver: true })
    if (blocking) {
      return res.status(400).json({ success: false, message: `ย้อนคืนไม่ได้ — ${blocking.message}` })
    }

    const now = new Date().toISOString()

    const transaction = db.transaction(() => {
      // ลบ GR DRAFT ทั้งหมดที่ผูกกับ PO นี้ (ยังไม่ยืนยัน ไม่มีผลต่อสต็อก)
      const draftGRs = db.prepare(
        "SELECT id FROM goods_receipts WHERE tenant_id = ? AND purchase_order_id = ? AND status = 'DRAFT'"
      ).all(tenantId, req.params.id) as any[]
      for (const gr of draftGRs) {
        db.prepare('DELETE FROM goods_receipt_items WHERE goods_receipt_id = ? AND tenant_id = ?').run(gr.id, tenantId)
        db.prepare('DELETE FROM goods_receipts WHERE id = ? AND tenant_id = ?').run(gr.id, tenantId)
      }
      // ย้อนสถานะ PO กลับเป็น DRAFT
      db.prepare("UPDATE purchase_orders SET status = 'DRAFT', approved_by = NULL, approved_at = NULL, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(now, req.params.id, tenantId)
      return draftGRs.length
    })

    const deletedGRCount = transaction()
    const updated = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    res.json({
      success: true,
      data: updated,
      message: `ย้อนคืน ${po.po_number} กลับเป็นร่างเรียบร้อย${deletedGRCount > 0 ? ` (ลบใบรับสินค้า DRAFT ${deletedGRCount} ใบ)` : ''}`,
    })
  } catch (error) {
    console.error('Reopen PO error:', error)
    res.status(500).json({ success: false, message: 'Failed to reopen purchase order' })
  }
})

export default router
