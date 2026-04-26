// ─── Paperclip Webhook Receiver ─────────────────────────────────────────────
// Receives Paperclip HTTP adapter heartbeat, verifies HMAC, enqueues job.

import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import db from '../db/sqlite'
import { enqueue } from './queue'
import { fetchIssue } from './paperclip.client'

const router = Router()

// Verify HMAC-SHA256 signature
function verifySignature(body: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}

// Naive intent parser: splits title into command + payload
function parseIntent(title: string): { command: string; payload: any } {
  const t = title.trim().toLowerCase()
  if (t.includes('สต็อก') || t.includes('stock') || t.includes('เหลือ')) {
    const q = title.replace(/สต็อก|stock|เหลือ/gi, '').trim()
    return { command: 'query_stock', payload: { query: q || undefined } }
  }
  if (t.includes('ยอดขาย') || t.includes('sales') || t.includes('revenue')) {
    return { command: 'query_sales', payload: { period: '30d' } }
  }
  if (t.includes('สรุป') || t.includes('summary') || t.includes('executive')) {
    return { command: 'get_executive_summary', payload: {} }
  }
  if (t.includes('ขอซื้อ') || t.includes('purchase request') || t.includes('pr')) {
    return { command: 'create_pr', payload: { description: title } }
  }
  if (t.includes('ใบสั่งงาน') || t.includes('work order') || t.includes('wo')) {
    return { command: 'create_wo', payload: { description: title } }
  }
  if (t.includes('อนุมัติ') || t.includes('approve') || t.includes('po')) {
    return { command: 'approve_po', payload: { poId: title.match(/[A-Z0-9-]+/)?.[0] ?? '' } }
  }
  // Default: executive summary
  return { command: 'get_executive_summary', payload: { originalTitle: title } }
}

router.post('/webhook', async (req: Request, res: Response) => {
  // Always respond 200 immediately per Paperclip requirement
  res.status(200).json({ received: true })

  try {
    const signature = req.headers['x-paperclip-signature'] as string | undefined
    if (!signature) {
      console.warn('⚠️ Paperclip webhook: missing signature')
      return
    }

    const payload = req.body as { runId: string; agentId: string; companyId: string; context: any }
    const companyId = payload.companyId
    const issueId = payload.context?.taskId as string | undefined

    // Look up tenant mapping + secret
    const mapping = db.prepare(
      'SELECT tenant_id, paperclip_api_key, webhook_secret FROM paperclip_companies WHERE paperclip_company_id = ? AND is_active = 1'
    ).get(companyId) as { tenant_id: string; paperclip_api_key: string; webhook_secret: string } | null

    if (!mapping) {
      console.warn(`⚠️ Paperclip webhook: no mapping for company ${companyId}`)
      return
    }

    // Verify HMAC
    const rawBody = JSON.stringify(req.body)
    if (!verifySignature(rawBody, signature, mapping.webhook_secret)) {
      console.warn('⚠️ Paperclip webhook: invalid signature')
      return
    }

    // Fetch issue details from Paperclip to understand intent
    let title = ''
    if (issueId) {
      const issue = await fetchIssue(companyId, issueId, mapping.paperclip_api_key)
      title = issue?.title ?? issue?.data?.title ?? ''
    }
    if (!title) title = 'get_executive_summary'

    const intent = parseIntent(title)

    enqueue({
      tenantId: mapping.tenant_id,
      command: intent.command,
      payload: intent.payload,
      paperclipCompanyId: companyId,
      paperclipIssueId: issueId ?? '',
    })

    console.log(`📎 Paperclip job enqueued: ${intent.command} for tenant ${mapping.tenant_id}`)
  } catch (err) {
    console.error('Paperclip webhook error:', err)
  }
})

export default router
