import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { randomUUID } from 'crypto'
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

router.post('/from-image', async (req: Request, res: Response) => {
  try {
    const { tenantId, userId, email } = req.user!
    const db = getDb()

    const parsed = FromImageSchema.safeParse(req.body)
    if (!parsed.success) {
      return void res.status(400).json({ success: false, message: parsed.error.issues[0].message })
    }

    const { imageBase64, imageType, extractedItems, notes, providerId } = parsed.data
    type PRItem = { name: string; quantity: number; unit: string; unit_price: number }
    let items: PRItem[] = []

    if (extractedItems && extractedItems.length > 0) {
      // โหมด 1: รับ items ที่ Gemma4 on-device อ่านมาแล้ว
      items = extractedItems as PRItem[]
    } else if (imageBase64) {
      // โหมด 2: ส่งรูปไปให้ LLM provider (vision) อ่าน
      const provider: any = providerId
        ? db.prepare(`SELECT * FROM llm_providers WHERE id = ? AND tenant_id = ? AND is_active = 1`).get(providerId, tenantId)
        : db.prepare(`SELECT * FROM llm_providers WHERE tenant_id = ? AND is_active = 1 AND is_default = 1 LIMIT 1`).get(tenantId)
          ?? db.prepare(`SELECT * FROM llm_providers WHERE tenant_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1`).get(tenantId)

      if (!provider) {
        return void res.status(400).json({
          success: false,
          message: 'ไม่พบ LLM Provider ที่เปิดใช้งาน กรุณาตั้งค่าใน Settings > AI / LLM',
        })
      }

      const visionPrompt =
        'อ่านรายการสินค้าจากรูปภาพใบสั่งซื้อหรือรายการสั่งซื้อนี้\n' +
        'ส่งคืนเฉพาะ JSON array เท่านั้น ห้ามมีข้อความอื่น รูปแบบ:\n' +
        '[{"name":"ชื่อสินค้า","quantity":จำนวน,"unit":"หน่วย","unit_price":ราคาต่อหน่วย}]\n' +
        'ถ้าไม่เห็นราคาให้ใส่ 0 ถ้าไม่เห็นหน่วยให้ใส่ "pcs"'

      const llmRes = await fetch(`${(provider.base_url as string).replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${provider.api_key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${imageType};base64,${imageBase64}` } },
              { type: 'text', text: visionPrompt },
            ],
          }],
          max_tokens: 1000,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(45_000),
      })

      if (!llmRes.ok) {
        const detail = await llmRes.text()
        return void res.status(502).json({ success: false, message: `LLM error ${llmRes.status}`, detail })
      }

      const llmData: any = await llmRes.json()
      const rawContent: string = llmData.choices?.[0]?.message?.content?.trim() ?? '[]'

      // รองรับ markdown code block ที่ LLM บางตัวห่อ JSON มาให้
      const jsonStr = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')

      try {
        const parsed = JSON.parse(jsonStr)
        items = Array.isArray(parsed) ? parsed : []
      } catch {
        return void res.status(422).json({
          success: false,
          message: 'LLM ไม่สามารถอ่านรายการสินค้าได้ กรุณาลองใหม่หรือป้อนรายการเอง',
          rawContent,
        })
      }
    } else {
      return void res.status(400).json({ success: false, message: 'ต้องส่ง imageBase64 หรือ extractedItems' })
    }

    if (items.length === 0) {
      return void res.status(422).json({ success: false, message: 'ไม่พบรายการสินค้าในรูปภาพ' })
    }

    // สร้าง PR
    const prNumber = formatDocumentNumber('PR', tenantId, 'PURCHASE_REQUEST', new Date().getFullYear(), 5)
    const prId = randomUUID()
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO purchase_requests
        (id, tenant_id, pr_number, requester_id, requester_name, supplier_name, source, status, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'TBD', 'IMAGE_OCR', 'DRAFT', ?, ?, ?)
    `).run(prId, tenantId, prNumber, userId, email, notes || 'สร้างจากรูปภาพ', now, now)

    const insertItem = db.prepare(`
      INSERT INTO purchase_request_items
        (id, tenant_id, purchase_request_id, pr_id, description, item_name, quantity, unit,
         estimated_unit_price, estimated_total_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    db.transaction(() => {
      for (const item of items) {
        const qty   = Number(item.quantity) || 0
        const price = Number(item.unit_price) || 0
        insertItem.run(
          randomUUID(), tenantId, prId, prId,
          item.name, item.name,
          qty, item.unit || 'pcs',
          price, qty * price,
        )
      }
    })()

    res.json({
      success: true,
      data: {
        id:         prId,
        pr_number:  prNumber,
        item_count: items.length,
        items,
        message: `สร้าง ${prNumber} จากรูปภาพ (${items.length} รายการ) — กรุณาตรวจสอบและส่งอนุมัติ`,
      },
    })
  } catch (e) {
    console.error('from-image PR error:', e)
    res.status(500).json({ success: false, message: 'ไม่สามารถสร้างใบขอซื้อจากรูปภาพได้' })
  }
})

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
            WHERE id = ? AND (pr_id = ? OR purchase_request_id = ?) AND tenant_id = ?
        `)

        const updateMany = db.transaction((items: typeof parsed.data.items) => {
            for (const it of items) {
                updateItem.run(
                    it.item_name ?? null, it.material_id ?? null,
                    it.quantity ?? null, it.unit ?? null, it.unit_price ?? null,
                    it.id, pr.id, pr.id, tenantId
                )
            }
        })

        updateMany(parsed.data.items)

        // เปลี่ยน status เป็น PENDING เพื่อรออนุมัติ
        db.prepare(
            "UPDATE purchase_requests SET status = 'PENDING', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?"
        ).run(pr.id, tenantId)

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
            WHERE id = ? AND tenant_id = ?
        `).run(userId, parsed.data.notes ?? null, pr.id, tenantId)

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
            WHERE id = ? AND tenant_id = ?
        `).run(userId, parsed.data.reason, pr.id, tenantId)

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
