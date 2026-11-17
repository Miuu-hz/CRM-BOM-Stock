import { describe, it, expect, vi, afterEach } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { lineBotService } from './line-bot.service'
import { describeEvent, describeMessages, logLine } from './lineLog'

const tenants: string[] = []
afterEach(() => {
    vi.restoreAllMocks()
    for (const t of tenants.splice(0)) db.prepare('DELETE FROM line_event_logs WHERE tenant_id = ?').run(t)
})
const logs = (t: string) => db.prepare('SELECT * FROM line_event_logs WHERE tenant_id = ? ORDER BY created_at').all(t) as any[]

describe('LINE log', () => {
    it('event ขาเข้าถูกบันทึก · handler พัง → ERROR พร้อมข้อความ และ error ยังเด้งออกไปตามเดิม', async () => {
        const t = 'tenant_log_' + generateId().slice(0, 8); tenants.push(t)
        const spy = vi.spyOn(lineBotService as any, 'dispatchEvent').mockResolvedValue(undefined)
        const ev = { type: 'message', message: { type: 'text', text: 'สถานะ' }, source: { type: 'user', userId: 'Uabc' } }
        await lineBotService.handleEvent(t, ev)
        spy.mockRejectedValue(new Error('boom'))
        await expect(lineBotService.handleEvent(t, ev)).rejects.toThrow('boom')
        const rows = logs(t)
        expect(rows.map(r => [r.direction, r.kind, r.summary, r.target, r.status, r.error])).toEqual([
            ['IN', 'message:text', 'สถานะ', 'Uabc', 'OK', null],
            ['IN', 'message:text', 'สถานะ', 'Uabc', 'ERROR', 'boom'],
        ])
    })

    it('ข้อความคุยในกลุ่มไม่ถูกบันทึก แต่รูป/postback/join ในกลุ่มบันทึก', () => {
        const g = { type: 'group', groupId: 'G1', userId: 'U1' }
        expect(describeEvent({ type: 'message', message: { type: 'text', text: 'คุยเล่น' }, source: g })).toBeNull()
        expect(describeEvent({ type: 'message', message: { type: 'image', imageSet: { index: 2, total: 3 } }, source: g })).toEqual({ kind: 'message:image', summary: 'รูป 2/3' })
        expect(describeEvent({ type: 'postback', postback: { data: 'a=1' }, source: g })).toEqual({ kind: 'postback', summary: 'a=1' })
        expect(describeEvent({ type: 'join', source: g })).toEqual({ kind: 'join', summary: '' })
    })

    it('ขาออก: สรุปชนิด + ข้อความ/altText · log พังไม่ throw', () => {
        expect(describeMessages([{ type: 'text', text: 'หวัดดี' }, { type: 'flex', altText: 'ยอดขายวันนี้' }])).toBe('[text] หวัดดี | [flex] ยอดขายวันนี้')
        expect(() => logLine({ direction: 'X' as any, kind: 'reply' })).not.toThrow() // ผิด CHECK → ถูกกลืน
    })
})
