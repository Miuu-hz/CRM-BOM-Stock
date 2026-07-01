import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import zlib from 'zlib'
import { pipeline } from 'stream/promises'
import { google } from 'googleapis'
import { getDb } from '../db/sqlite'

// ── Paths ────────────────────────────────────────────────────────────────────
const DB_PATH = path.join(__dirname, '../../dev.db')
const BACKUP_DIR = path.join(__dirname, '../../backups')

// ── Ensure backup directory exists ──────────────────────────────────────────
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true })

// ── Initialise backup_logs table ────────────────────────────────────────────
export function initBackupTable() {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS backup_logs (
      id          TEXT PRIMARY KEY,
      tenant_id   TEXT,
      filename    TEXT NOT NULL,
      file_size   INTEGER,
      status      TEXT NOT NULL DEFAULT 'PENDING',
      cloud_url   TEXT,
      cloud_file_id TEXT,
      error       TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    )
  `)
  // Add tenant_id to existing tables that don't have it
  try {
    const cols = db.prepare(`PRAGMA table_info(backup_logs)`).all() as any[]
    if (!cols.some((c: any) => c.name === 'tenant_id')) {
      db.exec(`ALTER TABLE backup_logs ADD COLUMN tenant_id TEXT`)
    }
  } catch {}
}

// ── Google Drive helper ──────────────────────────────────────────────────────
// Supports two auth methods (checked in order):
//   1. OAuth2 refresh token  — GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN
//   2. Service Account JSON  — GOOGLE_SERVICE_ACCOUNT_JSON
function getDriveClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_SERVICE_ACCOUNT_JSON } = process.env

  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN) {
    const oauth2 = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)
    oauth2.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN })
    return google.drive({ version: 'v3', auth: oauth2 })
  }

  if (GOOGLE_SERVICE_ACCOUNT_JSON) {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON),
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    })
    return google.drive({ version: 'v3', auth })
  }

  throw new Error('Google Drive ยังไม่ได้ตั้งค่า credential')
}

async function uploadToDrive(filePath: string, filename: string): Promise<{ id: string; webViewLink: string }> {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID
  if (!folderId) throw new Error('GOOGLE_DRIVE_FOLDER_ID ยังไม่ได้ตั้งค่า')

  const drive = getDriveClient()
  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folderId],
    },
    media: {
      mimeType: 'application/gzip',
      body: fs.createReadStream(filePath),
    },
    fields: 'id,webViewLink',
  })

  return { id: res.data.id!, webViewLink: res.data.webViewLink ?? '' }
}

// ── Core backup function ─────────────────────────────────────────────────────
export async function runBackup(tenantId?: string): Promise<string> {
  const db = getDb()
  const id = `bk_${Date.now()}`
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const filename = `phopy-db-${timestamp}.db.gz`
  const destPath = path.join(BACKUP_DIR, filename)

  db.prepare(
    `INSERT INTO backup_logs (id, tenant_id, filename, status, created_at) VALUES (?, ?, ?, 'RUNNING', datetime('now'))`
  ).run(id, tenantId ?? null, filename)

  try {
    // SQLite WAL checkpoint before copy to ensure consistency
    db.pragma('wal_checkpoint(TRUNCATE)')

    // Gzip the database file
    await pipeline(
      fs.createReadStream(DB_PATH),
      zlib.createGzip({ level: 6 }),
      fs.createWriteStream(destPath)
    )

    const { size } = await fsp.stat(destPath)

    // Upload to Google Drive (skip gracefully if not configured)
    let cloudUrl: string | null = null
    let cloudFileId: string | null = null
    let driveError: string | null = null

    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_DRIVE_FOLDER_ID) {
      try {
        const { id: fid, webViewLink } = await uploadToDrive(destPath, filename)
        cloudUrl = webViewLink
        cloudFileId = fid
      } catch (err: any) {
        driveError = err.message
        console.error('[Backup] Google Drive upload failed:', err.message)
      }
    }

    db.prepare(`
      UPDATE backup_logs
      SET status = ?, file_size = ?, cloud_url = ?, cloud_file_id = ?, error = ?, completed_at = datetime('now')
      WHERE id = ?
    `).run(driveError ? 'PARTIAL' : 'SUCCESS', size, cloudUrl, cloudFileId, driveError, id)

    // Keep only the last 10 local backups
    pruneLocalBackups()

    console.log(`[Backup] ✅ ${filename} (${(size / 1024).toFixed(1)} KB)${cloudUrl ? ' → Drive' : ''}`)
    return id
  } catch (err: any) {
    db.prepare(`
      UPDATE backup_logs SET status = 'FAILED', error = ?, completed_at = datetime('now') WHERE id = ?
    `).run(err.message, id)
    throw err
  }
}

// ── Delete old local files (keep newest 10) ─────────────────────────────────
function pruneLocalBackups(keep = 10) {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.db.gz'))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)

  files.slice(keep).forEach(f => {
    try { fs.unlinkSync(path.join(BACKUP_DIR, f.name)) } catch {}
  })
}

// ── Delete a backup (log + local file) ──────────────────────────────────────
export async function deleteBackup(id: string, tenantId?: string) {
  const db = getDb()
  const row = tenantId
    ? db.prepare('SELECT filename, cloud_file_id FROM backup_logs WHERE id = ? AND (tenant_id = ? OR tenant_id IS NULL)').get(id, tenantId) as any
    : db.prepare('SELECT filename, cloud_file_id FROM backup_logs WHERE id = ?').get(id) as any
  if (!row) throw new Error('ไม่พบ backup')

  // Delete local file
  const localPath = path.join(BACKUP_DIR, row.filename)
  if (fs.existsSync(localPath)) fs.unlinkSync(localPath)

  // Delete from Drive
  if (row.cloud_file_id) {
    try {
      const drive = getDriveClient()
      await drive.files.delete({ fileId: row.cloud_file_id })
    } catch {}
  }

  db.prepare('DELETE FROM backup_logs WHERE id = ?').run(id)
}

// ── List backup logs ─────────────────────────────────────────────────────────
export function listBackups(tenantId?: string) {
  const db = getDb()
  if (tenantId) {
    return db.prepare(`
      SELECT id, filename, file_size, status, cloud_url, error, created_at, completed_at
      FROM backup_logs WHERE tenant_id = ? OR tenant_id IS NULL
      ORDER BY created_at DESC LIMIT 50
    `).all(tenantId)
  }
  return db.prepare(`
    SELECT id, filename, file_size, status, cloud_url, error, created_at, completed_at
    FROM backup_logs ORDER BY created_at DESC LIMIT 50
  `).all()
}

// ── Get local file path for download ────────────────────────────────────────
export function getBackupFilePath(id: string, tenantId?: string): string {
  const db = getDb()
  const row = tenantId
    ? db.prepare('SELECT filename FROM backup_logs WHERE id = ? AND (tenant_id = ? OR tenant_id IS NULL)').get(id, tenantId) as any
    : db.prepare('SELECT filename FROM backup_logs WHERE id = ?').get(id) as any
  if (!row) throw new Error('ไม่พบ backup')
  const p = path.join(BACKUP_DIR, row.filename)
  if (!fs.existsSync(p)) throw new Error('ไฟล์ถูกลบออกจากเซิร์ฟเวอร์แล้ว')
  return p
}

// ── Test Google Drive connection ─────────────────────────────────────────────
export async function testDriveConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const drive = getDriveClient()
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID
    if (!folderId) return { ok: false, message: 'GOOGLE_DRIVE_FOLDER_ID ยังไม่ได้ตั้งค่า' }
    await drive.files.list({ q: `'${folderId}' in parents`, pageSize: 1, fields: 'files(id)' })
    return { ok: true, message: 'เชื่อมต่อ Google Drive สำเร็จ' }
  } catch (err: any) {
    return { ok: false, message: err.message }
  }
}

// ── Scheduler: run every 3 days (uses node-cron via backup.scheduler.ts) ────
export function getLastBackupTime(tenantId?: string): string | null {
  const db = getDb()
  const row = tenantId
    ? db.prepare(
        `SELECT created_at FROM backup_logs WHERE status IN ('SUCCESS','PARTIAL') AND (tenant_id = ? OR tenant_id IS NULL) ORDER BY created_at DESC LIMIT 1`
      ).get(tenantId) as any
    : db.prepare(
        `SELECT created_at FROM backup_logs WHERE status IN ('SUCCESS','PARTIAL') ORDER BY created_at DESC LIMIT 1`
      ).get() as any
  return row?.created_at ?? null
}
