import { describe, it, expect, vi, afterEach } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { richMenus } from './line-richmenu.service'
import { lineBotService } from './line-bot.service'

/** OA กลาง Phopy-ERP: ร้านมาจากรหัส 6 หลัก ใครไม่ได้ผูกต้องไม่ได้อะไรเลย */
const tenants: string[] = []
afterEach(() => {
    vi.restoreAllMocks()
    for (const t of tenants.splice(0)) {
        for (const tb of ['line_user_mappings', 'line_group_mappings', 'line_link_tokens', 'users']) db.prepare(`DELETE FROM ${tb} WHERE tenant_id = ?`).run(t)
    }
})

function setup(role: string) {
    const tenantId = 'tenant_oa_' + generateId().slice(0, 8)
    tenants.push(tenantId)
    const userId = generateId()
    db.prepare(`INSERT INTO users (id, email, password, name, role, tenant_id, status) VALUES (?, ?, 'x', 'ทดสอบ', ?, ?, 'active')`)
        .run(userId, `${userId}@example.com`, role, tenantId)
    const replies: any[] = []
    const client = { token: 't', replyMessage: async (_t: string, m: any) => { replies.push(m) }, pushMessage: vi.fn() }
    vi.spyOn(lineBotService as any, 'getClient').mockReturnValue(client)
    vi.spyOn(richMenus, 'syncUser').mockResolvedValue()
    // webhook จริงเรียก resolveTenant ก่อน handleEvent — เทสต์ทำตามลำดับเดียวกัน
    const send = (event: any) => lineBotService.handleEvent(lineBotService.resolveTenant(event), { replyToken: 'rt', ...event })
    const say = (text: string, src: any) => send({ type: 'message', message: { type: 'text', text }, source: src })
    return { tenantId, userId, replies, client, send, say }
}

describe('LINE OA กลาง', () => {
    it('คนที่ยังไม่ผูก: ได้แค่วิธีผูก ไม่มี mapping · ส่งรหัส 6 หลักเฉยๆ → ผูกกับร้านของเจ้าของรหัส', async () => {
        const { tenantId, userId, replies, say } = setup('USER')
        const lineUserId = 'U' + generateId()
        await say('สถานะ', { type: 'user', userId: lineUserId })
        expect(replies[0].text).toContain('ยังไม่ได้เชื่อม')
        expect(lineBotService.resolveTenant({ source: { type: 'user', userId: lineUserId } })).toBe('')

        const token = lineBotService.generateLinkToken(tenantId, userId)
        await say(token, { type: 'user', userId: lineUserId })
        expect(replies[1].text).toContain('สำเร็จ')
        expect(lineBotService.resolveTenant({ source: { type: 'user', userId: lineUserId } })).toBe(tenantId)
        const used = db.prepare('SELECT 1 FROM line_link_tokens WHERE token = ?').get(token)
        expect(used, 'รหัสใช้ได้ครั้งเดียว').toBeUndefined()
    })

    it('บอทเข้ากลุ่ม → ไม่ผูกเอง · รหัสพนักงานผูกกลุ่มไม่ได้ · รหัสผู้ดูแลผูกได้', async () => {
        const staff = setup('USER')
        const groupId = 'C' + generateId()
        const g = { type: 'group', groupId, userId: 'U' + generateId() }
        await staff.send({ type: 'join', source: g })
        expect(lineBotService.resolveTenant({ source: g }), 'เข้ากลุ่มแล้วต้องยังไม่ผูก').toBe('')

        await staff.say(lineBotService.generateLinkToken(staff.tenantId, staff.userId), g)
        expect(staff.replies.at(-1).text).toContain('เฉพาะรหัสของผู้ดูแล')
        expect(lineBotService.resolveTenant({ source: g })).toBe('')

        vi.restoreAllMocks()
        const admin = setup('ADMIN')
        await admin.say(lineBotService.generateLinkToken(admin.tenantId, admin.userId), g)
        expect(admin.replies.at(-1).text).toContain('ผูกกลุ่มนี้')
        expect(lineBotService.resolveTenant({ source: g })).toBe(admin.tenantId)
    })

    it('กลุ่มที่ผูกแล้ว: ตัวเลข 6 หลักในแชทปกติไม่ถูกตีเป็นรหัส', async () => {
        const admin = setup('ADMIN')
        const g = { type: 'group', groupId: 'C' + generateId(), userId: 'U' + generateId() }
        await admin.say(lineBotService.generateLinkToken(admin.tenantId, admin.userId), g)
        const n = admin.replies.length
        await admin.say('100000', g)
        expect(admin.replies.length, 'คนพิมพ์ไม่ได้ผูก → เงียบ ไม่ตอบ "รหัสไม่ถูกต้อง"').toBe(n)
    })
})
