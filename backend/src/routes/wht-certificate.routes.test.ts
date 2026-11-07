import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import whtCertificateRouter, { VALID_SECTIONS, defaultIncomeSection } from './wht-certificate.routes'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/wht-certificates', authenticate, whtCertificateRouter)

describe('WHT Certificate sections and default mapping', () => {
  it('40(5) accepted in VALID_SECTIONS', () => {
    expect(VALID_SECTIONS).toContain('40(5)')
  })

  it('defaultIncomeSection maps income types correctly', () => {
    // service / hire of work (ค่าบริการ, รับจ้างทำของ) = 40(8) by default
    expect(defaultIncomeSection('ค่าบริการ')).toBe('40(8)')
    expect(defaultIncomeSection('รับจ้างทำของ')).toBe('40(8)')
    expect(defaultIncomeSection('service')).toBe('40(8)')
    expect(defaultIncomeSection('hire of work')).toBe('40(8)')

    // 40(7) when contractor supplies materials (รับเหมาที่ผู้รับจ้างจัดหาสัมภาระ)
    expect(defaultIncomeSection('รับเหมาที่ผู้รับจ้างจัดหาสัมภาระ')).toBe('40(7)')
    expect(defaultIncomeSection('contractor supplies materials')).toBe('40(7)')

    // 40(2) for fees/commission (ค่าธรรมเนียม ค่านายหน้า)
    expect(defaultIncomeSection('ค่าธรรมเนียม')).toBe('40(2)')
    expect(defaultIncomeSection('ค่านายหน้า')).toBe('40(2)')
    expect(defaultIncomeSection('fees')).toBe('40(2)')
    expect(defaultIncomeSection('commission')).toBe('40(2)')

    // professional (วิชาชีพอิสระ) = 40(6)
    expect(defaultIncomeSection('วิชาชีพอิสระ')).toBe('40(6)')
    expect(defaultIncomeSection('professional')).toBe('40(6)')

    // rent = 40(5)
    expect(defaultIncomeSection('ค่าเช่า')).toBe('40(5)')
    expect(defaultIncomeSection('rent')).toBe('40(5)')

    // advertising = 40(8)
    expect(defaultIncomeSection('ค่าโฆษณา')).toBe('40(8)')
    expect(defaultIncomeSection('advertising')).toBe('40(8)')

    // transport = 40(8)
    expect(defaultIncomeSection('ค่าขนส่ง')).toBe('40(8)')
    expect(defaultIncomeSection('transport')).toBe('40(8)')
  })

  it('accepts 40(5) and takes base_amount from corrected pre-VAT value', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const txnId = generateId()

    // Seed tax_transaction with pre-VAT base (e.g. base 10,000, tax 300, net 10,400)
    db.prepare(`
      INSERT INTO tax_transactions (
        id, tenant_id, transaction_type, source_type, source_id, document_number, document_date,
        partner_id, partner_name, partner_tax_id, description, base_amount, tax_amount, total_amount,
        tax_rate, wht_rate, wht_form, is_deductible
      ) VALUES (?, ?, 'WHT', 'SUPPLIER_PAYMENT', ?, 'SP-TEST-001', '2026-11-08',
        NULL, 'ผู้ให้เช่า', '0105555555555', 'ค่าเช่าสำนักงาน', 10000, 500, 10200, 5, 5, 'PND53', 0)
    `).run(txnId, user.tenantId, generateId())

    const res = await request(app)
      .post(`/api/wht-certificates/from-transaction/${txnId}`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        incomeType: 'ค่าเช่า',
        incomeSection: '40(5)',
      })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.income_section).toBe('40(5)')
    expect(res.body.data.base_amount).toBe(10000)
    expect(res.body.data.tax_amount).toBe(500)
  })

  it('automatically defaults section when incomeSection is omitted in request', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const txnId = generateId()

    db.prepare(`
      INSERT INTO tax_transactions (
        id, tenant_id, transaction_type, source_type, source_id, document_number, document_date,
        partner_id, partner_name, partner_tax_id, description, base_amount, tax_amount, total_amount,
        tax_rate, wht_rate, wht_form, is_deductible
      ) VALUES (?, ?, 'WHT', 'SUPPLIER_PAYMENT', ?, 'SP-TEST-002', '2026-11-08',
        NULL, 'ผู้รับจ้าง', '0105555555556', 'ค่าบริการตรวจรับ', 10000, 300, 10400, 3, 3, 'PND53', 0)
    `).run(txnId, user.tenantId, generateId())

    const res = await request(app)
      .post(`/api/wht-certificates/from-transaction/${txnId}`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        incomeType: 'ค่าบริการ',
      })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.income_section).toBe('40(8)')
    expect(res.body.data.base_amount).toBe(10000)
    expect(res.body.data.tax_amount).toBe(300)
  })
})
