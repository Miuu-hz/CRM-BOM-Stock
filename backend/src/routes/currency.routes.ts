import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'

// THB is always the accounting base currency (exchange_rate = 1, fixed). Foreign currencies
// are captured at document level only — see invoices.ts / purchaseOrder.routes.ts. No
// revaluation, no FX gain/loss automation. ponytail: scope ceiling per task spec.
db.prepare(`CREATE TABLE IF NOT EXISTS currencies (
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  symbol TEXT,
  exchange_rate REAL NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, code)
)`).run()

// ponytail: rates below are placeholders, not a live FX feed — admins edit via PUT /:code.
const DEFAULT_CURRENCIES = [
  { code: 'THB', name: 'บาทไทย', symbol: '฿', exchange_rate: 1 },
  { code: 'USD', name: 'ดอลลาร์สหรัฐ', symbol: '$', exchange_rate: 35.5 },
  { code: 'EUR', name: 'ยูโร', symbol: '€', exchange_rate: 38.5 },
  { code: 'CNY', name: 'หยวนจีน', symbol: '¥', exchange_rate: 4.9 },
  { code: 'JPY', name: 'เยนญี่ปุ่น', symbol: '¥', exchange_rate: 0.23 },
]

// currencies is keyed by (tenant_id, code) so a table-level seed at module load can't target
// every tenant that will ever exist — seed lazily per-tenant on first read instead.
function ensureSeededForTenant(tenantId: string) {
  const existing = db.prepare('SELECT COUNT(*) as count FROM currencies WHERE tenant_id = ?').get(tenantId) as { count: number }
  if (existing.count > 0) return

  const now = new Date().toISOString()
  const insert = db.prepare(`
    INSERT INTO currencies (tenant_id, code, name, symbol, exchange_rate, is_active, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `)
  const run = db.transaction(() => {
    for (const c of DEFAULT_CURRENCIES) {
      insert.run(tenantId, c.code, c.name, c.symbol, c.exchange_rate, now)
    }
  })
  run()
}

const router = Router()
router.use(authenticate)

// GET /api/currencies
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    ensureSeededForTenant(tenantId)

    const rows = db.prepare(
      `SELECT * FROM currencies WHERE tenant_id = ? ORDER BY (code = 'THB') DESC, code`
    ).all(tenantId)

    res.json({ success: true, data: rows })
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// PUT /api/currencies/:code — update rate/name/active
router.put('/:code', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const code = String(req.params.code).toUpperCase()
    ensureSeededForTenant(tenantId)

    const existing = db.prepare('SELECT * FROM currencies WHERE tenant_id = ? AND code = ?').get(tenantId, code) as any
    if (!existing) return res.status(404).json({ success: false, message: 'ไม่พบสกุลเงินนี้' })

    const { name, symbol, exchangeRate, isActive } = req.body

    // THB is the fixed accounting base — its rate can never move away from 1.
    let rate = existing.exchange_rate
    if (code === 'THB') {
      rate = 1
    } else if (exchangeRate !== undefined) {
      const n = Number(exchangeRate)
      if (!Number.isFinite(n) || n <= 0) {
        return res.status(400).json({ success: false, message: 'อัตราแลกเปลี่ยนต้องมากกว่า 0' })
      }
      rate = n
    }

    const nextName = typeof name === 'string' && name.trim() ? name.trim() : existing.name
    const nextSymbol = typeof symbol === 'string' ? symbol : existing.symbol
    // THB must always stay active — it's the base currency every accounting entry relies on.
    const nextActive = code === 'THB' ? 1 : (typeof isActive === 'boolean' ? (isActive ? 1 : 0) : existing.is_active)
    const now = new Date().toISOString()

    db.prepare(`
      UPDATE currencies SET name = ?, symbol = ?, exchange_rate = ?, is_active = ?, updated_at = ?
      WHERE tenant_id = ? AND code = ?
    `).run(nextName, nextSymbol, rate, nextActive, now, tenantId, code)

    const updated = db.prepare('SELECT * FROM currencies WHERE tenant_id = ? AND code = ?').get(tenantId, code)
    res.json({ success: true, data: updated })
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
})

export default router
