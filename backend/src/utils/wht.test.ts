import { describe, it, expect } from 'vitest'
import { calcWhtBase, calcWhtAmount } from './wht'

describe('WHT calculation on pre-VAT base', () => {
  it('WHT base excludes VAT: paid 10,700 incl. 7% VAT, 3% -> base 10,000, tax 300', () => {
    const invoice = {
      subtotal: 10000,
      tax_amount: 700,
      total_amount: 10700,
      tax_rate: 7,
    }
    const base = calcWhtBase(10700, invoice)
    expect(base).toBe(10000)

    const tax = calcWhtAmount(base, 3)
    expect(tax).toBe(300)
  })

  it('WHT base excludes VAT on proportional partial payment', () => {
    const invoice = {
      subtotal: 10000,
      tax_amount: 700,
      total_amount: 10700,
      tax_rate: 7,
    }
    // จ่ายครึ่งหนึ่ง 5,350 -> ฐานก่อน VAT คือ 5,000
    const base = calcWhtBase(5350, invoice)
    expect(base).toBe(5000)

    const tax = calcWhtAmount(base, 3)
    expect(tax).toBe(150)
  })

  it('Payment with no VAT info or without invoice defaults base to payment amount', () => {
    // ไม่มี invoice
    expect(calcWhtBase(5000, null)).toBe(5000)

    // invoice ไม่มี VAT (tax_amount = 0)
    const noVatInvoice = {
      subtotal: 5000,
      tax_amount: 0,
      total_amount: 5000,
      tax_rate: 0,
    }
    expect(calcWhtBase(5000, noVatInvoice)).toBe(5000)
    expect(calcWhtAmount(5000, 3)).toBe(150)
  })
})
