import db from '../db/sqlite'
import { generateId, formatDocumentNumber } from '../utils/id'
import { can, Role, Department } from './rbac.service'

/**
 * ประตูกลางของระบบอนุมัติ — ทุกจุดที่ต้องขออนุมัติเรียกผ่านไฟล์นี้ที่เดียว
 *
 * เดิมตรรกะ "ต้องอนุมัติมั้ย + สร้างคำขอ" ถูก copy ไว้ 4 ที่ (purchaseOrder.routes.ts,
 * purchase-request.routes.ts, sales/salesOrders.ts, mcp/tools/shared.ts) การเพิ่มหมวดใหม่
 * ต้องไม่เพิ่มสำเนาที่ 5
 *
 * โหมดเดียว (A) — กดปุ่ม → บล็อก + เก็บ payload ไว้ → อนุมัติแล้วระบบรัน action ให้
 * (โหมด B "ปลดล็อกแล้วแก้เอง" ถูกถอดออกแล้ว — doc_edit ตอนนี้เป็น draft แบบเดียวกับหมวดอื่น
 * คอลัมน์ consumed_at/expires_at ยังอยู่ในตาราง เผื่อใครอ้างอิงอยู่ แต่โค้ดฝั่งนี้ไม่เขียนแล้ว)
 */

export type GateCategory = 'stock_adjust' | 'pos_void' | 'doc_edit'

export interface GateUser {
  userId: string
  email: string
  role: string
  /** สำหรับเช็คระบบสิทธิ์เดิม (rbac.service.can) — ไม่ใส่มาก็ได้ ถือว่าไม่มีแผนก/ไม่มี custom */
  departments?: Department[]
  customPermissions?: Record<string, boolean>
}

const APPROVER_ROLES = new Set(['ADMIN', 'MASTER'])

// หมวดอนุมัติ → resource ในระบบสิทธิ์เดิม (Settings > สิทธิ์การใช้งาน) ที่ถือว่า "ผูกกัน"
// คนที่มี action 'approve' บน resource นี้อยู่แล้ว (จาก role+department หรือ customPermissions)
// ไม่ต้องมาตั้ง can_bypass ซ้ำอีกชั้น
const CATEGORY_RESOURCE: Record<GateCategory, string> = {
  stock_adjust: 'stock',
  pos_void: 'orders',
  doc_edit: 'purchase',
}

/** ADMIN/MASTER อนุมัติได้เสมอ นอกนั้นต้องถูกมอบสิทธิ์รายคน */
export function canApprove(tenantId: string, user: GateUser): boolean {
  if (APPROVER_ROLES.has(user.role)) return true
  const perm = db.prepare(
    'SELECT 1 FROM user_approval_permissions WHERE tenant_id = ? AND user_id = ? AND can_approve = 1 LIMIT 1'
  ).get(tenantId, user.userId)
  return !!perm
}

/**
 * หมวดนี้เปิดใช้การอนุมัติกับ role นี้อยู่หรือเปล่า
 * ไม่มีแถวใน approval_settings = ไม่ต้องขออนุมัติ (ตรงกับคำอธิบายในหน้าตั้งค่าเดิม)
 */
export function isApprovalRequired(
  tenantId: string,
  user: GateUser,
  category: GateCategory,
  amount = 0
): boolean {
  if (APPROVER_ROLES.has(user.role)) return false

  const setting = db.prepare(
    'SELECT approval_required, auto_approve_threshold FROM approval_settings WHERE tenant_id = ? AND role = ? AND module_type = ?'
  ).get(tenantId, user.role, category) as any

  if (!setting || setting.approval_required !== 1) return false
  if (setting.auto_approve_threshold > 0 && amount <= setting.auto_approve_threshold) return false
  return true
}

/**
 * สิทธิ์ "ทำเลยไม่ต้องขออนุมัติ" — เป็นจริงถ้าเข้าเงื่อนไขข้อใดข้อหนึ่ง:
 *   (a) admin ให้สิทธิ์ can_bypass รายคน/รายหมวดไว้ตรงๆ (ตารางใหม่ที่ทำในงานนี้), หรือ
 *   (b) ระบบสิทธิ์เดิม (Settings > สิทธิ์การใช้งาน, rbac.service.can) ให้ action 'approve'
 *       บน resource ที่หมวดนี้ผูกไว้อยู่แล้ว (role+department หรือ customPermissions รายคน)
 * ต่างจาก canApprove (สิทธิ์อนุมัติ "คำขอของคนอื่น") ตรงนี้คือสิทธิ์ทำ action ของตัวเองได้เลย
 * ADMIN/MASTER ถือว่ามี bypass ทุกหมวดอยู่แล้วโดยธรรมชาติ (can() คืน true ให้อยู่แล้วเช่นกัน
 * แต่เช็คลัดตรงนี้ก่อนเพื่อไม่ต้องพึ่งพา departments/customPermissions ที่อาจไม่ได้ส่งมา)
 */
export function hasBypass(tenantId: string, user: GateUser, category: GateCategory): boolean {
  if (APPROVER_ROLES.has(user.role)) return true

  const perm = db.prepare(
    'SELECT 1 FROM user_approval_permissions WHERE tenant_id = ? AND user_id = ? AND module_type = ? AND can_bypass = 1 LIMIT 1'
  ).get(tenantId, user.userId, category)
  if (perm) return true

  const resource = CATEGORY_RESOURCE[category]
  return can(user.role as Role, user.departments || [], resource, 'approve', user.customPermissions)
}

export interface CreateRequestArgs {
  tenantId: string
  user: GateUser
  category: GateCategory
  refType: string
  refId: string
  description: string
  amount?: number
  /** args ที่ต้องใช้ตอน executeApprovedAction รัน action ให้ทีหลัง */
  payload?: unknown
}

export function createRequest(args: CreateRequestArgs) {
  const now = new Date().toISOString()
  const id = generateId()
  // ใช้ตัวออกเลขกลาง (docType 'APPROVAL_REQUEST' seed ไว้แล้วใน document_sequences)
  // แทน 'APR-SO-' + Date.now() แบบที่ salesOrders.ts ทำ ซึ่งไม่เรียงและชนกันได้
  const requestNumber = formatDocumentNumber(
    'APR', args.tenantId, 'APPROVAL_REQUEST', new Date().getFullYear()
  )

  db.prepare(`
    INSERT INTO approval_requests (
      id, tenant_id, request_number, module_type, reference_type, reference_id,
      requester_id, requester_name, requester_role, amount, description, status,
      payload, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
  `).run(
    id, args.tenantId, requestNumber, args.category, args.refType, args.refId,
    args.user.userId, args.user.email, args.user.role, args.amount || 0, args.description,
    args.payload === undefined ? null : JSON.stringify(args.payload),
    now, now
  )

  db.prepare(`
    INSERT INTO approval_logs (id, tenant_id, approval_request_id, action, actor_id, actor_name,
      actor_role, comment, old_status, new_status, created_at)
    VALUES (?, ?, ?, 'CREATE', ?, ?, ?, ?, NULL, 'PENDING', ?)
  `).run(generateId(), args.tenantId, id, args.user.userId, args.user.email, args.user.role,
    args.description, now)

  return db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(id) as any
}

/**
 * บันทึกประวัติ "ทำเลยไม่ต้องขออนุมัติ" — เรียกหลัง action ทำสำเร็จแล้ว เมื่อผู้ใช้เป็น
 * ADMIN/MASTER หรือถูกมอบสิทธิ์ bypass ในหมวดนี้ ไม่งั้นไม่บันทึกอะไร (คนทั่วไปที่หมวดนี้ไม่ได้
 * เปิดอนุมัติเลยไม่ต้องมีประวัติ กันตาราง approval_requests บวมโดยไม่มีประโยชน์)
 *
 * ตั้งใจไม่ throw — ผู้เรียกไม่ต้อง try/catch เอง การ log ประวัติพังต้องไม่ทำให้ action จริงพังตาม
 */
export function recordAutoAction(args: CreateRequestArgs) {
  if (!hasBypass(args.tenantId, args.user, args.category)) return null
  try {
    const now = new Date().toISOString()
    const id = generateId()
    const requestNumber = formatDocumentNumber(
      'APR', args.tenantId, 'APPROVAL_REQUEST', new Date().getFullYear()
    )

    db.prepare(`
      INSERT INTO approval_requests (
        id, tenant_id, request_number, module_type, reference_type, reference_id,
        requester_id, requester_name, requester_role, amount, description, status,
        payload, final_executor_id, final_executor_name, executed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AUTO', ?, ?, ?, ?, ?, ?)
    `).run(
      id, args.tenantId, requestNumber, args.category, args.refType, args.refId,
      args.user.userId, args.user.email, args.user.role, args.amount || 0, args.description,
      args.payload === undefined ? null : JSON.stringify(args.payload),
      args.user.userId, args.user.email, now, now, now
    )

    return db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(id) as any
  } catch (e) {
    console.error('[approvalGate] recordAutoAction failed (ไม่กระทบ action จริง):', e)
    return null
  }
}

/** มีคำขอ PENDING ค้างอยู่แล้วมั้ย — กันกดซ้ำจนคำขอท่วม inbox */
export function findPendingRequest(
  tenantId: string,
  category: GateCategory,
  refType: string,
  refId: string
) {
  return db.prepare(`
    SELECT * FROM approval_requests
    WHERE tenant_id = ? AND module_type = ? AND reference_type = ? AND reference_id = ?
      AND status = 'PENDING'
    ORDER BY created_at DESC LIMIT 1
  `).get(tenantId, category, refType, refId) as any
}

/**
 * ด่านหลัก — เรียกที่หัว handler
 * คืน null = ทำงานต่อได้ (ไม่ต้องอนุมัติ หรือมีสิทธิ์ bypass) / คืนคำขอ = ต้องตอบ 202 แล้วหยุด
 * ผู้เรียกที่ได้ null กลับมาเพราะ bypass ควรเรียก recordAutoAction(args) ต่อหลัง action สำเร็จ
 * เพื่อให้มีร่องรอยในประวัติ (recordAutoAction เช็ค hasBypass ซ้ำเอง เรียกซ้ำได้อย่างปลอดภัย)
 */
export function gateOrCreate(args: CreateRequestArgs) {
  if (!isApprovalRequired(args.tenantId, args.user, args.category, args.amount)) return null
  if (hasBypass(args.tenantId, args.user, args.category)) return null
  return findPendingRequest(args.tenantId, args.category, args.refType, args.refId)
    || createRequest(args)
}
