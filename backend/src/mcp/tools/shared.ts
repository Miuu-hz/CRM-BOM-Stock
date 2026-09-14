import db from '../../db/sqlite'

export type ToolResult = { content: Array<{ type: 'text'; text: string }> }

export const ok = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
})

export interface ApprovalCheckResult { allowed: boolean; message?: string }

// เลียนแบบ permission check ใน REST routes (purchase-request.routes.ts, purchaseOrder.routes.ts)
// ป้องกัน MCP tool อนุมัติเอกสารโดยข้ามวงเงิน/สิทธิ์อนุมัติที่ผู้ใช้ตั้งไว้
export function checkApprovalPermission(
  tenantId: string, userId: string, role: string, moduleType: string, amount: number
): ApprovalCheckResult {
  if (role === 'MASTER' || role === 'ADMIN') return { allowed: true }

  const setting = db.prepare(
    `SELECT * FROM approval_settings WHERE tenant_id = ? AND role = ? AND module_type = ?`
  ).get(tenantId, role, moduleType) as any
  const autoApprove = setting && setting.auto_approve_threshold > 0 && amount <= setting.auto_approve_threshold
  if (autoApprove) return { allowed: true }

  const perm = db.prepare(
    `SELECT * FROM user_approval_permissions WHERE tenant_id = ? AND user_id = ? AND module_type = ?`
  ).get(tenantId, userId, moduleType) as any
  if (!perm || perm.can_approve !== 1) {
    return { allowed: false, message: 'ไม่มีสิทธิ์อนุมัติ กรุณาติดต่อ Admin' }
  }
  if (perm.can_approve_unlimited !== 1 && perm.approval_limit > 0 && amount > perm.approval_limit) {
    return {
      allowed: false,
      message: `วงเงินอนุมัติของคุณไม่เพียงพอ (limit: ${perm.approval_limit.toLocaleString()}, ยอด: ${amount.toLocaleString()})`,
    }
  }
  return { allowed: true }
}

// เช็คสิทธิ์แบบไม่มีวงเงิน (ใช้กับ reject ที่ REST ไม่เช็ค approval_limit)
export function checkCanApprove(tenantId: string, userId: string, role: string, moduleType: string): ApprovalCheckResult {
  if (role === 'MASTER' || role === 'ADMIN') return { allowed: true }
  const perm = db.prepare(
    `SELECT * FROM user_approval_permissions WHERE tenant_id = ? AND user_id = ? AND module_type = ?`
  ).get(tenantId, userId, moduleType) as any
  if (!perm || perm.can_approve !== 1) {
    return { allowed: false, message: 'ไม่มีสิทธิ์ กรุณาติดต่อ Admin' }
  }
  return { allowed: true }
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

  const rawFilter = rawOnly ? `AND category IN ('raw','RAW_MATERIAL','material','wip')` : ''
  const rows = db.prepare(`
    SELECT id, name, sku, unit, COALESCE(base_unit, unit) AS baseUnit, quantity
    FROM stock_items
    WHERE tenant_id = ? AND status = 'ACTIVE' AND name LIKE ? ${rawFilter}
    ORDER BY CASE WHEN name LIKE ? THEN 0 ELSE 1 END, length(name)
    LIMIT 8
  `).all(tenantId, `%${description.trim()}%`, `${description.trim()}%`) as StockCandidate[]

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
