import { z } from 'zod'
import db from '../../db/sqlite'
import { IMcpServer } from '../sdk-compat'
import { ok, dbAnchoredSearch, tokenWhere, tokenParams } from './shared'

export function registerSearchTool(server: IMcpServer, tenantId: string): void {
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
}
