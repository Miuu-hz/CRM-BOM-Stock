import db from '../db/sqlite'
import { posSales, cashDrawer, r2 } from './phopyBoard.service'

export interface ExecDigest {
  day: string
  sales: number
  purchases: number
  withdrawals: number
  purchaseSources: { label: string; amount: number }[]
  withdrawalItems: { reason: string; amount: number; shiftNumber: string }[]
  deliveries: { doNumber: string; customer: string; status: string; address: string }[]
  totalDeliveries: number
}

export function buildExecDigest(tenantId: string, day: string /* YYYY-MM-DD Thai date = yesterday */, today: string): ExecDigest {
  // 1. Sales: posSales(tenantId, day, day).revenue — same as "ยอดขายวันนี้"
  const sales = r2(posSales(tenantId, day, day).revenue)

  // 2. Purchases & Drawer Purchases
  const drawer = cashDrawer(tenantId, day, day)
  const drawerPurchases = drawer.movements.filter(m => m.category === 'PURCHASE')
  const drawerPurchaseTotal = r2(drawerPurchases.reduce((s, m) => s + (Number(m.amount) || 0), 0))

  const piRows = db.prepare(`
    SELECT pi.total_amount, sp.name AS supplier_name
    FROM purchase_invoices pi
    LEFT JOIN suppliers sp ON sp.id = pi.supplier_id AND (sp.tenant_id = pi.tenant_id OR sp.tenant_id IS NULL)
    WHERE pi.tenant_id = ? AND date(pi.invoice_date) = ? AND (pi.status IS NULL OR pi.status NOT IN ('CANCELLED', 'DRAFT', 'VOID'))
  `).all(tenantId, day) as Array<{ total_amount: number; supplier_name: string | null }>

  const supplierTotals = new Map<string, number>()
  for (const row of piRows) {
    const name = (row.supplier_name || '').trim() || 'ไม่ระบุผู้ขาย'
    supplierTotals.set(name, r2((supplierTotals.get(name) || 0) + (Number(row.total_amount) || 0)))
  }

  const sourcesList: { label: string; amount: number }[] = []
  for (const [name, amt] of supplierTotals.entries()) {
    if (amt > 0) sourcesList.push({ label: name, amount: amt })
  }
  if (drawerPurchaseTotal > 0) {
    sourcesList.push({ label: 'เงินสดหน้าร้าน', amount: drawerPurchaseTotal })
  }
  sourcesList.sort((a, b) => b.amount - a.amount)

  const topSources = sourcesList.slice(0, 5)
  if (sourcesList.length > 5) {
    const rest = r2(sourcesList.slice(5).reduce((s, x) => s + x.amount, 0))
    if (rest > 0) topSources.push({ label: 'อื่นๆ', amount: rest })
  }

  const invoicePurchases = r2(piRows.reduce((s, r) => s + (Number(r.total_amount) || 0), 0))
  const purchases = r2(invoicePurchases + drawerPurchaseTotal)

  // 3. Withdrawals: EXPENSE, OWNER or OTHER (not PURCHASE, not CASH_IN, not OPENING_GAP type)
  const withdrawalMovements = drawer.movements.filter(m => ['EXPENSE', 'OWNER', 'OTHER'].includes(m.category) && m.type !== 'OPENING_GAP')
  const withdrawals = r2(withdrawalMovements.reduce((s, m) => s + (Number(m.amount) || 0), 0))

  const sortedWithdrawals = withdrawalMovements.slice().sort((a, b) => b.amount - a.amount)
  const withdrawalItems = sortedWithdrawals.slice(0, 6).map(m => ({
    reason: m.reason || 'จ่ายออกจากลิ้นชัก',
    amount: r2(m.amount),
    shiftNumber: m.shiftNumber || '',
  }))

  // 4. Deliveries: delivery_orders where delivery_date (date part) = today and status not DELIVERED/CANCELLED
  const doRows = db.prepare(`
    SELECT do.do_number, c.name AS customer_name, do.status, COALESCE(do.delivery_address, c.address, '') AS address
    FROM delivery_orders do
    LEFT JOIN customers c ON c.id = do.customer_id AND (c.tenant_id = do.tenant_id OR c.tenant_id IS NULL)
    WHERE do.tenant_id = ? AND date(do.delivery_date) = ? AND (do.status IS NULL OR do.status NOT IN ('DELIVERED', 'CANCELLED'))
    ORDER BY do.created_at ASC
  `).all(tenantId, today) as any[]

  const totalDeliveries = doRows.length
  const deliveries = doRows.slice(0, 8).map(d => ({
    doNumber: d.do_number,
    customer: d.customer_name || 'ลูกค้าทั่วไป',
    status: d.status || 'DRAFT',
    address: d.address || '',
  }))

  return {
    day,
    sales,
    purchases,
    withdrawals,
    purchaseSources: topSources,
    withdrawalItems,
    deliveries,
    totalDeliveries,
  }
}
