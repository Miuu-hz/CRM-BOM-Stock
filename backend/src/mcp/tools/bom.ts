import { z } from 'zod'
import db from '../../db/sqlite'
import { IMcpServer } from '../sdk-compat'
import { randomUUID } from 'crypto'
import { ok } from './shared'

export function registerBomTools(server: IMcpServer, tenantId: string): void {
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
}
