import { describe, it, expect } from 'vitest'
import {
  periodRange,
  compareRange,
  closeChecklistPeriod,
} from './period'

describe('periodRange', () => {
  const fixedNow = new Date('2026-10-26T12:00:00Z')

  it('calculates month range (ตุลาคม 2026)', () => {
    const range = periodRange('month', fixedNow)
    expect(range).toEqual({
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    })
  })

  it('calculates quarter range (Q4 2026)', () => {
    const range = periodRange('quarter', fixedNow)
    expect(range).toEqual({
      startDate: '2026-10-01',
      endDate: '2026-12-31',
    })
  })

  it('calculates year range (2026)', () => {
    const range = periodRange('year', fixedNow)
    expect(range).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    })
  })

  it('calculates 3y range (2024 to 2026)', () => {
    const range = periodRange('3y', fixedNow)
    expect(range).toEqual({
      startDate: '2024-01-01',
      endDate: '2026-12-31',
    })
  })

  it('calculates 5y range (2022 to 2026)', () => {
    const range = periodRange('5y', fixedNow)
    expect(range).toEqual({
      startDate: '2022-01-01',
      endDate: '2026-12-31',
    })
  })

  it('returns custom range if provided', () => {
    const custom = { startDate: '2026-05-01', endDate: '2026-06-15' }
    const range = periodRange('custom', fixedNow, custom)
    expect(range).toEqual(custom)
  })
})

describe('compareRange', () => {
  it('calculates yoy (same period last year)', () => {
    const range = { startDate: '2026-07-01', endDate: '2026-09-30' }
    const cmp = compareRange(range, 'yoy')
    expect(cmp).toEqual({
      startDate: '2025-07-01',
      endDate: '2025-09-30',
    })
  })

  it('calculates prev (contiguous previous period of same length)', () => {
    // 2026-10-01 to 2026-10-31 = 31 days
    const range = { startDate: '2026-10-01', endDate: '2026-10-31' }
    const cmp = compareRange(range, 'prev')
    // prevEnd is 2026-09-30, 31 days before that is 2026-08-31
    expect(cmp).toEqual({
      startDate: '2026-08-31',
      endDate: '2026-09-30',
    })
  })

  it('returns null for budget compare', () => {
    const range = { startDate: '2026-01-01', endDate: '2026-12-31' }
    expect(compareRange(range, 'budget')).toBeNull()
  })
})

describe('closeChecklistPeriod', () => {
  const fixedNow = new Date('2026-10-26T12:00:00Z')

  it('returns month of endDate if that month has already ended', () => {
    // 2026-09-30 has already ended as of 2026-10-26
    const period = closeChecklistPeriod('2026-09-30', fixedNow)
    expect(period).toBe('2026-09')
  })

  it('returns previous month if current month has not ended yet', () => {
    // 2026-10-31 has not ended as of 2026-10-26
    const period = closeChecklistPeriod('2026-10-31', fixedNow)
    expect(period).toBe('2026-09')
  })
})
