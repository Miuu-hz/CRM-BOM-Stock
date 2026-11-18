import { describe, it, expect, vi, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { buildExecDigest } from './execDigest.service'
import { lineBotService } from './line-bot.service'
import lineBotRouter, { parseDonutQuery, buildDonutSvg } from '../routes/line-bot.routes'
import { thaiToday } from './phopyBoard.service'
import { flexTemplates } from './line-flex-templates'

const tenants: string[] = []

afterEach(() => {
    vi.restoreAllMocks()
    for (const t of tenants.splice(0)) {
        for (const tb of [
            'pos_payments', 'pos_running_bills', 'pos_shift_cash_movements', 'pos_shifts',
            'purchase_invoices', 'purchase_orders', 'suppliers',
            'delivery_orders', 'customers', 'accounts',
            'line_user_mappings', 'line_master_notify', 'line_master_links', 'line_push_counts',
            'users', 'company_settings'
        ]) {
            try { db.prepare(`DELETE FROM ${tb} WHERE tenant_id = ?`).run(t) } catch {}
        }
    }
})

function setupTenant(name = 'ร้านทดสอบ สรุปผู้บริหาร') {
    const tenantId = 't_ed_' + generateId().slice(0, 8)
    tenants.push(tenantId)
    try {
        db.prepare('INSERT INTO company_settings (id, tenant_id, name) VALUES (?, ?, ?)').run(generateId(), tenantId, name)
    } catch {
        db.prepare('INSERT INTO company_settings (tenant_id, name) VALUES (?, ?)').run(tenantId, name)
    }
    return tenantId
}

function insertAccount(tenantId: string, code: string, name: string, type: string, category: string) {
    const id = generateId()
    db.prepare(`
        INSERT INTO accounts (id, tenant_id, code, name, type, category, normal_balance)
        VALUES (?, ?, ?, ?, ?, ?, CASE WHEN ? IN ('ASSET', 'EXPENSE') THEN 'DEBIT' ELSE 'CREDIT' END)
    `).run(id, tenantId, code, name, type, category, type)
    return id
}

function insertPosBill(tenantId: string, amount: number, closedAtUtc: string, status = 'PAID') {
    const billId = generateId()
    db.prepare(`
        INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, subtotal, total_amount, status, opened_at, closed_at)
        VALUES (?, ?, ?, 't', ?, ?, ?, ?, ?)
    `).run(billId, tenantId, 'BILL-' + billId.slice(0, 6), amount, amount, status, closedAtUtc, closedAtUtc)

    if (status === 'PAID') {
        db.prepare(`
            INSERT INTO pos_payments (id, tenant_id, bill_id, payment_method, amount, paid_at, received_by)
            VALUES (?, ?, ?, 'CASH', ?, ?, 'test')
        `).run(generateId(), tenantId, billId, amount, closedAtUtc)
    }
    return billId
}

function insertSupplier(tenantId: string, name: string) {
    const id = generateId()
    db.prepare(`
        INSERT INTO suppliers (id, tenant_id, code, name, contact_name, status)
        VALUES (?, ?, ?, ?, '-', 'ACTIVE')
    `).run(id, tenantId, 'SUP-' + id.slice(0, 6), name)
    return id
}

function insertPurchaseInvoice(tenantId: string, supplierId: string, amount: number, invoiceDate: string, status = 'ISSUED') {
    const id = generateId()
    const poId = generateId()
    db.prepare(`
        INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, total_amount)
        VALUES (?, ?, ?, ?, 'APPROVED', ?)
    `).run(poId, tenantId, 'PO-' + poId.slice(0, 6), supplierId, amount)

    db.prepare(`
        INSERT INTO purchase_invoices (id, tenant_id, pi_number, purchase_order_id, supplier_id, invoice_date, total_amount, balance_amount, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, 'PI-' + id.slice(0, 6), poId, supplierId, invoiceDate, amount, amount, status)
    return id
}

function insertCashMovement(tenantId: string, opts: {
    type: string
    amount: number
    reason: string
    createdAtUtc: string
    accountId?: string | null
    shiftNumber?: string
}) {
    const id = generateId()
    let shiftId: string | null = null
    if (opts.shiftNumber) {
        shiftId = generateId()
        db.prepare(`
            INSERT INTO pos_shifts (id, tenant_id, shift_number, status, opened_at, closed_at)
            VALUES (?, ?, ?, 'CLOSED', ?, ?)
        `).run(shiftId, tenantId, opts.shiftNumber, opts.createdAtUtc, opts.createdAtUtc)
    }
    db.prepare(`
        INSERT INTO pos_shift_cash_movements (id, tenant_id, shift_id, type, amount, reason, account_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, shiftId, opts.type, opts.amount, opts.reason, opts.accountId ?? null, opts.createdAtUtc)
    return id
}

function insertCustomer(tenantId: string, name: string, address = '') {
    const id = generateId()
    db.prepare(`
        INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city, address, status)
        VALUES (?, ?, ?, ?, 'INDIVIDUAL', '-', '-', '-', '-', ?, 'ACTIVE')
    `).run(id, tenantId, 'CUST-' + id.slice(0, 6), name, address)
    return id
}

function insertDeliveryOrder(tenantId: string, customerId: string, deliveryDate: string, status = 'READY', address = '') {
    const id = generateId()
    const soId = generateId()
    db.prepare(`
        INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, total_amount, status)
        VALUES (?, ?, ?, ?, 100, 'CONFIRMED')
    `).run(soId, tenantId, 'SO-' + soId.slice(0, 6), customerId)

    db.prepare(`
        INSERT INTO delivery_orders (id, tenant_id, do_number, sales_order_id, customer_id, delivery_date, delivery_address, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, 'DO-' + id.slice(0, 6), soId, customerId, deliveryDate, address, status)
    return id
}

describe('Executive Digest Service & LINE Push', () => {
    // (a) sales/purchases/withdrawals totals for yesterday, PURCHASE drawer row goes to purchases + 'เงินสดหน้าร้าน', EXPENSE row goes to withdrawals
    it('(a) คำนวณยอดขาย ยอดซื้อ ยอดเบิก ของเมื่อวาน: PURCHASE ลิ้นชักเข้ายอดซื้อและแสดงเป็น เงินสดหน้าร้าน, EXPENSE เข้ายอดเบิก', () => {
        const tenantId = setupTenant()
        const yesterday = '2026-11-17'
        const today = '2026-11-18'

        // ยอดขายเมื่อวาน (เวลาไทย 2026-11-17 12:00:00 -> UTC 2026-11-17T05:00:00Z)
        insertPosBill(tenantId, 1200, '2026-11-17T05:00:00Z', 'PAID')

        // ยอดซื้อใบแจ้งหนี้เมื่อวาน 2 ผู้ขาย
        const sup1 = insertSupplier(tenantId, 'เบทาโกร')
        const sup2 = insertSupplier(tenantId, 'ซีพีเอฟ')
        insertPurchaseInvoice(tenantId, sup1, 800, yesterday, 'ISSUED')
        insertPurchaseInvoice(tenantId, sup2, 400, yesterday, 'ISSUED')

        // บัญชี 1182 (ASSET) สำหรับเงินออกลิ้นชักเพื่อซื้อของหน้าร้าน
        const acc1182 = insertAccount(tenantId, '1182', 'เงินสดสำรองจ่ายซื้อของ', 'ASSET', 'CURRENT_ASSET')
        // บัญชี 5403 (EXPENSE) สำหรับค่าใช้จ่ายหน้าร้าน
        const acc5403 = insertAccount(tenantId, '5403', 'ค่าใช้จ่ายเบ็ดเตล็ดหน้าร้าน', 'EXPENSE', 'EXPENSE')

        // ลิ้นชัก PURCHASE (1182) -> 350 บาท
        insertCashMovement(tenantId, {
            type: 'PAID_OUT',
            amount: 350,
            reason: 'ซื้อผักสดตลาดสด',
            accountId: acc1182,
            createdAtUtc: '2026-11-17T03:00:00Z',
            shiftNumber: 'SH-01',
        })

        // ลิ้นชัก EXPENSE (5403) -> 150 บาท
        insertCashMovement(tenantId, {
            type: 'PAID_OUT',
            amount: 150,
            reason: 'ค่าน้ำแข็งหลอด',
            accountId: acc5403,
            createdAtUtc: '2026-11-17T04:00:00Z',
            shiftNumber: 'SH-01',
        })

        const digest = buildExecDigest(tenantId, yesterday, today)

        expect(digest.day).toBe(yesterday)
        expect(digest.sales).toBe(1200)
        // purchases = 800 (เบทาโกร) + 400 (ซีพีเอฟ) + 350 (ลิ้นชัก) = 1550
        expect(digest.purchases).toBe(1550)
        // withdrawals = 150 (ค่าน้ำแข็งหลอด)
        expect(digest.withdrawals).toBe(150)

        // purchaseSources ต้องมี เงินสดหน้าร้าน
        const cashDrawerSource = digest.purchaseSources.find(s => s.label === 'เงินสดหน้าร้าน')
        expect(cashDrawerSource).toBeDefined()
        expect(cashDrawerSource!.amount).toBe(350)

        const betagroSource = digest.purchaseSources.find(s => s.label === 'เบทาโกร')
        expect(betagroSource).toBeDefined()
        expect(betagroSource!.amount).toBe(800)

        // withdrawalItems ต้องมี ค่าน้ำแข็งหลอด
        expect(digest.withdrawalItems).toHaveLength(1)
        expect(digest.withdrawalItems[0]).toMatchObject({
            reason: 'ค่าน้ำแข็งหลอด',
            amount: 150,
            shiftNumber: 'SH-01',
        })
    })

    // (b) a UTC timestamp at 2026-11-17T18:30:00Z counts as Thai 2026-11-18
    it('(b) เวลา UTC 2026-11-17T18:30:00Z นับเป็นวันไทย 2026-11-18 (+7 ชม.)', () => {
        const tenantId = setupTenant()
        const utcTimestamp = '2026-11-17T18:30:00Z' // 01:30 ของวันที่ 2026-11-18 เวลาไทย

        insertPosBill(tenantId, 3500, utcTimestamp, 'PAID')

        // คิวรียอดของวันที่ 2026-11-18 (วันไทย) -> ต้องเจอยอด 3500
        const digest18 = buildExecDigest(tenantId, '2026-11-18', '2026-11-19')
        expect(digest18.sales).toBe(3500)

        // คิวรียอดของวันที่ 2026-11-17 (วันไทย) -> ต้องเป็น 0 เพราะข้ามวันไปแล้ว
        const digest17 = buildExecDigest(tenantId, '2026-11-17', '2026-11-18')
        expect(digest17.sales).toBe(0)
    })

    // (c) delivery due today listed, DELIVERED one not
    it('(c) รายการส่งของวันนี้: รายการที่ยังไม่ส่งถูกลิสต์ ส่วน DELIVERED และ CANCELLED ไม่ถูกลิสต์', () => {
        const tenantId = setupTenant()
        const today = '2026-11-18'
        const yesterday = '2026-11-17'

        const cust1 = insertCustomer(tenantId, 'บริษัท ก จำกัด', 'สุขุมวิท 21')
        const cust2 = insertCustomer(tenantId, 'ร้านอาหาร ข', 'สีลม ซอย 3')
        const cust3 = insertCustomer(tenantId, 'คุณ ค', 'ลาดพร้าว 101')

        // 1. ส่งวันนี้ สถานะ READY -> ต้องถูกลิสต์
        insertDeliveryOrder(tenantId, cust1, `${today} 10:00:00`, 'READY', 'สุขุมวิท 21')
        // 2. ส่งวันนี้ สถานะ DELIVERED -> ต้องไม่ถูกลิสต์
        insertDeliveryOrder(tenantId, cust2, `${today} 11:00:00`, 'DELIVERED', 'สีลม ซอย 3')
        // 3. ส่งวันนี้ สถานะ CANCELLED -> ต้องไม่ถูกลิสต์
        insertDeliveryOrder(tenantId, cust3, `${today} 14:00:00`, 'CANCELLED', 'ลาดพร้าว 101')

        const digest = buildExecDigest(tenantId, yesterday, today)

        expect(digest.totalDeliveries).toBe(1)
        expect(digest.deliveries).toHaveLength(1)
        expect(digest.deliveries[0].customer).toBe('บริษัท ก จำกัด')
        expect(digest.deliveries[0].status).toBe('READY')
        expect(digest.deliveries[0].address).toBe('สุขุมวิท 21')
    })

    // (d) sendExecDigests pushes once per recipient and stops when claimPush cap is reached, and skips an all-empty tenant
    it('(d) sendExecDigests: ส่ง push ให้ผู้รับ 1 ครั้งต่อคน, หยุดเมื่อโควตาเต็ม, และข้ามร้านที่ไม่มีข้อมูลเลย', async () => {
        const tenantWithData = setupTenant('ร้านมีข้อมูล')
        const tenantEmpty = setupTenant('ร้านว่างเปล่า')

        const yesterday = '2026-11-17'
        const today = '2026-11-18'

        // ใส่ยอดขายให้ tenantWithData
        insertPosBill(tenantWithData, 2000, `${yesterday}T04:00:00Z`, 'PAID')

        // ผู้รับของ tenantWithData: 1 Admin + 1 Master subscriber
        const adminUser = generateId(), adminLine = 'U_admin_' + generateId()
        db.prepare(`INSERT INTO users (id, email, password, name, role, tenant_id, status) VALUES (?, 'admin@ex.com', 'x', 'Admin', 'ADMIN', ?, 'active')`).run(adminUser, tenantWithData)
        db.prepare(`INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role) VALUES (?, ?, ?, ?, 'ADMIN')`).run(generateId(), tenantWithData, adminUser, adminLine)

        const masterLine = 'U_master_' + generateId()
        db.prepare(`INSERT INTO line_master_links (line_user_id, master_id, view_tenant_id) VALUES (?, ?, ?)`).run(masterLine, `master_${process.env.MASTER_BB_USERNAME || 'm1@ex.com'}`, tenantWithData)
        db.prepare(`INSERT INTO line_master_notify (line_user_id, tenant_id, kind) VALUES (?, ?, 'daily')`).run(masterLine, tenantWithData)

        // ผู้รับของ tenantEmpty (มี admin แต่ไม่มีข้อมูลอะไรเลย)
        const emptyAdminUser = generateId(), emptyAdminLine = 'U_empty_admin_' + generateId()
        db.prepare(`INSERT INTO users (id, email, password, name, role, tenant_id, status) VALUES (?, 'empty@ex.com', 'x', 'Admin', 'ADMIN', ?, 'active')`).run(emptyAdminUser, tenantEmpty)
        db.prepare(`INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role) VALUES (?, ?, ?, ?, 'ADMIN')`).run(generateId(), tenantEmpty, emptyAdminUser, emptyAdminLine)

        const pushedTargets: string[] = []
        const pushMessage = vi.fn().mockImplementation(async (target: string) => {
            pushedTargets.push(target)
        })
        vi.spyOn(lineBotService as any, 'getClient').mockReturnValue({ pushMessage })

        // 1. ทดสอบการ push ปกติ
        await lineBotService.sendExecDigests(today)

        expect(pushedTargets).toContain(adminLine)
        expect(pushedTargets).toContain(masterLine)
        // ร้านที่ไม่มีข้อมูลเลยต้องถูกข้าม
        expect(pushedTargets).not.toContain(emptyAdminLine)

        // 2. เรียกซ้ำวันเดียวกัน (cron ซ้ำ/รีสตาร์ท) → ไม่ส่งซ้ำ
        pushedTargets.length = 0
        await lineBotService.sendExecDigests(today)
        expect(pushedTargets).toHaveLength(0)

        // 3. ทดสอบกรณีโควตาเต็ม (claimPush = false) — ล้างตัวกันส่งซ้ำก่อน
        db.prepare('DELETE FROM line_master_alerts WHERE key LIKE ?').run(`exec_digest:${tenantWithData}:%`)
        vi.spyOn(lineBotService as any, 'claimPush').mockReturnValue(false)

        await lineBotService.sendExecDigests(today)
        // โควตาเต็ม ต้องไม่ push เลย
        expect(pushedTargets).toHaveLength(0)
    })

    // (e) the donut route rejects 7 values and 'abc' with 400
    it('(e) donut route ตรวจสอบความถูกต้อง: ปฏิเสธ 7 ค่า และ "abc" ด้วย 400, แปลง SVG เป็น PNG ได้', async () => {
        // ทดสอบ pure validator
        expect(parseDonutQuery('1,2,3,4,5,6,7')).toBeNull() // 7 values -> null
        expect(parseDonutQuery('abc')).toBeNull() // non-numeric -> null
        expect(parseDonutQuery('-10,20')).toBeNull() // negative -> null
        expect(parseDonutQuery('100, 200, 300')).toEqual([100, 200, 300])

        // ทดสอบ SVG builder
        const svg = buildDonutSvg([100, 200, 300])
        expect(svg).toContain('<svg')
        expect(svg).toContain('<circle')

        // ทดสอบ route ผ่าน Supertest
        const app = express()
        app.use(lineBotRouter)

        // 7 ค่า -> 400
        const res7 = await request(app).get('/donut.png?v=1,2,3,4,5,6,7')
        expect(res7.status).toBe(400)

        // 'abc' -> 400
        const resAbc = await request(app).get('/donut.png?v=abc')
        expect(resAbc.status).toBe(400)

        // ค่าถูกต้อง -> 200 และคืน content-type เป็น image/png
        const resOk = await request(app).get('/donut.png?v=1000,500,200')
        expect(resOk.status).toBe(200)
        expect(resOk.headers['content-type']).toContain('image/png')
        expect(resOk.headers['cache-control']).toBe('public, max-age=86400')
        expect(resOk.body.length).toBeGreaterThan(0)
    })

    it('(f) บิลซื้อที่จับคู่เงินออกลิ้นชักแล้ว ไม่นับซ้ำ · การ์ดทุก box มี contents (LINE ปฏิเสธถ้าไม่มี)', () => {
        const t = setupTenant()
        const acc = insertAccount(t, '1182', 'เงินสดจ่ายรอบิล', 'ASSET', 'CURRENT_ASSET')
        const mv = insertCashMovement(t, { type: 'PAID_OUT', amount: 500, reason: 'ซื้อผัก', createdAtUtc: '2026-11-17T03:00:00Z', accountId: acc, shiftNumber: 'S-F' })
        const pi = insertPurchaseInvoice(t, insertSupplier(t, 'ตลาดผัก'), 500, '2026-11-17')
        db.prepare('UPDATE purchase_invoices SET pos_cash_movement_id = ? WHERE id = ?').run(mv, pi)
        const d = buildExecDigest(t, '2026-11-17', '2026-11-18')
        expect(d.purchases).toBe(500)
        const card = flexTemplates.execDigestCard({ ...d, sales: 100, withdrawals: 50, company: 'ร้าน' })
        const walk = (n: any): void => {
            if (!n || typeof n !== 'object') return
            if (n.type === 'box') expect(Array.isArray(n.contents), JSON.stringify(n).slice(0, 120)).toBe(true)
            Object.values(n).forEach(walk)
        }
        walk(card)
        expect(JSON.stringify(card).length).toBeLessThan(30000)
    })
})
