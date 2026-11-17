import fs from 'fs'
import path from 'path'
import { z } from 'zod'
import db from '../../db/sqlite'
import { IMcpServer } from '../sdk-compat'
import { ok, ToolResult, resolveDocRef } from './shared'
import { invoiceUploadDir } from '../../routes/sales/shared'

export function registerBillInboxTools(server: IMcpServer, tenantId: string, userId: string): void {
  // ── 1. list_bill_inbox ───────────────────────────────────────────────────────
  server.tool(
    'list_bill_inbox',
    `รายการบิลซื้อที่ส่งเข้า LINE รอลงบัญชี / List pending bills from LINE inbox waiting to be processed.
เรียงตามลำดับเก่าก่อนเพื่อความสะดวกในการเคลียร์บิลทีละใบ`,
    {
      status: z.enum(['PENDING', 'ATTACHED', 'DISCARDED']).optional().default('PENDING').describe('สถานะบิล: PENDING (รอลง), ATTACHED (แนบแล้ว), DISCARDED (ยกเลิก)'),
      limit: z.number().int().min(1).max(50).optional().default(20).describe('จำนวนรายการสูงสุด (1-50, ค่าเริ่มต้น 20)'),
    },
    async (args) => {
      const status = args.status || 'PENDING'
      const limit = Math.min(Math.max(args.limit || 20, 1), 50)

      const countRow = db.prepare(
        'SELECT COUNT(*) as total FROM bill_inbox WHERE tenant_id = ? AND status = ?'
      ).get(tenantId, status) as { total: number } | undefined
      const total = countRow?.total ?? 0

      const rows = db.prepare(`
        SELECT b.id, b.status, b.created_at, b.file_size, b.ref_type, b.ref_id, COALESCE(u.name, CASE WHEN b.user_id LIKE 'master_%' THEN 'Master' END) as user_name
        FROM bill_inbox b
        LEFT JOIN users u ON b.user_id = u.id
        WHERE b.tenant_id = ? AND b.status = ?
        ORDER BY b.created_at ASC, b.id ASC
        LIMIT ?
      `).all(tenantId, status, limit) as any[]

      // ponytail: resolveDocRef lookup per row for ATTACHED items; limit is capped at 50 so overhead is negligible
      const items = rows.map((r) => {
        let doc_number: string | null = null
        if (r.ref_type && r.ref_id) {
          const resolved = resolveDocRef(tenantId, r.ref_type, r.ref_id)
          doc_number = resolved?.doc_num ?? null
        }
        return {
          inbox_id: r.id,
          status: r.status,
          sent_by: r.user_name?.trim() ? r.user_name : 'ไม่ทราบ',
          created_at: r.created_at,
          file_size_bytes: r.file_size,
          doc_type: r.ref_type ?? null,
          doc_number,
        }
      })

      return ok({
        success: true,
        total,
        items,
      })
    }
  )

  // ── 2. get_bill_image ────────────────────────────────────────────────────────
  server.tool(
    'get_bill_image',
    `ดูรูปภาพและข้อมูลบิลจากกล่องรับบิล / Get bill image and details by inbox_id.
คืนข้อมูลรูปภาพเป็น base64 พร้อมรายละเอียด เพื่อให้อ่านข้อมูลบิลไปร่างใบสั่งซื้อ (PO) ต่อได้`,
    {
      inbox_id: z.string().describe('ID ของบิลในกล่องรับบิล (bill_inbox.id)'),
    },
    async (args) => {
      const inboxId = (args.inbox_id ?? '').trim()
      const row = db.prepare(`
        SELECT b.id, b.status, b.file_path, b.mime_type, b.created_at, COALESCE(u.name, CASE WHEN b.user_id LIKE 'master_%' THEN 'Master' END) as user_name
        FROM bill_inbox b
        LEFT JOIN users u ON b.user_id = u.id
        WHERE b.id = ? AND b.tenant_id = ?
      `).get(inboxId, tenantId) as any

      if (!row) {
        return ok({
          success: false,
          message: `ไม่พบบิล ID "${inboxId}" ในกล่องรับบิลของกิจการนี้`,
        })
      }

      const absPath = path.join(invoiceUploadDir, path.basename(row.file_path))
      if (!fs.existsSync(absPath)) {
        return ok({
          success: false,
          message: `ไม่พบไฟล์รูปภาพของบิล ID "${inboxId}" บนดิสก์`,
        })
      }

      try {
        // ponytail: reading whole image into memory as base64 — inbox images are compressed and <= 10MB
        const buffer = fs.readFileSync(absPath)
        const base64Data = buffer.toString('base64')
        const mimeType = row.mime_type || 'image/jpeg'
        const sentBy = row.user_name?.trim() ? row.user_name : 'ไม่ทราบ'

        const result: ToolResult = {
          content: [
            { type: 'image', data: base64Data, mimeType },
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                inbox_id: row.id,
                status: row.status,
                sent_by: sentBy,
                created_at: row.created_at,
              }, null, 2),
            },
          ],
        }
        return result
      } catch (err: any) {
        return ok({
          success: false,
          message: `เกิดข้อผิดพลาดในการอ่านไฟล์รูปภาพ: ${err?.message || err}`,
        })
      }
    }
  )

  // ── 3. discard_bill_inbox ────────────────────────────────────────────────────
  server.tool(
    'discard_bill_inbox',
    `ยกเลิก/ทิ้งบิลที่ไม่ต้องการลงบัญชีออกจากกล่องรับบิล / Discard a pending bill from LINE inbox.
ใช้ได้เฉพาะบิลสถานะ PENDING เท่านั้น โดยต้องระบุเหตุผล เช่น รูปไม่ชัด หรือไม่ใช่บิลของบริษัท`,
    {
      inbox_id: z.string().describe('ID ของบิลที่ต้องการทิ้ง'),
      reason: z.string().min(1).describe('เหตุผลในการทิ้งรายการ (ต้องไม่ว่าง)'),
    },
    async (args) => {
      const inboxId = (args.inbox_id ?? '').trim()
      const reason = (args.reason ?? '').trim()

      if (!reason) {
        return ok({
          success: false,
          message: 'กรุณาระบุเหตุผลการทิ้งรายการ',
        })
      }

      const row = db.prepare(`
        SELECT id, status, file_path FROM bill_inbox WHERE id = ? AND tenant_id = ?
      `).get(inboxId, tenantId) as any

      if (!row) {
        return ok({
          success: false,
          message: `ไม่พบบิล ID "${inboxId}" ในกล่องรับบิลของกิจการนี้`,
        })
      }

      if (row.status !== 'PENDING') {
        return ok({
          success: false,
          message: `ไม่สามารถทิ้งบิลที่มีสถานะ ${row.status} ได้ (ทิ้งได้เฉพาะ PENDING)`,
        })
      }

      const now = new Date().toISOString()
      db.prepare(`
        UPDATE bill_inbox
        SET status = 'DISCARDED',
            discard_reason = ?,
            processed_by = ?,
            processed_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run(reason, userId, now, row.id, tenantId)

      const absPath = path.join(invoiceUploadDir, path.basename(row.file_path))
      if (fs.existsSync(absPath)) {
        try {
          fs.unlinkSync(absPath)
        } catch {
          // ignore error if file was already removed
        }
      }

      return ok({
        success: true,
        message: 'ทิ้งบิลออกจากกล่องรับบิลเรียบร้อยแล้ว',
        inbox_id: row.id,
        status: 'DISCARDED',
      })
    }
  )
}
