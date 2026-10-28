import { describe, it, expect, afterEach } from 'vitest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { registerHrTools } from './hr'
import { registerTools, READ_ONLY_TOOLS } from '../tools'
import type { IMcpServer } from '../sdk-compat'
import { createTestUser } from '../../test/testAuth'

function fakeServer(): { server: IMcpServer; tools: Record<string, (args: any) => Promise<any>> } {
  const tools: Record<string, (args: any) => Promise<any>> = {}
  const server: IMcpServer = {
    tool: (name: string, _desc: string, _schema: any, handler: any) => {
      tools[name] = handler
    },
    connect: async () => {},
    close: async () => {},
  }
  return { server, tools }
}

function parseOk(res: any): any {
  return JSON.parse(res.content[0].text)
}

const tenants: string[] = []

afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM attendance_logs WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM attendance_imports WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM employees WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM shifts WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM tenant_subscriptions WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM users WHERE tenant_id = ?').run(t)
  }
})

describe('mcp/tools/hr — hr_import_attendance & hr_attendance_summary', () => {
  it('denies permission when caller lacks hr:write / hr:read or tenant lacks hr feature', async () => {
    const salesUser = createTestUser({ role: 'USER' })
    tenants.push(salesUser.tenantId)
    db.prepare('UPDATE users SET departments = ?, custom_permissions = ? WHERE id = ?').run(
      JSON.stringify(['SALES']),
      null,
      salesUser.userId
    )

    const { server, tools } = fakeServer()
    registerHrTools(server, salesUser.tenantId, salesUser.userId, 'Sales Only', 'USER')

    const impDenied = parseOk(
      await tools['hr_import_attendance']({
        filename: 'attlog.dat',
        content: '101\t2026-03-02 09:00:00',
      })
    )
    expect(impDenied.success).toBe(false)
    expect(impDenied.code).toBe('FORBIDDEN')

    const sumDenied = parseOk(
      await tools['hr_attendance_summary']({
        from: '2026-03-02',
        to: '2026-03-02',
      })
    )
    expect(sumDenied.success).toBe(false)
    expect(sumDenied.code).toBe('FORBIDDEN')
  })

  it('imports punches and summarizes attendance for an authorized caller, and exposes only summary in readonly scope', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const t = admin.tenantId
    tenants.push(t)

    const shiftId = generateId()
    const empId = generateId()

    db.prepare(
      `INSERT INTO shifts (id, tenant_id, name, start_time, end_time, grace_minutes, break_minutes, is_active, created_at)
       VALUES (?, ?, 'กะปกติ', '09:00', '18:00', 0, 60, 1, ?)`
    ).run(shiftId, t, new Date().toISOString())

    db.prepare(
      `INSERT INTO employees (
        id, tenant_id, code, first_name, last_name, employment_type, base_wage,
        start_date, status, device_pin, shift_id, created_at, updated_at
      ) VALUES (?, ?, 'EMP-001', 'มานะ', 'ขยัน', 'MONTHLY', 18000, '2026-01-01', 'ACTIVE', '101', ?, ?, ?)`
    ).run(empId, t, shiftId, new Date().toISOString(), new Date().toISOString())

    const { server, tools } = fakeServer()
    registerHrTools(server, t, admin.userId, 'Admin', 'ADMIN')

    const content = [
      '101\t2026-03-02 09:10:00\t1\t0\t1\t0',
      '101\t2026-03-02 18:45:00\t1\t1\t1\t0',
      '999\t2026-03-02 09:00:00\t1\t0\t1\t0',
    ].join('\n')

    const impRes = parseOk(
      await tools['hr_import_attendance']({
        filename: 'attlog.dat',
        content,
      })
    )
    expect(impRes.success).toBe(true)
    expect(impRes.total).toBe(3)
    expect(impRes.inserted).toBe(3)
    expect(impRes.duplicates).toBe(0)
    expect(impRes.unmappedPins).toEqual([{ pin: '999', count: 1 }])

    const sumRes = parseOk(
      await tools['hr_attendance_summary']({
        from: '2026-03-02',
        to: '2026-03-02',
      })
    )
    expect(sumRes.success).toBe(true)
    expect(sumRes.employees).toHaveLength(1)
    expect(sumRes.employees[0]).toMatchObject({
      employeeId: empId,
      daysWorked: 1,
      lateMinutes: 10,
      otCandidateMinutes: 30, // 45 mins past 18:00 = 1 full 30-minute OT block
      absentDays: 0,
    })
    expect(sumRes.unmappedPins).toHaveLength(1)
    expect(sumRes.unmappedPins[0].pin).toBe('999')

    expect(READ_ONLY_TOOLS.has('hr_attendance_summary')).toBe(true)
    expect(READ_ONLY_TOOLS.has('hr_import_attendance')).toBe(false)

    // Verify readonly user via registerTools sees hr_attendance_summary but not hr_import_attendance
    const roUser = createTestUser({ role: 'ADMIN', tenantId: t })
    db.prepare("UPDATE users SET mcp_scope = 'readonly' WHERE id = ?").run(roUser.userId)

    const ro = fakeServer()
    registerTools(ro.server, t, roUser.userId)
    expect(ro.tools['hr_attendance_summary']).toBeTypeOf('function')
    expect(ro.tools['hr_import_attendance']).toBeUndefined()
  })
})
