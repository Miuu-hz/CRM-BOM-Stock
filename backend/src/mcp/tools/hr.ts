import { z } from 'zod'
import db from '../../db/sqlite'
import { IMcpServer } from '../sdk-compat'
import { ok } from './shared'
import { hasFeature } from '../../services/subscription.service'
import { loadPermUser, userCan } from '../../services/rbac.service'
import {
  AttendanceError,
  getAttendanceSummary,
  importAttendance,
} from '../../services/hr/attendanceStore'

export const HR_READ_ONLY_TOOLS = ['hr_attendance_summary'] as const

const KNOWN_ROLES = new Set(['MASTER', 'ADMIN', 'MANAGER', 'POWERUSER', 'USER', 'VIEWER'])
const YMD = /^\d{4}-\d{2}-\d{2}$/

function resolveCallerRole(
  userId: string,
  callerRoleOrName?: string,
  maybeCallerRole?: string
): string {
  if (maybeCallerRole && KNOWN_ROLES.has(maybeCallerRole)) return maybeCallerRole
  if (callerRoleOrName && KNOWN_ROLES.has(callerRoleOrName)) return callerRoleOrName
  if (userId === 'master' || userId.startsWith('master_')) return 'MASTER'
  try {
    const row = db
      .prepare('SELECT role FROM users WHERE id = ? LIMIT 1')
      .get(userId) as { role?: string } | undefined
    if (row?.role) return row.role
  } catch {
    /* ignore */
  }
  return maybeCallerRole || callerRoleOrName || 'USER'
}

export function registerHrTools(
  server: IMcpServer,
  tenantId: string,
  userId = 'mcp-agent',
  callerRoleOrName?: string,
  maybeCallerRole?: string
): void {
  const checkAccess = (action: 'read' | 'write'): { allowed: true } | { allowed: false; reason: string; code: string } => {
    const role = resolveCallerRole(userId, callerRoleOrName, maybeCallerRole)
    if (role !== 'MASTER' && !hasFeature(tenantId, 'hr')) {
      return {
        allowed: false,
        code: 'FEATURE_LOCKED',
        reason: 'HR feature is not enabled for this tenant subscription.',
      }
    }
    const perm = loadPermUser(userId, role)
    if (!userCan(perm, 'hr', action)) {
      return {
        allowed: false,
        code: 'FORBIDDEN',
        reason: `Permission denied: hr:${action} is required.`,
      }
    }
    return { allowed: true }
  }

  server.tool(
    'hr_import_attendance',
    'Import biometric/CSV time-clock punches into HR attendance logs and return insert/duplicate/unmapped counts. Note: OT minutes computed from punches are candidates that need supervisor approval before payroll.',
    {
      filename: z.string().optional().describe('Original file name (e.g. attlog.dat or punches.csv)'),
      content: z.string().describe('Raw text content of the attendance log file (max 5 MB)'),
    },
    async ({ filename, content }) => {
      const access = checkAccess('write')
      if (!access.allowed) {
        return ok({ success: false, code: access.code, error: access.reason, message: access.reason })
      }
      try {
        const result = importAttendance({
          tenantId,
          filename: filename || 'mcp-import.txt',
          content,
          source: 'MCP',
          createdBy: userId,
        })
        return ok({
          success: true,
          ...result,
          note: 'OT minutes are candidates that need supervisor approval before payroll.',
        })
      } catch (e: any) {
        const msg = e instanceof AttendanceError ? e.message : e?.message || 'Import failed'
        return ok({ success: false, error: msg, message: msg })
      }
    }
  )

  server.tool(
    'hr_attendance_summary',
    'Get per-employee attendance summary (days worked, late minutes, early leave minutes, OT-candidate minutes, absent days) and unmapped device PINs for a date range. OT minutes are candidates that need supervisor approval before payroll.',
    {
      from: z.string().regex(YMD).describe('Start date YYYY-MM-DD (inclusive)'),
      to: z.string().regex(YMD).describe('End date YYYY-MM-DD (inclusive, max 62-day span)'),
    },
    async ({ from, to }) => {
      const access = checkAccess('read')
      if (!access.allowed) {
        return ok({ success: false, code: access.code, error: access.reason, message: access.reason })
      }
      try {
        const summary = getAttendanceSummary(tenantId, from, to)
        const employees = summary.employees.map((e) => ({
          employeeId: e.employeeId,
          code: e.code,
          name: e.name,
          devicePin: e.devicePin,
          shiftName: e.shiftName,
          daysWorked: e.totals.daysWorked,
          absentDays: e.totals.absentDays,
          lateMinutes: e.totals.lateMinutes,
          earlyLeaveMinutes: e.totals.earlyLeaveMinutes,
          otCandidateMinutes: e.totals.otCandidateMinutes,
          ...(e.totals.holidayDays !== undefined ? { holidayDays: e.totals.holidayDays } : {}),
          ...(e.totals.leaveDays !== undefined ? { leaveDays: e.totals.leaveDays } : {}),
          totals: e.totals,
        }))
        return ok({
          success: true,
          from: summary.from,
          to: summary.to,
          employees,
          noShift: summary.noShift,
          unmappedPins: summary.unmappedPins,
          note: 'OT minutes are candidates that need supervisor approval before payroll.',
        })
      } catch (e: any) {
        const msg = e instanceof AttendanceError ? e.message : e?.message || 'Summary failed'
        return ok({ success: false, error: msg, message: msg })
      }
    }
  )
}
