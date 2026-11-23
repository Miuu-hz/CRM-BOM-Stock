import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// ทุกชนิดเอกสารที่ backend ออกเลขผ่าน formatDocumentNumber ต้องตั้งรูปแบบได้ในหน้า Settings
// (เคยมีให้ตั้งแค่ 16 จาก 24 ชนิด: ใบค้างส่ง/ใบคืนสินค้า/งานจ้างผลิต/WHT ฯลฯ ตั้งไม่ได้เลย)
// CUSTOMER/SUPPLIER = รหัสลูกค้า/ผู้ขาย ไม่ใช่เลขเอกสาร จึงไม่อยู่ในหน้านี้
const NOT_DOCUMENTS = new Set(['CUSTOMER', 'SUPPLIER'])
const SRC = path.resolve(__dirname, '..')
const SETTINGS = path.resolve(__dirname, '../../../frontend/src/pages/settings/DocumentNumberSettings.tsx')

const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [path.join(dir, e.name)] : [])

describe('หน้าตั้งค่าเลขเอกสารครอบคลุมทุกชนิดที่ระบบออกเลข', () => {
  it('ทุก docType ใน formatDocumentNumber(...) และ docTypeMap ของจัดซื้อ อยู่ใน DOC_TYPES ของหน้า Settings', () => {
    const issued = new Set<string>()
    for (const f of walk(SRC)) {
      const s = fs.readFileSync(f, 'utf8')
      for (const m of s.matchAll(/formatDocumentNumber\(\s*[^,]+,\s*[^,]+,\s*'([A-Z_]+)'/g)) issued.add(m[1])
      const map = s.match(/const docTypeMap: Record<string, string> = \{([^}]+)\}/)
      if (map) for (const m of map[1].matchAll(/'([A-Z_]+)'/g)) issued.add(m[1])
      for (const m of s.matchAll(/formatDocumentNumber\(\s*'[^']*',\s*[^,]+,\s*'([A-Z_]+)'/g)) issued.add(m[1])
    }
    expect(issued.size).toBeGreaterThan(15)   // regex ยังจับได้จริง
    const ui = fs.readFileSync(SETTINGS, 'utf8')
    const listed = new Set([...ui.matchAll(/value: '([A-Z_]+)'/g)].map(m => m[1]))
    const missing = [...issued].filter(d => !NOT_DOCUMENTS.has(d) && !listed.has(d))
    expect(missing).toEqual([])
  })
})
