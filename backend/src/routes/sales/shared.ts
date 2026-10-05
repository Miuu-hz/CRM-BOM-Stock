import db from '../../db/sqlite'
import { generateId, formatDocumentNumber } from '../../utils/id'
import { isValidImageFile, isAllowedImageExt, isAllowedImageMimetype, getSafeImageExtension, sanitizeFilename } from '../../utils/upload'
import multer from 'multer'
import { convertQuantityBidirectional, autoUnpackIfNeeded, normalizeUnit } from '../../services/unitConversion.service'
import { roundQty } from '../../utils/qty'
import { ACC, ACC_META, resolveBankAccountGL } from '../../config/accountCodes'
import path from 'path'
import fs from 'fs'

// ─── Invoice Attachments Setup ────────────────────────────────────────────────
// ที่เก็บไฟล์แนบ/สลิปที่เดียวของระบบ (multer หน้าเว็บ, MCP image_base64 และ route เสิร์ฟไฟล์ใช้ตัวนี้ร่วมกัน)
// อิง __dirname ไม่ใช่ cwd → backend/storage/payment-attachments ทั้งตอนรันจาก src และ dist
// ATTACHMENT_STORAGE_DIR ใช้ย้ายไปที่อื่นได้ (เทสต์ชี้ไป /tmp จะได้ไม่เขียนลงโฟลเดอร์จริง)
export const invoiceUploadDir = process.env.ATTACHMENT_STORAGE_DIR || path.join(__dirname, '..', '..', '..', 'storage', 'payment-attachments')
if (!fs.existsSync(invoiceUploadDir)) fs.mkdirSync(invoiceUploadDir, { recursive: true })

const invoiceStorage = multer.diskStorage({
  destination: (_req: any, _file: any, cb: any) => cb(null, invoiceUploadDir),
  filename: (req: any, _file: any, cb: any) => {
    const ext = getSafeImageExtension(_file.originalname) || '.jpg'
    cb(null, `inv-${req.params.id}-${Date.now()}${ext}`)
  },
})

export const invoiceUpload = multer({
  storage: invoiceStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req: any, file: any, cb: any) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (isAllowedImageExt(ext) && isAllowedImageMimetype(file.mimetype)) cb(null, true)
    else cb(new Error('Only image files allowed'))
  },
})

// Create invoice_attachments table if not exists
db.prepare(`CREATE TABLE IF NOT EXISTS invoice_attachments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  original_name TEXT NOT NULL,
  file_size INTEGER,
  created_at TEXT NOT NULL
)`).run()

// ─── Accounting helpers ────────────────────────────────────────────────────────

// ตัวจริงอยู่ที่ services/accounting.service — re-export ไว้เพราะ sales/index.ts
// กับ sales/creditNotes.ts import ผ่าน './shared' อยู่เดิม
import { getOrCreateAccount, postJournal } from '../../services/accounting.service'
import { isServiceItem, isSellableItem, normName, rememberAlias } from '../../services/stockItem.service'
export { getOrCreateAccount }

// ── Sellable guard (ขายได้แค่ FINISHED/WIP/SERVICE) ─────────────────────────────
// เจ้าของยืนยัน 2026-10-04: ไม่มีร้านไหนตั้งใจขายวัตถุดิบ (raw) — ก่อนหน้านี้ไม่มี guard
// เลยสักช่องทาง (REST ขาย / MCP ขาย) ใช้ร่วมกันที่นี่ที่เดียวกันหย่อนไม่เท่ากัน
// (ดู [[project_erp_mcp_parity]]) — ตัวที่จริงอยู่ที่ services/stockItem.service.ts (isSellableItem)
export function findNonSellableLine(
  tenantId: string,
  stockItemIds: Array<string | null | undefined>
): { name: string; category: string } | null {
  for (const id of stockItemIds) {
    if (!id) continue   // บรรทัด free text / บริการไม่ผูกสินค้า ผ่านเหมือนเดิม
    const item = db.prepare('SELECT name, category FROM stock_items WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any
    if (item && !isSellableItem(item)) return { name: item.name, category: item.category }
  }
  return null
}

export const notSellableMessage = (name: string, category: string): string =>
  `"${name}" เป็นสินค้าหมวด ${category} ขายไม่ได้ — ขายได้เฉพาะสินค้าสำเร็จรูป/กึ่งสำเร็จรูป/บริการ`

// account_balances ถูกถอดออกจากระบบ 2026-09-14 — ตรวจแล้วไม่มีโค้ดไหนอ่านตารางนี้เลย
// (งบการเงิน/ผังบัญชีรวมยอดจาก journal_lines ตรง ๆ) การคอยเขียนให้มันจึงเป็นการเลี้ยงยอดคงเหลือ
// ชุดที่ 2 ที่ไม่มีวันตรงกับ journal — ถ้าวันไหนต้องการยอดตามงวดจริง ให้คำนวณจาก journal_lines

export function createSalesJournal(
  tenantId: string, referenceType: string, referenceId: string,
  description: string, totalAmount: number, taxAmount: number,
  paymentMethod?: string, sourceNumber?: string, soNumber?: string, bankAccountId?: string | null
) {
    const now = new Date().toISOString()
    const dateStr = now.split('T')[0]
    const yr = new Date().getFullYear()
    const jvNumber = formatDocumentNumber('JV', tenantId, 'JOURNAL', yr, 5)

    // Accounts — using standardized codes from ACC constants
    const arMeta = ACC_META[ACC.AR]!
    const revMeta = ACC_META[ACC.REVENUE_PRODUCT]!
    const vatMeta = ACC_META[ACC.OUTPUT_VAT]!
    const cashMeta = ACC_META[ACC.CASH]!
    const bankMeta = ACC_META[ACC.BANK]!

    const arId   = getOrCreateAccount(tenantId, ACC.AR, arMeta.name, arMeta.type, arMeta.category, arMeta.normalBalance)
    const revId  = getOrCreateAccount(tenantId, ACC.REVENUE_PRODUCT, revMeta.name, revMeta.type, revMeta.category, revMeta.normalBalance)
    const vatId  = getOrCreateAccount(tenantId, ACC.OUTPUT_VAT, vatMeta.name, vatMeta.type, vatMeta.category, vatMeta.normalBalance)
    const cashId = getOrCreateAccount(tenantId, ACC.CASH, cashMeta.name, cashMeta.type, cashMeta.category, cashMeta.normalBalance)
    const bankId = getOrCreateAccount(tenantId, ACC.BANK, bankMeta.name, bankMeta.type, bankMeta.category, bankMeta.normalBalance)

    const entryId = generateId()
    const netRevenue = totalAmount - taxAmount

    if (referenceType === 'INVOICE') {
      // ต้นทุนขาย/ลดสต็อกย้ายไปลงตอนตัดสต็อกแล้ว (deductStockForSO → journal referenceType SO_COGS)
      // เพราะ unit_cost ตอนออกใบแจ้งหนี้อาจไม่ใช่ราคาที่ตัดจริงตอนยืนยัน SO แล้ว (ต้นทุนขยับได้ตลอด
      // จากรับของเข้าใหม่) ลง COGS ซ้ำที่นี่จะทำให้ต้นทุนขายถูกนับสองรอบ
      // DR ลูกหนี้การค้า / CR รายได้ขาย + CR ภาษีขาย
      db.prepare(`INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id, source_number, so_number, description, total_debit, total_credit, is_auto_generated, is_posted, created_by, created_at, updated_at, business_unit)
        VALUES (?, ?, ?, ?, 'INVOICE', ?, ?, ?, ?, ?, ?, 1, 1, 'system', ?, ?, 'WHOLESALE')`)
        .run(entryId, tenantId, jvNumber, dateStr, referenceId, sourceNumber || null, soNumber || null, description, totalAmount, totalAmount, now, now)

      let lineNum = 1
      db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`)
        .run(generateId(), tenantId, entryId, arId, lineNum++, description, totalAmount)
      db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`)
        .run(generateId(), tenantId, entryId, revId, lineNum++, description, netRevenue)
      if (taxAmount > 0) {
        db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`)
          .run(generateId(), tenantId, entryId, vatId, lineNum++, 'ภาษีขาย', taxAmount)
      }

    } else if (referenceType === 'RECEIPT') {
      // DR เงินสด/ธนาคาร (บัญชีย่อยที่ผูกไว้ถ้าเลือกบัญชีธนาคาร) / CR ลูกหนี้การค้า
      const linkedAccountId = resolveBankAccountGL(tenantId, bankAccountId)
      // Allowlist: only CASH posts to the cash account. Everything else (TRANSFER,
      // CHEQUE, CREDIT_CARD, QR_CODE, and any future method) posts to bank, matching
      // the purchase side (purchase.routes.ts) and avoiding new methods silently
      // falling through to cash.
      const cashAccId = linkedAccountId || (paymentMethod === 'CASH' ? cashId : bankId)
      db.prepare(`INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id, source_number, so_number, description, total_debit, total_credit, is_auto_generated, is_posted, created_by, created_at, updated_at, business_unit)
        VALUES (?, ?, ?, ?, 'PAYMENT', ?, ?, ?, ?, ?, ?, 1, 1, 'system', ?, ?, 'WHOLESALE')`)
        .run(entryId, tenantId, jvNumber, dateStr, referenceId, sourceNumber || null, soNumber || null, description, totalAmount, totalAmount, now, now)

      let lineNum = 1
      db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`)
        .run(generateId(), tenantId, entryId, cashAccId, lineNum++, description, totalAmount)
      db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`)
        .run(generateId(), tenantId, entryId, arId, lineNum++, description, totalAmount)

    }
}

export function deductStockForSO(tenantId: string, soId: string, soNumber: string) {
  const items = db.prepare('SELECT * FROM sales_order_items WHERE sales_order_id = ?').all(soId) as any[]

  // When enabled, confirming an SO is allowed to push stock negative instead of
  // throwing "Insufficient stock" and blocking confirmation.
  const setting = db.prepare('SELECT allow_negative_stock FROM company_settings WHERE tenant_id = ?').get(tenantId) as any
  const allowNegativeStock = !!setting && setting.allow_negative_stock === 1

  const deduct = db.transaction(() => {
    let totalCogsValue = 0
    for (const item of items) {
      const stockItemId = item.stock_item_id
      if (!stockItemId) continue
      let qty = Number(item.quantity || 0)
      if (qty <= 0) continue

      // Re-read stock inside the transaction so the deduction is atomic
      const stockItem = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(stockItemId, tenantId) as any
      if (!stockItem) continue
      if (isServiceItem(stockItem)) continue   // ค่าขนส่ง/ค่าแพ็ค ไม่มีของให้ตัด

      const soUnit = item.unit || ''
      // stock_items.quantity is always stored in base_unit — `unit` is the legacy
      // column copied over during the base/sale/display migration and can differ
      // from base_unit (23/456 items today, e.g. shrimp: unit=kg, base_unit=g).
      // Deducting against `unit` silently deducted the wrong amount (5kg sold only
      // took 5g off stock). Fall back to `unit` only when base_unit is empty.
      const stockUnit = stockItem.base_unit || stockItem.unit || ''
      if (soUnit && stockUnit && normalizeUnit(soUnit) !== normalizeUnit(stockUnit)) {
        const converted = convertQuantityBidirectional(qty, soUnit, stockUnit, tenantId, stockItemId, item.product_name)
        if (!converted) {
          // Never deduct the raw SO-unit number: for g -> kg that would take 500 kg
          // off stock for a 500 g line.
          throw new Error(`ไม่พบการแปลงหน่วย ${soUnit} → ${stockUnit} สำหรับ "${stockItem.name || stockItemId}" กรุณาตั้งค่า Unit Conversion ก่อน`)
        }
        qty = converted.converted
      }

      const deductQty = roundQty(qty)

      // Open sealed packs on demand, the way delivery orders and production
      // already do. Without this, confirming an order failed with "insufficient
      // stock" while full unopened packs sat in the warehouse.
      let availableQty = stockItem.quantity
      if (availableQty < deductQty && (stockItem.sealed_qty ?? 0) > 0) {
        const unpack = autoUnpackIfNeeded(stockItem, deductQty, tenantId)
        if (unpack && unpack.unpackedPacks > 0) {
          const released = roundQty(unpack.unpackedPacks * unpack.packFactor)
          db.prepare('UPDATE stock_items SET quantity = ?, sealed_qty = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
            .run(unpack.quantity, unpack.sealed_qty, new Date().toISOString(), stockItemId, tenantId)
          // movement_unit/movement_quantity = หน่วย/จำนวนแพ็คที่ user มองเห็น ให้ตรงกับ
          // แกะแพ็คด้วยมือ (stock.routes.ts POST /:id/unpack) เพื่อ reconcile รายงานได้
          db.prepare(`INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by)
            VALUES (?, ?, ?, 'UNPACK', ?, ?, ?, ?, ?, ?, 'system')`).run(
            generateId(), tenantId, stockItemId, released, stockItem.display_unit || null, unpack.unpackedPacks, `SO: ${soNumber}`,
            `แกะอัตโนมัติ ${unpack.unpackedPacks} ${stockItem.display_unit || ''} → +${released} ${stockUnit}`,
            new Date().toISOString())
          availableQty = unpack.quantity
        }
      }

      if (availableQty < deductQty && !allowNegativeStock) {
        // Say why the packs could not help, so the fix (set the pack rate) is
        // obvious instead of looking like a plain shortage.
        const sealed = stockItem.sealed_qty ?? 0
        const sealedNote = sealed > 0
          ? ` — มีในแพ็คอีก ${sealed} ${stockItem.display_unit || ''} แต่แกะไม่ได้ ยังไม่ได้ตั้งอัตราแปลงหน่วย ${stockItem.display_unit || ''} → ${stockUnit}`
          : ''
        throw new Error(`Insufficient stock for ${stockItem.name || stockItemId}: need ${deductQty} ${stockUnit}, have ${availableQty}${sealedNote}`)
      }

      // ขายด้วยชื่อที่ไม่ตรง SKU (ชื่อเรียกแทน เช่น "น้ำดื่มสิงห์" ของ SKU "น้ำดื่ม") → จำเป็นชื่อรอง
      // แบบเดียวกับฝั่งรับของ + จดชื่อที่ขายไว้ใน stock log (ระบบไม่รู้ว่าของที่ออกจริงยี่ห้อไหน แค่จดชื่อ)
      const lineName = String(item.product_name || '').trim()
      const soldAs = lineName && normName(lineName) !== normName(stockItem.name)
        && rememberAlias(tenantId, lineName, stockItemId, soNumber, 'system') ? `ขาย "${lineName}" · ` : ''

      db.prepare('UPDATE stock_items SET quantity = quantity - ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(deductQty, new Date().toISOString(), stockItemId, tenantId)
      db.prepare(`INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
        VALUES (?, ?, ?, 'OUT', ?, ?, ?, ?, 'system')`).run(
        generateId(), tenantId, stockItemId, deductQty, `SO: ${soNumber}`, `${soldAs}ขายสินค้า SO ${soNumber}${soUnit !== stockUnit ? ` (แปลง: ${item.quantity} ${soUnit} → ${deductQty} ${stockUnit})` : ''}`, new Date().toISOString())

      // เก็บต้นทุนต่อหน่วยฐาน ณ วินาทีตัดสต็อกจริงไว้ที่บรรทัด SO — stock_items.unit_cost เปลี่ยนได้
      // ตลอดเวลา (รับของเข้าใหม่ราคาไม่เท่าเดิม) ถ้ารอไปอ่านตอนออกใบแจ้งหนี้ทีหลังจะได้ต้นทุนผิดตัว
      // ไม่ตรงกับของที่ถูกตัดออกจากคลังจริง ณ วินาทีนี้
      const unitCost = Number(stockItem.unit_cost || 0)
      db.prepare('UPDATE sales_order_items SET issued_unit_cost = ? WHERE id = ?').run(unitCost, item.id)
      totalCogsValue += deductQty * unitCost
    }

    // Dr ต้นทุนขาย / Cr สต็อกสินค้า ในทรานแซกชันเดียวกับการตัดของ — กันช่วงเวลาที่สต็อกในงบสูงเกินจริง
    // ระหว่างตอนตัดของกับตอนออกใบแจ้งหนี้ (ต้นทุนอาจขยับไปแล้วตอนนั้น) ข้ามถ้ามูลค่ารวมน้อยจนไม่มี
    // นัยสำคัญ (ทศนิยมสะสมจากการปัดเศษ) หรือถ้า SO_COGS ของ SO นี้ยังค้างอยู่ (กันเรียกซ้ำ) — ดูยอดสุทธิหลังหัก
    // SO_COGS_CANCEL ไม่ใช่แค่มีแถว: ยืนยัน→ยกเลิก→ยืนยันใหม่ ต้องลงต้นทุนรอบใหม่ ไม่งั้นสต็อกในงบสูงกว่าสต็อกจริง
    if (netSoCogs(tenantId, soId) <= 0.005 && totalCogsValue > 0.005) {
      postJournal({
        tenantId,
        date: new Date().toISOString().substring(0, 10),
        referenceType: 'SO_COGS',
        referenceId: soId,
        description: `ต้นทุนขาย SO ${soNumber}`,
        lines: [
          { code: ACC.COGS_PRODUCT, description: `ต้นทุนขาย - ${soNumber}`, debit: totalCogsValue },
          { code: ACC.INVENTORY, description: `ลดสต็อก - ${soNumber}`, credit: totalCogsValue },
        ],
        createdBy: 'system',
        businessUnit: 'WHOLESALE',
        sourceNumber: soNumber,
        soNumber,
      })
    }
  })

  deduct()
}

/** movement ที่เป็นของ SO นี้: ตัดตอนยืนยัน (SO: x) หรือตัดตอนส่งของ (DO: y ของ SO นี้) */
function soOutRefs(tenantId: string, soId: string, soNumber: string): string[] {
  const dos = db.prepare('SELECT do_number FROM delivery_orders WHERE sales_order_id = ? AND tenant_id = ?').all(soId, tenantId) as any[]
  return [`SO: ${soNumber}`, ...dos.map(d => `DO: ${d.do_number}`)]
}

/** คืนแล้วเท่าไร: ยกเลิก SO ครั้งก่อน (SO: x) + ใบลดหนี้รับคืนของจากใบแจ้งหนี้ของ SO นี้ (CN: z) */
function soReturnRefs(tenantId: string, soId: string, soNumber: string): string[] {
  const cns = db.prepare(`SELECT cn.cn_number FROM credit_notes cn JOIN invoices i ON i.id = cn.invoice_id AND i.tenant_id = cn.tenant_id
    WHERE i.sales_order_id = ? AND cn.tenant_id = ?`).all(soId, tenantId) as any[]
  return [`SO: ${soNumber}`, ...cns.map(c => `CN: ${c.cn_number}`)]
}

function sumMovementsByItem(tenantId: string, type: 'OUT' | 'RETURN', refs: string[]): Map<string, number> {
  const rows = db.prepare(`SELECT stock_item_id, SUM(quantity) AS q FROM stock_movements
    WHERE tenant_id = ? AND type = ? AND reference IN (${refs.map(() => '?').join(',')}) GROUP BY stock_item_id`)
    .all(tenantId, type, ...refs) as any[]
  return new Map(rows.map(r => [r.stock_item_id, Number(r.q) || 0]))
}

/**
 * หน่วยฐานที่ตัดออกจริงต่อ 1 หน่วยของบรรทัด SO (จาก movement OUT ตอนยืนยัน SO) — ใบลดหนี้รับคืนบางส่วน
 * ใช้ตัวคูณเดิมตอนขาย ไม่ใช่ตัวคูณปัจจุบัน (แก้ตัวคูณชื่อเรียกแทน/กฎแปลงหน่วยทีหลังแล้วของคืนไม่เพี้ยน)
 * null = หาไม่ได้แน่ชัด (สินค้าเดียวกันหลายบรรทัดใน SO เดียว / ตัดผ่านใบส่งของ / ไม่มี movement) → ผู้เรียกแปลงแบบเดิม
 */
export function issuedBasePerUnit(tenantId: string, soItemId: string): number | null {
  const line = db.prepare(`SELECT soi.sales_order_id, soi.stock_item_id, soi.quantity, so.so_number FROM sales_order_items soi
    JOIN sales_orders so ON so.id = soi.sales_order_id WHERE soi.id = ? AND so.tenant_id = ?`).get(soItemId, tenantId) as any
  if (!line?.stock_item_id || !(Number(line.quantity) > 0)) return null
  const siblings = db.prepare('SELECT COUNT(*) AS n FROM sales_order_items WHERE sales_order_id = ? AND stock_item_id = ?')
    .get(line.sales_order_id, line.stock_item_id) as any
  if (Number(siblings?.n) !== 1) return null // ponytail: ไม่มี line id ใน stock_movements แยกบรรทัดพี่น้องไม่ได้ — ใช้แปลงแบบเดิม
  // หักที่ยกเลิก SO คืนไปแล้ว (RETURN 'SO: x') — ยืนยัน→ยกเลิก→ยืนยันใหม่ OUT สะสม 2 รอบ ถ้าไม่หักตัวคูณจะเบิ้ล
  const ref = [`SO: ${line.so_number}`]
  const out = sumMovementsByItem(tenantId, 'OUT', ref).get(line.stock_item_id) || 0
  const net = out - (sumMovementsByItem(tenantId, 'RETURN', ref).get(line.stock_item_id) || 0)
  return net > 0.000001 ? net / Number(line.quantity) : null // คืนครบ/คืนเกิน = ไม่สอดคล้อง → แปลงแบบเดิม
}

/**
 * ต้นทุนขายของ SO ที่ยังค้างอยู่ = SO_COGS ทุกรอบ − SO_COGS_CANCEL ทุกรอบ (ยืนยัน/ยกเลิกได้หลายรอบ หลายแถวต่อ ref เดียวกัน)
 * ไม่หัก CREDIT_NOTE_COGS — ส่วนนั้นถูกหักไว้ที่ปริมาณคืนแล้ว (restoreQty ไม่รวมของที่ใบลดหนี้รับคืน)
 */
function netSoCogs(tenantId: string, soId: string): number {
  const row = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN reference_type = 'SO_COGS' THEN total_debit ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN reference_type = 'SO_COGS_CANCEL' THEN total_debit ELSE 0 END), 0) AS net
    FROM journal_entries WHERE tenant_id = ? AND reference_id = ? AND reference_type IN ('SO_COGS', 'SO_COGS_CANCEL')`)
    .get(tenantId, soId) as any
  return Math.round((Number(row?.net) || 0) * 100) / 100
}

/**
 * กลับรายการต้นทุนขายเฉพาะส่วนที่ยกเลิกแล้วคืนเข้าสต็อกจริง (restoreQty × ต้นทุน ณ ตอนขาย) — ไม่ mirror SO_COGS ทั้งก้อน
 * เพราะส่วนที่ใบลดหนี้รับคืนไปก่อนแล้วถูกกลับด้วย CREDIT_NOTE_COGS ไปแล้ว กลับซ้ำ = สต็อกในงบสูงกว่าสต็อกจริง
 * ไม่เคยลง SO_COGS (ตัดผ่านใบส่งของ/เอกสารเก่า) หรือกลับครบแล้ว (ยกเลิกซ้ำ) → ยอดค้างเป็นศูนย์ ไม่ทำอะไร
 */
function reverseSoCogsForRestored(tenantId: string, soId: string, soNumber: string, restoreCost: number) {
  const amount = Math.min(restoreCost, netSoCogs(tenantId, soId)) // ไม่กลับเกินยอดที่ยังค้างอยู่
  if (amount <= 0.005) return
  postJournal({
    tenantId,
    date: new Date().toISOString().substring(0, 10),
    referenceType: 'SO_COGS_CANCEL',
    referenceId: soId,
    description: `กลับรายการต้นทุนขาย (ยกเลิก SO) - ${soNumber}`,
    lines: [
      { code: ACC.INVENTORY, description: `คืนสต็อก (ยกเลิก SO) - ${soNumber}`, debit: amount },
      { code: ACC.COGS_PRODUCT, description: `กลับรายการต้นทุนขาย - ${soNumber}`, credit: amount },
    ],
    createdBy: 'system',
    businessUnit: 'WHOLESALE',
    sourceNumber: soNumber,
    soNumber,
  })
}

/**
 * ยกเลิก SO → คืนสต็อกตาม movement OUT ที่บันทึกไว้จริง (หน่วยฐานที่ตัดไปจริง) ไม่ใช่แปลงใหม่ด้วยตัวคูณปัจจุบัน
 * — แก้ตัวคูณชื่อเรียกแทน (แพ็คสิงห์ 15 → 12) หรือลบชื่อเรียกแทนระหว่างทาง ของต้องกลับเท่าที่ออกไป
 * หักที่คืนไปแล้ว (ยกเลิกซ้ำ / ใบลดหนี้รับคืน) → ไม่คืนซ้ำไม่คืนเกิน · ส่งของบางส่วนผ่าน DO = คืนเท่าที่ DO ตัดจริง
 * เอกสารเก่าที่ไม่มี movement OUT เลย → แปลงหน่วยแบบเดิมทีละบรรทัด
 */
export function restoreStockForSO(tenantId: string, soId: string, soNumber: string) {
  const items = db.prepare('SELECT * FROM sales_order_items WHERE sales_order_id = ?').all(soId) as any[]

  const restore = db.transaction(() => {
    const outByItem = sumMovementsByItem(tenantId, 'OUT', soOutRefs(tenantId, soId, soNumber))
    if (outByItem.size > 0) {
      const returnedByItem = sumMovementsByItem(tenantId, 'RETURN', soReturnRefs(tenantId, soId, soNumber))
      const now = new Date().toISOString()
      const issuedCost = new Map((db.prepare('SELECT stock_item_id, issued_unit_cost FROM sales_order_items WHERE sales_order_id = ?')
        .all(soId) as any[]).map(r => [r.stock_item_id, Number(r.issued_unit_cost || 0)]))
      let restoreCost = 0
      for (const [stockItemId, out] of outByItem) {
        const restoreQty = roundQty(out - (returnedByItem.get(stockItemId) || 0))
        if (restoreQty <= 0) continue
        const stockItem = db.prepare('SELECT base_unit, unit FROM stock_items WHERE id = ? AND tenant_id = ?').get(stockItemId, tenantId) as any
        if (!stockItem) continue
        restoreCost += restoreQty * (issuedCost.get(stockItemId) || 0)
        db.prepare('UPDATE stock_items SET quantity = quantity + ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
          .run(restoreQty, now, stockItemId, tenantId)
        db.prepare(`INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
          VALUES (?, ?, ?, 'RETURN', ?, ?, ?, ?, 'system')`).run(
          generateId(), tenantId, stockItemId, restoreQty, `SO: ${soNumber}`,
          `ยกเลิก SO ${soNumber} - คืนสต็อกตามที่ตัดไปจริง ${restoreQty} ${stockItem.base_unit || stockItem.unit || ''}`, now)
      }
      reverseSoCogsForRestored(tenantId, soId, soNumber, restoreCost)
      return
    }

    // เอกสารเก่า (ไม่มี movement ให้อ้างอิง) — แปลงหน่วยใหม่ทีละบรรทัดแบบเดิม
    for (const item of items) {
      const stockItemId = item.stock_item_id
      if (!stockItemId) continue
      let qty = Number(item.quantity || 0)
      if (qty <= 0) continue

      // Re-read stock inside the transaction so the restoration is atomic
      const stockItem = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(stockItemId, tenantId) as any
      if (!stockItem) continue
      if (isServiceItem(stockItem)) continue   // ค่าขนส่ง/ค่าแพ็ค ไม่มีของให้ตัด

      const soUnit = item.unit || ''
      // Must mirror deductStockForSO's target-unit choice exactly (base_unit first,
      // `unit` fallback) — otherwise a confirm-then-cancel round trip restores stock
      // in a different unit than it was deducted in and the quantity doesn't match.
      const stockUnit = stockItem.base_unit || stockItem.unit || ''
      if (soUnit && stockUnit && normalizeUnit(soUnit) !== normalizeUnit(stockUnit)) {
        const converted = convertQuantityBidirectional(qty, soUnit, stockUnit, tenantId, stockItemId, item.product_name)
        if (!converted) {
          throw new Error(`ไม่พบการแปลงหน่วย ${soUnit} → ${stockUnit} สำหรับ "${stockItem.name || stockItemId}" จึงคืนสต็อกไม่ได้ กรุณาตั้งค่า Unit Conversion กลับคืนก่อน`)
        }
        qty = converted.converted
      }

      // Mirror deductStockForSO's rounding so the restored quantity exactly
      // matches what was originally deducted for this line.
      const restoreQty = roundQty(qty)
      if (restoreQty <= 0) continue

      db.prepare('UPDATE stock_items SET quantity = quantity + ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(restoreQty, new Date().toISOString(), stockItemId, tenantId)
      db.prepare(`INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
        VALUES (?, ?, ?, 'RETURN', ?, ?, ?, ?, 'system')`).run(
        generateId(), tenantId, stockItemId, restoreQty, `SO: ${soNumber}`, `ยกเลิก SO ${soNumber} - คืนสต็อก${soUnit !== stockUnit ? ` (แปลง: ${item.quantity} ${soUnit} \u2192 ${restoreQty} ${stockUnit})` : ''}`, new Date().toISOString())
    }

    // กลับรายการต้นทุนขายที่ deductStockForSO ลงไว้ (ถ้ามี) — ไม่งั้นยกเลิก SO แล้วต้นทุนค้างอยู่
    // ในงบทั้งที่สต็อกถูกคืนแล้ว reverseSalesJournalByRef ทำตัวเป็น no-op เองถ้าไม่เคยลง SO_COGS
    // มาก่อน หรือกลับรายการไปแล้ว (กันเรียกซ้ำจากการยกเลิกซ้ำ)
    reverseSalesJournalByRef(tenantId, 'SO_COGS', 'SO_COGS_CANCEL', soId, `กลับรายการต้นทุนขาย (ยกเลิก SO) - ${soNumber}`)
  })

  restore()
}

// Reverses the sales journal originally posted by createSalesJournal() for an
// INVOICE (Dr AR/COGS, Cr Revenue/VAT/Inventory) by inserting a mirror-image
// journal entry with every line's debit/credit swapped, and applying the same
// swap to account_balances so the net effect nets to zero.
//
// Idempotent: if no original 'INVOICE' journal exists (invoice was never
// posted, e.g. cancelled while still DRAFT) this is a no-op. If a reversal
// (reference_type = 'INVOICE_CANCEL') already exists for this invoice, this
// is also a no-op — guards against double-reversal on repeated cancel calls.
export function reverseSalesJournal(tenantId: string, invoiceId: string, invoiceNumber: string, soNumber?: string): boolean {
  try {
    const original = db.prepare(
      "SELECT * FROM journal_entries WHERE tenant_id = ? AND reference_type = 'INVOICE' AND reference_id = ?"
    ).get(tenantId, invoiceId) as any
    if (!original) return false // nothing was ever posted for this invoice — nothing to reverse

    const alreadyReversed = db.prepare(
      "SELECT id FROM journal_entries WHERE tenant_id = ? AND reference_type = 'INVOICE_CANCEL' AND reference_id = ?"
    ).get(tenantId, invoiceId)
    if (alreadyReversed) return false // already reversed — guard against double reversal

    const originalLines = db.prepare('SELECT * FROM journal_lines WHERE journal_entry_id = ? AND tenant_id = ?').all(original.id, tenantId) as any[]
    if (originalLines.length === 0) return false

    const now = new Date().toISOString()
    const dateStr = now.split('T')[0]
    const yr = new Date().getFullYear()
    const jvNumber = formatDocumentNumber('JV', tenantId, 'JOURNAL', yr, 5)
    const entryId = generateId()

    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id, source_number, so_number, description, total_debit, total_credit, is_auto_generated, is_posted, created_by, created_at, updated_at, business_unit)
        VALUES (?, ?, ?, ?, 'INVOICE_CANCEL', ?, ?, ?, ?, ?, ?, 1, 1, 'system', ?, ?, ?)`)
        .run(entryId, tenantId, jvNumber, dateStr, invoiceId, original.source_number || invoiceNumber || null, original.so_number || soNumber || null,
          `กลับรายการ (ยกเลิกใบแจ้งหนี้) - ${invoiceNumber}`, original.total_credit, original.total_debit, now, now, original.business_unit || 'WHOLESALE')

      for (const line of originalLines) {
        db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(generateId(), tenantId, entryId, line.account_id, line.line_number, `กลับรายการ: ${line.description || ''}`, line.credit || 0, line.debit || 0)
      }
    })
    tx()
    return true
  } catch (err) {
    console.error('\u26a0\ufe0f reverseSalesJournal error:', err)
    return false
  }
}

// Generic reversal for any sales-side journal (e.g. RECEIPT). Mirrors
// reverseSalesJournal but parameterised on the reference_type so it can back
// out receipt (customer payment) postings too. Idempotent; updates account_balances.
export function reverseSalesJournalByRef(tenantId: string, originalRefType: string, cancelRefType: string, refId: string, description: string): boolean {
  try {
    const original = db.prepare(
      "SELECT * FROM journal_entries WHERE tenant_id = ? AND reference_type = ? AND reference_id = ?"
    ).get(tenantId, originalRefType, refId) as any
    if (!original) return false
    const alreadyReversed = db.prepare(
      "SELECT id FROM journal_entries WHERE tenant_id = ? AND reference_type = ? AND reference_id = ?"
    ).get(tenantId, cancelRefType, refId)
    if (alreadyReversed) return false
    const originalLines = db.prepare('SELECT * FROM journal_lines WHERE journal_entry_id = ? AND tenant_id = ?').all(original.id, tenantId) as any[]
    if (originalLines.length === 0) return false

    const now = new Date().toISOString()
    const dateStr = now.split('T')[0]
    const yr = new Date().getFullYear()
    const jvNumber = formatDocumentNumber('JV', tenantId, 'JOURNAL', yr, 5)
    const entryId = generateId()

    db.prepare(`INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id, source_number, so_number, description, total_debit, total_credit, is_auto_generated, is_posted, created_by, created_at, updated_at, business_unit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'system', ?, ?, ?)`)
      .run(entryId, tenantId, jvNumber, dateStr, cancelRefType, refId, original.source_number || null, original.so_number || null,
        description, original.total_credit, original.total_debit, now, now, original.business_unit || 'WHOLESALE')

    for (const line of originalLines) {
      db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(generateId(), tenantId, entryId, line.account_id, line.line_number, `กลับรายการ: ${line.description || ''}`, line.credit || 0, line.debit || 0)
    }
    return true
  } catch (err) {
    console.error('reverseSalesJournalByRef error:', err)
    return false
  }
}

// Voids a receipt (customer payment): reverses its RECEIPT journal, restores the
// invoice paid/balance/status and the SO payment_status, then deletes the receipt.
// Caller must wrap in a db.transaction.
export function voidReceipt(tenantId: string, receipt: any): void {
  reverseSalesJournalByRef(tenantId, 'PAYMENT', 'PAYMENT_CANCEL', receipt.id, `กลับรายการรับชำระ ${receipt.receipt_number}`)
  const now = new Date().toISOString()
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(receipt.invoice_id, tenantId) as any
  if (invoice) {
    const newPaid = Math.max(0, (invoice.paid_amount || 0) - receipt.amount)
    const newBalance = invoice.total_amount - newPaid
    const paymentStatus = newPaid <= 0 ? 'UNPAID' : 'PARTIAL'
    const newStatus = invoice.status === 'CANCELLED' ? 'CANCELLED' : (newPaid <= 0 ? 'ISSUED' : 'PARTIAL')
    db.prepare('UPDATE invoices SET paid_amount = ?, balance_amount = ?, payment_status = ?, status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
      .run(newPaid, newBalance, paymentStatus, newStatus, now, invoice.id, tenantId)
    if (invoice.sales_order_id) {
      db.prepare("UPDATE sales_orders SET payment_status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(paymentStatus, now, invoice.sales_order_id, tenantId)
    }
  }
  db.prepare('DELETE FROM receipts WHERE id = ? AND tenant_id = ?').run(receipt.id, tenantId)
}

export { isValidImageFile, sanitizeFilename }

/**
 * สต็อกของคำสั่งขายใบนี้ถูกตัดไปแล้วหรือยัง
 *
 * ดูจากหลักฐานจริงคือ stock_movements ที่ deductStockForSO เขียนไว้ ไม่ใช่เดาจาก
 * สถานะของ SO — สถานะถูกแก้มือได้หลายทาง (เช่น POST /delivery-orders ดัน SO เป็น
 * PARTIAL ทั้งที่ยังไม่เคยยืนยัน) แต่รายการเคลื่อนไหวโกหกไม่ได้
 */
/**
 * สถานะที่ "ผ่าน deductStockForSO() มาแล้ว" — ใช้ตัดสินว่าตอนยกเลิกต้องคืนสต็อกไหม
 * อยู่ที่นี่ที่เดียวเพราะทั้ง REST (routes/sales/salesOrders.ts) และ MCP (mcp/tools/sales.ts)
 * ต้องใช้ลิสต์เดียวกัน — เคยเป็นสำเนา 2 ชุด ซึ่งคือต้นเหตุของบั๊ก REST/MCP ไม่เท่ากันทั้งชุด
 */
export const STOCK_DEDUCTED_STATUSES = ['CONFIRMED', 'PROCESSING', 'READY', 'DELIVERED', 'PARTIAL', 'COMPLETED']

export function soStockAlreadyDeducted(tenantId: string, soNumber: string): boolean {
  return !!db.prepare("SELECT 1 FROM stock_movements WHERE tenant_id = ? AND type = 'OUT' AND reference = ? LIMIT 1")
    .get(tenantId, `SO: ${soNumber}`)
}

/**
 * ออกใบส่งของจากคำสั่งขาย — เอาเฉพาะของที่ยังค้างส่ง (quantity - delivered_qty)
 *
 * ตั้งสถานะเริ่มต้นเป็น SHIPPED ไม่ใช่ DELIVERED โดยตั้งใจ: สต็อกถูกตัดไปตั้งแต่
 * ยืนยัน SO แล้ว การให้คนรับของกดยืนยัน DELIVERED เองจึงเป็นขั้นที่เหลือไว้ให้
 * หน้างานกด และ delivered_qty ก็ไปอัปเดตที่นั่นที่เดียว (PUT /:id/status)
 *
 * คืน null เมื่อมีใบที่ยังไม่ถูกยกเลิกอยู่แล้ว หรือไม่มีของค้างส่ง — เรียกซ้ำได้ปลอดภัย
 */
export function createDeliveryOrderForSO(
  tenantId: string,
  soId: string,
  opts: { createdBy?: string; status?: string; notes?: string } = {}
): { id: string; do_number: string } | null {
  const so = db.prepare('SELECT * FROM sales_orders WHERE id = ? AND tenant_id = ?').get(soId, tenantId) as any
  if (!so) return null

  const existing = db.prepare("SELECT id FROM delivery_orders WHERE tenant_id = ? AND sales_order_id = ? AND status != 'CANCELLED' LIMIT 1")
    .get(tenantId, soId)
  if (existing) return null

  const items = (db.prepare('SELECT * FROM sales_order_items WHERE sales_order_id = ?').all(soId) as any[])
    .map(i => ({ ...i, remaining: roundQty(Number(i.quantity || 0) - Number(i.delivered_qty || 0)) }))
    .filter(i => i.remaining > 0)
  if (items.length === 0) return null

  // sales_orders ไม่มีที่อยู่จัดส่งของตัวเอง ใช้ที่อยู่ลูกค้าเป็นค่าเริ่มต้นให้แก้ทีหลังได้
  const cust = db.prepare('SELECT address FROM customers WHERE id = ?').get(so.customer_id) as any

  const id = generateId()
  const now = new Date().toISOString()
  let doNumber = ''

  db.transaction(() => {
    // ออกเลขในทรานแซกชันเดียวกับการ insert — ถ้า insert ล้มเหลว ตัวนับต้องย้อนกลับไปด้วย
    // ไม่ใช่เสียเลขไปเปล่าๆ (ponytail ของเดิม: ออกเลขไว้ก่อนนอกทรานแซกชัน)
    doNumber = formatDocumentNumber('DO', tenantId, 'DELIVERY_ORDER', new Date().getFullYear(), 5)
    db.prepare(`
      INSERT INTO delivery_orders (id, tenant_id, do_number, sales_order_id, customer_id, delivery_date,
        delivery_address, driver_name, vehicle_plate, status, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, ?, ?)
    `).run(id, tenantId, doNumber, soId, so.customer_id, so.delivery_date || now,
      cust?.address || '', opts.status || 'SHIPPED', opts.notes || '', opts.createdBy || 'system', now, now)

    const insertItem = db.prepare(`
      INSERT INTO delivery_order_items (id, tenant_id, delivery_order_id, sales_order_item_id, product_id, quantity, notes)
      VALUES (?, ?, ?, ?, ?, ?, '')
    `)
    for (const it of items) {
      // product_id ว่างได้ ตัวสินค้าจริงตามไปจาก sales_order_item_id -> stock_item_id
      insertItem.run(generateId(), tenantId, id, it.id, it.product_id || null, it.remaining)
    }
  })()

  return { id, do_number: doNumber }
}
