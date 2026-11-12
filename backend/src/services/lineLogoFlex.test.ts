import { describe, it, expect, vi, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { card, flexTemplates } from './line-flex-templates'
import { lineBotService, companyLogoUrl } from './line-bot.service'
import { richMenus } from './line-richmenu.service'
import lineBotRouter from '../routes/line-bot.routes'

// Sample 1x1 transparent PNG data URL and 1x1 JPEG
const SAMPLE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const SAMPLE_PNG_DATA_URL = `data:image/png;base64,${SAMPLE_PNG_BASE64}`
const SAMPLE_JPEG_DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='

function buildApp() {
    const app = express()
    app.use(express.json())
    app.use('/api/line', lineBotRouter)
    return app
}
const app = buildApp()

const tenants: string[] = []
afterEach(() => {
    vi.restoreAllMocks()
    for (const t of tenants.splice(0)) {
        db.prepare('DELETE FROM company_settings WHERE tenant_id = ?').run(t)
        db.prepare('DELETE FROM line_user_mappings WHERE tenant_id = ?').run(t)
        db.prepare('DELETE FROM users WHERE tenant_id = ?').run(t)
    }
})

function hasImageInHeader(header: any): boolean {
    const json = JSON.stringify(header)
    return json.includes('"type":"image"')
}

function findLogoUrlInHeader(header: any): string | undefined {
    let found: string | undefined
    function walk(node: any) {
        if (!node || typeof node !== 'object') return
        if (node.type === 'image' && typeof node.url === 'string') found = node.url
        if (Array.isArray(node.contents)) node.contents.forEach(walk)
    }
    walk(header)
    return found
}

describe('LINE Flex Card Header Company Logo', () => {
    it('a card for a company with a logo contains the logo URL in its header', () => {
        const logoUrl = 'https://erp.phopy.net/api/line/logo/tenant_abc'
        const c = card({
            alt: 'ทดสอบยอดขาย',
            kicker: 'ร้าน กาแฟโบราณ',
            title: 'ยอดขายวันนี้',
            body: [],
            logoUrl,
        })

        const header = c.contents.header
        expect(hasImageInHeader(header)).toBe(true)
        expect(findLogoUrlInHeader(header)).toBe(logoUrl)
        expect(JSON.stringify(header)).toContain(logoUrl)

        // The image is placed small on the left, next to the kicker text
        const firstItem = header.contents[0] as any
        expect(firstItem.type).toBe('box')
        expect(firstItem.layout).toBe('horizontal')
        expect(firstItem.contents[0]).toMatchObject({
            type: 'image',
            url: logoUrl,
            size: 'xxs',
        })
        expect(firstItem.contents[1].text).toBe('ร้าน กาแฟโบราณ')
    })

    it('a card for a company without a logo has no image in the header and looks exactly as before', () => {
        const c = card({
            alt: 'ทดสอบยอดขาย',
            kicker: 'ร้าน กาแฟโบราณ',
            title: 'ยอดขายวันนี้',
            body: [],
        })

        const header = c.contents.header
        expect(hasImageInHeader(header)).toBe(false)
        expect(findLogoUrlInHeader(header)).toBeUndefined()

        // Without logo, the first element remains direct text kicker
        const firstItem = header.contents[0] as any
        expect(firstItem.type).toBe('text')
        expect(firstItem.text).toBe('ร้าน กาแฟโบราณ')
    })

    it('templates that receive company pass logoUrl to card header when present, and omit when absent', () => {
        const logoUrl = 'https://erp.phopy.net/api/line/logo/tenant_xyz'

        // 1. dailySalesCard
        const salesWithLogo = flexTemplates.dailySalesCard({
            company: 'Phopy Coffee',
            logoUrl,
            date: '2026-11-12',
            revenue: 1250,
            bills: 5,
            avgBill: 250,
            discount: 0,
            byMethod: [],
            cancelled: { bills: 0, amount: 0 },
            lastWeek: null,
        })
        expect(findLogoUrlInHeader(salesWithLogo.contents.header)).toBe(logoUrl)

        const salesWithoutLogo = flexTemplates.dailySalesCard({
            company: 'Phopy Coffee',
            date: '2026-11-12',
            revenue: 1250,
            bills: 5,
            avgBill: 250,
            discount: 0,
            byMethod: [],
            cancelled: { bills: 0, amount: 0 },
            lastWeek: null,
        })
        expect(hasImageInHeader(salesWithoutLogo.contents.header)).toBe(false)

        // 2. monthProfitCard
        const profitWithLogo = flexTemplates.monthProfitCard({
            company: 'Phopy Coffee',
            logoUrl,
            from: '2026-11-01',
            to: '2026-11-12',
            revenue: 50000,
            cogs: 20000,
            opex: 10000,
        })
        expect(findLogoUrlInHeader(profitWithLogo.contents.header)).toBe(logoUrl)

        const profitWithoutLogo = flexTemplates.monthProfitCard({
            company: 'Phopy Coffee',
            from: '2026-11-01',
            to: '2026-11-12',
            revenue: 50000,
            cogs: 20000,
            opex: 10000,
        })
        expect(hasImageInHeader(profitWithoutLogo.contents.header)).toBe(false)

        // 3. pendingApprovalsCard
        const appWithLogo = flexTemplates.pendingApprovalsCard({
            company: 'Phopy Coffee',
            logoUrl,
            total: 1,
            rows: [{ requestNumber: 'REQ-1', moduleType: 'doc_edit', requesterName: 'สมชาย', amount: 0, createdAt: '2026-11-12' }],
        })
        expect(findLogoUrlInHeader((appWithLogo as any).contents.header)).toBe(logoUrl)

        // 4. lowStockCard
        const stockWithLogo = flexTemplates.lowStockCard({
            company: 'Phopy Coffee',
            logoUrl,
            total: 1,
            rows: [{ name: 'เมล็ดกาแฟ', available: 2, minStock: 5, unit: 'ถุง' }],
        })
        expect(findLogoUrlInHeader((stockWithLogo as any).contents.header)).toBe(logoUrl)

        // 5. meCard
        const meWithLogo = flexTemplates.meCard({
            company: 'Phopy Coffee',
            logoUrl,
            name: 'สมชาย',
            email: 'somchai@example.com',
            roleLabel: 'ผู้บริหาร',
            menuLabel: 'ผู้บริหาร',
            linkedAt: '2026-11-12',
        })
        expect(findLogoUrlInHeader(meWithLogo.contents.header)).toBe(logoUrl)
    })
})

describe('LINE Bot Service with Company Logo', () => {
    function setupUser(role: string, withLogo: boolean) {
        const tenantId = 'tenant_logo_' + generateId().slice(0, 8)
        tenants.push(tenantId)
        const userId = generateId(), lineUserId = 'U' + generateId()

        db.prepare('INSERT INTO company_settings (tenant_id, name, logo_base64) VALUES (?, ?, ?)')
            .run(tenantId, 'ร้านกาแฟทดสอบ', withLogo ? SAMPLE_PNG_DATA_URL : null)

        db.prepare(`INSERT INTO users (id, email, password, name, role, tenant_id, status) VALUES (?, ?, 'x', 'ทดสอบ', ?, ?, 'active')`)
            .run(userId, `${userId}@example.com`, role, tenantId)
        db.prepare(`INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role) VALUES (?, ?, ?, ?, 'USER')`)
            .run(generateId(), tenantId, userId, lineUserId)

        const replies: any[] = []
        const client = { token: 't', replyMessage: async (_t: string, m: any) => { replies.push(m) } }
        vi.spyOn(lineBotService as any, 'getClient').mockReturnValue(client)
        vi.spyOn(richMenus, 'syncUser').mockResolvedValue()

        const say = (text: string) => lineBotService.handleEvent(tenantId, {
            type: 'message', replyToken: 'rt', message: { type: 'text', text },
            source: { type: 'user', userId: lineUserId },
        })
        return { tenantId, replies, say }
    }

    it('lineBotService generates cards with logo URL when company has logo', async () => {
        const { tenantId, replies, say } = setupUser('ADMIN', true)
        const expectedLogoUrl = companyLogoUrl(tenantId)
        expect(expectedLogoUrl).toBeDefined()
        expect(expectedLogoUrl).toContain(`/api/line/logo/${tenantId}`)

        await say('ยอดขายวันนี้')
        expect(replies[0].type).toBe('flex')
        const header = replies[0].contents.header
        expect(hasImageInHeader(header)).toBe(true)
        expect(findLogoUrlInHeader(header)).toBe(expectedLogoUrl)
    })

    it('lineBotService generates cards with no image in header when company has no logo', async () => {
        const { tenantId, replies, say } = setupUser('ADMIN', false)
        expect(companyLogoUrl(tenantId)).toBeUndefined()

        await say('ยอดขายวันนี้')
        expect(replies[0].type).toBe('flex')
        const header = replies[0].contents.header
        expect(hasImageInHeader(header)).toBe(false)
        expect(findLogoUrlInHeader(header)).toBeUndefined()
    })
})

describe('Public Logo Route GET /api/line/logo/:tenantId', () => {
    it('returns the decoded image with correct Content-Type and Cache-Control for a tenant with PNG logo', async () => {
        const tenantId = 'tenant_route_png_' + generateId().slice(0, 8)
        tenants.push(tenantId)
        db.prepare('INSERT INTO company_settings (tenant_id, name, logo_base64) VALUES (?, ?, ?)')
            .run(tenantId, 'ร้านชาเขียว', SAMPLE_PNG_DATA_URL)

        const res = await request(app).get(`/api/line/logo/${tenantId}`)
        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toContain('image/png')
        expect(res.headers['cache-control']).toBeDefined()
        expect(res.headers['cache-control']).toContain('public')

        const expectedBuffer = Buffer.from(SAMPLE_PNG_BASE64, 'base64')
        expect(Buffer.isBuffer(res.body)).toBe(true)
        expect(res.body.equals(expectedBuffer)).toBe(true)
    })

    it('returns the decoded image with correct Content-Type for a tenant with JPEG logo', async () => {
        const tenantId = 'tenant_route_jpeg_' + generateId().slice(0, 8)
        tenants.push(tenantId)
        db.prepare('INSERT INTO company_settings (tenant_id, name, logo_base64) VALUES (?, ?, ?)')
            .run(tenantId, 'ร้านกาแฟคั่ว', SAMPLE_JPEG_DATA_URL)

        const res = await request(app).get(`/api/line/logo/${tenantId}`)
        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toContain('image/jpeg')
        expect(res.headers['cache-control']).toBeDefined()
    })

    it('returns 404 when tenant exists but has no logo (null or empty)', async () => {
        const tenantId = 'tenant_route_nologo_' + generateId().slice(0, 8)
        tenants.push(tenantId)
        db.prepare('INSERT INTO company_settings (tenant_id, name, logo_base64) VALUES (?, ?, NULL)')
            .run(tenantId, 'ร้านไม่มีโลโก้')

        const res = await request(app).get(`/api/line/logo/${tenantId}`)
        expect(res.status).toBe(404)

        // Also test empty string logo
        db.prepare('UPDATE company_settings SET logo_base64 = "" WHERE tenant_id = ?').run(tenantId)
        const resEmpty = await request(app).get(`/api/line/logo/${tenantId}`)
        expect(resEmpty.status).toBe(404)
    })

    it('returns 404 when tenant does not exist', async () => {
        const res = await request(app).get('/api/line/logo/non_existent_tenant_999')
        expect(res.status).toBe(404)
    })
})
