import db from '../db/sqlite'
import { ACC } from '../config/accountCodes'
import { generateId, formatDocumentNumber } from '../utils/id'
import { closedPeriodLabel, CLOSE_ADJ_REF } from '../routes/journal.routes'
import { reverseSupplierPayment } from '../routes/purchase.routes'
import { getOrCreateAccount, isVatRegistered, isHeaderAccountError } from './accounting.service'
import { recordCustomerPayment, SalesBillingError } from './salesBilling.service'
import { userCan, type PermUser } from './rbac.service'
import { gateOrCreate, recordAutoAction, isGm, type CreateRequestArgs, type GateUser } from './approvalGate.service'
import {
  MonthCloseError, periodRange, moneyAccounts, isHeaderAccount, reconciliationStatus, r2, ZERO, TIMING_STATUS,
  type MoneyAccount, type ReconStatus,
} from './monthClose.service'

// ─────────────────────────────────────────────────────────────────────────
// รายการปรับปรุงปิดเดือน (A5/A6) — AI ของลูกค้าเทียบ statement แล้วส่งกลับทาง MCP · server ไม่อ่าน statement ไม่เรียก AI
// ตรวจครบทุกด่านแล้วเก็บเป็น "ร่าง" เท่านั้น การ post ต้องผ่านคนอนุมัติ (หมวด close_adjust ในระบบอนุมัติเดิม)
// ประเภทที่มีเอกสารต้นทาง (รับชำระใบแจ้งหนี้ขาย / ใบจ่ายเงินผู้ขายที่ลงซ้ำ) ไม่สร้าง JV ลอย — ตอนอนุมัติเรียก service เดิม
// ─────────────────────────────────────────────────────────────────────────

export const MAX_LINES = 200

/** 12 ประเภทปรับปรุง + TIMING (รายการกระทบยอดที่ไม่ลงบัญชี) — ตาราง 4 ของสเปกปิดบัญชีรายเดือน */
export const ADJ_TYPES = {
  MISSING_EXPENSE: { label: 'รายจ่ายที่ไม่ได้ลง', debit: 'account_code (ค่าใช้จ่าย 52xx/53xx/54xx)', credit: 'บัญชีที่กระทบยอด', needs: ['account_code'], note: 'มีใบเสร็จหรือใบรับรองแทนใบเสร็จรับเงิน · ห้ามลงภาษีซื้อ 1110 (ไม่มีใบกำกับเต็มรูป)' },
  BANK_FEE: { label: 'ค่าธรรมเนียมธนาคาร', debit: ACC.BANK_CHARGE, credit: 'บัญชีที่กระทบยอด', needs: [], note: 'อ้างบรรทัดใน statement' },
  INTEREST_INCOME: { label: 'ดอกเบี้ยรับ', debit: 'บัญชีที่กระทบยอด', credit: ACC.INTEREST_INCOME, needs: [], note: 'ถ้าธนาคารหักภาษี ณ ที่จ่าย ให้ผู้ทำบัญชีลงส่วนนั้นเพิ่ม' },
  WRONG_CHANNEL: { label: 'ลงช่องทางผิด', debit: 'ย้ายยอดจากบัญชีของ ref_line_id', credit: 'ไป account_code (ไม่ระบุ = บัญชีที่กระทบยอด)', needs: ['ref_line_id'], note: 'เช่น โอนจริงแต่ลงเงินสด · บัญชีต้นทางหรือปลายทางต้องเป็นบัญชีที่กระทบยอด' },
  WRONG_ACCOUNT: { label: 'ลงบัญชีหัวแทนบัญชีย่อย', debit: 'ย้ายยอดจากบัญชีหัวของ ref_line_id', credit: 'ไปบัญชีย่อย account_code (= บัญชีที่กระทบยอด)', needs: ['ref_line_id', 'account_code'], note: 'เช่น 1102 → 1102-01 · ส่งทีละ line_id ของรายการเดิม' },
  OWNER_PERSONAL: { label: 'เงินร้านจ่ายเรื่องส่วนตัว', debit: `${ACC.OWNER_DRAWINGS} ถอนใช้ส่วนตัว (บุคคลธรรมดา) / ${ACC.DIRECTOR_LOAN} เงินให้กู้ยืมกรรมการ (หจก./บจก.)`, credit: 'บัญชีที่กระทบยอด', needs: [], note: 'ม.65 ตรี (3) · ระบบเลือกบัญชีตามรูปแบบกิจการเอง' },
  OWNER_PAID: { label: 'เจ้าของควักจ่ายแทนร้าน', debit: 'account_code (ค่าใช้จ่าย) หรือบัญชีเงินของ ref_line_id (รายการจ่ายเดิมที่จริงเจ้าของจ่าย)', credit: `${ACC.OWNER_ADVANCE} เงินทดรองจากเจ้าของ (หรือ counter_account_code = ${ACC.CAPITAL} ทุน)`, needs: ['account_code หรือ ref_line_id'], note: 'มีใบเสร็จ · ถ้าเป็นการจ่ายใบแจ้งหนี้ซื้อที่ลงเป็นเงินร้านไว้ ให้อ้าง ref_line_id ของรายการจ่ายนั้น' },
  OWNER_CAPITAL: { label: 'เจ้าของโอนเงินเข้าร้าน', debit: 'บัญชีที่กระทบยอด', credit: `${ACC.CAPITAL} ทุน (บุคคลธรรมดา) / ${ACC.OWNER_ADVANCE} เงินกู้ยืมจากกรรมการ (หจก./บจก.) หรือเลือกด้วย counter_account_code`, needs: [], note: 'เจ้าของยืนยันว่าเป็นเงินลงทุนหรือเงินให้ยืม' },
  UNRECORDED_RECEIPT: { label: 'เงินเข้าที่ไม่ได้ลง', debit: 'บัญชีที่กระทบยอด', credit: 'invoice_id → รับชำระใบแจ้งหนี้ขาย (บริการรับชำระเดิม) · ไม่มีใบ → account_code รายได้ 4xxx', needs: ['invoice_id หรือ account_code'], note: 'ต้องให้คนยืนยันทุกรายการ · ถ้าจด VAT ต้องออกใบกำกับตามวันที่รับเงินหรือส่งมอบ' },
  DUPLICATE: { label: 'ลงซ้ำ', debit: 'กลับรายการเดิมทั้งใบ', credit: '', needs: ['ref_line_id'], note: 'บันทึกเอง = กลับรายการ · ใบจ่ายเงินผู้ขาย = ยกเลิกใบจ่ายด้วยบริการเดิม · เอกสารอื่นยกเลิกที่หน้าเว็บ' },
  CASH_COUNT_DIFF: { label: 'เงินสดนับจริงไม่ตรง', debit: `${ACC.CASH_OVER_SHORT} เงินขาด/เงินเกิน คู่กับบัญชีเงินสด`, credit: '', needs: ['direction'], note: 'ใช้กับบัญชีเงินสด (ไม่ใช่ธนาคาร) · direction OUT = เงินขาด, IN = เงินเกิน' },
  UNIDENTIFIED: { label: 'หาที่มาไม่ได้', debit: `${ACC.SUSPENSE} บัญชีพักรอตรวจสอบ คู่กับบัญชีที่กระทบยอด`, credit: '', needs: ['direction'], note: 'ต้องล้างภายในเดือนถัดไป · ปิดงวดได้ถ้ารวมไม่เกินเพดาน (500 บาท)' },
  TIMING: { label: 'รายการระหว่างทาง (ไม่ลงบัญชี)', debit: 'ไม่ลงบัญชี', credit: '', needs: ['ref_line_id'], note: 'ลงบัญชีแล้วแต่ statement ยังไม่มี ณ สิ้นงวด (เงินฝากระหว่างทาง / รายการจ่ายที่ธนาคารยังไม่ตัด) — ใช้อธิบายผลต่างเท่านั้น' },
} as const

export type AdjType = keyof typeof ADJ_TYPES
const TYPE_NAMES = Object.keys(ADJ_TYPES) as AdjType[]

export interface SubmitLine {
  type: string
  date: string
  amount: number
  statement_ref?: string
  statement_line_no?: number
  description?: string
  account_code?: string
  counter_account_code?: string
  ref_line_id?: string
  invoice_id?: string
  direction?: string
  reason?: string
  confidence?: number
}

export interface SubmitInput {
  period: string
  bank_account_code: string
  statement_closing_balance: number
  statement_hash?: string
  lines: SubmitLine[]
}

export interface Actor extends PermUser {
  userId: string
  name: string
  email: string
}

export interface LineResult {
  index: number
  statement_line_no: number | null
  type: string
  status: 'accepted' | 'duplicate' | 'rejected' | 'not_saved'
  errors?: string[]
  warnings?: string[]
  record_id?: string
  entry_number?: string | null
  effect?: number
}

interface Leg { accountId: string; debit: number; credit: number }
interface Plan {
  legs: Leg[]
  effect: number
  status: 'DRAFT' | typeof TIMING_STATUS
  sourceDocType?: 'INVOICE' | 'SUPPLIER_PAYMENT_VOID'
  sourceDocId?: string
  warnings: string[]
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MANUAL_REFS = new Set(['MANUAL', 'ADJUSTMENT'])
const twoDecimals = (n: number) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6

/** ใครส่งรายการปรับปรุงได้: MASTER/ADMIN หรือมีสิทธิ์เขียนหมวดบัญชี — แคชเชียร์/ผู้ใช้พื้นฐานไม่ได้ */
export function canSubmitAdjustments(actor: PermUser): boolean {
  return actor.role === 'MASTER' || actor.role === 'ADMIN' || userCan(actor, 'accounting', 'write')
}

interface AccRow { id: string; code: string; name: string; type: string; category: string | null; parent_id: string | null; is_active: number; normal_balance: string }
const accByCode = (t: string, code: string) =>
  db.prepare('SELECT id, code, name, type, category, parent_id, is_active, normal_balance FROM accounts WHERE tenant_id = ? AND code = ?').get(t, code) as AccRow | undefined
const accById = (t: string, id: string) =>
  db.prepare('SELECT id, code, name, type, category, parent_id, is_active, normal_balance FROM accounts WHERE tenant_id = ? AND id = ?').get(t, id) as AccRow | undefined

/** ค่าใช้จ่ายที่ AI เลือกได้: บัญชีย่อยค่าใช้จ่ายในการขาย/บริหาร/อื่น (52xx 53xx 54xx) — ไม่รวมต้นทุนขายและ 59xx ของระบบ */
const isAllowedExpense = (a: AccRow) => a.type === 'EXPENSE' && /^5[234]/.test(a.code) && a.is_active !== 0 && !isHeaderAccount(a.id)
/** รายได้ที่ AI เลือกได้: บัญชีย่อยรายได้ปกติ (ไม่ใช่ส่วนลด/รับคืน 43xx) */
const isAllowedRevenue = (a: AccRow) => a.type === 'REVENUE' && a.normal_balance === 'CREDIT' && !a.code.startsWith('43') && a.is_active !== 0 && !isHeaderAccount(a.id)

export function allowedExpenseCodes(t: string): string[] {
  return (db.prepare(`SELECT id, code, name, type, category, parent_id, is_active, normal_balance FROM accounts WHERE tenant_id = ? AND type = 'EXPENSE' ORDER BY code`).all(t) as AccRow[])
    .filter(isAllowedExpense).map(a => a.code)
}
export function allowedRevenueCodes(t: string): string[] {
  return (db.prepare(`SELECT id, code, name, type, category, parent_id, is_active, normal_balance FROM accounts WHERE tenant_id = ? AND type = 'REVENUE' ORDER BY code`).all(t) as AccRow[])
    .filter(isAllowedRevenue).map(a => a.code)
}

interface RefLine {
  id: string; account_id: string; debit: number; credit: number
  je_id: string; entry_number: string; date: string; is_posted: number; is_auto_generated: number
  reference_type: string | null; reference_id: string | null; code: string
}
function refLine(t: string, id: string): RefLine | undefined {
  return db.prepare(`
    SELECT jl.id, jl.account_id, jl.debit, jl.credit, je.id AS je_id, je.entry_number, je.date, je.is_posted,
      je.is_auto_generated, je.reference_type, je.reference_id, a.code
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id JOIN accounts a ON a.id = jl.account_id
    WHERE jl.id = ? AND jl.tenant_id = ? AND je.tenant_id = ?
  `).get(id, t, t) as RefLine | undefined
}

/** ยอดที่ถูกใช้แก้ line นี้ไปแล้ว (รายการที่ยังไม่ทิ้ง) — กันสองบรรทัดใน statement มาแก้รายการเดิมซ้ำ */
function usedOnRef(t: string, refId: string): number {
  const row = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS v FROM bank_reconciliation_records
    WHERE tenant_id = ? AND ref_line_id = ? AND status <> 'DISCARDED' AND type <> 'TIMING'`).get(t, refId) as { v: number }
  return r2(row.v)
}

interface Ctx {
  t: string
  period: string
  start: string
  end: string
  bank: MoneyAccount
  money: Map<string, MoneyAccount>
  entityType: 'INDIVIDUAL' | 'PARTNERSHIP' | 'COMPANY' | null
  vatRegistered: boolean
  /** ยอดที่บรรทัดก่อนหน้าในชุดเดียวกันใช้แก้ ref line ไปแล้ว */
  batchRefUse: Map<string, number>
  /** ref_line_id ที่บรรทัดก่อนหน้าในชุดเดียวกันระบุเป็น TIMING ไปแล้ว */
  batchTimingRefs: Set<string>
  /** ยอดรับชำระใบแจ้งหนี้ขายที่บรรทัดก่อนหน้าในชุดเดียวกันจองไว้แล้ว */
  batchInvUse: Map<string, number>
}

const ENTITY_REQUIRED = 'ตั้งรูปแบบกิจการที่ ตั้งค่า > ข้อมูลบริษัท ก่อน (บุคคลธรรมดา / หจก. / บจก.) — ระบบต้องรู้ว่าจะลงเงินของเจ้าของเข้าบัญชีไหน'

/** ย้ายยอดตามทิศของรายการเดิม: s = เครื่องหมายของ (เดบิต − เครดิต) ของ ref line */
function moveLegs(fromId: string, toId: string, s: number, amt: number): Leg[] {
  return s < 0
    ? [{ accountId: fromId, debit: amt, credit: 0 }, { accountId: toId, debit: 0, credit: amt }]
    : [{ accountId: fromId, debit: 0, credit: amt }, { accountId: toId, debit: amt, credit: 0 }]
}

const effectOn = (legs: Leg[], accountId: string) => r2(legs.filter(l => l.accountId === accountId).reduce((s, l) => s + l.debit - l.credit, 0))

/** ตรวจ ref_line_id ร่วม: มีจริงใน tenant, post แล้ว, ไม่เกินยอดเดิมเมื่อรวมกับที่แก้ไปแล้ว */
function checkRef(ctx: Ctx, line: SubmitLine, amt: number, errors: string[], opts: { capped: boolean }): RefLine | null {
  if (!line.ref_line_id) { errors.push('ต้องระบุ ref_line_id (lineId ของรายการเดิมจาก get_close_pack)'); return null }
  const ref = refLine(ctx.t, line.ref_line_id)
  if (!ref) { errors.push(`ไม่พบ ref_line_id ${line.ref_line_id} ในกิจการนี้ — ใช้ lineId จาก get_close_pack`); return null }
  if (!ref.is_posted) { errors.push(`รายการเดิม ${ref.entry_number} ยังเป็นร่าง — แก้ร่างนั้นตรง ๆ ในสมุดรายวัน ไม่ต้องส่งรายการปรับปรุง`); return null }
  if (String(ref.date).substring(0, 10) > ctx.end) { errors.push(`รายการเดิม ${ref.entry_number} ลงวันที่หลังสิ้นงวด ${ctx.end}`); return null }
  const d = r2(ref.debit - ref.credit)
  if (Math.abs(d) < ZERO) { errors.push(`รายการเดิม ${ref.entry_number} บรรทัดนี้ไม่มียอด`); return null }
  if (opts.capped) {
    const used = r2(usedOnRef(ctx.t, ref.id) + (ctx.batchRefUse.get(ref.id) || 0))
    if (amt > Math.abs(d) - used + ZERO) {
      errors.push(`ยอดแก้รวมเกินยอดรายการเดิม ${ref.entry_number} (เดิม ฿${Math.abs(d).toLocaleString()} แก้ไปแล้ว ฿${used.toLocaleString()})`)
      return null
    }
  }
  return ref
}

/** ตรวจบรรทัดเดียว → แผนลงบัญชี หรือรายการข้อผิดพลาด (ข้อความไทย + วิธีแก้) */
function planLine(ctx: Ctx, line: SubmitLine): { plan?: Plan; errors: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  const B = ctx.bank.id
  const type = String(line.type || '').toUpperCase() as AdjType
  const amt = Number(line.amount)

  if (!TYPE_NAMES.includes(type)) errors.push(`ประเภท "${line.type}" ไม่อยู่ในรายการที่รับ — ใช้ได้เฉพาะ: ${TYPE_NAMES.join(', ')}`)
  if (!line.date || !DATE_RE.test(line.date)) errors.push('date ต้องเป็น YYYY-MM-DD')
  else if (line.date < ctx.start || line.date > ctx.end) errors.push(`วันที่ ${line.date} อยู่นอกงวด ${ctx.period} (${ctx.start} ถึง ${ctx.end})`)
  if (!Number.isFinite(amt) || amt <= 0) errors.push('amount ต้องเป็นตัวเลขมากกว่า 0 (ทิศทางเงินบอกด้วยประเภทหรือ direction ไม่ใช่เครื่องหมายลบ)')
  else if (!twoDecimals(amt)) errors.push('amount มีทศนิยมได้ไม่เกิน 2 ตำแหน่ง')
  if (!line.statement_ref || !String(line.statement_ref).trim()) errors.push('ต้องระบุ statement_ref (เลขอ้างอิงในบรรทัด statement เช่นเลขรายการ/เวลา) — รายการนับเงินสดใช้เช่น "นับเงิน 31/10"')
  if (!Number.isInteger(line.statement_line_no) || (line.statement_line_no as number) < 0) errors.push('ต้องระบุ statement_line_no เป็นเลขลำดับบรรทัดใน statement (จำนวนเต็ม ≥ 0)')
  if (!line.description || !String(line.description).trim()) errors.push('ต้องมี description อธิบายรายการ')
  if (!line.reason || String(line.reason).trim().length < 3) errors.push('ต้องมี reason ว่าทำไมจัดเป็นประเภทนี้ (เก็บเป็นร่องรอยการตรวจสอบ)')
  if (line.confidence !== undefined && line.confidence !== null && !(Number(line.confidence) >= 0 && Number(line.confidence) <= 1)) {
    errors.push('confidence ต้องอยู่ระหว่าง 0 ถึง 1 (เช่น 0.9)')
  }
  if (errors.length) return { errors }

  const needAccount = (code: string | undefined, label: string): AccRow | null => {
    if (!code) { errors.push(`ต้องระบุ ${label}`); return null }
    const a = accByCode(ctx.t, String(code).trim())
    if (!a) { errors.push(`ไม่พบบัญชี ${code} — ใช้รหัสจากผังบัญชีใน get_close_pack`); return null }
    if (a.is_active === 0) { errors.push(`บัญชี ${a.code} ปิดใช้งานอยู่`); return null }
    if (isHeaderAccount(a.id)) { errors.push(`บัญชี ${a.code} ${a.name} เป็นบัญชีหัว (มีบัญชีย่อย) — เลือกบัญชีย่อยแทน`); return null }
    return a
  }
  const needEntity = () => { if (!ctx.entityType) errors.push(ENTITY_REQUIRED); return !!ctx.entityType }
  const counterOf = (fallback: string): AccRow | null => {
    const code = line.counter_account_code ? String(line.counter_account_code).trim() : fallback
    if (code !== ACC.OWNER_ADVANCE && code !== ACC.CAPITAL) {
      errors.push(`counter_account_code ใช้ได้เฉพาะ ${ACC.OWNER_ADVANCE} (เงินทดรอง/เงินกู้ยืมจากเจ้าของ) หรือ ${ACC.CAPITAL} (ทุน)`)
      return null
    }
    return needAccount(code, 'counter_account_code')
  }
  const fixed = (code: string) => getOrCreateAccount(ctx.t, code)
  const dir = String(line.direction || '').toUpperCase()

  let legs: Leg[] = []
  let sourceDocType: Plan['sourceDocType']
  let sourceDocId: string | undefined
  let effect: number | null = null
  let status: Plan['status'] = 'DRAFT'

  switch (type) {
    case 'MISSING_EXPENSE': {
      const a = needAccount(line.account_code, 'account_code (บัญชีค่าใช้จ่าย)')
      if (a && !isAllowedExpense(a)) errors.push(`บัญชี ${a.code} ใช้กับรายจ่ายที่ไม่ได้ลงไม่ได้ — เลือกค่าใช้จ่าย 52xx/53xx/54xx (ห้ามภาษีซื้อ 1110 และต้นทุนขาย)`)
      if (a && !errors.length) legs = [{ accountId: a.id, debit: amt, credit: 0 }, { accountId: B, debit: 0, credit: amt }]
      break
    }
    case 'BANK_FEE':
      if (line.account_code && line.account_code !== ACC.BANK_CHARGE) errors.push(`ค่าธรรมเนียมธนาคารลงบัญชี ${ACC.BANK_CHARGE} เสมอ — ไม่ต้องส่ง account_code`)
      else legs = [{ accountId: fixed(ACC.BANK_CHARGE), debit: amt, credit: 0 }, { accountId: B, debit: 0, credit: amt }]
      break
    case 'INTEREST_INCOME':
      if (line.account_code && line.account_code !== ACC.INTEREST_INCOME) errors.push(`ดอกเบี้ยรับลงบัญชี ${ACC.INTEREST_INCOME} เสมอ — ไม่ต้องส่ง account_code`)
      else legs = [{ accountId: B, debit: amt, credit: 0 }, { accountId: fixed(ACC.INTEREST_INCOME), debit: 0, credit: amt }]
      break
    case 'WRONG_CHANNEL': {
      const ref = checkRef(ctx, line, amt, errors, { capped: true })
      if (!ref) break
      if (!ctx.money.has(ref.account_id)) { errors.push(`รายการเดิมไม่ได้ลงบัญชีเงินสด/ธนาคาร (${ref.code}) — ถ้าเป็นบัญชีหัวให้ใช้ WRONG_ACCOUNT`); break }
      const to = line.account_code ? needAccount(line.account_code, 'account_code') : accById(ctx.t, B)!
      if (!to) break
      if (!ctx.money.has(to.id)) { errors.push(`ปลายทาง ${to.code} ไม่ใช่บัญชีเงินสด/ธนาคาร`); break }
      if (to.id === ref.account_id) { errors.push('บัญชีต้นทางกับปลายทางเป็นบัญชีเดียวกัน'); break }
      if (to.id !== B && ref.account_id !== B) { errors.push(`รายการนี้ไม่เกี่ยวกับบัญชี ${ctx.bank.code} ที่กำลังกระทบยอด — ส่งในรอบกระทบยอดของบัญชีที่เกี่ยวข้อง`); break }
      legs = moveLegs(ref.account_id, to.id, Math.sign(ref.debit - ref.credit), amt)
      ctx.batchRefUse.set(ref.id, (ctx.batchRefUse.get(ref.id) || 0) + amt)
      break
    }
    case 'WRONG_ACCOUNT': {
      const ref = checkRef(ctx, line, amt, errors, { capped: true })
      if (!ref) break
      if (!isHeaderAccount(ref.account_id)) { errors.push(`รายการเดิมลงบัญชี ${ref.code} ซึ่งไม่ใช่บัญชีหัว — ถ้าลงผิดช่องทางให้ใช้ WRONG_CHANNEL`); break }
      const to = line.account_code ? needAccount(line.account_code, 'account_code (บัญชีย่อยที่ถูก)') : accById(ctx.t, B)!
      if (!to) break
      if (to.parent_id !== ref.account_id) { errors.push(`บัญชี ${to.code} ไม่ใช่บัญชีย่อยของ ${ref.code}`); break }
      if (to.id !== B) { errors.push(`ย้ายยอดเข้า ${to.code} ให้ส่งในรอบกระทบยอดของบัญชี ${to.code} (ตอนนี้กำลังกระทบยอด ${ctx.bank.code})`); break }
      legs = moveLegs(ref.account_id, to.id, Math.sign(ref.debit - ref.credit), amt)
      ctx.batchRefUse.set(ref.id, (ctx.batchRefUse.get(ref.id) || 0) + amt)
      break
    }
    case 'OWNER_PERSONAL': {
      if (!needEntity()) break
      const code = ctx.entityType === 'INDIVIDUAL' ? ACC.OWNER_DRAWINGS : ACC.DIRECTOR_LOAN
      legs = [{ accountId: fixed(code), debit: amt, credit: 0 }, { accountId: B, debit: 0, credit: amt }]
      if (ctx.entityType !== 'INDIVIDUAL') warnings.push(`ลงเป็นเงินให้กู้ยืมกรรมการ (${ACC.DIRECTOR_LOAN}) — สรรพากรประเมินดอกเบี้ยได้ (ม.65 ทวิ (4)) ควรล้างยอดก่อนสิ้นปี`)
      break
    }
    case 'OWNER_PAID': {
      if (!needEntity()) break
      const counter = counterOf(ACC.OWNER_ADVANCE)
      if (!counter) break
      if (line.ref_line_id) {
        const ref = checkRef(ctx, line, amt, errors, { capped: true })
        if (!ref) break
        if (!ctx.money.has(ref.account_id)) { errors.push(`รายการเดิมไม่ได้จ่ายจากบัญชีเงินสด/ธนาคาร (${ref.code})`); break }
        if (ref.debit - ref.credit >= 0) { errors.push(`รายการเดิม ${ref.entry_number} ไม่ใช่เงินออก — อ้าง line ฝั่งที่เงินออกจากร้าน`); break }
        legs = [{ accountId: ref.account_id, debit: amt, credit: 0 }, { accountId: counter.id, debit: 0, credit: amt }]
        ctx.batchRefUse.set(ref.id, (ctx.batchRefUse.get(ref.id) || 0) + amt)
      } else {
        const a = needAccount(line.account_code, 'account_code (ค่าใช้จ่ายที่เจ้าของจ่ายแทน) หรือ ref_line_id (รายการจ่ายเดิม)')
        if (a && !isAllowedExpense(a)) { errors.push(`บัญชี ${a.code} ใช้ไม่ได้ — เลือกค่าใช้จ่าย 52xx/53xx/54xx`); break }
        if (a) legs = [{ accountId: a.id, debit: amt, credit: 0 }, { accountId: counter.id, debit: 0, credit: amt }]
      }
      break
    }
    case 'OWNER_CAPITAL': {
      if (!needEntity()) break
      const counter = counterOf(ctx.entityType === 'INDIVIDUAL' ? ACC.CAPITAL : ACC.OWNER_ADVANCE)
      if (counter) legs = [{ accountId: B, debit: amt, credit: 0 }, { accountId: counter.id, debit: 0, credit: amt }]
      break
    }
    case 'UNRECORDED_RECEIPT': {
      if (line.invoice_id) {
        const inv = db.prepare(`SELECT id, invoice_number, status, balance_amount FROM invoices WHERE tenant_id = ? AND (id = ? OR invoice_number = ?)`)
          .get(ctx.t, line.invoice_id, line.invoice_id) as any
        if (!inv) { errors.push(`ไม่พบใบแจ้งหนี้ขาย ${line.invoice_id} — ใช้ id/เลขที่จาก openInvoices.sales ใน get_close_pack`); break }
        if (inv.status === 'CANCELLED' || inv.status === 'DRAFT') { errors.push(`ใบแจ้งหนี้ ${inv.invoice_number} สถานะ ${inv.status} รับชำระไม่ได้`); break }
        const usedInv = r2(((db.prepare(`SELECT COALESCE(SUM(amount), 0) AS v FROM bank_reconciliation_records
          WHERE tenant_id = ? AND source_doc_type = 'INVOICE' AND source_doc_id = ? AND status IN ('DRAFT', 'PENDING_APPROVAL')`).get(ctx.t, inv.id) as { v: number })?.v || 0)
          + (ctx.batchInvUse.get(inv.id) || 0))
        if (amt > Number(inv.balance_amount) - usedInv + ZERO) {
          errors.push(`ยอด ${amt} เกินยอดค้างของ ${inv.invoice_number} (฿${Number(inv.balance_amount).toLocaleString()}${usedInv > 0 ? ` รอรับชำระในร่างอีก ฿${usedInv.toLocaleString()}` : ''})`)
          break
        }
        if (!receiptChannel(ctx.t, ctx.bank)) { errors.push(`บัญชี ${ctx.bank.code} รับชำระใบแจ้งหนี้ผ่านระบบไม่ได้ — ผูกบัญชีนี้ใน ตั้งค่า > บัญชีธนาคาร ก่อน`); break }
        sourceDocType = 'INVOICE'
        sourceDocId = inv.id
        effect = amt
        ctx.batchInvUse.set(inv.id, (ctx.batchInvUse.get(inv.id) || 0) + amt)
      } else {
        const a = needAccount(line.account_code, 'invoice_id (ถ้ามีใบแจ้งหนี้) หรือ account_code (บัญชีรายได้)')
        if (a && !isAllowedRevenue(a)) { errors.push(`บัญชี ${a.code} ใช้ไม่ได้ — เลือกบัญชีรายได้ 4xxx (ไม่ใช่ส่วนลด/รับคืน)`); break }
        if (a) legs = [{ accountId: B, debit: amt, credit: 0 }, { accountId: a.id, debit: 0, credit: amt }]
        if (ctx.vatRegistered) warnings.push('กิจการจด VAT: ถ้าเป็นการขายต้องออกใบกำกับภาษีตามวันรับเงิน/ส่งมอบ — ออกใบแจ้งหนี้ในหน้าขายแล้วส่งใหม่พร้อม invoice_id จะถูกต้องกว่า')
      }
      warnings.push('ต้องให้คนยืนยันรายการเงินเข้าทุกรายการก่อนอนุมัติ')
      break
    }
    case 'DUPLICATE': {
      const ref = checkRef(ctx, line, amt, errors, { capped: true })
      if (!ref) break
      if (ref.account_id !== B) { errors.push(`รายการซ้ำต้องอ้าง line ของบัญชี ${ctx.bank.code} ที่กำลังกระทบยอด`); break }
      if (Math.abs(amt - Math.abs(ref.debit - ref.credit)) > ZERO) { errors.push('ลงซ้ำต้องกลับรายการเดิมเต็มจำนวน — amount ต้องเท่ากับยอดของ line เดิม'); break }
      const refType = ref.reference_type || 'MANUAL'
      if (db.prepare(`SELECT 1 FROM journal_entries WHERE tenant_id = ? AND reference_type = 'REVERSAL' AND reference_id = ?`).get(ctx.t, ref.je_id)) {
        errors.push(`${ref.entry_number} ถูกกลับรายการไปแล้ว`); break
      }
      if (refType === 'SUPPLIER_PAYMENT') {
        const pay = db.prepare('SELECT id, payment_number, status FROM supplier_payments WHERE id = ? AND tenant_id = ?').get(ref.reference_id, ctx.t) as any
        if (!pay || pay.status === 'CANCELLED') { errors.push(`ใบจ่ายเงินของ ${ref.entry_number} ไม่พบหรือถูกยกเลิกแล้ว`); break }
        sourceDocType = 'SUPPLIER_PAYMENT_VOID'
        sourceDocId = pay.id
        const lines = db.prepare('SELECT account_id, debit, credit FROM journal_lines WHERE journal_entry_id = ? AND tenant_id = ?').all(ref.je_id, ctx.t) as Leg[]
        effect = -effectOn(lines.map(l => ({ accountId: (l as any).account_id, debit: l.debit, credit: l.credit })), B)
      } else if (!ref.is_auto_generated && (MANUAL_REFS.has(refType))) {
        const lines = db.prepare('SELECT account_id, debit, credit FROM journal_lines WHERE journal_entry_id = ? AND tenant_id = ?').all(ref.je_id, ctx.t) as any[]
        legs = lines.map(l => ({ accountId: l.account_id, debit: r2(l.credit), credit: r2(l.debit) }))
      } else {
        errors.push(`รายการ ${ref.entry_number} มาจากเอกสาร (${refType}) — ยกเลิกเอกสารนั้นที่หน้าเว็บ ระบบจะกลับรายการบัญชีให้เอง (ไม่ใช้ DUPLICATE)`)
      }
      if (!errors.length) ctx.batchRefUse.set(ref.id, (ctx.batchRefUse.get(ref.id) || 0) + amt)
      break
    }
    case 'CASH_COUNT_DIFF': {
      if (ctx.bank.kind !== 'CASH') { errors.push(`ผลต่างเงินสดนับจริงใช้กับบัญชีเงินสดเท่านั้น (${ctx.bank.code} เป็นบัญชีธนาคาร)`); break }
      if (dir !== 'IN' && dir !== 'OUT') { errors.push('ต้องระบุ direction: OUT = เงินขาด (นับได้น้อยกว่าบัญชี), IN = เงินเกิน'); break }
      const os = fixed(ACC.CASH_OVER_SHORT)
      legs = dir === 'OUT'
        ? [{ accountId: os, debit: amt, credit: 0 }, { accountId: B, debit: 0, credit: amt }]
        : [{ accountId: B, debit: amt, credit: 0 }, { accountId: os, debit: 0, credit: amt }]
      break
    }
    case 'UNIDENTIFIED': {
      if (dir !== 'IN' && dir !== 'OUT') { errors.push('ต้องระบุ direction: IN = เงินเข้าที่หาที่มาไม่ได้, OUT = เงินออกที่หาที่มาไม่ได้'); break }
      const susp = fixed(ACC.SUSPENSE)
      legs = dir === 'IN'
        ? [{ accountId: B, debit: amt, credit: 0 }, { accountId: susp, debit: 0, credit: amt }]
        : [{ accountId: susp, debit: amt, credit: 0 }, { accountId: B, debit: 0, credit: amt }]
      warnings.push('ต้องล้างบัญชีพักรอตรวจสอบภายในเดือนถัดไป')
      break
    }
    case 'TIMING': {
      const ref = checkRef(ctx, line, amt, errors, { capped: false })
      if (!ref) break
      if (ref.account_id !== B) { errors.push(`รายการระหว่างทางต้องเป็น line ของบัญชี ${ctx.bank.code}`); break }
      const d = r2(ref.debit - ref.credit)
      if (Math.abs(amt - Math.abs(d)) > ZERO) { errors.push('amount ต้องเท่ากับยอดของ line เดิม'); break }
      const noted = db.prepare(`SELECT 1 FROM bank_reconciliation_records r JOIN bank_reconciliations b ON b.id = r.reconciliation_id
        WHERE r.tenant_id = ? AND r.ref_line_id = ? AND r.type = 'TIMING' AND r.status = ? AND b.period = ?`).get(ctx.t, ref.id, TIMING_STATUS, ctx.period)
      if (noted || ctx.batchTimingRefs.has(ref.id)) { errors.push(`${ref.entry_number} ถูกระบุเป็นรายการระหว่างทางของงวดนี้ไปแล้ว`); break }
      ctx.batchTimingRefs.add(ref.id)
      status = TIMING_STATUS
      effect = -d
      break
    }
  }
  if (errors.length) return { errors }

  if (legs.length) {
    const dr = r2(legs.reduce((s, l) => s + l.debit, 0))
    const cr = r2(legs.reduce((s, l) => s + l.credit, 0))
    if (Math.abs(dr - cr) > ZERO || dr <= 0) return { errors: [`ระบบสร้างคู่บัญชีไม่ดุล (เดบิต ${dr} เครดิต ${cr}) — แจ้งผู้ดูแลระบบ`] }
    effect = effectOn(legs, B)
  }
  return { plan: { legs, effect: r2(effect ?? 0), status, sourceDocType, sourceDocId, warnings }, errors }
}

/** ช่องทางรับชำระของบัญชีที่กระทบยอด — คืน null ถ้าบริการรับชำระเดิมลงบัญชีอื่น (จะทำให้สมการไม่ตรง) */
function receiptChannel(t: string, bank: MoneyAccount): { paymentMethod: string; bankAccountId: string | null } | null {
  const linked = db.prepare('SELECT id FROM bank_accounts WHERE tenant_id = ? AND account_id = ? AND is_active = 1').get(t, bank.id) as { id: string } | undefined
  if (linked) return { paymentMethod: 'TRANSFER', bankAccountId: linked.id }
  if (bank.code === ACC.CASH) return { paymentMethod: 'CASH', bankAccountId: null }
  const hasBanks = db.prepare('SELECT 1 FROM bank_accounts WHERE tenant_id = ? AND is_active = 1').get(t)
  if (bank.code === ACC.BANK && !hasBanks) return { paymentMethod: 'TRANSFER', bankAccountId: null }
  return null
}

function dedupeKey(accountId: string, l: SubmitLine): string {
  return [accountId, l.date, Number(l.amount).toFixed(2), String(l.statement_ref ?? '').trim(), l.statement_line_no ?? ''].join('|')
}

export interface SubmitResult {
  period: string
  bank_account: { code: string; name: string; kind: string }
  results: LineResult[]
  summary: {
    accepted: number; duplicate: number; rejected: number; not_saved: number; saved: boolean
    book_closing_balance: number; pending_adjustments: number; timing_items: number
    statement_closing_balance: number; difference: number; reconciled: boolean
    message: string
  }
}

/** A5 — รับรายการปรับปรุงจาก AI: ตรวจทุกด่าน → เก็บเป็นร่าง → ตอบผลรายบรรทัด + ผลต่างที่เหลือ */
export function submitCloseAdjustments(tenantId: string, actor: Actor, input: SubmitInput): SubmitResult {
  if (!canSubmitAdjustments(actor)) {
    throw new MonthCloseError(403, 'ไม่มีสิทธิ์ส่งรายการปรับปรุง — ต้องเป็น MASTER/ADMIN หรือมีสิทธิ์เขียนหมวดบัญชี (แผนกบัญชี)')
  }
  const { start, end } = periodRange(input.period)
  const [y, m] = input.period.split('-').map(Number)
  const tp = db.prepare('SELECT status FROM tax_periods WHERE tenant_id = ? AND year = ? AND month = ?').get(tenantId, y, m) as { status: string } | undefined
  if (tp?.status === 'CLOSED') {
    throw new MonthCloseError(400, `งวด ${m}/${y} ปิดแล้ว ส่งรายการปรับปรุงไม่ได้ — ข้อผิดพลาดของงวดที่ปิดแล้วให้ผู้ทำบัญชีลงในงวดปัจจุบันกับบัญชี ${ACC.PRIOR_PERIOD_ADJ} ปรับปรุงกำไรสะสมงวดก่อน`)
  }
  const lines = Array.isArray(input.lines) ? input.lines : []
  if (lines.length > MAX_LINES) throw new MonthCloseError(400, `ส่งได้ครั้งละไม่เกิน ${MAX_LINES} บรรทัด (ส่งมา ${lines.length}) — แบ่งส่งหลายครั้ง ระบบกันซ้ำให้`)
  const stmt = Number(input.statement_closing_balance)
  if (!Number.isFinite(stmt) || !twoDecimals(stmt)) throw new MonthCloseError(400, 'statement_closing_balance ต้องเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง (ยอดคงเหลือสิ้นงวดตาม statement หรือเงินสดที่นับได้)')
  if (input.statement_hash !== undefined && (typeof input.statement_hash !== 'string' || input.statement_hash.length > 128)) {
    throw new MonthCloseError(400, 'statement_hash ต้องเป็นข้อความไม่เกิน 128 ตัวอักษร (เช่น SHA-256 ของไฟล์ statement)')
  }

  const money = new Map(moneyAccounts(tenantId).map(a => [a.id, a]))
  const bankAcc = accByCode(tenantId, String(input.bank_account_code || '').trim())
  const bank = bankAcc ? money.get(bankAcc.id) : undefined
  if (!bank) {
    const header = bankAcc && isHeaderAccount(bankAcc.id)
    throw new MonthCloseError(400, header
      ? `${bankAcc!.code} เป็นบัญชีหัว — กระทบยอดทีละบัญชีย่อย (accounts[].code ใน get_close_pack)`
      : `ไม่พบบัญชีเงินสด/ธนาคาร "${input.bank_account_code}" — ใช้รหัสจาก accounts[].code ใน get_close_pack`)
  }

  const company = db.prepare('SELECT entity_type FROM company_settings WHERE tenant_id = ?').get(tenantId) as { entity_type: string | null } | undefined
  const ctx: Ctx = {
    t: tenantId, period: input.period, start, end, bank, money,
    entityType: (company?.entity_type as Ctx['entityType']) ?? null,
    vatRegistered: isVatRegistered(tenantId),
    batchRefUse: new Map(),
    batchTimingRefs: new Set(),
    batchInvUse: new Map(),
  }

  const results: LineResult[] = []
  const toWrite: Array<{ index: number; line: SubmitLine; plan: Plan; key: string; type: AdjType }> = []
  const seenKeys = new Set<string>()
  lines.forEach((raw, index) => {
    const line = (raw ?? {}) as SubmitLine
    const base = { index, statement_line_no: Number.isInteger(line.statement_line_no) ? line.statement_line_no! : null, type: String(line.type ?? '') }
    const key = dedupeKey(bank.id, line)
    const existing = db.prepare(`SELECT r.id, r.status, r.effect, je.entry_number FROM bank_reconciliation_records r
      LEFT JOIN journal_entries je ON je.id = r.journal_entry_id
      WHERE r.tenant_id = ? AND r.dedupe_key = ? AND r.status <> 'DISCARDED'`).get(tenantId, key) as any
    if (existing || seenKeys.has(key)) {
      results.push({ ...base, status: 'duplicate', record_id: existing?.id, entry_number: existing?.entry_number ?? null, effect: existing?.effect,
        warnings: [`ส่งซ้ำ — บรรทัด statement นี้ถูกบันทึกไว้แล้ว${existing ? ` (สถานะ ${existing.status})` : ' ในชุดเดียวกัน'} ระบบไม่สร้างรายการเพิ่ม`] })
      return
    }
    const { plan, errors } = planLine(ctx, line)
    if (!plan) { results.push({ ...base, status: 'rejected', errors }); return }
    seenKeys.add(key)
    toWrite.push({ index, line, plan, key, type: String(line.type).toUpperCase() as AdjType })
    results.push({ ...base, status: 'accepted', warnings: plan.warnings.length ? plan.warnings : undefined, effect: plan.effect })
  })

  const NOT_SAVED_WARN = 'ยังไม่บันทึก — ชุดนี้มีบรรทัดที่ถูกปฏิเสธ ระบบจึงไม่บันทึกทั้งชุด (รวมยอด statement) แก้บรรทัดที่ถูกปฏิเสธแล้วส่งทั้งชุดใหม่'
  const rejectedCount = results.filter(r => r.status === 'rejected').length
  const saved = rejectedCount === 0
  if (!saved) {
    for (const r of results) {
      if (r.status === 'accepted') {
        r.status = 'not_saved'
        r.warnings = [...(r.warnings ?? []), NOT_SAVED_WARN]
      }
    }
  } else {
    const now = new Date().toISOString()
    try {
      db.transaction(() => {
        // รอบกระทบยอด: 1 แถวต่อบัญชีต่องวด — statement ล่าสุดที่ส่งมาเป็นตัวเทียบ
        db.prepare(`INSERT INTO bank_reconciliations (id, tenant_id, period, account_id, statement_closing_balance, statement_hash,
            submitted_by, submitted_by_name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(tenant_id, period, account_id) DO UPDATE SET statement_closing_balance = excluded.statement_closing_balance,
            statement_hash = COALESCE(excluded.statement_hash, bank_reconciliations.statement_hash),
            submitted_by = excluded.submitted_by, submitted_by_name = excluded.submitted_by_name, updated_at = excluded.updated_at`)
          .run(generateId(), tenantId, input.period, bank.id, r2(stmt), input.statement_hash ?? null, actor.email, actor.name, now, now)
        const recon = db.prepare('SELECT id FROM bank_reconciliations WHERE tenant_id = ? AND period = ? AND account_id = ?').get(tenantId, input.period, bank.id) as { id: string }

        for (const w of toWrite) {
          const recordId = generateId()
          let jeId: string | null = null
          let entryNumber: string | null = null
          if (w.plan.legs.length) {
            jeId = generateId()
            entryNumber = formatDocumentNumber('JV', tenantId, 'JOURNAL', Number(w.line.date.substring(0, 4)), 5, w.line.date)
            const total = r2(w.plan.legs.reduce((s, l) => s + l.debit, 0))
            const label = ADJ_TYPES[w.type].label
            db.prepare(`INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id, source_number, description,
                total_debit, total_credit, is_auto_generated, is_posted, notes, created_by, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`)
              .run(jeId, tenantId, entryNumber, w.line.date, CLOSE_ADJ_REF, recordId, String(w.line.statement_ref).trim(),
                `ปิดเดือน ${input.period} · ${label}: ${String(w.line.description).trim()}`, total, total,
                `เหตุผลจาก AI: ${String(w.line.reason).trim()}${w.line.confidence != null ? ` (ความมั่นใจ ${Math.round(Number(w.line.confidence) * 100)}%)` : ''} · statement บรรทัด ${w.line.statement_line_no}`,
                actor.email, now, now)
            const ins = db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            w.plan.legs.forEach((l, i) => ins.run(generateId(), tenantId, jeId, l.accountId, i + 1, String(w.line.description).trim(), r2(l.debit), r2(l.credit)))
          }
          db.prepare(`INSERT INTO bank_reconciliation_records (id, tenant_id, reconciliation_id, dedupe_key, type, line_date, amount, effect, direction,
              statement_ref, statement_line_no, description, account_code, counter_account_code, ref_line_id, source_doc_type, source_doc_id,
              reason, confidence, statement_hash, journal_entry_id, status, submitted_by, submitted_by_name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(recordId, tenantId, recon.id, w.key, w.type, w.line.date, r2(Number(w.line.amount)), w.plan.effect,
              w.line.direction ? String(w.line.direction).toUpperCase() : null, String(w.line.statement_ref).trim(), w.line.statement_line_no,
              String(w.line.description).trim(), w.line.account_code ?? null, w.line.counter_account_code ?? null, w.line.ref_line_id ?? null,
              w.plan.sourceDocType ?? null, w.plan.sourceDocId ?? null, String(w.line.reason).trim(),
              w.line.confidence != null ? Number(w.line.confidence) : null, input.statement_hash ?? null, jeId, w.plan.status,
              actor.email, actor.name, now, now)
          const res = results.find(r => r.index === w.index)!
          res.record_id = recordId
          res.entry_number = entryNumber
        }
      })()
    } catch (e) {
      if (isHeaderAccountError(e)) throw new MonthCloseError(400, (e as Error).message)
      throw e
    }
  }

  const st = reconciliationStatus(tenantId, input.period).find(r => r.accountId === bank.id)
  const book = st?.book ?? 0
  const pending = st?.pending ?? 0
  const timing = st?.timing ?? 0
  const difference = st?.difference ?? r2(stmt - book)
  const reconciled = saved && Math.abs(difference) <= ZERO
  const count = (s: LineResult['status']) => results.filter(r => r.status === s).length
  return {
    period: input.period,
    bank_account: { code: bank.code, name: bank.name, kind: bank.kind },
    results,
    summary: {
      accepted: count('accepted'), duplicate: count('duplicate'), rejected: rejectedCount,
      not_saved: count('not_saved'), saved,
      book_closing_balance: book, pending_adjustments: pending, timing_items: timing,
      statement_closing_balance: r2(stmt), difference, reconciled,
      message: !saved
        ? `ไม่ได้บันทึกอะไรเลย: มี ${rejectedCount} บรรทัดถูกปฏิเสธ — แก้ตาม errors ของแต่ละบรรทัดแล้วส่งทั้งชุดใหม่ (ส่งซ้ำได้ ระบบกันซ้ำ) · ยอด statement ยังไม่ถูกบันทึก`
        : reconciled
          ? 'ยอดตามบัญชี + รายการปรับปรุง + รายการระหว่างทาง = ยอดตาม statement แล้ว · รายการทั้งหมดเป็นร่าง รอคนอนุมัติที่หน้า บัญชี > ปิดงวด'
          : `ยังต่าง ฿${difference.toLocaleString('th-TH', { minimumFractionDigits: 2 })} (statement − บัญชี − รายการปรับปรุง − รายการระหว่างทาง) — หาบรรทัด statement ที่ยังไม่จับคู่ แก้บรรทัดที่ถูกปฏิเสธ แล้วส่งเพิ่ม (ส่งซ้ำได้ ระบบกันซ้ำ) · ปิดงวดไม่ได้จนกว่าผลต่างเป็น 0`,
    },
  }
}

// ── A6: อนุมัติทีละกลุ่ม → post ────────────────────────────────────────────

function recordsInPeriod(tenantId: string, period: string, where: string, params: unknown[]) {
  return db.prepare(`SELECT r.* FROM bank_reconciliation_records r JOIN bank_reconciliations b ON b.id = r.reconciliation_id
    WHERE r.tenant_id = ? AND b.period = ? ${where} ORDER BY r.line_date, r.created_at`).all(tenantId, period, ...params) as any[]
}

/**
 * post รายการปรับปรุงที่อนุมัติแล้ว — เรียกได้ 2 ทาง: GM กดอนุมัติเอง (approveCloseGroup) และ executeApprovedAction ตอนคำขอผ่าน
 * ต้องเรียกในทรานแซกชันของผู้เรียก (ล้มกลางทาง = rollback ทั้งกลุ่ม คำขอยัง PENDING)
 */
export function postCloseRecords(tenantId: string, recordIds: string[], actorEmail: string): number {
  const now = new Date().toISOString()
  let posted = 0
  for (const id of recordIds) {
    const rec = db.prepare(`SELECT * FROM bank_reconciliation_records WHERE id = ? AND tenant_id = ? AND status IN ('DRAFT', 'PENDING_APPROVAL')`).get(id, tenantId) as any
    if (!rec) continue
    const closed = closedPeriodLabel(tenantId, rec.line_date)
    if (closed) throw new MonthCloseError(400, `งวด ${closed} ปิดแล้ว post รายการปรับปรุงไม่ได้ — เปิดงวดก่อนหรือทิ้งรายการ`)
    let jeId: string | null = rec.journal_entry_id
    if (jeId) {
      const je = db.prepare('SELECT id, is_posted FROM journal_entries WHERE id = ? AND tenant_id = ?').get(jeId, tenantId) as any
      if (!je) throw new MonthCloseError(409, `ร่างรายการบัญชีของรายการปรับปรุง ${rec.statement_ref} หายไป — ทิ้งรายการนี้แล้วให้ AI ส่งใหม่`)
      if (!je.is_posted) {
        db.prepare('UPDATE journal_entries SET is_posted = 1, posted_at = ?, posted_by = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
          .run(now, actorEmail, now, jeId, tenantId)
      }
    } else if (rec.source_doc_type === 'INVOICE') {
      const recon = db.prepare('SELECT account_id FROM bank_reconciliations WHERE id = ?').get(rec.reconciliation_id) as { account_id: string }
      const bank = moneyAccounts(tenantId).find(a => a.id === recon.account_id)
      const channel = bank && receiptChannel(tenantId, bank)
      if (!channel) throw new MonthCloseError(409, 'บัญชีที่กระทบยอดรับชำระใบแจ้งหนี้ผ่านระบบไม่ได้แล้ว (ตั้งค่าบัญชีธนาคารเปลี่ยน) — ทิ้งรายการแล้วส่งใหม่')
      try {
        const r = recordCustomerPayment(tenantId, {
          invoiceId: rec.source_doc_id, receiptDate: rec.line_date, paymentMethod: channel.paymentMethod,
          paymentReference: rec.statement_ref, amount: rec.amount, notes: `ปิดเดือน: ${rec.description}`, bankAccountId: channel.bankAccountId,
        })
        jeId = (db.prepare(`SELECT id FROM journal_entries WHERE tenant_id = ? AND reference_type = 'PAYMENT' AND reference_id = ?`).get(tenantId, r.receipt.id) as any)?.id ?? null
      } catch (e) {
        if (e instanceof SalesBillingError) throw new MonthCloseError(409, `รับชำระ ${rec.statement_ref} ไม่สำเร็จ: ${e.message}`)
        throw e
      }
    } else if (rec.source_doc_type === 'SUPPLIER_PAYMENT_VOID') {
      const pay = db.prepare('SELECT * FROM supplier_payments WHERE id = ? AND tenant_id = ?').get(rec.source_doc_id, tenantId) as any
      if (!pay || pay.status === 'CANCELLED') throw new MonthCloseError(409, `ใบจ่ายเงินที่ลงซ้ำถูกยกเลิกไปแล้ว — ทิ้งรายการ ${rec.statement_ref}`)
      // บริการยกเลิกใบจ่ายเงินเดิม (กลับรายการบัญชี + คืนยอดค้างใบแจ้งหนี้) ลงวันที่ตาม statement ไม่ใช่วันที่กดอนุมัติ
      reverseSupplierPayment(tenantId, pay, actorEmail, rec.line_date)
      jeId = (db.prepare(`SELECT id FROM journal_entries WHERE tenant_id = ? AND reference_type = 'SUPPLIER_PAYMENT_CANCEL' AND reference_id = ? ORDER BY created_at DESC`).get(tenantId, pay.id) as any)?.id ?? null
    } else {
      continue
    }
    db.prepare(`UPDATE bank_reconciliation_records SET status = 'POSTED', journal_entry_id = ?, posted_by = ?, posted_at = ?, updated_at = ? WHERE id = ?`)
      .run(jeId, actorEmail, now, now, id)
    posted++
  }
  return posted
}

/**
 * อนุมัติกลุ่มรายการร่างประเภทเดียวกันในงวด: GM (ADMIN/MASTER/OWNER หรือแผนก CEO) = post ทันที + บันทึกความเคลื่อนไหว
 * คนอื่นที่มีสิทธิ์บัญชี = สร้างคำขออนุมัติหมวด close_adjust (ระบบอนุมัติเดิม) แล้วรอ
 */
export function approveCloseGroup(tenantId: string, period: string, type: string, actor: Actor & GateUser, recordIds?: string[]) {
  periodRange(period)
  if (!isGm(actor) && !canSubmitAdjustments(actor)) throw new MonthCloseError(403, 'ไม่มีสิทธิ์อนุมัติรายการปรับปรุง — ต้องมีสิทธิ์หมวดบัญชี')
  const t = String(type || '').toUpperCase()
  if (!TYPE_NAMES.includes(t as AdjType)) throw new MonthCloseError(400, `ไม่รู้จักประเภท ${type}`)
  if (t === 'TIMING') throw new MonthCloseError(400, 'รายการระหว่างทางไม่ลงบัญชี ไม่ต้องอนุมัติ')
  let records = recordsInPeriod(tenantId, period, `AND r.type = ? AND r.status = 'DRAFT'`, [t])
  if (recordIds?.length) records = records.filter(r => recordIds.includes(r.id))
  if (!records.length) throw new MonthCloseError(400, 'ไม่มีรายการร่างประเภทนี้ให้อนุมัติ')
  const ids = records.map(r => r.id)
  const total = r2(records.reduce((s, r) => s + Number(r.amount), 0))
  const label = ADJ_TYPES[t as AdjType].label
  const gateArgs: CreateRequestArgs = {
    tenantId, user: actor, category: 'close_adjust',
    refType: 'bank_reconciliation_records', refId: `${period}:${t}:${ids[0]}`,
    description: `อนุมัติรายการปรับปรุงปิดเดือน ${period} · ${label} ${ids.length} รายการ รวม ฿${total.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`,
    amount: total, payload: { period, type: t, recordIds: ids },
  }
  const pending = gateOrCreate(gateArgs)
  if (!pending) {
    const posted = db.transaction(() => postCloseRecords(tenantId, ids, actor.email))()
    recordAutoAction(gateArgs)
    return { mode: 'posted' as const, posted }
  }
  const now = new Date().toISOString()
  const upd = db.prepare(`UPDATE bank_reconciliation_records SET status = 'PENDING_APPROVAL', approval_request_id = ?, updated_at = ? WHERE id = ? AND status = 'DRAFT'`)
  db.transaction(() => { for (const id of ids) upd.run(pending.id, now, id) })()
  return { mode: 'requested' as const, posted: 0, requestId: pending.id as string, requestNumber: pending.request_number as string }
}

/** ผู้อนุมัติปฏิเสธคำขอ → รายการกลับเป็นร่าง (แก้/ทิ้ง/ขอใหม่ได้) */
export function revertCloseApproval(tenantId: string, approvalRequestId: string) {
  db.prepare(`UPDATE bank_reconciliation_records SET status = 'DRAFT', approval_request_id = NULL, updated_at = ?
    WHERE tenant_id = ? AND approval_request_id = ? AND status = 'PENDING_APPROVAL'`).run(new Date().toISOString(), tenantId, approvalRequestId)
}

/** ทิ้งรายการ (ร่าง/รายการระหว่างทาง) — ลบร่าง JV ทิ้ง เก็บแถวไว้พร้อมเหตุผล · คีย์กันซ้ำว่างให้ AI ส่งบรรทัดนั้นใหม่ได้ */
export function discardCloseRecord(tenantId: string, recordId: string, actor: Actor, reason: string) {
  if (!canSubmitAdjustments(actor) && !isGm(actor as any)) throw new MonthCloseError(403, 'ไม่มีสิทธิ์ทิ้งรายการปรับปรุง')
  const why = String(reason || '').trim()
  if (why.length < 5) throw new MonthCloseError(400, 'กรุณาระบุเหตุผลที่ทิ้งรายการ (อย่างน้อย 5 ตัวอักษร)')
  const rec = db.prepare('SELECT * FROM bank_reconciliation_records WHERE id = ? AND tenant_id = ?').get(recordId, tenantId) as any
  if (!rec) throw new MonthCloseError(404, 'ไม่พบรายการปรับปรุงนี้')
  if (rec.status === 'PENDING_APPROVAL') throw new MonthCloseError(400, 'รายการนี้อยู่ระหว่างขออนุมัติ — ให้ผู้อนุมัติปฏิเสธคำขอก่อน')
  if (rec.status !== 'DRAFT' && rec.status !== TIMING_STATUS) throw new MonthCloseError(400, `รายการสถานะ ${rec.status} ทิ้งไม่ได้ — ที่ลงบัญชีแล้วให้กลับรายการในสมุดรายวัน`)
  const now = new Date().toISOString()
  db.transaction(() => {
    if (rec.journal_entry_id) {
      const je = db.prepare('SELECT is_posted FROM journal_entries WHERE id = ? AND tenant_id = ?').get(rec.journal_entry_id, tenantId) as any
      if (je?.is_posted) throw new MonthCloseError(400, 'ร่างนี้ถูกยืนยันไปแล้ว ทิ้งไม่ได้')
      db.prepare('DELETE FROM journal_lines WHERE journal_entry_id = ? AND tenant_id = ?').run(rec.journal_entry_id, tenantId)
      db.prepare('DELETE FROM journal_entries WHERE id = ? AND tenant_id = ?').run(rec.journal_entry_id, tenantId)
    }
    db.prepare(`UPDATE bank_reconciliation_records SET status = 'DISCARDED', journal_entry_id = NULL, discarded_by = ?, discard_reason = ?, updated_at = ? WHERE id = ?`)
      .run(actor.email, why, now, recordId)
  })()
}
