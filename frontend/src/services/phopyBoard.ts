import api from './api'

export type AgingBuckets = { current: number; days30: number; days60: number; days90: number; over90: number }
export interface AgingDetail { buckets: AgingBuckets; total: number; overdue: number; count: number; ledger: Record<string, number> }
export type DrawerCategory = 'EXPENSE' | 'PURCHASE' | 'OWNER' | 'CASH_IN' | 'OTHER'

export interface CogsAnalysis {
  recipe: number; stockAdjust: number; directPurchase: number; ledger: number
  stock: { opening: number; purchasesToStock: number; directPurchase: number; closing: number; cogs: number }
  variance: number; varianceCount: number; notInLedgerCogs: number
  systemStock: { value: number | null; diff: number | null }
}

export interface PosSales {
  revenue: number; bills: number; avgBill: number; discount: number
  byMethod: Array<{ method: string; label: string; amount: number; count: number }>
  cancelled: { bills: number; amount: number }
  ledger: { sales: number; cancels: number; other: number; net: number }
  diff: number
}

export interface CashDrawer {
  movements: Array<{ date: string; shiftNumber: string; type: string; reason: string; amount: number; category: DrawerCategory; accountCode: string; accountName: string; posted: boolean }>
  totals: Record<DrawerCategory, number>
  unposted: { count: number; amount: number }
  untrackedGaps: Array<{ shiftNumber: string; previousShift: string; amount: number }>
  overShort: { over: number; short: number; net: number; ledger: number }
}

export interface EarlyWarning {
  id: string; label: string; status: 'ok' | 'warn' | 'danger'; value: string; detail: string
  hint: { what: string; calc: string; thresholds: string; action: string }
}

export interface PhopyBoardData {
  period: { start: string; end: string }
  kpis: {
    revenue: number
    cost: number
    grossProfit: number
    netProfit: number
    grossMarginPct: number
    prevRevenue: number
    prevGrossProfit: number
    opex: number
    labour: number
  }
  businessUnits: Array<{
    unit: 'RETAIL' | 'WHOLESALE' | 'ONLINE' | 'OTHER'; revenue: number; cogs: number; expense: number; adjust: number; netProfit: number
    breakdown: Array<{ referenceType: string; label: string; revenue: number; cogs: number; expense: number; adjust: number }>
  }>
  revenueChart: Array<{ month: string; revenue: number; cost: number; grossProfit: number }>
  plTable: Array<{ month: string; revenue: number; cogs: number; grossProfit: number; labour: number; otherOpex: number; netProfit: number; margin: number }>
  arAging: AgingBuckets
  apAging: AgingBuckets
  arDetail: AgingDetail
  apDetail: AgingDetail
  customers: Array<{
    id: string; name: string; currentRevenue: number; prevRevenue: number
    trend: 'up' | 'down' | 'stable'; tier: string; lastOrderDays: number
    creditLimit: number; creditUsed: number
  }>
  stockAlerts: Array<{ id: string; name: string; quantity: number; minStock: number; unit: string; daysRemaining: number }>
  workOrders: { draft: number; planned: number; inProgress: number; completed: number; cancelled: number; costVariance: number }
  earlyWarnings: EarlyWarning[]
  cogsAnalysis: CogsAnalysis
  posSales: PosSales
  cashDrawer: CashDrawer
  labour: { salary: number; directLabor: number; total: number }
}

export interface PhopyBoardExtendedData {
  channel: {
    byPlatform: Array<{ platform: string; revenue: number; orders: number }>
    onlineTotal: number; onlineOrders: number
    offlineRevenue: number; offlineOrders: number
    orderTrend: Array<{ month: string; online: number; offline: number; wholesale: number; retail: number }>
    retailRevenue: number; retailBills: number
    channels: Array<{ unit: 'RETAIL' | 'WHOLESALE' | 'ONLINE'; label: string; revenue: number; orders: number }>
  }
  adsROI: {
    totals: {
      impressions: number; clicks: number; orders: number; revenue: number; adCost: number
      roas: number; cpc: number; cpo: number; ctr: number; orderRate: number; revenuePerAdBaht: number
    }
    byPlatform: Array<{
      platform: string; impressions: number; clicks: number; orders: number
      revenue: number; adCost: number; roas: number; cpc: number; cpo: number
    }>
  }
  costStructure: {
    cogsByCategory: Array<{ category: string; amount: number }>
    expenseByCategory: Array<{ category: string; amount: number }>
    expenseRatio: number
    productionVariance: { estimated: number; actual: number; variancePct: number; count: number }
    costTrend: Array<{ month: string; cogs: number; opex: number; purchases: number }>
    ledgerCogsTotal: number
    ledgerRevenue: number
  }
  products: {
    top10: Array<{ id: string; name: string; code: string; revenue: number; unitsSold: number; orderCount: number; bomCost: number; margin: number }>
    bottom10: Array<{ id: string; name: string; code: string; revenue: number; unitsSold: number; orderCount: number; bomCost: number; margin: number }>
    concentrationRisk: number; totalRevenue: number
  }
  workingCapital: {
    currentAssets: number; currentLiabilities: number; cash: number; ar: number
    currentRatio: number; quickRatio: number; cashBurnRate: number
    wcTrend: Array<{ month: string; currentRatio: number; quickRatio: number }>
  }
  outsourceProduction: {
    stockValue: { inHouse: number; offsite: number }
    suppliersWithStock: Array<{ supplier_id: string; supplier_name: string; value: number; items: number }>
    overdueContracts: Array<{ id: string; contract_number: string; supplier_id: string; supplier_name: string; due_date: string; status: string; outstanding_amount: number }>
    yield: {
      good: number; scrap: number; shortage: number
      goodPct: number; scrapPct: number; shortagePct: number
      byContract: Array<{ contract_id: string; contract_number: string; supplier_name: string; good: number; scrap: number; shortage: number; goodPct: number }>
    }
  }
}

export const phopyBoardApi = {
  getSummary: (params: { startDate: string; endDate: string }) =>
    api.get<{ success: boolean; data: PhopyBoardData }>('/phopy-board/summary', { params }),
  getExtended: (params: { startDate: string; endDate: string }) =>
    api.get<{ success: boolean; data: PhopyBoardExtendedData }>('/phopy-board/extended', { params }),
}
