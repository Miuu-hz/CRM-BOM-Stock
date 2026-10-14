import { describe, it, expect } from 'vitest'
import { generateId } from '../../utils/id'
import { registerPlatformMonthTools } from './platformMonth'
import type { IMcpServer } from '../sdk-compat'

// ตรวจ zod schema ของ platform_submit_file (findings #7 / #13 / #17) — เรียกตรงผ่าน handler โดยไม่ยุ่ง DB
// เลยถ้า schema reject ตั้งแต่ชั้น safeParse (ไม่ถึง submitFile) ก็ไม่ต้อง seed tenant จริง
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

const BASE = { platform: 'SHOPEE' as const, shop_key: 'ร้านหลัก', month: '2026-10' }

describe('MCP platform_submit_file — zod schema (findings #7, #13, #17)', () => {
  const { server, tools } = fakeServer()
  registerPlatformMonthTools(server, 'test_tenant_' + generateId(), 'u1')
  const submit = tools['platform_submit_file']

  it('products: แถว level="variant" ไม่มี variant_id ต้องถูกปฏิเสธ (finding #7)', async () => {
    const res = await submit({ ...BASE, file_type: 'products', data: { rows: [{ level: 'variant', product_id: 'P1' }] } })
    const body = parseOk(res)
    expect(body.success).toBe(false)
    expect(body.message).toMatch(/variant_id/)
  })

  it('products: แถว (ทั้ง parent/variant) ไม่มี product_id ต้องถูกปฏิเสธ (finding #7)', async () => {
    const res = await submit({ ...BASE, file_type: 'products', data: { rows: [{ level: 'parent' }] } })
    const body = parseOk(res)
    expect(body.success).toBe(false)
    expect(body.message).toMatch(/product_id/)
  })

  it('products: rows ว่างเปล่าต้องถูกปฏิเสธ (finding #13 — เดิมผ่านได้ products_received=1 ทั้งที่ไม่มีข้อมูล)', async () => {
    const res = await submit({ ...BASE, file_type: 'products', data: { rows: [] } })
    const body = parseOk(res)
    expect(body.success).toBe(false)
  })

  it('income: ตัวเลขเกินขอบ (เกิน 1 หมื่นล้าน) ต้องถูกปฏิเสธ (finding #13)', async () => {
    const res = await submit({
      ...BASE,
      file_type: 'income',
      data: {
        period_start: '2026-10-01', period_end: '2026-10-31', order_count: 1, product_list_price: 1e12,
        seller_discount: 0, refund_to_buyer: 0, shopee_product_discount: 0, product_sales: 1, total_income: 1,
        shipping_buyer_paid: 0, shipping_shopee_subsidy: 0, shipping_charged: 0, shipping_return: 0,
        commission: 0, ams_commission: 0, service_fee: 0, infrastructure_fee: 0, transaction_fee: 0,
        ads_topup_from_escrow: 0, total_expense: 0, total_transferred: 1,
        adjustments: { total: 0, marketing: 0, shipping_claim: 0, refund_after_complete: 0, other: 0 },
      },
    })
    const body = parseOk(res)
    expect(body.success).toBe(false)
  })

  it('income: period_end รูปแบบวันที่ผิด (dd/mm/yyyy) ต้องถูกปฏิเสธ (finding #13)', async () => {
    const res = await submit({
      ...BASE,
      file_type: 'income',
      data: {
        period_start: '2026-10-01', period_end: '05/10/2026', order_count: 1, product_list_price: 1,
        seller_discount: 0, refund_to_buyer: 0, shopee_product_discount: 0, product_sales: 1, total_income: 1,
        shipping_buyer_paid: 0, shipping_shopee_subsidy: 0, shipping_charged: 0, shipping_return: 0,
        commission: 0, ams_commission: 0, service_fee: 0, infrastructure_fee: 0, transaction_fee: 0,
        ads_topup_from_escrow: 0, total_expense: 0, total_transferred: 1,
        adjustments: { total: 0, marketing: 0, shipping_claim: 0, refund_after_complete: 0, other: 0 },
      },
    })
    const body = parseOk(res)
    expect(body.success).toBe(false)
  })

  it('stats: totals.repeat_rate เกิน 1 (ส่ง 35 แทน 0.35) ต้องถูกปฏิเสธ (finding #17)', async () => {
    const res = await submit({
      ...BASE,
      file_type: 'stats',
      data: {
        period_start: '2026-10-01', period_end: '2026-10-31',
        totals: {
          sales_all: 0, sales_confirmed: 0, orders_all: 0, orders_confirmed: 0, visitors: 0, clicks: 0,
          cancelled_orders: 0, cancelled_sales: 0, buyers: 0, new_buyers: 0, existing_buyers: 0,
          potential_buyers: 0, repeat_rate: 35,
        },
        daily: [],
        sources: { product_page: 0, live: 0, video: 0, partner: 0, ads_attributed: 0 },
      },
    })
    const body = parseOk(res)
    expect(body.success).toBe(false)
  })
})
