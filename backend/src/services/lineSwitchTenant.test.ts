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
