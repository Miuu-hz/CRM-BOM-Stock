import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { randomUUID } from 'crypto'

const router = Router()

router.use(authenticate)

function generateId() {
  return randomUUID().replace(/-/g, '').substring(0, 25)
}

// Generate customer code
function generateCustomerCode(index: number): string {
  return `C${String(index + 1).padStart(4, '0')}`
}

// Generate SKU
function generateSKU(category: string, index: number): string {
  const prefix = category.substring(0, 2).toUpperCase()
  return `${prefix}-${String(index + 1).padStart(4, '0')}`
}

// ============================================
// IMPORT CUSTOMERS - นำเข้าลูกค้าจาก Excel/CSV
// ============================================
router.post('/customers', async (req: Request, res: Response) => {
  console.log('=== IMPORT CUSTOMERS API CALLED ===')
  console.log('req.user:', req.user)
  console.log('data length:', req.body?.data?.length)
  
  try {
    const tenantId = req.user?.tenantId
    if (!tenantId) {
      console.log('ERROR: No tenantId in req.user')
      return res.status(401).json({ success: false, message: 'Unauthorized - no tenant' })
    }
    const { data } = req.body

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No data provided'
      })
    }

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[]
    }

    // Get existing customer count for code generation
    const existingCount = (db.prepare('SELECT COUNT(*) as count FROM customers WHERE tenant_id = ?').get(tenantId) as any).count

    const insertCustomer = db.prepare(`
      INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, address, city, credit_limit, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const now = new Date().toISOString()

    console.log(`Processing ${data.length} rows, tenantId: ${tenantId}`)
    
    for (let i = 0; i < data.length; i++) {
      const row = data[i]
      
      // Log first row for debugging
      if (i === 0) {
        console.log('First row sample:', JSON.stringify(row))
      }
      
      try {
        // Validate required fields
        if (!row.name) {
          results.failed++
          results.errors.push(`Row ${i + 1}: Name is required`)
          continue
        }

        // Generate unique code
        const code = row.code || generateCustomerCode(existingCount + i)
        
        // Check for duplicate code
        const existing = db.prepare('SELECT id FROM customers WHERE code = ? AND tenant_id = ?').get(code, tenantId)
        if (existing) {
          results.failed++
          results.errors.push(`Row ${i + 1}: Customer code ${code} already exists`)
          continue
        }

        insertCustomer.run(
          generateId(),
          tenantId,
          code,
          row.name,
          row.type || 'RETAIL',
          row.contact_name || row.name,
          row.email || '-',
          row.phone || '-',
          row.address || null,
          row.city || '-',
          row.credit_limit || 0,
          'ACTIVE',
          now,
          now
        )

        results.success++
      } catch (error: any) {
        results.failed++
        results.errors.push(`Row ${i + 1}: ${error.message}`)
      }
    }

    res.json({
      success: true,
      message: `Imported ${results.success} customers, ${results.failed} failed`,
      data: results
    })
  } catch (error: any) {
    console.error('Import customers error:', error)
    res.status(500).json({ success: false, message: error.message || 'Failed to import customers' })
  }
})

// ============================================
// IMPORT STOCK ITEMS - นำเข้าสินค้าจาก Excel/CSV
// ============================================
router.post('/stock', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { data } = req.body

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No data provided'
      })
    }

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[]
    }

    // Get existing stock count for SKU generation
    const existingCount = (db.prepare('SELECT COUNT(*) as count FROM stock_items WHERE tenant_id = ?').get(tenantId) as any).count

    const insertStock = db.prepare(`
      INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, min_stock, max_stock, location, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const now = new Date().toISOString()

    for (let i = 0; i < data.length; i++) {
      const row = data[i]
      
      try {
        // Validate required fields
        if (!row.name) {
          results.failed++
          results.errors.push(`Row ${i + 1}: Name is required`)
          continue
        }

        const category = row.category || 'GENERAL'
        const sku = row.sku || generateSKU(category, existingCount + i)
        
        // Check for duplicate SKU
        const existing = db.prepare('SELECT id FROM stock_items WHERE sku = ? AND tenant_id = ?').get(sku, tenantId)
        if (existing) {
          results.failed++
          results.errors.push(`Row ${i + 1}: SKU ${sku} already exists`)
          continue
        }

        insertStock.run(
          generateId(),
          tenantId,
          sku,
          row.name,
          category,
          row.quantity || 0,
          row.unit || 'PCS',
          row.min_stock || 0,
          row.max_stock || 1000,
          row.location || 'MAIN',
          row.status || 'ACTIVE',
          now,
          now
        )

        results.success++
      } catch (error: any) {
        results.failed++
        results.errors.push(`Row ${i + 1}: ${error.message}`)
      }
    }

    res.json({
      success: true,
      message: `Imported ${results.success} stock items, ${results.failed} failed`,
      data: results
    })
  } catch (error: any) {
    console.error('Import stock error:', error)
    res.status(500).json({ success: false, message: error.message || 'Failed to import stock items' })
  }
})

// ============================================
// VALIDATE IMPORT DATA - ตรวจสอบข้อมูลก่อน import
// ============================================
router.post('/validate', async (req: Request, res: Response) => {
  try {
    const { type, data } = req.body

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No data provided'
      })
    }

    const validation = {
      total: data.length,
      valid: 0,
      invalid: 0,
      errors: [] as string[]
    }

    for (let i = 0; i < data.length; i++) {
      const row = data[i]
      const rowErrors = []

      if (type === 'customers') {
        if (!row.name && !row.code) rowErrors.push('Name or Code is required')
        // Allow empty email/phone - will be filled with default values
      } else if (type === 'stock') {
        if (!row.name) rowErrors.push('Name is required')
        if (!row.unit) rowErrors.push('Unit is required')
      }

      if (rowErrors.length > 0) {
        validation.invalid++
        validation.errors.push(`Row ${i + 1}: ${rowErrors.join(', ')}`)
      } else {
        validation.valid++
      }
    }

    res.json({
      success: true,
      data: validation
    })
  } catch (error: any) {
    console.error('Validation error:', error)
    res.status(500).json({ success: false, message: error.message || 'Validation failed' })
  }
})

export default router
