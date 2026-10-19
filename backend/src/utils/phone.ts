// customers.phone เป็นข้อความอิสระ — เบอร์เดียวกันถูกบันทึกได้หลายแบบ (081-234-5678 / +66 81 234 5678 / 0812345678)
// เทียบกันได้ต้องเหลือแต่ตัวเลข และเปลี่ยนรหัสประเทศ 66 ข้างหน้าเป็น 0 ก่อน
// ลงทะเบียนเป็นฟังก์ชัน SQL phone_digits() ไว้ใน db/connection.ts ด้วย ให้ WHERE เทียบแบบเดียวกัน
export function phoneDigits(raw: unknown): string {
  const d = String(raw ?? '').replace(/\D/g, '')
  return d.startsWith('66') && (d.length === 10 || d.length === 11) ? '0' + d.slice(2) : d
}

// เบอร์มือถือไทย 10 หลัก (06/08/09) — ใช้เป็นตัวระบุสมาชิกที่สมัครเองผ่าน QR · ไม่ใช่เบอร์มือถือ = null
export function normalizeThaiMobile(raw: unknown): string | null {
  const d = phoneDigits(raw)
  return /^0[689]\d{8}$/.test(d) ? d : null
}

// 081-xxx-5678 — โชว์บนจอลูกค้า/แคชเชียร์โดยไม่เผยเบอร์เต็ม
export function maskPhone(raw: unknown): string {
  const d = phoneDigits(raw)
  return d.length >= 7 ? `${d.slice(0, 3)}-xxx-${d.slice(-4)}` : d
}
