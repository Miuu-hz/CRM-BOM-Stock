import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import posBillRouter from './pos-bill.routes'
import { cancelPosBill } from '../services/posBillCancel.service'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/pos', posBillRouter)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM pos_kds_ticket_items WHERE ticket_id IN (SELECT id FROM pos_kds_tickets WHERE tenant_id = ?)').run(t)
    for (const tbl of [
      'pos_redemptions', 'pos_rewards', 'pos_promotions', 'pos_ad_slots', 'pos_ad_events',
      'pos_member_devices', 'loyalty_transactions', 'pos_kds_tickets', 'journal_lines',
      'journal_entries', 'pos_payments', 'pos_bill_items', 'pos_running_bills', 'pos_tables',
      'pos_shifts', 'pos_menu_configs', 'stock_items', 'customers', 'company_settings',
      'accounts', 'users', 'document_sequences'
    ]) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch { /* no tenant_id column */ }
    }
  }
})

function seedMenu(tenantId: string, posPrice: number) {
  const productId = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, unit, location, status)
    VALUES (?, ?, ?, 'Test Product', 'FOOD', 'pcs', 'WH1', 'ACTIVE')
  `).run(productId, tenantId, productId)
  const menuId = generateId()
  db.prepare(`INSERT INTO pos_menu_configs (id, tenant_id, product_id, pos_price) VALUES (?, ?, ?, ?)`)
    .run(menuId, tenantId, productId, posPrice)
  return menuId
}

describe('E1: posBillCancel.service.ts', () => {
  it('keeps cancel reason when bill notes is null and updates RESERVED redemptions to RETURNED', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    tenants.push(u.tenantId)

    const billId = generateId()
    db.prepare(`
      INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, notes, created_by)
      VALUES (?, ?, ?, 'Bill Without Notes', 'OPEN', NULL, 'tester')
    `).run(billId, u.tenantId, `POS-TEST-${billId}`)

    // Seed customer and reward for redemption
    const customerId = generateId()
    db.prepare(`
      INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city, status, loyalty_points, total_spent)
      VALUES (?, ?, 'CUS-TEST', 'Member Test', 'INDIVIDUAL', 'Member Test', '', '0812345678', '', 'ACTIVE', 100, 0)
    `).run(customerId, u.tenantId)

    const rewardId = generateId()
    db.prepare(`
      INSERT INTO pos_rewards (id, tenant_id, name, points_cost, pos_menu_id, is_active)
      VALUES (?, ?, 'Free Drink', 50, 'menu-free-drink', 1)
    `).run(rewardId, u.tenantId)

    const redemptionId1 = generateId()
    const redemptionId2 = generateId()
    db.prepare(`
      INSERT INTO pos_redemptions (id, tenant_id, bill_id, customer_id, reward_id, bill_item_id, points, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'item-r1', 50, 'RESERVED', ?)
    `).run(redemptionId1, u.tenantId, billId, customerId, rewardId, new Date().toISOString())

    db.prepare(`
      INSERT INTO pos_redemptions (id, tenant_id, bill_id, customer_id, reward_id, bill_item_id, points, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'item-r2', 50, 'USED', ?)
    `).run(redemptionId2, u.tenantId, billId, customerId, rewardId, new Date().toISOString())

    // Cancel the bill
    await cancelPosBill(u.tenantId, u.userId, billId, 'Customer changed mind', 'CANCELLED')

    // Check notes is not null and has the cancel reason
    const bill = db.prepare('SELECT status, notes FROM pos_running_bills WHERE id = ?').get(billId) as any
    expect(bill.status).toBe('CANCELLED')
    expect(bill.notes).toBe('[CANCELLED: Customer changed mind]')

    // Check redemption status
    const r1 = db.prepare('SELECT status FROM pos_redemptions WHERE id = ?').get(redemptionId1) as any
    expect(r1.status).toBe('RETURNED')
    // Non-RESERVED redemption should remain untouched
    const r2 = db.prepare('SELECT status FROM pos_redemptions WHERE id = ?').get(redemptionId2) as any
    expect(r2.status).toBe('USED')
  })

  it('keeps existing notes when cancelling a bill with pre-existing notes', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    tenants.push(u.tenantId)

    const billId = generateId()
    db.prepare(`
      INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, notes, created_by)
      VALUES (?, ?, ?, 'Bill With Notes', 'OPEN', 'VIP table', 'tester')
    `).run(billId, u.tenantId, `POS-TEST-${billId}`)

    await cancelPosBill(u.tenantId, u.userId, billId, 'Mistake', 'CANCELLED')

    const bill = db.prepare('SELECT status, notes FROM pos_running_bills WHERE id = ?').get(billId) as any
    expect(bill.status).toBe('CANCELLED')
    expect(bill.notes).toBe('VIP table [CANCELLED: Mistake]')
  })
})

describe('E2: pos-bill.routes.ts PUT /bills/:billId/items/:itemId', () => {
  it('uses the new note when raising the quantity of an item already sent to kitchen', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    tenants.push(u.tenantId)

    const menuId = seedMenu(u.tenantId, 50)
    const billId = generateId()
    db.prepare(`
      INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, created_by)
      VALUES (?, ?, ?, 'Bill Test', 'OPEN', 'tester')
    `).run(billId, u.tenantId, `POS-TEST-${billId}`)

    const itemId = generateId()
    db.prepare(`
      INSERT INTO pos_bill_items (id, tenant_id, bill_id, pos_menu_id, product_name, quantity, unit_price, total_price, special_instructions, sent_to_kds, created_by)
      VALUES (?, ?, ?, ?, 'Pad Thai', 1, 50, 50, 'no spicy', 1, 'tester')
    `).run(itemId, u.tenantId, billId, menuId)

    const auth = { Authorization: `Bearer ${u.token}` }

    // Send PUT request to raise quantity from 1 to 2 with new note
    const res = await request(app)
      .put(`/api/pos/bills/${billId}/items/${itemId}`)
      .set(auth)
      .send({ quantity: 2, special_instructions: 'extra spicy' })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    // Verify there are now two items: original (1, no spicy) and extra row (1, extra spicy)
    const items = db.prepare(`
      SELECT id, quantity, special_instructions, sent_to_kds
      FROM pos_bill_items
      WHERE bill_id = ?
      ORDER BY rowid ASC
    `).all(billId) as any[]

    expect(items.length).toBe(2)
    // Original row remains sent_to_kds = 1 with original instruction
    expect(items[0].id).toBe(itemId)
    expect(items[0].quantity).toBe(1)
    expect(items[0].special_instructions).toBe('no spicy')
    expect(items[0].sent_to_kds).toBe(1)

    // New row has extra qty 1, new note "extra spicy", and sent_to_kds = 0
    expect(items[1].quantity).toBe(1)
    expect(items[1].special_instructions).toBe('extra spicy')
    expect(items[1].sent_to_kds).toBe(0)
  })

  it('preserves old note if no new note is provided when raising quantity of item sent to kitchen', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    tenants.push(u.tenantId)

    const menuId = seedMenu(u.tenantId, 50)
    const billId = generateId()
    db.prepare(`
      INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, created_by)
      VALUES (?, ?, ?, 'Bill Test 2', 'OPEN', 'tester')
    `).run(billId, u.tenantId, `POS-TEST-${billId}`)

    const itemId = generateId()
    db.prepare(`
      INSERT INTO pos_bill_items (id, tenant_id, bill_id, pos_menu_id, product_name, quantity, unit_price, total_price, special_instructions, sent_to_kds, created_by)
      VALUES (?, ?, ?, ?, 'Fried Rice', 1, 50, 50, 'less oil', 1, 'tester')
    `).run(itemId, u.tenantId, billId, menuId)

    const auth = { Authorization: `Bearer ${u.token}` }

    const res = await request(app)
      .put(`/api/pos/bills/${billId}/items/${itemId}`)
      .set(auth)
      .send({ quantity: 3 })

    expect(res.status).toBe(200)

    const items = db.prepare(`
      SELECT id, quantity, special_instructions, sent_to_kds
      FROM pos_bill_items
      WHERE bill_id = ?
      ORDER BY rowid ASC
    `).all(billId) as any[]

    expect(items.length).toBe(2)
    expect(items[0].quantity).toBe(1)
    expect(items[0].special_instructions).toBe('less oil')
    expect(items[1].quantity).toBe(2)
    expect(items[1].special_instructions).toBe('less oil')
    expect(items[1].sent_to_kds).toBe(0)
  })
})
