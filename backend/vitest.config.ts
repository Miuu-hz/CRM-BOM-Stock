import { defineConfig } from 'vitest/config'
import path from 'path'

// ponytail: single-process, non-isolated run — this suite hits one real SQLite file
// (backend/dev.db, migrated fresh in this worktree) via better-sqlite3. Parallel workers
// or per-file module isolation would each open their own connection / re-run the full
// migration set, which is slower and adds needless lock contention for no benefit here.
export default defineConfig({
  test: {
    environment: 'node',
    // ต้องตั้งผ่าน test.env เท่านั้น — ตั้งใน vitest.setup.ts ไม่ทัน เพราะ import ถูก hoist
    // ทำให้ db/connection.ts อ่าน dbPath ไปก่อนที่ statement แรกของ setup จะรัน
    //
    // ก่อนหน้านี้ suite นี้วิ่งใส่ backend/dev.db ตัวจริง: ALTER TABLE ลง production
    // ตามที่ vitest.setup.ts เตือนไว้ และเทสต์ที่ INSERT company_settings/users ทิ้งขยะ
    // ค้างไว้จริง (เจอ 4 tenant + 32 users ค้างเมื่อ 2026-09-09)
    env: { SQLITE_DB_PATH: path.resolve(__dirname, 'test.db') },
    setupFiles: [path.resolve(__dirname, 'vitest.setup.ts')],
    fileParallelism: false,
    isolate: false,
    testTimeout: 20000,
    include: ['src/**/*.test.ts'],
  },
})
