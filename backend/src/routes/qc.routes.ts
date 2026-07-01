import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { randomUUID } from 'crypto'

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
    batch_number TEXT DEFAULT '',
    product_name TEXT DEFAULT '',
    inspector_name TEXT DEFAULT '',
    status TEXT DEFAULT 'PENDING',
    results TEXT DEFAULT '[]',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
  );
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
  const rows = db.prepare('SELECT * FROM qc_inspections WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 200').all(req.user!.tenantId)
  res.json({ success: true, data: (rows as any[]).map(r => ({ ...r, results: JSON.parse(r.results) })) })
})

router.post('/inspections', (req: Request, res: Response) => {
  const { checklist_id, work_order_ref, batch_number, product_name, inspector_name } = req.body
  if (!checklist_id) return void res.status(400).json({ success: false, message: 'ต้องเลือกแม่แบบ' })
  const checklist = db.prepare('SELECT * FROM qc_checklists WHERE id = ? AND tenant_id = ?').get(checklist_id, req.user!.tenantId) as any
  if (!checklist) return void res.status(404).json({ success: false, message: 'ไม่พบแม่แบบ' })

  const results = (JSON.parse(checklist.check_items) as any[]).map(item => ({
    item_id: item.id, item_name: item.name, type: item.type || 'passfail',
    expected: item.expected || '', unit: item.unit || '',
    result: 'PENDING', actual_value: '', notes: '',
  }))

  const id = genId()
  db.prepare('INSERT INTO qc_inspections (id, tenant_id, checklist_id, checklist_name, work_order_ref, batch_number, product_name, inspector_name, results) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.user!.tenantId, checklist_id, checklist.name, work_order_ref || '', batch_number || '', product_name || '', inspector_name || '', JSON.stringify(results))
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
  const { results, notes } = req.body
  const allResults = results as any[]
  const failed  = allResults.filter(r => r.result === 'FAIL').length
  const pending = allResults.filter(r => r.result === 'PENDING').length
  const status  = pending > 0 ? 'PENDING' : failed > 0 ? 'FAIL' : 'PASS'
  db.prepare("UPDATE qc_inspections SET results = ?, notes = ?, status = ?, completed_at = datetime('now') WHERE id = ? AND tenant_id = ?")
    .run(JSON.stringify(results), notes || '', status, req.params.id, req.user!.tenantId)
  res.json({ success: true, data: { status } })
})

router.delete('/inspections/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM qc_inspections WHERE id = ? AND tenant_id = ?').run(req.params.id, req.user!.tenantId)
  res.json({ success: true })
})

export default router
