import Database from 'better-sqlite3'
import path from 'path'
import { phoneDigits } from '../utils/phone'

// ค่าเริ่มต้นคือ backend/dev.db เหมือนเดิม SQLITE_DB_PATH มีไว้ให้ test suite ชี้ไป
// ไฟล์ชั่วคราวได้ ไม่งั้น vitest.setup.ts จะ ALTER TABLE ใส่ฐานข้อมูล production ตัวจริง
export const dbPath = process.env.SQLITE_DB_PATH ?? path.join(__dirname, '../../dev.db')
const db: any = new Database(dbPath)

// Enable foreign keys
db.pragma('foreign_keys = ON')

// phone_digits(customers.phone) — เทียบเบอร์ที่บันทึกต่างรูปแบบกันได้ (ดู utils/phone.ts)
// ponytail: ใช้แค่ใน WHERE ไม่ทำ index บนฟังก์ชัน (sqlite3 CLI ที่ไม่รู้จักฟังก์ชันนี้จะเปิด index ไม่ได้)
// สแกนลูกค้าของ tenant เดียว หลักพันแถวยังเร็วอยู่ — ถ้าช้าค่อยเก็บคอลัมน์ phone_digits แยก
db.function('phone_digits', { deterministic: true }, (p: unknown) => phoneDigits(p))

export default db
export const getDb = () => db
