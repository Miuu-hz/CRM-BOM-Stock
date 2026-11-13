import { describe, it, expect, afterEach, vi } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { createTestUser } from '../test/testAuth'
import { lineBotService } from './line-bot.service'
import { collectExpiryDigest, runExpiryDigest } from './hrExpiry.scheduler'

const TODAY = '2026-06-01'
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const tenants: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const t of tenants.splice(0)) {
    for (const tbl of ['hr_employee_documents', 'training_records', 'training_courses', 'employees', 'line_user_mappings', 'hr_expiry_digest_runs', 'company_settings', 'users']) {
      db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t)
    }
  }
})

function setupTenant(name = 'บริษัททดสอบ') {
  const admin = createTestUser({ role: 'ADMIN' })
  tenants.push(admin.tenantId)
  db.prepare('INSERT INTO company_settings (tenant_id, name) VALUES (?, ?)').run(admin.tenantId, name)
  return admin
}
function link(tenantId: string, userId: string) {
  db.prepare("INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role) VALUES (?,?,?,?, 'USER')")
    .run(generateId(), tenantId, userId, `U${generateId()}`)
}
function addEmp(tenantId: string, first: string, status = 'ACTIVE') {
  const id = generateId()
  db.prepare(`INSERT INTO employees (id, tenant_id, code, first_name, last_name, employment_type, base_wage, sso_enrolled, start_date, status)
    VALUES (?, ?, ?, ?, 'ทดสอบ', 'MONTHLY', 10000, 0, '2026-01-01', ?)`).run(id, tenantId, `E${generateId().slice(0, 6)}`, first, status)
  return id
}
function addDoc(tenantId: string, empId: string, title: string, expires: string) {
  db.prepare("INSERT INTO hr_employee_documents (id, tenant_id, employee_id, doc_type, title, expires_on) VALUES (?,?,?, 'OTHER', ?, ?)")
    .run(generateId(), tenantId, empId, title, expires)
}

describe('hrExpiry digest', () => {
  it('เลือกเฉพาะวันที่เหลือ 60/30/7/-1 พอดี และข้ามพนักงานที่ออกแล้ว', () => {
    const { tenantId } = setupTenant()
    const emp = addEmp(tenantId, 'สมชาย')
    const gone = addEmp(tenantId, 'ลาออก', 'RESIGNED')
    for (const n of [59, 60, 61, 30, 7, -1, -2, 8]) addDoc(tenantId, emp, `เอกสาร${n}`, addDays(TODAY, n))
    addDoc(tenantId, gone, 'ของคนออก', addDays(TODAY, 7))
    const course = generateId()
    db.prepare("INSERT INTO training_courses (id, tenant_id, name) VALUES (?,?, 'ความปลอดภัย')").run(course, tenantId)
    db.prepare('INSERT INTO training_records (id, tenant_id, course_id, employee_id, trained_on, expires_on, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(generateId(), tenantId, course, emp, '2025-01-01', addDays(TODAY, 30), '2025-01-01')
    // บันทึกใหม่กว่าเลื่อนวันหมดอายุออกไป → ต้องไม่ถูกเตือน
    db.prepare('INSERT INTO training_records (id, tenant_id, course_id, employee_id, trained_on, expires_on, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(generateId(), tenantId, course, emp, '2026-01-01', addDays(TODAY, 300), '2026-01-01')
    const items = collectExpiryDigest(tenantId, TODAY)
    expect(items.map(i => i.days_left).sort((a, b) => a - b)).toEqual([-1, 7, 30, 60])
    expect(items.every(i => i.kind === 'DOCUMENT')).toBe(true)
    expect(items.some(i => i.employee_name.includes('ลาออก'))).toBe(false)
  })

  it('ส่งเฉพาะผู้ใช้ที่ผูก LINE และมีสิทธิ์ hr, ไม่ปนข้อมูลบริษัทอื่น, รันซ้ำวันเดิมไม่ส่งซ้ำ', async () => {
    const a = setupTenant('บริษัท A')
    const b = setupTenant('บริษัท B')
    link(a.tenantId, a.userId)
    const plain = createTestUser({ role: 'USER', tenantId: a.tenantId }); link(a.tenantId, plain.userId)
    const unlinked = createTestUser({ role: 'ADMIN', tenantId: a.tenantId })
    addDoc(a.tenantId, addEmp(a.tenantId, 'เอ'), 'พาสปอร์ต', addDays(TODAY, 7))
    addDoc(b.tenantId, addEmp(b.tenantId, 'บี'), 'ใบอนุญาต', addDays(TODAY, 7))
    const spy = vi.spyOn(lineBotService, 'pushToUser').mockResolvedValue(true)

    const r = await runExpiryDigest(TODAY)
    const calls = spy.mock.calls.filter(c => [a.tenantId, b.tenantId].includes(c[0]))
    expect(calls.filter(c => c[0] === a.tenantId).map(c => c[1])).toEqual([a.userId])
    expect(calls.some(c => c[1] === plain.userId || c[1] === unlinked.userId)).toBe(false)
    const text = (calls[0][2] as any).text as string
    expect(text).toContain('เอกสารใกล้ครบกำหนด · บริษัท A')
    expect(text).toContain('เหลือ 7 วัน')
    expect(text).not.toContain('บี')
    expect(r.pushes).toBeGreaterThanOrEqual(1)

    spy.mockClear()
    await runExpiryDigest(TODAY)
    expect(spy.mock.calls.filter(c => c[0] === a.tenantId)).toHaveLength(0)
  })

  it('ตัดที่ 15 บรรทัดและบอกจำนวนที่เหลือ; หมดอายุแล้วใช้ข้อความหมดอายุ', async () => {
    const t = setupTenant()
    link(t.tenantId, t.userId)
    const emp = addEmp(t.tenantId, 'สมหญิง')
    for (let i = 0; i < 17; i++) addDoc(t.tenantId, emp, `doc${i}`, addDays(TODAY, 30))
    addDoc(t.tenantId, emp, 'เก่า', addDays(TODAY, -1))
    const spy = vi.spyOn(lineBotService, 'pushToUser').mockResolvedValue(true)
    await runExpiryDigest(TODAY)
    const text = (spy.mock.calls.find(c => c[0] === t.tenantId)![2] as any).text as string
    const lines = text.split('\n')
    expect(lines.filter(l => l.startsWith('• '))).toHaveLength(15)
    expect(text).toContain('… และอีก 3 รายการ')
    expect(text).toContain('หมดอายุแล้ว')
    expect(lines[lines.length - 1]).toBe('ดูทั้งหมดที่ HR > เอกสารพนักงาน')
  })

  it('ไม่มีรายการครบกำหนด → ไม่ push และไม่มีแถว run', async () => {
    const t = setupTenant()
    link(t.tenantId, t.userId)
    addDoc(t.tenantId, addEmp(t.tenantId, 'สมศักดิ์'), 'ยังไกล', addDays(TODAY, 100))
    const spy = vi.spyOn(lineBotService, 'pushToUser').mockResolvedValue(true)
    await runExpiryDigest(TODAY)
    expect(spy.mock.calls.filter(c => c[0] === t.tenantId)).toHaveLength(0)
    expect(db.prepare('SELECT COUNT(*) n FROM hr_expiry_digest_runs WHERE tenant_id = ?').get(t.tenantId)).toEqual({ n: 0 })
  })
})
