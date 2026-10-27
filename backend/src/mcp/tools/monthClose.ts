import { z } from 'zod'
import db from '../../db/sqlite'
import { IMcpServer } from '../sdk-compat'
import { ok } from './shared'
import { closeChecklist } from '../../services/closeChecklist.service'
import { buildClosePack } from '../../services/closePack.service'
import { submitCloseAdjustments, canSubmitAdjustments, MAX_LINES, ADJ_TYPES } from '../../services/closeAdjustments.service'
import { MonthCloseError } from '../../services/monthClose.service'
import { loadPermUser } from '../../services/rbac.service'

// ปิดบัญชีรายเดือน (A3/A4/A5) — สาย MCP เรียก service ตัวเดียวกับ REST (routes/monthClose.routes.ts) ห้าม copy SQL
// get_close_pack / submit_close_adjustments เห็นเฉพาะคนที่ส่งรายการปรับปรุงได้ (MASTER/ADMIN หรือ accounting:write)
const PERIOD = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).describe('งวด YYYY-MM เช่น 2026-10')

const fail = (e: unknown) => ok({ success: false, message: e instanceof MonthCloseError ? e.message : ((e as Error).message || 'เกิดข้อผิดพลาด') })

export function registerMonthCloseTools(server: IMcpServer, tenantId: string, userId: string, callerName: string, callerRole: string): void {
  server.tool(
    'get_close_checklist',
    `ด่านตรวจปิดงวด 11 ข้อ (อ่านอย่างเดียว) / Month-end close checklist.
ใช้เมื่อถาม "ปิดงวดได้หรือยัง" "ตัวเลขเชื่อได้แค่ไหน" "มีอะไรค้างก่อนปิดเดือน" — ได้สถานะรายข้อ pass/warn/block/na + รายละเอียดภาษาไทย + label "ผ่าน N/11"
ข้อที่เป็น block ต้องแก้ก่อนปิดงวด (canClose = false)`,
    { period: PERIOD },
    async ({ period }) => {
      try { return ok(closeChecklist(tenantId, period)) } catch (e) { return fail(e) }
    }
  )

  const perm = { ...loadPermUser(userId, callerRole), role: callerRole }
  if (!canSubmitAdjustments(perm)) return

  server.tool(
    'get_close_pack',
    `ชุดปิดเดือน (อ่านอย่างเดียว) สำหรับเทียบกับ bank statement / Month-end close pack.
ได้: คำสั่งสำหรับ AI (instructions — อ่านก่อนเริ่ม), ทุกบรรทัดของบัญชีเงินสด/ธนาคารในงวด (lineId, วันที่, เลขเอกสาร, ที่มา, คู่ค้า, เข้า, ออก, คงเหลือ),
ยอดยกมา/สิ้นงวดต่อบัญชี, บัญชีหัวที่ค้างยอด, ผังบัญชีที่ใช้ได้, คู่ค้า, ใบแจ้งหนี้ค้าง, 13 ประเภทรายการพร้อมบัญชีที่อนุญาต, แบบฟอร์มส่งกลับ
ลำดับ: get_close_pack → เทียบ statement (ถามคนเมื่อชื่อถูกปิดบางส่วน) → submit_close_adjustments ทีละบัญชี`,
    { period: PERIOD },
    async ({ period }) => {
      try { return ok(buildClosePack(tenantId, period)) } catch (e) { return fail(e) }
    }
  )

  const typeNames = Object.keys(ADJ_TYPES) as [string, ...string[]]
  server.tool(
    'submit_close_adjustments',
    `ส่งรายการปรับปรุงจากการเทียบ statement กลับเข้าระบบ (ทีละ 1 บัญชี ≤ ${MAX_LINES} บรรทัด) / Submit month-end bank reconciliation adjustments.
ระบบตรวจทุกบรรทัด (ประเภท/บัญชี/ยอด/งวด/รายการเดิม/บัญชีหัว) แล้วเก็บเป็น "ร่าง" เท่านั้น — คนต้องอนุมัติที่หน้า บัญชี > ปิดงวด ก่อนลงบัญชี
ถ้ามีบรรทัดใดถูกปฏิเสธ (rejected) ระบบจะไม่บันทึกอะไรเลยทั้งชุดรวมยอด statement (บรรทัดที่ผ่านได้สถานะ not_saved) — แก้บรรทัดที่ถูกปฏิเสธแล้วส่งทั้งชุดใหม่
ส่งซ้ำได้ (กันซ้ำด้วยบัญชี+วันที่+ยอด+statement_ref+statement_line_no) · ตอบผลรายบรรทัดพร้อมวิธีแก้ และผลต่างที่เหลือ (summary.difference ต้องเป็น 0)
ไม่มีอะไรต้องปรับก็ส่ง lines: [] พร้อม statement_closing_balance เพื่อบันทึกว่ากระทบยอดแล้ว · ดูประเภท/ตัวอย่างใน get_close_pack (types, submitSchema)`,
    {
      period: PERIOD,
      bank_account_code: z.string().describe('รหัสบัญชีเงินสด/ธนาคารที่กระทบยอด (accounts[].code จาก get_close_pack) เช่น 1102-01 หรือ 1101'),
      statement_closing_balance: z.number().finite().describe('ยอดคงเหลือสิ้นงวดตาม statement (หรือเงินสดที่นับได้จริง)'),
      statement_hash: z.string().max(128).optional().describe('SHA-256 ของไฟล์ statement (ถ้ามี) เก็บเป็นหลักฐาน'),
      lines: z.array(z.object({
        type: z.enum(typeNames).describe('ประเภทรายการ (ดู get_close_pack.types)'),
        date: z.string().describe('วันที่ตาม statement YYYY-MM-DD (ต้องอยู่ในงวด)'),
        amount: z.number().finite().positive().describe('จำนวนเงินบวก ทศนิยมไม่เกิน 2 ตำแหน่ง'),
        statement_ref: z.string().max(120).describe('เลขอ้างอิงในบรรทัด statement'),
        statement_line_no: z.number().int().min(0).describe('ลำดับบรรทัดใน statement'),
        description: z.string().max(300).describe('คำอธิบายรายการ'),
        account_code: z.string().max(20).optional().describe('บัญชีที่ประเภทนั้นให้เลือก (types[].allowedAccounts)'),
        counter_account_code: z.string().max(20).optional().describe('OWNER_PAID/OWNER_CAPITAL: 2110 หรือ 3101'),
        ref_line_id: z.string().max(64).optional().describe('lineId ของรายการเดิม (WRONG_CHANNEL, WRONG_ACCOUNT, DUPLICATE, TIMING, OWNER_PAID)'),
        invoice_id: z.string().max(64).optional().describe('UNRECORDED_RECEIPT ที่มีใบแจ้งหนี้ขาย: id หรือเลขที่ (openInvoices.sales)'),
        direction: z.enum(['IN', 'OUT']).optional().describe('CASH_COUNT_DIFF / UNIDENTIFIED: IN = เงินเข้า/เกิน, OUT = เงินออก/ขาด'),
        reason: z.string().max(500).describe('เหตุผลที่จัดเป็นประเภทนี้'),
        confidence: z.number().min(0).max(1).optional().describe('ความมั่นใจ 0–1'),
      })).max(MAX_LINES),
    },
    async (args) => {
      try {
        const name = (db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as { name?: string } | undefined)?.name || callerName
        return ok({ success: true, ...submitCloseAdjustments(tenantId, { ...perm, userId, name, email: callerName }, args as any) })
      } catch (e) { return fail(e) }
    }
  )
}

export default registerMonthCloseTools
