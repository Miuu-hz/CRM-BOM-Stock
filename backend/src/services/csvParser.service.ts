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

      // Extract metadata from first 8 lines (actual Shopee format)
      const metadata: ShopeeMetadata = {
        userName: '',
        shopName: '',
        shopId: '',
        reportStart: '',
        reportEnd: '',
      }

      // Helper: Convert Thai date (19/01/2026) to ISO (2026-01-19)
      const parseThaiDate = (dateStr: string): string => {
        const parts = dateStr.trim().split('/')
        if (parts.length === 3) {
          return `${parts[2]}-${parts[1]}-${parts[0]}`
        }
        return dateStr
      }

      // Parse metadata (actual Shopee format)
      if (lines.length >= 8) {
        const parseLine = (line: string) => {
          const parts = line.split(',')
          return parts.length > 1 ? parts[1].trim().replace(/"/g, '') : ''
        }

        // Line 2: User Name,xxx
        if (lines[1]) {
          metadata.userName = parseLine(lines[1])
        }

        // Line 3: ชื่อกลุ่ม or ชื่อร้านค้า
        if (lines[2]) {
          metadata.shopName = parseLine(lines[2])
        }

        // Line 4: Shop ID,xxx
        if (lines[3]) {
          metadata.shopId = parseLine(lines[3])
        }

        // Line 6: ระยะเวลา,19/01/2026 - 19/01/2026
        if (lines[5]) {
          const periodLine = parseLine(lines[5])
          if (periodLine && periodLine.includes('-')) {
            const dates = periodLine.split('-').map(d => d.trim())
            if (dates.length >= 2) {
              metadata.reportStart = parseThaiDate(dates[0])
              metadata.reportEnd = parseThaiDate(dates[1])
            }
          }
        }
      }

      // Parse CSV data starting from row 8 (index 7) - skip line 7 which is empty
      const csvData = lines.slice(7).join('\n')

      Papa.parse(csvData, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          try {
            // Check if CSV has date column
            const firstRow: any = results.data[0]
            const hasDateColumn = results.data.length > 0 && firstRow &&
              (firstRow.hasOwnProperty('Date') || firstRow.hasOwnProperty('วันที่'))

            // If no date column, distribute dates across report period
            let dateDistribution: string[] = []
            if (!hasDateColumn && metadata.reportStart) {
              const startDate = new Date(metadata.reportStart)
              const endDate = metadata.reportEnd ? new Date(metadata.reportEnd) : startDate
              const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))

              // Create array of dates
              if (daysDiff > 0) {
                const interval = Math.ceil(daysDiff / results.data.length) || 1
                for (let i = 0; i < results.data.length; i++) {
                  const date = new Date(startDate)
                  date.setDate(date.getDate() + (i * interval))
                  dateDistribution.push(date.toISOString().split('T')[0])
                }
              } else {
                // All on start date
                dateDistribution = Array(results.data.length).fill(startDate.toISOString().split('T')[0])
              }
            }

            const metrics: ShopeeMetricRow[] = results.data.map((row: any, index: number) => {
              // Map CSV columns to our structure
              // Column names are in Thai from Shopee CSV
              return {
                date: row['Date'] || row['วันที่'] || dateDistribution[index] || new Date().toISOString().split('T')[0],
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
