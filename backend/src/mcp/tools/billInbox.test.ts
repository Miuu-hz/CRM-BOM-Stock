import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import db from '../../db/sqlite'
import { invoiceUploadDir } from '../../routes/sales/shared'
import { registerBillInboxTools } from './billInbox'
import { registerPurchaseTools } from './purchase'

function fakeServer() {
  const tools: Record<string, any> = {}
  return {
    server: { tool: (name: string, _d: any, _s: any, handler: any) => { tools[name] = handler } } as any,
    call: (name: string, args: any) => tools[name](args),
  }
}

const parse = (res: any) => JSON.parse(res.content[0].text)

describe('Bill Inbox MCP Tools (T2)', () => {
  const createdFiles: string[] = []
  const createdTenants: string[] = []

  afterEach(() => {
    for (const f of createdFiles) {
      if (fs.existsSync(f)) {
        try { fs.unlinkSync(f) } catch { /* ignore */ }
      }
    }
    createdFiles.length = 0

    if (createdTenants.length > 0) {
      const placeholders = createdTenants.map(() => '?').join(',')
      db.prepare(`DELETE FROM payment_attachments WHERE tenant_id IN (${placeholders})`).run(...createdTenants)
      db.prepare(`DELETE FROM bill_inbox WHERE tenant_id IN (${placeholders})`).run(...createdTenants)
      db.prepare(`DELETE FROM purchase_orders WHERE tenant_id IN (${placeholders})`).run(...createdTenants)
      db.prepare(`DELETE FROM users WHERE tenant_id IN (${placeholders})`).run(...createdTenants)
      createdTenants.length = 0
    }
  })

  function createTestFile(content = 'dummy-bill-content'): { fileName: string; fullPath: string } {
    if (!fs.existsSync(invoiceUploadDir)) {
      fs.mkdirSync(invoiceUploadDir, { recursive: true })
    }
    const fileName = `inbox-test-${Math.random().toString(36).slice(2, 10)}.jpg`
    const fullPath = path.join(invoiceUploadDir, fileName)
    fs.writeFileSync(fullPath, Buffer.from(content))
    createdFiles.push(fullPath)
    return { fileName, fullPath }
  }

  it('list_bill_inbox: เห็นเฉพาะ tenant ตัวเอง, เรียงเก่าก่อน, แสดง sent_by และเอกสารที่ผูก', async () => {
    const tenantA = 'tn_inbox_a_' + Math.random().toString(36).slice(2, 8)
    const tenantB = 'tn_inbox_b_' + Math.random().toString(36).slice(2, 8)
    createdTenants.push(tenantA, tenantB)

    const userA = 'u_inbox_a_' + Math.random().toString(36).slice(2, 8)
    db.prepare(`
      INSERT INTO users (id, tenant_id, email, password, name, role)
      VALUES (?, ?, ?, 'pass', 'สมชาย จัดซื้อ', 'USER')
    `).run(userA, tenantA, `${userA}@test.com`)

    const f1 = createTestFile('bill-1')
    const f2 = createTestFile('bill-2')
    const f3 = createTestFile('bill-b')
    const f4 = createTestFile('bill-attached')

    // Tenant A - PENDING 1 (เก่ากว่า มี user_id)
    const idA1 = 'inbox_a1_' + Math.random().toString(36).slice(2, 8)
    db.prepare(`
      INSERT INTO bill_inbox (id, tenant_id, line_message_id, line_user_id, user_id, file_path, mime_type, file_size, status, created_at)
      VALUES (?, ?, 'msg_1', 'line_u1', ?, ?, 'image/jpeg', 100, 'PENDING', '2026-11-01T10:00:00Z')
    `).run(idA1, tenantA, userA, f1.fileName)

    // Tenant A - PENDING 2 (ใหม่กว่า ไม่มี user_id)
    const idA2 = 'inbox_a2_' + Math.random().toString(36).slice(2, 8)
    db.prepare(`
      INSERT INTO bill_inbox (id, tenant_id, line_message_id, line_user_id, user_id, file_path, mime_type, file_size, status, created_at)
      VALUES (?, ?, 'msg_2', 'line_u2', NULL, ?, 'image/jpeg', 200, 'PENDING', '2026-11-02T10:00:00Z')
    `).run(idA2, tenantA, f2.fileName)

    // Tenant B - PENDING 3 (ของร้านอื่น ต้องไม่เห็นในร้าน A)
    const idB = 'inbox_b1_' + Math.random().toString(36).slice(2, 8)
    db.prepare(`
      INSERT INTO bill_inbox (id, tenant_id, line_message_id, line_user_id, user_id, file_path, mime_type, file_size, status, created_at)
      VALUES (?, ?, 'msg_b', 'line_ub', NULL, ?, 'image/jpeg', 300, 'PENDING', '2026-11-01T08:00:00Z')
    `).run(idB, tenantB, f3.fileName)

    // Tenant A - ATTACHED (ผูกกับ PO)
    const poId = 'po_' + Math.random().toString(36).slice(2, 8)
    const poNum = 'PO-2026-99991'
    db.prepare(`
      INSERT INTO purchase_orders (id, tenant_id, po_number, status)
      VALUES (?, ?, ?, 'DRAFT')
    `).run(poId, tenantA, poNum)

    const idAAttached = 'inbox_att_' + Math.random().toString(36).slice(2, 8)
    db.prepare(`
      INSERT INTO bill_inbox (id, tenant_id, line_message_id, line_user_id, user_id, file_path, mime_type, file_size, status, ref_type, ref_id, created_at)
      VALUES (?, ?, 'msg_att', 'line_u1', ?, ?, 'image/jpeg', 400, 'ATTACHED', 'PURCHASE_ORDER', ?, '2026-11-03T10:00:00Z')
    `).run(idAAttached, tenantA, userA, f4.fileName, poId)

    const { server, call } = fakeServer()
    registerBillInboxTools(server, tenantA, userA)

    // 1. เรียก list ค่าเริ่มต้น (PENDING)
    const listPending = parse(await call('list_bill_inbox', {}))
    expect(listPending.success).toBe(true)
    expect(listPending.total).toBe(2)
    expect(listPending.items).toHaveLength(2)

    // เรียงเก่าก่อน: A1 มาก่อน A2
    expect(listPending.items[0].inbox_id).toBe(idA1)
    expect(listPending.items[0].sent_by).toBe('สมชาย จัดซื้อ')
    expect(listPending.items[0].status).toBe('PENDING')
    expect(listPending.items[0].doc_number).toBeNull()

    // A2 ไม่มี user_id -> "ไม่ทราบ"
    expect(listPending.items[1].inbox_id).toBe(idA2)
    expect(listPending.items[1].sent_by).toBe('ไม่ทราบ')

    // 2. เรียก list ของ ATTACHED
    const listAttached = parse(await call('list_bill_inbox', { status: 'ATTACHED' }))
    expect(listAttached.success).toBe(true)
    expect(listAttached.total).toBe(1)
    expect(listAttached.items[0].inbox_id).toBe(idAAttached)
    expect(listAttached.items[0].doc_type).toBe('PURCHASE_ORDER')
    expect(listAttached.items[0].doc_number).toBe(poNum)
  })

  it('get_bill_image: คืน content[0] เป็นรูป base64 ถอดกลับได้ไฟล์เดิม และ content[1] เป็น JSON รายละเอียด', async () => {
    const tenant = 'tn_img_' + Math.random().toString(36).slice(2, 8)
    const userId = 'u_img_' + Math.random().toString(36).slice(2, 8)
    createdTenants.push(tenant)

    db.prepare(`
      INSERT INTO users (id, tenant_id, email, password, name, role)
      VALUES (?, ?, ?, 'pass', 'สมหญิง ตรวจสอบ', 'USER')
    `).run(userId, tenant, `${userId}@test.com`)

    const originalContent = 'image-binary-payload-' + Math.random().toString(36)
    const f = createTestFile(originalContent)

    const inboxId = 'inbox_img_' + Math.random().toString(36).slice(2, 8)
    db.prepare(`
      INSERT INTO bill_inbox (id, tenant_id, line_message_id, line_user_id, user_id, file_path, mime_type, file_size, status, created_at)
      VALUES (?, ?, 'msg_img', 'line_u', ?, ?, 'image/png', ?, 'PENDING', '2026-11-05T12:00:00Z')
    `).run(inboxId, tenant, userId, f.fileName, Buffer.byteLength(originalContent))

    const { server, call } = fakeServer()
    registerBillInboxTools(server, tenant, userId)

    const res = await call('get_bill_image', { inbox_id: inboxId })
    expect(res.content).toHaveLength(2)

    // content[0] คือ image
    expect(res.content[0].type).toBe('image')
    expect(res.content[0].mimeType).toBe('image/png')
    const decoded = Buffer.from(res.content[0].data, 'base64').toString('utf8')
    expect(decoded).toBe(originalContent)

    // content[1] คือ metadata JSON
    expect(res.content[1].type).toBe('text')
    const meta = JSON.parse(res.content[1].text)
    expect(meta.success).toBe(true)
    expect(meta.inbox_id).toBe(inboxId)
    expect(meta.status).toBe('PENDING')
    expect(meta.sent_by).toBe('สมหญิง ตรวจสอบ')

    // ไม่พบ inbox_id
    const notFound = parse(await call('get_bill_image', { inbox_id: 'non-existent' }))
    expect(notFound.success).toBe(false)

    // กิจการอื่นเข้าถึงไม่ได้
    const otherServer = fakeServer()
    registerBillInboxTools(otherServer.server, 'other_tenant', userId)
    const otherTenantRes = parse(await otherServer.call('get_bill_image', { inbox_id: inboxId }))
    expect(otherTenantRes.success).toBe(false)
  })

  it('attach_document_evidence (ทาง inbox_id): แนบเอกสารสำเร็จ, ย้ายเป็น ATTACHED และชี้ไฟล์เดิม', async () => {
    const tenant = 'tn_att_' + Math.random().toString(36).slice(2, 8)
    const userId = 'u_att_' + Math.random().toString(36).slice(2, 8)
    createdTenants.push(tenant)

    db.prepare(`
      INSERT INTO users (id, tenant_id, email, password, name, role)
      VALUES (?, ?, ?, 'pass', 'ผู้จัดซื้อ', 'ADMIN')
    `).run(userId, tenant, `${userId}@test.com`)

    const poId = 'po_' + Math.random().toString(36).slice(2, 8)
    const poNum = 'PO-2026-88888'
    db.prepare(`
      INSERT INTO purchase_orders (id, tenant_id, po_number, status)
      VALUES (?, ?, ?, 'DRAFT')
    `).run(poId, tenant, poNum)

    const f = createTestFile('bill-for-po-attachment')
    const inboxId = 'inbox_to_attach_' + Math.random().toString(36).slice(2, 8)
    db.prepare(`
      INSERT INTO bill_inbox (id, tenant_id, line_message_id, line_user_id, user_id, file_path, mime_type, file_size, status, created_at)
      VALUES (?, ?, 'msg_po_att', 'line_u', ?, ?, 'image/jpeg', 500, 'PENDING', '2026-11-10T09:30:00Z')
    `).run(inboxId, tenant, userId, f.fileName)

    const { server, call } = fakeServer()
    registerPurchaseTools(server, tenant, userId, 'ผู้จัดซื้อ', 'ADMIN')

    // แนบสำเร็จ
    const attachRes = parse(await call('attach_document_evidence', {
      doc_type: 'PURCHASE_ORDER',
      doc_id_or_number: poNum,
      inbox_id: inboxId,
    }))
    expect(attachRes.success).toBe(true)
    expect(attachRes.inbox_id).toBe(inboxId)
    expect(attachRes.attachment.doc_id).toBe(poId)
    expect(attachRes.attachment.doc_number).toBe(poNum)
    expect(attachRes.attachment.file_path).toBe(`/storage/payment-attachments/${f.fileName}`)

    // ตรวจ payment_attachments ในฐานข้อมูล
    const attRow = db.prepare('SELECT * FROM payment_attachments WHERE id = ?').get(attachRes.attachment.id) as any
    expect(attRow).toBeDefined()
    expect(attRow.tenant_id).toBe(tenant)
    expect(attRow.ref_type).toBe('PURCHASE_ORDER')
    expect(attRow.ref_id).toBe(poId)
    expect(attRow.file_path).toBe(f.fileName) // ใช้ชื่อไฟล์เดิม ไม่ได้ก๊อปปี้
    expect(attRow.original_name).toMatch(/^bill-2026-11-10-/)

    // ตรวจ bill_inbox ว่าเปลี่ยนเป็น ATTACHED พร้อมข้อมูลอ้างอิง
    const inboxRow = db.prepare('SELECT * FROM bill_inbox WHERE id = ?').get(inboxId) as any
    expect(inboxRow.status).toBe('ATTACHED')
    expect(inboxRow.ref_type).toBe('PURCHASE_ORDER')
    expect(inboxRow.ref_id).toBe(poId)
    expect(inboxRow.attachment_id).toBe(attachRes.attachment.id)
    expect(inboxRow.processed_by).toBe(userId)
    expect(inboxRow.processed_at).toBeDefined()

    // แนบซ้ำด้วย inbox_id เดิมที่ ATTACHED ไปแล้ว ต้องถูกปฏิเสธ (success: false)
    const secondAttach = parse(await call('attach_document_evidence', {
      doc_type: 'PURCHASE_ORDER',
      doc_id_or_number: poNum,
      inbox_id: inboxId,
    }))
    expect(secondAttach.success).toBe(false)
    expect(secondAttach.message).toMatch(/ไม่อยู่ในสถานะ PENDING/)
  })

  it('attach_document_evidence: ตรวจจับ error conditions (ส่งทั้งคู่, ไม่ส่งเลย, ข้าม tenant)', async () => {
    const tenantA = 'tn_att_err_a_' + Math.random().toString(36).slice(2, 8)
    const tenantB = 'tn_att_err_b_' + Math.random().toString(36).slice(2, 8)
    const userA = 'u_att_err_a_' + Math.random().toString(36).slice(2, 8)
    createdTenants.push(tenantA, tenantB)

    const poId = 'po_err_' + Math.random().toString(36).slice(2, 8)
    const poNum = 'PO-2026-77777'
    db.prepare(`
      INSERT INTO purchase_orders (id, tenant_id, po_number, status)
      VALUES (?, ?, ?, 'DRAFT')
    `).run(poId, tenantA, poNum)

    const f = createTestFile('bill-err')
    const idB = 'inbox_tenant_b_' + Math.random().toString(36).slice(2, 8)
    db.prepare(`
      INSERT INTO bill_inbox (id, tenant_id, line_message_id, line_user_id, file_path, mime_type, file_size, status, created_at)
      VALUES (?, ?, 'msg_err_b', 'line_b', ?, 'image/jpeg', 100, 'PENDING', '2026-11-11T10:00:00Z')
    `).run(idB, tenantB, f.fileName)

    const { server, call } = fakeServer()
    registerPurchaseTools(server, tenantA, userA, 'User A', 'ADMIN')

    // 1. ส่งทั้ง image_base64 และ inbox_id
    const bothRes = parse(await call('attach_document_evidence', {
      doc_type: 'PURCHASE_ORDER',
      doc_id_or_number: poNum,
      image_base64: Buffer.from('some-data').toString('base64'),
      inbox_id: idB,
    }))
    expect(bothRes.success).toBe(false)
    expect(bothRes.message).toMatch(/อย่างใดอย่างหนึ่งเท่านั้น/)

    // 2. ไม่ส่งทั้ง image_base64 และ inbox_id
    const neitherRes = parse(await call('attach_document_evidence', {
      doc_type: 'PURCHASE_ORDER',
      doc_id_or_number: poNum,
    }))
    expect(neitherRes.success).toBe(false)
    expect(neitherRes.message).toMatch(/อย่างใดอย่างหนึ่งเท่านั้น/)

    // 3. นำ inbox_id ของ tenant อื่นมาแนบ
    const crossTenantRes = parse(await call('attach_document_evidence', {
      doc_type: 'PURCHASE_ORDER',
      doc_id_or_number: poNum,
      inbox_id: idB,
    }))
    expect(crossTenantRes.success).toBe(false)
    expect(crossTenantRes.message).toMatch(/ไม่พบบิล/)
  })

  it('discard_bill_inbox: ทิ้งรายการ PENDING สำเร็จ, ไฟล์ถูกลบทิ้ง, บันทึก reason/processed_by', async () => {
    const tenant = 'tn_disc_' + Math.random().toString(36).slice(2, 8)
    const userId = 'u_disc_' + Math.random().toString(36).slice(2, 8)
    createdTenants.push(tenant)

    const f = createTestFile('bill-to-discard')
    expect(fs.existsSync(f.fullPath)).toBe(true)

    const inboxId = 'inbox_disc_' + Math.random().toString(36).slice(2, 8)
    db.prepare(`
      INSERT INTO bill_inbox (id, tenant_id, line_message_id, line_user_id, file_path, mime_type, file_size, status, created_at)
      VALUES (?, ?, 'msg_disc', 'line_u', ?, 'image/jpeg', 250, 'PENDING', '2026-11-12T10:00:00Z')
    `).run(inboxId, tenant, f.fileName)

    const { server, call } = fakeServer()
    registerBillInboxTools(server, tenant, userId)

    // ทิ้งโดยไม่ระบุ reason หรือเหตุผลว่างเปล่า
    const emptyReason = parse(await call('discard_bill_inbox', { inbox_id: inboxId, reason: '   ' }))
    expect(emptyReason.success).toBe(false)

    // ทิ้งสำเร็จ
    const res = parse(await call('discard_bill_inbox', { inbox_id: inboxId, reason: 'รูปเบลอ อ่านไม่ออก' }))
    expect(res.success).toBe(true)
    expect(res.status).toBe('DISCARDED')

    // ตรวจสอบใน DB
    const row = db.prepare('SELECT * FROM bill_inbox WHERE id = ?').get(inboxId) as any
    expect(row.status).toBe('DISCARDED')
    expect(row.discard_reason).toBe('รูปเบลอ อ่านไม่ออก')
    expect(row.processed_by).toBe(userId)
    expect(row.processed_at).toBeDefined()

    // ไฟล์ต้องถูกลบจากดิสก์แล้ว
    expect(fs.existsSync(f.fullPath)).toBe(false)

    // ทิ้งซ้ำ (สถานะเป็น DISCARDED อยู่แล้ว) ต้องล้มเหลว
    const retryRes = parse(await call('discard_bill_inbox', { inbox_id: inboxId, reason: 'ทิ้งซ้ำ' }))
    expect(retryRes.success).toBe(false)
    expect(retryRes.message).toMatch(/ทิ้งได้เฉพาะ PENDING/)
  })
})
