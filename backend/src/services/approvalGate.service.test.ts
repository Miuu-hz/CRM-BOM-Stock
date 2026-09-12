import { describe, it, expect } from 'vitest'
import db from '../db/sqlite'
import { createTestUser } from '../test/testAuth'
import {
  canApprove, isApprovalRequired, hasBypass, recordAutoAction, gateOrCreate,
} from './approvalGate.service'
import { generateId } from '../utils/id'

function openCategory(tenantId: string, category: string, role = 'USER', threshold = 0) {
  db.prepare(`
    INSERT INTO approval_settings (id, tenant_id, role, module_type, approval_required, auto_approve_threshold)
    VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT(tenant_id, role, module_type) DO UPDATE SET
      approval_required = 1, auto_approve_threshold = excluded.auto_approve_threshold
  `).run(generateId(), tenantId, role, category, threshold)
}

function grantBypass(tenantId: string, userId: string, category: string) {
  db.prepare(`
    INSERT INTO user_approval_permissions (id, tenant_id, user_id, module_type, can_bypass)
    VALUES (?, ?, ?, ?, 1)
  `).run(generateId(), tenantId, userId, category)
}

const asGate = (u: ReturnType<typeof createTestUser>) => ({ userId: u.userId, email: u.email, role: u.role })

describe('approvalGate — ต้องขออนุมัติมั้ย', () => {
  it('ADMIN ผ่านเสมอ แม้หมวดจะเปิดไว้', () => {
    const admin = createTestUser({ role: 'ADMIN' })
    openCategory(admin.tenantId, 'stock_adjust', 'ADMIN')
    expect(isApprovalRequired(admin.tenantId, asGate(admin), 'stock_adjust')).toBe(false)
  })

  it('USER + หมวดเปิด → ต้องขออนุมัติ', () => {
    const user = createTestUser({ role: 'USER' })
    openCategory(user.tenantId, 'stock_adjust')
    expect(isApprovalRequired(user.tenantId, asGate(user), 'stock_adjust')).toBe(true)
  })

  it('USER + ไม่ได้ตั้งค่าหมวดไว้ → ผ่านเลย (ไม่ตั้ง = ไม่บังคับ)', () => {
    const user = createTestUser({ role: 'USER' })
    expect(isApprovalRequired(user.tenantId, asGate(user), 'pos_void')).toBe(false)
  })

  it('ยอดต่ำกว่าวงเงินอนุมัติอัตโนมัติ → ผ่าน, เกิน → ต้องขอ', () => {
    const user = createTestUser({ role: 'USER' })
    openCategory(user.tenantId, 'pos_void', 'USER', 500)
    expect(isApprovalRequired(user.tenantId, asGate(user), 'pos_void', 300)).toBe(false)
    expect(isApprovalRequired(user.tenantId, asGate(user), 'pos_void', 900)).toBe(true)
  })
})

describe('approvalGate — ใครอนุมัติได้', () => {
  it('ADMIN/MASTER อนุมัติได้โดยไม่ต้องมีแถวใน user_approval_permissions', () => {
    const admin = createTestUser({ role: 'ADMIN' })
    expect(canApprove(admin.tenantId, asGate(admin))).toBe(true)
  })

  it('USER ธรรมดาอนุมัติไม่ได้ จนกว่าจะถูกมอบสิทธิ์', () => {
    const user = createTestUser({ role: 'USER' })
    expect(canApprove(user.tenantId, asGate(user))).toBe(false)

    db.prepare(`
      INSERT INTO user_approval_permissions (id, tenant_id, user_id, module_type, can_approve)
      VALUES (?, ?, ?, 'stock_adjust', 1)
    `).run(generateId(), user.tenantId, user.userId)
    expect(canApprove(user.tenantId, asGate(user))).toBe(true)
  })
})

describe('approvalGate — โหมด A (ทำให้เลย)', () => {
  it('gateOrCreate คืนคำขอพร้อม payload และไม่สร้างซ้ำเมื่อกดปุ่มรัวๆ', () => {
    const user = createTestUser({ role: 'USER' })
    openCategory(user.tenantId, 'stock_adjust')
    const args = {
      tenantId: user.tenantId, user: asGate(user), category: 'stock_adjust' as const,
      refType: 'stock_items', refId: 'item-1', description: 'ปรับสต๊อก',
      payload: { type: 'ADJUST', quantity: 7 },
    }

    const first = gateOrCreate(args)
    expect(first).toBeTruthy()
    expect(JSON.parse(first.payload)).toEqual({ type: 'ADJUST', quantity: 7 })
    expect(first.request_number).toMatch(/^APR/)

    const second = gateOrCreate(args)
    expect(second.id).toBe(first.id)
    const count = db.prepare(
      "SELECT COUNT(*) c FROM approval_requests WHERE tenant_id = ? AND reference_id = 'item-1'"
    ).get(user.tenantId) as any
    expect(count.c).toBe(1)
  })

  it('ADMIN ไม่ถูกบล็อก — gateOrCreate คืน null', () => {
    const admin = createTestUser({ role: 'ADMIN' })
    openCategory(admin.tenantId, 'stock_adjust', 'ADMIN')
    expect(gateOrCreate({
      tenantId: admin.tenantId, user: asGate(admin), category: 'stock_adjust',
      refType: 'stock_items', refId: 'item-2', description: 'x',
    })).toBeNull()
  })
})

describe('approvalGate — สิทธิ์ bypass รายคน', () => {
  it('USER ธรรมดาไม่มีสิทธิ์ bypass โดยดีฟอลต์', () => {
    const user = createTestUser({ role: 'USER' })
    expect(hasBypass(user.tenantId, asGate(user), 'stock_adjust')).toBe(false)
  })

  it('มอบสิทธิ์ can_bypass ให้แล้ว hasBypass เป็นจริงเฉพาะหมวดนั้น', () => {
    const user = createTestUser({ role: 'USER' })
    grantBypass(user.tenantId, user.userId, 'stock_adjust')
    expect(hasBypass(user.tenantId, asGate(user), 'stock_adjust')).toBe(true)
    expect(hasBypass(user.tenantId, asGate(user), 'pos_void')).toBe(false)
  })

  it('ADMIN/MASTER ถือว่ามี bypass ทุกหมวดอยู่แล้วโดยธรรมชาติ', () => {
    const admin = createTestUser({ role: 'ADMIN' })
    expect(hasBypass(admin.tenantId, asGate(admin), 'stock_adjust')).toBe(true)
  })

  it('recordAutoAction: ไม่มีสิทธิ์ bypass → ไม่บันทึกอะไร (คืน null)', () => {
    const user = createTestUser({ role: 'USER' })
    const row = recordAutoAction({
      tenantId: user.tenantId, user: asGate(user), category: 'stock_adjust',
      refType: 'stock_items', refId: 'item-9', description: 'ปรับสต๊อก',
    })
    expect(row).toBeNull()
    const count = db.prepare("SELECT COUNT(*) c FROM approval_requests WHERE reference_id = 'item-9'").get() as any
    expect(count.c).toBe(0)
  })

  it('recordAutoAction: มีสิทธิ์ bypass → บันทึกแถวสถานะ AUTO พร้อมเครดิตผู้ทำ', () => {
    const user = createTestUser({ role: 'USER' })
    grantBypass(user.tenantId, user.userId, 'stock_adjust')

    const row = recordAutoAction({
      tenantId: user.tenantId, user: asGate(user), category: 'stock_adjust',
      refType: 'stock_items', refId: 'item-10', description: 'ปรับสต๊อกแบบ bypass',
      payload: { type: 'IN', quantity: 5 },
    })

    expect(row).toBeTruthy()
    expect(row.status).toBe('AUTO')
    expect(row.requester_id).toBe(user.userId)
    expect(row.final_executor_id).toBe(user.userId)
    expect(row.executed_at).toBeTruthy()
    expect(JSON.parse(row.payload)).toEqual({ type: 'IN', quantity: 5 })
  })

  // 2 ทางที่ทำให้ hasBypass เป็นจริง — ต้องข้ามอนุมัติได้ทั้งคู่ และทั้งคู่ต้องมีแถว AUTO ในประวัติ
  it('ทางที่ 1 — ให้สิทธิ์ can_bypass ตรงๆ (ตารางใหม่) → gateOrCreate ข้ามอนุมัติ + มีแถว AUTO', () => {
    const user = createTestUser({ role: 'USER' })
    openCategory(user.tenantId, 'stock_adjust')
    grantBypass(user.tenantId, user.userId, 'stock_adjust')

    const args = {
      tenantId: user.tenantId, user: asGate(user), category: 'stock_adjust' as const,
      refType: 'stock_items', refId: 'item-bypass-explicit', description: 'ปรับสต๊อก',
    }
    expect(gateOrCreate(args)).toBeNull()   // ไม่ถูกบล็อกทั้งที่หมวดเปิดอนุมัติไว้

    const row = recordAutoAction(args)
    expect(row).toBeTruthy()
    expect(row.status).toBe('AUTO')
    expect(row.requester_id).toBe(user.userId)
  })

  it('ทางที่ 2 — ไม่มี can_bypass แต่ระบบสิทธิ์เดิม (MANAGER + แผนกจัดซื้อ) ให้ approve หมวดนี้อยู่แล้ว → ข้ามอนุมัติได้เหมือนกัน', () => {
    const user = createTestUser({ role: 'MANAGER' })
    openCategory(user.tenantId, 'doc_edit', 'MANAGER')
    const gateUser = { userId: user.userId, email: user.email, role: user.role, departments: ['PURCHASE'] as any }

    expect(hasBypass(user.tenantId, gateUser, 'doc_edit')).toBe(true)

    const args = {
      tenantId: user.tenantId, user: gateUser, category: 'doc_edit' as const,
      refType: 'purchase_orders', refId: 'po-bypass-perm', description: 'แก้ไข PO',
    }
    expect(gateOrCreate(args)).toBeNull()   // ไม่ได้ตั้ง can_bypass เลย แต่สิทธิ์เดิมให้ approve อยู่แล้ว

    const row = recordAutoAction(args)
    expect(row).toBeTruthy()
    expect(row.status).toBe('AUTO')
    expect(row.requester_id).toBe(user.userId)

    const explicitGrant = db.prepare(
      "SELECT COUNT(*) c FROM user_approval_permissions WHERE tenant_id = ? AND user_id = ? AND can_bypass = 1"
    ).get(user.tenantId, user.userId) as any
    expect(explicitGrant.c).toBe(0)   // ยืนยันว่าผ่านเพราะระบบสิทธิ์เดิม ไม่ใช่ can_bypass
  })
})
