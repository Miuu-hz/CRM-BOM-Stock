import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import db from '../db/sqlite'
import { generateId } from '../utils/id'

const mockBackupPiiTo = vi.fn(async (destPath: string) => {
  fs.writeFileSync(destPath, 'SQLite format 3\0mock-pii-db')
})

vi.mock('../db/piiConnection', () => ({
  backupPiiTo: (destPath: string) => mockBackupPiiTo(destPath),
}))

import { initBackupTable, runBackup } from './backup.service'

const BACKUP_DIR = path.join(__dirname, '../../backups')
const createdIds: string[] = []
let preExistingFiles: Set<string> = new Set()

beforeEach(() => {
  initBackupTable()
  preExistingFiles = new Set(fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR) : [])
  mockBackupPiiTo.mockClear()
})

afterEach(() => {
  for (const id of createdIds.splice(0)) {
    db.prepare('DELETE FROM backup_logs WHERE id = ?').run(id)
  }
  if (fs.existsSync(BACKUP_DIR)) {
    for (const f of fs.readdirSync(BACKUP_DIR)) {
      if (!preExistingFiles.has(f)) {
        try { fs.unlinkSync(path.join(BACKUP_DIR, f)) } catch {}
      }
    }
  }
})

describe('backup.service (B1-B4)', () => {
  it('B2+B4: runBackup ใช้ db.backup() สำรองฐานหลักเป็น phopy-db-*.db.gz และสำรอง PII เป็น phopy-pii-*.db.gz', async () => {
    const t = 'test_bk_' + generateId()
    const id = await runBackup(t)
    createdIds.push(id)

    expect(mockBackupPiiTo).toHaveBeenCalledTimes(1)

    const newFiles = fs.readdirSync(BACKUP_DIR).filter(f => !preExistingFiles.has(f))
    const dbGz = newFiles.find(f => f.startsWith('phopy-db-') && f.endsWith('.db.gz'))
    const piiGz = newFiles.find(f => f.startsWith('phopy-pii-') && f.endsWith('.db.gz'))
    expect(dbGz).toBeDefined()
    expect(piiGz).toBeDefined()
    // ต้องไม่เหลือไฟล์ .tmp ค้าง
    expect(newFiles.some(f => f.endsWith('.tmp'))).toBe(false)

    // ไฟล์ที่ gzip ต้องแตกได้เป็น SQLite header จริง
    const mainRaw = zlib.gunzipSync(fs.readFileSync(path.join(BACKUP_DIR, dbGz!)))
    expect(mainRaw.subarray(0, 15).toString('ascii')).toBe('SQLite format 3')

    const piiRaw = zlib.gunzipSync(fs.readFileSync(path.join(BACKUP_DIR, piiGz!)))
    expect(piiRaw.toString('ascii')).toContain('mock-pii-db')

    const log = db.prepare('SELECT status, filename FROM backup_logs WHERE id = ?').get(id) as any
    expect(log.status).toBe('SUCCESS')
    expect(log.filename).toBe(dbGz)
  })

  it('B3+B4: retention เก็บสูงสุด 3 ไฟล์ต่อประเภท (phopy-db-* และ phopy-pii-*)', async () => {
    // สร้างไฟล์เก่าจำลองไว้ 4 ไฟล์ต่อประเภท
    for (let i = 1; i <= 4; i++) {
      const ts = `2020-01-0${i}T00-00-00`
      const f1 = path.join(BACKUP_DIR, `phopy-db-${ts}.db.gz`)
      const f2 = path.join(BACKUP_DIR, `phopy-pii-${ts}.db.gz`)
      fs.writeFileSync(f1, 'old-db')
      fs.writeFileSync(f2, 'old-pii')
      const mtime = new Date(2020, 0, i).getTime() / 1000
      fs.utimesSync(f1, mtime, mtime)
      fs.utimesSync(f2, mtime, mtime)
    }

    const id = await runBackup('test_bk_ret_' + generateId())
    createdIds.push(id)

    const all = fs.readdirSync(BACKUP_DIR)
    const dbFiles = all.filter(f => f.startsWith('phopy-db-') && f.endsWith('.db.gz'))
    const piiFiles = all.filter(f => f.startsWith('phopy-pii-') && f.endsWith('.db.gz'))

    expect(dbFiles.length).toBeLessThanOrEqual(3)
    expect(piiFiles.length).toBeLessThanOrEqual(3)
    expect(dbFiles.some(f => f.includes('2020-01-01'))).toBe(false)
    expect(piiFiles.some(f => f.includes('2020-01-01'))).toBe(false)
  })
})
