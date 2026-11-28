import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { getDb } from '../db/sqlite'

/**
 * ริชเมนู LINE แยกตามตำแหน่ง (HR Phase 8 · 2026-10-27)
 *   guest   = ยังไม่ผูกบัญชี (ตั้งเป็น default ของ OA)
 *   staff   = USER และตำแหน่งอื่น
 *   manager = MANAGER
 *   exec    = MASTER / ADMIN / OWNER
 * เมนูแค่ซ่อนปุ่ม — สิทธิ์ดูข้อมูลยังตรวจที่ handler ทุกครั้ง (line-bot.service.ts)
 * รูปอยู่ที่ backend/assets/line-richmenu/<key>.png สร้างด้วย backend/scripts/gen-richmenu.mjs ลำดับปุ่มต้องตรงกับ MENUS
 */

export type MenuKey = 'guest' | 'staff' | 'manager' | 'exec'
export type RichMenuKey = MenuKey | 'staff_car'

export const RICH_MENU_ALIASES: Record<'staff' | 'staff_car', string> = {
    staff: 'phopy-staff',
    staff_car: 'phopy-staff-car',
}
export const RETRY_COOLDOWN_MS = 60_000

const APP_URL = process.env.APP_URL ?? 'https://erp.phopy.net'
const msg = (text: string) => ({ type: 'message', text })
const uri = (u: string) => ({ type: 'uri', uri: u })
// เปิดคีย์บอร์ดพร้อมคำนำหน้า ผู้ใช้พิมพ์ชื่อต่อแล้วส่ง → เข้า handler "สต็อก xxx"/"สูตร xxx" เดิม
const ask = (prefix: string) => ({ type: 'postback', data: 'action=kbd', inputOption: 'openKeyboard', fillInText: prefix })
const richMenuSwitch = (aliasId: string, to: RichMenuKey) => ({
    type: 'richmenuswitch',
    richMenuAliasId: aliasId,
    data: `action=richmenu_switch&to=${to}`,
})

export function getMyTasksUrl(): string | null {
    const raw = process.env.MY_TASKS_URL?.trim()
    if (!raw) return null
    try {
        const u = new URL(raw)
        return u.protocol === 'https:' || u.protocol === 'http:' ? raw : null
    } catch {
        return null
    }
}

type Menu = { chatBarText: string; label: string; cols: number; buttons: [string, any][] }
const MINE: [string, any] = ['ของฉัน', msg('ของฉัน')]
const ACCOUNT: [string, any] = ['บัญชีของฉัน', msg('บัญชีของฉัน')]
export const MENUS: Record<RichMenuKey, Menu> = {
    exec: { chatBarText: 'เมนูผู้บริหาร', label: 'ผู้บริหาร', cols: 4, buttons: [
        ['ยอดขายวันนี้', msg('ยอดขายวันนี้')], ['กำไรเดือนนี้', msg('กำไรเดือนนี้')], ['รออนุมัติ', msg('รออนุมัติ')], ['สต็อกต่ำ', msg('สต็อกต่ำ')],
        ['Phopy Board', uri(`${APP_URL}/accounting/phopy-board`)], ['ออเดอร์', msg('ออเดอร์')], MINE, ACCOUNT,
    ] },
    manager: { chatBarText: 'เมนูหัวหน้า', label: 'หัวหน้า / ผู้จัดการ', cols: 4, buttons: [
        ['รออนุมัติ', msg('รออนุมัติ')], ['สต็อกต่ำ', msg('สต็อกต่ำ')], ['เช็คสต็อก', ask('สต็อก ')], ['งานผลิต', msg('สถานะ')],
        ['ออเดอร์', msg('ออเดอร์')], MINE, ACCOUNT, ['เปิด ERP', uri(APP_URL)],
    ] },
    staff: { chatBarText: 'เมนูพนักงาน', label: 'พนักงาน', cols: 4, buttons: [
        ['เช็คอิน', msg('เช็คอิน')], ['ขอลา', msg('ขอลา')], ['ตารางกะ', msg('ตารางกะ')], ['ขอเบิก', msg('ขอเบิก')],
        ['งานของฉัน', msg('งานของฉัน')], ['ใช้งานรถยนต์', richMenuSwitch(RICH_MENU_ALIASES.staff_car, 'staff_car')], MINE, ACCOUNT,
    ] },
    staff_car: { chatBarText: 'ใช้งานรถยนต์', label: 'ใช้งานรถยนต์', cols: 4, buttons: [
        ['เริ่ม/จบทริป', msg('เริ่ม/จบทริป')], ['แวะจุด/ส่งตำแหน่ง', uri('https://line.me/R/nv/location/')], ['ประวัติทริป', msg('ประวัติทริป')], ['กลับเมนูหลัก', richMenuSwitch(RICH_MENU_ALIASES.staff, 'staff')],
    ] },
    guest: { chatBarText: 'เริ่มใช้งาน', label: 'ยังไม่ผูกบัญชี', cols: 3, buttons: [
        ['เชื่อมบัญชี', msg('วิธีเชื่อมบัญชี')], ['วิธีใช้', msg('ช่วยเหลือ')], ['เปิดเว็บ', uri(APP_URL)],
    ] },
}

export function menuKeyForRole(role: string | null | undefined): MenuKey {
    if (role === 'MASTER' || role === 'ADMIN' || role === 'OWNER') return 'exec'
    if (role === 'MANAGER') return 'manager'
    return 'staff'
}

/** ตาราง N คอลัมน์ (ตาม menu.cols) × 1–2 แถว เต็ม 2500 กว้าง แต่ละแถวสูง 843 · คอลัมน์สุดท้ายรับเศษ */
export function buildRichMenu(key: RichMenuKey) {
    const m = MENUS[key], n = m.cols
    const rows = m.buttons.length / n, w = Math.floor(2500 / n)
    const myTasksUrl = key === 'staff' ? getMyTasksUrl() : null
    return {
        size: { width: 2500, height: 843 * rows },
        selected: true,
        name: `phopy-${key}`,
        chatBarText: m.chatBarText,
        areas: m.buttons.map(([label, baseAction], i) => {
            const c = i % n
            const action = key === 'staff' && label === 'งานของฉัน'
                ? (myTasksUrl ? uri(myTasksUrl) : msg('งานของฉัน'))
                : baseAction
            return {
                bounds: { x: c * w, y: Math.floor(i / n) * 843, width: c === n - 1 ? 2500 - c * w : w, height: 843 },
                action: { ...action, label },
            }
        }),
    }
}

const ASSET_DIR = path.join(__dirname, '../../assets/line-richmenu')
const image = (key: RichMenuKey) => fs.readFileSync(path.join(ASSET_DIR, `${key}.png`))

/** เปลี่ยนนิยามเมนูหรือรูป → version เปลี่ยน → สร้างชุดใหม่ให้เองครั้งถัดไปที่มีคนทักบอท */
let VER: string | undefined // รูป/นิยามไม่เปลี่ยนระหว่างรัน — คิดครั้งเดียวต่อ process
function version(): string {
    if (VER) return VER
    const h = crypto.createHash('sha1')
    for (const k of Object.keys(MENUS) as RichMenuKey[]) h.update(JSON.stringify(buildRichMenu(k))).update(image(k))
    h.update(getMyTasksUrl() ?? '').update(JSON.stringify(RICH_MENU_ALIASES))
    return (VER = h.digest('hex').slice(0, 12))
}

type Ids = Record<RichMenuKey, string>

export const richMenuSdk = {
    create(token: string) {
        const line = require('@line/bot-sdk')
        return {
            api: new line.messagingApi.MessagingApiClient({ channelAccessToken: token }),
            blob: new line.messagingApi.MessagingApiBlobClient({ channelAccessToken: token }),
        }
    },
}

function sdk(token: string) {
    return richMenuSdk.create(token)
}

// ponytail: cache ในหน่วยความจำต่อ process — restart แล้วผูกเมนูซ้ำ 1 ครั้งต่อคนตอนเขาทักมา (API call เดียว ไม่แพง)
const ensuring = new Map<string, Promise<Ids | null>>()
const linkedMenu = new Map<string, string>() // lineUserId → `${ver}:${key ?? 'guest'}`
const retryAfter = new Map<string, number>()

export function resetRichMenuCache(): void {
    VER = undefined
    ensuring.clear()
    linkedMenu.clear()
    retryAfter.clear()
}

const httpStatus = (e: any): number | undefined =>
    typeof e?.status === 'number' ? e.status
    : typeof e?.statusCode === 'number' ? e.statusCode
    : typeof e?.response?.status === 'number' ? e.response.status
    : undefined

async function create(tenantId: string, token: string, ver: string): Promise<Ids | null> {
    const db = getDb()
    // เมนูเป็นของช่อง (OA กลางใช้ชุดเดียวทุกร้าน) — หาแถวจาก token ไม่ใช่ร้าน
    const row = db.prepare('SELECT rich_menus FROM line_channels WHERE channel_access_token = ?').get(token) as any
    const saved = row?.rich_menus ? JSON.parse(row.rich_menus) : null
    if (saved?.version === ver) return saved.ids as Ids

    const { api, blob } = sdk(token)
    const ids = {} as Ids
    const createdIds: string[] = []
    const updatedAliases: Array<{ aliasId: string; prevRichMenuId: string | null }> = []
    let defaultChanged = false

    try {
        for (const k of Object.keys(MENUS) as RichMenuKey[]) {
            const { richMenuId } = await api.createRichMenu(buildRichMenu(k))
            createdIds.push(richMenuId)
            await blob.setRichMenuImage(richMenuId, new Blob([image(k)], { type: 'image/png' }))
            ids[k] = richMenuId
        }
        // อัปเดต/สร้าง alias ก่อนลบเมนูเก่า (กัน alias ชี้ไปเมนูที่ถูกลบ)
        for (const k of ['staff', 'staff_car'] as const) {
            const aliasId = RICH_MENU_ALIASES[k]
            const richMenuId = ids[k]
            let isNew = false
            try {
                await api.updateRichMenuAlias(aliasId, { richMenuId })
            } catch (e: any) {
                if (httpStatus(e) !== 404) throw e
                isNew = true
                await api.createRichMenuAlias({ richMenuAliasId: aliasId, richMenuId })
            }
            updatedAliases.push({ aliasId, prevRichMenuId: isNew ? null : (saved?.ids?.[k] ?? null) })
        }
        await api.setDefaultRichMenu(ids.guest)
        defaultChanged = true
        db.prepare('UPDATE line_channels SET rich_menus = ? WHERE channel_access_token = ?')
            .run(JSON.stringify({ version: ver, ids, aliases: RICH_MENU_ALIASES }), token)
    } catch (err) {
        if (defaultChanged && saved?.ids?.guest) {
            try { await api.setDefaultRichMenu(saved.ids.guest) } catch { /* best-effort */ }
        }
        for (const { aliasId, prevRichMenuId } of [...updatedAliases].reverse()) {
            try {
                if (prevRichMenuId) await api.updateRichMenuAlias(aliasId, { richMenuId: prevRichMenuId })
                else await api.deleteRichMenuAlias(aliasId)
            } catch { /* best-effort */ }
        }
        for (const id of createdIds) {
            try { await api.deleteRichMenu(id) } catch { /* best-effort */ }
        }
        throw err
    }

    retryAfter.delete(token)

    // ย้ายทุกคนที่ผูกไว้ไปชุดใหม่ก่อนลบชุดเก่า (ไม่งั้นเขาจะเห็นเมนูหายไปชั่วขณะ)
    const users = db.prepare(`
        SELECT lum.line_user_id, lum.user_id, lum.role, u.role AS user_role
        FROM line_user_mappings lum LEFT JOIN users u ON u.id = lum.user_id
        ORDER BY COALESCE(lum.active_at, lum.linked_at) ASC -- คนผูกหลายร้าน: ร้านที่ใช้อยู่มาทีหลัง เมนูสุดท้ายจึงตรง
    `).all() as any[]
    // Master ลอยตัวไม่มีแถวใน line_user_mappings — ต่อท้ายให้เมนู Master (หรือ role ที่ demo อยู่) ชนะ
    users.push(...db.prepare(`SELECT line_user_id, master_id AS user_id, COALESCE(demo_role, 'MASTER') AS user_role FROM line_master_links WHERE as_member = 0`).all() as any[])
    for (const u of users) {
        const mk = menuKeyForRole(effectiveRole(u))
        const id = ids[mk]
        try { await api.linkRichMenuIdToUser(u.line_user_id, id); linkedMenu.set(u.line_user_id, `${ver}:${mk}`) }
        catch (e) { console.error('richmenu relink failed', u.line_user_id, e) }
    }
    for (const old of Object.values(saved?.ids ?? {}) as string[]) {
        if (Object.values(ids).includes(old)) continue
        try { await api.deleteRichMenu(old) } catch { /* ลบไปแล้วหรือไม่มี — ข้าม */ }
    }
    try {
        const keep = new Set<string>(Object.values(RICH_MENU_ALIASES))
        const aliasRes = await api.getRichMenuAliasList?.()
        const aliasList = Array.isArray(aliasRes) ? aliasRes : (aliasRes?.aliases ?? [])
        for (const a of aliasList) {
            const aid = a?.richMenuAliasId
            if (typeof aid === 'string' && aid.startsWith('phopy-') && !keep.has(aid)) {
                try { await api.deleteRichMenuAlias(aid) } catch { /* best-effort */ }
            }
        }
    } catch { /* best-effort */ }
    console.log(`✅ LINE rich menus ${ver} → ${tenantId}`)
    return ids
}

/** role ปัจจุบันจากตาราง users (mapping.role เป็นแค่สำเนาตอนผูก) · บัญชี master_* ไม่มีแถวใน users */
export function effectiveRole(m: { user_id: string; role?: string | null; user_role?: string | null }): string {
    return m.user_role ?? (String(m.user_id).startsWith('master_') ? 'MASTER' : m.role ?? 'USER')
}

export const richMenus = {
    ensure(tenantId: string, token: string): Promise<Ids | null> {
        if (Date.now() < (retryAfter.get(token) ?? 0)) return Promise.resolve(null)
        let ver: string
        try { ver = version() } catch (e) { console.error('richmenu assets missing', e); return Promise.resolve(null) }
        const key = `${token}:${ver}`
        if (!ensuring.has(key)) {
            ensuring.set(key, create(tenantId, token, ver).catch(e => {
                retryAfter.set(token, Date.now() + RETRY_COOLDOWN_MS)
                ensuring.delete(key) // ลองใหม่ได้ครั้งหน้า
                console.error('richmenu create failed', tenantId, e?.body ?? e)
                return null
            }))
        }
        return ensuring.get(key)!
    },

    /** ผูกเมนูให้ตรงตำแหน่ง — เรียกได้ทุกข้อความ ยิง API เฉพาะตอนเมนูต้องเปลี่ยน (คง sub-menu staff_car ไว้) */
    async syncUser(tenantId: string, token: string, lineUserId: string, key: MenuKey | null, opts?: { force?: boolean }): Promise<void> {
        const ids = await this.ensure(tenantId, token)
        if (!ids) return
        const ver = version()
        const cacheKey = lineUserId // OA กลาง: เมนูเดียวต่อ LINE user ไม่ว่าอยู่ร้านไหน (key ต่อร้านทำให้สลับร้านกลับมาแล้วเมนูค้าง)
        const tag = `${ver}:${key ?? 'guest'}`
        if (!opts?.force && linkedMenu.get(cacheKey) === tag) return

        const { api } = sdk(token)
        if (!opts?.force && key === 'staff') {
            try {
                const cur = await api.getRichMenuIdOfUser(lineUserId)
                const curId = typeof cur === 'string' ? cur : cur?.richMenuId
                if (curId === ids.staff || curId === ids.staff_car) {
                    linkedMenu.set(cacheKey, tag)
                    return
                }
            } catch (e: any) {
                if (httpStatus(e) !== 404) {
                    console.error('richmenu get failed', lineUserId, e?.body ?? e)
                    return
                }
                /* 404 = ยังไม่เคยผูกเมนู — ไปผูกใหม่ด้านล่าง */
            }
        }

        const want = key ? ids[key] : null
        try {
            if (want) await api.linkRichMenuIdToUser(lineUserId, want)
            else await api.unlinkRichMenuIdFromUser(lineUserId) // กลับไปใช้ default = guest
            linkedMenu.set(cacheKey, tag)
        } catch (e: any) { console.error('richmenu link failed', lineUserId, e?.body ?? e) }
    },
}
