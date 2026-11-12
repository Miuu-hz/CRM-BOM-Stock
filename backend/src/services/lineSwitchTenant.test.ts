import { describe, it, expect, vi, afterEach } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { richMenus } from './line-richmenu.service'
import { lineBotService } from './line-bot.service'

/** OA กลาง: LINE เดียวผูกหลายบริษัท — สลับได้เฉพาะบริษัทที่ผูกไว้จริง และข้อมูลตามบริษัทที่เลือก */
const made: string[] = []
afterEach(() => {
    vi.restoreAllMocks()
    for (const t of made.splice(0)) for (const tb of ['line_user_mappings', 'line_link_tokens', 'users', 'company_settings'])
        db.prepare(`DELETE FROM ${tb} WHERE tenant_id = ?`).run(t)
})

function shop(label: string, role = 'ADMIN') {
    const tenantId = 'tenant_sw_' + generateId().slice(0, 8); made.push(tenantId)
    const userId = generateId(), company = `ร้าน${label}-${tenantId.slice(-6)}`
    db.prepare(`INSERT INTO users (id, email, password, name, role, tenant_id, status) VALUES (?, ?, 'x', ?, ?, ?, 'active')`).run(userId, `${userId}@example.com`, 'คน' + label, role, tenantId)
    try { db.prepare('INSERT INTO company_settings (id, tenant_id, name) VALUES (?, ?, ?)').run(generateId(), tenantId, company) }
    catch { db.prepare('INSERT INTO company_settings (tenant_id, name) VALUES (?, ?)').run(tenantId, company) }
    return { tenantId, userId, company }
}

describe('LINE OA กลาง: เปลี่ยนบริษัท', () => {
    it('ผูก 2 บริษัท → สลับไปมาได้ คำตอบตามบริษัทที่เลือก · สลับไปบริษัทที่ไม่ได้ผูกไม่ได้', async () => {
        const replies: any[] = []
        vi.spyOn(lineBotService as any, 'getClient').mockReturnValue({ token: 't', replyMessage: async (_t: string, m: any) => { replies.push(m) }, pushMessage: vi.fn() })
        const sync = vi.spyOn(richMenus, 'syncUser').mockResolvedValue()
        const uid = 'U' + generateId(), source = { type: 'user', userId: uid }
        const send = async (ev: any) => {
            const n = replies.length, event = { replyToken: 'rt', source, ...ev }
            await lineBotService.handleEvent(lineBotService.resolveTenant(event), event)
            return JSON.stringify(replies.slice(n))
        }
        const say = (text: string) => send({ type: 'message', message: { type: 'text', text } })
        const press = (tenantId: string) => send({ type: 'postback', postback: { data: `action=switch_tenant&id=${encodeURIComponent(tenantId)}` } })
        const active = () => lineBotService.resolveTenant({ source })

        const A = shop('เอ'), B = shop('บี', 'USER'), C = shop('ซี')
        await say(lineBotService.generateLinkToken(A.tenantId, A.userId))
        expect(await say('เปลี่ยนบริษัท'), 'ผูกร้านเดียว → ไม่มีปุ่มให้เลือก').not.toContain('switch_tenant')

        await say(lineBotService.generateLinkToken(B.tenantId, B.userId))
        expect(active(), 'ร้านที่เพิ่งผูกเป็นร้านที่ใช้อยู่').toBe(B.tenantId)

        const menu = await say('เปลี่ยนบริษัท')
        expect(menu).toContain(A.tenantId)          // ปุ่มไปร้าน A
        expect(menu).not.toContain(`id=${B.tenantId}`) // ไม่มีปุ่มไปร้านที่ใช้อยู่
        expect(menu).not.toContain(C.company)       // ร้านที่ไม่ได้ผูกไม่โผล่

        expect(await press(A.tenantId)).toContain(A.company)
        expect(active()).toBe(A.tenantId)
        expect(sync.mock.calls.at(-1)?.slice(0, 1).concat(sync.mock.calls.at(-1)?.[3] as any), 'เมนูตามตำแหน่งในร้าน A').toEqual([A.tenantId, 'exec'])
        const meA = await say('บัญชีของฉัน')
        expect(meA).toContain(A.company); expect(meA).not.toContain(B.company)

        expect(await press(B.tenantId)).toContain(B.company)
        expect(active()).toBe(B.tenantId)
        const meB = await say('บัญชีของฉัน')
        expect(meB).toContain(B.company); expect(meB).not.toContain(A.company)
        expect(await say('ยอดขายวันนี้'), 'ร้าน B เป็นพนักงาน → ไม่เห็นยอดขาย').toContain('🔒')

        // ปุ่มปลอม: ร้านที่ไม่ได้ผูก → ไม่สลับ ไม่หลุดชื่อร้าน
        const forged = await press(C.tenantId)
        expect(forged).not.toContain(C.company)
        expect(active()).toBe(B.tenantId)
    })
})

describe('LINE self-service: ลิงก์เข้าหน้าของฉัน', () => {
    it('แชทส่วนตัว + ผูกกับทะเบียนพนักงาน → ได้ลิงก์ · ในกลุ่ม/ไม่มีทะเบียน → ไม่ได้ลิงก์', async () => {
        const replies: any[] = []
        vi.spyOn(lineBotService as any, 'getClient').mockReturnValue({ token: 't', replyMessage: async (_t: string, m: any) => { replies.push(m) }, pushMessage: vi.fn() })
        vi.spyOn(richMenus, 'syncUser').mockResolvedValue()
        const A = shop('เอ', 'USER'), uid = 'U' + generateId()
        const say = async (text: string, source: any) => {
            const n = replies.length, event = { type: 'message', replyToken: 'rt', message: { type: 'text', text }, source }
            await lineBotService.handleEvent(lineBotService.resolveTenant(event), event)
            return JSON.stringify(replies.slice(n))
        }
        await say(lineBotService.generateLinkToken(A.tenantId, A.userId), { type: 'user', userId: uid })
        expect(await say('ขอลา', { type: 'user', userId: uid }), 'ยังไม่มีทะเบียนพนักงาน').not.toContain('line-login')

        db.prepare(`INSERT INTO employees (id, tenant_id, code, first_name, last_name, employment_type, base_wage, start_date, status, user_id) VALUES (?, ?, 'E1', 'ก', 'ข', 'MONTHLY', 10000, '2026-01-01', 'ACTIVE', ?)`).run(generateId(), A.tenantId, A.userId)
        try {
            expect(await say('ขอลา', { type: 'user', userId: uid })).toContain('/line-login?t=')
            const g = { type: 'group', groupId: 'C' + generateId(), userId: uid }
            db.prepare(`INSERT INTO line_group_mappings (id, tenant_id, group_id, is_active) VALUES (?, ?, ?, 1)`).run(generateId(), A.tenantId, g.groupId)
            expect(await say('ขอลา', g), 'ลิงก์ล็อกอินห้ามโผล่ในกลุ่ม').not.toContain('line-login')
        } finally {
            for (const tb of ['employees', 'line_group_mappings', 'line_login_tokens']) db.prepare(`DELETE FROM ${tb} WHERE tenant_id = ?`).run(A.tenantId)
        }
    })
})

describe('LINE: บัญชีถูกระงับ / กันเดารหัส / กลุ่มของบริษัทอื่น', () => {
    function rig() {
        const replies: any[] = []
        vi.spyOn(lineBotService as any, 'getClient').mockReturnValue({ token: 't', replyMessage: async (_t: string, m: any) => { replies.push(m) }, pushMessage: vi.fn() })
        vi.spyOn(richMenus, 'syncUser').mockResolvedValue()
        const say = async (text: string, source: any) => {
            const n = replies.length, event = { type: 'message', replyToken: 'rt', message: { type: 'text', text }, source }
            await lineBotService.handleEvent(lineBotService.resolveTenant(event), event)
            return JSON.stringify(replies.slice(n))
        }
        return { say }
    }

    it('ระงับบัญชีในร้านที่ใช้อยู่ → คำสั่งไปร้านที่ยังใช้ได้ ไม่เห็นข้อมูลร้านที่ถูกระงับ', async () => {
        const { say } = rig()
        const A = shop('เอ'), B = shop('บี'), src = { type: 'user', userId: 'U' + generateId() }
        await say(lineBotService.generateLinkToken(A.tenantId, A.userId), src)
        await say(lineBotService.generateLinkToken(B.tenantId, B.userId), src)
        db.prepare(`UPDATE users SET status = 'inactive' WHERE id = ?`).run(B.userId)
        expect(lineBotService.resolveTenant({ source: src })).toBe(A.tenantId)
        const out = await say('ยอดขายวันนี้', src)
        expect(out).toContain(A.company); expect(out).not.toContain(B.company)
        db.prepare(`UPDATE users SET status = 'inactive' WHERE id = ?`).run(A.userId)
        expect(await say('ยอดขายวันนี้', src), 'ถูกระงับทุกร้าน → ไม่ได้ข้อมูลอะไร').not.toContain(A.company)
    })

    it('เดารหัสเกิน 5 ครั้งใน 10 นาที → ถูกพัก แม้รหัสถัดไปจะถูก', async () => {
        const { say } = rig()
        const A = shop('เอ'), src = { type: 'user', userId: 'U' + generateId() }
        for (let i = 0; i < 5; i++) await say('000000', src)
        const out = await say(lineBotService.generateLinkToken(A.tenantId, A.userId), src)
        expect(out).toContain('ลองรหัสบ่อยเกินไป')
        expect(lineBotService.resolveTenant({ source: src })).toBe('')
    })

    it('กลุ่มที่ผูกกับร้าน A อยู่ → รหัสผู้ดูแลของร้าน B ย้ายกลุ่มไม่ได้', async () => {
        const { say } = rig()
        const A = shop('เอ'), B = shop('บี')
        const g = { type: 'group', groupId: 'C' + generateId(), userId: 'U' + generateId() }
        try {
            await say(lineBotService.generateLinkToken(A.tenantId, A.userId), g)
            expect(lineBotService.resolveTenant({ source: g })).toBe(A.tenantId)
            const out = await say('ลิงก์ ' + lineBotService.generateLinkToken(B.tenantId, B.userId), { ...g, userId: 'U' + generateId() })
            expect(out).toContain('ผูกกับบริษัทอื่นอยู่')
            expect(lineBotService.resolveTenant({ source: g })).toBe(A.tenantId)
        } finally {
            for (const t of [A, B]) db.prepare('DELETE FROM line_group_mappings WHERE tenant_id = ?').run(t.tenantId)
        }
    })
})
