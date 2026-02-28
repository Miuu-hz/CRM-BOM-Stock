import Database from 'better-sqlite3'
import path from 'path'

const dbPath = path.join(__dirname, '../../dev.db')
const db: any = new Database(dbPath)

// Enable foreign keys
db.pragma('foreign_keys = ON')

// ============================================
// Multi-Tenant Schema (Shared DB + Tenant ID)
// ============================================
db.exec(`
  -- ==================== TENANTS (บริษัท/ร้าน) ====================
  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    logo TEXT,
    address TEXT,
    phone TEXT,
    email TEXT,
    tax_id TEXT,
    status TEXT DEFAULT 'ACTIVE',
    plan TEXT DEFAULT 'FREE',
    expires_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_tenants_code ON tenants(code);
  CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);

  -- ==================== USERS ====================
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    email TEXT NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'USER',
    status TEXT DEFAULT 'ACTIVE',
    last_login_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, email)
  );

  CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_users_tenant_email ON users(tenant_id, email);

  -- ==================== CUSTOMERS ====================
  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT,
    city TEXT NOT NULL,
    credit_limit REAL DEFAULT 0,
    status TEXT DEFAULT 'ACTIVE',
    total_orders INTEGER DEFAULT 0,
    total_revenue REAL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, code)
  );

  CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_customers_tenant_status ON customers(tenant_id, status);

  -- ==================== PRODUCTS ====================
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'ACTIVE',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, code)
  );

  CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id);

  -- ==================== MATERIALS ====================
  CREATE TABLE IF NOT EXISTS materials (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    unit_cost REAL NOT NULL,
    min_stock INTEGER DEFAULT 0,
    max_stock INTEGER DEFAULT 1000,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, code)
  );

  CREATE INDEX IF NOT EXISTS idx_materials_tenant ON materials(tenant_id);

  -- ==================== BOMs ====================
  CREATE TABLE IF NOT EXISTS boms (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    version TEXT NOT NULL,
    status TEXT DEFAULT 'DRAFT',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id),
    UNIQUE(tenant_id, product_id, version)
  );

  CREATE INDEX IF NOT EXISTS idx_boms_tenant ON boms(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_boms_product ON boms(product_id);

  CREATE TABLE IF NOT EXISTS bom_items (
    id TEXT PRIMARY KEY,
    bom_id TEXT NOT NULL,
    material_id TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit TEXT NOT NULL,
    FOREIGN KEY (bom_id) REFERENCES boms(id) ON DELETE CASCADE,
    FOREIGN KEY (material_id) REFERENCES materials(id)
  );

  CREATE INDEX IF NOT EXISTS idx_bom_items_bom ON bom_items(bom_id);

  -- ==================== ORDERS ====================
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    order_number TEXT UNIQUE NOT NULL,
    customer_id TEXT NOT NULL,
    order_date TEXT DEFAULT CURRENT_TIMESTAMP,
    delivery_date TEXT,
    total_amount REAL NOT NULL,
    status TEXT DEFAULT 'PENDING',
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  );

  CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

  CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    total_price REAL NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

  -- ==================== STOCK ITEMS ====================
  CREATE TABLE IF NOT EXISTS stock_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    sku TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    product_id TEXT,
    material_id TEXT,
    quantity INTEGER DEFAULT 0,
    unit TEXT NOT NULL,
    min_stock INTEGER DEFAULT 0,
    max_stock INTEGER DEFAULT 1000,
    location TEXT NOT NULL,
    status TEXT DEFAULT 'ADEQUATE',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (material_id) REFERENCES materials(id),
    UNIQUE(tenant_id, sku)
  );

  CREATE INDEX IF NOT EXISTS idx_stock_items_tenant ON stock_items(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_stock_items_material ON stock_items(material_id);

  CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY,
    stock_item_id TEXT NOT NULL,
    type TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    reference TEXT,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT NOT NULL,
    FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON stock_movements(stock_item_id);

  -- ==================== SUPPLIERS ====================
  CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    code TEXT NOT NULL,
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
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, code)
  );

  CREATE INDEX IF NOT EXISTS idx_suppliers_tenant ON suppliers(tenant_id);

  -- ==================== PURCHASE ORDERS ====================
  CREATE TABLE IF NOT EXISTS purchase_orders (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    po_number TEXT NOT NULL,
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
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
    UNIQUE(tenant_id, po_number)
  );

  CREATE INDEX IF NOT EXISTS idx_po_tenant ON purchase_orders(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);

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

  CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items(purchase_order_id);

  -- ==================== WORK ORDERS ====================
  CREATE TABLE IF NOT EXISTS work_orders (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    wo_number TEXT NOT NULL,
    bom_id TEXT NOT NULL,
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
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (bom_id) REFERENCES boms(id),
    UNIQUE(tenant_id, wo_number)
  );

  CREATE INDEX IF NOT EXISTS idx_wo_tenant ON work_orders(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_wo_bom ON work_orders(bom_id);

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

  CREATE INDEX IF NOT EXISTS idx_wo_materials_wo ON work_order_materials(work_order_id);

  -- ==================== SHOPS (Marketing) ====================
  CREATE TABLE IF NOT EXISTS shops (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    shop_id TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, platform, shop_id)
  );

  CREATE INDEX IF NOT EXISTS idx_shops_tenant ON shops(tenant_id);

  CREATE TABLE IF NOT EXISTS marketing_files (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    shop_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    platform TEXT NOT NULL,
    user_name TEXT,
    report_start TEXT,
    report_end TEXT,
    row_count INTEGER DEFAULT 0,
    uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (shop_id) REFERENCES shops(id)
  );

  CREATE INDEX IF NOT EXISTS idx_marketing_files_tenant ON marketing_files(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_marketing_files_shop ON marketing_files(shop_id);

  CREATE TABLE IF NOT EXISTS marketing_metrics (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
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
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (file_id) REFERENCES marketing_files(id) ON DELETE CASCADE,
    FOREIGN KEY (shop_id) REFERENCES shops(id)
  );

  CREATE INDEX IF NOT EXISTS idx_metrics_tenant ON marketing_metrics(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_metrics_tenant_date ON marketing_metrics(tenant_id, date);
  CREATE INDEX IF NOT EXISTS idx_metrics_shop_date ON marketing_metrics(shop_id, date);
`)

console.log('✅ Multi-Tenant Database initialized at:', dbPath)

// Helper: ดึงข้อมูลตาม Tenant
export const withTenant = (tableName: string) => {
  return {
    // SELECT ด้วย tenant filter
    all: (tenantId: string, where: string = '', params: any[] = []) => {
      const query = where 
        ? `SELECT * FROM ${tableName} WHERE tenant_id = ? AND ${where}`
        : `SELECT * FROM ${tableName} WHERE tenant_id = ?`
      return db.prepare(query).all(tenantId, ...params)
    },
    
    // SELECT one ด้วย tenant filter
    get: (tenantId: string, id: string) => {
      return db.prepare(`SELECT * FROM ${tableName} WHERE tenant_id = ? AND id = ?`).get(tenantId, id)
    },
    
    // COUNT ด้วย tenant filter
    count: (tenantId: string, where: string = '', params: any[] = []) => {
      const query = where
        ? `SELECT COUNT(*) as count FROM ${tableName} WHERE tenant_id = ? AND ${where}`
        : `SELECT COUNT(*) as count FROM ${tableName} WHERE tenant_id = ?`
      return (db.prepare(query).get(tenantId, ...params) as any)?.count || 0
    },
  }
}

export default db
