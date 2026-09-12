import { describe, it, expect } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { createTestUser } from '../test/testAuth'
import { hasBypass, isApprovalRequired, gateOrCreate } from './approvalGate.service'

/**
 * สิทธิ์ยกเว้นต้องอ่านได้จาก 2 ที่ ไม่ใช่ที่เดียว:
 *   (ก) can_bypass รายหมวด ในหน้าตั้งค่าการอนุมัติ
 *   (ข) สิทธิ์ 'approve' ในระบบสิทธิ์เดิมของเจ้าของ (role + แผนก + custom_permissions)
 */

function openCategory(tenantId: string, category: string, role = 'USER') {
  db.prepare(`
    INSERT INTO approval_settings (id, tenant_id, role, module_type, approval_required, auto_approve_threshold)
    VALUES (?, ?, ?, ?, 1, 0)
    ON CONFLICT(tenant_id, role, module_type) DO UPDATE SET approval_required = 1
  `).run(generateId(), tenantId, role, category)
}

const gateUser = (u: any, extra: any = {}) =>
  ({ userId: u.userId, email: u.email, role: u.role, ...extra })

describe('สิทธิ์ยกเว้น — ต่อกับระบบสิทธิ์เดิมของ tenant', () => {
  it('ผู้จัดการที่ดูแลแผนกคลัง ข้ามการอนุมัติปรับสต็อกได้ โดยไม่ต้องตั้ง can_bypass ซ้ำ', () => {
    const u = createTestUser({ role: 'MANAGER' })
    openCategory(u.tenantId, 'stock_adjust', 'MANAGER')

    expect(hasBypass(u.tenantId, gateUser(u, { departments: ['STOCK'] }), 'stock_adjust')).toBe(true)
    // คนละแผนก → ไม่ได้สิทธิ์ข้ามหมวดนี้
    expect(hasBypass(u.tenantId, gateUser(u, { departments: ['SALES'] }), 'stock_adjust')).toBe(false)
  })

  it('พนักงานธรรมดาไม่ได้สิทธิ์ข้าม แม้จะอยู่แผนกนั้น', () => {
    const u = createTestUser({ role: 'USER' })
    openCategory(u.tenantId, 'stock_adjust')
    expect(hasBypass(u.tenantId, gateUser(u, { departments: ['STOCK'] }), 'stock_adjust')).toBe(false)
  })

  it('ติ๊ก can_bypass รายหมวดยังใช้ได้อยู่ (ทางที่ ก)', () => {
    const u = createTestUser({ role: 'USER' })
    openCategory(u.tenantId, 'pos_void')
    expect(hasBypass(u.tenantId, gateUser(u), 'pos_void')).toBe(false)

    db.prepare(`
      INSERT INTO user_approval_permissions (id, tenant_id, user_id, module_type, can_approve, can_bypass)
      VALUES (?, ?, ?, 'pos_void', 0, 1)
    `).run(generateId(), u.tenantId, u.userId)

    expect(hasBypass(u.tenantId, gateUser(u), 'pos_void')).toBe(true)
  })

  it('แผนก CEO ข้ามได้ทุกหมวด (ตามเมทริกซ์สิทธิ์เดิม ไม่ได้เขียนกฎใหม่)', () => {
    const u = createTestUser({ role: 'MANAGER' })
    for (const c of ['stock_adjust', 'pos_void', 'doc_edit'] as const) {
      openCategory(u.tenantId, c, 'MANAGER')
      expect(hasBypass(u.tenantId, gateUser(u, { departments: ['CEO'] }), c)).toBe(true)
    }
  })

  it('คนที่ข้ามได้ ยังถูกนับว่า "ต้องขออนุมัติ" ตามหมวด แต่ gate ปล่อยผ่านและเขียนประวัติ', () => {
    const u = createTestUser({ role: 'MANAGER' })
    openCategory(u.tenantId, 'stock_adjust', 'MANAGER')
    const user = gateUser(u, { departments: ['STOCK'] })

    expect(isApprovalRequired(u.tenantId, user, 'stock_adjust')).toBe(true)

    const pending = gateOrCreate({
      tenantId: u.tenantId, user, category: 'stock_adjust',
      refType: 'stock_items', refId: 'item-bypass', description: 'ปรับสต๊อก',
    })
    expect(pending).toBeNull()   // ปล่อยผ่าน ไม่สร้างคำขอรออนุมัติ

    const stuck = db.prepare(
      "SELECT COUNT(*) c FROM approval_requests WHERE tenant_id = ? AND reference_id = 'item-bypass' AND status = 'PENDING'"
    ).get(u.tenantId) as any
    expect(stuck.c).toBe(0)
  })
})
