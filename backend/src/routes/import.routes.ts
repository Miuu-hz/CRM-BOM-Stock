import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { randomUUID } from 'crypto'

const router = Router()
const MAX_IMPORT_ROWS = 5_000

// ── Zod schemas ───────────────────────────────────────────────────────────────
// Unknown keys are stripped by default (Zod's strip mode).
// z.coerce.number() handles Excel-exported numeric strings ("100" → 100).
// Max lengths prevent oversized strings from reaching the DB.
const CustomerRowSchema = z.object({
  name:         z.string().min(1, 'Name is required').max(255),
  code:         z.string().max(50).optional(),
  type:         z.string().max(50).optional(),
  contact_name: z.string().max(255).optional(),
  email:        z.string().max(255).optional(),
  phone:        z.string().max(50).optional(),
  address:      z.string().max(500).optional(),
  city:         z.string().max(100).optional(),
  credit_limit: z.coerce.number().min(0).optional(),
})

const StockRowSchema = z.object({
  name:      z.string().min(1, 'Name is required').max(255),
  sku:       z.string().max(100).optional(),
  category:  z.string().max(100).optional(),
  quantity:  z.coerce.number().int().min(0).optional(),
  unit:      z.string().max(50).optional(),
  min_stock: z.coerce.number().int().min(0).optional(),
  max_stock: z.coerce.number().int().min(0).optional(),
  location:  z.string().max(100).optional(),
  status:    z.string().max(50).optional(),
})

type CustomerRow = z.infer<typeof CustomerRowSchema>
type StockRow    = z.infer<typeof StockRowSchema>
// ─────────────────────────────────────────────────────────────────────────────

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

    if (data.length > MAX_IMPORT_ROWS) {
      return res.status(400).json({
        success: false,
        message: `Too many rows. Maximum allowed is ${MAX_IMPORT_ROWS}.`
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
      const parsed = CustomerRowSchema.safeParse(data[i])
      if (!parsed.success) {
        results.failed++
        results.errors.push(`Row ${i + 1}: ${parsed.error.issues.map(e => e.message).join(', ')}`)
        continue
      }
      const row: CustomerRow = parsed.data

      try {
        const code = row.code || generateCustomerCode(existingCount + i)

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
        console.error(`Import customers row ${i + 1} error:`, error)
        results.failed++
        results.errors.push(`Row ${i + 1}: Failed to save record`)
      }
    }

    res.json({
      success: true,
      message: `Imported ${results.success} customers, ${results.failed} failed`,
      data: results
    })
  } catch (error: any) {
    console.error('Import customers error:', error)
    res.status(500).json({ success: false, message: 'Failed to import customers' })
  }
})

// ============================================
// IMPORT STOCK ITEMS - นำเข้าสินค้าจาก Excel/CSV
// ============================================
router.post('/stock', async (req: Request, res: Response) => {
  console.log('=== IMPORT STOCK API CALLED ===')
  
  try {
    const tenantId = req.user!.tenantId
    const { data } = req.body

    console.log('TenantId:', tenantId)
    console.log('Data received:', data?.length, 'rows')

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No data provided'
      })
    }

    if (data.length > MAX_IMPORT_ROWS) {
      return res.status(400).json({
        success: false,
        message: `Too many rows. Maximum allowed is ${MAX_IMPORT_ROWS}.`
      })
    }

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[]
    }

    // Get existing SKUs for duplicate check
    const existingSkus = new Set(
      (db.prepare('SELECT sku FROM stock_items WHERE tenant_id = ?').all(tenantId) as any[])
        .map(r => r.sku)
    )

    const existingCount = (db.prepare('SELECT COUNT(*) as count FROM stock_items WHERE tenant_id = ?').get(tenantId) as any).count

    const insertStock = db.prepare(`
      INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, min_stock, max_stock, location, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const now = new Date().toISOString()
    
    // Validate all rows with Zod first, collect pre-validated data
    const validatedRows: { index: number; row: StockRow }[] = []
    for (let i = 0; i < data.length; i++) {
      const parsed = StockRowSchema.safeParse(data[i])
      if (!parsed.success) {
        results.failed++
        results.errors.push(`Row ${i + 1}: ${parsed.error.issues.map(e => e.message).join(', ')}`)
      } else {
        validatedRows.push({ index: i, row: parsed.data })
      }
    }

    // Use transaction for batch insert of validated rows only
    const insertMany = db.transaction((items: typeof validatedRows) => {
      for (const { index: i, row } of items) {
        try {
          const category = row.category || 'GENERAL'
          let sku = row.sku

          if (!sku || existingSkus.has(sku)) {
            sku = generateSKU(category, existingCount + i)
          }

          if (existingSkus.has(sku)) {
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

          existingSkus.add(sku)
          results.success++
        } catch (error: any) {
          console.error(`Import stock row ${i + 1} error:`, error)
          results.failed++
          results.errors.push(`Row ${i + 1}: Failed to save record`)
        }
      }
    })

    insertMany(validatedRows)

    res.json({
      success: true,
      message: `Imported ${results.success} stock items, ${results.failed} failed`,
      data: results
    })
  } catch (error: any) {
    console.error('Import stock error:', error)
    res.status(500).json({ success: false, message: 'Failed to import stock items' })
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

    // Build duplicate SKU set within the file itself
    const fileSkus = new Set<string>()

    for (let i = 0; i < data.length; i++) {
      const row = data[i]
      const rowErrors = []

      if (type === 'customers') {
        if (!row.name && !row.code) rowErrors.push('Name or Code is required')
        // Allow empty email/phone - will be filled with default values
      } else if (type === 'stock') {
        if (!row.name) rowErrors.push('Name is required')
        if (!row.unit) rowErrors.push('Unit is required')
        // Check for duplicate SKU within the file
        if (row.sku) {
          if (fileSkus.has(row.sku)) rowErrors.push(`SKU "${row.sku}" ซ้ำในไฟล์`)
          else fileSkus.add(row.sku)
        }
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
    res.status(500).json({ success: false, message: 'Validation failed' })
  }
})

export default router
