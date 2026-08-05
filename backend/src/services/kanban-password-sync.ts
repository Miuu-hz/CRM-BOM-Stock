// Push a changed/reset password to the linked Phopy Board (Planka) account so
// direct kanban.phopy.net login stays in sync with Phopy ERP. Non-fatal by
// design: the SSO button always works regardless, and not every ERP user has a
// linked Kanban account (server-to-server, mirrors provisionKanban()).
import jwt from 'jsonwebtoken'

const KANBAN_SSO_SECRET = process.env.KANBAN_SSO_SECRET
const KANBAN_INTERNAL_URL = process.env.KANBAN_INTERNAL_URL || 'http://192.168.1.96:1337'

export async function syncKanbanPassword(erpUserId: string, plaintextPassword: string): Promise<void> {
  if (!KANBAN_SSO_SECRET) {
    console.warn('[kanban-password-sync] KANBAN_SSO_SECRET not set — skipping')
    return
  }
  // Master accounts keep their password in .env, not in any Planka-linked row.
  if (!erpUserId || erpUserId.startsWith('master_') || !plaintextPassword) return

  try {
    const token = jwt.sign(
      { erpUserId, password: plaintextPassword, purpose: 'kanban-password-sync' },
      KANBAN_SSO_SECRET,
      { algorithm: 'HS256', expiresIn: 120 },
    )
    const resp = await fetch(`${KANBAN_INTERNAL_URL}/erp-sso/sync-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    if (!resp.ok) {
      console.warn('[kanban-password-sync] failed', resp.status, await resp.text().catch(() => ''))
    }
  } catch (err) {
    console.warn('[kanban-password-sync] error (non-fatal)', err)
  }
}
