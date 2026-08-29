export function runMigrations(db: any): void {
  // ==================== MIGRATIONS ====================
  // Add bom_id column to pos_menu_configs (for existing databases)
  try {
    const tableInfo = db.prepare(`PRAGMA table_info(pos_menu_configs)`).all() as any[]
    const hasBomId = tableInfo.some(col => col.name === 'bom_id')

    if (!hasBomId) {
      db.exec(`ALTER TABLE pos_menu_configs ADD COLUMN bom_id TEXT REFERENCES boms(id) ON DELETE SET NULL`)
      console.log('✅ Migration: Added bom_id column to pos_menu_configs')
    }

    // Create index for bom_id after column exists
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_pos_menu_bom ON pos_menu_configs(bom_id)`)
    } catch (indexError) {
      // Index might already exist or column doesn't exist yet
    }
  } catch (error) {
    console.log('ℹ️ Migration check skipped (table may not exist yet)')
  }

  // Add gs1_barcode and is_pos_enabled columns to stock_items (for existing databases)
  try {
    const stockTableInfo = db.prepare(`PRAGMA table_info(stock_items)`).all() as any[]
    const hasGs1Barcode = stockTableInfo.some(col => col.name === 'gs1_barcode')
    const hasPosEnabled = stockTableInfo.some(col => col.name === 'is_pos_enabled')

    if (!hasGs1Barcode) {
      db.exec(`ALTER TABLE stock_items ADD COLUMN gs1_barcode TEXT`)
      console.log('✅ Migration: Added gs1_barcode column to stock_items')
    }

    if (!hasPosEnabled) {
      db.exec(`ALTER TABLE stock_items ADD COLUMN is_pos_enabled BOOLEAN DEFAULT 0`)
      console.log('✅ Migration: Added is_pos_enabled column to stock_items')
    }

    // Create indexes after columns exist
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_stock_items_gs1 ON stock_items(gs1_barcode)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_stock_items_pos ON stock_items(tenant_id, is_pos_enabled) WHERE is_pos_enabled = 1`)
    } catch (indexError) {
      // Index might already exist
    }
  } catch (error) {
    console.error('ℹ️ Stock items migration error:', error)
  }

  // Fix work_order_materials FK: change from REFERENCES materials(id) to REFERENCES stock_items(id)
  try {
    const womSQL = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='work_order_materials'`).get() as any
    if (womSQL && womSQL.sql && womSQL.sql.includes('REFERENCES materials(id)')) {
      db.pragma('foreign_keys = OFF')
      db.exec(`
        CREATE TABLE work_order_materials_new (
          id TEXT PRIMARY KEY,
          tenant_id TEXT,
          work_order_id TEXT NOT NULL,
          material_id TEXT,
          material_name TEXT,
          required_qty REAL DEFAULT 0,
          issued_qty REAL DEFAULT 0,
          status TEXT DEFAULT 'PENDING',
          FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE,
          FOREIGN KEY (material_id) REFERENCES stock_items(id)
        );
        INSERT INTO work_order_materials_new SELECT id, tenant_id, work_order_id, material_id, material_name, required_qty, issued_qty, status FROM work_order_materials;
        DROP TABLE work_order_materials;
        ALTER TABLE work_order_materials_new RENAME TO work_order_materials;
      `)
      db.pragma('foreign_keys = ON')
      console.log('✅ Migration: Fixed work_order_materials FK to reference stock_items')
    }
  } catch (error) {
    console.error('⚠️ work_order_materials migration error:', error)
    db.pragma('foreign_keys = ON')
  }

  // Fix pos_menu_configs FK: change from REFERENCES products(id) to REFERENCES stock_items(id)
  try {
    const pmcSQL = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='pos_menu_configs'`).get() as any
    if (pmcSQL && pmcSQL.sql && pmcSQL.sql.includes('REFERENCES products(id)')) {
      db.pragma('foreign_keys = OFF')
      db.exec(`
        DROP TABLE IF EXISTS pos_menu_configs_new;
        CREATE TABLE pos_menu_configs_new (
          id TEXT PRIMARY KEY,
          tenant_id TEXT,
          product_id TEXT NOT NULL,
          bom_id TEXT,
          category_id TEXT,
          pos_price REAL NOT NULL,
          cost_price REAL DEFAULT 0,
          is_available BOOLEAN DEFAULT 1,
          is_pos_enabled BOOLEAN DEFAULT 1,
          display_order INTEGER DEFAULT 0,
          quick_code TEXT,
          image_url TEXT,
          preparation_time INTEGER DEFAULT 10,
          description TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (product_id) REFERENCES stock_items(id) ON DELETE CASCADE,
          FOREIGN KEY (bom_id) REFERENCES boms(id) ON DELETE SET NULL,
          FOREIGN KEY (category_id) REFERENCES pos_categories(id),
          UNIQUE(tenant_id, product_id)
        );
        INSERT OR IGNORE INTO pos_menu_configs_new
          (id, tenant_id, product_id, bom_id, category_id, pos_price, cost_price, is_available, is_pos_enabled, display_order, quick_code, image_url, preparation_time, description, created_at, updated_at)
          SELECT id, tenant_id, product_id, bom_id, category_id, pos_price, cost_price, is_available, is_pos_enabled, display_order, quick_code, image_url, preparation_time, description, created_at, updated_at
          FROM pos_menu_configs;
        DROP TABLE pos_menu_configs;
        ALTER TABLE pos_menu_configs_new RENAME TO pos_menu_configs;
      `)
      db.pragma('foreign_keys = ON')
      console.log('✅ Migration: Fixed pos_menu_configs FK to reference stock_items')
    }
  } catch (error) {
    console.error('⚠️ pos_menu_configs migration error:', error)
    db.pragma('foreign_keys = ON')
  }

  // Migration: add sent_to_kds to pos_bill_items
  try {
    const cols = db.prepare(`PRAGMA table_info(pos_bill_items)`).all() as any[]
    if (!cols.some(c => c.name === 'sent_to_kds')) {
      db.exec(`ALTER TABLE pos_bill_items ADD COLUMN sent_to_kds BOOLEAN DEFAULT 0`)
      console.log('✅ Migration: added sent_to_kds to pos_bill_items')
    }
  } catch (e) { console.error('⚠️ sent_to_kds migration error:', e) }

  // Migration: add image_url to stock_items
  try {
    const cols = db.prepare(`PRAGMA table_info(stock_items)`).all() as any[]
    if (!cols.some((c: any) => c.name === 'image_url')) {
      db.exec(`ALTER TABLE stock_items ADD COLUMN image_url TEXT`)
      console.log('✅ Migration: added image_url to stock_items')
    }
  } catch (e) { console.error('⚠️ image_url migration error:', e) }

  // Migration: add unit_price (selling price) to stock_items
  try {
    const cols = db.prepare(`PRAGMA table_info(stock_items)`).all() as any[]
    if (!cols.some((c: any) => c.name === 'unit_price')) {
      db.exec(`ALTER TABLE stock_items ADD COLUMN unit_price REAL DEFAULT 0`)
      console.log('✅ Migration: added unit_price to stock_items')
    }
  } catch (e) { console.error('⚠️ unit_price migration error:', e) }

  // Migration: create pos_shifts table
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pos_shifts (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        shift_number TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'OPEN',
        opened_at TEXT NOT NULL,
        closed_at TEXT,
        opening_cash REAL NOT NULL DEFAULT 0,
        closing_cash_counted REAL,
        expected_cash REAL,
        cash_difference REAL,
        total_revenue REAL DEFAULT 0,
        cash_revenue REAL DEFAULT 0,
        bank_revenue REAL DEFAULT 0,
        bill_count INTEGER DEFAULT 0,
        opened_by TEXT,
        closed_by TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)
    console.log('✅ Migration: pos_shifts table ready')
  } catch (e) { console.error('⚠️ pos_shifts migration error:', e) }

  // Migration: CRM Loyalty Points system
  try {
    db.exec(`ALTER TABLE customers ADD COLUMN loyalty_points REAL DEFAULT 0`)
    console.log('✅ Migration: added loyalty_points to customers')
  } catch (e) { /* already exists */ }

  try {
    db.exec(`ALTER TABLE customers ADD COLUMN total_spent REAL DEFAULT 0`)
    console.log('✅ Migration: added total_spent to customers')
  } catch (e) { /* already exists */ }

  try {
    db.exec(`ALTER TABLE pos_running_bills ADD COLUMN customer_id TEXT`)
    console.log('✅ Migration: added customer_id to pos_running_bills')
  } catch (e) { /* already exists */ }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS crm_points_transactions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        bill_id TEXT,
        type TEXT NOT NULL DEFAULT 'EARN',
        points REAL NOT NULL,
        balance_before REAL NOT NULL DEFAULT 0,
        balance_after REAL NOT NULL DEFAULT 0,
        description TEXT,
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        FOREIGN KEY (bill_id) REFERENCES pos_running_bills(id)
      )
    `)
    console.log('✅ Migration: crm_points_transactions table ready')
  } catch (e) { console.error('⚠️ crm_points_transactions migration error:', e) }

  // Migration: add over/short tracking to pos_clearing_transfers
  try {
    db.exec(`ALTER TABLE pos_clearing_transfers ADD COLUMN original_clearing_amount REAL DEFAULT 0`)
    console.log('✅ Migration: added original_clearing_amount to pos_clearing_transfers')
  } catch (e) { /* column already exists */ }

  try {
    db.exec(`ALTER TABLE pos_clearing_transfers ADD COLUMN cash_difference REAL DEFAULT 0`)
    console.log('✅ Migration: added cash_difference to pos_clearing_transfers')
  } catch (e) { /* column already exists */ }

  // Migration: add VOID support note (pos_running_bills.status already TEXT, VOID is just a new value)
  // No schema change needed — status field accepts any TEXT value

  // Migration: add linked_pr_id to purchase_orders
  try {
    const cols = db.prepare(`PRAGMA table_info(purchase_orders)`).all() as any[]
    if (!cols.some((c: any) => c.name === 'linked_pr_id')) {
      db.exec(`ALTER TABLE purchase_orders ADD COLUMN linked_pr_id TEXT`)
      console.log('✅ Migration: added linked_pr_id to purchase_orders')
    }
  } catch (e) { console.error('⚠️ linked_pr_id migration error:', e) }

  // Migration: Fix purchase_order_items FK — change material_id from REFERENCES materials(id) to REFERENCES stock_items(id)
  // Needed because stock is stored as standalone stock_items (materials table is empty)
  try {
    const poiSQL = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='purchase_order_items'`).get() as any
    if (poiSQL && poiSQL.sql && poiSQL.sql.includes('REFERENCES materials(id)')) {
      db.pragma('foreign_keys = OFF')
      db.exec(`
        CREATE TABLE purchase_order_items_new (
          id TEXT PRIMARY KEY,
          tenant_id TEXT,
          purchase_order_id TEXT NOT NULL,
          material_id TEXT,
          description TEXT,
          quantity REAL DEFAULT 0,
          unit_price REAL DEFAULT 0,
          total_price REAL DEFAULT 0,
          received_qty REAL DEFAULT 0,
          notes TEXT,
          FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
          FOREIGN KEY (material_id) REFERENCES stock_items(id)
        );
        INSERT OR IGNORE INTO purchase_order_items_new SELECT id, tenant_id, purchase_order_id, material_id, description, quantity, unit_price, total_price, received_qty, notes FROM purchase_order_items;
        DROP TABLE purchase_order_items;
        ALTER TABLE purchase_order_items_new RENAME TO purchase_order_items;
      `)
      db.pragma('foreign_keys = ON')
      console.log('✅ Migration: Fixed purchase_order_items FK to reference stock_items')
    }
  } catch (error) {
    console.error('⚠️ purchase_order_items migration error:', error)
    db.pragma('foreign_keys = ON')
  }

  // Migration: Fix goods_receipt_items FK — material_id from REFERENCES materials(id) to REFERENCES stock_items(id)
  try {
    const griSQL = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='goods_receipt_items'`).get() as any
    if (griSQL && griSQL.sql && griSQL.sql.includes('REFERENCES materials(id)')) {
      db.pragma('foreign_keys = OFF')
      db.exec(`
        CREATE TABLE goods_receipt_items_new (
          id TEXT PRIMARY KEY,
          tenant_id TEXT,
          goods_receipt_id TEXT NOT NULL,
          purchase_order_item_id TEXT NOT NULL,
          material_id TEXT,
          ordered_qty REAL DEFAULT 0,
          received_qty REAL DEFAULT 0,
          accepted_qty REAL DEFAULT 0,
          rejected_qty REAL DEFAULT 0,
          lot_number TEXT,
          location TEXT,
          notes TEXT,
          FOREIGN KEY (goods_receipt_id) REFERENCES goods_receipts(id) ON DELETE CASCADE,
          FOREIGN KEY (purchase_order_item_id) REFERENCES purchase_order_items(id),
          FOREIGN KEY (material_id) REFERENCES stock_items(id)
        );
        INSERT OR IGNORE INTO goods_receipt_items_new
          SELECT id, tenant_id, goods_receipt_id, purchase_order_item_id, material_id,
                 ordered_qty, received_qty, accepted_qty, rejected_qty, NULL, NULL, notes
          FROM goods_receipt_items;
        DROP TABLE goods_receipt_items;
        ALTER TABLE goods_receipt_items_new RENAME TO goods_receipt_items;
      `)
      db.pragma('foreign_keys = ON')
      console.log('✅ Migration: Fixed goods_receipt_items FK + added lot_number, location')
    } else {
      // Table already fixed — just add columns if missing
      const cols = db.prepare(`PRAGMA table_info(goods_receipt_items)`).all() as any[]
      if (!cols.some((c: any) => c.name === 'lot_number')) {
        db.exec(`ALTER TABLE goods_receipt_items ADD COLUMN lot_number TEXT`)
        console.log('✅ Migration: added lot_number to goods_receipt_items')
      }
      if (!cols.some((c: any) => c.name === 'location')) {
        db.exec(`ALTER TABLE goods_receipt_items ADD COLUMN location TEXT`)
        console.log('✅ Migration: added location to goods_receipt_items')
      }
    }
  } catch (error) {
    console.error('⚠️ goods_receipt_items migration error:', error)
    db.pragma('foreign_keys = ON')
  }

  // Migration: add delivery_note_no to goods_receipts
  try {
    const cols = db.prepare(`PRAGMA table_info(goods_receipts)`).all() as any[]
    if (!cols.some((c: any) => c.name === 'delivery_note_no')) {
      db.exec(`ALTER TABLE goods_receipts ADD COLUMN delivery_note_no TEXT`)
      console.log('✅ Migration: added delivery_note_no to goods_receipts')
    }
  } catch (e) { console.error('⚠️ delivery_note_no migration error:', e) }

  // Migration: add goods_receipt_ids (JSON array) to purchase_invoices for multi-GR reference
  try {
    const cols = db.prepare(`PRAGMA table_info(purchase_invoices)`).all() as any[]
    if (!cols.some((c: any) => c.name === 'goods_receipt_ids')) {
      db.exec(`ALTER TABLE purchase_invoices ADD COLUMN goods_receipt_ids TEXT DEFAULT '[]'`)
      console.log('✅ Migration: added goods_receipt_ids to purchase_invoices')
    }
  } catch (e) { console.error('⚠️ goods_receipt_ids migration error:', e) }

  // Migration: fix quotation_items — make product_id nullable, add product_name + stock_item_id
  try {
    const cols = db.prepare(`PRAGMA table_info(quotation_items)`).all() as any[]
    const hasProductName = cols.some((c: any) => c.name === 'product_name')
    const hasStockItemId = cols.some((c: any) => c.name === 'stock_item_id')
    const productIdNotNull = cols.find((c: any) => c.name === 'product_id')?.notnull === 1

    if (!hasProductName || !hasStockItemId || productIdNotNull) {
      db.pragma('foreign_keys = OFF')
      db.exec(`
        CREATE TABLE IF NOT EXISTS quotation_items_new (
          id TEXT PRIMARY KEY,
          tenant_id TEXT,
          quotation_id TEXT NOT NULL,
          stock_item_id TEXT,
          product_id TEXT,
          product_name TEXT,
          quantity REAL DEFAULT 0,
          unit_price REAL DEFAULT 0,
          discount_percent REAL DEFAULT 0,
          total_price REAL DEFAULT 0,
          notes TEXT,
          FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE,
          FOREIGN KEY (stock_item_id) REFERENCES stock_items(id)
        );
        INSERT INTO quotation_items_new (id, tenant_id, quotation_id, stock_item_id, product_id, product_name, quantity, unit_price, discount_percent, total_price, notes)
          SELECT id, tenant_id, quotation_id, NULL, product_id, NULL, quantity, unit_price, discount_percent, total_price, notes FROM quotation_items;
        DROP TABLE quotation_items;
        ALTER TABLE quotation_items_new RENAME TO quotation_items;
      `)
      db.pragma('foreign_keys = ON')
      console.log('✅ Migration: rebuilt quotation_items with nullable product_id + product_name + stock_item_id')
    }
  } catch (error) {
    console.error('⚠️ quotation_items migration error:', error)
    db.pragma('foreign_keys = ON')
  }

  // Migration: fix invoice_items — make product_id + sales_order_item_id nullable, add stock_item_id + product_name
  try {
    const cols = db.prepare(`PRAGMA table_info(invoice_items)`).all() as any[]
    const hasProductName = cols.some((c: any) => c.name === 'product_name')
    const hasStockItemId = cols.some((c: any) => c.name === 'stock_item_id')
    const productIdNotNull = cols.find((c: any) => c.name === 'product_id')?.notnull === 1
    const soItemNotNull = cols.find((c: any) => c.name === 'sales_order_item_id')?.notnull === 1

    if (!hasProductName || !hasStockItemId || productIdNotNull || soItemNotNull) {
      db.pragma('foreign_keys = OFF')
      db.exec(`
        CREATE TABLE IF NOT EXISTS invoice_items_new (
          id TEXT PRIMARY KEY,
          tenant_id TEXT,
          invoice_id TEXT NOT NULL,
          sales_order_item_id TEXT,
          stock_item_id TEXT,
          product_id TEXT,
          product_name TEXT,
          quantity REAL DEFAULT 0,
          unit_price REAL DEFAULT 0,
          total_price REAL DEFAULT 0,
          FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
          FOREIGN KEY (sales_order_item_id) REFERENCES sales_order_items(id),
          FOREIGN KEY (stock_item_id) REFERENCES stock_items(id)
        );
        INSERT INTO invoice_items_new (id, tenant_id, invoice_id, sales_order_item_id, stock_item_id, product_id, product_name, quantity, unit_price, total_price)
          SELECT id, tenant_id, invoice_id, sales_order_item_id, NULL, product_id, NULL, quantity, unit_price, total_price FROM invoice_items;
        DROP TABLE invoice_items;
        ALTER TABLE invoice_items_new RENAME TO invoice_items;
      `)
      db.pragma('foreign_keys = ON')
      console.log('✅ Migration: rebuilt invoice_items with nullable product_id + stock_item_id + product_name')
    }
  } catch (error) {
    console.error('⚠️ invoice_items migration error:', error)
    db.pragma('foreign_keys = ON')
  }

  // Migration: fix sales_order_items — make product_id nullable, add product_name + stock_item_id
  try {
    const cols = db.prepare(`PRAGMA table_info(sales_order_items)`).all() as any[]
    const hasProductName = cols.some((c: any) => c.name === 'product_name')
    const hasStockItemId = cols.some((c: any) => c.name === 'stock_item_id')
    const productIdNotNull = cols.find((c: any) => c.name === 'product_id')?.notnull === 1

    if (!hasProductName || !hasStockItemId || productIdNotNull) {
      db.pragma('foreign_keys = OFF')
      db.exec(`
        CREATE TABLE IF NOT EXISTS sales_order_items_new (
          id TEXT PRIMARY KEY,
          tenant_id TEXT,
          sales_order_id TEXT NOT NULL,
          stock_item_id TEXT,
          product_id TEXT,
          product_name TEXT,
          quotation_item_id TEXT,
          quantity REAL DEFAULT 0,
          delivered_qty REAL DEFAULT 0,
          unit_price REAL DEFAULT 0,
          discount_percent REAL DEFAULT 0,
          total_price REAL DEFAULT 0,
          notes TEXT,
          FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id) ON DELETE CASCADE,
          FOREIGN KEY (stock_item_id) REFERENCES stock_items(id),
          FOREIGN KEY (quotation_item_id) REFERENCES quotation_items(id)
        );
        INSERT INTO sales_order_items_new (id, tenant_id, sales_order_id, stock_item_id, product_id, product_name, quotation_item_id, quantity, delivered_qty, unit_price, discount_percent, total_price, notes)
          SELECT id, tenant_id, sales_order_id, NULL, product_id, NULL, quotation_item_id, quantity, delivered_qty, unit_price, discount_percent, total_price, notes FROM sales_order_items;
        DROP TABLE sales_order_items;
        ALTER TABLE sales_order_items_new RENAME TO sales_order_items;
      `)
      db.pragma('foreign_keys = ON')
      console.log('✅ Migration: rebuilt sales_order_items with nullable product_id + product_name + stock_item_id')
    }
  } catch (error) {
    console.error('⚠️ sales_order_items migration error:', error)
    db.pragma('foreign_keys = ON')
  }

  // Migration: add source_number + so_number to journal_entries for cross-reference with Sales
  try {
    db.exec(`ALTER TABLE journal_entries ADD COLUMN source_number TEXT`)
    console.log('✅ Migration: added source_number to journal_entries')
  } catch (e) { /* already exists */ }

  try {
    db.exec(`ALTER TABLE journal_entries ADD COLUMN so_number TEXT`)
    console.log('✅ Migration: added so_number to journal_entries')
  } catch (e) { /* already exists */ }

  // Migration: create company_settings table
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS company_settings (
        tenant_id TEXT PRIMARY KEY,
        name      TEXT,
        address   TEXT,
        phone     TEXT,
        email     TEXT,
        tax_id    TEXT,
        logo_base64 TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `)
    console.log('✅ Migration: company_settings table ready')
  } catch (e) { console.error('⚠️ company_settings migration error:', e) }

  // Migration: add pos_bom_deduct to company_settings (default 1 = enabled)
  try {
    db.exec(`ALTER TABLE company_settings ADD COLUMN pos_bom_deduct INTEGER DEFAULT 1`)
    console.log('✅ Migration: company_settings.pos_bom_deduct added')
  } catch { /* column already exists */ }

  // Migration: add POS billing settings to company_settings
  try {
    db.exec(`ALTER TABLE company_settings ADD COLUMN pos_vat_enabled INTEGER`)
    console.log('✅ Migration: company_settings.pos_vat_enabled added')
  } catch { /* column already exists */ }

  try {
    db.exec(`ALTER TABLE company_settings ADD COLUMN pos_vat_rate REAL`)
    console.log('✅ Migration: company_settings.pos_vat_rate added')
  } catch { /* column already exists */ }

  try {
    db.exec(`ALTER TABLE company_settings ADD COLUMN pos_service_enabled INTEGER`)
    console.log('✅ Migration: company_settings.pos_service_enabled added')
  } catch { /* column already exists */ }

  try {
    db.exec(`ALTER TABLE company_settings ADD COLUMN pos_service_rate REAL`)
    console.log('✅ Migration: company_settings.pos_service_rate added')
  } catch { /* column already exists */ }

  // Migration: fix accounts with NULL is_active (manually created accounts missed the column)
  try {
    db.exec(`UPDATE accounts SET is_active = 1 WHERE is_active IS NULL`)
    console.log('✅ Migration: accounts is_active NULL → 1')
  } catch { /* ignore */ }

  // Migration: Purchase Requests (PR) — created from LINE, filled on web
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS purchase_requests (
        id                    TEXT PRIMARY KEY,
        tenant_id             TEXT NOT NULL,
        pr_number             TEXT NOT NULL,
        supplier_name         TEXT NOT NULL,       -- ชื่อที่พิมพ์มาจาก LINE
        supplier_id           TEXT,                -- FK ที่ map บน web (optional)
        status                TEXT DEFAULT 'DRAFT', -- DRAFT | PENDING | APPROVED | REJECTED | CONVERTED
        source                TEXT DEFAULT 'LINE',  -- LINE | WEB
        requester_line_user_id TEXT,               -- LINE userId ของคนสร้าง
        requester_name        TEXT,               -- ชื่อจาก LINE profile
        source_group_id       TEXT,               -- groupId ถ้าสร้างจากกลุ่ม
        notes                 TEXT,
        approved_by           TEXT,               -- userId ใน system ที่อนุมัติ
        approved_at           TEXT,
        rejection_reason      TEXT,
        created_at            TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at            TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, pr_number),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_pr_tenant_status ON purchase_requests(tenant_id, status);

      CREATE TABLE IF NOT EXISTS purchase_request_items (
        id            TEXT PRIMARY KEY,
        pr_id         TEXT NOT NULL,
        item_name     TEXT NOT NULL,    -- ชื่อจาก LINE (free text)
        material_id   TEXT,            -- map กับ materials/stock_items บน web
        quantity      REAL,            -- กรอกบน web
        unit          TEXT,            -- กรอกบน web
        unit_price    REAL,            -- กรอกบน web
        total_price   REAL GENERATED ALWAYS AS (COALESCE(quantity,0) * COALESCE(unit_price,0)) VIRTUAL,
        sort_order    INTEGER DEFAULT 0,
        FOREIGN KEY (pr_id) REFERENCES purchase_requests(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_pr_items_pr ON purchase_request_items(pr_id);
    `)
    console.log('✅ Migration: purchase_requests tables ready')
  } catch (e) { /* already exists */ }

  // Migration: Add LINE-specific columns to existing purchase_requests table
  ;[
    "ALTER TABLE purchase_requests ADD COLUMN supplier_name TEXT",
    "ALTER TABLE purchase_requests ADD COLUMN source TEXT DEFAULT 'WEB'",
    "ALTER TABLE purchase_requests ADD COLUMN requester_line_user_id TEXT",
    "ALTER TABLE purchase_requests ADD COLUMN source_group_id TEXT",
    "ALTER TABLE purchase_requests ADD COLUMN rejection_reason TEXT",
    "ALTER TABLE purchase_requests ADD COLUMN approved_at TEXT",
  ].forEach(sql => { try { db.exec(sql) } catch { /* column already exists */ } })

  // Migration: Add LINE-specific columns to existing purchase_request_items table
  ;[
    "ALTER TABLE purchase_request_items ADD COLUMN pr_id TEXT",
    "ALTER TABLE purchase_request_items ADD COLUMN item_name TEXT",
    "ALTER TABLE purchase_request_items ADD COLUMN sort_order INTEGER DEFAULT 0",
    "ALTER TABLE purchase_request_items ADD COLUMN unit_price REAL",
  ].forEach(sql => { try { db.exec(sql) } catch { /* column already exists */ } })

  console.log('✅ Migration: purchase_requests LINE columns ready')

  // Migration: LINE group mappings — track LINE groups per tenant for push notifications
  // Recreate without FK on tenant_id (no tenants table in this schema)
  try {
    const grpSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='line_group_mappings'").get() as any
    if (!grpSchema) {
      db.exec(`
        CREATE TABLE line_group_mappings (
          id         TEXT PRIMARY KEY,
          tenant_id  TEXT NOT NULL,
          group_id   TEXT NOT NULL,
          group_name TEXT,
          is_active  INTEGER DEFAULT 1,
          joined_at  TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(tenant_id, group_id)
        );
        CREATE INDEX IF NOT EXISTS idx_line_groups_tenant ON line_group_mappings(tenant_id, is_active);
      `)
      console.log('✅ Migration: line_group_mappings table created')
    } else if (grpSchema.sql?.includes('REFERENCES tenants')) {
      db.pragma('foreign_keys = OFF')
      db.exec(`
        CREATE TABLE line_group_mappings_new (
          id         TEXT PRIMARY KEY,
          tenant_id  TEXT NOT NULL,
          group_id   TEXT NOT NULL,
          group_name TEXT,
          is_active  INTEGER DEFAULT 1,
          joined_at  TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(tenant_id, group_id)
        );
        INSERT OR IGNORE INTO line_group_mappings_new SELECT * FROM line_group_mappings;
        DROP TABLE line_group_mappings;
        ALTER TABLE line_group_mappings_new RENAME TO line_group_mappings;
        CREATE INDEX IF NOT EXISTS idx_line_groups_tenant ON line_group_mappings(tenant_id, is_active);
      `)
      db.pragma('foreign_keys = ON')
      console.log('✅ Migration: line_group_mappings FK removed')
    }
  } catch (e) { console.error('line_group_mappings migration error:', e) }

  // Migration: LINE link tokens — temporary codes for linking LINE userId to system user
  // No FK on user_id: master accounts use synthetic IDs (master_${email}) not in users table
  try {
    db.exec(`
      DROP TABLE IF EXISTS line_link_tokens;
      CREATE TABLE line_link_tokens (
        id         TEXT PRIMARY KEY,
        tenant_id  TEXT NOT NULL,
        user_id    TEXT NOT NULL,
        token      TEXT UNIQUE NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_line_link_tokens_token ON line_link_tokens(token);
    `)
    console.log('✅ Migration: line_link_tokens table ready')
  } catch (e) { console.error('line_link_tokens migration error:', e) }

  // Migration: Remove FK from line_user_mappings (master accounts use synthetic IDs not in users table)
  try {
    const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='line_user_mappings'").get() as any
    if (schema?.sql?.includes('REFERENCES users')) {
      db.pragma('foreign_keys = OFF')
      db.exec(`
        CREATE TABLE line_user_mappings_new (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          line_user_id TEXT NOT NULL,
          role TEXT NOT NULL,
          notify_events TEXT DEFAULT '[]',
          linked_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(tenant_id, user_id),
          UNIQUE(tenant_id, line_user_id)
        );
        INSERT OR IGNORE INTO line_user_mappings_new SELECT * FROM line_user_mappings;
        DROP TABLE line_user_mappings;
        ALTER TABLE line_user_mappings_new RENAME TO line_user_mappings;
      `)
      db.pragma('foreign_keys = ON')
      console.log('✅ Migration: line_user_mappings FK removed')
    }
  } catch (e) { console.error('line_user_mappings migration error:', e) }

  // Migration: pending LINE tasks awaiting user confirmation
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS line_pending_tasks (
        id          TEXT PRIMARY KEY,
        tenant_id   TEXT NOT NULL,
        line_user_id TEXT NOT NULL,
        type        TEXT NOT NULL DEFAULT 'task',  -- 'task' | 'menu'
        title       TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        stock_context TEXT,
        expires_at  TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_pending_tasks_user
        ON line_pending_tasks(tenant_id, line_user_id);
    `)
    // Clean up expired pending tasks on startup
    db.prepare("DELETE FROM line_pending_tasks WHERE expires_at < datetime('now')").run()
    console.log('✅ Migration: line_pending_tasks table ready')
  } catch (e) { console.error('line_pending_tasks migration error:', e) }

  // Migration: Unit Conversions — แปลงหน่วยระหว่างหน่วยนับ (เช่น 1 แพ็ค = 24 ชิ้น)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS unit_conversions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        material_id TEXT,                   -- NULL = ใช้ได้กับทุก material (global)
        from_unit TEXT NOT NULL,            -- หน่วยต้นทาง เช่น 'pack'
        to_unit TEXT NOT NULL,              -- หน่วยปลายทาง/base เช่น 'pcs'
        conversion_factor REAL NOT NULL,    -- ตัวคูณ: 1 from_unit = X to_unit
        is_global INTEGER DEFAULT 0,        -- 1 = มาตรฐานสากล (ล็อคแก้ไขไม่ได้)
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, material_id, from_unit, to_unit)
      );
      CREATE INDEX IF NOT EXISTS idx_unit_conversions_material
        ON unit_conversions(tenant_id, material_id);
    `)
    console.log('✅ Migration: unit_conversions table ready')
  } catch (e) { console.error('unit_conversions migration error:', e) }

  // Migration: add base_unit to materials (หน่วยนับหลักที่ใช้ตัดสต็อก)
  try {
    const cols = db.prepare(`PRAGMA table_info(materials)`).all() as any[]
    if (!cols.some((c: any) => c.name === 'base_unit')) {
      db.exec(`ALTER TABLE materials ADD COLUMN base_unit TEXT`)
      console.log('✅ Migration: added base_unit to materials')
    }
  } catch (e) { console.error('⚠️ base_unit migration error:', e) }

  // Migration: Calculator presets (was previously in-memory from mockData.ts)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS calculator_presets (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        operating_cost REAL DEFAULT 0,
        scrap_value REAL DEFAULT 0,
        total_cost REAL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS calculator_preset_materials (
        id TEXT PRIMARY KEY,
        preset_id TEXT NOT NULL,
        name TEXT NOT NULL,
        quantity REAL NOT NULL,
        unit_price REAL NOT NULL,
        unit TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        FOREIGN KEY (preset_id) REFERENCES calculator_presets(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_calc_preset_tenant ON calculator_presets(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_calc_preset_materials_preset ON calculator_preset_materials(preset_id);
    `)
    console.log('✅ Migration: calculator_presets table ready')
  } catch (e) { console.error('calculator_presets migration error:', e) }

  // Migration: Paperclip company mapping + agent job queue
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS paperclip_companies (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL UNIQUE,
        paperclip_company_id TEXT NOT NULL UNIQUE,
        paperclip_api_key TEXT NOT NULL,
        webhook_secret TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS agent_jobs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        command TEXT NOT NULL,
        payload TEXT,
        paperclip_company_id TEXT,
        paperclip_issue_id TEXT,
        status TEXT DEFAULT 'pending',
        result TEXT,
        error TEXT,
        attempts INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_agent_jobs_status ON agent_jobs(status, created_at);
    `)
    console.log('✅ Migration: paperclip_companies + agent_jobs ready')
  } catch (e) { console.error('agent_jobs migration error:', e) }

  // Migration: add unit column to bom_items
   try {
     const cols = db.prepare(`PRAGMA table_info(bom_items)`).all() as any[]
     if (!cols.some((c: any) => c.name === 'unit')) {
       db.exec(`ALTER TABLE bom_items ADD COLUMN unit TEXT`)
       console.log('✅ Migration: added unit to bom_items')
     }
   } catch (e) { console.error('⚠️ bom_items unit migration error:', e) }
   
   // Migration: add unit column to work_order_materials
   try {
     const cols = db.prepare(`PRAGMA table_info(work_order_materials)`).all() as any[]
     if (!cols.some((c: any) => c.name === 'unit')) {
       db.exec(`ALTER TABLE work_order_materials ADD COLUMN unit TEXT`)
       console.log('✅ Migration: added unit to work_order_materials')
     }
   } catch (e) { console.error('⚠️ work_order_materials unit migration error:', e) }
   
   // Migration: add unit column to purchase_order_items
   try {
     const cols = db.prepare(`PRAGMA table_info(purchase_order_items)`).all() as any[]
     if (!cols.some((c: any) => c.name === 'unit')) {
       db.exec(`ALTER TABLE purchase_order_items ADD COLUMN unit TEXT`)
       console.log('✅ Migration: added unit to purchase_order_items')
     }
   } catch (e) { console.error('⚠️ purchase_order_items unit migration error:', e) }

   // Migration: add unit column to quotation_items
   try {
     const cols = db.prepare(`PRAGMA table_info(quotation_items)`).all() as any[]
     if (!cols.some((c: any) => c.name === 'unit')) {
       db.exec(`ALTER TABLE quotation_items ADD COLUMN unit TEXT`)
       console.log('✅ Migration: added unit to quotation_items')
     }
   } catch (e) { console.error('⚠️ quotation_items unit migration error:', e) }

   // Migration: add unit column to sales_order_items
   try {
     const cols = db.prepare(`PRAGMA table_info(sales_order_items)`).all() as any[]
     if (!cols.some((c: any) => c.name === 'unit')) {
       db.exec(`ALTER TABLE sales_order_items ADD COLUMN unit TEXT`)
       console.log('✅ Migration: added unit to sales_order_items')
     }
   } catch (e) { console.error('⚠️ sales_order_items unit migration error:', e) }

   // Migration: add base_unit, sale_unit, display_unit to stock_items
   try {
     const cols = db.prepare(`PRAGMA table_info(stock_items)`).all() as any[]
     if (!cols.some((c: any) => c.name === 'base_unit')) {
       db.exec(`ALTER TABLE stock_items ADD COLUMN base_unit TEXT`)
       console.log('✅ Migration: added base_unit to stock_items')
     }
     if (!cols.some((c: any) => c.name === 'sale_unit')) {
       db.exec(`ALTER TABLE stock_items ADD COLUMN sale_unit TEXT`)
       console.log('✅ Migration: added sale_unit to stock_items')
     }
     if (!cols.some((c: any) => c.name === 'display_unit')) {
       db.exec(`ALTER TABLE stock_items ADD COLUMN display_unit TEXT`)
       console.log('✅ Migration: added display_unit to stock_items')
     }
   } catch (e) { console.error('⚠️ stock_items base_unit migration error:', e) }

   // Migration: add movement_unit, movement_quantity to stock_movements
   try {
     const cols = db.prepare(`PRAGMA table_info(stock_movements)`).all() as any[]
     if (!cols.some((c: any) => c.name === 'movement_unit')) {
       db.exec(`ALTER TABLE stock_movements ADD COLUMN movement_unit TEXT`)
       console.log('✅ Migration: added movement_unit to stock_movements')
     }
     if (!cols.some((c: any) => c.name === 'movement_quantity')) {
       db.exec(`ALTER TABLE stock_movements ADD COLUMN movement_quantity REAL`)
       console.log('✅ Migration: added movement_quantity to stock_movements')
     }
   } catch (e) { console.error('⚠️ stock_movements movement_unit migration error:', e) }

   // Migration: auto-set base_unit and display_unit for existing stock_items
   try {
     const updated = db.prepare(`
       UPDATE stock_items
       SET base_unit = COALESCE(base_unit, unit),
           display_unit = COALESCE(display_unit, unit),
           sale_unit = COALESCE(sale_unit, unit)
       WHERE base_unit IS NULL OR display_unit IS NULL OR sale_unit IS NULL
     `).run()
     if (updated.changes > 0) {
       console.log(`✅ Migration: auto-set base_unit/display_unit/sale_unit for ${updated.changes} stock_items`)
     }
   } catch (e) { console.error('⚠️ stock_items auto-set base_unit migration error:', e) }

   // Migration: add sale_unit to pos_menu_configs
   try {
     const cols = db.prepare(`PRAGMA table_info(pos_menu_configs)`).all() as any[]
     if (!cols.some((c: any) => c.name === 'sale_unit')) {
       db.exec(`ALTER TABLE pos_menu_configs ADD COLUMN sale_unit TEXT`)
       console.log('✅ Migration: added sale_unit to pos_menu_configs')
     }
   } catch (e) { console.error('⚠️ pos_menu_configs sale_unit migration error:', e) }

   // Migration: auto-set sale_unit for existing pos_menu_configs
   try {
     const updated = db.prepare(`
       UPDATE pos_menu_configs
       SET sale_unit = COALESCE(sale_unit, (SELECT base_unit FROM stock_items si WHERE si.id = pos_menu_configs.product_id AND si.tenant_id = pos_menu_configs.tenant_id), 'pcs')
       WHERE sale_unit IS NULL
     `).run()
     if (updated.changes > 0) {
       console.log(`✅ Migration: auto-set sale_unit for ${updated.changes} pos_menu_configs`)
     }
   } catch (e) { console.error('⚠️ pos_menu_configs auto-set sale_unit migration error:', e) }

  // Migration: add sealed_qty to stock_items
  try {
    const cols = db.prepare(`PRAGMA table_info(stock_items)`).all() as any[]
    if (!cols.some((c: any) => c.name === 'sealed_qty')) {
      db.exec(`ALTER TABLE stock_items ADD COLUMN sealed_qty INTEGER DEFAULT 0`)
      console.log('✅ Migration: added sealed_qty to stock_items')
    }
  } catch (e) { console.error('⚠️ stock_items sealed_qty migration error:', e) }

  // Migration: per-user MCP API key (linked to login account, not tenant)
  try {
    const cols = db.prepare(`PRAGMA table_info(users)`).all() as any[]
    if (!cols.some((c: any) => c.name === 'mcp_api_key')) {
      db.exec(`ALTER TABLE users ADD COLUMN mcp_api_key TEXT`)
      console.log('✅ Migration: users.mcp_api_key added')
    }
  } catch (e) { console.error('⚠️ users.mcp_api_key migration error:', e) }

  // Migration: make purchase_orders.supplier_id nullable (needed for AI-generated draft POs)
  try {
    const poSQL = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='purchase_orders'`).get() as any
    if (poSQL?.sql && /supplier_id\s+TEXT\s+NOT\s+NULL/i.test(poSQL.sql)) {
      db.pragma('foreign_keys = OFF')
      const cols = db.prepare(`PRAGMA table_info(purchase_orders)`).all() as any[]
      const hasLinkedPrId = cols.some((c: any) => c.name === 'linked_pr_id')
      const baseColsCsv = 'id, tenant_id, po_number, supplier_id, status, order_date, expected_date, received_date, subtotal, tax_rate, tax_amount, total_amount, notes, created_by, approved_by, created_at, updated_at'
      const allColsCsv = hasLinkedPrId ? `${baseColsCsv}, linked_pr_id` : baseColsCsv
      db.exec(`
        CREATE TABLE purchase_orders_new (
          id TEXT PRIMARY KEY,
          tenant_id TEXT,
          po_number TEXT NOT NULL,
          supplier_id TEXT,
          status TEXT DEFAULT 'DRAFT',
          order_date TEXT DEFAULT CURRENT_TIMESTAMP,
          expected_date TEXT,
          received_date TEXT,
          subtotal REAL DEFAULT 0,
          tax_rate REAL DEFAULT 0,
          tax_amount REAL DEFAULT 0,
          total_amount REAL DEFAULT 0,
          notes TEXT,
          created_by TEXT,
          approved_by TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          ${hasLinkedPrId ? 'linked_pr_id TEXT,' : ''}
          FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
          UNIQUE(tenant_id, po_number)
        );
        INSERT OR IGNORE INTO purchase_orders_new (${allColsCsv})
          SELECT ${allColsCsv} FROM purchase_orders;
        DROP TABLE purchase_orders;
        ALTER TABLE purchase_orders_new RENAME TO purchase_orders;
      `)
      db.pragma('foreign_keys = ON')
      console.log('✅ Migration: purchase_orders.supplier_id is now nullable')
    }
  } catch (e) {
    console.error('⚠️ purchase_orders supplier_id nullable migration error:', e)
    db.pragma('foreign_keys = ON')
  }

  // Migration: add department column and normalize legacy roles
  try {
    const userCols = db.prepare(`PRAGMA table_info(users)`).all() as any[]
    if (!userCols.some((c: any) => c.name === 'department')) {
      db.exec(`ALTER TABLE users ADD COLUMN department TEXT`)
      console.log('✅ Migration: users.department added')
    }
    db.prepare(`UPDATE users SET role = 'ADMIN' WHERE role = 'MASTER'`).run()
    db.prepare(`UPDATE users SET role = 'USER' WHERE role NOT IN ('ADMIN', 'POWERUSER', 'USER')`).run()
    console.log('✅ Migration: legacy roles normalized')
  } catch (e) {
    console.error('⚠️ users role/department migration error:', e)
  }

  // Migration: atomic document number sequences
  // ponytail: one-row-per-(tenant,doc_type,year) counter replaces COUNT(*)+1,
  // eliminating duplicate document numbers under concurrent inserts.
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS document_sequences (
        tenant_id TEXT NOT NULL,
        doc_type TEXT NOT NULL,
        year INTEGER NOT NULL DEFAULT 0,
        last_number INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (tenant_id, doc_type, year)
      );
      CREATE INDEX IF NOT EXISTS idx_document_sequences_tenant ON document_sequences(tenant_id);
    `)
    // Seed counters from existing document tables so the first atomic number
    // continues after the existing highest sequence, avoiding collisions on upgrade.
    // ponytail: seeded as total per tenant/year=0; this is safe because the new
    // atomic sequence will always exceed the prior COUNT(*)+1 generated numbers.
    const seedMap: [string, string][] = [
      ['QUOTATION', 'quotations'],
      ['SALES_ORDER', 'sales_orders'],
      ['DELIVERY_ORDER', 'delivery_orders'],
      ['INVOICE', 'invoices'],
      ['CREDIT_NOTE', 'credit_notes'],
      ['RECEIPT', 'receipts'],
      ['BACKORDER', 'backorders'],
      ['PURCHASE_REQUEST', 'purchase_requests'],
      ['PO', 'purchase_orders'],
      ['GOODS_RECEIPT', 'goods_receipts'],
      ['PURCHASE_INVOICE', 'purchase_invoices'],
      ['SUPPLIER_PAYMENT', 'supplier_payments'],
      ['PURCHASE_RETURN', 'purchase_returns'],
      ['WORK_ORDER', 'work_orders'],
      ['ORDER', 'orders'],
      ['POS_BILL', 'pos_running_bills'],
      ['POS_DAILY_SALES', 'pos_daily_sales'],
      ['POS_SHIFT', 'pos_shifts'],
      ['JOURNAL', 'journal_entries'],
      ['APPROVAL_REQUEST', 'approval_requests'],
      ['STOCK_ADJUSTMENT', 'stock_adjustments'],
      ['SUBCONTRACT', 'wo_subcontracts'],
      ['SUBCON_ISSUE', 'subcon_material_issues'],
      ['SUBCON_RECEIPT', 'subcon_receipts'],
    ]
    for (const [docType, table] of seedMap) {
      try {
        const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[]
        if (!cols.some((c: any) => c.name === 'tenant_id')) {
          console.log(`⚠️ document_sequences seed skipped for ${table}: no tenant_id column`)
          continue
        }
        // ponytail: seed from MAX numeric tail of the document number, not COUNT(*).
        // COUNT drifts below MAX when documents are deleted, causing duplicate
        // numbers after restart. Never decrease an existing counter.
        const numCol = cols.find((c: any) => c.name.endsWith('_number'))
        if (!numCol) {
          console.log(`⚠️ document_sequences seed skipped for ${table}: no *_number column`)
          continue
        }
        const rows = db.prepare(`SELECT tenant_id, ${numCol.name} AS num FROM ${table}`).all() as any[]
        const maxByTenant = new Map<string, number>()
        for (const r of rows) {
          if (!r.num) continue
          const parts = String(r.num).split('-')
          const tail = parseInt(parts[parts.length - 1], 10)
          if (isNaN(tail)) continue
          const cur = maxByTenant.get(r.tenant_id) || 0
          if (tail > cur) maxByTenant.set(r.tenant_id, tail)
        }
        const upsert = db.prepare(`
          INSERT INTO document_sequences (tenant_id, doc_type, year, last_number, updated_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(tenant_id, doc_type, year) DO UPDATE SET
            last_number = MAX(last_number, excluded.last_number),
            updated_at = CURRENT_TIMESTAMP
        `)
        // ponytail: generateNumber() call sites are split — some pass no year segment
        // (bucket year=0: PO, WORK_ORDER, SUBCONTRACT family) and most pass the current
        // calendar year (bucket year=<current year>: GOODS_RECEIPT, INVOICE, JOURNAL,
        // QUOTATION, SALES_ORDER, PURCHASE_REQUEST, etc). Seeding only year=0 left the
        // year-bucket counter unsynced with real data, so it could fall behind and
        // collide with existing numbers (e.g. after a direct-SQL data seed). Sync both
        // buckets so whichever one a given doc type actually reads stays ahead of MAX.
        const currentYear = new Date().getFullYear()
        for (const [tenantId, maxNum] of maxByTenant) {
          upsert.run(tenantId, docType, 0, maxNum)
          upsert.run(tenantId, docType, currentYear, maxNum)
        }
      } catch (seedErr) {
        console.error(`⚠️ document_sequences seed error for ${table}:`, seedErr)
      }
    }
    console.log('✅ Migration: document_sequences table ready')
  } catch (e) {
    console.error('⚠️ document_sequences migration error:', e)
  }

  // Migration: configurable document number formats (Settings → เลขที่เอกสาร)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS document_number_formats (
        tenant_id TEXT NOT NULL,
        doc_type TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        prefix TEXT NOT NULL,
        padding INTEGER NOT NULL DEFAULT 3,
        date_format TEXT NOT NULL DEFAULT 'DDMMYY',
        separator TEXT NOT NULL DEFAULT '-',
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (tenant_id, doc_type)
      );
    `)
    console.log('✅ Migration: document_number_formats table ready')
  } catch (e) {
    console.error('⚠️ document_number_formats migration error:', e)
  }

  // Migration: QC ↔ Work Order integration (Phase 1)
  // Links qc_inspections to a work_order and tracks inspected/passed/rejected qty
  // so work order completion can be gated on QC results and use QC-verified quantities.
  try {
    const cols = db.prepare(`PRAGMA table_info(qc_inspections)`).all() as any[]
    if (!cols.some((c: any) => c.name === 'work_order_id')) {
      db.exec(`ALTER TABLE qc_inspections ADD COLUMN work_order_id TEXT`)
      console.log('✅ Migration: added work_order_id to qc_inspections')
    }
    if (!cols.some((c: any) => c.name === 'inspected_qty')) {
      db.exec(`ALTER TABLE qc_inspections ADD COLUMN inspected_qty INTEGER DEFAULT 0`)
      console.log('✅ Migration: added inspected_qty to qc_inspections')
    }
    if (!cols.some((c: any) => c.name === 'passed_qty')) {
      db.exec(`ALTER TABLE qc_inspections ADD COLUMN passed_qty INTEGER DEFAULT 0`)
      console.log('✅ Migration: added passed_qty to qc_inspections')
    }
    if (!cols.some((c: any) => c.name === 'rejected_qty')) {
      db.exec(`ALTER TABLE qc_inspections ADD COLUMN rejected_qty INTEGER DEFAULT 0`)
      console.log('✅ Migration: added rejected_qty to qc_inspections')
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_qc_inspections_wo ON qc_inspections(work_order_id)`)
    console.log('✅ Migration: qc_inspections work_order columns/index ready')
  } catch (e) {
    console.error('⚠️ qc_inspections work_order migration error:', e)
  }

  // Migration: QC gate toggle on company_settings (default 0 = disabled → preserves existing behavior)
  try {
    db.exec(`ALTER TABLE company_settings ADD COLUMN qc_gate_enabled INTEGER DEFAULT 0`)
    console.log('✅ Migration: company_settings.qc_gate_enabled added')
  } catch { /* column already exists */ }

  // Migration: Phase 2 — Subcontract piece-rate labor (wo_subcontracts)
  // Table is also created via CREATE TABLE IF NOT EXISTS in schema.ts (applySchema runs on
  // every boot); repeated here for parity with the other table migrations in this file and
  // as a safety net in case applySchema and runMigrations ever diverge.
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS wo_subcontracts (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        contract_number TEXT,
        work_order_id TEXT NOT NULL,
        supplier_id TEXT NOT NULL,
        supplier_name TEXT,
        contract_type TEXT DEFAULT 'PIECE_RATE',
        purchase_order_id TEXT,
        rate_per_unit REAL DEFAULT 0,
        agreed_qty INTEGER DEFAULT 0,
        received_qty INTEGER DEFAULT 0,
        billed_qty INTEGER DEFAULT 0,
        labor_amount REAL DEFAULT 0,
        wht_rate REAL DEFAULT 3,
        paid_amount REAL DEFAULT 0,
        status TEXT DEFAULT 'OPEN',
        due_date TEXT, notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, contract_number)
      );
      CREATE INDEX IF NOT EXISTS idx_wo_subcontracts_wo ON wo_subcontracts(work_order_id);
    `)
    console.log('✅ Migration: wo_subcontracts table ready')
  } catch (e) {
    console.error('⚠️ wo_subcontracts migration error:', e)
  }

  // Migration: Phase 3 — Outsource material issue/receipt + off-site stock ledger
  // Tables are also created via CREATE TABLE IF NOT EXISTS in schema.ts (applySchema runs on
  // every boot); repeated here for parity with the other table migrations in this file and
  // as a safety net in case applySchema and runMigrations ever diverge.
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS subcon_material_issues (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        issue_number TEXT,
        subcontract_id TEXT NOT NULL,
        stock_item_id TEXT NOT NULL,
        item_name TEXT, quantity REAL, unit TEXT,
        unit_cost REAL DEFAULT 0,
        total_value REAL DEFAULT 0,
        issued_at TEXT DEFAULT CURRENT_TIMESTAMP, issued_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_smi_contract ON subcon_material_issues(subcontract_id);

      CREATE TABLE IF NOT EXISTS subcon_receipts (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        receipt_number TEXT,
        subcontract_id TEXT NOT NULL,
        received_qty INTEGER DEFAULT 0,
        scrap_qty INTEGER DEFAULT 0,
        shortage_qty INTEGER DEFAULT 0,
        qc_inspection_id TEXT,
        material_reconcile TEXT DEFAULT '[]',
        notes TEXT,
        received_at TEXT DEFAULT CURRENT_TIMESTAMP, received_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_src_contract ON subcon_receipts(subcontract_id);

      CREATE TABLE IF NOT EXISTS subcon_stock (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        supplier_id TEXT NOT NULL, supplier_name TEXT,
        stock_item_id TEXT NOT NULL, item_name TEXT, unit TEXT,
        quantity REAL DEFAULT 0,
        total_value REAL DEFAULT 0,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, supplier_id, stock_item_id)
      );
    `)
    console.log('✅ Migration: subcon_material_issues / subcon_receipts / subcon_stock tables ready')
  } catch (e) {
    console.error('⚠️ subcon outsource tables migration error:', e)
  }

  // Migration: toggle for "subcon stock value" stat card on Stock page (default 1 = shown → preserves existing behavior)
  try {
    db.exec(`ALTER TABLE company_settings ADD COLUMN show_subcon_stock_widget INTEGER DEFAULT 1`)
    console.log('✅ Migration: company_settings.show_subcon_stock_widget added')
  } catch { /* column already exists */ }

  // Migration: password_changed_at — lets /auth/refresh reject refresh tokens
  // issued before the user's last password change (session revocation).
  try {
    db.exec(`ALTER TABLE users ADD COLUMN password_changed_at TEXT`)
    console.log('✅ Migration: users.password_changed_at added')
  } catch { /* column already exists */ }

  // Migration: business_unit on journal_entries — attributes each JE to
  // RETAIL (POS) / WHOLESALE (sales orders/invoices) / ONLINE (platform ads) / OTHER.
  // Set at creation time by each JE-creating source; backfilled here for existing rows.
  try {
    db.exec(`ALTER TABLE journal_entries ADD COLUMN business_unit TEXT`)
    console.log('✅ Migration: journal_entries.business_unit added')
  } catch { /* column already exists */ }

  try {
    // ponytail: heuristic backfill from reference_type — the only signal old rows carry.
    // Idempotent (only touches rows still missing business_unit), safe to run every boot.
    const backfilled = db.prepare(`
      UPDATE journal_entries
      SET business_unit = CASE
        WHEN reference_type IN ('POS_SALE','POS_COGS','POS_CANCEL','POS_VOID') THEN 'RETAIL'
        WHEN reference_type IN ('INVOICE','PAYMENT') THEN 'WHOLESALE'
        WHEN reference_type = 'AD_SPEND' THEN 'ONLINE'
        ELSE 'OTHER'
      END
      WHERE business_unit IS NULL
    `).run()
    if (backfilled.changes > 0) {
      console.log(`✅ Migration: backfilled business_unit on ${backfilled.changes} journal_entries`)
    }
  } catch (e) { console.error('⚠️ business_unit backfill error:', e) }

  // ==================== SUBSCRIPTION PLANS SEED + TENANT BACKFILL ====================
  // 4 แพ็กเกจตามตารางราคา — INSERT OR IGNORE จึง idempotent, MASTER แก้ผ่าน /api/master/plans ทีหลังได้
  try {
    const insertPlan = db.prepare(`
      INSERT OR IGNORE INTO subscription_plans
        (id, code, name, description, price_monthly, price_yearly, max_users, max_products, max_pos_shifts, features, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const plans: any[][] = [
      ['plan_free', 'free', 'Free', 'ซื้อขายพื้นฐาน ไม่มีวันหมดอายุ', 0, 0, 1, 100, 1,
        JSON.stringify(['stock', 'sales', 'purchase', 'pos']), 1],
      ['plan_starter', 'starter', 'Starter', 'สำหรับร้านค้าเริ่มต้น', 990, 9900, 3, null, 1,
        JSON.stringify(['stock', 'sales', 'crm', 'pos', 'reports']), 2],
      ['plan_business', 'business', 'Business', 'ครบทั้งผลิตและบัญชี', 2490, 24900, 15, null, null,
        JSON.stringify(['stock', 'sales', 'crm', 'pos', 'reports', 'bom', 'work_orders', 'purchase', 'kds', 'accounting', 'tax', 'ai']), 3],
      ['plan_enterprise', 'enterprise', 'Enterprise', 'ไม่จำกัดทุกอย่าง + API access', 5990, 59900, null, null, null,
        JSON.stringify(['stock', 'sales', 'crm', 'pos', 'reports', 'bom', 'work_orders', 'purchase', 'kds', 'accounting', 'tax', 'ai', 'api_access']), 4],
    ]
    for (const p of plans) insertPlan.run(...p)
    console.log('✅ Migration: subscription plans seeded (4 plans)')
  } catch (e) { console.error('⚠️ subscription plans seed error:', e) }

  // Backfill tenant เดิม (จาก company_settings) ที่ยังไม่มี subscription → ACTIVE/enterprise
  // grandfather ไว้ไม่ให้ฟีเจอร์หาย — MASTER ค่อยปรับแพ็กเกจทีหลัง
  try {
    const backfill = db.prepare(`
      INSERT OR IGNORE INTO tenant_subscriptions
        (id, tenant_id, plan_code, status, current_period_start, current_period_end)
      SELECT lower(hex(randomblob(8))), cs.tenant_id, 'enterprise', 'ACTIVE',
             datetime('now'), datetime('now', '+100 years')
      FROM company_settings cs
    `).run()
    if (backfill.changes > 0) {
      console.log(`✅ Migration: backfilled ${backfill.changes} tenant subscription(s) as ACTIVE/enterprise`)
    }
  } catch (e) { console.error('⚠️ tenant subscription backfill error:', e) }

  // signup_requests — self-service signup awaiting Master approval (no tenant until approved)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS signup_requests (
        id TEXT PRIMARY KEY,
        business_name TEXT NOT NULL,
        admin_name TEXT NOT NULL,
        email TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        phone TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        tenant_id TEXT,
        reject_reason TEXT,
        reviewed_by TEXT,
        reviewed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_signup_requests_status ON signup_requests(status)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_signup_requests_email ON signup_requests(email)`)
    console.log('✅ Migration: signup_requests table ready')
  } catch (e) { console.error('⚠️ signup_requests migration error:', e) }

  // bank_accounts — QR รับเงิน + ผูกบัญชี GL (บัญชีย่อยใต้ 1102)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS bank_accounts (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        bank_name TEXT NOT NULL,
        account_name TEXT NOT NULL,
        account_number TEXT NOT NULL,
        qr_code_base64 TEXT,
        account_id TEXT NOT NULL,
        is_default BOOLEAN DEFAULT 0,
        is_active BOOLEAN DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (account_id) REFERENCES accounts(id)
      )
    `)
    console.log('✅ Migration: bank_accounts table ready')
  } catch (e) { console.error('⚠️ bank_accounts migration error:', e) }

  // Link receipts / supplier_payments / pos_payments to the bank account used, so
  // journal posting can resolve the correct linked GL sub-account per payment.
  try {
    db.exec(`ALTER TABLE receipts ADD COLUMN bank_account_id TEXT`)
    console.log('✅ Migration: receipts.bank_account_id added')
  } catch { /* column already exists */ }

  try {
    db.exec(`ALTER TABLE supplier_payments ADD COLUMN bank_account_id TEXT`)
    console.log('✅ Migration: supplier_payments.bank_account_id added')
  } catch { /* column already exists */ }

  try {
    db.exec(`ALTER TABLE pos_payments ADD COLUMN bank_account_id TEXT`)
    console.log('✅ Migration: pos_payments.bank_account_id added')
  } catch { /* column already exists */ }

  // MCP API key ต้องไม่ซ้ำข้ามบริษัท — resolveTenant() ใช้ LIMIT 1 ถ้าคีย์ซ้ำจะ route ไป tenant ไหนก็ได้
  try {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_mcp_api_key
      ON users(mcp_api_key) WHERE mcp_api_key IS NOT NULL AND mcp_api_key != ''
    `)
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_company_settings_mcp_api_key
      ON company_settings(mcp_api_key) WHERE mcp_api_key IS NOT NULL AND mcp_api_key != ''
    `)
    console.log('✅ Migration: unique index on mcp_api_key ready')
  } catch (e) { console.error('⚠️ mcp_api_key unique index migration error:', e) }

  // Goods receipts: remember exactly what was written to stock at confirm time so
  // cancelling a receipt can reverse the identical amount instead of re-deriving it
  // from unit-conversion rules that may have been edited or deleted since.
  // (goods_receipt_items.stock_qty)
  for (const col of [
    'stock_item_id TEXT',
    'stock_qty REAL',
    'stock_sealed_qty REAL',
    'stock_factor REAL',
  ]) {
    try {
      db.exec(`ALTER TABLE goods_receipt_items ADD COLUMN ${col}`)
      console.log(`✅ Migration: goods_receipt_items.${col.split(' ')[0]} added`)
    } catch { /* column already exists */ }
  }

  // BOM output qty/unit: ก่อนหน้านี้ BOM 1 ใบสมมติว่าผลิตได้ 1 หน่วยเสมอ ทำให้กรณี
  // ผลิตแบบ "ซื้อผ้ามาเป็นม้วน → ตัดแบ่งเป็นเมตร (คนละ SKU)" คำนวณต้นทุนต่อหน่วยผิด
  // และปิดใบสั่งงานแล้วไม่รู้ว่า 1 รอบผลิตได้กี่หน่วยผลผลิตจริง — ต้องเก็บ output_qty/
  // output_unit ต่อ BOM แทนการ hardcode = 1. บาก backfill output_qty = 1 ให้แถวเดิม
  // เพื่อไม่ให้ต้นทุนของ BOM ที่มีอยู่แล้วเปลี่ยนค่า (totalCost / 1 = totalCost เท่าเดิม)
  try {
    const cols = db.prepare(`PRAGMA table_info(boms)`).all() as any[]
    if (!cols.some((c: any) => c.name === 'output_qty')) {
      db.exec(`ALTER TABLE boms ADD COLUMN output_qty REAL DEFAULT 1`)
      db.exec(`UPDATE boms SET output_qty = 1 WHERE output_qty IS NULL`)
      console.log('✅ Migration: added output_qty to boms (backfilled = 1)')
    }
    if (!cols.some((c: any) => c.name === 'output_unit')) {
      db.exec(`ALTER TABLE boms ADD COLUMN output_unit TEXT`)
      console.log('✅ Migration: added output_unit to boms (NULL = ใช้ base_unit ของ product)')
    }
  } catch (e) { console.error('⚠️ boms output_qty/output_unit migration error:', e) }

  // Work order unit: ปิดใบสั่งงาน (COMPLETED) ต้องรู้ว่า completed_qty กรอกมาเป็นหน่วยไหน
  // ก่อนจะแปลงเข้าหน่วยฐานของสินค้าสำเร็จรูป (ดู workOrder.routes.ts status === 'COMPLETED')
  // NULL = ใช้หน่วยของสินค้าตาม BOM เหมือนพฤติกรรมเดิม (ไม่ต้องแปลง)
  try {
    const cols = db.prepare(`PRAGMA table_info(work_orders)`).all() as any[]
    if (!cols.some((c: any) => c.name === 'unit')) {
      db.exec(`ALTER TABLE work_orders ADD COLUMN unit TEXT`)
      console.log('✅ Migration: added unit to work_orders')
    }
  } catch (e) { console.error('⚠️ work_orders unit migration error:', e) }

  // Goods receipt invoicing dedup: once a GR is pulled into a purchase invoice it must
  // not be selectable for another invoice (was previously unenforced — same GR/PO could
  // be invoiced twice). invoiced_at is separate from status (DRAFT/CONFIRMED/CANCELLED)
  // which tracks stock receipt, not billing.
  try {
    const grCols = db.prepare(`PRAGMA table_info(goods_receipts)`).all() as any[]
    if (!grCols.some((c: any) => c.name === 'invoiced_at')) {
      db.exec(`ALTER TABLE goods_receipts ADD COLUMN invoiced_at TEXT`)
      console.log('✅ Migration: added invoiced_at to goods_receipts')
    }
  } catch (e) { console.error('⚠️ goods_receipts invoiced_at migration error:', e) }

  // ==================== purchase_price / purchase_unit (stock_items) ====================
  // Shop owners only know what they PAID per purchased unit ("1 pack of eggs = 133 บาท"),
  // never the derived price-per-base-unit ("4.4333 บาท/ฟอง") — the UI label said "ต่อ แพ็ค"
  // but the field underneath stored/showed a per-base-unit number, so owners kept typing
  // the pack price into a field that meant something else and got silently wrong stock
  // costs. purchase_price/purchase_unit store what the owner actually knows; unit_cost
  // KEEPS its existing meaning (price per 1 base_unit) and is now DERIVED from these two:
  //   unit_cost = purchase_price / factor(purchase_unit → base_unit)
  // See priceToBaseUnitCost() in stock.routes.ts / purchase.routes.ts for the write side.
  //
  // Standard-units table duplicated (not imported) from unitConversion.service.ts on
  // purpose: that service does `import db from '../db/sqlite'`, and this migration runs
  // synchronously INSIDE db/sqlite.ts's own module init, before its `export default db`
  // line executes — importing the service here would read `db` as undefined and crash
  // the very first query it runs. Keeping this file import-free (as it already was)
  // avoids that circular-require trap entirely.
  const BACKFILL_STANDARD_FACTORS: Record<string, number> = {
    'kg->g': 1000, 'g->kg': 0.001, 'kg->mg': 1_000_000, 'mg->g': 0.001, 'g->mg': 1000,
    'lb->kg': 0.453592, 'kg->lb': 2.20462, 'oz->g': 28.3495, 'g->oz': 0.035274,
    'hg->g': 100, 'g->hg': 0.01, 'hg->kg': 0.1, 'kg->hg': 10,
    'inch->cm': 2.54, 'cm->inch': 0.393701, 'inch->mm': 25.4, 'mm->inch': 0.0393701,
    'm->cm': 100, 'cm->m': 0.01, 'm->mm': 1000, 'mm->m': 0.001, 'km->m': 1000, 'm->km': 0.001,
    'ft->m': 0.3048, 'm->ft': 3.28084, 'yard->m': 0.9144, 'm->yard': 1.09361,
    'yard->cm': 91.44, 'cm->yard': 0.0109361,
    'l->ml': 1000, 'ml->l': 0.001, 'gallon->l': 3.78541, 'l->gallon': 0.264172,
    'fl_oz->ml': 29.5735, 'ml->fl_oz': 0.033814,
    'm2->cm2': 10000, 'cm2->m2': 0.0001,
    'dozen->pcs': 12, 'pcs->dozen': 0.083333, 'gross->pcs': 144, 'pcs->gross': 0.006944,
    'gross->dozen': 12, 'dozen->gross': 0.083333, 'pair->pcs': 2, 'pcs->pair': 0.5,
  }

  // Best-effort SINGLE-HOP resolver (no multi-hop graph search like the real
  // unitConversion.service.ts) — good enough for a one-time backfill sanity check.
  // Returns null when the factor can't be determined this way; callers must treat
  // that as "unknown / can't verify", never as "mismatch".
  function resolveFactorForBackfillCheck(
    db: any,
    tenantId: string,
    fromUnit: string,
    toUnit: string,
    materialId: string | null
  ): number | null {
    const from = String(fromUnit || '').trim().toLowerCase()
    const to = String(toUnit || '').trim().toLowerCase()
    if (!from || !to) return null
    if (from === to) return 1

    try {
      if (materialId) {
        const rows = db.prepare(
          `SELECT from_unit, to_unit, conversion_factor FROM unit_conversions WHERE material_id = ? AND tenant_id = ?`
        ).all(materialId, tenantId) as any[]
        for (const r of rows) {
          const rf = String(r.from_unit).trim().toLowerCase()
          const rt = String(r.to_unit).trim().toLowerCase()
          if (rf === from && rt === to) return Number(r.conversion_factor)
          if (rf === to && rt === from && Number(r.conversion_factor) > 0) return 1 / Number(r.conversion_factor)
        }
      }
      const gRows = db.prepare(
        `SELECT from_unit, to_unit, conversion_factor FROM unit_conversions WHERE tenant_id = ? AND material_id IS NULL`
      ).all(tenantId) as any[]
      for (const r of gRows) {
        const rf = String(r.from_unit).trim().toLowerCase()
        const rt = String(r.to_unit).trim().toLowerCase()
        if (rf === from && rt === to) return Number(r.conversion_factor)
        if (rf === to && rt === from && Number(r.conversion_factor) > 0) return 1 / Number(r.conversion_factor)
      }
    } catch {
      // unit_conversions table may not exist yet on a brand-new db — treat as unresolved
    }

    const key = `${from}->${to}`
    if (BACKFILL_STANDARD_FACTORS[key] !== undefined) return BACKFILL_STANDARD_FACTORS[key]
    const revKey = `${to}->${from}`
    if (BACKFILL_STANDARD_FACTORS[revKey] !== undefined && BACKFILL_STANDARD_FACTORS[revKey] > 0) {
      return 1 / BACKFILL_STANDARD_FACTORS[revKey]
    }
    return null
  }

  try {
    const stockCols = db.prepare(`PRAGMA table_info(stock_items)`).all() as any[]
    const hasPurchasePrice = stockCols.some((c: any) => c.name === 'purchase_price')
    const hasPurchaseUnit = stockCols.some((c: any) => c.name === 'purchase_unit')

    if (!hasPurchasePrice) {
      db.exec(`ALTER TABLE stock_items ADD COLUMN purchase_price REAL`)
      console.log('✅ Migration: added purchase_price to stock_items')
    }
    if (!hasPurchaseUnit) {
      db.exec(`ALTER TABLE stock_items ADD COLUMN purchase_unit TEXT`)
      console.log('✅ Migration: added purchase_unit to stock_items')
    }

    // Backfill only runs the moment either column is first created — never again — so a
    // shop owner's later manual edits to purchase_price/purchase_unit can't be silently
    // overwritten by re-running this migration on every server start. unit_cost is NEVER
    // written here — its current value is assumed correct already.
    if (!hasPurchasePrice || !hasPurchaseUnit) {
      const items = db.prepare(`SELECT id, tenant_id, sku, name, material_id, base_unit, unit, unit_cost FROM stock_items`).all() as any[]
      const mismatches: string[] = []
      let unresolvedCount = 0
      let filledFromHistory = 0
      let filledFromBaseUnit = 0

      for (const item of items) {
        const baseUnit = item.base_unit || item.unit
        let purchasePrice: number
        let purchaseUnit: string

        // Latest PO history for this item: purchase_order_items.material_id has been
        // used inconsistently across the app (sometimes it's stock_items.material_id —
        // the BOM-linked `materials` row — sometimes it's stock_items.id directly for
        // standalone stock, see the same OR-fallback pattern in purchase.routes.ts's
        // goods-receipt-confirm handler) so check both.
        const hist = db.prepare(`
          SELECT poi.unit_price as unit_price, poi.unit as unit
          FROM purchase_order_items poi
          JOIN purchase_orders po ON po.id = poi.purchase_order_id
          WHERE (poi.material_id = ? OR poi.material_id = ?)
            AND poi.unit IS NOT NULL AND poi.unit != ''
            AND poi.unit_price > 0
          ORDER BY po.created_at DESC, poi.rowid DESC
          LIMIT 1
        `).get(item.material_id, item.id) as any

        if (hist) {
          purchasePrice = Number(hist.unit_price)
          purchaseUnit = String(hist.unit)
          filledFromHistory++
        } else {
          purchasePrice = Number(item.unit_cost) || 0
          purchaseUnit = baseUnit
          filledFromBaseUnit++
        }

        db.prepare(`UPDATE stock_items SET purchase_price = ?, purchase_unit = ? WHERE id = ?`)
          .run(purchasePrice, purchaseUnit, item.id)

        // Sanity check only — never touches unit_cost. Flag rows where the formula
        // doesn't hold so a human can look at that specific item (this is EXPECTED for
        // rows whose only PO history predates the pricing fix and recorded a price in
        // the wrong unit).
        const factor = resolveFactorForBackfillCheck(db, item.tenant_id, purchaseUnit, baseUnit, item.id)
        if (factor === null) {
          unresolvedCount++
        } else {
          const expected = purchasePrice / factor
          const actual = Number(item.unit_cost) || 0
          const tolerance = Math.max(0.01, Math.abs(actual) * 0.01) // 1% or 0.01 บาท, whichever is bigger
          if (Math.abs(expected - actual) > tolerance) {
            mismatches.push(
              `   - [${item.sku}] ${item.name} (id=${item.id}): purchase_price=${purchasePrice} purchase_unit=${purchaseUnit} base_unit=${baseUnit} factor=${factor} ` +
              `→ purchase_price/factor=${expected.toFixed(4)} but unit_cost=${actual} (unit_cost left untouched)`
            )
          }
        }
      }

      console.log(`✅ Migration: backfilled purchase_price/purchase_unit for ${items.length} stock_items (${filledFromHistory} from PO history, ${filledFromBaseUnit} from base_unit fallback)`)
      if (unresolvedCount > 0) {
        console.log(`ℹ️ Migration purchase_price backfill: ${unresolvedCount} rows skipped formula check (no known unit conversion rule to verify against)`)
      }
      if (mismatches.length > 0) {
        console.warn(`⚠️ Migration purchase_price backfill: ${mismatches.length} rows where purchase_price/factor != unit_cost (unit_cost NOT modified, needs human review):`)
        for (const m of mismatches) console.warn(m)
      }
    }
  } catch (e) {
    console.error('⚠️ stock_items purchase_price/purchase_unit migration error:', e)
  }

  // Migration: allow_negative_stock — global toggle to permit selling/consuming
  // past zero (POS payment, sales order confirm, work order material issue) when
  // stock or BOM materials run short. Default 0 = keep the strict "no stock, no
  // sale" behaviour that was already in place.
  try {
    db.exec(`ALTER TABLE company_settings ADD COLUMN allow_negative_stock INTEGER DEFAULT 0`)
    console.log('✅ Migration: company_settings.allow_negative_stock added')
  } catch { /* column already exists */ }

  // Migration: require_pos_shift — global toggle to force cashiers to open a
  // POS shift before a bill can be paid. Default 0 = keep the existing
  // behaviour (sell without opening a shift) so existing tenants are not
  // suddenly blocked from selling.
  try {
    db.exec(`ALTER TABLE company_settings ADD COLUMN require_pos_shift INTEGER DEFAULT 0`)
    console.log('✅ Migration: company_settings.require_pos_shift added')
  } catch { /* column already exists */ }

  // Migration: pos_running_bills.shift_id — attributes a running bill to the
  // POS shift that was open when it was created, so shift close can sum
  // sales by shift_id instead of guessing from a time range. NULL for bills
  // created before this migration or while no shift was open.
  try {
    db.exec(`ALTER TABLE pos_running_bills ADD COLUMN shift_id TEXT`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_pos_bills_shift ON pos_running_bills(shift_id)`)
    console.log('✅ Migration: pos_running_bills.shift_id added')
  } catch { /* column already exists */ }

  // Migration: pos_shift_cash_movements — petty cash in/out of the POS
  // drawer during an open shift (paid-out for expenses, cash-in top-ups).
  // Each row also posts a GL entry immediately (see pos.routes.ts).
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pos_shift_cash_movements (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        shift_id TEXT NOT NULL,
        type TEXT NOT NULL,              -- PAID_OUT | CASH_IN
        amount REAL NOT NULL,
        reason TEXT,
        account_id TEXT NOT NULL,        -- expense/source account chosen by the user
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_pos_shift_cash_mv_shift ON pos_shift_cash_movements(shift_id);
    `)
    console.log('✅ Migration: pos_shift_cash_movements table ready')
  } catch (e) {
    console.error('⚠️ pos_shift_cash_movements migration error:', e)
  }

  // Migration: purchase_return_items.material_id FK rebuild — it pointed at
  // materials(id), but every writer of this column (the return-modal's
  // MaterialSearchInput, backed by stockService.getAll() the same way
  // purchase_order_items.material_id / goods_receipt_items.material_id are
  // populated — both verified to match stock_items.id, not materials.id)
  // actually stores a stock_items.id there. materials only has ~42 rows vs
  // ~492 in stock_items, so the stale FK rejected essentially every insert
  // with "FOREIGN KEY constraint failed", meaning POST /purchase/returns
  // always 500'd and purchase_returns stayed permanently empty.
  // Rebuild via the standard SQLite recipe (FK off → new table → copy →
  // drop → rename → FK on → integrity check). Idempotent: skipped once the
  // FK already targets stock_items.
  try {
    const returnFkList = db.prepare(`PRAGMA foreign_key_list(purchase_return_items)`).all() as any[]
    const materialFk = returnFkList.find((fk: any) => fk.from === 'material_id')
    if (materialFk && materialFk.table !== 'stock_items') {
      db.exec(`PRAGMA foreign_keys=OFF`)
      const rebuild = db.transaction(() => {
        db.exec(`
          CREATE TABLE purchase_return_items_new (
            id TEXT PRIMARY KEY,
            tenant_id TEXT,
            purchase_return_id TEXT NOT NULL,
            goods_receipt_item_id TEXT,
            material_id TEXT,
            quantity REAL DEFAULT 0,
            unit_price REAL DEFAULT 0,
            reason TEXT,
            total_price REAL DEFAULT 0,
            FOREIGN KEY (purchase_return_id) REFERENCES purchase_returns(id) ON DELETE CASCADE,
            FOREIGN KEY (goods_receipt_item_id) REFERENCES goods_receipt_items(id),
            FOREIGN KEY (material_id) REFERENCES stock_items(id)
          )
        `)
        db.exec(`
          INSERT INTO purchase_return_items_new (id, tenant_id, purchase_return_id, goods_receipt_item_id, material_id, quantity, unit_price, reason, total_price)
          SELECT id, tenant_id, purchase_return_id, goods_receipt_item_id, material_id, quantity, unit_price, reason, total_price
          FROM purchase_return_items
        `)
        db.exec(`DROP TABLE purchase_return_items`)
        db.exec(`ALTER TABLE purchase_return_items_new RENAME TO purchase_return_items`)
      })
      rebuild()
      db.exec(`PRAGMA foreign_keys=ON`)
      const violations = db.prepare(`PRAGMA foreign_key_check(purchase_return_items)`).all()
      if (violations.length > 0) {
        console.error('⚠️ Migration: purchase_return_items FK rebuild left orphaned rows (needs manual review):', violations)
      } else {
        console.log('✅ Migration: purchase_return_items.material_id FK now points to stock_items(id)')
      }
    }
  } catch (e) {
    console.error('⚠️ purchase_return_items FK rebuild migration error:', e)
    try { db.exec(`PRAGMA foreign_keys=ON`) } catch {}
  }

  // Migration: credit_note_items.product_id NOT NULL + FK rebuild — same defect
  // class as purchase_return_items.material_id above. product_id was declared
  // NOT NULL REFERENCES products(id), but nothing in the real sales pipeline ever
  // populates a products.id here: invoice_items.product_id is NULL on every real
  // row (18/18) and stock_items.product_id is NULL on every real row (492/492).
  // products is a disconnected 12-row catalog, unrelated to what's actually sold.
  // Net effect: POST /sales/credit-notes with return-mode items always threw
  // "FOREIGN KEY constraint failed", so credit_note_items stayed permanently
  // empty (0 rows) and restoreCreditNoteStock() never had anything to restore.
  // Fix: make product_id nullable with no FK — creditNotes.ts already resolves
  // the actual stock item via invoice_item_id -> invoice_items.stock_item_id,
  // never via product_id, so nothing downstream depends on this constraint.
  // Same rebuild recipe as purchase_return_items. Idempotent: skipped once
  // product_id is already nullable.
  try {
    const cniCols = db.prepare(`PRAGMA table_info(credit_note_items)`).all() as any[]
    const productIdCol = cniCols.find((c: any) => c.name === 'product_id')
    if (productIdCol && productIdCol.notnull === 1) {
      db.exec(`PRAGMA foreign_keys=OFF`)
      const rebuild = db.transaction(() => {
        db.exec(`
          CREATE TABLE credit_note_items_new (
            id TEXT PRIMARY KEY,
            tenant_id TEXT,
            credit_note_id TEXT NOT NULL,
            invoice_item_id TEXT NOT NULL,
            product_id TEXT,
            quantity REAL DEFAULT 0,
            unit_price REAL DEFAULT 0,
            reason TEXT,
            total_price REAL DEFAULT 0,
            FOREIGN KEY (credit_note_id) REFERENCES credit_notes(id) ON DELETE CASCADE,
            FOREIGN KEY (invoice_item_id) REFERENCES invoice_items(id)
          )
        `)
        db.exec(`
          INSERT INTO credit_note_items_new (id, tenant_id, credit_note_id, invoice_item_id, product_id, quantity, unit_price, reason, total_price)
          SELECT id, tenant_id, credit_note_id, invoice_item_id, product_id, quantity, unit_price, reason, total_price
          FROM credit_note_items
        `)
        db.exec(`DROP TABLE credit_note_items`)
        db.exec(`ALTER TABLE credit_note_items_new RENAME TO credit_note_items`)
      })
      rebuild()
      db.exec(`PRAGMA foreign_keys=ON`)
      const violations = db.prepare(`PRAGMA foreign_key_check(credit_note_items)`).all()
      if (violations.length > 0) {
        console.error('⚠️ Migration: credit_note_items FK rebuild left orphaned rows (needs manual review):', violations)
      } else {
        console.log('✅ Migration: credit_note_items.product_id is now nullable with no FK to products')
      }
    }
  } catch (e) {
    console.error('⚠️ credit_note_items FK rebuild migration error:', e)
    try { db.exec(`PRAGMA foreign_keys=ON`) } catch {}
  }
}
