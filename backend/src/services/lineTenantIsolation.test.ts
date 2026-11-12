import { describe, it, expect, vi, afterEach } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { richMenus } from './line-richmenu.service'
import { lineBotService } from './line-bot.service'

/** OA กลาง: คำสั่งของคนร้าน A ต้องไม่มีชื่อ/อีเมล/รหัสของร้าน B โผล่ในคำตอบ */
const CMDS = ['บัญชีของฉัน', 'ยอดขายวันนี้', 'กำไรเดือนนี้', 'รออนุมัติ', 'สต็อกต่ำ', 'สถานะ']
const made: string[] = []
afterEach(() => {
    vi.restoreAllMocks()
    for (const t of made.splice(0)) for (const tb of ['line_user_mappings', 'line_group_mappings', 'line_link_tokens', 'users', 'company_settings'])
        db.prepare(`DELETE FROM ${tb} WHERE tenant_id = ?`).run(t)
})

function shop(label: string) {
    const tenantId = 'tenant_iso_' + generateId().slice(0, 8); made.push(tenantId)
    const userId = generateId(), email = `${label}-${userId}@example.com`, company = `ร้าน${label}-${tenantId.slice(-6)}`
    db.prepare(`INSERT INTO users (id, email, password, name, role, tenant_id, status) VALUES (?, ?, 'x', ?, 'ADMIN', ?, 'active')`).run(userId, email, 'คน' + label, tenantId)
    try { db.prepare('INSERT INTO company_settings (id, tenant_id, name) VALUES (?, ?, ?)').run(generateId(), tenantId, company) }
    catch { db.prepare('INSERT INTO company_settings (tenant_id, name) VALUES (?, ?)').run(tenantId, company) }
    return { tenantId, userId, email, company, lineUserId: 'U' + generateId() }
}

describe('LINE OA กลาง: แยกข้อมูลระหว่างบริษัท', () => {
    it('คนร้าน A กับคนร้าน B สั่งคำสั่งเดียวกัน → ได้ของร้านตัวเองเท่านั้น', async () => {
        const replies: any[] = []
        vi.spyOn(lineBotService as any, 'getClient').mockReturnValue({ token: 't', replyMessage: async (_t: string, m: any) => { replies.push(m) }, pushMessage: vi.fn() })
        vi.spyOn(richMenus, 'syncUser').mockResolvedValue()
        const say = async (text: string, source: any) => {
            const n = replies.length
            const ev = { type: 'message', replyToken: 'rt', message: { type: 'text', text }, source }
            await lineBotService.handleEvent(lineBotService.resolveTenant(ev), ev)
            return JSON.stringify(replies.slice(n))
        }
        const A = shop('เอ'), B = shop('บี')
        for (const s of [A, B]) {
            const out = await say(lineBotService.generateLinkToken(s.tenantId, s.userId), { type: 'user', userId: s.lineUserId })
            expect(out).toContain(s.company)
        }
        expect(lineBotService.resolveTenant({ source: { type: 'user', userId: A.lineUserId } })).toBe(A.tenantId)
        expect(lineBotService.resolveTenant({ source: { type: 'user', userId: B.lineUserId } })).toBe(B.tenantId)

        let answered = 0
        for (const [me, other] of [[A, B], [B, A]] as const) for (const cmd of CMDS) {
            const out = await say(cmd, { type: 'user', userId: me.lineUserId })
            if (out !== '[]') answered++
            for (const leak of [other.company, other.email, other.tenantId]) expect(out, `${cmd}: ของอีกร้านหลุด`).not.toContain(leak)
            if (cmd === 'บัญชีของฉัน') { expect(out).toContain(me.company); expect(out).toContain(me.email) }
        }
        expect(answered, 'คำสั่งต้องมีคำตอบจริง ไม่ใช่ผ่านเพราะเงียบ').toBeGreaterThanOrEqual(8)

        // คนที่ไม่ได้ผูก: ไม่มีชื่อร้านไหนหลุด
        for (const cmd of CMDS) {
            const out = await say(cmd, { type: 'user', userId: 'U' + generateId() })
            for (const s of [A, B]) expect(out, `ไม่ผูก · ${cmd}`).not.toContain(s.company)
        }

        // กลุ่มของร้าน B: คนร้าน A พิมพ์ในกลุ่ม → ไม่มีข้อมูลร้าน A หลุดเข้ากลุ่ม
        const g = { type: 'group', groupId: 'C' + generateId(), userId: B.lineUserId }
        expect(await say(lineBotService.generateLinkToken(B.tenantId, B.userId), g)).toContain(B.company)
        for (const cmd of CMDS) {
            const out = await say(cmd, { ...g, userId: A.lineUserId })
            for (const leak of [A.company, A.email, A.tenantId]) expect(out, `กลุ่ม B · ${cmd}`).not.toContain(leak)
        }
    })
})
