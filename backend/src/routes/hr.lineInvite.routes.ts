import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import db from '../db/sqlite'
import { requirePermission } from '../middleware/auth.middleware'
import { lineBotService } from '../services/line-bot.service'

// HR Phase 8b — เชิญพนักงานเข้า LINE แม้ไม่มีบัญชี ERP
// พนักงานที่ไม่มีบัญชีจะได้บัญชี "LINE อย่างเดียว" (users.line_only = 1): ล็อกอินด้วยรหัสผ่านไม่ได้ ไม่นับที่นั่งของแพ็กเกจ
const router = Router()

router.post('/employees/:id/line-invite', requirePermission('hr', 'write'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const emp = db.prepare('SELECT id, first_name, last_name, status, user_id FROM employees WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!emp) return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลพนักงาน' })
    if (emp.status !== 'ACTIVE') return res.status(409).json({ success: false, message: 'เชิญได้เฉพาะพนักงานที่ยังทำงานอยู่' })

    let userId: string = emp.user_id
    if (!userId) {
      userId = crypto.randomBytes(12).toString('hex')
      // รหัสผ่านสุ่มที่ไม่มีใครรู้ + login ปฏิเสธ line_only อยู่แล้ว (auth.routes.ts)
      const unusable = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10)
      db.transaction(() => {
        db.prepare(
          `INSERT INTO users (id, email, password, name, role, departments, tenant_id, status, line_only, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'USER', '[]', ?, 'active', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        ).run(userId, `line-${userId}@line.invalid`, unusable, `${emp.first_name} ${emp.last_name}`.trim().slice(0, 200), tenantId)
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
