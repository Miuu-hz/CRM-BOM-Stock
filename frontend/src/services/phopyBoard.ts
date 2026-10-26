import api from './api'
import type { TrendPeriod } from '../components/charts/CandleChart'

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

// ── บท 1/6/เทรนด์ — เพิ่มสำหรับ Phopy Board 7 บท (CONTRACTS.md C2/A3) ──────

export type TrendGrain = 'week' | 'month' | 'quarter' | 'year'

export interface TrendResponse {
  grain: TrendGrain
  requestedGrain?: TrendGrain
  note?: string
  ma: [number, number]
  warmup: number
  dataSince: string | null
  periods: TrendPeriod[]
}

export interface CfoKpi {
  key: string; label: string; value: number; prev: number | null; deltaPct: number | null
  format: 'baht' | 'pct'; note?: string
}
export interface CfoSummaryLine { text: string; from: string }
export interface CfoSummaryData {
  period: { start: string; end: string }
  compare: { mode: 'yoy' | 'prev'; start: string; end: string; label: string; hasData: boolean }
  kpis: CfoKpi[]
  strengths: CfoSummaryLine[]
  cautions: CfoSummaryLine[]
  decisions: CfoSummaryLine[]
  confidence: { period: string; label: string; passed: number; total: number }
}

export type ChecklistStatus = 'pass' | 'warn' | 'block' | 'na'
export interface ChecklistItem {
  id: number; key: string; title: string; severity: 'block' | 'warn'; status: ChecklistStatus
  detail: string; count?: number; amount?: number; link?: string; daily: boolean; rows?: Record<string, unknown>[]
}
export interface ChecklistResult {
  period: string; start: string; end: string; periodStatus: 'OPEN' | 'CLOSED' | 'FILING' | 'NONE'
  items: ChecklistItem[]; passed: number; total: number; blocks: number; warns: number; label: string; canClose: boolean
}

export const phopyBoardApi = {
  getSummary: (params: { startDate: string; endDate: string }) =>
    api.get<{ success: boolean; data: PhopyBoardData }>('/phopy-board/summary', { params }),
  getExtended: (params: { startDate: string; endDate: string }) =>
    api.get<{ success: boolean; data: PhopyBoardExtendedData }>('/phopy-board/extended', { params }),
  getTrend: (params: { grain: TrendGrain; from?: string; to: string; warmup?: number }) =>
    api.get<{ success: boolean; data: TrendResponse }>('/phopy-board/trend', { params }),
  getCfoSummary: (params: { startDate: string; endDate: string; compare: 'yoy' | 'prev' }) =>
    api.get<{ success: boolean; data: CfoSummaryData }>('/phopy-board/cfo-summary', { params }),
  getChecklist: (period: string) =>
    api.get<{ success: boolean; data: ChecklistResult }>(`/month-close/${period}/checklist`),
  getBudgets: (year: number) =>
    api.get<{ success: boolean; data: any[] }>(`/budgets/${year}`),
  getBudgetVsActual: (year: number) =>
    api.get<{ success: boolean; data: any }>(`/budgets/${year}/vs-actual`),
}
