import { Router, Request, Response } from 'express'
import db from '../db/sqlite'
import { authenticate } from '../middleware/auth.middleware'
import { thaiNow } from './dashboard.routes'

// ═══════════════════════════════════════════════════════════════
// 3D Digital Twin — สรุปสถานะคลัง "ตอนนี้" ของ tenant เดียว ในคำขอเดียว
// ฉาก 3D ใช้ตัวเลขชุดนี้กำหนดจำนวนรถที่ท่า/บนถนน ความเต็มของชั้นวาง ฯลฯ
// ขาเข้า = PO ที่อนุมัติแล้วรอรับของ · ขาออก = ใบส่งของ (READY = ขึ้นของที่ท่า, SHIPPED = กำลังวิ่ง)
// ═══════════════════════════════════════════════════════════════

const router = Router()
router.use(authenticate)

const INBOUND_PO = `('APPROVED', 'PARTIAL')`
const LIST_LIMIT = 6

const ymd = (d: Date) => d.toISOString().slice(0, 10)

/** ตัวเลขเงินเห็นได้เฉพาะคนที่ดูรายงานการเงินได้ — กติกาเดียวกับ dashboard.routes */
function canSeeMoney(user: any): boolean {
  if (['MASTER', 'ADMIN', 'MANAGER', 'POWERUSER'].includes(user?.role)) return true
  const deps: string[] = user?.departments || (user?.department ? [user.department] : [])
  return deps.some(d => ['CEO', 'CTO', 'IT', 'ACCOUNTING', 'SALES'].includes(d))
}

export function buildTwinSummary(tenantId: string, showMoney: boolean) {
  const today = ymd(thaiNow())
  const since30 = ymd(new Date(thaiNow().getTime() - 29 * 86400000))
  const one = (sql: string, ...p: unknown[]) => db.prepare(sql).get(tenantId, ...p) as any

  const stock = one(`
    SELECT COUNT(*) AS sku,
           SUM(CASE WHEN quantity > 0 THEN 1 ELSE 0 END) AS in_stock,
           SUM(CASE WHEN min_stock > 0 AND quantity <= min_stock THEN 1 ELSE 0 END) AS low,
           COALESCE(SUM(CASE WHEN quantity > 0 THEN quantity * unit_cost ELSE 0 END), 0) AS value
    FROM stock_items WHERE tenant_id = ?`)

  const categories = db.prepare(`
    SELECT category, COUNT(*) AS sku, SUM(CASE WHEN quantity > 0 THEN 1 ELSE 0 END) AS in_stock
    FROM stock_items WHERE tenant_id = ? GROUP BY category ORDER BY sku DESC`).all(tenantId) as any[]

  const lowItems = db.prepare(`
    SELECT id, sku, name, quantity, min_stock AS minStock, unit
    FROM stock_items WHERE tenant_id = ? AND min_stock > 0 AND quantity <= min_stock
    ORDER BY CAST(quantity AS REAL) / min_stock ASC LIMIT ?`).all(tenantId, LIST_LIMIT)

  const inbound = db.prepare(`
    SELECT po.id, po.po_number AS number, po.status, po.expected_date AS eta, po.total_amount AS amount,
           s.name AS party
    FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id AND s.tenant_id = po.tenant_id
    WHERE po.tenant_id = ? AND po.status IN ${INBOUND_PO}
    ORDER BY COALESCE(po.expected_date, po.order_date) ASC LIMIT ?`).all(tenantId, LIST_LIMIT) as any[]

  const inboundCount = one(`SELECT COUNT(*) AS n FROM purchase_orders WHERE tenant_id = ? AND status IN ${INBOUND_PO}`).n
  const receivedToday = one(`
    SELECT COUNT(*) AS n FROM goods_receipts
    WHERE tenant_id = ? AND status != 'CANCELLED' AND DATE(receipt_date) = ?`, today).n

  const outbound = db.prepare(`
    SELECT d.id, d.do_number AS number, d.status, d.delivery_date AS eta, d.driver_name AS driver,
           d.vehicle_plate AS plate, d.delivery_address AS address, d.updated_at AS updatedAt, c.name AS party
    FROM delivery_orders d LEFT JOIN customers c ON c.id = d.customer_id AND c.tenant_id = d.tenant_id
    WHERE d.tenant_id = ? AND (d.status IN ('READY', 'SHIPPED') OR (d.status = 'DELIVERED' AND DATE(d.updated_at) = ?))
    ORDER BY CASE d.status WHEN 'READY' THEN 0 WHEN 'SHIPPED' THEN 1 ELSE 2 END, d.delivery_date ASC
    LIMIT ?`).all(tenantId, today, LIST_LIMIT) as any[]

  const doCounts = db.prepare(`
    SELECT SUM(CASE WHEN status = 'READY' THEN 1 ELSE 0 END) AS ready,
           SUM(CASE WHEN status = 'SHIPPED' THEN 1 ELSE 0 END) AS shipped,
           SUM(CASE WHEN status = 'DELIVERED' AND DATE(updated_at) = ? THEN 1 ELSE 0 END) AS delivered_today
    FROM delivery_orders WHERE tenant_id = ?`).get(today, tenantId) as any

  // ส่งตรงเวลา = ส่งถึง (DELIVERED) ไม่เกินวันที่นัดใน SO ใน 30 วันล่าสุด
  // ponytail: ใช้ updated_at เป็นเวลาที่ส่งถึง (ไม่มีคอลัมน์ delivered_at) — แก้ใบหลังส่งแล้ววันที่จะเลื่อน
  const onTime = one(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN DATE(d.updated_at) <= DATE(COALESCE(so.delivery_date, d.delivery_date)) THEN 1 ELSE 0 END) AS ok
    FROM delivery_orders d LEFT JOIN sales_orders so ON so.id = d.sales_order_id AND so.tenant_id = d.tenant_id
    WHERE d.tenant_id = ? AND d.status = 'DELIVERED' AND DATE(d.updated_at) >= ?`, since30)

  const production = db.prepare(`
    SELECT id, wo_number AS number, product_name AS product, quantity, completed_qty AS completed, due_date AS due
    FROM work_orders WHERE tenant_id = ? AND status = 'IN_PROGRESS'
    ORDER BY COALESCE(due_date, start_date) ASC LIMIT ?`).all(tenantId, LIST_LIMIT)
  const productionCount = one(`SELECT COUNT(*) AS n FROM work_orders WHERE tenant_id = ? AND status = 'IN_PROGRESS'`).n

  const company = db.prepare('SELECT name, address FROM company_settings WHERE tenant_id = ?').get(tenantId) as any

  return {
    generatedAt: new Date().toISOString(),
    site: { name: company?.name || '', address: company?.address || '' },
    stock: {
      sku: stock?.sku || 0,
      inStock: stock?.in_stock || 0,
      low: stock?.low || 0,
      value: showMoney ? Math.round(stock?.value || 0) : null,
      categories: categories.map(c => ({ category: c.category, sku: c.sku, inStock: c.in_stock })),
      lowItems,
    },
    inbound: {
      open: inboundCount || 0,
      receivedToday: receivedToday || 0,
      list: inbound.map(p => ({ ...p, amount: showMoney ? p.amount : null })),
    },
    outbound: {
      ready: doCounts?.ready || 0,
      shipped: doCounts?.shipped || 0,
      deliveredToday: doCounts?.delivered_today || 0,
      onTimePct: onTime?.total ? Math.round((onTime.ok / onTime.total) * 1000) / 10 : null,
      list: outbound,
    },
    production: { active: productionCount || 0, list: production },
  }
}

router.get('/', (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: buildTwinSummary(req.user!.tenantId, canSeeMoney(req.user)) })
  } catch (error) {
    console.error('Digital twin summary error:', error)
    res.status(500).json({ success: false, message: 'โหลดข้อมูลคลังไม่สำเร็จ' })
  }
})

export default router
