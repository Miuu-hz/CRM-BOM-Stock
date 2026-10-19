import { Router } from 'express'
import db from '../db/sqlite'
import { authenticate, requireRole } from '../middleware/auth.middleware'
import { generateId } from '../utils/id'
import { getQrSettings, mintQrToken, qrImage, qrUrl } from '../services/posQr.service'

// ผังโต๊ะหน้าแคชเชียร์ + จัดการโต๊ะ/QR — เปิดโต๊ะใช้ POST /api/pos/bills { table_id } (pos-bill.routes.ts)
const router = Router()
router.use(authenticate)

const MANAGERS = ['ADMIN', 'MANAGER', 'MASTER'] as const
const MAX_NAME = 20

// GET /api/pos/tables — โต๊ะทั้งหมด + บิลที่เปิดอยู่ของแต่ละโต๊ะ (หน้าแคชเชียร์ดึงทุก 5 วินาที)
router.get('/tables', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const rows = db.prepare(`
      SELECT t.id, t.name, t.sort_order,
             b.id AS bill_id, b.bill_number, b.total_amount, b.opened_at, b.customer_name,
             b.bill_requested_at,
             (SELECT COUNT(*) FROM pos_bill_items bi WHERE bi.bill_id = b.id) AS item_count,
             (SELECT COUNT(*) FROM pos_bill_items bi WHERE bi.bill_id = b.id AND bi.created_by = 'QR') AS qr_item_count
      FROM pos_tables t
      LEFT JOIN pos_running_bills b ON b.tenant_id = t.tenant_id AND b.table_id = t.id AND b.status = 'OPEN'
      WHERE t.tenant_id = ? AND t.is_active = 1
      ORDER BY t.sort_order ASC, t.name ASC
    `).all(tenantId)
    res.json({ success: true, data: { tables: rows, settings: getQrSettings(tenantId) } })
  } catch (error) {
    console.error('Error fetching tables:', error)
    res.status(500).json({ success: false, message: 'โหลดผังโต๊ะไม่สำเร็จ' })
  }
})

// POST /api/pos/tables { names: string[] } — เพิ่มทีละหลายโต๊ะได้ (T-01..T-10)
router.post('/tables', requireRole(...MANAGERS), (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const names: string[] = Array.isArray(req.body?.names) ? req.body.names.map((n: unknown) => String(n ?? '').trim()) : []
    if (!names.length || names.length > 100 || names.some(n => !n || n.length > MAX_NAME) || new Set(names).size !== names.length) {
      return res.status(400).json({ success: false, message: `ชื่อโต๊ะต้องไม่ว่าง ไม่ซ้ำกัน ยาวไม่เกิน ${MAX_NAME} ตัวอักษร (ครั้งละไม่เกิน 100 โต๊ะ)` })
    }
    const taken = db.prepare(`SELECT name FROM pos_tables WHERE tenant_id = ? AND is_active = 1 AND name IN (${names.map(() => '?').join(',')})`)
      .all(tenantId, ...names) as any[]
    if (taken.length) return res.status(409).json({ success: false, message: `มีโต๊ะชื่อนี้แล้ว: ${taken.map(t => t.name).join(', ')}` })

    const base = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM pos_tables WHERE tenant_id = ?').get(tenantId) as any).m
    const insert = db.prepare('INSERT INTO pos_tables (id, tenant_id, name, qr_token, sort_order) VALUES (?, ?, ?, ?, ?)')
    db.transaction(() => names.forEach((n, i) => insert.run(generateId(), tenantId, n, mintQrToken(), base + i + 1)))()
    res.json({ success: true, data: { created: names.length } })
  } catch (error) {
    console.error('Error creating tables:', error)
    res.status(500).json({ success: false, message: 'เพิ่มโต๊ะไม่สำเร็จ' })
  }
})

// PATCH /api/pos/tables/:id { name?, sort_order? }
router.patch('/tables/:id', requireRole(...MANAGERS), (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const { name, sort_order } = req.body || {}
    const trimmed = name === undefined ? undefined : String(name).trim()
    if (trimmed !== undefined && (!trimmed || trimmed.length > MAX_NAME)) {
      return res.status(400).json({ success: false, message: `ชื่อโต๊ะต้องไม่ว่างและยาวไม่เกิน ${MAX_NAME} ตัวอักษร` })
    }
    if (sort_order !== undefined && !Number.isInteger(Number(sort_order))) {
      return res.status(400).json({ success: false, message: 'ลำดับต้องเป็นจำนวนเต็ม' })
    }
    const r = db.prepare(`UPDATE pos_tables SET name = COALESCE(?, name), sort_order = COALESCE(?, sort_order)
      WHERE id = ? AND tenant_id = ? AND is_active = 1`)
      .run(trimmed ?? null, sort_order === undefined ? null : Number(sort_order), req.params.id, tenantId)
    if (!r.changes) return res.status(404).json({ success: false, message: 'ไม่พบโต๊ะนี้' })
    res.json({ success: true })
  } catch (error: any) {
    if (String(error?.code).startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ success: false, message: 'มีโต๊ะชื่อนี้แล้ว' })
    console.error('Error updating table:', error)
    res.status(500).json({ success: false, message: 'แก้ไขโต๊ะไม่สำเร็จ' })
  }
})

// DELETE /api/pos/tables/:id — ซ่อนโต๊ะ (บิลเก่ายังอ้างถึงได้) · โต๊ะที่เปิดอยู่ลบไม่ได้
router.delete('/tables/:id', requireRole(...MANAGERS), (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const open = db.prepare(`SELECT 1 FROM pos_running_bills WHERE tenant_id = ? AND table_id = ? AND status = 'OPEN'`).get(tenantId, req.params.id)
    if (open) return res.status(409).json({ success: false, message: 'โต๊ะนี้ยังเปิดบิลอยู่ ปิดบิลก่อนแล้วค่อยลบ' })
    const r = db.prepare('UPDATE pos_tables SET is_active = 0 WHERE id = ? AND tenant_id = ? AND is_active = 1').run(req.params.id, tenantId)
    if (!r.changes) return res.status(404).json({ success: false, message: 'ไม่พบโต๊ะนี้' })
    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting table:', error)
    res.status(500).json({ success: false, message: 'ลบโต๊ะไม่สำเร็จ' })
  }
})

// POST /api/pos/tables/:id/regenerate-qr — สติกเกอร์ QR หลุด/ถูกถ่ายไปใช้แกล้ง: ออกลิงก์ใหม่ อันเก่าใช้ไม่ได้ทันที
router.post('/tables/:id/regenerate-qr', requireRole(...MANAGERS), (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const r = db.prepare('UPDATE pos_tables SET qr_token = ? WHERE id = ? AND tenant_id = ? AND is_active = 1').run(mintQrToken(), req.params.id, tenantId)
    if (!r.changes) return res.status(404).json({ success: false, message: 'ไม่พบโต๊ะนี้' })
    res.json({ success: true })
  } catch (error) {
    console.error('Error regenerating table QR:', error)
    res.status(500).json({ success: false, message: 'สร้าง QR ใหม่ไม่สำเร็จ' })
  }
})

// GET /api/pos/tables/qr — QR ถาวรทุกโต๊ะ สำหรับพิมพ์สติกเกอร์
router.get('/tables/qr', async (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const tables = db.prepare('SELECT id, name, qr_token FROM pos_tables WHERE tenant_id = ? AND is_active = 1 ORDER BY sort_order, name').all(tenantId) as any[]
    const data = await Promise.all(tables.map(async t => ({ id: t.id, name: t.name, url: qrUrl(t.qr_token), qr: await qrImage(t.qr_token) })))
    res.json({ success: true, data })
  } catch (error) {
    console.error('Error building table QR sheet:', error)
    res.status(500).json({ success: false, message: 'สร้าง QR ไม่สำเร็จ' })
  }
})

// GET /api/pos/tables/:id/slip — ใบเปิดโต๊ะ: QR ที่ลูกค้าต้องสแกนตอนนี้ (rotate = QR ของรอบ, static = QR ถาวร) + PIN
router.get('/tables/:id/slip', async (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const table = db.prepare('SELECT id, name, qr_token FROM pos_tables WHERE id = ? AND tenant_id = ? AND is_active = 1').get(req.params.id, tenantId) as any
    if (!table) return res.status(404).json({ success: false, message: 'ไม่พบโต๊ะนี้' })
    const bill = db.prepare(`SELECT bill_number, qr_token, opened_at FROM pos_running_bills
      WHERE tenant_id = ? AND table_id = ? AND status = 'OPEN'`).get(tenantId, table.id) as any
    const mode = getQrSettings(tenantId).mode
    if (mode === 'rotate' && !bill) return res.status(409).json({ success: false, message: 'เปิดโต๊ะก่อนจึงจะพิมพ์ QR ของรอบนี้ได้' })
    const token = mode === 'rotate' ? bill.qr_token : table.qr_token
    res.json({
      success: true,
      data: { table: table.name, mode, url: qrUrl(token), qr: await qrImage(token), bill_number: bill?.bill_number || null, opened_at: bill?.opened_at || null },
    })
  } catch (error) {
    console.error('Error building table slip:', error)
    res.status(500).json({ success: false, message: 'สร้างใบเปิดโต๊ะไม่สำเร็จ' })
  }
})

export default router
