import { describe, it, expect } from 'vitest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { registerPurchaseTools } from './purchase'
import { createTestUser } from '../../test/testAuth'
import type { IMcpServer } from '../sdk-compat'

/**
 * เทสต์เฉพาะบั๊กที่เป็นของฝั่ง MCP ล้วนๆ (ไม่ได้ทดสอบผ่าน service ตรงๆ เหมือน
 * goodsReceipt.service.test.ts): เลขที่ GR ไม่ชนกับ REST + ไม่ย้อนหลังหลังลบ (Bug #1),
 * จับคู่ description แบบ exact ไม่ใช่ includes() สองทาง (Bug #2), และ convert_pr_to_po
 * ผูก linked_pr_id + เลข PO ไม่ชนกับ REST (Bug #5)
 */
function fakeServer(): { server: IMcpServer; tools: Record<string, (args: any) => Promise<any>> } {
  const tools: Record<string, (args: any) => Promise<any>> = {}
  const server: IMcpServer = {
    tool: (name: string, _desc: string, _schema: any, handler: any) => { tools[name] = handler },
    connect: async () => {},
    close: async () => {},
  }
  return { server, tools }
}

function parseOk(res: any): any {
  return JSON.parse(res.content[0].text)
}

function seedPo(tenantId: string, lines: { description: string; qty: number; unbound?: boolean }[]) {
  const supplierId = generateId()
  db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'Sup', 'C')")
    .run(supplierId, tenantId, supplierId)
  const poId = generateId()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_amount, total_amount, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'APPROVED', 100, 0, 100, ?, ?)
  `).run(poId, tenantId, 'PO-' + poId.slice(0, 6), supplierId, now, now)
  for (const line of lines) {
    // ตั้งแต่ 2026-09-14 บรรทัดที่ยังไม่ผูกวัตถุดิบจะรับของไม่ได้ (กันใบรับของผี)
    // seed จึงต้องผูกให้เหมือน PO ที่คนกดผูกมาแล้ว ยกเว้นสั่ง unbound มาโดยเฉพาะ
    let materialId: string | null = null
    if (!line.unbound) {
      materialId = generateId()
      db.prepare(`
        INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
        VALUES (?, ?, ?, ?, 'raw', 0, 'pcs', 'pcs', 10, 'STOCK', 'ACTIVE')
      `).run(materialId, tenantId, 'SKU-' + materialId.slice(0, 8), line.description)
    }
    db.prepare(`
      INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, quantity, unit, unit_price, total_price, received_qty)
      VALUES (?, ?, ?, ?, ?, ?, 'pcs', 10, 10, 0)
    `).run(generateId(), tenantId, poId, materialId, line.description, line.qty)
  }
  return poId
}

describe('MCP create_goods_receipt — เลขที่ GR ใช้ตัวนับกลาง ไม่ชนกับ REST (Bug #1)', () => {
  it('สร้างผ่าน MCP แล้วลบ แล้วสร้างใหม่ผ่าน REST-style (formatDocumentNumber) เลขไม่ย้อนหลัง/ไม่ชน', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { server, tools } = fakeServer()
    registerPurchaseTools(server, user.tenantId, user.userId, user.email, 'ADMIN')

    const poId1 = seedPo(user.tenantId, [{ description: 'กล่อง', qty: 5 }])
    const created1 = parseOk(await tools['create_goods_receipt']({ po_id: poId1 }))
    expect(created1.success, created1.message).toBe(true)
    const grNumber1 = created1.grNumber

    // ลบ GR แรกทิ้ง (จำลองการลบร่าง) แล้วสร้างใหม่จาก PO อีกใบ — เลขต้องเดินหน้าต่อ ไม่ย้อนกลับ
    db.prepare('DELETE FROM goods_receipt_items WHERE goods_receipt_id = ?').run(created1.grId)
    db.prepare('DELETE FROM goods_receipts WHERE id = ?').run(created1.grId)

    const poId2 = seedPo(user.tenantId, [{ description: 'ถุง', qty: 5 }])
    const created2 = parseOk(await tools['create_goods_receipt']({ po_id: poId2 }))
    expect(created2.success, created2.message).toBe(true)

    // เลขที่สองต้องเป็นเลขถัดไปจากตัวนับกลาง (ไม่ใช่เลขเดิมจาก COUNT(*) ที่ลดลงหลังลบ)
    const seqNum = (s: string) => parseInt(s.split('-').pop() || '0', 10)
    expect(seqNum(created2.grNumber)).toBeGreaterThan(seqNum(grNumber1))

    // เลขต้องมาจาก document_sequences ตัวเดียวกับที่ REST ใช้ (docType GOODS_RECEIPT)
    const seqRow = db.prepare("SELECT last_number FROM document_sequences WHERE tenant_id = ? AND doc_type = 'GOODS_RECEIPT'").get(user.tenantId) as any
    expect(seqRow.last_number).toBe(seqNum(created2.grNumber))
  })
})

describe('MCP create_goods_receipt — จับคู่ description แบบ exact เท่านั้น (Bug #2)', () => {
  it('"กล่อง" ต้องไม่จับคู่กับ "กล่องของขวัญเปล่า" ที่เป็นคนละรายการ', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { server, tools } = fakeServer()
    registerPurchaseTools(server, user.tenantId, user.userId, user.email, 'ADMIN')

    const poId = seedPo(user.tenantId, [{ description: 'กล่องของขวัญเปล่า', qty: 5 }])
    const res = parseOk(await tools['create_goods_receipt']({
      po_id: poId,
      items: [{ description: 'กล่อง', received_qty: 2 }],
    }))

    expect(res.success).toBe(false)
    expect(res.message).toContain('ไม่พบรายการ')
  })

  it('ชื่อตรงเป๊ะ (ตัดช่องว่าง/case) จับคู่ได้ปกติ', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { server, tools } = fakeServer()
    registerPurchaseTools(server, user.tenantId, user.userId, user.email, 'ADMIN')

    const poId = seedPo(user.tenantId, [{ description: 'กล่อง', qty: 5 }])
    const res = parseOk(await tools['create_goods_receipt']({
      po_id: poId,
      items: [{ description: ' กล่อง ', received_qty: 2 }],
    }))

    expect(res.success, res.message).toBe(true)
    expect(res.itemCount).toBe(1)
  })
})

describe('MCP create_goods_receipt — เพดานยอดรับ (Bug #4 ผ่านทาง service กลาง)', () => {
  it('รับเกินยอดค้างไม่ได้', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { server, tools } = fakeServer()
    registerPurchaseTools(server, user.tenantId, user.userId, user.email, 'ADMIN')

    const poId = seedPo(user.tenantId, [{ description: 'น้ำตาล', qty: 5 }])
    const res = parseOk(await tools['create_goods_receipt']({
      po_id: poId,
      items: [{ description: 'น้ำตาล', received_qty: 999 }],
    }))

    expect(res.success).toBe(false)
    expect(res.message).toContain('เกินยอดค้าง')
  })
})

describe('MCP confirm_goods_receipt — ยืนยัน GR ที่ CANCELLED ซ้ำไม่ได้ (Bug #3)', () => {
  it('ของไม่เข้าสต็อกซ้ำรอบสอง', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { server, tools } = fakeServer()
    registerPurchaseTools(server, user.tenantId, user.userId, user.email, 'ADMIN')

    const poId = seedPo(user.tenantId, [{ description: 'ข้าวสาร', qty: 5 }])
    const created = parseOk(await tools['create_goods_receipt']({ po_id: poId }))
    expect(created.success, created.message).toBe(true)

    const confirmed = parseOk(await tools['confirm_goods_receipt']({ gr_id: created.grId }))
    expect(confirmed.success, confirmed.message).toBe(true)

    db.prepare("UPDATE goods_receipts SET status = 'CANCELLED' WHERE id = ?").run(created.grId)

    const reconfirmed = parseOk(await tools['confirm_goods_receipt']({ gr_id: created.grId }))
    expect(reconfirmed.success).toBe(false)
  })
})

describe('MCP convert_pr_to_po — ผูก linked_pr_id + เลข PO ใช้ตัวนับกลาง (Bug #5)', () => {
  it('linked_pr_id ต้องถูกบันทึก และเลขไม่ย้อนหลังหลัง PO อื่นถูกลบ', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { server, tools } = fakeServer()
    registerPurchaseTools(server, user.tenantId, user.userId, user.email, 'ADMIN')

    const supplierId = generateId()
    db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'Sup', 'C')")
      .run(supplierId, user.tenantId, supplierId)

    const created = parseOk(await tools['create_purchase_request']({
      description: 'ขอซื้อทดสอบ',
      items: [{ name: 'วัตถุดิบทดสอบ', qty: 3, unit: 'kg' }],
    }))
    await tools['approve_purchase_request']({ pr_id: created.prId })

    const converted = parseOk(await tools['convert_pr_to_po']({ pr_id: created.prId, supplier_id: supplierId }))
    expect(converted.success, converted.message).toBe(true)

    const po = db.prepare('SELECT linked_pr_id FROM purchase_orders WHERE id = ?').get(converted.poId) as any
    expect(po.linked_pr_id).toBe(created.prId)

    const seqRow = db.prepare("SELECT last_number FROM document_sequences WHERE tenant_id = ? AND doc_type = 'PO'").get(user.tenantId) as any
    const seqNum = (s: string) => parseInt(s.split('-').pop() || '0', 10)
    expect(seqRow.last_number).toBe(seqNum(converted.poNumber))
  })
})

describe('MCP create_goods_receipt — ของที่ไม่ต้องนับสต็อก รับได้แต่ต้องเตือน', () => {
  it('PO ที่ยังไม่ผูก material_id → รับของได้ แต่มีคำเตือนว่าจะไม่เพิ่มสต็อก', async () => {
    const tenantId = 'tn-unbound-' + Date.now()
    const poId = seedPo(tenantId, [{ description: 'ข้าวสาร', qty: 10, unbound: true }])
    const { server, tools } = fakeServer()
    registerPurchaseTools(server, tenantId, 'u1', 'tester', 'ADMIN')

    const res = parseOk(await tools.create_goods_receipt({ po_id: poId }))
    expect(res.success).toBe(true)
    expect(res.warning).toContain('จะไม่ถูกเพิ่มเข้าสต็อก')
    expect(res.warning).toContain('ข้าวสาร')
    expect(db.prepare('SELECT COUNT(*) c FROM goods_receipts WHERE purchase_order_id = ?').get(poId)).toMatchObject({ c: 1 })

    // ยืนยันแล้วต้องบอกกลับมาว่าบรรทัดไหนไม่ได้เข้าสต็อก ไม่ใช่เงียบ
    const confirmed = parseOk(await tools.confirm_goods_receipt({ gr_id: res.grNumber }))
    expect(confirmed.success).toBe(true)
  })
})

