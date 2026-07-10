import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { randomUUID } from 'crypto'
import { accrueSubcontractLabor } from '../services/subcontract.service'

const router = Router()
router.use(authenticate)

db.exec(`
  CREATE TABLE IF NOT EXISTS qc_checklists (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    check_items TEXT NOT NULL DEFAULT '[]',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS qc_inspections (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    checklist_id TEXT NOT NULL,
    checklist_name TEXT NOT NULL,
    work_order_ref TEXT DEFAULT '',
    work_order_id TEXT,
    batch_number TEXT DEFAULT '',
    product_name TEXT DEFAULT '',
    inspector_name TEXT DEFAULT '',
    status TEXT DEFAULT 'PENDING',
    results TEXT DEFAULT '[]',
    notes TEXT DEFAULT '',
    inspected_qty INTEGER DEFAULT 0,
    passed_qty INTEGER DEFAULT 0,
    rejected_qty INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_qc_inspections_wo ON qc_inspections(work_order_id);
`)

function genId() { return randomUUID().replace(/-/g, '').substring(0, 20) }

// ── Stats ────────────────────────────────────────────────────────────────────
router.get('/stats', (req: Request, res: Response) => {
  const tid = req.user!.tenantId
  const total     = (db.prepare('SELECT COUNT(*) as c FROM qc_inspections WHERE tenant_id = ?').get(tid) as any).c
  const passed    = (db.prepare("SELECT COUNT(*) as c FROM qc_inspections WHERE tenant_id = ? AND status = 'PASS'").get(tid) as any).c
  const failed    = (db.prepare("SELECT COUNT(*) as c FROM qc_inspections WHERE tenant_id = ? AND status = 'FAIL'").get(tid) as any).c
  const pending   = (db.prepare("SELECT COUNT(*) as c FROM qc_inspections WHERE tenant_id = ? AND status = 'PENDING'").get(tid) as any).c
  const templates = (db.prepare('SELECT COUNT(*) as c FROM qc_checklists WHERE tenant_id = ? AND is_active = 1').get(tid) as any).c
  res.json({ success: true, data: { total, passed, failed, pending, templates, passRate: total > 0 ? Math.round((passed / total) * 100) : 0 } })
})

// ── Checklists ───────────────────────────────────────────────────────────────
router.get('/checklists', (req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM qc_checklists WHERE tenant_id = ? AND is_active = 1 ORDER BY created_at DESC').all(req.user!.tenantId)
  res.json({ success: true, data: (rows as any[]).map(r => ({ ...r, check_items: JSON.parse(r.check_items) })) })
})

router.post('/checklists', (req: Request, res: Response) => {
  const { name, description, check_items } = req.body
  if (!name?.trim()) return void res.status(400).json({ success: false, message: 'ต้องระบุชื่อแม่แบบ' })
  const id = genId()
  db.prepare('INSERT INTO qc_checklists (id, tenant_id, name, description, check_items) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.user!.tenantId, name.trim(), description || '', JSON.stringify(check_items || []))
  const row = db.prepare('SELECT * FROM qc_checklists WHERE id = ? AND tenant_id = ?').get(id, req.user!.tenantId) as any
  res.json({ success: true, data: { ...row, check_items: JSON.parse(row.check_items) } })
})

router.put('/checklists/:id', (req: Request, res: Response) => {
  const { name, description, check_items } = req.body
  db.prepare("UPDATE qc_checklists SET name = ?, description = ?, check_items = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?")
    .run(name, description || '', JSON.stringify(check_items || []), req.params.id, req.user!.tenantId)
  res.json({ success: true })
})

router.delete('/checklists/:id', (req: Request, res: Response) => {
  db.prepare('UPDATE qc_checklists SET is_active = 0 WHERE id = ? AND tenant_id = ?').run(req.params.id, req.user!.tenantId)
  res.json({ success: true })
})

// ── Inspections ──────────────────────────────────────────────────────────────
router.get('/inspections', (req: Request, res: Response) => {
  const tid = req.user!.tenantId
  const { work_order_id } = req.query
  const rows = work_order_id
    ? db.prepare('SELECT * FROM qc_inspections WHERE tenant_id = ? AND work_order_id = ? ORDER BY created_at DESC LIMIT 200').all(tid, work_order_id)
    : db.prepare('SELECT * FROM qc_inspections WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 200').all(tid)
  res.json({ success: true, data: (rows as any[]).map(r => ({ ...r, results: JSON.parse(r.results) })) })
})

router.post('/inspections', (req: Request, res: Response) => {
  const { checklist_id, work_order_id, work_order_ref, batch_number, product_name, inspector_name, inspected_qty } = req.body
  if (!checklist_id) return void res.status(400).json({ success: false, message: 'ต้องเลือกแม่แบบ' })
  const checklist = db.prepare('SELECT * FROM qc_checklists WHERE id = ? AND tenant_id = ?').get(checklist_id, req.user!.tenantId) as any
  if (!checklist) return void res.status(404).json({ success: false, message: 'ไม่พบแม่แบบ' })

  // ถ้าส่ง work_order_id มา ต้อง validate ว่า WO อยู่ใน tenant เดียวกัน แล้ว auto-fill work_order_ref/product_name จาก WO
  let woRef = work_order_ref || ''
  let woProductName = product_name || ''
  if (work_order_id) {
    const wo = db.prepare('SELECT * FROM work_orders WHERE id = ? AND tenant_id = ?').get(work_order_id, req.user!.tenantId) as any
    if (!wo) return void res.status(404).json({ success: false, message: 'ไม่พบใบสั่งงาน' })
    woRef = wo.wo_number
    woProductName = wo.product_name || woProductName
  }

  const results = (JSON.parse(checklist.check_items) as any[]).map(item => ({
    item_id: item.id, item_name: item.name, type: item.type || 'passfail',
    expected: item.expected || '', unit: item.unit || '',
    result: 'PENDING', actual_value: '', notes: '',
  }))

  const id = genId()
  db.prepare(`INSERT INTO qc_inspections
      (id, tenant_id, checklist_id, checklist_name, work_order_ref, work_order_id, batch_number, product_name, inspector_name, results, inspected_qty)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, req.user!.tenantId, checklist_id, checklist.name, woRef, work_order_id || null, batch_number || '', woProductName, inspector_name || '', JSON.stringify(results), Number(inspected_qty) || 0)
  const row = db.prepare('SELECT * FROM qc_inspections WHERE id = ? AND tenant_id = ?').get(id, req.user!.tenantId) as any
  res.json({ success: true, data: { ...row, results: JSON.parse(row.results) } })
})

router.put('/inspections/:id', (req: Request, res: Response) => {
  const { results, notes } = req.body
  db.prepare('UPDATE qc_inspections SET results = ?, notes = ? WHERE id = ? AND tenant_id = ?')
    .run(JSON.stringify(results), notes || '', req.params.id, req.user!.tenantId)
  res.json({ success: true })
})

router.post('/inspections/:id/complete', (req: Request, res: Response) => {
  const tid = req.user!.tenantId
  const { results, notes } = req.body
  let { passed_qty, rejected_qty } = req.body
  const allResults = results as any[]
  const failed  = allResults.filter(r => r.result === 'FAIL').length
  const pending = allResults.filter(r => r.result === 'PENDING').length
  const status  = pending > 0 ? 'PENDING' : failed > 0 ? 'FAIL' : 'PASS'

  const inspection = db.prepare('SELECT * FROM qc_inspections WHERE id = ? AND tenant_id = ?').get(req.params.id, tid) as any
  if (!inspection) return void res.status(404).json({ success: false, message: 'ไม่พบรายการตรวจสอบ' })

  // default: ถ้า status รวมเป็น PASS ให้ passed_qty = inspected_qty (ถ้าไม่ได้ส่งมา)
  if (passed_qty === undefined || passed_qty === null) {
    passed_qty = status === 'PASS' ? (inspection.inspected_qty || 0) : 0
  }
  if (rejected_qty === undefined || rejected_qty === null) {
    rejected_qty = 0
  }
  passed_qty = Number(passed_qty) || 0
  rejected_qty = Number(rejected_qty) || 0

  const tx = db.transaction(() => {
    db.prepare("UPDATE qc_inspections SET results = ?, notes = ?, status = ?, passed_qty = ?, rejected_qty = ?, completed_at = datetime('now') WHERE id = ? AND tenant_id = ?")
      .run(JSON.stringify(results), notes || '', status, passed_qty, rejected_qty, req.params.id, tid)

    // ถ้ามี work_order_id: อัปเดต work_orders แบบสะสม (cap completed_qty ไม่ให้เกิน quantity ของ WO)
    if (inspection.work_order_id) {
      const wo = db.prepare('SELECT * FROM work_orders WHERE id = ? AND tenant_id = ?').get(inspection.work_order_id, tid) as any
      if (wo) {
        const newCompleted = Math.min(wo.quantity, (wo.completed_qty || 0) + passed_qty)
        const newScrap = (wo.scrap_qty || 0) + rejected_qty
        db.prepare("UPDATE work_orders SET completed_qty = ?, scrap_qty = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?")
          .run(newCompleted, newScrap, wo.id, tid)
      }
    }
  })
  tx()

  // Phase 2: QC ผ่านปุ๊บ ตั้งค่าแรงเหมาช่วง (piece-rate) ค้างจ่ายอัตโนมัติ ถ้า WO นี้มีสัญญาจ้างเหมาเปิดอยู่
  if (inspection.work_order_id && passed_qty > 0) {
    try {
      accrueSubcontractLabor(tid, inspection.work_order_id, passed_qty, req.user!.email)
    } catch (err) {
      console.error('accrueSubcontractLabor error:', err)
    }
  }

  res.json({ success: true, data: { status, passed_qty, rejected_qty } })
})

router.delete('/inspections/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM qc_inspections WHERE id = ? AND tenant_id = ?').run(req.params.id, req.user!.tenantId)
  res.json({ success: true })
})

export default router
