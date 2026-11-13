import { describe, it, expect, vi, afterEach } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { richMenus } from './line-richmenu.service'
import { lineBotService } from './line-bot.service'

/** โหมด demo: MASTER ดูบอทเป็นตำแหน่งที่ต่ำกว่าได้ — ลดสิทธิ์อย่างเดียว ไม่มีทางยกสิทธิ์ให้คนที่ไม่ใช่ MASTER */
const made: string[] = []
afterEach(() => {
    vi.restoreAllMocks()
    for (const t of made.splice(0)) for (const tb of ['line_user_mappings', 'users'])
        db.prepare(`DELETE FROM ${tb} WHERE tenant_id = ?`).run(t)
})

function rig() {
    const replies: any[] = []
    vi.spyOn(lineBotService as any, 'getClient').mockReturnValue({ token: 't', replyMessage: async (_t: string, m: any) => { replies.push(m) }, pushMessage: vi.fn() })
    const sync = vi.spyOn(richMenus, 'syncUser').mockResolvedValue()
    return { replies, sync }
}

function member(role: string, lineUserId: string, label = '') {
    const tenantId = 'tenant_demo_' + generateId().slice(0, 8) + label; made.push(tenantId)
    const userId = generateId()
    db.prepare(`INSERT INTO users (id, email, password, name, role, tenant_id, status) VALUES (?, ?, 'x', 'ทดสอบ', ?, ?, 'active')`).run(userId, `${userId}@example.com`, role, tenantId)
    db.prepare(`INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role) VALUES (?, ?, ?, ?, ?)`).run(generateId(), tenantId, userId, lineUserId, role)
    return tenantId
}

const send = (tenantId: string, lineUserId: string, ev: any) =>
    lineBotService.handleEvent(tenantId, { replyToken: 'rt', source: { type: 'user', userId: lineUserId }, ...ev })
const say = (t: string, u: string, text: string) => send(t, u, { type: 'message', message: { type: 'text', text } })
const press = (t: string, u: string, role: string) => send(t, u, { type: 'postback', postback: { data: `action=demo_role&role=${role}` } })
const row = (t: string, u: string) => db.prepare('SELECT role, demo_role FROM line_user_mappings WHERE tenant_id = ? AND line_user_id = ?').get(t, u) as any

describe('LINE โหมด demo', () => {
    it('MASTER พิมพ์ demo → ได้ quick reply 4 ปุ่ม postback', async () => {
        const { replies } = rig(), u = 'U' + generateId(), t = member('MASTER', u)
        await say(t, u, 'demo')
        const items = replies[0].quickReply.items
        expect(items).toHaveLength(4)
        expect(items.every((i: any) => i.action.type === 'postback')).toBe(true)
        expect(items.map((i: any) => i.action.data)).toEqual([
            'action=demo_role&role=ADMIN', 'action=demo_role&role=MANAGER', 'action=demo_role&role=USER', 'action=demo_role&role=off',
        ])
    })

    it('เลือกพนักงาน → เก็บ demo_role, role จริงไม่เปลี่ยน, เมนู staff, ยอดขายถูกปฏิเสธ · off → กลับมาใช้ได้', async () => {
        const { replies, sync } = rig(), u = 'U' + generateId(), t = member('MASTER', u)
        await press(t, u, 'USER')
        expect(row(t, u)).toEqual({ role: 'MASTER', demo_role: 'USER' })
        expect(sync).toHaveBeenCalledWith(t, 't', u, 'staff')

        await say(t, u, 'ยอดขายวันนี้')
        expect(replies.at(-1).text).toContain('🔒')
        expect(row(t, u).role).toBe('MASTER')

        await press(t, u, 'off')
        expect(row(t, u).demo_role).toBeNull()
        expect(sync).toHaveBeenLastCalledWith(t, 't', u, 'exec')
        await say(t, u, 'ยอดขายวันนี้')
        expect(replies.at(-1).text ?? '').not.toContain('🔒')
    })

    it('MANAGER พิมพ์ demo / กดปุ่ม demo → ถูกปฏิเสธ demo_role ว่างตลอด', async () => {
        const { replies } = rig(), u = 'U' + generateId(), t = member('MANAGER', u)
        await say(t, u, 'demo')
        expect(replies.at(-1).text).toContain('🔒')
        await press(t, u, 'ADMIN')
        expect(replies.at(-1).text).toContain('🔒')
        expect(row(t, u).demo_role).toBeNull()
    })

    it('demo_role ค้างของคนที่ role จริงเป็น USER → ถูกเมิน ยังเป็น USER', async () => {
        const { replies } = rig(), u = 'U' + generateId(), t = member('USER', u)
        db.prepare(`UPDATE line_user_mappings SET demo_role = 'ADMIN' WHERE tenant_id = ?`).run(t)
        await say(t, u, 'ยอดขายวันนี้')
        expect(replies.at(-1).text).toContain('🔒')
    })

    it('demo ในบริษัท A ไม่กระทบ role ของ LINE เดียวกันในบริษัท B', async () => {
        const { replies } = rig(), u = 'U' + generateId()
        const A = member('MASTER', u, 'a'), B = member('MASTER', u, 'b')
        await press(A, u, 'USER')
        await say(A, u, 'ยอดขายวันนี้')
        expect(replies.at(-1).text).toContain('🔒')
        await say(B, u, 'ยอดขายวันนี้')
        expect(replies.at(-1).text ?? '').not.toContain('🔒')
        expect(row(B, u).demo_role).toBeNull()
    })
})
