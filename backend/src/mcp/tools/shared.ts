export type ToolResult = { content: Array<{ type: 'text'; text: string }> }

export const ok = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
})

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
