import { Router, Request, Response } from 'express'
import { authenticate, requireMaster } from '../middleware/auth.middleware'
import {
  runBackup,
  listBackups,
  deleteBackup,
  getBackupFilePath,
  testDriveConnection,
  getLastBackupTime,
} from '../services/backup.service'

const router = Router()

// All backup routes require authenticated MASTER user
router.use(authenticate, requireMaster)

// ── GET /api/backup — list backup logs + config status ───────────────────────
router.get('/', (req: Request, res: Response): void => {
  const tenantId = req.user!.tenantId
  const backups = listBackups(tenantId)
  const lastBackup = getLastBackupTime(tenantId)
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_DRIVE_FOLDER_ID } = process.env
  const driveConfigured = !!(GOOGLE_DRIVE_FOLDER_ID && (
    (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN) ||
    GOOGLE_SERVICE_ACCOUNT_JSON
  ))
  res.json({ success: true, data: { backups, lastBackup, driveConfigured } })
})

// ── POST /api/backup/trigger — manual backup ─────────────────────────────────
router.post('/trigger', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId
  try {
    const id = await runBackup(tenantId)
    const backups = listBackups(tenantId)
    res.json({ success: true, data: { id, backups } })
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// ── GET /api/backup/download/:id — stream file to browser ────────────────────
router.get('/download/:id', (req: Request, res: Response): void => {
  const tenantId = req.user!.tenantId
  try {
    const filePath = getBackupFilePath(req.params.id, tenantId)
    const filename = filePath.split(/[\\/]/).pop()!
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Type', 'application/gzip')
    res.download(filePath, filename)
  } catch (err: any) {
    res.status(404).json({ success: false, message: err.message })
  }
})

// ── DELETE /api/backup/:id ───────────────────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId
  try {
    await deleteBackup(req.params.id, tenantId)
    res.json({ success: true })
  } catch (err: any) {
    res.status(404).json({ success: false, message: err.message })
  }
})

// ── POST /api/backup/test-drive — verify Google Drive connection ──────────────
router.post('/test-drive', async (_req: Request, res: Response): Promise<void> => {
  const result = await testDriveConnection()
  res.json({ success: result.ok, message: result.message })
})

export default router
