import { defineConfig } from 'vitest/config'
import path from 'path'

// ponytail: single-process, non-isolated run — this suite hits one real SQLite file
// (backend/dev.db, migrated fresh in this worktree) via better-sqlite3. Parallel workers
// or per-file module isolation would each open their own connection / re-run the full
// migration set, which is slower and adds needless lock contention for no benefit here.
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: [path.resolve(__dirname, 'vitest.setup.ts')],
    fileParallelism: false,
    isolate: false,
    testTimeout: 20000,
    include: ['src/**/*.test.ts'],
  },
})
