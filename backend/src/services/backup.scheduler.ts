import cron from 'node-cron'
import { runBackup, getLastBackupTime, initBackupTable } from './backup.service'

const INTERVAL_DAYS = 3

export function startBackupScheduler() {
  initBackupTable()

  // Run at 02:00 every day; the handler checks if 3 days have elapsed
  cron.schedule('0 2 * * *', async () => {
    const last = getLastBackupTime()
    if (last) {
      const diffDays = (Date.now() - new Date(last).getTime()) / (1000 * 60 * 60 * 24)
      if (diffDays < INTERVAL_DAYS) {
        console.log(`[Backup] ⏭ Skipped — last backup was ${diffDays.toFixed(1)} days ago`)
        return
      }
    }
    console.log('[Backup] 🗄 Starting scheduled backup...')
    try {
      await runBackup()
    } catch (err: any) {
      console.error('[Backup] ❌ Scheduled backup failed:', err.message)
    }
  })

  console.log('[Backup] ⏰ Scheduler started — runs at 02:00 daily, every 3 days')
}
