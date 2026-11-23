import { describe, it, expect } from 'vitest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { REF_TYPE_DOCS, resolveDocRef, matchStockItem } from './shared'

/**
 * กันบั๊ก REF_TYPE_DOCS ชี้คอลัมน์ผิด — เดิม PURCHASE_INVOICE.numCol = 'invoice_number'
 * แต่ตารางจริงคือ pi_number → attach_document_evidence(doc_type=PURCHASE_INVOICE) throw
 * "no such column" ทุกครั้ง เทสต์นี้วิ่ง resolveDocRef ครบทุก doc type ใน map
 * (better-sqlite3 prepare SQL จริง) คอลัมน์/ตารางไหนผิดจะ throw ทันที
 */
describe('resolveDocRef / REF_TYPE_DOCS', () => {
  const tenantId = 'tn' + generateId()

  for (const docType of new Set([...Object.keys(REF_TYPE_DOCS), 'POS_PAYMENT'])) {
    it(`${docType}: SQL ใช้ตาราง/คอลัมน์ที่มีอยู่จริง (ไม่ throw)`, () => {
      expect(() => resolveDocRef(tenantId, docType, 'ไม่มีเอกสารนี้-' + generateId())).not.toThrow()
      expect(resolveDocRef(tenantId, docType, 'ไม่มีเอกสารนี้-' + generateId())).toBeNull()
    })
  }

  it('numCol ทุกตัวเป็นคอลัมน์จริงของตาราง', () => {
    for (const [docType, info] of Object.entries(REF_TYPE_DOCS)) {
      const cols = (db.prepare(`PRAGMA table_info(${info.table})`).all() as any[]).map(c => c.name)
      expect(cols.length, `${docType}: ไม่มีตาราง ${info.table}`).toBeGreaterThan(0)
      if (info.numCol) expect(cols, `${docType}: ไม่มีคอลัมน์ ${info.numCol}`).toContain(info.numCol)
    }
  })

  it('PURCHASE_INVOICE หาเจอด้วย pi_number และด้วย id', () => {
    const supplierId = generateId()
    db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'Sup', 'C')")
      .run(supplierId, tenantId, supplierId)
    const poId = generateId()
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_rate, tax_amount, total_amount, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'APPROVED', 0, 7, 0, 0, ?, ?)
    `).run(poId, tenantId, 'PO-' + poId.slice(0, 6), supplierId, now, now)
    const piId = generateId()
    const piNumber = 'PI-T-' + piId.slice(0, 6)
    db.prepare('INSERT INTO purchase_invoices (id, tenant_id, pi_number, purchase_order_id, supplier_id) VALUES (?, ?, ?, ?, ?)')
      .run(piId, tenantId, piNumber, poId, supplierId)

    expect(resolveDocRef(tenantId, 'PURCHASE_INVOICE', piNumber)).toEqual({ id: piId, doc_num: piNumber, table: 'purchase_invoices' })
    expect(resolveDocRef(tenantId, 'PURCHASE_INVOICE', piId)).toEqual({ id: piId, doc_num: piNumber, table: 'purchase_invoices' })
    // tenant อื่นต้องไม่เห็น
    expect(resolveDocRef('other-' + tenantId, 'PURCHASE_INVOICE', piNumber)).toBeNull()
  })
})

describe('matchStockItem — escape wildcard % _ \\ ใน LIKE (B8)', () => {
  it('ค้นหาที่มี %, _, \\ ไม่จับคู่แบบ wildcard', () => {
    const t = 'tn_esc_' + generateId()
    const mk = (name: string) => {
      const id = generateId()
      db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
        VALUES (?, ?, ?, ?, 'FINISHED', 10, 'pcs', 'pcs', 10, 'MAIN', 'ACTIVE')`).run(id, t, id, name)
      return id
    }
    mk('น้ำผลไม้ 1000 มล.')
    mk('axb')
    mk('cxb')

    expect(matchStockItem(t, '100%').candidates).toHaveLength(0)
    expect(matchStockItem(t, 'a_b').candidates).toHaveLength(0)
    expect(matchStockItem(t, 'c\\b').candidates).toHaveLength(0)

    const exactPct = mk('น้ำผลไม้ 100%')
    const exactUnder = mk('a_b')
    const exactSlash = mk('c\\b')
    expect(matchStockItem(t, '100%').candidates.map(c => c.id)).toEqual([exactPct])
    expect(matchStockItem(t, 'a_b').exact?.id).toBe(exactUnder)
    expect(matchStockItem(t, 'c\\b').exact?.id).toBe(exactSlash)
  })
})
