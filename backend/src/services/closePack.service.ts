import db from '../db/sqlite'
import { ACC } from '../config/accountCodes'
import { thaiDateStr } from '../utils/id'
import { REF_LABELS } from './phopyBoard.service'
import { closeChecklist } from './closeChecklist.service'
import { ensurePeriod } from '../routes/tax.routes'
import { isGm, type GateUser } from './approvalGate.service'
import { isVatRegistered } from './accounting.service'
import {
  periodRange, moneyAccounts, postedBalance, reconciliationStatus, headerAccountIds, r2, ZERO, TIMING_STATUS,
} from './monthClose.service'
import { ADJ_TYPES, MAX_LINES, allowedExpenseCodes, allowedRevenueCodes, type AdjType } from './closeAdjustments.service'

// ─────────────────────────────────────────────────────────────────────────
// ชุดปิดเดือน (A4) + ชุดคำสั่งสำหรับ AI ของลูกค้า (A7) + สถานะหน้าทบทวน (A6)
// ฟังก์ชันสร้างข้อมูลตัวเดียว ออกได้ 2 ทาง: REST (หน้าเว็บสร้าง .xlsx ในเบราว์เซอร์) และ MCP get_close_pack
// ─────────────────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  ...REF_LABELS,
  PAYMENT: 'รับชำระจากลูกค้า', SUPPLIER_PAYMENT_CANCEL: 'ยกเลิกการจ่ายผู้ขาย', PAYMENT_CANCEL: 'ยกเลิกการรับชำระ',
  CLOSE_ADJUSTMENT: 'รายการปรับปรุงปิดเดือน', REVERSAL: 'กลับรายการ', POS_SHIFT_CLOSE: 'ปิดกะ POS',
  PLATFORM_MONTH: 'รอบเดือนแพลตฟอร์ม', SUBCONTRACT_PAYMENT: 'จ่ายค่าจ้างเหมา',
}

const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
export const thaiPeriodLabel = (period: string) => {
  const [y, m] = period.split('-').map(Number)
  return `${THAI_MONTHS[m - 1]} ${y + 543}`
}

interface PackLine {
  lineId: string; date: string; entryNumber: string; journalEntryId: string; source: string; sourceType: string
  sourceNumber: string | null; counterparty: string | null; description: string; in: number; out: number; balance: number | null; posted: boolean
}

function accountLines(tenantId: string, accountId: string, start: string, end: string, opening: number): PackLine[] {
  const rows = db.prepare(`
    SELECT jl.id AS lineId, je.date, je.entry_number AS entryNumber, je.id AS journalEntryId,
      COALESCE(je.reference_type, 'MANUAL') AS sourceType,
      COALESCE(je.source_number,
        CASE je.reference_type
          WHEN 'SUPPLIER_PAYMENT' THEN (SELECT sp.payment_number FROM supplier_payments sp WHERE sp.id = je.reference_id AND sp.tenant_id = je.tenant_id)
          WHEN 'PAYMENT' THEN (SELECT r.receipt_number FROM receipts r WHERE r.id = je.reference_id AND r.tenant_id = je.tenant_id)
        END) AS sourceNumber,
      CASE je.reference_type
        WHEN 'SUPPLIER_PAYMENT' THEN (SELECT s.name FROM supplier_payments sp JOIN suppliers s ON s.id = sp.supplier_id WHERE sp.id = je.reference_id AND sp.tenant_id = je.tenant_id)
        WHEN 'PAYMENT' THEN (SELECT c.name FROM receipts r JOIN customers c ON c.id = r.customer_id WHERE r.id = je.reference_id AND r.tenant_id = je.tenant_id)
        WHEN 'INVOICE' THEN (SELECT c.name FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = je.reference_id AND i.tenant_id = je.tenant_id)
      END AS counterparty,
      COALESCE(NULLIF(jl.description, ''), je.description) AS description, jl.debit, jl.credit, je.is_posted AS posted
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE jl.tenant_id = ? AND je.tenant_id = ? AND jl.account_id = ? AND date(je.date) BETWEEN ? AND ?
      AND (je.is_closing_entry IS NULL OR je.is_closing_entry = 0)
    ORDER BY je.date, je.created_at, jl.line_number
  `).all(tenantId, tenantId, accountId, start, end) as any[]
  let bal = opening
  return rows.map(r => {
    const posted = !!r.posted
    if (posted) bal = r2(bal + r.debit - r.credit)
    return {
      lineId: r.lineId, date: String(r.date).substring(0, 10), entryNumber: r.entryNumber, journalEntryId: r.journalEntryId,
      source: SOURCE_LABELS[r.sourceType] || r.sourceType, sourceType: r.sourceType, sourceNumber: r.sourceNumber ?? null,
      counterparty: r.sourceType.startsWith('POS_') ? 'หน้าร้าน POS' : (r.counterparty ?? null),
      description: r.description ?? '', in: r2(r.debit), out: r2(r.credit), balance: posted ? bal : null, posted,
    }
  })
}

/** ชุดคำสั่งสำหรับ AI ของลูกค้า (markdown) — ต่อยอดจาก prompt งบพิสูจน์ยอดเงินฝาก (BF001) ในสกิล phopy-audit-prompts */
export function closeInstructions(company: { name: string | null; entityType: string | null; vatRegistered: boolean }, period: string): string {
  const { start, end } = periodRange(period)
  const typeRows = (Object.keys(ADJ_TYPES) as AdjType[]).map(k => {
    const t = ADJ_TYPES[k]
    return `| \`${k}\` | ${t.label} | ${t.debit}${t.credit ? ` / ${t.credit}` : ''} | ${t.needs.join(', ') || '-'} | ${t.note} |`
  }).join('\n')
  const entity = company.entityType === 'INDIVIDUAL' ? 'บุคคลธรรมดา' : company.entityType === 'PARTNERSHIP' ? 'ห้างหุ้นส่วน (หจก.)'
    : company.entityType === 'COMPANY' ? 'บริษัทจำกัด (บจก.)' : 'ยังไม่ระบุ — ประเภท OWNER_* จะถูกปฏิเสธจนกว่าเจ้าของตั้งที่ ตั้งค่า > ข้อมูลบริษัท'
  return `# ชุดคำสั่งสำหรับ AI: ปิดบัญชีเดือน${thaiPeriodLabel(period)} (${start} ถึง ${end})
กิจการ: ${company.name ?? '-'} · รูปแบบกิจการ: ${entity} · จด VAT: ${company.vatRegistered ? 'จดแล้ว' : 'ยังไม่จด'}

## บทบาท
คุณคือนักบัญชีที่จัดทำงบพิสูจน์ยอดเงินฝากธนาคาร (วิธีปรับยอดทั้งสองข้าง) ให้กิจการนี้ งานของคุณคือ **เทียบรายการในระบบ Phopy กับ statement / เงินสดที่นับได้ แล้วเสนอรายการปรับปรุง** — Phopy เป็นคนตรวจและบันทึกเป็นร่าง คนของกิจการเป็นคนอนุมัติ คุณไม่ได้ลงบัญชีเอง

## ข้อมูลที่ใช้
1. ชุดปิดเดือนจาก Phopy: ไฟล์ .xlsx ที่ผู้ใช้แนบ หรือเรียก MCP \`get_close_pack(period: "${period}")\` — มีทุกบรรทัดของบัญชีเงินสด/ธนาคารในงวด (\`lineId\`), ยอดยกมา/สิ้นงวด, ผังบัญชีที่ใช้ได้, คู่ค้า, ใบแจ้งหนี้ค้าง และประเภทรายการที่รับ
2. statement ของแต่ละบัญชีธนาคาร (PDF/CSV) ที่ผู้ใช้แนบ — **ห้ามเดาตัวเลข** ถ้าไม่มี statement ของบัญชีไหน ให้ขอผู้ใช้ก่อน
3. บัญชีเงินสด (เช่น ${ACC.CASH}, ${ACC.PETTY_CASH}) ใช้ "เงินที่นับได้จริงวันที่ ${end}" แทน statement — ถามผู้ใช้

## ขั้นตอน (ทำทีละบัญชี)
1. ตรวจยอดยกมา: ยอดยกมาตามบัญชี (opening) เทียบยอดต้นงวดใน statement ถ้าไม่ตรงให้รายงานก่อน (มักเป็นผลจากงวดก่อนที่ยังไม่ได้กระทบยอด)
2. จับคู่รายการ: ยอดเงินตรงกันเป๊ะ และวันที่ห่างไม่เกิน 1–3 วัน · ชื่อที่ธนาคารปิดบางส่วน (เช่น "นาย ส... ส...") หรือจับคู่ได้หลายตัว **ให้ถามคนก่อน** อย่าเลือกเอง
3. บรรทัดที่จับคู่ไม่ได้ ให้จัดเข้า 1 ใน 13 ประเภทด้านล่างเท่านั้น ทุกบรรทัดต้องอ้างบรรทัดใน statement (\`statement_ref\` + \`statement_line_no\`) และมีเหตุผล (\`reason\`) + ความมั่นใจ 0–1 (\`confidence\`)
   - อยู่ใน statement แต่ไม่อยู่ในระบบ → ประเภทปรับปรุง (ค่าธรรมเนียม ดอกเบี้ย รายจ่ายที่ไม่ได้ลง เงินเข้าที่ไม่ได้ลง เงินเจ้าของ ฯลฯ)
   - อยู่ในระบบแต่ลงผิด (ช่องทาง/บัญชีหัว/ซ้ำ) → อ้าง \`ref_line_id\` = lineId ของรายการเดิม
   - อยู่ในระบบ ถูกต้อง แต่ statement ยังไม่มี ณ สิ้นงวด (เงินฝากระหว่างทาง / เช็คหรือรายการจ่ายที่ธนาคารยังไม่ตัด) → \`TIMING\` ไม่ลงบัญชี
4. ส่งกลับด้วย MCP \`submit_close_adjustments\` ครั้งละ 1 บัญชี ไม่เกิน ${MAX_LINES} บรรทัด (แบ่งส่งได้ ส่งซ้ำได้ ระบบกันซ้ำด้วยบัญชี+วันที่+ยอด+statement_ref+statement_line_no) พร้อม \`statement_closing_balance\` (ยอดสิ้นงวดตาม statement หรือเงินที่นับได้) และ \`statement_hash\` (SHA-256 ของไฟล์ statement ถ้าคำนวณได้)
   - ถ้าไม่มีอะไรต้องปรับ ก็ยังต้องส่ง \`lines: []\` พร้อมยอด statement เพื่อบันทึกว่ากระทบยอดแล้ว
5. อ่านผลรายบรรทัด: \`rejected\` มีข้อความภาษาไทยบอกวิธีแก้ → แก้แล้วส่งเฉพาะบรรทัดนั้นใหม่ · \`summary.difference\` ต้องเป็น 0 ถึงจะปิดงวดได้ ถ้าไม่เป็น 0 ให้หาบรรทัด statement ที่ยังไม่จับคู่ต่อ
6. เสร็จแล้วบอกผู้ใช้ให้ไปทบทวนและอนุมัติที่หน้า **บัญชี > ปิดงวด** (รายการทั้งหมดยังเป็นร่างจนกว่าคนอนุมัติ) แล้วสรุปงบพิสูจน์ยอดให้ผู้ใช้ดู: ยอดตามบัญชี / รายการปรับปรุง / รายการระหว่างทาง / ยอดตาม statement / ผลต่าง (ตัวเลขมีจุลภาคและทศนิยม 2 ตำแหน่ง)

## 13 ประเภทที่รับ (ใช้ได้เฉพาะเหล่านี้ — บัญชีที่เลือกได้อยู่ใน types[].allowedAccounts ของชุดปิดเดือน)
| type | ความหมาย | เดบิต / เครดิต | ต้องส่งเพิ่ม | เงื่อนไข |
|---|---|---|---|---|
${typeRows}

## กฎที่ห้ามพลาด
- ห้ามลงบัญชีหัว (บัญชีที่มีบัญชีย่อย เช่น ${ACC.BANK} เมื่อมี ${ACC.BANK}-01) — ยอดที่ค้างในบัญชีหัวให้ย้ายด้วย \`WRONG_ACCOUNT\` ทีละ line
- รายจ่ายส่วนตัวของเจ้าของห้ามเป็นค่าใช้จ่ายของกิจการ (ม.65 ตรี (3)) → ใช้ \`OWNER_PERSONAL\`
- ของที่ไม่มีใบกำกับภาษีเต็มรูป ห้ามลงภาษีซื้อ ${ACC.INPUT_VAT}
- เงินเข้าที่มีใบแจ้งหนี้ ให้ส่ง \`invoice_id\` (ระบบจะใช้บริการรับชำระเดิม ไม่สร้างรายการลอย)${company.vatRegistered ? ' · กิจการจด VAT: รายได้ต้องมีใบกำกับภาษีตามวันรับเงิน/ส่งมอบ' : ''}
- ยอดเงิน (\`amount\`) เป็นบวกเสมอ ทศนิยมไม่เกิน 2 ตำแหน่ง ทิศทางบอกด้วยประเภท หรือ \`direction\` (IN/OUT) สำหรับ \`CASH_COUNT_DIFF\` และ \`UNIDENTIFIED\`
- วันที่ทุกบรรทัดต้องอยู่ในงวด ${start} ถึง ${end} · งวดที่ปิดแล้วส่งไม่ได้
- ข้อมูลที่อนุมานเอง ให้เขียนใน \`reason\` ว่า "(เป็นการอนุมานจากข้อมูลที่มี)" และลด \`confidence\`

## ตัวอย่าง payload
\`\`\`json
{ "period": "${period}", "bank_account_code": "${ACC.BANK}-01", "statement_closing_balance": 15230.50, "statement_hash": "<sha256>",
  "lines": [
    { "type": "BANK_FEE", "date": "${end}", "amount": 20, "statement_ref": "FEE${end.replace(/-/g, '').slice(2)}", "statement_line_no": 58,
      "description": "ค่าธรรมเนียมโอนต่างธนาคาร", "reason": "statement บรรทัด 58 ไม่มีในระบบ", "confidence": 0.95 },
    { "type": "WRONG_ACCOUNT", "date": "${end}", "amount": 1250, "statement_ref": "TRF0912", "statement_line_no": 12,
      "account_code": "${ACC.BANK}-01", "ref_line_id": "<lineId ของรายการเดิมที่ลง ${ACC.BANK}>", "description": "ย้ายจ่ายผู้ขายจากบัญชีหัว",
      "reason": "รายการจ่ายนี้ลง ${ACC.BANK} หัว แต่ statement กรุงศรีมีรายการนี้", "confidence": 0.9 } ] }
\`\`\`
`
}

/** A4 — ชุดปิดเดือน (JSON) */
export function buildClosePack(tenantId: string, period: string) {
  const { start, end } = periodRange(period)
  const co = db.prepare('SELECT name, tax_id, entity_type FROM company_settings WHERE tenant_id = ?').get(tenantId) as any
  const company = { name: co?.name ?? null, taxId: co?.tax_id ?? null, entityType: co?.entity_type ?? null, vatRegistered: isVatRegistered(tenantId) }
  const recon = new Map(reconciliationStatus(tenantId, period).map(r => [r.accountId, r]))
  const accounts = moneyAccounts(tenantId)
    .filter(a => recon.has(a.id))
    .map(a => {
      const opening = postedBalance(tenantId, a.id, start, true)
      const st = recon.get(a.id)!
      return {
        accountId: a.id, code: a.code, name: a.name, kind: a.kind, bankName: a.bankName, accountNumber: a.accountNumber,
        opening, closing: st.book, pending: st.pending, timing: st.timing, statement: st.statement,
        lines: accountLines(tenantId, a.id, start, end, opening),
      }
    })
  const headers = headerAccountIds(tenantId)
  const headerBalances = [...headers].map(id => {
    const a = db.prepare('SELECT code, name FROM accounts WHERE id = ? AND tenant_id = ?').get(id, tenantId) as { code: string; name: string } | undefined
    return a ? { code: a.code, name: a.name, balance: postedBalance(tenantId, id, end) } : null
  }).filter((h): h is { code: string; name: string; balance: number } => !!h && Math.abs(h.balance) > ZERO)
  const chart = (db.prepare(`SELECT id, code, name, type, category FROM accounts WHERE tenant_id = ? AND is_active = 1 ORDER BY code`).all(tenantId) as any[])
    .filter(a => !headers.has(a.id)).map(({ id: _id, ...a }) => a)
  const expense = allowedExpenseCodes(tenantId)
  const revenue = allowedRevenueCodes(tenantId)
  const moneyCodes = accounts.map(a => a.code)
  const headerPairs = (db.prepare(`SELECT p.code AS parent, c.code AS child FROM accounts c JOIN accounts p ON p.id = c.parent_id
    WHERE c.tenant_id = ? AND p.category = 'CASH'`).all(tenantId) as { parent: string; child: string }[]).map(r => `${r.parent}→${r.child}`)
  const allowed: Record<AdjType, string[]> = {
    MISSING_EXPENSE: expense, BANK_FEE: [ACC.BANK_CHARGE], INTEREST_INCOME: [ACC.INTEREST_INCOME], WRONG_CHANNEL: moneyCodes,
    WRONG_ACCOUNT: headerPairs, OWNER_PERSONAL: [company.entityType === 'INDIVIDUAL' ? ACC.OWNER_DRAWINGS : ACC.DIRECTOR_LOAN],
    OWNER_PAID: [...expense, ACC.OWNER_ADVANCE, ACC.CAPITAL], OWNER_CAPITAL: [ACC.CAPITAL, ACC.OWNER_ADVANCE],
    UNRECORDED_RECEIPT: revenue, DUPLICATE: [], CASH_COUNT_DIFF: [ACC.CASH_OVER_SHORT], UNIDENTIFIED: [ACC.SUSPENSE], TIMING: [],
  }
  const types = (Object.keys(ADJ_TYPES) as AdjType[]).map(k => ({
    type: k, label: ADJ_TYPES[k].label, debit: ADJ_TYPES[k].debit, credit: ADJ_TYPES[k].credit,
    needs: [...ADJ_TYPES[k].needs], allowedAccounts: allowed[k], note: ADJ_TYPES[k].note,
  }))
  const suppliers = db.prepare(`SELECT id, code, name, tax_id AS taxId FROM suppliers WHERE tenant_id = ? ORDER BY name LIMIT 3000`).all(tenantId)
  const customers = db.prepare(`SELECT id, code, name, tax_id AS taxId FROM customers WHERE tenant_id = ? ORDER BY name LIMIT 3000`).all(tenantId)
  const salesOpen = db.prepare(`SELECT i.id, i.invoice_number AS number, c.name AS party, i.invoice_date AS date, i.due_date AS dueDate, i.balance_amount AS balance
    FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.tenant_id = ? AND i.status NOT IN ('CANCELLED', 'DRAFT') AND i.balance_amount > 0.005
    ORDER BY i.invoice_date`).all(tenantId)
  const purchaseOpen = db.prepare(`SELECT pi.id, pi.pi_number AS number, s.name AS party, pi.invoice_date AS date, pi.due_date AS dueDate, pi.balance_amount AS balance
    FROM purchase_invoices pi LEFT JOIN suppliers s ON s.id = pi.supplier_id WHERE pi.tenant_id = ? AND pi.status NOT IN ('CANCELLED', 'DRAFT') AND pi.balance_amount > 0.005
    ORDER BY pi.invoice_date`).all(tenantId)
  const existingAdjustments = db.prepare(`SELECT r.type, r.line_date AS date, r.amount, r.effect, r.statement_ref AS statementRef, r.statement_line_no AS statementLineNo,
      r.status, je.entry_number AS entryNumber, a.code AS accountCode
    FROM bank_reconciliation_records r JOIN bank_reconciliations b ON b.id = r.reconciliation_id JOIN accounts a ON a.id = b.account_id
    LEFT JOIN journal_entries je ON je.id = r.journal_entry_id
    WHERE r.tenant_id = ? AND b.period = ? AND r.status <> 'DISCARDED' ORDER BY r.line_date`).all(tenantId, period)

  return {
    version: 1, period, start, end, generatedAt: new Date().toISOString(), company,
    instructions: closeInstructions(company, period),
    accounts, headerBalances, chart,
    contacts: { suppliers, customers },
    openInvoices: { sales: salesOpen, purchase: purchaseOpen },
    types,
    submitSchema: {
      tool: 'submit_close_adjustments',
      top: { period, bank_account_code: 'accounts[].code', statement_closing_balance: 'number', statement_hash: 'string (optional)', lines: `array ≤ ${MAX_LINES}` },
      lineFields: ['type', 'date', 'amount', 'statement_ref', 'statement_line_no', 'description', 'account_code', 'counter_account_code',
        'ref_line_id', 'invoice_id', 'direction', 'reason', 'confidence'],
      example: { type: 'BANK_FEE', date: end, amount: 20, statement_ref: 'FEE1031', statement_line_no: 58, description: 'ค่าธรรมเนียมโอนต่างธนาคาร',
        reason: 'statement บรรทัด 58 ไม่มีในระบบ', confidence: 0.95 },
    },
    existingAdjustments,
  }
}

/** A6 — ข้อมูลหน้าทบทวน/อนุมัติ/ล็อกงวด */
export function monthCloseStatus(tenantId: string, period: string, user: GateUser) {
  const { start, end } = periodRange(period)
  const taxPeriodId = ensurePeriod(tenantId, start)
  const tp = db.prepare('SELECT status FROM tax_periods WHERE id = ?').get(taxPeriodId) as { status: string } | undefined
  const co = db.prepare('SELECT entity_type FROM company_settings WHERE tenant_id = ?').get(tenantId) as { entity_type: string | null } | undefined
  const records = db.prepare(`
    SELECT r.*, je.entry_number AS entryNumber, a.code AS reconCode, ar.request_number AS approvalRequestNumber,
      (SELECT GROUP_CONCAT(ac.code || ' ' || ac.name, ', ') FROM journal_lines jl JOIN accounts ac ON ac.id = jl.account_id WHERE jl.journal_entry_id = r.journal_entry_id AND jl.debit > 0) AS debitAccount,
      (SELECT GROUP_CONCAT(ac.code || ' ' || ac.name, ', ') FROM journal_lines jl JOIN accounts ac ON ac.id = jl.account_id WHERE jl.journal_entry_id = r.journal_entry_id AND jl.credit > 0) AS creditAccount
    FROM bank_reconciliation_records r JOIN bank_reconciliations b ON b.id = r.reconciliation_id JOIN accounts a ON a.id = b.account_id
    LEFT JOIN journal_entries je ON je.id = r.journal_entry_id
    LEFT JOIN approval_requests ar ON ar.id = r.approval_request_id
    WHERE r.tenant_id = ? AND b.period = ? AND r.status IN ('DRAFT', 'PENDING_APPROVAL', ?)
    ORDER BY r.line_date, r.created_at
  `).all(tenantId, period, TIMING_STATUS) as any[]
  const groups = new Map<string, any>()
  for (const r of records) {
    const key = `${r.type}|${r.status}`
    const g = groups.get(key) ?? { type: r.type, label: ADJ_TYPES[r.type as AdjType]?.label ?? r.type, status: r.status, count: 0, total: 0, records: [] as any[] }
    g.count++
    g.total = r2(g.total + Number(r.amount))
    g.records.push({
      id: r.id, accountCode: r.reconCode, date: r.line_date, amount: r.amount, effect: r.effect, direction: r.direction,
      description: r.description, statementRef: r.statement_ref, statementLineNo: r.statement_line_no, reason: r.reason, confidence: r.confidence,
      debitAccount: r.debitAccount ?? (r.source_doc_type === 'INVOICE' ? 'รับชำระใบแจ้งหนี้ (บริการเดิม)' : r.source_doc_type === 'SUPPLIER_PAYMENT_VOID' ? 'ยกเลิกใบจ่ายเงินที่ลงซ้ำ (บริการเดิม)' : null),
      creditAccount: r.creditAccount ?? null, journalEntryId: r.journal_entry_id, entryNumber: r.entryNumber ?? null, status: r.status,
      submittedBy: r.submitted_by_name || r.submitted_by, approvalRequestNumber: r.approvalRequestNumber ?? null,
    })
    groups.set(key, g)
  }
  const unposts = db.prepare(`SELECT entry_number AS entryNumber, entry_date AS entryDate, reason, unposted_by AS unpostedBy, unposted_at AS unpostedAt,
      total_debit AS totalDebit FROM journal_unposts
    WHERE tenant_id = ? AND (date(entry_date) BETWEEN ? AND ? OR date(unposted_at, '+7 hours') BETWEEN ? AND ?) ORDER BY unposted_at DESC`)
    .all(tenantId, start, end, start, end)
  return {
    period, start, end, periodStatus: (tp?.status ?? 'NONE') as 'OPEN' | 'CLOSED' | 'FILING' | 'NONE', taxPeriodId,
    entityType: co?.entity_type ?? null,
    canApprove: isGm(user),
    recon: reconciliationStatus(tenantId, period),
    groups: [...groups.values()].sort((a, b) => (a.type === 'TIMING' ? 1 : 0) - (b.type === 'TIMING' ? 1 : 0)),
    checklist: closeChecklist(tenantId, period),
    unposts,
    today: thaiDateStr(),
  }
}
