import Database from 'better-sqlite3'
import path from 'path'

// ค่าเริ่มต้นคือ backend/dev.db เหมือนเดิม SQLITE_DB_PATH มีไว้ให้ test suite ชี้ไป
// ไฟล์ชั่วคราวได้ ไม่งั้น vitest.setup.ts จะ ALTER TABLE ใส่ฐานข้อมูล production ตัวจริง
export const dbPath = process.env.SQLITE_DB_PATH ?? path.join(__dirname, '../../dev.db')
const db: any = new Database(dbPath)

// Enable foreign keys
db.pragma('foreign_keys = ON')

export default db
export const getDb = () => db
