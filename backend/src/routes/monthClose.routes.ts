import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import { closeChecklist } from '../services/closeChecklist.service'
import { MonthCloseError } from '../services/monthClose.service'
import { buildClosePack, closeInstructions, monthCloseStatus } from '../services/closePack.service'
import { approveCloseGroup, discardCloseRecord } from '../services/closeAdjustments.service'
import { isVatRegistered } from '../services/accounting.service'
import db from '../db/sqlite'

// ปิดบัญชีรายเดือน (A3/A4/A6/A7) — อ่านได้ทุกคนที่เข้าหมวดบัญชีได้ (index.ts คุม subscriptionGate('accounting'))
// อนุมัติ/ทิ้งรายการ ตรวจสิทธิ์ใน service (accounting:write หรือ GM) · การส่งรายการปรับปรุงทำผ่าน MCP เท่านั้น
const router = Router()
router.use(authenticate)

const actorOf = (req: Request) => ({
  userId: req.user!.userId, email: req.user!.email, name: req.user!.email, role: req.user!.role,
  departments: (req.user as any).departments || [], customPermissions: (req.user as any).customPermissions,
})

function fail(res: Response, e: unknown, label: string) {
  if (e instanceof MonthCloseError) return res.status(e.status).json({ success: false, message: e.message })
  console.error(`month-close ${label} error:`, e)
  res.status(500).json({ success: false, message: (e as Error).message || 'เกิดข้อผิดพลาด' })
}

router.get('/:period/checklist', (req, res) => {
  try { res.json({ success: true, data: closeChecklist(req.user!.tenantId, req.params.period) }) } catch (e) { fail(res, e, 'checklist') }
})

router.get('/:period/status', (req, res) => {
  try { res.json({ success: true, data: monthCloseStatus(req.user!.tenantId, req.params.period, actorOf(req)) }) } catch (e) { fail(res, e, 'status') }
})

router.get('/:period/pack', (req, res) => {
  try { res.json({ success: true, data: buildClosePack(req.user!.tenantId, req.params.period) }) } catch (e) { fail(res, e, 'pack') }
})

router.get('/:period/instructions.md', (req, res) => {
  try {
    const t = req.user!.tenantId
    const co = db.prepare('SELECT name, entity_type FROM company_settings WHERE tenant_id = ?').get(t) as any
    const md = closeInstructions({ name: co?.name ?? null, entityType: co?.entity_type ?? null, vatRegistered: isVatRegistered(t) }, req.params.period)
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="close-instructions-${req.params.period}.md"`)
    res.send(md)
  } catch (e) { fail(res, e, 'instructions') }
})

router.post('/:period/approve', (req, res) => {
  try {
    const { type, recordIds } = req.body ?? {}
    const result = approveCloseGroup(req.user!.tenantId, req.params.period, type, actorOf(req), Array.isArray(recordIds) ? recordIds : undefined)
    res.json({ success: true, data: result, message: result.mode === 'posted' ? `ลงบัญชีแล้ว ${result.posted} รายการ` : `ส่งคำขออนุมัติ ${result.requestNumber} แล้ว` })
  } catch (e) { fail(res, e, 'approve') }
})

router.post('/records/:id/discard', (req, res) => {
  try {
    discardCloseRecord(req.user!.tenantId, req.params.id, actorOf(req), req.body?.reason)
    res.json({ success: true, message: 'ทิ้งรายการแล้ว' })
  } catch (e) { fail(res, e, 'discard') }
})

export default router
