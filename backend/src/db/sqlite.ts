import Database from 'better-sqlite3'
import path from 'path'

const dbPath = path.join(__dirname, '../../dev.db')
const db: any = new Database(dbPath)

// Enable foreign keys
db.pragma('foreign_keys = ON')

// Create tables if they don't exist
db.exec(`
  -- Shops table
  CREATE TABLE IF NOT EXISTS shops (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    shop_id TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(platform, shop_id)
  );

  -- Marketing files table
  CREATE TABLE IF NOT EXISTS marketing_files (
    id TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    platform TEXT NOT NULL,
    user_name TEXT,
    report_start TEXT,
    report_end TEXT,
    row_count INTEGER DEFAULT 0,
    uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (shop_id) REFERENCES shops(id)
  );

  -- Marketing metrics table
  CREATE TABLE IF NOT EXISTS marketing_metrics (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL,
    shop_id TEXT NOT NULL,
    date TEXT NOT NULL,
    order_number INTEGER,
    campaign_name TEXT,
    product_name TEXT,
    sku TEXT,
    ad_status TEXT,

    impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    ctr REAL DEFAULT 0,

    orders INTEGER DEFAULT 0,
    direct_orders INTEGER DEFAULT 0,
    order_rate REAL DEFAULT 0,
    direct_order_rate REAL DEFAULT 0,

    cost_per_order REAL DEFAULT 0,
    direct_cost_per_order REAL DEFAULT 0,

    items_sold INTEGER DEFAULT 0,
    direct_items_sold INTEGER DEFAULT 0,

    sales REAL DEFAULT 0,
    direct_sales REAL DEFAULT 0,

    ad_cost REAL DEFAULT 0,

    roas REAL DEFAULT 0,
    direct_roas REAL DEFAULT 0,
    acos REAL DEFAULT 0,
    direct_acos REAL DEFAULT 0,

    conversion_rate REAL DEFAULT 0,
    extra_data TEXT,

    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (file_id) REFERENCES marketing_files(id) ON DELETE CASCADE,
    FOREIGN KEY (shop_id) REFERENCES shops(id)
  );

  -- Indexes for performance
  CREATE INDEX IF NOT EXISTS idx_metrics_shop_date ON marketing_metrics(shop_id, date);
  CREATE INDEX IF NOT EXISTS idx_metrics_file ON marketing_metrics(file_id);
  CREATE INDEX IF NOT EXISTS idx_files_shop ON marketing_files(shop_id);

  -- ============================================
  -- Suppliers (ผู้ขาย/ซัพพลายเออร์)
  -- ============================================
  CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'RAW_MATERIAL',
    contact_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
    city TEXT,
    tax_id TEXT,
    payment_terms TEXT DEFAULT 'NET30',
    rating INTEGER DEFAULT 0,
    status TEXT DEFAULT 'ACTIVE',
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- ============================================
  -- Purchase Orders (ใบสั่งซื้อ)
  -- ============================================
  CREATE TABLE IF NOT EXISTS purchase_orders (
    id TEXT PRIMARY KEY,
    po_number TEXT NOT NULL UNIQUE,
    supplier_id TEXT NOT NULL,
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
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
  );

  CREATE TABLE IF NOT EXISTS purchase_order_items (
    id TEXT PRIMARY KEY,
    purchase_order_id TEXT NOT NULL,
    material_id TEXT,
    description TEXT,
    quantity REAL DEFAULT 0,
    unit_price REAL DEFAULT 0,
    total_price REAL DEFAULT 0,
    received_qty REAL DEFAULT 0,
    unit TEXT,
    notes TEXT,
    FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
  );

  -- ============================================
  -- Work Orders (ใบสั่งผลิต)
  -- ============================================
  CREATE TABLE IF NOT EXISTS work_orders (
    id TEXT PRIMARY KEY,
    wo_number TEXT NOT NULL UNIQUE,
    bom_id TEXT,
    product_name TEXT,
    quantity INTEGER DEFAULT 0,
    completed_qty INTEGER DEFAULT 0,
    scrap_qty INTEGER DEFAULT 0,
    status TEXT DEFAULT 'DRAFT',
    priority TEXT DEFAULT 'NORMAL',
    start_date TEXT,
    due_date TEXT,
    completed_date TEXT,
    assigned_to TEXT,
    notes TEXT,
    estimated_cost REAL DEFAULT 0,
    actual_cost REAL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS work_order_materials (
    id TEXT PRIMARY KEY,
    work_order_id TEXT NOT NULL,
    material_id TEXT,
    material_name TEXT,
    required_qty REAL DEFAULT 0,
    issued_qty REAL DEFAULT 0,
    unit TEXT,
    status TEXT DEFAULT 'PENDING',
    FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);
  CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
  CREATE INDEX IF NOT EXISTS idx_wo_status ON work_orders(status);
  CREATE INDEX IF NOT EXISTS idx_wo_bom ON work_orders(bom_id);
`)

console.log('✅ SQLite database initialized at:', dbPath)

export default db
