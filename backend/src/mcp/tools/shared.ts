import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import db from '../../db/sqlite'
import { approvalDenyReason } from '../../services/approvalGate.service'

export type ToolResult = { content: Array<{ type: 'text'; text: string }> }

export const ok = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
})

export interface ApprovalCheckResult { allowed: boolean; message?: string }

/**
 * สิทธิ์อนุมัติเอกสาร — ห่อ approvalDenyReason() ตัวเดียวกับที่ REST ใช้
 * เดิมที่นี่เขียนเกณฑ์ซ้ำเอง (role -> auto_approve_threshold -> can_approve -> approval_limit)
 * ซึ่งตรงกับ REST อยู่แล้ววันนี้ แต่ถ้าวันหน้าแก้ฝั่งเดียวจะหย่อนไม่เท่ากันอีก
 * — ยุบเหลือแหล่งเดียว 2026-09-14
 */
export function checkApprovalPermission(
  tenantId: string, userId: string, role: string, moduleType: string, amount: number
): ApprovalCheckResult {
  const label = moduleType === 'purchase_order' ? 'PO' : 'PR'
  const denied = approvalDenyReason(
    tenantId, { userId, role },
    moduleType as 'purchase_request' | 'purchase_order',
    amount, label
  )
  return denied ? { allowed: false, message: denied } : { allowed: true }
}

/** เช็คสิทธิ์แบบไม่ดูวงเงิน (ใช้กับ reject ที่ REST ไม่เช็ค approval_limit) — ส่ง amount 0 เข้าไป */
export function checkCanApprove(tenantId: string, userId: string, role: string, moduleType: string): ApprovalCheckResult {
  return checkApprovalPermission(tenantId, userId, role, moduleType, 0)
}

// ── DB-Anchored Token Intersection ────────────────────────────────────────────
// existsFn  — return true if a substring appears in at least one relevant row
// searchFn  — execute the real query with the given tokens and mode

export function anchorTokens(
  q: string,
  existsFn: (sub: string) => boolean,
  searchFn: (tokens: string[], mode: 'and' | 'or') => unknown[]
): unknown[] {
  // Generate substrings length 2–8, sorted longest-first
  const subs: string[] = []
  for (let len = Math.min(8, q.length); len >= 2; len--) {
    for (let i = 0; i <= q.length - len; i++) subs.push(q.slice(i, i + len))
  }
  const validSubs = [...new Set(subs)].filter(existsFn)
  if (validSubs.length === 0) return []

  // Greedy non-overlapping token selection
  const tokens: string[] = []
  const usedPos = new Set<number>()
  for (const sub of validSubs) {
    const pos = q.indexOf(sub)
    if (pos === -1) continue
    const overlaps = Array.from({ length: sub.length }, (_, i) => i).some(i => usedPos.has(pos + i))
    if (!overlaps) {
      tokens.push(sub)
      for (let i = 0; i < sub.length; i++) usedPos.add(pos + i)
    }
  }
  if (tokens.length === 0) return []

  // AND intersection first (precision). If no match, fall back to longest token only —
  // avoids noise tokens (e.g. "หม" from "ไหม") polluting an OR-expanded result set.
  const andResult = searchFn(tokens, 'and')
  if (andResult.length > 0) return andResult
  return searchFn([tokens[0]], 'and')
}

export function dbAnchoredSearch(
  query: string,
  existsFn: (sub: string) => boolean,
  searchFn: (tokens: string[], mode: 'and' | 'or') => unknown[]
): unknown[] {
  if (!query || query.trim() === '') return searchFn([''], 'or')
  const q = query.trim()

  // Step 1: exact full-query match
  const exact = searchFn([q], 'and')
  if (exact.length > 0) return exact

  // Step 2: if query has spaces, try each space-separated segment first.
  // "หมูสับ มีกี่โล" → try "หมูสับ" → finds results without processing noise words.
  if (q.includes(' ')) {
    const segments = q.split(/\s+/).filter(s => s.length >= 2)
    for (const seg of segments) {
      const segExact = searchFn([seg], 'and')
      if (segExact.length > 0) return segExact
      const segResult = anchorTokens(seg, existsFn, searchFn)
      if (segResult.length > 0) return segResult
    }
  }

  // Step 3: full-query DB-anchored token intersection
  return anchorTokens(q, existsFn, searchFn)
}

// Build a WHERE clause from tokens with the given mode
export function tokenWhere(col: string, tokens: string[], mode: 'and' | 'or'): string {
  const clause = tokens.map(() => `${col} LIKE ?`).join(` ${mode.toUpperCase()} `)
  return `(${clause})`
}

export function tokenParams(tokens: string[]): string[] {
  return tokens.map(t => `%${t}%`)
}

// ── จับคู่สินค้าในสต็อก: ตรงเป๊ะเท่านั้นถึงผูกให้ ────────────────────────────────
// เจ้าของสั่งไว้ 2026-08-18 (เคส "ข้าวโพด" ไปเข้า "สลัดทูน่าข้าวโพด") ว่า AI ห้ามเดาผูกเอง
// ตั้งแต่ 2026-09-14 ใช้กติกาเดียวกันทั้งสายซื้อและสายขาย:
//   ชื่อตรงเป๊ะ (ตัดช่องว่าง/ตัวพิมพ์) → ผูกให้เลย
//   ไม่ตรงเป๊ะ → ไม่ผูก คืนตัวเลือกให้ผู้ใช้เลือกผ่าน bind_document_item ก่อนยืนยันเอกสาร
export interface StockCandidate {
  id: string
  name: string
  sku: string | null
  /** หน่วยที่ใช้บนเอกสาร (คอลัมน์ unit เดิม เช่น kg) — คนละตัวกับหน่วยที่ quantity เก็บอยู่ */
  unit: string
  /** หน่วยฐานที่ stock_items.quantity เก็บจริง (เช่น g) */
  baseUnit: string
  quantity: number
}
export interface StockMatch {
  exact: StockCandidate | null
  candidates: StockCandidate[]
}

const normName = (s: string) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * @param rawOnly true = เอาเฉพาะวัตถุดิบ (สายซื้อ) ไม่เอาเมนูที่ขายหน้าร้าน
 */
export function matchStockItem(tenantId: string, description: string, rawOnly = false): StockMatch {
  const want = normName(description)
  if (!want) return { exact: null, candidates: [] }

  const rawFilter = rawOnly ? `AND LOWER(category) IN ('raw','raw_material','material','wip')` : ''
  const trimmed = description.trim()
  const rows = db.prepare(`
    SELECT id, name, sku, unit, COALESCE(base_unit, unit) AS baseUnit, quantity
    FROM stock_items
    WHERE tenant_id = ? AND status = 'ACTIVE' AND name LIKE ? ${rawFilter}
    ORDER BY CASE WHEN LOWER(TRIM(name)) = ? THEN 0 WHEN name LIKE ? THEN 1 ELSE 2 END, length(name)
    LIMIT 8
  `).all(tenantId, `%${trimmed}%`, want, `${trimmed}%`) as StockCandidate[]

  const exactRows = rows.filter(r => normName(r.name) === want)
  // ชื่อตรงเป๊ะแต่มีมากกว่า 1 ตัว = ยังเลือกแทนคนไม่ได้ ต้องให้คนชี้
  const exact = exactRows.length === 1 ? exactRows[0] : null
  return { exact, candidates: rows }
}

/** แถวสำหรับโชว์เป็นตารางกลับไปให้ผู้ใช้ตรวจก่อนยืนยัน */
export function bindingRow(description: string, match: StockMatch, unit: string) {
  return {
    รายการที่สั่ง: description,
    หน่วย: unit,
    ผูกกับสินค้า: match.exact ? match.exact.name : null,
    คงเหลือ: match.exact ? `${match.exact.quantity} ${match.exact.baseUnit}` : null,
    สถานะ: match.exact ? 'ผูกแล้ว (ชื่อตรงเป๊ะ)' : 'ยังไม่ผูก — ต้องเลือกก่อนยืนยัน',
    ตัวเลือก: match.exact ? undefined : match.candidates.map(c => ({
      stock_item_id: c.id, ชื่อ: c.name, คงเหลือ: `${c.quantity} ${c.baseUnit}`,
    })),
  }
}

// ── Document References & Polymorphic Evidence Attachments ────────────────────
export const REF_TYPE_DOCS: Record<string, { table: string; numCol?: string; label: string }> = {
  PURCHASE_ORDER: { table: 'purchase_orders', numCol: 'po_number', label: 'ใบสั่งซื้อ' },
  PURCHASE_REQUEST: { table: 'purchase_requests', numCol: 'pr_number', label: 'ใบขอซื้อ' },
  GOODS_RECEIPT: { table: 'goods_receipts', numCol: 'gr_number', label: 'ใบรับสินค้า' },
  PURCHASE_INVOICE: { table: 'purchase_invoices', numCol: 'invoice_number', label: 'ใบแจ้งหนี้เจ้าหนี้' },
  SUPPLIER_PAYMENT: { table: 'supplier_payments', numCol: 'payment_number', label: 'ใบสำคัญจ่าย' },
  INVOICE: { table: 'invoices', numCol: 'invoice_number', label: 'ใบแจ้งหนี้/ใบกำกับภาษี' },
  RECEIPT: { table: 'receipts', numCol: 'receipt_number', label: 'ใบเสร็จรับเงิน' },
  POS_PAYMENT: { table: 'pos_payments', numCol: undefined, label: 'รายการจ่ายเงิน POS' },
  STOCK_ADJUSTMENT: { table: 'stock_adjustments', numCol: 'adjustment_number', label: 'ใบปรับสต็อก' },
}

export function resolveDocRef(
  tenantId: string,
  docType: string,
  docIdOrNum: string
): { id: string; doc_num: string; table: string } | null {
  const trimmed = docIdOrNum.trim()
  if (!trimmed) return null

  if (docType === 'POS_PAYMENT') {
    const direct = db.prepare('SELECT id FROM pos_payments WHERE id = ? AND tenant_id = ?').get(trimmed, tenantId) as any
    if (direct) return { id: direct.id, doc_num: direct.id, table: 'pos_payments' }
    const fromBill = db.prepare(`
      SELECT p.id, b.bill_number FROM pos_payments p
      JOIN pos_running_bills b ON p.bill_id = b.id
      WHERE (b.bill_number = ? OR b.id = ?) AND p.tenant_id = ?
      LIMIT 1
    `).get(trimmed, trimmed, tenantId) as any
    if (fromBill) return { id: fromBill.id, doc_num: fromBill.bill_number || fromBill.id, table: 'pos_payments' }
    return null
  }

  const info = REF_TYPE_DOCS[docType]
  if (!info) return null

  if (info.numCol) {
    const row = db.prepare(`
      SELECT id, ${info.numCol} AS doc_num FROM ${info.table}
      WHERE (id = ? OR ${info.numCol} = ?) AND tenant_id = ?
      LIMIT 1
    `).get(trimmed, trimmed, tenantId) as any
    if (row) return { id: row.id, doc_num: row.doc_num || row.id, table: info.table }
  } else {
    const row = db.prepare(`
      SELECT id FROM ${info.table}
      WHERE id = ? AND tenant_id = ?
      LIMIT 1
    `).get(trimmed, tenantId) as any
    if (row) return { id: row.id, doc_num: row.id, table: info.table }
  }

  return null
}

const ATTACHMENT_DIR = process.env.ATTACHMENT_STORAGE_DIR || path.resolve(process.cwd(), 'storage/payment-attachments')

export function saveBase64Attachment(params: {
  tenantId: string
  userId: string
  refType: string
  refId: string
  base64Data: string
  fileName?: string
  mimeType?: string
}): {
  id: string
  ref_type: string
  ref_id: string
  file_path: string
  storage_file_name: string
  original_name: string
  file_size: number
  created_at: string
} {
  const { tenantId, userId, refType, refId, base64Data, fileName, mimeType } = params
  if (!fs.existsSync(ATTACHMENT_DIR)) {
    fs.mkdirSync(ATTACHMENT_DIR, { recursive: true })
  }

  let cleanBase64 = base64Data.trim()
  let detectedMime = mimeType
  let ext = '.jpg'

  const match = cleanBase64.match(/^data:([^;]+);base64,(.*)$/)
  if (match) {
    detectedMime = match[1]
    cleanBase64 = match[2]
  }

  if (detectedMime) {
    if (detectedMime.includes('png')) ext = '.png'
    else if (detectedMime.includes('jpeg') || detectedMime.includes('jpg')) ext = '.jpg'
    else if (detectedMime.includes('webp')) ext = '.webp'
    else if (detectedMime.includes('pdf')) ext = '.pdf'
  } else if (fileName) {
    const fileExt = path.extname(fileName).toLowerCase()
    if (fileExt && ['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.gif'].includes(fileExt)) {
      ext = fileExt
    }
  }

  const safeRefType = refType.replace(/[^a-zA-Z0-9_-]/g, '')
  const safeRefId = refId.replace(/[^a-zA-Z0-9_-]/g, '')
  const storageFileName = `pay-${safeRefType}-${safeRefId}-${Date.now()}${ext}`
  const targetPath = path.join(ATTACHMENT_DIR, storageFileName)

  const buffer = Buffer.from(cleanBase64, 'base64')
  fs.writeFileSync(targetPath, buffer)

  const attachmentId = randomUUID().replace(/-/g, '').substring(0, 25)
  const now = new Date().toISOString()
  const originalName = fileName || `evidence_${safeRefType}_${safeRefId}${ext}`

  db.prepare(`
    INSERT INTO payment_attachments (id, tenant_id, ref_type, ref_id, file_path, original_name, file_size, uploaded_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(attachmentId, tenantId, refType, refId, storageFileName, originalName, buffer.length, userId, now)

  return {
    id: attachmentId,
    ref_type: refType,
    ref_id: refId,
    file_path: `/storage/payment-attachments/${storageFileName}`,
    storage_file_name: storageFileName,
    original_name: originalName,
    file_size: buffer.length,
    created_at: now,
  }
}
