import { describe, it, expect, afterEach } from 'vitest'
import db from '../../db/sqlite'
import { deleteTenantPii } from '../../db/piiConnection'
import { generateId } from '../../utils/id'
import { registerTools, READ_ONLY_TOOLS } from '../tools'
import { registerOnlineOrderTools } from './onlineOrders'
import type { IMcpServer } from '../sdk-compat'

function fakeServer(): { server: IMcpServer; tools: Record<string, (args: any) => Promise<any>> } {
  const tools: Record<string, (args: any) => Promise<any>> = {}
  const server: IMcpServer = {
    tool: (name: string, _desc: string, _schema: any, handler: any) => { tools[name] = handler },
    connect: async () => {},
    close: async () => {},
  }
  return { server, tools }
}

const parseOk = (res: any) => JSON.parse(res.content[0].text)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    deleteTenantPii(t)
    for (const tbl of [
      'online_order_lines',
      'online_orders',
      'online_import_batches',
      'online_return_events',
      'platform_sku_proposals',
      'stock_item_aliases',
      'stock_items',
      'tenant_subscriptions',
      'users',
    ]) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch {}
    }
  }
})

function newTenant() {
  const t = 'test_mcp_online_' + generateId()
  tenants.push(t)
  return t
}

describe('MCP onlineOrders tools + feature gate', () => {
  it('online_submit_orders: บันทึกได้และผลลัพธ์ห้ามมี PII ดิบ', async () => {
    const t = newTenant()
    const { server, tools } = fakeServer()
    registerOnlineOrderTools(server, t, 'u1')

    const rawName = 'ธัชพงษ์'
    const rawPhone = '081-234-5678'
    const rawAddress = 'เลขที่ 858/7 หมู่ที่ 4 ตำบลรอบเมือง อำเภอเมืองชัยภูมิ จังหวัดชัยภูมิ 36000'

    const res = await tools['online_submit_orders']({
      platform: 'SHOPEE',
      shop_key: 'bebozch',
      rows: [
        {
          order_no: 'MCP-001',
          order_time: '2026-10-15 14:30',
          status: 'สำเร็จ',
          buyer_name: rawName,
          buyer_phone: rawPhone,
          full_address: rawAddress,
          province: 'ชัยภูมิ',
          district: 'เมืองชัยภูมิ',
          postal_code: '36000',
          product_name: 'หมอนยางพารา',
          variant_name: 'ลายดอกไม้',
          qty: 2,
          qty_returned: 0,
          list_price: 600,
          net_price: 500,
        },
      ],
    })

    const rawText = res.content[0].text as string
    expect(rawText).not.toContain(rawName)
    expect(rawText).not.toContain(rawPhone)
    expect(rawText).not.toContain('858/7')

    const body = parseOk(res)
    expect(body.success).toBe(true)
    expect(body.ordersInserted).toBe(1)
    expect(body.linesUnlinked).toBe(1)
  })

  it('online_submit_orders: ปฏิเสธ rows ว่าง หรือเกิน 150 แถว หรือ qty <= 0', async () => {
    const t = newTenant()
    const { server, tools } = fakeServer()
    registerOnlineOrderTools(server, t, 'u1')

    const empty = parseOk(await tools['online_submit_orders']({ platform: 'SHOPEE', shop_key: 's1', rows: [] }))
    expect(empty.success).toBe(false)

    const badQty = parseOk(await tools['online_submit_orders']({
      platform: 'SHOPEE',
      shop_key: 's1',
      rows: [{ order_no: 'O1', order_time: '2026-10-01 10:00', status: 'สำเร็จ', product_name: 'A', qty: 0, net_price: 100 }],
    }))
    expect(badQty.success).toBe(false)

    const tooMany = parseOk(await tools['online_submit_orders']({
      platform: 'SHOPEE',
      shop_key: 's1',
      rows: Array.from({ length: 151 }, (_, i) => ({
        order_no: `O${i}`,
        order_time: '2026-10-01 10:00',
        status: 'สำเร็จ',
        product_name: 'A',
        qty: 1,
        net_price: 100,
      })),
    }))
    expect(tooMany.success).toBe(false)
  })

  it('online_orders_query และ online_propose_mapping ทำงานถูกต้องและไม่คืน PII', async () => {
    const t = newTenant()
    const stockId = generateId()
    db.prepare(`
      INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
      VALUES (?, ?, 'SKU-1', 'หมอน', 'FINISHED', 20, 'pcs', 'pcs', 100, 'WH1', 'ACTIVE')
    `).run(stockId, t)

    const { server, tools } = fakeServer()
    registerOnlineOrderTools(server, t, 'u1')

    await tools['online_submit_orders']({
      platform: 'SHOPEE',
      shop_key: 'bebozch',
      rows: [
        {
          order_no: 'MCP-Q1',
          order_time: '2026-10-15 10:00',
          status: 'สำเร็จ',
          buyer_name: 'ทีปกร สะอาดถิ่น',
          buyer_phone: '66812345678',
          province: 'ราชบุรี',
          product_name: 'หมอน',
          qty: 2,
          net_price: 400,
        },
      ],
    })

    const qRes = await tools['online_orders_query']({ from: '2026-10-01', to: '2026-10-31', group_by: 'province' })
    expect(qRes.content[0].text).not.toContain('ทีปกร')
    expect(qRes.content[0].text).not.toContain('66812345678')
    const qBody = parseOk(qRes)
    expect(qBody.success).toBe(true)
    expect(qBody.unlinkedCount).toBe(1)
    expect(qBody.rows[0]).toMatchObject({ key: 'ราชบุรี', orders: 1, sales: 400, netSales: 400 })

    // เสนอคู่จับคู่ (ไม่ผูกจริง)
    const pRes = parseOk(await tools['online_propose_mapping']({
      pairs: [{ source_ref: 'SHOPEE:Nหมอน||', sku: 'SKU-1', factor: 1 }],
    }))
    expect(pRes.success).toBe(true)
    expect(pRes.accepted).toBe(1)
    expect((db.prepare(`SELECT COUNT(*) AS c FROM stock_item_aliases WHERE tenant_id = ?`).get(t) as any).c).toBe(0)
    expect((db.prepare(`SELECT COUNT(*) AS c FROM platform_sku_proposals WHERE tenant_id = ?`).get(t) as any).c).toBe(1)
  })

  it('READ_ONLY_TOOLS มี online_orders_query และไม่มี online_submit_orders/online_propose_mapping', () => {
    expect(READ_ONLY_TOOLS.has('online_orders_query')).toBe(true)
    expect(READ_ONLY_TOOLS.has('online_submit_orders')).toBe(false)
    expect(READ_ONLY_TOOLS.has('online_propose_mapping')).toBe(false)
  })

  it('feature gate: เทแนนต์ที่แพ็กเกจไม่มี platform_settlement จะไม่เห็น tool แพลตฟอร์มทั้งกลุ่ม (platformMonth + onlineOrders)', () => {
    const tLocked = newTenant()
    const tAllowed = newTenant()

    // สร้าง user ADMIN ทั้งคู่
    const uLocked = generateId()
    const uAllowed = generateId()
    db.prepare(`INSERT INTO users (id, email, password, name, role, tenant_id, status) VALUES (?, ?, 'x', 'Locked Admin', 'ADMIN', ?, 'active')`)
      .run(uLocked, `locked-${uLocked}@test.local`, tLocked)
    db.prepare(`INSERT INTO users (id, email, password, name, role, tenant_id, status) VALUES (?, ?, 'x', 'Allowed Admin', 'ADMIN', ?, 'active')`)
      .run(uAllowed, `allowed-${uAllowed}@test.local`, tAllowed)

    // แพ็ก free ไม่มี platform_settlement
    db.prepare(`
      INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status, packs, addons)
      VALUES (?, ?, 'free', 'FREE', '[]', '{}')
    `).run(generateId(), tLocked)

    // แพ็ก free + pack online → มีฟีเจอร์ platform_settlement
    db.prepare(`
      INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status, packs, addons)
      VALUES (?, ?, 'free', 'ACTIVE', '["online"]', '{}')
    `).run(generateId(), tAllowed)

    const lockedSrv = fakeServer()
    registerTools(lockedSrv.server, tLocked, uLocked)
    for (const toolName of [
      'platform_submit_file',
      'platform_month_status',
      'platform_propose_sku_mapping',
      'online_submit_orders',
      'online_orders_query',
      'online_propose_mapping',
    ]) {
      expect(lockedSrv.tools[toolName], `tenant ที่ไม่มีฟีเจอร์ต้องไม่เห็น ${toolName}`).toBeUndefined()
    }

    const allowedSrv = fakeServer()
    registerTools(allowedSrv.server, tAllowed, uAllowed)
    for (const toolName of [
      'platform_submit_file',
      'platform_month_status',
      'platform_propose_sku_mapping',
      'online_submit_orders',
      'online_orders_query',
      'online_propose_mapping',
    ]) {
      expect(allowedSrv.tools[toolName], `tenant ที่มีฟีเจอร์ต้องเห็น ${toolName}`).toBeDefined()
    }
  })
})
