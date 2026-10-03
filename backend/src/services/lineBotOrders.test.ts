import { describe, it, expect } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { lineBotService } from './line-bot.service'

/**
 * คำสั่ง LINE "ออเดอร์/orders" เคย query ตาราง orders ด้วย tenant_id ซึ่งไม่มีคอลัมน์นี้
 * → prepare throw ทุกครั้ง เทสต์นี้ยืนยันว่าอ่าน sales_orders แยกตาม tenant แล้ว
 */
function seedSO(tenantId: string, soNumber: string, amount: number, createdAt: string) {
  const customerId = generateId()
  db.prepare(`
    INSERT INTO customers (id, code, name, type, contact_name, email, phone, city, tenant_id)
    VALUES (?, ?, 'ลูกค้าทดสอบ', 'RETAIL', 'x', 'x@example.com', '0800000000', 'BKK', ?)
  `).run(customerId, 'CUS-' + customerId.slice(0, 8), tenantId)
  db.prepare(`
    INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, total_amount, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'CONFIRMED', ?)
  `).run(generateId(), tenantId, soNumber, customerId, amount, createdAt)
}

describe('LINE คำสั่ง orders (handleOrderCommand)', () => {
  it('ตอบ flex card จาก sales_orders เฉพาะ tenant ตัวเอง เรียงล่าสุดก่อน', async () => {
    const tA = 'tenant_linebot_' + generateId().slice(0, 8)
    const tB = 'tenant_linebot_' + generateId().slice(0, 8)
    seedSO(tA, 'SO-A-OLD', 100, '2026-01-01 10:00:00')
    seedSO(tA, 'SO-A-NEW', 2500, '2026-02-01 10:00:00')
    seedSO(tB, 'SO-B-1', 999, '2026-03-01 10:00:00')

    const replies: any[] = []
    const client = { replyMessage: async (_t: string, m: any) => { replies.push(m) } }
    await (lineBotService as any).handleOrderCommand(tA, 'reply-token', client)

    expect(replies).toHaveLength(1)
    const msg = replies[0]
    expect(msg.type).toBe('flex')
    const rows = msg.contents.body.contents
    const numbers = rows.map((r: any) => r.contents[0].text)
    expect(numbers).toEqual(['SO-A-NEW', 'SO-A-OLD'])
    expect(rows[0].contents[1].text).toBe('CONFIRMED')
    expect(rows[0].contents[2].text).toBe(`฿${Number(2500).toLocaleString()}`)
    expect(msg.quickReply).toBeDefined()
  })

  it('tenant ที่ไม่มีใบสั่งขาย → ข้อความ "ยังไม่มีคำสั่งซื้อ" ไม่ throw', async () => {
    const replies: any[] = []
    const client = { replyMessage: async (_t: string, m: any) => { replies.push(m) } }
    await (lineBotService as any).handleOrderCommand('tenant_linebot_empty_' + generateId().slice(0, 8), 'rt', client)
    expect(replies[0].type).toBe('text')
    expect(replies[0].text).toContain('ยังไม่มีคำสั่งซื้อ')
  })
})
