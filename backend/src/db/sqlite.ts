import db, { dbPath } from './connection'
import { applySchema } from './schema'
import { runMigrations } from './migrations'
import { runPosQrMigrations } from './posQrMigrations'

applySchema(db)
runMigrations(db)
runPosQrMigrations(db)

console.log('✅ SQLite database initialized at:', dbPath)

export default db
export const getDb = () => db
