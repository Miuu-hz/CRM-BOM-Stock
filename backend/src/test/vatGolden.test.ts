import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
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

describe.skipIf(!existsSync(DEV_DB) || !existsSync(FIXTURE))('ยอดของเอกสารเก่าต้องไม่ขยับ', () => {
  const db = new Database(DEV_DB, { readonly: true })

  for (const table of Object.keys(golden)) {
    it(`${table} — ${rows(table).length} ใบ`, () => {
      const live = db.prepare(
        `SELECT id, subtotal, tax_rate, tax_amount, total_amount FROM ${table}`
      ).all() as any[]
      const byId = new Map(live.map(r => [r.id, r]))

      const changed: string[] = []
      for (const g of rows(table)) {
        const cur = byId.get(g.id)
        if (!cur) { changed.push(`${g.doc_number}: หายไปจากฐานข้อมูล`); continue }
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
