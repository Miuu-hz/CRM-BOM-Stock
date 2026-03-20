import { Router } from 'express'
import db from '../db/sqlite'

const router = Router()

const generateId = () => {
  const chars = '0123456789abcdef'
  let id = ''
  for (let i = 0; i < 24; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}
const now = () => new Date().toISOString()

// ==================== KDS Ticket-based API ====================

// POST /send — สร้าง ticket จาก item ที่ยังไม่ได้ส่งครัว
router.post('/send', (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default'
    const { bill_id } = req.body

    if (!bill_id) return res.status(400).json({ success: false, message: 'bill_id required' })

    const bill = db.prepare(
      `SELECT id, bill_number, display_name FROM pos_running_bills WHERE id = ? AND tenant_id = ? AND status = 'OPEN'`
    ).get(bill_id, tenantId) as any

    if (!bill) return res.status(404).json({ success: false, message: 'Bill not found or not open' })

    const unsentItems = db.prepare(
      `SELECT id, product_name, quantity, special_instructions FROM pos_bill_items WHERE bill_id = ? AND sent_to_kds = 0`
    ).all(bill_id) as any[]

    if (unsentItems.length === 0) {
      return res.status(400).json({ success: false, message: 'ไม่มีรายการใหม่ที่จะส่งครัว' })
    }

    const roundRow = db.prepare(
      `SELECT MAX(round) as max_round FROM pos_kds_tickets WHERE bill_id = ?`
    ).get(bill_id) as any
    const round = (roundRow?.max_round || 0) + 1

    const ticketId = generateId()
    const sendTime = now()

    const sendTransaction = db.transaction(() => {
      db.prepare(
        `INSERT INTO pos_kds_tickets (id, tenant_id, bill_id, bill_number, table_name, round, status, sent_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`
      ).run(ticketId, tenantId, bill_id, bill.bill_number, bill.display_name, round, sendTime, sendTime)

      for (const item of unsentItems) {
        db.prepare(
          `INSERT INTO pos_kds_ticket_items (id, ticket_id, bill_item_id, product_name, quantity, special_instructions, status)
           VALUES (?, ?, ?, ?, ?, ?, 'PENDING')`
        ).run(generateId(), ticketId, item.id, item.product_name, item.quantity, item.special_instructions || null)
      }

      const ids = unsentItems.map(() => '?').join(',')
      db.prepare(`UPDATE pos_bill_items SET sent_to_kds = 1 WHERE id IN (${ids})`).run(...unsentItems.map(i => i.id))
    })

    sendTransaction()

    res.json({ success: true, data: { ticket_id: ticketId, round, item_count: unsentItems.length } })
  } catch (error) {
    console.error('Error sending to KDS:', error)
    res.status(500).json({ success: false, message: 'Failed to send to kitchen' })
  }
})

// GET /tickets — ดึง tickets ที่ active (PENDING + IN_PROGRESS) พร้อม items
router.get('/tickets', (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default'

    const tickets = db.prepare(
      `SELECT * FROM pos_kds_tickets
       WHERE tenant_id = ? AND status IN ('PENDING', 'IN_PROGRESS')
       ORDER BY sent_at ASC`
    ).all(tenantId) as any[]

    const result = tickets.map(ticket => {
      const items = db.prepare(
        `SELECT * FROM pos_kds_ticket_items WHERE ticket_id = ?`
      ).all(ticket.id)
      return { ...ticket, items }
    })

    res.json({ success: true, data: result })
  } catch (error) {
    console.error('Error fetching KDS tickets:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch tickets' })
  }
})

// PATCH /tickets/:id/status — อัปเดตสถานะ ticket
router.patch('/tickets/:id/status', (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default'
    const { id } = req.params
    const { status } = req.body

    if (!['PENDING', 'IN_PROGRESS', 'DONE'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' })
    }

    const ticket = db.prepare(
      `SELECT id FROM pos_kds_tickets WHERE id = ? AND tenant_id = ?`
    ).get(id, tenantId)

    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' })

    db.prepare(`UPDATE pos_kds_tickets SET status = ?, updated_at = ? WHERE id = ?`)
      .run(status, now(), id)

    res.json({ success: true, message: `Ticket updated to ${status}` })
  } catch (error) {
    console.error('Error updating ticket status:', error)
    res.status(500).json({ success: false, message: 'Failed to update ticket' })
  }
})

// ==================== Legacy item-based API (backward compat) ====================

router.get('/orders', (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default'
    const stmt = db.prepare(`
      SELECT bi.id, bi.bill_id, b.bill_number, b.display_name as bill_name, b.opened_at,
             bi.pos_menu_id, pmc.image_url, bi.product_name, bi.quantity,
             bi.special_instructions, bi.status, bi.added_at
      FROM pos_bill_items bi
      JOIN pos_running_bills b ON bi.bill_id = b.id
      JOIN pos_menu_configs pmc ON bi.pos_menu_id = pmc.id
      WHERE b.tenant_id = ? AND b.status = 'OPEN' AND bi.status IN ('PENDING', 'PREPARING')
      ORDER BY bi.added_at ASC
    `)
    const items = stmt.all(tenantId)
    const billsMap = new Map()
    items.forEach((item: any) => {
      if (!billsMap.has(item.bill_id)) {
        billsMap.set(item.bill_id, { bill_id: item.bill_id, bill_number: item.bill_number, bill_name: item.bill_name, opened_at: item.opened_at, items: [] })
      }
      billsMap.get(item.bill_id).items.push({ id: item.id, pos_menu_id: item.pos_menu_id, product_name: item.product_name, image_url: item.image_url, quantity: item.quantity, special_instructions: item.special_instructions, status: item.status, added_at: item.added_at })
    })
    res.json({ success: true, data: Array.from(billsMap.values()) })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch KDS orders' })
  }
})

router.patch('/items/:id/status', (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default'
    const { id } = req.params
    const { status } = req.body
    if (!['PENDING', 'PREPARING', 'READY', 'SERVED'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' })
    }
    const item = db.prepare(`SELECT bi.id FROM pos_bill_items bi JOIN pos_running_bills b ON bi.bill_id = b.id WHERE bi.id = ? AND b.tenant_id = ?`).get(id, tenantId)
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' })
    db.prepare(`UPDATE pos_bill_items SET status = ? WHERE id = ?`).run(status, id)
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update item status' })
  }
})

export default router
