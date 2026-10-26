import db from '../db/sqlite'
import { ACC } from '../config/accountCodes'
import { CLOSE_CHECK } from '../config/thresholds'
import {
  periodRange,
  previousPeriod,
  moneyAccounts,
  postedBalance,
  hasActivity,
  headerAccountIds,
  reconciliationStatus,
  r2,
  ZERO,
  type ReconStatus,
} from './monthClose.service'
import { clearingReconcileData } from '../routes/clearingReconcile.routes'
import { arAging, apAging } from '../routes/receivables.routes'
import { totalStockValue } from './stockValue.service'
import { thaiToday } from './phopyBoard.service'

// ด่านตรวจปิดงวด 11 ข้อ (A3) — service เดียวที่ทั้งการปิดงวด, Dashboard (สัญญาณการควบคุม + ป้ายความน่าเชื่อถือ),
// Phopy Board บท 6 และ MCP get_close_checklist ใช้ร่วมกัน

export type CheckStatus = 'pass' | 'warn' | 'block' | 'na'

export interface CheckItem {
  /** 1–11 ตามตารางหัวข้อ 6 ของสเปกปิดบัญชีรายเดือน */
  id: number
  key: string
  title: string
  /** ระดับเมื่อไม่ผ่าน */
  severity: 'block' | 'warn'
  status: CheckStatus
  /** คำอธิบายภาษาไทยว่าเจออะไร/ต้องทำอะไร */
  detail: string
  count?: number
  amount?: number
  /** ลิงก์หน้าเว็บที่แก้ได้ */
  link?: string
  /** ตรวจได้รายวัน (ข้อ 1, 4, 5, 6) — Dashboard ใช้ทำสัญญาณการควบคุมระหว่างเดือน */
  daily: boolean
  /** ข้อมูลประกอบ (รายการบัญชี ฯลฯ) */
  rows?: Array<Record<string, unknown>>
}

export interface ChecklistResult {
  period: string
  start: string
  end: string
  periodStatus: 'OPEN' | 'CLOSED' | 'FILING' | 'NONE'
  items: CheckItem[]
  /** pass + na */
  passed: number
  total: number
  blocks: number
  warns: number
  /** "ผ่าน N/11" */
  label: string
  canClose: boolean
}

const POSTED_NON_CLOSING = `je.tenant_id = ? AND je.is_posted = 1 AND (je.is_closing_entry IS NULL OR je.is_closing_entry = 0)`
const MANUAL_REF_SQL = `(je.reference_type IS NULL OR je.reference_type = '' OR je.reference_type IN ('MANUAL', 'ADJUSTMENT', 'REVERSAL')) AND (je.is_closing_entry IS NULL OR je.is_closing_entry = 0)`
const baht = (n: number) => `฿${r2(Math.abs(n)).toLocaleString('th-TH')}`

function accountIdOf(tenantId: string, code: string): string | null {
  const row = db.prepare('SELECT id FROM accounts WHERE tenant_id = ? AND code = ?').get(tenantId, code) as { id: string } | undefined
  return row?.id ?? null
}

/** 1. งบทดลองดุล */
function checkTrialBalance(tenantId: string, end: string): CheckItem {
  const tot = db.prepare(`
    SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS diff
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.tenant_id = ? AND je.is_posted = 1 AND date(je.date) <= ?
  `).get(tenantId, end) as { diff: number }

  const unbalanced = (db.prepare(`
    SELECT je.entry_number AS entryNumber, je.date AS date, COALESCE(SUM(jl.debit - jl.credit), 0) AS diff
    FROM journal_entries je
    LEFT JOIN journal_lines jl ON jl.journal_entry_id = je.id
    WHERE je.tenant_id = ? AND je.is_posted = 1 AND date(je.date) <= ?
    GROUP BY je.id
    HAVING ABS(COALESCE(SUM(jl.debit - jl.credit), 0)) > ?
    ORDER BY je.date DESC, je.entry_number DESC
    LIMIT 20
  `).all(tenantId, end, ZERO) as Array<{ entryNumber: string; date: string; diff: number }>)
    .map(r => ({ entryNumber: r.entryNumber, date: r.date, diff: r2(r.diff) }))

  const absDiff = r2(Math.abs(tot.diff))
  const failed = Math.abs(tot.diff) > ZERO || unbalanced.length > 0
  return {
    id: 1,
    key: 'trial_balance',
    title: 'งบทดลองดุล',
    severity: 'block',
    status: failed ? 'block' : 'pass',
    detail: failed
      ? `งบทดลองไม่ดุล ต่างกัน ${baht(absDiff)} (พบรายการไม่ดุล ${unbalanced.length} รายการ) — ตรวจสอบและแก้ไขรายการในสมุดรายวัน`
      : 'เดบิตและเครดิตรวมเท่ากันทุกรายการ',
    count: unbalanced.length,
    amount: absDiff,
    link: '/accounting/reports?tab=trial-balance',
    daily: true,
    rows: unbalanced,
  }
}

/**
 * 2. บัญชีเงินฝากทุกบัญชีกระทบยอดกับ statement แล้ว ผลต่าง 0
 * + กฎของประเภท UNIDENTIFIED: เงินที่หาที่มาไม่ได้ (บัญชีพักรอตรวจสอบ 1190 รวมรายการที่รอ post) เกินเพดาน = กระทบยอดยังไม่จบ → บล็อก
 *   (ข้อ 7 ยังเตือนยอดค้างเดิมของ 1190 ตามตารางด่านตรวจ — ตรงนี้คือเงื่อนไข "ปิดงวดได้ถ้ารวมไม่เกินเพดาน" ในตารางประเภทรายการ)
 */
function checkBankReconciled(tenantId: string, period: string, end: string, recons: ReconStatus[]): CheckItem {
  const banks = recons.filter(r => r.kind === 'BANK')
  const suspenseId = accountIdOf(tenantId, ACC.SUSPENSE)
  const pendingUnidentified = (db.prepare(`SELECT COALESCE(SUM(r.effect), 0) AS v FROM bank_reconciliation_records r
    JOIN bank_reconciliations b ON b.id = r.reconciliation_id
    WHERE r.tenant_id = ? AND b.period = ? AND r.type = 'UNIDENTIFIED' AND r.status IN ('DRAFT', 'PENDING_APPROVAL')`).get(tenantId, period) as { v: number }).v
  const suspense = r2((suspenseId ? postedBalance(tenantId, suspenseId, end) : 0) - Number(pendingUnidentified))
  const suspenseOver = Math.abs(suspense) > CLOSE_CHECK.suspenseCapBaht
  if (banks.length === 0 && !suspenseOver) {
    return {
      id: 2,
      key: 'bank_reconciled',
      title: 'บัญชีเงินฝากทุกบัญชีกระทบยอดกับ statement แล้ว ผลต่าง 0',
      severity: 'block',
      status: 'na',
      detail: 'ไม่มีบัญชีเงินฝากที่มีความเคลื่อนไหวในงวดนี้',
      link: '/accounting/period-closing',
      daily: false,
    }
  }
  const failed = banks.filter(r => r.statement === null || !r.reconciled)
  const rows: Array<Record<string, unknown>> = failed.slice(0, 20).map(r => ({
    code: r.code, name: r.name, book: r.book, pending: r.pending, timing: r.timing, statement: r.statement, difference: r.difference,
  }))
  if (suspenseOver) rows.push({ code: ACC.SUSPENSE, name: 'บัญชีพักรอตรวจสอบ (รวมรายการที่รอ post)', balance: suspense, cap: CLOSE_CHECK.suspenseCapBaht })
  const amount = r2(failed.reduce((s, r) => s + Math.abs(r.difference ?? r.book), 0))
  const blocked = failed.length > 0 || suspenseOver
  const suspenseNote = suspenseOver
    ? ` · เงินที่หาที่มาไม่ได้ (${ACC.SUSPENSE}) รวม ${baht(suspense)} เกินเพดาน ${baht(CLOSE_CHECK.suspenseCapBaht)} — ต้องหาที่มาให้ได้ก่อนปิดงวด`
    : ''
  return {
    id: 2,
    key: 'bank_reconciled',
    title: 'บัญชีเงินฝากทุกบัญชีกระทบยอดกับ statement แล้ว ผลต่าง 0',
    severity: 'block',
    status: blocked ? 'block' : 'pass',
    detail: (failed.length > 0
      ? `มีบัญชีเงินฝากที่ยังไม่กระทบยอดหรือผลต่างไม่เป็น 0 จำนวน ${failed.length} บัญชี — ดาวน์โหลดชุดปิดเดือนให้ AI เทียบกับ statement แล้วส่งรายการปรับปรุงผ่าน MCP submit_close_adjustments`
      : banks.length > 0 ? `บัญชีเงินฝากทั้ง ${banks.length} บัญชีกระทบยอดตรงกับ statement แล้ว` : 'ไม่มีบัญชีเงินฝากที่มีความเคลื่อนไหว') + suspenseNote,
    count: failed.length + (suspenseOver ? 1 : 0),
    amount,
    link: '/accounting/period-closing',
    daily: false,
    rows,
  }
}

/** 3. นับเงินสดจริงสิ้นงวดแล้ว ผลต่างลง 5901 */
function checkCashCounted(recons: ReconStatus[]): CheckItem {
  const cashes = recons.filter(r => r.kind === 'CASH')
  if (cashes.length === 0) {
    return {
      id: 3,
      key: 'cash_counted',
      title: 'นับเงินสดจริงสิ้นงวดแล้ว ผลต่างลง 5901',
      severity: 'block',
      status: 'na',
      detail: 'ไม่มีบัญชีเงินสดที่มีความเคลื่อนไหวในงวดนี้',
      link: '/accounting/period-closing',
      daily: false,
    }
  }
  const failed = cashes.filter(r => r.statement === null || !r.reconciled)
  const rows = failed.slice(0, 20).map(r => ({
    code: r.code, name: r.name, book: r.book, pending: r.pending, timing: r.timing, statement: r.statement, difference: r.difference,
  }))
  const amount = r2(failed.reduce((s, r) => s + Math.abs(r.difference ?? r.book), 0))
  return {
    id: 3,
    key: 'cash_counted',
    title: 'นับเงินสดจริงสิ้นงวดแล้ว ผลต่างลง 5901',
    severity: 'block',
    status: failed.length > 0 ? 'block' : 'pass',
    detail: failed.length > 0
      ? `มีบัญชีเงินสดที่ยังไม่ได้ส่งยอดนับจริงสิ้นงวดหรือผลต่างไม่เป็น 0 จำนวน ${failed.length} บัญชี — นับเงินสดจริงแล้วส่งยอดพร้อมรายการปรับปรุง CASH_COUNT_DIFF (ลง 5901) ผ่าน MCP submit_close_adjustments`
      : `นับเงินสดจริงสิ้นงวดตรงกับยอดตามบัญชีทั้ง ${cashes.length} บัญชีแล้ว`,
    count: failed.length,
    amount,
    link: '/accounting/period-closing',
    daily: false,
    rows,
  }
}

/** 4. ไม่มีรายการร่างค้างในงวด */
function checkNoDrafts(tenantId: string, start: string, end: string): CheckItem {
  const drafts = db.prepare(`
    SELECT je.entry_number AS entryNumber, je.date AS date, COALESCE(je.description, '') AS description,
           je.reference_type AS referenceType,
           COALESCE(NULLIF(je.total_debit, 0), (SELECT COALESCE(SUM(jl.debit), 0) FROM journal_lines jl WHERE jl.journal_entry_id = je.id), 0) AS total
    FROM journal_entries je
    WHERE je.tenant_id = ? AND (je.is_posted = 0 OR je.is_posted IS NULL) AND date(je.date) BETWEEN ? AND ?
    ORDER BY je.date ASC, je.entry_number ASC
  `).all(tenantId, start, end) as Array<{ entryNumber: string; date: string; description: string; referenceType: string | null; total: number }>

  const count = drafts.length
  const amount = r2(drafts.reduce((s, d) => s + Number(d.total || 0), 0))
  const rows = drafts.slice(0, 20).map(d => ({
    entryNumber: d.entryNumber,
    date: d.date,
    description: d.description,
    referenceType: d.referenceType,
    total: r2(d.total),
  }))

  return {
    id: 4,
    key: 'no_drafts',
    title: 'ไม่มีรายการร่างค้างในงวด',
    severity: 'block',
    status: count > 0 ? 'block' : 'pass',
    detail: count > 0
      ? `มีรายการร่างค้างในงวด ${count} รายการ รวม ${baht(amount)} — ไปที่สมุดรายวันเพื่อยืนยัน (Post) หรือลบร่างที่ไม่ใช้`
      : 'ไม่มีรายการร่างค้างในงวด',
    count,
    amount,
    link: `/accounting/books?tab=journal&status=draft&from=${start}&to=${end}`,
    daily: true,
    rows,
  }
}

/** 5. เงินสดและเงินฝากไม่ติดลบวันไหนเลยในงวด */
function checkNoNegativeCash(tenantId: string, start: string, end: string): CheckItem {
  const activeMoney = moneyAccounts(tenantId).filter(a => hasActivity(tenantId, a.id, end))
  if (activeMoney.length === 0) {
    return {
      id: 5,
      key: 'no_negative_cash',
      title: 'เงินสดและเงินฝากไม่ติดลบวันไหนเลยในงวด',
      severity: 'warn',
      status: 'na',
      detail: 'ไม่มีบัญชีเงินสดหรือเงินฝากที่มีความเคลื่อนไหว',
      link: '/accounting/books?tab=chart',
      daily: true,
    }
  }

  const dailyMoves = db.prepare(`
    SELECT jl.account_id AS accountId, date(je.date) AS day, COALESCE(SUM(jl.debit - jl.credit), 0) AS delta
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE ${POSTED_NON_CLOSING}
      AND jl.account_id IN (${activeMoney.map(() => '?').join(',')})
      AND date(je.date) BETWEEN ? AND ?
    GROUP BY jl.account_id, date(je.date)
    ORDER BY day ASC
  `).all(tenantId, ...activeMoney.map(a => a.id), start, end) as Array<{ accountId: string; day: string; delta: number }>

  const movesByAcc = new Map<string, Array<{ day: string; delta: number }>>()
  for (const m of dailyMoves) {
    let arr = movesByAcc.get(m.accountId)
    if (!arr) { arr = []; movesByAcc.set(m.accountId, arr) }
    arr.push({ day: m.day, delta: Number(m.delta) })
  }

  const rows: Array<{ code: string; name: string; firstNegativeDate: string; minBalance: number; minBalanceDate: string }> = []
  for (const acc of activeMoney) {
    const opening = postedBalance(tenantId, acc.id, start, true)
    const moves = movesByAcc.get(acc.id) ?? []
    const steps = opening < -ZERO && moves[0]?.day !== start
      ? [{ day: start, delta: 0 }, ...moves]
      : moves

    let running = opening
    let firstNegativeDate: string | null = null
    let minBalance = Infinity
    let minBalanceDate = ''
    for (const s of steps) {
      running = r2(running + s.delta)
      if (running < -ZERO) {
        if (!firstNegativeDate) firstNegativeDate = s.day
        if (running < minBalance) {
          minBalance = running
          minBalanceDate = s.day
        }
      }
    }
    if (firstNegativeDate) {
      rows.push({
        code: acc.code,
        name: acc.name,
        firstNegativeDate,
        minBalance: r2(minBalance),
        minBalanceDate,
      })
    }
  }

  const count = rows.length
  const amount = r2(rows.reduce((s, r) => s + Math.abs(r.minBalance), 0))
  return {
    id: 5,
    key: 'no_negative_cash',
    title: 'เงินสดและเงินฝากไม่ติดลบวันไหนเลยในงวด',
    severity: 'warn',
    status: count > 0 ? 'warn' : 'pass',
    detail: count > 0
      ? `มีบัญชีเงินสด/เงินฝากติดลบในงวด ${count} บัญชี (เริ่มติดลบวันแรก ${rows[0].firstNegativeDate}) — ตรวจสอบรายการจ่ายที่ลงผิดบัญชีหรือขาดการบันทึกรายรับ/เงินทดรองจ่ายเจ้าของ`
      : 'ยอดเงินสดและเงินฝากสิ้นวันไม่ติดลบเลยตลอดงวด',
    count,
    amount,
    link: '/accounting/books?tab=chart',
    daily: true,
    rows: rows.slice(0, 20),
  }
}

/** 6. ไม่มียอดค้างในบัญชีหัว (บัญชีที่มีบัญชีย่อย) */
function checkNoHeaderBalance(tenantId: string, end: string): CheckItem {
  const headerIds = headerAccountIds(tenantId)
  const rows: Array<{ code: string; name: string; balance: number; lineCount: number }> = []

  if (headerIds.size > 0) {
    const lineCounts = db.prepare(`
      SELECT a.id, a.code, a.name, COUNT(jl.id) AS lineCount
      FROM accounts a
      JOIN journal_lines jl ON jl.account_id = a.id
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE a.tenant_id = ? AND ${POSTED_NON_CLOSING}
      GROUP BY a.id
      ORDER BY a.code ASC
    `).all(tenantId, tenantId) as Array<{ id: string; code: string; name: string; lineCount: number }>

    for (const h of lineCounts) {
      if (!headerIds.has(h.id)) continue
      const balance = postedBalance(tenantId, h.id, end)
      if (Math.abs(balance) > ZERO) {
        rows.push({ code: h.code, name: h.name, balance, lineCount: Number(h.lineCount) })
      }
    }
  }

  const count = rows.length
  const amount = r2(rows.reduce((s, r) => s + Math.abs(r.balance), 0))
  return {
    id: 6,
    key: 'no_header_balance',
    title: 'ไม่มียอดค้างในบัญชีหัว (บัญชีที่มีบัญชีย่อย)',
    severity: 'block',
    status: count > 0 ? 'block' : 'pass',
    detail: count > 0
      ? `พบยอดค้างในบัญชีหัว ${count} บัญชี รวม ${baht(amount)} — ย้ายยอดไปบัญชีย่อยด้วยรายการปรับปรุงประเภท WRONG_ACCOUNT`
      : 'ไม่มียอดค้างในบัญชีหัว',
    count,
    amount,
    link: '/accounting/period-closing',
    daily: true,
    rows: rows.slice(0, 20),
  }
}

/** 7. บัญชีพัก 1180 / 1181 / 1182 / 2109 / พักรอตรวจสอบ ไม่ค้างเกินเพดานหรือเกินอายุ */
function checkClearingAccounts(tenantId: string, end: string): CheckItem {
  const today = thaiToday()
  const todayMs = Date.parse(`${today}T00:00:00Z`)
  const findings: Array<Record<string, unknown>> = []

  const suspenseId = accountIdOf(tenantId, ACC.SUSPENSE)
  const suspenseBal = suspenseId ? postedBalance(tenantId, suspenseId, end) : 0
  if (Math.abs(suspenseBal) > CLOSE_CHECK.suspenseCapBaht) {
    findings.push({
      kind: 'SUSPENSE',
      code: ACC.SUSPENSE,
      name: 'บัญชีพักรอตรวจสอบ',
      balance: suspenseBal,
      cap: CLOSE_CHECK.suspenseCapBaht,
      label: `บัญชีพักรอตรวจสอบ (${ACC.SUSPENSE}) มียอดค้าง ${baht(suspenseBal)} เกินเพดาน ${baht(CLOSE_CHECK.suspenseCapBaht)}`,
    })
  }

  const buckets = clearingReconcileData(tenantId)
  for (const b of buckets) {
    if (b.mismatch) {
      findings.push({
        kind: 'MISMATCH',
        code: b.code,
        name: b.name,
        balance: r2(b.balance),
        itemsTotal: r2(b.itemsTotal),
        diff: r2(b.balance - b.itemsTotal),
        label: `บัญชีพัก ${b.code} (${b.name}) ยอดบัญชี ${baht(b.balance)} ไม่ตรงกับยอดเอกสารค้าง ${baht(b.itemsTotal)}`,
      })
    }
    for (const it of b.items) {
      if (!it.date) continue
      const dayStr = String(it.date).slice(0, 10)
      const itemMs = Date.parse(`${dayStr}T00:00:00Z`)
      if (!Number.isFinite(itemMs)) continue
      const ageDays = Math.floor((todayMs - itemMs) / 86_400_000)
      if (ageDays > CLOSE_CHECK.clearingMaxAgeDays) {
        findings.push({
          kind: 'AGED',
          code: b.code,
          name: b.name,
          docNumber: it.docNumber,
          date: dayStr,
          ageDays,
          value: r2(it.value),
          party: it.party,
          label: `${b.code} เอกสาร ${it.docNumber} ค้างนาน ${ageDays} วัน (ตั้งแต่ ${dayStr})`,
        })
      }
    }
  }

  const asOfNote = end < today ? ' (รายการเอกสารตรวจ ณ วันนี้)' : ''
  const hasAged = findings.some(f => f.kind === 'AGED')
  const count = findings.length
  return {
    id: 7,
    key: 'clearing_accounts',
    title: 'บัญชีพัก 1180 / 1181 / 1182 / 2109 / พักรอตรวจสอบ ไม่ค้างเกินเพดานหรือเกินอายุ',
    severity: 'warn',
    status: count > 0 ? 'warn' : 'pass',
    detail: count > 0
      ? `พบบัญชีพักเกินเพดาน/ยอดไม่ตรงเอกสาร${hasAged ? '/ค้างนาน' : ''} ${count} รายการ${asOfNote} — ตรวจสอบและล้างรายการค้างที่หน้ากระทบยอดบัญชีพัก`
      : `บัญชีพักไม่เกินเพดานและไม่มีรายการค้างนาน${asOfNote}`,
    count,
    amount: r2(Math.abs(suspenseBal)),
    link: '/accounting/reconcile',
    daily: false,
    rows: findings.slice(0, 20),
  }
}

/** 8. ยอดลูกหนี้ / เจ้าหนี้ในบัญชี = ยอดรายใบ (aging) */
function checkSubledgerMatch(tenantId: string, end: string): CheckItem {
  const arId = accountIdOf(tenantId, ACC.AR)
  const apId = accountIdOf(tenantId, ACC.AP)
  const arGl = arId ? postedBalance(tenantId, arId, end) : 0
  const apGl = apId ? r2(-postedBalance(tenantId, apId, end)) : 0
  const arDoc = r2(arAging(tenantId, end).totals.outstanding)
  const apDoc = r2(apAging(tenantId, end).totals.outstanding)

  if (Math.abs(arGl) <= ZERO && Math.abs(arDoc) <= ZERO && Math.abs(apGl) <= ZERO && Math.abs(apDoc) <= ZERO) {
    return {
      id: 8,
      key: 'subledger_match',
      title: 'ยอดลูกหนี้ / เจ้าหนี้ในบัญชี = ยอดรายใบ (aging)',
      severity: 'warn',
      status: 'na',
      detail: 'ไม่มียอดลูกหนี้และเจ้าหนี้คงค้าง (ยอดรายใบคำนวณ ณ วันนี้)',
      link: '/accounting/phopy-board?view=receivables',
      daily: false,
    }
  }

  const arDiff = r2(arGl - arDoc)
  const apDiff = r2(apGl - apDoc)
  const rows: Array<Record<string, unknown>> = []
  if (Math.abs(arDiff) > CLOSE_CHECK.ledgerVsDocTolerance) {
    rows.push({ kind: 'AR', code: ACC.AR, name: 'ลูกหนี้การค้า', ledger: arGl, subledger: arDoc, diff: arDiff })
  }
  if (Math.abs(apDiff) > CLOSE_CHECK.ledgerVsDocTolerance) {
    rows.push({ kind: 'AP', code: ACC.AP, name: 'เจ้าหนี้การค้า', ledger: apGl, subledger: apDoc, diff: apDiff })
  }

  const count = rows.length
  const amount = r2(Math.abs(arDiff) + Math.abs(apDiff))
  return {
    id: 8,
    key: 'subledger_match',
    title: 'ยอดลูกหนี้ / เจ้าหนี้ในบัญชี = ยอดรายใบ (aging)',
    severity: 'warn',
    status: count > 0 ? 'warn' : 'pass',
    detail: count > 0
      ? `ยอดลูกหนี้/เจ้าหนี้ในบัญชีต่างจากยอดรายใบ ณ วันนี้ รวม ${baht(amount)} — ตรวจสอบรายการลงบัญชีตรงที่ไม่ผ่านใบแจ้งหนี้หรือใบเสร็จ`
      : 'ยอดลูกหนี้และเจ้าหนี้ในบัญชีตรงกับยอดรายใบ (ยอดรายใบคำนวณ ณ วันนี้)',
    count,
    amount,
    link: '/accounting/phopy-board?view=receivables',
    daily: false,
    rows,
  }
}

/** 9. มูลค่าสต็อกในบัญชีเทียบมูลค่าในระบบ ต่างไม่เกินเกณฑ์ */
function checkStockValue(tenantId: string, end: string): CheckItem {
  const glRow = db.prepare(`
    SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS v
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE ${POSTED_NON_CLOSING} AND a.type = 'ASSET' AND a.category = 'INVENTORY' AND date(je.date) <= ?
  `).get(tenantId, end) as { v: number }
  const gl = r2(glRow.v)

  const subconRow = db.prepare('SELECT COALESCE(SUM(total_value), 0) AS v FROM subcon_stock WHERE tenant_id = ?').get(tenantId) as { v: number }
  const system = r2(totalStockValue(tenantId) + Number(subconRow.v || 0))

  if (Math.abs(gl) <= ZERO && Math.abs(system) <= ZERO) {
    return {
      id: 9,
      key: 'stock_value',
      title: 'มูลค่าสต็อกในบัญชีเทียบมูลค่าในระบบ ต่างไม่เกินเกณฑ์',
      severity: 'warn',
      status: 'na',
      detail: 'ไม่มีมูลค่าสต็อกในบัญชีและในระบบ (มูลค่าในระบบ ณ วันนี้)',
      link: '/stock',
      daily: false,
    }
  }

  const diff = r2(Math.abs(gl - system))
  const threshold = Math.max(CLOSE_CHECK.stockDiffBaht, CLOSE_CHECK.stockDiffRatio * Math.max(Math.abs(gl), Math.abs(system)))
  const failed = diff > threshold
  return {
    id: 9,
    key: 'stock_value',
    title: 'มูลค่าสต็อกในบัญชีเทียบมูลค่าในระบบ ต่างไม่เกินเกณฑ์',
    severity: 'warn',
    status: failed ? 'warn' : 'pass',
    detail: failed
      ? `มูลค่าสต็อกในบัญชี (${baht(gl)}) ต่างจากมูลค่าในระบบ ณ วันนี้ (${baht(system)}) อยู่ ${baht(diff)} เกินเกณฑ์ — ตรวจนับสต็อกและปรับปรุงยอด`
      : `มูลค่าสต็อกในบัญชี (${baht(gl)}) สอดคล้องกับมูลค่าในระบบ ณ วันนี้ (${baht(system)})`,
    count: failed ? 1 : 0,
    amount: diff,
    link: '/stock',
    daily: false,
    rows: failed ? [{ ledger: gl, system, diff: r2(gl - system), threshold: r2(threshold) }] : [],
  }
}

/** 10. ภาษีซื้อ / ภาษีขายในบัญชีตรงทะเบียนภาษี (เฉพาะกิจการที่จด VAT) */
function checkVatMatch(tenantId: string, start: string, end: string): CheckItem {
  const cs = db.prepare('SELECT vat_registered FROM company_settings WHERE tenant_id = ? LIMIT 1').get(tenantId) as { vat_registered: number | null } | undefined
  if (cs && cs.vat_registered === 0) {
    return {
      id: 10,
      key: 'vat_match',
      title: 'ภาษีซื้อ / ภาษีขายในบัญชีตรงทะเบียนภาษี (เฉพาะกิจการที่จด VAT)',
      severity: 'warn',
      status: 'na',
      detail: 'กิจการไม่ได้จด VAT',
      link: '/tax',
      daily: false,
    }
  }

  const glRow = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN a.code = ? THEN jl.debit - jl.credit ELSE 0 END), 0) AS inputGl,
      COALESCE(SUM(CASE WHEN a.code = ? THEN jl.credit - jl.debit ELSE 0 END), 0) AS outputGl
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE ${POSTED_NON_CLOSING} AND date(je.date) BETWEEN ? AND ? AND a.code IN (?, ?)
  `).get(ACC.INPUT_VAT, ACC.OUTPUT_VAT, tenantId, start, end, ACC.INPUT_VAT, ACC.OUTPUT_VAT) as { inputGl: number; outputGl: number }

  const regRow = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN is_input_vat = 1 THEN vat_amount ELSE 0 END), 0) AS inputReg,
      COALESCE(SUM(CASE WHEN is_output_vat = 1 THEN vat_amount ELSE 0 END), 0) AS outputReg
    FROM vat_entries
    WHERE tenant_id = ? AND date(document_date) BETWEEN ? AND ?
  `).get(tenantId, start, end) as { inputReg: number; outputReg: number }

  const inputGl = r2(glRow.inputGl), outputGl = r2(glRow.outputGl)
  const inputReg = r2(regRow.inputReg), outputReg = r2(regRow.outputReg)
  const inputDiff = r2(inputGl - inputReg)
  const outputDiff = r2(outputGl - outputReg)

  const rows: Array<Record<string, unknown>> = []
  if (Math.abs(inputDiff) > CLOSE_CHECK.ledgerVsDocTolerance) {
    rows.push({ kind: 'INPUT_VAT', code: ACC.INPUT_VAT, name: 'ภาษีซื้อ', ledger: inputGl, register: inputReg, diff: inputDiff })
  }
  if (Math.abs(outputDiff) > CLOSE_CHECK.ledgerVsDocTolerance) {
    rows.push({ kind: 'OUTPUT_VAT', code: ACC.OUTPUT_VAT, name: 'ภาษีขาย', ledger: outputGl, register: outputReg, diff: outputDiff })
  }

  const count = rows.length
  const amount = r2(Math.abs(inputDiff) + Math.abs(outputDiff))
  return {
    id: 10,
    key: 'vat_match',
    title: 'ภาษีซื้อ / ภาษีขายในบัญชีตรงทะเบียนภาษี (เฉพาะกิจการที่จด VAT)',
    severity: 'warn',
    status: count > 0 ? 'warn' : 'pass',
    detail: count > 0
      ? `ยอดภาษีซื้อ/ภาษีขายในบัญชีต่างจากทะเบียนภาษี รวม ${baht(amount)} — ตรวจสอบรายการลงบัญชีภาษีโดยตรงที่ไม่ผ่านใบกำกับภาษี`
      : 'ยอดภาษีซื้อและภาษีขายในบัญชีตรงกับทะเบียนภาษี',
    count,
    amount,
    link: '/tax',
    daily: false,
    rows,
  }
}

/** 11. รายการปรับปรุงด้วยมือผิดปกติ */
function checkManualAnomaly(tenantId: string, period: string, start: string, end: string): CheckItem {
  const prev = periodRange(previousPeriod(period))

  const curCount = (db.prepare(`
    SELECT COUNT(*) AS n FROM journal_entries je
    WHERE je.tenant_id = ? AND ${MANUAL_REF_SQL} AND date(je.date) BETWEEN ? AND ?
  `).get(tenantId, start, end) as { n: number }).n

  const prevCount = (db.prepare(`
    SELECT COUNT(*) AS n FROM journal_entries je
    WHERE je.tenant_id = ? AND ${MANUAL_REF_SQL} AND date(je.date) BETWEEN ? AND ?
  `).get(tenantId, prev.start, prev.end) as { n: number }).n

  const rows: Array<Record<string, unknown>> = []

  if (curCount >= CLOSE_CHECK.manualSpikeMinCount && curCount > CLOSE_CHECK.manualSpikeRatio * prevCount) {
    rows.push({
      kind: 'SPIKE',
      count: curCount,
      previousCount: prevCount,
      label: `รายการปรับปรุงด้วยมือสูงผิดปกติ (${curCount} รายการ เทียบงวดก่อน ${prevCount} รายการ)`,
    })
  }

  const selfPosted = db.prepare(`
    SELECT je.entry_number AS entryNumber, je.date AS date, je.created_by AS createdBy, je.posted_by AS postedBy,
           COALESCE(NULLIF(je.total_debit, 0), (SELECT COALESCE(SUM(jl.debit), 0) FROM journal_lines jl WHERE jl.journal_entry_id = je.id), 0) AS total
    FROM journal_entries je
    WHERE je.tenant_id = ? AND je.is_posted = 1 AND ${MANUAL_REF_SQL}
      AND date(je.date) BETWEEN ? AND ?
      AND je.created_by IS NOT NULL AND TRIM(je.created_by) <> ''
      AND je.posted_by IS NOT NULL AND TRIM(je.posted_by) <> ''
      AND lower(TRIM(je.created_by)) = lower(TRIM(je.posted_by))
    ORDER BY je.date ASC, je.entry_number ASC
  `).all(tenantId, start, end) as Array<{ entryNumber: string; date: string; createdBy: string; postedBy: string; total: number }>

  for (const s of selfPosted) {
    rows.push({
      kind: 'SELF_POSTED',
      entryNumber: s.entryNumber,
      date: s.date,
      createdBy: s.createdBy,
      postedBy: s.postedBy,
      total: r2(s.total),
      label: `คนลงรายการและคนยืนยันเป็นคนเดียวกัน: ${s.entryNumber} (${s.createdBy})`,
    })
  }

  const unposts = db.prepare(`
    SELECT entry_number AS entryNumber, entry_date AS entryDate, reason,
           unposted_by AS unpostedBy, unposted_at AS unpostedAt, COALESCE(total_debit, 0) AS totalDebit
    FROM journal_unposts
    WHERE tenant_id = ?
      AND ((entry_date IS NOT NULL AND date(entry_date) BETWEEN ? AND ?)
        OR (unposted_at IS NOT NULL AND date(unposted_at, '+7 hours') BETWEEN ? AND ?))
    ORDER BY unposted_at DESC
  `).all(tenantId, start, end, start, end) as Array<{
    entryNumber: string | null; entryDate: string | null; reason: string; unpostedBy: string; unpostedAt: string; totalDebit: number
  }>

  for (const u of unposts) {
    rows.push({
      kind: 'UNPOST',
      entryNumber: u.entryNumber,
      entryDate: u.entryDate,
      reason: u.reason,
      unpostedBy: u.unpostedBy,
      unpostedAt: u.unpostedAt,
      totalDebit: r2(u.totalDebit),
      label: `มีการถอยรายการ (unpost) ${u.entryNumber || '-'} โดย ${u.unpostedBy}: ${u.reason}`,
    })
  }

  const count = rows.length
  return {
    id: 11,
    key: 'manual_anomaly',
    title: 'รายการปรับปรุงด้วยมือผิดปกติ',
    severity: 'warn',
    status: count > 0 ? 'warn' : 'pass',
    detail: count > 0
      ? `พบจุดสังเกตของรายการปรับปรุงด้วยมือ ${count} รายการ — ทบทวนหลักฐานและเหตุผลของรายการในสมุดรายวัน`
      : 'ไม่พบรายการปรับปรุงด้วยมือที่ผิดปกติในงวดนี้',
    count,
    link: '/accounting/books?tab=journal',
    daily: false,
    rows: rows.slice(0, 20),
  }
}

export function closeChecklist(tenantId: string, period: string): ChecklistResult {
  const { start, end } = periodRange(period)
  const [year, month] = period.split('-').map(Number)
  const tp = db.prepare('SELECT status FROM tax_periods WHERE tenant_id = ? AND year = ? AND month = ?')
    .get(tenantId, year, month) as { status: string } | undefined
  const periodStatus: ChecklistResult['periodStatus'] =
    tp?.status === 'OPEN' || tp?.status === 'CLOSED' || tp?.status === 'FILING' ? tp.status : 'NONE'

  const recons = reconciliationStatus(tenantId, period)

  const items: CheckItem[] = [
    checkTrialBalance(tenantId, end),
    checkBankReconciled(tenantId, period, end, recons),
    checkCashCounted(recons),
    checkNoDrafts(tenantId, start, end),
    checkNoNegativeCash(tenantId, start, end),
    checkNoHeaderBalance(tenantId, end),
    checkClearingAccounts(tenantId, end),
    checkSubledgerMatch(tenantId, end),
    checkStockValue(tenantId, end),
    checkVatMatch(tenantId, start, end),
    checkManualAnomaly(tenantId, period, start, end),
  ]

  const passed = items.filter(i => i.status === 'pass' || i.status === 'na').length
  const blocks = items.filter(i => i.status === 'block').length
  const warns = items.filter(i => i.status === 'warn').length
  const total = 11

  return {
    period,
    start,
    end,
    periodStatus,
    items,
    passed,
    total,
    blocks,
    warns,
    label: `ผ่าน ${passed}/11`,
    canClose: blocks === 0,
  }
}
