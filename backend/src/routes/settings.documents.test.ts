import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import settingsRouter from './settings.routes'
import { createTestUser } from '../test/testAuth'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/settings', settingsRouter)
  return app
}

const app = buildApp()

// tenants created by this file's tests, cleaned up after each test so nothing leaks into test.db
const tenantIds: string[] = []
function trackTenant(tenantId: string) {
  tenantIds.push(tenantId)
  return tenantId
}

afterEach(() => {
  while (tenantIds.length) {
    const tenantId = tenantIds.pop()!
    db.prepare('DELETE FROM document_settings WHERE tenant_id = ?').run(tenantId)
    db.prepare('DELETE FROM company_settings WHERE tenant_id = ?').run(tenantId)
    db.prepare('DELETE FROM tenant_subscriptions WHERE tenant_id = ?').run(tenantId)
    db.prepare('DELETE FROM users WHERE tenant_id = ?').run(tenantId)
  }
})

describe('GET /api/settings/documents', () => {
  it('returns the built-in defaults when the tenant has never saved settings', async () => {
    const { tenantId, token } = createTestUser()
    trackTenant(tenantId)

    const res = await request(app)
      .get('/api/settings/documents')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.brandColor).toBe('#5b5bd6')
    expect(res.body.data.marginMm).toBe(13)
    expect(res.body.data.fontSizePt).toBe(12)
    expect(res.body.data.defaultPaper.rc).toBe('THERMAL')
    expect(res.body.data.defaultPaper.qt).toBe('A4')
    expect(res.body.data.columns).toEqual({ discount: true, vat: true, wht: false, sku: true })
    expect(res.body.data.signatureSlots).toHaveLength(4)
    expect(res.body.data.branding).toEqual({ logoBase64: null, isFreePlan: true })
  })

  it('reflects a non-free plan and the tenant logo in branding', async () => {
    const { tenantId, token } = createTestUser()
    trackTenant(tenantId)
    db.prepare(`INSERT INTO company_settings (tenant_id, logo_base64) VALUES (?, 'data:image/png;base64,abc')`).run(tenantId)
    db.prepare(`
      INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status)
      VALUES (?, ?, 'business', 'ACTIVE')
    `).run(`sub_${tenantId}`, tenantId)

    const res = await request(app)
      .get('/api/settings/documents')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.branding.isFreePlan).toBe(false)
    expect(res.body.data.branding.logoBase64).toBe('data:image/png;base64,abc')
  })
})

describe('PUT /api/settings/documents', () => {
  it('saves settings and GET reads them back', async () => {
    const { tenantId, token } = createTestUser({ role: 'ADMIN' })
    trackTenant(tenantId)

    const putRes = await request(app)
      .put('/api/settings/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({ brandColor: '#ff0000', marginMm: 20, signatureSlots: ['เซ็นชื่อ'] })

    expect(putRes.status).toBe(200)
    expect(putRes.body.data.brandColor).toBe('#ff0000')
    expect(putRes.body.data.marginMm).toBe(20)
    expect(putRes.body.data.signatureSlots).toEqual(['เซ็นชื่อ'])
    // untouched fields keep their defaults
    expect(putRes.body.data.fontSizePt).toBe(12)

    const getRes = await request(app)
      .get('/api/settings/documents')
      .set('Authorization', `Bearer ${token}`)
    expect(getRes.body.data.brandColor).toBe('#ff0000')
    expect(getRes.body.data.marginMm).toBe(20)
  })

  it('merges a partial nested update (defaultPaper) onto the saved value without wiping sibling keys', async () => {
    const { tenantId, token } = createTestUser({ role: 'ADMIN' })
    trackTenant(tenantId)

    await request(app)
      .put('/api/settings/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({ defaultPaper: { inv: 'A5' } })
      .expect(200)

    const res = await request(app)
      .put('/api/settings/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({ defaultPaper: { po: 'A5' } })

    expect(res.status).toBe(200)
    // both partial updates survive: proves merge-by-key, not whole-object replace
    expect(res.body.data.defaultPaper.inv).toBe('A5')
    expect(res.body.data.defaultPaper.po).toBe('A5')
    // untouched doc types still default
    expect(res.body.data.defaultPaper.rc).toBe('THERMAL')
    expect(res.body.data.defaultPaper.qt).toBe('A4')
  })

  it('rejects with 403 when the caller is not ADMIN/MASTER, and does not write anything', async () => {
    const { tenantId, token } = createTestUser({ role: 'USER' })
    trackTenant(tenantId)

    const res = await request(app)
      .put('/api/settings/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({ brandColor: '#000000' })

    expect(res.status).toBe(403)

    const row = db.prepare('SELECT * FROM document_settings WHERE tenant_id = ?').get(tenantId)
    expect(row).toBeUndefined()
  })

  it('rejects invalid input (400) — bad hex color', async () => {
    const { tenantId, token } = createTestUser({ role: 'MASTER' })
    trackTenant(tenantId)

    const res = await request(app)
      .put('/api/settings/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({ brandColor: 'not-a-color' })

    expect(res.status).toBe(400)
  })

  it('rejects marginMm out of range (400)', async () => {
    const { tenantId, token } = createTestUser({ role: 'MASTER' })
    trackTenant(tenantId)

    const res = await request(app)
      .put('/api/settings/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({ marginMm: 99 })

    expect(res.status).toBe(400)
  })
})
