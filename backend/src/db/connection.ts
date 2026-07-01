import Database from 'better-sqlite3'
import path from 'path'

export const dbPath = path.join(__dirname, '../../dev.db')
const db: any = new Database(dbPath)

// Enable foreign keys
db.pragma('foreign_keys = ON')

export default db
export const getDb = () => db
