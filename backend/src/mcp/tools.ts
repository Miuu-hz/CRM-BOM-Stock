// MCP tool handlers — DB-Anchored Token Intersection search
// 5 tools: search, get_summary, get_sales, get_orders, create_purchase_request
//
// Core idea: use the database itself as a Thai vocabulary.
// "เนื้อหมูสับ" → substrings → filter those that exist in DB → greedy non-overlap tokens
// → AND search (fallback OR) → precise results without a Thai NLP library.

import { z } from 'zod'
import db from '../db/sqlite'
import { IMcpServer } from './sdk-compat'
import { randomUUID } from 'crypto'
import { convertQuantityBidirectional, autoUnpackIfNeeded, normalizeUnit } from '../services/unitConversion.service'

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

export function registerTools(server: IMcpServer, tenantId: string, userId = 'mcp-agent'): void {

  // ── 1. search ──────────────────────────────────────────────────────────────
  server.tool(
    'search',
    `ค้นหาข้อมูลใดๆ ใน ERP — ส่ง query ตามที่ผู้ใช้พูดมาเลย ไม่ต้อง extract keyword
ระบบจะ tokenize คำค้นหาเองโดยใช้ฐานข้อมูลเป็น vocabulary แล้วค้นหาแบบ AND intersection
category: "stock"=สต็อก, "bom"=สูตรผลิต, "customer"=ลูกค้า ถ้าไม่ระบุค้นทุก category
stock_type: ใช้ร่วมกับ category="stock" เพื่อกรองประเภทสินค้า — raw=วัตถุดิบ, finished=สินค้าสำเร็จรูป/เมนู, wip=กึ่งสำเร็จรูป
ตัวอย่าง:
  "เนื้อหมูสับ มีกี่โล"       → search(query="เนื้อหมูสับ", category="stock", stock_type="raw")
  "ข้าวกะเพรามีกี่จาน"         → search(query="ข้าวกะเพรา", category="stock", stock_type="finished")
  "ลูกค้าสมชาย เบอร์โทรอะไร"  → search(query="สมชาย", category="customer")
  "BOM กาแฟใช้วัตถุดิบอะไร"    → search(query="กาแฟ", category="bom")
  "มีสินค้าชนิดไหนใกล้หมด"     → search(query="", category="stock", low_stock=true)`,
    {
      query: z.string().describe('คำค้นหา ส่งมาตรงๆ ตามที่ผู้ใช้พูด'),
      category: z.enum(['stock', 'bom', 'customer']).optional()
        .describe('หมวดหมู่ที่จะค้น ถ้าไม่ระบุค้นทุกหมวด'),
      stock_type: z.enum(['raw', 'finished', 'wip', 'all']).optional()
        .describe('กรองสต็อกตามประเภทสินค้า: raw=วัตถุดิบ, finished=สินค้าสำเร็จรูป/เมนู, wip=กึ่งสำเร็จรูป, all=ทั้งหมด (default: all). ใช้เมื่อผู้ใช้ถามเฉพาะวัตถุดิบหรือเฉพาะเมนู'),
      low_stock: z.boolean().optional()
        .describe('true = แสดงเฉพาะสต็อกที่ต่ำกว่า min_stock'),
    },
    async (args) => {
      const query = (args.query ?? '').trim()
      const cat = args.category
      const stockType = args.stock_type ?? 'all'
      const lowStock = args.low_stock ?? false
      const results: Record<string, unknown> = {}

      if (!cat || cat === 'stock') {
        const lowWhere = lowStock ? 'AND si.quantity <= si.min_stock' : ''
        // Map stock_type to category filter
        let categoryWhere = ''
        if (stockType === 'raw') {
          categoryWhere = "AND si.category IN ('raw', 'RAW_MATERIAL')"
        } else if (stockType === 'finished') {
          categoryWhere = "AND si.category IN ('finished', 'FINISHED')"
        } else if (stockType === 'wip') {
          categoryWhere = "AND si.category IN ('wip', 'WIP')"
        }
        const existsStmt = db.prepare(
          `SELECT 1 FROM stock_items si WHERE si.tenant_id = ? AND si.name LIKE ? ${categoryWhere} LIMIT 1`
        )
        const searchStmt = (where: string) =>
          `SELECT si.sku, si.name, si.quantity, si.unit, si.min_stock, si.unit_cost, si.location, si.category
           FROM stock_items si
           WHERE si.tenant_id = ? AND ${where} ${categoryWhere} ${lowWhere}
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
          `SELECT 1 FROM boms b JOIN stock_items p ON b.product_id = p.id WHERE b.tenant_id = ? AND p.name LIKE ? LIMIT 1`
        )
        const boms = dbAnchoredSearch(
          query,
          sub => existsStmt.get(tenantId, `%${sub}%`) !== undefined,
          (tokens, mode) => {
            if (tokens[0] === '' || query === '') {
              const rows = db.prepare(
                `SELECT b.id, b.version, b.status, b.level, b.is_semi_finished, p.name as product_name, p.sku as product_sku
                 FROM boms b
                 JOIN stock_items p ON b.product_id = p.id
                 WHERE b.tenant_id = ? LIMIT 5`
              ).all(tenantId) as Array<{
                id: string; version: string; status: string; level: number; is_semi_finished: number
                product_name: string; product_sku: string
              }>
              return rows.map(bom => ({
                ...bom,
                items: db.prepare(
                  `SELECT bi.quantity, bi.unit, bi.item_type,
                          COALESCE(m.name, 'Unknown') as material_name,
                          COALESCE(m.sku, '') as material_sku,
                          COALESCE(m.unit_cost, 0) as unit_cost
                   FROM bom_items bi
                   LEFT JOIN stock_items m ON bi.material_id = m.id
                   WHERE bi.bom_id = ?`
                ).all(bom.id),
              }))
            }
            const w = tokenWhere('p.name', tokens, mode)
            const rows = db.prepare(
              `SELECT b.id, b.version, b.status, b.level, b.is_semi_finished, p.name as product_name, p.sku as product_sku
               FROM boms b
               JOIN stock_items p ON b.product_id = p.id
               WHERE b.tenant_id = ? AND ${w} LIMIT 5`
            ).all(tenantId, ...tokenParams(tokens)) as Array<{
              id: string; version: string; status: string; level: number; is_semi_finished: number
              product_name: string; product_sku: string
            }>
            return rows.map(bom => ({
              ...bom,
              items: db.prepare(
                `SELECT bi.quantity, bi.unit, bi.item_type,
                        COALESCE(m.name, 'Unknown') as material_name,
                        COALESCE(m.sku, '') as material_sku,
                        COALESCE(m.unit_cost, 0) as unit_cost
                 FROM bom_items bi
                 LEFT JOIN stock_items m ON bi.material_id = m.id
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
          `SELECT wo.wo_number, wo.product_name as product, wo.quantity, wo.status,
                  wo.start_date as planned_start, wo.due_date as planned_end, wo.notes
           FROM work_orders wo
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
      const items = args.items ?? []
      const id = randomUUID().replace(/-/g, '').substring(0, 25)
      const count = (db.prepare('SELECT COUNT(*) as c FROM purchase_requests WHERE tenant_id = ?').get(tenantId) as { c: number }).c
      const prNumber = `PR-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`
      const now = new Date().toISOString()

      db.transaction(() => {
        db.prepare(
          `INSERT INTO purchase_requests (id, tenant_id, pr_number, requester_id, requester_name, supplier_name, source, status, notes, created_at, updated_at)
           VALUES (?, ?, ?, 'mcp-agent', 'MCP Agent', 'TBD', 'MCP', 'DRAFT', ?, ?, ?)`
        ).run(id, tenantId, prNumber, desc, now, now)

        if (items.length > 0) {
          const insertItem = db.prepare(`
            INSERT INTO purchase_request_items
              (id, tenant_id, purchase_request_id, pr_id, description, item_name, quantity, unit, estimated_unit_price, estimated_total_price)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          for (const item of items) {
            insertItem.run(
              randomUUID().replace(/-/g, '').substring(0, 25),
              tenantId, id, id,
              item.name, item.name,
              item.qty, item.unit || 'pcs',
              0, 0
            )
          }
        }
      })()

      return ok({ prNumber, prId: id, status: 'DRAFT', itemCount: items.length, message: `สร้างใบขอซื้อ ${prNumber} สำเร็จ (${items.length} รายการ)` })
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
      const id = randomUUID().replace(/-/g, '').substring(0, 25)
      const count = (db.prepare('SELECT COUNT(*) as c FROM purchase_orders WHERE tenant_id = ?').get(tenantId) as { c: number }).c
      const poNumber = `PO-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`
      const now = new Date().toISOString()

      const subtotal = items.reduce((s: number, i: { quantity: number; unitPrice: number }) => s + i.quantity * i.unitPrice, 0)

      db.prepare(`
        INSERT INTO purchase_orders
          (id, tenant_id, po_number, supplier_id, status, order_date, subtotal, tax_rate, tax_amount, total_amount, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, 0, 0, ?, ?, ?, ?)
      `).run(id, tenantId, poNumber, null, now, subtotal, subtotal,
        `[AI Draft] ${notes ?? supplier_hint ?? 'จากรูปภาพ'}`, now, now)

      const insertItem = db.prepare(`
        INSERT INTO purchase_order_items
          (id, tenant_id, purchase_order_id, material_id, description, quantity, unit, unit_price, total_price, notes)
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, '')
      `)
      for (const item of items) {
        insertItem.run(
          randomUUID().replace(/-/g, '').substring(0, 25),
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

  // ── 7. record_stock_movement ────────────────────────────────────────────────
  server.tool(
    'record_stock_movement',
    `บันทึกการเคลื่อนไหวสต็อก (รับเข้า/เบิกออก/ปรับยอด) / Record stock movement IN, OUT, or ADJUST.
ใช้เมื่อผู้ใช้ต้องการรับสินค้าเข้าคลัง เบิกใช้ หรือปรับยอดสต็อก
ตัวอย่าง: "รับหมูสับเข้า 10 กก." → record_stock_movement(stock_item_id="...", type="IN", quantity=10, unit="kg", notes="รับจากซัพพลายเออร์ A")
"เบิกหมูสับไปทำกะเพรา 2 กก." → record_stock_movement(stock_item_id="...", type="OUT", quantity=2, unit="kg")
ระบบจะแปลงหน่วยอัตโนมัติและทำ auto-unpack ถ้าจำเป็น`,
    {
      stock_item_id: z.string().describe('ID ของ stock item (หรือใช้ sku ถ้าระบุ sku)'),
      type: z.enum(['IN', 'OUT', 'ADJUST']).describe('ประเภท: IN=รับเข้า, OUT=เบิกออก, ADJUST=ปรับยอด'),
      quantity: z.number().describe('จำนวน (ในหน่วยที่ระบุ)'),
      unit: z.string().optional().describe('หน่วย (ถ้าไม่ระบุจะใช้หน่วยของ stock item)'),
      reference: z.string().optional().describe('เลขที่อ้างอิง เช่น PO-2024-00001'),
      notes: z.string().optional().describe('หมายเหตุ'),
      unit_cost: z.number().optional().describe('ราคาต่อหน่วย (ใช้กับ type=IN เท่านั้น)'),
    },
    async (args) => {
      const { stock_item_id, type, quantity, unit, reference, notes, unit_cost } = args

      // Find stock item by ID or SKU
      let item = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(stock_item_id, tenantId) as any
      if (!item) {
        item = db.prepare('SELECT * FROM stock_items WHERE sku = ? AND tenant_id = ?').get(stock_item_id, tenantId) as any
      }
      if (!item) {
        return ok({ success: false, message: `ไม่พบ stock item: ${stock_item_id}` })
      }

      const stockItemId = item.id
      const baseUnit = item.base_unit || item.unit
      const movementUnit = unit || item.unit
      let convertedQuantity = Number(quantity)

      // Convert movement unit to base unit if different
      if (movementUnit !== baseUnit) {
        const conversion = convertQuantityBidirectional(Number(quantity), movementUnit, baseUnit, tenantId, stockItemId)
        if (!conversion) {
          return ok({
            success: false,
            message: `ไม่พบการแปลงหน่วยจาก "${movementUnit}" เป็น "${baseUnit}" กรุณาตั้งค่าการแปลงหน่วยใน Settings > การแปลงหน่วย`,
          })
        }
        convertedQuantity = conversion.converted
      }

      if (type === 'ADJUST' && convertedQuantity < 0) {
        return ok({ success: false, message: 'ปรับยอดสต็อกไม่ได้ — ค่าต้องไม่ติดลบ' })
      }

      let newQuantity = item.quantity
      let newSealedQty = item.sealed_qty ?? 0
      const now = new Date().toISOString()

      if (type === 'IN') {
        newQuantity += convertedQuantity
      } else if (type === 'OUT') {
        // auto-unpack if quantity insufficient but sealed_qty available
        if (item.quantity < convertedQuantity && (item.sealed_qty ?? 0) > 0) {
          const unpack = autoUnpackIfNeeded(item, convertedQuantity, tenantId)
          if (unpack && unpack.unpackedPacks > 0) {
            db.prepare(`
              INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
              VALUES (?, ?, ?, 'UNPACK', ?, ?, ?, ?, 'mcp-agent')
            `).run(
              randomUUID().replace(/-/g, '').substring(0, 25), tenantId, stockItemId,
              unpack.unpackedPacks, reference || 'AUTO',
              `แกะอัตโนมัติ ${unpack.unpackedPacks} ${item.display_unit || ''}`, now
            )
            db.prepare('UPDATE stock_items SET sealed_qty = ?, updated_at = ? WHERE id = ?')
              .run(unpack.sealed_qty, now, stockItemId)
            newSealedQty = unpack.sealed_qty
            newQuantity = unpack.quantity
            item.quantity = unpack.quantity
          }
        }
        if (newQuantity < convertedQuantity) {
          return ok({ success: false, message: 'สต็อกไม่พอสำหรับเบิกออก' })
        }
        newQuantity -= convertedQuantity
      } else if (type === 'ADJUST') {
        newQuantity = convertedQuantity
      }

      if (type === 'IN' && unit_cost !== undefined && unit_cost !== null) {
        db.prepare('UPDATE stock_items SET quantity = ?, unit_cost = ?, updated_at = ? WHERE id = ?')
          .run(newQuantity, Number(unit_cost), now, stockItemId)
      } else {
        db.prepare('UPDATE stock_items SET quantity = ?, updated_at = ? WHERE id = ?')
          .run(newQuantity, now, stockItemId)
      }

      const movementId = randomUUID().replace(/-/g, '').substring(0, 25)
      db.prepare(`
        INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mcp-agent')
      `).run(movementId, tenantId, stockItemId, type, convertedQuantity, movementUnit, Number(quantity), reference || '', notes || '', now)

      const updatedItem = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(stockItemId)
      return ok({
        success: true,
        movementId,
        type,
        stockItem: { id: stockItemId, name: item.name, sku: item.sku, quantity: newQuantity, unit: baseUnit },
        message: `บันทึก${type === 'IN' ? 'รับเข้า' : type === 'OUT' ? 'เบิกออก' : 'ปรับยอด'} ${quantity} ${movementUnit} สำเร็จ`,
      })
    }
  )

  // ── 8. create_work_order ────────────────────────────────────────────────────
  server.tool(
    'create_work_order',
    `สร้างใบสั่งผลิต (Work Order) / Create a work order for production.
ใช้เมื่อต้องการสั่งผลิตสินค้าตาม BOM หรือสั่งผลิตโดยตรง
ถ้ามี bom_id ระบบจะดึงวัตถุดิบจาก BOM อัตโนมัติ
ตัวอย่าง: "สั่งผลิตข้าวกะเพรา 20 จาน" → create_work_order(bom_id="...", product_name="ข้าวกะเพรา", quantity=20)`,
    {
      bom_id: z.string().optional().describe('ID ของ BOM (optional)'),
      product_name: z.string().describe('ชื่อสินค้าที่ต้องการผลิต'),
      quantity: z.number().describe('จำนวนที่ต้องการผลิต'),
      priority: z.enum(['URGENT', 'HIGH', 'NORMAL', 'LOW']).optional().describe('ความสำคัญ (default: NORMAL)'),
      due_date: z.string().optional().describe('กำหนดเสร็จ (ISO date)'),
      notes: z.string().optional().describe('หมายเหตุ'),
    },
    async (args) => {
      const { bom_id, product_name, quantity, priority, due_date, notes } = args

      const id = randomUUID().replace(/-/g, '').substring(0, 25)
      const count = (db.prepare('SELECT COUNT(*) as count FROM work_orders WHERE tenant_id = ?').get(tenantId) as any).count
      const woNumber = `WO-${String(count + 1).padStart(5, '0')}`
      const now = new Date().toISOString()

      let materials: any[] = []
      let estimatedCost = 0

      if (bom_id) {
        const bom = db.prepare('SELECT * FROM boms WHERE id = ? AND tenant_id = ?').get(bom_id, tenantId) as any
        if (!bom) {
          return ok({ success: false, message: `ไม่พบ BOM: ${bom_id}` })
        }
        const bomItems = db.prepare(`
          SELECT bi.*, m.name as material_name, m.unit as material_unit, m.unit_cost
          FROM bom_items bi
          LEFT JOIN stock_items m ON bi.material_id = m.id
          WHERE bi.bom_id = ? AND bi.item_type = 'MATERIAL'
        `).all(bom_id, tenantId) as any[]

        for (const bi of bomItems) {
          const requiredQty = bi.quantity * quantity
          materials.push({
            materialId: bi.material_id,
            materialName: bi.material_name,
            requiredQty: requiredQty,
            unit: bi.unit || bi.material_unit || 'pcs',
            unitCost: bi.unit_cost || 0,
          })
          estimatedCost += requiredQty * (bi.unit_cost || 0)
        }
      }

      db.transaction(() => {
        db.prepare(`
          INSERT INTO work_orders (id, tenant_id, wo_number, bom_id, product_name, quantity, status, priority,
            due_date, notes, estimated_cost, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?)
        `).run(id, tenantId, woNumber, bom_id || null, product_name, quantity,
          priority || 'NORMAL', due_date || null, notes || '', estimatedCost, now, now)

        if (materials.length > 0) {
          const insertMaterial = db.prepare(`
            INSERT INTO work_order_materials (id, tenant_id, work_order_id, material_id, material_name, required_qty, unit, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')
          `)
          for (const m of materials) {
            insertMaterial.run(
              randomUUID().replace(/-/g, '').substring(0, 25),
              tenantId, id, m.materialId, m.materialName, m.requiredQty, m.unit
            )
          }
        }
      })()

      return ok({
        success: true,
        woNumber,
        woId: id,
        status: 'DRAFT',
        productName: product_name,
        quantity,
        materialCount: materials.length,
        estimatedCost,
        message: `สร้างใบสั่งผลิต ${woNumber} สำเร็จ (${materials.length} รายการวัตถุดิบ)`,
      })
    }
  )

  // ── 9. update_work_order_status ─────────────────────────────────────────────
  server.tool(
    'update_work_order_status',
    `เปลี่ยนสถานะใบสั่งผลิต / Update work order status.
สถานะที่เป็นไปได้: DRAFT → PLANNED → IN_PROGRESS → COMPLETED → CANCELLED
เมื่อเปลี่ยนเป็น IN_PROGRESS ระบบจะเบิกวัตถุดิบจากสต็อกอัตโนมัติ
เมื่อเปลี่ยนเป็น COMPLETED ระบบจะรับสินค้าสำเร็จรูปเข้าสต็อก
ตัวอย่าง: "เริ่มผลิต WO-00001" → update_work_order_status(wo_id="...", status="IN_PROGRESS")`,
    {
      wo_id: z.string().describe('ID หรือ WO number ของ work order'),
      status: z.enum(['DRAFT', 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'ON_HOLD']).describe('สถานะใหม่'),
    },
    async (args) => {
      const { wo_id, status } = args

      let wo = db.prepare('SELECT * FROM work_orders WHERE id = ? AND tenant_id = ?').get(wo_id, tenantId) as any
      if (!wo) {
        wo = db.prepare('SELECT * FROM work_orders WHERE wo_number = ? AND tenant_id = ?').get(wo_id, tenantId) as any
      }
      if (!wo) {
        return ok({ success: false, message: `ไม่พบ work order: ${wo_id}` })
      }

      // Enforce valid status transitions
      const validNext: Record<string, string[]> = {
        DRAFT:       ['PLANNED', 'CANCELLED'],
        PLANNED:     ['IN_PROGRESS', 'CANCELLED', 'ON_HOLD'],
        IN_PROGRESS: ['COMPLETED', 'CANCELLED', 'ON_HOLD'],
        ON_HOLD:     ['IN_PROGRESS', 'CANCELLED'],
        COMPLETED:   [],
        CANCELLED:   [],
      }
      const allowed = validNext[wo.status] ?? []
      if (!allowed.includes(status)) {
        return ok({ success: false, message: `ไม่สามารถเปลี่ยนสถานะจาก ${wo.status} เป็น ${status} ได้ (อนุญาต: ${allowed.join(', ') || 'ไม่มี'})` })
      }

      const now = new Date().toISOString()
      const materials = db.prepare('SELECT * FROM work_order_materials WHERE work_order_id = ?').all(wo.id) as any[]

      // When starting production - deduct materials from stock
      if (status === 'IN_PROGRESS' && wo.status !== 'IN_PROGRESS') {
        for (const m of materials) {
          if (m.material_id) {
            const stock = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(m.material_id, tenantId) as any
            if (!stock) continue

            let deductQty = m.required_qty
            let movementNotes = `Material issued for work order ${wo.wo_number}`

            if (m.unit && m.unit !== stock.unit) {
              const converted = convertQuantityBidirectional(Number(m.required_qty), m.unit, stock.unit, tenantId, m.material_id)
              if (converted) {
                deductQty = converted.converted
                movementNotes += ` (converted: ${m.required_qty} ${m.unit} → ${converted.converted.toFixed(4)} ${stock.unit})`
              }
            }

            const needed = Math.floor(deductQty)
            if (stock.quantity < needed && (stock.sealed_qty ?? 0) > 0) {
              const unpack = autoUnpackIfNeeded(stock, needed, tenantId)
              if (unpack && unpack.unpackedPacks > 0) {
                db.prepare('UPDATE stock_items SET sealed_qty = ?, quantity = ?, updated_at = ? WHERE id = ?')
                  .run(unpack.sealed_qty, unpack.quantity, now, stock.id)
                db.prepare(`INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
                  VALUES (?, ?, ?, 'UNPACK', ?, ?, ?, ?, 'mcp-agent')`)
                  .run(randomUUID().replace(/-/g, '').substring(0, 25), tenantId, stock.id, unpack.unpackedPacks,
                    `WO: ${wo.wo_number}`, `แกะอัตโนมัติ ${unpack.unpackedPacks} ${stock.display_unit}`, now)
                stock.quantity = unpack.quantity
              }
            }

            if (stock.quantity < needed) {
              return ok({ success: false, message: `สต็อกไม่พอสำหรับ ${m.material_name}: ต้องการ ${needed} ${stock.unit} มี ${stock.quantity}` })
            }

            db.prepare('UPDATE stock_items SET quantity = quantity - ?, updated_at = ? WHERE id = ?')
              .run(needed, now, stock.id)
            db.prepare(`INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
              VALUES (?, ?, ?, 'OUT', ?, ?, ?, ?, 'mcp-agent')`)
              .run(randomUUID().replace(/-/g, '').substring(0, 25), tenantId, stock.id, needed,
                `WO: ${wo.wo_number}`, movementNotes, now)
            db.prepare("UPDATE work_order_materials SET issued_qty = ?, status = 'ISSUED' WHERE id = ?")
              .run(m.required_qty, m.id)
          }
        }

        db.prepare("UPDATE work_orders SET status = ?, start_date = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
          .run(status, now, now, wo.id, tenantId)
      } else if (status === 'COMPLETED') {
        db.prepare("UPDATE work_orders SET status = ?, completed_date = ?, completed_qty = quantity, updated_at = ? WHERE id = ? AND tenant_id = ?")
          .run(status, now, now, wo.id, tenantId)

        // Add finished product to stock
        if (wo.bom_id) {
          const bom = db.prepare('SELECT product_id FROM boms WHERE id = ?').get(wo.bom_id) as any
          if (bom?.product_id) {
            const finishedStock = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(bom.product_id, tenantId) as any
            if (finishedStock) {
              db.prepare('UPDATE stock_items SET quantity = quantity + ?, updated_at = ? WHERE id = ?')
                .run(wo.quantity, now, finishedStock.id)
              db.prepare(`INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
                VALUES (?, ?, ?, 'IN', ?, ?, ?, ?, 'mcp-agent')`)
                .run(randomUUID().replace(/-/g, '').substring(0, 25), tenantId, finishedStock.id, wo.quantity,
                  `WO: ${wo.wo_number}`, 'Finished goods from production', now)
            }
          }
        }
      } else {
        db.prepare("UPDATE work_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
          .run(status, now, wo.id, tenantId)
      }

      const updated = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(wo.id)
      return ok({ success: true, woId: wo.id, woNumber: wo.wo_number, status, message: `เปลี่ยนสถานะ ${wo.wo_number} เป็น ${status} สำเร็จ` })
    }
  )

  // ── 10. approve_purchase_request ────────────────────────────────────────────
  server.tool(
    'approve_purchase_request',
    `อนุมัติใบขอซื้อ (PR) / Approve a purchase request.
ใช้เมื่อผู้ใช้ต้องการอนุมัติ PR ที่สร้างไว้
ตัวอย่าง: "อนุมัติ PR-2024-00001" → approve_purchase_request(pr_id="...")`,
    {
      pr_id: z.string().describe('ID หรือ PR number ของ purchase request'),
    },
    async (args) => {
      const { pr_id } = args

      let pr = db.prepare('SELECT * FROM purchase_requests WHERE id = ? AND tenant_id = ?').get(pr_id, tenantId) as any
      if (!pr) {
        pr = db.prepare('SELECT * FROM purchase_requests WHERE pr_number = ? AND tenant_id = ?').get(pr_id, tenantId) as any
      }
      if (!pr) {
        return ok({ success: false, message: `ไม่พบ PR: ${pr_id}` })
      }

      const now = new Date().toISOString()
      db.prepare(`
        UPDATE purchase_requests SET status = ?, approved_by = ?, approved_at = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run('APPROVED', userId, now, now, pr.id, tenantId)

      return ok({ success: true, prId: pr.id, prNumber: pr.pr_number, status: 'APPROVED', message: `อนุมัติ ${pr.pr_number} สำเร็จ` })
    }
  )

  // ── 11. convert_pr_to_po ────────────────────────────────────────────────────
  server.tool(
    'convert_pr_to_po',
    `แปลงใบขอซื้อ (PR) เป็นใบสั่งซื้อ (PO) / Convert an approved PR to a Purchase Order.
PR ต้องมีสถานะ APPROVED ก่อน
ตัวอย่าง: "แปลง PR-2024-00001 เป็น PO ซัพพลายเออร์ ABC" → convert_pr_to_po(pr_id="...", supplier_id="...")`,
    {
      pr_id: z.string().describe('ID หรือ PR number'),
      supplier_id: z.string().describe('ID ของ supplier'),
    },
    async (args) => {
      const { pr_id, supplier_id } = args

      let pr = db.prepare('SELECT * FROM purchase_requests WHERE id = ? AND tenant_id = ?').get(pr_id, tenantId) as any
      if (!pr) {
        pr = db.prepare('SELECT * FROM purchase_requests WHERE pr_number = ? AND tenant_id = ?').get(pr_id, tenantId) as any
      }
      if (!pr) {
        return ok({ success: false, message: `ไม่พบ PR: ${pr_id}` })
      }
      if (pr.status !== 'APPROVED') {
        return ok({ success: false, message: `PR ต้องมีสถานะ APPROVED ก่อน (ปัจจุบัน: ${pr.status})` })
      }

      const prItems = db.prepare('SELECT * FROM purchase_request_items WHERE purchase_request_id = ?').all(pr.id) as any[]
      const now = new Date().toISOString()
      const poId = randomUUID().replace(/-/g, '').substring(0, 25)
      const count = (db.prepare('SELECT COUNT(*) as c FROM purchase_orders WHERE tenant_id = ?').get(tenantId) as any).c
      const poNumber = `PO-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`

      let subtotal = 0
      for (const item of prItems) {
        subtotal += (item.estimated_unit_price || 0) * item.quantity
      }
      const taxRate = 7
      const taxAmount = subtotal * (taxRate / 100)
      const totalAmount = subtotal + taxAmount

      db.transaction(() => {
        db.prepare(`
          INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, order_date, expected_date,
            subtotal, tax_rate, tax_amount, total_amount, notes, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(poId, tenantId, poNumber, supplier_id, now, null, subtotal, taxRate, taxAmount, totalAmount,
          `Created from PR: ${pr.pr_number}`, now, now)

        const insertItem = db.prepare(`
          INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description,
            quantity, unit, unit_price, total_price, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of prItems) {
          const total = (item.estimated_unit_price || 0) * item.quantity
          insertItem.run(randomUUID().replace(/-/g, '').substring(0, 25), tenantId, poId,
            item.material_id, item.description, item.quantity, item.unit || '',
            item.estimated_unit_price || 0, total, item.notes || '')
        }

        db.prepare("UPDATE purchase_requests SET status = 'CONVERTED', updated_at = ? WHERE id = ?")
          .run(now, pr.id)
      })()

      return ok({
        success: true,
        poNumber,
        poId,
        prNumber: pr.pr_number,
        itemCount: prItems.length,
        totalAmount,
        message: `แปลง ${pr.pr_number} เป็น ${poNumber} สำเร็จ`,
      })
    }
  )

  // ── 12. confirm_goods_receipt ───────────────────────────────────────────────
  server.tool(
    'confirm_goods_receipt',
    `ยืนยันรับสินค้า (GR) / Confirm a goods receipt and update stock.
ใช้เมื่อสินค้ามาถึงและต้องการบันทึกรับเข้าคลัง
ระบบจะแปลงหน่วยอัตโนมัติและอัปเดตสต็อก
ตัวอย่าง: "ยืนยันรับสินค้า GR-2024-00001" → confirm_goods_receipt(gr_id="...")`,
    {
      gr_id: z.string().describe('ID หรือ GR number ของ goods receipt'),
    },
    async (args) => {
      const { gr_id } = args

      let gr = db.prepare('SELECT * FROM goods_receipts WHERE id = ? AND tenant_id = ?').get(gr_id, tenantId) as any
      if (!gr) {
        gr = db.prepare('SELECT * FROM goods_receipts WHERE gr_number = ? AND tenant_id = ?').get(gr_id, tenantId) as any
      }
      if (!gr) {
        return ok({ success: false, message: `ไม่พบ GR: ${gr_id}` })
      }
      if (gr.status === 'CONFIRMED') {
        return ok({ success: false, message: 'GR นี้ถูกยืนยันไปแล้ว' })
      }

      const items = db.prepare('SELECT * FROM goods_receipt_items WHERE goods_receipt_id = ?').all(gr.id) as any[]
      const now = new Date().toISOString()

      try {
        db.transaction(() => {
          db.prepare("UPDATE goods_receipts SET status = 'CONFIRMED', updated_at = ? WHERE id = ?")
            .run(now, gr.id)

          for (const item of items) {
            if (item.material_id && item.accepted_qty > 0) {
              let stockItem = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(item.material_id, tenantId) as any
              if (!stockItem) {
                stockItem = db.prepare('SELECT * FROM stock_items WHERE material_id = ? AND tenant_id = ?').get(item.material_id, tenantId) as any
              }

              let stockQty = item.accepted_qty
              let movementNotes = `Received from purchase`

              if (stockItem) {
                const stockUnit = normalizeUnit(stockItem.unit || '')
                const displayUnit = normalizeUnit(stockItem.display_unit || '')
                const poItem = db.prepare('SELECT unit FROM purchase_order_items WHERE id = ?').get(item.purchase_order_item_id) as any
                const poUnit = normalizeUnit(poItem?.unit || '')

                if (poUnit && displayUnit && poUnit === displayUnit) {
                  db.prepare('UPDATE stock_items SET sealed_qty = COALESCE(sealed_qty, 0) + ?, updated_at = ? WHERE id = ?')
                    .run(Math.floor(item.accepted_qty), now, stockItem.id)
                  movementNotes = `Received as sealed ${poUnit}: ${item.accepted_qty} ${poUnit}`
                } else if (poUnit && poUnit !== stockUnit) {
                  const converted = convertQuantityBidirectional(Number(item.accepted_qty), poUnit, stockUnit, tenantId, item.material_id)
                  if (!converted) {
                    throw new Error(`ไม่พบการแปลงหน่วย ${poUnit} → ${stockUnit} กรุณาตั้งค่า Unit Conversion ก่อน`)
                  }
                  stockQty = converted.converted
                  movementNotes = `Received from purchase (converted: ${item.accepted_qty} ${poUnit} → ${converted.converted.toFixed(4)} ${stockUnit})`
                  db.prepare('UPDATE stock_items SET quantity = quantity + ?, updated_at = ? WHERE id = ?')
                    .run(Math.floor(stockQty), now, stockItem.id)
                } else {
                  db.prepare('UPDATE stock_items SET quantity = quantity + ?, updated_at = ? WHERE id = ?')
                    .run(Math.floor(stockQty), now, stockItem.id)
                }

                db.prepare(`INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
                  VALUES (?, ?, ?, 'IN', ?, ?, ?, ?, 'mcp-agent')`)
                  .run(randomUUID().replace(/-/g, '').substring(0, 25), tenantId, stockItem.id,
                    Math.floor(stockQty), `GR: ${gr.gr_number}`, movementNotes, now)
              }

              db.prepare('UPDATE purchase_order_items SET received_qty = received_qty + ? WHERE id = ?')
                .run(item.accepted_qty, item.purchase_order_item_id)
            }
          }

          // Update PO status
          const poItems = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(gr.purchase_order_id) as any[]
          const allReceived = poItems.every((item: any) => item.received_qty >= item.quantity)
          if (allReceived) {
            db.prepare("UPDATE purchase_orders SET status = 'RECEIVED', received_date = ?, updated_at = ? WHERE id = ?")
              .run(now, now, gr.purchase_order_id)
          } else {
            db.prepare("UPDATE purchase_orders SET status = 'PARTIAL', updated_at = ? WHERE id = ?")
              .run(now, gr.purchase_order_id)
          }
        })()

        return ok({ success: true, grId: gr.id, grNumber: gr.gr_number, message: `ยืนยันรับสินค้า ${gr.gr_number} สำเร็จ` })
      } catch (error: any) {
        return ok({ success: false, message: error.message || 'ยืนยันรับสินค้าไม่สำเร็จ' })
      }
    }
  )

  // ── 13. create_bom ──────────────────────────────────────────────────────────
  server.tool(
    'create_bom',
    `สร้างสูตรผลิต (BOM) / Create a Bill of Materials.
ใช้เมื่อต้องการสร้างสูตรผลิตใหม่
ตัวอย่าง: "สร้าง BOM ข้าวกะเพรา ใช้หมูสับ 200g ข้าว 1จาน" → create_bom(product_id="...", version="v1", items=[{material_id:"...", quantity:200, unit:"g"}, ...])`,
    {
      product_id: z.string().describe('ID ของสินค้าสำเร็จรูป (stock_items.id)'),
      version: z.string().describe('เวอร์ชัน เช่น v1, v2'),
      items: z.array(z.object({
        material_id: z.string().describe('ID วัตถุดิบ (stock_items.id)'),
        quantity: z.number().describe('จำนวน'),
        unit: z.string().optional().describe('หน่วย (ถ้าไม่ระบุจะใช้หน่วยของวัตถุดิบ)'),
        notes: z.string().optional().describe('หมายเหตุ'),
      })).describe('รายการวัตถุดิบ'),
      is_semi_finished: z.boolean().optional().describe('true = สินค้ากึ่งสำเร็จรูป'),
    },
    async (args) => {
      const { product_id, version, items, is_semi_finished } = args

      const product = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(product_id, tenantId) as any
      if (!product) {
        return ok({ success: false, message: `ไม่พบสินค้า: ${product_id}` })
      }

      const existingBOM = db.prepare('SELECT * FROM boms WHERE product_id = ? AND version = ? AND tenant_id = ?').get(product_id, version, tenantId) as any
      if (existingBOM) {
        return ok({ success: false, message: `BOM สำหรับ ${product.name} เวอร์ชัน ${version} มีอยู่แล้ว` })
      }

      const id = randomUUID().replace(/-/g, '').substring(0, 25)
      const now = new Date().toISOString()

      db.transaction(() => {
        db.prepare(`
          INSERT INTO boms (id, tenant_id, product_id, version, status, level, is_semi_finished, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'DRAFT', 0, ?, ?, ?)
        `).run(id, tenantId, product_id, version, is_semi_finished ? 1 : 0, now, now)

        if (items && items.length > 0) {
          const insertItem = db.prepare(`
            INSERT INTO bom_items (id, tenant_id, bom_id, item_type, material_id, quantity, unit, notes, sort_order)
            VALUES (?, ?, ?, 'MATERIAL', ?, ?, ?, ?, ?)
          `)
          for (let i = 0; i < items.length; i++) {
            const item = items[i]
            const material = db.prepare('SELECT id, unit FROM stock_items WHERE id = ? AND tenant_id = ?').get(item.material_id, tenantId) as any
            const itemUnit = item.unit || material?.unit || null
            insertItem.run(randomUUID().replace(/-/g, '').substring(0, 25), tenantId, id,
              item.material_id, item.quantity, itemUnit, item.notes || '', i)
          }
        }
      })()

      return ok({ success: true, bomId: id, productName: product.name, version, itemCount: items?.length || 0, message: `สร้าง BOM ${product.name} v${version} สำเร็จ` })
    }
  )

  // ── 14. explode_bom ─────────────────────────────────────────────────────────
  server.tool(
    'explode_bom',
    `ระเบิด BOM ดูวัตถุดิบทั้งหมด (flatten) / Explode a BOM to see all raw materials needed.
ใช้เมื่อต้องการคำนวณวัตถุดิบรวมสำหรับการผลิตจำนวนหนึ่ง
ตัวอย่าง: "ข้าวกะเพรา 50 จาน ต้องใช้อะไรบ้าง" → explode_bom(bom_id="...", multiplier=50)`,
    {
      bom_id: z.string().describe('ID ของ BOM'),
      multiplier: z.number().optional().describe('จำนวนที่ต้องการผลิต (default: 1)'),
    },
    async (args) => {
      const { bom_id, multiplier = 1 } = args

      const bom = db.prepare('SELECT * FROM boms WHERE id = ? AND tenant_id = ?').get(bom_id, tenantId) as any
      if (!bom) {
        return ok({ success: false, message: `ไม่พบ BOM: ${bom_id}` })
      }

      const explode = (currentBomId: string, qty: number, level: number, visited: Set<string>): any[] => {
        if (visited.has(currentBomId)) return []
        visited.add(currentBomId)

        const items = db.prepare(`
          SELECT bi.*, m.name as material_name, m.sku as material_code, m.unit
          FROM bom_items bi
          LEFT JOIN stock_items m ON bi.material_id = m.id
          WHERE bi.bom_id = ? AND bi.tenant_id = ?
        `).all(currentBomId, tenantId) as any[]

        let result: any[] = []
        for (const item of items) {
          const totalQty = item.quantity * qty
          if (item.item_type === 'CHILD_BOM' && item.child_bom_id) {
            result = [...result, ...explode(item.child_bom_id, totalQty, level + 1, new Set(visited))]
          } else {
            result.push({ materialId: item.material_id, materialName: item.material_name, materialCode: item.material_code, unit: item.unit, quantity: totalQty, level })
          }
        }
        return result
      }

      const exploded = explode(bom_id, multiplier, 0, new Set())
      const grouped = exploded.reduce((acc: any, item: any) => {
        const key = item.materialId
        if (!acc[key]) acc[key] = { ...item, quantity: 0 }
        acc[key].quantity += item.quantity
        return acc
      }, {})

      return ok({
        success: true,
        bomId: bom_id,
        multiplier,
        totalMaterials: Object.values(grouped).length,
        materials: Object.values(grouped),
        rawList: exploded,
      })
    }
  )

  // ── 15. manage_unit_conversion ──────────────────────────────────────────────
  server.tool(
    'manage_unit_conversion',
    `จัดการการแปลงหน่วย (Unit Conversion) / Create, update, or delete unit conversions.
ใช้เมื่อต้องการตั้งค่าหน่วยแปลงใหม่ แก้ไข หรือลบ
ตัวอย่าง:
  สร้าง: manage_unit_conversion(action="create", from_unit="kg", to_unit="g", conversion_factor=1000)
  แก้ไข: manage_unit_conversion(action="update", conversion_id="...", conversion_factor=1200)
  ลบ: manage_unit_conversion(action="delete", conversion_id="...")`,
    {
      action: z.enum(['create', 'update', 'delete']).describe('create | update | delete'),
      conversion_id: z.string().optional().describe('ID สำหรับ update/delete'),
      from_unit: z.string().optional().describe('หน่วยต้นทาง (สำหรับ create)'),
      to_unit: z.string().optional().describe('หน่วยปลายทาง (สำหรับ create)'),
      conversion_factor: z.number().optional().describe('ตัวคูณ (สำหรับ create/update)'),
      material_id: z.string().optional().describe('ID วัตถุดิบถ้าเป็น per-material (optional)'),
      notes: z.string().optional().describe('หมายเหตุ (สำหรับ create/update)'),
    },
    async (args) => {
      const { action, conversion_id, from_unit, to_unit, conversion_factor, material_id, notes } = args

      if (action === 'create') {
        if (!from_unit || !to_unit || conversion_factor == null) {
          return ok({ success: false, message: 'from_unit, to_unit, conversion_factor จำเป็นต้องระบุ' })
        }
        if (Number(conversion_factor) <= 0) {
          return ok({ success: false, message: 'conversion_factor ต้องมากกว่า 0' })
        }
        if (from_unit === to_unit) {
          return ok({ success: false, message: 'หน่วยต้นทางและปลายทางต้องไม่เหมือนกัน' })
        }

        try {
          const id = randomUUID().replace(/-/g, '').substring(0, 25)
          const now = new Date().toISOString()
          db.prepare(`
            INSERT INTO unit_conversions (id, tenant_id, material_id, from_unit, to_unit, conversion_factor, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(id, tenantId, material_id || null, from_unit, to_unit, Number(conversion_factor), notes || '', now, now)

          return ok({ success: true, conversionId: id, from_unit, to_unit, conversion_factor, message: `สร้างการแปลงหน่วย ${from_unit} → ${to_unit} สำเร็จ` })
        } catch (error: any) {
          if (error?.message?.includes('UNIQUE')) {
            return ok({ success: false, message: 'มีการแปลงหน่วยนี้อยู่แล้ว' })
          }
          return ok({ success: false, message: 'สร้างการแปลงหน่วยไม่สำเร็จ' })
        }
      }

      if (action === 'update') {
        if (!conversion_id) {
          return ok({ success: false, message: 'conversion_id จำเป็นต้องระบุ' })
        }
        if (conversion_factor != null && Number(conversion_factor) <= 0) {
          return ok({ success: false, message: 'conversion_factor ต้องมากกว่า 0' })
        }

        const existing = db.prepare('SELECT * FROM unit_conversions WHERE id = ? AND tenant_id = ?').get(conversion_id, tenantId) as any
        if (!existing) {
          return ok({ success: false, message: `ไม่พบ conversion: ${conversion_id}` })
        }

        const now = new Date().toISOString()
        db.prepare(`
          UPDATE unit_conversions SET conversion_factor = COALESCE(?, conversion_factor), notes = COALESCE(?, notes), updated_at = ?
          WHERE id = ? AND tenant_id = ?
        `).run(conversion_factor !== undefined ? Number(conversion_factor) : undefined, notes || undefined, now, conversion_id, tenantId)

        return ok({ success: true, conversionId: conversion_id, message: `อัปเดตการแปลงหน่วยสำเร็จ` })
      }

      if (action === 'delete') {
        if (!conversion_id) {
          return ok({ success: false, message: 'conversion_id จำเป็นต้องระบุ' })
        }
        const existing = db.prepare('SELECT * FROM unit_conversions WHERE id = ? AND tenant_id = ?').get(conversion_id, tenantId) as any
        if (!existing) {
          return ok({ success: false, message: `ไม่พบ conversion: ${conversion_id}` })
        }
        db.prepare('DELETE FROM unit_conversions WHERE id = ? AND tenant_id = ?').run(conversion_id, tenantId)
        return ok({ success: true, message: `ลบการแปลงหน่วยสำเร็จ` })
      }

      return ok({ success: false, message: 'action ไม่ถูกต้อง' })
    }
  )

  // ── 16. get_purchase_requests ───────────────────────────────────────────────
  server.tool(
    'get_purchase_requests',
    `ดูรายการใบขอซื้อ (PR) / List purchase requests with status filter.
ใช้เมื่อถามว่า "PR ไหนรออนุมัติ" "ดู PR ที่สร้างจาก MCP" หรือหา PR number ก่อนอนุมัติ/แปลงเป็น PO
status: DRAFT=ร่าง, PENDING=รออนุมัติ, APPROVED=อนุมัติแล้ว, REJECTED=ปฏิเสธ, CONVERTED=แปลงเป็น PO แล้ว`,
    {
      status: z.enum(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CONVERTED']).optional()
        .describe('กรองตามสถานะ ถ้าไม่ระบุแสดงทั้งหมด'),
      limit: z.number().optional().describe('จำนวนสูงสุด (default: 20)'),
    },
    async (args) => {
      const { status, limit = 20 } = args
      const where = status ? 'AND pr.status = ?' : ''
      const params: any[] = status ? [tenantId, status, limit] : [tenantId, limit]

      const rows = db.prepare(`
        SELECT pr.id, pr.pr_number, pr.status, pr.source, pr.requester_name,
               pr.supplier_name, pr.notes, pr.created_at, pr.approved_at,
               COUNT(pri.id) as item_count
        FROM purchase_requests pr
        LEFT JOIN purchase_request_items pri ON pri.purchase_request_id = pr.id OR pri.pr_id = pr.id
        WHERE pr.tenant_id = ? ${where}
        GROUP BY pr.id
        ORDER BY pr.created_at DESC
        LIMIT ?
      `).all(...params)

      return ok({ count: rows.length, items: rows })
    }
  )

  // ── 17. get_suppliers ───────────────────────────────────────────────────────
  server.tool(
    'get_suppliers',
    `ค้นหาและดูรายชื่อ Supplier / Search suppliers to get their ID for convert_pr_to_po.
ใช้เมื่อต้องการหา supplier_id สำหรับสร้าง PO หรือดูรายชื่อซัพพลายเออร์ทั้งหมด
ตัวอย่าง: "ซัพพลายเออร์ชื่อ ABC คือใคร" → get_suppliers(query="ABC")`,
    {
      query: z.string().optional().describe('ค้นหาจากชื่อ, รหัส, เบอร์โทร, ชื่อผู้ติดต่อ'),
      status: z.enum(['ACTIVE', 'INACTIVE']).optional().describe('กรองตามสถานะ (default: ACTIVE)'),
    },
    async (args) => {
      const { query, status = 'ACTIVE' } = args
      const searchTerm = query ? `%${query}%` : null

      const rows = searchTerm
        ? db.prepare(`
            SELECT id, code, name, contact_name, phone, email, payment_terms, rating, status
            FROM suppliers
            WHERE tenant_id = ? AND status = ?
              AND (name LIKE ? OR code LIKE ? OR contact_name LIKE ? OR phone LIKE ?)
            ORDER BY name LIMIT 20
          `).all(tenantId, status, searchTerm, searchTerm, searchTerm, searchTerm)
        : db.prepare(`
            SELECT id, code, name, contact_name, phone, email, payment_terms, rating, status
            FROM suppliers
            WHERE tenant_id = ? AND status = ?
            ORDER BY name LIMIT 30
          `).all(tenantId, status)

      return ok({ count: (rows as any[]).length, suppliers: rows })
    }
  )

  // ── 18. get_stock_movements ─────────────────────────────────────────────────
  server.tool(
    'get_stock_movements',
    `ดูประวัติการเคลื่อนไหวสต็อก / View stock movement history.
ใช้เมื่อถามว่า "หมูสับรับเข้าเมื่อไหร่" "เบิกออกไปเท่าไหร่" "ประวัติการเคลื่อนไหวเดือนนี้"
ต้องระบุ stock_item_id หรือใช้ search() หาก่อน`,
    {
      stock_item_id: z.string().describe('ID หรือ SKU ของ stock item'),
      type: z.enum(['IN', 'OUT', 'ADJUST', 'UNPACK']).optional().describe('กรองประเภท IN=รับเข้า OUT=เบิก ADJUST=ปรับ'),
      days: z.number().optional().describe('ย้อนหลังกี่วัน (default: 30)'),
    },
    async (args) => {
      const { stock_item_id, type, days = 30 } = args

      let item = db.prepare('SELECT id, name, sku, unit, quantity FROM stock_items WHERE id = ? AND tenant_id = ?').get(stock_item_id, tenantId) as any
      if (!item) {
        item = db.prepare('SELECT id, name, sku, unit, quantity FROM stock_items WHERE sku = ? AND tenant_id = ?').get(stock_item_id, tenantId) as any
      }
      if (!item) return ok({ success: false, message: `ไม่พบ stock item: ${stock_item_id}` })

      const typeFilter = type ? 'AND type = ?' : ''
      const queryParams: any[] = [item.id, `-${days} days`]
      if (type) queryParams.push(type)

      const movements = db.prepare(`
        SELECT type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by
        FROM stock_movements
        WHERE stock_item_id = ? AND created_at >= date('now', ?)
        ${typeFilter}
        ORDER BY created_at DESC LIMIT 50
      `).all(...queryParams)

      const totalIn = (movements as any[]).filter(m => m.type === 'IN').reduce((s, m) => s + m.quantity, 0)
      const totalOut = (movements as any[]).filter(m => m.type === 'OUT').reduce((s, m) => s + m.quantity, 0)

      return ok({
        item: { id: item.id, name: item.name, sku: item.sku, current_quantity: item.quantity, unit: item.unit },
        period_days: days,
        total_in: totalIn,
        total_out: totalOut,
        movements,
      })
    }
  )

  // ── 19. get_ar_aging ────────────────────────────────────────────────────────
  server.tool(
    'get_ar_aging',
    `ดูลูกหนี้การค้า (AR Aging) — ลูกค้าใครยังไม่จ่ายเงิน ค้างนานแค่ไหน / Accounts Receivable aging report.
ใช้เมื่อถาม "ลูกค้าใครค้างชำระ" "บิลไหนเกินกำหนด" "ยอดลูกหนี้รวมเท่าไหร่"
แสดง: ชื่อลูกค้า, เลขบิล, ยอดค้าง, วันครบกำหนด, จำนวนวันที่เกิน`,
    {
      overdue_only: z.boolean().optional().describe('true=เฉพาะที่เกินกำหนดแล้ว, false=ทั้งหมดที่ยังไม่จ่าย (default: false)'),
      customer_name: z.string().optional().describe('กรองเฉพาะลูกค้ารายนี้'),
    },
    async (args) => {
      const { overdue_only = false, customer_name } = args

      const overdueFilter = overdue_only ? "AND date(inv.due_date) < date('now')" : ''
      const customerFilter = customer_name ? 'AND c.name LIKE ?' : ''
      const params: any[] = [tenantId]
      if (customer_name) params.push(`%${customer_name}%`)

      const rows = db.prepare(`
        SELECT inv.invoice_number, inv.invoice_date, inv.due_date,
               inv.total_amount, inv.paid_amount, inv.balance_amount,
               inv.payment_status,
               c.name as customer_name, c.phone as customer_phone,
               CAST(julianday('now') - julianday(inv.due_date) AS INTEGER) as days_overdue
        FROM invoices inv
        JOIN customers c ON inv.customer_id = c.id
        WHERE inv.tenant_id = ?
          AND inv.payment_status IN ('UNPAID','PARTIAL')
          ${overdueFilter}
          ${customerFilter}
        ORDER BY days_overdue DESC, inv.due_date ASC
        LIMIT 50
      `).all(...params) as any[]

      const totalBalance = rows.reduce((s, r) => s + (r.balance_amount || 0), 0)
      const overdueCount = rows.filter(r => r.days_overdue > 0).length
      const overdueAmount = rows.filter(r => r.days_overdue > 0).reduce((s, r) => s + (r.balance_amount || 0), 0)

      // Bucket ตาม aging
      const bucket = (days: number) =>
        days <= 0 ? 'ยังไม่ถึงกำหนด' :
        days <= 30 ? '1-30 วัน' :
        days <= 60 ? '31-60 วัน' :
        days <= 90 ? '61-90 วัน' : 'เกิน 90 วัน'

      const buckets = rows.reduce((acc: Record<string, number>, r) => {
        const b = bucket(r.days_overdue)
        acc[b] = (acc[b] || 0) + (r.balance_amount || 0)
        return acc
      }, {})

      return ok({
        summary: { total_unpaid_invoices: rows.length, total_balance: totalBalance, overdue_count: overdueCount, overdue_amount: overdueAmount },
        aging_buckets: buckets,
        invoices: rows,
      })
    }
  )

  // ── 20. get_ap_aging ────────────────────────────────────────────────────────
  server.tool(
    'get_ap_aging',
    `ดูเจ้าหนี้การค้า (AP Aging) — เราค้างจ่าย Supplier ไหน ครบกำหนดแล้วหรือยัง / Accounts Payable aging report.
ใช้เมื่อถาม "เราต้องจ่าย supplier ไหนบ้าง" "บิลซื้อไหนถึงกำหนดแล้ว" "ยอดเจ้าหนี้รวมเท่าไหร่"`,
    {
      overdue_only: z.boolean().optional().describe('true=เฉพาะที่เกินกำหนดแล้ว (default: false)'),
      supplier_name: z.string().optional().describe('กรองเฉพาะ supplier รายนี้'),
    },
    async (args) => {
      const { overdue_only = false, supplier_name } = args

      const overdueFilter = overdue_only ? "AND date(pi.due_date) < date('now')" : ''
      const supplierFilter = supplier_name ? 'AND s.name LIKE ?' : ''
      const params: any[] = [tenantId]
      if (supplier_name) params.push(`%${supplier_name}%`)

      const rows = db.prepare(`
        SELECT pi.pi_number, pi.invoice_date, pi.due_date,
               pi.total_amount, pi.paid_amount, pi.balance_amount,
               pi.payment_status,
               s.name as supplier_name, s.phone as supplier_phone,
               CAST(julianday('now') - julianday(pi.due_date) AS INTEGER) as days_overdue
        FROM purchase_invoices pi
        JOIN suppliers s ON pi.supplier_id = s.id
        WHERE pi.tenant_id = ?
          AND pi.payment_status IN ('UNPAID','PARTIAL')
          ${overdueFilter}
          ${supplierFilter}
        ORDER BY days_overdue DESC, pi.due_date ASC
        LIMIT 50
      `).all(...params) as any[]

      const totalBalance = rows.reduce((s, r) => s + (r.balance_amount || 0), 0)
      const overdueCount = rows.filter(r => r.days_overdue > 0).length
      const overdueAmount = rows.filter(r => r.days_overdue > 0).reduce((s, r) => s + (r.balance_amount || 0), 0)

      const bucket = (days: number) =>
        days <= 0 ? 'ยังไม่ถึงกำหนด' :
        days <= 30 ? '1-30 วัน' :
        days <= 60 ? '31-60 วัน' :
        days <= 90 ? '61-90 วัน' : 'เกิน 90 วัน'

      const buckets = rows.reduce((acc: Record<string, number>, r) => {
        const b = bucket(r.days_overdue)
        acc[b] = (acc[b] || 0) + (r.balance_amount || 0)
        return acc
      }, {})

      return ok({
        summary: { total_unpaid_invoices: rows.length, total_balance: totalBalance, overdue_count: overdueCount, overdue_amount: overdueAmount },
        aging_buckets: buckets,
        invoices: rows,
      })
    }
  )

  // ── 21. get_financial_summary ───────────────────────────────────────────────
  server.tool(
    'get_financial_summary',
    `สรุปภาพรวมการเงิน — รายรับ รายจ่าย กำไรขั้นต้น ยอด AR/AP / Financial P&L and balance summary.
ใช้เมื่อถาม "สรุปบัญชีเดือนนี้" "รายรับรายจ่ายเป็นยังไง" "กำไรเดือนนี้เท่าไหร่" "ภาพรวมการเงิน"`,
    {
      period: z.enum(['7d', '30d', '90d', 'ytd']).optional()
        .describe('ช่วงเวลา: 7d=7วัน, 30d=เดือนนี้, 90d=3เดือน, ytd=ตั้งแต่ต้นปี (default: 30d)'),
    },
    async (args) => {
      const { period = '30d' } = args
      const dateFilter = period === 'ytd'
        ? `date('now','start of year')`
        : `date('now', '-${({ '7d': 7, '30d': 30, '90d': 90 } as Record<string, number>)[period] ?? 30} days')`

      // รายรับจากบิลขาย (invoices ที่ออกในช่วง)
      const revenue = db.prepare(`
        SELECT COALESCE(SUM(total_amount), 0) as total,
               COALESCE(SUM(paid_amount), 0) as collected,
               COALESCE(SUM(balance_amount), 0) as outstanding,
               COUNT(*) as invoice_count
        FROM invoices
        WHERE tenant_id = ? AND invoice_date >= ${dateFilter}
          AND status NOT IN ('CANCELLED','DRAFT')
      `).get(tenantId) as any

      // รายจ่ายจากบิลซื้อ (purchase_invoices)
      const expense = db.prepare(`
        SELECT COALESCE(SUM(total_amount), 0) as total,
               COALESCE(SUM(paid_amount), 0) as paid,
               COALESCE(SUM(balance_amount), 0) as outstanding,
               COUNT(*) as invoice_count
        FROM purchase_invoices
        WHERE tenant_id = ? AND invoice_date >= ${dateFilter}
          AND status NOT IN ('CANCELLED','DRAFT')
      `).get(tenantId) as any

      // ยอด AR รวม (ลูกหนี้ทั้งหมดที่ยังค้างอยู่)
      const arTotal = db.prepare(`
        SELECT COALESCE(SUM(balance_amount), 0) as total,
               COUNT(*) as count
        FROM invoices
        WHERE tenant_id = ? AND payment_status IN ('UNPAID','PARTIAL')
      `).get(tenantId) as any

      // ยอด AP รวม (เจ้าหนี้ทั้งหมดที่ยังค้างอยู่)
      const apTotal = db.prepare(`
        SELECT COALESCE(SUM(balance_amount), 0) as total,
               COUNT(*) as count
        FROM purchase_invoices
        WHERE tenant_id = ? AND payment_status IN ('UNPAID','PARTIAL')
      `).get(tenantId) as any

      // บิลเกินกำหนด
      const arOverdue = db.prepare(`
        SELECT COALESCE(SUM(balance_amount), 0) as total, COUNT(*) as count
        FROM invoices
        WHERE tenant_id = ? AND payment_status IN ('UNPAID','PARTIAL')
          AND due_date IS NOT NULL AND date(due_date) < date('now')
      `).get(tenantId) as any

      const apOverdue = db.prepare(`
        SELECT COALESCE(SUM(balance_amount), 0) as total, COUNT(*) as count
        FROM purchase_invoices
        WHERE tenant_id = ? AND payment_status IN ('UNPAID','PARTIAL')
          AND due_date IS NOT NULL AND date(due_date) < date('now')
      `).get(tenantId) as any

      const grossProfit = revenue.collected - expense.paid

      return ok({
        period,
        income: {
          total_invoiced: revenue.total,
          collected: revenue.collected,
          outstanding: revenue.outstanding,
          invoice_count: revenue.invoice_count,
        },
        expenses: {
          total_invoiced: expense.total,
          paid: expense.paid,
          outstanding: expense.outstanding,
          invoice_count: expense.invoice_count,
        },
        gross_profit: grossProfit,
        accounts_receivable: {
          total_outstanding: arTotal.total,
          invoice_count: arTotal.count,
          overdue_amount: arOverdue.total,
          overdue_count: arOverdue.count,
        },
        accounts_payable: {
          total_outstanding: apTotal.total,
          invoice_count: apTotal.count,
          overdue_amount: apOverdue.total,
          overdue_count: apOverdue.count,
        },
      })
    }
  )
}
