import { describe, it, expect } from 'vitest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { registerSummaryTools } from './summary'

/**
 * สถานะ PO จริงคือ DRAFT/SUBMITTED/APPROVED/PARTIAL/RECEIVED/REJECTED/CANCELLED — ไม่มี PENDING
 * (PENDING เป็นสถานะของใบขอซื้อ PR) เดิม get_orders default กรอง 'PENDING' ทำให้ PO ที่ส่งรออนุมัติ
 * (SUBMITTED) หายไปจากรายการ "ที่ยังเปิดอยู่" และ get_summary ไม่นับเป็น open PO
 */
function fakeServer() {
  const tools: Record<string, any> = {}
  return {
    server: { tool: (name: string, _d: any, _s: any, handler: any) => { tools[name] = handler } } as any,
    call: async (name: string, args: any) => JSON.parse((await tools[name](args)).content[0].text),
  }
}

function seedPo(tenantId: string, status: string, total: number) {
  const supplierId = generateId()
  db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'Sup', 'C')")
    .run(supplierId, tenantId, supplierId)
  const poId = generateId()
  const poNumber = 'PO-' + status + '-' + poId.slice(0, 6)
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_rate, tax_amount, total_amount, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
  `).run(poId, tenantId, poNumber, supplierId, status, total, total, now, now)
  return poNumber
}

describe('MCP summary — สถานะ PO', () => {
  it('get_orders (ไม่ระบุ status) แสดง PO ที่ SUBMITTED/APPROVED/PARTIAL แต่ไม่แสดง DRAFT/RECEIVED/CANCELLED', async () => {
    const tenantId = 'tn' + generateId()
    const submitted = seedPo(tenantId, 'SUBMITTED', 100)
    const approved = seedPo(tenantId, 'APPROVED', 200)
    const partial = seedPo(tenantId, 'PARTIAL', 300)
    const draft = seedPo(tenantId, 'DRAFT', 1)
    const received = seedPo(tenantId, 'RECEIVED', 1)
    const cancelled = seedPo(tenantId, 'CANCELLED', 1)
    const { server, call } = fakeServer()
    registerSummaryTools(server, tenantId)

    const res = await call('get_orders', { type: 'po' })
    const nums = res.purchase_orders.map((p: any) => p.po_number)
    expect(nums).toEqual(expect.arrayContaining([submitted, approved, partial]))
    expect(nums).not.toContain(draft)
    expect(nums).not.toContain(received)
    expect(nums).not.toContain(cancelled)

    const onlySubmitted = await call('get_orders', { type: 'po', status: 'SUBMITTED' })
    expect(onlySubmitted.purchase_orders.map((p: any) => p.po_number)).toEqual([submitted])
  })

  it('get_summary นับ PO ที่ SUBMITTED เป็น open PO ด้วย', async () => {
    const tenantId = 'tn' + generateId()
    seedPo(tenantId, 'SUBMITTED', 100)
    seedPo(tenantId, 'APPROVED', 200)
    seedPo(tenantId, 'PARTIAL', 300)
    seedPo(tenantId, 'RECEIVED', 999)
    const { server, call } = fakeServer()
    registerSummaryTools(server, tenantId)

    const res = await call('get_summary', {})
    expect(res.purchase.openPOs).toBe(3)
    expect(res.purchase.committedSpend).toBe(600)
  })
})
