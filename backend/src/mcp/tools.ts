// MCP tool handlers — DB-Anchored Token Intersection search
// 5 tools: search, get_summary, get_sales, get_orders, create_purchase_request
//
// Core idea: use the database itself as a Thai vocabulary.
// "เนื้อหมูสับ" → substrings → filter those that exist in DB → greedy non-overlap tokens
// → AND search (fallback OR) → precise results without a Thai NLP library.

import { z } from 'zod'
import db from '../db/sqlite'
import { IMcpServer } from './sdk-compat'

type ToolResult = { content: Array<{ type: 'text'; text: string }> }
const ok = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
})

// ── DB-Anchored Token Intersection ────────────────────────────────────────────
// existsFn  — return true if a substring appears in at least one relevant row
// searchFn  — execute the real query with the given tokens and mode

function anchorTokens(
  q: string,
  existsFn: (sub: string) => boolean,
  searchFn: (tokens: string[], mode: 'and' | 'or') => unknown[]
): unknown[] {
  // Generate substrings length 2–8, sorted longest-first
  const subs: string[] = []
  for (let len = Math.min(8, q.length); len >= 2; len--) {
    for (let i = 0; i <= q.length - len; i++) subs.push(q.slice(i, i + len))
  }
  const validSubs = [...new Set(subs)].filter(existsFn)
  if (validSubs.length === 0) return []

  // Greedy non-overlapping token selection
  const tokens: string[] = []
  const usedPos = new Set<number>()
  for (const sub of validSubs) {
    const pos = q.indexOf(sub)
    if (pos === -1) continue
    const overlaps = Array.from({ length: sub.length }, (_, i) => i).some(i => usedPos.has(pos + i))
    if (!overlaps) {
      tokens.push(sub)
      for (let i = 0; i < sub.length; i++) usedPos.add(pos + i)
    }
  }
  if (tokens.length === 0) return []

  // AND intersection first (precision). If no match, fall back to longest token only —
  // avoids noise tokens (e.g. "หม" from "ไหม") polluting an OR-expanded result set.
  const andResult = searchFn(tokens, 'and')
  if (andResult.length > 0) return andResult
  return searchFn([tokens[0]], 'and')
}

function dbAnchoredSearch(
  query: string,
  existsFn: (sub: string) => boolean,
  searchFn: (tokens: string[], mode: 'and' | 'or') => unknown[]
): unknown[] {
  if (!query || query.trim() === '') return searchFn([''], 'or')
  const q = query.trim()

  // Step 1: exact full-query match
  const exact = searchFn([q], 'and')
  if (exact.length > 0) return exact

  // Step 2: if query has spaces, try each space-separated segment first.
  // "หมูสับ มีกี่โล" → try "หมูสับ" → finds results without processing noise words.
  if (q.includes(' ')) {
    const segments = q.split(/\s+/).filter(s => s.length >= 2)
    for (const seg of segments) {
      const segExact = searchFn([seg], 'and')
      if (segExact.length > 0) return segExact
      const segResult = anchorTokens(seg, existsFn, searchFn)
      if (segResult.length > 0) return segResult
    }
  }

  // Step 3: full-query DB-anchored token intersection
  return anchorTokens(q, existsFn, searchFn)
}

// Build a WHERE clause from tokens with the given mode
function tokenWhere(col: string, tokens: string[], mode: 'and' | 'or'): string {
  const clause = tokens.map(() => `${col} LIKE ?`).join(` ${mode.toUpperCase()} `)
  return `(${clause})`
}
function tokenParams(tokens: string[]): string[] {
  return tokens.map(t => `%${t}%`)
}

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerTools(server: IMcpServer, tenantId: string): void {

  // ── 1. search ──────────────────────────────────────────────────────────────
  server.tool(
    'search',
    `ค้นหาข้อมูลใดๆ ใน ERP — ส่ง query ตามที่ผู้ใช้พูดมาเลย ไม่ต้อง extract keyword
ระบบจะ tokenize คำค้นหาเองโดยใช้ฐานข้อมูลเป็น vocabulary แล้วค้นหาแบบ AND intersection
category: "stock"=สต็อก, "bom"=สูตรผลิต, "customer"=ลูกค้า ถ้าไม่ระบุค้นทุก category
ตัวอย่าง:
  "เนื้อหมูสับ มีกี่โล"       → search(query="เนื้อหมูสับ", category="stock")
  "ลูกค้าสมชาย เบอร์โทรอะไร"  → search(query="สมชาย", category="customer")
  "BOM กาแฟใช้วัตถุดิบอะไร"    → search(query="กาแฟ", category="bom")
  "มีสินค้าชนิดไหนใกล้หมด"     → search(query="", category="stock") ใช้ low_stock=true`,
    {
      query: z.string().describe('คำค้นหา ส่งมาตรงๆ ตามที่ผู้ใช้พูด'),
      category: z.enum(['stock', 'bom', 'customer']).optional()
        .describe('หมวดหมู่ที่จะค้น ถ้าไม่ระบุค้นทุกหมวด'),
      low_stock: z.boolean().optional()
        .describe('true = แสดงเฉพาะสต็อกที่ต่ำกว่า min_stock'),
    },
    async (args) => {
      const query = (args.query ?? '').trim()
      const cat = args.category
      const lowStock = args.low_stock ?? false
      const results: Record<string, unknown> = {}

      if (!cat || cat === 'stock') {
        const lowWhere = lowStock ? 'AND si.quantity <= si.min_stock' : ''
        const existsStmt = db.prepare(
          `SELECT 1 FROM stock_items si WHERE si.tenant_id = ? AND si.name LIKE ? LIMIT 1`
        )
        const searchStmt = (where: string) =>
          `SELECT si.sku, si.name, si.quantity, si.unit, si.min_stock, si.unit_cost, si.location
           FROM stock_items si
           WHERE si.tenant_id = ? AND ${where} ${lowWhere}
           ORDER BY si.name LIMIT 20`

        const stockItems = dbAnchoredSearch(
          query,
          sub => existsStmt.get(tenantId, `%${sub}%`) !== undefined,
          (tokens, mode) => {
            if (tokens[0] === '' || query === '') {
              return db.prepare(searchStmt('1=1')).all(tenantId)
            }
            const w = tokenWhere('si.name', tokens, mode)
            return db.prepare(searchStmt(w)).all(tenantId, ...tokenParams(tokens))
          }
        )
        if (stockItems.length > 0 || cat === 'stock') {
          results.stock = { count: stockItems.length, items: stockItems }
        }
      }

      if (!cat || cat === 'bom') {
        const existsStmt = db.prepare(
          `SELECT 1 FROM boms WHERE tenant_id = ? AND name LIKE ? LIMIT 1`
        )
        const boms = dbAnchoredSearch(
          query,
          sub => existsStmt.get(tenantId, `%${sub}%`) !== undefined,
          (tokens, mode) => {
            const w = tokens[0] === '' ? '1=1' : tokenWhere('name', tokens, mode)
            const rows = db.prepare(
              `SELECT id, name, status, total_cost, yield_qty, yield_unit
               FROM boms WHERE tenant_id = ? AND ${w} LIMIT 5`
            ).all(tenantId, ...(tokens[0] === '' ? [] : tokenParams(tokens))) as Array<{
              id: string; name: string; status: string
              total_cost: number; yield_qty: number; yield_unit: string
            }>
            return rows.map(bom => ({
              ...bom,
              items: db.prepare(
                `SELECT bi.quantity, bi.unit,
                        COALESCE(m.name, p.name, 'Unknown') as material_name,
                        COALESCE(m.unit_cost, 0) as unit_cost
                 FROM bom_items bi
                 LEFT JOIN materials m ON bi.material_id = m.id
                 LEFT JOIN products p ON bi.product_id = p.id
                 WHERE bi.bom_id = ?`
              ).all(bom.id),
            }))
          }
        )
        if (boms.length > 0 || cat === 'bom') {
          results.bom = { count: boms.length, items: boms }
        }
      }

      if (!cat || cat === 'customer') {
        const existsStmt = db.prepare(
          `SELECT 1 FROM customers WHERE tenant_id = ? AND (name LIKE ? OR phone LIKE ? OR code LIKE ?) LIMIT 1`
        )
        const customers = dbAnchoredSearch(
          query,
          sub => existsStmt.get(tenantId, `%${sub}%`, `%${sub}%`, `%${sub}%`) !== undefined,
          (tokens, mode) => {
            if (tokens[0] === '') {
              return db.prepare(
                `SELECT code, name, phone, email, credit_limit, status
                 FROM customers WHERE tenant_id = ? LIMIT 10`
              ).all(tenantId)
            }
            const nameW = tokenWhere('name', tokens, mode)
            const phoneW = tokenWhere('phone', tokens, mode)
            const codeW = tokenWhere('code', tokens, mode)
            const params = [
              tenantId,
              ...tokenParams(tokens),
              ...tokenParams(tokens),
              ...tokenParams(tokens),
            ]
            return db.prepare(
              `SELECT code, name, phone, email, credit_limit, status
               FROM customers WHERE tenant_id = ? AND (${nameW} OR ${phoneW} OR ${codeW})
               LIMIT 10`
            ).all(...params)
          }
        )
        if (customers.length > 0 || cat === 'customer') {
          results.customer = { count: customers.length, items: customers }
        }
      }

      const totalFound = Object.values(results).reduce(
        (s: number, v) => s + (v as { count: number }).count, 0
      )
      return ok({ query, total_found: totalFound, results })
    }
  )

  // ── 2. get_summary ─────────────────────────────────────────────────────────
  server.tool(
    'get_summary',
    'ดูภาพรวม ERP: สต็อก ยอดขาย PO ใบสั่งผลิต / Full ERP dashboard snapshot. ใช้เมื่อถามสรุปภาพรวม สถานการณ์ทั้งหมด หรือ dashboard',
    {},
    async () => {
      const stock = db.prepare(
        `SELECT COUNT(*) as total_items,
                SUM(CASE WHEN quantity <= min_stock THEN 1 ELSE 0 END) as low_stock,
                COALESCE(SUM(quantity * unit_cost), 0) as stock_value
         FROM stock_items WHERE tenant_id = ?`
      ).get(tenantId) as { total_items: number; low_stock: number; stock_value: number }

      const sales = db.prepare(
        `SELECT COUNT(*) as orders, COALESCE(SUM(total_amount), 0) as revenue
         FROM sales_orders
         WHERE tenant_id = ? AND created_at >= date('now', '-30 days') AND status != 'CANCELLED'`
      ).get(tenantId) as { orders: number; revenue: number }

      const purchase = db.prepare(
        `SELECT COUNT(*) as pos, COALESCE(SUM(total_amount), 0) as committed
         FROM purchase_orders WHERE tenant_id = ? AND status IN ('APPROVED','PARTIAL')`
      ).get(tenantId) as { pos: number; committed: number }

      const work = db.prepare(
        `SELECT COUNT(*) as active_wo
         FROM work_orders WHERE tenant_id = ? AND status IN ('PLANNED','IN_PROGRESS')`
      ).get(tenantId) as { active_wo: number }

      const lowStockItems = db.prepare(
        `SELECT name, quantity, unit, min_stock FROM stock_items
         WHERE tenant_id = ? AND quantity <= min_stock ORDER BY (quantity - min_stock) LIMIT 5`
      ).all(tenantId)

      return ok({
        stock: {
          totalItems: stock.total_items,
          lowStock: stock.low_stock,
          stockValue: stock.stock_value,
          lowStockItems,
        },
        sales_30d: { orders: sales.orders, revenue: sales.revenue },
        purchase: { openPOs: purchase.pos, committedSpend: purchase.committed },
        production: { activeWorkOrders: work.active_wo },
      })
    }
  )

  // ── 3. get_sales ───────────────────────────────────────────────────────────
  server.tool(
    'get_sales',
    'ดูยอดขายและรายได้แยกตามช่วงเวลา / Query sales revenue over a time period. ใช้เมื่อถามยอดขาย รายได้ ออเดอร์',
    {
      period: z.enum(['7d', '30d', '90d']).optional()
        .describe('ช่วงเวลา: 7d=7วัน 30d=เดือนนี้ 90d=3เดือน (default: 30d)'),
    },
    async (args) => {
      const period = args.period ?? '30d'
      const days = ({ '7d': 7, '30d': 30, '90d': 90 } as Record<string, number>)[period] ?? 30
      const rows = db.prepare(
        `SELECT strftime('%Y-%m-%d', created_at) as date,
                COUNT(*) as order_count,
                COALESCE(SUM(total_amount), 0) as revenue
         FROM sales_orders
         WHERE tenant_id = ? AND created_at >= date('now', ?) AND status != 'CANCELLED'
         GROUP BY date ORDER BY date`
      ).all(tenantId, `-${days} days`) as Array<{ date: string; order_count: number; revenue: number }>
      const total = rows.reduce((s, r) => s + r.revenue, 0)
      const totalOrders = rows.reduce((s, r) => s + r.order_count, 0)
      return ok({ period, total_revenue: total, total_orders: totalOrders, daily: rows })
    }
  )

  // ── 4. get_orders ──────────────────────────────────────────────────────────
  server.tool(
    'get_orders',
    `ดูใบสั่งผลิต (WO) และใบสั่งซื้อ (PO) / View work orders and purchase orders.
ใช้เมื่อถามเกี่ยวกับการผลิต ใบสั่งซื้อ หรือสถานะออเดอร์
type: "wo"=ใบสั่งผลิต "po"=ใบสั่งซื้อ ไม่ระบุ=ทั้งคู่`,
    {
      type: z.enum(['wo', 'po']).optional().describe('"wo"=work orders, "po"=purchase orders, ไม่ระบุ=ทั้งคู่'),
      status: z.string().optional().describe('สถานะ: WO=PLANNED/IN_PROGRESS/COMPLETED/CANCELLED, PO=DRAFT/PENDING/APPROVED/PARTIAL/RECEIVED/CANCELLED'),
    },
    async (args) => {
      const { type, status } = args
      const result: Record<string, unknown> = {}

      if (!type || type === 'wo') {
        const statusFilter = status
          ? 'AND wo.status = ?'
          : "AND wo.status IN ('PLANNED','IN_PROGRESS')"
        const params = status ? [tenantId, status] : [tenantId]
        result.work_orders = db.prepare(
          `SELECT wo.wo_number, p.name as product, wo.quantity, wo.unit, wo.status,
                  wo.planned_start, wo.planned_end, wo.notes
           FROM work_orders wo LEFT JOIN products p ON wo.product_id = p.id
           WHERE wo.tenant_id = ? ${statusFilter}
           ORDER BY wo.created_at DESC LIMIT 20`
        ).all(...params)
      }

      if (!type || type === 'po') {
        const statusFilter = status
          ? 'AND po.status = ?'
          : "AND po.status IN ('PENDING','APPROVED','PARTIAL')"
        const params = status ? [tenantId, status] : [tenantId]
        result.purchase_orders = db.prepare(
          `SELECT po.po_number, s.name as supplier, po.total_amount, po.status,
                  po.expected_date, po.notes
           FROM purchase_orders po LEFT JOIN suppliers s ON po.supplier_id = s.id
           WHERE po.tenant_id = ? ${statusFilter}
           ORDER BY po.created_at DESC LIMIT 20`
        ).all(...params)
      }

      return ok(result)
    }
  )

  // ── 5. create_purchase_request ─────────────────────────────────────────────
  server.tool(
    'create_purchase_request',
    'สร้างใบขอซื้อวัตถุดิบ / Create a purchase request (PR). ใช้เมื่อผู้ใช้ต้องการสั่งซื้อ ขอซื้อ หรือเปิด PR',
    {
      description: z.string().describe('รายละเอียดการขอซื้อ เช่น "ขอซื้อหมูสับ 5 กก. และพริก 2 กก."'),
      items: z.array(z.object({
        name: z.string(),
        qty: z.number(),
        unit: z.string(),
      })).optional().describe('รายการวัตถุดิบ (optional)'),
    },
    async (args) => {
      const desc = args.description ?? ''
      const id = crypto.randomUUID().replace(/-/g, '').substring(0, 25)
      const count = (db.prepare('SELECT COUNT(*) as c FROM purchase_requests').get() as { c: number }).c
      const prNumber = `PR-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`
      const now = new Date().toISOString()
      db.prepare(
        `INSERT INTO purchase_requests (id, tenant_id, pr_number, status, notes, created_by, created_at, updated_at)
         VALUES (?, ?, ?, 'DRAFT', ?, 'mcp-agent', ?, ?)`
      ).run(id, tenantId, prNumber, desc, now, now)
      return ok({ prNumber, prId: id, status: 'DRAFT', message: `สร้างใบขอซื้อ ${prNumber} สำเร็จ` })
    }
  )

  // ── 6. create_draft_po ─────────────────────────────────────────────────────
  server.tool(
    'create_draft_po',
    `สร้างใบสั่งซื้อ (PO) แบบร่างจากรูปภาพหรือรายการที่อ่านได้ / Create a DRAFT Purchase Order from image or list.
ใช้เมื่อผู้ใช้ส่งรูปใบสั่งซื้อ รายการสินค้า หรือบอกรายการที่ต้องการสั่งซื้อพร้อมปริมาณและราคา
ระบบจะสร้าง PO สถานะ DRAFT ให้ผู้ใช้ไปยืนยันและแก้ไขต่อใน ERP web ก่อน submit
ตัวอย่าง: "สั่งหมูสับ 5 กก. ราคา 120 บาท/กก., ไข่ไก่ 30 ฟอง ราคา 4 บาท" → create_draft_po(items=[...], notes="จากรูปภาพ")`,
    {
      items: z.array(z.object({
        description: z.string().describe('ชื่อสินค้า/วัตถุดิบ'),
        quantity: z.number().describe('จำนวน'),
        unit: z.string().describe('หน่วย เช่น กก. ฟอง ถุง ลัง'),
        unitPrice: z.number().describe('ราคาต่อหน่วย (ถ้าไม่รู้ใส่ 0)'),
      })).describe('รายการสินค้าที่อ่านได้จากรูปหรือข้อความ'),
      supplier_hint: z.string().optional().describe('ชื่อซัพพลายเออร์ถ้าอ่านได้จากรูป'),
      notes: z.string().optional().describe('หมายเหตุ เช่น "จากรูปภาพใบสั่งซื้อ" หรือ "จาก AI อ่านรูป"'),
    },
    async (args) => {
      const { items, supplier_hint, notes } = args
      const id = crypto.randomUUID().replace(/-/g, '').substring(0, 25)
      const count = (db.prepare('SELECT COUNT(*) as c FROM purchase_orders WHERE tenant_id = ?').get(tenantId) as { c: number }).c
      const poNumber = `PO-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`
      const now = new Date().toISOString()

      const subtotal = items.reduce((s: number, i: { quantity: number; unitPrice: number }) => s + i.quantity * i.unitPrice, 0)

      db.prepare(`
        INSERT INTO purchase_orders
          (id, tenant_id, po_number, supplier_id, status, order_date, subtotal, tax_rate, tax_amount, total_amount, notes, created_at, updated_at)
        VALUES (?, ?, ?, NULL, 'DRAFT', ?, ?, 0, 0, ?, ?, ?, ?)
      `).run(id, tenantId, poNumber, now, subtotal, subtotal,
        `[AI Draft] ${notes ?? supplier_hint ?? 'จากรูปภาพ'}`, now, now)

      const insertItem = db.prepare(`
        INSERT INTO purchase_order_items
          (id, tenant_id, purchase_order_id, material_id, description, quantity, unit, unit_price, total_price, notes)
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, '')
      `)
      for (const item of items) {
        insertItem.run(
          crypto.randomUUID().replace(/-/g, '').substring(0, 25),
          tenantId, id, item.description, item.quantity, item.unit,
          item.unitPrice, item.quantity * item.unitPrice
        )
      }

      return ok({
        poNumber,
        poId: id,
        status: 'DRAFT',
        itemCount: items.length,
        totalAmount: subtotal,
        message: `สร้าง Draft PO ${poNumber} แล้ว (${items.length} รายการ มูลค่า ฿${subtotal.toLocaleString()}) — กรุณาไปยืนยันและเลือก Supplier ใน ERP web ก่อน Submit`,
        supplier_hint: supplier_hint ?? null,
      })
    }
  )
}
