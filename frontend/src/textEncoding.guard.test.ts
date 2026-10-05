import { describe, it, expect } from 'vitest'

// ข้อความไทยที่ถูกบันทึกด้วย encoding ผิดจะกลายเป็น "????" หรือ U+FFFD
// เคยหลุดขึ้น production มาแล้ว (หน้าหมวดวัตถุดิบ 2026-10-05) — เทสต์นี้กันก่อน deploy
// ใช้ import.meta.glob ของ Vite อ่านซอร์สเป็นข้อความ (frontend ไม่มี type ของ Node fs)
const files = import.meta.glob(['./**/*.{ts,tsx,json}', '!./**/node_modules/**'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const ALLOW = new Set<string>(['./textEncoding.guard.test.ts'])  // ไฟล์นี้เองมีตัวอย่างในคอมเมนต์
const BROKEN = /\?{4,}|\uFFFD/

describe('ข้อความในซอร์สต้องไม่พังจาก encoding', () => {
  it('ไม่มี "????" หรือ U+FFFD ในไฟล์ .ts/.tsx/.json ใต้ src', () => {
    expect(Object.keys(files).length).toBeGreaterThan(50)
    const hits: string[] = []
    for (const [file, text] of Object.entries(files)) {
      if (ALLOW.has(file)) continue
      text.split('\n').forEach((line: string, i: number) => {
        if (BROKEN.test(line)) hits.push(`${file}:${i + 1}  ${line.trim().slice(0, 80)}`)
      })
    }
    expect(hits, `พบข้อความที่พัง:\n${hits.join('\n')}`).toEqual([])
  })
})
