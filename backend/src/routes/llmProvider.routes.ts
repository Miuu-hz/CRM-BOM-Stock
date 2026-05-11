import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { randomUUID } from 'crypto'

const router = Router()
router.use(authenticate)

function generateId() {
  return randomUUID().replace(/-/g, '').substring(0, 25)
}

// GET /api/llm-providers — list all for tenant
router.get('/', (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId
  try {
    const items = db.prepare(
      `SELECT id, tenant_id, name, provider_type, base_url, model, is_active, is_default, created_at, updated_at
       FROM llm_providers WHERE tenant_id = ? ORDER BY created_at DESC`
    ).all(tenantId)
    res.json({ success: true, data: items })
  } catch (err: any) {
    console.error('list llm providers error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// GET /api/llm-providers/:id
router.get('/:id', (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId
  const { id } = req.params
  try {
    const item = db.prepare(
      `SELECT id, tenant_id, name, provider_type, base_url, model, is_active, is_default, created_at, updated_at
       FROM llm_providers WHERE id = ? AND tenant_id = ?`
    ).get(id, tenantId)
    if (!item) return res.status(404).json({ success: false, message: 'Not found' })
    res.json({ success: true, data: item })
  } catch (err: any) {
    console.error('get llm provider error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// POST /api/llm-providers — create
router.post('/', (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId
  const { name, provider_type, base_url, api_key, model, is_active, is_default } = req.body

  if (!name || !provider_type || !base_url || !api_key || !model) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบ' })
  }

  const id = generateId()
  const now = new Date().toISOString()

  try {
    db.prepare(`INSERT INTO llm_providers
      (id, tenant_id, name, provider_type, base_url, api_key, model, is_active, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, tenantId, name, provider_type, base_url, api_key, model, is_active ? 1 : 0, is_default ? 1 : 0, now, now)

    if (is_default) {
      db.prepare(`UPDATE llm_providers SET is_default = 0 WHERE tenant_id = ? AND id != ?`).run(tenantId, id)
    }

    const created = db.prepare(`SELECT * FROM llm_providers WHERE id = ?`).get(id)
    res.status(201).json({ success: true, data: created })
  } catch (err: any) {
    console.error('create llm provider error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// PUT /api/llm-providers/:id — update
router.put('/:id', (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId
  const { id } = req.params
  const { name, provider_type, base_url, api_key, model, is_active, is_default } = req.body

  const existing = db.prepare(`SELECT id FROM llm_providers WHERE id = ? AND tenant_id = ?`).get(id, tenantId)
  if (!existing) return res.status(404).json({ success: false, message: 'Not found' })

  const now = new Date().toISOString()

  try {
    db.prepare(`UPDATE llm_providers SET
      name = COALESCE(?, name),
      provider_type = COALESCE(?, provider_type),
      base_url = COALESCE(?, base_url),
      api_key = COALESCE(?, api_key),
      model = COALESCE(?, model),
      is_active = COALESCE(?, is_active),
      is_default = COALESCE(?, is_default),
      updated_at = ?
      WHERE id = ? AND tenant_id = ?`)
      .run(name, provider_type, base_url, api_key, model, is_active !== undefined ? (is_active ? 1 : 0) : undefined, is_default !== undefined ? (is_default ? 1 : 0) : undefined, now, id, tenantId)

    if (is_default) {
      db.prepare(`UPDATE llm_providers SET is_default = 0 WHERE tenant_id = ? AND id != ?`).run(tenantId, id)
    }

    const updated = db.prepare(`SELECT * FROM llm_providers WHERE id = ?`).get(id)
    res.json({ success: true, data: updated })
  } catch (err: any) {
    console.error('update llm provider error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// DELETE /api/llm-providers/:id
router.delete('/:id', (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId
  const { id } = req.params

  const existing = db.prepare(`SELECT id FROM llm_providers WHERE id = ? AND tenant_id = ?`).get(id, tenantId)
  if (!existing) return res.status(404).json({ success: false, message: 'Not found' })

  try {
    db.prepare(`DELETE FROM llm_providers WHERE id = ? AND tenant_id = ?`).run(id, tenantId)
    res.json({ success: true, message: 'Deleted' })
  } catch (err: any) {
    console.error('delete llm provider error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// POST /api/llm-providers/:id/test — test connection
router.post('/:id/test', async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId
  const { id } = req.params

  const provider: any = db.prepare(`SELECT * FROM llm_providers WHERE id = ? AND tenant_id = ? AND is_active = 1`).get(id, tenantId)
  if (!provider) return res.status(404).json({ success: false, message: 'Provider not found or inactive' })

  try {
    const response = await fetch(`${provider.base_url.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${provider.api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: 'user', content: 'Say "OK" only.' }],
        max_tokens: 5,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) {
      const text = await response.text()
      return res.status(502).json({ success: false, message: `Provider returned ${response.status}: ${text}` })
    }

    const data: any = await response.json()
    const reply = data.choices?.[0]?.message?.content?.trim() || 'No content'
    res.json({ success: true, message: 'Connected', reply })
  } catch (err: any) {
    console.error('test llm provider error:', err)
    res.status(502).json({ success: false, message: err.message || 'Connection failed' })
  }
})

// POST /api/llm-providers/test-chat — LLM Playground
router.post('/test-chat', async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId
  const { message, providerId } = req.body

  if (!message) return res.status(400).json({ success: false, message: 'Message is required' })

  let provider: any

  if (providerId) {
    provider = db.prepare(`SELECT * FROM llm_providers WHERE id = ? AND tenant_id = ? AND is_active = 1`).get(providerId, tenantId)
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found or inactive' })
  } else {
    provider = db.prepare(`SELECT * FROM llm_providers WHERE tenant_id = ? AND is_active = 1 AND is_default = 1 LIMIT 1`).get(tenantId)
    if (!provider) {
      provider = db.prepare(`SELECT * FROM llm_providers WHERE tenant_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1`).get(tenantId)
    }
  }

  if (!provider) {
    return res.status(400).json({ success: false, message: 'ไม่พบ LLM Provider ที่เปิดใช้งาน กรุณาตั้งค่าใน Settings > AI / LLM' })
  }

  try {
    const response = await fetch(`${provider.base_url.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${provider.api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: 'user', content: message }],
        max_tokens: 500,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) {
      const text = await response.text()
      return res.status(502).json({ success: false, message: `Provider returned ${response.status}: ${text}` })
    }

    const data: any = await response.json()
    const reply = data.choices?.[0]?.message?.content?.trim() || 'No content'
    res.json({ success: true, reply })
  } catch (err: any) {
    console.error('test-chat error:', err)
    res.status(502).json({ success: false, message: err.message || 'Connection failed' })
  }
})

export default router
