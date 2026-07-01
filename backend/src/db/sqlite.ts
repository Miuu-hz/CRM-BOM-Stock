import db, { dbPath } from './connection'
import { applySchema } from './schema'
import { runMigrations } from './migrations'

applySchema(db)
runMigrations(db)

console.log('✅ SQLite database initialized at:', dbPath)

export default db
export const getDb = () => db
