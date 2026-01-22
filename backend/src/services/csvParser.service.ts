import Papa from 'papaparse'
import fs from 'fs'

export interface ShopeeMetadata {
  userName: string
  shopName: string
  shopId: string
  reportStart: string
  reportEnd: string
}

export interface ShopeeMetricRow {
  date: string
  campaignName?: string
  productName?: string
  sku?: string
  adStatus?: string
  impressions: number
  clicks: number
  ctr: number
  orders: number
  directOrders: number
  orderRate: number
  directOrderRate: number
  costPerOrder: number
  directCostPerOrder: number
  itemsSold: number
  directItemsSold: number
  sales: number
  directSales: number
  adCost: number
  roas: number
  directRoas: number
  acos: number
  directAcos: number
  conversionRate: number
  extraData?: any
}

export interface ParsedCSVResult {
  metadata: ShopeeMetadata
  metrics: ShopeeMetricRow[]
  rowCount: number
}

/**
 * แปลงค่า % (เช่น 5.11%) เป็นตัวเลข float (0.0511)
 */
function cleanPercent(value: any): number {
  if (typeof value === 'string' && value.includes('%')) {
    return parseFloat(value.replace('%', '')) / 100
  }
  return isNaN(parseFloat(value)) ? 0 : parseFloat(value)
}

/**
 * แปลงตัวเลขที่มีคอมมา (เช่น 1,234.56) เป็น float
 */
function cleanNumber(value: any): number {
  if (typeof value === 'string') {
    return parseFloat(value.replace(/,/g, ''))
  }
  return isNaN(parseFloat(value)) ? 0 : parseFloat(value)
}

/**
 * Parse Shopee CSV file
 * Format:
 * - Lines 1-6: Metadata
 * - Line 7: Headers
 * - Line 8+: Data rows
 */
export async function parseShopeeCSV(filePath: string): Promise<ParsedCSVResult> {
  return new Promise((resolve, reject) => {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8')
      const lines = fileContent.split('\n')

      // Extract metadata from first 6 lines
      const metadata: ShopeeMetadata = {
        userName: '',
        shopName: '',
        shopId: '',
        reportStart: '',
        reportEnd: '',
      }

      // Parse metadata (assuming format: "Label,Value")
      if (lines.length >= 6) {
        const parseLine = (line: string) => {
          const parts = line.split(',')
          return parts.length > 1 ? parts[1].trim().replace(/"/g, '') : ''
        }

        metadata.userName = parseLine(lines[1])
        metadata.shopName = parseLine(lines[2])
        metadata.shopId = parseLine(lines[3])

        // Parse report period (lines 4-5 might have start and end dates)
        const reportPeriod = parseLine(lines[4])
        if (reportPeriod) {
          const dates = reportPeriod.split('-').map(d => d.trim())
          metadata.reportStart = dates[0] || ''
          metadata.reportEnd = dates[1] || dates[0] || ''
        }
      }

      // Parse CSV data starting from row 7 (index 6)
      const csvData = lines.slice(6).join('\n')

      Papa.parse(csvData, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          try {
            const metrics: ShopeeMetricRow[] = results.data.map((row: any) => {
              // Map CSV columns to our structure
              // Column names are in Thai from Shopee CSV
              return {
                date: row['Date'] || row['วันที่'] || new Date().toISOString(),
                campaignName: row['ชื่อโฆษณา / ชื่อสินค้า'] || row['Campaign'] || '',
                productName: row['ชื่อโฆษณา / ชื่อสินค้า'] || row['Product'] || '',
                sku: row['รหัสสินค้า'] || row['SKU'] || '',
                adStatus: row['สถานะโฆษณา'] || row['Ad Status'] || '',

                // Traffic
                impressions: cleanNumber(row['การมองเห็น'] || row['Impressions'] || 0),
                clicks: cleanNumber(row['จำนวนคลิก'] || row['Clicks'] || 0),
                ctr: cleanPercent(row['อัตราการคลิก (CTR)'] || row['CTR'] || 0),

                // Orders
                orders: cleanNumber(row['การสั่งซื้อ'] || row['Orders'] || 0),
                directOrders: cleanNumber(row['การสั่งซื้อโดยตรง'] || row['Direct Orders'] || 0),
                orderRate: cleanPercent(row['อัตราการสั่งซื้อ'] || row['Order Rate'] || 0),
                directOrderRate: cleanPercent(row['อัตราการสั่งซื้อโดยตรง'] || row['Direct Order Rate'] || 0),

                // Cost per Order
                costPerOrder: cleanNumber(row['ราคาต่อการสั่งซื้อ'] || row['Cost per Order'] || 0),
                directCostPerOrder: cleanNumber(row['ราคาต่อการสั่งซื้อโดยตรง'] || row['Direct Cost per Order'] || 0),

                // Items Sold
                itemsSold: cleanNumber(row['สินค้าที่ขายแล้ว'] || row['Items Sold'] || 0),
                directItemsSold: cleanNumber(row['สินค้าที่ขายแล้วโดยตรง'] || row['Direct Items Sold'] || 0),

                // Sales
                sales: cleanNumber(row['ยอดขาย'] || row['Sales'] || 0),
                directSales: cleanNumber(row['ยอดขายโดยตรง'] || row['Direct Sales'] || 0),

                // Ad Cost
                adCost: cleanNumber(row['ค่าโฆษณา'] || row['Ad Cost'] || row['Cost'] || 0),

                // Performance
                roas: cleanPercent(row['ยอดขาย/รายจ่าย (ROAS)'] || row['ROAS'] || 0),
                directRoas: cleanPercent(row['ผลตอบแทนจากการลงทุนโดยตรง (Direct ROAS)'] || row['Direct ROAS'] || 0),
                acos: cleanPercent(row['ACOS'] || 0),
                directAcos: cleanPercent(row['อัตราส่วนค่าใช้จ่ายต่อรายได้โดยตรง (Direct ACOS)'] || row['Direct ACOS'] || 0),

                conversionRate: cleanPercent(row['Conversion Rate'] || row['อัตราการแปลง'] || 0),
                extraData: row, // Store full row for reference
              }
            })

            resolve({
              metadata,
              metrics,
              rowCount: metrics.length,
            })
          } catch (error) {
            reject(new Error('Failed to process CSV data: ' + error))
          }
        },
        error: (error: any) => {
          reject(new Error('Failed to parse CSV: ' + error.message))
        },
      })
    } catch (error) {
      reject(error)
    }
  })
}

/**
 * Generic CSV parser for future platform support (TikTok, etc.)
 */
export async function parseMarketingCSV(
  filePath: string,
  platform: string
): Promise<ParsedCSVResult> {
  switch (platform.toUpperCase()) {
    case 'SHOPEE':
      return parseShopeeCSV(filePath)
    case 'TIKTOK':
      // TODO: Implement TikTok parser when format is available
      throw new Error('TikTok CSV parsing not yet implemented')
    default:
      throw new Error(`Unsupported platform: ${platform}`)
  }
}
