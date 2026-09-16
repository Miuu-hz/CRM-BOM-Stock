import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { approvalDenyReason } from '../services/approvalGate.service'
import { authenticate, requireRole } from '../middleware/auth.middleware'
import { getDb } from '../db/sqlite'
import { formatDocumentNumber } from '../utils/id'
import { lineBotService } from '../services/line-bot.service'

const router = Router()
router.use(authenticate)

// ─── POST /api/purchase-requests — create PR from web (shortage auto-PR) ─────
const CreatePRSchema = z.object({
  reason: z.string().max(500).optional(),
  items: z.array(z.object({
    material_id: z.string().optional().nullable(),
    material_name: z.string().min(1).max(255),
    quantity: z.coerce.number().positive(),
    unit: z.string().max(50).optional(),
  })).min(1),
})

router.post('/', (req: Request, res: Response) => {
  try {
    const { tenantId, userId, email } = req.user!
    const db = getDb()
    const parsed = CreatePRSchema.safeParse(req.body)
    if (!parsed.success) return void res.status(400).json({ success: false, message: parsed.error.issues[0].message })

    const { reason, items } = parsed.data
    const prNumber = formatDocumentNumber('PR', tenantId, 'PURCHASE_REQUEST', new Date().getFullYear(), 5)
    const prId = randomUUID()

    db.prepare(`
      INSERT INTO purchase_requests
        (id, tenant_id, pr_number, requester_id, requester_name, supplier_name, source, status, notes)
      VALUES (?, ?, ?, ?, ?, 'TBD', 'WEB', 'DRAFT', ?)
    `).run(prId, tenantId, prNumber, userId, email, reason || null)

    const insertItem = db.prepare(`
      INSERT INTO purchase_request_items
        (id, tenant_id, purchase_request_id, pr_id, material_id, description, item_name, quantity, unit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    db.transaction(() => {
      for (const item of items) {
        insertItem.run(
          randomUUID(), tenantId, prId, prId,
          item.material_id || null,
          item.material_name,
          item.material_name,
          item.quantity,
          item.unit || 'pcs',
        )
      }
    })()

    res.json({ success: true, data: { id: prId, pr_number: prNumber } })
  } catch (e) {
    console.error('Create PR error:', e)
    res.status(500).json({ success: false, message: 'Failed to create PR' })
  }
})

// ─── POST /api/purchase-requests/from-image — OCR รูปภาพ → สร้าง Draft PR ──────
// รองรับ 2 โหมด:
//   1. imageBase64 — backend ส่งรูปไปยัง LLM provider (vision) เพื่อ OCR
//   2. extractedItems — mobile (Gemma4 E2B/E4B บนเครื่อง) ส่ง items ที่อ่านแล้วมาเลย
const FromImageSchema = z.object({
  imageBase64:    z.string().optional(),
  imageType:      z.string().default('image/jpeg'),
  extractedItems: z.array(z.object({
    name:       z.string().min(1).max(255),
    quantity:   z.coerce.number().positive(),
    unit:       z.string().max(50).default('pcs'),
    unit_price: z.coerce.number().min(0).default(0),
  })).optional(),
  notes:      z.string().max(500).optional(),
  providerId: z.string().optional(),
})
router.post('/:id/cancel', (req: Request, res: Response) => {
    try {
        const { tenantId, role, email } = req.user!
        const db = getDb()

        const ALLOWED_ROLES = ['MASTER', 'ADMIN', 'MANAGER', 'POWERUSER']
        if (!ALLOWED_ROLES.includes(String(role))) {
            return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ยกเลิกใบขอซื้อ — ต้องเป็นผู้จัดการขึ้นไป' })
        }

        const pr = db.prepare('SELECT * FROM purchase_requests WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
        if (!pr) return res.status(404).json({ success: false, message: 'ไม่พบใบขอซื้อ' })

        if (pr.status === 'CANCELLED') {
            return res.status(400).json({ success: false, message: 'ใบขอซื้อนี้ถูกยกเลิกไปแล้ว' })
        }
        if (pr.status === 'REJECTED') {
            return res.status(400).json({ success: false, message: 'ใบขอซื้อนี้ถูกปฏิเสธไปแล้ว ไม่ต้องยกเลิกซ้ำ' })
        }

        const linkedPO = db.prepare(
            "SELECT po_number, status FROM purchase_orders WHERE tenant_id = ? AND linked_pr_id = ? AND status != 'CANCELLED' LIMIT 1"
        ).get(tenantId, req.params.id) as any
        if (linkedPO) {
            return res.status(400).json({
                success: false,
                code: 'PR_HAS_ACTIVE_PO',
                message: `ยกเลิกไม่ได้ — มีใบสั่งซื้อ ${linkedPO.po_number} ที่ออกจากใบขอซื้อนี้อยู่ กรุณายกเลิกใบสั่งซื้อก่อน`,
            })
        }

        const reason = String(req.body?.reason || '').trim()
        const now = new Date().toISOString()
        db.prepare('UPDATE purchase_requests SET status = ?, rejection_reason = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
            .run('CANCELLED', reason ? `ยกเลิกโดย ${email}: ${reason}` : `ยกเลิกโดย ${email}`, now, req.params.id, tenantId)

        const updated = db.prepare('SELECT * FROM purchase_requests WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
        res.json({ success: true, message: `ยกเลิกใบขอซื้อ ${pr.pr_number} เรียบร้อย`, data: updated })
    } catch (e) {
        console.error('Cancel PR error:', e)
        res.status(500).json({ success: false, message: 'ยกเลิกใบขอซื้อไม่สำเร็จ' })
    }
})
export default router
