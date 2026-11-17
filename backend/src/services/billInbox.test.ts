import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { invoiceUploadDir } from '../routes/sales/shared'
import { richMenus } from './line-richmenu.service'
import { lineBotService } from './line-bot.service'
import { intakeBillImage, MAX_PENDING_PER_TENANT } from './billInbox.service'

const tenants: string[] = []
const createdFiles: string[] = []

afterEach(() => {
    vi.restoreAllMocks()
    for (const t of tenants.splice(0)) {
        // ลบไฟล์บนดิสก์ที่สร้างระหว่างเทสต์
        const rows = db.prepare('SELECT file_path FROM bill_inbox WHERE tenant_id = ?').all(t) as { file_path: string }[]
        for (const r of rows) {
            const p = path.join(invoiceUploadDir, path.basename(r.file_path))
            try { if (fs.existsSync(p)) fs.unlinkSync(p) } catch {}
        }
        const attRows = db.prepare('SELECT file_path FROM payment_attachments WHERE tenant_id = ?').all(t) as { file_path: string }[]
        for (const r of attRows) {
            const p = path.join(invoiceUploadDir, path.basename(r.file_path))
            try { if (fs.existsSync(p)) fs.unlinkSync(p) } catch {}
        }
        for (const tb of ['bill_inbox', 'payment_attachments', 'purchase_orders', 'line_user_mappings', 'line_group_mappings', 'line_link_tokens', 'users']) {
            try { db.prepare(`DELETE FROM ${tb} WHERE tenant_id = ?`).run(t) } catch {}
        }
    }
    for (const f of createdFiles.splice(0)) {
        try { if (fs.existsSync(f)) fs.unlinkSync(f) } catch {}
    }
})

let colorSeed = 1
async function makeImage(): Promise<Buffer> {
    const c = ++colorSeed
    const r = (c * 37) % 256
    const g = (c * 67) % 256
    const b = (c * 97) % 256
    return sharp({
        create: {
            width: 80,
            height: 80,
            channels: 3,
            background: { r, g, b },
        },
    }).jpeg().toBuffer()
}

function setup(role = 'USER') {
    const tenantId = 'tenant_bi_' + generateId().slice(0, 8)
    tenants.push(tenantId)
    const userId = generateId()
    const lineUserId = 'U' + generateId()

    db.prepare(`INSERT INTO users (id, email, password, name, role, tenant_id, status) VALUES (?, ?, 'x', 'ทดสอบ', ?, ?, 'active')`)
        .run(userId, `${userId}@example.com`, role, tenantId)

    db.prepare(`INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role, notify_events, linked_at) VALUES (?, ?, ?, ?, ?, '[]', datetime('now'))`)
        .run(generateId(), tenantId, userId, lineUserId, role)

    const replies: any[] = []
    let currentBuffer: Buffer | null = null

    const client = {
        token: 'token_' + tenantId,
        replyMessage: async (_t: string, m: any) => { replies.push(m) },
        pushMessage: vi.fn(),
        getMessageContent: async (_id: string): Promise<Buffer> => {
            if (currentBuffer) return currentBuffer
            return makeImage()
        },
    }

    vi.spyOn(lineBotService as any, 'getClient').mockReturnValue(client)
    vi.spyOn(richMenus, 'syncUser').mockResolvedValue()

    const send = (event: any) =>
        lineBotService.handleEvent(lineBotService.resolveTenant(event), { replyToken: 'rt', ...event })

    const sendImage = (messageId: string, src: any, extraMsg: any = {}) =>
        send({
            type: 'message',
            message: { type: 'image', id: messageId, ...extraMsg },
            source: src,
        })

    return {
        tenantId,
        userId,
        lineUserId,
        replies,
        client,
        send,
        sendImage,
        setBuffer: (buf: Buffer | null) => { currentBuffer = buf },
    }
}

describe('T1 — Bill Inbox: รับรูปบิลจาก LINE', () => {
    it('ผูกแล้วส่งรูป → แถว PENDING + ไฟล์อยู่จริง + ข้อความตอบ', async () => {
        const { tenantId, userId, lineUserId, replies, sendImage, setBuffer } = setup()
        const imgBuf = await makeImage()
        setBuffer(imgBuf)

        const msgId = 'msg_' + generateId()
        await sendImage(msgId, { type: 'user', userId: lineUserId })

        expect(replies.length).toBe(1)
        expect(replies[0].text).toBe('📥 รับบิลแล้ว · รอลงบัญชี 1 ใบ')

        const row = db.prepare('SELECT * FROM bill_inbox WHERE tenant_id = ?').get(tenantId) as any
        expect(row).toBeDefined()
        expect(row.status).toBe('PENDING')
        expect(row.tenant_id).toBe(tenantId)
        expect(row.line_user_id).toBe(lineUserId)
        expect(row.user_id).toBe(userId)
        expect(row.line_message_id).toBe(msgId)
        expect(row.file_path).toMatch(/^inbox-[a-f0-9]+\.jpg$/i)
        expect(row.mime_type).toBe('image/jpeg')
        expect(row.file_size).toBeGreaterThan(0)

        const diskPath = path.join(invoiceUploadDir, row.file_path)
        expect(fs.existsSync(diskPath)).toBe(true)
        const saved = fs.readFileSync(diskPath)
        expect(saved.length).toBe(row.file_size)
    })

    it('ยังไม่ผูกบัญชี (ไม่มี tenant หรือ mapping) → ไม่มีแถว + ตอบวิธีผูก', async () => {
        const { tenantId, replies, sendImage } = setup()
        const unlinkedLineUserId = 'U_unlinked_' + generateId()

        await sendImage('msg_unlinked', { type: 'user', userId: unlinkedLineUserId })

        expect(replies.length).toBe(1)
        expect(replies[0].text).toContain('วิธีเชื่อมบัญชี')

        const rows = db.prepare('SELECT * FROM bill_inbox WHERE tenant_id = ?').all(tenantId)
        expect(rows.length).toBe(0)
    })

    it('รูปในกลุ่ม/ห้อง → ไม่มีแถว ไม่ตอบ (เงียบ)', async () => {
        const { tenantId, lineUserId, replies, sendImage } = setup()

        // ส่งในกลุ่ม
        const groupSrc = { type: 'group', groupId: 'G_' + generateId(), userId: lineUserId }
        await sendImage('msg_group', groupSrc)
        expect(replies.length).toBe(0)

        // ส่งในห้อง
        const roomSrc = { type: 'room', roomId: 'R_' + generateId(), userId: lineUserId }
        await sendImage('msg_room', roomSrc)
        expect(replies.length).toBe(0)

        const rows = db.prepare('SELECT * FROM bill_inbox WHERE tenant_id = ?').all(tenantId)
        expect(rows.length).toBe(0)
    })

    it('message id ซ้ำ → แถวเดียว ไม่ตอบซ้ำ (เงียบ)', async () => {
        const { tenantId, lineUserId, replies, sendImage, setBuffer } = setup()
        const imgBuf = await makeImage()
        setBuffer(imgBuf)

        const msgId = 'msg_dup_' + generateId()
        await sendImage(msgId, { type: 'user', userId: lineUserId })
        expect(replies.length).toBe(1)
        expect(replies[0].text).toContain('รับบิลแล้ว')

        // ส่งซ้ำด้วย message id เดิม
        await sendImage(msgId, { type: 'user', userId: lineUserId })
        expect(replies.length, 'เงียบ ไม่ตอบเพิ่ม').toBe(1)

        const count = (db.prepare('SELECT COUNT(*) AS c FROM bill_inbox WHERE tenant_id = ?').get(tenantId) as any).c
        expect(count).toBe(1)
    })

    it('รูปเดิมส่งซ้ำ (message id ต่างกัน) ในร้านเดียวกัน → DUPLICATE_IMAGE ไม่มี docNum', async () => {
        const { tenantId, lineUserId, replies, sendImage, setBuffer } = setup()
        const imgBuf = await makeImage()
        setBuffer(imgBuf)

        await sendImage('msg_first_' + generateId(), { type: 'user', userId: lineUserId })
        expect(replies.length).toBe(1)
        expect(replies[0].text).toContain('รับบิลแล้ว')

        // ส่งรูปเดิมอีกรอบด้วย message id ใหม่
        await sendImage('msg_second_' + generateId(), { type: 'user', userId: lineUserId })
        expect(replies.length).toBe(2)
        expect(replies[1].text).toBe('⚠️ รูปนี้ส่งมาแล้ว และยังรอลงบัญชีอยู่ ไม่ได้เก็บซ้ำ')

        const count = (db.prepare('SELECT COUNT(*) AS c FROM bill_inbox WHERE tenant_id = ?').get(tenantId) as any).c
        expect(count).toBe(1)
    })

    it('รูปซ้ำกับไฟล์แนบใน payment_attachments → DUPLICATE_IMAGE มี docNum และ label', async () => {
        const { tenantId, userId, lineUserId, replies, sendImage, setBuffer } = setup()
        const imgBuf = await makeImage()

        // 1. สร้าง PO อ้างอิง
        const poId = generateId()
        const poNumber = 'PO-TEST-' + generateId().slice(0, 5)
        db.prepare('INSERT INTO purchase_orders (id, tenant_id, po_number, status) VALUES (?, ?, ?, ?)').run(poId, tenantId, poNumber, 'DRAFT')

        // 2. เขียนไฟล์หลักฐานลง invoiceUploadDir
        const storageFileName = `pay-PO-${poId}-${Date.now()}.jpg`
        const filePath = path.join(invoiceUploadDir, storageFileName)
        fs.writeFileSync(filePath, imgBuf)
        createdFiles.push(filePath)

        // 3. บันทึกลง payment_attachments
        const attId = generateId()
        db.prepare(`
            INSERT INTO payment_attachments (id, tenant_id, ref_type, ref_id, file_path, original_name, file_size, uploaded_by, created_at)
            VALUES (?, ?, 'PURCHASE_ORDER', ?, ?, 'bill.jpg', ?, ?, datetime('now'))
        `).run(attId, tenantId, poId, storageFileName, imgBuf.length, userId)

        // 4. ส่งรูปเดียวกันผ่าน LINE
        setBuffer(imgBuf)
        await sendImage('msg_po_dup_' + generateId(), { type: 'user', userId: lineUserId })

        expect(replies.length).toBe(1)
        expect(replies[0].text).toBe(`⚠️ รูปนี้เคยแนบไว้แล้วในใบสั่งซื้อ ${poNumber} ไม่ได้เก็บซ้ำ`)

        const rows = db.prepare('SELECT id FROM bill_inbox WHERE tenant_id = ?').all(tenantId)
        expect(rows.length).toBe(0)
    })

    it('ร้านอื่นไม่เห็นแถว: รูปของร้าน A ไม่ปนกับร้าน B', async () => {
        const a = setup()
        const imgA = await makeImage()
        a.setBuffer(imgA)

        await a.sendImage('msg_a1', { type: 'user', userId: a.lineUserId })
        expect(a.replies.length).toBe(1)
        // setup() mock getClient ทับกัน — สร้างร้าน B หลังร้าน A ส่งเสร็จ
        const b = setup()

        // ร้าน B ตรวจ inbox ตัวเองต้องไม่เห็นของร้าน A
        const bRows = db.prepare('SELECT id FROM bill_inbox WHERE tenant_id = ?').all(b.tenantId)
        expect(bRows.length).toBe(0)

        // ร้าน B ส่งรูปเดียวกัน (เทียบซ้ำเฉพาะในร้านเดียวกันเท่านั้น)
        b.setBuffer(imgA)
        await b.sendImage('msg_b1', { type: 'user', userId: b.lineUserId })
        expect(b.replies.length).toBe(1)
        expect(b.replies[0].text).toBe('📥 รับบิลแล้ว · รอลงบัญชี 1 ใบ')

        const bAfter = db.prepare('SELECT id FROM bill_inbox WHERE tenant_id = ?').all(b.tenantId)
        expect(bAfter.length).toBe(1)
    })

    it('รูปเป็นชุด (imageSet) → เก็บทุกใบ แต่ตอบครั้งเดียวตอน index === total', async () => {
        const { tenantId, lineUserId, replies, sendImage, setBuffer } = setup()
        const img1 = await makeImage()
        const img2 = await makeImage()
        const img3 = await makeImage()

        const setId = 'set_' + generateId().slice(0, 6)

        // ใบที่ 1
        setBuffer(img1)
        await sendImage('msg_set_1', { type: 'user', userId: lineUserId }, { imageSet: { id: setId, index: 1, total: 3 } })
        expect(replies.length).toBe(0)

        // ใบที่ 2
        setBuffer(img2)
        await sendImage('msg_set_2', { type: 'user', userId: lineUserId }, { imageSet: { id: setId, index: 2, total: 3 } })
        expect(replies.length).toBe(0)

        // ใบที่ 3 (สุดท้าย)
        setBuffer(img3)
        await sendImage('msg_set_3', { type: 'user', userId: lineUserId }, { imageSet: { id: setId, index: 3, total: 3 } })
        expect(replies.length).toBe(1)
        expect(replies[0].text).toBe('📥 รับบิลแล้ว · รอลงบัญชี 3 ใบ')

        const count = (db.prepare('SELECT COUNT(*) AS c FROM bill_inbox WHERE tenant_id = ?').get(tenantId) as any).c
        expect(count).toBe(3)
    })

    it('บิลรอลงเต็ม MAX_PENDING_PER_TENANT (200) → INBOX_FULL', async () => {
        const { tenantId, lineUserId, replies, sendImage } = setup()

        // จำลอง 200 แถว PENDING ด้วย transaction
        const insert = db.prepare(`
            INSERT INTO bill_inbox (id, tenant_id, line_message_id, line_user_id, file_path, mime_type, file_size, status, created_at)
            VALUES (?, ?, ?, ?, 'seed.jpg', 'image/jpeg', 50, 'PENDING', datetime('now'))
        `)
        const insertMany = db.transaction(() => {
            for (let i = 0; i < MAX_PENDING_PER_TENANT; i++) {
                insert.run(generateId(), tenantId, `seed_msg_${i}_${generateId()}`, lineUserId)
            }
        })
        insertMany()

        await sendImage('msg_overflow', { type: 'user', userId: lineUserId })
        expect(replies.length).toBe(1)
        expect(replies[0].text).toBe(`⚠️ บิลรอลงเต็ม ${MAX_PENDING_PER_TENANT} ใบแล้ว แจ้งผู้ดูแลให้เคลียร์ก่อน`)

        const count = (db.prepare("SELECT COUNT(*) AS c FROM bill_inbox WHERE tenant_id = ? AND status = 'PENDING'").get(tenantId) as any).c
        expect(count).toBe(MAX_PENDING_PER_TENANT)
    })

    it('ไฟล์ไม่ใช่รูป → NOT_IMAGE ตอบ "ไฟล์นี้อ่านเป็นรูปไม่ได้ ลองถ่ายใหม่อีกครั้ง"', async () => {
        const { tenantId, lineUserId, replies, sendImage, setBuffer } = setup()
        setBuffer(Buffer.from('not an image at all'))

        await sendImage('msg_not_image', { type: 'user', userId: lineUserId })
        expect(replies.length).toBe(1)
        expect(replies[0].text).toBe('ไฟล์นี้อ่านเป็นรูปไม่ได้ ลองถ่ายใหม่อีกครั้ง')

        const count = (db.prepare('SELECT COUNT(*) AS c FROM bill_inbox WHERE tenant_id = ?').get(tenantId) as any).c
        expect(count).toBe(0)
    })

    it('ดึงรูปไม่สำเร็จ: client throw error → ตอบ "ดึงรูปไม่สำเร็จ ลองส่งใหม่อีกครั้ง"', async () => {
        const { tenantId, lineUserId, replies, sendImage, client } = setup()
        client.getMessageContent = async () => { throw new Error('Network error') }

        await sendImage('msg_err', { type: 'user', userId: lineUserId })
        expect(replies.length).toBe(1)
        expect(replies[0].text).toBe('ดึงรูปไม่สำเร็จ ลองส่งใหม่อีกครั้ง')

        const count = (db.prepare('SELECT COUNT(*) AS c FROM bill_inbox WHERE tenant_id = ?').get(tenantId) as any).c
        expect(count).toBe(0)
    })

    it('ดึงรูปไม่สำเร็จ: รูปขนาดเกิน 10MB → ตอบ "ดึงรูปไม่สำเร็จ ลองส่งใหม่อีกครั้ง"', async () => {
        const { tenantId, lineUserId, replies, sendImage, client } = setup()
        client.getMessageContent = async () => Buffer.alloc(11 * 1024 * 1024)

        await sendImage('msg_oversize', { type: 'user', userId: lineUserId })
        expect(replies.length).toBe(1)
        expect(replies[0].text).toBe('ดึงรูปไม่สำเร็จ ลองส่งใหม่อีกครั้ง')

        const count = (db.prepare('SELECT COUNT(*) AS c FROM bill_inbox WHERE tenant_id = ?').get(tenantId) as any).c
        expect(count).toBe(0)
    })
})

describe('intakeBillImage unit tests', () => {
    it('รับรูปปกติ คืน ok: true, id, pending', async () => {
        const { tenantId, userId, lineUserId } = setup()
        const raw = await makeImage()
        const res = await intakeBillImage({
            tenantId,
            lineUserId,
            userId,
            lineMessageId: 'unit_msg_' + generateId(),
            raw,
        })
        expect(res.ok).toBe(true)
        if (res.ok) {
            expect(res.id).toBeTruthy()
            expect(res.pending).toBe(1)
        }
    })
})
