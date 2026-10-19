import { Router } from 'express'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import { createKdsTicket } from '../services/kdsTicket.service'

const router = Router()

router.use(authenticate)

const now = () => new Date().toISOString()

// ==================== KDS Ticket-based API ====================

// POST /send — สร้าง ticket จาก item ที่ยังไม่ได้ส่งครัว (Atomic Transaction)
router.post('/send', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const { bill_id } = req.body

    if (!bill_id) return res.status(400).json({ success: false, message: 'bill_id required' })

    const bill = db.prepare(
      `SELECT id, bill_number, display_name FROM pos_running_bills WHERE id = ? AND tenant_id = ? AND status = 'OPEN'`
    ).get(bill_id, tenantId) as any

    if (!bill) return res.status(404).json({ success: false, message: 'Bill not found or not open' })

    const result = createKdsTicket(tenantId, bill)

    if (!result) {
      return res.status(400).json({ success: false, message: 'ไม่มีรายการใหม่ที่จะส่งครัว' })
    }

    res.json({ success: true, data: result })
  } catch (error) {
    console.error('Error sending to KDS:', error)
    res.status(500).json({ success: false, message: 'Failed to send to kitchen' })
  }
})

// GET /tickets — ตั๋วที่ครัวต้องเห็น:
//   ยังไม่เสร็จ ของบิลที่เปิดอยู่ หรือบิลที่จ่ายเงินแล้ว (ร้านที่ให้จ่ายก่อนทำ — เดิมจ่ายปุ๊บตั๋วหายจากครัว)
//   + ตั๋วที่บิลถูกยกเลิก (CANCELLED) ค้างเป็นการ์ดแดงจนเชฟกดรับทราบ
// ponytail: บิลที่จ่ายแล้วดูย้อนหลัง 12 ชม. กันตั๋วเก่าที่ไม่เคยกดเสร็จโผล่ — ร้านเปิดข้ามวันค่อยขยาย
router.get('/tickets', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const paidSince = new Date(Date.now() - 12 * 3600 * 1000).toISOString()

    const tickets = db.prepare(
      `SELECT t.* FROM pos_kds_tickets t
       INNER JOIN pos_running_bills b ON t.bill_id = b.id
       WHERE t.tenant_id = ? AND (
         t.status = 'CANCELLED'
         OR (t.status IN ('PENDING', 'IN_PROGRESS') AND (b.status = 'OPEN' OR (b.status = 'PAID' AND t.sent_at >= ?)))
       )
       ORDER BY (t.status = 'CANCELLED') DESC, t.sent_at ASC`
    ).all(tenantId, paidSince) as any[]

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

// PATCH /tickets/:id/status — อัปเดตสถานะ ticket พร้อม sync ไปยัง pos_bill_items
router.patch('/tickets/:id/status', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const { id } = req.params
    const { status } = req.body

    if (!['PENDING', 'IN_PROGRESS', 'DONE', 'CANCEL_ACK'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' })
    }

    const ticket = db.prepare(
      `SELECT id, status FROM pos_kds_tickets WHERE id = ? AND tenant_id = ?`
    ).get(id, tenantId) as any

    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' })

    // State machine: prevent moving backwards from DONE to PENDING
    if (ticket.status === 'DONE' && status !== 'DONE') {
      return res.status(400).json({ success: false, message: 'ไม่สามารถเปลี่ยนสถานะตั๋วที่เสร็จสิ้นแล้ว' })
    }
    // ตั๋วที่บิลถูกยกเลิก ทำได้อย่างเดียวคือกดรับทราบ — และรับทราบได้เฉพาะตั๋วที่ถูกยกเลิก
    if ((ticket.status === 'CANCELLED') !== (status === 'CANCEL_ACK') || ticket.status === 'CANCEL_ACK') {
      return res.status(400).json({ success: false, message: 'ตั๋วนี้ถูกยกเลิกแล้ว กดได้แค่รับทราบ' })
    }

    const updateTx = db.transaction(() => {
      db.prepare(`UPDATE pos_kds_tickets SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`)
        .run(status, now(), id, tenantId)

      // Sync status to pos_bill_items and pos_kds_ticket_items
      if (status === 'IN_PROGRESS') {
        db.prepare(
          `UPDATE pos_bill_items SET status = 'PREPARING'
           WHERE id IN (SELECT bill_item_id FROM pos_kds_ticket_items WHERE ticket_id = ?) AND tenant_id = ?`
        ).run(id, tenantId)
      } else if (status === 'DONE') {
        db.prepare(`UPDATE pos_kds_ticket_items SET status = 'DONE' WHERE ticket_id = ?`).run(id)
        db.prepare(
          `UPDATE pos_bill_items SET status = 'READY'
           WHERE id IN (SELECT bill_item_id FROM pos_kds_ticket_items WHERE ticket_id = ?) AND tenant_id = ?`
        ).run(id, tenantId)
      }
    })

    updateTx()

    res.json({ success: true, message: `Ticket updated to ${status}` })
  } catch (error) {
    console.error('Error updating ticket status:', error)
    res.status(500).json({ success: false, message: 'Failed to update ticket' })
  }
})

export default router
