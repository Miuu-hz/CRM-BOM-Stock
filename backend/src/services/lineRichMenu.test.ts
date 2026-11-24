import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import {
    MENUS, buildRichMenu, menuKeyForRole, effectiveRole, richMenus,
    RichMenuKey, MenuKey, RICH_MENU_ALIASES, RETRY_COOLDOWN_MS,
    getMyTasksUrl, resetRichMenuCache, richMenuSdk,
} from './line-richmenu.service'
import { lineBotService } from './line-bot.service'

/** ริชเมนูตามตำแหน่ง (HR Phase 8) — นิยามต้องผ่านข้อจำกัดของ LINE และคำสั่งเงินต้องตรวจสิทธิ์ที่ server */
describe('ริชเมนู LINE', () => {
    it('ทุกเมนูผ่านข้อจำกัด LINE และรูปมีขนาดตรงกับ size', () => {
        for (const k of Object.keys(MENUS) as RichMenuKey[]) {
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
            const pngPath = path.join(__dirname, '../../assets/line-richmenu', `${k}.png`)
            if (k !== 'staff_car' || fs.existsSync(pngPath)) {
                const png = fs.readFileSync(pngPath)
                expect(png.length).toBeLessThan(1024 * 1024)
                expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([m.size.width, m.size.height])
            }
        }
    })

    it('exec/manager/staff = 4×2 (625 ต่อช่อง) · staff_car = 4×1 · guest = 3×1', () => {
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
        const sc = buildRichMenu('staff_car')
        expect(sc.size).toEqual({ width: 2500, height: 843 })
        expect(sc.areas.map(a => a.bounds.width)).toEqual(Array(4).fill(625))
        expect(sc.chatBarText).toBe('ใช้งานรถยนต์')
        expect(sc.areas.map(a => a.action.label)).toEqual(['เริ่ม/จบทริป', 'แวะจุด', 'ประวัติทริป', 'กลับเมนูหลัก'])
        expect(sc.areas[3].action).toMatchObject({ type: 'richmenuswitch', richMenuAliasId: RICH_MENU_ALIASES.staff })

        const st = buildRichMenu('staff')
        expect(st.areas.map(a => a.action.label)).toEqual(['เช็คอิน', 'ขอลา', 'ตารางกะ', 'ขอเบิก', 'งานของฉัน', 'ใช้งานรถยนต์', 'ของฉัน', 'บัญชีของฉัน'])
        expect(st.areas[5].action).toMatchObject({ type: 'richmenuswitch', richMenuAliasId: RICH_MENU_ALIASES.staff_car })
    })

    it('MY_TASKS_URL ว่าง/ไม่ถูกต้อง → ปุ่ม message · URL ถูกต้อง → ปุ่ม uri', () => {
        const prev = process.env.MY_TASKS_URL
        try {
            delete process.env.MY_TASKS_URL
            expect(getMyTasksUrl()).toBeNull()
            expect(buildRichMenu('staff').areas[4].action).toEqual({ type: 'message', text: 'งานของฉัน', label: 'งานของฉัน' })

            process.env.MY_TASKS_URL = 'javascript:alert(1)'
            expect(getMyTasksUrl()).toBeNull()
            expect(buildRichMenu('staff').areas[4].action).toEqual({ type: 'message', text: 'งานของฉัน', label: 'งานของฉัน' })

            process.env.MY_TASKS_URL = 'https://tasks.example.com/my'
            expect(getMyTasksUrl()).toBe('https://tasks.example.com/my')
            expect(buildRichMenu('staff').areas[4].action).toEqual({ type: 'uri', uri: 'https://tasks.example.com/my', label: 'งานของฉัน' })
        } finally {
            if (prev === undefined) delete process.env.MY_TASKS_URL
            else process.env.MY_TASKS_URL = prev
        }
    })

    it('role → เมนู และบัญชี master_* ที่ไม่มีแถวใน users นับเป็น MASTER', () => {
        expect(['MASTER', 'ADMIN', 'OWNER', 'MANAGER', 'USER', null].map(menuKeyForRole))
            .toEqual(['exec', 'exec', 'exec', 'manager', 'staff', 'staff'])
        expect(effectiveRole({ user_id: 'master_x', role: 'USER', user_role: null })).toBe('MASTER')
        expect(effectiveRole({ user_id: 'u1', role: 'USER', user_role: 'MANAGER' })).toBe('MANAGER')
    })
})

describe('richMenus aliases, sub-menu persistence, rollback & cool-down', () => {
    const tenants: string[] = []
    const origReadFileSync = fs.readFileSync.bind(fs)
    let prevTasksUrl: string | undefined

    beforeEach(() => {
        prevTasksUrl = process.env.MY_TASKS_URL
        delete process.env.MY_TASKS_URL
        resetRichMenuCache()
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
        resetRichMenuCache()
        if (prevTasksUrl === undefined) delete process.env.MY_TASKS_URL
        else process.env.MY_TASKS_URL = prevTasksUrl
        for (const t of tenants.splice(0)) {
            for (const tb of ['line_user_mappings', 'line_channels', 'users']) {
                db.prepare(`DELETE FROM ${tb} WHERE tenant_id = ?`).run(t)
            }
        }
    })

    function stubAssets(opts?: { missingStaffCar?: boolean }) {
        vi.spyOn(fs, 'readFileSync').mockImplementation(((p: any, ...rest: any[]) => {
            const s = String(p)
            if (s.includes('assets/line-richmenu') || s.includes('assets\\line-richmenu')) {
                if (opts?.missingStaffCar && s.endsWith('staff_car.png')) {
                    const err: any = new Error(`ENOENT: no such file or directory, open '${s}'`)
                    err.code = 'ENOENT'
                    throw err
                }
                return Buffer.from(`fake-png-${path.basename(s)}`)
            }
            return origReadFileSync(p, ...rest)
        }) as any)
    }

    function seedChannel(savedRichMenus: any = null) {
        const tenantId = 'tenant_rm_' + generateId().slice(0, 8)
        tenants.push(tenantId)
        const token = 'tok_' + generateId()
        db.prepare(`INSERT INTO line_channels (id, tenant_id, channel_name, channel_secret, channel_access_token, is_active, rich_menus) VALUES (?, ?, 'OA', 'sec', ?, 1, ?)`)
            .run(generateId(), tenantId, token, savedRichMenus ? JSON.stringify(savedRichMenus) : null)
        return { tenantId, token }
    }

    function mockSdk(overrides?: {
        updateAlias?: (aliasId: string, body: any) => Promise<any>
        createAlias?: (body: any) => Promise<any>
        setImage?: (id: string, blob: any) => Promise<any>
        setDefault?: (id: string) => Promise<any>
        aliasList?: Array<{ richMenuAliasId: string; richMenuId: string }>
        getRichMenuIdOfUser?: (uid: string) => Promise<any>
    }) {
        const calls: string[] = []
        let seq = 0
        const api = {
            createRichMenu: vi.fn(async (menu: any) => {
                const richMenuId = `rm_${menu.name}_${++seq}`
                calls.push(`createRichMenu:${menu.name}:${richMenuId}`)
                return { richMenuId }
            }),
            updateRichMenuAlias: vi.fn(async (aliasId: string, body: any) => {
                calls.push(`updateRichMenuAlias:${aliasId}:${body.richMenuId}`)
                if (overrides?.updateAlias) return overrides.updateAlias(aliasId, body)
                return {}
            }),
            createRichMenuAlias: vi.fn(async (body: any) => {
                calls.push(`createRichMenuAlias:${body.richMenuAliasId}:${body.richMenuId}`)
                if (overrides?.createAlias) return overrides.createAlias(body)
                return {}
            }),
            deleteRichMenuAlias: vi.fn(async (aliasId: string) => {
                calls.push(`deleteRichMenuAlias:${aliasId}`)
                return {}
            }),
            getRichMenuAliasList: vi.fn(async () => ({
                aliases: overrides?.aliasList ?? [],
            })),
            setDefaultRichMenu: vi.fn(async (id: string) => {
                calls.push(`setDefaultRichMenu:${id}`)
                if (overrides?.setDefault) return overrides.setDefault(id)
                return {}
            }),
            linkRichMenuIdToUser: vi.fn(async (uid: string, id: string) => {
                calls.push(`linkRichMenuIdToUser:${uid}:${id}`)
                return {}
            }),
            unlinkRichMenuIdFromUser: vi.fn(async (uid: string) => {
                calls.push(`unlinkRichMenuIdFromUser:${uid}`)
                return {}
            }),
            getRichMenuIdOfUser: vi.fn(async (uid: string) => {
                calls.push(`getRichMenuIdOfUser:${uid}`)
                if (overrides?.getRichMenuIdOfUser) return overrides.getRichMenuIdOfUser(uid)
                throw Object.assign(new Error('not found'), { status: 404 })
            }),
            deleteRichMenu: vi.fn(async (id: string) => {
                calls.push(`deleteRichMenu:${id}`)
                return {}
            }),
        }
        const blob = {
            setRichMenuImage: vi.fn(async (id: string, img: any) => {
                calls.push(`setRichMenuImage:${id}`)
                if (overrides?.setImage) return overrides.setImage(id, img)
                return {}
            }),
        }
        vi.spyOn(richMenuSdk, 'create').mockReturnValue({ api, blob })
        return { api, blob, calls }
    }

    it('ช่องใหม่: สร้าง 5 เมนู + fallback update-404 เป็น create alias + บันทึก DB', async () => {
        stubAssets()
        const { tenantId, token } = seedChannel(null)
        const { api, calls } = mockSdk({
            updateAlias: async () => { throw Object.assign(new Error('not found'), { status: 404 }) },
        })

        const ids = await richMenus.ensure(tenantId, token)
        expect(ids).toBeTruthy()
        expect(Object.keys(ids!)).toHaveLength(5)
        expect(api.createRichMenu).toHaveBeenCalledTimes(5)
        expect(api.createRichMenuAlias).toHaveBeenCalledWith({ richMenuAliasId: 'phopy-staff', richMenuId: ids!.staff })
        expect(api.createRichMenuAlias).toHaveBeenCalledWith({ richMenuAliasId: 'phopy-staff-car', richMenuId: ids!.staff_car })
        expect(api.setDefaultRichMenu).toHaveBeenCalledWith(ids!.guest)
        expect(calls.indexOf(`createRichMenuAlias:phopy-staff-car:${ids!.staff_car}`))
            .toBeLessThan(calls.indexOf(`setDefaultRichMenu:${ids!.guest}`))

        const row = db.prepare('SELECT rich_menus FROM line_channels WHERE channel_access_token = ?').get(token) as any
        const saved = JSON.parse(row.rich_menus)
        expect(saved.ids).toEqual(ids)
        expect(saved.aliases).toEqual(RICH_MENU_ALIASES)
    })

    it('อัปเกรดเวอร์ชัน: อัปเดต alias ก่อนลบเมนูเก่า และลบเฉพาะ alias phopy-* ที่ค้าง', async () => {
        stubAssets()
        const oldIds = { exec: 'old_exec', manager: 'old_mgr', staff: 'old_staff', staff_car: 'old_car', guest: 'old_guest' }
        const { tenantId, token } = seedChannel({ version: 'old_ver', ids: oldIds })
        const { api, calls } = mockSdk({
            aliasList: [
                { richMenuAliasId: 'phopy-staff', richMenuId: 'x' },
                { richMenuAliasId: 'phopy-staff-car', richMenuId: 'y' },
                { richMenuAliasId: 'phopy-legacy', richMenuId: 'z' },
            ],
        })

        const ids = await richMenus.ensure(tenantId, token)
        expect(ids).toBeTruthy()
        const lastAliasIdx = Math.max(
            calls.indexOf(`updateRichMenuAlias:phopy-staff:${ids!.staff}`),
            calls.indexOf(`updateRichMenuAlias:phopy-staff-car:${ids!.staff_car}`),
        )
        const firstDeleteIdx = calls.findIndex(c => c.startsWith('deleteRichMenu:'))
        expect(firstDeleteIdx).toBeGreaterThan(lastAliasIdx)
        for (const oldId of Object.values(oldIds)) {
            expect(api.deleteRichMenu).toHaveBeenCalledWith(oldId)
        }
        expect(api.deleteRichMenuAlias).toHaveBeenCalledWith('phopy-legacy')
        expect(api.deleteRichMenuAlias).not.toHaveBeenCalledWith('phopy-staff')
        expect(api.deleteRichMenuAlias).not.toHaveBeenCalledWith('phopy-staff-car')
    })

    it('syncUser: คง staff_car ทั้ง warm cache และ cold cache · เปลี่ยนตำแหน่ง/เลิกผูกจึง relink', async () => {
        stubAssets()
        const { tenantId, token } = seedChannel(null)
        const { api } = mockSdk({
            updateAlias: async () => { throw Object.assign(new Error('not found'), { status: 404 }) },
        })
        const ids = (await richMenus.ensure(tenantId, token))!
        api.linkRichMenuIdToUser.mockClear()
        api.getRichMenuIdOfUser.mockClear()
        const lineUserId = 'U' + generateId()

        // ผูกครั้งแรกเมื่อยังไม่มีเมนู
        await richMenus.syncUser(tenantId, token, lineUserId, 'staff')
        expect(api.linkRichMenuIdToUser).toHaveBeenCalledTimes(1)
        expect(api.linkRichMenuIdToUser).toHaveBeenLastCalledWith(lineUserId, ids.staff)

        // Warm cache: ผู้ใช้สลับไป staff_car แล้วส่งข้อความ → ไม่ยิง link ซ้ำ
        api.linkRichMenuIdToUser.mockClear()
        api.getRichMenuIdOfUser.mockClear()
        await richMenus.syncUser(tenantId, token, lineUserId, 'staff')
        expect(api.linkRichMenuIdToUser).not.toHaveBeenCalled()
        expect(api.getRichMenuIdOfUser).not.toHaveBeenCalled()

        // Cold cache (หลัง restart): getRichMenuIdOfUser คืน staff_car → ไม่ relink กลับ staff
        resetRichMenuCache()
        stubAssets()
        api.getRichMenuIdOfUser.mockResolvedValue({ richMenuId: ids.staff_car })
        await richMenus.syncUser(tenantId, token, lineUserId, 'staff')
        expect(api.getRichMenuIdOfUser).toHaveBeenCalledWith(lineUserId)
        expect(api.linkRichMenuIdToUser).not.toHaveBeenCalled()

        // เปลี่ยนตำแหน่งเป็น manager → ต้อง relink ทันที
        api.linkRichMenuIdToUser.mockClear()
        await richMenus.syncUser(tenantId, token, lineUserId, 'manager')
        expect(api.linkRichMenuIdToUser).toHaveBeenCalledTimes(1)
        expect(api.linkRichMenuIdToUser).toHaveBeenCalledWith(lineUserId, ids.manager)

        // เลิกผูก (null) → unlink
        api.unlinkRichMenuIdFromUser.mockClear()
        await richMenus.syncUser(tenantId, token, lineUserId, null)
        expect(api.unlinkRichMenuIdFromUser).toHaveBeenCalledTimes(1)
        expect(api.unlinkRichMenuIdFromUser).toHaveBeenCalledWith(lineUserId)
    })

    it('syncUser: getRichMenuIdOfUser คืน 500/network error → ไม่ relink และไม่ cache · 404 จึง relink', async () => {
        stubAssets()
        const { tenantId, token } = seedChannel(null)
        const { api } = mockSdk({
            updateAlias: async () => { throw Object.assign(new Error('not found'), { status: 404 }) },
        })
        const ids = (await richMenus.ensure(tenantId, token))!
        api.linkRichMenuIdToUser.mockClear()
        api.getRichMenuIdOfUser.mockClear()
        const lineUserId = 'U' + generateId()

        // 1) HTTPFetchError 500 → ไม่ link และไม่ cache
        api.getRichMenuIdOfUser.mockRejectedValueOnce(Object.assign(new Error('500'), { status: 500 }))
        await richMenus.syncUser(tenantId, token, lineUserId, 'staff')
        expect(api.getRichMenuIdOfUser).toHaveBeenCalledTimes(1)
        expect(api.linkRichMenuIdToUser).not.toHaveBeenCalled()

        // 2) Timeout / network error (ไม่มี .status) → เรียก getRichMenuIdOfUser ใหม่, ยังไม่ link และไม่ cache
        api.getRichMenuIdOfUser.mockRejectedValueOnce(new Error('ETIMEDOUT'))
        await richMenus.syncUser(tenantId, token, lineUserId, 'staff')
        expect(api.getRichMenuIdOfUser).toHaveBeenCalledTimes(2)
        expect(api.linkRichMenuIdToUser).not.toHaveBeenCalled()

        // 3) 404 → ผูก ids.staff 1 ครั้ง
        api.getRichMenuIdOfUser.mockRejectedValueOnce(Object.assign(new Error('not found'), { status: 404 }))
        await richMenus.syncUser(tenantId, token, lineUserId, 'staff')
        expect(api.getRichMenuIdOfUser).toHaveBeenCalledTimes(3)
        expect(api.linkRichMenuIdToUser).toHaveBeenCalledTimes(1)
        expect(api.linkRichMenuIdToUser).toHaveBeenCalledWith(lineUserId, ids.staff)
    })

    it('rollback เมื่อพังระหว่างอัปโหลดรูป / alias / setDefault: ลบเมนูใหม่ คืน alias เดิม ไม่ลบเมนูเก่า', async () => {
        stubAssets()
        const oldIds = { exec: 'old_exec', manager: 'old_mgr', staff: 'old_staff', staff_car: 'old_car', guest: 'old_guest' }
        const { tenantId, token } = seedChannel({ version: 'old_ver', ids: oldIds })

        // Case 1: fail on 3rd setRichMenuImage
        let imgCount = 0
        const m1 = mockSdk({
            setImage: async () => { if (++imgCount === 3) throw new Error('upload boom') },
        })
        expect(await richMenus.ensure(tenantId, token)).toBeNull()
        expect(m1.api.deleteRichMenu).toHaveBeenCalledTimes(3)
        for (const oldId of Object.values(oldIds)) expect(m1.api.deleteRichMenu).not.toHaveBeenCalledWith(oldId)
        expect(JSON.parse((db.prepare('SELECT rich_menus FROM line_channels WHERE channel_access_token = ?').get(token) as any).rich_menus).version).toBe('old_ver')

        // Case 2: fail on 2nd alias upsert (phopy-staff-car) → restores phopy-staff BEFORE deleting new menus
        resetRichMenuCache()
        stubAssets()
        const m2 = mockSdk({
            updateAlias: async (aliasId) => { if (aliasId === 'phopy-staff-car') throw new Error('alias boom') },
        })
        expect(await richMenus.ensure(tenantId, token)).toBeNull()
        const restoreIdx = m2.calls.indexOf('updateRichMenuAlias:phopy-staff:old_staff')
        const delNewIdx = m2.calls.findIndex(c => c.startsWith('deleteRichMenu:'))
        expect(restoreIdx).toBeGreaterThan(-1)
        expect(restoreIdx).toBeLessThan(delNewIdx)
        expect(m2.api.deleteRichMenu).toHaveBeenCalledTimes(5)
        for (const oldId of Object.values(oldIds)) expect(m2.api.deleteRichMenu).not.toHaveBeenCalledWith(oldId)

        // Case 3: fail on setDefaultRichMenu → restores both aliases in reverse order BEFORE deleting new menus
        resetRichMenuCache()
        stubAssets()
        const m3 = mockSdk({
            setDefault: async () => { throw new Error('default boom') },
        })
        expect(await richMenus.ensure(tenantId, token)).toBeNull()
        const rCar = m3.calls.indexOf('updateRichMenuAlias:phopy-staff-car:old_car')
        const rStaff = m3.calls.indexOf('updateRichMenuAlias:phopy-staff:old_staff')
        const firstDel = m3.calls.findIndex(c => c.startsWith('deleteRichMenu:'))
        expect(rCar).toBeGreaterThan(-1)
        expect(rStaff).toBeGreaterThan(rCar)
        expect(firstDel).toBeGreaterThan(rStaff)
        expect(m3.api.deleteRichMenu).toHaveBeenCalledTimes(5)
    })

    it('retry cool-down: หลัง create พัง → เรียกซ้ำทันทีคืน null (0 API calls) · พ้น cool-down แล้วสร้างใหม่ได้', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-11-24T00:00:00Z'))
        stubAssets()
        const { tenantId, token } = seedChannel(null)
        const { api } = mockSdk({
            setDefault: async () => { throw new Error('line 500') },
        })

        expect(await richMenus.ensure(tenantId, token)).toBeNull()
        expect(api.createRichMenu).toHaveBeenCalledTimes(5)

        api.createRichMenu.mockClear()
        expect(await richMenus.ensure(tenantId, token)).toBeNull()
        expect(api.createRichMenu).not.toHaveBeenCalled()

        vi.advanceTimersByTime(RETRY_COOLDOWN_MS)
        api.setDefaultRichMenu.mockResolvedValue({})
        const ids = await richMenus.ensure(tenantId, token)
        expect(ids).toBeTruthy()
        expect(api.createRichMenu).toHaveBeenCalledTimes(5)
    })

    it('ขาดไฟล์ staff_car.png (ENOENT) → คืน null โดยไม่ throw และไม่เรียก LINE API', async () => {
        stubAssets({ missingStaffCar: true })
        const { tenantId, token } = seedChannel(null)
        const { api } = mockSdk()
        expect(await richMenus.ensure(tenantId, token)).toBeNull()
        expect(api.createRichMenu).not.toHaveBeenCalled()
    })
})

describe('คำสั่งจากเมนู ตรวจสิทธิ์ที่ server', () => {
    const serverTenants: string[] = []
    afterEach(() => {
        vi.restoreAllMocks()
        for (const t of serverTenants.splice(0)) {
            for (const tb of ['line_user_mappings', 'users']) {
                db.prepare(`DELETE FROM ${tb} WHERE tenant_id = ?`).run(t)
            }
        }
    })

    function setup(role: string) {
        const tenantId = 'tenant_rm_' + generateId().slice(0, 8)
        serverTenants.push(tenantId)
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
