import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { MENUS, buildRichMenu, menuKeyForRole, effectiveRole, richMenus, MenuKey } from './line-richmenu.service'
import { lineBotService } from './line-bot.service'

/** ริชเมนูตามตำแหน่ง (HR Phase 8) — นิยามต้องผ่านข้อจำกัดของ LINE และคำสั่งเงินต้องตรวจสิทธิ์ที่ server */
describe('ริชเมนู LINE', () => {
    it('ทุกเมนูผ่านข้อจำกัด LINE และรูปมีขนาดตรงกับ size', () => {
        for (const k of Object.keys(MENUS) as MenuKey[]) {
            const m = buildRichMenu(k)
            expect(m.chatBarText.length).toBeLessThanOrEqual(14)
            expect(m.areas.length).toBe(MENUS[k].buttons.length)
            for (const a of m.areas) {
                expect(a.action.label.length).toBeLessThanOrEqual(20)
                expect(a.bounds.x + a.bounds.width).toBeLessThanOrEqual(m.size.width)
                expect(a.bounds.y + a.bounds.height).toBeLessThanOrEqual(m.size.height)
            }
            expect(m.areas.length).toBe(m.size.height / 843 * MENUS[k].cols)
            for (let r = 0; r < m.size.height / 843; r++) {
                const row = m.areas.filter(a => a.bounds.y === r * 843)
                expect(row.reduce((n, a) => n + a.bounds.width, 0)).toBe(2500)
                row.forEach((a, i) => expect(a.bounds.x).toBe(row.slice(0, i).reduce((n, b) => n + b.bounds.width, 0)))
            }
            const png = fs.readFileSync(path.join(__dirname, '../../assets/line-richmenu', `${k}.png`))
            expect(png.length).toBeLessThan(1024 * 1024)
            expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([m.size.width, m.size.height])
        }
    })

    it('exec/manager/staff = 4×2 (625 ต่อช่อง) · guest = 3×1', () => {
        for (const k of ['exec', 'manager', 'staff'] as MenuKey[]) {
            const m = buildRichMenu(k)
            expect(m.size).toEqual({ width: 2500, height: 1686 })
            expect(m.areas.map(a => a.bounds.width)).toEqual(Array(8).fill(625))
        }
        expect(buildRichMenu('guest').size).toEqual({ width: 2500, height: 843 })
        for (const k of ['exec', 'manager', 'staff'] as MenuKey[]) {
            expect(MENUS[k].buttons.length).toBe(8)
            expect(buildRichMenu(k).areas.map(a => a.action.label)).not.toContain('เปลี่ยนบริษัท')
        }
    })

    it('role → เมนู และบัญชี master_* ที่ไม่มีแถวใน users นับเป็น MASTER', () => {
        expect(['MASTER', 'ADMIN', 'OWNER', 'MANAGER', 'USER', null].map(menuKeyForRole))
            .toEqual(['exec', 'exec', 'exec', 'manager', 'staff', 'staff'])
        expect(effectiveRole({ user_id: 'master_x', role: 'USER', user_role: null })).toBe('MASTER')
        expect(effectiveRole({ user_id: 'u1', role: 'USER', user_role: 'MANAGER' })).toBe('MANAGER')
    })
})

describe('คำสั่งจากเมนู ตรวจสิทธิ์ที่ server', () => {
    function setup(role: string) {
        const tenantId = 'tenant_rm_' + generateId().slice(0, 8)
        const userId = generateId(), lineUserId = 'U' + generateId()
        db.prepare(`INSERT INTO users (id, email, password, name, role, tenant_id, status) VALUES (?, ?, 'x', 'ทดสอบ', ?, ?, 'active')`)
            .run(userId, `${userId}@example.com`, role, tenantId)
        db.prepare(`INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role) VALUES (?, ?, ?, ?, 'USER')`)
            .run(generateId(), tenantId, userId, lineUserId)
        const replies: any[] = []
        const client = { token: 't', replyMessage: async (_t: string, m: any) => { replies.push(m) } }
        vi.spyOn(lineBotService as any, 'getClient').mockReturnValue(client)
        vi.spyOn(richMenus, 'syncUser').mockResolvedValue()
        const say = (text: string, type = 'user') => lineBotService.handleEvent(tenantId, {
            type: 'message', replyToken: 'rt', message: { type: 'text', text },
            source: { type, userId: lineUserId, groupId: type === 'group' ? 'G1' : undefined },
        })
        return { tenantId, lineUserId, replies, say }
    }

    it('พนักงานกด "กำไรเดือนนี้" → ถูกปฏิเสธ ไม่เห็นตัวเลข', async () => {
        const { replies, say } = setup('USER')
        await say('กำไรเดือนนี้')
        expect(replies[0].type).toBe('text')
        expect(replies[0].text).toContain('🔒')
    })

    it('ผู้บริหารได้การ์ดกำไร แต่ถ้าพิมพ์ในกลุ่มต้องไม่โชว์', async () => {
        const { replies, say } = setup('ADMIN')
        await say('กำไรเดือนนี้')
        expect(replies[0].type).toBe('flex')
        await say('กำไรเดือนนี้', 'group')
        expect(replies[1].text).toContain('แชทส่วนตัว')
    })

    it('เลื่อนตำแหน่งในเว็บ → mapping.role ตามในข้อความถัดไป และผูกเมนูผู้บริหาร', async () => {
        const { tenantId, lineUserId, say } = setup('MASTER')
        await say('บัญชีของฉัน')
        const row = db.prepare('SELECT role FROM line_user_mappings WHERE tenant_id = ? AND line_user_id = ?').get(tenantId, lineUserId) as any
        expect(row.role).toBe('MASTER')
        expect(richMenus.syncUser).toHaveBeenCalledWith(tenantId, 't', lineUserId, 'exec')
    })
})
