// Bill Components Export
export { default as BillTemplate } from './BillTemplate'
export { default as UnifiedBillTemplate } from './UnifiedBillTemplate'
export { default as BillViewer, BillDemo, QuickPrintButton } from './BillViewer'
export {
  BillProvider,
  useBill,
  BILL_CONFIGS,
  type BillType,
  type BillConfig,
  type BillData,
  type BillItem,
  type BillParty,
} from './BillContext'

// Utility functions
export { numberToThaiText, formatCurrency, formatThaiDate } from './BillTemplate'
