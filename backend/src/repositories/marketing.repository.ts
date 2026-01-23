import db from '../db/sqlite'
import { randomBytes } from 'crypto'

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

export const getAllShops = (platform?: string, isActive?: boolean) => {
  let query = 'SELECT * FROM shops WHERE 1=1'
  const params: any[] = []

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

export const getShopById = (id: string) => {
  const result = db.prepare('SELECT * FROM shops WHERE id = ?').get(id)
  return snakeToCamel(result)
}

export const createShop = (data: {
  name: string
  platform: string
  shopId: string
}) => {
  const id = generateId()
  const stmt = db.prepare(`
    INSERT INTO shops (id, name, platform, shop_id, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
  `)

  stmt.run(id, data.name, data.platform, data.shopId)
  return getShopById(id) // Already converted by getShopById
}

export const updateShop = (id: string, data: { name?: string; isActive?: boolean }) => {
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

  if (updates.length === 0) return getShopById(id)

  updates.push("updated_at = datetime('now')")
  params.push(id)

  const stmt = db.prepare(`
    UPDATE shops SET ${updates.join(', ')} WHERE id = ?
  `)

  stmt.run(...params)
  return getShopById(id) // Already converted by getShopById
}

export const deleteShop = (id: string) => {
  const stmt = db.prepare('DELETE FROM shops WHERE id = ?')
  return stmt.run(id)
}

// ==================== FILES ====================

export const getAllFiles = (shopId?: string, platform?: string) => {
  let query = 'SELECT * FROM marketing_files WHERE 1=1'
  const params: any[] = []

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

export const createFile = (data: {
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
      id, shop_id, file_name, file_path, platform,
      user_name, report_start, report_end, row_count, uploaded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `)

  stmt.run(
    id,
    data.shopId,
    data.fileName,
    data.filePath,
    data.platform,
    data.userName || null,
    data.reportStart || null,
    data.reportEnd || null,
    data.rowCount
  )

  const result = db.prepare('SELECT * FROM marketing_files WHERE id = ?').get(id)
  return snakeToCamel(result)
}

export const deleteFile = (id: string) => {
  // Delete file and related metrics (CASCADE)
  const stmt = db.prepare('DELETE FROM marketing_files WHERE id = ?')
  return stmt.run(id)
}

// ==================== METRICS ====================

export const getMetrics = (filters: {
  shopId?: string
  startDate?: string
  endDate?: string
  platform?: string
}) => {
  let query = 'SELECT * FROM marketing_metrics WHERE 1=1'
  const params: any[] = []

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
      .prepare('SELECT id FROM shops WHERE platform = ?')
      .all(filters.platform)
      .map((s: any) => s.id)

    if (shopIds.length > 0) {
      query += ` AND shop_id IN (${shopIds.map(() => '?').join(',')})`
      params.push(...shopIds)
    }
  }

  query += ' ORDER BY date DESC'

  const results = db.prepare(query).all(...params)
  return snakeToCamel(results)
}

export const createMetric = (data: any) => {
  const id = generateId()
  const stmt = db.prepare(`
    INSERT INTO marketing_metrics (
      id, file_id, shop_id, date,
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
      ?, ?, ?, ?,
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

export const bulkCreateMetrics = (metrics: any[]) => {
  const insert = db.prepare(`
    INSERT INTO marketing_metrics (
      id, file_id, shop_id, date,
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
      ?, ?, ?, ?,
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

  const insertMany = db.transaction((metrics: any[]) => {
    for (const data of metrics) {
      insert.run(
        generateId(),
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
    }
  })

  insertMany(metrics)
}
