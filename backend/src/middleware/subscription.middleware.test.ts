import { describe, it, expect, vi } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { subscriptionGate } from './subscription.middleware'

function createTenant(planCode: string, packs: string[] = [], addons: Record<string, number> = {}) {
  const tenantId = `t_gate_${generateId()}`
  db.prepare(`
    INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status, current_period_end, packs, addons)
    VALUES (?, ?, ?, 'ACTIVE', datetime('now', '+30 days'), ?, ?)
  `).run(generateId(), tenantId, planCode, JSON.stringify(packs), JSON.stringify(addons))
  return tenantId
}

describe('subscriptionGate middleware', () => {
  const mockRes = () => {
    const res: any = {
      statusCode: 200,
      headers: {},
      status(code: number) { this.statusCode = code; return this },
      json(payload: any) { this.body = payload; return this },
      setHeader(k: string, v: string) { this.headers[k] = v }
    }
    return res
  }

  it('MASTER role passes any feature gate', () => {
    const req: any = { user: { role: 'MASTER', tenantId: 'any' } }
    const res = mockRes()
    const next = vi.fn()

    subscriptionGate('subcontract')(req, res, next)
    expect(next).toHaveBeenCalled()
    expect(res.statusCode).toBe(200)
  })

  it('Free tenant is blocked with 403 FEATURE_LOCKED on multi_currency, subcontract, and work_orders', () => {
    const freeTenant = createTenant('free')

    for (const feat of ['multi_currency', 'subcontract', 'work_orders']) {
      const req: any = { user: { role: 'USER', tenantId: freeTenant } }
      const res = mockRes()
      const next = vi.fn()

      subscriptionGate(feat)(req, res, next)
      expect(next).not.toHaveBeenCalled()
      expect(res.statusCode).toBe(403)
      expect(res.body.code).toBe('FEATURE_LOCKED')
      expect(res.body.feature).toBe(feat)
    }
  })

  it('Enterprise AI tenant passes multi_currency, subcontract, and work_orders gates', () => {
    const entTenant = createTenant('enterprise_ai')

    for (const feat of ['multi_currency', 'subcontract', 'work_orders']) {
      const req: any = { user: { role: 'USER', tenantId: entTenant } }
      const res = mockRes()
      const next = vi.fn()

      subscriptionGate(feat)(req, res, next)
      expect(next).toHaveBeenCalled()
      expect(res.statusCode).toBe(200)
    }
  })

  it('Maker pack enables work_orders (QC gate) on Business plan', () => {
    const makerTenant = createTenant('business', ['maker'])
    const req: any = { user: { role: 'USER', tenantId: makerTenant } }
    const res = mockRes()
    const next = vi.fn()

    subscriptionGate('work_orders')(req, res, next)
    expect(next).toHaveBeenCalled()
  })

  it('Subcontract add-on enables subcontract gate on Business plan', () => {
    const subconTenant = createTenant('business', ['maker'], { subcontract: 1 })
    const req: any = { user: { role: 'USER', tenantId: subconTenant } }
    const res = mockRes()
    const next = vi.fn()

    subscriptionGate('subcontract')(req, res, next)
    expect(next).toHaveBeenCalled()
  })
})