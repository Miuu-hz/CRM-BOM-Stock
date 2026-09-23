import { describe, it, expect, afterEach } from 'vitest'
import db from '../db/sqlite'
import * as repo from './marketing.repository'

// เดิมไฟล์ marketing.repository.ts ไม่มีคำว่า tenant อยู่เลยสักที่ ทั้งที่ 3 ตารางมีคอลัมน์
// tenant_id (nullable) — ร้าน/ไฟล์/เมตริกของทุก tenant จึงปนกันหมด เทสต์นี้กันไม่ให้หลุดอีก

const A = 'tenant_mkt_a'
const B = 'tenant_mkt_b'

afterEach(() => {
  for (const t of [A, B]) {
    for (const tbl of ['marketing_metrics', 'marketing_files', 'shops']) {
      db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t)
    }
  }
})

describe('marketing repository — tenant isolation', () => {
  it('ร้านค้าของอีก tenant ต้องไม่โผล่ทั้งใน list และ getById', () => {
    const shopA = repo.createShop(A, { name: 'ร้านเอ', platform: 'SHOPEE', shopId: 'A-1' })
    repo.createShop(B, { name: 'ร้านบี', platform: 'SHOPEE', shopId: 'B-1' })

    expect(repo.getAllShops(A).map((s: any) => s.name)).toEqual(['ร้านเอ'])
    expect(repo.getAllShops(B).map((s: any) => s.name)).toEqual(['ร้านบี'])
    expect(repo.getShopById(B, shopA.id)).toBeUndefined()
  })

  it('แก้/ลบร้านของ tenant อื่นไม่ได้', () => {
    const shopA = repo.createShop(A, { name: 'ร้านเอ', platform: 'SHOPEE', shopId: 'A-1' })

    repo.updateShop(B, shopA.id, { name: 'โดนแก้' })
    expect(repo.getShopById(A, shopA.id).name).toBe('ร้านเอ')

    expect(repo.deleteShop(B, shopA.id).changes).toBe(0)
    expect(repo.getShopById(A, shopA.id)).toBeTruthy()
  })

  it('ไฟล์และเมตริกถูกกรองตาม tenant', () => {
    const shopA = repo.createShop(A, { name: 'ร้านเอ', platform: 'SHOPEE', shopId: 'A-1' })
    const shopB = repo.createShop(B, { name: 'ร้านบี', platform: 'SHOPEE', shopId: 'B-1' })

    const fileA = repo.createFile(A, { shopId: shopA.id, fileName: 'a.csv', filePath: '/tmp/a.csv', platform: 'SHOPEE', rowCount: 1 })
    const fileB = repo.createFile(B, { shopId: shopB.id, fileName: 'b.csv', filePath: '/tmp/b.csv', platform: 'SHOPEE', rowCount: 1 })

    repo.createMetric(A, { fileId: fileA.id, shopId: shopA.id, date: '2026-09-01', adCost: 100 })
    repo.createMetric(B, { fileId: fileB.id, shopId: shopB.id, date: '2026-09-01', adCost: 999 })

    expect(repo.getAllFiles(A).map((f: any) => f.fileName)).toEqual(['a.csv'])
    expect(repo.getMetrics(A, {}).map((m: any) => m.adCost)).toEqual([100])
    expect(repo.getMetrics(B, {}).map((m: any) => m.adCost)).toEqual([999])
  })

  it('กรองตามแพลตฟอร์มที่ tenant ไม่มีร้านอยู่ ต้องได้ว่าง ไม่ใช่ของทุกแพลตฟอร์ม', () => {
    const shopA = repo.createShop(A, { name: 'ร้านเอ', platform: 'SHOPEE', shopId: 'A-1' })
    const fileA = repo.createFile(A, { shopId: shopA.id, fileName: 'a.csv', filePath: '/tmp/a.csv', platform: 'SHOPEE', rowCount: 1 })
    repo.createMetric(A, { fileId: fileA.id, shopId: shopA.id, date: '2026-09-01', adCost: 100 })

    expect(repo.getMetrics(A, { platform: 'LAZADA' })).toEqual([])
    expect(repo.getMetrics(A, { platform: 'SHOPEE' })).toHaveLength(1)
  })

  it('bulkCreateMetrics เขียน tenant_id ลงทุกแถว', () => {
    const shopA = repo.createShop(A, { name: 'ร้านเอ', platform: 'SHOPEE', shopId: 'A-1' })
    const fileA = repo.createFile(A, { shopId: shopA.id, fileName: 'a.csv', filePath: '/tmp/a.csv', platform: 'SHOPEE', rowCount: 2 })

    repo.bulkCreateMetrics(A, [
      { fileId: fileA.id, shopId: shopA.id, date: '2026-09-01', adCost: 10 },
      { fileId: fileA.id, shopId: shopA.id, date: '2026-09-02', adCost: 20 },
    ])

    const orphans = db.prepare('SELECT COUNT(*) c FROM marketing_metrics WHERE tenant_id IS NULL').get() as any
    expect(orphans.c).toBe(0)
    expect(repo.getMetrics(A, {})).toHaveLength(2)
    expect(repo.getMetrics(B, {})).toHaveLength(0)
  })
})
