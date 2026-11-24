import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { richMenus } from './line-richmenu.service'
import { lineBotService } from './line-bot.service'
import { getItemHistory } from './stockCostBasis.service'
import { normName } from './stockItem.service'

const MASTER_EMAIL = 'm@hrprod.test'
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
    }
    for (const l of lines.splice(0)) {
        for (const tb of ['line_pending_tasks', 'line_master_links', 'line_master_notify', 'line_user_mappings']) {
            db.prepare(`DELETE FROM ${tb} WHERE line_user_id = ?`).run(l)
        }
    }
    for (const t of tenants.splice(0)) {
        for (const tb of [
            'line_pending_tasks', 'approval_logs', 'approval_requests', 'user_approval_permissions',
            'leave_requests', 'leave_types', 'employees', 'org_units',
            'pos_stock_deductions', 'pos_bill_items', 'pos_menu_configs', 'pos_running_bills',
            'sales_order_items', 'sales_orders', 'customers',
            'goods_receipt_items', 'goods_receipts', 'purchase_order_items', 'purchase_orders', 'suppliers',
            'stock_item_aliases', 'stock_items',
            'line_group_mappings', 'line_user_mappings', 'tenant_subscriptions', 'users', 'company_settings',
        ]) {
            try { db.prepare(`DELETE FROM ${tb} WHERE tenant_id = ?`).run(t) } catch {}
        }
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
    vi.spyOn(lineBotService, 'notifyApprovalDecision').mockResolvedValue(undefined as any)
    vi.spyOn(richMenus, 'syncUser').mockResolvedValue()

    const send = async (source: any, text: string) => {
        const n = replies.length
        const event = { replyToken: 'rt', source, type: 'message', message: { type: 'text', text } }
        await lineBotService.handleEvent(lineBotService.resolveTenant(event), event)
        return replies.slice(n)
    }
    const postback = async (tenantId: string, source: any, data: string) => {
        const n = replies.length
        const event = { replyToken: 'rt', source, type: 'postback', postback: { data } }
        await lineBotService.handleEvent(tenantId, event)
        return replies.slice(n)
    }
    const say = (uid: string, text: string) => send({ type: 'user', userId: uid }, text)
    const sayInGroup = (gid: string, uid: string, text: string) => send({ type: 'group', groupId: gid, userId: uid }, text)
    return { push, say, sayInGroup, postback }
}

function company(name: string, opts: { aliasEnabled?: number } = {}) {
    const tenantId = 'tenant_hp_' + generateId().slice(0, 8)
    tenants.push(tenantId)
    try {
        db.prepare('INSERT INTO company_settings (id, tenant_id, name, stock_alias_enabled) VALUES (?, ?, ?, ?)')
            .run(generateId(), tenantId, name, opts.aliasEnabled ?? 1)
    } catch {
        db.prepare('INSERT INTO company_settings (tenant_id, name, stock_alias_enabled) VALUES (?, ?, ?)')
            .run(tenantId, name, opts.aliasEnabled ?? 1)
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

function member(tenantId: string, role: string, departments: string[] = []) {
    const userId = generateId()
    const uid = 'U' + generateId()
    lines.push(uid)
    db.prepare(`INSERT INTO users (id, email, password, name, role, departments, tenant_id, status) VALUES (?, ?, 'x', 'พนักงาน', ?, ?, ?, 'active')`)
        .run(userId, `${userId}@hrprod.test`, role, departments.length ? JSON.stringify(departments) : null, tenantId)
    db.prepare('INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role) VALUES (?, ?, ?, ?, ?)')
        .run(generateId(), tenantId, userId, uid, role)
    return { userId, uid }
}

function bindGroup(tenantId: string) {
    const gid = 'C' + generateId().slice(0, 16)
    groups.push(gid)
    db.prepare('INSERT INTO line_group_mappings (id, tenant_id, group_id, is_active, pos_daily) VALUES (?, ?, ?, 1, 0)')
        .run(generateId(), tenantId, gid)
    return gid
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

function addAlias(tenantId: string, stockItemId: string, aliasName: string) {
    const now = new Date().toISOString()
    db.prepare(`
        INSERT INTO stock_item_aliases (id, tenant_id, name_norm, name, stock_item_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(generateId(), tenantId, normName(aliasName), aliasName, stockItemId, now, now)
}

function addGR(tenantId: string, o: {
    stockItemId?: string | null
    materialId?: string | null
    grNumber: string
    supplierName: string
    receiptDate: string
    createdAt?: string
    acceptedQty: number
    unit: string
    unitPrice: number
    stockQty?: number | null
    status?: string
}) {
    const supId = generateId(), poId = generateId(), poiId = generateId(), grId = generateId()
    const createdAt = o.createdAt ?? new Date().toISOString()
    db.prepare(`INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, ?, 'c')`)
        .run(supId, tenantId, 'SUP-' + supId.slice(0, 6), o.supplierName)
    db.prepare(`INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status) VALUES (?, ?, ?, ?, 'APPROVED')`)
        .run(poId, tenantId, 'PO-' + poId.slice(0, 6), supId)
    db.prepare(`INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, quantity, unit, unit_price, total_price)
        VALUES (?, ?, ?, ?, 'desc', ?, ?, ?, ?)`)
        .run(poiId, tenantId, poId, o.stockItemId ?? o.materialId ?? null, o.acceptedQty, o.unit, o.unitPrice, o.acceptedQty * o.unitPrice)
    db.prepare(`INSERT INTO goods_receipts (id, tenant_id, gr_number, purchase_order_id, supplier_id, receipt_date, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(grId, tenantId, o.grNumber, poId, supId, o.receiptDate, o.status ?? 'CONFIRMED', createdAt)
    db.prepare(`INSERT INTO goods_receipt_items (id, tenant_id, goods_receipt_id, purchase_order_item_id, material_id, stock_item_id, accepted_qty, stock_qty)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(generateId(), tenantId, grId, poiId, o.materialId ?? null, o.stockItemId ?? null, o.acceptedQty, o.stockQty ?? null)
}

function addSO(tenantId: string, o: {
    stockItemId: string
    soNumber: string
    customerName: string
    orderDate: string
    qty: number
    unit: string
    unitPrice: number
    status?: string
}) {
    const custId = generateId(), soId = generateId()
    db.prepare(`INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city)
        VALUES (?, ?, ?, ?, 'RETAIL', 'c', 'c@t.test', '080', 'BKK')`)
        .run(custId, tenantId, 'CUS-' + custId.slice(0, 6), o.customerName)
    db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, order_date, status)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(soId, tenantId, o.soNumber, custId, o.orderDate, o.status ?? 'CONFIRMED')
    db.prepare(`INSERT INTO sales_order_items (id, tenant_id, sales_order_id, stock_item_id, quantity, unit, unit_price, total_price)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(generateId(), tenantId, soId, o.stockItemId, o.qty, o.unit, o.unitPrice, o.qty * o.unitPrice)
}

function addPosDeduction(tenantId: string, stockItemId: string, qty: number, deductedAt: string, returned = 0) {
    // เมนูคนละตัวกับวัตถุดิบ: วัตถุดิบถูกตัดเพราะขายเมนูนี้
    const menu = { id: generateId() }
    const dishId = addStockItem(tenantId, { name: 'จานเมนู', sku: 'DISH-' + menu.id })
    db.prepare('INSERT INTO pos_menu_configs (id, tenant_id, product_id, pos_price) VALUES (?, ?, ?, 50)').run(menu.id, tenantId, dishId)
    const billId = generateId(), itemId = generateId()
    db.prepare(`INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status) VALUES (?, ?, ?, 'T1', 'PAID')`)
        .run(billId, tenantId, 'B-' + billId.slice(0, 8))
    db.prepare(`INSERT INTO pos_bill_items (id, tenant_id, bill_id, pos_menu_id, product_name, quantity, unit_price, total_price)
        VALUES (?, ?, ?, ?, 'เมนู', 1, 50, 50)`).run(itemId, tenantId, billId, menu.id)
    db.prepare(`INSERT INTO pos_stock_deductions (id, tenant_id, bill_item_id, stock_item_id, quantity_deducted, deducted_at, returned)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(generateId(), tenantId, itemId, stockItemId, qty, deductedAt, returned)
}

function addApprovalRequest(tenantId: string, requesterUserId: string, o: {
    requestNumber: string
    moduleType?: string
    amount?: number
    description?: string
    status?: string
    createdAt?: string
    decidedAt?: string | null
}) {
    const now = o.createdAt ?? new Date().toISOString()
    const mod = o.moduleType ?? 'leave'
    const id = generateId()
    let refType = 'leave_requests'
    let refId = generateId()

    if (mod === 'leave') {
        const ltId = generateId(), empId = generateId()
        db.prepare(`INSERT OR IGNORE INTO leave_types (id, tenant_id, code, name, paid, days_per_year, is_active, created_at)
            VALUES (?, ?, ?, 'ลาป่วย', 1, 30, 1, ?)`).run(ltId, tenantId, 'LT-' + ltId.slice(0, 6), now)
        let emp = db.prepare('SELECT id FROM employees WHERE tenant_id = ? AND user_id = ?').get(tenantId, requesterUserId) as any
        if (!emp) {
            db.prepare(`INSERT INTO employees (id, tenant_id, code, first_name, last_name, employment_type, base_wage, start_date, status, user_id, created_at, updated_at)
                VALUES (?, ?, ?, 'สมชาย', 'ใจดี', 'MONTHLY', 15000, '2026-01-01', 'ACTIVE', ?, ?, ?)`)
                .run(empId, tenantId, 'E-' + empId.slice(0, 6), requesterUserId, now, now)
            emp = { id: empId }
        }
        db.prepare(`INSERT INTO leave_requests (id, tenant_id, employee_id, leave_type_id, start_date, end_date, days, reason, status, approval_request_id, requested_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, '2026-11-24', '2026-11-24', 1, 'ป่วย', 'PENDING', ?, ?, ?, ?)`)
            .run(refId, tenantId, emp.id, ltId, id, requesterUserId, now, now)
    } else if (mod === 'purchase_order') {
        refType = 'purchase_orders'
    }

    db.prepare(`
        INSERT INTO approval_requests (
            id, tenant_id, request_number, module_type, reference_type, reference_id,
            requester_id, requester_name, requester_role, amount, description, status,
            approver_2_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'สมชาย', 'USER', ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, o.requestNumber, mod, refType, refId, requesterUserId, o.amount ?? 0, o.description ?? 'ลาป่วย 1 วัน', o.status ?? 'PENDING', o.decidedAt ?? null, now, o.decidedAt ?? now)
    return { id, refId, requestNumber: o.requestNumber }
}

const minutesAgoIso = (mins: number) => new Date(Date.now() - mins * 60 * 1000).toISOString()

describe('LINE Feature A: HR approval by slash command + 30-minute rule', () => {
    it('29 นาที vs 31 นาที — ทั้งคำสั่ง /อนุมัติ และปุ่ม postback บนการ์ด', async () => {
        const { say, postback, push } = rig()
        const A = company('บริษัทเวลาจำกัด')
        const admin = member(A.tenantId, 'ADMIN')
        const staff = member(A.tenantId, 'USER')

        const freshCmd = addApprovalRequest(A.tenantId, staff.userId, { requestNumber: 'APR-29-CMD', createdAt: minutesAgoIso(29) })
        const oldCmd = addApprovalRequest(A.tenantId, staff.userId, { requestNumber: 'APR-31-CMD', createdAt: minutesAgoIso(31) })
        const freshBtn = addApprovalRequest(A.tenantId, staff.userId, { requestNumber: 'APR-29-BTN', createdAt: minutesAgoIso(29) })
        const oldBtn = addApprovalRequest(A.tenantId, staff.userId, { requestNumber: 'APR-31-BTN', createdAt: minutesAgoIso(31) })

        // 31 นาที: คำสั่งและปุ่มถูกปฏิเสธพร้อมลิงก์ /approvals
        const oldCmdOut = JSON.stringify(await say(admin.uid, '/อนุมัติ APR-31-CMD'))
        expect(oldCmdOut).toContain('เลย 30 นาทีแล้ว อนุมัติในเว็บ')
        expect(oldCmdOut).toContain('/approvals')
        expect((db.prepare('SELECT status FROM approval_requests WHERE id = ?').get(oldCmd.id) as any).status).toBe('PENDING')

        const oldBtnOut = JSON.stringify(await postback(A.tenantId, { type: 'user', userId: admin.uid }, `action=approve_req&id=${oldBtn.id}`))
        expect(oldBtnOut).toContain('เลย 30 นาทีแล้ว อนุมัติในเว็บ')
        expect((db.prepare('SELECT status FROM approval_requests WHERE id = ?').get(oldBtn.id) as any).status).toBe('PENDING')

        // 29 นาที: ปุ่มอนุมัติได้
        const freshBtnOut = JSON.stringify(await postback(A.tenantId, { type: 'user', userId: admin.uid }, `action=approve_req&id=${freshBtn.id}`))
        expect(freshBtnOut).toContain('อนุมัติแล้ว')
        expect((db.prepare('SELECT status FROM approval_requests WHERE id = ?').get(freshBtn.id) as any).status).toBe('EXECUTED')

        // 29 นาที: คำสั่ง /อนุมัติ แสดงรายละเอียด + ถามยืนยัน แล้ว /ใช่ อนุมัติจริง
        const askOut = JSON.stringify(await say(admin.uid, '/อนุมัติ APR-29-CMD'))
        expect(askOut).toContain('APR-29-CMD')
        expect(askOut).toContain('ขอลา')
        expect(askOut).toContain('สมชาย')
        expect(askOut).toContain(A.name)
        expect(askOut).toContain('ต้องการอนุมัติ APR-29-CMD จริงหรือไม่ ตอบ /ใช่ หรือ /ไม่ใช่')

        const yesOut = JSON.stringify(await say(admin.uid, '/ใช่'))
        expect(yesOut).toContain('อนุมัติแล้ว')
        expect((db.prepare('SELECT status FROM approval_requests WHERE id = ?').get(freshCmd.id) as any).status).toBe('EXECUTED')
        expect((db.prepare('SELECT status FROM leave_requests WHERE id = ?').get(freshCmd.refId) as any).status).toBe('APPROVED')
        expect(push).not.toHaveBeenCalled()
    })

    it('/ใช่ สองครั้งรันครั้งเดียว · /ไม่ใช่ ยกเลิกคำถาม · คำว่า "ใช่" ไม่มี / ไม่ยืนยัน', async () => {
        const { say } = rig()
        const A = company('บริษัทดับเบิลคลิก')
        const admin = member(A.tenantId, 'ADMIN')
        const staff = member(A.tenantId, 'USER')

        const r1 = addApprovalRequest(A.tenantId, staff.userId, { requestNumber: 'APR-TWICE', createdAt: minutesAgoIso(5) })
        const r2 = addApprovalRequest(A.tenantId, staff.userId, { requestNumber: 'APR-CANCEL', createdAt: minutesAgoIso(5) })

        // คำว่า "ใช่" โดยไม่มี / ต้องไม่อนุมัติ
        await say(admin.uid, '/อนุมัติ APR-TWICE')
        await say(admin.uid, 'ใช่')
        expect((db.prepare('SELECT status FROM approval_requests WHERE id = ?').get(r1.id) as any).status).toBe('PENDING')

        // /ใช่ ครั้งแรกอนุมัติและลบแถวทิ้ง · /ใช่ ครั้งที่สองไม่ทำซ้ำ
        const first = JSON.stringify(await say(admin.uid, '/ใช่'))
        expect(first).toContain('อนุมัติแล้ว')
        expect((db.prepare('SELECT status FROM approval_requests WHERE id = ?').get(r1.id) as any).status).toBe('EXECUTED')
        expect(db.prepare("SELECT * FROM line_pending_tasks WHERE line_user_id = ? AND type IN ('hr_approve','hr_reject')").all(admin.uid)).toHaveLength(0)

        const second = JSON.stringify(await say(admin.uid, '/ใช่'))
        expect(second).not.toContain('อนุมัติแล้ว')
        expect((db.prepare("SELECT COUNT(*) c FROM approval_logs WHERE approval_request_id = ? AND action = 'APPROVED'").get(r1.id) as any).c).toBe(1)

        // /ไม่ใช่ ลบแถวและคงสถานะ PENDING
        await say(admin.uid, '/อนุมัติ APR-CANCEL')
        const noOut = JSON.stringify(await say(admin.uid, '/ไม่ใช่'))
        expect(noOut).toContain('ยกเลิกแล้ว คำขอยังรออยู่')
        expect((db.prepare('SELECT status FROM approval_requests WHERE id = ?').get(r2.id) as any).status).toBe('PENDING')
        expect(db.prepare("SELECT * FROM line_pending_tasks WHERE line_user_id = ? AND type IN ('hr_approve','hr_reject')").all(admin.uid)).toHaveLength(0)
    })

    it('แถว pending ของผู้ใช้สองคนแยกกัน และคำถามใหม่แทนที่ของเก่าของคนเดิมเท่านั้น', async () => {
        const { say } = rig()
        const A = company('บริษัทสองแอดมิน')
        const admin1 = member(A.tenantId, 'ADMIN')
        const admin2 = member(A.tenantId, 'ADMIN')
        const staff = member(A.tenantId, 'USER')

        const r1 = addApprovalRequest(A.tenantId, staff.userId, { requestNumber: 'APR-U1', createdAt: minutesAgoIso(5) })
        const r2 = addApprovalRequest(A.tenantId, staff.userId, { requestNumber: 'APR-U2', createdAt: minutesAgoIso(4) })
        const r3 = addApprovalRequest(A.tenantId, staff.userId, { requestNumber: 'APR-U3', createdAt: minutesAgoIso(3) })

        await say(admin1.uid, '/อนุมัติ APR-U1')
        await say(admin2.uid, '/อนุมัติ APR-U2')
        // admin1 ถามคำขอใหม่ → แทนที่แถวของ admin1 แต่ไม่กระทบ admin2
        await say(admin1.uid, '/อนุมัติ APR-U3')

        expect(db.prepare("SELECT title FROM line_pending_tasks WHERE line_user_id = ? AND type IN ('hr_approve','hr_reject')").all(admin1.uid))
            .toEqual([{ title: r3.id }])
        expect(db.prepare("SELECT title FROM line_pending_tasks WHERE line_user_id = ? AND type IN ('hr_approve','hr_reject')").all(admin2.uid))
            .toEqual([{ title: r2.id }])

        await say(admin1.uid, '/ใช่')
        expect((db.prepare('SELECT status FROM approval_requests WHERE id = ?').get(r3.id) as any).status).toBe('EXECUTED')
        expect((db.prepare('SELECT status FROM approval_requests WHERE id = ?').get(r1.id) as any).status).toBe('PENDING')
        expect((db.prepare('SELECT status FROM approval_requests WHERE id = ?').get(r2.id) as any).status).toBe('PENDING')

        await say(admin2.uid, '/ใช่')
        expect((db.prepare('SELECT status FROM approval_requests WHERE id = ?').get(r2.id) as any).status).toBe('EXECUTED')
    })

    it('สิทธิ์: คนไม่มีสิทธิ์ได้ "ไม่พบคำขอนี้" ไม่เปิดเผยข้อมูล · Demo Master ถูกปฏิเสธ · กลุ่มเงียบ/ปฏิเสธ', async () => {
        const { say, sayInGroup } = rig()
        const A = company('บริษัทตรวจสิทธิ์')
        const staff1 = member(A.tenantId, 'USER')
        const staff2 = member(A.tenantId, 'USER')
        const admin = member(A.tenantId, 'ADMIN')
        const demoM = master(A.tenantId, { demoRole: 'ADMIN' })
        const r = addApprovalRequest(A.tenantId, staff1.userId, { requestNumber: 'APR-SECRET', description: 'ความลับHR', createdAt: minutesAgoIso(5) })

        // พนักงานไม่มีสิทธิ์ → เหมือนไม่พบคำขอ ไม่เปิดเผยรายละเอียด
        const denyStaff = JSON.stringify(await say(staff2.uid, '/อนุมัติ APR-SECRET'))
        expect(denyStaff).toContain('ไม่พบคำขอนี้')
        expect(denyStaff).not.toContain('ความลับHR')

        // Demo Master → ถูกปฏิเสธ
        const denyDemo = JSON.stringify(await say(demoM, '/อนุมัติ APR-SECRET'))
        expect(denyDemo).toContain('demo')
        expect(denyDemo).not.toContain('ความลับHR')

        // กลุ่มที่ผูกแล้ว: คนผูกบัญชีได้ "ใช้ได้ในแชทส่วนตัวเท่านั้น" ไม่มีข้อมูล · คนแปลกหน้าเงียบ
        const gid = bindGroup(A.tenantId)
        const stranger = 'U' + generateId(); lines.push(stranger)
        expect(await sayInGroup(gid, stranger, '/อนุมัติ APR-SECRET')).toHaveLength(0)
        const grpAdmin = JSON.stringify(await sayInGroup(gid, admin.uid, '/อนุมัติ APR-SECRET'))
        expect(grpAdmin).toContain('ใช้ได้ในแชทส่วนตัวเท่านั้น')
        expect(grpAdmin).not.toContain('ความลับHR')
        expect((db.prepare('SELECT status FROM approval_requests WHERE id = ?').get(r.id) as any).status).toBe('PENDING')
    })

    it('เลขคำขอซ้ำข้ามบริษัท: สมาชิกเห็นเฉพาะบริษัทตัวเอง · Master ลอยได้ปุ่มเลือกบริษัท ไม่เดา', async () => {
        const { say } = rig()
        const A = company('บริษัทเอ-ซ้ำ')
        const B = company('บริษัทบี-ซ้ำ')
        const adminA = member(A.tenantId, 'ADMIN')
        const staffA = member(A.tenantId, 'USER')
        const staffB = member(B.tenantId, 'USER')
        const mUid = master(A.tenantId)

        const reqA = addApprovalRequest(A.tenantId, staffA.userId, { requestNumber: 'APR-SAME-01', createdAt: minutesAgoIso(5) })
        const reqB = addApprovalRequest(B.tenantId, staffB.userId, { requestNumber: 'APR-SAME-01', createdAt: minutesAgoIso(5) })

        // Master ลอยเจอ 2 บริษัท → ได้ปุ่ม `/อนุมัติ APR-SAME-01 tenant <id>` ไม่เดา
        const pickOut = await say(mUid, '/อนุมัติ APR-SAME-01')
        expect(pickOut).toHaveLength(1)
        const texts = pickOut[0].quickReply.items.map((i: any) => i.action.text)
        expect(texts).toContain(`/อนุมัติ APR-SAME-01 tenant ${A.tenantId}`)
        expect(texts).toContain(`/อนุมัติ APR-SAME-01 tenant ${B.tenantId}`)
        expect(db.prepare("SELECT * FROM line_pending_tasks WHERE line_user_id = ?").all(mUid)).toHaveLength(0)

        // เลือกบริษัท B แล้ว /ใช่ → อนุมัติเฉพาะ B, A ยัง PENDING
        await say(mUid, `/อนุมัติ APR-SAME-01 tenant ${B.tenantId}`)
        await say(mUid, '/ใช่')
        expect((db.prepare('SELECT status FROM approval_requests WHERE id = ?').get(reqB.id) as any).status).toBe('EXECUTED')
        expect((db.prepare('SELECT status FROM approval_requests WHERE id = ?').get(reqA.id) as any).status).toBe('PENDING')

        // สมาชิกบริษัท A พิมพ์เลขเดียวกัน → เห็นเฉพาะบริษัท A
        await say(adminA.uid, '/อนุมัติ APR-SAME-01')
        await say(adminA.uid, '/ใช่')
        expect((db.prepare('SELECT status FROM approval_requests WHERE id = ?').get(reqA.id) as any).status).toBe('EXECUTED')
    })

    it('/ไม่อนุมัติ พร้อมเหตุผล ส่งเข้า comment "ทาง LINE: <reason>" และปฏิเสธหมวดที่ไม่ใช่ HR', async () => {
        const { say } = rig()
        const A = company('บริษัทเหตุผล')
        const admin = member(A.tenantId, 'ADMIN')
        const staff = member(A.tenantId, 'USER')

        const rLeave = addApprovalRequest(A.tenantId, staff.userId, { requestNumber: 'APR-REJ-1', createdAt: minutesAgoIso(5) })
        const rPo = addApprovalRequest(A.tenantId, staff.userId, { requestNumber: 'APR-PO-1', moduleType: 'purchase_order', amount: 2500, createdAt: minutesAgoIso(5) })

        // หมวดที่ไม่ใช่ HR ถูกปฏิเสธให้เปิดในเว็บ
        const poOut = JSON.stringify(await say(admin.uid, '/อนุมัติ APR-PO-1'))
        expect(poOut).toContain('เปิดในเว็บ')
        expect((db.prepare('SELECT status FROM approval_requests WHERE id = ?').get(rPo.id) as any).status).toBe('PENDING')

        // /ไม่อนุมัติ พร้อมเหตุผล
        const askRej = JSON.stringify(await say(admin.uid, '/ไม่อนุมัติ APR-REJ-1 ใบรับรองแพทย์ไม่ครบ'))
        expect(askRej).toContain('ต้องการไม่อนุมัติ APR-REJ-1 จริงหรือไม่')
        expect(askRej).toContain('ใบรับรองแพทย์ไม่ครบ')

        const rejOut = JSON.stringify(await say(admin.uid, '/ใช่'))
        expect(rejOut).toContain('ไม่อนุมัติแล้ว')
        const updated = db.prepare('SELECT status, approver_2_comment FROM approval_requests WHERE id = ?').get(rLeave.id) as any
        expect(updated.status).toBe('REJECTED')
        expect(updated.approver_2_comment).toBe('ทาง LINE: ใบรับรองแพทย์ไม่ครบ')
    })

    it('/อนุมัติ ไม่ระบุเลข เรียง PENDING ≤30น. (เก่าก่อน + ปุ่ม) → PENDING >30น. (ต้องอนุมัติในเว็บ) → ตัดสินใน 30น. (✅/❌)', async () => {
        const { say } = rig()
        const A = company('บริษัทลิสต์')
        const admin = member(A.tenantId, 'ADMIN')
        const staff = member(A.tenantId, 'USER')

        addApprovalRequest(A.tenantId, staff.userId, { requestNumber: 'APR-NEW', createdAt: minutesAgoIso(5) })
        addApprovalRequest(A.tenantId, staff.userId, { requestNumber: 'APR-OLDER', createdAt: minutesAgoIso(20) })
        addApprovalRequest(A.tenantId, staff.userId, { requestNumber: 'APR-EXP', createdAt: minutesAgoIso(45) })
        addApprovalRequest(A.tenantId, staff.userId, { requestNumber: 'APR-DONE-OK', status: 'EXECUTED', createdAt: minutesAgoIso(40), decidedAt: minutesAgoIso(10) })
        addApprovalRequest(A.tenantId, staff.userId, { requestNumber: 'APR-DONE-NO', status: 'REJECTED', createdAt: minutesAgoIso(40), decidedAt: minutesAgoIso(12) })
        addApprovalRequest(A.tenantId, staff.userId, { requestNumber: 'APR-DONE-OLD', status: 'EXECUTED', createdAt: minutesAgoIso(90), decidedAt: minutesAgoIso(40) })

        const out = await say(admin.uid, '/อนุมัติ')
        expect(out).toHaveLength(1)
        const json = JSON.stringify(out[0])
        expect(json.indexOf('APR-OLDER')).toBeLessThan(json.indexOf('APR-NEW'))
        expect(json.indexOf('APR-NEW')).toBeLessThan(json.indexOf('APR-EXP'))
        expect(json.indexOf('APR-EXP')).toBeLessThan(json.indexOf('APR-DONE-OK'))
        expect(json).toContain('ต้องอนุมัติในเว็บ')
        expect(json).toContain('✅')
        expect(json).toContain('❌')
        expect(json).not.toContain('APR-DONE-OLD')

        // ปุ่ม quickReply เฉพาะตัว PENDING ≤ 30 นาที เรียงเก่าก่อน
        expect(out[0].quickReply.items.map((i: any) => i.action.text)).toEqual(['/อนุมัติ APR-OLDER', '/อนุมัติ APR-NEW'])

        // ใบเก่าค้างเกิน 200 ใบ ต้องไม่ดันใบใหม่หลุดจากรายการ
        for (let i = 0; i < 205; i++) addApprovalRequest(A.tenantId, staff.userId, { requestNumber: `APR-STALE-${i}`, createdAt: minutesAgoIso(500 + i) })
        expect(JSON.stringify(await say(admin.uid, '/อนุมัติ'))).toContain('/อนุมัติ APR-NEW')
    })

    it('โค้ดยืนยัน task/menu เดิมไม่หยิบแถว hr_approve/hr_reject และคำสั่ง HR ไม่ลบแถว task/menu', async () => {
        const { say, postback } = rig()
        const A = company('บริษัทแยกตาราง')
        const admin = member(A.tenantId, 'ADMIN')
        const staff = member(A.tenantId, 'USER')

        const taskId = 'pt_' + generateId().slice(0, 8)
        db.prepare(`INSERT INTO line_pending_tasks (id, tenant_id, line_user_id, type, title, description, expires_at)
            VALUES (?, ?, ?, 'task', 'งานเดิม', 'desc', ?)`).run(taskId, A.tenantId, admin.uid, new Date(Date.now() + 300_000).toISOString())

        const r = addApprovalRequest(A.tenantId, staff.userId, { requestNumber: 'APR-TASK-SEP', createdAt: minutesAgoIso(5) })
        await say(admin.uid, '/อนุมัติ APR-TASK-SEP')

        // แถว task เดิมต้องยังอยู่ครบ
        expect(db.prepare('SELECT id FROM line_pending_tasks WHERE id = ?').get(taskId)).toBeTruthy()
        const hrRow = db.prepare("SELECT id FROM line_pending_tasks WHERE line_user_id = ? AND type = 'hr_approve'").get(admin.uid) as { id: string }
        expect(hrRow).toBeTruthy()

        // postback confirm_task/cancel_task ที่ส่ง id ของ hr_approve ต้องไม่หยิบและไม่ลบแถว HR
        const hijack = JSON.stringify(await postback(A.tenantId, { type: 'user', userId: admin.uid }, `action=confirm_task&id=${hrRow.id}`))
        expect(hijack).toContain('หมดอายุหรือถูกดำเนินการไปแล้ว')
        expect(db.prepare('SELECT id FROM line_pending_tasks WHERE id = ?').get(hrRow.id)).toBeTruthy()

        // /ไม่ใช่ ลบเฉพาะแถว HR ไม่ลบแถว task
        await say(admin.uid, '/ไม่ใช่')
        expect(db.prepare('SELECT id FROM line_pending_tasks WHERE id = ?').get(taskId)).toBeTruthy()
        expect((db.prepare('SELECT status FROM approval_requests WHERE id = ?').get(r.id) as any).status).toBe('PENDING')
    })
})

describe('LINE Feature B: /สินค้า + getItemHistory', () => {
    it('สิทธิ์ตามตำแหน่งและทุกแผนก (อนุญาต vs ปฏิเสธ) · บริษัทอื่นมองไม่เห็น · กลุ่มเงียบ/ปฏิเสธ', async () => {
        const { say, sayInGroup, push } = rig()
        const A = company('บริษัทคลังเอ')
        const B = company('บริษัทคลังบี')
        addStockItem(A.tenantId, { name: 'นมสดเมจิ', sku: 'MILK-A', qty: 24, unit: 'ขวด' })
        addStockItem(B.tenantId, { name: 'ลับเฉพาะบี', sku: 'SEC-B', qty: 99, unit: 'กล่อง' })

        const allowedDepts = ['IT', 'PURCHASE', 'SALES', 'STOCK', 'PRODUCTION']
        const deniedDepts = ['CEO', 'CTO', 'ACCOUNTING', 'HR', 'MARKETING', 'QC', 'POS']

        for (const dept of allowedDepts) {
            const u = member(A.tenantId, 'USER', [dept])
            const out = JSON.stringify(await say(u.uid, '/สินค้า นมสดเมจิ'))
            expect(out, `dept ${dept} should be allowed`).toContain('นมสดเมจิ')
            expect(out).toContain('MILK-A')
        }

        for (const dept of deniedDepts) {
            const u = member(A.tenantId, 'USER', [dept])
            const out = JSON.stringify(await say(u.uid, '/สินค้า นมสดเมจิ'))
            expect(out, `dept ${dept} should be denied`).toContain('🔒 สำหรับ')
            expect(out).not.toContain('MILK-A')
        }

        // พนักงานไม่มีแผนก → ปฏิเสธ
        const plainUser = member(A.tenantId, 'USER', [])
        expect(JSON.stringify(await say(plainUser.uid, '/สินค้า นมสดเมจิ'))).toContain('🔒 สำหรับ')

        // ADMIN / OWNER / MASTER ผ่านหมด · และมองไม่เห็นของบริษัทอื่น
        const admin = member(A.tenantId, 'ADMIN')
        const owner = member(A.tenantId, 'OWNER')
        const mUid = master(A.tenantId)
        for (const uid of [admin.uid, owner.uid, mUid]) {
            expect(JSON.stringify(await say(uid, '/สินค้า นมสดเมจิ'))).toContain('MILK-A')
            expect(JSON.stringify(await say(uid, '/สินค้า ลับเฉพาะบี'))).toContain('ไม่พบสินค้า')
        }

        // กลุ่ม: คนแปลกหน้าเงียบ · คนผูกบัญชีได้ "ใช้ได้ในแชทส่วนตัวเท่านั้น" ไม่มีข้อมูลราคา
        const gid = bindGroup(A.tenantId)
        const stranger = 'U' + generateId(); lines.push(stranger)
        expect(await sayInGroup(gid, stranger, '/สินค้า นมสดเมจิ')).toHaveLength(0)
        const grpOut = JSON.stringify(await sayInGroup(gid, admin.uid, '/สินค้า นมสดเมจิ'))
        expect(grpOut).toContain('ใช้ได้ในแชทส่วนตัวเท่านั้น')
        expect(grpOut).not.toContain('MILK-A')
        expect(push).not.toHaveBeenCalled()
    })

    it('จับคู่คำค้น: พิมพ์ผิด (bigram >= 0.8), ชื่อซ้ำส่งปุ่ม /สินค้า sku <SKU>, ชื่อรองเปิด/ปิด, สั้นกว่า 2 ตัว', async () => {
        const { say } = rig()
        const A = company('บริษัทจับคู่', { aliasEnabled: 1 })
        const admin = member(A.tenantId, 'ADMIN')

        const idSugar = addStockItem(A.tenantId, { name: 'น้ำตาลทรายขาว', sku: 'SUG-01', qty: 50, unit: 'kg' })
        addStockItem(A.tenantId, { name: 'กาแฟคั่วเข้ม', sku: 'COF-1', qty: 10, unit: 'ถุง' })
        addStockItem(A.tenantId, { name: 'กาแฟคั่วเข้ม', sku: 'COF-2', qty: 20, unit: 'ถุง' })
        addStockItem(A.tenantId, { name: 'สินค้าปิดใช้แล้ว', sku: 'OLD-1', qty: 5, unit: 'ชิ้น', status: 'INACTIVE' })
        addAlias(A.tenantId, idSugar, 'มิตรผลขาว')

        // สั้นกว่า 2 ตัวอักษร → ขอให้พิมพ์เพิ่ม
        expect(JSON.stringify(await say(admin.uid, '/สินค้า น'))).toContain('อย่างน้อย 2 ตัวอักษร')

        // INACTIVE ไม่โผล่
        expect(JSON.stringify(await say(admin.uid, '/สินค้า ปิดใช้แล้ว'))).toContain('ไม่พบสินค้า')

        // พิมพ์ผิดสลับตัวอักษรท้าย (น้ำตาลทรายขวา vs น้ำตาลทรายขาว, bigram 10/12 = 0.833) → เจอ
        expect(JSON.stringify(await say(admin.uid, '/สินค้า น้ำตาลทรายขวา'))).toContain('SUG-01')

        // ชื่อซ้ำ → ปุ่ม message action ส่ง `/สินค้า sku <SKU>` ความยาวป้าย <= 20
        const dupOut = await say(admin.uid, '/สินค้า กาแฟคั่วเข้ม')
        expect(dupOut).toHaveLength(1)
        const items = dupOut[0].quickReply.items
        expect(items).toHaveLength(2)
        expect(items.map((i: any) => i.action.text).sort()).toEqual(['/สินค้า sku COF-1', '/สินค้า sku COF-2'])
        for (const it of items) {
            expect(it.action.type).toBe('message')
            expect(it.action.label.length).toBeLessThanOrEqual(20)
        }
        // กดปุ่ม `/สินค้า sku COF-2` → ได้ประวัติของ COF-2 ตัวเดียว
        const picked = JSON.stringify(await say(admin.uid, '/สินค้า sku COF-2'))
        expect(picked).toContain('COF-2')
        expect(picked).toContain('20 ถุง')

        // ชื่อรองเปิด → ค้น "มิตรผลขาว" เจอ SUG-01 · ปิด (stock_alias_enabled = 0) → ไม่พบสินค้า
        expect(JSON.stringify(await say(admin.uid, '/สินค้า มิตรผลขาว'))).toContain('SUG-01')
        db.prepare('UPDATE company_settings SET stock_alias_enabled = 0 WHERE tenant_id = ?').run(A.tenantId)
        expect(JSON.stringify(await say(admin.uid, '/สินค้า มิตรผลขาว'))).toContain('ไม่พบสินค้า')
    })

    it('getItemHistory + การ์ด: receipt_date vs created_at, material_id ล้วน, ไม่มี stock_qty, ตัด DRAFT/CANCELLED, POS รวมรายวันไทย, 5+5 เติมฝั่ง', async () => {
        const { say } = rig()
        const A = company('บริษัทประวัติ')
        const admin = member(A.tenantId, 'ADMIN')
        const itemId = addStockItem(A.tenantId, { name: 'แป้งสาลี', sku: 'FLR-01', qty: 120, unit: 'g' })

        // BUY 1: ใช้ receipt_date (2026-10-05) ไม่ใช่ created_at (2026-11-24), ผูกเฉพาะ material_id, stock_qty = null
        addGR(A.tenantId, {
            stockItemId: null, materialId: itemId, grNumber: 'GR-MAT-1', supplierName: 'ซัพเอ',
            receiptDate: '2026-10-05', createdAt: '2026-11-24T04:00:00.000Z',
            acceptedQty: 5, unit: 'ถุง', unitPrice: 45, stockQty: null, status: 'CONFIRMED',
        })
        // BUY ที่ยัง DRAFT ต้องไม่ติดมา
        addGR(A.tenantId, {
            stockItemId: itemId, grNumber: 'GR-DRAFT', supplierName: 'ซัพปลอม',
            receiptDate: '2026-11-20', acceptedQty: 1, unit: 'ถุง', unitPrice: 999, status: 'DRAFT',
        })
        // เติม BUY อีก 7 ใบ (รวมเป็น 8 CONFIRMED) เพื่อทดสอบกฎ 5+5 เติมจากฝั่งที่มีมากกว่า
        for (let i = 1; i <= 7; i++) {
            addGR(A.tenantId, {
                stockItemId: itemId, grNumber: `GR-0${i}`, supplierName: `ซัพ${i}`,
                receiptDate: `2026-11-0${i}`, acceptedQty: i, unit: 'กก.', unitPrice: 30 + i, stockQty: i * 1000,
            })
        }

        // SELL SO: CONFIRMED ติดมา · DRAFT และ CANCELLED ต้องถูกตัดทิ้ง
        addSO(A.tenantId, {
            stockItemId: itemId, soNumber: 'SO-OK-1', customerName: 'ร้านขนม',
            orderDate: '2026-11-10', qty: 3, unit: 'กก.', unitPrice: 55, status: 'CONFIRMED',
        })
        addSO(A.tenantId, {
            stockItemId: itemId, soNumber: 'SO-DRAFT', customerName: 'ร่าง',
            orderDate: '2026-11-22', qty: 9, unit: 'กก.', unitPrice: 99, status: 'DRAFT',
        })
        addSO(A.tenantId, {
            stockItemId: itemId, soNumber: 'SO-CANCEL', customerName: 'ยกเลิก',
            orderDate: '2026-11-22', qty: 9, unit: 'กก.', unitPrice: 99, status: 'CANCELLED',
        })

        // SELL POS: สองแถวในวันไทยเดียวกัน (18:00Z ของ 14 = 01:00 วันที่ 15 ไทย + 05:00Z วันที่ 15 = 12:00 วันที่ 15 ไทย) → รวมเป็นวัน 2026-11-15 ยอด 35
        // แถวที่ returned = 1 ต้องไม่นำมารวม
        addPosDeduction(A.tenantId, itemId, 15, '2026-11-14T18:00:00.000Z', 0)
        addPosDeduction(A.tenantId, itemId, 20, '2026-11-15T05:00:00.000Z', 0)
        addPosDeduction(A.tenantId, itemId, 50, '2026-11-15T06:00:00.000Z', 1)

        const h = getItemHistory(A.tenantId, itemId)
        expect(h.buys).toHaveLength(8)
        expect(h.sells).toHaveLength(2) // 1 SO + 1 POS day
        // 8 buys + 2 sells → เติมฝั่งซื้อเป็น 8 + 2 = 10 บรรทัด เรียงใหม่สุดก่อน
        expect(h.lines).toHaveLength(10)
        expect(h.lines.filter(l => l.side === 'buy')).toHaveLength(8)
        expect(h.lines.filter(l => l.side === 'sell')).toHaveLength(2)

        // ตรวจ GR ที่ผูกด้วย material_id และไม่มี stock_qty ใช้วัน receipt_date (2026-10-05) ไม่ใช่ created_at (2026-11-24)
        const matRow = h.buys.find(b => b.doc === 'GR-MAT-1')
        expect(matRow).toEqual({
            side: 'buy', kind: 'gr', date: '2026-10-05', doc: 'GR-MAT-1', party: 'ซัพเอ',
            qty: 5, unit: 'ถุง', price: 45,
        })
        expect(h.buys.some(b => b.doc === 'GR-DRAFT')).toBe(false)
        expect(h.sells.some(s => s.doc === 'SO-DRAFT' || s.doc === 'SO-CANCEL')).toBe(false)

        // ตรวจ POS รวมรายวันไทย + price เป็น null
        const posRow = h.sells.find(s => s.kind === 'pos')
        expect(posRow).toEqual({
            side: 'sell', kind: 'pos', date: '2026-11-15', doc: 'POS', party: null,
            qty: 35, unit: 'g', price: null,
        })

        // ตรวจการ์ดจากคำสั่ง /สินค้า
        const cardOut = await say(admin.uid, '/สินค้า แป้งสาลี')
        expect(cardOut).toHaveLength(1)
        const json = JSON.stringify(cardOut[0])
        expect(json).toContain('แป้งสาลี')
        expect(json).toContain('FLR-01')
        expect(json).toContain('120 g')
        expect(json).toContain('15/11/26')
        expect(json).toContain('5/10/26')
        expect(json).toContain('🟢ซื้อ')
        expect(json).toContain('🔴ขาย')
        expect(json).toContain('ไม่มีราคา')
        expect(json).toContain('฿55/กก.')
        expect(json).toContain('฿45/ถุง')
        expect(json).toContain('ราคาตามเอกสาร อาจรวมหรือไม่รวม VAT')
        expect(json).not.toContain('ต้นทุน')
        expect(json).not.toContain('กำไร')
        expect(json).not.toContain('GR-DRAFT')
        expect(json).not.toContain('SO-DRAFT')
        expect(json).not.toContain('SO-CANCEL')
        expect(json).not.toContain('ไม่มีใบรับซื้อ')
    })

    it('เมนู POS: ราคาขายมาจากบิล PAID รวมต่อวันไทย+ราคา, ตัดบิลยกเลิก/รายการ VOID/บริษัทอื่น, ไม่นับการตัดสต็อกตัวเองซ้ำ', async () => {
        const { say } = rig()
        const A = company('บริษัทเมนู')
        const B = company('บริษัทเมนูอื่น')
        const admin = member(A.tenantId, 'ADMIN')
        const dish = addStockItem(A.tenantId, { name: 'ข้าวผัดเด็ก', sku: 'FD-K', qty: 0, unit: 'plate' })
        const menuId = generateId()
        db.prepare("INSERT INTO pos_menu_configs (id, tenant_id, product_id, pos_price, sale_unit) VALUES (?, ?, ?, 89, 'จาน')").run(menuId, A.tenantId, dish)

        const sell = (qty: number, price: number, closedAt: string | null, o: { bill?: string; item?: string; tenant?: string } = {}) => {
            const bill = generateId(), line = generateId(), tid = o.tenant ?? A.tenantId
            db.prepare("INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, opened_at, closed_at) VALUES (?, ?, ?, 'โต๊ะ', ?, '2026-11-01T05:00:00.000Z', ?)")
                .run(bill, tid, 'B-' + bill, o.bill ?? 'PAID', closedAt)
            db.prepare('INSERT INTO pos_bill_items (id, tenant_id, bill_id, pos_menu_id, product_name, quantity, unit_price, total_price, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
                .run(line, tid, bill, menuId, 'ข้าวผัดเด็ก', qty, price, qty * price, o.item ?? 'PENDING')
            return line
        }
        const own = sell(1, 89, '2026-11-14T18:00:00.000Z') // 01:00 วันที่ 15 ไทย
        sell(2, 89, '2026-11-15T05:00:00.000Z')
        sell(1, 50, '2026-11-15T06:00:00.000Z')             // ราคาต่างกัน = คนละบรรทัด
        sell(1, 70, null)                                   // ไม่มี closed_at → ใช้ opened_at
        sell(9, 89, '2026-11-16T05:00:00.000Z', { bill: 'CANCELLED' })
        sell(9, 89, '2026-11-16T05:00:00.000Z', { item: 'VOID' })
        sell(9, 89, '2026-11-16T05:00:00.000Z', { tenant: B.tenantId })
        db.prepare("INSERT INTO pos_stock_deductions (id, tenant_id, bill_item_id, stock_item_id, quantity_deducted, deducted_at, returned) VALUES (?, ?, ?, ?, 1, '2026-11-14T18:00:00.000Z', 0)")
            .run(generateId(), A.tenantId, own, dish)

        const h = getItemHistory(A.tenantId, dish)
        expect(h.buys).toHaveLength(0)
        expect(h.lines.map(l => [l.date, l.qty, l.unit, l.price]).sort()).toEqual([
            ['2026-11-01', 1, 'จาน', 70], ['2026-11-15', 1, 'จาน', 50], ['2026-11-15', 3, 'จาน', 89],
        ])
        const json = JSON.stringify(await say(admin.uid, '/สินค้า ข้าวผัดเด็ก'))
        expect(json).toContain('฿89/จาน')
        expect(json).toContain('ไม่มีใบรับซื้อของรายการนี้')
    })
})
