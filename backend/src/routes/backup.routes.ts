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
router.get('/', (_req: Request, res: Response): void => {
  const backups = listBackups()
  const lastBackup = getLastBackupTime()
  const driveConfigured = !!(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_DRIVE_FOLDER_ID
  )
  res.json({ success: true, data: { backups, lastBackup, driveConfigured } })
})

// ── POST /api/backup/trigger — manual backup ─────────────────────────────────
router.post('/trigger', async (_req: Request, res: Response): Promise<void> => {
  try {
    const id = await runBackup()
    const backups = listBackups()
    res.json({ success: true, data: { id, backups } })
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// ── GET /api/backup/download/:id — stream file to browser ────────────────────
router.get('/download/:id', (req: Request, res: Response): void => {
  try {
    const filePath = getBackupFilePath(req.params.id)
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
  try {
    await deleteBackup(req.params.id)
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
