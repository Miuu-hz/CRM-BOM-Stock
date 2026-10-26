import { describe, it, expect } from 'vitest'
import { moneyAccountsOf, leafAccountsOfType, type AccountLike } from './quickEntryAccounts'

describe('quickEntryAccounts', () => {
  it('1102 with child 1102-01 -> only 1102-01 (+1101) offered; receivable 1104 / inventory 1106 never offered', () => {
    const accounts: AccountLike[] = [
      { id: 'acc-1101', code: '1101', name: 'เงินสดในมือ', type: 'ASSET', category: 'CASH', isActive: true },
      { id: 'acc-1102', code: '1102', name: 'เงินฝากธนาคาร', type: 'ASSET', category: 'CASH', isActive: true },
      { id: 'acc-1102-01', code: '1102-01', name: 'ธนาคารกสิกรไทย', type: 'ASSET', category: 'CASH', parent_id: 'acc-1102', isActive: true },
      { id: 'acc-1104', code: '1104', name: 'ลูกหนี้การค้า', type: 'ASSET', category: 'RECEIVABLE', isActive: true },
      { id: 'acc-1106', code: '1106', name: 'สินค้าคงเหลือ', type: 'ASSET', category: 'INVENTORY', isActive: true },
      { id: 'acc-1101-closed', code: '1101-02', name: 'เงินสดย่อยปิดแล้ว', type: 'ASSET', category: 'CASH', isActive: false },
    ]

    const result = moneyAccountsOf(accounts)
    expect(result.map(a => a.code)).toEqual(['1101', '1102-01'])
  })

  it('works when child uses parentId camelCase and correctly excludes headers and inactives', () => {
    const accounts: AccountLike[] = [
      { id: 'parent-bank', code: '1102', name: 'เงินฝากธนาคาร', type: 'ASSET', category: 'CASH', isActive: true },
      { id: 'sub-scb', code: '1102-02', name: 'ไทยพาณิชย์', type: 'ASSET', category: 'CASH', parentId: 'parent-bank', isActive: true },
      { id: 'sub-kbank', code: '1102-01', name: 'กสิกรไทย', type: 'ASSET', category: 'CASH', parentId: 'parent-bank', isActive: true },
    ]

    const result = moneyAccountsOf(accounts)
    // Sorted by code: 1102-01, then 1102-02
    expect(result.map(a => a.code)).toEqual(['1102-01', '1102-02'])
  })

  it('leafAccountsOfType excludes headers for expense and revenue accounts', () => {
    const accounts: AccountLike[] = [
      { id: 'exp-head', code: '5100', name: 'ต้นทุนขาย (หัว)', type: 'EXPENSE', category: 'COGS', isActive: true },
      { id: 'exp-child', code: '5101', name: 'ต้นทุนสินค้า', type: 'EXPENSE', category: 'COGS', parent_id: 'exp-head', isActive: true },
      { id: 'rev-head', code: '4100', name: 'รายได้จากการขาย (หัว)', type: 'REVENUE', category: 'SALES', isActive: true },
      { id: 'rev-child', code: '4101', name: 'ขายสินค้าหน้าร้าน', type: 'REVENUE', category: 'SALES', parentId: 'rev-head', isActive: true },
    ]

    const expenses = leafAccountsOfType(accounts, 'EXPENSE')
    expect(expenses.map(a => a.code)).toEqual(['5101'])

    const revenues = leafAccountsOfType(accounts, 'REVENUE')
    expect(revenues.map(a => a.code)).toEqual(['4101'])
  })
})
