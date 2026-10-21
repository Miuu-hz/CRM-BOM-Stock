import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import boardRouter from './phopy-board.routes'
import { createTestUser } from '../test/testAuth'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { seedChartOfAccounts } from '../config/chartOfAccounts'

const app = express()
app.use(express.json())
app.use('/api/phopy-board', boardRouter)

// ทั้ง 2 endpoint รัน SQL จริงทุกโซน — กัน SQL พังตอน runtime และตรวจตัวเลขหลักที่ผู้ใช้เห็น
describe('GET /phopy-board/summary + /extended', () => {
  const user = createTestUser({ role: 'MASTER' })
  const t = user.tenantId
  seedChartOfAccounts(t)
  const acc = (code: string) => (db.prepare('SELECT id FROM accounts WHERE tenant_id = ? AND code = ?').get(t, code) as { id: string }).id
  let n = 0
  const je = (date: string, ref: string, bu: string | null, lines: Array<[string, number, number]>) => {
    const id = generateId()
    db.prepare(`INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, description, is_posted, business_unit)
      VALUES (?, ?, ?, ?, ?, 'test', 1, ?)`).run(id, t, `JV-R-${++n}`, date, ref, bu)
    lines.forEach(([code, dr, cr], i) => db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, debit, credit)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(generateId(), t, id, acc(code), i + 1, dr, cr))
  }
  je('2026-09-30', 'GOODS_RECEIPT', 'OTHER', [['1107', 2000, 0], ['2109', 0, 2000]])
  je('2026-10-05', 'POS_SALE', 'RETAIL', [['1180', 1000, 0], ['4101', 0, 1000]])
  je('2026-10-05', 'POS_COGS', 'RETAIL', [['5101', 300, 0], ['1107', 0, 300]])
  je('2026-10-14', 'STOCK_ADJUST', 'OTHER', [['5102', 200, 0], ['1107', 0, 200]])
  je('2026-10-20', 'POS_SHIFT_CLOSE', 'RETAIL', [['1101', 1022, 0], ['1180', 0, 1000], ['5901', 0, 22]])
  je('2026-10-25', 'PAYROLL', null, [['5301', 400, 0], ['1101', 0, 400]])
  const billId = generateId()
  db.prepare(`INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, opened_at, closed_at, subtotal, total_amount)
    VALUES (?, ?, ?, 'โต๊ะ 1', 'PAID', '2026-10-05T03:00:00.000Z', '2026-10-05T04:00:00.000Z', 1000, 1000)`).run(billId, t, 'B-' + billId.slice(0, 6))
  db.prepare(`INSERT INTO pos_payments (id, tenant_id, bill_id, payment_method, amount, received_by) VALUES (?, ?, ?, 'QR_CODE', 1000, 'x')`).run(generateId(), t, billId)
  // PO ร่างเก่าปี 2024 — เดิมโผล่เป็นเจ้าหนี้ 120+ วัน ต้องไม่นับแล้ว
  db.prepare(`INSERT INTO purchase_orders (id, tenant_id, po_number, status, order_date, total_amount) VALUES (?, ?, 'PO-OLD', 'DRAFT', '2024-10-20', 310)`).run(generateId(), t)

  const q = '?startDate=2026-10-01&endDate=2026-10-31'

  it('summary: P&L, ต้นทุน 2 มุม, POS, เจ้าหนี้ ตรงกับ journal', async () => {
    const res = await request(app).get('/api/phopy-board/summary' + q).set('Authorization', 'Bearer ' + user.token)
    expect(res.status).toBe(200)
    const d = res.body.data
    expect(d.kpis).toMatchObject({ revenue: 1000, cost: 500, grossProfit: 500, netProfit: 500 - 400 + 22, labour: 400 })
    expect(d.businessUnits.find((b: any) => b.unit === 'RETAIL')).toMatchObject({ revenue: 1000, cogs: 300, expense: 0, adjust: -22 })
    expect(d.cogsAnalysis).toMatchObject({ recipe: 300, stockAdjust: 200, ledger: 500, variance: 200 })
    expect(d.cogsAnalysis.stock).toMatchObject({ opening: 2000, closing: 1500, cogs: 500 })
    expect(d.posSales).toMatchObject({ revenue: 1000, bills: 1, avgBill: 1000, diff: 0 })
    expect(d.apDetail.total).toBe(0)
    expect(d.plTable).toHaveLength(1)
    expect(d.plTable[0]).toMatchObject({ month: '2026/10', labour: 400, netProfit: 122 })
    expect(d.earlyWarnings.every((w: any) => w.hint && w.hint.what && w.hint.action)).toBe(true)
  })

  it('extended: ทุกโซนรันได้ และ expense ratio หารรายได้ในบัญชี', async () => {
    const res = await request(app).get('/api/phopy-board/extended' + q).set('Authorization', 'Bearer ' + user.token)
    expect(res.status).toBe(200)
    const cs = res.body.data.costStructure
    expect(cs.ledgerCogsTotal).toBe(500)
    expect(cs.expenseRatio).toBe(37.8)             // (400 − 22) ÷ 1000
    expect(res.body.data.channel.retailRevenue).toBe(1000)
    expect(res.body.data.workingCapital.wcTrend).toHaveLength(12)
  })

  it('วันที่ผิดรูปแบบได้ 400', async () => {
    const res = await request(app).get('/api/phopy-board/summary?startDate=2026-10-01;DROP').set('Authorization', 'Bearer ' + user.token)
    expect(res.status).toBe(400)
  })
})
