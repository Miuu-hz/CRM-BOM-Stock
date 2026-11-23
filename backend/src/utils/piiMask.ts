// กติกามาสก์ข้อมูลส่วนตัว (PII) — คำนวณฝั่ง backend ตอนรับข้อมูลเข้า (ingest)
// อ้างอิง docs/contracts/online-orders.md ข้อ 1

/**
 * มาสก์ชื่อผู้รับ: trim, ยุบช่องว่างซ้อน, มาสก์ทีละคำ (นับตาม code point ด้วย Array.from)
 * - คำยาว >= 4 code point → เก็บ len-3 ตัวแรก + 'xxx'
 * - คำยาว 1–3 code point → ตัวแรก + 'xxx'
 * - ว่าง/null/undefined → ''
 */
export function maskName(s: string | null | undefined): string {
  if (s == null) return ''
  const normalized = String(s).trim().replace(/\s+/g, ' ')
  if (!normalized) return ''
  return normalized
    .split(' ')
    .map((word) => {
      const cps = Array.from(word)
      if (cps.length >= 4) return cps.slice(0, cps.length - 3).join('') + 'xxx'
      return cps[0] + 'xxx'
    })
    .join(' ')
}

/**
 * มาสก์เบอร์โทร: ถ้าไม่มีตัวเลข → คืนค่าเดิม;
 * ไม่งั้นแทนตัวเลข 3 ตัวสุดท้ายด้วย 'x' โดยคงอักขระอื่นไว้ตำแหน่งเดิม
 */
export function maskPhone(s: string | null | undefined): string {
  if (s == null) return ''
  const str = String(s)
  const chars = Array.from(str)
  const digitIndices: number[] = []
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    if (ch >= '0' && ch <= '9') digitIndices.push(i)
  }
  if (digitIndices.length === 0) return str
  const toMask = digitIndices.slice(-3)
  for (const idx of toMask) chars[idx] = 'x'
  return chars.join('')
}

// คำนำหน้าตัวเลขที่ไม่ใช่บ้านเลขที่ (ตามสัญญาข้อ 1)
const NON_HOUSE_PREFIX_RE = /(?:หมู่ที่|หมู่|ม\.|ซอย|ซ\.|ถนน|ถ\.|ต\.|อ\.|จ\.|ชั้น|ห้อง)\s*$/

/**
 * มาสก์ที่อยู่: ซ่อนเฉพาะบ้านเลขที่แทนด้วย 'xxx' ที่เหลือแสดงครบ
 * - ถ้ามีคำว่า 'เลขที่' ให้ใช้ตัวเลข (\d+(?:[/-]\d+)*) หลังคำนั้นก่อน
 * - ไม่งั้นหาตัวเลขชุดแรกที่ไม่ได้ตามหลังคำนำหน้า ม./หมู่/หมู่ที่/ซ./ซอย/ถ./ถนน/ต./อ./จ./ชั้น/ห้อง
 *   และไม่ใช่รหัสไปรษณีย์ 5 หลัก
 * - ไม่มีบ้านเลขที่ → คืนค่าเดิม
 */
export function maskAddress(s: string | null | undefined): string {
  if (s == null) return ''
  const str = String(s)
  if (!str) return ''

  // 1) ถ้ามีคำว่า "เลขที่" ให้มาสก์ตัวเลขหลังคำนั้นก่อน
  const explicitMatch = /(เลขที่\s*)(\d+(?:[/-]\d+)*)/.exec(str)
  if (explicitMatch && explicitMatch.index !== undefined) {
    const numStart = explicitMatch.index + explicitMatch[1].length
    const numEnd = numStart + explicitMatch[2].length
    return str.slice(0, numStart) + 'xxx' + str.slice(numEnd)
  }

  // 2) หาตัวเลขชุดแรกที่ไม่ตามหลังคำนำหน้าต้องห้ามและไม่ใช่รหัสไปรษณีย์ 5 หลัก
  const numRe = /\d+(?:[/-]\d+)*/g
  let match: RegExpExecArray | null
  while ((match = numRe.exec(str)) !== null) {
    const token = match[0]
    const idx = match.index
    if (/^\d{5}$/.test(token)) continue
    const before = str.slice(0, idx)
    if (NON_HOUSE_PREFIX_RE.test(before)) continue
    return str.slice(0, idx) + 'xxx' + str.slice(idx + token.length)
  }

  return str
}
