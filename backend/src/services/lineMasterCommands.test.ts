import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { richMenus } from './line-richmenu.service'
import { flexTemplates } from './line-flex-templates'
import { lineBotService } from './line-bot.service'
import { thaiToday, addDaysStr } from './phopyBoard.service'

const MASTER_EMAIL = 'm@cmd.test'
const prevMaster = process.env.MASTER_BB_USERNAME
const prevCap = process.env.LINE_BULK_PUSH_CAP

const tenants: string[] = []
const lines: string[] = []
const groups: string[] = []

beforeEach(() => {
    process.env.MASTER_BB_USERNAME = MASTER_EMAIL
})

afterEach(() => {
    vi.restoreAllMocks()
    if (prevCap === undefined) delete process.env.LINE_BULK_PUSH_CAP
    else process.env.LINE_BULK_PUSH_CAP = prevCap

    for (const g of groups.splice(0)) {
        db.prepare('DELETE FROM line_group_mappings WHERE group_id = ?').run(g)
        db.prepare('DELETE FROM line_master_alerts WHERE key LIKE ?').run(`%${g}%`)
    }
    for (const t of tenants.splice(0)) {
        for (const tb of [
            'pos_payments', 'pos_running_bills', 'journal_lines', 'journal_entries', 'accounts',
            'line_group_mappings', 'line_user_mappings', 'line_link_tokens', 'line_master_notify',
            'line_push_counts', 'users', 'company_settings',
        ]) {
            try { db.prepare(`DELETE FROM ${tb} WHERE tenant_id = ?`).run(t) } catch {}
        }
        db.prepare('DELETE FROM line_master_alerts WHERE key LIKE ?').run(`%${t}%`)
    }
    for (const l of lines.splice(0)) {
        for (const tb of ['line_master_links', 'line_master_notify', 'line_user_mappings']) {
            db.prepare(`DELETE FROM ${tb} WHERE line_user_id = ?`).run(l)
        }
    }
})

afterAll(() => {
    if (prevMaster === undefined) delete process.env.MASTER_BB_USERNAME
    else process.env.MASTER_BB_USERNAME = prevMaster
})

function rig(opts: {
    memberCount?: number | (() => Promise<number>)
    quota?: { type: string; value?: number }
    used?: number
} = {}) {
    const replies: any[] = []
    const push = vi.fn(async (_to: string, _m: any) => {})
    const getGroupMembersCount = vi.fn(async (_gid: string) => {
        if (typeof opts.memberCount === 'function') return opts.memberCount()
        if (opts.memberCount !== undefined) return opts.memberCount
        return 5
    })
    const getRoomMembersCount = vi.fn(async (rid: string) => getGroupMembersCount(rid))
    const client: any = {
        token: 't',
        replyMessage: async (_t: string, m: any) => { replies.push(m) },
        pushMessage: push,
        getGroupMembersCount,
        getRoomMembersCount,
    }
    if (opts.quota) {
        client.getMessageQuota = vi.fn(async () => opts.quota)
        client.getMessageQuotaConsumption = vi.fn(async () => ({ totalUsage: opts.used ?? 0 }))
    }
    vi.spyOn(lineBotService as any, 'getClient').mockReturnValue(client)
    const syncSpy = vi.spyOn(richMenus, 'syncUser').mockResolvedValue()

    const send = async (source: any, text: string) => {
        const n = replies.length
        const event = { replyToken: 'rt', source, type: 'message', message: { type: 'text', text } }
        await lineBotService.handleEvent(lineBotService.resolveTenant(event), event)
        return replies.slice(n)
    }
    const say = (uid: string, text: string) => send({ type: 'user', userId: uid }, text)
    const sayInGroup = (gid: string, uid: string, text: string) => send({ type: 'group', groupId: gid, userId: uid }, text)
    return { replies, push, syncSpy, getGroupMembersCount, say, sayInGroup, client }
}

function company(name: string, fixedTenantId?: string) {
    const tenantId = fixedTenantId ?? ('tenant_mc_' + generateId().slice(0, 8))
    tenants.push(tenantId)
    try { db.prepare('INSERT INTO company_settings (id, tenant_id, name) VALUES (?, ?, ?)').run(generateId(), tenantId, name) }
    catch { db.prepare('INSERT INTO company_settings (tenant_id, name) VALUES (?, ?)').run(tenantId, name) }
    return { tenantId, name }
}

function master(view: string, opts: { demoRole?: string | null; asMember?: number } = {}) {
    const uid = 'U' + generateId()
    lines.push(uid)
    db.prepare('INSERT INTO line_master_links (line_user_id, master_id, view_tenant_id, demo_role, as_member) VALUES (?, ?, ?, ?, ?)')
        .run(uid, `master_${MASTER_EMAIL}`, view, opts.demoRole ?? null, opts.asMember ?? 0)
    return uid
}

function member(tenantId: string, uid: string, role: string) {
    const userId = generateId()
    db.prepare(`INSERT INTO users (id, email, password, name, role, tenant_id, status) VALUES (?, ?, 'x', 'พนักงาน', ?, ?, 'active')`)
        .run(userId, `${userId}@cmd.test`, role, tenantId)
    db.prepare('INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role) VALUES (?, ?, ?, ?, ?)')
        .run(generateId(), tenantId, userId, uid, role)
    return userId
}

function newGroup() {
    const gid = 'C' + generateId().slice(0, 16)
    groups.push(gid)
    return gid
}

function insertPosBill(tenantId: string, amount: number, thaiDate: string, status = 'PAID', method = 'CASH') {
    const billId = generateId()
    const tsUtc = `${thaiDate}T05:00:00Z` // 12:00 เวลาไทย
    db.prepare(`
        INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, subtotal, total_amount, status, opened_at, closed_at)
        VALUES (?, ?, ?, 't', ?, ?, ?, ?, ?)
    `).run(billId, tenantId, 'B-' + billId.slice(0, 6), amount, amount, status, tsUtc, tsUtc)
    if (status === 'PAID') {
        db.prepare(`
            INSERT INTO pos_payments (id, tenant_id, bill_id, payment_method, amount, paid_at, received_by)
            VALUES (?, ?, ?, ?, ?, ?, 'test')
        `).run(generateId(), tenantId, billId, method, amount, tsUtc)
    }
    return billId
}

function insertRevenueJournal(tenantId: string, amount: number, date: string) {
    let acc = db.prepare(`SELECT id FROM accounts WHERE tenant_id = ? AND code = '4101'`).get(tenantId) as any
    if (!acc) {
        const accId = generateId()
        db.prepare(`INSERT INTO accounts (id, tenant_id, code, name, type, category, normal_balance) VALUES (?, ?, '4101', 'รายได้ขาย', 'REVENUE', 'REVENUE', 'CREDIT')`)
            .run(accId, tenantId)
        acc = { id: accId }
    }
    const jeId = generateId()
    db.prepare(`INSERT INTO journal_entries (id, tenant_id, entry_number, date, description, total_debit, total_credit, is_posted) VALUES (?, ?, ?, ?, 'ขาย', ?, ?, 1)`)
        .run(jeId, tenantId, 'JV-' + jeId.slice(0, 6), date, amount, amount)
    db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, debit, credit) VALUES (?, ?, ?, ?, 0, ?)`)
        .run(generateId(), tenantId, jeId, acc.id, amount)
}

describe('LINE Master commands + daily POS group summary', () => {
    it('1. non-master, demo Master และ as_member Master เงียบในกลุ่มทุกคำสั่ง', async () => {
        const { sayInGroup } = rig()
        const A = company('ร้านเอ-' + generateId().slice(0, 4))
        const gid = newGroup()
        const cmds = ['/pos', '/รายได้', `/บริษัท ${A.name}`, `/ผูก pos ${A.name}`, '/เลิกผูก pos', '/คำสั่ง']

        // คนทั่วไปที่ไม่ได้ลงทะเบียน + พนักงาน ADMIN ในบริษัท
        const stranger = 'U' + generateId(); lines.push(stranger)
        const adminUid = 'U' + generateId(); lines.push(adminUid)
        member(A.tenantId, adminUid, 'ADMIN')
        const demoMaster = master(A.tenantId, { demoRole: 'USER' })
        const asMemberMaster = master(A.tenantId, { asMember: 1 })

        for (const uid of [stranger, adminUid, demoMaster, asMemberMaster]) {
            for (const cmd of cmds) {
                const out = await sayInGroup(gid, uid, cmd)
                expect(out, `${uid} typing ${cmd}`).toHaveLength(0)
            }
        }
    })

    it('2. กลุ่มยังไม่ผูกและไม่ระบุบริษัท → ปุ่ม quickReply แบบ message และไม่มียอดเงิน', async () => {
        const { sayInGroup } = rig()
        const A = company('ร้านสุ่มเอ-' + generateId().slice(0, 4))
        insertPosBill(A.tenantId, 4321, thaiToday())
        insertRevenueJournal(A.tenantId, 9876, thaiToday())
        const uid = master(A.tenantId)
        const gid = newGroup()

        for (const cmd of ['/pos', '/รายได้']) {
            const out = await sayInGroup(gid, uid, cmd)
            expect(out).toHaveLength(1)
            const msg = out[0]
            expect(msg.type).toBe('text')
            expect(msg.quickReply?.items?.length).toBeGreaterThan(0)
            expect(msg.quickReply.items.length).toBeLessThanOrEqual(13)
            for (const item of msg.quickReply.items) {
                expect(item.action.type).toBe('message')
                expect(item.action.label.length).toBeLessThanOrEqual(20)
                expect(item.action.text.startsWith(`${cmd} `)).toBe(true)
            }
            const json = JSON.stringify(out)
            expect(json).not.toContain('4,321')
            expect(json).not.toContain('9,876')
        }
    })

    it('3. /pos มีและไม่มีชื่อบริษัท · ค้นด้วยชื่อและ tenant_id (kids/bb) · กลุ่มล็อกปฏิเสธบริษัทอื่น', async () => {
        const { say, sayInGroup } = rig()
        const uniq = generateId().slice(0, 4)
        const kids = company(`Kids House Cafe ${uniq}`, `tenant_bb_pillow_${uniq}`)
        const other = company(`Other Shop ${uniq}`)
        const today = thaiToday()
        insertPosBill(kids.tenantId, 1250, today)
        insertPosBill(other.tenantId, 8888, today)
        const uid = master(kids.tenantId)

        // แชทส่วนตัวไม่ระบุบริษัท → ใช้ view_tenant_id
        const priv = await say(uid, '/pos')
        expect(JSON.stringify(priv)).toContain('1,250')
        expect(JSON.stringify(priv)).toContain(kids.name)

        // กลุ่มยังไม่ผูก ระบุทั้ง "kids" และ "bb" ต้องหา Kids House Cafe เจอ
        const gid = newGroup()
        expect(JSON.stringify(await sayInGroup(gid, uid, `/pos kids house cafe ${uniq}`))).toContain('1,250')
        expect(JSON.stringify(await sayInGroup(gid, uid, `/pos bb_pillow_${uniq}`))).toContain('1,250')

        // ผูกกลุ่มกับ kids แล้วไม่ระบุบริษัท → ได้ยอดของ kids
        await sayInGroup(gid, uid, `/ผูก pos bb_pillow_${uniq}`)
        expect(JSON.stringify(await sayInGroup(gid, uid, '/pos'))).toContain('1,250')

        // คำค้นตรงหลายบริษัทรวมบริษัทของกลุ่ม → ได้ยอดของบริษัทกลุ่มเท่านั้น
        const both = JSON.stringify(await sayInGroup(gid, uid, `/pos ${uniq}`))
        expect(both).toContain('1,250')
        expect(both).not.toContain('8,888')

        // กลุ่มล็อกไว้กับ kids → ขอดูบริษัทอื่นต้องถูกปฏิเสธทั้ง /pos และ /รายได้
        const refusePos = JSON.stringify(await sayInGroup(gid, uid, `/pos ${other.name}`))
        expect(refusePos).toContain(`🔒 กลุ่มนี้ล็อกไว้กับ ${kids.name}`)
        expect(refusePos).not.toContain('8,888')

        const refuseRev = JSON.stringify(await sayInGroup(gid, uid, `/รายได้ ${other.name}`))
        expect(refuseRev).toContain(`🔒 กลุ่มนี้ล็อกไว้กับ ${kids.name}`)
    })

    it('4. /pos เมื่อวาน ไม่รวมยอดวันนี้ และ title/alt/hero ระบุคำว่า เมื่อวาน', async () => {
        const { say } = rig()
        const A = company('ร้านเมื่อวาน-' + generateId().slice(0, 4))
        const today = thaiToday()
        const yesterday = addDaysStr(today, -1)
        insertPosBill(A.tenantId, 777, yesterday)
        insertPosBill(A.tenantId, 999, today)
        const uid = master(A.tenantId)

        const out = await say(uid, '/pos เมื่อวาน')
        expect(out).toHaveLength(1)
        const card = out[0]
        expect(card.type).toBe('flex')
        expect(card.altText).toContain('เมื่อวาน')
        const json = JSON.stringify(card)
        expect(json).toContain('ยอดขายเมื่อวาน')
        expect(json).toContain('777')
        expect(json).not.toContain('999')
    })

    it('5. /รายได้ แสดงรายได้ตามบัญชี + POS พร้อมหมายเหตุ และไม่มีต้นทุน/กำไร', async () => {
        const { say } = rig()
        const A = company('ร้านรายได้-' + generateId().slice(0, 4))
        const today = thaiToday()
        insertPosBill(A.tenantId, 1200, today)
        insertRevenueJournal(A.tenantId, 5400, today)
        const uid = master(A.tenantId)

        const out = await say(uid, '/รายได้')
        expect(out).toHaveLength(1)
        const json = JSON.stringify(out[0])
        expect(json).toContain('5,400')
        expect(json).toContain('1,200')
        expect(json).toContain('POS รวมอยู่ในรายได้แล้ว ไม่ต้องบวกกัน')
        expect(json).not.toContain('กำไร')
        expect(json).not.toContain('ขาดทุน')
        expect(json).not.toContain('ต้นทุน')
        expect(json).not.toContain('ค่าใช้จ่าย')
    })

    it('6. /ผูก pos (ขณะดูบริษัทอื่น), ย้ายกลุ่ม, /เลิกผูก pos, และปฏิเสธในแชทส่วนตัว', async () => {
        process.env.LINE_BULK_PUSH_CAP = '100'
        const { say, sayInGroup } = rig({ memberCount: 5 })
        const A = company('ร้านผูกเอ-' + generateId().slice(0, 4))
        const B = company('ร้านผูกบี-' + generateId().slice(0, 4))
        const uid = master(A.tenantId) // กำลังดู A อยู่
        const gid = newGroup()

        // แชทส่วนตัวต้องปฏิเสธ
        expect(JSON.stringify(await say(uid, `/ผูก pos ${B.name}`))).toContain('ใช้ได้ในกลุ่มเท่านั้น')
        expect(JSON.stringify(await say(uid, '/เลิกผูก pos'))).toContain('ใช้ได้ในกลุ่มเท่านั้น')

        // ผูกกลุ่มกับ B ทั้งที่ Master ดู A อยู่ (สมาชิก 5 → 150 > cap 100 → มีคำเตือน)
        const bindOut = JSON.stringify(await sayInGroup(gid, uid, `/ผูกpos ${B.name}`))
        expect(bindOut).toContain(B.name)
        expect(bindOut).toContain('09:00')
        expect(bindOut).toContain('150')
        expect(bindOut).toContain('⚠️')

        const rowB = db.prepare('SELECT is_active, pos_daily FROM line_group_mappings WHERE tenant_id = ? AND group_id = ?').get(B.tenantId, gid) as any
        expect(rowB).toEqual({ is_active: 1, pos_daily: 1 })
        const notifyB = db.prepare(`SELECT 1 FROM line_master_notify WHERE line_user_id = ? AND tenant_id = ? AND kind = 'daily'`).get(uid, B.tenantId)
        expect(notifyB).toBeTruthy()

        // ย้ายกลุ่มจาก B → A
        const moveOut = JSON.stringify(await sayInGroup(gid, uid, `/ผูก pos ${A.name}`))
        expect(moveOut).toContain(A.name)
        expect(moveOut).toContain(B.name)
        expect(db.prepare('SELECT is_active, pos_daily FROM line_group_mappings WHERE tenant_id = ? AND group_id = ?').get(B.tenantId, gid))
            .toEqual({ is_active: 0, pos_daily: 0 })
        expect(db.prepare('SELECT is_active, pos_daily FROM line_group_mappings WHERE tenant_id = ? AND group_id = ?').get(A.tenantId, gid))
            .toEqual({ is_active: 1, pos_daily: 1 })

        // เลิกผูก pos → ปิดทั้ง is_active และ pos_daily แต่ไม่ลบแถว daily ของ Master เอง
        const unbindOut = JSON.stringify(await sayInGroup(gid, uid, '/เลิกผูกpos'))
        expect(unbindOut).toContain('แจ้งเตือน')
        expect(db.prepare('SELECT is_active, pos_daily FROM line_group_mappings WHERE tenant_id = ? AND group_id = ?').get(A.tenantId, gid))
            .toEqual({ is_active: 0, pos_daily: 0 })
        expect(db.prepare(`SELECT 1 FROM line_master_notify WHERE line_user_id = ? AND tenant_id = ? AND kind = 'daily'`).get(uid, A.tenantId))
            .toBeTruthy()
    })

    it('7. /ผูก pos เมื่อดึงจำนวนสมาชิกไม่สำเร็จ ยังผูกได้และแจ้งว่าไม่ทราบจำนวน', async () => {
        const { sayInGroup } = rig({ memberCount: async () => { throw new Error('network') } })
        const A = company('ร้านนับไม่ได้-' + generateId().slice(0, 4))
        const uid = master(A.tenantId)
        const gid = newGroup()

        const out = JSON.stringify(await sayInGroup(gid, uid, `/ผูก pos ${A.name}`))
        expect(out).toContain(A.name)
        expect(out).toContain('ไม่ทราบจำนวนสมาชิก')
        expect(db.prepare('SELECT is_active, pos_daily FROM line_group_mappings WHERE tenant_id = ? AND group_id = ?').get(A.tenantId, gid))
            .toEqual({ is_active: 1, pos_daily: 1 })
    })

    it('8. /บริษัท 0/1/หลายบริษัท (ชื่อตรงเป๊ะชนะ LIKE) + escape % และ _', async () => {
        const { say, syncSpy } = rig()
        const tag = generateId().slice(0, 5)
        const c1 = company(`Alpha_${tag}`)
        const c2 = company(`Alpha_${tag} Extra`)
        const c3 = company(`BetaX${tag}`)
        const uid = master(c1.tenantId)

        // 0 match
        expect(JSON.stringify(await say(uid, `/บริษัท ไม่มีชื่อนี้_${tag}`))).toContain('ไม่พบบริษัท')

        // % และ _ ต้องถูก escape ไม่ match ทุกบริษัท (_ ต้องไม่จับคู่ตัวอักษร X ของ c3)
        expect(JSON.stringify(await say(uid, '/บริษัท %'))).toContain('ไม่พบบริษัท')
        expect(JSON.stringify(await say(uid, `/บริษัท Beta_${tag}`))).toContain('ไม่พบบริษัท')

        // >1 match → quickReply message buttons
        const many = await say(uid, `/บริษัท Alpha_${tag.slice(0, -1)}`)
        expect(many[0].quickReply.items).toHaveLength(2)
        expect(many[0].quickReply.items[0].action.type).toBe('message')

        // exact full-name match wins over LIKE matches
        const exactOut = await say(uid, `/บริษัท ${c1.name}`)
        expect(JSON.stringify(exactOut)).toContain(c1.name)
        expect((db.prepare('SELECT view_tenant_id FROM line_master_links WHERE line_user_id = ?').get(uid) as any).view_tenant_id).toBe(c1.tenantId)

        // 1 match → สลับไป c2 (และ c3) แล้วเรียก richMenus.syncUser
        syncSpy.mockClear()
        await say(uid, `/บริษัท ${c2.name}`)
        expect((db.prepare('SELECT view_tenant_id FROM line_master_links WHERE line_user_id = ?').get(uid) as any).view_tenant_id).toBe(c2.tenantId)
        expect(syncSpy).toHaveBeenCalled()
        await say(uid, `/บริษัท ${c3.name}`)
        expect((db.prepare('SELECT view_tenant_id FROM line_master_links WHERE line_user_id = ?').get(uid) as any).view_tenant_id).toBe(c3.tenantId)
    })

    it('9. ใบสั่งผลิตและ PR ไม่ push เข้ากลุ่มอีกต่อไป · /คำสั่ง และ helpCard exec', async () => {
        const { push, say } = rig()
        const A = company('ร้านผลิต-' + generateId().slice(0, 4))
        const gid = newGroup()
        const uid = master(A.tenantId)
        db.prepare('INSERT INTO line_group_mappings (id, tenant_id, group_id, is_active, pos_daily) VALUES (?, ?, ?, 1, 1)')
            .run(generateId(), A.tenantId, gid)

        await lineBotService.notifyWorkOrderCreated(A.tenantId, { wo_number: 'WO-1', product_name: 'หมอน', quantity: 10, created_at: new Date().toISOString() })
        await lineBotService.notifyWorkOrderStatusChanged(A.tenantId, { wo_number: 'WO-1', product_name: 'หมอน', quantity: 10, status: 'COMPLETED' })
        await lineBotService.notifyPRStatus(A.tenantId, {
            id: 'pr1', prNumber: 'PR-1', supplierName: 'ซัพ', status: 'APPROVED', approverName: 'แอดมิน', sourceGroupId: gid,
        })
        expect(push.mock.calls.map((c: any[]) => c[0])).not.toContain(gid)

        const cmdText = JSON.stringify(await say(uid, '/คำสั่ง'))
        expect(cmdText).toContain('/pos')
        expect(cmdText).toContain('/รายได้')
        expect(cmdText).toContain('/ผูก pos')
        expect(cmdText).toContain('/เลิกผูก pos')

        const help = JSON.stringify(flexTemplates.helpCard('exec'))
        expect(help).toContain('/คำสั่ง')
        expect(help).toContain('คำสั่ง Master')
    })

    it('10. sendExecDigests กลุ่ม POS: วันละครั้ง, คิดโควตาตามสมาชิก, กลุ่มรหัส 6 หลักไม่ได้, วันว่างข้าม, เกินเพดานเตือน Master ครั้งเดียว', async () => {
        process.env.LINE_BULK_PUSH_CAP = '10'
        const today = thaiToday()
        const yesterday = addDaysStr(today, -1)

        // ร้าน A: มีกลุ่ม pos_daily=1 (สมาชิก 4) + กลุ่มผูกด้วยรหัส 6 หลัก (pos_daily=0) ไม่มีผู้รับรายคน
        const A = company('ร้านส่งกลุ่มเอ-' + generateId().slice(0, 4))
        const gidDaily = newGroup()
        const gidCode = newGroup()
        const mUid = master(A.tenantId)
        insertPosBill(A.tenantId, 2500, yesterday)
        db.prepare('INSERT INTO line_group_mappings (id, tenant_id, group_id, is_active, pos_daily) VALUES (?, ?, ?, 1, 1)').run(generateId(), A.tenantId, gidDaily)
        db.prepare('INSERT INTO line_group_mappings (id, tenant_id, group_id, is_active, pos_daily) VALUES (?, ?, ?, 1, 0)').run(generateId(), A.tenantId, gidCode)

        // ร้าน B: ไม่มีบิลเมื่อวานเลย → ข้าม
        const B = company('ร้านวันว่าง-' + generateId().slice(0, 4))
        const gidEmpty = newGroup()
        db.prepare('INSERT INTO line_group_mappings (id, tenant_id, group_id, is_active, pos_daily) VALUES (?, ?, ?, 1, 1)').run(generateId(), B.tenantId, gidEmpty)

        // ร้าน C: สมาชิก 12 > cap 10 (insert แรกต้องไม่ทะลุ cap) → ข้าม + เตือน Master ครั้งเดียว
        const C = company('ร้านเกินเพดาน-' + generateId().slice(0, 4))
        const gidOver1 = newGroup()
        const gidOver2 = newGroup()
        insertPosBill(C.tenantId, 900, yesterday)
        db.prepare('INSERT INTO line_group_mappings (id, tenant_id, group_id, is_active, pos_daily) VALUES (?, ?, ?, 1, 1)').run(generateId(), C.tenantId, gidOver1)
        db.prepare('INSERT INTO line_group_mappings (id, tenant_id, group_id, is_active, pos_daily) VALUES (?, ?, ?, 1, 1)').run(generateId(), C.tenantId, gidOver2)

        const { push, getGroupMembersCount, sayInGroup } = rig()
        getGroupMembersCount.mockImplementation(async (gid: string) => (gid === gidOver1 || gid === gidOver2) ? 12 : 4)

        await lineBotService.sendExecDigests(today)

        const targets = push.mock.calls.map((c: any[]) => c[0])
        expect(targets.filter(t => t === gidDaily)).toHaveLength(1)
        expect(targets).not.toContain(gidCode)
        expect(targets).not.toContain(gidEmpty)
        expect(targets).not.toContain(gidOver1)
        expect(targets).not.toContain(gidOver2)

        // โควตา A หัก 4 (ตามจำนวนสมาชิก) · โควตา C ไม่ถูกหัก (insert แรกเกิน cap ต้องปฏิเสธ)
        const cntA = db.prepare('SELECT n FROM line_push_counts WHERE tenant_id = ? AND month = ?').get(A.tenantId, today.slice(0, 7)) as any
        expect(cntA?.n).toBe(4)
        const cntC = db.prepare('SELECT n FROM line_push_counts WHERE tenant_id = ? AND month = ?').get(C.tenantId, today.slice(0, 7)) as any
        expect(cntC).toBeUndefined()

        // Master ได้รับข้อความเตือนเกินเพดานของร้าน C แค่ครั้งเดียว (แม้มี 2 กลุ่มที่โดนปฏิเสธ)
        const alertsToMaster = push.mock.calls.filter((c: any[]) => c[0] === mUid && String(c[1]?.text ?? '').includes(C.name))
        expect(alertsToMaster).toHaveLength(1)

        // เรียกซ้ำวันเดียวกัน → ไม่ส่งซ้ำ
        push.mockClear()
        await lineBotService.sendExecDigests(today)
        expect(push.mock.calls.filter((c: any[]) => c[0] === gidDaily)).toHaveLength(0)

        // leave รีเซ็ต pos_daily=0 และผูกใหม่ด้วยรหัส 6 หลักต้องไม่คืนชีพ pos_daily=1
        await lineBotService.handleEvent(A.tenantId, { type: 'leave', source: { type: 'group', groupId: gidDaily } })
        expect(db.prepare('SELECT is_active, pos_daily FROM line_group_mappings WHERE tenant_id = ? AND group_id = ?').get(A.tenantId, gidDaily))
            .toEqual({ is_active: 0, pos_daily: 0 })

        const adminId = member(A.tenantId, 'U_adm_' + generateId(), 'ADMIN')
        const tok = lineBotService.generateLinkToken(A.tenantId, adminId)
        const linkReplies = await sayInGroup(gidDaily, 'U_adm_x', tok)
        expect(db.prepare('SELECT is_active, pos_daily FROM line_group_mappings WHERE tenant_id = ? AND group_id = ?').get(A.tenantId, gidDaily))
            .toEqual({ is_active: 1, pos_daily: 0 })
        expect(linkReplies[0]?.text).toContain(`✅ ผูกกลุ่มนี้กับ ${A.name} แล้ว`)
        expect(linkReplies[0]?.text).toContain('/ผูก pos')
    })

    it('11. sendExecDigests ข้ามกลุ่มเมื่อโควตา LINE OA (limited) ไม่พอ และเตือน Master ครั้งเดียว', async () => {
        const today = thaiToday()
        const yesterday = addDaysStr(today, -1)
        const A = company('ร้านโควตาOA-' + generateId().slice(0, 4))
        const gid = newGroup()
        const mUid = master(A.tenantId)
        insertPosBill(A.tenantId, 1500, yesterday)
        db.prepare('INSERT INTO line_group_mappings (id, tenant_id, group_id, is_active, pos_daily) VALUES (?, ?, ?, 1, 1)').run(generateId(), A.tenantId, gid)

        const { push } = rig({ memberCount: 6, quota: { type: 'limited', value: 300 }, used: 296 })
        await lineBotService.sendExecDigests(today)

        expect(push.mock.calls.map((c: any[]) => c[0])).not.toContain(gid)
        const alerts = push.mock.calls.filter((c: any[]) => c[0] === mUid && String(c[1]?.text ?? '').includes(A.name))
        expect(alerts).toHaveLength(1)
    })
})
