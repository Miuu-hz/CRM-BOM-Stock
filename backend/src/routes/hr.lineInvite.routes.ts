import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import db from '../db/sqlite'
import { requirePermission } from '../middleware/auth.middleware'
import { lineBotService } from '../services/line-bot.service'
import { ROLE_HIERARCHY } from '../config/roles'

// HR Phase 8b — เชิญพนักงานเข้า LINE แม้ไม่มีบัญชี ERP
// พนักงานที่ไม่มีบัญชีจะได้บัญชี "LINE อย่างเดียว" (users.line_only = 1): ล็อกอินด้วยรหัสผ่านไม่ได้ ไม่นับที่นั่งของแพ็กเกจ
const router = Router()

router.post('/employees/:id/line-invite', requirePermission('hr', 'write'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const emp = db.prepare('SELECT id, first_name, last_name, email, status, user_id FROM employees WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!emp) return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลพนักงาน' })
    if (emp.status !== 'ACTIVE') return res.status(409).json({ success: false, message: 'เชิญได้เฉพาะพนักงานที่ยังทำงานอยู่' })

    let userId: string = emp.user_id
    if (userId) {
      const linked = db.prepare(`SELECT role FROM users WHERE id = ? AND tenant_id = ? AND status = 'active'`).get(userId, tenantId) as any
      if (!linked) return res.status(409).json({ success: false, message: 'บัญชีผู้ใช้ของพนักงานคนนี้ถูกระงับอยู่ เปิดใช้งานบัญชีก่อนเชิญ' })
      // รหัสเชิญ = สิทธิ์เข้า LINE ในนามบัญชีนั้น จึงออกให้บัญชีที่ role สูงกว่าตัวเองไม่ได้
      if (((ROLE_HIERARCHY as Record<string, number>)[linked.role] ?? Infinity) > ((ROLE_HIERARCHY as Record<string, number>)[req.user!.role] ?? 0)) {
        return res.status(403).json({ success: false, message: 'เชิญบัญชีที่มีระดับสิทธิ์สูงกว่าคุณไม่ได้ ให้ผู้ดูแลระบบเป็นคนเชิญ' })
      }
    }
    if (!userId) {
      const fullName = `${emp.first_name} ${emp.last_name ?? ''}`.trim()
      const match = req.body?.new_account === true ? null : db.prepare(
        `SELECT u.name, u.email FROM users u
         WHERE u.tenant_id = ? AND u.status = 'active' AND COALESCE(u.line_only, 0) = 0
           AND (TRIM(u.name) = ? COLLATE NOCASE OR (? <> '' AND u.email = ? COLLATE NOCASE))
           AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.user_id = u.id AND e.tenant_id = u.tenant_id)`
      ).get(tenantId, fullName, emp.email ?? '', emp.email ?? '') as any
      if (match) {
        return res.status(409).json({
          success: false, code: 'ERP_ACCOUNT_EXISTS',
          message: `มีบัญชี ERP "${match.name}" (${match.email}) ที่ยังไม่ผูกกับพนักงาน — ให้ผู้ดูแลระบบผูกในหน้าแก้ไขพนักงานก่อน`,
        })
      }
      userId = crypto.randomBytes(12).toString('hex')
      // รหัสผ่านสุ่มที่ไม่มีใครรู้ + login ปฏิเสธ line_only อยู่แล้ว (auth.routes.ts)
      const unusable = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10)
      db.transaction(() => {
        db.prepare(
          `INSERT INTO users (id, email, password, name, role, departments, tenant_id, status, line_only, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'USER', '[]', ?, 'active', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        ).run(userId, `line-${userId}@line.invalid`, unusable, fullName.slice(0, 200), tenantId)
        // user_id IS NULL กันสองคนกดเชิญพร้อมกันแล้วได้บัญชีซ้อน
        const linked = db.prepare('UPDATE employees SET user_id = ? WHERE id = ? AND tenant_id = ? AND user_id IS NULL').run(userId, emp.id, tenantId)
        if (linked.changes !== 1) throw new Error('RACE')
      })()
    }
    const code = lineBotService.generateLinkToken(tenantId, userId)
    res.status(201).json({ success: true, data: { code, expires_in_minutes: 10, created_line_only_account: !emp.user_id } })
  } catch (e: any) {
    if (e?.message === 'RACE') return res.status(409).json({ success: false, message: 'มีคนเชิญพนักงานคนนี้อยู่ ลองใหม่อีกครั้ง' })
    console.error('line-invite error:', e)
    res.status(500).json({ success: false, message: 'สร้างรหัสเชิญไม่สำเร็จ' })
  }
})

export default router
