import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { authenticate, requireRole } from '../middleware/auth.middleware'
import { getDb } from '../db/sqlite'
import { lineBotService } from '../services/line-bot.service'

const router = Router()
router.use(authenticate)

// ─── GET /api/purchase-requests — list (with filter) ──────────────────────────
router.get('/', (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user!
        const status = req.query.status as string | undefined
        const db = getDb()

        const rows = status
            ? db.prepare(
                'SELECT * FROM purchase_requests WHERE tenant_id = ? AND status = ? ORDER BY created_at DESC'
              ).all(tenantId, status)
            : db.prepare(
                'SELECT * FROM purchase_requests WHERE tenant_id = ? ORDER BY created_at DESC'
              ).all(tenantId)

        res.json({ success: true, data: rows })
    } catch (e) {
        console.error(e)
        res.status(500).json({ success: false, message: 'Failed to fetch PRs' })
    }
})

// ─── GET /api/purchase-requests/:id — single PR with items ────────────────────
router.get('/:id', (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user!
        const db = getDb()

        const pr = db.prepare(
            'SELECT * FROM purchase_requests WHERE id = ? AND tenant_id = ?'
        ).get(req.params.id, tenantId) as any
        if (!pr) return res.status(404).json({ success: false, message: 'PR not found' })

        const items = db.prepare(
            'SELECT * FROM purchase_request_items WHERE pr_id = ? OR purchase_request_id = ? ORDER BY sort_order'
        ).all(pr.id, pr.id)

        res.json({ success: true, data: { ...pr, items } })
    } catch (e) {
        console.error(e)
        res.status(500).json({ success: false, message: 'Failed to fetch PR' })
    }
})

// ─── PATCH /api/purchase-requests/:id/items — อัพเดท qty/price ของ items ───────
const UpdateItemsSchema = z.object({
    items: z.array(z.object({
        id:          z.string(),
        item_name:   z.string().max(255).nullish(),
        material_id: z.string().nullish(),
        quantity:    z.coerce.number().min(0).nullish(),
        unit:        z.string().max(50).nullish(),
        unit_price:  z.coerce.number().min(0).nullish(),
    }))
})

router.patch('/:id/items', (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user!
        const db = getDb()

        const pr = db.prepare(
            "SELECT id, status FROM purchase_requests WHERE id = ? AND tenant_id = ?"
        ).get(req.params.id, tenantId) as any
        if (!pr) return res.status(404).json({ success: false, message: 'PR not found' })
        if (!['DRAFT', 'PENDING'].includes(pr.status)) {
            return res.status(400).json({ success: false, message: 'Cannot edit items after approval' })
        }

        const parsed = UpdateItemsSchema.safeParse(req.body)
        if (!parsed.success) {
            console.error('UpdateItems validation error:', parsed.error.issues)
            return res.status(400).json({ success: false, message: parsed.error.issues[0].message })
        }

        const updateItem = db.prepare(`
            UPDATE purchase_request_items
            SET item_name   = COALESCE(?, item_name),
                material_id = COALESCE(?, material_id),
                quantity    = COALESCE(?, quantity),
                unit        = COALESCE(?, unit),
                unit_price  = COALESCE(?, unit_price)
            WHERE id = ? AND (pr_id = ? OR purchase_request_id = ?)
        `)

        const updateMany = db.transaction((items: typeof parsed.data.items) => {
            for (const it of items) {
                updateItem.run(
                    it.item_name ?? null, it.material_id ?? null,
                    it.quantity ?? null, it.unit ?? null, it.unit_price ?? null,
                    it.id, pr.id, pr.id
                )
            }
        })

        updateMany(parsed.data.items)

        // เปลี่ยน status เป็น PENDING เพื่อรออนุมัติ
        db.prepare(
            "UPDATE purchase_requests SET status = 'PENDING', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).run(pr.id)

        res.json({ success: true })
    } catch (e) {
        console.error(e)
        res.status(500).json({ success: false, message: 'Failed to update items' })
    }
})

// ─── POST /api/purchase-requests/:id/approve ─────────────────────────────────
const ApproveSchema = z.object({ notes: z.string().max(500).optional() })

router.post('/:id/approve', requireRole('MASTER', 'MANAGER'), async (req: Request, res: Response) => {
    try {
        const { tenantId, userId, email } = req.user!
        const db = getDb()

        const pr = db.prepare(
            "SELECT * FROM purchase_requests WHERE id = ? AND tenant_id = ? AND status = 'PENDING'"
        ).get(req.params.id, tenantId) as any
        if (!pr) return res.status(404).json({ success: false, message: 'PR not found or not pending' })

        const parsed = ApproveSchema.safeParse(req.body)
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: parsed.error.issues[0].message })
        }

        const approverName = email
        db.prepare(`
            UPDATE purchase_requests
            SET status = 'APPROVED', approved_by = ?, approved_at = CURRENT_TIMESTAMP,
                notes = COALESCE(?, notes), updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(userId, parsed.data.notes ?? null, pr.id)

        // Push LINE notification
        await lineBotService.notifyPRStatus(tenantId, {
            id:                   pr.id,
            prNumber:             pr.pr_number,
            supplierName:         pr.supplier_name,
            status:               'APPROVED',
            requesterLineUserId:  pr.requester_line_user_id,
            sourceGroupId:        pr.source_group_id,
            approverName,
        })

        res.json({ success: true, message: 'PR approved' })
    } catch (e) {
        console.error(e)
        res.status(500).json({ success: false, message: 'Failed to approve PR' })
    }
})

// ─── POST /api/purchase-requests/:id/reject ──────────────────────────────────
const RejectSchema = z.object({ reason: z.string().min(1).max(500) })

router.post('/:id/reject', requireRole('MASTER', 'MANAGER'), async (req: Request, res: Response) => {
    try {
        const { tenantId, userId, email } = req.user!
        const db = getDb()

        const pr = db.prepare(
            "SELECT * FROM purchase_requests WHERE id = ? AND tenant_id = ? AND status = 'PENDING'"
        ).get(req.params.id, tenantId) as any
        if (!pr) return res.status(404).json({ success: false, message: 'PR not found or not pending' })

        const parsed = RejectSchema.safeParse(req.body)
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: parsed.error.issues[0].message })
        }

        db.prepare(`
            UPDATE purchase_requests
            SET status = 'REJECTED', approved_by = ?, approved_at = CURRENT_TIMESTAMP,
                rejection_reason = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(userId, parsed.data.reason, pr.id)

        await lineBotService.notifyPRStatus(tenantId, {
            id:                   pr.id,
            prNumber:             pr.pr_number,
            supplierName:         pr.supplier_name,
            status:               'REJECTED',
            requesterLineUserId:  pr.requester_line_user_id,
            sourceGroupId:        pr.source_group_id,
            approverName:         email,
            rejectionReason:      parsed.data.reason,
        })

        res.json({ success: true, message: 'PR rejected' })
    } catch (e) {
        console.error(e)
        res.status(500).json({ success: false, message: 'Failed to reject PR' })
    }
})

export default router
