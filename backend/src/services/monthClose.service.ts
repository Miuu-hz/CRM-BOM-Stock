import db from '../db/sqlite'
import { ACC } from '../config/accountCodes'

// ─────────────────────────────────────────────────────────────────────────
// ปิดบัญชีรายเดือน — ส่วนกลางที่ทุกชิ้นใช้ร่วมกัน (ด่านตรวจ A3, ชุดปิดเดือน A4, รับรายการปรับปรุง A5, หน้าทบทวน A6)
// "บัญชีเงิน" = บัญชีย่อยหมวด CASH (ไม่ใช่บัญชีหัว) + บัญชีที่ผูกกับ bank_accounts
// ยอดตามบัญชี = รายการที่ post แล้วเท่านั้น (เดบิต − เครดิต) ไม่นับรายการปิดสิ้นปี
// ─────────────────────────────────────────────────────────────────────────

export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/
export const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100
/** ยอดที่ถือว่าเป็นศูนย์ (ครึ่งสตางค์) */
export const ZERO = 0.005

export class MonthCloseError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

/** 'YYYY-MM' → วันแรก/วันสุดท้ายของเดือน (string ล้วน ไม่ผ่าน timezone) */
export function periodRange(period: string): { start: string; end: string } {
  if (!PERIOD_RE.test(period)) throw new MonthCloseError(400, `งวด "${period}" ไม่ถูกต้อง — ใช้รูปแบบ YYYY-MM เช่น 2026-10`)
  const [y, m] = period.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { start: `${period}-01`, end: `${period}-${String(last).padStart(2, '0')}` }
}

/** งวดก่อนหน้า ('2026-01' → '2025-12') */
export function previousPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

export interface MoneyAccount {
  id: string
  code: string
  name: string
  /** BANK = ผูกกับ bank_accounts หรืออยู่ใต้ 1102 · CASH = เงินสด/เงินสดย่อย (กระทบยอดด้วยการนับเงิน) */
  kind: 'BANK' | 'CASH'
  isActive: boolean
  bankName: string | null
  accountNumber: string | null
}

interface AccRow { id: string; code: string; name: string; parent_id: string | null; category: string | null; is_active: number }

/** บัญชีหัว = บัญชีที่มีบัญชีอื่นชี้ parent_id มา (ใช้กฎเดียวกับ trigger trg_journal_lines_no_header) */
export function headerAccountIds(tenantId: string): Set<string> {
  const rows = db.prepare(`SELECT DISTINCT parent_id FROM accounts WHERE tenant_id = ? AND parent_id IS NOT NULL`).all(tenantId) as { parent_id: string }[]
  return new Set(rows.map(r => r.parent_id))
}

export function isHeaderAccount(accountId: string): boolean {
  return !!db.prepare('SELECT 1 FROM accounts WHERE parent_id = ? LIMIT 1').get(accountId)
}

/** บัญชีเงินทั้งหมดของกิจการ (ไม่รวมบัญชีหัว) เรียงตามรหัส */
export function moneyAccounts(tenantId: string): MoneyAccount[] {
  const all = db.prepare(`SELECT id, code, name, parent_id, category, is_active FROM accounts WHERE tenant_id = ?`).all(tenantId) as AccRow[]
  const byId = new Map(all.map(a => [a.id, a]))
  const headers = headerAccountIds(tenantId)
  const banks = db.prepare(`SELECT account_id, bank_name, account_number FROM bank_accounts WHERE tenant_id = ?`).all(tenantId) as
    { account_id: string; bank_name: string; account_number: string }[]
  const bankByAcc = new Map(banks.map(b => [b.account_id, b]))
  // อยู่ใต้ 1102 (ไล่ parent ขึ้นไป) — กิจการที่ไม่ได้ตั้ง bank_accounts ใช้ 1102 ตรง ๆ ก็ยังนับเป็นธนาคาร
  const underBank = (a: AccRow): boolean => {
    for (let cur: AccRow | undefined = a, hops = 0; cur && hops < 10; cur = cur.parent_id ? byId.get(cur.parent_id) : undefined, hops++) {
      if (cur.code === ACC.BANK) return true
    }
    return false
  }
  return all
    .filter(a => !headers.has(a.id) && (a.category === 'CASH' || bankByAcc.has(a.id)))
    .map(a => {
      const bank = bankByAcc.get(a.id)
      return {
        id: a.id, code: a.code, name: a.name,
        kind: (bank || underBank(a) ? 'BANK' : 'CASH') as MoneyAccount['kind'],
        isActive: a.is_active !== 0,
        bankName: bank?.bank_name ?? null,
        accountNumber: bank?.account_number ?? null,
      }
    })
    .sort((x, y) => x.code.localeCompare(y.code))
}

const POSTED = `je.tenant_id = ? AND je.is_posted = 1 AND (je.is_closing_entry IS NULL OR je.is_closing_entry = 0)`

/** ยอดคงเหลือ (เดบิต − เครดิต) ของรายการที่ post แล้ว ถึงวันที่ asOf (รวม) — before = true คือก่อน asOf */
export function postedBalance(tenantId: string, accountId: string, asOf: string, before = false): number {
  const row = db.prepare(`
    SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS v
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE ${POSTED} AND jl.account_id = ? AND date(je.date) ${before ? '<' : '<='} ?
  `).get(tenantId, accountId, asOf) as { v: number }
  return r2(row.v)
}

/** มีรายการ (post แล้วหรือร่าง) ถึงวันที่ asOf ไหม — บัญชีที่ไม่เคยใช้ไม่ต้องกระทบยอด */
export function hasActivity(tenantId: string, accountId: string, asOf: string): boolean {
  return !!db.prepare(`
    SELECT 1 FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.tenant_id = ? AND jl.account_id = ? AND date(je.date) <= ? LIMIT 1
  `).get(tenantId, accountId, asOf)
}

/** สถานะของรายการปรับปรุงที่ยังไม่อยู่ในยอดตามบัญชี (รอ post) */
export const PENDING_STATUSES = ['DRAFT', 'PENDING_APPROVAL'] as const
/** รายการกระทบยอดที่ไม่ลงบัญชี (เงินฝากระหว่างทาง / รายการจ่ายที่ธนาคารยังไม่ตัด) — อธิบายผลต่างอย่างเดียว */
export const TIMING_STATUS = 'NOTED'

export interface ReconStatus {
  accountId: string
  code: string
  name: string
  kind: MoneyAccount['kind']
  bankName: string | null
  accountNumber: string | null
  /** ยอดตามบัญชีสิ้นงวด (post แล้ว) */
  book: number
  /** ผลรวมผลกระทบต่อบัญชีนี้ของรายการปรับปรุงที่ยังรอ post */
  pending: number
  /** รายการระหว่างทาง (ลงบัญชีแล้วแต่ statement ยังไม่มี ณ สิ้นงวด) — ไม่ลงบัญชี ใช้อธิบายผลต่าง */
  timing: number
  /** ยอดตาม statement / เงินที่นับได้ ที่ส่งมาครั้งล่าสุด (null = ยังไม่เคยส่ง) */
  statement: number | null
  statementHash: string | null
  /** statement − (book + pending + timing) · null = ยังไม่เคยส่ง */
  difference: number | null
  reconciled: boolean
  reconciliationId: string | null
  submittedAt: string | null
  submittedBy: string | null
  counts: { draft: number; pendingApproval: number; posted: number; discarded: number; noted: number }
}

/**
 * สถานะกระทบยอดของทุกบัญชีเงินในงวด — คิดสดทุกครั้ง (มีรายการ post เพิ่มหลังส่ง ผลต่างก็เปลี่ยนตาม)
 * บัญชีที่ไม่มีรายการเลยถึงสิ้นงวดและไม่เคยส่ง statement = ไม่ต้องกระทบยอด (ไม่อยู่ในผล)
 */
export function reconciliationStatus(tenantId: string, period: string): ReconStatus[] {
  const { end } = periodRange(period)
  const recons = db.prepare(`SELECT * FROM bank_reconciliations WHERE tenant_id = ? AND period = ?`).all(tenantId, period) as any[]
  const reconByAcc = new Map(recons.map(r => [r.account_id, r]))
  const out: ReconStatus[] = []
  for (const acc of moneyAccounts(tenantId)) {
    const recon = reconByAcc.get(acc.id)
    if (!recon && !hasActivity(tenantId, acc.id, end)) continue
    const book = postedBalance(tenantId, acc.id, end)
    const counts = { draft: 0, pendingApproval: 0, posted: 0, discarded: 0, noted: 0 }
    let pending = 0
    let timing = 0
    if (recon) {
      const rows = db.prepare(`SELECT status, COUNT(*) AS n, COALESCE(SUM(effect), 0) AS eff FROM bank_reconciliation_records
        WHERE tenant_id = ? AND reconciliation_id = ? GROUP BY status`).all(tenantId, recon.id) as { status: string; n: number; eff: number }[]
      for (const r of rows) {
        if (r.status === 'DRAFT') counts.draft = r.n
        else if (r.status === 'PENDING_APPROVAL') counts.pendingApproval = r.n
        else if (r.status === 'POSTED') counts.posted = r.n
        else if (r.status === 'DISCARDED') counts.discarded = r.n
        else if (r.status === TIMING_STATUS) { counts.noted = r.n; timing += Number(r.eff) }
        if ((PENDING_STATUSES as readonly string[]).includes(r.status)) pending += Number(r.eff)
      }
    }
    pending = r2(pending)
    timing = r2(timing)
    const statement = recon ? r2(recon.statement_closing_balance) : null
    const difference = statement === null ? null : r2(statement - (book + pending + timing))
    out.push({
      accountId: acc.id, code: acc.code, name: acc.name, kind: acc.kind, bankName: acc.bankName, accountNumber: acc.accountNumber,
      book, pending, timing, statement, statementHash: recon?.statement_hash ?? null, difference,
      reconciled: difference !== null && Math.abs(difference) <= ZERO,
      reconciliationId: recon?.id ?? null, submittedAt: recon?.updated_at ?? null, submittedBy: recon?.submitted_by_name ?? recon?.submitted_by ?? null,
      counts,
    })
  }
  return out
}
