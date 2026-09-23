import db from '../db/sqlite'
import { randomBytes } from 'crypto'

// ⚠️ ทุกฟังก์ชันในไฟล์นี้รับ tenantId เป็นพารามิเตอร์แรกและกรองด้วยเสมอ
// เดิมไม่มีคำว่า tenant อยู่ในไฟล์นี้เลย ทั้งที่ทั้ง 3 ตารางมีคอลัมน์ tenant_id
// (ซึ่งเป็น nullable) — ร้านของทุก tenant จึงถูกเขียนเป็น NULL แล้วเห็นกันหมด
// ห้ามเพิ่มคิวรีใหม่ในไฟล์นี้โดยไม่มี tenant_id ในเงื่อนไข

// Generate unique ID
const generateId = () => randomBytes(16).toString('hex')

// Helper function to convert snake_case to camelCase
const snakeToCamel = (obj: any): any => {
  if (!obj || typeof obj !== 'object') return obj

  if (Array.isArray(obj)) {
    return obj.map(snakeToCamel)
  }

  const result: any = {}
  for (const key in obj) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
    result[camelKey] = obj[key]
  }
  return result
}

// ==================== SHOPS ====================

export const getAllShops = (tenantId: string, platform?: string, isActive?: boolean) => {
  let query = 'SELECT * FROM shops WHERE tenant_id = ?'
  const params: any[] = [tenantId]

  if (platform) {
    query += ' AND platform = ?'
    params.push(platform)
  }

  if (isActive !== undefined) {
    query += ' AND is_active = ?'
    params.push(isActive ? 1 : 0)
  }

  const results = db.prepare(query).all(...params)
  return snakeToCamel(results)
}

export const getShopById = (tenantId: string, id: string) => {
  const result = db.prepare('SELECT * FROM shops WHERE id = ? AND tenant_id = ?').get(id, tenantId)
  return snakeToCamel(result)
}

export const createShop = (tenantId: string, data: {
  name: string
  platform: string
  shopId: string
}) => {
  const id = generateId()
  const stmt = db.prepare(`
    INSERT INTO shops (id, tenant_id, name, platform, shop_id, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
  `)

  stmt.run(id, tenantId, data.name, data.platform, data.shopId)
  return getShopById(tenantId, id) // Already converted by getShopById
}

export const updateShop = (tenantId: string, id: string, data: { name?: string; isActive?: boolean }) => {
  const updates: string[] = []
  const params: any[] = []

  if (data.name !== undefined) {
    updates.push('name = ?')
    params.push(data.name)
  }

  if (data.isActive !== undefined) {
    updates.push('is_active = ?')
    params.push(data.isActive ? 1 : 0)
  }

  if (updates.length === 0) return getShopById(tenantId, id)

  updates.push("updated_at = datetime('now')")
  params.push(id, tenantId)

  const stmt = db.prepare(`
    UPDATE shops SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?
  `)

  stmt.run(...params)
  return getShopById(tenantId, id) // Already converted by getShopById
}

export const deleteShop = (tenantId: string, id: string) => {
  const stmt = db.prepare('DELETE FROM shops WHERE id = ? AND tenant_id = ?')
  return stmt.run(id, tenantId)
}

// ==================== FILES ====================

export const getAllFiles = (tenantId: string, shopId?: string, platform?: string) => {
  let query = 'SELECT * FROM marketing_files WHERE tenant_id = ?'
  const params: any[] = [tenantId]

  if (shopId) {
    query += ' AND shop_id = ?'
    params.push(shopId)
  }

  if (platform) {
    query += ' AND platform = ?'
    params.push(platform)
  }

  query += ' ORDER BY uploaded_at DESC'

  const results = db.prepare(query).all(...params)
  return snakeToCamel(results)
}

export const createFile = (tenantId: string, data: {
  shopId: string
  fileName: string
  filePath: string
  platform: string
  userName?: string
  reportStart?: string
  reportEnd?: string
  rowCount: number
}) => {
  const id = generateId()
  const stmt = db.prepare(`
    INSERT INTO marketing_files (
      id, tenant_id, shop_id, file_name, file_path, platform,
      user_name, report_start, report_end, row_count, uploaded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `)

  stmt.run(
    id,
    tenantId,
    data.shopId,
    data.fileName,
    data.filePath,
    data.platform,
    data.userName || null,
    data.reportStart || null,
    data.reportEnd || null,
    data.rowCount
  )

  const result = db.prepare('SELECT * FROM marketing_files WHERE id = ? AND tenant_id = ?').get(id, tenantId)
  return snakeToCamel(result)
}

export const deleteFile = (tenantId: string, id: string) => {
  // Delete file and related metrics (CASCADE)
  const stmt = db.prepare('DELETE FROM marketing_files WHERE id = ? AND tenant_id = ?')
  return stmt.run(id, tenantId)
}

// ==================== METRICS ====================

export const getMetrics = (tenantId: string, filters: {
  shopId?: string
  startDate?: string
  endDate?: string
  platform?: string
}) => {
  let query = 'SELECT * FROM marketing_metrics WHERE tenant_id = ?'
  const params: any[] = [tenantId]

  if (filters.shopId) {
    query += ' AND shop_id = ?'
    params.push(filters.shopId)
  }

  if (filters.startDate) {
    query += ' AND date >= ?'
    params.push(filters.startDate)
  }

  if (filters.endDate) {
    // Use < with next day to properly handle ISO timestamps
    // e.g., '2026-01-19T00:00:00.000Z' < '2026-01-20' works correctly
    const nextDay = new Date(filters.endDate)
    nextDay.setDate(nextDay.getDate() + 1)
    const nextDayStr = nextDay.toISOString().split('T')[0]
    query += ' AND date < ?'
    params.push(nextDayStr)
  }

  if (filters.platform) {
    const shopIds = db
      .prepare('SELECT id FROM shops WHERE platform = ? AND tenant_id = ?')
      .all(filters.platform, tenantId)
      .map((s: any) => s.id)

    if (shopIds.length > 0) {
      query += ` AND shop_id IN (${shopIds.map(() => '?').join(',')})`
      params.push(...shopIds)
    } else {
      // ไม่มีร้านของ tenant นี้บนแพลตฟอร์มที่ขอ = ต้องได้ผลลัพธ์ว่าง
      // เดิมเงื่อนไขนี้ถูกข้ามไปเฉย ๆ แล้วคืนเมตริกของทุกแพลตฟอร์มกลับมาแทน
      return []
    }
  }

  query += ' ORDER BY date DESC'

  const results = db.prepare(query).all(...params)
  return snakeToCamel(results)
}

export const createMetric = (tenantId: string, data: any) => {
  const id = generateId()
  const stmt = db.prepare(`
    INSERT INTO marketing_metrics (
      id, tenant_id, file_id, shop_id, date,
      campaign_name, product_name, sku, ad_status,
      impressions, clicks, ctr,
      orders, direct_orders, order_rate, direct_order_rate,
      cost_per_order, direct_cost_per_order,
      items_sold, direct_items_sold,
      sales, direct_sales,
      ad_cost,
      roas, direct_roas, acos, direct_acos,
      conversion_rate, extra_data, created_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?,
      ?, ?, ?, ?,
      ?, ?, datetime('now')
    )
  `)

  stmt.run(
    id,
    tenantId,
    data.fileId,
    data.shopId,
    data.date,
    data.campaignName || null,
    data.productName || null,
    data.sku || null,
    data.adStatus || null,
    data.impressions || 0,
    data.clicks || 0,
    data.ctr || 0,
    data.orders || 0,
    data.directOrders || 0,
    data.orderRate || 0,
    data.directOrderRate || 0,
    data.costPerOrder || 0,
    data.directCostPerOrder || 0,
    data.itemsSold || 0,
    data.directItemsSold || 0,
    data.sales || 0,
    data.directSales || 0,
    data.adCost || 0,
    data.roas || 0,
    data.directRoas || 0,
    data.acos || 0,
    data.directAcos || 0,
    data.conversionRate || 0,
    data.extraData || null
  )

  return id
}

/**
 * Get the last order number for a shop in a specific date range
 */
export const getLastOrderNumber = (tenantId: string, shopId: string, startDate: string, endDate: string): number => {
  const result: any = db.prepare(`
    SELECT MAX(order_number) as lastOrderNumber
    FROM marketing_metrics
    WHERE tenant_id = ?
      AND shop_id = ?
      AND date >= ?
      AND date < ?
  `).get(tenantId, shopId, startDate, endDate)

  return result?.lastOrderNumber || 0
}

export const bulkCreateMetrics = (tenantId: string, metrics: any[]) => {
  const insert = db.prepare(`
    INSERT INTO marketing_metrics (
      id, tenant_id, file_id, shop_id, date, order_number,
      campaign_name, product_name, sku, ad_status,
      impressions, clicks, ctr,
      orders, direct_orders, order_rate, direct_order_rate,
      cost_per_order, direct_cost_per_order,
      items_sold, direct_items_sold,
      sales, direct_sales,
      ad_cost,
      roas, direct_roas, acos, direct_acos,
      conversion_rate, extra_data, created_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?,
      ?, ?, ?, ?,
      ?, ?, datetime('now')
    )
  `)

  const insertMany = db.transaction((rows: any[]) => {
    for (const data of rows) {
      insert.run(
        generateId(),
        tenantId,
        data.fileId,
        data.shopId,
        data.date,
        data.orderNumber || null,
        data.campaignName || null,
        data.productName || null,
        data.sku || null,
        data.adStatus || null,
        data.impressions || 0,
        data.clicks || 0,
        data.ctr || 0,
        data.orders || 0,
        data.directOrders || 0,
        data.orderRate || 0,
        data.directOrderRate || 0,
        data.costPerOrder || 0,
        data.directCostPerOrder || 0,
        data.itemsSold || 0,
        data.directItemsSold || 0,
        data.sales || 0,
        data.directSales || 0,
        data.adCost || 0,
        data.roas || 0,
        data.directRoas || 0,
        data.acos || 0,
        data.directAcos || 0,
        data.conversionRate || 0,
        data.extraData || null
      )
    }
  })

  insertMany(metrics)
}
