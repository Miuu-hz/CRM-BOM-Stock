import { describe, it, expect, vi, afterEach } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { richMenus } from './line-richmenu.service'
import { lineBotService } from './line-bot.service'

/** "demo": จำกัดเฉพาะ Master — non-Master (รวมบัญชีทดสอบ Testshop) ต้องถูกปฏิเสธ */
const lines: string[] = []
const made: { t: string; ids: string[] }[] = []
afterEach(() => {
    vi.restoreAllMocks()
    for (const u of lines.splice(0)) db.prepare('DELETE FROM line_user_mappings WHERE line_user_id = ?').run(u)
    for (const { t, ids } of made.splice(0)) for (const id of ids) {
        db.prepare('DELETE FROM users WHERE id = ? AND tenant_id = ?').run(id, t)
        db.prepare('DELETE FROM employees WHERE user_id = ? AND tenant_id = ?').run(id, t)
    }
})

function seed(t: string, codes: [string, string][]) {
    const ids = codes.map(([code, role]) => {
        const id = generateId()
        db.prepare(`INSERT INTO users (id, email, password, name, role, tenant_id, status) VALUES (?, ?, 'x', ?, ?, ?, 'active')`).run(id, `${id}@example.com`, code, role, t)
        db.prepare(`INSERT INTO employees (id, tenant_id, code, first_name, employment_type, base_wage, start_date, status, user_id) VALUES (?, ?, ?, ?, 'MONTHLY', 0, '2026-01-01', 'ACTIVE', ?)`)
            .run(generateId(), t, code + '-' + id.slice(0, 4), code, id)
        return id
    })
    made.push({ t, ids })
    return ids
}
const setCode = (userId: string, code: string) => db.prepare('UPDATE employees SET code = ? WHERE user_id = ?').run(code, userId)

function rig(t: string, userId: string, role: string) {
    const u = 'U' + generateId(); lines.push(u)
    db.prepare(`INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role) VALUES (?, ?, ?, ?, ?)`).run(generateId(), t, userId, u, role)
    const replies: any[] = []
    vi.spyOn(lineBotService as any, 'getClient').mockReturnValue({ token: 't', replyMessage: async (_t: string, m: any) => { replies.push(m) }, pushMessage: vi.fn() })
    const sync = vi.spyOn(richMenus, 'syncUser').mockResolvedValue()
    const say = (text: string) => lineBotService.handleEvent(t, { replyToken: 'rt', type: 'message', message: { type: 'text', text }, source: { type: 'user', userId: u } })
    const sayInGroup = (text: string) => lineBotService.handleEvent(t, { replyToken: 'rt', type: 'message', message: { type: 'text', text }, source: { type: 'group', groupId: 'C_demo_grp', userId: u } })
    const press = (data: string) => lineBotService.handleEvent(t, { replyToken: 'rt', type: 'postback', postback: { data }, source: { type: 'user', userId: u } })
    const mapped = () => db.prepare('SELECT user_id, role FROM line_user_mappings WHERE tenant_id = ? AND line_user_id = ?').get(t, u) as any
    return { u, replies, sync, say, sayInGroup, press, mapped }
}

describe('LINE demo เฉพาะ Master (non-Master ถูกปฏิเสธ)', () => {
    it('Testshop EMP-TEST และ MGR-TEST (non-Master) พิมพ์ demo → 🔒 mapping ไม่เปลี่ยน', async () => {
        // ร้านสาธิตจริงอาจมี EMP-TEST/MGR-TEST อยู่แล้ว (UNIQUE code) — เทสต์ยืมรหัสชั่วคราวไม่ได้ จึงข้ามถ้ามี
        if (db.prepare(`SELECT 1 FROM employees WHERE tenant_id = 'Testshop' AND code IN ('EMP-TEST','MGR-TEST')`).get()) return
        const [emp, mgr] = seed('Testshop', [['E', 'USER'], ['M', 'MANAGER']])
        setCode(emp, 'EMP-TEST'); setCode(mgr, 'MGR-TEST')
        const rEmp = rig('Testshop', emp, 'USER')
        await rEmp.say('demo')
        expect(rEmp.replies.at(-1).text).toBe('🔒 โหมด demo ใช้ได้เฉพาะ Master ครับ')
        expect(rEmp.mapped()).toEqual({ user_id: emp, role: 'USER' })

        const rMgr = rig('Testshop', mgr, 'MANAGER')
        await rMgr.say('demo')
        expect(rMgr.replies.at(-1).text).toBe('🔒 โหมด demo ใช้ได้เฉพาะ Master ครับ')
        expect(rMgr.mapped()).toEqual({ user_id: mgr, role: 'MANAGER' })
    })

    it('Testshop ผู้ใช้ปกติ (non-Master) พิมพ์ demo → 🔒 mapping ไม่เปลี่ยน', async () => {
        const [emp] = seed('Testshop', [['X', 'USER']])
        const { replies, say, mapped } = rig('Testshop', emp, 'USER')
        await say('demo')
        expect(replies.at(-1).text).toBe('🔒 โหมด demo ใช้ได้เฉพาะ Master ครับ')
        expect(mapped()).toEqual({ user_id: emp, role: 'USER' })
    })

    it('ร้านอื่นที่บังเอิญมีรหัส EMP-TEST/MGR-TEST (non-Master) พิมพ์ demo → 🔒 mapping ไม่เปลี่ยน', async () => {
        const t = 'tenant_sw_' + generateId().slice(0, 8)
        const [emp, mgr] = seed(t, [['E', 'USER'], ['M', 'MANAGER']])
        setCode(emp, 'EMP-TEST'); setCode(mgr, 'MGR-TEST')
        const { replies, say, mapped } = rig(t, emp, 'USER')
        await say('demo')
        expect(replies.at(-1).text).toBe('🔒 โหมด demo ใช้ได้เฉพาะ Master ครับ')
        expect(mapped()).toEqual({ user_id: emp, role: 'USER' })
    })

    it('non-Master ที่ผูก EMP-TEST ปลอม postback action=demo_role&role=MANAGER|USER|off → 🔒 mapping ไม่เปลี่ยน ไม่มีแถว line_master_links ไม่ sync เมนู', async () => {
        if (db.prepare(`SELECT 1 FROM employees WHERE tenant_id = 'Testshop' AND code IN ('EMP-TEST','MGR-TEST')`).get()) return
        const [emp, mgr] = seed('Testshop', [['E', 'USER'], ['M', 'MANAGER']])
        setCode(emp, 'EMP-TEST'); setCode(mgr, 'MGR-TEST')
        const { u, replies, sync, press, mapped } = rig('Testshop', emp, 'USER')
        for (const role of ['MANAGER', 'USER', 'off']) {
            await press(`action=demo_role&role=${role}`)
            expect(replies.at(-1).text).toContain('🔒')
            expect(mapped()).toEqual({ user_id: emp, role: 'USER' })
            expect(db.prepare('SELECT 1 FROM line_master_links WHERE line_user_id = ?').get(u)).toBeUndefined()
            expect(sync).not.toHaveBeenCalled()
        }
    })

    it('พิมพ์ demo ในกลุ่ม → ตอบว่าใช้ได้ในแชทส่วนตัวเท่านั้น และ mapping ไม่เปลี่ยน', async () => {
        const [emp] = seed('Testshop', [['G', 'USER']])
        const { replies, sayInGroup, mapped } = rig('Testshop', emp, 'USER')
        await sayInGroup('demo')
        expect(replies.at(-1).text).toContain('แชทส่วนตัว')
        expect(mapped()).toEqual({ user_id: emp, role: 'USER' })
    })
})
