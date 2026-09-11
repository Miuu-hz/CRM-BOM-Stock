import db from '../db/sqlite'
import { generateId, formatDocumentNumber } from '../utils/id'
import { getOrCreateAccount } from './accounting.service'
import { resolveBankAccountGL, ACC, ACC_META } from '../config/accountCodes'
import { convertQuantityBidirectional, normalizeUnit } from './unitConversion.service'
import type { POSBill, POSPayment } from '../types'

const now = () => new Date().toISOString()

interface POSBillItem {
  bill_item_id: string
  pos_menu_id: string
  product_name: string
  quantity: number
  bom_id?: string | null
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

interface DailySalesSummary {
  date: string
  summary: {
    bill_count: number
    total_subtotal: number
    total_service_charge: number
    total_tax: number
    total_revenue: number
    avg_bill_value: number
  }
  paymentBreakdown: unknown[]
}

class POSAccountingService {
  /**
   * Generate journal entry number
   */
  private generateEntryNumber(tenantId: string): string {
    const year = new Date().getFullYear()
    return formatDocumentNumber('JV', tenantId, 'JOURNAL', year, 6)
  }

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
  private async calculateCOGS(billId: string, tenantId: string): Promise<{
    totalCost: number
    items: CogsItem[]
  }> {
    // Get bill items with their BOM info
    const itemsStmt = db.prepare(`
      SELECT
        bi.id as bill_item_id,
        bi.pos_menu_id,
        bi.product_name,
        bi.quantity,
        pmc.bom_id
      FROM pos_bill_items bi
      JOIN pos_menu_configs pmc ON bi.pos_menu_id = pmc.id
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
   */
  async recordSale(
    bill: POSBill,
    payment: POSPayment,
    tenantId: string,
    userId: string
  ): Promise<{ success: boolean; journalEntryId?: string; cogsEntryId?: string; errors: string[] }> {
    const errors: string[] = []

    try {
      // Calculate COGS
      const cogs = await this.calculateCOGS(bill.id, tenantId)

      // 1. Create Revenue Journal Entry
      const entryNumber = this.generateEntryNumber(tenantId)
      const entryId = generateId()
      const today = now().split('T')[0]

      const totalRevenue = bill.subtotal + bill.service_charge_amount

      // Insert journal entry header
      const entryStmt = db.prepare(`
        INSERT INTO journal_entries (
          id, tenant_id, entry_number, date, reference_type, reference_id,
          description, total_debit, total_credit, is_auto_generated, created_by, created_at, business_unit
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'RETAIL')
      `)

      entryStmt.run(
        entryId,
        tenantId,
        entryNumber,
        today,
        'POS_SALE',
        bill.id,
        `ขายหน้าร้าน - ${bill.bill_number} (${bill.display_name})`,
        bill.total_amount,
        bill.total_amount,
        userId,
        now()
      )

      // Insert journal lines
      // Line 1: Debit Cash/Bank — the specific bank account's linked GL sub-account
      // when the cashier selected one (e.g. QR_CODE payment), else the generic
      // CASH/BANK account by payment method.
      const line1Id = generateId()
      const linkedAccountId = resolveBankAccountGL(tenantId, payment.bank_account_id)
      const cashAccountCode = payment.payment_method === 'CASH' ? ACC.CASH : ACC.BANK
      const cashAccountMeta = ACC_META[cashAccountCode]!
      const cashAccountId = linkedAccountId || getOrCreateAccount(tenantId, cashAccountCode, cashAccountMeta.name, cashAccountMeta.type, cashAccountMeta.category, cashAccountMeta.normalBalance)

      const lineStmt = db.prepare(`
        INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
        VALUES (?, ?, ?, ?, 1, ?, ?, 0)
      `)

      lineStmt.run(
        line1Id,
        tenantId,
        entryId,
        cashAccountId,
        `รับเงินขาย ${bill.bill_number}`,
        bill.total_amount
      )

      // Line 2: Credit Sales Revenue
      const line2Id = generateId()
      const revenueAccountId = getOrCreateAccount(tenantId, ACC.REVENUE_PRODUCT, ACC_META[ACC.REVENUE_PRODUCT]!.name, ACC_META[ACC.REVENUE_PRODUCT]!.type, ACC_META[ACC.REVENUE_PRODUCT]!.category, ACC_META[ACC.REVENUE_PRODUCT]!.normalBalance)
      const line2Stmt = db.prepare(`
        INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
        VALUES (?, ?, ?, ?, 2, ?, 0, ?)
      `)

      line2Stmt.run(
        line2Id,
        tenantId,
        entryId,
        revenueAccountId,
        `รายได้จากการขาย ${bill.bill_number}`,
        totalRevenue
      )

      // Line 3: Credit VAT Output (if > 0)
      if (bill.tax_amount > 0) {
        const line3Id = generateId()
        const vatAccountId = getOrCreateAccount(tenantId, ACC.OUTPUT_VAT, ACC_META[ACC.OUTPUT_VAT]!.name, ACC_META[ACC.OUTPUT_VAT]!.type, ACC_META[ACC.OUTPUT_VAT]!.category, ACC_META[ACC.OUTPUT_VAT]!.normalBalance)
        const line3Stmt = db.prepare(`
          INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
          VALUES (?, ?, ?, ?, 3, ?, 0, ?)
        `)

        line3Stmt.run(
          line3Id,
          tenantId,
          entryId,
          vatAccountId,
          `ภาษีขาย ${bill.bill_number}`,
          bill.tax_amount
        )
      }

      // 2. Record COGS Journal Entry (if cost > 0)
      let cogsEntryId: string | undefined
      if (cogs.totalCost > 0) {
        const cogsEntryNumber = this.generateEntryNumber(tenantId)
        cogsEntryId = generateId()

        const cogsEntryStmt = db.prepare(`
          INSERT INTO journal_entries (
            id, tenant_id, entry_number, date, reference_type, reference_id,
            description, total_debit, total_credit, is_auto_generated, created_by, created_at, business_unit
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'RETAIL')
        `)

        cogsEntryStmt.run(
          cogsEntryId,
          tenantId,
          cogsEntryNumber,
          today,
          'POS_COGS',
          bill.id,
          `ต้นทุนขาย - ${bill.bill_number}`,
          cogs.totalCost,
          cogs.totalCost,
          userId,
          now()
        )

        // COGS Line 1: Debit COGS
        const cogsLine1Id = generateId()
        const cogsAccountId = getOrCreateAccount(tenantId, ACC.COGS_PRODUCT, ACC_META[ACC.COGS_PRODUCT]!.name, ACC_META[ACC.COGS_PRODUCT]!.type, ACC_META[ACC.COGS_PRODUCT]!.category, ACC_META[ACC.COGS_PRODUCT]!.normalBalance)
        const cogsLineStmt = db.prepare(`
          INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
          VALUES (?, ?, ?, ?, 1, ?, ?, 0)
        `)

        cogsLineStmt.run(
          cogsLine1Id,
          tenantId,
          cogsEntryId,
          cogsAccountId,
          `ต้นทุนขาย ${bill.bill_number}`,
          cogs.totalCost
        )

        // COGS Line 2: Credit Inventory
        const cogsLine2Id = generateId()
        const inventoryAccountId = getOrCreateAccount(tenantId, ACC.INVENTORY, ACC_META[ACC.INVENTORY]!.name, ACC_META[ACC.INVENTORY]!.type, ACC_META[ACC.INVENTORY]!.category, ACC_META[ACC.INVENTORY]!.normalBalance)
        const cogsLine2Stmt = db.prepare(`
          INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
          VALUES (?, ?, ?, ?, 2, ?, 0, ?)
        `)

        cogsLine2Stmt.run(
          cogsLine2Id,
          tenantId,
          cogsEntryId,
          inventoryAccountId,
          `ลดสินค้าคงคลัง ${bill.bill_number}`,
          cogs.totalCost
        )

        // Update balances for COGS
        await this.updateAccountBalances(tenantId, today, [
          { accountCode: ACC.COGS_PRODUCT, debit: cogs.totalCost, credit: 0 },
          { accountCode: ACC.INVENTORY, debit: 0, credit: cogs.totalCost }
        ])
      }

      // 3. Record VAT Entry
      const vatId = generateId()
      const vatStmt = db.prepare(`
        INSERT INTO vat_entries (
          id, tenant_id, document_type, document_id, document_number, document_date,
          party_name, party_tax_id, base_amount, vat_rate, vat_amount, total_amount,
          is_output_vat, journal_entry_id, created_at
        ) VALUES (?, ?, 'SALES', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `)

      vatStmt.run(
        vatId,
        tenantId,
        bill.id,
        bill.bill_number,
        today,
        bill.customer_name || 'ลูกค้าทั่วไป',
        // ฝั่งซื้อใส่ supplier tax_id มาตลอด (purchase.routes.ts) ฝั่งขายเคยใส่ null แข็งๆ
        (bill.customer_id
          ? ((db.prepare('SELECT tax_id FROM customers WHERE id = ? AND tenant_id = ?')
              .get(bill.customer_id, tenantId) as any)?.tax_id ?? null)
          : null), // party_tax_id
        totalRevenue,
        bill.tax_rate || 0,
        bill.tax_amount,
        bill.total_amount,
        entryId,
        now()
      )

      // 4. Update Account Balances for Revenue
      await this.updateAccountBalances(tenantId, today, [
        { accountCode: cashAccountCode, debit: bill.total_amount, credit: 0 },
        { accountCode: ACC.REVENUE_PRODUCT, debit: 0, credit: totalRevenue },
        { accountCode: ACC.OUTPUT_VAT, debit: 0, credit: bill.tax_amount }
      ])

      return {
        success: true,
        journalEntryId: entryId,
        cogsEntryId,
        errors: []
      }
    } catch (error) {
      return {
        success: false,
        errors: [(error as Error).message || 'Failed to record sale transaction']
      }
    }
  }

  /**
   * Record cancelled sale (reverse journal entry)
   */
  async recordCancelledSale(
    bill: Pick<POSBill, 'id' | 'bill_number' | 'display_name' | 'total_amount'>,
    tenantId: string,
    userId: string,
    reason?: string
  ): Promise<{ success: boolean; journalEntryId?: string; errors: string[] }> {
    const errors: string[] = []

    try {
      // กันลงซ้ำ: ถ้ามี entry POS_CANCEL ของบิลนี้อยู่แล้ว ไม่สร้างซ้ำ
      const existingCancel = db.prepare(`
        SELECT id FROM journal_entries
        WHERE tenant_id = ? AND reference_type = 'POS_CANCEL' AND reference_id = ?
      `).get(tenantId, bill.id) as { id: string } | undefined
      if (existingCancel) {
        return { success: true, journalEntryId: existingCancel.id, errors: [] }
      }

      // ponytail: mirror ของเดิมด้วยการสลับ debit<->credit ของ journal เดิม (POS_SALE +
      // POS_COGS) ของบิลนี้ทั้งหมด แทนการ re-derive VAT/COGS/บัญชีเงินสด-ธนาคารเอง — ได้
      // mirror image ที่ถูกต้องเสมอ (รวม sub-account ธนาคารที่ resolveBankAccountGL ผูกไว้
      // ตอนขาย) แม้ recordSale จะเปลี่ยน logic ในอนาคต — เหมือน void ใน pos.routes.ts —
      // ยกเว้นบรรทัด REVENUE_PRODUCT (4101) ที่ให้ลงเป็น SALES_RETURN (4302) แทน เพื่อโชว์
      // เป็น contra-revenue ตามที่นักบัญชีต้องการอ่านง่าย
      const saleLines = db.prepare(`
        SELECT jl.account_id, jl.debit, jl.credit
        FROM journal_lines jl
        JOIN journal_entries je ON je.id = jl.journal_entry_id
        WHERE je.tenant_id = ? AND je.reference_id = ?
          AND je.reference_type IN ('POS_SALE', 'POS_COGS')
        ORDER BY je.reference_type DESC, jl.line_number
      `).all(tenantId, bill.id) as Array<{ account_id: string; debit: number; credit: number }>

      if (saleLines.length === 0) {
        // บิลเก่าที่ไม่เคยลงบัญชี — ไม่มีอะไรให้กลับ อย่าสร้าง entry ปลอม
        console.warn(`[pos-cancel] bill ${bill.id} has no POS_SALE/POS_COGS journal; skipping reversal entry`)
        return { success: true, errors: [] }
      }

      const revenueAccountId = getOrCreateAccount(tenantId, ACC.REVENUE_PRODUCT, ACC_META[ACC.REVENUE_PRODUCT]!.name, ACC_META[ACC.REVENUE_PRODUCT]!.type, ACC_META[ACC.REVENUE_PRODUCT]!.category, ACC_META[ACC.REVENUE_PRODUCT]!.normalBalance)
      const salesReturnAccountId = getOrCreateAccount(tenantId, ACC.SALES_RETURN, ACC_META[ACC.SALES_RETURN]!.name, ACC_META[ACC.SALES_RETURN]!.type, ACC_META[ACC.SALES_RETURN]!.category, ACC_META[ACC.SALES_RETURN]!.normalBalance)

      const reversalTotal = saleLines.reduce((s, l) => s + (l.debit || 0), 0)
      const entryNumber = this.generateEntryNumber(tenantId)
      const entryId = generateId()
      const today = now().split('T')[0]

      const entryStmt = db.prepare(`
        INSERT INTO journal_entries (
          id, tenant_id, entry_number, date, reference_type, reference_id,
          description, total_debit, total_credit, is_auto_generated, created_by, created_at, business_unit
        ) VALUES (?, ?, ?, ?, 'POS_CANCEL', ?, ?, ?, ?, 1, ?, ?, 'RETAIL')
      `)

      entryStmt.run(
        entryId,
        tenantId,
        entryNumber,
        today,
        bill.id,
        `ยกเลิกบิล - ${bill.bill_number} (${bill.display_name})${reason ? ': ' + reason : ''}`,
        reversalTotal,
        reversalTotal,
        userId,
        now()
      )

      const insertLine = db.prepare(`
        INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)

      // อัปเดต account_balances ด้วย account_id ตรงๆ (บัญชีเงินสด/ธนาคารอาจเป็น sub-account
      // ที่ผูกกับ bank_accounts จึงหาด้วย code ไม่ได้ — เหมือน void ใน pos.routes.ts)
      const balYear = parseInt(today.split('-')[0])
      const balPeriod = parseInt(today.split('-')[1])
      const updateBal = (accountId: string, debit: number, credit: number) => {
        const existingBal = db.prepare(`
          SELECT id FROM account_balances WHERE account_id = ? AND fiscal_year = ? AND period = ?
        `).get(accountId, balYear, balPeriod)
        if (existingBal) {
          db.prepare(`
            UPDATE account_balances
            SET debit_amount = debit_amount + ?, credit_amount = credit_amount + ?,
                ending_balance = ending_balance + ? - ?
            WHERE account_id = ? AND fiscal_year = ? AND period = ?
          `).run(debit, credit, debit, credit, accountId, balYear, balPeriod)
        } else {
          db.prepare(`
            INSERT INTO account_balances (id, tenant_id, account_id, fiscal_year, period, beginning_balance, debit_amount, credit_amount, ending_balance)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
          `).run(generateId(), tenantId, accountId, balYear, balPeriod, debit, credit, debit - credit)
        }
      }

      saleLines.forEach((l, i) => {
        const debit = l.credit || 0
        const credit = l.debit || 0
        // บรรทัดรายได้ (4101) ให้ลงเป็นรับคืนสินค้า (4302) แทน ไม่ใช่ Dr กลับ 4101 ตรงๆ
        const accountId = l.account_id === revenueAccountId ? salesReturnAccountId : l.account_id
        insertLine.run(
          generateId(), tenantId, entryId, accountId, i + 1,
          `กลับรายการยกเลิกบิล ${bill.bill_number}`, debit, credit
        )
        updateBal(accountId, debit, credit)
      })

      return {
        success: true,
        journalEntryId: entryId,
        errors: []
      }
    } catch (error) {
      return {
        success: false,
        errors: [(error as Error).message || 'Failed to record cancellation']
      }
    }
  }

  /**
   * Update account balances (simplified)
   */
  private async updateAccountBalances(
    tenantId: string,
    date: string,
    entries: AccountBalanceEntry[]
  ): Promise<void> {
    const year = parseInt(date.split('-')[0])
    const month = parseInt(date.split('-')[1])

    for (const entry of entries) {
      if (entry.debit === 0 && entry.credit === 0) continue

      // Get account ID
      const accountStmt = db.prepare('SELECT id FROM accounts WHERE code = ? AND tenant_id = ?')
      const account = accountStmt.get(entry.accountCode, tenantId) as { id: string } | undefined

      if (!account) {
        console.warn(`Account ${entry.accountCode} not found for tenant ${tenantId}`)
        continue
      }

      // Check if balance record exists
      const checkStmt = db.prepare(`
        SELECT id FROM account_balances 
        WHERE account_id = ? AND fiscal_year = ? AND period = ?
      `)
      const existing = checkStmt.get(account.id, year, month)

      if (existing) {
        // Update existing
        const updateStmt = db.prepare(`
          UPDATE account_balances 
          SET debit_amount = debit_amount + ?,
              credit_amount = credit_amount + ?,
              ending_balance = ending_balance + ? - ?
          WHERE account_id = ? AND fiscal_year = ? AND period = ?
        `)
        updateStmt.run(entry.debit, entry.credit, entry.debit, entry.credit, account.id, year, month)
      } else {
        // Create new
        const balanceId = generateId()
        const insertStmt = db.prepare(`
          INSERT INTO account_balances (id, tenant_id, account_id, fiscal_year, period, beginning_balance, debit_amount, credit_amount, ending_balance)
          VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
        `)
        insertStmt.run(balanceId, tenantId, account.id, year, month, entry.debit, entry.credit, entry.debit - entry.credit)
      }
    }
  }

  /**
   * Get daily sales summary
   */
  async getDailySalesSummary(tenantId: string, date?: string): Promise<DailySalesSummary> {
    const targetDate = date || now().split('T')[0]

    const stmt = db.prepare(`
      SELECT
        COUNT(*) as bill_count,
        SUM(subtotal) as total_subtotal,
        SUM(service_charge_amount) as total_service_charge,
        SUM(tax_amount) as total_tax,
        SUM(total_amount) as total_revenue,
        AVG(total_amount) as avg_bill_value
      FROM pos_running_bills
      WHERE tenant_id = ?
        AND status = 'PAID'
        AND DATE(closed_at) = ?
    `)

    const summary = stmt.get(tenantId, targetDate) as DailySalesSummary['summary']

    // Get payment method breakdown
    const paymentStmt = db.prepare(`
      SELECT 
        payment_method,
        COUNT(*) as count,
        SUM(amount) as total
      FROM pos_payments p
      JOIN pos_running_bills b ON p.bill_id = b.id
      WHERE b.tenant_id = ? 
        AND b.status = 'PAID'
        AND DATE(b.closed_at) = ?
      GROUP BY payment_method
    `)

    const paymentBreakdown = paymentStmt.all(tenantId, targetDate)

    return {
      date: targetDate,
      summary,
      paymentBreakdown
    }
  }
}

export default new POSAccountingService()
