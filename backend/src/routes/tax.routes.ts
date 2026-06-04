import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { randomUUID } from 'crypto'

const router = Router()
router.use(authenticate)

function generateId() {
  return randomUUID().replace(/-/g, '').substring(0, 25)
}

// Get Tax Dashboard
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { periodId } = req.query
    
    let currentPeriodId = periodId
    if (!currentPeriodId) {
      const currentPeriod = db.prepare(
        "SELECT id FROM tax_periods WHERE tenant_id = ? AND status = 'OPEN' ORDER BY year DESC, month DESC LIMIT 1"
      ).get(tenantId) as any
      currentPeriodId = currentPeriod?.id
    }
    
    if (!currentPeriodId) {
      return res.json({
        success: true,
        data: { vat: { output: 0, input: 0, net: 0 }, wht: { collected: 0, paid: 0 }, alerts: [] }
      })
    }
    
    const vatSummary = db.prepare(`
      SELECT 
        SUM(CASE WHEN transaction_type = 'VAT_OUTPUT' THEN tax_amount ELSE 0 END) as output_vat,
        SUM(CASE WHEN transaction_type = 'VAT_INPUT' AND is_deductible = 1 THEN tax_amount ELSE 0 END) as input_vat,
        SUM(CASE WHEN transaction_type = 'VAT_INPUT_UNDEDUCTIBLE' THEN tax_amount ELSE 0 END) as undeductible_vat
      FROM tax_transactions WHERE tenant_id = ? AND period_id = ?
    `).get(tenantId, currentPeriodId) as any
    
    res.json({
      success: true,
      data: {
        periodId: currentPeriodId,
        vat: {
          output: vatSummary?.output_vat || 0,
          input: vatSummary?.input_vat || 0,
          undeductible: vatSummary?.undeductible_vat || 0,
          net: (vatSummary?.output_vat || 0) - (vatSummary?.input_vat || 0)
        },
        alerts: []
      }
    })
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// Get Tax Periods
router.get('/periods', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const periods = db.prepare('SELECT * FROM tax_periods WHERE tenant_id = ? ORDER BY year DESC, month DESC').all(tenantId)
    res.json({ success: true, data: periods })
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// Get Tax Transactions
router.get('/transactions', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { type } = req.query
    
    let query = 'SELECT * FROM tax_transactions WHERE tenant_id = ?'
    const params: any[] = [tenantId]
    
    if (type) {
      query += ' AND transaction_type = ?'
      params.push(type)
    }
    
    query += ' ORDER BY document_date DESC LIMIT 100'
    
    const transactions = db.prepare(query).all(...params)
    res.json({ success: true, data: transactions })
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
})

export default router
