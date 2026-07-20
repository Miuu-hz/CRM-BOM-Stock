import api from './api'

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
  }
  businessUnits: Array<{ unit: 'RETAIL' | 'WHOLESALE' | 'ONLINE' | 'OTHER'; revenue: number; cogs: number; expense: number; netProfit: number }>
  revenueChart: Array<{ month: string; revenue: number; cost: number; grossProfit: number }>
  plTable: Array<{ month: string; revenue: number; cogs: number; grossProfit: number; netProfit: number; margin: number }>
  arAging: { current: number; days30: number; days60: number; days90: number; over90: number }
  apAging: { current: number; days30: number; days60: number; days90: number; over90: number }
  customers: Array<{
    id: string; name: string; currentRevenue: number; prevRevenue: number
    trend: 'up' | 'down' | 'stable'; tier: string; lastOrderDays: number
    creditLimit: number; creditUsed: number
  }>
  stockAlerts: Array<{ id: string; name: string; quantity: number; minStock: number; unit: string; daysRemaining: number }>
  workOrders: { draft: number; planned: number; inProgress: number; completed: number; cancelled: number; costVariance: number }
  earlyWarnings: Array<{ id: string; label: string; status: 'ok' | 'warn' | 'danger'; value: string; detail: string }>
}

export interface PhopyBoardExtendedData {
  channel: {
    byPlatform: Array<{ platform: string; revenue: number; orders: number }>
    onlineTotal: number; onlineOrders: number
    offlineRevenue: number; offlineOrders: number
    orderTrend: Array<{ month: string; online: number; offline: number }>
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
    costTrend: Array<{ month: string; cogs: number; opex: number }>
    ledgerCogsTotal: number
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
