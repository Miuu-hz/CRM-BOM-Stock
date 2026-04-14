import crypto from 'crypto'
import { getDb } from '../db/sqlite'

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
    const db = getDb()
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const count = (db.prepare(
        "SELECT COUNT(*) as c FROM purchase_requests WHERE tenant_id = ? AND pr_number LIKE ?"
    ).get(tenantId, `PR-${today}-%`) as any).c + 1
    return `PR-${today}-${String(count).padStart(3, '0')}`
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

import { flexTemplates } from './line-flex-templates'

// ─── Paperclip API ────────────────────────────────────────────────────────────
const PAPERCLIP_URL        = process.env.PAPERCLIP_URL        ?? 'http://100.96.174.42:3100'
const PAPERCLIP_API_KEY    = process.env.PAPERCLIP_API_KEY    ?? 'pcp_dce7e732c947e995243ffac7af546776d8542c1751b60f56'
const PAPERCLIP_COMPANY_ID = process.env.PAPERCLIP_COMPANY_ID ?? '08de03c2-f5fc-4f81-baf5-52f3a6675e6f'
const PAPERCLIP_AGENT_ID   = process.env.PAPERCLIP_AGENT_ID   ?? '84136f5d-618a-4898-b406-89bd13a9c7da'

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
        return data.identifier ?? data.id ?? '?'
    } catch (err) {
        console.error('Paperclip createTask error:', err)
        return '?'
    }
}

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
        items.splice(4, 0, {
            type: 'action', action: { type: 'message', label: '🔗 เชื่อมบัญชี', text: 'วิธีเชื่อมบัญชี' }
        })
    }
    return items.slice(0, 13) // LINE max 13 items
}

// ─── Source helpers ────────────────────────────────────────────────────────────
function sourceType(event: any): 'user' | 'group' | 'room' {
    return event.source?.type ?? 'user'
}
function replyTarget(event: any): string {
    return sourceType(event) === 'group'
        ? event.source.groupId
        : sourceType(event) === 'room'
            ? event.source.roomId
            : event.source.userId
}

// ─── Service ──────────────────────────────────────────────────────────────────
class LineBotService {

    // ── Client factory ────────────────────────────────────────────────────────
    // Returns a v8-compatible wrapper around @line/bot-sdk v11 MessagingApiClient
    private getClient(tenantId: string): any | null {
        if (!Client) return null
        const db = getDb()
        const config = db.prepare(
            'SELECT * FROM line_channels WHERE tenant_id = ? AND is_active = 1'
        ).get(tenantId) as any
        if (!config) return null
        const inner = new Client({ channelAccessToken: config.channel_access_token })
        // Wrap v11 API to be compatible with v8 call signatures used throughout this service
        const wrap = (msgs: any) => Array.isArray(msgs) ? msgs : [msgs]
        return {
            replyMessage: (replyToken: string, messages: any) =>
                inner.replyMessage({ replyToken, messages: wrap(messages) }),
            pushMessage: (to: string, messages: any) =>
                inner.pushMessage({ to, messages: wrap(messages) }),
            getProfile: (userId: string) => inner.getProfile(userId),
            getGroupMemberProfile: (groupId: string, userId: string) =>
                inner.getGroupMemberProfile(groupId, userId),
            getRoomMemberProfile: (roomId: string, userId: string) =>
                inner.getRoomMemberProfile(roomId, userId),
        }
    }

    // ── Tenant resolution ─────────────────────────────────────────────────────
    public getTenantFromSignature(signature: string, bodyRaw: Buffer | string): string | null {
        if (!validateSignature) return null
        const db = getDb()
        const channels = db.prepare(
            'SELECT tenant_id, channel_secret FROM line_channels WHERE is_active = 1'
        ).all() as any[]
        for (const ch of channels) {
            try {
                if (validateSignature(bodyRaw, ch.channel_secret, signature)) return ch.tenant_id
            } catch { /* try next */ }
        }
        return null
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
            this.pushToAllGroups(tenantId, msg),
        ])
    }

    public async notifyWorkOrderStatusChanged(tenantId: string, wo: any) {
        const msg = flexTemplates.statusChangedCard(wo)
        await Promise.all([
            this.pushToRole(tenantId, 'MASTER',  msg),
            this.pushToRole(tenantId, 'MANAGER', msg),
            this.pushToAllGroups(tenantId, msg),
        ])
    }

    // ── Account linking ───────────────────────────────────────────────────────
    /** Generate a short-lived 6-digit token; returns the plain token */
    public generateLinkToken(tenantId: string, userId: string): string {
        const db = getDb()
        // Invalidate previous tokens for this user
        db.prepare('DELETE FROM line_link_tokens WHERE user_id = ?').run(userId)
        const token = Math.floor(100000 + Math.random() * 900000).toString()
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
        db.prepare(
            'INSERT INTO line_link_tokens (id, tenant_id, user_id, token, expires_at) VALUES (lower(hex(randomblob(12))), ?, ?, ?, ?)'
        ).run(tenantId, userId, token, expiresAt)
        return token
    }

    private tryLinkAccount(tenantId: string, lineUserId: string, token: string): 'ok' | 'invalid' | 'expired' | 'already_linked' {
        const db = getDb()
        const row = db.prepare(
            'SELECT * FROM line_link_tokens WHERE token = ? AND tenant_id = ?'
        ).get(token, tenantId) as any
        if (!row) return 'invalid'
        if (new Date(row.expires_at) < new Date()) {
            db.prepare('DELETE FROM line_link_tokens WHERE id = ?').run(row.id)
            return 'expired'
        }
        // Check already linked
        const existing = db.prepare(
            'SELECT id FROM line_user_mappings WHERE tenant_id = ? AND line_user_id = ?'
        ).get(tenantId, lineUserId)
        if (existing) return 'already_linked'
        // Fetch user role
        const user = db.prepare('SELECT role FROM users WHERE id = ?').get(row.user_id) as any
        const role = user?.role ?? 'USER'
        // Upsert mapping
        db.prepare(`
            INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role)
            VALUES (lower(hex(randomblob(12))), ?, ?, ?, ?)
            ON CONFLICT(tenant_id, user_id) DO UPDATE SET line_user_id = excluded.line_user_id, role = excluded.role
        `).run(tenantId, row.user_id, lineUserId, role)
        db.prepare('DELETE FROM line_link_tokens WHERE id = ?').run(row.id)
        return 'ok'
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
            INSERT INTO purchase_request_items (id, purchase_request_id, pr_id, description, item_name, sort_order)
            VALUES (lower(hex(randomblob(12))), ?, ?, ?, ?, ?)
        `)
        parsed.items.forEach((name, i) => insertItem.run(prId, prId, name, name, i))

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
            `).run(id, tenantId, sku, name, category, unit, now, now)
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
            "SELECT order_number, status, total_amount, created_at FROM orders WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 5"
        ).all(tenantId) as any[]
        const msg = flexTemplates.recentOrdersCard(orders) as any
        msg.quickReply = { items: quickReplyItems(false) }
        await client.replyMessage(replyToken, msg)
    }

    private async handleLinkCommand(
        tenantId: string, lineUserId: string,
        token: string, replyToken: string, client: any
    ) {
        const result = this.tryLinkAccount(tenantId, lineUserId, token)
        const texts: Record<string, string> = {
            ok:            '✅ เชื่อมบัญชีสำเร็จ!\nตอนนี้คุณจะได้รับแจ้งเตือนและสั่งงานผ่าน LINE ได้แล้ว 🎉',
            invalid:       '❌ รหัสไม่ถูกต้อง\nกรุณาขอรหัสใหม่จากหน้าตั้งค่าในระบบ',
            expired:       '⏰ รหัสหมดอายุแล้ว (มีอายุ 10 นาที)\nกรุณาขอรหัสใหม่จากหน้าตั้งค่า',
            already_linked:'ℹ️ LINE นี้เชื่อมบัญชีไว้แล้ว',
        }
        await client.replyMessage(replyToken, {
            type: 'text', text: texts[result],
            quickReply: { items: quickReplyItems(true) }
        })
    }

    private async handleHowToLinkCommand(replyToken: string, client: any) {
        await client.replyMessage(replyToken, {
            type: 'text',
            text: '🔗 วิธีเชื่อมบัญชี LINE กับระบบ\n\n1️⃣ เปิดเว็บ erp.phopy.net\n2️⃣ ไปที่ ตั้งค่า → LINE Bot\n3️⃣ กดปุ่ม "สร้างรหัสเชื่อม"\n4️⃣ ส่งข้อความนี้มาที่นี่:\n\nลิงก์ [รหัส 6 หลัก]\n\nตัวอย่าง: ลิงก์ 123456\n\n⏰ รหัสมีอายุ 10 นาที',
            quickReply: { items: quickReplyItems(true) }
        })
    }

    // ── Main event dispatcher ─────────────────────────────────────────────────
    public async handleEvent(tenantId: string, event: any) {
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
            db.prepare(
                'DELETE FROM line_user_mappings WHERE tenant_id = ? AND line_user_id = ?'
            ).run(tenantId, event.source.userId)
            return
        }

        // ── join: bot added to a group/room ───────────────────────────────────
        if (event.type === 'join') {
            const groupId = event.source.groupId ?? event.source.roomId
            if (groupId) {
                this.saveGroup(tenantId, groupId)
                // pushMessage instead of replyMessage — replyToken expires in 30s
                // and may already be stale when we get here
                try {
                    await client.pushMessage(groupId, {
                        type: 'text',
                        text: '👋 สวัสดีครับ! บอทเชื่อมต่อระบบแล้ว\nพิมพ์ "-help" เพื่อดูคำสั่งที่ใช้ได้'
                    })
                } catch { /* ignore push failures */ }
            }
            return
        }

        // ── leave: bot removed from group/room ───────────────────────────────
        if (event.type === 'leave') {
            const groupId = event.source.groupId ?? event.source.roomId
            if (groupId) this.deactivateGroup(tenantId, groupId)
            return
        }

        // ── text message ──────────────────────────────────────────────────────
        if (event.type === 'message' && event.message.type === 'text') {
            const text = event.message.text.trim()
            const lower = text.toLowerCase()

            // ── BOM Draft (personal chat only) ───────────────────────────────
            if (src === 'user') {
                const bomParsed = parseBOMCommand(text)
                if (bomParsed) {
                    await this.handleBOMCommand(tenantId, event, client, bomParsed)
                    return
                }
            }

            // ── PR request (group + personal) ────────────────────────────────
            const prParsed = parsePRCommand(text)
            if (prParsed) {
                await this.handlePRCommand(tenantId, event, client, prParsed)
                return
            }

            // ── Account linking (personal chat only) ─────────────────────────
            if (src === 'user' && (lower.startsWith('/ลิงก์ ') || lower.startsWith('ลิงก์ '))) {
                const token = text.split(' ')[1]?.trim()
                if (token) {
                    await this.handleLinkCommand(tenantId, event.source.userId, token, event.replyToken, client)
                    return
                }
            }

            // ── คำสั่ง: วิธีเชื่อมบัญชี (personal only) ─────────────────────
            if (src === 'user' && ['วิธีเชื่อมบัญชี', 'เชื่อมบัญชี', 'link', '-link'].includes(lower)) {
                await this.handleHowToLinkCommand(event.replyToken, client)
                return
            }

            // ── คำสั่ง: -help / /help / help / ช่วยเหลือ / ? ────────────────
            const isHelp = ['-help', '/help', 'help', 'ช่วยเหลือ', '?', 'menu', 'เมนู'].includes(lower)
            if (isHelp) {
                const msg = flexTemplates.helpCard(src === 'user') as any
                msg.quickReply = { items: quickReplyItems(src === 'user') }
                await client.replyMessage(event.replyToken, msg)
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

            // ── fallback ──────────────────────────────────────────────────────
            // กลุ่ม: เงียบ (ไม่ตอบทุก message)
            // ส่วนตัว: แนะนำ -help พร้อม Quick Reply
            if (src === 'user') {
                await client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: 'พิมพ์ -help เพื่อดูคำสั่งทั้งหมด 👇',
                    quickReply: { items: quickReplyItems(false) }
                })
            }
            return
        }

        // ── postback ──────────────────────────────────────────────────────────
        if (event.type === 'postback' && event.postback.data) {
            const params = new URLSearchParams(event.postback.data)
            const action = params.get('action')
            const id     = params.get('id')
            const db     = getDb()

            if (action === 'start_wo' && id) {
                db.prepare(
                    "UPDATE work_orders SET status = 'IN_PROGRESS', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
                ).run(id)
                const wo = db.prepare(
                    "SELECT wo.*, si.name as product_name FROM work_orders wo LEFT JOIN stock_items si ON wo.bom_id = si.id WHERE wo.id = ?"
                ).get(id) as any
                await client.replyMessage(event.replyToken, {
                    type: 'text', text: `🏭 เริ่มผลิต ${wo?.wo_number ?? id} แล้วครับ`
                })
                if (wo) await this.notifyWorkOrderStatusChanged(tenantId, wo)
                return
            }

            if (action === 'complete_wo' && id) {
                db.prepare(
                    "UPDATE work_orders SET status = 'COMPLETED', completed_date = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
                ).run(id)
                const wo = db.prepare(
                    "SELECT wo.*, si.name as product_name FROM work_orders wo LEFT JOIN stock_items si ON wo.bom_id = si.id WHERE wo.id = ?"
                ).get(id) as any
                await client.replyMessage(event.replyToken, {
                    type: 'text', text: `✅ บันทึกว่าผลิตเสร็จ ${wo?.wo_number ?? id} แล้วครับ`
                })
                if (wo) await this.notifyWorkOrderStatusChanged(tenantId, wo)
                return
            }
        }
    }
}

export const lineBotService = new LineBotService()
