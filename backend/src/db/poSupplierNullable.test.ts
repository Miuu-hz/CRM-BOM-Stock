import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { makePoSupplierNullable } from './migrations'

/** DB จำลองแบบเก่า: supplier_id NOT NULL + คอลัมน์ที่ ALTER เพิ่มทีหลัง + index ตาม schema.ts */
function legacyDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE suppliers (id TEXT PRIMARY KEY);
    CREATE TABLE purchase_orders (
      id TEXT PRIMARY KEY, tenant_id TEXT, po_number TEXT NOT NULL, supplier_id TEXT NOT NULL,
      status TEXT DEFAULT 'DRAFT', order_date TEXT, expected_date TEXT, received_date TEXT,
      subtotal REAL DEFAULT 0, tax_rate REAL DEFAULT 0, tax_amount REAL DEFAULT 0, total_amount REAL DEFAULT 0,
      notes TEXT, created_by TEXT, approved_by TEXT, created_at TEXT, updated_at TEXT,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id), UNIQUE(tenant_id, po_number)
    );
    ALTER TABLE purchase_orders ADD COLUMN payment_method TEXT DEFAULT 'CASH';
    ALTER TABLE purchase_orders ADD COLUMN is_paid INTEGER DEFAULT 0;
    CREATE INDEX idx_po_supplier ON purchase_orders(supplier_id);
    CREATE INDEX idx_po_status ON purchase_orders(status);
    INSERT INTO suppliers (id) VALUES ('s1');
    INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, total_amount, payment_method, is_paid)
      VALUES ('po1', 't1', 'PO-1', 's1', 'APPROVED', 500, 'TRANSFER', 1);
  `)
  return db
}
const poIndexes = (db: any) => (db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='purchase_orders' AND name LIKE 'idx_%' ORDER BY name`).all() as any[]).map(r => r.name)

describe('migration: purchase_orders.supplier_id เป็น NULL ได้', () => {
  it('DB เก่า → rebuild แล้วข้อมูล/คอลัมน์ที่เพิ่มทีหลัง/index อยู่ครบ และ supplier_id ว่างได้', () => {
    const db = legacyDb()
    expect(makePoSupplierNullable(db)).toBe(true)
    const row = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get('po1') as any
    expect(row).toMatchObject({ po_number: 'PO-1', supplier_id: 's1', status: 'APPROVED', total_amount: 500, payment_method: 'TRANSFER', is_paid: 1 })
    expect(poIndexes(db)).toEqual(['idx_po_status', 'idx_po_supplier'])
    db.prepare(`INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id) VALUES ('po2', 't1', 'PO-2', NULL)`).run()
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'purchase_orders_new'`).get()).toBeUndefined()
  })

  it('ตารางที่ NULL ได้อยู่แล้ว → ไม่ทำอะไร', () => {
    const db = legacyDb()
    makePoSupplierNullable(db)
    const before = (db.prepare(`SELECT sql FROM sqlite_master WHERE name='purchase_orders'`).get() as any).sql
    expect(makePoSupplierNullable(db)).toBe(false)
    expect((db.prepare(`SELECT sql FROM sqlite_master WHERE name='purchase_orders'`).get() as any).sql).toBe(before)
  })

  it('ตาราง _new ค้างจากรอบที่พังก่อนหน้า → ทิ้งแล้วทำต่อได้ · พังกลางทาง = rollback ตารางเดิมอยู่ครบ', () => {
    const db = legacyDb()
    db.exec(`CREATE TABLE purchase_orders_new (junk TEXT)`)
    expect(makePoSupplierNullable(db)).toBe(true)

    const broken = legacyDb()
    broken.exec(`ALTER TABLE purchase_orders ADD COLUMN "bad col" TEXT`) // ชื่อคอลัมน์มีช่องว่าง → CREATE พัง
    expect(() => makePoSupplierNullable(broken)).toThrow()
    expect(broken.prepare('SELECT COUNT(*) AS n FROM purchase_orders').get()).toEqual({ n: 1 })
    expect(poIndexes(broken)).toEqual(['idx_po_status', 'idx_po_supplier'])
    expect(broken.pragma('foreign_keys', { simple: true })).toBe(1)
  })
})
