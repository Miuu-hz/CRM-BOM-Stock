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
    ]
    for (const [docType, table] of seedMap) {
      try {
        const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[]
        if (!cols.some((c: any) => c.name === 'tenant_id')) {
          console.log(`⚠️ document_sequences seed skipped for ${table}: no tenant_id column`)
          continue
        }
        db.prepare(`
          INSERT OR REPLACE INTO document_sequences (tenant_id, doc_type, year, last_number, updated_at)
          SELECT tenant_id, ?, 0, COUNT(*), CURRENT_TIMESTAMP FROM ${table} GROUP BY tenant_id
        `).run(docType)
      } catch (seedErr) {
        console.error(`⚠️ document_sequences seed error for ${table}:`, seedErr)
      }
    }
    console.log('✅ Migration: document_sequences table ready')
  } catch (e) {
    console.error('⚠️ document_sequences migration error:', e)
  }
}
