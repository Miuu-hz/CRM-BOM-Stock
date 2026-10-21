import { Router } from 'express'
import db from '../db/sqlite'
import { authenticate, requireRole } from '../middleware/auth.middleware'
import { generateId } from '../utils/id'
import { getQrSettings, mintQrToken, qrImage, qrUrl } from '../services/posQr.service'
import { recalculateBillTotals } from './pos-bill.routes'

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
             b.id AS bill_id, b.bill_number, b.total_amount, b.opened_at,
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

// GET /api/pos/tables/:id/slip — ใบเปิดโต๊ะ: QR ที่ลูกค้าต้องสแกนตอนนี้ (rotate = QR ของรอบ, static = QR ถาวร)
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

// POST /api/pos/bills/:id/move { table_id } — ย้ายบิลไปโต๊ะว่างอื่น (คง qr_token เดิม ลูกค้าสั่งต่อได้)
router.post('/bills/:id/move', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const billId = req.params.id
    const targetTableId = req.body?.table_id

    if (!targetTableId || typeof targetTableId !== 'string') {
      return res.status(400).json({ success: false, message: 'กรุณาระบุโต๊ะปลายทาง' })
    }

    const bill = db.prepare(`
      SELECT id, tenant_id, table_id, display_name, status, qr_token
      FROM pos_running_bills
      WHERE id = ? AND tenant_id = ?
    `).get(billId, tenantId) as any

    if (!bill) {
      return res.status(404).json({ success: false, message: 'ไม่พบบิลนี้' })
    }
    if (bill.status !== 'OPEN') {
      return res.status(400).json({ success: false, message: 'ย้ายได้เฉพาะบิลที่เปิดอยู่' })
    }
    if (bill.table_id === targetTableId) {
      return res.status(400).json({ success: false, message: 'ไม่สามารถย้ายไปโต๊ะเดิมได้' })
    }

    const targetTable = db.prepare(`
      SELECT id, name FROM pos_tables
      WHERE id = ? AND tenant_id = ? AND is_active = 1
    `).get(targetTableId, tenantId) as any

    if (!targetTable) {
      return res.status(404).json({ success: false, message: 'ไม่พบโต๊ะปลายทาง' })
    }

    // ตรวจว่าโต๊ะปลายทางมีบิลเปิดอยู่หรือไม่
    const openBill = db.prepare(`
      SELECT id FROM pos_running_bills
      WHERE tenant_id = ? AND table_id = ? AND status = 'OPEN'
    `).get(tenantId, targetTable.id) as any

    if (openBill) {
      return res.status(409).json({
        success: false,
        code: 'TABLE_ALREADY_OPEN',
        message: 'โต๊ะปลายทางมีบิลเปิดอยู่แล้ว',
        data: { bill_id: openBill.id }
      })
    }

    // ถ้า display_name ตรงกับชื่อโต๊ะเดิม ให้เปลี่ยนเป็นชื่อโต๊ะใหม่
    let newDisplayName = bill.display_name
    if (bill.table_id) {
      const oldTable = db.prepare(`SELECT name FROM pos_tables WHERE id = ? AND tenant_id = ?`).get(bill.table_id, tenantId) as any
      if (oldTable && bill.display_name === oldTable.name) {
        newDisplayName = targetTable.name
      }
    }

    const nowIso = new Date().toISOString()
    // ponytail: db.transaction ครอบการย้ายโต๊ะ เพื่อป้องกัน race condition และอัปเดตตั๋วครัวพร้อมกัน
    db.transaction(() => {
      // ponytail: คง qr_token เดิมไว้ ลูกค้าที่สแกนแล้วสั่งต่อได้ไม่ต้องสแกนใหม่
      db.prepare(`
        UPDATE pos_running_bills
        SET table_id = ?, display_name = ?
        WHERE id = ? AND tenant_id = ?
      `).run(targetTable.id, newDisplayName, bill.id, tenantId)

      // อัปเดตชื่อโต๊ะบนตั๋วครัวที่ยังทำไม่เสร็จ (PENDING / IN_PROGRESS)
      db.prepare(`
        UPDATE pos_kds_tickets
        SET table_name = ?, updated_at = ?
        WHERE bill_id = ? AND tenant_id = ? AND status IN ('PENDING', 'IN_PROGRESS')
      `).run(targetTable.name, nowIso, bill.id, tenantId)
    })()

    res.json({
      success: true,
      message: 'ย้ายโต๊ะสำเร็จ',
      data: {
        bill_id: bill.id,
        table_id: targetTable.id,
        table_name: targetTable.name,
        display_name: newDisplayName
      }
    })
  } catch (error: any) {
    // ดักจับ race condition จาก unique index idx_pos_bills_open_table
    if (String(error?.code).startsWith('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ success: false, code: 'TABLE_ALREADY_OPEN', message: 'โต๊ะปลายทางมีบิลเปิดอยู่แล้ว' })
    }
    console.error('Error moving table:', error)
    res.status(500).json({ success: false, message: 'ย้ายโต๊ะไม่สำเร็จ' })
  }
})

// POST /api/pos/bills/:id/merge { target_bill_id } — รวมบิลต้นทางเข้าบิลปลายทาง
router.post('/bills/:id/merge', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const sourceBillId = req.params.id
    const targetBillId = req.body?.target_bill_id

    if (!targetBillId || typeof targetBillId !== 'string') {
      return res.status(400).json({ success: false, message: 'กรุณาระบุบิลปลายทาง' })
    }
    if (sourceBillId === targetBillId) {
      return res.status(400).json({ success: false, message: 'ไม่สามารถรวมเข้าบิลเดียวกันได้' })
    }

    const source = db.prepare(`SELECT * FROM pos_running_bills WHERE id = ? AND tenant_id = ?`).get(sourceBillId, tenantId) as any
    if (!source) {
      return res.status(404).json({ success: false, message: 'ไม่พบบิลต้นทาง' })
    }
    const target = db.prepare(`SELECT * FROM pos_running_bills WHERE id = ? AND tenant_id = ?`).get(targetBillId, tenantId) as any
    if (!target) {
      return res.status(404).json({ success: false, message: 'ไม่พบบิลปลายทาง' })
    }

    if (source.status !== 'OPEN' || target.status !== 'OPEN') {
      return res.status(400).json({ success: false, message: 'รวมได้เฉพาะบิลที่เปิดอยู่ทั้งคู่' })
    }

    // หากทั้งสองบิลมีสมาชิกคนละคนกัน ให้แจ้งเตือนเอาสมาชิกออกก่อน
    if (source.customer_id && target.customer_id && source.customer_id !== target.customer_id) {
      return res.status(409).json({
        success: false,
        code: 'MEMBER_CONFLICT',
        message: 'ทั้งสองบิลมีสมาชิกคนละคนกัน กรุณายกเลิกสมาชิกจากบิลใดบิลหนึ่งก่อนรวมโต๊ะ'
      })
    }

    // หากบิลต้นทางมีส่วนลดหรือค่าบริการ ให้ล้างออกก่อน
    const sourceDiscount = Number(source.discount_amount || 0)
    const sourceExtraCharge = Number(source.extra_charge_amount || 0)
    if (sourceDiscount > 0 || sourceExtraCharge > 0) {
      return res.status(409).json({
        success: false,
        code: 'SOURCE_HAS_DISCOUNT_OR_CHARGE',
        message: 'บิลต้นทางมีส่วนลดหรือค่าบริการเพิ่มเติม กรุณาล้างส่วนลด/ค่าบริการก่อนรวมบิล'
      })
    }

    const nowIso = new Date().toISOString()
    const mergeNote = `[รวมเข้าบิล ${target.bill_number}]`
    const sourceNotes = source.notes ? `${source.notes} ${mergeNote}` : mergeNote

    // ถ้าปลายทางไม่มีสมาชิก ให้คัดลอกจากต้นทาง
    let targetCustomerId = target.customer_id
    let targetCustomerName = target.customer_name
    let targetCustomerPhone = target.customer_phone
    let targetMemberDeviceId = target.member_device_id
    if (!target.customer_id && source.customer_id) {
      targetCustomerId = source.customer_id
      targetCustomerName = source.customer_name
      targetCustomerPhone = source.customer_phone
      targetMemberDeviceId = source.member_device_id
    }

    // เก็บเวลาเรียกเช็คบิลที่เร็วที่สุด
    let earliestRequestedAt: string | null = null
    if (source.bill_requested_at && target.bill_requested_at) {
      earliestRequestedAt = source.bill_requested_at < target.bill_requested_at
        ? source.bill_requested_at
        : target.bill_requested_at
    } else {
      earliestRequestedAt = source.bill_requested_at || target.bill_requested_at || null
    }

    // ponytail: db.transaction รวมทุกรายการเข้าบิลปลายทาง ย้ายตั๋วครัว/ของแถม แล้วปิดบิลเดิมพร้อมบันทึก merged_into_bill_id
    db.transaction(() => {
      // 1. ย้ายรายการอาหาร
      db.prepare('UPDATE pos_bill_items SET bill_id = ? WHERE bill_id = ? AND tenant_id = ?')
        .run(target.id, source.id, tenantId)

      // 2. ย้ายรายการแลกของรางวัล
      db.prepare('UPDATE pos_redemptions SET bill_id = ? WHERE bill_id = ? AND tenant_id = ?')
        .run(target.id, source.id, tenantId)

      // 3. ย้ายตั๋วครัว พร้อมเปลี่ยนชื่อโต๊ะเป็นชื่อของบิลปลายทาง (รอบอาจซ้ำกันได้ตามสเปก)
      db.prepare(`
        UPDATE pos_kds_tickets
        SET bill_id = ?, bill_number = ?, table_name = ?, updated_at = ?
        WHERE bill_id = ? AND tenant_id = ?
      `).run(target.id, target.bill_number, target.display_name, nowIso, source.id, tenantId)

      // 4. ย้ายประวัติสั่งของลูกค้าทั่วไป (guest)
      db.prepare('UPDATE pos_guest_bill_items SET bill_id = ? WHERE bill_id = ? AND tenant_id = ?')
        .run(target.id, source.id, tenantId)

      // 5. ปรับปรุงข้อมูลสมาชิก/เวลาเรียกเช็คบิลของบิลปลายทาง
      db.prepare(`
        UPDATE pos_running_bills
        SET customer_id = ?, customer_name = ?, customer_phone = ?, member_device_id = ?, bill_requested_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run(
        targetCustomerId ?? null,
        targetCustomerName ?? null,
        targetCustomerPhone ?? null,
        targetMemberDeviceId ?? null,
        earliestRequestedAt,
        target.id,
        tenantId
      )

      // 6. ยกเลิกบิลต้นทาง ปลดโต๊ะ (table_id NULL) และบันทึก merged_into_bill_id ให้มือถือตามไปถูก
      db.prepare(`
        UPDATE pos_running_bills
        SET status = 'CANCELLED', closed_at = ?, table_id = NULL, merged_into_bill_id = ?, notes = ?
        WHERE id = ? AND tenant_id = ?
      `).run(nowIso, target.id, sourceNotes, source.id, tenantId)

      // 7. คำนวณยอดรวมของบิลปลายทางใหม่
      recalculateBillTotals(target.id)
    })()

    res.json({
      success: true,
      message: 'รวมบิลสำเร็จ',
      data: {
        id: target.id,
        bill_number: target.bill_number
      }
    })
  } catch (error) {
    console.error('Error merging bills:', error)
    res.status(500).json({ success: false, message: 'รวมบิลไม่สำเร็จ' })
  }
})

export default router
