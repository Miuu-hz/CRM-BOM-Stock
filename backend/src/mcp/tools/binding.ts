import { z } from 'zod'
import db from '../../db/sqlite'
import { IMcpServer } from '../sdk-compat'
import { ok, matchStockItem, bindingRow } from './shared'

/**
 * ผูกสินค้าในสต็อกเข้ากับบรรทัดของเอกสาร (ใบสั่งขาย / ใบขอซื้อ / ใบสั่งซื้อ)
 *
 * ทำไมต้องมี: AI เดาชื่อสินค้าแทนคนไม่ได้ (เคส "ข้าวโพด" → "สลัดทูน่าข้าวโพด" 2026-08-18)
 * ตั้งแต่ 2026-09-14 ทุก tool ที่สร้างเอกสารจะผูกให้เฉพาะ "ชื่อตรงเป๊ะ" แล้วโชว์ตารางกลับไป
 * บรรทัดที่ยังไม่ผูกต้องมาผ่าน tool นี้ก่อน ไม่งั้นยืนยันเอกสารไม่ได้
 */

type DocKind = 'SO' | 'PR' | 'PO'

interface DocSpec {
  kind: DocKind
  table: string
  itemTable: string
  fk: string
  numberCol: string
  /** คอลัมน์ที่เก็บตัวผูก — ฝั่งขายผูกกับ stock_items ตรง ๆ ฝั่งซื้อใช้ material_id */
  bindCol: string
  nameCol: string
  statusLock: (status: string) => string | null
}

const SPECS: DocSpec[] = [
  {
    kind: 'SO', table: 'sales_orders', itemTable: 'sales_order_items', fk: 'sales_order_id',
    numberCol: 'so_number', bindCol: 'stock_item_id', nameCol: 'product_name',
    statusLock: (st) => st === 'DRAFT' ? null : `แก้ได้เฉพาะใบสั่งขายสถานะ DRAFT (ปัจจุบัน: ${st})`,
  },
  {
    kind: 'PR', table: 'purchase_requests', itemTable: 'purchase_request_items', fk: 'purchase_request_id',
    numberCol: 'pr_number', bindCol: 'material_id', nameCol: 'description',
    statusLock: (st) => ['DRAFT', 'PENDING'].includes(st) ? null : `แก้ได้เฉพาะใบขอซื้อสถานะ DRAFT/PENDING (ปัจจุบัน: ${st})`,
  },
  {
    kind: 'PO', table: 'purchase_orders', itemTable: 'purchase_order_items', fk: 'purchase_order_id',
    numberCol: 'po_number', bindCol: 'material_id', nameCol: 'description',
    statusLock: (st) => ['DRAFT', 'SUBMITTED'].includes(st) ? null : `แก้ได้เฉพาะใบสั่งซื้อสถานะ DRAFT/SUBMITTED (ปัจจุบัน: ${st})`,
  },
]

function findDoc(tenantId: string, ref: string) {
  for (const spec of SPECS) {
    const row = db.prepare(
      `SELECT * FROM ${spec.table} WHERE (id = ? OR ${spec.numberCol} = ?) AND tenant_id = ?`
    ).get(ref, ref, tenantId) as any
    if (row) return { spec, doc: row }
  }
  return null
}

function listItems(spec: DocSpec, docId: string) {
  return db.prepare(
    `SELECT rowid as _rowid, id, ${spec.nameCol} as name, ${spec.bindCol} as bound, quantity, unit
     FROM ${spec.itemTable} WHERE ${spec.fk} = ? ORDER BY rowid`
  ).all(docId) as any[]
}

export function registerBindingTools(server: IMcpServer, tenantId: string): void {
  server.tool(
    'bind_document_item',
    `ผูกสินค้าในสต็อกเข้ากับบรรทัดของเอกสาร (ใบสั่งขาย SO / ใบขอซื้อ PR / ใบสั่งซื้อ PO)
ใช้เมื่อสร้างเอกสารแล้วมีบรรทัดที่ขึ้นว่า "ยังไม่ผูก" — ระบบจะยืนยันเอกสารไม่ได้จนกว่าจะผูกครบ
เรียกโดยไม่ใส่ stock_item_id = ดูสถานะการผูกของทุกบรรทัดพร้อมตัวเลือกให้ผู้ใช้เลือก
**ห้ามเลือกแทนผู้ใช้เอง** ให้เอาตัวเลือกไปถามก่อนเสมอ
ตัวอย่าง: "ผูกบรรทัดที่ 2 ของ SO-2026-00123 กับขนมจีน" → bind_document_item(doc="SO-2026-00123", line=2, stock_item_id="...")`,
    {
      doc: z.string().describe('เลขที่เอกสารหรือ id — SO / PR / PO'),
      line: z.number().int().positive().optional().describe('บรรทัดที่เท่าไหร่ (เริ่มที่ 1) — ดูจากตารางที่ tool สร้างเอกสารคืนมา'),
      stock_item_id: z.string().optional().describe('id ของสินค้าในสต็อกที่จะผูก — ถ้าไม่ใส่จะแค่แสดงสถานะ'),
    },
    async (args) => {
      const { doc, line, stock_item_id } = args
      const found = findDoc(tenantId, doc)
      if (!found) return ok({ success: false, message: `ไม่พบเอกสาร: ${doc}` })
      const { spec, doc: row } = found

      const items = listItems(spec, row.id)
      if (items.length === 0) return ok({ success: false, message: `${doc} ไม่มีรายการสินค้า` })

      // โหมดดูอย่างเดียว — คืนตารางพร้อมตัวเลือกให้ผู้ใช้เลือก
      if (!stock_item_id) {
        return ok({
          success: true,
          doc: row[spec.numberCol],
          status: row.status,
          items: items.map((it, i) => {
            if (it.bound) {
              const si = db.prepare('SELECT name, quantity, COALESCE(base_unit, unit) as unit FROM stock_items WHERE id = ?').get(it.bound) as any
              return {
                บรรทัดที่: i + 1, รายการ: it.name, จำนวน: `${it.quantity} ${it.unit || ''}`,
                สถานะ: 'ผูกแล้ว', ผูกกับสินค้า: si ? si.name : `(id ${it.bound} ไม่พบในสต็อก)`,
              }
            }
            const match = matchStockItem(tenantId, it.name, spec.kind !== 'SO')
            return {
              บรรทัดที่: i + 1, รายการ: it.name, จำนวน: `${it.quantity} ${it.unit || ''}`,
              ...bindingRow(it.name, match, it.unit || ''),
            }
          }),
          message: 'เอาตัวเลือกไปถามผู้ใช้ก่อนว่าจะผูกกับตัวไหน แล้วค่อยเรียกซ้ำพร้อม line + stock_item_id',
        })
      }

      const lock = spec.statusLock(row.status)
      if (lock) return ok({ success: false, message: lock })

      if (!line || line > items.length) {
        return ok({ success: false, message: `ระบุ line ระหว่าง 1–${items.length}` })
      }
      const target = items[line - 1]

      const stockItem = db.prepare(
        "SELECT id, name, COALESCE(base_unit, unit) as unit, quantity FROM stock_items WHERE id = ? AND tenant_id = ? AND status = 'ACTIVE'"
      ).get(stock_item_id, tenantId) as any
      if (!stockItem) return ok({ success: false, message: `ไม่พบสินค้าในสต็อก: ${stock_item_id}` })

      db.prepare(`UPDATE ${spec.itemTable} SET ${spec.bindCol} = ? WHERE id = ?`).run(stockItem.id, target.id)

      // ใบรับสินค้าที่ยังเป็นร่างคัดลอก material_id ไปตั้งแต่ตอนสร้าง — ผูกทีหลังต้องตามไปแก้ด้วย
      // ไม่งั้นยืนยันรับของแล้วของไม่เข้าสต็อกทั้งที่ PO ผูกแล้ว
      if (spec.kind === 'PO') {
        db.prepare(`
          UPDATE goods_receipt_items SET material_id = ?
          WHERE purchase_order_item_id = ?
            AND goods_receipt_id IN (SELECT id FROM goods_receipts WHERE purchase_order_id = ? AND status = 'DRAFT')
        `).run(stockItem.id, target.id, row.id)
      }

      const after = listItems(spec, row.id)
      const stillUnbound = after.filter(i => !i.bound)
      return ok({
        success: true,
        doc: row[spec.numberCol],
        boundLine: line,
        boundTo: { id: stockItem.id, name: stockItem.name, คงเหลือ: `${stockItem.quantity} ${stockItem.unit}` },
        unboundRemaining: stillUnbound.length,
        message: stillUnbound.length === 0
          ? `ผูกครบทุกบรรทัดแล้ว — ${row[spec.numberCol]} พร้อมยืนยัน`
          : `ผูกบรรทัดที่ ${line} แล้ว · ยังเหลืออีก ${stillUnbound.length} บรรทัด: ${stillUnbound.map(i => i.name).join(', ')}`,
      })
    }
  )
}
