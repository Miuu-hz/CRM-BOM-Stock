import crypto from 'crypto'
import { getDb } from '../db/sqlite'
import { formatDocumentNumber, thaiDateStr } from '../utils/id'
import { normalizeUnit } from './unitConversion.service'

// ─── BOM Command Parser ───────────────────────────────────────────────────────
// รองรับรูปแบบ (ส่วนตัวเท่านั้น):
//   บอม [ชื่อสินค้า]
//   [วัตถุดิบ 1] [จำนวน] [หน่วย]
//   [วัตถุดิบ 2] [จำนวน] [หน่วย]
export function parseBOMCommand(text: string): { productName: string; items: { name: string; qty: number; unit: string }[] } | null {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0)
    if (lines.length < 2) return null

    const firstLine = lines[0]
    if (!/^บอม\s+/i.test(firstLine)) return null

    const productName = firstLine.replace(/^บอม\s+/i, '').trim()
    if (!productName) return null

    const items = lines.slice(1).map(line => {
        const parts = line.split(/\s+/)
        // รูปแบบ: "ชื่อ qty unit"
        if (parts.length >= 3) {
            const maybeQty = parseFloat(parts[parts.length - 2])
            const maybeUnit = parts[parts.length - 1]
            if (!isNaN(maybeQty) && maybeQty > 0 && !/^\d/.test(maybeUnit)) {
                return { name: parts.slice(0, -2).join(' '), qty: maybeQty, unit: maybeUnit }
            }
        }
        // รูปแบบ: "ชื่อ qty"
        if (parts.length >= 2) {
            const maybeQty = parseFloat(parts[parts.length - 1])
            if (!isNaN(maybeQty) && maybeQty > 0) {
                return { name: parts.slice(0, -1).join(' '), qty: maybeQty, unit: 'ชิ้น' }
            }
        }
        // ไม่มีจำนวน → default 1
        return { name: line.trim(), qty: 1, unit: 'ชิ้น' }
    }).filter(i => i.name.length > 0)

    if (items.length === 0) return null
    return { productName, items }
}

// ─── PR Command Parser ────────────────────────────────────────────────────────
// รองรับรูปแบบ:
//   ขอซื้อ PR กับ [ซัพพลายเออร์]    หรือ    ขอซื้อ [ซัพพลายเออร์]
//   [รายการ 1]
//   [รายการ 2]
//   ...
export function parsePRCommand(text: string): { supplierName: string; items: string[] } | null {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0)
    if (lines.length < 2) return null

    const firstLine = lines[0]
    const isPR = /^ขอซื้อ/i.test(firstLine)
    if (!isPR) return null

    // ดึงชื่อซัพพลายเออร์: "ขอซื้อ PR กับ ABC" หรือ "ขอซื้อ กับ ABC" หรือ "ขอซื้อ ABC"
    const withMatch = firstLine.match(/กับ\s+(.+)$/i)
    const supplierName = withMatch
        ? withMatch[1].trim()
        : firstLine.replace(/^ขอซื้อ\s*(PR\s*)?/i, '').trim() || 'ไม่ระบุซัพพลายเออร์'

    const items = lines.slice(1).filter(l => l.length > 0)
    if (items.length === 0) return null

    return { supplierName, items }
}

// ─── PR Number Generator ──────────────────────────────────────────────────────
function generatePRNumber(tenantId: string): string {
    return formatDocumentNumber('PR', tenantId, 'PURCHASE_REQUEST', new Date().getFullYear(), 5)
}

let Client: any
let validateSignature: any
try {
    const line = require('@line/bot-sdk')
    // @line/bot-sdk v11 moved Client to messagingApi.MessagingApiClient
    Client = line.messagingApi?.MessagingApiClient ?? line.Client
    validateSignature = line.validateSignature
} catch (e) {
    console.warn('⚠️ @line/bot-sdk is not installed. LINE Bot functionality will be disabled.')
}

import { flexTemplates, IN_CHAT_APPROVAL } from './line-flex-templates'
import { getSubscription } from './subscription.service'
import { handleDecision } from '../routes/approval.routes' // วนกันกับ approval.routes แต่ใช้ตอนเรียกเท่านั้น
import { detectIntent } from './llm.service'
import { richMenus, menuKeyForRole, effectiveRole, MENUS, MenuKey } from './line-richmenu.service'
import { posSales, ledgerRevenue, ledgerCogs, ledgerOpex, thaiToday, addDaysStr } from './phopyBoard.service'
import { canApprove } from './approvalGate.service'
import { getLowStockItems } from '../routes/dashboard.routes'
import { intakeBillImage, MAX_PENDING_PER_TENANT } from './billInbox.service'
import { logLine, describeEvent, describeMessages } from './lineLog'
import { buildShiftSummary } from './posShiftSummary.service'
import { buildExecDigest } from './execDigest.service'

const ROLE_LABEL: Record<string, string> = { MASTER: 'เจ้าของ (Master)', OWNER: 'เจ้าของ', ADMIN: 'ผู้ดูแลระบบ', MANAGER: 'ผู้จัดการ', USER: 'พนักงาน', GUEST: 'ยังไม่ผูกบัญชี' }
// ponytail: OA กลางคือแถว active แรกใน line_channels (ตอนนี้มีแถวเดียว Phopy-ERP @060cskax) — ถ้าวันหนึ่งมีหลาย OA ต้องมีคอลัมน์บอกว่าอันไหนกลาง
function centralChannel(): any {
    return getDb().prepare('SELECT * FROM line_channels WHERE is_active = 1 ORDER BY created_at LIMIT 1').get()
}

// shortcut: นับในหน่วยความจำของ process เดียว (pm2 fork) — ถ้ารันหลาย instance ต้องย้ายไปเก็บใน DB
export const linkThrottle = {
    hits: new Map<string, number[]>(),
    allow(key: string, max = 5, windowMs = 10 * 60 * 1000): boolean {
        const now = Date.now()
        const recent = (this.hits.get(key) ?? []).filter(t => now - t < windowMs)
        if (recent.length >= max) { this.hits.set(key, recent); return false }
        recent.push(now); this.hits.set(key, recent)
        if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.some(t => now - t < windowMs)) this.hits.delete(k)
        return true
    },
}

const companyName = (tenantId: string) =>
    ((getDb().prepare('SELECT name FROM company_settings WHERE tenant_id = ?').get(tenantId) as any)?.name ?? '') as string

// บัญชี Master มาจาก .env (MASTER_BB_* / MASTER_KIDS_* แบบเดียวกับ auth.routes.ts)
// shortcut: ไม่มี MASTER_*_USERNAME เลย (dev/test) → ไม่เช็ค · ถ้าเพิ่ม prefix ใน auth.routes.ts ต้องเพิ่มที่นี่ด้วย
function isMasterId(id: string): boolean {
    const envMasters = ['BB', 'KIDS'].map(p => process.env[`MASTER_${p}_USERNAME`]?.toLowerCase()).filter(Boolean)
    return id.startsWith('master_') && (!envMasters.length || envMasters.includes(id.slice(7).toLowerCase()))
}

// แจ้งเตือนของบริษัทที่ Master (LINE ลอย) เปิดรับเองได้ — ปิดเป็นค่าเริ่มต้น
// ป้ายปุ่มตอบด่วนของ LINE ยาวได้ไม่เกิน 20 ตัวอักษร (รวมเครื่องหมายหน้าชื่อ) → ชื่อชนิดต้องสั้น
const MASTER_NOTIFY_KINDS: [string, string][] = [['shift', 'ปิดกะ'], ['approval', 'คำขออนุมัติ'], ['work_order', 'ใบสั่งผลิต'], ['purchase', 'ใบขอซื้อ'], ['daily', 'สรุปผู้บริหาร']]

export const companyLogoUrl = (tenantId: string) => {
    const row = getDb().prepare('SELECT logo_base64 FROM company_settings WHERE tenant_id = ?').get(tenantId) as any
    if (!row?.logo_base64 || !row.logo_base64.trim()) return undefined
    const base = process.env.APP_URL ?? 'https://erp.phopy.net'
    return `${base}/api/line/logo/${tenantId}`
}

// ─── Paperclip API ────────────────────────────────────────────────────────────
const PAPERCLIP_URL        = process.env.PAPERCLIP_URL
const PAPERCLIP_API_KEY    = process.env.PAPERCLIP_API_KEY
const PAPERCLIP_COMPANY_ID = process.env.PAPERCLIP_COMPANY_ID
const PAPERCLIP_AGENT_ID   = process.env.PAPERCLIP_AGENT_ID

if (!PAPERCLIP_URL || !PAPERCLIP_API_KEY || !PAPERCLIP_COMPANY_ID || !PAPERCLIP_AGENT_ID) {
  console.warn('⚠️ Paperclip credentials not fully configured. LINE→Paperclip task creation disabled.')
}

async function createPaperclipTask(title: string, description: string): Promise<string> {
    try {
        const res = await fetch(`${PAPERCLIP_URL}/api/companies/${PAPERCLIP_COMPANY_ID}/issues`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PAPERCLIP_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                title,
                description,
                assigneeAgentId: PAPERCLIP_AGENT_ID,
                priority: 'medium',
                status: 'todo',
            }),
        })
        const data: any = await res.json()
        const identifier = data.identifier ?? data.id ?? '?'

        // Trigger agent heartbeat so it picks up the task immediately
        if (identifier !== '?') {
            fetch(`${PAPERCLIP_URL}/api/agents/${PAPERCLIP_AGENT_ID}/heartbeat/invoke`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${PAPERCLIP_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            }).catch(e => console.error('Paperclip heartbeat error:', e))
        }

        return identifier
    } catch (err) {
        console.error('Paperclip createTask error:', err)
        return '?'
    }
}

const BULK_PUSH_CAP = () => Number(process.env.LINE_BULK_PUSH_CAP) || 100

// ─── Quick Reply Items ────────────────────────────────────────────────────────
function quickReplyItems(isPersonal: boolean) {
    const items: any[] = [
        { type: 'action', action: { type: 'message', label: '📊 สถานะงาน',    text: 'สถานะ' } },
        { type: 'action', action: { type: 'message', label: '📦 เช็คสต็อก',   text: 'สต็อก ' } },
        { type: 'action', action: { type: 'message', label: '📋 ดูสูตร',       text: 'สูตร ' } },
        { type: 'action', action: { type: 'message', label: '🛒 ออเดอร์',      text: 'ออเดอร์' } },
        { type: 'action', action: { type: 'message', label: '❓ ช่วยเหลือ',    text: '-help' } },
    ]
    if (isPersonal) {
        // ปุ่ม HR + เปลี่ยนบริษัท อยู่หน้าสุด — รูปริชเมนูยังไม่มีปุ่มสองอย่างนี้
        items.unshift(
            { type: 'action', action: { type: 'message', label: '👤 ของฉัน (HR)', text: 'ของฉัน' } },
            { type: 'action', action: { type: 'message', label: '🏢 เปลี่ยนบริษัท', text: 'เปลี่ยนบริษัท' } },
        )
        items.splice(6, 0, {
            type: 'action', action: { type: 'message', label: '🔗 เชื่อมบัญชี', text: 'วิธีเชื่อมบัญชี' }
        })
    }
    return items.slice(0, 13) // LINE max 13 items
}

// ─── Source helpers ────────────────────────────────────────────────────────────
function sourceType(event: any): 'user' | 'group' | 'room' {
    return event.source?.type ?? 'user'
}

// ─── Service ──────────────────────────────────────────────────────────────────
class LineBotService {

    // ── Client factory ────────────────────────────────────────────────────────
    // Returns a v8-compatible wrapper around @line/bot-sdk v11 MessagingApiClient
    private getClient(tenantId: string): any | null {
        if (!Client) return null
        const db = getDb()
        // OA กลาง Phopy-ERP ตัวเดียวทุกร้าน — tenantId ไม่ได้เลือกช่องแล้ว ใครได้ข้อความตัดสินที่ mapping ที่ผูกด้วยรหัส 6 หลัก
        const config = centralChannel()
        if (!config) return null
        const inner = new Client({ channelAccessToken: config.channel_access_token })
        // Wrap v11 API to be compatible with v8 call signatures used throughout this service
        const wrap = (msgs: any) => Array.isArray(msgs) ? msgs : [msgs]
        // ทุกข้อความขาออกผ่าน 2 ทางนี้เท่านั้น → บันทึก log ที่เดียว (สำเร็จ/ล้มเหลว) แล้วส่งผลเดิมต่อ
        const sent = <T>(kind: string, to: string | undefined, messages: any, p: Promise<T>): Promise<T> => {
            const t0 = Date.now()
            const base = { tenantId, direction: 'OUT' as const, kind, target: to, summary: describeMessages(messages) }
            return p.then(
                r => { logLine({ ...base, ms: Date.now() - t0 }); return r },
                e => { logLine({ ...base, ok: false, error: e, ms: Date.now() - t0 }); throw e },
            )
        }
        return {
            token: config.channel_access_token as string,
            replyMessage: (replyToken: string, messages: any) =>
                sent('reply', undefined, messages, inner.replyMessage({ replyToken, messages: wrap(messages) })),
            pushMessage: (to: string, messages: any) =>
                sent('push', to, messages, inner.pushMessage({ to, messages: wrap(messages) })),
            getProfile: (userId: string) => inner.getProfile(userId),
            getMessageQuota: () => inner.getMessageQuota(),
            getMessageQuotaConsumption: () => inner.getMessageQuotaConsumption(),
            getGroupMemberProfile: (groupId: string, userId: string) =>
                inner.getGroupMemberProfile(groupId, userId),
            getRoomMemberProfile: (roomId: string, userId: string) =>
                inner.getRoomMemberProfile(roomId, userId),
            getMessageContent: async (messageId: string): Promise<Buffer> => {
                const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
                    headers: { Authorization: `Bearer ${config.channel_access_token}` },
                })
                if (!res.ok) throw new Error(`LINE content fetch failed: HTTP ${res.status}`)
                const buf = Buffer.from(await res.arrayBuffer())
                if (buf.length > 10 * 1024 * 1024) throw new Error('LINE content exceeds 10MB')
                return buf
            },
        }
    }

    // ── Tenant resolution ─────────────────────────────────────────────────────
    public verifySignature(signature: string, bodyRaw: Buffer | string): boolean {
        const ch = centralChannel()
        if (!validateSignature || !ch) return false
        try { return !!validateSignature(bodyRaw, ch.channel_secret, signature) } catch { return false }
    }

    /** ร้านของ event: กลุ่ม → กลุ่มที่ผูกรหัสไว้ · แชทส่วนตัว → บัญชีที่ผูกล่าสุด · ยังไม่ผูก = '' (ทำได้แค่ผูกบัญชี/ดูวิธี) */
    public resolveTenant(event: any): string {
        const db = getDb()
        const groupId = event.source?.groupId ?? event.source?.roomId
        if (groupId) {
            const g = db.prepare('SELECT tenant_id FROM line_group_mappings WHERE group_id = ? AND is_active = 1 ORDER BY joined_at DESC LIMIT 1').get(groupId) as any
            return g?.tenant_id ?? ''
        }
        // Master: LINE ลอย ไม่ผูกบริษัท — ไปที่บริษัทที่เลือกดูอยู่ (as_member = 1 คือใช้บัญชีทดสอบ ตามตาราง mapping ปกติ)
        const ml = this.masterLink(event.source?.userId ?? '')
        if (ml && !ml.as_member) return ml.view_tenant_id || ''
        // LINE เดียวผูกหลายร้านได้ — แชทส่วนตัวไปที่ร้านที่เลือกล่าสุด (คำสั่ง "เปลี่ยนบริษัท") ถ้าไม่เคยเลือกคือร้านที่ผูกล่าสุด
        // ข้ามร้านที่บัญชีถูกระงับ — ไม่งั้นคนที่ผูกหลายร้านจะค้างอยู่ที่ร้านที่ใช้ไม่ได้และสลับออกไม่ได้
        const m = db.prepare(`
            SELECT lum.tenant_id FROM line_user_mappings lum LEFT JOIN users u ON u.id = lum.user_id
            WHERE lum.line_user_id = ? AND (u.id IS NULL OR u.status = 'active')
            ORDER BY COALESCE(lum.active_at, lum.linked_at) DESC LIMIT 1
        `).get(event.source?.userId ?? '') as any
        return m?.tenant_id ?? ''
    }

    /** ตั้งร้านที่ใช้อยู่ของ LINE นี้ — ล้าง active_at ร้านอื่นเพื่อให้ลำดับชัดแม้เวลาชนกันในวินาทีเดียว */
    private setActiveTenant(lineUserId: string, tenantId: string) {
        getDb().prepare(`UPDATE line_user_mappings SET active_at = CASE WHEN tenant_id = ? THEN strftime('%Y-%m-%d %H:%M:%f', 'now') END WHERE line_user_id = ?`)
            .run(tenantId, lineUserId)
    }

    /** แถว line_master_links ของ LINE นี้ (Master ที่ผูกแล้ว) */
    private masterLink(lineUserId: string): any | undefined {
        const m = getDb().prepare('SELECT * FROM line_master_links WHERE line_user_id = ?').get(lineUserId) as any
        // Master ถูกถอดออกจาก .env → LINE หมดสิทธิ์ Master ด้วย (บัญชีเว็บล็อกอินไม่ได้แล้ว)
        return m && isMasterId(String(m.master_id)) ? m : undefined
    }

    /** Master ที่ "ลอย" อยู่ (ไม่ได้ใช้บัญชีทดสอบ) */
    private floatingLink(lineUserId: string): any | undefined {
        const m = this.masterLink(lineUserId)
        return m && !m.as_member ? m : undefined
    }

    /** LINE ของ Master ที่เปิดรับแจ้งเตือนชนิดนี้ของบริษัทนี้ */
    private masterSubscribers(tenantId: string, kind: string): string[] {
        return (getDb().prepare(`
            SELECT n.line_user_id, l.master_id FROM line_master_notify n JOIN line_master_links l ON l.line_user_id = n.line_user_id
            WHERE n.tenant_id = ? AND n.kind = ?
        `).all(tenantId, kind) as any[]).filter(r => isMasterId(String(r.master_id))).map(r => r.line_user_id as string)
    }

    /** ข้อความรายการแจ้งเตือนของบริษัทที่ Master ดูอยู่ + ปุ่มเปิด/ปิด */
    private masterNotifyMessage(lineUserId: string, tenantId: string) {
        const on = new Set((getDb().prepare('SELECT kind FROM line_master_notify WHERE line_user_id = ? AND tenant_id = ?').all(lineUserId, tenantId) as any[]).map(r => r.kind as string))
        const mark = (k: string) => on.has(k) ? '✅' : '⬜'
        return {
            type: 'text',
            text: `แจ้งเตือนของ ${companyName(tenantId) || tenantId}\n${MASTER_NOTIFY_KINDS.map(([k, n]) => `${mark(k)} ${n}`).join('\n')}\nกดปุ่มเพื่อเปิด/ปิด`,
            quickReply: { items: MASTER_NOTIFY_KINDS.map(([k, n]) => ({
                type: 'action', action: { type: 'postback', label: `${mark(k)} ${n}`, data: `action=master_notify&kind=${k}`, displayText: n },
            })) },
        }
    }

    /** ปุ่มเลือกบริษัท (quick reply สูงสุด 13 ปุ่ม, label สูงสุด 20 ตัวอักษร) */
    private companyButtons(rows: { tenant_id: string; name: string }[]) {
        return rows.map(r => {
            const name = r.name || r.tenant_id
            return { type: 'action', action: { type: 'postback', label: name.slice(0, 20), data: `action=switch_tenant&id=${encodeURIComponent(r.tenant_id)}`, displayText: name } }
        })
    }

    /** ข้อความถึง Master ทุกคนที่ผูก LINE ไว้ — แจ้งเตือนระดับ Master เสมอ · ไม่ throw */
    public async notifyMasters(text: string) {
        try {
            const client = this.getClient('')
            if (!client) return
            const rows = (getDb().prepare('SELECT line_user_id, master_id FROM line_master_links').all() as { line_user_id: string; master_id: string }[]).filter(r => isMasterId(String(r.master_id)))
            for (const r of rows) {
                try { await client.pushMessage(r.line_user_id, { type: 'text', text }) } catch (err) {
                    console.error(`notifyMasters push failed → ${r.line_user_id}:`, err)
                }
            }
        } catch (err) { console.error('notifyMasters failed:', err) }
    }

    /** push ให้ Master ที่เปิดรับชนิดนี้ของบริษัทนี้ (ข้ามคนที่มีแถวใน mapping ของบริษัท = ได้ตามตำแหน่งปกติแล้ว) */
    private async pushToMasterSubscribers(tenantId: string, kind: string, message: any) {
        const client = this.getClient(tenantId)
        if (!client) return
        const has = getDb().prepare('SELECT 1 FROM line_user_mappings WHERE tenant_id = ? AND line_user_id = ?')
        for (const id of this.masterSubscribers(tenantId, kind)) {
            if (has.get(tenantId, id)) continue
            try { await client.pushMessage(id, message) } catch (err) {
                console.error(`pushToMasterSubscribers failed → ${id}:`, err)
            }
        }
    }

    /** แจ้ง Master ครั้งเดียวต่อ key (บันทึก key หลังส่งแล้วเท่านั้น) */
    private async alertMastersOnce(key: string, text: string) {
        const db = getDb()
        if (db.prepare('SELECT 1 FROM line_master_alerts WHERE key = ?').get(key)) return
        if (!db.prepare('SELECT 1 FROM line_master_links LIMIT 1').get()) return
        await this.notifyMasters(text)
        db.prepare("INSERT OR IGNORE INTO line_master_alerts (key, sent_at) VALUES (?, datetime('now'))").run(key)
    }

    /** แจ้ง Master รายวัน: แพ็กเกจใกล้หมด/หมดแล้ว + โควตาข้อความ LINE ≥ 80% · เรียกจาก cron 09:00 */
    public async runMasterDailyAlerts(today: string) {
        const day = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`)
        try {
            const subs = getDb().prepare(`SELECT tenant_id, current_period_end FROM tenant_subscriptions WHERE status IN ('ACTIVE', 'TRIAL') AND current_period_end IS NOT NULL`).all() as any[]
            for (const s of subs) {
                const end = String(s.current_period_end).slice(0, 10)
                const left = Math.round((day(end) - day(today)) / 86400000)
                const name = companyName(s.tenant_id) || s.tenant_id
                if (left >= 0 && left <= 7) await this.alertMastersOnce(`sub7:${s.tenant_id}:${s.current_period_end}`, `⏳ แพ็กเกจ ${name} จะหมด ${end}`)
                else if (left < 0 && left >= -3) await this.alertMastersOnce(`subx:${s.tenant_id}:${s.current_period_end}`, `⛔ แพ็กเกจ ${name} หมดอายุแล้ว ${end}`)
            }
        } catch (err) { console.error('[MasterAlerts] subscription check failed:', err) }
        try {
            const client = this.getClient('')
            if (client?.getMessageQuota) {
                const quota = await client.getMessageQuota()
                const used = (await client.getMessageQuotaConsumption()).totalUsage
                if (quota?.type === 'limited' && quota.value > 0 && used >= quota.value * 0.8) {
                    await this.alertMastersOnce(`quota80:${today.slice(0, 7)}`, `📨 โควตาข้อความ LINE ใช้ไป ${used}/${quota.value} (${Math.round(used / quota.value * 100)}%) เดือนนี้`)
                }
            }
        } catch (err) { console.error('[MasterAlerts] LINE quota check failed:', err) }
    }

    /** ร้านทั้งหมดที่ LINE นี้ผูกไว้ */
    private linkedTenants(lineUserId: string): { tenantId: string; name: string }[] {
        return (getDb().prepare('SELECT DISTINCT tenant_id FROM line_user_mappings WHERE line_user_id = ? ORDER BY linked_at').all(lineUserId) as any[])
            .map(r => ({ tenantId: r.tenant_id, name: companyName(r.tenant_id) || r.tenant_id }))
    }

    // ── Push helpers ──────────────────────────────────────────────────────────
    public async pushToRole(tenantId: string, role: string, message: any) {
        const client = this.getClient(tenantId)
        if (!client) return
        const db = getDb()
        const users = db.prepare(
            'SELECT line_user_id FROM line_user_mappings WHERE tenant_id = ? AND role = ?'
        ).all(tenantId, role) as any[]
        for (const u of users) {
            try { await client.pushMessage(u.line_user_id, message) } catch (err) {
                console.error(`pushToRole failed for ${u.line_user_id}:`, err)
            }
        }
    }

    /** push หาผู้ใช้คนเดียว (ถ้าผูก LINE และบัญชียัง active) — คืน true เมื่อส่งสำเร็จ · push กินโควตารายเดือนของ OA กลาง ใช้เท่าที่จำเป็น */
    // shortcut: เพดานคงที่ต่อบริษัท (ค่าเริ่ม 100/เดือน) กันบริษัทเดียวกินโควตา 300 ของ OA กลางหมด — ซื้อแพ็กเกจข้อความแล้วค่อยปรับ LINE_BULK_PUSH_CAP
    public pushQuotaLeft(tenantId: string): number {
        const row = getDb().prepare('SELECT n FROM line_push_counts WHERE tenant_id = ? AND month = ?').get(tenantId, thaiToday().slice(0, 7)) as { n: number } | undefined
        return Math.max(0, BULK_PUSH_CAP() - (row?.n ?? 0))
    }

    /** จอง 1 ข้อความจากเพดาน push รายเดือนของบริษัท (อะตอมมิก) — false = เต็มแล้ว */
    private claimPush(tenantId: string): boolean {
        return getDb().prepare(`INSERT INTO line_push_counts (tenant_id, month, n) VALUES (?, ?, 1)
            ON CONFLICT(tenant_id, month) DO UPDATE SET n = n + 1 WHERE n < ?`).run(tenantId, thaiToday().slice(0, 7), BULK_PUSH_CAP()).changes > 0
    }

    public async pushToUser(tenantId: string, userId: string, message: any): Promise<boolean> {
        const client = this.getClient(tenantId)
        if (!client) return false
        const m = getDb().prepare(`
            SELECT lum.line_user_id FROM line_user_mappings lum LEFT JOIN users u ON u.id = lum.user_id
            WHERE lum.tenant_id = ? AND lum.user_id = ? AND (u.id IS NULL OR u.status = 'active')
        `).get(tenantId, userId) as { line_user_id: string } | undefined
        if (!m) return false
        // จองโควตาก่อนส่ง (อะตอมมิก) — เต็มแล้วไม่ส่ง
        if (!this.claimPush(tenantId)) { console.warn(`pushToUser: โควตา push ของ ${tenantId} เดือนนี้เต็มแล้ว`); return false }
        // รับข้อความตัวอักษรเปล่าด้วย — LINE รับเฉพาะ object
        try { await client.pushMessage(m.line_user_id, typeof message === 'string' ? { type: 'text', text: message } : message); return true }
        catch (err) { console.error(`pushToUser failed → ${userId}:`, err); return false }
    }

    public async pushToAllGroups(tenantId: string, message: any) {
        const client = this.getClient(tenantId)
        if (!client) return
        const db = getDb()
        const groups = db.prepare(
            'SELECT group_id FROM line_group_mappings WHERE tenant_id = ? AND is_active = 1'
        ).all(tenantId) as any[]
        for (const g of groups) {
            try { await client.pushMessage(g.group_id, message) } catch (err) {
                console.error(`pushToAllGroups failed for ${g.group_id}:`, err)
            }
        }
    }

    // ── Work Order notifications ───────────────────────────────────────────────
    // ── PR status notification (called from web API after approve/reject) ────
    public async notifyPRStatus(
        tenantId: string,
        pr: {
            id: string; prNumber: string; supplierName: string
            status: 'APPROVED' | 'REJECTED'
            requesterLineUserId?: string; sourceGroupId?: string
            approverName: string; rejectionReason?: string
        }
    ) {
        const client = this.getClient(tenantId)
        if (!client) return

        const webUrl = `${process.env.APP_URL ?? 'https://erp.phopy.net'}/purchase-requests/${pr.id}`
        const card = flexTemplates.prStatusCard({ ...pr, webUrl })

        const targets = new Set<string>()
        if (pr.requesterLineUserId) targets.add(pr.requesterLineUserId)
        if (pr.sourceGroupId)       targets.add(pr.sourceGroupId)
        this.masterSubscribers(tenantId, 'purchase').forEach(id => targets.add(id))
        for (const target of targets) {
            try { await client.pushMessage(target, card) } catch (err) {
                console.error(`notifyPRStatus push failed → ${target}:`, err)
            }
        }
    }

    public async notifyWorkOrderCreated(tenantId: string, wo: any) {
        const msg = flexTemplates.workOrderCard(wo)
        await Promise.all([
            this.pushToRole(tenantId, 'USER',    msg),
            this.pushToRole(tenantId, 'MANAGER', msg),
            this.pushToRole(tenantId, 'MASTER',  msg),
            this.pushToMasterSubscribers(tenantId, 'work_order', msg),
            this.pushToAllGroups(tenantId, msg),
        ])
    }

    public async notifyWorkOrderStatusChanged(tenantId: string, wo: any) {
        const msg = flexTemplates.statusChangedCard(wo)
        await Promise.all([
            this.pushToRole(tenantId, 'MASTER',  msg),
            this.pushToMasterSubscribers(tenantId, 'work_order', msg),
            this.pushToRole(tenantId, 'MANAGER', msg),
            this.pushToAllGroups(tenantId, msg),
        ])
    }


    /** LINE ส่วนตัวของ ADMIN/MASTER ใน tenant (ไม่รวมกลุ่ม) */
    private adminLineUsers(tenantId: string): { line_user_id: string }[] {
        return getDb().prepare(`
            SELECT DISTINCT lum.line_user_id
            FROM line_user_mappings lum
            LEFT JOIN users u ON lum.user_id = u.id AND (lum.tenant_id = u.tenant_id OR u.tenant_id IS NULL)
            WHERE lum.tenant_id = ? 
              AND (
                u.role IN ('ADMIN', 'MASTER')
                OR lum.role IN ('ADMIN', 'MASTER')
              )
        `).all(tenantId) as { line_user_id: string }[]
    }

    // โควตา LINE: push/multicast/broadcast นับต่อ "ผู้รับ" — push เข้ากลุ่มกิน 1 ข้อความต่อสมาชิกทุกคน (กลุ่ม 10 คน = 10)
    // reply (replyToken) ฟรีไม่นับโควตา → กลุ่มดูสรุปปิดกะด้วยคำสั่ง "สรุปการปิดกะ" แทนการ push (OA กลางมี 300/เดือนรวมทุกบริษัท)
    public async notifyShiftClosed(tenantId: string, summary: any) {
        const client = this.getClient(tenantId)
        if (!client || !summary) return
        const card = flexTemplates.shiftCloseCard({ ...summary, webUrl: process.env.APP_URL ?? 'https://erp.phopy.net' })
        for (const line_user_id of new Set([...this.adminLineUsers(tenantId).map(u => u.line_user_id), ...this.masterSubscribers(tenantId, 'shift')])) {
            if (!this.claimPush(tenantId)) { console.warn(`notifyShiftClosed: โควตา push ของ ${tenantId} เดือนนี้เต็มแล้ว`); break }
            try { await client.pushMessage(line_user_id, card) } catch (err) {
                console.error(`notifyShiftClosed push failed → ${line_user_id}:`, err)
            }
        }
    }

    // ponytail: ชื่อคอลัมน์เดิมยังเป็น line_shift_expense_groups — ตอนนี้คุมว่า "คนในกลุ่มพิมพ์ สรุปการปิดกะ ดูได้ไหม" (ไม่ push เข้ากลุ่มแล้ว)
    private shiftToGroups(tenantId: string): boolean {
        const cfg = getDb().prepare('SELECT line_shift_expense_groups FROM company_settings WHERE tenant_id = ?').get(tenantId) as any
        return cfg?.line_shift_expense_groups === 1
    }

    // ── สรุปผู้บริหาร 09:00 (Exec Dashboard Digest) ─────────────────────────
    public async sendExecDigests(today: string) {
        const tenants = (getDb().prepare(`
            SELECT DISTINCT tenant_id FROM company_settings WHERE tenant_id IS NOT NULL AND tenant_id != ''
            UNION
            SELECT DISTINCT tenant_id FROM line_user_mappings WHERE tenant_id IS NOT NULL AND tenant_id != ''
        `).all() as any[]).map(r => r.tenant_id as string)

        const yesterday = addDaysStr(today, -1)

        for (const tenantId of tenants) {
            try {
                const tenantClient = this.getClient(tenantId)
                if (!tenantClient) continue

                const recipients = new Set<string>([
                    ...this.adminLineUsers(tenantId).map(u => u.line_user_id),
                    ...this.masterSubscribers(tenantId, 'daily'),
                ])
                if (recipients.size === 0) continue

                const digest = buildExecDigest(tenantId, yesterday, today)
                if (digest.sales === 0 && digest.purchases === 0 && digest.withdrawals === 0 && (!digest.deliveries || digest.deliveries.length === 0)) {
                    continue
                }

                const card = flexTemplates.execDigestCard({
                    ...digest,
                    company: companyName(tenantId),
                    logoUrl: companyLogoUrl(tenantId),
                })

                // วันละครั้งต่อบริษัท — cron ซ้ำ/รีสตาร์ทตอน 9 โมงต้องไม่ส่งซ้ำ (claim แบบ sync ก่อน await แรก)
                if (!getDb().prepare("INSERT OR IGNORE INTO line_master_alerts (key, sent_at) VALUES (?, datetime('now'))").run(`exec_digest:${tenantId}:${today}`).changes) continue
                for (const lineUserId of recipients) {
                    if (!this.claimPush(tenantId)) {
                        console.warn(`sendExecDigests: โควตา push ของ ${tenantId} เดือนนี้เต็มแล้ว`)
                        break
                    }
                    try {
                        await tenantClient.pushMessage(lineUserId, card)
                    } catch (err) {
                        console.error(`sendExecDigests push failed → ${lineUserId}:`, err)
                    }
                }
            } catch (err: any) {
                console.error(`[sendExecDigests] tenant ${tenantId} failed:`, err.message)
            }
        }
    }

    // ── Approval notifications (Samsung One UI 9 Flex Card) ───────────────────
    public async notifyApprovalRequest(tenantId: string, req: any) {
        const client = this.getClient(tenantId)
        if (!client) return

        const db = getDb()
        // 1. Target: ADMIN and MASTER in this tenant (check users table or line_user_mappings)
        const blanketUsers = this.adminLineUsers(tenantId)

        // 2. Specific module approvers from user_approval_permissions
        const specificUsers = db.prepare(`
            SELECT lum.line_user_id
            FROM user_approval_permissions uap
            JOIN line_user_mappings lum ON uap.user_id = lum.user_id AND uap.tenant_id = lum.tenant_id
            WHERE uap.tenant_id = ? AND uap.module_type = ? AND uap.can_approve = 1
        `).all(tenantId, req.module_type) as { line_user_id: string }[]

        const targets = new Set<string>()
        blanketUsers.forEach(u => targets.add(u.line_user_id))
        specificUsers.forEach(u => targets.add(u.line_user_id))
        this.masterSubscribers(tenantId, 'approval').forEach(id => targets.add(id))
        // คำขอ HR: หัวหน้าแผนกอนุมัติลาลูกทีมได้โดยไม่ต้องเป็น ADMIN → แจ้งทุกคนที่อนุมัติรายการนี้ได้จริง (กติกาเดียวกับปุ่ม "รออนุมัติ")
        if (['leave', 'advance', 'shift_swap', 'offsite'].includes(req.module_type)) {
            const linked = db.prepare(`
                SELECT lum.line_user_id, lum.user_id, u.email, COALESCE(u.role, lum.role) AS role
                FROM line_user_mappings lum LEFT JOIN users u ON u.id = lum.user_id
                WHERE lum.tenant_id = ? AND lum.user_id != ?
            `).all(tenantId, req.requester_id ?? '') as any[]
            for (const u of linked) {
                if (canApprove(tenantId, { userId: u.user_id, email: u.email ?? '', role: u.role }, req.module_type, Number(req.amount) || 0, req.reference_id)) targets.add(u.line_user_id)
            }
        }

        if (targets.size === 0) return

        const webUrl = process.env.APP_URL ?? 'https://erp.phopy.net'
        const card = (flexTemplates as any).approvalRequestCard({
            id: req.id,
            requestNumber: req.request_number,
            moduleType: req.module_type,
            requesterName: req.requester_name,
            requesterRole: req.requester_role,
            amount: req.amount,
            description: req.description,
            createdAt: req.created_at,
            webUrl,
        })

        for (const lineUserId of targets) {
            try {
                await client.pushMessage(lineUserId, card)
            } catch (err) {
                console.error(`notifyApprovalRequest push failed → ${lineUserId}:`, err)
            }
        }
    }

    public async notifyApprovalDecision(
        tenantId: string,
        req: any,
        decision: 'APPROVED' | 'REJECTED',
        approverName: string,
        comment?: string
    ) {
        const client = this.getClient(tenantId)
        if (!client) return

        const db = getDb()
        // Target: Requester's line_user_id
        const userMapping = db.prepare(
            'SELECT line_user_id FROM line_user_mappings WHERE tenant_id = ? AND user_id = ?'
        ).get(tenantId, req.requester_id) as { line_user_id: string } | undefined

        if (!userMapping?.line_user_id) return

        const webUrl = process.env.APP_URL ?? 'https://erp.phopy.net'
        const card = (flexTemplates as any).approvalDecisionCard({
            requestNumber: req.request_number,
            moduleType: req.module_type,
            decision,
            approverName,
            comment,
            decidedAt: new Date().toISOString(),
            webUrl,
        })

        try {
            await client.pushMessage(userMapping.line_user_id, card)
        } catch (err) {
            console.error(`notifyApprovalDecision push failed → ${userMapping.line_user_id}:`, err)
        }
    }

    // ── Account linking ───────────────────────────────────────────────────────
    /** Generate a short-lived 6-digit token; returns the plain token */
    public generateLinkToken(tenantId: string, userId: string): string {
        const db = getDb()
        // Invalidate previous tokens for this user (+ ของที่หมดอายุทุกคน)
        db.prepare('DELETE FROM line_link_tokens WHERE user_id = ? OR expires_at < ?').run(userId, new Date().toISOString())
        // รหัสต้องไม่ซ้ำข้ามร้าน เพราะ OA กลางรู้ว่าเป็นร้านไหนก็จากรหัสนี้
        let token: string
        do { token = crypto.randomInt(100000, 1000000).toString() }
        while (db.prepare('SELECT 1 FROM line_link_tokens WHERE token = ?').get(token))
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
        db.prepare(
            'INSERT INTO line_link_tokens (id, tenant_id, user_id, token, expires_at) VALUES (lower(hex(randomblob(12))), ?, ?, ?, ?)'
        ).run(tenantId, userId, token, expiresAt)
        return token
    }

    /** ลิงก์ใช้ครั้งเดียวเข้าหน้า "ของฉัน" (แลกเป็น token scope hr_self ที่ POST /api/auth/line-login) */
    public createLoginLink(tenantId: string, userId: string): string {
        const db = getDb()
        const token = crypto.randomBytes(32).toString('hex')
        const now = new Date()
        db.prepare('DELETE FROM line_login_tokens WHERE expires_at < ?').run(now.toISOString())
        db.prepare('INSERT INTO line_login_tokens (token_hash, tenant_id, user_id, expires_at) VALUES (?, ?, ?, ?)')
            .run(crypto.createHash('sha256').update(token).digest('hex'), tenantId, userId, new Date(now.getTime() + 5 * 60 * 1000).toISOString())
        return `${process.env.APP_URL ?? 'https://erp.phopy.net'}/line-login?t=${token}`
    }

    /** รหัส 6 หลักไม่ผูกกับร้าน (OA กลาง) — ร้านมาจากเจ้าของรหัสเอง */
    private tryLinkAccount(lineUserId: string, token: string): { result: 'ok' | 'invalid' | 'expired' | 'already_linked'; tenantId: string } {
        const db = getDb()
        const row = db.prepare('SELECT * FROM line_link_tokens WHERE token = ?').get(token) as any
        if (!row) return { result: 'invalid', tenantId: '' }
        const tenantId = row.tenant_id
        if (new Date(row.expires_at) < new Date()) {
            db.prepare('DELETE FROM line_link_tokens WHERE id = ?').run(row.id)
            return { result: 'expired', tenantId }
        }
        // Master: LINE ลอย ไม่ผูกกับบริษัทใด — เก็บใน line_master_links (บริษัทในรหัสเป็นแค่บริษัทที่ดูอยู่ตอนแรก)
        if (String(row.user_id).startsWith('master_')) {
            db.transaction(() => {
                db.prepare(`
                    INSERT INTO line_master_links (line_user_id, master_id, view_tenant_id, demo_role, as_member)
                    VALUES (?, ?, ?, NULL, 0)
                    ON CONFLICT(line_user_id) DO UPDATE SET master_id = excluded.master_id, view_tenant_id = excluded.view_tenant_id,
                        demo_role = NULL, as_member = 0, linked_at = CURRENT_TIMESTAMP
                `).run(lineUserId, row.user_id, tenantId)
                db.prepare('DELETE FROM line_link_tokens WHERE id = ?').run(row.id)
            })()
            return { result: 'ok', tenantId }
        }
        // LINE นี้เคยผูกกับบัญชีอื่นในร้านเดียวกัน → ย้ายมาบัญชีเจ้าของรหัส (รหัสพิสูจน์ว่าถือทั้งบัญชีเว็บและ LINE)
        // เดิมตอบ "เชื่อมแล้ว" แล้วตัน: ลบผูกจากบัญชีหนึ่งแล้วผูกใหม่ด้วยอีกบัญชีไม่ได้เลย
        const user = db.prepare('SELECT role FROM users WHERE id = ?').get(row.user_id) as any
        const role = effectiveRole({ user_id: row.user_id, role: 'USER', user_role: user?.role ?? null })
        db.transaction(() => {
            db.prepare('DELETE FROM line_user_mappings WHERE tenant_id = ? AND line_user_id = ? AND user_id != ?').run(tenantId, lineUserId, row.user_id)
            db.prepare(`
                INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role)
                VALUES (lower(hex(randomblob(12))), ?, ?, ?, ?)
                ON CONFLICT(tenant_id, user_id) DO UPDATE SET line_user_id = excluded.line_user_id, role = excluded.role, linked_at = CURRENT_TIMESTAMP
            `).run(tenantId, row.user_id, lineUserId, role)
            db.prepare('DELETE FROM line_link_tokens WHERE id = ?').run(row.id)
            this.setActiveTenant(lineUserId, tenantId) // ร้านที่เพิ่งผูกเป็นร้านที่ใช้อยู่
        })()
        return { result: 'ok', tenantId }
    }

    /** ผูกกลุ่มกับร้าน: ผู้ดูแลพิมพ์รหัส 6 หลักของตัวเองในกลุ่ม — กลุ่มที่ไม่ได้ผูกจะไม่ได้รับแจ้งเตือนใดๆ */
    private async handleGroupLink(groupId: string, token: string, replyToken: string, client: any) {
        const db = getDb()
        const row = db.prepare('SELECT * FROM line_link_tokens WHERE token = ?').get(token) as any
        const u = row ? db.prepare('SELECT role FROM users WHERE id = ?').get(row.user_id) as any : null
        const role = row ? effectiveRole({ user_id: row.user_id, role: 'USER', user_role: u?.role ?? null }) : ''
        let text: string
        if (!row) text = '❌ รหัสไม่ถูกต้อง\nขอรหัสใหม่ได้ที่ ตั้งค่า > LINE ในระบบ'
        else if (new Date(row.expires_at) < new Date()) text = '⏰ รหัสหมดอายุแล้ว (มีอายุ 10 นาที)\nขอรหัสใหม่ได้ที่ ตั้งค่า > LINE'
        else if (!['ADMIN', 'MASTER', 'OWNER'].includes(role)) text = '🔒 ผูกกลุ่มได้เฉพาะรหัสของผู้ดูแล (Admin/Master)'
        // กลุ่มผูกกับบริษัทอื่นอยู่: ผู้ดูแลของอีกบริษัทที่อยู่ในกลุ่มต้องย้ายเองไม่ได้ (การ์ดยอดขายของเขาจะไหลเข้ากลุ่มนี้แทน)
        else if (db.prepare('SELECT 1 FROM line_group_mappings WHERE group_id = ? AND is_active = 1 AND tenant_id != ?').get(groupId, row.tenant_id))
            text = '🔒 กลุ่มนี้ผูกกับบริษัทอื่นอยู่\nถ้าจะย้าย ให้เชิญบอทออกจากกลุ่มแล้วเชิญเข้าใหม่ก่อนส่งรหัส'
        else {
            db.transaction(() => {
                db.prepare('UPDATE line_group_mappings SET is_active = 0 WHERE group_id = ? AND tenant_id != ?').run(groupId, row.tenant_id)
                this.saveGroup(row.tenant_id, groupId)
                db.prepare('DELETE FROM line_link_tokens WHERE id = ?').run(row.id)
            })()
            text = `✅ ผูกกลุ่มนี้กับ ${companyName(row.tenant_id)} แล้ว\nกลุ่มนี้จะได้รับแจ้งเตือนของบริษัทนี้`
        }
        await client.replyMessage(replyToken, { type: 'text', text })
    }

    // ── Group membership ──────────────────────────────────────────────────────
    private saveGroup(tenantId: string, groupId: string) {
        const db = getDb()
        db.prepare(`
            INSERT INTO line_group_mappings (id, tenant_id, group_id, is_active)
            VALUES (lower(hex(randomblob(12))), ?, ?, 1)
            ON CONFLICT(tenant_id, group_id) DO UPDATE SET is_active = 1
        `).run(tenantId, groupId)
    }

    private deactivateGroup(tenantId: string, groupId: string) {
        const db = getDb()
        db.prepare(
            'UPDATE line_group_mappings SET is_active = 0 WHERE tenant_id = ? AND group_id = ?'
        ).run(tenantId, groupId)
    }

    // ── Profile helper (works for both personal and group source) ────────────
    private async getDisplayName(client: any, event: any): Promise<string> {
        try {
            if (event.source.type === 'group') {
                const p = await client.getGroupMemberProfile(event.source.groupId, event.source.userId)
                return p.displayName
            }
            if (event.source.type === 'room') {
                const p = await client.getRoomMemberProfile(event.source.roomId, event.source.userId)
                return p.displayName
            }
            const p = await client.getProfile(event.source.userId)
            return p.displayName
        } catch {
            return 'LINE User'
        }
    }

    // ── PR command ────────────────────────────────────────────────────────────
    private async handlePRCommand(
        tenantId: string, event: any, client: any,
        parsed: { supplierName: string; items: string[] }
    ) {
        const db = getDb()

        const requesterName = await this.getDisplayName(client, event)

        const prNumber = generatePRNumber(tenantId)
        const sourceGroupId = event.source.groupId ?? event.source.roomId ?? null

        // สร้าง PR ใน DB
        // ใช้ชื่อ column ที่ compatible กับทั้ง original schema และ LINE schema
        const prId = `pr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        const lineUserId = event.source.userId
        db.prepare(`
            INSERT INTO purchase_requests
              (id, tenant_id, pr_number, supplier_name, status, source,
               requester_id, requester_line_user_id, requester_name, source_group_id)
            VALUES (?, ?, ?, ?, 'DRAFT', 'LINE', ?, ?, ?, ?)
        `).run(prId, tenantId, prNumber, parsed.supplierName,
               lineUserId, lineUserId, requesterName, sourceGroupId)

        // สร้าง items — ต้องส่ง purchase_request_id และ description ด้วย (NOT NULL ใน original schema)
        const insertItem = db.prepare(`
            INSERT INTO purchase_request_items (id, tenant_id, purchase_request_id, pr_id, description, item_name, sort_order)
            VALUES (lower(hex(randomblob(12))), ?, ?, ?, ?, ?, ?)
        `)
        parsed.items.forEach((name, i) => insertItem.run(tenantId, prId, prId, name, name, i))

        const webUrl = `${process.env.APP_URL ?? 'https://erp.phopy.net'}/purchase-requests/${prId}`

        const card = flexTemplates.prDraftCard({
            prNumber,
            supplierName: parsed.supplierName,
            items: parsed.items,
            webUrl,
        })

        await client.replyMessage(event.replyToken, card)
    }

    // ── BOM Draft command (personal chat only) ───────────────────────────────
    private async handleBOMCommand(
        tenantId: string, event: any, client: any,
        parsed: { productName: string; items: { name: string; qty: number; unit: string }[] }
    ) {
        const db = getDb()

        // ── Helper: find existing stock_item by name, or create placeholder ──
        const findOrCreate = (name: string, unit: string, category: string): { id: string; isNew: boolean } => {
            const existing = db.prepare(
                'SELECT id FROM stock_items WHERE tenant_id = ? AND name = ? LIMIT 1'
            ).get(tenantId, name) as any
            if (existing) return { id: existing.id, isNew: false }

            const id  = `si_${crypto.randomBytes(6).toString('hex')}`
            const sku = `LINE-${crypto.randomBytes(4).toString('hex').toUpperCase()}`
            const now = new Date().toISOString()
            db.prepare(`
                INSERT INTO stock_items
                  (id, tenant_id, sku, name, category, unit, location, status, quantity, unit_cost, min_stock, max_stock, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 'ไม่ระบุ', 'ACTIVE', 0, 0, 0, 1000, ?, ?)
            `).run(id, tenantId, sku, name, category, normalizeUnit(unit || 'pcs'), now, now)
            return { id, isNew: true }
        }

        // 1. สินค้าหลัก (product)
        const product = findOrCreate(parsed.productName, 'ชิ้น', 'PRODUCT')

        // 2. Auto-version: นับ BOM ที่มีอยู่ของ product นี้
        const existingCount = (db.prepare(
            'SELECT COUNT(*) as c FROM boms WHERE product_id = ? AND tenant_id = ?'
        ).get(product.id, tenantId) as any).c
        const version = `v${existingCount + 1}`

        // 3. สร้าง BOM (DRAFT)
        const bomId = `bom_${crypto.randomBytes(7).toString('hex')}`
        const now   = new Date().toISOString()
        db.prepare(`
            INSERT INTO boms (id, tenant_id, product_id, version, status, level, is_semi_finished, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'DRAFT', 0, 0, ?, ?)
        `).run(bomId, tenantId, product.id, version, now, now)

        // 4. สร้าง bom_items — find/create วัตถุดิบแต่ละตัว
        const insertItem = db.prepare(`
            INSERT INTO bom_items (id, tenant_id, bom_id, item_type, material_id, quantity, notes, sort_order)
            VALUES (?, ?, ?, 'MATERIAL', ?, ?, '', ?)
        `)
        const newItems: string[] = []
        parsed.items.forEach((item, i) => {
            const mat = findOrCreate(item.name, item.unit, 'MATERIAL')
            if (mat.isNew) newItems.push(item.name)
            insertItem.run(`bi_${crypto.randomBytes(6).toString('hex')}`, tenantId, bomId, mat.id, item.qty, i)
        })

        const webUrl = `${process.env.APP_URL ?? 'https://erp.phopy.net'}/bom`
        const card = flexTemplates.bomDraftCard({
            productName: parsed.productName,
            version,
            items: parsed.items,
            newItems,
            webUrl,
        })
        await client.replyMessage(event.replyToken, card)
    }

    // ── Text command handlers ─────────────────────────────────────────────────
    private async handleStatusCommand(tenantId: string, replyToken: string, client: any) {
        const db = getDb()
        const inProgress = db.prepare(
            "SELECT wo.*, si.name as product_name FROM work_orders wo LEFT JOIN stock_items si ON wo.bom_id = si.id WHERE wo.tenant_id = ? AND wo.status = 'IN_PROGRESS' ORDER BY wo.created_at DESC LIMIT 10"
        ).all(tenantId) as any[]
        const msg = flexTemplates.statusSummaryCard(inProgress) as any
        msg.quickReply = { items: quickReplyItems(false) }
        await client.replyMessage(replyToken, msg)
    }

    private async handleStockCommand(tenantId: string, query: string, replyToken: string, client: any) {
        const db = getDb()
        const items = db.prepare(
            "SELECT name, sku, quantity, unit, status FROM stock_items WHERE tenant_id = ? AND name LIKE ? LIMIT 5"
        ).all(tenantId, `%${query}%`) as any[]
        const msg = flexTemplates.stockQueryCard(query, items) as any
        msg.quickReply = { items: quickReplyItems(false) }
        await client.replyMessage(replyToken, msg)
    }

    // ── BOM Query: สูตร [ชื่อสินค้า] ─────────────────────────────────────────
    private async handleBOMQueryCommand(tenantId: string, query: string, replyToken: string, client: any) {
        const db = getDb()
        const product = db.prepare(
            'SELECT id, name FROM stock_items WHERE tenant_id = ? AND name LIKE ? LIMIT 1'
        ).get(tenantId, `%${query}%`) as any

        if (!product) {
            await client.replyMessage(replyToken, {
                type: 'text',
                text: `ไม่พบสินค้า "${query}" ในระบบ\nลองพิมพ์ชื่อสั้นลง หรือตรวจสอบชื่อใหม่อีกครั้ง`,
                quickReply: { items: quickReplyItems(false) }
            })
            return
        }

        const bom = db.prepare(
            "SELECT id, version FROM boms WHERE product_id = ? AND tenant_id = ? ORDER BY CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END, created_at DESC LIMIT 1"
        ).get(product.id, tenantId) as any

        if (!bom) {
            await client.replyMessage(replyToken, {
                type: 'text',
                text: `ยังไม่มีสูตรการผลิตสำหรับ "${product.name}"\nสามารถสร้างสูตรได้ที่ erp.phopy.net`,
                quickReply: { items: quickReplyItems(false) }
            })
            return
        }

        const items = db.prepare(`
            SELECT bi.quantity, si.name, si.unit, si.unit_cost
            FROM bom_items bi
            LEFT JOIN stock_items si ON bi.material_id = si.id
            WHERE bi.bom_id = ?
            ORDER BY bi.sort_order
        `).all(bom.id) as any[]

        const totalCost = items.reduce((sum: number, i: any) => sum + (i.quantity * (i.unit_cost ?? 0)), 0)
        const lines = items.map((i: any) =>
            `• ${i.name ?? '?'}: ${i.quantity} ${i.unit ?? ''} — ฿${((i.unit_cost ?? 0) * i.quantity).toFixed(2)}`
        )
        const text = [
            `📋 สูตร: ${product.name} (${bom.version})`,
            '',
            ...lines,
            '',
            `💰 ต้นทุนรวม: ฿${totalCost.toFixed(2)}`,
        ].join('\n')

        await client.replyMessage(replyToken, {
            type: 'text', text,
            quickReply: { items: quickReplyItems(false) }
        })
    }

    // ── Create Paperclip Task: งาน [คำอธิบาย] ────────────────────────────────
    private async handleTaskCommand(
        tenantId: string, lineUserId: string,
        taskText: string, replyToken: string, client: any
    ) {
        const db = getDb()
        // Only registered (linked) users can create tasks
        const mapping = db.prepare(
            'SELECT user_id, role FROM line_user_mappings WHERE tenant_id = ? AND line_user_id = ?'
        ).get(tenantId, lineUserId) as any

        if (!mapping) {
            await client.replyMessage(replyToken, {
                type: 'text',
                text: '🔒 ต้องเชื่อมบัญชีก่อนถึงจะสร้างงานได้\nพิมพ์ "วิธีเชื่อมบัญชี" เพื่อดูวิธี',
                quickReply: { items: quickReplyItems(true) }
            })
            return
        }

        const user = db.prepare('SELECT name FROM users WHERE id = ?').get(mapping.user_id) as any
        const requesterName = user?.name ?? lineUserId
        const description = `สร้างจาก LINE โดย ${requesterName} (${mapping.role})\n\n${taskText}`

        const identifier = await createPaperclipTask(taskText, description)
        const success = identifier !== '?'

        await client.replyMessage(replyToken, {
            type: 'text',
            text: success
                ? `✅ สร้างงาน ${identifier} แล้วครับ\n\n"${taskText}"\n\nทีม AI จะรับงานและแจ้งความคืบหน้าให้ทราบ 🚀`
                : `❌ สร้างงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง`,
            quickReply: { items: quickReplyItems(true) }
        })
    }

    private async handleOrderCommand(tenantId: string, replyToken: string, client: any) {
        const db = getDb()
        const orders = db.prepare(
            // ตาราง orders ไม่มี tenant_id เคย throw ทุกครั้ง — ใช้ sales_orders (alias so_number ให้ recentOrdersCard เดิม)
            "SELECT so_number AS order_number, status, total_amount, created_at FROM sales_orders WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 5"
        ).all(tenantId) as any[]
        const msg = flexTemplates.recentOrdersCard(orders) as any
        msg.quickReply = { items: quickReplyItems(false) }
        await client.replyMessage(replyToken, msg)
    }

    private async handleLinkCommand(lineUserId: string, token: string, replyToken: string, client: any) {
        const { result, tenantId } = this.tryLinkAccount(lineUserId, token)
        const texts: Record<string, string> = {
            ok:            `✅ เชื่อมบัญชีกับ ${companyName(tenantId)} สำเร็จ!\nตอนนี้คุณจะได้รับแจ้งเตือนและสั่งงานผ่าน LINE ได้แล้ว 🎉`,
            invalid:       '❌ รหัสไม่ถูกต้อง\nกรุณาขอรหัสใหม่จากหน้า ตั้งค่า > LINE ในระบบ',
            expired:       '⏰ รหัสหมดอายุแล้ว (มีอายุ 10 นาที)\nกรุณาขอรหัสใหม่จากหน้า ตั้งค่า > LINE',
            already_linked:'ℹ️ LINE นี้เชื่อมกับผู้ใช้อื่นในบริษัทนี้อยู่แล้ว',
        }
        await client.replyMessage(replyToken, {
            type: 'text', text: texts[result],
            quickReply: { items: quickReplyItems(true) }
        })
        const me = result === 'ok' ? this.linkedUser(tenantId, lineUserId) : null
        if (me) await richMenus.syncUser(tenantId, client.token, lineUserId, me.menu)
    }

    // ── ผู้ใช้ที่ผูกแล้ว + role ปัจจุบัน (เลื่อนตำแหน่งในเว็บ → mapping.role ตามทันในข้อความถัดไป) ──
    private linkedUser(tenantId: string, lineUserId: string) {
        const db = getDb()
        // Master ลอย: ดูบริษัท view_tenant_id ได้เสมอโดยไม่ต้องมี mapping · demo_role ทำงานเหมือนเดิม
        const ml = this.masterLink(lineUserId)
        if (ml && !ml.as_member && tenantId === (ml.view_tenant_id || '')) {
            const demo = ['ADMIN', 'MANAGER', 'USER', 'GUEST'].includes(ml.demo_role)
            const role: string = demo ? ml.demo_role : 'MASTER'
            const menu: MenuKey = demo && ml.demo_role === 'GUEST' ? 'guest' : menuKeyForRole(role)
            return { user_id: ml.master_id as string, role, menu, realRole: 'MASTER', demo, name: 'Master', email: String(ml.master_id).slice(7), linked_at: ml.linked_at as string, user_status: null }
        }
        const m = db.prepare(`
            SELECT lum.user_id, lum.role, lum.demo_role, lum.linked_at, u.role AS user_role, u.name, u.email, u.status AS user_status
            FROM line_user_mappings lum LEFT JOIN users u ON u.id = lum.user_id
            WHERE lum.tenant_id = ? AND lum.line_user_id = ?
        `).get(tenantId, lineUserId) as any
        if (!m) return null
        // บัญชีถูกระงับ/ปิดตอนออกงาน → LINE ใช้ไม่ได้ทันที (บัญชี master_* ไม่มีแถวใน users จึงไม่มี status)
        if (m.user_status && m.user_status !== 'active') return null
        const role = effectiveRole(m)
        if (role !== m.role) {
            db.prepare('UPDATE line_user_mappings SET role = ? WHERE tenant_id = ? AND line_user_id = ?').run(role, tenantId, lineUserId)
        }
        // demo: MASTER ดูบอทเป็นตำแหน่งที่ต่ำกว่าได้ — ใช้เฉพาะเมื่อ role จริงเป็น MASTER (ค่าค้างของคนที่ไม่ใช่ MASTER ถูกเมินเสมอ)
        if (role === 'MASTER' && ['ADMIN', 'MANAGER', 'USER', 'GUEST'].includes(m.demo_role)) {
            const menu: MenuKey = m.demo_role === 'GUEST' ? 'guest' : menuKeyForRole(m.demo_role)
            return { ...m, role: m.demo_role as string, menu, realRole: 'MASTER', demo: true }
        }
        return { ...m, role, menu: menuKeyForRole(role) as MenuKey, realRole: role, demo: false }
    }

    // ── เมนูผู้บริหาร / หัวหน้า (ตรวจสิทธิ์ที่นี่ ไม่พึ่งว่าเมนูซ่อนปุ่มไว้) ─────────
    private async handleDailySales(tenantId: string, replyToken: string, client: any) {
        const today = thaiToday()
        const s = posSales(tenantId, today, today)
        const lw = addDaysStr(today, -7)
        const last = posSales(tenantId, lw, lw)
        await client.replyMessage(replyToken, flexTemplates.dailySalesCard({
            company: companyName(tenantId), logoUrl: companyLogoUrl(tenantId), date: today, revenue: s.revenue, bills: s.bills, avgBill: s.avgBill,
            discount: s.discount, byMethod: s.byMethod, cancelled: s.cancelled, lastWeek: last.bills > 0 ? last.revenue : null,
        }))
    }

    private async handleMonthProfit(tenantId: string, replyToken: string, client: any) {
        const to = thaiToday(), from = `${to.slice(0, 7)}-01`
        await client.replyMessage(replyToken, flexTemplates.monthProfitCard({
            company: companyName(tenantId), logoUrl: companyLogoUrl(tenantId), from, to,
            revenue: ledgerRevenue(tenantId, from, to), cogs: ledgerCogs(tenantId, from, to), opex: ledgerOpex(tenantId, from, to),
        }))
    }

    private async handlePendingApprovals(tenantId: string, me: any, replyToken: string, client: any) {
        // ponytail: ดึง 200 แถวล่าสุดแล้วกรองด้วย canApprove ทีละแถว — พอสำหรับร้านเล็ก ถ้าค้างเกินนี้ให้ย้ายเงื่อนไขไปใน SQL
        const rows = (getDb().prepare(`
            SELECT request_number, module_type, reference_id, requester_name, amount, created_at
            FROM approval_requests WHERE tenant_id = ? AND status = 'PENDING'
            ORDER BY created_at DESC LIMIT 200
        `).all(tenantId) as any[])
            .filter(r => canApprove(tenantId, { userId: me.user_id, email: me.email ?? '', role: me.role }, r.module_type, Number(r.amount) || 0, r.reference_id))
        await client.replyMessage(replyToken, flexTemplates.pendingApprovalsCard({
            company: companyName(tenantId), logoUrl: companyLogoUrl(tenantId), total: rows.length,
            rows: rows.slice(0, 6).map(r => ({ requestNumber: r.request_number, moduleType: r.module_type, requesterName: r.requester_name,
                amount: Number(r.amount) || 0, createdAt: r.created_at })),
        }))
    }

    private async handleLowStock(tenantId: string, replyToken: string, client: any) {
        const rows = getLowStockItems(tenantId)
        await client.replyMessage(replyToken, flexTemplates.lowStockCard({
            company: companyName(tenantId), logoUrl: companyLogoUrl(tenantId), total: rows.length,
            rows: rows.slice(0, 8).map((r: any) => ({ name: r.name, available: r.available, minStock: r.min_stock, unit: r.unit })),
        }))
    }

    private async handleMe(tenantId: string, me: any, replyToken: string, client: any) {
        const card = flexTemplates.meCard({
            company: companyName(tenantId), logoUrl: companyLogoUrl(tenantId), name: me.name ?? '', email: me.email ?? '',
            roleLabel: (ROLE_LABEL[me.role] ?? me.role) + (me.demo ? ' (โหมด demo)' : ''), menuLabel: MENUS[me.menu as MenuKey].label, linkedAt: me.linked_at,
        }) as any
        if (me.realRole === 'MASTER') {
            const items: any[] = [{ type: 'action', action: { type: 'message', label: 'โหมด demo', text: 'demo' } }]
            if (String(me.user_id).startsWith('master_')) items.push({ type: 'action', action: { type: 'message', label: 'แจ้งเตือน', text: 'แจ้งเตือน' } })
            card.quickReply = { items }
        }
        await client.replyMessage(replyToken, card)
    }

    // ── "สรุปการปิดกะ": กะของบริษัทที่ปิดวันนี้ (ไทย) · reply เท่านั้น ไม่ push · LINE รับ reply ได้สูงสุด 5 ข้อความ ──
    private async handleShiftSummaryCommand(tenantId: string, src: string, me: any, replyToken: string, client: any) {
        const text = (t: string) => ({ type: 'text', text: t })
        if (src !== 'user' && !this.shiftToGroups(tenantId)) {
            await client.replyMessage(replyToken, text('🔒 บริษัทนี้ยังไม่เปิดให้ดูสรุปปิดกะในกลุ่ม · ผู้ดูแลเปิดได้ที่ ตั้งค่า > LINE'))
            return
        }
        if (src === 'user' && !['ADMIN', 'MASTER', 'MANAGER'].includes(me?.role)) {
            await client.replyMessage(replyToken, text('🔒 สรุปปิดกะดูได้เฉพาะหัวหน้าและผู้ดูแล'))
            return
        }
        const appUrl = process.env.APP_URL ?? 'https://erp.phopy.net'
        const card = (id: string) => {
            const s = buildShiftSummary(tenantId, id)
            return s ? flexTemplates.shiftCloseCard({ ...s, webUrl: appUrl }) : null
        }
        // ponytail: อ่านล่าสุด 200 กะแล้วกรองวันในโค้ด (วันไทยแปลงด้วย thaiDateStr เหมือน buildShiftSummary)
        const rows = (getDb().prepare(`SELECT id, closed_at FROM pos_shifts WHERE tenant_id = ? AND status = 'CLOSED' AND closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 200`)
            .all(tenantId) as { id: string; closed_at: string }[]).reverse()
        const today = thaiDateStr()
        const todays = rows.filter(r => thaiDateStr(r.closed_at) === today)
        if (!todays.length) {
            await client.replyMessage(replyToken, text('วันนี้ยังไม่มีกะที่ปิดครับ'))
            return
        }
        const shown = todays.length > 5 ? todays.slice(-4) : todays
        const messages: any[] = shown.map(r => card(r.id)).filter(Boolean)
        if (todays.length > 5) messages.push(text(`วันนี้ปิดไปแล้ว ${todays.length} กะ · ดูทั้งหมดในเว็บ ${appUrl}`))
        await client.replyMessage(replyToken, messages)
    }

    private async handleExecDigest(tenantId: string, replyToken: string, client: any) {
        const today = thaiToday()
        const yesterday = addDaysStr(today, -1)
        const digest = buildExecDigest(tenantId, yesterday, today)
        const card = flexTemplates.execDigestCard({
            ...digest,
            company: companyName(tenantId),
            logoUrl: companyLogoUrl(tenantId),
        })
        await client.replyMessage(replyToken, card)
    }

    private async handleHowToLinkCommand(replyToken: string, client: any) {
        await client.replyMessage(replyToken, {
            type: 'text',
            text: '🔗 วิธีเชื่อมบัญชี LINE กับระบบ\n\n1️⃣ เปิดเว็บ erp.phopy.net\n2️⃣ ไปที่ ตั้งค่า → LINE\n3️⃣ กดปุ่ม "สร้างรหัสเชื่อม"\n4️⃣ ส่งรหัส 6 หลักมาที่แชทนี้\n\nตัวอย่าง: 123456\n\n⏰ รหัสมีอายุ 10 นาที\n👥 ผูกกลุ่ม: ผู้ดูแลพิมพ์รหัสในกลุ่มนั้น',
            quickReply: { items: quickReplyItems(true) }
        })
    }

    // ── Pending task: save + send confirm card ────────────────────────────────
    private async askConfirmTask(
        tenantId: string, lineUserId: string,
        type: 'task' | 'menu', title: string, description: string,
        replyToken: string, client: any, stockContext?: string
    ) {
        const db = getDb()
        const id = `pt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5 นาที
        db.prepare(`
            INSERT INTO line_pending_tasks (id, tenant_id, line_user_id, type, title, description, stock_context, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, tenantId, lineUserId, type, title, description, stockContext ?? null, expiresAt)

        const emoji = type === 'menu' ? '🍽️' : '📋'
        const typeLabel = type === 'menu' ? 'แนะนำเมนู' : 'สร้างงาน'

        await client.replyMessage(replyToken, {
            type: 'flex',
            altText: `ยืนยัน${typeLabel}: ${title}`,
            contents: {
                type: 'bubble',
                header: {
                    type: 'box', layout: 'vertical', backgroundColor: '#1a73e8',
                    contents: [{ type: 'text', text: `${emoji} ยืนยัน${typeLabel}?`, weight: 'bold', color: '#ffffff', size: 'md' }]
                },
                body: {
                    type: 'box', layout: 'vertical', spacing: 'sm',
                    contents: [
                        { type: 'text', text: title, wrap: true, weight: 'bold', size: 'sm' },
                        ...(stockContext ? [{ type: 'text' as const, text: `วัตถุดิบในคลัง: ${stockContext.slice(0, 80)}...`, wrap: true, size: 'xs' as const, color: '#888888', margin: 'sm' as const }] : []),
                        { type: 'text', text: '⏰ ยืนยันภายใน 5 นาที', size: 'xs', color: '#aaaaaa', margin: 'md' },
                    ]
                },
                footer: {
                    type: 'box', layout: 'horizontal', spacing: 'sm',
                    contents: [
                        {
                            type: 'button', style: 'primary', color: '#1a73e8', flex: 1,
                            action: { type: 'postback', label: '✅ ยืนยัน', data: `action=confirm_task&id=${id}` }
                        },
                        {
                            type: 'button', style: 'secondary', flex: 1,
                            action: { type: 'postback', label: '❌ ยกเลิก', data: `action=cancel_task&id=${id}` }
                        },
                    ]
                }
            }
        })
    }

    // ── LLM Fallback: วิเคราะห์ intent → route ───────────────────────────────
    private async handleLLMFallback(
        tenantId: string, lineUserId: string,
        text: string, replyToken: string, client: any
    ) {
        const db = getDb()
        const mapping = db.prepare(
            'SELECT user_id, role FROM line_user_mappings WHERE tenant_id = ? AND line_user_id = ?'
        ).get(tenantId, lineUserId) as any
        const user = db.prepare('SELECT name FROM users WHERE id = ?').get(mapping?.user_id) as any
        const requesterName = user?.name ?? 'ผู้ใช้'

        let intent
        try {
            intent = await detectIntent(text, tenantId)
        } catch {
            await client.replyMessage(replyToken, {
                type: 'text', text: 'ขออภัย ระบบวิเคราะห์คำสั่งขัดข้อง กรุณาลองใหม่หรือพิมพ์ -help',
                quickReply: { items: quickReplyItems(true) }
            })
            return
        }

        switch (intent.intent) {

            // ── ทำทันที: BOM มี structure ชัดเจน ────────────────────────────
            case 'CREATE_BOM': {
                const p = intent.params
                if (p.productName && Array.isArray(p.items) && p.items.length > 0) {
                    await this.handleBOMCommand(tenantId, { replyToken, source: { userId: lineUserId } } as any, client, {
                        productName: p.productName,
                        items: p.items.map((i: any) => ({
                            name: String(i.name ?? ''),
                            qty:  Number(i.qty  ?? 1),
                            unit: String(i.unit ?? 'ชิ้น'),
                        })),
                    })
                } else {
                    await client.replyMessage(replyToken, {
                        type: 'text',
                        text: 'กรุณาระบุชื่อสินค้าและวัตถุดิบให้ครบครับ\nตัวอย่าง:\nบอม หมอนใหม่\nใยโพลี 500 g\nผ้า 1 m',
                    })
                }
                break
            }

            // ── ถามยืนยัน: แนะนำเมนู ─────────────────────────────────────
            case 'SUGGEST_MENU': {
                const stock = db.prepare(
                    "SELECT name, quantity, unit FROM stock_items WHERE tenant_id = ? AND quantity > 0 AND status = 'ACTIVE' ORDER BY quantity DESC LIMIT 20"
                ).all(tenantId) as any[]
                const stockCtx = stock.map((s: any) => `${s.name} ${s.quantity}${s.unit}`).join(', ')
                const title = intent.params.description ?? text
                const desc  = `คำขอจาก LINE: "${text}"\nโดย: ${requesterName}\n\nวัตถุดิบในคลัง:\n${stockCtx || 'ไม่พบข้อมูล'}`
                await this.askConfirmTask(tenantId, lineUserId, 'menu', `แนะนำเมนู: ${title}`, desc, replyToken, client, stockCtx)
                break
            }

            // ── ตอบทันที: query ERP ──────────────────────────────────────
            case 'QUERY_ERP': {
                const { queryType, keyword } = intent.params
                if (queryType === 'stock' && keyword) {
                    await this.handleStockCommand(tenantId, keyword, replyToken, client)
                } else if (queryType === 'bom' && keyword) {
                    await this.handleBOMQueryCommand(tenantId, keyword, replyToken, client)
                } else if (queryType === 'order') {
                    await this.handleOrderCommand(tenantId, replyToken, client)
                } else {
                    await client.replyMessage(replyToken, {
                        type: 'text',
                        text: 'ต้องการข้อมูลส่วนใดครับ? ลองพิมพ์:\n• สต็อก [ชื่อสินค้า]\n• สูตร [ชื่อสินค้า]\n• ออเดอร์',
                        quickReply: { items: quickReplyItems(true) }
                    })
                }
                break
            }

            // ── ถามยืนยัน: งานซับซ้อน ────────────────────────────────────
            case 'CREATE_TASK': {
                const title = intent.params.title ?? text
                const desc  = `${intent.params.description ?? text}\n\nโดย: ${requesterName}`
                await this.askConfirmTask(tenantId, lineUserId, 'task', title, desc, replyToken, client)
                break
            }

            // ── ตอบตรง: chat ─────────────────────────────────────────────
            case 'CHAT':
            default: {
                const reply = intent.replyDirect || 'ขออภัย ไม่เข้าใจคำสั่ง พิมพ์ -help เพื่อดูคำสั่งที่รองรับครับ'
                await client.replyMessage(replyToken, {
                    type: 'text', text: reply,
                    quickReply: { items: quickReplyItems(true) }
                })
            }
        }
    }

    // ── Main event dispatcher ─────────────────────────────────────────────────
    public async handleEvent(tenantId: string, event: any) {
        const d = describeEvent(event)
        const t0 = Date.now()
        const base = d && {
            tenantId, direction: 'IN' as const, kind: d.kind, summary: d.summary,
            sourceType: event.source?.type, target: event.source?.groupId ?? event.source?.roomId ?? event.source?.userId,
        }
        try {
            await this.dispatchEvent(tenantId, event)
            if (base) logLine({ ...base, ms: Date.now() - t0 })
        } catch (e) {
            if (base) logLine({ ...base, ok: false, error: e, ms: Date.now() - t0 })
            throw e
        }
    }

    private async dispatchEvent(tenantId: string, event: any) {
        const client = this.getClient(tenantId)
        if (!client) return

        const src = sourceType(event)

        // ── follow: user added the bot as friend ──────────────────────────────
        if (event.type === 'follow') {
            await client.replyMessage(event.replyToken, flexTemplates.welcomeCard())
            return
        }

        // ── unfollow: user blocked/removed the bot (no reply token) ──────────
        if (event.type === 'unfollow') {
            const db = getDb()
            // บล็อก OA กลาง = เลิกรับจากทุกร้าน
            getDb().prepare('DELETE FROM line_user_mappings WHERE line_user_id = ?').run(event.source.userId)
            getDb().prepare('DELETE FROM line_master_links WHERE line_user_id = ?').run(event.source.userId)
            return
        }

        // ── join: bot added to a group/room ───────────────────────────────────
        if (event.type === 'join') {
            const groupId = event.source.groupId ?? event.source.roomId
            if (groupId) {
                // ไม่ผูกกลุ่มอัตโนมัติแล้ว — OA กลางไม่รู้ว่ากลุ่มนี้ของร้านไหน และกลุ่มที่ไม่ได้ผูกต้องไม่ได้ข้อความของใคร
                try {
                    await client.replyMessage(event.replyToken, {
                        type: 'text',
                        text: '👋 สวัสดีครับ จาก Phopy-ERP\nกลุ่มนี้ยังไม่ได้ผูกกับบริษัท จึงยังไม่ได้รับแจ้งเตือนใดๆ\n\nให้ผู้ดูแล (Admin/Master) ขอรหัส 6 หลักที่ ตั้งค่า > LINE ในระบบ แล้วพิมพ์รหัสในกลุ่มนี้'
                    })
                } catch { /* ignore */ }
            }
            return
        }

        // ── leave: bot removed from group/room ───────────────────────────────
        if (event.type === 'leave') {
            const groupId = event.source.groupId ?? event.source.roomId
            if (groupId) getDb().prepare('UPDATE line_group_mappings SET is_active = 0 WHERE group_id = ?').run(groupId)
            return
        }

        // ── image message (bill inbox) ─────────────────────────────────────────
        if (event.type === 'message' && event.message.type === 'image') {
            if (src !== 'user') return

            const lineUserId = event.source?.userId
            const ml = lineUserId ? this.masterLink(lineUserId) : undefined
            const mapping = !lineUserId || !tenantId ? undefined
                : ml && !ml.as_member ? (ml.view_tenant_id === tenantId ? { user_id: ml.master_id as string } : undefined) // Master ลอยตัว: บิลเข้าบริษัทที่ดูอยู่
                : getDb().prepare('SELECT user_id FROM line_user_mappings WHERE tenant_id = ? AND line_user_id = ?').get(tenantId, lineUserId) as { user_id: string } | undefined

            if (!tenantId || !mapping) {
                await this.handleHowToLinkCommand(event.replyToken, client)
                return
            }

            let raw: Buffer
            try {
                raw = await client.getMessageContent(String(event.message.id))
                if (!raw || raw.length > 10 * 1024 * 1024) throw new Error('Too large')
            } catch {
                await client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: 'ดึงรูปไม่สำเร็จ ลองส่งใหม่อีกครั้ง',
                })
                return
            }

            const res = await intakeBillImage({
                tenantId,
                lineUserId,
                userId: mapping.user_id ?? null,
                lineMessageId: String(event.message.id),
                raw,
            })

            const imageSet = event.message.imageSet
            const shouldReply = !imageSet || imageSet.index === imageSet.total
            if (!shouldReply) return

            if (res.ok) {
                await client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: `📥 รับบิลแล้ว · รอลงบัญชี ${res.pending} ใบ`,
                })
                return
            }

            switch (res.reason) {
                case 'DUPLICATE_IMAGE': {
                    const text = res.docNum
                        ? `⚠️ รูปนี้เคยแนบไว้แล้วใน${res.label} ${res.docNum} ไม่ได้เก็บซ้ำ`
                        : '⚠️ รูปนี้ส่งมาแล้ว และยังรอลงบัญชีอยู่ ไม่ได้เก็บซ้ำ'
                    await client.replyMessage(event.replyToken, { type: 'text', text })
                    return
                }
                case 'INBOX_FULL': {
                    await client.replyMessage(event.replyToken, {
                        type: 'text',
                        text: `⚠️ บิลรอลงเต็ม ${MAX_PENDING_PER_TENANT} ใบแล้ว แจ้งผู้ดูแลให้เคลียร์ก่อน`,
                    })
                    return
                }
                case 'NOT_IMAGE': {
                    await client.replyMessage(event.replyToken, {
                        type: 'text',
                        text: 'ไฟล์นี้อ่านเป็นรูปไม่ได้ ลองถ่ายใหม่อีกครั้ง',
                    })
                    return
                }
                case 'DUPLICATE_MESSAGE':
                default:
                    return
            }
        }

        // ── text message ──────────────────────────────────────────────────────
        if (event.type === 'message' && event.message.type === 'text') {
            const text = event.message.text.trim()
            // คนชินพิมพ์ /demo /help แบบแอปแชทอื่น — ตัด / นำหน้าทิ้ง ไม่งั้นหลุดไป AI fallback
            const lower = text.toLowerCase().replace(/^\//, '')

            // ── กลับเป็น Master จากบัญชีทดสอบ — ก่อนด่านลงทะเบียนเพื่อให้ใช้ได้เสมอ ──
            if (src === 'user' && ['master', 'กลับเป็น master'].includes(lower)) {
                const uid = event.source.userId, ml = this.masterLink(uid)
                if (ml?.as_member || ml?.demo_role) {
                    const view = ml.view_tenant_id || ''
                    getDb().prepare('UPDATE line_master_links SET as_member = 0, demo_role = NULL WHERE line_user_id = ?').run(uid)
                    const back = this.linkedUser(view, uid)
                    if (back) await richMenus.syncUser(view, client.token, uid, back.menu)
                    await client.replyMessage(event.replyToken, { type: 'text', text: `กลับเป็น Master แล้ว · ตอนนี้ดู: ${companyName(view) || view}` })
                    return
                }
            }

            // ── Registration gate ─────────────────────────────────────────────
            // คนที่ยังไม่ผูกใช้ได้แค่ "ลิงก์ XXXXXX" + ปุ่มในเมนู guest (วิธีเชื่อมบัญชี / ช่วยเหลือ)
            // ส่งรหัส 6 หลักเฉยๆ ก็ผูกได้ · ในกลุ่มที่ผูกแล้วต้องพิมพ์ "ลิงก์ xxxxxx" กันตัวเลขในแชทปกติโดนตีเป็นรหัส
            const bareOtp = /^\d{6}$/.test(text) && (src === 'user' || !tenantId)
            const isLinkAttempt = bareOtp || lower.startsWith('ลิงก์ ') || lower.startsWith('/ลิงก์ ')
            const isHelp = ['-help', '/help', 'help', 'ช่วยเหลือ', '?', 'menu', 'เมนู'].includes(lower)
            const isHowToLink = ['วิธีเชื่อมบัญชี', 'เชื่อมบัญชี', 'link', '-link'].includes(lower)
            const linked = this.linkedUser(tenantId, event.source.userId)
            if (linked) {
                // ไม่ await — อย่าให้การผูกเมนู (ครั้งแรกต้องอัปโหลดรูป) ถ่วงการตอบ
                richMenus.syncUser(tenantId, client.token, event.source.userId, linked.menu).catch(() => {})
            }
            // demo "ยังไม่ผูกบัญชี": Master เห็นบอทแบบคนที่เพิ่งเพิ่มเพื่อน — ทุกข้อความทำเหมือนไม่มีการผูก ยกเว้นคำสั่ง demo (ทางกลับ)
            const me = linked?.demo && linked.role === 'GUEST' && !['demo', 'โหมด demo'].includes(lower) ? null : linked
            // ── สรุปปิดกะ: ตอบด้วย reply เท่านั้น (ฟรี ไม่กินโควตา push) · ก่อนด่านลงทะเบียนเพราะในกลุ่มที่ผูกแล้วใครก็ใช้ได้ ──
            // กลุ่มที่ยังไม่ผูก (tenantId ว่าง) และแชทส่วนตัวที่ยังไม่ผูก (me ว่าง) ไม่เข้าตรงนี้ → ไปด่านลงทะเบียนตามเดิม
            if (['สรุปการปิดกะ', 'สรุปปิดกะ', 'ปิดกะ'].includes(lower) && (src === 'user' ? !!me : !!tenantId)) {
                await this.handleShiftSummaryCommand(tenantId, src, me, event.replyToken, client)
                return
            }
            if (!isLinkAttempt && !(src === 'user' && (isHelp || isHowToLink))) {
                if (!me) {
                    if (src === 'user') {
                        await client.replyMessage(event.replyToken, {
                            type: 'text',
                            text: '🔒 LINE นี้ยังไม่ได้เชื่อมกับบัญชีในระบบ ERP\n\nเข้าเว็บ erp.phopy.net > ตั้งค่า > LINE กด "สร้างรหัสเชื่อม" แล้วส่งรหัส 6 หลักมาที่แชทนี้\n\nตัวอย่าง: 123456',
                        })
                    }
                    // กลุ่ม: เงียบ ไม่ตอบคนที่ไม่ได้ลงทะเบียน
                    return
                }
            }

            // BOM and PR drafting via chat removed (use Web ERP instead)

            // ── Account linking (personal chat only) ─────────────────────────
            if (isLinkAttempt) {
                // รหัส 6 หลักเป็นความลับเดียวของการผูก และ OA กลางรับรหัสของทุกร้าน → จำกัดจำนวนครั้งต่อ LINE user
                if (!linkThrottle.allow(event.source.userId ?? event.source.groupId ?? '')) {
                    await client.replyMessage(event.replyToken, { type: 'text', text: '⏳ ลองรหัสบ่อยเกินไป รอ 10 นาทีแล้วลองใหม่' })
                    return
                }
                const token = bareOtp ? text : text.split(' ')[1]?.trim()
                if (token) {
                    if (src === 'user') await this.handleLinkCommand(event.source.userId, token, event.replyToken, client)
                    else await this.handleGroupLink(event.source.groupId ?? event.source.roomId, token, event.replyToken, client)
                    return
                }
            }

            // ── คำสั่ง: วิธีเชื่อมบัญชี (personal only) ─────────────────────
            if (src === 'user' && isHowToLink) {
                await this.handleHowToLinkCommand(event.replyToken, client)
                return
            }

            // ── คำสั่ง: -help / /help / help / ช่วยเหลือ / ? ────────────────
            if (isHelp) {
                const msg = flexTemplates.helpCard(me ? me.menu : 'guest') as any
                msg.quickReply = { items: quickReplyItems(src === 'user') }
                await client.replyMessage(event.replyToken, msg)
                return
            }

            // ── เมนูตามตำแหน่ง (ข้อมูลเงิน/อนุมัติ → แชทส่วนตัวเท่านั้น ไม่โชว์ในกลุ่ม) ──
            const menuCmd: Record<string, MenuKey[]> = {
                'ยอดขายวันนี้': ['exec'], 'สรุปผู้บริหาร': ['exec'], 'กำไรเดือนนี้': ['exec'],
                'รออนุมัติ': ['exec', 'manager', 'staff'], 'สต็อกต่ำ': ['exec', 'manager'],
                'บัญชีของฉัน': ['exec', 'manager', 'staff'],
            }
            if (me && menuCmd[text]) {
                if (src !== 'user') {
                    await client.replyMessage(event.replyToken, { type: 'text', text: `🔒 "${text}" ดูได้ในแชทส่วนตัวกับบอทเท่านั้นครับ` })
                    return
                }
                if (!menuCmd[text].includes(me.menu)) {
                    await client.replyMessage(event.replyToken, { type: 'text', text: `🔒 "${text}" สำหรับ${text === 'สต็อกต่ำ' ? 'หัวหน้าและผู้บริหาร' : 'ผู้บริหาร'}เท่านั้นครับ` })
                    return
                }
                if (text === 'ยอดขายวันนี้') await this.handleDailySales(tenantId, event.replyToken, client)
                else if (text === 'สรุปผู้บริหาร') await this.handleExecDigest(tenantId, event.replyToken, client)
                else if (text === 'กำไรเดือนนี้') await this.handleMonthProfit(tenantId, event.replyToken, client)
                else if (text === 'รออนุมัติ') await this.handlePendingApprovals(tenantId, me, event.replyToken, client)
                else if (text === 'สต็อกต่ำ') await this.handleLowStock(tenantId, event.replyToken, client)
                else await this.handleMe(tenantId, me, event.replyToken, client)
                return
            }

            // ── self-service: เปิดหน้า "ของฉัน" ด้วยลิงก์ใช้ครั้งเดียว — เฉพาะแชทส่วนตัว (ลิงก์ในกลุ่ม = ใครกดก็เข้าได้) ──
            const selfCmd = ['ของฉัน', 'เช็คอิน', 'ขอลา', 'ขอเบิก', 'สลิป', 'ตารางกะ', 'แลกกะ']
            if (me && selfCmd.includes(text)) {
                if (src !== 'user') {
                    await client.replyMessage(event.replyToken, { type: 'text', text: `🔒 "${text}" ใช้ได้ในแชทส่วนตัวกับบอทเท่านั้นครับ` })
                    return
                }
                const emp = getDb().prepare(`SELECT 1 FROM employees WHERE tenant_id = ? AND user_id = ? AND status = 'ACTIVE'`).get(tenantId, me.user_id)
                if (!emp) {
                    await client.replyMessage(event.replyToken, { type: 'text', text: 'บัญชีนี้ยังไม่ได้ผูกกับทะเบียนพนักงาน\nให้ฝ่ายบุคคลผูกบัญชีผู้ใช้ในหน้าพนักงานก่อนครับ' })
                    return
                }
                await client.replyMessage(event.replyToken, {
                    type: 'template', altText: `${text} · ${companyName(tenantId)}`,
                    template: {
                        type: 'buttons', title: (companyName(tenantId) || 'Phopy ERP').slice(0, 40),
                        text: 'เช็คอิน ขอลา ขอเบิก สลิป ตารางกะ แลกกะ\nลิงก์ใช้ได้ครั้งเดียว ภายใน 5 นาที',
                        actions: [{ type: 'uri', label: 'เปิดหน้าของฉัน', uri: this.createLoginLink(tenantId, me.user_id) }],
                    },
                })
                return
            }

            // ── เปลี่ยนบริษัท (LINE เดียวผูกหลายร้าน) — เฉพาะแชทส่วนตัว ร้านในกลุ่มมาจากการผูกกลุ่ม ──
            if (me && src === 'user' && ['เปลี่ยนบริษัท', 'สลับบริษัท'].includes(text) && this.floatingLink(event.source.userId)) {
                // Master เห็นทุกบริษัท (ไม่ต้องมี mapping) — เกิน 13 ปุ่มให้ค้นด้วย "บริษัท <ชื่อ>"
                const now = companyName(tenantId) || tenantId
                const all = getDb().prepare('SELECT tenant_id, name FROM company_settings WHERE tenant_id != ? ORDER BY tenant_id').all(tenantId) as any[]
                const more = all.length > 13
                await client.replyMessage(event.replyToken, {
                    type: 'text', text: `ตอนนี้ดู: ${now}\nเลือกบริษัทที่จะเปลี่ยนไป${more ? '\nพิมพ์ บริษัท <ชื่อ> เพื่อค้นหา' : ''}`,
                    quickReply: { items: this.companyButtons(more ? all.slice(0, 12) : all) },
                })
                return
            }
            if (me && src === 'user' && text.startsWith('บริษัท ') && this.floatingLink(event.source.userId)) {
                const q = text.slice(6).trim()
                const found = q ? getDb().prepare('SELECT tenant_id, name FROM company_settings WHERE name LIKE ? ORDER BY tenant_id LIMIT 13').all(`%${q}%`) as any[] : []
                await client.replyMessage(event.replyToken, found.length
                    ? { type: 'text', text: `พบ ${found.length} บริษัท · เลือกบริษัทที่จะดู`, quickReply: { items: this.companyButtons(found) } }
                    : { type: 'text', text: `ไม่พบบริษัท "${q}"` })
                return
            }
            // ── แจ้งเตือนของบริษัทที่ Master ดูอยู่ (ปิดเป็นค่าเริ่มต้น) ──
            if (me && src === 'user' && text === 'แจ้งเตือน' && this.floatingLink(event.source.userId)) {
                await client.replyMessage(event.replyToken, this.masterNotifyMessage(event.source.userId, tenantId))
                return
            }
            if (me && src === 'user' && ['เปลี่ยนบริษัท', 'สลับบริษัท'].includes(text)) {
                const shops = this.linkedTenants(event.source.userId)
                const now = companyName(tenantId) || tenantId
                if (shops.length < 2) {
                    await client.replyMessage(event.replyToken, { type: 'text', text: `ตอนนี้ LINE นี้ผูกกับ ${now} บริษัทเดียวครับ\nถ้าจะเพิ่มบริษัท ให้ส่งรหัส 6 หลักจากหน้าตั้งค่าของบริษัทนั้นมาในแชทนี้` })
                    return
                }
                await client.replyMessage(event.replyToken, {
                    type: 'text', text: `ตอนนี้ใช้งาน: ${now}\nเลือกบริษัทที่จะเปลี่ยนไป`,
                    // LINE: quick reply สูงสุด 13 ปุ่ม, label สูงสุด 20 ตัวอักษร
                    quickReply: { items: shops.filter(s => s.tenantId !== tenantId).slice(0, 13).map(s => ({
                        type: 'action', action: { type: 'postback', label: s.name.slice(0, 20), data: `action=switch_tenant&id=${encodeURIComponent(s.tenantId)}`, displayText: s.name },
                    })) },
                })
                return
            }

            // ── โหมด demo: MASTER ดูบอทเป็นตำแหน่งที่ต่ำกว่า (ลดสิทธิ์อย่างเดียว) ──
            if (me && ['demo', 'โหมด demo'].includes(lower)) {
                const deny = (t: string) => client.replyMessage(event.replyToken, { type: 'text', text: t })
                if (src !== 'user') await deny('โหมด demo ใช้ได้ในแชทส่วนตัวกับบอทเท่านั้นครับ')
                else if (me.realRole !== 'MASTER') await deny('🔒 โหมด demo ใช้ได้เฉพาะ Master ครับ')
                else {
                    const btn = (label: string, role: string) => ({ type: 'action', action: { type: 'postback', label, data: `action=demo_role&role=${role}`, displayText: label } })
                    await client.replyMessage(event.replyToken, {
                        type: 'text', text: `โหมด demo: เลือกตำแหน่งที่อยากดู\nตอนนี้: ${ROLE_LABEL[me.role] ?? me.role}`,
                        quickReply: { items: [btn(ROLE_LABEL.ADMIN, 'ADMIN'), btn(ROLE_LABEL.MANAGER, 'MANAGER'), btn(ROLE_LABEL.USER, 'USER'), btn(ROLE_LABEL.GUEST, 'GUEST'), btn('กลับเป็น Master', 'off')] },
                    })
                }
                return
            }

            // ── Master ลอยสลับเป็นบัญชีทดสอบของ Testshop (ต้องมี mapping ของ LINE นี้ใน Testshop อยู่แล้ว) ──
            if (me && src === 'user' && lower === 'สลับทดสอบ' && this.floatingLink(event.source.userId)
                && getDb().prepare(`SELECT 1 FROM line_user_mappings WHERE tenant_id = 'Testshop' AND line_user_id = ?`).get(event.source.userId)) {
                const uid = event.source.userId
                getDb().prepare('UPDATE line_master_links SET as_member = 1 WHERE line_user_id = ?').run(uid)
                this.setActiveTenant(uid, 'Testshop')
                const t = this.linkedUser('Testshop', uid)
                if (t) await richMenus.syncUser('Testshop', client.token, uid, t.menu)
                await client.replyMessage(event.replyToken, { type: 'text', text: 'ตอนนี้เป็นบัญชีทดสอบของร้านสาธิต · พิมพ์ สลับทดสอบ เพื่อสลับพนักงาน/ผู้จัดการ · พิมพ์ master เพื่อกลับเป็น Master' })
                return
            }

            // ── ร้านสาธิต Testshop: สลับ LINE นี้ระหว่างบัญชีทดสอบ พนักงาน (EMP-TEST) ↔ ผู้จัดการ (MGR-TEST) ──
            // LINE เดียวผูกได้บัญชีเดียวต่อร้าน จึงย้ายการผูกไปมา · ล็อกไว้ที่ Testshop + ต้องเป็นบัญชีทดสอบอยู่แล้ว (ร้านจริงใช้ยกสิทธิ์ไม่ได้)
            if (me && tenantId === 'Testshop' && src === 'user' && lower === 'สลับทดสอบ') {
                const db = getDb()
                const cur = db.prepare('SELECT code FROM employees WHERE tenant_id = ? AND user_id = ?').get(tenantId, me.user_id) as any
                const other = cur?.code === 'EMP-TEST' ? 'MGR-TEST' : cur?.code === 'MGR-TEST' ? 'EMP-TEST' : null
                const to = other && db.prepare(`
                    SELECT e.user_id, u.role, u.name FROM employees e JOIN users u ON u.id = e.user_id AND u.tenant_id = e.tenant_id
                    WHERE e.tenant_id = ? AND e.code = ? AND e.status = 'ACTIVE' AND u.status = 'active'
                `).get(tenantId, other) as any
                if (!to) {
                    await client.replyMessage(event.replyToken, { type: 'text', text: 'คำสั่งนี้ใช้ได้เฉพาะบัญชีทดสอบของร้านสาธิตครับ' })
                    return
                }
                db.prepare('UPDATE line_user_mappings SET user_id = ?, role = ?, demo_role = NULL WHERE tenant_id = ? AND line_user_id = ?')
                    .run(to.user_id, to.role, tenantId, event.source.userId)
                await richMenus.syncUser(tenantId, client.token, event.source.userId, menuKeyForRole(to.role))
                await client.replyMessage(event.replyToken, { type: 'text', text: `ตอนนี้เป็น: ${to.name} (${ROLE_LABEL[to.role] ?? to.role})
พิมพ์ สลับทดสอบ เพื่อสลับกลับ` })
                return
            }

            // ── คำสั่ง: สถานะ / status / -status ─────────────────────────────
            if (['สถานะ', 'status', '-status'].includes(lower)) {
                await this.handleStatusCommand(tenantId, event.replyToken, client)
                return
            }

            // ── คำสั่ง: สต็อก [ชื่อ] / stock [name] ─────────────────────────
            if (lower.startsWith('สต็อก ') || lower.startsWith('stock ') || lower.startsWith('-stock ')) {
                const query = text.split(' ').slice(1).join(' ').trim()
                if (query) {
                    await this.handleStockCommand(tenantId, query, event.replyToken, client)
                    return
                }
            }

            // ── คำสั่ง: สูตร [ชื่อสินค้า] ──────────────────────────────────
            if (text.startsWith('สูตร ') || lower.startsWith('-สูตร ')) {
                const query = text.split(' ').slice(1).join(' ').trim()
                if (query) {
                    await this.handleBOMQueryCommand(tenantId, query, event.replyToken, client)
                    return
                }
            }

            // ── คำสั่ง: งาน [คำอธิบาย] → Paperclip task (registered only) ──
            if (src === 'user' && text.startsWith('งาน ')) {
                const taskText = text.slice(3).trim()
                if (taskText) {
                    await this.handleTaskCommand(tenantId, event.source.userId, taskText, event.replyToken, client)
                    return
                }
            }

            // ── คำสั่ง: ออเดอร์ / orders / -orders ───────────────────────────
            if (['ออเดอร์', 'orders', '-orders'].includes(lower)) {
                await this.handleOrderCommand(tenantId, event.replyToken, client)
                return
            }

            // ── LLM fallback — วิเคราะห์ intent ด้วย ThaiLLM ──────────────────
            // กลุ่ม: เงียบ ถ้าไม่ match คำสั่งใด
            if (src === 'user') {
                await this.handleLLMFallback(tenantId, event.source.userId, text, event.replyToken, client)
            }
            return
        }

        // ── postback ──────────────────────────────────────────────────────────
        if (event.type === 'postback' && event.postback.data) {
            const params = new URLSearchParams(event.postback.data)
            const action = params.get('action')
            const id     = params.get('id')
            const db     = getDb()

            // เปลี่ยนบริษัท: id มาจากปุ่มซึ่งปลอมได้ → ต้องมี mapping ของ LINE นี้กับร้านนั้นจริง
            if (action === 'switch_tenant' && id && event.source?.type === 'user') {
                // Master ลอย: สลับไปบริษัทใดก็ได้ที่มีจริง ไม่ต้องมี mapping
                if (this.floatingLink(event.source.userId)) {
                    if (!db.prepare('SELECT 1 FROM company_settings WHERE tenant_id = ?').get(id)) return
                    db.prepare('UPDATE line_master_links SET view_tenant_id = ?, as_member = 0 WHERE line_user_id = ?').run(id, event.source.userId)
                    await client.replyMessage(event.replyToken, { type: 'text', text: `ตอนนี้ดู: ${companyName(id) || id} (Master)` })
                    const view = this.linkedUser(id, event.source.userId)
                    if (view) await richMenus.syncUser(id, client.token, event.source.userId, view.menu)
                    return
                }
                const to = this.linkedUser(id, event.source.userId)
                if (!to) {
                    await client.replyMessage(event.replyToken, { type: 'text', text: '❌ LINE นี้ไม่ได้ผูกกับบริษัทนั้น' })
                    return
                }
                this.setActiveTenant(event.source.userId, id)
                await client.replyMessage(event.replyToken, { type: 'text', text: `✅ ตอนนี้ใช้งาน: ${companyName(id) || id}\nคำสั่งและเมนูในแชทนี้เป็นของบริษัทนี้แล้ว` })
                await richMenus.syncUser(id, client.token, event.source.userId, to.menu)
                return
            }

            // เปิด/ปิดแจ้งเตือนของบริษัทที่ Master ดูอยู่ — เฉพาะ Master ลอย (เช็คจากตาราง ไม่ใช่จากปุ่ม)
            if (action === 'master_notify' && event.source?.type === 'user') {
                const lineUserId = event.source.userId, kind = params.get('kind') ?? ''
                const fl = this.floatingLink(lineUserId)
                if (!fl?.view_tenant_id || !MASTER_NOTIFY_KINDS.some(([k]) => k === kind)) return
                const gone = db.prepare('DELETE FROM line_master_notify WHERE line_user_id = ? AND tenant_id = ? AND kind = ?').run(lineUserId, fl.view_tenant_id, kind)
                if (!gone.changes) db.prepare('INSERT INTO line_master_notify (line_user_id, tenant_id, kind) VALUES (?, ?, ?)').run(lineUserId, fl.view_tenant_id, kind)
                await client.replyMessage(event.replyToken, this.masterNotifyMessage(lineUserId, fl.view_tenant_id))
                return
            }

            // โหมด demo: เปลี่ยนได้เฉพาะ MASTER จริง (เช็คจาก realRole ที่มาจากตาราง users ไม่ใช่จากปุ่ม) · เก็บต่อบริษัท
            if (action === 'demo_role' && event.source?.type === 'user') {
                const lineUserId = event.source.userId, role = params.get('role') ?? ''
                const me = this.linkedUser(tenantId, lineUserId)
                if (!me) return
                if (me.realRole !== 'MASTER') {
                    await client.replyMessage(event.replyToken, { type: 'text', text: '🔒 โหมด demo ใช้ได้เฉพาะ Master ครับ' })
                    return
                }
                if (!['ADMIN', 'MANAGER', 'USER', 'GUEST', 'off'].includes(role)) return
                const demo = role === 'off' ? null : role
                if (this.floatingLink(lineUserId)) db.prepare('UPDATE line_master_links SET demo_role = ? WHERE line_user_id = ?').run(demo, lineUserId)
                else db.prepare('UPDATE line_user_mappings SET demo_role = ? WHERE tenant_id = ? AND line_user_id = ?').run(demo, tenantId, lineUserId)
                const now = this.linkedUser(tenantId, lineUserId)
                if (!now) return
                await richMenus.syncUser(tenantId, client.token, lineUserId, now.menu)
                await client.replyMessage(event.replyToken, { type: 'text', text: role === 'off' ? 'กลับเป็น Master แล้ว' : `ตอนนี้ดูแบบ: ${ROLE_LABEL[role]} (โหมด demo)\nพิมพ์ demo เพื่อเปลี่ยนหรือกลับเป็น Master` })
                return
            }

            // ── อนุมัติ/ไม่อนุมัติคำขอ HR จากการ์ด (เฉพาะแชทส่วนตัว) — ด่านสิทธิ์ใช้ตัวเดียวกับหน้าเว็บ ──
            if ((action === 'approve_req' || action === 'reject_req') && id && event.source?.type === 'user') {
                // Master ลอยตัว: การ์ดอาจมาจากบริษัทอื่นที่ไม่ได้ดูอยู่ (เปิดแจ้งเตือนไว้) — Master เข้าได้ทุกบริษัท จึงใช้บริษัทของคำขอเอง
                // อยู่บัญชีทดสอบ (as_member) แต่การ์ดมาจากบริษัทอื่นที่เปิดแจ้งเตือนไว้ → อนุมัติในฐานะ Master เช่นกัน
                const ml = this.masterLink(event.source.userId)
                const ownerTenant: string | undefined = ml ? (db.prepare('SELECT tenant_id FROM approval_requests WHERE id = ?').get(id) as any)?.tenant_id : undefined
                const floating = !!ml && (!ml.as_member || (!!ownerTenant && ownerTenant !== tenantId))
                const reqTenant: string = floating ? (ownerTenant ?? tenantId) : tenantId
                const me = floating ? { user_id: ml.master_id, realRole: 'MASTER' } : this.linkedUser(reqTenant, event.source.userId)
                if (!me) return
                const row = db.prepare('SELECT module_type FROM approval_requests WHERE id = ? AND tenant_id = ?').get(id, reqTenant) as any
                // บัญชี master_<email> ไม่มีแถวใน users (ดู auth.routes.ts) → ประกอบข้อมูลเองเหมือนตอนล็อกอินเว็บ
                const mid = String(me.user_id)
                const u = (me.realRole === 'MASTER' && mid.startsWith('master_')
                    ? { id: mid, email: mid.slice(7), role: 'MASTER', departments: null, custom_permissions: null }
                    : db.prepare('SELECT id, email, role, departments, custom_permissions FROM users WHERE id = ? AND tenant_id = ?').get(me.user_id, reqTenant)) as any
                // ด่านแพ็กเกจเดียวกับ /api/approval บนเว็บ: หมดอายุ → เฉพาะ ADMIN
                const sub = getSubscription(reqTenant)
                if (u && u.role !== 'ADMIN' && (sub.status === 'EXPIRED' || sub.status === 'CANCELLED')) {
                    await client.replyMessage(event.replyToken, { type: 'text', text: '❌ แพ็กเกจหมดอายุ กรุณาติดต่อผู้ดูแลบริษัทเพื่อต่ออายุ' })
                    return
                }
                if (!row || !u || !IN_CHAT_APPROVAL.includes(row.module_type)) {
                    await client.replyMessage(event.replyToken, { type: 'text', text: '❌ รายการนี้อนุมัติในแชทไม่ได้ กรุณาเปิดในเว็บครับ' })
                    return
                }
                const departments = u.departments ? JSON.parse(u.departments) : []
                const req = {
                    params: { id }, body: { decision: action === 'approve_req' ? 'APPROVED' : 'REJECTED', comment: 'ทาง LINE' },
                    user: { userId: u.id, email: u.email, role: u.role, department: departments[0], departments, tenantId: reqTenant,
                        customPermissions: u.custom_permissions ? JSON.parse(u.custom_permissions) : undefined },
                }
                let out: any = {}
                const res: any = { status: () => res, json: (j: any) => { out = j; return res } }
                await handleDecision(req as any, res)
                const text = out.success ? (action === 'approve_req' ? '✅ อนุมัติแล้ว' : '❌ ไม่อนุมัติแล้ว')
                    : /already|ตัดสินไปแล้ว/.test(out.message || '') ? 'รายการนี้ถูกตัดสินไปแล้วครับ' : `❌ ${out.message || 'ทำรายการไม่สำเร็จ'}`
                await client.replyMessage(event.replyToken, { type: 'text', text })
                return
            }

            // ปุ่มเริ่ม/ผลิตเสร็จบนการ์ดเก่า: เคย UPDATE ตรงๆ โดยไม่เช็ค tenant/สิทธิ์ และไม่ตัดสต็อก
            // → การ์ดใหม่เปิดเว็บแทน ส่วนการ์ดเก่าที่ค้างในแชทตอบลิงก์ให้ไปทำในเว็บ
            if ((action === 'start_wo' || action === 'complete_wo') && id) {
                await client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: `กรุณาเปลี่ยนสถานะใบสั่งผลิตในเว็บ เพื่อให้ระบบตัดสต็อกและลงบัญชีให้ถูกต้องครับ
${process.env.APP_URL ?? 'https://erp.phopy.net'}/work-orders`,
                })
                return
            }

            // ── ยืนยัน/ยกเลิก pending task ───────────────────────────────────
            if ((action === 'confirm_task' || action === 'cancel_task') && id) {
                const pending = db.prepare(
                    "SELECT * FROM line_pending_tasks WHERE id = ? AND tenant_id = ? AND line_user_id = ?"
                ).get(id, tenantId, event.source.userId) as any

                if (!pending) {
                    await client.replyMessage(event.replyToken, {
                        type: 'text', text: '⏰ คำขอนี้หมดอายุหรือถูกดำเนินการไปแล้วครับ'
                    })
                    return
                }

                // ลบ pending เสมอ (ไม่ว่าจะยืนยันหรือยกเลิก)
                db.prepare('DELETE FROM line_pending_tasks WHERE id = ?').run(id)

                if (action === 'cancel_task') {
                    await client.replyMessage(event.replyToken, {
                        type: 'text', text: '❌ ยกเลิกแล้วครับ',
                        quickReply: { items: quickReplyItems(true) }
                    })
                    return
                }

                // confirm → สร้าง Paperclip issue
                const identifier = await createPaperclipTask(pending.title, pending.description)
                const emoji = pending.type === 'menu' ? '🍽️' : '🚀'
                await client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: identifier !== '?'
                        ? `✅ สร้างงาน ${identifier} แล้วครับ\n"${pending.title}"\n\nทีม AI รับงานแล้ว ${emoji}`
                        : '❌ สร้างงานไม่สำเร็จ กรุณาลองใหม่',
                    quickReply: { items: quickReplyItems(true) }
                })
                return
            }
        }
    }
}

export const lineBotService = new LineBotService()

/** แจ้ง Master รายวัน (แพ็กเกจใกล้หมด/หมด + โควตา LINE) — เรียกจาก cron 09:00 */
export async function runMasterDailyAlerts(today: string): Promise<void> {
    await lineBotService.runMasterDailyAlerts(today)
}
