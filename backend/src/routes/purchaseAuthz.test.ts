import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import purchaseRouter from './purchase.routes'
import purchaseOrderRouter from './purchaseOrder.routes'
import supplierRouter from './supplier.routes'
import approvalRouter from './approval.routes'
import { createTestUser } from '../test/testAuth'
import { createGoodsReceipt, confirmGoodsReceipt, GoodsReceiptError } from '../services/goodsReceipt.service'
import { registerPurchaseTools } from '../mcp/tools/purchase'
import { registerTools } from '../mcp/tools'
import type { IMcpServer } from '../mcp/sdk-compat'
import { getOrCreateAccount } from '../services/accounting.service'
import { ACC } from '../config/accountCodes'
import { canApprove, hasBypass, isApprovalRequired } from '../services/approvalGate.service'
import { gateSalesCancel } from '../services/salesCancel.service'

/**
 * สิทธิ์ระบบจัดซื้อตามที่เจ้าของสั่ง 2026-10-24 (BRIEF-fix D1–D3) + ช่องโหว่จากรีวิว
 * D2 ผู้ใช้พื้นฐาน (USER ไม่มีแผนก): ร่าง PR/PO ได้อย่างเดียว · D3 ยกเลิก/void ต้องมีสิทธิ์แผนก ไม่งั้นขออนุมัติ
 */
const app = express()
app.use(express.json())
app.use('/api/purchase', purchaseRouter)
app.use('/api/purchase-orders', purchaseOrderRouter)
app.use('/api/suppliers', supplierRouter)
app.use('/api/approval', approvalRouter)
for (const p of ['/api/journal', '/api/accounts', '/api/bank-accounts', '/api/tax', '/api/sales']) {
  app.use(p, authenticate, (_req, res) => { res.json({ success: true }) })
}

type Who = ReturnType<typeof createTestUser>
function user(role: 'USER' | 'MANAGER' | 'POWERUSER' | 'ADMIN', departments: string[] = [], tenantId?: string): Who {
  const u = createTestUser({ role, tenantId })
  if (departments.length) db.prepare('UPDATE users SET departments = ? WHERE id = ?').run(JSON.stringify(departments), u.userId)
  return u
}
const as = (u: Who) => ({ Authorization: `Bearer ${u.token}` })

function seedSupplier(tenantId: string) {
  const id = generateId()
  db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'Sup', 'C')").run(id, tenantId, id)
  return id
}

function seedPo(tenantId: string, status = 'APPROVED', qty = 5) {
  const supplierId = seedSupplier(tenantId)
  const stockId = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, sealed_qty, unit, base_unit, location, status, unit_cost)
    VALUES (?, ?, ?, 'ของทดสอบ', 'RAW', 0, 0, 'pcs', 'pcs', 'WH1', 'ACTIVE', 1)
  `).run(stockId, tenantId, 'SKU-' + stockId.slice(0, 6))
  const poId = generateId()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_amount, total_amount, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 50, 0, 50, ?, ?)
  `).run(poId, tenantId, 'PO-' + poId.slice(0, 6), supplierId, status, now, now)
  const poItemId = generateId()
  db.prepare(`
    INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, quantity, unit, unit_price, total_price, received_qty)
    VALUES (?, ?, ?, ?, 'ของทดสอบ', ?, 'pcs', 10, ?, 0)
  `).run(poItemId, tenantId, poId, stockId, qty, qty * 10)
  return { poId, poItemId, stockId, supplierId }
}

const stockQty = (id: string) => (db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(id) as any).quantity
const statusOf = (table: string, id: string) => (db.prepare(`SELECT status FROM ${table} WHERE id = ?`).get(id) as any).status

function confirmedGr(tenantId: string) {
  const po = seedPo(tenantId)
  const gr = createGoodsReceipt(tenantId, 'tester', {
    purchaseOrderId: po.poId,
    items: [{ poItemId: po.poItemId, materialId: po.stockId, orderedQty: 5, receivedQty: 5, acceptedQty: 5 }],
  }) as any
  confirmGoodsReceipt(tenantId, 'tester', gr.id)
  return { ...po, grId: gr.id }
}

describe('ใบรับสินค้า: บรรทัดต้องเป็นของใบสั่งซื้อนี้', () => {
  it('อ้าง PO item ของใบอื่น (ยังไม่อนุมัติ) → ปฏิเสธ ไม่มีของเข้าคลัง', () => {
    const u = user('ADMIN')
    const a = seedPo(u.tenantId, 'APPROVED')
    const b = seedPo(u.tenantId, 'DRAFT', 1)
    expect(() => createGoodsReceipt(u.tenantId, 'x', {
      purchaseOrderId: a.poId,
      items: [{ poItemId: b.poItemId, materialId: b.stockId, orderedQty: 1, receivedQty: 1000, acceptedQty: 1000 }],
    })).toThrow(GoodsReceiptError)
    expect(stockQty(b.stockId)).toBe(0)
  })

  it('สร้างใบรับสินค้าผ่าน REST ต้องเป็นฝ่ายจัดซื้อ/คลัง — ผู้ใช้พื้นฐานได้ 403', async () => {
    const basic = user('USER')
    const po = seedPo(basic.tenantId)
    const res = await request(app).post('/api/purchase/goods-receipts').set(as(basic)).send({ purchaseOrderId: po.poId })
    expect(res.status).toBe(403)
  })
})

describe('D2 ผู้ใช้พื้นฐาน', () => {
  it('สร้าง/แก้ PO ร่างได้ แต่ส่งอนุมัติไม่ได้ · แก้ "จ่ายแล้ว" ไม่ได้', async () => {
    const basic = user('USER')
    const supplierId = seedSupplier(basic.tenantId)
    const created = await request(app).post('/api/purchase-orders').set(as(basic))
      .send({ supplierId, items: [{ quantity: 1, unitPrice: 100 }], isPaid: 1, paidAmount: 100 })
    expect(created.status).toBe(201)
    expect(created.body.data).toMatchObject({ status: 'DRAFT', is_paid: 0 })
    const poId = created.body.data.id

    const submit = await request(app).put(`/api/purchase-orders/${poId}/status`).set(as(basic)).send({ status: 'SUBMITTED' })
    expect(submit.status).toBe(403)
    expect(statusOf('purchase_orders', poId)).toBe('DRAFT')
  })

  it('ร่างเป็นสิทธิ์พื้นฐาน: USER ฝ่ายขายสร้าง PO ร่างได้ แต่ส่งอนุมัติไม่ได้ (ไม่มีสิทธิ์ purchase)', async () => {
    const sales = user('USER', ['SALES'])
    const res = await request(app).post('/api/purchase-orders').set(as(sales))
      .send({ items: [{ quantity: 1, unitPrice: 100 }] })
    expect(res.status).toBe(201)
    expect(res.body.data.status).toBe('DRAFT')
    const submit = await request(app).put(`/api/purchase-orders/${res.body.data.id}/status`).set(as(sales)).send({ status: 'SUBMITTED' })
    expect(submit.status).toBe(403)
    expect(statusOf('purchase_orders', res.body.data.id)).toBe('DRAFT')
  })

  it('เพิ่ม/แก้ผู้ขายไม่ได้ · ฝ่ายจัดซื้อได้', async () => {
    const basic = user('USER')
    const denied = await request(app).post('/api/suppliers').set(as(basic)).send({ code: 'S1', name: 'n', contactName: 'c' })
    expect(denied.status).toBe(403)
    const purchase = user('USER', ['PURCHASE'], basic.tenantId)
    const ok = await request(app).post('/api/suppliers').set(as(purchase)).send({ code: 'S1', name: 'n', contactName: 'c' })
    expect(ok.status).toBe(201)
  })

  it('API บัญชี/ภาษีถูกปิด ยกเว้นรายชื่อบัญชีเงิน/ธนาคารที่หน้าแคชเชียร์ใช้ · POS/ขายยังใช้ได้', async () => {
    const basic = user('USER')
    expect((await request(app).get('/api/journal').set(as(basic))).status).toBe(403)
    expect((await request(app).get('/api/tax/vat').set(as(basic))).status).toBe(403)
    expect((await request(app).post('/api/accounts').set(as(basic)).send({})).status).toBe(403)
    expect((await request(app).get('/api/accounts').set(as(basic))).status).toBe(200)
    expect((await request(app).get('/api/bank-accounts').set(as(basic))).status).toBe(200)
    expect((await request(app).post('/api/sales/pos-shifts/x/close').set(as(basic)).send({})).status).toBe(200)
    const acc = user('USER', ['ACCOUNTING'])
    expect((await request(app).get('/api/journal').set(as(acc))).status).toBe(200)
  })
})

describe('D3 ยกเลิก/void เอกสารซื้อ', () => {
  it('MANAGER แผนกอื่นยกเลิกใบรับสินค้า → 202 คำขอ · ADMIN อนุมัติแล้วสต็อกถูกคืน', async () => {
    const admin = user('ADMIN')
    const gr = confirmedGr(admin.tenantId)
    expect(stockQty(gr.stockId)).toBe(5)

    const qc = user('MANAGER', ['QC'], admin.tenantId)
    const res = await request(app).put(`/api/purchase/goods-receipts/${gr.grId}/status`).set(as(qc)).send({ status: 'CANCELLED' })
    expect(res.status).toBe(202)
    expect(res.body.message).toContain('ส่งคำขออนุมัติแล้ว')
    expect(statusOf('goods_receipts', gr.grId)).toBe('CONFIRMED')

    const decide = await request(app).put(`/api/approval/requests/${res.body.request_id}/decision`).set(as(admin)).send({ decision: 'APPROVED' })
    expect(decide.status).toBe(200)
    expect(statusOf('goods_receipts', gr.grId)).toBe('CANCELLED')
    expect(stockQty(gr.stockId)).toBe(0)
  })

  it('MANAGER ฝ่ายจัดซื้อยกเลิกได้ทันที (บันทึก AUTO ไว้)', async () => {
    const mgr = user('MANAGER', ['PURCHASE'])
    const gr = confirmedGr(mgr.tenantId)
    const res = await request(app).put(`/api/purchase/goods-receipts/${gr.grId}/status`).set(as(mgr)).send({ status: 'CANCELLED' })
    expect(res.status).toBe(200)
    expect(statusOf('goods_receipts', gr.grId)).toBe('CANCELLED')
    const log = db.prepare("SELECT status FROM approval_requests WHERE reference_id = ? AND module_type = 'purchase_cancel'").get(gr.grId) as any
    expect(log.status).toBe('AUTO')
  })

  it('ผู้ขอปฏิเสธคำขอ → เอกสารคงเดิม (ไม่ตก branch supplier_payments เดิม)', async () => {
    const admin = user('ADMIN')
    const po = seedPo(admin.tenantId, 'APPROVED')
    const pu = user('POWERUSER', [], admin.tenantId)
    const res = await request(app).put(`/api/purchase-orders/${po.poId}/status`).set(as(pu)).send({ status: 'CANCELLED' })
    expect(res.status).toBe(202)
    await request(app).put(`/api/approval/requests/${res.body.request_id}/decision`).set(as(admin)).send({ decision: 'REJECTED' })
    expect(statusOf('purchase_orders', po.poId)).toBe('APPROVED')
  })
})

describe('GM = ADMIN/MASTER/OWNER หรือแผนก CEO (หมวดที่ต้องอนุมัติเสมอ)', () => {
  const ceo = (role: 'USER' | 'MANAGER', departments = ['CEO']) => ({ userId: generateId(), email: 'gm@x', role, departments })

  it('purchase_cancel: แผนก CEO อนุมัติคำขอยกเลิกของคนอื่นได้ เกิน 5,000 โดยไม่ต้องมอบสิทธิ์', async () => {
    const admin = user('ADMIN')
    const po = seedPo(admin.tenantId, 'APPROVED')
    db.prepare('UPDATE purchase_orders SET total_amount = 20000 WHERE id = ?').run(po.poId)
    const pu = user('POWERUSER', [], admin.tenantId)
    const req = await request(app).put(`/api/purchase-orders/${po.poId}/status`).set(as(pu)).send({ status: 'CANCELLED' })
    expect(req.status).toBe(202)

    const gm = user('USER', ['CEO'], admin.tenantId)
    const res = await request(app).put(`/api/approval/requests/${req.body.request_id}/decision`).set(as(gm)).send({ decision: 'APPROVED' })
    expect(res.status).toBe(200)
    expect(statusOf('purchase_orders', po.poId)).toBe('CANCELLED')

    // คนที่ไม่ใช่ GM ยังติดเพดาน/ต้องมอบสิทธิ์ตามเดิม
    const po2 = seedPo(admin.tenantId, 'APPROVED')
    const req2 = await request(app).put(`/api/purchase-orders/${po2.poId}/status`).set(as(pu)).send({ status: 'CANCELLED' })
    const mgr = user('MANAGER', ['PURCHASE'], admin.tenantId)
    const denied = await request(app).put(`/api/approval/requests/${req2.body.request_id}/decision`).set(as(mgr)).send({ decision: 'APPROVED' })
    expect(denied.status).toBe(403)
  })

  it('purchase_cancel / sales_cancel: แผนก CEO ทำได้เลย (ไม่ต้องขอ) · อนุมัติคำขอได้ไม่ติดเพดาน · คนอื่นต้องขอ', () => {
    for (const category of ['purchase_cancel', 'sales_cancel'] as const) {
      const tenantId = generateId()
      for (const gm of [ceo('USER'), ceo('MANAGER')]) {
        expect(isApprovalRequired(tenantId, gm, category), category).toBe(false)
        expect(canApprove(tenantId, gm, category, 50000), category).toBe(true)
      }
      const other = ceo('MANAGER', ['SALES', 'PURCHASE'])
      expect(isApprovalRequired(tenantId, other, category), category).toBe(true)
      expect(hasBypass(tenantId, other, category), category).toBe(false)
      expect(canApprove(tenantId, other, category, 50000), category).toBe(false)
    }
    const { pending } = gateSalesCancel({ tenantId: generateId(), user: ceo('USER'), kind: 'invoice', refId: generateId(), docNumber: 'INV-1', amount: 9000 })
    expect(pending).toBeNull()
  })
})

describe('สถานะเดินได้ทางเดียว', () => {
  it('PO ที่ยกเลิกแล้วปลุกกลับเป็น SUBMITTED/APPROVED ไม่ได้', async () => {
    const admin = user('ADMIN')
    const po = seedPo(admin.tenantId, 'CANCELLED')
    for (const status of ['SUBMITTED', 'APPROVED']) {
      const res = await request(app).put(`/api/purchase-orders/${po.poId}/status`).set(as(admin)).send({ status })
      expect(res.status).toBe(400)
    }
    expect(statusOf('purchase_orders', po.poId)).toBe('CANCELLED')
  })

  it('PR ที่แปลงเป็น PO แล้ว อนุมัติซ้ำไม่ได้ · อนุมัติผ่านเว็บบันทึก approved_at', async () => {
    const admin = user('ADMIN')
    const prId = generateId()
    db.prepare(`INSERT INTO purchase_requests (id, tenant_id, pr_number, requester_id, requester_name, status, total_amount, request_date)
      VALUES (?, ?, ?, 'u', 'n', 'CONVERTED', 100, ?)`).run(prId, admin.tenantId, 'PR-' + prId.slice(0, 6), new Date().toISOString())
    const res = await request(app).put(`/api/purchase/requests/${prId}/status`).set(as(admin)).send({ status: 'APPROVED' })
    expect(res.status).toBe(400)

    db.prepare("UPDATE purchase_requests SET status = 'PENDING' WHERE id = ?").run(prId)
    const ok = await request(app).put(`/api/purchase/requests/${prId}/status`).set(as(admin)).send({ status: 'APPROVED' })
    expect(ok.status).toBe(200)
    expect(ok.body.data).toMatchObject({ status: 'APPROVED', approved_by: admin.userId })
    expect(ok.body.data.approved_at).toBeTruthy()
  })
})

describe('ยอด/ค่าที่มาจาก client', () => {
  it('ยอดใบขอซื้อ = จำนวน × ราคา (ไม่เชื่อ estimatedTotalPrice) รองรับ snake_case จากหน้าเว็บ', async () => {
    const basic = user('USER')
    const res = await request(app).post('/api/purchase/requests').set(as(basic)).send({
      items: [
        { description: 'a', quantity: 10, estimatedUnitPrice: 100, estimatedTotalPrice: 0 },
        { description: 'b', quantity: 2, estimated_unit_price: 50 },
      ],
    })
    expect(res.status).toBe(201)
    expect(res.body.data.total_amount).toBe(1100)
  })

  it('แก้ PO ร่างด้วยจำนวนติดลบ → 400 (เหมือนตอนสร้าง)', async () => {
    const admin = user('ADMIN')
    const po = seedPo(admin.tenantId, 'DRAFT')
    const res = await request(app).put(`/api/purchase-orders/${po.poId}`).set(as(admin))
      .send({ items: [{ quantity: -5, unitPrice: 100 }] })
    expect(res.status).toBe(400)
  })

  it('id ของเทแนนต์อื่น: ผู้ขายตอนแปลง PR, บัญชีธนาคาร/PR อ้างอิงตอนสร้าง PO → 400', async () => {
    const admin = user('ADMIN')
    const other = user('ADMIN')
    const foreignSupplier = seedSupplier(other.tenantId)
    const foreignBank = generateId()
    db.prepare("INSERT INTO bank_accounts (id, tenant_id, bank_name, account_number, account_name, account_id) VALUES (?, ?, 'B', '123', 'n', ?)")
      .run(foreignBank, other.tenantId, getOrCreateAccount(other.tenantId, ACC.BANK))

    const prId = generateId()
    db.prepare(`INSERT INTO purchase_requests (id, tenant_id, pr_number, requester_id, requester_name, status, total_amount, request_date)
      VALUES (?, ?, ?, 'u', 'n', 'APPROVED', 0, ?)`).run(prId, admin.tenantId, 'PR-' + prId.slice(0, 6), new Date().toISOString())
    const conv = await request(app).post(`/api/purchase/requests/${prId}/convert-to-po`).set(as(admin)).send({ supplierId: foreignSupplier })
    expect(conv.status).toBe(400)

    const bank = await request(app).post('/api/purchase-orders').set(as(admin)).send({ items: [{ quantity: 1, unitPrice: 1 }], bankAccountId: foreignBank })
    expect(bank.status).toBe(400)
    const pr = await request(app).post('/api/purchase-orders').set(as(admin)).send({ items: [{ quantity: 1, unitPrice: 1 }], linkedPrId: generateId() })
    expect(pr.status).toBe(400)
  })

  it('แปลง PR เป็น PO เก็บหมายเหตุที่กรอกไว้', async () => {
    const admin = user('ADMIN')
    const supplierId = seedSupplier(admin.tenantId)
    const prId = generateId()
    db.prepare(`INSERT INTO purchase_requests (id, tenant_id, pr_number, requester_id, requester_name, status, total_amount, request_date)
      VALUES (?, ?, ?, 'u', 'n', 'APPROVED', 0, ?)`).run(prId, admin.tenantId, 'PR-' + prId.slice(0, 6), new Date().toISOString())
    const res = await request(app).post(`/api/purchase/requests/${prId}/convert-to-po`).set(as(admin)).send({ supplierId, notes: 'ส่งด่วน' })
    expect(res.status).toBe(201)
    expect(res.body.data.notes).toContain('ส่งด่วน')
  })
})

describe('ผู้ขาย: ข้อมูลใบสั่งซื้อต้องเป็นของเทแนนต์ตัวเอง', () => {
  it('PO ของเทแนนต์อื่นที่อ้าง supplier id เดียวกัน ไม่โผล่ในหน้า supplier', async () => {
    const a = user('ADMIN')
    const b = user('ADMIN')
    const supplierId = seedSupplier(a.tenantId)
    const poId = generateId()
    db.prepare(`INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, total_amount, created_at, updated_at)
      VALUES (?, ?, 'PO-B', ?, 'APPROVED', 999, datetime('now'), datetime('now'))`).run(poId, b.tenantId, supplierId)
    const res = await request(app).get(`/api/suppliers/${supplierId}`).set(as(a))
    expect(res.body.data.purchaseOrders).toEqual([])
  })
})

describe('MCP ใช้สิทธิ์เดียวกับ REST', () => {
  function tools(u: Who) {
    const t: Record<string, (args: any) => Promise<any>> = {}
    const server: IMcpServer = { tool: (name: string, _d: string, _s: any, h: any) => { t[name] = h }, connect: async () => {}, close: async () => {} }
    registerPurchaseTools(server, u.tenantId, u.userId, u.email, u.role)
    return t
  }
  const call = async (t: any, name: string, args: any) => JSON.parse((await t[name](args)).content[0].text)

  it('ผู้ใช้พื้นฐานยืนยันรับสินค้า/แปลง PR ไม่ได้', async () => {
    const basic = user('USER')
    const t = tools(basic)
    const po = seedPo(basic.tenantId)
    const gr = createGoodsReceipt(basic.tenantId, 'x', { purchaseOrderId: po.poId }) as any
    expect((await call(t, 'confirm_goods_receipt', { gr_id: gr.id })).success).toBe(false)
    expect(statusOf('goods_receipts', gr.id)).toBe('DRAFT')
    expect((await call(t, 'convert_pr_to_po', { pr_id: 'x', supplier_id: 'y' })).success).toBe(false)
  })

  it('approve_purchase_request อนุมัติได้เฉพาะ DRAFT/PENDING', async () => {
    const admin = user('ADMIN')
    const prId = generateId()
    db.prepare(`INSERT INTO purchase_requests (id, tenant_id, pr_number, requester_id, requester_name, status, total_amount, request_date)
      VALUES (?, ?, ?, 'u', 'n', 'CONVERTED', 0, ?)`).run(prId, admin.tenantId, 'PR-' + prId.slice(0, 6), new Date().toISOString())
    expect((await call(tools(admin), 'approve_purchase_request', { pr_id: prId })).success).toBe(false)
    expect(statusOf('purchase_requests', prId)).toBe('CONVERTED')
  })

  it('update_po_status CANCELLED โดยคนไม่มีสิทธิ์แผนก → ส่งคำขอ ใบยังไม่ถูกยกเลิก', async () => {
    const u = user('USER', ['PURCHASE'])
    const po = seedPo(u.tenantId, 'APPROVED')
    const out = await call(tools(u), 'update_po_status', { po_id: po.poId, status: 'CANCELLED' })
    expect(out.pending_approval).toBe(true)
    expect(statusOf('purchase_orders', po.poId)).toBe('APPROVED')
  })

  it('update_purchase_order กับ PO ที่อนุมัติแล้ว → ข้อความ D1', async () => {
    const admin = user('ADMIN')
    const po = seedPo(admin.tenantId, 'APPROVED')
    const out = await call(tools(admin), 'update_purchase_order', { po_id: po.poId, notes: 'x' })
    expect(out.message).toContain('reopen')
  })

  it('แคชเชียร์ (แผนก POS อย่างเดียว) ไม่เห็น tool ใดเลย · ผู้ใช้พื้นฐานไม่เห็น tool บัญชี', () => {
    const names = (u: Who) => {
      const n: string[] = []
      registerTools({ tool: (name: string) => { n.push(name) }, connect: async () => {}, close: async () => {} } as any, u.tenantId, u.userId)
      return n
    }
    expect(names(user('USER', ['POS']))).toEqual([])
    const basic = names(user('USER'))
    expect(basic).toContain('create_draft_po')
    expect(basic).not.toContain('get_trial_balance')
  })
})
