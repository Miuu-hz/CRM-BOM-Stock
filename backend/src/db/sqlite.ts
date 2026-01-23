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
`)

console.log('✅ SQLite database initialized at:', dbPath)

export default db
