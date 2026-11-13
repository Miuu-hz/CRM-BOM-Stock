import { describe, it, expect, vi, afterEach } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { createTestUser } from '../test/testAuth'
import { lineBotService } from './line-bot.service'
import { flexTemplates } from './line-flex-templates'

/** ปุ่มอนุมัติ/ไม่อนุมัติบนการ์ด LINE — เฉพาะคำขอ HR, แชทส่วนตัว, สิทธิ์ตามด่านเดียวกับหน้าเว็บ */
const tenants: string[] = []
afterEach(() => {
    vi.restoreAllMocks()
    for (const t of tenants.splice(0)) for (const tb of ['approval_logs', 'approval_requests', 'leave_requests', 'leave_types', 'employees', 'line_user_mappings', 'tenant_subscriptions', 'users'])
        db.prepare(`DELETE FROM ${tb} WHERE tenant_id = ?`).run(t)
})

function setup() {
    const admin = createTestUser({ role: 'ADMIN' }); tenants.push(admin.tenantId)
    const t = admin.tenantId, staff = createTestUser({ role: 'USER', tenantId: t }), now = new Date().toISOString()
    const link = (userId: string) => { const l = 'U' + generateId(); db.prepare(`INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role) VALUES (?, ?, ?, ?, 'USER')`).run(generateId(), t, userId, l); return l }
    const typeId = generateId(), empId = generateId()
    db.prepare(`INSERT INTO leave_types (id, tenant_id, code, name, paid, days_per_year, is_active, created_at) VALUES (?, ?, 'SICK', 'ลาป่วย', 1, 30, 1, ?)`).run(typeId, t, now)
    db.prepare(`INSERT INTO employees (id, tenant_id, code, first_name, last_name, employment_type, base_wage, start_date, status, user_id, created_at, updated_at)
        VALUES (?, ?, ?, 'ส', 'ด', 'MONTHLY', 15000, '2026-01-01', 'ACTIVE', ?, ?, ?)`).run(empId, t, 'E' + empId.slice(0, 6), staff.userId, now, now)
    const request = (module = 'leave') => {
        const leaveId = generateId(), id = generateId()
        db.prepare(`INSERT INTO leave_requests (id, tenant_id, employee_id, leave_type_id, start_date, end_date, days, reason, status, approval_request_id, requested_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, '2026-11-03', '2026-11-03', 1, 'ป่วย', 'PENDING', ?, ?, ?, ?)`).run(leaveId, t, empId, typeId, id, staff.userId, now, now)
        db.prepare(`INSERT INTO approval_requests (id, tenant_id, request_number, module_type, reference_type, reference_id, requester_id, requester_name, requester_role, amount, description, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'leave_requests', ?, ?, 'x', 'USER', 0, 'ลาป่วย 1 วัน', 'PENDING', ?, ?)`).run(id, t, 'APR-' + id.slice(0, 8), module, leaveId, staff.userId, now, now)
        return { id, leaveId }
    }
    const replies: any[] = []
    vi.spyOn(lineBotService as any, 'getClient').mockReturnValue({ token: 't', replyMessage: async (_t: string, m: any) => { replies.push(m) }, pushMessage: vi.fn() })
    vi.spyOn(lineBotService, 'notifyApprovalDecision').mockResolvedValue(undefined as any)
    const press = async (lineUserId: string, action: string, id: string, source: any = { type: 'user', userId: lineUserId }) => {
        const n = replies.length
        await lineBotService.handleEvent(t, { type: 'postback', replyToken: 'rt', source, postback: { data: `action=${action}&id=${id}` } })
        return JSON.stringify(replies.slice(n))
    }
    const st = (id: string) => (db.prepare('SELECT status FROM approval_requests WHERE id = ?').get(id) as any).status
    return { t, admin, staff, link, request, press, st }
}

describe('LINE: อนุมัติคำขอ HR ในแชท', () => {
    it('การ์ดมีปุ่มอนุมัติเฉพาะหมวด HR', () => {
        const card = (moduleType: string) => JSON.stringify(flexTemplates.approvalRequestCard({ id: 'r1', requestNumber: 'APR-1', moduleType, moduleLabel: 'x', description: 'd', requesterName: 'n', amount: 0 } as any))
        expect(card('leave')).toContain('action=approve_req&id=r1')
        expect(card('purchase_order')).not.toContain('approve_req')
    })

    it('ผู้ดูแลกดอนุมัติ → คำขอและใบลา APPROVED · กดซ้ำได้ข้อความว่าตัดสินแล้ว', async () => {
        const s = setup(), boss = s.link(s.admin.userId), r = s.request()
        expect(await s.press(boss, 'approve_req', r.id)).toContain('อนุมัติแล้ว')
        expect(s.st(r.id)).toBe('EXECUTED')
        expect((db.prepare('SELECT status FROM leave_requests WHERE id = ?').get(r.leaveId) as any).status).toBe('APPROVED')
        expect(await s.press(boss, 'reject_req', r.id)).toContain('ตัดสินไปแล้ว')
        expect(s.st(r.id)).toBe('EXECUTED')
    })

    it('กดไม่อนุมัติ → REJECTED', async () => {
        const s = setup(), r = s.request()
        await s.press(s.link(s.admin.userId), 'reject_req', r.id)
        expect(s.st(r.id)).toBe('REJECTED')
    })

    it('พนักงานไม่มีสิทธิ์ / กลุ่ม / LINE ไม่ได้ผูก / หมวดอื่น / บริษัทอื่น → ยัง PENDING', async () => {
        const other = setup(), theirs = other.request()
        const s = setup(), r = s.request(), me = s.link(s.staff.userId), boss = s.link(s.admin.userId)
        expect(await s.press(me, 'approve_req', r.id)).toContain('❌')
        expect(await s.press(boss, 'approve_req', r.id, { type: 'group', groupId: 'G1', userId: boss })).toBe('[]')
        expect(await s.press('Uunknown', 'approve_req', r.id)).toBe('[]')
        expect(s.st(r.id)).toBe('PENDING')
        const po = s.request('purchase_order')
        expect(await s.press(boss, 'approve_req', po.id)).toContain('อนุมัติในแชทไม่ได้')
        expect(s.st(po.id)).toBe('PENDING')
        expect(await s.press(boss, 'approve_req', theirs.id)).toContain('อนุมัติในแชทไม่ได้')
        expect(other.st(theirs.id)).toBe('PENDING')
    })
})

describe('ด่านแพ็กเกจและเพดาน push', () => {
    it('แพ็กเกจหมดอายุ → คนที่ไม่ใช่ ADMIN กดอนุมัติในแชทไม่ได้ (เหมือนหน้าเว็บ)', async () => {
        const s = setup(), r = s.request(), me = s.link(s.staff.userId)
        db.prepare('DELETE FROM tenant_subscriptions WHERE tenant_id = ?').run(s.t)
        db.prepare(`INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status, current_period_end, packs, addons)
            VALUES (?, ?, 'pro', 'EXPIRED', datetime('now', '-1 days'), '[]', '{}')`).run(generateId(), s.t)
        expect(await s.press(me, 'approve_req', r.id)).toContain('แพ็กเกจหมดอายุ')
        expect(s.st(r.id)).toBe('PENDING')
    })

    it('pushToUser หยุดส่งเมื่อถึงเพดานต่อบริษัทต่อเดือน', async () => {
        const s = setup(), pushMessage = vi.fn()
        s.link(s.staff.userId)
        vi.spyOn(lineBotService as any, 'getClient').mockReturnValue({ pushMessage })
        vi.stubEnv('LINE_BULK_PUSH_CAP', '2')
        try {
            const sent = []
            for (let i = 0; i < 4; i++) sent.push(await lineBotService.pushToUser(s.t, s.staff.userId, 'x'))
            expect(sent).toEqual([true, true, false, false])
            expect(pushMessage).toHaveBeenCalledTimes(2)
            expect(lineBotService.pushQuotaLeft(s.t)).toBe(0)
        } finally { vi.unstubAllEnvs(); db.prepare('DELETE FROM line_push_counts WHERE tenant_id = ?').run(s.t) }
    })
})

describe('pushToUser', () => {
    it('ข้อความตัวอักษรเปล่าถูกห่อเป็น text message', async () => {
        const s = setup(), line = s.link(s.staff.userId), pushMessage = vi.fn()
        vi.spyOn(lineBotService as any, 'getClient').mockReturnValue({ pushMessage })
        expect(await lineBotService.pushToUser(s.t, s.staff.userId, 'สวัสดี')).toBe(true)
        expect(pushMessage).toHaveBeenCalledWith(line, { type: 'text', text: 'สวัสดี' })
    })
})
