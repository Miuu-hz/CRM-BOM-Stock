import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

// ข้อความไทยที่ถูกบันทึกด้วย encoding ผิดจะกลายเป็น "????" หรือ U+FFFD
// เคยหลุดขึ้น production มาแล้ว (ข้อความวงเงินอนุมัติ, หน้าหมวดวัตถุดิบ 2026-10-05) — เทสต์นี้กันก่อน deploy
// ponytail: สแกนทั้ง src ทุกครั้ง (~ร้อยไฟล์ เร็วพอ); ถ้าวันหน้ามี "????" ที่ตั้งใจจริง ให้เพิ่มไฟล์นั้นใน ALLOW
const ROOT = join(__dirname)
const ALLOW = new Set<string>(['textEncoding.guard.test.ts'])  // ไฟล์นี้เองมีตัวอย่างในคอมเมนต์
const BROKEN = /\?{4,}|\uFFFD/

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|json)$/.test(name)) out.push(p)
  }
  return out
}

describe('ข้อความในซอร์สต้องไม่พังจาก encoding', () => {
  it('ไม่มี "????" หรือ U+FFFD ในไฟล์ .ts/.tsx/.json ใต้ src', () => {
    const hits: string[] = []
    for (const file of walk(ROOT)) {
      const rel = relative(ROOT, file)
      if (ALLOW.has(rel)) continue
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (BROKEN.test(line)) hits.push(`${rel}:${i + 1}  ${line.trim().slice(0, 80)}`)
      })
    }
    expect(hits, `พบข้อความที่พัง:\n${hits.join('\n')}`).toEqual([])
  })
})
