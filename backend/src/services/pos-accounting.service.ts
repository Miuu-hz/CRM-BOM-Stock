import db from '../db/sqlite'
import { generateId, thaiDateStr } from '../utils/id'
import { postJournal, type JournalLineInput } from './accounting.service'
import { ACC, resolveBankAccountGL } from '../config/accountCodes'
import { ensurePeriod } from '../routes/tax.routes'
import { convertQuantityBidirectional, normalizeUnit } from './unitConversion.service'
import { isServiceItem } from './stockItem.service'
import type { POSBill, POSPayment } from '../types'

const now = () => new Date().toISOString()
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

interface POSBillItem {
  bill_item_id: string
  pos_menu_id: string
  product_name: string
  quantity: number
  bom_id?: string | null
  product_id?: string | null
  menu_sale_unit?: string | null
  product_base_unit?: string | null
  product_stock_unit?: string | null
  product_unit_cost?: number | null
  product_category?: string | null
}

interface BomCostItem {
  quantity: number
  unit_cost: number
  material_id: string | null
  ingredient_unit: string | null
  stock_base_unit: string | null
  stock_unit: string | null
}

interface PosMenuIngredient {
  quantity_used: number
  unit_cost: number
  stock_item_id: string | null
  unit_id: string | null
  stock_base_unit: string | null
  stock_unit: string | null
}

interface CogsItem {
  menuId: string
  menuName: string
  quantity: number
  unitCost: number
  totalCost: number
}

interface AccountBalanceEntry {
  accountCode: string
  debit: number
  credit: number
}

class POSAccountingService {
  /**
   * แปลงจำนวนตามสูตร (BOM/เมนู) ให้เป็นหน่วยฐาน (base_unit) ของวัตถุดิบก่อนคูณกับ
   * unit_cost — unit_cost เก็บเป็น "ต่อ 1 หน่วยฐาน" เสมอ แต่จำนวนในสูตรอาจเขียนด้วย
   * หน่วยอื่น (เช่น สูตรเขียน 0.03 l แต่ base_unit ของวัตถุดิบเป็น ml) ถ้าแปลงไม่ได้
   * (ไม่มี conversion rate) ห้าม throw เพราะเส้นทางนี้ใช้ตอนปิดบิล/ปิดกะ — แค่ warn แล้ว
   * ใช้ตัวเลขเดิม (ไม่แปลง) ไปก่อน เหมือน pattern ใน bom.routes.ts:calculateBOMCost
   */
  private toBaseQty(
    qty: number,
    recipeUnit: string | null | undefined,
    stockBaseUnit: string | null | undefined,
    tenantId: string,
    materialId: string | null | undefined,
    context: string
  ): number {
    const fromUnit = recipeUnit || stockBaseUnit || ''
    const toUnit = stockBaseUnit || fromUnit
    if (!fromUnit || !toUnit || normalizeUnit(fromUnit) === normalizeUnit(toUnit)) {
      return qty
    }
    const result = convertQuantityBidirectional(qty, fromUnit, toUnit, tenantId, materialId || undefined)
    if (result) {
      return result.converted
    }
    console.warn(`[qty] POS COGS: no conversion ${fromUnit} → ${toUnit} for stock item ${materialId}; ${context} cost uses the unconverted quantity and is unreliable`)
    return qty
  }

  /**
   * Calculate COGS from bill items using BOM
   */
  calculateCOGS(billId: string, tenantId: string): {
    totalCost: number
    items: CogsItem[]
  } {
    // Get bill items with their BOM info
    // เพิ่ม pmc.product_id/sale_unit + si.base_unit/unit/unit_cost/category ของสินค้าเมนูเอง
    // ไว้ใช้ตอนเมนูไม่มีทั้ง bom_id และ pos_menu_ingredients (ดูสาขาที่ 3 ด้านล่าง — มิเรอร์
    // pos-stock.service.ts ที่ตัดสต็อกตรงจาก product_id ของเมนูตรงๆ ในเคสนี้)
    const itemsStmt = db.prepare(`
      SELECT
        bi.id as bill_item_id,
        bi.pos_menu_id,
        bi.product_name,
        bi.quantity,
        pmc.bom_id,
        pmc.product_id,
        pmc.sale_unit as menu_sale_unit,
        si.base_unit as product_base_unit,
        si.unit as product_stock_unit,
        si.unit_cost as product_unit_cost,
        si.category as product_category
      FROM pos_bill_items bi
      JOIN pos_menu_configs pmc ON bi.pos_menu_id = pmc.id
      LEFT JOIN stock_items si ON pmc.product_id = si.id AND pmc.tenant_id = si.tenant_id
      WHERE bi.bill_id = ? AND bi.tenant_id = ?
    `)
    const items = itemsStmt.all(billId, tenantId) as POSBillItem[]

    let totalCost = 0
    const costItems: CogsItem[] = []

    for (const item of items) {
      let itemCost = 0

      if (item.bom_id) {
        // Calculate cost from BOM items
        const bomItemsStmt = db.prepare(`
          SELECT
            bi.quantity,
            bi.unit as ingredient_unit,
            bi.material_id,
            si.unit_cost,
            si.base_unit as stock_base_unit,
            si.unit as stock_unit
          FROM bom_items bi
          JOIN stock_items si ON bi.material_id = si.id
          WHERE bi.bom_id = ? AND bi.tenant_id = ? AND bi.item_type = 'MATERIAL'
        `)
        const bomItems = bomItemsStmt.all(item.bom_id, tenantId) as BomCostItem[]

        for (const bomItem of bomItems) {
          const qty = this.toBaseQty(
            bomItem.quantity,
            bomItem.ingredient_unit,
            bomItem.stock_base_unit || bomItem.stock_unit,
            tenantId,
            bomItem.material_id,
            `bill ${billId} bom ${item.bom_id} material ${bomItem.material_id}`
          )
          itemCost += (qty * bomItem.unit_cost)
        }
      } else {
        // Fallback: use pos_menu_ingredients
        const ingStmt = db.prepare(`
          SELECT
            pmi.quantity_used,
            pmi.unit_id,
            pmi.stock_item_id,
            si.unit_cost,
            si.base_unit as stock_base_unit,
            si.unit as stock_unit
          FROM pos_menu_ingredients pmi
          JOIN stock_items si ON pmi.stock_item_id = si.id
          WHERE pmi.pos_menu_id = ? AND pmi.tenant_id = ?
        `)
        const ingredients = ingStmt.all(item.pos_menu_id, tenantId) as PosMenuIngredient[]

        if (ingredients.length > 0) {
          for (const ing of ingredients) {
            const qty = this.toBaseQty(
              ing.quantity_used,
              ing.unit_id,
              ing.stock_base_unit || ing.stock_unit,
              tenantId,
              ing.stock_item_id,
              `bill ${billId} menu ${item.pos_menu_id} stock item ${ing.stock_item_id}`
            )
            itemCost += (qty * ing.unit_cost)
          }
        } else if (item.product_id && !isServiceItem({ category: item.product_category })) {
          // เมนูไม่มีสูตรเลย (ไม่มี bom_id และไม่มีแถว pos_menu_ingredients) — ตัดต้นทุนตรง
          // จากสินค้าของเมนูเอง (product_id) มิเรอร์ pos-stock.service.ts ที่ตัดสต็อกทางนี้
          // เหมือนกัน (เมนูไม่มีสูตร → ตัดสต็อกตรงจาก product เอง, ~L254-261): 1 หน่วยขาย
          // (sale_unit ถ้าตั้งไว้ ไม่งั้น base_unit) ต่อ 1 หน่วยเมนู แปลงเป็น base_unit แล้ว
          // ค่อยคูณ unit_cost (unit_cost เก็บเป็น "ต่อ 1 หน่วยฐาน" เสมอ)
          // ponytail: ข้ามรายการหมวด SERVICE (ค่าบริการ/ค่าขนส่งที่ขายเป็นเมนูได้แต่ไม่มี
          // ต้นทุนสต็อกจริง) ตาม isServiceItem() เดียวกับจุดอื่นที่ตัด/คืนสต็อก
          const stockBaseUnit = item.product_base_unit || item.product_stock_unit
          const qtyPerUnit = this.toBaseQty(
            1,
            item.menu_sale_unit || stockBaseUnit,
            stockBaseUnit,
            tenantId,
            item.product_id,
            `bill ${billId} menu ${item.pos_menu_id} product ${item.product_id} (no recipe)`
          )
          itemCost += qtyPerUnit * (item.product_unit_cost || 0)
        }
      }

      const totalItemCost = itemCost * item.quantity
      totalCost += totalItemCost

      costItems.push({
        menuId: item.pos_menu_id,
        menuName: item.product_name,
        quantity: item.quantity,
        unitCost: itemCost,
        totalCost: totalItemCost
      })
    }

    return { totalCost, items: costItems }
  }

  /**
   * Record sale transaction (Journal Entry + VAT + COGS)
   *
   * Sync + throws: ทุกอย่างอยู่ใน db.transaction เดียว (ซ้อนใน transaction ของผู้เรียกได้ —
   * better-sqlite3 ทำเป็น savepoint) ถ้าพังต้องโยนให้ผู้เรียก rollback การจ่ายเงินทั้งหมด
   * เดิม catch แล้วคืน {success:false} ทำให้บิล PAID ไปแล้วแต่ไม่มี journal
   * บรรทัดลงผ่าน postJournal → เดบิตไม่เท่าเครดิตจะโยน JournalError
   */
  recordSale(
    bill: POSBill,
    _payment: Pick<POSPayment, 'payment_method' | 'amount'> & { bank_account_id?: string | null },
    tenantId: string,
    userId: string
  ): { journalEntryId?: string; cogsEntryId?: string } {
    return db.transaction(() => {
      const cogs = this.calculateCOGS(bill.id, tenantId)
      const today = thaiDateStr() // วันที่ลงบัญชีตามเวลาไทย

      // ต้องเท่ากับ total − ภาษี พอดี ไม่งั้น Dr บัญชีพัก POS (= total) ไม่บาลานซ์กับ Cr
      // ค่าขนส่ง/ค่าบริการอื่นที่เรียกเก็บจากลูกค้าเป็นรายได้ ส่วนลดท้ายบิลหักออกจากรายได้
      const totalRevenue = bill.subtotal + bill.service_charge_amount
        + (bill.extra_charge_amount || 0) - (bill.discount_amount || 0)
      const taxAmount = bill.tax_amount > 0 ? bill.tax_amount : 0

      // เงินจากบิล POS ยังไม่ถึงบัญชีบริษัท ณ ตอนปิดบิล — ลงบัญชีพัก 1180 ไว้ก่อน
      // ทั้งบิลเงินสดและบิลโอน/QR แล้วไปปิดเป็นเงินสด/ธนาคารทีเดียวตอนปิดกะ
      // ponytail: บิลยอด 0 (ฟรีทั้งบิล) ไม่มีบรรทัดให้ลง — postJournal จะโยน จึงข้าม
      let journalEntryId: string | undefined
      if (r2(bill.total_amount) !== 0 || r2(taxAmount) !== 0) {
        journalEntryId = postJournal({
          tenantId,
          date: today,
          referenceType: 'POS_SALE',
          referenceId: bill.id,
          description: `ขายหน้าร้าน - ${bill.bill_number} (${bill.display_name})`,
          createdBy: userId,
          businessUnit: 'RETAIL',
          lines: [
            { code: ACC.POS_CLEARING, description: `รับเงินขาย ${bill.bill_number}`, debit: bill.total_amount },
            { code: ACC.REVENUE_PRODUCT, description: `รายได้จากการขาย ${bill.bill_number}`, credit: totalRevenue },
            { code: ACC.OUTPUT_VAT, description: `ภาษีขาย ${bill.bill_number}`, credit: taxAmount },
          ],
        })
      }

      let cogsEntryId: string | undefined
      if (r2(cogs.totalCost) > 0) {
        cogsEntryId = postJournal({
          tenantId,
          date: today,
          referenceType: 'POS_COGS',
          referenceId: bill.id,
          description: `ต้นทุนขาย - ${bill.bill_number}`,
          createdBy: userId,
          businessUnit: 'RETAIL',
          lines: [
            { code: ACC.COGS_PRODUCT, description: `ต้นทุนขาย ${bill.bill_number}`, debit: cogs.totalCost },
            // ของเข้าคลังลง 1107 สต็อกวัตถุดิบทุกทาง (รับของ/บิลซื้อ/ปรับสต็อก) ตัดออกต้องจาก 1107 ตัวเดียวกัน
            // เคยตัดจาก 1106: 1107 ไม่เคยลด ส่วน 1106 ติดลบเพิ่มทุกบิล
            { code: ACC.RAW_MATERIAL, description: `ลดสินค้าคงคลัง ${bill.bill_number}`, credit: cogs.totalCost },
          ],
        })
      }

      // ฝั่งซื้อใส่ supplier tax_id มาตลอด (purchase.routes.ts) ฝั่งขายเคยใส่ null แข็งๆ
      const partyTaxId = bill.customer_id
        ? ((db.prepare('SELECT tax_id FROM customers WHERE id = ? AND tenant_id = ?')
            .get(bill.customer_id, tenantId) as any)?.tax_id ?? null)
        : null
      db.prepare(`
        INSERT INTO vat_entries (
          id, tenant_id, document_type, document_id, document_number, document_date,
          party_name, party_tax_id, base_amount, vat_rate, vat_amount, total_amount,
          is_output_vat, journal_entry_id, created_at
        ) VALUES (?, ?, 'SALES', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        generateId(), tenantId, bill.id, bill.bill_number, today,
        bill.customer_name || 'ลูกค้าทั่วไป', partyTaxId,
        totalRevenue, bill.tax_rate || 0, bill.tax_amount, bill.total_amount,
        journalEntryId ?? null, now()
      )

      return { journalEntryId, cogsEntryId }
    })()
  }

  /**
   * กะของบิลนี้ปิดไปแล้วหรือยัง — ปิดแล้ว = journal ปิดกะเคลียร์ 1180 ของบิลนี้ไปเป็นเงินสด/ธนาคารแล้ว
   * บิลไม่มี shift_id (บิลเก่า) ใช้เงื่อนไขเดียวกับ getShiftSalesSummary: closed_at อยู่ในช่วงกะที่ปิดแล้ว
   * และกะนั้นมี journal POS_SHIFT_CLOSE จริง
   */
  private isBillShiftClosed(billId: string, tenantId: string): boolean {
    const b = db.prepare('SELECT shift_id, closed_at FROM pos_running_bills WHERE id = ? AND tenant_id = ?')
      .get(billId, tenantId) as { shift_id: string | null; closed_at: string | null } | undefined
    if (!b) return false
    if (b.shift_id) {
      const s = db.prepare('SELECT status FROM pos_shifts WHERE id = ? AND tenant_id = ?')
        .get(b.shift_id, tenantId) as { status: string } | undefined
      return s?.status === 'CLOSED'
    }
    if (!b.closed_at) return false
    return !!db.prepare(`
      SELECT 1 FROM pos_shifts s
      WHERE s.tenant_id = ? AND s.status = 'CLOSED' AND s.opened_at <= ? AND s.closed_at >= ?
        AND EXISTS (SELECT 1 FROM journal_entries j
                    WHERE j.tenant_id = s.tenant_id AND j.reference_type = 'POS_SHIFT_CLOSE' AND j.reference_id = s.id)
    `).get(tenantId, b.closed_at, b.closed_at)
  }

  /**
   * แบ่งยอดเครดิตที่เคยลง 1180 ไปเงินสด/ธนาคาร ตามสัดส่วนที่จ่ายจริง — สูตรเดียวกับ getShiftBankLines
   * (CASH = เงินสด, อื่น ๆ = บัญชี GL ของ bank_account_id หรือ 1102 ถ้าไม่ได้เลือก, ไม่มี payment = เงินสดทั้งก้อน)
   * ให้ตรงกับขาที่ journal ปิดกะ (buildShiftCloseJournal) ลงไว้
   */
  private settledLines(billId: string, tenantId: string, amount: number, description: string): JournalLineInput[] {
    const rows = db.prepare(`
      SELECT payment_method = 'CASH' AS is_cash, bank_account_id, COALESCE(SUM(amount), 0) AS amt
      FROM pos_payments WHERE tenant_id = ? AND bill_id = ?
      GROUP BY is_cash, bank_account_id
    `).all(tenantId, billId) as { is_cash: number; bank_account_id: string | null; amt: number }[]
    const paid = rows.reduce((a, r) => a + r.amt, 0)
    if (paid <= 0) return [{ code: ACC.CASH, description, credit: r2(amount) }]

    const byAccount = new Map<string, number>() // key: 'CASH' | accountId | 'BANK'
    for (const r of rows) {
      const key = r.is_cash ? 'CASH' : (resolveBankAccountGL(tenantId, r.bank_account_id) ?? 'BANK')
      byAccount.set(key, (byAccount.get(key) || 0) + r.amt)
    }
    const entries = [...byAccount.entries()]
    let left = r2(amount)
    return entries.map(([key, amt], i): JournalLineInput => {
      const credit = i === entries.length - 1 ? left : r2(amount * amt / paid)
      left = r2(left - credit)
      if (key === 'CASH') return { code: ACC.CASH, description, credit }
      if (key === 'BANK') return { code: ACC.BANK, description, credit }
      return { accountId: key, description, credit }
    })
  }

  /**
   * Record cancelled sale (reverse journal entry + VAT)
   * Sync + throws (ใน transaction เดียว) — ผู้เรียกต้องไม่ปิดสถานะบิลถ้าตรงนี้โยน
   */
  recordCancelledSale(
    bill: Pick<POSBill, 'id' | 'bill_number' | 'display_name' | 'total_amount'>,
    tenantId: string,
    userId: string,
    reason?: string
  ): { journalEntryId?: string } {
    return db.transaction(() => {
      const journalEntryId = this.reverseSaleJournal(bill, tenantId, userId, reason)
      this.reverseSaleVat(bill, tenantId, journalEntryId)
      return { journalEntryId }
    })()
  }

  private reverseSaleJournal(
    bill: Pick<POSBill, 'id' | 'bill_number' | 'display_name'>,
    tenantId: string,
    userId: string,
    reason?: string
  ): string | undefined {
    // กันลงซ้ำ: ถ้ามี entry POS_CANCEL ของบิลนี้อยู่แล้ว ไม่สร้างซ้ำ
    const existingCancel = db.prepare(`
      SELECT id FROM journal_entries
      WHERE tenant_id = ? AND reference_type = 'POS_CANCEL' AND reference_id = ?
    `).get(tenantId, bill.id) as { id: string } | undefined
    if (existingCancel) return existingCancel.id

    // ponytail: mirror ของเดิมด้วยการสลับ debit<->credit ของ journal เดิม (POS_SALE +
    // POS_COGS) ของบิลนี้ทั้งหมด แทนการ re-derive VAT/COGS เอง — ยกเว้น
    // - บรรทัด REVENUE_PRODUCT (4101) ลงเป็น SALES_RETURN (4302) ให้โชว์เป็น contra-revenue
    // - บรรทัด 1180 เมื่อกะปิดแล้ว: ปิดกะเคลียร์ 1180 ไปเป็นเงินสด/ธนาคารแล้ว ถ้ายัง Cr 1180
    //   บัญชีพักจะติดลบค้าง → คืนเงินจากเงินสด/ธนาคารตามช่องทางที่จ่ายแทน
    const saleLines = db.prepare(`
      SELECT jl.account_id, a.code, jl.debit, jl.credit
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.tenant_id = jl.tenant_id
      LEFT JOIN accounts a ON a.id = jl.account_id AND a.tenant_id = jl.tenant_id
      WHERE je.tenant_id = ? AND je.reference_id = ?
        AND je.reference_type IN ('POS_SALE', 'POS_COGS')
      ORDER BY je.reference_type DESC, jl.line_number
    `).all(tenantId, bill.id) as Array<{ account_id: string; code: string | null; debit: number; credit: number }>

    // บิลเก่า/บิลยังไม่จ่ายที่ไม่เคยลงบัญชี — ไม่มีอะไรให้กลับ อย่าสร้าง entry ปลอม
    if (saleLines.length === 0) return undefined

    const shiftClosed = this.isBillShiftClosed(bill.id, tenantId)
    const description = `กลับรายการยกเลิกบิล ${bill.bill_number}`
    const lines: JournalLineInput[] = saleLines.flatMap((l): JournalLineInput[] => {
      const debit = l.credit || 0
      const credit = l.debit || 0
      if (l.code === ACC.REVENUE_PRODUCT) return [{ code: ACC.SALES_RETURN, description, debit, credit }]
      if (shiftClosed && l.code === ACC.POS_CLEARING && credit > 0 && debit === 0) {
        return this.settledLines(bill.id, tenantId, credit, description)
      }
      return [{ accountId: l.account_id, description, debit, credit }]
    })

    return postJournal({
      tenantId,
      date: thaiDateStr(),
      referenceType: 'POS_CANCEL',
      referenceId: bill.id,
      description: `ยกเลิกบิล - ${bill.bill_number} (${bill.display_name})${reason ? ': ' + reason : ''}`,
      createdBy: userId,
      businessUnit: 'RETAIL',
      lines,
    })
  }

  /**
   * กลับภาษีขาย: vat_entries แถวลบ (SALES_CANCEL — /reports/vat รวม is_output_vat ทุกแถวจึงหักกันเป็น 0)
   * + ลบแถว tax_transactions POS_BILL ถ้างวดยังเปิด / งวดยื่นแล้ว (status ≠ OPEN) คงแถวเดิมไว้แล้วลงแถวปรับลด
   * ติดลบในงวดปัจจุบันแทน (source_type POS_BILL_CANCEL) — ทั้งหมดรันซ้ำได้
   */
  private reverseSaleVat(bill: Pick<POSBill, 'id' | 'bill_number'>, tenantId: string, journalEntryId?: string) {
    const today = thaiDateStr()
    const sale = db.prepare(`
      SELECT * FROM vat_entries WHERE tenant_id = ? AND document_type = 'SALES' AND document_id = ?
    `).get(tenantId, bill.id) as any
    const reversed = db.prepare(`
      SELECT 1 FROM vat_entries WHERE tenant_id = ? AND document_type = 'SALES_CANCEL' AND document_id = ?
    `).get(tenantId, bill.id)
    if (sale && !reversed) {
      db.prepare(`
        INSERT INTO vat_entries (
          id, tenant_id, document_type, document_id, document_number, document_date,
          party_name, party_tax_id, base_amount, vat_rate, vat_amount, total_amount,
          is_output_vat, journal_entry_id, created_at
        ) VALUES (?, ?, 'SALES_CANCEL', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        generateId(), tenantId, bill.id, sale.document_number, today, sale.party_name, sale.party_tax_id,
        -sale.base_amount, sale.vat_rate, -sale.vat_amount, -sale.total_amount, journalEntryId ?? null, now()
      )
    }

    const tx = db.prepare(`
      SELECT t.*, p.status AS period_status FROM tax_transactions t
      LEFT JOIN tax_periods p ON p.id = t.period_id AND p.tenant_id = t.tenant_id
      WHERE t.tenant_id = ? AND t.source_type = 'POS_BILL' AND t.source_id = ?
    `).get(tenantId, bill.id) as any
    if (!tx) return
    if (!tx.period_status || tx.period_status === 'OPEN') {
      db.prepare('DELETE FROM tax_transactions WHERE id = ? AND tenant_id = ?').run(tx.id, tenantId)
      return
    }
    const adjusted = db.prepare(`
      SELECT 1 FROM tax_transactions WHERE tenant_id = ? AND source_type = 'POS_BILL_CANCEL' AND source_id = ?
    `).get(tenantId, bill.id)
    if (adjusted) return
    db.prepare(`
      INSERT INTO tax_transactions (
        id, tenant_id, period_id, transaction_type, source_type, source_id, document_number, document_date,
        partner_id, partner_name, partner_tax_id, description, base_amount, tax_amount, total_amount, tax_rate,
        is_deductible, tax_invoice_number
      ) VALUES (?, ?, ?, 'VAT_OUTPUT', 'POS_BILL_CANCEL', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      generateId(), tenantId, ensurePeriod(tenantId, today), bill.id, tx.document_number, today,
      tx.partner_id, tx.partner_name, tx.partner_tax_id,
      `ปรับลดภาษีขาย ยกเลิกบิล POS ${bill.bill_number} (งวดเดิมยื่นแล้ว)`,
      -tx.base_amount, -tx.tax_amount, -tx.total_amount, tx.tax_rate, tx.tax_invoice_number
    )
  }
}

export default new POSAccountingService()
