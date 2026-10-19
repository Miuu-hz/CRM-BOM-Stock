import db from '../db/sqlite'
import { generateId } from '../utils/id'

export interface KdsTicketResult { ticket_id: string; round: number; item_count: number }

/**
 * สร้างตั๋วครัว 1 รอบจากรายการในบิลที่ยังไม่ส่งครัว (atomic — กดรัวก็ไม่ส่งซ้ำ)
 * itemIds = ส่งเฉพาะรายการเหล่านี้ (ออเดอร์จาก QR ส่งของตัวเอง ไม่กวาดรายการที่แคชเชียร์ยังพักไว้ไปด้วย)
 * คืน null = ไม่มีรายการใหม่ให้ส่ง
 */
export function createKdsTicket(
  tenantId: string,
  bill: { id: string; bill_number: string; display_name: string },
  itemIds?: string[],
): KdsTicketResult | null {
  return db.transaction(() => {
    const onlyIds = itemIds?.length ? ` AND id IN (${itemIds.map(() => '?').join(',')})` : ''
    const unsentItems = db.prepare(
      `SELECT id, product_name, quantity, special_instructions FROM pos_bill_items
       WHERE bill_id = ? AND tenant_id = ? AND sent_to_kds = 0${onlyIds}`
    ).all(bill.id, tenantId, ...(itemIds || [])) as any[]
    if (unsentItems.length === 0) return null

    const roundRow = db.prepare(
      `SELECT MAX(round) as max_round FROM pos_kds_tickets WHERE bill_id = ? AND tenant_id = ?`
    ).get(bill.id, tenantId) as any
    const round = (roundRow?.max_round || 0) + 1

    const ticketId = generateId()
    const sendTime = new Date().toISOString()
    db.prepare(
      `INSERT INTO pos_kds_tickets (id, tenant_id, bill_id, bill_number, table_name, round, status, sent_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`
    ).run(ticketId, tenantId, bill.id, bill.bill_number, bill.display_name, round, sendTime, sendTime)

    const insertItem = db.prepare(
      `INSERT INTO pos_kds_ticket_items (id, ticket_id, bill_item_id, product_name, quantity, special_instructions, status)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING')`
    )
    for (const item of unsentItems) {
      insertItem.run(generateId(), ticketId, item.id, item.product_name, item.quantity, item.special_instructions || null)
    }

    const ids = unsentItems.map(() => '?').join(',')
    db.prepare(`UPDATE pos_bill_items SET sent_to_kds = 1 WHERE id IN (${ids}) AND tenant_id = ?`).run(...unsentItems.map(i => i.id), tenantId)

    return { ticket_id: ticketId, round, item_count: unsentItems.length }
  })()
}
