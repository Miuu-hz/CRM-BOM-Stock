import dotenv from 'dotenv'
import path from 'path'

// Same loading convention as src/index.ts: read backend/.env regardless of cwd.
dotenv.config({ path: path.resolve(__dirname, '.env') })

// ponytail: src/middleware/auth.middleware.ts (authenticate) selects
// users.departments / users.custom_permissions, but neither db/schema.ts's CREATE TABLE
// nor any migration in db/migrations.ts actually adds those columns (grepped both files,
// zero hits). Production's dev.db evidently picked them up out-of-band at some point —
// a *freshly migrated* DB (exactly what this test suite builds) does not have them, so
// every authenticated request 401s before a route handler even runs. Patched here,
// test-DB-only, instead of touching the shared migration path for something we can't
// verify against the live DB. Upgrade path: add a proper guarded migration for these
// two columns in db/migrations.ts once someone can confirm what prod's schema drift is.
import db from './src/db/sqlite'
const userCols = db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[]
const userColNames = new Set(userCols.map((c) => c.name))
if (!userColNames.has('departments')) db.exec(`ALTER TABLE users ADD COLUMN departments TEXT`)
if (!userColNames.has('custom_permissions')) db.exec(`ALTER TABLE users ADD COLUMN custom_permissions TEXT`)

// Same drift, second instance: purchaseOrder.routes.ts's /approve and /reject handlers
// write purchase_orders.approved_at / rejection_reason, neither of which exists in a
// freshly migrated DB either (PRAGMA table_info confirmed: no approved_at, no
// rejection_reason). Same test-only patch, same real gap to flag for a real migration.
const poCols = db.prepare(`PRAGMA table_info(purchase_orders)`).all() as { name: string }[]
const poColNames = new Set(poCols.map((c) => c.name))
if (!poColNames.has('approved_at')) db.exec(`ALTER TABLE purchase_orders ADD COLUMN approved_at TEXT`)
if (!poColNames.has('rejection_reason')) db.exec(`ALTER TABLE purchase_orders ADD COLUMN rejection_reason TEXT`)
