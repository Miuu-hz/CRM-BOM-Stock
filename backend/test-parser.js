const { parseShopeeCSV } = require('./dist/services/csvParser.service')
const path = require('path')

async function test() {
  try {
    console.log('🧪 Testing CSV Parser...\n')

    const csvPath = path.join(__dirname, '../shopee-sample-correct.csv')
    console.log('📄 CSV File:', csvPath)

    const result = await parseShopeeCSV(csvPath)

    console.log('\n📊 Metadata:')
    console.log('  - User:', result.metadata.userName)
    console.log('  - Shop:', result.metadata.shopName)
    console.log('  - Shop ID:', result.metadata.shopId)
    console.log('  - Period:', result.metadata.reportStart, '-', result.metadata.reportEnd)

    console.log('\n📈 Metrics:', result.rowCount, 'rows')

    if (result.metrics.length > 0) {
      console.log('\n✅ Sample Data (first 3 rows):')
      result.metrics.slice(0, 3).forEach((m, i) => {
        console.log(`\n  Row ${i + 1}:`)
        console.log('    Date:', m.date)
        console.log('    Campaign:', m.campaignName)
        console.log('    SKU:', m.sku)
        console.log('    Impressions:', m.impressions)
        console.log('    Clicks:', m.clicks)
        console.log('    Orders:', m.orders)
        console.log('    Sales:', m.sales)
        console.log('    Ad Cost:', m.adCost)
        console.log('    ROAS:', m.roas)
      })

      console.log('\n📅 Date Distribution:')
      const dates = result.metrics.map(m => m.date)
      const uniqueDates = [...new Set(dates)]
      console.log('  Unique dates:', uniqueDates.length)
      console.log('  Dates:', uniqueDates.join(', '))
    }

    console.log('\n✅ Parser Test Complete!')

  } catch (error) {
    console.error('❌ Parser Test Failed:', error)
    console.error(error.stack)
  }
}

test()
