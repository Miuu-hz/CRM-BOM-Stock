import { Router, Request, Response } from 'express'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { requirePermission } from '../middleware/auth.middleware'
import {
  getEffectiveCells,
  listShifts,
  weekDates,
  isMonday,
  isIsoDate,
  addDays,
  RosterShift,
} from '../services/hr/rosterData'
import {
  employeeWarnings,
  dayLaborCost,
  laborPct,
  WorkDay,
} from '../services/hr/roster'
import { getTenantHrSettings } from './hr.payroll.routes'

// สัญญากลาง: docs/contracts/hr-phase7.md — ตารางกะรายวัน + ค่าแรงเทียบยอดขาย POS (งาน B7a: R1–R5)
const router = Router()

const round2 = (n: number): number => Math.round(n * 100) / 100

function getSelfEmployee(tenantId: string, userId: string) {
  return db.prepare(
    `SELECT * FROM employees WHERE tenant_id = ? AND user_id = ? AND status = 'ACTIVE'`
  ).get(tenantId, userId) as any
}

// R1: GET /roster?week_start=YYYY-MM-DD (hr:read)
router.get('/roster', requirePermission('hr', 'read'), (req: Request, res: Response) => {
  try {
    const weekStart = typeof req.query.week_start === 'string' ? req.query.week_start.trim() : ''
    if (!isMonday(weekStart)) {
      return res.status(400).json({ success: false, message: 'week_start ต้องเป็นวันจันทร์' })
    }

    const tenantId = req.user!.tenantId
    const dates = weekDates(weekStart)
    const shifts = listShifts(tenantId)
    const shiftMap = new Map<string, RosterShift>(shifts.map((s) => [s.id, s]))

    const hrSettings = getTenantHrSettings(tenantId)
    const rosterMinStaff = Number(hrSettings.rosterMinStaff ?? 0)
    const laborCostTargetPct = Number(hrSettings.laborCostTargetPct ?? 25)
    const daysPerMonthForRate = Number(hrSettings.daysPerMonthForRate || 30)

    const empRows = db.prepare(`
      SELECT e.id, e.code, e.first_name, e.last_name, e.employment_type, e.base_wage, e.shift_id,
             ou.name AS org_unit_name
      FROM employees e
      LEFT JOIN org_units ou ON e.org_unit_id = ou.id AND ou.tenant_id = e.tenant_id
      WHERE e.tenant_id = ? AND e.status = 'ACTIVE'
      ORDER BY e.code ASC
    `).all(tenantId) as any[]

    const cellMap = getEffectiveCells(tenantId, dates)
    const dayStaff = new Array<number>(dates.length).fill(0)
    const dayLaborCostSum = new Array<number>(dates.length).fill(0)

    const employees = empRows.map((e) => {
      const cells = cellMap.get(e.id) || []
      const workDays: WorkDay[] = []
      const breakShort: Array<{ date: string; shiftName: string }> = []
      let empHours = 0
      let empLaborCost = 0

      cells.forEach((cell, idx) => {
        if (cell.shift_id && !cell.on_leave) {
          const sh = shiftMap.get(cell.shift_id)
          if (sh) {
            workDays.push({ date: cell.date, hours: sh.hours })
            if (sh.hours > 5 && sh.break_minutes < 60) {
              breakShort.push({ date: cell.date, shiftName: sh.name })
            }
            const cost = dayLaborCost(
              e.employment_type,
              Number(e.base_wage ?? 0),
              sh.hours,
              daysPerMonthForRate
            )
            empHours += sh.hours
            empLaborCost += cost
            dayStaff[idx] += 1
            dayLaborCostSum[idx] += cost
          }
        }
      })

      return {
        id: e.id,
        code: e.code,
        name: `${e.first_name || ''} ${e.last_name || ''}`.trim(),
        org_unit_name: e.org_unit_name ?? null,
        employment_type: e.employment_type,
        default_shift_id: e.shift_id ?? null,
        cells,
        hours: round2(empHours),
        labor_cost: round2(empLaborCost),
        warnings: employeeWarnings(workDays, breakShort, dates.length),
      }
    })

    // ponytail: คิวรีบิล POS ย้อนหลัง 4 สัปดาห์ต่อวันด้วย prepared statement ตัวเดียว (7 วัน = 7 ครั้ง เบาและอ่านง่าย)
    const posStmt = db.prepare(
      `SELECT COUNT(*) n, COALESCE(SUM(total_amount),0) s
       FROM pos_running_bills
       WHERE tenant_id = ?
         AND status = 'PAID'
         AND date(COALESCE(closed_at, opened_at), '+7 hours') IN (?, ?, ?, ?)`
    )

    const days = dates.map((date, idx) => {
      const staff = dayStaff[idx]
      const labor_cost = round2(dayLaborCostSum[idx])
      const posRow = posStmt.get(
        tenantId,
        addDays(date, -7),
        addDays(date, -14),
        addDays(date, -21),
        addDays(date, -28)
      ) as { n: number; s: number }
      const avg_sales = Number(posRow.n) > 0 ? round2(Number(posRow.s) / 4) : null
      const labor_pct = laborPct(labor_cost, avg_sales)
      const warnings: string[] = []
      if (rosterMinStaff > 0 && staff < rosterMinStaff) {
        warnings.push(`คนไม่ถึงขั้นต่ำ (${staff}/${rosterMinStaff})`)
      }
      if (labor_pct !== null && labor_pct > laborCostTargetPct) {
        warnings.push(`ค่าแรงเกินเป้า ${labor_pct}%`)
      }
      return {
        date,
        staff,
        labor_cost,
        avg_sales,
        labor_pct,
        warnings,
      }
    })

    res.json({
      success: true,
      data: {
        week_start: weekStart,
        dates,
        shifts,
        employees,
        days,
        settings: { rosterMinStaff, laborCostTargetPct },
      },
    })
  } catch (err: any) {
    console.error('Get roster error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// R2: PUT /roster/assignments (hr:write)
router.put('/roster/assignments', requirePermission('hr', 'write'), (req: Request, res: Response) => {
  try {
    const items = req.body?.items
    if (!Array.isArray(items) || items.length < 1 || items.length > 500) {
      return res.status(400).json({ success: false, message: 'รายการต้องมี 1–500 แถว' })
    }

    const tenantId = req.user!.tenantId
    const now = new Date().toISOString()
    let updated = 0
    let cleared = 0

    const findEmpStmt = db.prepare('SELECT id FROM employees WHERE id = ? AND tenant_id = ?')
    const findActiveShiftStmt = db.prepare('SELECT id FROM shifts WHERE id = ? AND tenant_id = ? AND is_active = 1')
    const delStmt = db.prepare(
      'DELETE FROM shift_assignments WHERE tenant_id = ? AND employee_id = ? AND work_date = ?'
    )
    const upsertStmt = db.prepare(`
      INSERT INTO shift_assignments (id, tenant_id, employee_id, work_date, shift_id, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, employee_id, work_date) DO UPDATE SET
        shift_id = excluded.shift_id,
        updated_at = excluded.updated_at
    `)

    db.transaction(() => {
      for (const item of items) {
        if (!item || typeof item.employee_id !== 'string' || !item.employee_id.trim()) {
          throw { status: 400, message: 'กรุณาระบุพนักงาน' }
        }
        if (!findEmpStmt.get(item.employee_id, tenantId)) {
          throw { status: 404, message: 'ไม่พบข้อมูลพนักงาน' }
        }
        if (!isIsoDate(item.work_date)) {
          throw { status: 400, message: 'วันที่ไม่ถูกต้อง' }
        }

        if (item.clear) {
          delStmt.run(tenantId, item.employee_id, item.work_date)
          cleared++
        } else {
          let shiftId: string | null = null
          if (item.shift_id !== null && item.shift_id !== undefined) {
            if (
              typeof item.shift_id !== 'string' ||
              !item.shift_id.trim() ||
              !findActiveShiftStmt.get(item.shift_id, tenantId)
            ) {
              throw { status: 400, message: 'กะไม่ถูกต้องหรือถูกปิดใช้งาน' }
            }
            shiftId = item.shift_id
          }
          upsertStmt.run(
            generateId(),
            tenantId,
            item.employee_id,
            item.work_date,
            shiftId,
            req.user!.userId,
            now,
            now
          )
          updated++
        }
      }
    })()

    res.json({ success: true, data: { updated, cleared } })
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json({ success: false, message: err.message })
    }
    console.error('Put roster assignments error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// R3: POST /roster/copy (hr:write)
router.post('/roster/copy', requirePermission('hr', 'write'), (req: Request, res: Response) => {
  try {
    const fromWeek = typeof req.body?.from_week_start === 'string' ? req.body.from_week_start.trim() : ''
    const toWeek = typeof req.body?.to_week_start === 'string' ? req.body.to_week_start.trim() : ''
    const overwrite = Boolean(req.body?.overwrite)

    if (!isMonday(fromWeek) || !isMonday(toWeek)) {
      return res.status(400).json({ success: false, message: 'week_start ต้องเป็นวันจันทร์' })
    }
    if (fromWeek === toWeek) {
      return res.status(400).json({ success: false, message: 'สัปดาห์ต้นทางและปลายทางต้องไม่เป็นสัปดาห์เดียวกัน' })
    }

    const tenantId = req.user!.tenantId
    const fromDates = weekDates(fromWeek)
    const toDates = weekDates(toWeek)
    const dateMap = new Map<string, string>(fromDates.map((d, i) => [d, toDates[i]]))

    const sourceRows = db.prepare(`
      SELECT sa.employee_id, sa.work_date, sa.shift_id
      FROM shift_assignments sa
      JOIN employees e ON e.id = sa.employee_id AND e.tenant_id = sa.tenant_id
      WHERE sa.tenant_id = ?
        AND e.status = 'ACTIVE'
        AND sa.work_date >= ?
        AND sa.work_date <= ?
    `).all(tenantId, fromDates[0], fromDates[6]) as Array<{
      employee_id: string
      work_date: string
      shift_id: string | null
    }>

    const existingStmt = db.prepare(
      'SELECT id FROM shift_assignments WHERE tenant_id = ? AND employee_id = ? AND work_date = ?'
    )
    const insertStmt = db.prepare(`
      INSERT INTO shift_assignments (id, tenant_id, employee_id, work_date, shift_id, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const updateStmt = db.prepare(`
      UPDATE shift_assignments
      SET shift_id = ?, updated_at = ?
      WHERE tenant_id = ? AND employee_id = ? AND work_date = ?
    `)

    let copied = 0
    let skipped = 0
    const now = new Date().toISOString()

    db.transaction(() => {
      for (const r of sourceRows) {
        const targetDate = dateMap.get(r.work_date)
        if (!targetDate) continue
        const existing = existingStmt.get(tenantId, r.employee_id, targetDate)
        if (existing) {
          if (!overwrite) {
            skipped++
            continue
          }
          updateStmt.run(r.shift_id ?? null, now, tenantId, r.employee_id, targetDate)
          copied++
        } else {
          insertStmt.run(
            generateId(),
            tenantId,
            r.employee_id,
            targetDate,
            r.shift_id ?? null,
            req.user!.userId,
            now,
            now
          )
          copied++
        }
      }
    })()

    res.json({ success: true, data: { copied, skipped } })
  } catch (err: any) {
    console.error('Copy roster error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// R5: GET /me/roster/day?date=YYYY-MM-DD (self — วางก่อน /me/roster)
router.get('/me/roster/day', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const selfEmp = getSelfEmployee(tenantId, req.user!.userId)
    if (!selfEmp) {
      return res.status(404).json({ success: false, message: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงาน' })
    }

    const date = typeof req.query.date === 'string' ? req.query.date.trim() : ''
    if (!isIsoDate(date)) {
      return res.status(400).json({ success: false, message: 'วันที่ไม่ถูกต้อง' })
    }

    const others = db.prepare(`
      SELECT e.id, e.first_name, e.last_name, ou.name AS org_unit_name
      FROM employees e
      LEFT JOIN org_units ou ON e.org_unit_id = ou.id AND ou.tenant_id = e.tenant_id
      WHERE e.tenant_id = ? AND e.status = 'ACTIVE' AND e.id <> ?
    `).all(tenantId, selfEmp.id) as any[]

    const shifts = listShifts(tenantId)
    const shiftMap = new Map<string, RosterShift>(shifts.map((s) => [s.id, s]))
    const cellMap = getEffectiveCells(tenantId, [date], others.map((o) => o.id))

    const data: Array<{
      employee_id: string
      name: string
      org_unit_name: string | null
      shift: RosterShift | null
    }> = []

    for (const emp of others) {
      const cell = cellMap.get(emp.id)?.[0]
      if (cell?.on_leave) continue
      const shift = cell?.shift_id ? (shiftMap.get(cell.shift_id) ?? null) : null
      data.push({
        employee_id: emp.id,
        name: `${emp.first_name || ''} ${emp.last_name || ''}`.trim(),
        org_unit_name: emp.org_unit_name ?? null,
        shift,
      })
    }

    data.sort((a, b) => {
      const sa = a.shift?.start_time ?? '99:99'
      const sb = b.shift?.start_time ?? '99:99'
      if (sa !== sb) return sa.localeCompare(sb)
      return a.name.localeCompare(b.name, 'th')
    })

    res.json({ success: true, data })
  } catch (err: any) {
    console.error('Get colleague shifts error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// R4: GET /me/roster?week_start=YYYY-MM-DD (self)
router.get('/me/roster', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const selfEmp = getSelfEmployee(tenantId, req.user!.userId)
    if (!selfEmp) {
      return res.status(404).json({ success: false, message: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงาน' })
    }

    const weekStart = typeof req.query.week_start === 'string' ? req.query.week_start.trim() : ''
    if (!isMonday(weekStart)) {
      return res.status(400).json({ success: false, message: 'week_start ต้องเป็นวันจันทร์' })
    }

    const dates = weekDates(weekStart)
    const shifts = listShifts(tenantId)
    const shiftMap = new Map<string, RosterShift>(shifts.map((s) => [s.id, s]))
    const cells = getEffectiveCells(tenantId, dates, [selfEmp.id]).get(selfEmp.id) || []

    const days = cells.map((c) => ({
      date: c.date,
      shift: c.shift_id ? (shiftMap.get(c.shift_id) ?? null) : null,
      source: c.source,
      on_leave: c.on_leave,
      holiday: c.holiday,
    }))

    res.json({
      success: true,
      data: {
        week_start: weekStart,
        employee_id: selfEmp.id,
        days,
      },
    })
  } catch (err: any) {
    console.error('Get my roster error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

export default router
