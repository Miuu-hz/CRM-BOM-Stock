import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { richMenus } from './line-richmenu.service'
import { lineBotService } from './line-bot.service'
import { buildShiftSummary } from './posShiftSummary.service'
import { getItemHistory } from './stockCostBasis.service'
import { thaiToday, addDaysStr } from './phopyBoard.service'

const MASTER_EMAIL = 'm@shiftrcp.test'
const prevMaster = process.env.MASTER_BB_USERNAME

const tenants: string[] = []
const lines: string[] = []
const groups: string[] = []

beforeEach(() => {
    process.env.MASTER_BB_USERNAME = MASTER_EMAIL
})

afterEach(() => {
    vi.restoreAllMocks()
    for (const g of groups.splice(0)) {
        db.prepare('DELETE FROM line_group_mappings WHERE group_id = ?').run(g)
        db.prepare('DELETE FROM line_master_alerts WHERE key LIKE ?').run(`%${g}%`)
    }
    for (const l of lines.splice(0)) {
        for (const tb of ['line_pending_tasks', 'line_master_links', 'line_master_notify', 'line_user_mappings']) {
            db.prepare(`DELETE FROM ${tb} WHERE line_user_id = ?`).run(l)
        }
    }
    for (const t of tenants.splice(0)) {
        for (const tb of [
            'line_pending_tasks', 'approval_logs', 'approval_requests', 'user_approval_permissions',
            'pos_stock_deductions', 'pos_bill_items', 'pos_payments', 'pos_running_bills',
            'pos_shift_cash_movements', 'pos_shifts',
            'pos_menu_configs', 'bom_items', 'boms',
            'sales_order_items', 'sales_orders', 'customers',
            'goods_receipt_items', 'goods_receipts', 'purchase_order_items', 'purchase_orders', 'suppliers',
            'stock_item_aliases', 'stock_items',
            'line_group_mappings', 'line_user_mappings', 'line_link_tokens', 'line_master_notify',
            'line_push_counts', 'tenant_subscriptions', 'users', 'company_settings',
        ]) {
            try { db.prepare(`DELETE FROM ${tb} WHERE tenant_id = ?`).run(t) } catch {}
        }
        db.prepare('DELETE FROM line_master_alerts WHERE key LIKE ?').run(`%${t}%`)
    }
})

afterAll(() => {
    if (prevMaster === undefined) delete process.env.MASTER_BB_USERNAME
    else process.env.MASTER_BB_USERNAME = prevMaster
})

function rig() {
    const replies: any[] = []
    const push = vi.fn(async (_to: string, _m: any) => {})
    const client: any = { token: 't', replyMessage: async (_t: string, m: any) => { replies.push(m) }, pushMessage: push }
    vi.spyOn(lineBotService as any, 'getClient').mockReturnValue(client)
    vi.spyOn(richMenus, 'syncUser').mockResolvedValue()

    const send = async (source: any, text: string) => {
        const n = replies.length
        const event = { replyToken: 'rt', source, type: 'message', message: { type: 'text', text } }
        await lineBotService.handleEvent(lineBotService.resolveTenant(event), event)
        return replies.slice(n)
    }
    const say = (uid: string, text: string) => send({ type: 'user', userId: uid }, text)
    const sayInGroup = (gid: string, uid: string, text: string) => send({ type: 'group', groupId: gid, userId: uid }, text)
    return { push, say, sayInGroup }
}

function company(name: string, opts: { shiftGroups?: number; aliasEnabled?: number } = {}) {
    const tenantId = 'tenant_sr_' + generateId().slice(0, 8)
    tenants.push(tenantId)
    try {
        db.prepare('INSERT INTO company_settings (id, tenant_id, name, line_shift_expense_groups, stock_alias_enabled) VALUES (?, ?, ?, ?, ?)')
            .run(generateId(), tenantId, name, opts.shiftGroups ?? 0, opts.aliasEnabled ?? 1)
    } catch {
        db.prepare('INSERT INTO company_settings (tenant_id, name, line_shift_expense_groups, stock_alias_enabled) VALUES (?, ?, ?, ?)')
            .run(tenantId, name, opts.shiftGroups ?? 0, opts.aliasEnabled ?? 1)
    }
    return { tenantId, name }
}

function master(view: string, opts: { demoRole?: string | null; asMember?: number } = {}) {
    const uid = 'U' + generateId()
    lines.push(uid)
    db.prepare('INSERT INTO line_master_links (line_user_id, master_id, view_tenant_id, demo_role, as_member) VALUES (?, ?, ?, ?, ?)')
        .run(uid, `master_${MASTER_EMAIL}`, view, opts.demoRole ?? null, opts.asMember ?? 0)
    return uid
}

function member(tenantId: string, role: string, name = 'พนักงาน') {
    const userId = generateId()
    const uid = 'U' + generateId()
    lines.push(uid)
    db.prepare(`INSERT INTO users (id, email, password, name, role, tenant_id, status) VALUES (?, ?, 'x', ?, ?, ?, 'active')`)
        .run(userId, `${userId}@sr.test`, name, role, tenantId)
    db.prepare('INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role) VALUES (?, ?, ?, ?, ?)')
        .run(generateId(), tenantId, userId, uid, role)
    return { userId, uid }
}

function bindGroup(tenantId: string, posDaily = 1) {
    const gid = 'C' + generateId().slice(0, 16)
    groups.push(gid)
    db.prepare('INSERT INTO line_group_mappings (id, tenant_id, group_id, is_active, pos_daily) VALUES (?, ?, ?, 1, ?)')
        .run(generateId(), tenantId, gid, posDaily)
    return gid
}

function newGroup() {
    const gid = 'C' + generateId().slice(0, 16)
    groups.push(gid)
    return gid
}

function insertShift(tenantId: string, o: {
    shiftNumber: string
    status: 'OPEN' | 'CLOSED'
    openedAt: string
    closedAt?: string | null
    openingCash?: number
    expectedCash?: number | null
    countedCash?: number | null
    difference?: number | null
    totalRevenue?: number
    cashRevenue?: number
    bankRevenue?: number
    billCount?: number
    openedBy?: string | null
    closedBy?: string | null
}) {
    const id = generateId()
    const vals: Record<string, any> = {
        id,
        tenant_id: tenantId,
        shift_number: o.shiftNumber,
        status: o.status,
        opened_at: o.openedAt,
        closed_at: o.status === 'OPEN' ? null : (o.closedAt ?? o.openedAt),
        opening_cash: o.openingCash ?? 0,
        expected_cash: o.status === 'OPEN' ? null : (o.expectedCash ?? 0),
        closing_cash_counted: o.status === 'OPEN' ? null : (o.countedCash ?? 0),
        cash_difference: o.status === 'OPEN' ? null : (o.difference ?? 0),
        total_revenue: o.totalRevenue ?? 0,
        cash_revenue: o.cashRevenue ?? 0,
        bank_revenue: o.bankRevenue ?? 0,
        bill_count: o.billCount ?? 0,
        opened_by: o.openedBy ?? null,
        closed_by: o.closedBy ?? null,
    }
    for (const c of db.prepare('PRAGMA table_info(pos_shifts)').all() as any[]) {
        if (c.notnull && c.dflt_value === null && !c.pk && !(c.name in vals)) {
            vals[c.name] = /INT|REAL|NUM/i.test(c.type) ? 0 : ''
        }
    }
    const cols = Object.keys(vals)
    db.prepare(`INSERT INTO pos_shifts (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map(c => vals[c]))
    return id
}

function addStockItem(tenantId: string, o: { name: string; sku: string; qty?: number; unit?: string; status?: string }) {
    const id = generateId()
    const now = new Date().toISOString()
    db.prepare(`
        INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'raw', ?, ?, ?, 'คลังหลัก', ?, ?, ?)
    `).run(id, tenantId, o.sku, o.name, o.qty ?? 10, o.unit ?? 'ชิ้น', o.unit ?? 'ชิ้น', o.status ?? 'ACTIVE', now, now)
    return id
}

function addMenu(tenantId: string, productId: string, o: { bomId?: string | null; price?: number; saleUnit?: string } = {}) {
    const id = generateId()
    db.prepare('INSERT INTO pos_menu_configs (id, tenant_id, product_id, bom_id, pos_price, sale_unit) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, tenantId, productId, o.bomId ?? null, o.price ?? 100, o.saleUnit ?? 'จาน')
    return id
}

function addBill(tenantId: string, o: {
    shiftId?: string | null
    status?: string
    subtotal?: number
    discountAmount?: number
    totalAmount: number
    discountReason?: string
    openedAt?: string
    closedAt?: string
    items?: { menuId: string; name: string; qty: number; price: number }[]
    payments?: { method: string; amount: number }[]
}) {
    const billId = generateId()
    const ts = o.closedAt ?? o.openedAt ?? new Date().toISOString()
    db.prepare(`
        INSERT INTO pos_running_bills (
            id, tenant_id, bill_number, display_name, status, shift_id,
            opened_at, closed_at, subtotal, discount_amount, total_amount, discount_reason
        ) VALUES (?, ?, ?, 'T1', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        billId, tenantId, 'B-' + billId.slice(0, 6), o.status ?? 'PAID', o.shiftId ?? null,
        o.openedAt ?? ts, ts, o.subtotal ?? o.totalAmount, o.discountAmount ?? 0, o.totalAmount, o.discountReason ?? null
    )
    for (const it of o.items ?? []) {
        db.prepare(`
            INSERT INTO pos_bill_items (id, tenant_id, bill_id, pos_menu_id, product_name, quantity, unit_price, total_price)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(generateId(), tenantId, billId, it.menuId, it.name, it.qty, it.price, it.qty * it.price)
    }
    for (const p of o.payments ?? []) {
        db.prepare(`
            INSERT INTO pos_payments (id, tenant_id, bill_id, payment_method, amount, paid_at, received_by)
            VALUES (?, ?, ?, ?, ?, ?, 'test')
        `).run(generateId(), tenantId, billId, p.method, p.amount, ts)
    }
    return billId
}

function addCashMovement(tenantId: string, shiftId: string, type: 'CASH_IN' | 'PAID_OUT' | 'OPENING_GAP', amount: number, reason: string) {
    db.prepare(`
        INSERT INTO pos_shift_cash_movements (id, tenant_id, shift_id, type, amount, reason, account_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'x', ?)
    `).run(generateId(), tenantId, shiftId, type, amount, reason, new Date().toISOString())
}

function addGR(tenantId: string, o: {
    stockItemId?: string | null
    materialId?: string | null
    grNumber: string
    supplierName?: string
    receiptDate: string
    createdAt?: string
    acceptedQty: number
    unit: string | null
    unitPrice: number | null
    stockQty?: number | null
    status?: string
}) {
    const supId = generateId(), poId = generateId(), poiId = generateId(), grId = generateId()
    const createdAt = o.createdAt ?? new Date().toISOString()
    db.prepare(`INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, ?, 'c')`)
        .run(supId, tenantId, 'SUP-' + supId.slice(0, 6), o.supplierName ?? 'ซัพเอ')
    db.prepare(`INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status) VALUES (?, ?, ?, ?, 'APPROVED')`)
        .run(poId, tenantId, 'PO-' + poId.slice(0, 6), supId)
    db.prepare(`INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, quantity, unit, unit_price, total_price)
        VALUES (?, ?, ?, ?, 'desc', ?, ?, ?, ?)`)
        .run(poiId, tenantId, poId, o.stockItemId ?? o.materialId ?? null, o.acceptedQty, o.unit, o.unitPrice, (o.unitPrice ?? 0) * o.acceptedQty)
    db.prepare(`INSERT INTO goods_receipts (id, tenant_id, gr_number, purchase_order_id, supplier_id, receipt_date, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(grId, tenantId, o.grNumber, poId, supId, o.receiptDate, o.status ?? 'CONFIRMED', createdAt)
    db.prepare(`INSERT INTO goods_receipt_items (id, tenant_id, goods_receipt_id, purchase_order_item_id, material_id, stock_item_id, accepted_qty, stock_qty)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(generateId(), tenantId, grId, poiId, o.materialId ?? null, o.stockItemId ?? null, o.acceptedQty, o.stockQty ?? null)
}

function addBOM(tenantId: string, productId: string, o: { version?: string; status?: string; createdAt?: string } = {}) {
    const id = generateId()
    db.prepare(`INSERT INTO boms (id, tenant_id, product_id, version, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, tenantId, productId, o.version ?? ('v-' + id.slice(0, 6)), o.status ?? 'ACTIVE', o.createdAt ?? new Date().toISOString())
    return id
}

function addBOMItem(tenantId: string, bomId: string, o: {
    itemType?: 'MATERIAL' | 'CHILD_BOM'
    materialId?: string | null
    childBomId?: string | null
    quantity?: number
    sortOrder?: number
}) {
    db.prepare(`
        INSERT INTO bom_items (id, tenant_id, bom_id, item_type, material_id, child_bom_id, quantity, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(generateId(), tenantId, bomId, o.itemType ?? 'MATERIAL', o.materialId ?? null, o.childBomId ?? null, o.quantity ?? 1, o.sortOrder ?? 0)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Goal A — /สรุป, EOS Shift Cards, Live Open Shift, Toggle, Midnight, Cap
// ═══════════════════════════════════════════════════════════════════════════════
describe('LINE Goal A: /สรุป EOS Shift Cards + Live Open Shift', () => {
    it('1. กลุ่ม vs ส่วนตัว, Master vs สมาชิก (toggle ON = 1)', async () => {
        const { push, say, sayInGroup } = rig()
        const today = thaiToday()
        const A = company('ร้านเอ EOS-' + generateId().slice(0, 4), { shiftGroups: 1 })
        const B = company('ร้านบี EOS-' + generateId().slice(0, 4), { shiftGroups: 0 })
        const cashier = member(A.tenantId, 'USER', 'แคชเชียร์เอ')
        const opened = `${today}T02:00:00.000Z`
        const closed = `${today}T09:00:00.000Z`
        const shA = insertShift(A.tenantId, {
            shiftNumber: 'SH-A101', status: 'CLOSED', openedAt: opened, closedAt: closed,
            openingCash: 500, expectedCash: 1500, countedCash: 1480, difference: -20,
            totalRevenue: 2000, cashRevenue: 1000, bankRevenue: 1000, billCount: 5,
            closedBy: cashier.userId,
        })
        const dishA = addStockItem(A.tenantId, { name: 'ข้าวผัดเอ', sku: 'D-A1' })
        const menuA = addMenu(A.tenantId, dishA, { price: 100 })
        addBill(A.tenantId, {
            shiftId: shA, totalAmount: 2000, openedAt: opened, closedAt: closed,
            items: [{ menuId: menuA, name: 'ข้าวผัดเอ', qty: 20, price: 100 }],
            payments: [{ method: 'CASH', amount: 1000 }, { method: 'QR_CODE', amount: 1000 }],
        })

        // B has shiftGroups = 0 and a closed shift today
        insertShift(B.tenantId, {
            shiftNumber: 'SH-B202', status: 'CLOSED', openedAt: opened, closedAt: closed,
            openingCash: 0, expectedCash: 300, countedCash: 300, difference: 0,
            totalRevenue: 3333, cashRevenue: 300, bankRevenue: 3033, billCount: 2,
        })

        const gid = bindGroup(A.tenantId, 1)
        const stranger = 'U' + generateId(); lines.push(stranger)
        const demoM = master(A.tenantId, { demoRole: 'USER' })
        const floatM = master(B.tenantId) // viewing B, typing in group bound to A

        // ทุกคนในกลุ่มที่ผูก pos ได้การ์ด EOS เดียวกันทั้ง /สรุป และ /สรุป วันนี้
        const expectedCard = JSON.stringify(await sayInGroup(gid, floatM, '/สรุป'))
        expect(expectedCard).toContain('SH-A101')
        expect(expectedCard).toContain('🔒 ปิดกะแล้ว')
        expect(expectedCard).toContain('ข้าวผัดเอ')
        expect(expectedCard).toContain('ยอด Delivery / ส่วนลด > 20%')
        expect(expectedCard).toContain('🔴 ขาด ฿20')

        for (const uid of [stranger, cashier.uid, demoM, floatM]) {
            for (const cmd of ['/สรุป', '/สรุป วันนี้']) {
                const out = await sayInGroup(gid, uid, cmd)
                expect(out).toHaveLength(1)
                expect(JSON.stringify(out)).toBe(expectedCard)
            }
        }
        expect(push).not.toHaveBeenCalled()

        // สมาชิกในกลุ่มระบุบริษัทอื่น → เงียบ
        for (const uid of [stranger, cashier.uid, demoM]) {
            expect(await sayInGroup(gid, uid, `/สรุป tenant ${B.tenantId}`)).toHaveLength(0)
            expect(await sayInGroup(gid, uid, `/สรุป ${B.name}`)).toHaveLength(0)
        }

        // Master แชทส่วนตัว → ได้การ์ด EOS แม้บริษัทตั้งค่า line_shift_expense_groups = 0
        const privDefault = await say(floatM, '/สรุป')
        expect(JSON.stringify(privDefault)).toContain('SH-B202')
        expect(JSON.stringify(privDefault)).toContain('🔒 ปิดกะแล้ว')
        const privOther = await say(floatM, `/สรุป tenant ${A.tenantId}`)
        expect(JSON.stringify(privOther)).toContain('SH-A101')
        expect(JSON.stringify(privOther)).toContain('🔒 ปิดกะแล้ว')

        // Master ในกลุ่มที่ยังไม่ผูก ไม่ระบุบริษัท → ปุ่ม quickReply ขึ้นต้นด้วย "/สรุป tenant " และไม่รั่วยอดเงิน
        const unboundGid = newGroup()
        const pickOut = await sayInGroup(unboundGid, floatM, '/สรุป')
        expect(pickOut).toHaveLength(1)
        expect(pickOut[0].type).toBe('text')
        expect(pickOut[0].quickReply?.items?.length).toBeGreaterThan(0)
        for (const it of pickOut[0].quickReply.items) {
            expect(it.action.type).toBe('message')
            expect(it.action.text.startsWith('/สรุป tenant ')).toBe(true)
        }
        expect(JSON.stringify(pickOut)).not.toContain('3,333')
        expect(JSON.stringify(pickOut)).not.toContain('2,000')

        // Master ในกลุ่มที่ผูกกับ A ระบุชื่อบริษัท B → 🔒 กลุ่มนี้ล็อกไว้กับ A
        const lockedOut = JSON.stringify(await sayInGroup(gid, floatM, `/สรุป ${B.name}`))
        expect(lockedOut).toContain(`🔒 กลุ่มนี้ล็อกไว้กับ ${A.name}`)
        expect(lockedOut).not.toContain('SH-B202')
    })

    it('2. Toggle OFF (line_shift_expense_groups = 0) ในกลุ่ม → /สรุป ตกกลับไปใช้ POS card, สรุปการปิดกะ ยังคงล็อก', async () => {
        const { sayInGroup } = rig()
        const today = thaiToday()
        const yesterday = addDaysStr(today, -1)
        const A = company('ร้านปิดสลับ-' + generateId().slice(0, 4), { shiftGroups: 0 })
        const gid = bindGroup(A.tenantId, 1)
        const staff = member(A.tenantId, 'USER')
        const floatM = master(A.tenantId)

        addBill(A.tenantId, {
            totalAmount: 1450,
            openedAt: `${today}T04:00:00.000Z`, closedAt: `${today}T04:00:00.000Z`,
            payments: [{ method: 'CASH', amount: 1450 }],
        })
        addBill(A.tenantId, {
            totalAmount: 650,
            openedAt: `${yesterday}T04:00:00.000Z`, closedAt: `${yesterday}T04:00:00.000Z`,
            payments: [{ method: 'CASH', amount: 650 }],
        })

        for (const uid of [staff.uid, floatM]) {
            const outToday = JSON.stringify(await sayInGroup(gid, uid, '/สรุป'))
            expect(outToday).toContain('ยอดขายวันนี้')
            expect(outToday).toContain('1,450')
            expect(outToday).not.toContain('ปิดกะแล้ว')
            expect(outToday).not.toContain('เงินในลิ้นชัก')

            const outYest = JSON.stringify(await sayInGroup(gid, uid, '/สรุป เมื่อวาน'))
            expect(outYest).toContain('ยอดขายเมื่อวาน')
            expect(outYest).toContain('650')
            expect(outYest).not.toContain('ปิดกะแล้ว')
        }

        const lockOut = JSON.stringify(await sayInGroup(gid, staff.uid, 'สรุปการปิดกะ'))
        expect(lockOut).toContain('🔒 บริษัทนี้ยังไม่เปิดให้ดูสรุปปิดกะในกลุ่ม')
        expect(lockOut).not.toContain('ยอดขายวันนี้')
    })

    it('3. /สรุป เดือนนี้ และ /pos คงใช้ POS card เสมอแม้ toggle ON', async () => {
        const { say, sayInGroup } = rig()
        const today = thaiToday()
        const A = company('ร้านเดือนนี้-' + generateId().slice(0, 4), { shiftGroups: 1 })
        const gid = bindGroup(A.tenantId, 1)
        const staff = member(A.tenantId, 'USER')
        const floatM = master(A.tenantId)
        insertShift(A.tenantId, {
            shiftNumber: 'SH-M01', status: 'CLOSED',
            openedAt: `${today}T02:00:00.000Z`, closedAt: `${today}T06:00:00.000Z`,
            totalRevenue: 900, cashRevenue: 900, expectedCash: 900, countedCash: 900, difference: 0, billCount: 1,
        })
        addBill(A.tenantId, {
            totalAmount: 900, openedAt: `${today}T03:00:00.000Z`, closedAt: `${today}T03:00:00.000Z`,
            payments: [{ method: 'CASH', amount: 900 }],
        })

        // /สรุป เดือนนี้ → dailySalesCard ทั้งส่วนตัวและกลุ่ม
        for (const out of [
            await say(floatM, '/สรุป เดือนนี้'),
            await sayInGroup(gid, floatM, '/สรุป เดือนนี้'),
            await sayInGroup(gid, staff.uid, '/สรุป เดือนนี้'),
        ]) {
            const json = JSON.stringify(out)
            expect(json).toContain('ยอดขายเดือนนี้')
            expect(json).toContain('900')
            expect(json).not.toContain('เงินในลิ้นชัก')
        }

        // /pos, /pos วันนี้, /pos เมื่อวาน → dailySalesCard แม้ toggle ON
        for (const cmd of ['/pos', '/pos วันนี้', '/pos เมื่อวาน']) {
            const json = JSON.stringify(await say(floatM, cmd))
            expect(json).toContain(cmd === '/pos เมื่อวาน' ? 'ยอดขายเมื่อวาน' : 'ยอดขายวันนี้')
            expect(json).not.toContain('เงินในลิ้นชัก')
        }
    })

    it('4. กะปิด + กะเปิดอยู่ (Live Open Shift) ในวันเดียวกัน + สูตรเงินสด/โอน/เงินเข้าออก + ไม่แสดง ขาด/เกิน/ตรงพอดี', async () => {
        const { push, say, sayInGroup } = rig()
        const today = thaiToday()
        const A = company('ร้านกะเปิด-' + generateId().slice(0, 4), { shiftGroups: 1 })
        const gid = bindGroup(A.tenantId, 1)
        const opener = member(A.tenantId, 'USER', 'พนักงานเปิดกะ')
        const floatM = master(A.tenantId)

        // กะที่ 1: CLOSED
        insertShift(A.tenantId, {
            shiftNumber: 'SH-C1', status: 'CLOSED',
            openedAt: `${today}T01:00:00.000Z`, closedAt: `${today}T05:00:00.000Z`,
            openingCash: 500, expectedCash: 800, countedCash: 800, difference: 0,
            totalRevenue: 300, cashRevenue: 300, bankRevenue: 0, billCount: 1,
            closedBy: opener.userId,
        })

        // กะที่ 2: OPEN (expected_cash/closing_cash_counted/cash_difference เป็น NULL)
        const openAt = new Date(Date.now() - 60_000).toISOString()
        const openId = insertShift(A.tenantId, {
            shiftNumber: 'SH-OPEN-LIVE', status: 'OPEN',
            openedAt: openAt, openingCash: 500, openedBy: opener.userId,
        })
        const dish = addStockItem(A.tenantId, { name: 'ก๋วยเตี๋ยวเรือ', sku: 'ND-1' })
        const menu = addMenu(A.tenantId, dish, { price: 150 })
        // บิล PAID จ่ายแยก: รวม 300 จ่าย CASH 100 + QR_CODE 200
        addBill(A.tenantId, {
            shiftId: openId, status: 'PAID', totalAmount: 300, openedAt: openAt, closedAt: openAt,
            items: [{ menuId: menu, name: 'ก๋วยเตี๋ยวเรือ', qty: 2, price: 150 }],
            payments: [{ method: 'CASH', amount: 100 }, { method: 'QR_CODE', amount: 200 }],
        })
        // บิล CANCELLED ห้ามนับ
        addBill(A.tenantId, {
            shiftId: openId, status: 'CANCELLED', totalAmount: 999, openedAt: openAt, closedAt: openAt,
            items: [{ menuId: menu, name: 'ของยกเลิก', qty: 1, price: 999 }],
            payments: [{ method: 'CASH', amount: 999 }],
        })
        addCashMovement(A.tenantId, openId, 'CASH_IN', 200, 'ทอนเพิ่ม')
        addCashMovement(A.tenantId, openId, 'PAID_OUT', 150, 'ซื้อน้ำแข็ง')
        addCashMovement(A.tenantId, openId, 'OPENING_GAP', 100, 'ส่วนต่างเปิดกะ') // ห้ามนับใน expectedCash

        const out = await sayInGroup(gid, floatM, '/สรุป')
        expect(out).toHaveLength(1)
        const cards = out[0] as any[]
        expect(cards).toHaveLength(2)

        const closedJson = JSON.stringify(cards[0])
        expect(closedJson).toContain('SH-C1')
        expect(closedJson).toContain('🔒 ปิดกะแล้ว')
        expect(closedJson).toContain('🟢 ตรงพอดี')

        const openJson = JSON.stringify(cards[1])
        expect(openJson).toContain('SH-OPEN-LIVE')
        expect(openJson).toContain('🟢 กะกำลังเปิดอยู่ (ยังไม่ปิดกะ)')
        expect(openJson).toContain('เปิดโดย พนักงานเปิดกะ')
        expect(openJson).not.toContain('Invalid Date')
        // 500 + 100 + 200 - 150 = 650
        expect(openJson).toContain('฿650')
        expect(openJson).toContain('฿300')
        expect(openJson).toContain('฿100')
        expect(openJson).toContain('฿200')
        expect(openJson).toContain('ยังไม่นับ')
        expect(openJson).not.toContain('ของยกเลิก')
        expect(openJson).not.toContain('ขาด')
        expect(openJson).not.toContain('เกิน')
        expect(openJson).not.toContain('ตรงพอดี')
        expect(openJson).not.toContain('→ ฿0')

        // สรุปการปิดกะ คืนเฉพาะกะที่ปิดแล้ว (ไม่รวมกะ OPEN)
        const eosOnly = await sayInGroup(gid, opener.uid, 'สรุปการปิดกะ')
        expect(eosOnly).toHaveLength(1)
        const eosArr = Array.isArray(eosOnly[0]) ? eosOnly[0] : [eosOnly[0]]
        expect(eosArr).toHaveLength(1)
        expect(JSON.stringify(eosArr)).toContain('SH-C1')
        expect(JSON.stringify(eosArr)).not.toContain('SH-OPEN-LIVE')

        // กะเปิดที่ยอดเป็น 0 ทุกอย่าง (opening_cash = 0, 0 บิล) ต้องไม่ขึ้น ขาด/เกิน/ตรงพอดี
        const Z = company('ร้านศูนย์-' + generateId().slice(0, 4), { shiftGroups: 1 })
        const zMaster = master(Z.tenantId)
        insertShift(Z.tenantId, { shiftNumber: 'SH-ZERO-OPEN', status: 'OPEN', openedAt: openAt, openingCash: 0 })
        const zOut = await say(zMaster, '/สรุป')
        const zJson = JSON.stringify(zOut)
        expect(zJson).toContain('SH-ZERO-OPEN')
        expect(zJson).toContain('ยังไม่นับ')
        expect(zJson).not.toContain('ขาด')
        expect(zJson).not.toContain('เกิน')
        expect(zJson).not.toContain('ตรงพอดี')
        expect(zJson).not.toContain('→ ฿0')
        expect(push).not.toHaveBeenCalled()
    })

    it('5. ข้ามเที่ยงคืน UTC / เวลาไทย (+07:00) สำหรับ /สรุป เมื่อวาน และไม่รวมกะ OPEN ในเมื่อวาน', async () => {
        const { say } = rig()
        const today = thaiToday()
        const yesterday = addDaysStr(today, -1)
        const twoDaysAgo = addDaysStr(today, -2)
        const A = company('ร้านเที่ยงคืน-' + generateId().slice(0, 4))
        const m = master(A.tenantId)

        // A: 16:59Z ของ twoDaysAgo = 23:59 ไทย twoDaysAgo → ไม่รวมในเมื่อวาน
        insertShift(A.tenantId, { shiftNumber: 'SH-BOUND-A', status: 'CLOSED', openedAt: `${twoDaysAgo}T10:00:00.000Z`, closedAt: `${twoDaysAgo}T16:59:00.000Z` })
        // B: 17:01Z ของ twoDaysAgo = 00:01 ไทย yesterday → รวมในเมื่อวาน
        insertShift(A.tenantId, { shiftNumber: 'SH-BOUND-B', status: 'CLOSED', openedAt: `${twoDaysAgo}T12:00:00.000Z`, closedAt: `${twoDaysAgo}T17:01:00.000Z` })
        // C: 16:59Z ของ yesterday = 23:59 ไทย yesterday → รวมในเมื่อวาน
        insertShift(A.tenantId, { shiftNumber: 'SH-BOUND-C', status: 'CLOSED', openedAt: `${yesterday}T10:00:00.000Z`, closedAt: `${yesterday}T16:59:00.000Z` })
        // D: 17:01Z ของ yesterday = 00:01 ไทย today → ไม่รวมในเมื่อวาน, รวมในวันนี้
        insertShift(A.tenantId, { shiftNumber: 'SH-BOUND-D', status: 'CLOSED', openedAt: `${yesterday}T12:00:00.000Z`, closedAt: `${yesterday}T17:01:00.000Z` })
        // E: กะ OPEN → ไม่รวมในเมื่อวาน
        insertShift(A.tenantId, { shiftNumber: 'SH-BOUND-OPEN', status: 'OPEN', openedAt: `${yesterday}T18:00:00.000Z` })

        const yestJson = JSON.stringify(await say(m, '/สรุป เมื่อวาน'))
        expect(yestJson).not.toContain('SH-BOUND-A')
        expect(yestJson).toContain('SH-BOUND-B')
        expect(yestJson).toContain('SH-BOUND-C')
        expect(yestJson).not.toContain('SH-BOUND-D')
        expect(yestJson).not.toContain('SH-BOUND-OPEN')

        const todayJson = JSON.stringify(await say(m, '/สรุป'))
        expect(todayJson).toContain('SH-BOUND-D')
        expect(todayJson).toContain('SH-BOUND-OPEN')
        expect(todayJson).not.toContain('SH-BOUND-B')
        expect(todayJson).not.toContain('SH-BOUND-C')
    })

    it('6. ไม่มีกะในวันนั้น (toggle ON) → ข้อความไทยสั้นตรงตามกรณี', async () => {
        const { sayInGroup } = rig()
        const A = company('ร้านว่าง-' + generateId().slice(0, 4), { shiftGroups: 1 })
        const gid = bindGroup(A.tenantId, 1)
        const staff = member(A.tenantId, 'USER')

        const outToday = await sayInGroup(gid, staff.uid, '/สรุป')
        expect(outToday).toHaveLength(1)
        expect(outToday[0]).toEqual([{ type: 'text', text: 'วันนี้ยังไม่มีกะที่เปิดหรือปิดครับ' }])

        const outYest = await sayInGroup(gid, staff.uid, '/สรุป เมื่อวาน')
        expect(outYest).toHaveLength(1)
        expect(outYest[0]).toEqual([{ type: 'text', text: 'เมื่อวานไม่มีกะที่ปิดครับ' }])
    })

    it('7. เกิน 5 กะ → จำกัด 5 ข้อความ (การ์ดล่าสุด 4 ใบ + ข้อความสรุปจำนวนกะและลิงก์เว็บ)', async () => {
        const { say } = rig()
        const today = thaiToday()
        const yesterday = addDaysStr(today, -1)
        const A = company('ร้านหลายกะ-' + generateId().slice(0, 4))
        const m = master(A.tenantId)

        // วันนี้: 5 CLOSED + 1 OPEN = 6 กะ
        for (let i = 1; i <= 5; i++) {
            insertShift(A.tenantId, {
                shiftNumber: `SH-T${i}`, status: 'CLOSED',
                openedAt: `${today}T01:0${i}:00.000Z`, closedAt: `${today}T02:0${i}:00.000Z`,
            })
        }
        insertShift(A.tenantId, { shiftNumber: 'SH-T-OPEN', status: 'OPEN', openedAt: `${today}T03:00:00.000Z` })

        const todayReply = (await say(m, '/สรุป'))[0] as any[]
        expect(todayReply).toHaveLength(5)
        expect(todayReply.slice(0, 4).every(c => c.type === 'flex')).toBe(true)
        const shownToday = todayReply.slice(0, 4).map(c => c.contents.header.contents[1].text)
        expect(shownToday).toEqual(['SH-T3', 'SH-T4', 'SH-T5', 'SH-T-OPEN'])
        expect(todayReply[4].type).toBe('text')
        expect(todayReply[4].text).toContain('6')
        expect(todayReply[4].text).toContain('https://')

        // เมื่อวาน: 6 CLOSED = 6 กะ
        for (let i = 1; i <= 6; i++) {
            insertShift(A.tenantId, {
                shiftNumber: `SH-Y${i}`, status: 'CLOSED',
                openedAt: `${yesterday}T01:0${i}:00.000Z`, closedAt: `${yesterday}T02:0${i}:00.000Z`,
            })
        }
        const yestReply = (await say(m, '/สรุป เมื่อวาน'))[0] as any[]
        expect(yestReply).toHaveLength(5)
        expect(yestReply.slice(0, 4).every(c => c.type === 'flex')).toBe(true)
        const shownYest = yestReply.slice(0, 4).map(c => c.contents.header.contents[1].text)
        expect(shownYest).toEqual(['SH-Y3', 'SH-Y4', 'SH-Y5', 'SH-Y6'])
        expect(yestReply[4].type).toBe('text')
        expect(yestReply[4].text).toContain('6')
        expect(yestReply[4].text).toContain('https://')
    })

    it('8. แยกข้อมูลข้ามบริษัท (Tenant Isolation)', async () => {
        const { say } = rig()
        const today = thaiToday()
        const A = company('บริษัทเอแยก-' + generateId().slice(0, 4))
        const B = company('บริษัทบีแยก-' + generateId().slice(0, 4))
        const mA = master(A.tenantId)
        const shB = insertShift(B.tenantId, {
            shiftNumber: 'SH-SECRET-B', status: 'OPEN', openedAt: `${today}T02:00:00.000Z`, openingCash: 9999,
        })
        const dishB = addStockItem(B.tenantId, { name: 'เมนูลับบี', sku: 'SEC-B' })
        const menuB = addMenu(B.tenantId, dishB, { price: 500 })
        addBill(B.tenantId, {
            shiftId: shB, totalAmount: 500, discountAmount: 100, discountReason: 'Shopee',
            openedAt: `${today}T02:00:00.000Z`, closedAt: `${today}T02:00:00.000Z`,
            items: [{ menuId: menuB, name: 'เมนูลับบี', qty: 1, price: 500 }],
            payments: [{ method: 'CASH', amount: 500 }],
        })
        addCashMovement(B.tenantId, shB, 'PAID_OUT', 777, 'ความลับบี')

        expect(buildShiftSummary(A.tenantId, shB)).toBeNull()
        const out = JSON.stringify(await say(mA, '/สรุป'))
        expect(out).not.toContain('SH-SECRET-B')
        expect(out).not.toContain('เมนูลับบี')
        expect(out).not.toContain('ความลับบี')
        expect(out).not.toContain('9,999')
    })

    it('9. ส่วน Platform / Delivery แสดงเสมอ (ทั้งตอนไม่มีรายการและมีรายการ, ทั้ง /สรุป และ notifyShiftClosed)', async () => {
        const { push, say } = rig()
        const today = thaiToday()
        const A = company('ร้านแพลตฟอร์ม-' + generateId().slice(0, 4))
        const admin = member(A.tenantId, 'ADMIN')
        const m = master(A.tenantId)
        const shEmpty = insertShift(A.tenantId, {
            shiftNumber: 'SH-NO-DLV', status: 'CLOSED',
            openedAt: `${today}T01:00:00.000Z`, closedAt: `${today}T03:00:00.000Z`,
        })

        // notifyShiftClosed push: ไม่มีรายการแพลตฟอร์มก็ต้องแสดง section นี้
        await lineBotService.notifyShiftClosed(A.tenantId, buildShiftSummary(A.tenantId, shEmpty))
        expect(push).toHaveBeenCalledTimes(1)
        const pushedJson = JSON.stringify(push.mock.calls[0][1])
        expect(pushedJson).toContain('🛵 ยอด Delivery / ส่วนลด > 20%')
        expect(pushedJson).toContain('ไม่มีรายการแพลตฟอร์มในกะนี้')

        // /สรุป เมื่อไม่มีรายการแพลตฟอร์ม
        const replyEmpty = JSON.stringify(await say(m, '/สรุป'))
        expect(replyEmpty).toContain('🛵 ยอด Delivery / ส่วนลด > 20%')
        expect(replyEmpty).toContain('ไม่มีรายการแพลตฟอร์มในกะนี้')

        // กะที่มี Shopee / LINE MAN / Grab
        const shDlv = insertShift(A.tenantId, {
            shiftNumber: 'SH-WITH-DLV', status: 'CLOSED',
            openedAt: `${today}T04:00:00.000Z`, closedAt: `${today}T06:00:00.000Z`,
        })
        addBill(A.tenantId, { shiftId: shDlv, subtotal: 200, discountAmount: 50, totalAmount: 150, discountReason: 'Shopee' })
        addBill(A.tenantId, { shiftId: shDlv, subtotal: 300, discountAmount: 60, totalAmount: 240, discountReason: 'LINE MAN' })
        addBill(A.tenantId, { shiftId: shDlv, subtotal: 400, discountAmount: 100, totalAmount: 300, discountReason: 'GrabFood' })

        const replyDlv = JSON.stringify(await say(m, '/สรุป'))
        expect(replyDlv).toContain('รวม 3 บิล')
        expect(replyDlv).toContain('Shopee (1 บิล)')
        expect(replyDlv).toContain('LINE MAN (1 บิล)')
        expect(replyDlv).toContain('Grab (1 บิล)')
        expect(admin.uid).toBeTruthy()
    })

    it('10. อัปเดตข้อความ /คำสั่ง, /ผูก pos และผูกกลุ่ม 6 หลักให้ตรงกับ /สรุป สรุปกะ', async () => {
        const { say, sayInGroup } = rig()
        const A = company('ร้านข้อความ-' + generateId().slice(0, 4))
        const m = master(A.tenantId)
        const admin = member(A.tenantId, 'ADMIN')

        const cmdText = JSON.stringify(await say(m, '/คำสั่ง'))
        expect(cmdText).toContain('/สรุป [วันนี้|เมื่อวาน|เดือนนี้]')
        expect(cmdText).toContain('สรุปกะ')
        expect(cmdText).toContain('/pos [วันนี้|เมื่อวาน|เดือนนี้]')
        expect(cmdText).toContain('ดูสรุปกะ/ยอด POS ได้')

        const gid1 = newGroup()
        const bindPosText = JSON.stringify(await sayInGroup(gid1, m, `/ผูก pos tenant ${A.tenantId}`))
        expect(bindPosText).toContain('/สรุป ดูสรุปกะของบริษัทนี้ได้')
        expect(bindPosText).toContain('ต้องเปิดสิทธิ์สรุปปิดกะในกลุ่มที่ตั้งค่า ไม่งั้นแสดงยอด POS')

        const gid2 = newGroup()
        const tok = lineBotService.generateLinkToken(A.tenantId, admin.userId)
        const linkText = JSON.stringify(await sayInGroup(gid2, admin.uid, tok))
        expect(linkText).toContain(`✅ ผูกกลุ่มนี้กับ ${A.name} แล้ว`)
        expect(linkText).toContain('ดูสรุปกะ/ยอด POS ให้ Master พิมพ์ /ผูก pos tenant <รหัส>')
    })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Goal B — /สินค้า Recipe Ingredients & Latest GR Prices
// ═══════════════════════════════════════════════════════════════════════════════
describe('LINE Goal B: /สินค้า Recipe Ingredients & Latest GR Prices', () => {
    it('11. เมนูไม่มีใบรับซื้อ + มีสูตร: pos_menu_configs.bom_id ชนะ fallback ACTIVE BOM, แสดงวันที่และราคา/หน่วยซื้อ, ไม่มี qty/ต้นทุน/กำไร', async () => {
        const { push, say } = rig()
        const A = company('ร้านสูตรเอ')
        const admin = member(A.tenantId, 'ADMIN')
        const dish = addStockItem(A.tenantId, { name: 'ข้าวผัดกุ้ง', sku: 'DISH-01', qty: 0, unit: 'จาน' })
        const shrimp = addStockItem(A.tenantId, { name: 'กุ้งสด', sku: 'ING-SHR', qty: 50, unit: 'g' })
        const rice = addStockItem(A.tenantId, { name: 'ข้าวหอม', sku: 'ING-RICE', qty: 50, unit: 'g' })
        const wrongIng = addStockItem(A.tenantId, { name: 'หมูสับสูตรอื่น', sku: 'ING-PORK', qty: 50, unit: 'g' })

        // BOM-B (ACTIVE ล่าสุดของ product) vs BOM-A (ถูกเลือกไว้ใน pos_menu_configs.bom_id)
        const bomA = addBOM(A.tenantId, dish, { version: 'v1', status: 'ACTIVE', createdAt: '2026-11-01T00:00:00.000Z' })
        addBOMItem(A.tenantId, bomA, { materialId: shrimp, quantity: 123.45, sortOrder: 1 })
        addBOMItem(A.tenantId, bomA, { materialId: rice, quantity: 234.56, sortOrder: 2 })
        const bomB = addBOM(A.tenantId, dish, { version: 'v2', status: 'ACTIVE', createdAt: '2026-11-10T00:00:00.000Z' })
        addBOMItem(A.tenantId, bomB, { materialId: wrongIng, quantity: 99, sortOrder: 1 })

        const menuId = addMenu(A.tenantId, dish, { bomId: bomA, price: 120, saleUnit: 'จาน' })
        addBill(A.tenantId, {
            totalAmount: 120, openedAt: '2026-11-20T05:00:00.000Z', closedAt: '2026-11-20T05:00:00.000Z',
            items: [{ menuId, name: 'ข้าวผัดกุ้ง', qty: 1, price: 120 }],
            payments: [{ method: 'CASH', amount: 120 }],
        })

        addGR(A.tenantId, { stockItemId: shrimp, grNumber: 'GR-SHR', receiptDate: '2026-11-18', acceptedQty: 2, unit: 'กก.', unitPrice: 320, stockQty: 2000 })
        addGR(A.tenantId, { stockItemId: rice, grNumber: 'GR-RICE', receiptDate: '2026-11-15', acceptedQty: 1, unit: 'กระสอบ', unitPrice: 450, stockQty: 5000 })
        addGR(A.tenantId, { stockItemId: wrongIng, grNumber: 'GR-PRK', receiptDate: '2026-11-19', acceptedQty: 1, unit: 'กก.', unitPrice: 180, stockQty: 1000 })

        const out = await say(admin.uid, '/สินค้า ข้าวผัดกุ้ง')
        expect(out).toHaveLength(1)
        const json = JSON.stringify(out[0])
        expect(json).toContain('฿120/จาน')
        expect(json).toContain('วัตถุดิบในสูตร (ราคาล่าสุด)')
        expect(json).toContain('กุ้งสด')
        expect(json).toContain('18/11/26')
        expect(json).toContain('฿320/กก.')
        expect(json).toContain('ข้าวหอม')
        expect(json).toContain('15/11/26')
        expect(json).toContain('฿450/กระสอบ')
        expect(json).not.toContain('หมูสับสูตรอื่น')
        expect(json).not.toContain('123.45')
        expect(json).not.toContain('234.56')
        expect(json).not.toContain('ต้นทุน')
        expect(json).not.toContain('กำไร')
        expect(json).not.toContain('ไม่มีใบรับซื้อของรายการนี้')
        expect(push).not.toHaveBeenCalled()

        // fallback ACTIVE BOM เมื่อไม่มี menu bom_id (ข้าม DRAFT/INACTIVE)
        const dish2 = addStockItem(A.tenantId, { name: 'ต้มยำกุ้ง', sku: 'DISH-02', qty: 0, unit: 'ชาม' })
        addMenu(A.tenantId, dish2, { bomId: null, price: 150, saleUnit: 'ชาม' })
        const bomDraft = addBOM(A.tenantId, dish2, { version: 'v2', status: 'DRAFT', createdAt: '2026-11-12T00:00:00.000Z' })
        addBOMItem(A.tenantId, bomDraft, { materialId: wrongIng, quantity: 10 })
        const bomActive = addBOM(A.tenantId, dish2, { version: 'v1', status: 'ACTIVE', createdAt: '2026-11-05T00:00:00.000Z' })
        addBOMItem(A.tenantId, bomActive, { materialId: shrimp, quantity: 50 })

        const hist2 = getItemHistory(A.tenantId, dish2)
        expect(hist2.recipeIngredients?.map(r => r.stockItemId)).toEqual([shrimp])
    })

    it('12. กฎเดียวกับ getItemHistory buys: receipt_date ล่าสุด, ตัด DRAFT/CANCELLED, material_id ล้วน, stock_qty NULL, แยก tenant', async () => {
        const A = company('บริษัทเอ')
        const B = company('บริษัทบี')
        const dish = addStockItem(A.tenantId, { name: 'สลัดผัก', sku: 'SLD-1', qty: 0 })
        const ing = addStockItem(A.tenantId, { name: 'ผักสลัด', sku: 'VEG-1', qty: 10, unit: 'g' })
        const bomA = addBOM(A.tenantId, dish, { status: 'ACTIVE' })
        addBOMItem(A.tenantId, bomA, { materialId: ing, quantity: 100 })

        // เก่ากว่าตาม receipt_date แต่ created_at ใหม่กว่า
        addGR(A.tenantId, {
            stockItemId: ing, grNumber: 'GR-OLD', receiptDate: '2026-10-01', createdAt: '2026-11-24T00:00:00.000Z',
            acceptedQty: 1, unit: 'กก.', unitPrice: 80, stockQty: 1000, status: 'CONFIRMED',
        })
        // ใหม่สุดตาม receipt_date, ผูกด้วย material_id ล้วน (stock_item_id = NULL), stock_qty = NULL
        addGR(A.tenantId, {
            stockItemId: null, materialId: ing, grNumber: 'GR-MAT-NEW', receiptDate: '2026-11-10', createdAt: '2026-11-01T00:00:00.000Z',
            acceptedQty: 2, unit: 'ถุง', unitPrice: 110, stockQty: null, status: 'CONFIRMED',
        })
        // DRAFT / CANCELLED ห้ามนับ
        addGR(A.tenantId, { stockItemId: ing, grNumber: 'GR-DR', receiptDate: '2026-11-22', acceptedQty: 1, unit: 'ถุง', unitPrice: 999, status: 'DRAFT' })
        addGR(A.tenantId, { stockItemId: ing, grNumber: 'GR-CN', receiptDate: '2026-11-23', acceptedQty: 1, unit: 'ถุง', unitPrice: 888, status: 'CANCELLED' })
        // ของบริษัทอื่น ห้ามนับ
        addGR(B.tenantId, { stockItemId: ing, grNumber: 'GR-OTHER', receiptDate: '2026-11-24', acceptedQty: 1, unit: 'ถุง', unitPrice: 777, status: 'CONFIRMED' })

        const hist = getItemHistory(A.tenantId, dish)
        expect(hist.recipeIngredients).toHaveLength(1)
        expect(hist.recipeIngredients![0]).toMatchObject({
            stockItemId: ing,
            date: '2026-11-10',
            unit: 'ถุง',
            price: 110,
        })
    })

    it('13. CHILD_BOM, MATERIAL ที่มี BOM ของตัวเอง (มี GR หยุด / ไม่มี GR แตกต่อ), deduplicate, ป้องกัน circular BOM', async () => {
        const A = company('บริษัทซับซ้อน')
        const dish = addStockItem(A.tenantId, { name: 'ชุดข้าวแกง', sku: 'SET-1', qty: 0 })
        const sauceItem = addStockItem(A.tenantId, { name: 'ซอสปรุงรส', sku: 'SAUCE-1', qty: 0 })
        const boughtSemi = addStockItem(A.tenantId, { name: 'พริกแกงสำเร็จ', sku: 'PASTE-1', qty: 5 })
        const unboughtSemi = addStockItem(A.tenantId, { name: 'น้ำสต๊อกโฮมเมด', sku: 'STOCK-1', qty: 0 })
        const soy = addStockItem(A.tenantId, { name: 'ซีอิ๊วขาว', sku: 'SOY-1', qty: 10 })
        const sugar = addStockItem(A.tenantId, { name: 'น้ำตาล', sku: 'SUG-1', qty: 10 })
        const bone = addStockItem(A.tenantId, { name: 'กระดูกหมู', sku: 'BONE-1', qty: 10 })
        const hiddenSub = addStockItem(A.tenantId, { name: 'พริกแห้งลับ', sku: 'CHILI-HID', qty: 10 })

        // ซอสปรุงรส (CHILD_BOM): ซีอิ๊วขาว + น้ำตาล
        const sauceBom = addBOM(A.tenantId, sauceItem, { status: 'ACTIVE' })
        addBOMItem(A.tenantId, sauceBom, { materialId: soy, sortOrder: 1 })
        addBOMItem(A.tenantId, sauceBom, { materialId: sugar, sortOrder: 2 })

        // พริกแกงสำเร็จ มี ACTIVE BOM แต่มี GR อยู่แล้ว → ต้องหยุดที่พริกแกงสำเร็จ ไม่แตกไปหาพริกแห้งลับ
        const pasteBom = addBOM(A.tenantId, boughtSemi, { status: 'ACTIVE' })
        addBOMItem(A.tenantId, pasteBom, { materialId: hiddenSub, sortOrder: 1 })
        addGR(A.tenantId, { stockItemId: boughtSemi, grNumber: 'GR-PASTE', receiptDate: '2026-11-12', acceptedQty: 1, unit: 'กก.', unitPrice: 140 })

        // น้ำสต๊อก ไม่มี GR และมี ACTIVE BOM → แตกไปหากระดูกหมู + ซีอิ๊วขาว (ซ้ำกับซอส → ต้องแสดงครั้งเดียว)
        const stockBom = addBOM(A.tenantId, unboughtSemi, { status: 'ACTIVE' })
        addBOMItem(A.tenantId, stockBom, { materialId: bone, sortOrder: 1 })
        addBOMItem(A.tenantId, stockBom, { materialId: soy, sortOrder: 2 })

        addGR(A.tenantId, { stockItemId: soy, grNumber: 'GR-SOY', receiptDate: '2026-11-11', acceptedQty: 1, unit: 'ขวด', unitPrice: 35 })
        addGR(A.tenantId, { stockItemId: sugar, grNumber: 'GR-SUG', receiptDate: '2026-11-10', acceptedQty: 1, unit: 'กก.', unitPrice: 25 })
        addGR(A.tenantId, { stockItemId: bone, grNumber: 'GR-BONE', receiptDate: '2026-11-09', acceptedQty: 1, unit: 'กก.', unitPrice: 90 })

        const rootBom = addBOM(A.tenantId, dish, { status: 'ACTIVE' })
        addBOMItem(A.tenantId, rootBom, { itemType: 'CHILD_BOM', childBomId: sauceBom, sortOrder: 1 })
        addBOMItem(A.tenantId, rootBom, { itemType: 'MATERIAL', materialId: boughtSemi, sortOrder: 2 })
        addBOMItem(A.tenantId, rootBom, { itemType: 'MATERIAL', materialId: unboughtSemi, sortOrder: 3 })
        addBOMItem(A.tenantId, rootBom, { itemType: 'MATERIAL', materialId: sugar, sortOrder: 4 }) // ซ้ำ

        const hist = getItemHistory(A.tenantId, dish)
        const ids = hist.recipeIngredients!.map(r => r.stockItemId)
        expect(ids).toEqual([soy, sugar, boughtSemi, bone])
        expect(ids).not.toContain(hiddenSub)

        // ทดสอบ circular BOM (BOM-A -> BOM-B -> BOM-A และ self-loop BOM-A -> BOM-A)
        const cycProd1 = addStockItem(A.tenantId, { name: 'วนลูป 1', sku: 'CYC-1', qty: 0 })
        const cycProd2 = addStockItem(A.tenantId, { name: 'วนลูป 2', sku: 'CYC-2', qty: 0 })
        const bom1 = addBOM(A.tenantId, cycProd1, { status: 'ACTIVE' })
        const bom2 = addBOM(A.tenantId, cycProd2, { status: 'ACTIVE' })
        addBOMItem(A.tenantId, bom1, { itemType: 'CHILD_BOM', childBomId: bom2, sortOrder: 1 })
        addBOMItem(A.tenantId, bom1, { itemType: 'CHILD_BOM', childBomId: bom1, sortOrder: 2 }) // self-loop
        addBOMItem(A.tenantId, bom1, { itemType: 'MATERIAL', materialId: soy, sortOrder: 3 })
        addBOMItem(A.tenantId, bom2, { itemType: 'CHILD_BOM', childBomId: bom1, sortOrder: 1 })
        addBOMItem(A.tenantId, bom2, { itemType: 'MATERIAL', materialId: bone, sortOrder: 2 })

        const cycHist = getItemHistory(A.tenantId, cycProd1)
        expect(cycHist.recipeIngredients!.map(r => r.stockItemId)).toEqual([bone, soy])
    })

    it('14. วัตถุดิบที่ไม่มีใบรับซื้อเลย (หรือมีแต่ DRAFT) → แสดง ไม่มีใบรับซื้อ', async () => {
        const { say } = rig()
        const A = company('บริษัทไม่มีใบรับซื้อ')
        const admin = member(A.tenantId, 'ADMIN')
        const dish = addStockItem(A.tenantId, { name: 'น้ำปั่นพิเศษ', sku: 'SM-1', qty: 0 })
        const noGrIng = addStockItem(A.tenantId, { name: 'ผลไม้ป่า', sku: 'FR-1', qty: 5 })
        const bom = addBOM(A.tenantId, dish, { status: 'ACTIVE' })
        addBOMItem(A.tenantId, bom, { materialId: noGrIng })
        addGR(A.tenantId, { stockItemId: noGrIng, grNumber: 'GR-DRAFT-ONLY', receiptDate: '2026-11-20', acceptedQty: 1, unit: 'กก.', unitPrice: 99, status: 'DRAFT' })

        const json = JSON.stringify(await say(admin.uid, '/สินค้า น้ำปั่นพิเศษ'))
        expect(json).toContain('ผลไม้ป่า')
        expect(json).toContain('ไม่มีใบรับซื้อ')
        expect(json).not.toContain('ไม่มีใบรับซื้อของรายการนี้')
    })

    it('15. วัตถุดิบเกิน 15 รายการ → แสดง 15 รายการแรก + และอีก N รายการ', async () => {
        const { say } = rig()
        const A = company('บริษัท18วัตถุดิบ')
        const admin = member(A.tenantId, 'ADMIN')
        const dish = addStockItem(A.tenantId, { name: 'เมนูอลังการ', sku: 'BIG-1', qty: 0 })
        const bom = addBOM(A.tenantId, dish, { status: 'ACTIVE' })

        for (let i = 1; i <= 18; i++) {
            const code = String(i).padStart(2, '0')
            const ing = addStockItem(A.tenantId, { name: `วัตถุดิบที่ ${code}`, sku: `ING-${code}`, qty: 1 })
            addBOMItem(A.tenantId, bom, { materialId: ing, sortOrder: i })
            addGR(A.tenantId, { stockItemId: ing, grNumber: `GR-${code}`, receiptDate: '2026-11-10', acceptedQty: 1, unit: 'กก.', unitPrice: 10 + i })
        }

        const json = JSON.stringify(await say(admin.uid, '/สินค้า เมนูอลังการ'))
        for (let i = 1; i <= 15; i++) {
            expect(json).toContain(`วัตถุดิบที่ ${String(i).padStart(2, '0')}`)
        }
        expect(json).not.toContain('วัตถุดิบที่ 16')
        expect(json).not.toContain('วัตถุดิบที่ 17')
        expect(json).not.toContain('วัตถุดิบที่ 18')
        expect(json).toContain('และอีก 3 รายการ')
    })

    it('16. ซ่อน vs คงข้อความ ไม่มีใบรับซื้อของรายการนี้ จึงไม่มีราคาซื้อ', async () => {
        const { say } = rig()
        const A = company('บริษัทข้อความใบรับ')
        const admin = member(A.tenantId, 'ADMIN')
        const ing = addStockItem(A.tenantId, { name: 'น้ำเชื่อม', sku: 'SYR-1', qty: 10 })
        addGR(A.tenantId, { stockItemId: ing, grNumber: 'GR-SYR', receiptDate: '2026-11-10', acceptedQty: 1, unit: 'ขวด', unitPrice: 60 })

        // (a) มีทั้ง GR ของตัวเอง และมี BOM → แสดงประวัติซื้อขายปกติ ไม่แสดงส่วนสูตร
        const itemWithGr = addStockItem(A.tenantId, { name: 'กาแฟซื้อเอง', sku: 'COF-GR', qty: 10 })
        addGR(A.tenantId, { stockItemId: itemWithGr, grNumber: 'GR-SELF', receiptDate: '2026-11-12', acceptedQty: 1, unit: 'ถุง', unitPrice: 250 })
        const bomWithGr = addBOM(A.tenantId, itemWithGr, { status: 'ACTIVE' })
        addBOMItem(A.tenantId, bomWithGr, { materialId: ing })
        const jsonA = JSON.stringify(await say(admin.uid, '/สินค้า กาแฟซื้อเอง'))
        expect(jsonA).toContain('฿250/ถุง')
        expect(jsonA).not.toContain('วัตถุดิบในสูตร (ราคาล่าสุด)')
        expect(jsonA).not.toContain('ไม่มีใบรับซื้อของรายการนี้')

        // (b) ไม่มี GR และไม่มี BOM (มีขาย) → คงข้อความ ไม่มีใบรับซื้อของรายการนี้ จึงไม่มีราคาซื้อ
        const itemNoBom = addStockItem(A.tenantId, { name: 'เมนูไม่มีสูตร', sku: 'NO-BOM', qty: 0 })
        const menuNoBom = addMenu(A.tenantId, itemNoBom, { price: 70, saleUnit: 'แก้ว' })
        addBill(A.tenantId, {
            totalAmount: 70, openedAt: '2026-11-15T05:00:00.000Z', closedAt: '2026-11-15T05:00:00.000Z',
            items: [{ menuId: menuNoBom, name: 'เมนูไม่มีสูตร', qty: 1, price: 70 }],
            payments: [{ method: 'CASH', amount: 70 }],
        })
        const jsonB = JSON.stringify(await say(admin.uid, '/สินค้า เมนูไม่มีสูตร'))
        expect(jsonB).toContain('ไม่มีใบรับซื้อของรายการนี้ จึงไม่มีราคาซื้อ')
        expect(jsonB).not.toContain('วัตถุดิบในสูตร (ราคาล่าสุด)')

        // (c) ไม่มี GR, ไม่มีขาย, แต่มี BOM → แสดง ยังไม่มีประวัติซื้อ-ขาย + ส่วนสูตร และซ่อน ไม่มีใบรับซื้อของรายการนี้...
        const itemNoSalesBom = addStockItem(A.tenantId, { name: 'เมนูใหม่ยังไม่ขาย', sku: 'NEW-BOM', qty: 0 })
        const bomNew = addBOM(A.tenantId, itemNoSalesBom, { status: 'ACTIVE' })
        addBOMItem(A.tenantId, bomNew, { materialId: ing })
        const jsonC = JSON.stringify(await say(admin.uid, '/สินค้า เมนูใหม่ยังไม่ขาย'))
        expect(jsonC).toContain('ยังไม่มีประวัติซื้อ-ขาย')
        expect(jsonC).toContain('วัตถุดิบในสูตร (ราคาล่าสุด)')
        expect(jsonC).toContain('น้ำเชื่อม')
        expect(jsonC).not.toContain('ไม่มีใบรับซื้อของรายการนี้')
    })
})
