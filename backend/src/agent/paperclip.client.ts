// ─── Thin Paperclip API Client ──────────────────────────────────────────────

const PAPERCLIP_URL = process.env.PAPERCLIP_URL
if (!PAPERCLIP_URL) {
  console.warn('⚠️ PAPERCLIP_URL not set — Paperclip integration disabled')
}

export async function addComment(companyId: string, issueId: string, text: string, apiKey: string): Promise<void> {
  if (!PAPERCLIP_URL) return
  try {
    await fetch(`${PAPERCLIP_URL}/api/companies/${companyId}/issues/${issueId}/comments`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    })
  } catch (err) {
    console.error('Paperclip addComment error:', err)
  }
}

export async function updateIssueStatus(companyId: string, issueId: string, status: string, apiKey: string): Promise<void> {
  if (!PAPERCLIP_URL) return
  try {
    await fetch(`${PAPERCLIP_URL}/api/companies/${companyId}/issues/${issueId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status }),
    })
  } catch (err) {
    console.error('Paperclip updateIssue error:', err)
  }
}

export async function fetchIssue(companyId: string, issueId: string, apiKey: string): Promise<any | null> {
  if (!PAPERCLIP_URL) return null
  try {
    const res = await fetch(`${PAPERCLIP_URL}/api/companies/${companyId}/issues/${issueId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })
    if (!res.ok) return null
    return await res.json()
  } catch (err) {
    console.error('Paperclip fetchIssue error:', err)
    return null
  }
}
