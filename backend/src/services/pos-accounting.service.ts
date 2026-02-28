import db from '../db/sqlite'

// Helper: Generate ID (24-char hex)
const generateId = () => {
  const chars = '0123456789abcdef'
  let id = ''
  for (let i = 0; i < 24; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

const now = () => new Date().toISOString()

class POSAccountingService {
  /**
   * Generate journal entry number
   */
  private generateEntryNumber(tenantId: string): string {
    const year = new Date().getFullYear()
    const prefix = `JV-${year}-`
    
    const stmt = db.prepare(`
      SELECT entry_number FROM journal_entries 
      WHERE tenant_id = ? AND entry_number LIKE ?
      ORDER BY entry_number DESC LIMIT 1
    `)
    const last = stmt.get(tenantId, `${prefix}%`) as { entry_number: string } | undefined
    
    let seq = 1
    if (last) {
      const match = last.entry_number.match(/-(\d+)$/)
      if (match) seq = parseInt(match[1]) + 1
    }
    
    return `${prefix}${String(seq).padStart(6, '0')}`
  }

  /**
   * Record sale transaction (Journal Entry + VAT)
   */
  async recordSale(
    bill: {
      id: string
      bill_number: string
      display_name: string
      customer_name?: string
      subtotal: number
      service_charge_amount: number
      tax_amount: number
      total_amount: number
    },
    payment: {
      payment_method: string
      amount: number
    },
    tenantId: string,
    userId: string
  ): Promise<{ success: boolean; journalEntryId?: string; errors: string[] }> {
    const errors: string[] = []

    try {
      // 1. Create Journal Entry
      const entryNumber = this.generateEntryNumber(tenantId)
      const entryId = generateId()
      const today = now().split('T')[0]

      const totalRevenue = bill.subtotal + bill.service_charge_amount

      // Insert journal entry header
      const entryStmt = db.prepare(`
        INSERT INTO journal_entries (
          id, tenant_id, entry_number, date, reference_type, reference_id,
          description, total_debit, total_credit, is_auto_generated, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
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

      // Helper to get or create account
      const getAccountId = (code: string, name: string, type: string, category: string) => {
        const stmt = db.prepare('SELECT id FROM accounts WHERE code = ? AND tenant_id = ?')
        let account = stmt.get(code, tenantId) as any
        
        if (!account) {
          // Create default account if not exists
          const newId = generateId()
          const createStmt = db.prepare(`
            INSERT INTO accounts (id, tenant_id, code, name, type, category, normal_balance, is_active, is_system)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)
          `)
          createStmt.run(newId, tenantId, code, name, type, category, type === 'ASSET' ? 'DEBIT' : 'CREDIT')
          return newId
        }
        return account.id
      }

      // Insert journal lines
      // Line 1: Debit Cash/Bank
      const line1Id = generateId()
      const cashAccountCode = payment.payment_method === 'CASH' ? '1101' : '1102'
      const cashAccountName = payment.payment_method === 'CASH' ? 'เงินสด' : 'เงินฝากธนาคาร'
      const cashAccountId = getAccountId(cashAccountCode, cashAccountName, 'ASSET', 'CURRENT_ASSET')

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
      const revenueAccountId = getAccountId('4100', 'รายได้จากการขาย', 'REVENUE', 'OPERATING_REVENUE')
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
        const vatAccountId = getAccountId('2150', 'ภาษีขาย', 'LIABILITY', 'CURRENT_LIABILITY')
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

      // 2. Record VAT Entry
      const vatId = generateId()
      const vatStmt = db.prepare(`
        INSERT INTO vat_entries (
          id, tenant_id, document_type, document_id, document_number, document_date,
          party_name, party_tax_id, base_amount, vat_rate, vat_amount, total_amount,
          is_output_vat, journal_entry_id, created_at
        ) VALUES (?, ?, 'SALES', ?, ?, ?, ?, ?, ?, 7, ?, ?, 1, ?, ?)
      `)

      vatStmt.run(
        vatId,
        tenantId,
        bill.id,
        bill.bill_number,
        today,
        bill.customer_name || 'ลูกค้าทั่วไป',
        null, // party_tax_id
        totalRevenue,
        bill.tax_amount,
        bill.total_amount,
        entryId,
        now()
      )

      // 3. Update Account Balances (optional - can be done via batch job)
      await this.updateAccountBalances(tenantId, today, [
        { accountCode: cashAccountCode, debit: bill.total_amount, credit: 0 },
        { accountCode: '4100', debit: 0, credit: totalRevenue },
        { accountCode: '2150', debit: 0, credit: bill.tax_amount }
      ])

      return {
        success: true,
        journalEntryId: entryId,
        errors: []
      }
    } catch (error: any) {
      return {
        success: false,
        errors: [error.message || 'Failed to record sale transaction']
      }
    }
  }

  /**
   * Record cancelled sale (reverse journal entry)
   */
  async recordCancelledSale(
    bill: {
      id: string
      bill_number: string
      display_name: string
      total_amount: number
    },
    tenantId: string,
    userId: string,
    reason?: string
  ): Promise<{ success: boolean; journalEntryId?: string; errors: string[] }> {
    const errors: string[] = []

    try {
      const entryNumber = this.generateEntryNumber(tenantId)
      const entryId = generateId()
      const today = now().split('T')[0]

      // Insert reversal journal entry
      const entryStmt = db.prepare(`
        INSERT INTO journal_entries (
          id, tenant_id, entry_number, date, reference_type, reference_id,
          description, total_debit, total_credit, is_auto_generated, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `)

      entryStmt.run(
        entryId,
        tenantId,
        entryNumber,
        today,
        'POS_CANCEL',
        bill.id,
        `ยกเลิกบิล - ${bill.bill_number} (${bill.display_name})${reason ? ': ' + reason : ''}`,
        bill.total_amount,
        bill.total_amount,
        userId,
        now()
      )

      // Helper to get or create account
      const getAccountId = (code: string, name: string, type: string, category: string) => {
        const stmt = db.prepare('SELECT id FROM accounts WHERE code = ? AND tenant_id = ?')
        let account = stmt.get(code, tenantId) as any
        
        if (!account) {
          const newId = generateId()
          const createStmt = db.prepare(`
            INSERT INTO accounts (id, tenant_id, code, name, type, category, normal_balance, is_active, is_system)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)
          `)
          createStmt.run(newId, tenantId, code, name, type, category, type === 'ASSET' ? 'DEBIT' : 'CREDIT')
          return newId
        }
        return account.id
      }

      // Reverse entries (opposite of sale)
      // Line 1: Credit Cash/Bank (reverse of debit)
      const line1Id = generateId()
      const cashAccountId = getAccountId('1101', 'เงินสด', 'ASSET', 'CURRENT_ASSET')
      const lineStmt = db.prepare(`
        INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
        VALUES (?, ?, ?, ?, 1, ?, 0, ?)
      `)

      lineStmt.run(
        line1Id,
        tenantId,
        entryId,
        cashAccountId,
        `คืนเงินยกเลิกบิล ${bill.bill_number}`,
        bill.total_amount
      )

      // Line 2: Debit Sales Returns
      const line2Id = generateId()
      const salesReturnAccountId = getAccountId('4200', 'รายได้คืน', 'REVENUE', 'OPERATING_REVENUE')
      const line2Stmt = db.prepare(`
        INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
        VALUES (?, ?, ?, ?, 2, ?, ?, 0)
      `)

      line2Stmt.run(
        line2Id,
        tenantId,
        entryId,
        salesReturnAccountId,
        `รายได้คืนจากการยกเลิก ${bill.bill_number}`,
        bill.total_amount
      )

      return {
        success: true,
        journalEntryId: entryId,
        errors: []
      }
    } catch (error: any) {
      return {
        success: false,
        errors: [error.message || 'Failed to record cancellation']
      }
    }
  }

  /**
   * Update account balances (simplified)
   */
  private async updateAccountBalances(
    tenantId: string,
    date: string,
    entries: { accountCode: string; debit: number; credit: number }[]
  ): Promise<void> {
    const year = parseInt(date.split('-')[0])
    const month = parseInt(date.split('-')[1])

    for (const entry of entries) {
      if (entry.debit === 0 && entry.credit === 0) continue

      // Get account ID
      const accountStmt = db.prepare('SELECT id FROM accounts WHERE code = ? AND tenant_id = ?')
      const account = accountStmt.get(entry.accountCode, tenantId) as any

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
  async getDailySalesSummary(tenantId: string, date?: string): Promise<any> {
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

    const summary = stmt.get(tenantId, targetDate) as any

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
