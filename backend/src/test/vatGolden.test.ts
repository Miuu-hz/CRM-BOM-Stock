import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import Database from 'better-sqlite3'

/**
 * ตาข่ายนิรภัยของงานยกเครื่อง VAT — ล็อกยอดของเอกสารจริง 857 ใบใน dev.db ไว้
 *
 * งานนี้แตะสูตรคิดภาษี 16 จุดและเพิ่มคอลัมน์ 8 ตัว ความเสี่ยงที่ใหญ่ที่สุดคือ
 * migration หรือ backfill ไปเขียนทับยอดของเอกสารเก่า ซึ่งผูกกับ journal
 * และงวดที่ปิดบัญชีไปแล้ว — เทสต์นี้จะแดงทันทีถ้ามีอะไรไปแตะ
 *
 * อ่าน dev.db ตรง ๆ (ไม่ใช่ test.db ที่ vitest ใช้) แบบ readonly
 * สร้าง fixture ใหม่เมื่อยอดเปลี่ยน "โดยตั้งใจ" เท่านั้น: node /tmp/gen.js
 */
const DEV_DB = '/opt/crm/backend/dev.db'
// fixture ไม่ได้อยู่ใน git (เป็นยอดขายจริงของลูกค้า) — เครื่องที่ไม่มีไฟล์ให้ข้ามเทสต์นี้
const FIXTURE = join(__dirname, 'fixtures', 'vatGolden.json')
const golden: Record<string, any[]> = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : {}
const rows = (t: string) => golden[t] ?? []
// fixture ไม่ได้เก็บสถานะบิล — ใช้เวลาที่เขียนไฟล์เป็นเวลาถ่าย snapshot แทน
// บิล POS ที่ปิด (closed_at) หลังเวลานี้ = ตอนถ่ายยังเป็นบิล OPEN ที่กำลังเพิ่มรายการอยู่
// ยอดโตขึ้นได้ตามปกติ ไม่ใช่การแก้ยอดเอกสารเก่า (เช่น POS-2026-00044: 223 → 374)
// ponytail: พึ่ง mtime ของไฟล์ — ถ้าก๊อป fixture แบบไม่รักษา mtime ให้เพิ่ม status ลง fixture ตอนสร้างใหม่
const SNAPSHOT_AT = existsSync(FIXTURE) ? statSync(FIXTURE).mtimeMs : 0
/** closed_at มีทั้ง ISO (มี Z) และ datetime('now') ของ SQLite (UTC ไม่มี Z) */
const parseUtc = (v: string) => Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : v.replace(' ', 'T') + 'Z')
const openAtSnapshot = (r: any) => r.status === 'OPEN' || (r.closed_at != null && parseUtc(r.closed_at) > SNAPSHOT_AT)

describe.skipIf(!existsSync(DEV_DB) || !existsSync(FIXTURE))('ยอดของเอกสารเก่าต้องไม่ขยับ', () => {
  const db = new Database(DEV_DB, { readonly: true })

  for (const table of Object.keys(golden)) {
    it(`${table} — ${rows(table).length} ใบ`, () => {
      const live = db.prepare(
        // บิล POS ที่ยังเปิดอยู่ตอนถ่าย snapshot เพิ่มรายการได้ตามปกติ — ล็อกเฉพาะบิลที่ปิดก่อนถ่าย
        `SELECT id, subtotal, tax_rate, tax_amount, total_amount, ${table === 'pos_running_bills' ? 'status, closed_at' : 'NULL AS status, NULL AS closed_at'} FROM ${table}`
      ).all() as any[]
      const byId = new Map(live.map(r => [r.id, r]))

      const changed: string[] = []
      for (const g of rows(table)) {
        const cur = byId.get(g.id)
        if (!cur) { changed.push(`${g.doc_number}: หายไปจากฐานข้อมูล`); continue }
        if (openAtSnapshot(cur)) continue
        for (const f of ['subtotal', 'tax_rate', 'tax_amount', 'total_amount'] as const) {
          if (Math.abs((cur[f] ?? 0) - (g[f] ?? 0)) > 0.005) {
            changed.push(`${g.doc_number}.${f}: ${g[f]} → ${cur[f]}`)
          }
        }
      }
      expect(changed, `เอกสารเก่าถูกแก้ยอด:\n${changed.join('\n')}`).toEqual([])
    })
  }

  it('ทุกเอกสาร: subtotal + ภาษี = total (ยืนยันแล้วว่าจริงทั้ง 857 ใบวันนี้)', () => {
    const bad: string[] = []
    for (const table of Object.keys(golden)) {
      for (const g of rows(table)) {
        // pos_running_bills มีค่าบริการแยกอยู่นอก subtotal จึงไม่เข้าสูตรนี้
        if (table === 'pos_running_bills') continue
        if (Math.abs((g.subtotal || 0) + (g.tax_amount || 0) - (g.total_amount || 0)) > 0.005) {
          bad.push(`${table} ${g.doc_number}: ${g.subtotal} + ${g.tax_amount} != ${g.total_amount}`)
        }
      }
    }
    expect(bad, bad.join(' | ')).toEqual([])
  })
})
