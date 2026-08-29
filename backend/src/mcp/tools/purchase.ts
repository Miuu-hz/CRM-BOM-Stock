import { z } from 'zod'
import db from '../../db/sqlite'
import { IMcpServer } from '../sdk-compat'
import { randomUUID } from 'crypto'
import { convertQuantityBidirectional, normalizeUnit, findConversionChain } from '../../services/unitConversion.service'
import { ok, checkApprovalPermission, checkCanApprove } from './shared'
// Math.floor() ทำลายจำนวนที่เป็นทศนิยม: รับ 500 g ของของที่หน่วยฐานเป็น kg แปลงได้ 0.5
// แล้ว floor(0.5) = 0 → สต็อกไม่เพิ่มเลยโดยไม่มีใครรู้ (route หลักแก้ไปแล้ว ที่นี่ตกหล่น)
import { roundQty, roundPackQty } from '../../utils/qty'

// stock_items.unit_cost MUST always be the price per 1 BASE UNIT (stock_items.base_unit),
// never per the unit the PO/GR line was written in — mirrors priceToBaseUnitCost() in
// purchase.routes.ts (same rationale: quantity is forced into base_unit, so price must be
// divided by the same from-unit→base_unit factor or cost silently multiplies by the
// pack/kg factor wherever base_unit differs from the purchased unit).
function priceToBaseUnitCost(pricePerPurchasedUnit: number, factor: number, context: string): number {
  if (!Number.isFinite(factor) || factor <= 0) {
    console.warn(`[unit_cost] invalid conversion factor (${factor}) for ${context} — keeping price un-converted to avoid corrupting cost`)
    return pricePerPurchasedUnit
  }
  return pricePerPurchasedUnit / factor
}

export function registerPurchaseTools(server: IMcpServer, tenantId: string, userId: string, callerName: string, callerRole: string): void {
  // ── 5. create_purchase_request ─────────────────────────────────────────────
  server.tool(
    'create_purchase_request',
    'สร้างใบขอซื้อวัตถุดิบ / Create a purchase request (PR). ใช้เมื่อผู้ใช้ต้องการสั่งซื้อ ขอซื้อ หรือเปิด PR',
    {
      description: z.string().describe('รายละเอียดการขอซื้อ เช่น "ขอซื้อหมูสับ 5 กก. และพริก 2 กก."'),
      items: z.array(z.object({
        name: z.string(),
        qty: z.number(),
        unit: z.string().describe(
          'หน่วยรหัสมาตรฐาน: กิโลกรัม/กก./กิโล/ก.ก. = kg | ขีด = hg | กรัม = g | ชิ้น/อัน/ตัว = pcs | ' +
          'ฟอง = egg | กล่อง = box | แพ็ค/แพ๊ค/แพ๊ล/pack = pack | ถุง = bag | ขวด = bottle | โหล = dozen | ลัง = case | ' +
          'ลิตร = ltr | มล./ซีซี = ml | ซอง = sachet — ถ้าไม่แน่ใจใช้ pcs'
        ),
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
           VALUES (?, ?, ?, ?, ?, 'TBD', 'MCP', 'DRAFT', ?, ?, ?)`
        ).run(id, tenantId, prNumber, userId, callerName, desc, now, now)

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
              item.qty, normalizeUnit(item.unit || 'pcs'),
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
        quantity: z.number().describe(
          'จำนวนตามที่เขียนในบิล — คัดลอกตัวเลขตรงๆ ห้ามแปลงหน่วย\n' +
          '✗ ผิด: "1.5 ขีด" → 150  ✓ ถูก: "1.5 ขีด" → 1.5'
        ),
        unit: z.string().describe(
          'รหัสหน่วยมาตรฐาน — แปลงแค่ชื่อหน่วย ไม่แปลงตัวเลข:\n' +
          '• น้ำหนัก: กิโลกรัม/กก./กิโล/ก.ก. = kg | ขีด = hg | กรัม/ก. = g | มิลลิกรัม/มก. = mg\n' +
          '• ปริมาตร: ลิตร/ล. = ltr | มล./ซีซี/cc = ml\n' +
          '• นับ: ชิ้น/อัน/ตัว/ใบ = pcs | ฟอง = egg | กล่อง = box | แพ็ค/แพ๊ค/แพ๊ล/pack = pack | ถุง = bag | ซอง = sachet | ขวด = bottle | โหล = dozen | ลัง = case\n' +
          'ถ้าไม่แน่ใจให้ใช้ pcs'
        ),
        lineTotal: z.number().optional().describe(
          'ราคารวมทั้งบรรทัดตามบิล (บาท) — สำหรับบิลตลาดที่แสดงราคารวมต่อแถว\n' +
          '"หอมป. 1.5 ขีด 10 บาท" → lineTotal:10 | "ไข่ 30 ฟอง 120 บาท" → lineTotal:120\n' +
          'ถ้าบิลแสดง ราคา/หน่วย (มี /กก. /ชิ้น ฯลฯ) ให้ใช้ unitPrice แทน'
        ),
        unitPrice: z.number().optional().describe(
          'ราคาต่อหน่วย — สำหรับบิลระบบที่แสดงราคา/หน่วย\n' +
          '"หมูสับ 5 กก. 120 บาท/กก." → unitPrice:120\n' +
          'ถ้าไม่แน่ใจว่าเป็นราคาต่อหน่วยหรือราคารวม ให้ใช้ lineTotal แทน'
        ),
      })).describe('รายการสินค้าที่อ่านได้จากรูปหรือข้อความ'),
      supplier_hint: z.string().optional().describe('ชื่อซัพพลายเออร์ถ้าอ่านได้จากรูป'),
      billTotal: z.number().optional().describe(
        'ยอดรวมที่เขียนไว้ในบิล — ใช้ cross-check กับ sum(lineTotal)\n' +
        'ถ้ามีและตัวเลขไม่ตรงกัน (ต่างกัน >5%) ให้แจ้ง user ก่อนสร้าง'
      ),
      notes: z.string().optional().describe('หมายเหตุ เช่น "จากรูปภาพใบสั่งซื้อ" หรือ "จาก AI อ่านรูป"'),
    },
    async (args) => {
      const { items, supplier_hint, billTotal, notes } = args
      const id = randomUUID().replace(/-/g, '').substring(0, 25)
      const count = (db.prepare('SELECT COUNT(*) as c FROM purchase_orders WHERE tenant_id = ?').get(tenantId) as { c: number }).c
      const poNumber = `PO-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`
      const now = new Date().toISOString()

      // ── Auto-find or create supplier ────────────────────────────────────────
      let supplierId: string | null = null
      let supplierCreated = false
      if (supplier_hint) {
        const existing = db.prepare(
          `SELECT id, name FROM suppliers WHERE tenant_id = ? AND (name LIKE ? OR code LIKE ?) AND status = 'ACTIVE' LIMIT 1`
        ).get(tenantId, `%${supplier_hint}%`, `%${supplier_hint}%`) as any
        if (existing) {
          supplierId = existing.id
        } else {
          const supCount = (db.prepare('SELECT COUNT(*) as c FROM suppliers WHERE tenant_id = ?').get(tenantId) as any).c
          const supCode = `SUP-${new Date().getFullYear()}-${String(supCount + 1).padStart(4, '0')}`
          const supId = randomUUID().replace(/-/g, '').substring(0, 25)
          db.prepare(`
            INSERT INTO suppliers (id, tenant_id, code, name, contact_name, status, type, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'ACTIVE', 'RAW_MATERIAL', ?, ?)
          `).run(supId, tenantId, supCode, supplier_hint, supplier_hint, now, now)
          supplierId = supId
          supplierCreated = true
        }
      }

      // lineTotal (ราคารวมต่อบรรทัด) มี priority ก่อน unitPrice
      const resolveLineTotal = (i: { quantity: number; lineTotal?: number; unitPrice?: number }): number => {
        if (i.lineTotal != null) return i.lineTotal
        if (i.unitPrice != null) return i.quantity * i.unitPrice
        return 0
      }
      const resolveUnitPrice = (i: { quantity: number; lineTotal?: number; unitPrice?: number }): number => {
        if (i.unitPrice != null) return i.unitPrice
        if (i.lineTotal != null && i.quantity > 0) return i.lineTotal / i.quantity
        return 0
      }
      const subtotal = items.reduce((s: number, i: { quantity: number; lineTotal?: number; unitPrice?: number }) => s + resolveLineTotal(i), 0)

      db.prepare(`
        INSERT INTO purchase_orders
          (id, tenant_id, po_number, supplier_id, status, order_date, subtotal, tax_rate, tax_amount, total_amount, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, 0, 0, ?, ?, ?, ?)
      `).run(id, tenantId, poNumber, supplierId, now, subtotal, subtotal,
        `[AI Draft] ${notes ?? supplier_hint ?? 'จากรูปภาพ'}`, now, now)

      // ── Insert PO items — free text only, MCP never binds material_id ──────────
      // Owner decision 2026-08-18: the old LIKE '%desc%' LIMIT 1 auto-match (no ORDER BY,
      // no category filter) matched menu dishes (category='finished') to raw-ingredient
      // bill lines — e.g. "ข้าวโพด" (corn) matched "สลัดทูน่าข้าวโพด" (tuna-corn salad) —
      // and silently auto-created junk stock_items when nothing matched. A human now binds
      // material_id later in the web UI. We still look up a candidate for the response
      // (reporting only, never written to material_id).
      const insertItem = db.prepare(`
        INSERT INTO purchase_order_items
          (id, tenant_id, purchase_order_id, material_id, description, quantity, unit, unit_price, total_price, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '')
      `)

      const findSuggestion = db.prepare(`
        SELECT id, name, sku, COALESCE(base_unit, unit) AS unit FROM stock_items
        WHERE tenant_id = ? AND status = 'ACTIVE'
          AND category IN ('raw','RAW_MATERIAL','material','wip')
          AND name LIKE ?
        ORDER BY CASE WHEN name = ? THEN 0 WHEN name LIKE ? THEN 1 ELSE 2 END, length(name)
        LIMIT 1
      `)

      const resultItems: { description: string; unit: string; suggestedMatch: { id: string; name: string; sku: string; unit: string } | null }[] = []
      for (const item of items) {
        const suggestion = findSuggestion.get(tenantId, `%${item.description}%`, item.description, `${item.description}%`) as any
        const resolvedUnit = normalizeUnit(item.unit || 'pcs')

        const itemUnitPrice = resolveUnitPrice(item)
        const itemLineTotal = resolveLineTotal(item)
        insertItem.run(
          randomUUID().replace(/-/g, '').substring(0, 25),
          tenantId, id, null, item.description, item.quantity,
          resolvedUnit, itemUnitPrice, itemLineTotal
        )
        resultItems.push({
          description: item.description,
          unit: resolvedUnit,
          suggestedMatch: suggestion ? { id: suggestion.id, name: suggestion.name, sku: suggestion.sku, unit: suggestion.unit } : null,
        })
      }

      const billTotalMismatch = billTotal != null && Math.abs(subtotal - billTotal) / Math.max(billTotal, 1) > 0.05
      return ok({
        poNumber,
        poId: id,
        status: 'DRAFT',
        itemCount: items.length,
        totalAmount: subtotal,
        billTotal: billTotal ?? null,
        billTotalMismatch: billTotalMismatch || null,
        supplier: supplierId ? { id: supplierId, name: supplier_hint, isNew: supplierCreated } : null,
        items: resultItems,
        message: [
          `สร้าง Draft PO ${poNumber} แล้ว (${items.length} รายการ มูลค่า ฿${subtotal.toLocaleString()}) — ยังไม่ได้ผูกวัตถุดิบ`,
          `กรุณาเปิด PO นี้ใน ERP web เพื่อผูกวัตถุดิบและตรวจสอบหน่วยก่อน submit`,
          supplierCreated ? `— สร้าง Supplier "${supplier_hint}" ใหม่` : '',
          billTotalMismatch ? `⚠️ ยอดรวมที่คำนวณ ฿${subtotal.toLocaleString()} ต่างจากยอดในบิล ฿${billTotal!.toLocaleString()} — กรุณาตรวจสอบ` : '',
        ].filter(Boolean).join(' '),
        supplier_hint: supplier_hint ?? null,
      })
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

      const check = checkApprovalPermission(tenantId, userId, callerRole, 'purchase_request', pr.total_amount || 0)
      if (!check.allowed) {
        return ok({ success: false, message: check.message })
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

      // supplier_id มาจาก LLM โดยตรง — ต้องยืนยันว่าเป็นของ tenant นี้ก่อนเขียนลง PO
      const supplier = db.prepare('SELECT id FROM suppliers WHERE id = ? AND tenant_id = ?').get(supplier_id, tenantId) as any
      if (!supplier) {
        return ok({ success: false, message: `ไม่พบ supplier: ${supplier_id}` })
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

  // ── update_purchase_request ────────────────────────────────────────────────
  server.tool(
    'update_purchase_request',
    `แก้ไขใบขอซื้อ (PR) ที่สถานะ DRAFT หรือ PENDING — ใช้เมื่อข้อมูลผิดพลาดหรือต้องการแก้ไขรายการ
pr_id รับได้ทั้ง UUID หรือเลขที่ PR เช่น "PR-2026-00001"
items ถ้าส่งมาจะแทนที่รายการทั้งหมด ถ้าไม่ส่งจะไม่เปลี่ยนรายการ`,
    {
      pr_id:       z.string().describe('ID หรือเลขที่ PR เช่น PR-2026-00001'),
      department:  z.string().optional().describe('แผนก'),
      required_date: z.string().optional().describe('วันที่ต้องการ (YYYY-MM-DD)'),
      priority:    z.enum(['LOW','NORMAL','HIGH','URGENT']).optional(),
      notes:       z.string().optional().describe('หมายเหตุ'),
      items:       z.array(z.object({
        description:        z.string().describe('ชื่อสินค้า/วัตถุดิบ'),
        quantity:           z.number().positive(),
        unit:               z.string().default('pcs'),
        estimatedUnitPrice: z.number().min(0).default(0).describe('ราคาต่อหน่วย'),
      })).optional().describe('รายการสินค้า — ถ้าส่งจะแทนที่รายการทั้งหมด'),
    },
    async (args) => {
      const { pr_id, department, required_date, priority, notes, items } = args
      let pr = db.prepare('SELECT * FROM purchase_requests WHERE id = ? AND tenant_id = ?').get(pr_id, tenantId) as any
      if (!pr) pr = db.prepare('SELECT * FROM purchase_requests WHERE pr_number = ? AND tenant_id = ?').get(pr_id, tenantId) as any
      if (!pr) return ok({ success: false, message: `ไม่พบ PR: ${pr_id}` })
      if (!['DRAFT', 'PENDING'].includes(pr.status)) return ok({ success: false, message: `ไม่สามารถแก้ไขได้ — PR สถานะ ${pr.status}` })

      const now = new Date().toISOString()
      const mappedItems = items?.map((i: { description: string; quantity: number; unit: string; estimatedUnitPrice: number }) => ({ ...i, estimatedTotalPrice: i.quantity * i.estimatedUnitPrice }))
      const totalAmount = mappedItems ? mappedItems.reduce((s: number, i: { estimatedTotalPrice: number }) => s + i.estimatedTotalPrice, 0) : pr.total_amount

      db.transaction(() => {
        db.prepare(`
          UPDATE purchase_requests
          SET department = COALESCE(?, department), required_date = COALESCE(?, required_date),
              priority = COALESCE(?, priority), notes = COALESCE(?, notes),
              total_amount = ?, updated_at = ?
          WHERE id = ?
        `).run(department ?? null, required_date ?? null, priority ?? null, notes ?? null, totalAmount, now, pr.id)

        if (mappedItems) {
          db.prepare('DELETE FROM purchase_request_items WHERE purchase_request_id = ?').run(pr.id)
          const ins = db.prepare(`
            INSERT INTO purchase_request_items
              (id, tenant_id, purchase_request_id, description, item_name, quantity, unit, estimated_unit_price, estimated_total_price)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          for (const it of mappedItems) {
            ins.run(randomUUID(), tenantId, pr.id, it.description, it.description, it.quantity, it.unit, it.estimatedUnitPrice, it.estimatedTotalPrice)
          }
        }
      })()

      const updated = db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(pr.id) as any
      const updatedItems = db.prepare('SELECT * FROM purchase_request_items WHERE purchase_request_id = ?').all(pr.id)
      return ok({ message: `แก้ไข ${updated.pr_number} สำเร็จ`, pr: updated, items: updatedItems })
    }
  )

  // ── update_purchase_order ──────────────────────────────────────────────────
  server.tool(
    'update_purchase_order',
    `แก้ไขใบสั่งซื้อ (PO) ที่สถานะ DRAFT — ใช้เมื่อข้อมูลผิดพลาดหรือต้องการแก้ไขรายการ
po_id รับได้ทั้ง UUID หรือเลขที่ PO เช่น "PO-00001"
items ถ้าส่งมาจะแทนที่รายการทั้งหมด`,
    {
      po_id:         z.string().describe('ID หรือเลขที่ PO เช่น PO-00006'),
      supplier_hint: z.string().optional().describe('ชื่อหรือรหัส supplier เพื่อค้นหา'),
      expected_date: z.string().optional().describe('วันที่คาดรับสินค้า (YYYY-MM-DD)'),
      notes:         z.string().optional().describe('หมายเหตุ'),
      tax_rate:      z.number().min(0).max(30).optional().describe('อัตราภาษี % เช่น 7'),
      items:         z.array(z.object({
        description: z.string().describe('ชื่อสินค้า'),
        quantity:    z.number().positive(),
        unit:        z.string().default('pcs'),
        unitPrice:   z.number().min(0),
        materialId:  z.string().optional().describe('ID วัตถุดิบ ถ้ามี'),
      })).optional().describe('รายการสินค้า — ถ้าส่งจะแทนที่รายการทั้งหมด'),
    },
    async (args) => {
      const { po_id, supplier_hint, expected_date, notes, tax_rate, items } = args
      let po = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(po_id, tenantId) as any
      if (!po) po = db.prepare('SELECT * FROM purchase_orders WHERE po_number = ? AND tenant_id = ?').get(po_id, tenantId) as any
      if (!po) return ok({ success: false, message: `ไม่พบ PO: ${po_id}` })
      if (po.status !== 'DRAFT') return ok({ success: false, message: `ไม่สามารถแก้ไขได้ — PO สถานะ ${po.status} (ต้องเป็น DRAFT เท่านั้น)` })

      const now = new Date().toISOString()

      let supplierId: string | null = null
      if (supplier_hint) {
        const sup = db.prepare(`
          SELECT id FROM suppliers WHERE tenant_id = ? AND (name LIKE ? OR code LIKE ?) AND status = 'ACTIVE' LIMIT 1
        `).get(tenantId, `%${supplier_hint}%`, `%${supplier_hint}%`) as any
        if (sup) supplierId = sup.id
      }

      const taxPct = tax_rate ?? po.tax_rate ?? 7
      const mappedItems = items?.map((i: { description: string; quantity: number; unit: string; unitPrice: number; materialId?: string }) => ({ ...i, totalPrice: i.quantity * i.unitPrice }))
      const subtotal = mappedItems ? mappedItems.reduce((s: number, i: { totalPrice: number }) => s + i.totalPrice, 0) : po.subtotal
      const taxAmount = subtotal * (taxPct / 100)
      const totalAmount = subtotal + taxAmount

      db.transaction(() => {
        db.prepare(`
          UPDATE purchase_orders
          SET supplier_id = COALESCE(?, supplier_id), expected_date = COALESCE(?, expected_date),
              notes = COALESCE(?, notes), tax_rate = ?, subtotal = ?, tax_amount = ?, total_amount = ?, updated_at = ?
          WHERE id = ? AND tenant_id = ?
        `).run(supplierId, expected_date ?? null, notes ?? null, taxPct, subtotal, taxAmount, totalAmount, now, po.id, tenantId)

        if (mappedItems) {
          db.prepare('DELETE FROM purchase_order_items WHERE purchase_order_id = ?').run(po.id)
          const ins = db.prepare(`
            INSERT INTO purchase_order_items
              (id, tenant_id, purchase_order_id, material_id, description, quantity, unit, unit_price, total_price)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          for (const it of mappedItems) {
            ins.run(randomUUID(), tenantId, po.id, it.materialId || null, it.description, it.quantity, it.unit, it.unitPrice, it.totalPrice)
          }
        }
      })()

      const updated = db.prepare(`
        SELECT po.*, s.name as supplier_name FROM purchase_orders po
        LEFT JOIN suppliers s ON po.supplier_id = s.id
        WHERE po.id = ?
      `).get(po.id) as any
      const updatedItems = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(po.id)
      return ok({ message: `แก้ไข ${updated.po_number} สำเร็จ`, po: updated, items: updatedItems })
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
                // stock_items.quantity is always stored in base_unit — see
                // purchase.routes.ts confirm/cancel handlers for the full rationale
                // (~23 items in this tenant have unit != base_unit from an old migration).
                const stockUnit = normalizeUnit(stockItem.base_unit || stockItem.unit || '')
                const displayUnit = normalizeUnit(stockItem.display_unit || '')
                const poItem = db.prepare('SELECT unit_price, unit FROM purchase_order_items WHERE id = ?').get(item.purchase_order_item_id) as any
                const poUnit = normalizeUnit(poItem?.unit || '')
                // unit_cost must ALWAYS be price per base unit (stockUnit), never per the PO's
                // purchased unit — see priceToBaseUnitCost() above for the full rationale.
                const unitPrice = poItem?.unit_price || 0

                // Same guard as purchase.routes.ts: only park in sealed_qty if display_unit
                // is a real unopened pack (differs from base_unit) that can later be
                // unpacked back out — otherwise it gets stuck in sealed_qty forever.
                const displayToBaseChain = (!!displayUnit && displayUnit !== stockUnit)
                  ? findConversionChain(displayUnit, stockUnit, tenantId, item.material_id)
                  : null
                const canUnpackDisplay = !!displayToBaseChain
                if (poUnit && displayUnit && poUnit === displayUnit && canUnpackDisplay) {
                  const sealedCostFactor = displayToBaseChain?.factor ?? 1
                  const sealedUnitCost = unitPrice
                    ? priceToBaseUnitCost(unitPrice, sealedCostFactor, `sealed ${poUnit}→${stockUnit} (material ${item.material_id})`)
                    : stockItem.unit_cost
                  db.prepare('UPDATE stock_items SET sealed_qty = COALESCE(sealed_qty, 0) + ?, unit_cost = ?, unit = COALESCE(base_unit, unit), updated_at = ? WHERE id = ?')
                    .run(roundPackQty(Number(item.accepted_qty), `GR ${gr.gr_number} sealed`), sealedUnitCost, now, stockItem.id)
                  movementNotes = `Received as sealed ${poUnit}: ${item.accepted_qty} ${poUnit}`
                } else if (poUnit && poUnit !== stockUnit) {
                  const converted = convertQuantityBidirectional(Number(item.accepted_qty), poUnit, stockUnit, tenantId, item.material_id)
                  if (!converted) {
                    throw new Error(`ไม่พบการแปลงหน่วย ${poUnit} → ${stockUnit} กรุณาตั้งค่า Unit Conversion ก่อน`)
                  }
                  stockQty = converted.converted
                  movementNotes = `Received from purchase (converted: ${item.accepted_qty} ${poUnit} → ${converted.converted.toFixed(4)} ${stockUnit})`
                  const newUnitCost = unitPrice
                    ? priceToBaseUnitCost(unitPrice, converted.factor, `${poUnit}→${stockUnit} (material ${item.material_id})`)
                    : stockItem.unit_cost
                  db.prepare('UPDATE stock_items SET quantity = quantity + ?, unit_cost = ?, unit = COALESCE(base_unit, unit), updated_at = ? WHERE id = ?')
                    .run(roundQty(stockQty), newUnitCost, now, stockItem.id)
                } else {
                  const newUnitCost = unitPrice ? unitPrice : stockItem.unit_cost
                  db.prepare('UPDATE stock_items SET quantity = quantity + ?, unit_cost = ?, unit = COALESCE(base_unit, unit), updated_at = ? WHERE id = ?')
                    .run(roundQty(stockQty), newUnitCost, now, stockItem.id)
                }

                db.prepare(`INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
                  VALUES (?, ?, ?, 'IN', ?, ?, ?, ?, ?)`)
                  .run(randomUUID().replace(/-/g, '').substring(0, 25), tenantId, stockItem.id,
                    roundQty(stockQty), `GR: ${gr.gr_number}`, movementNotes, now, userId)
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

  // ── reject_purchase_request ─────────────────────────────────────────────────
  server.tool(
    'reject_purchase_request',
    `ปฏิเสธใบขอซื้อ (PR) / Reject a purchase request.
ใช้เมื่อผู้ใช้ต้องการปฏิเสธหรือไม่อนุมัติ PR
ตัวอย่าง: "ปฏิเสธ PR-2026-00001 เพราะงบไม่พอ" → reject_purchase_request(pr_id="...", reason="งบไม่พอ")`,
    {
      pr_id: z.string().describe('ID หรือ PR number'),
      reason: z.string().optional().describe('เหตุผลที่ปฏิเสธ'),
    },
    async (args) => {
      const { pr_id, reason } = args
      let pr = db.prepare('SELECT * FROM purchase_requests WHERE id = ? AND tenant_id = ?').get(pr_id, tenantId) as any
      if (!pr) pr = db.prepare('SELECT * FROM purchase_requests WHERE pr_number = ? AND tenant_id = ?').get(pr_id, tenantId) as any
      if (!pr) return ok({ success: false, message: `ไม่พบ PR: ${pr_id}` })
      if (!['DRAFT', 'PENDING'].includes(pr.status)) {
        return ok({ success: false, message: `ปฏิเสธได้เฉพาะ PR สถานะ DRAFT/PENDING (ปัจจุบัน: ${pr.status})` })
      }

      const check = checkCanApprove(tenantId, userId, callerRole, 'purchase_request')
      if (!check.allowed) {
        return ok({ success: false, message: check.message })
      }

      const now = new Date().toISOString()
      const notes = reason ? `${pr.notes || ''}\n[ปฏิเสธ] ${reason}`.trim() : pr.notes
      db.prepare('UPDATE purchase_requests SET status = ?, notes = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run('REJECTED', notes, now, pr.id, tenantId)

      return ok({ success: true, prNumber: pr.pr_number, status: 'REJECTED', message: `ปฏิเสธ ${pr.pr_number} แล้ว${reason ? ` (เหตุผล: ${reason})` : ''}` })
    }
  )

  // ── update_po_status ────────────────────────────────────────────────────────
  server.tool(
    'update_po_status',
    `เปลี่ยนสถานะใบสั่งซื้อ (PO): ส่ง อนุมัติ หรือยกเลิก / Submit, approve, or cancel a purchase order.
SUBMITTED = ส่งขออนุมัติ | APPROVED = อนุมัติ (จาก DRAFT หรือ SUBMITTED) | CANCELLED = ยกเลิก
การรับสินค้าไม่ใช้ tool นี้ — ใช้ create_goods_receipt + confirm_goods_receipt แทน
ตัวอย่าง: "อนุมัติ PO-2026-00003" → update_po_status(po_id="PO-2026-00003", status="APPROVED")`,
    {
      po_id: z.string().describe('ID หรือเลขที่ PO'),
      status: z.enum(['SUBMITTED', 'APPROVED', 'CANCELLED']).describe('สถานะใหม่'),
    },
    async (args) => {
      const { po_id, status } = args
      let po = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(po_id, tenantId) as any
      if (!po) po = db.prepare('SELECT * FROM purchase_orders WHERE po_number = ? AND tenant_id = ?').get(po_id, tenantId) as any
      if (!po) return ok({ success: false, message: `ไม่พบ PO: ${po_id}` })
      if (po.status === status) return ok({ success: false, message: `PO อยู่ในสถานะ ${status} อยู่แล้ว` })
      if (['RECEIVED', 'PARTIAL', 'CANCELLED'].includes(po.status)) {
        return ok({ success: false, message: `ไม่สามารถเปลี่ยนสถานะได้ — PO ${po.status} ไปแล้ว` })
      }
      if (status === 'SUBMITTED' && po.status !== 'DRAFT') {
        return ok({ success: false, message: `ส่งขออนุมัติได้เฉพาะ PO สถานะ DRAFT (ปัจจุบัน: ${po.status})` })
      }
      if (status === 'APPROVED') {
        const check = checkApprovalPermission(tenantId, userId, callerRole, 'purchase_order', po.total_amount || 0)
        if (!check.allowed) {
          return ok({ success: false, message: check.message })
        }
      }

      const now = new Date().toISOString()
      if (status === 'APPROVED') {
        db.prepare('UPDATE purchase_orders SET status = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
          .run(status, userId, now, now, po.id, tenantId)
      } else {
        db.prepare('UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
          .run(status, now, po.id, tenantId)
      }

      return ok({ success: true, poNumber: po.po_number, status, message: `เปลี่ยนสถานะ ${po.po_number} เป็น ${status} สำเร็จ` })
    }
  )

  // ── create_goods_receipt ────────────────────────────────────────────────────
  server.tool(
    'create_goods_receipt',
    `สร้างใบรับสินค้า (GR) จากใบสั่งซื้อ / Create a goods receipt for a PO.
ใช้เมื่อของมาส่งและต้องการบันทึกรับสินค้า — ระบบสร้าง GR สถานะ DRAFT
ถ้าไม่ระบุ items จะรับทุกรายการที่ค้างรับเต็มจำนวน / ระบุ items เพื่อรับบางส่วน
หลังสร้างแล้วใช้ confirm_goods_receipt เพื่อยืนยันและอัปเดตสต็อก
ตัวอย่าง: "ของจาก PO-2026-00003 มาส่งแล้ว รับเข้าเลย" → create_goods_receipt(po_id="PO-2026-00003") แล้ว confirm_goods_receipt`,
    {
      po_id: z.string().describe('ID หรือเลขที่ PO'),
      items: z.array(z.object({
        description: z.string().describe('ชื่อสินค้า (ตรงกับรายการใน PO)'),
        received_qty: z.number().positive().describe('จำนวนที่รับจริง (หน่วยเดียวกับใน PO)'),
      })).optional().describe('รายการที่รับ — ถ้าไม่ระบุรับทุกรายการที่ค้างเต็มจำนวน'),
      delivery_note_no: z.string().optional().describe('เลขที่ใบส่งของจากซัพพลายเออร์'),
      notes: z.string().optional().describe('หมายเหตุ'),
    },
    async (args) => {
      const { po_id, items, delivery_note_no, notes } = args
      let po = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(po_id, tenantId) as any
      if (!po) po = db.prepare('SELECT * FROM purchase_orders WHERE po_number = ? AND tenant_id = ?').get(po_id, tenantId) as any
      if (!po) return ok({ success: false, message: `ไม่พบ PO: ${po_id}` })
      if (po.status === 'RECEIVED') return ok({ success: false, message: `${po.po_number} รับสินค้าครบแล้ว` })
      if (po.status === 'CANCELLED') return ok({ success: false, message: `${po.po_number} ถูกยกเลิกไปแล้ว` })

      const existingDraft = db.prepare(
        "SELECT gr_number FROM goods_receipts WHERE purchase_order_id = ? AND tenant_id = ? AND status = 'DRAFT'"
      ).get(po.id, tenantId) as any
      if (existingDraft) {
        return ok({ success: false, message: `มีใบรับสินค้าร่าง ${existingDraft.gr_number} รออยู่ — ยืนยันด้วย confirm_goods_receipt ก่อนสร้างใหม่`, grNumber: existingDraft.gr_number })
      }

      const pendingItems = db.prepare(`
        SELECT *, (quantity - COALESCE(received_qty, 0)) as pending_qty
        FROM purchase_order_items
        WHERE purchase_order_id = ? AND quantity > COALESCE(received_qty, 0)
      `).all(po.id) as any[]
      if (pendingItems.length === 0) return ok({ success: false, message: `${po.po_number} ไม่มีรายการค้างรับ` })

      // จับคู่รายการที่ผู้ใช้ระบุกับรายการค้างรับ — ถ้าไม่ระบุรับทั้งหมดเต็มจำนวน
      const grItems: { poItem: any; receivedQty: number }[] = []
      if (items && items.length > 0) {
        for (const item of items) {
          const found = pendingItems.find(p => (p.description || '').includes(item.description) || item.description.includes(p.description || ''))
          if (!found) {
            return ok({ success: false, message: `ไม่พบรายการ "${item.description}" ใน PO (รายการค้างรับ: ${pendingItems.map(p => p.description).join(', ')})` })
          }
          grItems.push({ poItem: found, receivedQty: item.received_qty })
        }
      } else {
        for (const p of pendingItems) grItems.push({ poItem: p, receivedQty: p.pending_qty })
      }

      const id = randomUUID().replace(/-/g, '').substring(0, 25)
      const grCount = (db.prepare('SELECT COUNT(*) as c FROM goods_receipts WHERE tenant_id = ?').get(tenantId) as any).c
      const grNumber = `GR-${new Date().getFullYear()}-${String(grCount + 1).padStart(5, '0')}`
      const now = new Date().toISOString()

      db.transaction(() => {
        db.prepare(`
          INSERT INTO goods_receipts (id, tenant_id, gr_number, purchase_order_id, supplier_id, receipt_date,
            received_by, status, notes, delivery_note_no, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)
        `).run(id, tenantId, grNumber, po.id, po.supplier_id, now, callerName, notes ?? '', delivery_note_no ?? null, now, now)

        const insertItem = db.prepare(`
          INSERT INTO goods_receipt_items (id, tenant_id, goods_receipt_id, purchase_order_item_id, material_id,
            ordered_qty, received_qty, accepted_qty, rejected_qty, lot_number, location, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, '')
        `)
        for (const { poItem, receivedQty } of grItems) {
          insertItem.run(randomUUID().replace(/-/g, '').substring(0, 25), tenantId, id,
            poItem.id, poItem.material_id, poItem.quantity, receivedQty, receivedQty)
        }
      })()

      return ok({
        success: true,
        grNumber,
        grId: id,
        poNumber: po.po_number,
        itemCount: grItems.length,
        items: grItems.map(g => ({ description: g.poItem.description, receivedQty: g.receivedQty, unit: g.poItem.unit })),
        message: `สร้างใบรับสินค้า ${grNumber} จาก ${po.po_number} แล้ว (${grItems.length} รายการ) — ใช้ confirm_goods_receipt(gr_id="${grNumber}") เพื่อยืนยันและอัปเดตสต็อก`,
      })
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
}
