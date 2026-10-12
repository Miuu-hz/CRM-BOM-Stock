// ซ่อมกะ POS ที่ปิดค้าง: status = CLOSED แต่ไม่มี journal POS_SHIFT_CLOSE (reference_id = id กะ)
// เกิดจากโค้ดปิดกะเดิม (ก่อน 2026-10-06) ที่ UPDATE สถานะเป็น CLOSED ก่อนลงบัญชีและไม่อยู่ใน transaction
// พอ postJournal โยน (เช่น "เดบิต 27.65 ไม่เท่ากับเครดิต 27.66") กะก็ปิดไปแล้ว บัญชีพัก 1180 ไม่ถูกเคลียร์
// ใช้โดย scripts/repair-stuck-pos-shifts-2026-10-06.ts
import db from '../db/sqlite'
import { ACC, resolveBankAccountGL } from '../config/accountCodes'
import { postJournal, type JournalLineInput } from './accounting.service'
import { closedPeriodLabel } from '../routes/journal.routes'
import { thaiDateStr } from '../utils/id'

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

type ShiftRef = { tenant_id: string; id: string; opened_at: string; closed_at?: string | null }

/**
 * ยอดรับไม่ใช่เงินสดของกะ แยกตามบัญชี GL ของ bank_account_id ที่เลือกตอนรับชำระ (Settings > บัญชีธนาคาร)
 * ไม่ได้เลือก/บัญชีถูกปิด = 1102 · บัตรเครดิตเข้าธนาคารด้วย (ผังบัญชียังไม่มีบัญชีพักบัตร)
 * แบ่งยอดบิลตามสัดส่วนที่จ่าย (สูตรเดียวกับ getShiftSalesSummary) → บิลจ่ายหลายแถวไม่นับซ้ำ
 * ปัดเศษรายบัญชีแล้วโยนเศษที่เหลือเข้าบรรทัดสุดท้าย ให้รวมได้ = bankRevenue เป๊ะ
 * ยอดรวมห่างจาก bankRevenue เกิน 0.01 (บิลเปลี่ยนหลังปิดกะ — ทางซ่อม) = ลง 1102 ก้อนเดียวแบบเดิม
 */
export function getShiftBankLines(shift: ShiftRef, bankRevenue: number): JournalLineInput[] {
  const description = 'ยอดรับผ่านโอน/QR/บัตร'
  const rows = db.prepare(`
    SELECT p.bank_account_id, SUM(b.total_amount * p.amount / t.paid) AS amount
    FROM pos_running_bills b
    JOIN (SELECT bill_id, SUM(amount) AS paid FROM pos_payments WHERE tenant_id = ? GROUP BY bill_id) t ON t.bill_id = b.id
    JOIN pos_payments p ON p.bill_id = b.id AND p.tenant_id = b.tenant_id
    WHERE b.tenant_id = ? AND b.status = 'PAID' AND t.paid > 0 AND p.payment_method <> 'CASH'
      AND (b.shift_id = ? OR (b.shift_id IS NULL AND b.closed_at >= ?${shift.closed_at ? ' AND b.closed_at <= ?' : ''}))
    GROUP BY p.bank_account_id
  `).all(shift.tenant_id, shift.tenant_id, shift.id, shift.opened_at, ...(shift.closed_at ? [shift.closed_at] : [])) as
    { bank_account_id: string | null; amount: number }[]

  const byAccount = new Map<string | null, number>()
  for (const r of rows) {
    const accountId = resolveBankAccountGL(shift.tenant_id, r.bank_account_id)
    byAccount.set(accountId, (byAccount.get(accountId) || 0) + r.amount)
  }
  const raw = [...byAccount.values()].reduce((a, b) => a + b, 0)
  if (byAccount.size === 0 || Math.abs(raw - bankRevenue) > 0.01) return [{ code: ACC.BANK, description, debit: bankRevenue }]

  const entries = [...byAccount.entries()]
  let left = bankRevenue
  return entries.map(([accountId, amt], i) => {
    const debit = i === entries.length - 1 ? r2(left) : r2(amt)
    left = r2(left - debit)
    return accountId ? { accountId, description, debit } : { code: ACC.BANK, description, debit }
  })
}

/**
 * บรรทัด journal ปิดกะ — ใช้ร่วมกันทั้ง POST /pos-shifts/:id/close (routes/sales/pos.routes.ts) และสคริปต์ซ่อมกะค้าง
 * (ปัดที่ยอดรวม ขาเงินสด = ส่วนที่เหลือของยอดบิล → ดุลเป๊ะเสมอ)
 * ขาธนาคารแยกตามบัญชีธนาคารที่รับเงินจริง (getShiftBankLines)
 */
export function buildShiftCloseJournal(shift: ShiftRef & {
  shift_number: string; total_revenue: number; bank_revenue: number; cash_difference: number
}): { description: string; lines: JournalLineInput[] } | null {
  const billsTotal = r2(shift.total_revenue)
  const bankRevenue = r2(shift.bank_revenue)
  const cashDifference = r2(shift.cash_difference)
  const cashNet = r2(billsTotal - bankRevenue + cashDifference)
  if (billsTotal <= 0.005 && Math.abs(cashDifference) <= 0.005) return null // ไม่มีอะไรต้องลง (กะว่าง นับตรง)
  const diffLabel = cashDifference < 0 ? 'เงินขาด' : 'เงินเกิน'
  const bankLines = bankRevenue > 0.005 ? getShiftBankLines(shift, bankRevenue) : []
  return {
    description: Math.abs(cashDifference) > 0.005
      ? `ปิดกะ ${shift.shift_number} — ${diffLabel} ${Math.abs(cashDifference).toFixed(2)} บาท`
      : `ปิดกะ ${shift.shift_number} — นำยอดขายเข้าบัญชี`,
    lines: [
      { code: ACC.CASH, description: 'เงินสดจากการขายหน้าร้าน', debit: Math.max(cashNet, 0), credit: Math.max(-cashNet, 0) },
      ...bankLines,
      { code: ACC.CASH_OVER_SHORT, description: 'เงินขาดจากการนับ', debit: cashDifference < 0 ? Math.abs(cashDifference) : 0 },
      { code: ACC.POS_CLEARING, description: `ปิดยอดบิลทั้งกะ ${shift.shift_number}`, credit: billsTotal },
      { code: ACC.CASH_OVER_SHORT, description: 'เงินเกินจากการนับ', credit: cashDifference > 0 ? cashDifference : 0 },
    ],
  }
}

const NO_CLOSE_JOURNAL = `NOT EXISTS (
  SELECT 1 FROM journal_entries j
  WHERE j.tenant_id = s.tenant_id AND j.reference_type = 'POS_SHIFT_CLOSE' AND j.reference_id = s.id)`

/**
 * กะ CLOSED ที่ไม่มี journal POS_SHIFT_CLOSE และ "ควรมี" (มียอดบิลหรือมีส่วนต่าง หรือข้อมูลปิดกะหาย)
 * กะว่างที่นับเงินตรงไม่มี journal อยู่แล้วโดยปกติ — ไม่นับว่าค้าง
 */
export function findStuckClosedShifts(tenantId?: string): any[] {
  return db.prepare(`
    SELECT s.* FROM pos_shifts s
    WHERE s.status = 'CLOSED' AND ${NO_CLOSE_JOURNAL}
      AND (s.total_revenue IS NULL OR s.cash_difference IS NULL OR s.closed_at IS NULL
           OR ABS(s.total_revenue) > 0.005 OR ABS(s.cash_difference) > 0.005)
      ${tenantId ? 'AND s.tenant_id = ?' : ''}
    ORDER BY s.tenant_id, s.closed_at
  `).all(...(tenantId ? [tenantId] : []))
}

/** ยอดที่บิลในกะนี้ลง Dr 1180 ไว้ตอนปิดบิล (POS_SALE) — ศูนย์ = กะก่อนเปลี่ยนมาใช้บัญชีพัก (2026-09-19) */
function clearingDebitOfShift(shift: any): number {
  const row = db.prepare(`
    SELECT COALESCE(SUM(l.debit), 0) AS amt
    FROM pos_running_bills b
    JOIN journal_entries j ON j.tenant_id = b.tenant_id AND j.reference_type = 'POS_SALE' AND j.reference_id = b.id
    JOIN journal_lines l ON l.journal_entry_id = j.id
    JOIN accounts a ON a.id = l.account_id AND a.code = ?
    WHERE b.tenant_id = ? AND b.status = 'PAID'
      AND (b.shift_id = ? OR (b.shift_id IS NULL AND b.closed_at >= ? AND b.closed_at <= ?))
  `).get(ACC.POS_CLEARING, shift.tenant_id, shift.id, shift.opened_at, shift.closed_at) as any
  return r2(row?.amt)
}

export interface ShiftRepairResult {
  /** posted = ลงแล้ว/จะลง · skip = ไม่ต้องซ่อม · blocked = ซ่อมไม่ได้ ต้องดูเอง */
  status: 'posted' | 'skip' | 'blocked'
  message: string
  date: string
  journalEntryId?: string
}

/**
 * ลง journal ปิดกะย้อนหลัง ลงวันที่ตาม closed_at (วันตามเวลาไทย แบบเดียวกับที่ route ปิดกะใช้)
 * ทำใน transaction · dryRun = ลงจริงแล้วถอยกลับ ให้ postJournal ตรวจดุลจริงโดยไม่เขียนอะไร
 * รันซ้ำได้: ตรวจซ้ำใน transaction ว่ายังไม่มี journal ก่อนลงทุกครั้ง
 */
export function repairStuckShift(shift: any, actor: string, opts: { dryRun?: boolean } = {}): ShiftRepairResult {
  const date = shift.closed_at ? thaiDateStr(shift.closed_at) : ''
  const result = (status: ShiftRepairResult['status'], message: string, journalEntryId?: string) =>
    ({ status, message, date, journalEntryId })

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || shift.total_revenue == null || shift.cash_difference == null) {
    return result('blocked', 'ข้อมูลปิดกะไม่ครบ (closed_at/ยอดขาย/ส่วนต่าง ว่าง) — ต้องลงบัญชีเอง')
  }
  const journal = buildShiftCloseJournal(shift)
  if (!journal) return result('skip', 'ไม่มียอดต้องลง (กะว่าง นับเงินตรง)')

  const clearing = clearingDebitOfShift(shift)
  const billsTotal = r2(shift.total_revenue)
  if (billsTotal > 0.005 && clearing <= 0.005) {
    return result('skip', 'บิลในกะไม่ได้ลงบัญชีพัก 1180 (กะก่อนเปลี่ยนระบบ) — ไม่ต้องปิดยอด')
  }
  const closed = closedPeriodLabel(shift.tenant_id, date)
  if (closed) return result('blocked', `งวด ${closed} ปิดบัญชีแล้ว ลงวันที่ ${date} ไม่ได้`)

  const warn = Math.abs(clearing - billsTotal) > 0.005
    ? ` ⚠️ ยอดบิลที่ลงพัก 1180 = ${clearing.toFixed(2)} ไม่เท่ายอดกะ ${billsTotal.toFixed(2)} (ใช้ยอดกะตามที่ปิดไว้)`
    : ''
  const ROLLBACK = Symbol('dry-run')
  let id: string | undefined
  let existed = false
  try {
    db.transaction(() => {
      const already = db.prepare(`SELECT id FROM journal_entries WHERE tenant_id = ? AND reference_type = 'POS_SHIFT_CLOSE' AND reference_id = ?`)
        .get(shift.tenant_id, shift.id) as any
      if (already) { existed = true; id = already.id; throw ROLLBACK }
      id = postJournal({
        tenantId: shift.tenant_id,
        date,
        referenceType: 'POS_SHIFT_CLOSE',
        referenceId: shift.id,
        description: journal.description,
        // ponytail: ผู้บันทึก = ชื่อสคริปต์ ไม่ใช่ user ที่ปิดกะ — ตามรอยได้จาก created_by
        createdBy: actor,
        businessUnit: 'RETAIL',
        sourceNumber: shift.shift_number,
        notes: `ลงย้อนหลังโดย ${actor} (กะปิดค้างไม่มี journal)`,
        lines: journal.lines,
      })
      if (opts.dryRun) throw ROLLBACK
    })()
  } catch (e: any) {
    if (e !== ROLLBACK) return result('blocked', `ลงบัญชีไม่ได้: ${e?.message || e}`)
  }
  if (existed) return result('skip', 'มี journal ปิดกะแล้ว (ทำไปก่อนหน้า)', id)
  const verb = opts.dryRun ? 'จะลง' : 'ลงแล้ว'
  return result('posted', `${verb} ${journal.description} · Cr 1180 ${billsTotal.toFixed(2)}${warn}`, opts.dryRun ? undefined : id)
}
