import { Router } from 'express'
import db from '../db/sqlite'
import posStockService from '../services/pos-stock.service'
import posAccountingService from '../services/pos-accounting.service'

const router = Router()

// Helper: Generate ID (24-char hex)
const generateId = () => {
  const chars = '0123456789abcdef'
  let id = ''
  for (let i = 0; i < 24; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

// Helper: Get current timestamp
const now = () => new Date().toISOString()

// Helper: Generate bill number (POS-2024-00001)
const generateBillNumber = (tenantId: string) => {
  const year = new Date().getFullYear()
  const prefix = `POS-${year}-`
  
  const stmt = db.prepare(`
    SELECT bill_number FROM pos_running_bills 
    WHERE tenant_id = ? AND bill_number LIKE ?
    ORDER BY bill_number DESC LIMIT 1
  `)
  const last = stmt.get(tenantId, `${prefix}%`) as { bill_number: string } | undefined
  
  let seq = 1
  if (last) {
    const match = last.bill_number.match(/-(\d+)$/)
    if (match) seq = parseInt(match[1]) + 1
  }
  
  return `${prefix}${String(seq).padStart(5, '0')}`
}

// ==================== BILLS ====================

// Get all bills
router.get('/bills', (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default'
    const { status } = req.query
    
    let query = `
      SELECT 
        b.*,
        COUNT(bi.id) as item_count,
        SUM(bi.quantity) as total_items
      FROM pos_running_bills b
      LEFT JOIN pos_bill_items bi ON b.id = bi.bill_id
      WHERE b.tenant_id = ?
    `
    const params: any[] = [tenantId]
    
    if (status) {
      query += ' AND b.status = ?'
      params.push(status)
    }
    
    query += ' GROUP BY b.id ORDER BY b.opened_at DESC'
    
    const stmt = db.prepare(query)
    const bills = stmt.all(...params)
    
    res.json({ success: true, data: bills })
  } catch (error) {
    console.error('Error fetching bills:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch bills' })
  }
})

// Get open bills only
router.get('/bills/open', (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default'
    
    const stmt = db.prepare(`
      SELECT 
        b.*,
        COUNT(bi.id) as item_count,
        SUM(bi.quantity) as total_items
      FROM pos_running_bills b
      LEFT JOIN pos_bill_items bi ON b.id = bi.bill_id
      WHERE b.tenant_id = ? AND b.status = 'OPEN'
      GROUP BY b.id
      ORDER BY b.opened_at DESC
    `)
    
    const bills = stmt.all(tenantId)
    res.json({ success: true, data: bills })
  } catch (error) {
    console.error('Error fetching open bills:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch open bills' })
  }
})

// Get single bill with items
router.get('/bills/:id', (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default'
    const { id } = req.params
    
    // Get bill
    const billStmt = db.prepare(`
      SELECT * FROM pos_running_bills 
      WHERE id = ? AND tenant_id = ?
    `)
    const bill = billStmt.get(id, tenantId)
    
    if (!bill) {
      return res.status(404).json({ success: false, message: 'Bill not found' })
    }
    
    // Get items
    const itemsStmt = db.prepare(`
      SELECT 
        bi.*,
        pmc.pos_price as current_price
      FROM pos_bill_items bi
      LEFT JOIN pos_menu_configs pmc ON bi.pos_menu_id = pmc.id
      WHERE bi.bill_id = ?
      ORDER BY bi.added_at ASC
    `)
    const items = itemsStmt.all(id)
    
    res.json({ success: true, data: { ...bill, items } })
  } catch (error) {
    console.error('Error fetching bill:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch bill' })
  }
})

// Create new bill
router.post('/bills', (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default'
    const userId = (req as any).user?.id || 'system'
    const { display_name, customer_name, customer_phone, notes } = req.body
    
    const id = generateId()
    const billNumber = generateBillNumber(tenantId)
    const defaultDisplayName = display_name || `บิล ${billNumber.split('-')[2]}`
    
    const stmt = db.prepare(`
      INSERT INTO pos_running_bills (
        id, tenant_id, bill_number, display_name, customer_name, customer_phone,
        status, opened_at, notes, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)
    `)
    
    stmt.run(
      id, tenantId, billNumber, defaultDisplayName, 
      customer_name || null, customer_phone || null,
      now(), notes || null, userId
    )
    
    res.json({ 
      success: true, 
      message: 'Bill created successfully',
      data: { 
        id, 
        bill_number: billNumber,
        display_name: defaultDisplayName
      }
    })
  } catch (error) {
    console.error('Error creating bill:', error)
    res.status(500).json({ success: false, message: 'Failed to create bill' })
  }
})

// Update bill (display_name, customer, notes)
router.put('/bills/:id', (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default'
    const { id } = req.params
    const { display_name, customer_name, customer_phone, notes } = req.body
    
    const stmt = db.prepare(`
      UPDATE pos_running_bills 
      SET display_name = ?, customer_name = ?, customer_phone = ?, notes = ?
      WHERE id = ? AND tenant_id = ? AND status = 'OPEN'
    `)
    
    const result = stmt.run(
      display_name, customer_name || null, customer_phone || null, notes || null,
      id, tenantId
    )
    
    if (result.changes === 0) {
      return res.status(400).json({ success: false, message: 'Bill not found or already closed' })
    }
    
    res.json({ success: true, message: 'Bill updated successfully' })
  } catch (error) {
    console.error('Error updating bill:', error)
    res.status(500).json({ success: false, message: 'Failed to update bill' })
  }
})

// Delete bill (only if OPEN and no items)
router.delete('/bills/:id', (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default'
    const { id } = req.params
    
    // Check if bill has items
    const checkStmt = db.prepare('SELECT COUNT(*) as count FROM pos_bill_items WHERE bill_id = ?')
    const check = checkStmt.get(id) as { count: number }
    
    if (check.count > 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot delete bill with items. Please cancel instead.' 
      })
    }
    
    const stmt = db.prepare(`
      DELETE FROM pos_running_bills 
      WHERE id = ? AND tenant_id = ? AND status = 'OPEN'
    `)
    
    const result = stmt.run(id, tenantId)
    
    if (result.changes === 0) {
      return res.status(400).json({ success: false, message: 'Bill not found or already closed' })
    }
    
    res.json({ success: true, message: 'Bill deleted successfully' })
  } catch (error) {
    console.error('Error deleting bill:', error)
    res.status(500).json({ success: false, message: 'Failed to delete bill' })
  }
})

// ==================== BILL ITEMS ====================

// Add item to bill
router.post('/bills/:id/items', (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default'
    const userId = (req as any).user?.id || 'system'
    const { id } = req.params
    const { pos_menu_id, quantity, special_instructions } = req.body
    
    if (!pos_menu_id || !quantity) {
      return res.status(400).json({ success: false, message: 'Menu ID and quantity required' })
    }
    
    // Get menu details
    const menuStmt = db.prepare('SELECT * FROM pos_menu_configs WHERE id = ? AND tenant_id = ?')
    const menu = menuStmt.get(pos_menu_id, tenantId)
    
    if (!menu) {
      return res.status(404).json({ success: false, message: 'Menu not found' })
    }
    
    const itemId = generateId()
    const totalPrice = (menu as any).pos_price * quantity
    
    const stmt = db.prepare(`
      INSERT INTO pos_bill_items (
        id, tenant_id, bill_id, pos_menu_id, product_name,
        quantity, unit_price, total_price, special_instructions, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    
    stmt.run(
      itemId, tenantId, id, pos_menu_id, (menu as any).product_name || 'Unknown',
      quantity, (menu as any).pos_price, totalPrice, special_instructions || null, userId
    )
    
    // Recalculate bill totals
    recalculateBillTotals(id)
    
    res.json({ 
      success: true, 
      message: 'Item added successfully',
      data: { id: itemId }
    })
  } catch (error) {
    console.error('Error adding item:', error)
    res.status(500).json({ success: false, message: 'Failed to add item' })
  }
})

// Update bill item (quantity, instructions)
router.put('/bills/:billId/items/:itemId', (req, res) => {
  try {
    const { billId, itemId } = req.params
    const { quantity, special_instructions } = req.body
    
    // Get current item
    const itemStmt = db.prepare('SELECT * FROM pos_bill_items WHERE id = ? AND bill_id = ?')
    const item = itemStmt.get(itemId, billId)
    
    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found' })
    }
    
    const newQty = quantity || (item as any).quantity
    const unitPrice = (item as any).unit_price
    const newTotal = newQty * unitPrice
    
    const stmt = db.prepare(`
      UPDATE pos_bill_items 
      SET quantity = ?, total_price = ?, special_instructions = ?
      WHERE id = ? AND bill_id = ?
    `)
    
    stmt.run(newQty, newTotal, special_instructions || null, itemId, billId)
    
    // Recalculate bill totals
    recalculateBillTotals(billId)
    
    res.json({ success: true, message: 'Item updated successfully' })
  } catch (error) {
    console.error('Error updating item:', error)
    res.status(500).json({ success: false, message: 'Failed to update item' })
  }
})

// Delete bill item
router.delete('/bills/:billId/items/:itemId', (req, res) => {
  try {
    const { billId, itemId } = req.params
    
    const stmt = db.prepare('DELETE FROM pos_bill_items WHERE id = ? AND bill_id = ?')
    const result = stmt.run(itemId, billId)
    
    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Item not found' })
    }
    
    // Recalculate bill totals
    recalculateBillTotals(billId)
    
    res.json({ success: true, message: 'Item removed successfully' })
  } catch (error) {
    console.error('Error deleting item:', error)
    res.status(500).json({ success: false, message: 'Failed to delete item' })
  }
})

// ==================== PAYMENT & STOCK ====================

// Process payment (deduct stock + record payment + accounting)
router.post('/bills/:id/pay', async (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default'
    const userId = (req as any).user?.id || 'system'
    const { id } = req.params
    const { payment_method, received_amount, reference } = req.body
    
    if (!payment_method) {
      return res.status(400).json({ success: false, message: 'Payment method required' })
    }
    
    // Get bill with items
    const billStmt = db.prepare(`
      SELECT b.*, COUNT(bi.id) as item_count
      FROM pos_running_bills b
      LEFT JOIN pos_bill_items bi ON b.id = bi.bill_id
      WHERE b.id = ? AND b.tenant_id = ? AND b.status = 'OPEN'
      GROUP BY b.id
    `)
    const bill = billStmt.get(id, tenantId)
    
    if (!bill) {
      return res.status(404).json({ success: false, message: 'Bill not found or already paid' })
    }
    
    if ((bill as any).item_count === 0) {
      return res.status(400).json({ success: false, message: 'Cannot pay empty bill' })
    }
    
    // 1. Deduct stock using service
    const stockResult = await posStockService.deductStockOnPayment(id, tenantId, userId)
    
    if (!stockResult.success) {
      return res.status(400).json({ 
        success: false, 
        message: 'Stock deduction failed',
        errors: stockResult.errors 
      })
    }
    
    // 2. Record payment
    const paymentId = generateId()
    const totalAmount = (bill as any).total_amount
    const changeAmount = received_amount ? received_amount - totalAmount : 0
    
    const paymentStmt = db.prepare(`
      INSERT INTO pos_payments (id, tenant_id, bill_id, payment_method, amount, received_amount, change_amount, reference, received_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    paymentStmt.run(
      paymentId, tenantId, id, payment_method, totalAmount,
      received_amount || totalAmount, changeAmount > 0 ? changeAmount : 0,
      reference || null, userId
    )
    
    // 3. Update bill status
    const updateBill = db.prepare(`
      UPDATE pos_running_bills 
      SET status = 'PAID', closed_at = ?, closed_by = ?
      WHERE id = ?
    `)
    updateBill.run(now(), userId, id)
    
    // 4. Record accounting entry
    const payment = { payment_method, amount: totalAmount }
    const accountingResult = await posAccountingService.recordSale(
      bill as any, payment, tenantId, userId
    )
    
    res.json({ 
      success: true, 
      message: 'Payment processed successfully',
      data: {
        payment_id: paymentId,
        amount: totalAmount,
        change: changeAmount > 0 ? changeAmount : 0,
        stock_deductions: stockResult.deductions.length,
        journal_entry_id: accountingResult.journalEntryId
      }
    })
  } catch (error) {
    console.error('Error processing payment:', error)
    res.status(500).json({ success: false, message: 'Failed to process payment' })
  }
})

// Cancel bill (return stock + record accounting)
router.post('/bills/:id/cancel', async (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default'
    const userId = (req as any).user?.id || 'system'
    const { id } = req.params
    const { reason } = req.body
    
    // Get bill
    const billStmt = db.prepare('SELECT * FROM pos_running_bills WHERE id = ? AND tenant_id = ?')
    const bill = billStmt.get(id, tenantId)
    
    if (!bill) {
      return res.status(404).json({ success: false, message: 'Bill not found' })
    }
    
    if ((bill as any).status === 'CANCELLED') {
      return res.status(400).json({ success: false, message: 'Bill already cancelled' })
    }
    
    // 1. Return stock using service
    const stockResult = await posStockService.returnStockOnCancel(id, tenantId, userId, reason)
    
    if (!stockResult.success) {
      console.warn('Stock return warnings:', stockResult.errors)
    }
    
    // 2. Record accounting reversal
    const accountingResult = await posAccountingService.recordCancelledSale(
      bill as any, tenantId, userId, reason
    )
    
    // 3. Update bill status
    const updateBill = db.prepare(`
      UPDATE pos_running_bills 
      SET status = 'CANCELLED', closed_at = ?, closed_by = ?, notes = COALESCE(?, notes) || ' [CANCELLED: ' || ? || ']'
      WHERE id = ?
    `)
    updateBill.run(now(), userId, (bill as any).notes, reason || 'No reason', id)
    
    res.json({ 
      success: true, 
      message: 'Bill cancelled successfully',
      data: {
        stock_returns: stockResult.returns.length,
        journal_entry_id: accountingResult.journalEntryId
      }
    })
  } catch (error) {
    console.error('Error cancelling bill:', error)
    res.status(500).json({ success: false, message: 'Failed to cancel bill' })
  }
})

// ==================== STOCK CHECK & REPORTS ====================

// Check stock availability for menu item
router.get('/menu-configs/:id/stock', async (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default'
    const { id } = req.params
    const { quantity } = req.query
    const qty = parseInt(quantity as string) || 1

    const result = await posStockService.checkStockAvailability(id, qty, tenantId)
    res.json({ success: true, data: result })
  } catch (error: any) {
    console.error('Error checking stock:', error)
    res.status(500).json({ success: false, message: error.message || 'Failed to check stock' })
  }
})

// Get low stock menus
router.get('/stock/low-stock', async (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default'
    const items = await posStockService.getLowStockMenus(tenantId)
    res.json({ success: true, data: items })
  } catch (error) {
    console.error('Error fetching low stock:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch low stock' })
  }
})

// Get menu stock level (how many can be made)
router.get('/menu-configs/:id/stock-level', async (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default'
    const { id } = req.params
    const maxCanMake = await posStockService.getMenuStockLevel(id, tenantId)
    res.json({ success: true, data: { menu_id: id, max_can_make: maxCanMake } })
  } catch (error) {
    console.error('Error getting stock level:', error)
    res.status(500).json({ success: false, message: 'Failed to get stock level' })
  }
})

// Get daily sales report
router.get('/reports/daily-sales', async (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default'
    const { date } = req.query
    const report = await posAccountingService.getDailySalesSummary(tenantId, date as string)
    res.json({ success: true, data: report })
  } catch (error) {
    console.error('Error getting daily sales:', error)
    res.status(500).json({ success: false, message: 'Failed to get daily sales' })
  }
})

// ==================== HELPERS ====================

function recalculateBillTotals(billId: string) {
  // Get all items
  const itemsStmt = db.prepare('SELECT * FROM pos_bill_items WHERE bill_id = ?')
  const items = itemsStmt.all(billId)
  
  const subtotal = (items as any[]).reduce((sum, item) => sum + item.total_price, 0)
  const serviceChargeRate = 0.10 // 10%
  const taxRate = 0.07 // 7%
  
  const serviceChargeAmount = subtotal * serviceChargeRate
  const taxAmount = (subtotal + serviceChargeAmount) * taxRate
  const totalAmount = subtotal + serviceChargeAmount + taxAmount
  
  const updateStmt = db.prepare(`
    UPDATE pos_running_bills 
    SET subtotal = ?, service_charge_amount = ?, tax_amount = ?, total_amount = ?
    WHERE id = ?
  `)
  updateStmt.run(subtotal, serviceChargeAmount, taxAmount, totalAmount, billId)
}

export default router
