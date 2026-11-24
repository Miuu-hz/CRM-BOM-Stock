import { describe, it, expect, vi, afterEach } from 'vitest'
import db from '../db/sqlite'
import { runMigrations } from '../db/migrations'
import { generateId } from '../utils/id'
import { richMenus } from './line-richmenu.service'
import { flexTemplates } from './line-flex-templates'
import { lineBotService, runMasterDailyAlerts } from './line-bot.service'

/** LINE ของ Master "ลอย": ไม่ผูกบริษัท เห็นได้ทุกบริษัท และไม่ได้แจ้งเตือนของบริษัทถ้าไม่เปิดเอง */
// masterLink เช็คกับรายชื่อ Master ใน .env → ให้ไฟล์นี้ใช้ Master ทดสอบคนเดียว
const MASTER_EMAIL = 'm@float.test'
process.env.MASTER_BB_USERNAME = MASTER_EMAIL
const tenants: string[] = []
const lines: string[] = []
const testshopEmpIds: string[] = []
afterEach(() => {
    vi.restoreAllMocks()
    for (const t of tenants.splice(0)) for (const tb of ['line_user_mappings', 'line_link_tokens', 'users', 'company_settings', 'line_master_notify', 'tenant_subscriptions'])
        db.prepare(`DELETE FROM ${tb} WHERE tenant_id = ?`).run(t)
    for (const l of lines.splice(0)) for (const tb of ['line_master_links', 'line_master_notify', 'line_user_mappings'])
        db.prepare(`DELETE FROM ${tb} WHERE line_user_id = ?`).run(l)
    for (const id of testshopEmpIds.splice(0)) db.prepare('DELETE FROM employees WHERE id = ?').run(id)
    db.prepare(`DELETE FROM users WHERE tenant_id = 'Testshop' AND email LIKE '%@float.test'`).run()
})

function rig() {
    const replies: any[] = []
    const push = vi.fn(async (_to: string, _m: any) => {})
    vi.spyOn(lineBotService as any, 'getClient').mockReturnValue({ token: 't', replyMessage: async (_t: string, m: any) => { replies.push(m) }, pushMessage: push })
    const sync = vi.spyOn(richMenus, 'syncUser').mockResolvedValue()
    const send = async (uid: string, ev: any) => {
        const n = replies.length, event = { replyToken: 'rt', source: { type: 'user', userId: uid }, ...ev }
        await lineBotService.handleEvent(lineBotService.resolveTenant(event), event)
        return JSON.stringify(replies.slice(n))
    }
    const say = (uid: string, text: string) => send(uid, { type: 'message', message: { type: 'text', text } })
    const press = (uid: string, data: string) => send(uid, { type: 'postback', postback: { data } })
    return { replies, push, sync, say, press }
}

function company(label: string) {
    const tenantId = 'tenant_mf_' + generateId().slice(0, 8); tenants.push(tenantId)
    const name = `ร้าน${label}-${tenantId.slice(-6)}`
    try { db.prepare('INSERT INTO company_settings (id, tenant_id, name) VALUES (?, ?, ?)').run(generateId(), tenantId, name) }
    catch { db.prepare('INSERT INTO company_settings (tenant_id, name) VALUES (?, ?)').run(tenantId, name) }
    return { tenantId, name }
}

function master(view: string, _label = '') {
    const uid = 'U' + generateId(); lines.push(uid)
    db.prepare('INSERT INTO line_master_links (line_user_id, master_id, view_tenant_id) VALUES (?, ?, ?)').run(uid, `master_${MASTER_EMAIL}`, view)
    return uid
}

/** แถว mapping ปกติ (ผูกกับ users จริง) */
function member(tenantId: string, uid: string, role: string) {
    const userId = generateId()
    db.prepare(`INSERT INTO users (id, email, password, name, role, tenant_id, status) VALUES (?, ?, 'x', 'ทดสอบ', ?, ?, 'active')`).run(userId, `${userId}@float.test`, role, tenantId)
    db.prepare('INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role) VALUES (?, ?, ?, ?, ?)').run(generateId(), tenantId, userId, uid, role)
    return userId
}

function linkTestshop(uid: string, userId: string, role: string) {
    db.prepare(`INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role) VALUES (?, 'Testshop', ?, ?, ?)`).run(generateId(), userId, uid, role)
}

function seedTestshopTestAccounts(opts?: { mgrRole?: string; mgrEmpStatus?: string; mgrUserStatus?: string }) {
    if (db.prepare("SELECT 1 FROM employees WHERE tenant_id = 'Testshop' AND code IN ('EMP-TEST','MGR-TEST')").get()) return null
    const empUserId = generateId(), mgrUserId = generateId(), empId = generateId(), mgrEmpId = generateId()
    db.prepare(`INSERT INTO users (id, email, password, name, role, tenant_id, status) VALUES (?, ?, 'x', 'พนักงานทดสอบ', 'USER', 'Testshop', 'active')`)
        .run(empUserId, `${empUserId}@float.test`)
    db.prepare(`INSERT INTO employees (id, tenant_id, code, first_name, employment_type, base_wage, start_date, status, user_id) VALUES (?, 'Testshop', 'EMP-TEST', 'พนักงานทดสอบ', 'MONTHLY', 0, '2026-01-01', 'ACTIVE', ?)`)
        .run(empId, empUserId)
    db.prepare(`INSERT INTO users (id, email, password, name, role, tenant_id, status) VALUES (?, ?, 'x', 'ผู้จัดการทดสอบ', ?, 'Testshop', ?)`)
        .run(mgrUserId, `${mgrUserId}@float.test`, opts?.mgrRole ?? 'MANAGER', opts?.mgrUserStatus ?? 'active')
    db.prepare(`INSERT INTO employees (id, tenant_id, code, first_name, employment_type, base_wage, start_date, status, user_id) VALUES (?, 'Testshop', 'MGR-TEST', 'ผู้จัดการทดสอบ', 'MONTHLY', 0, '2026-01-01', ?, ?)`)
        .run(mgrEmpId, opts?.mgrEmpStatus ?? 'ACTIVE', mgrUserId)
    testshopEmpIds.push(empId, mgrEmpId)
    return { empUserId, mgrUserId }
}

const link = (uid: string) => db.prepare('SELECT * FROM line_master_links WHERE line_user_id = ?').get(uid) as any
const mappings = (uid: string) => db.prepare('SELECT * FROM line_user_mappings WHERE line_user_id = ?').all(uid) as any[]

describe('LINE Master ลอย', () => {
    it('1. migration ย้ายแถว master_* จาก line_user_mappings ไป line_master_links (รันซ้ำได้)', () => {
        const A = company('เอ'), uid = 'U' + generateId(); lines.push(uid)
        const mid = `master_mig${uid.slice(-6)}@float.test`
        db.prepare('INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role, demo_role) VALUES (?, ?, ?, ?, ?, ?)').run(generateId(), A.tenantId, mid, uid, 'MASTER', 'USER')
        runMigrations(db)
        runMigrations(db)
        expect(mappings(uid)).toHaveLength(0)
        expect(link(uid)).toMatchObject({ master_id: mid, view_tenant_id: A.tenantId, demo_role: 'USER', as_member: 0 })
    })

    it('2. ผูกด้วยรหัสของ master → line_master_links ไม่ใช่ line_user_mappings', async () => {
        const { say } = rig(), A = company('เอ'), uid = 'U' + generateId(); lines.push(uid)
        const mid = `master_lnk${uid.slice(-6)}@float.test`
        await say(uid, lineBotService.generateLinkToken(A.tenantId, mid))
        expect(link(uid)).toMatchObject({ master_id: mid, view_tenant_id: A.tenantId, as_member: 0, demo_role: null })
        expect(mappings(uid)).toHaveLength(0)
    })

    it('3. อยู่บริษัท A และมีบัญชี USER ใน Testshop → ยังอยู่ A · demo ได้ 5 ปุ่ม', async () => {
        const { say } = rig(), A = company('เอ'), uid = master(A.tenantId)
        member('Testshop', uid, 'USER')
        expect(lineBotService.resolveTenant({ source: { type: 'user', userId: uid } })).toBe(A.tenantId)
        expect(JSON.parse(await say(uid, 'demo'))[0].quickReply.items).toHaveLength(5)
    })

    it('4. switch_tenant ไปบริษัทใดก็ได้ที่มีจริง (ไม่มี mapping) · ไม่มีจริง = ไม่ทำอะไร', async () => {
        const { say, press } = rig(), A = company('เอ'), B = company('บี'), uid = master(A.tenantId)
        expect(await press(uid, `action=switch_tenant&id=${encodeURIComponent(B.tenantId)}`)).toContain(B.name)
        expect(link(uid).view_tenant_id).toBe(B.tenantId)
        const out = await say(uid, 'ยอดขายวันนี้')
        expect(out).not.toContain('🔒'); expect(out).not.toContain('ยังไม่ได้เชื่อม'); expect(out).toContain(B.name)

        await press(uid, 'action=switch_tenant&id=tenant_ไม่มีจริง')
        expect(link(uid).view_tenant_id).toBe(B.tenantId)
    })

    it('5. คนที่ไม่ใช่ master มี mapping แค่ A → สลับไป B ไม่ได้', async () => {
        const { press } = rig(), A = company('เอ'), B = company('บี'), uid = 'U' + generateId(); lines.push(uid)
        member(A.tenantId, uid, 'ADMIN')
        const out = await press(uid, `action=switch_tenant&id=${encodeURIComponent(B.tenantId)}`)
        expect(out).toContain('❌')
        expect(lineBotService.resolveTenant({ source: { type: 'user', userId: uid } })).toBe(A.tenantId)
    })

    it('6. แจ้งเตือนปิดกะ: ปิดเป็นค่าเริ่มต้น · เปิดเฉพาะบริษัทที่เลือก', async () => {
        const { push, say, press } = rig(), A = company('เอ'), B = company('บี'), uid = master(A.tenantId)
        vi.spyOn(flexTemplates as any, 'shiftCloseCard').mockReturnValue({ type: 'text', text: 'สรุปปิดกะ' })
        const pushed = () => push.mock.calls.map((c: any[]) => c[0])

        await lineBotService.notifyShiftClosed(A.tenantId, { shiftNumber: 'S1' })
        expect(pushed()).not.toContain(uid)

        const list = await say(uid, 'แจ้งเตือน')
        expect(list).toContain('action=master_notify&kind=shift'); expect(list).toContain('⬜ ปิดกะ')
        expect(await press(uid, 'action=master_notify&kind=shift')).toContain('✅ ปิดกะ')

        await lineBotService.notifyShiftClosed(A.tenantId, { shiftNumber: 'S2' })
        expect(pushed()).toContain(uid)
        push.mockClear()
        await lineBotService.notifyShiftClosed(B.tenantId, { shiftNumber: 'S3' })
        expect(pushed()).not.toContain(uid)

        // kind ที่ไม่มีในรายการ → ไม่เพิ่มแถว
        await press(uid, 'action=master_notify&kind=hack')
        expect(db.prepare('SELECT COUNT(*) AS n FROM line_master_notify WHERE line_user_id = ?').get(uid)).toEqual({ n: 1 })
    })

    it('7. demo เปิดเมนู 5 ปุ่ม → เลือก USER เข้าบัญชีทดสอบ Testshop → master กลับเป็น Master ดูบริษัทเดิม', async () => {
        const acc = seedTestshopTestAccounts(); if (!acc) return
        const { sync, say, press } = rig(), A = company('เอ'), uid = master(A.tenantId)
        linkTestshop(uid, acc.empUserId, 'USER')
        const src = { source: { type: 'user', userId: uid } }

        const menu = JSON.parse(await say(uid, 'demo'))
        expect(menu[0].quickReply.items).toHaveLength(5)
        expect(link(uid).as_member).toBe(0)

        const out = await press(uid, 'action=demo_role&role=USER')
        expect(out).toContain('ร้านสาธิต')
        expect(out).toContain('พิมพ์ demo เพื่อเปลี่ยน หรือ master เพื่อกลับ')
        expect(link(uid)).toMatchObject({ as_member: 1, demo_role: null })
        expect(lineBotService.resolveTenant(src)).toBe('Testshop')
        expect(sync).toHaveBeenLastCalledWith('Testshop', 't', uid, 'staff')

        expect(await say(uid, 'master')).toContain('กลับเป็น Master แล้ว')
        expect(link(uid)).toMatchObject({ as_member: 0, demo_role: null })
        expect(lineBotService.resolveTenant(src)).toBe(A.tenantId)
        expect(sync).toHaveBeenLastCalledWith(A.tenantId, 't', uid, 'exec')
    })

    it('8. notifyMasters ส่งถึงทุกลิงก์ · แจ้งแพ็กเกจใกล้หมดครั้งเดียวต่อรอบ', async () => {
        const { push } = rig(), A = company('เอ'), m1 = master(A.tenantId, '1'), m2 = master(A.tenantId, '2')
        await lineBotService.notifyMasters('ทดสอบ')
        const ids = push.mock.calls.map((c: any[]) => c[0])
        expect(ids).toContain(m1); expect(ids).toContain(m2)

        const before = new Set((db.prepare('SELECT key FROM line_master_alerts').all() as any[]).map(r => r.key))
        try {
            const today = new Date().toISOString().slice(0, 10)
            const end = new Date(Date.now() + 3 * 86400000).toISOString()
            db.prepare(`INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status, billing_cycle, current_period_start, current_period_end, packs, addons)
                VALUES (?, ?, 'free', 'ACTIVE', NULL, ?, ?, '[]', '{}')`).run(generateId(), A.tenantId, new Date().toISOString(), end)
            push.mockClear()
            await runMasterDailyAlerts(today)
            const texts = push.mock.calls.filter((c: any[]) => c[0] === m1).map((c: any[]) => (c[1] as any).text as string)
            expect(texts.filter(t => t.includes('⏳') && t.includes(A.name))).toHaveLength(1)

            push.mockClear()
            await runMasterDailyAlerts(today)
            expect(push).not.toHaveBeenCalled()
        } finally {
            for (const r of db.prepare('SELECT key FROM line_master_alerts').all() as any[])
                if (!before.has(r.key)) db.prepare('DELETE FROM line_master_alerts WHERE key = ?').run(r.key)
        }
    })

    it('9. Master ดูบริษัท A กดอนุมัติการ์ดคำขอลาของบริษัท B ได้ · ส่งรูปบิลเข้าบริษัทที่ดูอยู่', () => approveOtherCompany(() => {}))

    it('10. อยู่บัญชีทดสอบ Testshop แล้วกดอนุมัติการ์ดของบริษัท B ได้ในฐานะ Master', () => approveOtherCompany(uid => {
        member('Testshop', uid, 'USER')
        db.prepare('UPDATE line_master_links SET as_member = 1 WHERE line_user_id = ?').run(uid)
    }))

    it('11. อยู่โหมด demo พนักงาน แล้วพิมพ์ master → กลับเป็น Master', async () => {
        const r = rig(), A = company('A'), uid = master(A.tenantId)
        db.prepare("UPDATE line_master_links SET demo_role = 'USER' WHERE line_user_id = ?").run(uid)
        expect(await r.say(uid, 'master')).toContain('กลับเป็น Master')
        expect(link(uid).demo_role).toBeNull()
    })

    it('12. Master ที่ถูกถอดออกจาก .env → LINE ไม่ได้สิทธิ์ Master', async () => {
        const A = company('A'), uid = master(A.tenantId)
        const old = process.env.MASTER_BB_USERNAME
        process.env.MASTER_BB_USERNAME = 'someone-else@float.test'
        try {
            expect((lineBotService as any).masterLink(uid)).toBeUndefined()
            process.env.MASTER_BB_USERNAME = String(link(uid).master_id).slice(7)
            expect((lineBotService as any).masterLink(uid)).toBeTruthy()
        } finally { process.env.MASTER_BB_USERNAME = old }
    })

    it('13. กด USER/MANAGER เข้าบัญชีทดสอบจริง EMP-TEST/MGR-TEST · demo ขณะเป็นบัญชีทดสอบแสดงชื่อบัญชี · ใช้ role จริงจาก users', async () => {
        const acc = seedTestshopTestAccounts(); if (!acc) return
        const { sync, say, press } = rig(), A = company('เอ'), uid = master(A.tenantId)
        linkTestshop(uid, acc.empUserId, 'USER')

        await press(uid, 'action=demo_role&role=USER')
        expect(link(uid)).toMatchObject({ as_member: 1, demo_role: null })
        expect(mappings(uid).find(m => m.tenant_id === 'Testshop')?.user_id).toBe(acc.empUserId)
        expect(sync).toHaveBeenLastCalledWith('Testshop', 't', uid, 'staff')

        for (const cmd of ['demo', '/demo']) {
            const res = JSON.parse(await say(uid, cmd))
            expect(res[0].quickReply.items).toHaveLength(5)
            expect(res[0].text).toContain('พนักงานทดสอบ')
        }

        await press(uid, 'action=demo_role&role=MANAGER')
        expect(link(uid)).toMatchObject({ as_member: 1, demo_role: null })
        expect(mappings(uid).find(m => m.tenant_id === 'Testshop')).toMatchObject({ user_id: acc.mgrUserId, role: 'MANAGER' })
        expect(sync).toHaveBeenLastCalledWith('Testshop', 't', uid, 'manager')

        // role จริงของ MGR-TEST เป็น USER → ต้องบันทึก USER และ sync เมนู staff (ไม่เขียน role จากปุ่ม)
        for (const id of testshopEmpIds.splice(0)) db.prepare('DELETE FROM employees WHERE id = ?').run(id)
        db.prepare(`DELETE FROM line_user_mappings WHERE tenant_id = 'Testshop' AND line_user_id = ?`).run(uid)
        db.prepare(`DELETE FROM users WHERE tenant_id = 'Testshop' AND email LIKE '%@float.test'`).run()
        const acc2 = seedTestshopTestAccounts({ mgrRole: 'USER' }); if (!acc2) return
        linkTestshop(uid, acc2.empUserId, 'USER')
        await press(uid, 'action=demo_role&role=MANAGER')
        expect(mappings(uid).find(m => m.tenant_id === 'Testshop')).toMatchObject({ user_id: acc2.mgrUserId, role: 'USER' })
        expect(sync).toHaveBeenLastCalledWith('Testshop', 't', uid, 'staff')
    })

    it('14. กด ADMIN หรือ off จากบัญชีทดสอบ (as_member=1) → กลับไปดูบริษัทเดิม', async () => {
        const acc = seedTestshopTestAccounts(); if (!acc) return
        const { sync, press } = rig(), A = company('เอ'), uid = master(A.tenantId)
        linkTestshop(uid, acc.empUserId, 'USER')
        const src = { source: { type: 'user', userId: uid } }

        await press(uid, 'action=demo_role&role=USER')
        expect(link(uid).as_member).toBe(1)

        await press(uid, 'action=demo_role&role=ADMIN')
        expect(link(uid)).toMatchObject({ as_member: 0, demo_role: 'ADMIN' })
        expect(lineBotService.resolveTenant(src)).toBe(A.tenantId)
        expect(sync).toHaveBeenLastCalledWith(A.tenantId, 't', uid, 'exec')

        await press(uid, 'action=demo_role&role=USER')
        expect(link(uid).as_member).toBe(1)

        const out = await press(uid, 'action=demo_role&role=off')
        expect(out).toContain('กลับเป็น Master แล้ว')
        expect(out).toContain(A.name)
        expect(link(uid)).toMatchObject({ as_member: 0, demo_role: null })
        expect(lineBotService.resolveTenant(src)).toBe(A.tenantId)
        expect(sync).toHaveBeenLastCalledWith(A.tenantId, 't', uid, 'exec')
    })

    it('15. ไม่มี mapping ใน Testshop → กด USER ตกกลับมาเป็นโหมด demo ดูอย่างเดียว', async () => {
        const { sync, press } = rig(), A = company('เอ'), uid = master(A.tenantId)
        const out = await press(uid, 'action=demo_role&role=USER')
        expect(out).toContain('(โหมด demo)')
        expect(link(uid)).toMatchObject({ as_member: 0, demo_role: 'USER' })
        expect(mappings(uid)).toHaveLength(0)
        expect(sync).toHaveBeenLastCalledWith(A.tenantId, 't', uid, 'staff')
    })

    it('16. MGR-TEST ไม่ active → กด MANAGER ตกกลับมาเป็นโหมด demo และไม่ย้าย mapping', async () => {
        const acc = seedTestshopTestAccounts({ mgrEmpStatus: 'RESIGNED' }); if (!acc) return
        const { sync, press } = rig(), A = company('เอ'), uid = master(A.tenantId)
        linkTestshop(uid, acc.empUserId, 'USER')

        await press(uid, 'action=demo_role&role=USER')
        expect(link(uid).as_member).toBe(1)

        await press(uid, 'action=demo_role&role=MANAGER')
        expect(link(uid)).toMatchObject({ as_member: 0, demo_role: 'MANAGER' })
        expect(mappings(uid).find(m => m.tenant_id === 'Testshop')?.user_id).toBe(acc.empUserId)
        expect(sync).toHaveBeenLastCalledWith(A.tenantId, 't', uid, 'manager')
    })

    it('17. mapping ใน Testshop เป็นบัญชีจริงที่ไม่ใช่บัญชีทดสอบ (ADMIN) → ไม่ย้าย mapping เด็ดขาด', async () => {
        const { press } = rig(), A = company('เอ'), uid = master(A.tenantId)
        const adminUserId = member('Testshop', uid, 'ADMIN')

        await press(uid, 'action=demo_role&role=USER')
        expect(link(uid)).toMatchObject({ as_member: 0, demo_role: 'USER' })
        expect(mappings(uid).find(m => m.tenant_id === 'Testshop')).toMatchObject({ user_id: adminUserId, role: 'ADMIN' })
    })

    it('18. ผู้ใช้ทั่วไปพิมพ์ demo หรือปลอม postback demo_role → ปฏิเสธและไม่เปลี่ยนสิทธิ์', async () => {
        const { say, press } = rig(), A = company('เอ'), uid = 'U' + generateId(); lines.push(uid)
        const userId = member(A.tenantId, uid, 'USER')

        expect(await say(uid, 'demo')).toContain('🔒')
        expect(await press(uid, 'action=demo_role&role=ADMIN')).toContain('🔒')
        expect(await press(uid, 'action=demo_role&role=MANAGER')).toContain('🔒')
        expect(mappings(uid)[0]).toMatchObject({ user_id: userId, role: 'USER', demo_role: null })
    })

    it('19. Master พิมพ์ สลับทดสอบ → ไม่เปิดเมนู demo และไม่แก้ line_master_links/mapping (ไหลไป fallback ปกติ)', async () => {
        const { say } = rig(), A = company('เอ'), uid = master(A.tenantId)
        const testUser = member('Testshop', uid, 'USER')
        const llm = vi.spyOn(lineBotService as any, 'handleLLMFallback').mockResolvedValue(undefined)

        const out = JSON.parse(await say(uid, 'สลับทดสอบ'))
        expect(llm).toHaveBeenCalledTimes(1)
        expect(out).toHaveLength(0)
        expect(link(uid)).toMatchObject({ as_member: 0, demo_role: null })
        expect(mappings(uid).find(m => m.tenant_id === 'Testshop')).toMatchObject({ user_id: testUser, role: 'USER' })
    })

    it('20. MGR-TEST ถูก LINE อื่นผูกอยู่แล้ว → กด MANAGER ตกกลับมาเป็น demo_role view และไม่แก้ mapping ทั้งสองฝั่ง', async () => {
        const acc = seedTestshopTestAccounts(); if (!acc) return
        const { sync, press } = rig(), A = company('เอ'), uid = master(A.tenantId), otherUid = 'U' + generateId(); lines.push(otherUid)
        linkTestshop(uid, acc.empUserId, 'USER')
        linkTestshop(otherUid, acc.mgrUserId, 'MANAGER')

        const out = await press(uid, 'action=demo_role&role=MANAGER')
        expect(out).toContain('(โหมด demo)')
        expect(link(uid)).toMatchObject({ as_member: 0, demo_role: 'MANAGER' })
        expect(mappings(uid).find(m => m.tenant_id === 'Testshop')).toMatchObject({ user_id: acc.empUserId, role: 'USER' })
        expect(mappings(otherUid).find(m => m.tenant_id === 'Testshop')).toMatchObject({ user_id: acc.mgrUserId, role: 'MANAGER' })
        expect(sync).toHaveBeenLastCalledWith(A.tenantId, 't', uid, 'manager')
    })
})

async function approveOtherCompany(prep: (uid: string) => void) {
    {
        const r = rig(), A = company('A'), B = company('B'), uid = master(A.tenantId)
        prep(uid)
        vi.spyOn(lineBotService, 'notifyApprovalDecision').mockResolvedValue(undefined as any)
        const t = B.tenantId, now = new Date().toISOString(), staff = generateId(), typeId = generateId(), empId = generateId(), leaveId = generateId(), id = generateId()
        db.prepare(`INSERT INTO users (id, email, password, name, role, tenant_id, status) VALUES (?, ?, 'x', 'พนักงาน', 'USER', ?, 'active')`).run(staff, `${staff}@float.test`, t)
        db.prepare(`INSERT INTO leave_types (id, tenant_id, code, name, paid, days_per_year, is_active, created_at) VALUES (?, ?, 'SICK', 'ลาป่วย', 1, 30, 1, ?)`).run(typeId, t, now)
        db.prepare(`INSERT INTO employees (id, tenant_id, code, first_name, last_name, employment_type, base_wage, start_date, status, user_id, created_at, updated_at)
            VALUES (?, ?, ?, 'ส', 'ด', 'MONTHLY', 15000, '2026-01-01', 'ACTIVE', ?, ?, ?)`).run(empId, t, 'E' + empId.slice(0, 6), staff, now, now)
        db.prepare(`INSERT INTO leave_requests (id, tenant_id, employee_id, leave_type_id, start_date, end_date, days, reason, status, approval_request_id, requested_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, '2026-11-03', '2026-11-03', 1, 'ป่วย', 'PENDING', ?, ?, ?, ?)`).run(leaveId, t, empId, typeId, id, staff, now, now)
        db.prepare(`INSERT INTO approval_requests (id, tenant_id, request_number, module_type, reference_type, reference_id, requester_id, requester_name, requester_role, amount, description, status, created_at, updated_at)
            VALUES (?, ?, ?, 'leave', 'leave_requests', ?, ?, 'x', 'USER', 0, 'ลาป่วย 1 วัน', 'PENDING', ?, ?)`).run(id, t, 'APR-' + id.slice(0, 8), leaveId, staff, now, now)
        try {
            expect(await r.press(uid, `action=approve_req&id=${id}`)).toContain('อนุมัติแล้ว')
            expect((db.prepare('SELECT status FROM approval_requests WHERE id = ?').get(id) as any).status).toBe('EXECUTED')
        } finally {
            for (const tb of ['approval_logs', 'approval_requests', 'leave_requests', 'leave_types', 'employees']) db.prepare(`DELETE FROM ${tb} WHERE tenant_id = ?`).run(t)
        }
    }
}
