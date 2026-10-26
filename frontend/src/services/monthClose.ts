import api from './api'

// ─────────────────────────────────────────────────────────────────────────
// ปิดบัญชีรายเดือน (A6) — types + client ตาม CONTRACTS.md §A3/§A6 และบรีฟ W7
// ─────────────────────────────────────────────────────────────────────────

export interface ClosePackLine {
  lineId: string
  date: string
  entryNumber: string
  journalEntryId: string
  source: string
  sourceType: string
  sourceNumber: string | null
  counterparty: string | null
  description: string
  in: number
  out: number
  balance: number
  posted: boolean
}

export interface ClosePackAccount {
  accountId: string
  code: string
  name: string
  kind: 'BANK' | 'CASH'
  bankName: string | null
  accountNumber: string | null
  opening: number
  closing: number
  pending: number
  timing?: number
  statement: number | null
  lines: ClosePackLine[]
}

export interface ClosePackHeaderBalance { code: string; name: string; balance: number }
export interface ClosePackChartAccount { code: string; name: string; type: string; category: string | null }
export interface ClosePackContact { id: string; code: string; name: string; taxId: string | null }
export interface ClosePackOpenInvoice { id: string; number: string; party: string; date: string; dueDate: string; balance: number }
// TIMING (รายการระหว่างทาง) ไม่มี debit/credit — ไม่ลงบัญชี
export interface ClosePackType { type: string; label: string; debit: string; credit: string; needs: string[]; allowedAccounts: string[]; note: string }
export interface ClosePackExistingAdjustment {
  type: string; date: string; amount: number; statementRef: string | null; statementLineNo: number | null
  status: string; entryNumber: string | null
}

export interface ClosePack {
  version: number
  period: string
  start: string
  end: string
  generatedAt: string
  company: { name: string; taxId: string | null; entityType: string | null; vatRegistered: boolean }
  instructions: string
  accounts: ClosePackAccount[]
  headerBalances: ClosePackHeaderBalance[]
  chart: ClosePackChartAccount[]
  contacts: { suppliers: ClosePackContact[]; customers: ClosePackContact[] }
  openInvoices: { sales: ClosePackOpenInvoice[]; purchase: ClosePackOpenInvoice[] }
  types: ClosePackType[]
  submitSchema: { lineFields: string[]; example: Record<string, unknown> }
  existingAdjustments: ClosePackExistingAdjustment[]
}

export interface ReconRow {
  accountId: string
  code: string
  name: string
  kind: 'BANK' | 'CASH'
  bankName: string | null
  accountNumber: string | null
  book: number
  pending: number
  /** รายการระหว่างทาง (ไม่ลงบัญชี) — ยังไม่ post เข้าบัญชี แต่ต้องรวมในสมการกระทบยอด */
  timing: number
  statement: number | null
  statementHash: string | null
  difference: number | null
  reconciled: boolean
  submittedAt: string | null
  submittedBy: string | null
  counts: { draft: number; pendingApproval: number; posted: number; discarded: number; noted: number }
}

export interface GroupRecord {
  id: string
  accountCode: string
  date: string
  amount: number
  effect: number
  direction: string | null
  description: string
  statementRef: string | null
  statementLineNo: number | null
  reason: string | null
  confidence: number | null
  debitAccount: string
  creditAccount: string
  journalEntryId: string | null
  entryNumber: string | null
  status: string
  submittedBy: string | null
  approvalRequestNumber: string | null
}

// สถานะกลุ่ม DRAFT (รอทบทวน) | PENDING_APPROVAL (ส่งขออนุมัติแล้ว) | NOTED (กลุ่ม TIMING — ไม่ลงบัญชี อธิบายผลต่างอย่างเดียว)
export interface MonthCloseGroup { type: string; label: string; status: string; count: number; total: number; records: GroupRecord[] }

export interface UnpostRow { entryNumber: string; entryDate: string; reason: string; unpostedBy: string; unpostedAt: string; totalDebit: number }

export interface ChecklistItem {
  id: number
  key: string
  title: string
  severity: 'block' | 'warn'
  status: 'pass' | 'warn' | 'block' | 'na'
  detail: string
  count?: number
  amount?: number
  link?: string
  daily: boolean
}

export interface ChecklistResult {
  period: string
  start: string
  end: string
  periodStatus: 'OPEN' | 'CLOSED' | 'FILING' | 'NONE'
  items: ChecklistItem[]
  passed: number
  total: number
  blocks: number
  warns: number
  label: string
  canClose: boolean
}

export interface MonthCloseStatus {
  period: string
  start: string
  end: string
  periodStatus: 'OPEN' | 'CLOSED' | 'FILING' | 'NONE'
  taxPeriodId: string | null
  entityType: string | null
  canApprove: boolean
  recon: ReconRow[]
  groups: MonthCloseGroup[]
  checklist: ChecklistResult
  unposts: UnpostRow[]
}

export interface ApproveGroupResult { mode: 'posted' | 'requested'; posted?: number; requestNumber?: string }

export const monthCloseApi = {
  getStatus: (period: string) =>
    api.get<{ success: boolean; data: MonthCloseStatus }>(`/month-close/${period}/status`),
  getPack: (period: string) =>
    api.get<{ success: boolean; data: ClosePack }>(`/month-close/${period}/pack`),
  approveGroup: (period: string, type: string, recordIds?: string[]) =>
    api.post<{ success: boolean; data: ApproveGroupResult }>(`/month-close/${period}/approve`, { type, recordIds }),
  discardRecord: (id: string, reason: string) =>
    api.post<{ success: boolean }>(`/month-close/records/${id}/discard`, { reason }),
}
