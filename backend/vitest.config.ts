import { defineConfig } from 'vitest/config'
import path from 'path'

// ponytail: single-process, non-isolated run — this suite hits one real SQLite file
// (backend/dev.db, migrated fresh in this worktree) via better-sqlite3. Parallel workers
// or per-file module isolation would each open their own connection / re-run the full
// migration set, which is slower and adds needless lock contention for no benefit here.
const testDbPath = path.resolve(process.env.SQLITE_DB_PATH || path.resolve(__dirname, 'test.db'))
if (testDbPath === path.resolve(__dirname, 'dev.db')) {
  throw new Error('SQLITE_DB_PATH ชี้ไปที่ dev.db (ฐานข้อมูลจริง) — ห้ามรันเทสต์ใส่')
}

export default defineConfig({
  test: {
    environment: 'node',
    // ต้องตั้งผ่าน test.env เท่านั้น — ตั้งใน vitest.setup.ts ไม่ทัน เพราะ import ถูก hoist
    // ทำให้ db/connection.ts อ่าน dbPath ไปก่อนที่ statement แรกของ setup จะรัน
    //
    // ก่อนหน้านี้ suite นี้วิ่งใส่ backend/dev.db ตัวจริง: ALTER TABLE ลง production
    // ตามที่ vitest.setup.ts เตือนไว้ และเทสต์ที่ INSERT company_settings/users ทิ้งขยะ
    // ค้างไว้จริง (เจอ 4 tenant + 32 users ค้างเมื่อ 2026-09-09)
    //
    // ส่ง SQLITE_DB_PATH มาเองได้ (เช่นหลาย agent รันพร้อมกันคนละไฟล์) — เดิมค่าใน config ทับทิ้ง
    // แต่ห้ามชี้ dev.db เด็ดขาด ไม่งั้นย้อนกลับไปเขียนใส่ production อย่างที่ว่าไว้ข้างบน
    env: { SQLITE_DB_PATH: testDbPath },
    setupFiles: [path.resolve(__dirname, 'vitest.setup.ts')],
    fileParallelism: false,
    isolate: false,
    testTimeout: 20000,
    include: ['src/**/*.test.ts'],
  },
})
