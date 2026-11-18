import { describe, it, expect, vi, afterEach } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { richMenus } from './line-richmenu.service'
import { lineBotService } from './line-bot.service'
import { buildShiftSummary } from './posShiftSummary.service'
import { thaiToday } from './phopyBoard.service'

/** push เข้ากลุ่มนับโควตาตามสมาชิก → เลิก push การ์ดปิดกะเข้ากลุ่ม · กลุ่ม/แชทส่วนตัวพิมพ์ "สรุปการปิดกะ" ดูเองด้วย reply (ฟรี) */
const tenants: string[] = []
afterEach(() => {
    vi.restoreAllMocks()
    for (const t of tenants.splice(0)) for (const tb of ['pos_shifts', 'line_group_mappings', 'line_user_mappings', 'line_push_counts', 'users', 'company_settings'])
        db.prepare(`DELETE FROM ${tb} WHERE tenant_id = ?`).run(t)
})

const HOUR = 3600_000
function insertShift(tenantId: string, no: string, closedAt: Date) {
    const id = generateId()
    const vals: Record<string, any> = {
        id, tenant_id: tenantId, shift_number: no, status: 'CLOSED', opened_at: new Date(closedAt.getTime() - 4 * HOUR).toISOString(),
        closed_at: closedAt.toISOString(), bill_count: 3, total_revenue: 1000, cash_revenue: 600, bank_revenue: 400,
        expected_cash: 600, closing_cash_counted: 600, cash_difference: 0,
    }
    // คอลัมน์ NOT NULL ที่ไม่มีค่าเริ่มต้น (ต่างกันตามรุ่น schema) → เติมค่าว่างให้
    for (const c of db.prepare('PRAGMA table_info(pos_shifts)').all() as any[])
        if (c.notnull && c.dflt_value === null && !c.pk && !(c.name in vals)) vals[c.name] = /INT|REAL|NUM/i.test(c.type) ? 0 : ''
    const cols = Object.keys(vals)
    db.prepare(`INSERT INTO pos_shifts (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map(c => vals[c]))
    return id
}

function setup(o: { groupOn?: boolean; role?: string } = {}) {
    const tenantId = 'tenant_sh_' + generateId().slice(0, 8); tenants.push(tenantId)
    const userId = generateId(), adminLine = 'U' + generateId(), groupId = 'C' + generateId()
    db.prepare(`INSERT INTO users (id, email, password, name, role, tenant_id, status) VALUES (?, ?, 'x', 'ทดสอบ', ?, ?, 'active')`).run(userId, `${userId}@example.com`, o.role ?? 'ADMIN', tenantId)
    try { db.prepare('INSERT INTO company_settings (id, tenant_id, name) VALUES (?, ?, ?)').run(generateId(), tenantId, 'ร้านทดสอบ') }
    catch { db.prepare('INSERT INTO company_settings (tenant_id, name) VALUES (?, ?)').run(tenantId, 'ร้านทดสอบ') }
    db.prepare('UPDATE company_settings SET line_shift_expense_groups = ? WHERE tenant_id = ?').run(o.groupOn ? 1 : 0, tenantId)
    db.prepare(`INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role) VALUES (?, ?, ?, ?, ?)`).run(generateId(), tenantId, userId, adminLine, o.role ?? 'ADMIN')
    db.prepare(`INSERT INTO line_group_mappings (id, tenant_id, group_id, is_active) VALUES (?, ?, ?, 1)`).run(generateId(), tenantId, groupId)

    const replies: any[][] = []
    const pushMessage = vi.fn()
    vi.spyOn(lineBotService as any, 'getClient').mockReturnValue({ token: 't', replyMessage: async (_t: string, m: any) => { replies.push([m].flat()) }, pushMessage })
    vi.spyOn(richMenus, 'syncUser').mockResolvedValue()
    const say = async (text: string, source: any) => {
        const event = { type: 'message', replyToken: 'rt', message: { type: 'text', text }, source }
        await lineBotService.handleEvent(lineBotService.resolveTenant(event), event)
    }
    const group = { type: 'group', groupId, userId: 'U' + generateId() }
    return { tenantId, adminLine, groupId, group, replies, pushMessage, say }
}
const json = (m: any) => JSON.stringify(m)

describe('LINE สรุปปิดกะ', () => {
    it('a) ปิดกะ → ไม่ push เข้ากลุ่ม · admin ยังได้ push และนับโควตา 1', async () => {
        const s = setup({ groupOn: true })
        const id = insertShift(s.tenantId, 'SH-A1', new Date())
        await lineBotService.notifyShiftClosed(s.tenantId, buildShiftSummary(s.tenantId, id))
        expect(s.pushMessage.mock.calls.map(c => c[0])).toEqual([s.adminLine])
        expect(s.pushMessage.mock.calls.some(c => c[0] === s.groupId)).toBe(false)
        const row = db.prepare('SELECT n FROM line_push_counts WHERE tenant_id = ? AND month = ?').get(s.tenantId, thaiToday().slice(0, 7)) as any
        expect(row.n).toBe(1)
    })

    it('b) กลุ่มพิมพ์ สรุปการปิดกะ (เปิดตั้งค่า) → reply การ์ดกะวันนี้ 1 ครั้ง ไม่ push', async () => {
        const s = setup({ groupOn: true })
        insertShift(s.tenantId, 'SH-B1', new Date())
        await s.say('สรุปการปิดกะ', s.group)
        expect(s.replies).toHaveLength(1)
        expect(s.replies[0]).toHaveLength(1)
        expect(s.replies[0][0].type).toBe('flex')
        expect(json(s.replies[0][0])).toContain('SH-B1')
        expect(s.pushMessage).not.toHaveBeenCalled()
    })

    it('c) ปิดตั้งค่า → กลุ่มได้ 🔒 ไม่มีการ์ด', async () => {
        const s = setup({ groupOn: false })
        insertShift(s.tenantId, 'SH-C1', new Date())
        await s.say('สรุปการปิดกะ', s.group)
        expect(s.replies).toHaveLength(1)
        expect(json(s.replies[0])).toContain('🔒')
        expect(s.replies[0].some(m => m.type === 'flex')).toBe(false)
    })

    it('d) แชทส่วนตัว: USER → 🔒 · ADMIN → การ์ด', async () => {
        const u = setup({ role: 'USER' })
        insertShift(u.tenantId, 'SH-D1', new Date())
        await u.say('สรุปปิดกะ', { type: 'user', userId: u.adminLine })
        expect(json(u.replies[0])).toContain('🔒')
        expect(u.replies[0].some(m => m.type === 'flex')).toBe(false)

        const a = setup({ role: 'ADMIN' })
        insertShift(a.tenantId, 'SH-D2', new Date())
        await a.say('ปิดกะ', { type: 'user', userId: a.adminLine })
        expect(a.replies[0][0].type).toBe('flex')
        expect(json(a.replies[0][0])).toContain('SH-D2')
    })

    it('e) กลุ่มที่ยังไม่ผูก → ไม่ตอบเลย', async () => {
        const s = setup({ groupOn: true })
        insertShift(s.tenantId, 'SH-E1', new Date())
        await s.say('สรุปการปิดกะ', { type: 'group', groupId: 'C' + generateId(), userId: 'U' + generateId() })
        expect(s.replies).toHaveLength(0)
        expect(s.pushMessage).not.toHaveBeenCalled()
    })

    it('f) ปิดวันนี้เกิน 5 กะ → 5 ข้อความ: การ์ดใหม่สุด 4 ใบ + ข้อความจำนวนกะ', async () => {
        const s = setup({ groupOn: true })
        const now = Date.now()
        for (let i = 1; i <= 7; i++) insertShift(s.tenantId, `SH-F${i}`, new Date(now - (8 - i) * 1000))
        await s.say('สรุปการปิดกะ', s.group)
        const msgs = s.replies[0]
        expect(msgs).toHaveLength(5)
        expect(msgs.slice(0, 4).every(m => m.type === 'flex')).toBe(true)
        expect(msgs.slice(0, 4).map(m => /SH-F\d/.exec(json(m))![0])).toEqual(['SH-F4', 'SH-F5', 'SH-F6', 'SH-F7'])
        expect(msgs[4].type).toBe('text')
        expect(msgs[4].text).toContain('วันนี้ปิดไปแล้ว 7 กะ')
    })

    it('g) วันนี้ไม่มี มีเมื่อวาน → ข้อความ + การ์ดของเมื่อวาน', async () => {
        const s = setup({ groupOn: true })
        insertShift(s.tenantId, 'SH-G1', new Date(Date.now() - 24 * HOUR))
        await s.say('สรุปการปิดกะ', s.group)
        const msgs = s.replies[0]
        expect(msgs).toHaveLength(2)
        expect(msgs[0].type).toBe('text')
        expect(msgs[0].text).toContain('วันนี้ยังไม่มีกะที่ปิด')
        expect(json(msgs[1])).toContain('SH-G1')
    })
})
