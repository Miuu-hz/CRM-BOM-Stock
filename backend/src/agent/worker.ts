// ─── Lean Agent Worker ──────────────────────────────────────────────────────
// Polls SQLite queue every 5s. No Redis, no Bull, no separate process.

import { dequeue, complete, fail } from './queue'
import commands from './commands'
import { addComment, updateIssueStatus } from './paperclip.client'
import db from '../db/sqlite'

const POLL_MS = 5000

function startWorker(): void {
  console.log('🤖 Agent worker started (polling every', POLL_MS, 'ms)')

  setInterval(async () => {
    const job = dequeue()
    if (!job) return

    const fn = commands[job.command]
    if (!fn) {
      fail(job.id, `Unknown command: ${job.command}`)
      await addComment(job.paperclipCompanyId, job.paperclipIssueId, `❌ Unknown command: ${job.command}`, getApiKey(job.paperclipCompanyId))
      return
    }

    try {
      const result = await fn(
        { tenantId: job.tenantId, db },
        JSON.parse(job.payload || '{}')
      )
      complete(job.id, JSON.stringify(result))
      console.log(`✅ Agent job ${job.id} completed: ${job.command}`)

      // Report back to Paperclip
      const apiKey = getApiKey(job.paperclipCompanyId)
      await addComment(job.paperclipCompanyId, job.paperclipIssueId, `✅ ${job.command}\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``, apiKey)
      await updateIssueStatus(job.paperclipCompanyId, job.paperclipIssueId, 'done', apiKey)
    } catch (err: any) {
      fail(job.id, err.message)
      console.error(`❌ Agent job ${job.id} failed:`, err.message)

      const apiKey = getApiKey(job.paperclipCompanyId)
      await addComment(job.paperclipCompanyId, job.paperclipIssueId, `❌ ${job.command} failed: ${err.message}`, apiKey)
    }
  }, POLL_MS)
}

function getApiKey(companyId: string): string {
  const row = db.prepare('SELECT paperclip_api_key FROM paperclip_companies WHERE paperclip_company_id = ?').get(companyId) as any
  return row?.paperclip_api_key ?? ''
}

export { startWorker }
