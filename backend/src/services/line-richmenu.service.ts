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
 * รูปอยู่ที่ backend/assets/line-richmenu/<key>.png สร้างจาก scratch HTML ลำดับปุ่มต้องตรงกับ MENUS
 */

export type MenuKey = 'guest' | 'staff' | 'manager' | 'exec'

const APP_URL = process.env.APP_URL ?? 'https://erp.phopy.net'
const msg = (text: string) => ({ type: 'message', text })
const uri = (u: string) => ({ type: 'uri', uri: u })
// เปิดคีย์บอร์ดพร้อมคำนำหน้า ผู้ใช้พิมพ์ชื่อต่อแล้วส่ง → เข้า handler "สต็อก xxx"/"สูตร xxx" เดิม
const ask = (prefix: string) => ({ type: 'postback', data: 'action=kbd', inputOption: 'openKeyboard', fillInText: prefix })

export const MENUS: Record<MenuKey, { chatBarText: string; label: string; buttons: [string, any][] }> = {
    exec: { chatBarText: 'เมนูผู้บริหาร', label: 'ผู้บริหาร', buttons: [
        ['ยอดขายวันนี้', msg('ยอดขายวันนี้')], ['กำไรเดือนนี้', msg('กำไรเดือนนี้')], ['รออนุมัติ', msg('รออนุมัติ')],
        ['สต็อกต่ำ', msg('สต็อกต่ำ')], ['Phopy Board', uri(`${APP_URL}/accounting/phopy-board`)], ['บัญชีของฉัน', msg('บัญชีของฉัน')],
    ] },
    manager: { chatBarText: 'เมนูหัวหน้า', label: 'หัวหน้า / ผู้จัดการ', buttons: [
        ['รออนุมัติ', msg('รออนุมัติ')], ['สต็อกต่ำ', msg('สต็อกต่ำ')], ['เช็คสต็อก', ask('สต็อก ')],
        ['งานผลิต', msg('สถานะ')], ['ออเดอร์', msg('ออเดอร์')], ['เปิด ERP', uri(APP_URL)],
    ] },
    staff: { chatBarText: 'เมนูพนักงาน', label: 'พนักงาน', buttons: [
        ['เช็คสต็อก', ask('สต็อก ')], ['สูตร', ask('สูตร ')], ['งานผลิต', msg('สถานะ')],
        ['ออเดอร์', msg('ออเดอร์')], ['บัญชีของฉัน', msg('บัญชีของฉัน')], ['เปิด ERP', uri(APP_URL)],
    ] },
    guest: { chatBarText: 'เริ่มใช้งาน', label: 'ยังไม่ผูกบัญชี', buttons: [
        ['เชื่อมบัญชี', msg('วิธีเชื่อมบัญชี')], ['วิธีใช้', msg('ช่วยเหลือ')], ['เปิดเว็บ', uri(APP_URL)],
    ] },
}

export function menuKeyForRole(role: string | null | undefined): MenuKey {
    if (role === 'MASTER' || role === 'ADMIN' || role === 'OWNER') return 'exec'
    if (role === 'MANAGER') return 'manager'
    return 'staff'
}

/** ตาราง 3 คอลัมน์ × 1–2 แถว ขนาดเต็ม 2500 กว้าง แต่ละแถวสูง 843 */
export function buildRichMenu(key: MenuKey) {
    const m = MENUS[key]
    const rows = m.buttons.length / 3
    const xs = [0, 833, 1666], ws = [833, 833, 834]
    return {
        size: { width: 2500, height: 843 * rows },
        selected: true,
        name: `phopy-${key}`,
        chatBarText: m.chatBarText,
        areas: m.buttons.map(([label, action], i) => ({
            bounds: { x: xs[i % 3], y: Math.floor(i / 3) * 843, width: ws[i % 3], height: 843 },
            action: { ...action, label },
        })),
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
    const row = db.prepare('SELECT rich_menus FROM line_channels WHERE tenant_id = ?').get(tenantId) as any
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
    db.prepare('UPDATE line_channels SET rich_menus = ? WHERE tenant_id = ?').run(JSON.stringify({ version: ver, ids }), tenantId)

    // ย้ายทุกคนที่ผูกไว้ไปชุดใหม่ก่อนลบชุดเก่า (ไม่งั้นเขาจะเห็นเมนูหายไปชั่วขณะ)
    const users = db.prepare(`
        SELECT lum.line_user_id, lum.user_id, lum.role, u.role AS user_role
        FROM line_user_mappings lum LEFT JOIN users u ON u.id = lum.user_id
        WHERE lum.tenant_id = ?
    `).all(tenantId) as any[]
    for (const u of users) {
        const id = ids[menuKeyForRole(effectiveRole(u))]
        try { await api.linkRichMenuIdToUser(u.line_user_id, id); linkedMenu.set(`${tenantId}:${u.line_user_id}`, id) }
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
        const key = `${tenantId}:${ver}`
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
        const cacheKey = `${tenantId}:${lineUserId}`
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
