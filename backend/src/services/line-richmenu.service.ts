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

const APP_URL = process.env.APP_URL ?? 'https://erp.phopy.net'
const msg = (text: string) => ({ type: 'message', text })
const uri = (u: string) => ({ type: 'uri', uri: u })
// เปิดคีย์บอร์ดพร้อมคำนำหน้า ผู้ใช้พิมพ์ชื่อต่อแล้วส่ง → เข้า handler "สต็อก xxx"/"สูตร xxx" เดิม
const ask = (prefix: string) => ({ type: 'postback', data: 'action=kbd', inputOption: 'openKeyboard', fillInText: prefix })

type Menu = { chatBarText: string; label: string; cols: number; buttons: [string, any][] }
const SWITCH: [string, any] = ['เปลี่ยนบริษัท', msg('เปลี่ยนบริษัท')]
const MINE: [string, any] = ['ของฉัน', msg('ของฉัน')]
const ACCOUNT: [string, any] = ['บัญชีของฉัน', msg('บัญชีของฉัน')]
export const MENUS: Record<MenuKey, Menu> = {
    exec: { chatBarText: 'เมนูผู้บริหาร', label: 'ผู้บริหาร', cols: 4, buttons: [
        ['ยอดขายวันนี้', msg('ยอดขายวันนี้')], ['กำไรเดือนนี้', msg('กำไรเดือนนี้')], ['รออนุมัติ', msg('รออนุมัติ')], ['สต็อกต่ำ', msg('สต็อกต่ำ')],
        ['Phopy Board', uri(`${APP_URL}/accounting/phopy-board`)], MINE, SWITCH, ACCOUNT,
    ] },
    manager: { chatBarText: 'เมนูหัวหน้า', label: 'หัวหน้า / ผู้จัดการ', cols: 4, buttons: [
        ['รออนุมัติ', msg('รออนุมัติ')], ['สต็อกต่ำ', msg('สต็อกต่ำ')], ['เช็คสต็อก', ask('สต็อก ')], ['งานผลิต', msg('สถานะ')],
        ['ออเดอร์', msg('ออเดอร์')], MINE, SWITCH, ['เปิด ERP', uri(APP_URL)],
    ] },
    staff: { chatBarText: 'เมนูพนักงาน', label: 'พนักงาน', cols: 4, buttons: [
        ['เช็คอิน', msg('เช็คอิน')], ['ขอลา', msg('ขอลา')], ['สลิป', msg('สลิป')], ['ตารางกะ', msg('ตารางกะ')],
        ['เช็คสต็อก', ask('สต็อก ')], ['งานผลิต', msg('สถานะ')], ACCOUNT, SWITCH,
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
export function buildRichMenu(key: MenuKey) {
    const m = MENUS[key], n = m.cols
    const rows = m.buttons.length / n, w = Math.floor(2500 / n)
    return {
        size: { width: 2500, height: 843 * rows },
        selected: true,
        name: `phopy-${key}`,
        chatBarText: m.chatBarText,
        areas: m.buttons.map(([label, action], i) => {
            const c = i % n
            return {
                bounds: { x: c * w, y: Math.floor(i / n) * 843, width: c === n - 1 ? 2500 - c * w : w, height: 843 },
                action: { ...action, label },
            }
        }),
    }
}

const ASSET_DIR = path.join(__dirname, '../../assets/line-richmenu')
const image = (key: MenuKey) => fs.readFileSync(path.join(ASSET_DIR, `${key}.png`))

/** เปลี่ยนนิยามเมนูหรือรูป → version เปลี่ยน → สร้างชุดใหม่ให้เองครั้งถัดไปที่มีคนทักบอท */
let VER: string | undefined // รูป/นิยามไม่เปลี่ยนระหว่างรัน — คิดครั้งเดียวต่อ process
function version(): string {
    if (VER) return VER
    const h = crypto.createHash('sha1')
    for (const k of Object.keys(MENUS) as MenuKey[]) h.update(JSON.stringify(buildRichMenu(k))).update(image(k))
    return (VER = h.digest('hex').slice(0, 12))
}

type Ids = Record<MenuKey, string>

function sdk(token: string) {
    const line = require('@line/bot-sdk')
    return {
        api: new line.messagingApi.MessagingApiClient({ channelAccessToken: token }),
        blob: new line.messagingApi.MessagingApiBlobClient({ channelAccessToken: token }),
    }
}

// ponytail: cache ในหน่วยความจำต่อ process — restart แล้วผูกเมนูซ้ำ 1 ครั้งต่อคนตอนเขาทักมา (API call เดียว ไม่แพง)
const ensuring = new Map<string, Promise<Ids | null>>()
const linkedMenu = new Map<string, string>() // `${tenantId}:${lineUserId}` → richMenuId

async function create(tenantId: string, token: string, ver: string): Promise<Ids | null> {
    const db = getDb()
    // เมนูเป็นของช่อง (OA กลางใช้ชุดเดียวทุกร้าน) — หาแถวจาก token ไม่ใช่ร้าน
    const row = db.prepare('SELECT rich_menus FROM line_channels WHERE channel_access_token = ?').get(token) as any
    const saved = row?.rich_menus ? JSON.parse(row.rich_menus) : null
    if (saved?.version === ver) return saved.ids as Ids

    const { api, blob } = sdk(token)
    const ids = {} as Ids
    for (const k of Object.keys(MENUS) as MenuKey[]) {
        const { richMenuId } = await api.createRichMenu(buildRichMenu(k))
        await blob.setRichMenuImage(richMenuId, new Blob([image(k)], { type: 'image/png' }))
        ids[k] = richMenuId
    }
    await api.setDefaultRichMenu(ids.guest)
    db.prepare('UPDATE line_channels SET rich_menus = ? WHERE channel_access_token = ?').run(JSON.stringify({ version: ver, ids }), token)

    // ย้ายทุกคนที่ผูกไว้ไปชุดใหม่ก่อนลบชุดเก่า (ไม่งั้นเขาจะเห็นเมนูหายไปชั่วขณะ)
    const users = db.prepare(`
        SELECT lum.line_user_id, lum.user_id, lum.role, u.role AS user_role
        FROM line_user_mappings lum LEFT JOIN users u ON u.id = lum.user_id
    `).all() as any[]
    for (const u of users) {
        const id = ids[menuKeyForRole(effectiveRole(u))]
        try { await api.linkRichMenuIdToUser(u.line_user_id, id); linkedMenu.set(u.line_user_id, id) }
        catch (e) { console.error('richmenu relink failed', u.line_user_id, e) }
    }
    for (const old of Object.values(saved?.ids ?? {}) as string[]) {
        try { await api.deleteRichMenu(old) } catch { /* ลบไปแล้วหรือไม่มี — ข้าม */ }
    }
    console.log(`✅ LINE rich menus ${ver} → ${tenantId}`)
    return ids
}

/** role ปัจจุบันจากตาราง users (mapping.role เป็นแค่สำเนาตอนผูก) · บัญชี master_* ไม่มีแถวใน users */
export function effectiveRole(m: { user_id: string; role?: string | null; user_role?: string | null }): string {
    return m.user_role ?? (String(m.user_id).startsWith('master_') ? 'MASTER' : m.role ?? 'USER')
}

export const richMenus = {
    ensure(tenantId: string, token: string): Promise<Ids | null> {
        let ver: string
        try { ver = version() } catch (e) { console.error('richmenu assets missing', e); return Promise.resolve(null) }
        const key = `${token}:${ver}`
        if (!ensuring.has(key)) {
            ensuring.set(key, create(tenantId, token, ver).catch(e => {
                ensuring.delete(key) // ลองใหม่ได้ครั้งหน้า
                console.error('richmenu create failed', tenantId, e?.body ?? e)
                return null
            }))
        }
        return ensuring.get(key)!
    },

    /** ผูกเมนูให้ตรงตำแหน่ง — เรียกได้ทุกข้อความ ยิง API เฉพาะตอนเมนูต้องเปลี่ยน */
    async syncUser(tenantId: string, token: string, lineUserId: string, key: MenuKey | null): Promise<void> {
        const ids = await this.ensure(tenantId, token)
        if (!ids) return
        const cacheKey = lineUserId // OA กลาง: เมนูเดียวต่อ LINE user ไม่ว่าอยู่ร้านไหน (key ต่อร้านทำให้สลับร้านกลับมาแล้วเมนูค้าง)
        const want = key ? ids[key] : null
        if (linkedMenu.get(cacheKey) === (want ?? ids.guest)) return
        const { api } = sdk(token)
        try {
            if (want) await api.linkRichMenuIdToUser(lineUserId, want)
            else await api.unlinkRichMenuIdFromUser(lineUserId) // กลับไปใช้ default = guest
            linkedMenu.set(cacheKey, want ?? ids.guest)
        } catch (e: any) { console.error('richmenu link failed', lineUserId, e?.body ?? e) }
    },
}
