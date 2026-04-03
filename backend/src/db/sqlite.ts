import Database from 'better-sqlite3'
import path from 'path'

const dbPath = path.join(__dirname, '../../dev.db')
const db: any = new Database(dbPath)

// Enable foreign keys
db.pragma('foreign_keys = ON')

// ============================================
// สร้างตารางทั้งหมดที่ระบบใช้ (better-sqlite3)
// ============================================
db.exec(`
  -- ==================== USERS ====================
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'USER',
    tenant_id TEXT,
    parent_id TEXT,
    status TEXT DEFAULT 'active',
    last_login_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- ==================== CUSTOMERS ====================
  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT,
    city TEXT NOT NULL,
    credit_limit REAL DEFAULT 0,
    status TEXT DEFAULT 'ACTIVE',
    tenant_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- ==================== PRODUCTS ====================
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'ACTIVE',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, code)
  );

  -- ==================== MATERIAL CATEGORIES ====================
  -- ตารางหมวดหมู่วัตถุดิบ - กำหนดหน่วยตามประเภทวัตถุดิบ
  CREATE TABLE IF NOT EXISTS material_categories (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    default_unit TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, code)
  );

  -- ==================== MATERIALS ====================
  CREATE TABLE IF NOT EXISTS materials (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    category_id TEXT,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    unit_cost REAL NOT NULL,
    min_stock INTEGER DEFAULT 0,
    max_stock INTEGER DEFAULT 1000,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES material_categories(id),
    UNIQUE(tenant_id, code)
  );

  -- ==================== ORDERS ====================
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    order_number TEXT UNIQUE NOT NULL,
    customer_id TEXT NOT NULL,
    order_date TEXT DEFAULT CURRENT_TIMESTAMP,
    delivery_date TEXT,
    subtotal REAL DEFAULT 0,
    total_amount REAL NOT NULL,
    status TEXT DEFAULT 'PENDING',
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  );

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

  -- ==================== BOMs ====================
  -- Nested BOM (Multi-level) - รองรับ BOM ที่มี hierarchy
  CREATE TABLE IF NOT EXISTS boms (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    product_id TEXT NOT NULL,
    parent_id TEXT,              -- ← อ้างอิง BOM แม่ (สำหรับ Semi-finished)
    version TEXT NOT NULL,
    status TEXT DEFAULT 'DRAFT',
    level INTEGER DEFAULT 0,     -- ← ระดับความลึก (0=Finished Good, 1=Semi-finished, etc.)
    is_semi_finished BOOLEAN DEFAULT 0,  -- ← เป็น Semi-finished product หรือไม่
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES stock_items(id),
    FOREIGN KEY (parent_id) REFERENCES boms(id) ON DELETE SET NULL,
    UNIQUE(tenant_id, product_id, version)
  );

  -- ==================== BOM Items ====================
  -- รองรับทั้ง Raw Material และ Child BOM (Semi-finished)
  CREATE TABLE IF NOT EXISTS bom_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    bom_id TEXT NOT NULL,
    item_type TEXT DEFAULT 'MATERIAL',  -- 'MATERIAL' | 'CHILD_BOM'
    material_id TEXT,                   -- ใช้เมื่อ item_type = 'MATERIAL' (อ้างอิง stock_items)
    child_bom_id TEXT,                  -- ใช้เมื่อ item_type = 'CHILD_BOM' (อ้างอิง BOM ลูก)
    quantity REAL NOT NULL,
    notes TEXT,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (bom_id) REFERENCES boms(id) ON DELETE CASCADE,
    FOREIGN KEY (material_id) REFERENCES stock_items(id),
    FOREIGN KEY (child_bom_id) REFERENCES boms(id) ON DELETE SET NULL
  );

  -- ==================== STOCK ITEMS ====================
  CREATE TABLE IF NOT EXISTS stock_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    sku TEXT NOT NULL,
    gs1_barcode TEXT,                  -- GS1 barcode สำหรับยิงค้นหา (optional)
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    product_id TEXT,
    material_id TEXT,
    quantity INTEGER DEFAULT 0,
    unit TEXT NOT NULL,
    unit_cost REAL DEFAULT 0,
    min_stock INTEGER DEFAULT 0,
    max_stock INTEGER DEFAULT 1000,
    location TEXT NOT NULL,
    status TEXT NOT NULL,
    is_pos_enabled BOOLEAN DEFAULT 0,  -- แสดงใน POS หรือไม่
    image_url TEXT,                     -- URL รูปภาพสินค้า
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (material_id) REFERENCES materials(id),
    UNIQUE(tenant_id, sku)
  );

  CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    stock_item_id TEXT NOT NULL,
    type TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    reference TEXT,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT NOT NULL,
    FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE CASCADE
  );

  -- ==================== SHOPS (Marketing) ====================
  CREATE TABLE IF NOT EXISTS shops (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    shop_id TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, platform, shop_id)
  );

  -- ==================== MARKETING FILES ====================
  CREATE TABLE IF NOT EXISTS marketing_files (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
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

  -- ==================== MARKETING METRICS ====================
  CREATE TABLE IF NOT EXISTS marketing_metrics (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
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

  -- ==================== SUPPLIERS ====================
  CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
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
    UNIQUE(tenant_id, code)
  );

  -- ==================== PURCHASE ORDERS ====================
  CREATE TABLE IF NOT EXISTS purchase_orders (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
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
    created_by TEXT,
    approved_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
    UNIQUE(tenant_id, po_number)
  );

  CREATE TABLE IF NOT EXISTS purchase_order_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    purchase_order_id TEXT NOT NULL,
    material_id TEXT,
    description TEXT,
    quantity REAL DEFAULT 0,
    unit_price REAL DEFAULT 0,
    total_price REAL DEFAULT 0,
    received_qty REAL DEFAULT 0,
    -- unit ถูกลบออก - ดึงจาก materials แทน
    notes TEXT,
    FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (material_id) REFERENCES materials(id)
  );

  -- ==================== WORK ORDERS ====================
  CREATE TABLE IF NOT EXISTS work_orders (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    wo_number TEXT NOT NULL,
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
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, wo_number)
  );

  CREATE TABLE IF NOT EXISTS work_order_materials (
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

  -- ==================== SAVED BOMs (Calculator) ====================
  CREATE TABLE IF NOT EXISTS saved_boms (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    name TEXT NOT NULL,
    description TEXT,
    materials TEXT NOT NULL,
    operating_cost REAL DEFAULT 0,
    scrap_value REAL DEFAULT 0,
    total_cost REAL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- ==================== SALES MODULE ====================
  -- ใบเสนอราคา (Quotations)
  CREATE TABLE IF NOT EXISTS quotations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    quotation_number TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    quotation_date TEXT DEFAULT CURRENT_TIMESTAMP,
    expiry_date TEXT,
    subtotal REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    tax_rate REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    total_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'DRAFT',
    notes TEXT,
    created_by TEXT,
    approved_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    UNIQUE(tenant_id, quotation_number)
  );

  CREATE TABLE IF NOT EXISTS quotation_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    quotation_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity REAL DEFAULT 0,
    unit_price REAL DEFAULT 0,
    discount_percent REAL DEFAULT 0,
    total_price REAL DEFAULT 0,
    notes TEXT,
    FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  -- คำสั่งขาย (Sales Orders)
  CREATE TABLE IF NOT EXISTS sales_orders (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    so_number TEXT NOT NULL,
    quotation_id TEXT,
    customer_id TEXT NOT NULL,
    order_date TEXT DEFAULT CURRENT_TIMESTAMP,
    delivery_date TEXT,
    subtotal REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    tax_rate REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    total_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'DRAFT',
    payment_status TEXT DEFAULT 'UNPAID',
    notes TEXT,
    created_by TEXT,
    approved_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (quotation_id) REFERENCES quotations(id),
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    UNIQUE(tenant_id, so_number)
  );

  CREATE TABLE IF NOT EXISTS sales_order_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    sales_order_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quotation_item_id TEXT,
    quantity REAL DEFAULT 0,
    delivered_qty REAL DEFAULT 0,
    unit_price REAL DEFAULT 0,
    discount_percent REAL DEFAULT 0,
    total_price REAL DEFAULT 0,
    notes TEXT,
    FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (quotation_item_id) REFERENCES quotation_items(id)
  );

  -- ใบส่งของ (Delivery Orders)
  CREATE TABLE IF NOT EXISTS delivery_orders (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    do_number TEXT NOT NULL,
    sales_order_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    delivery_date TEXT DEFAULT CURRENT_TIMESTAMP,
    delivery_address TEXT,
    driver_name TEXT,
    vehicle_plate TEXT,
    status TEXT DEFAULT 'DRAFT',
    notes TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id),
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    UNIQUE(tenant_id, do_number)
  );

  CREATE TABLE IF NOT EXISTS delivery_order_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    delivery_order_id TEXT NOT NULL,
    sales_order_item_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity REAL DEFAULT 0,
    notes TEXT,
    FOREIGN KEY (delivery_order_id) REFERENCES delivery_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (sales_order_item_id) REFERENCES sales_order_items(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  -- ใบแจ้งหนี้/ใบกำกับภาษี (Invoices)
  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    invoice_number TEXT NOT NULL,
    sales_order_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    invoice_date TEXT DEFAULT CURRENT_TIMESTAMP,
    due_date TEXT,
    subtotal REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    tax_rate REAL DEFAULT 7,
    tax_amount REAL DEFAULT 0,
    total_amount REAL DEFAULT 0,
    paid_amount REAL DEFAULT 0,
    balance_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'DRAFT',
    payment_status TEXT DEFAULT 'UNPAID',
    notes TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id),
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    UNIQUE(tenant_id, invoice_number)
  );

  CREATE TABLE IF NOT EXISTS invoice_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    invoice_id TEXT NOT NULL,
    sales_order_item_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity REAL DEFAULT 0,
    unit_price REAL DEFAULT 0,
    total_price REAL DEFAULT 0,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
    FOREIGN KEY (sales_order_item_id) REFERENCES sales_order_items(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  -- การรับชำระเงิน (Payments/Receipts)
  CREATE TABLE IF NOT EXISTS receipts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    receipt_number TEXT NOT NULL,
    invoice_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    receipt_date TEXT DEFAULT CURRENT_TIMESTAMP,
    payment_method TEXT NOT NULL,
    payment_reference TEXT,
    amount REAL DEFAULT 0,
    notes TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id),
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    UNIQUE(tenant_id, receipt_number)
  );

  -- ==================== BACKORDERS (สำหรับ Partial Delivery) ====================
  CREATE TABLE IF NOT EXISTS backorders (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    bo_number TEXT NOT NULL,
    sales_order_id TEXT NOT NULL,
    original_do_id TEXT,
    customer_id TEXT NOT NULL,
    status TEXT DEFAULT 'PENDING',
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id),
    FOREIGN KEY (original_do_id) REFERENCES delivery_orders(id),
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    UNIQUE(tenant_id, bo_number)
  );

  CREATE TABLE IF NOT EXISTS backorder_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    backorder_id TEXT NOT NULL,
    sales_order_item_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    ordered_qty REAL DEFAULT 0,
    delivered_qty REAL DEFAULT 0,
    remaining_qty REAL DEFAULT 0,
    notes TEXT,
    FOREIGN KEY (backorder_id) REFERENCES backorders(id) ON DELETE CASCADE,
    FOREIGN KEY (sales_order_item_id) REFERENCES sales_order_items(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  -- ==================== CREDIT NOTES ====================
  CREATE TABLE IF NOT EXISTS credit_notes (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    cn_number TEXT NOT NULL,
    invoice_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    credit_date TEXT DEFAULT CURRENT_TIMESTAMP,
    reason TEXT NOT NULL,
    subtotal REAL DEFAULT 0,
    tax_rate REAL DEFAULT 7,
    tax_amount REAL DEFAULT 0,
    total_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'DRAFT',
    notes TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id),
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    UNIQUE(tenant_id, cn_number)
  );

  CREATE TABLE IF NOT EXISTS credit_note_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    credit_note_id TEXT NOT NULL,
    invoice_item_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity REAL DEFAULT 0,
    unit_price REAL DEFAULT 0,
    reason TEXT,
    total_price REAL DEFAULT 0,
    FOREIGN KEY (credit_note_id) REFERENCES credit_notes(id) ON DELETE CASCADE,
    FOREIGN KEY (invoice_item_id) REFERENCES invoice_items(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  -- ==================== WITHHOLDING TAX ====================
  CREATE TABLE IF NOT EXISTS withholding_tax (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    invoice_id TEXT NOT NULL,
    tax_type TEXT NOT NULL,
    tax_rate REAL DEFAULT 0,
    tax_base REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
  );

  -- ==================== PRODUCT VARIANTS ====================
  CREATE TABLE IF NOT EXISTS product_variants (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    product_id TEXT NOT NULL,
    sku TEXT NOT NULL,
    variant_name TEXT NOT NULL,
    attributes TEXT NOT NULL,
    unit_price REAL DEFAULT 0,
    cost_price REAL DEFAULT 0,
    status TEXT DEFAULT 'ACTIVE',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, sku)
  );

  -- ==================== QUOTATION TEMPLATES ====================
  CREATE TABLE IF NOT EXISTS quotation_templates (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    name TEXT NOT NULL,
    description TEXT,
    expiration_days INTEGER DEFAULT 30,
    header_text TEXT,
    footer_text TEXT,
    terms_conditions TEXT,
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, name)
  );

  CREATE TABLE IF NOT EXISTS quotation_template_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    template_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity REAL DEFAULT 1,
    unit_price REAL DEFAULT 0,
    discount_percent REAL DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    notes TEXT,
    FOREIGN KEY (template_id) REFERENCES quotation_templates(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  -- ==================== INDEXES ====================
  -- ==================== INDEXES ====================
  CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
  CREATE INDEX IF NOT EXISTS idx_backorders_so ON backorders(sales_order_id);
  CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice ON credit_notes(invoice_id);
  CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants(product_id);
  CREATE INDEX IF NOT EXISTS idx_quotation_templates_tenant ON quotation_templates(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_quotations_customer ON quotations(customer_id);
  CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations(status);
  CREATE INDEX IF NOT EXISTS idx_sales_orders_customer ON sales_orders(customer_id);
  CREATE INDEX IF NOT EXISTS idx_sales_orders_status ON sales_orders(status);
  CREATE INDEX IF NOT EXISTS idx_sales_orders_quotation ON sales_orders(quotation_id);
  CREATE INDEX IF NOT EXISTS idx_delivery_orders_so ON delivery_orders(sales_order_id);
  CREATE INDEX IF NOT EXISTS idx_invoices_so ON invoices(sales_order_id);
  CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
  CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
  CREATE INDEX IF NOT EXISTS idx_receipts_invoice ON receipts(invoice_id);
  CREATE INDEX IF NOT EXISTS idx_materials_category ON materials(category_id);
  CREATE INDEX IF NOT EXISTS idx_bom_items_material ON bom_items(material_id);
  -- ==================== PURCHASE REQUEST (PR) ====================
  CREATE TABLE IF NOT EXISTS purchase_requests (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    pr_number TEXT NOT NULL,
    requester_id TEXT NOT NULL,
    requester_name TEXT NOT NULL,
    department TEXT,
    request_date TEXT DEFAULT CURRENT_TIMESTAMP,
    required_date TEXT,
    total_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'DRAFT',
    priority TEXT DEFAULT 'NORMAL',
    notes TEXT,
    approved_by TEXT,
    approved_date TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, pr_number)
  );

  CREATE TABLE IF NOT EXISTS purchase_request_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    purchase_request_id TEXT NOT NULL,
    material_id TEXT,
    description TEXT NOT NULL,
    quantity REAL DEFAULT 0,
    unit TEXT,
    estimated_unit_price REAL DEFAULT 0,
    estimated_total_price REAL DEFAULT 0,
    notes TEXT,
    FOREIGN KEY (purchase_request_id) REFERENCES purchase_requests(id) ON DELETE CASCADE,
    FOREIGN KEY (material_id) REFERENCES materials(id)
  );

  -- ==================== GOODS RECEIPT (GRN) ====================
  CREATE TABLE IF NOT EXISTS goods_receipts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    gr_number TEXT NOT NULL,
    purchase_order_id TEXT NOT NULL,
    supplier_id TEXT NOT NULL,
    receipt_date TEXT DEFAULT CURRENT_TIMESTAMP,
    received_by TEXT,
    status TEXT DEFAULT 'DRAFT',
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id),
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
    UNIQUE(tenant_id, gr_number)
  );

  CREATE TABLE IF NOT EXISTS goods_receipt_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    goods_receipt_id TEXT NOT NULL,
    purchase_order_item_id TEXT NOT NULL,
    material_id TEXT,
    ordered_qty REAL DEFAULT 0,
    received_qty REAL DEFAULT 0,
    accepted_qty REAL DEFAULT 0,
    rejected_qty REAL DEFAULT 0,
    notes TEXT,
    FOREIGN KEY (goods_receipt_id) REFERENCES goods_receipts(id) ON DELETE CASCADE,
    FOREIGN KEY (purchase_order_item_id) REFERENCES purchase_order_items(id),
    FOREIGN KEY (material_id) REFERENCES materials(id)
  );

  -- ==================== PURCHASE INVOICE ====================
  CREATE TABLE IF NOT EXISTS purchase_invoices (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    pi_number TEXT NOT NULL,
    supplier_invoice_number TEXT,
    purchase_order_id TEXT NOT NULL,
    supplier_id TEXT NOT NULL,
    goods_receipt_id TEXT,
    invoice_date TEXT DEFAULT CURRENT_TIMESTAMP,
    due_date TEXT,
    subtotal REAL DEFAULT 0,
    tax_rate REAL DEFAULT 7,
    tax_amount REAL DEFAULT 0,
    total_amount REAL DEFAULT 0,
    paid_amount REAL DEFAULT 0,
    balance_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'DRAFT',
    payment_status TEXT DEFAULT 'UNPAID',
    notes TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id),
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
    FOREIGN KEY (goods_receipt_id) REFERENCES goods_receipts(id),
    UNIQUE(tenant_id, pi_number)
  );

  CREATE TABLE IF NOT EXISTS purchase_invoice_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    purchase_invoice_id TEXT NOT NULL,
    purchase_order_item_id TEXT NOT NULL,
    material_id TEXT,
    quantity REAL DEFAULT 0,
    unit_price REAL DEFAULT 0,
    total_price REAL DEFAULT 0,
    FOREIGN KEY (purchase_invoice_id) REFERENCES purchase_invoices(id) ON DELETE CASCADE,
    FOREIGN KEY (purchase_order_item_id) REFERENCES purchase_order_items(id),
    FOREIGN KEY (material_id) REFERENCES materials(id)
  );

  -- ==================== SUPPLIER PAYMENTS ====================
  CREATE TABLE IF NOT EXISTS supplier_payments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    payment_number TEXT NOT NULL,
    supplier_id TEXT NOT NULL,
    purchase_invoice_id TEXT,
    payment_date TEXT DEFAULT CURRENT_TIMESTAMP,
    payment_method TEXT NOT NULL,
    payment_reference TEXT,
    amount REAL DEFAULT 0,
    withholding_tax REAL DEFAULT 0,
    net_amount REAL DEFAULT 0,
    notes TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
    FOREIGN KEY (purchase_invoice_id) REFERENCES purchase_invoices(id),
    UNIQUE(tenant_id, payment_number)
  );

  -- ==================== PURCHASE RETURNS ====================
  CREATE TABLE IF NOT EXISTS purchase_returns (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    pr_number TEXT NOT NULL,
    purchase_order_id TEXT NOT NULL,
    goods_receipt_id TEXT,
    supplier_id TEXT NOT NULL,
    return_date TEXT DEFAULT CURRENT_TIMESTAMP,
    reason TEXT NOT NULL,
    subtotal REAL DEFAULT 0,
    tax_rate REAL DEFAULT 7,
    tax_amount REAL DEFAULT 0,
    total_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'DRAFT',
    notes TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id),
    FOREIGN KEY (goods_receipt_id) REFERENCES goods_receipts(id),
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
    UNIQUE(tenant_id, pr_number)
  );

  CREATE TABLE IF NOT EXISTS purchase_return_items (
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
    FOREIGN KEY (material_id) REFERENCES materials(id)
  );

  -- ==================== ACTIVITY LOGS ====================
  CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    type TEXT NOT NULL,
    note TEXT NOT NULL,
    created_by TEXT,
    tenant_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
  CREATE INDEX IF NOT EXISTS idx_boms_product ON boms(product_id);
  CREATE INDEX IF NOT EXISTS idx_bom_items_bom ON bom_items(bom_id);
  CREATE INDEX IF NOT EXISTS idx_stock_items_material ON stock_items(material_id);
  CREATE INDEX IF NOT EXISTS idx_stock_items_product ON stock_items(product_id);
  -- index for gs1 is created down in the migration block if column exists
  -- index for is_pos_enabled is created down in the migration block if column exists
  CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON stock_movements(stock_item_id);
  CREATE INDEX IF NOT EXISTS idx_metrics_shop_date ON marketing_metrics(shop_id, date);
  CREATE INDEX IF NOT EXISTS idx_metrics_file ON marketing_metrics(file_id);
  CREATE INDEX IF NOT EXISTS idx_files_shop ON marketing_files(shop_id);
  CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);
  CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
  CREATE INDEX IF NOT EXISTS idx_pr_requester ON purchase_requests(requester_id);
  CREATE INDEX IF NOT EXISTS idx_pr_status ON purchase_requests(status);
  CREATE INDEX IF NOT EXISTS idx_gr_po ON goods_receipts(purchase_order_id);
  CREATE INDEX IF NOT EXISTS idx_gr_supplier ON goods_receipts(supplier_id);
  CREATE INDEX IF NOT EXISTS idx_pi_po ON purchase_invoices(purchase_order_id);
  CREATE INDEX IF NOT EXISTS idx_pi_supplier ON purchase_invoices(supplier_id);
  CREATE INDEX IF NOT EXISTS idx_pi_status ON purchase_invoices(payment_status);
  CREATE INDEX IF NOT EXISTS idx_payment_supplier ON supplier_payments(supplier_id);
  CREATE INDEX IF NOT EXISTS idx_payment_invoice ON supplier_payments(purchase_invoice_id);
  CREATE INDEX IF NOT EXISTS idx_return_po ON purchase_returns(purchase_order_id);
  CREATE INDEX IF NOT EXISTS idx_return_supplier ON purchase_returns(supplier_id);
  CREATE INDEX IF NOT EXISTS idx_wo_status ON work_orders(status);
  CREATE INDEX IF NOT EXISTS idx_wo_bom ON work_orders(bom_id);
  CREATE INDEX IF NOT EXISTS idx_activity_customer ON activity_logs(customer_id);
  CREATE INDEX IF NOT EXISTS idx_activity_tenant ON activity_logs(tenant_id);

  -- ==================== CUSTOMER PRODUCT RECOMMENDATIONS ====================
  -- สินค้าที่แนะนำสำหรับลูกค้า (จาก Sales/CRM)
  CREATE TABLE IF NOT EXISTS customer_recommendations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    customer_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    product_category TEXT,
    reason TEXT,                           -- เหตุผลที่แนะนำ
    priority INTEGER DEFAULT 0,            -- ลำดับความสำคัญ
    status TEXT DEFAULT 'PENDING',         -- PENDING, OFFERED, ACCEPTED, REJECTED
    offered_at TEXT,                       -- วันที่เสนอ
    offered_by TEXT,
    notes TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, customer_id, product_id)
  );

  CREATE INDEX IF NOT EXISTS idx_rec_customer ON customer_recommendations(customer_id);
  CREATE INDEX IF NOT EXISTS idx_rec_status ON customer_recommendations(status);
  CREATE INDEX IF NOT EXISTS idx_rec_tenant ON customer_recommendations(tenant_id);

  -- ==================== TAX MANAGEMENT SYSTEM ====================
  -- Tax Periods (งวดภาษี)
  CREATE TABLE IF NOT EXISTS tax_periods (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    period_type TEXT NOT NULL, -- 'MONTHLY', 'QUARTERLY', 'ANNUAL'
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    vat_due_date TEXT,
    wht_due_date TEXT,
    status TEXT DEFAULT 'OPEN', -- 'OPEN', 'CLOSED', 'FILING'
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, year, month, period_type)
  );

  -- Tax Transactions (รายการภาษี)
  CREATE TABLE IF NOT EXISTS tax_transactions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    period_id TEXT,
    transaction_type TEXT NOT NULL, -- 'VAT_OUTPUT', 'VAT_INPUT', 'VAT_INPUT_UNDEDUCTIBLE', 'WHT', 'CIT'
    source_type TEXT NOT NULL, -- 'SALE_INVOICE', 'PURCHASE_INVOICE', 'PAYMENT', 'JOURNAL'
    source_id TEXT NOT NULL,
    document_number TEXT NOT NULL,
    document_date TEXT NOT NULL,
    partner_id TEXT, -- customer_id or supplier_id
    partner_name TEXT,
    partner_tax_id TEXT,
    description TEXT,
    base_amount REAL DEFAULT 0, -- ยอดก่อนภาษี
    tax_amount REAL DEFAULT 0, -- ยอดภาษี
    total_amount REAL DEFAULT 0, -- ยอดรวม
    tax_rate REAL DEFAULT 0,
    wht_rate REAL DEFAULT 0,
    is_deductible INTEGER DEFAULT 1, -- ภาษีซื้อหักได้หรือไม่
    is_paid INTEGER DEFAULT 0,
    paid_date TEXT,
    paid_amount REAL DEFAULT 0,
    tax_invoice_number TEXT,
    tax_invoice_date TEXT,
    remarks TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (period_id) REFERENCES tax_periods(id)
  );

  -- Tax Incentives (สิทธิประโยชน์ทางภาษี)
  CREATE TABLE IF NOT EXISTS tax_incentives (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    incentive_type TEXT NOT NULL, -- 'TRAINING_200', 'AUTOMATION', 'EMPLOY_SENIOR', 'EMPLOY_EX_PRISONER', 'SME_DEPRECIATION'
    description TEXT,
    multiplier INTEGER DEFAULT 100, -- 100 = 100%, 200 = 200%
    max_amount REAL,
    valid_from TEXT,
    valid_to TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- Tax Incentive Claims (การเคลมสิทธิประโยชน์)
  CREATE TABLE IF NOT EXISTS tax_incentive_claims (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    incentive_id TEXT NOT NULL,
    period_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    base_amount REAL DEFAULT 0,
    claimable_amount REAL DEFAULT 0, -- base_amount * multiplier / 100
    document_ref TEXT,
    status TEXT DEFAULT 'PENDING', -- 'PENDING', 'APPROVED', 'REJECTED'
    remarks TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (incentive_id) REFERENCES tax_incentives(id),
    FOREIGN KEY (period_id) REFERENCES tax_periods(id)
  );

  -- Tax Adjustments (รายการปรับปรุงภาษี CIT)
  CREATE TABLE IF NOT EXISTS tax_adjustments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    period_id TEXT NOT NULL,
    adjustment_type TEXT NOT NULL, -- 'ADD_BACK', 'DEDUCTION', 'DOUBLE_DEDUCTION'
    account_code TEXT NOT NULL,
    description TEXT,
    accounting_amount REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    reason TEXT,
    is_permanent INTEGER DEFAULT 1, -- Permanent or Temporary difference
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (period_id) REFERENCES tax_periods(id)
  );

  -- Tax Filing Status (สถานะการยื่นแบบ)
  CREATE TABLE IF NOT EXISTS tax_filings (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    period_id TEXT NOT NULL,
    form_type TEXT NOT NULL, -- 'PP30', 'PND3', 'PND53', 'PND50', 'PND51'
    filing_status TEXT DEFAULT 'DRAFT', -- 'DRAFT', 'READY', 'SUBMITTED', 'PAID'
    submission_date TEXT,
    submitted_by TEXT,
    tax_amount REAL DEFAULT 0,
    penalty_amount REAL DEFAULT 0,
    surcharge_amount REAL DEFAULT 0,
    total_payable REAL DEFAULT 0,
    paid_amount REAL DEFAULT 0,
    attachment_path TEXT,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (period_id) REFERENCES tax_periods(id)
  );

  -- Tax Reports (รายงานภาษีที่สร้าง)
  CREATE TABLE IF NOT EXISTS tax_reports (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    filing_id TEXT,
    report_type TEXT NOT NULL, -- 'PP30', 'PND3', 'PND53', 'PND50', 'CIT_COMPUTATION'
    report_period TEXT NOT NULL,
    file_path TEXT,
    generated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    generated_by TEXT,
    status TEXT DEFAULT 'GENERATED'
  );

  CREATE INDEX IF NOT EXISTS idx_tax_trans_period ON tax_transactions(period_id);
  CREATE INDEX IF NOT EXISTS idx_tax_trans_type ON tax_transactions(transaction_type);
  CREATE INDEX IF NOT EXISTS idx_tax_trans_date ON tax_transactions(document_date);
  CREATE INDEX IF NOT EXISTS idx_tax_trans_partner ON tax_transactions(partner_tax_id);
  CREATE INDEX IF NOT EXISTS idx_tax_periods_tenant ON tax_periods(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_tax_incentives_tenant ON tax_incentives(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_tax_filings_period ON tax_filings(period_id);

  -- ==================== APPROVAL SYSTEM ====================
  -- ตั้งค่าการอนุมัติตาม Role (Master ID ตั้งค่าได้คนเดียว)
  CREATE TABLE IF NOT EXISTS approval_settings (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    role TEXT NOT NULL,                    -- PRODUCTION_MANAGER, ACCOUNTING_MANAGER, etc.
    module_type TEXT NOT NULL,             -- PRODUCTION, PURCHASE_PAYMENT, SALES_RECEIPT, STOCK_ADJUSTMENT
    approval_required INTEGER DEFAULT 1,   -- 0 = ไม่ต้องอนุมัติ, 1 = ต้องอนุมัติ
    auto_approve_threshold REAL DEFAULT 0, -- อนุมัติอัตโนมัติถ้ายอดไม่เกิน (0 = ไม่มี)
    created_by TEXT,                       -- Master ID ที่ตั้งค่า
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, role, module_type)
  );

  -- คำขออนุมัติ
  CREATE TABLE IF NOT EXISTS approval_requests (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    request_number TEXT NOT NULL,          -- APR-2024-00001
    module_type TEXT NOT NULL,             -- PRODUCTION, PURCHASE_PAYMENT, SALES_RECEIPT, STOCK_ADJUSTMENT
    reference_type TEXT NOT NULL,          -- work_orders, supplier_payments, receipts, stock_movements
    reference_id TEXT NOT NULL,            -- ID ของ record ที่ขออนุมัติ
    requester_id TEXT NOT NULL,            -- พนักงานที่ขอ
    requester_name TEXT NOT NULL,
    requester_role TEXT NOT NULL,          -- Role ของผู้ขอ
    amount REAL DEFAULT 0,                 -- ยอดเงิน (ถ้ามี)
    description TEXT NOT NULL,             -- รายละเอียดการขอ
    status TEXT DEFAULT 'PENDING',         -- PENDING, APPROVED, REJECTED, CANCELLED
    
    -- ผู้อนุมัติระดับ 1 (หัวหน้าฝ่าย)
    approver_1_id TEXT,
    approver_1_name TEXT,
    approver_1_decision TEXT,              -- APPROVED, REJECTED
    approver_1_comment TEXT,
    approver_1_at TEXT,
    
    -- ผู้อนุมัติระดับ 2 (Master ID - บังคับสำหรับบางกรณี)
    approver_2_id TEXT,
    approver_2_name TEXT,
    approver_2_decision TEXT,
    approver_2_comment TEXT,
    approver_2_at TEXT,
    
    -- ผู้ดำเนินการสุดท้าย (ระบบหรือคน)
    final_executor_id TEXT,
    final_executor_name TEXT,
    executed_at TEXT,
    
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, request_number)
  );

  -- Log การดำเนินการอนุมัติ (Audit Trail)
  CREATE TABLE IF NOT EXISTS approval_logs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    approval_request_id TEXT NOT NULL,
    action TEXT NOT NULL,                  -- CREATE, SUBMIT, APPROVE, REJECT, EXECUTE, CANCEL
    actor_id TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    comment TEXT,
    old_status TEXT,
    new_status TEXT,
    metadata TEXT,                         -- JSON เก็บข้อมูลเพิ่มเติม
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id) ON DELETE CASCADE
  );

  -- สิทธิ์การอนุมัติของผู้ใช้ (ใครอนุมัติอะไรได้บ้าง)
  CREATE TABLE IF NOT EXISTS user_approval_permissions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    user_id TEXT NOT NULL,
    module_type TEXT NOT NULL,             -- PRODUCTION, PURCHASE_PAYMENT, SALES_RECEIPT, STOCK_ADJUSTMENT
    can_approve INTEGER DEFAULT 1,         -- 0 = ไม่ได้, 1 = ได้
    can_approve_unlimited INTEGER DEFAULT 0, -- 0 = มี limit, 1 = ไม่มี limit
    approval_limit REAL DEFAULT 0,         -- อนุมัติได้สูงสุดเท่าไร (0 = ไม่จำกัดถ้า unlimited=1)
    is_master_approver INTEGER DEFAULT 0,  -- 1 = เป็น Master ID ที่อนุมัติขั้นสุดท้ายได้
    created_by TEXT,                       -- Master ID ที่ให้สิทธิ์
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, user_id, module_type)
  );

  -- ==================== STOCK ADJUSTMENT (Manual) ====================
  -- การปรับสต็อกแบบ manual (ไม่ผ่าน BOM/Production/Sales)
  CREATE TABLE IF NOT EXISTS stock_adjustments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    adjustment_number TEXT NOT NULL,       -- ADJ-2024-00001
    stock_item_id TEXT NOT NULL,
    adjustment_type TEXT NOT NULL,         -- INCREASE, DECREASE, CORRECTION
    quantity_before REAL DEFAULT 0,
    quantity_after REAL DEFAULT 0,
    quantity_adjusted REAL DEFAULT 0,
    unit_cost REAL DEFAULT 0,
    total_value REAL DEFAULT 0,
    reason TEXT NOT NULL,                  -- เหตุผลการปรับ
    reference_type TEXT,                   -- อ้างอิงจาก (ถ้ามี)
    reference_id TEXT,
    status TEXT DEFAULT 'PENDING',         -- PENDING, APPROVED, REJECTED, EXECUTED
    approval_request_id TEXT,              -- เชื่อมกับ approval_requests
    notes TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stock_item_id) REFERENCES stock_items(id),
    FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id),
    UNIQUE(tenant_id, adjustment_number)
  );

  -- ==================== INDEXES สำหรับ APPROVAL ====================
  CREATE INDEX IF NOT EXISTS idx_approval_settings_role ON approval_settings(tenant_id, role, module_type);
  CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(tenant_id, status);
  CREATE INDEX IF NOT EXISTS idx_approval_requests_module ON approval_requests(tenant_id, module_type, reference_type, reference_id);
  CREATE INDEX IF NOT EXISTS idx_approval_requests_requester ON approval_requests(tenant_id, requester_id);
  CREATE INDEX IF NOT EXISTS idx_approval_logs_request ON approval_logs(approval_request_id);
  CREATE INDEX IF NOT EXISTS idx_user_approval_perm ON user_approval_permissions(tenant_id, user_id);
  CREATE INDEX IF NOT EXISTS idx_stock_adj_status ON stock_adjustments(tenant_id, status);

  -- ==================== ACCOUNTING MODULE ====================
  -- ผังบัญชี (Chart of Accounts) ตามประมวลบัญชีไทย
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    code TEXT NOT NULL,                    -- เช่น 1101, 2101, 3101
    name TEXT NOT NULL,                    -- เช่น เงินสด, เจ้าหนี้การค้า
    name_en TEXT,                          -- ชื่อภาษาอังกฤษ (optional)
    type TEXT NOT NULL,                    -- ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE
    category TEXT NOT NULL,                -- หมวดย่อย เช่น CURRENT_ASSET, FIXED_ASSET
    parent_id TEXT,                        -- อ้างอิงบัญชีแม่ (สำหรับ grouping)
    level INTEGER DEFAULT 0,               -- ระดับ (0=หลัก, 1=ย่อย, 2=รอง)
    is_active BOOLEAN DEFAULT 1,
    is_system BOOLEAN DEFAULT 0,           -- บัญชีระบบ (ลบไม่ได้)
    normal_balance TEXT NOT NULL,          -- DEBIT หรือ CREDIT
    description TEXT,
    tax_related BOOLEAN DEFAULT 0,         -- เกี่ยวข้องกับภาษี
    tax_code TEXT,                         -- รหัสภาษี (ถ้ามี)
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES accounts(id) ON DELETE SET NULL,
    UNIQUE(tenant_id, code)
  );

  -- สมุดรายวัน (Journal Entries) - บันทึกรายการคู่
  CREATE TABLE IF NOT EXISTS journal_entries (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    entry_number TEXT NOT NULL,            -- JV-2024-000001
    date TEXT NOT NULL,                    -- วันที่บันทึก
    reference_type TEXT,                   -- PO, INVOICE, PAYMENT, ADJUSTMENT, MANUAL
    reference_id TEXT,                     -- ID ของเอกสารอ้างอิง
    description TEXT NOT NULL,             -- คำอธิบายรายการ
    total_debit REAL NOT NULL DEFAULT 0,
    total_credit REAL NOT NULL DEFAULT 0,
    is_auto_generated BOOLEAN DEFAULT 0,   -- สร้างอัตโนมัติจากระบบอื่น
    is_posted BOOLEAN DEFAULT 0,           -- ยืนยันแล้ว (post แล้ว)
    posted_at TEXT,
    posted_by TEXT,
    notes TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, entry_number)
  );

  -- รายการในสมุดรายวัน (Journal Lines)
  CREATE TABLE IF NOT EXISTS journal_lines (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    journal_entry_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    line_number INTEGER DEFAULT 1,
    description TEXT,
    debit REAL DEFAULT 0,
    credit REAL DEFAULT 0,
    FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES accounts(id)
  );

  -- ยอดคงเหลือบัญชีต่อช่วงเวลา (Account Balances) - สำหรับรายงาน
  CREATE TABLE IF NOT EXISTS account_balances (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    account_id TEXT NOT NULL,
    fiscal_year INTEGER NOT NULL,          -- ปีงบประมาณ
    period INTEGER NOT NULL,               -- งวด (1-12)
    beginning_balance REAL DEFAULT 0,
    debit_amount REAL DEFAULT 0,
    credit_amount REAL DEFAULT 0,
    ending_balance REAL DEFAULT 0,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, account_id, fiscal_year, period)
  );

  -- รายการเฉพาะทาง (Special Entries)
  -- ภาษีมูลค่าเพิ่ม (VAT)
  CREATE TABLE IF NOT EXISTS vat_entries (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    document_type TEXT NOT NULL,           -- PURCHASE, SALES
    document_id TEXT NOT NULL,
    document_number TEXT NOT NULL,
    document_date TEXT NOT NULL,
    party_name TEXT NOT NULL,              -- ชื่อคู่ค้า
    party_tax_id TEXT,                     -- เลขประจำตัวผู้เสียภาษี
    base_amount REAL NOT NULL,             -- ยอดก่อนภาษี
    vat_rate REAL DEFAULT 7,               -- อัตราภาษี
    vat_amount REAL NOT NULL,              -- ยอดภาษี
    total_amount REAL NOT NULL,            -- ยอดรวม
    is_input_vat BOOLEAN DEFAULT 0,        -- ภาษีซื้อ
    is_output_vat BOOLEAN DEFAULT 0,       -- ภาษีขาย
    journal_entry_id TEXT,                 -- อ้างอิงสมุดรายวัน
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id)
  );

  -- หัก ณ ที่จ่าย (Withholding Tax)
  CREATE TABLE IF NOT EXISTS withholding_tax_entries (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    document_type TEXT NOT NULL,           -- PAYMENT, INVOICE
    document_id TEXT NOT NULL,
    document_number TEXT NOT NULL,
    document_date TEXT NOT NULL,
    party_name TEXT NOT NULL,
    party_tax_id TEXT,
    base_amount REAL NOT NULL,             -- ยอดก่อนหัก
    wht_rate REAL NOT NULL,                -- อัตราหัก ณ ที่จ่าย
    wht_amount REAL NOT NULL,              -- ยอดหัก
    wht_type TEXT,                         -- ประเภท หัก ณ ที่จ่าย (เงินเดือน, ค่าบริการ, etc.)
    journal_entry_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id)
  );

  -- ==================== ACCOUNTING INDEXES ====================
  CREATE INDEX IF NOT EXISTS idx_accounts_type ON accounts(tenant_id, type);
  CREATE INDEX IF NOT EXISTS idx_accounts_parent ON accounts(parent_id);
  CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_entries(tenant_id, date);
  CREATE INDEX IF NOT EXISTS idx_journal_ref ON journal_entries(reference_type, reference_id);
  CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines(journal_entry_id);
  CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_id);
  CREATE INDEX IF NOT EXISTS idx_vat_entries_date ON vat_entries(tenant_id, document_date);
  CREATE INDEX IF NOT EXISTS idx_wht_entries_date ON withholding_tax_entries(tenant_id, document_date);

  -- ==================== POS SYSTEM (Cashier) ====================
  -- ❌ ลบ pos_tables ออก - ไม่ใช้โต๊ะแล้ว
  -- DROP TABLE IF EXISTS pos_tables;

  -- POS Categories (หมวดหมู่เมนู)
  CREATE TABLE IF NOT EXISTS pos_categories (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    name TEXT NOT NULL,                -- เช่น อาหารจานหลัก, เครื่องดื่ม
    color TEXT DEFAULT '#00f0ff',      -- สีประจำหมวดหมู่
    icon TEXT,                         -- ชื่อ icon
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- POS Menu Configs (เมนูที่เปิดขายใน POS)
  CREATE TABLE IF NOT EXISTS pos_menu_configs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    product_id TEXT NOT NULL,          -- เชื่อมกับ products
    bom_id TEXT,                       -- เชื่อมกับ BOM (ใช้วัตถุดิบจาก BOM แทน pos_menu_ingredients)
    category_id TEXT,                  -- หมวดหมู่ POS
    pos_price REAL NOT NULL,           -- ราคาขายใน POS (อาจต่างจากราคาปกติ)
    cost_price REAL DEFAULT 0,         -- ต้นทุน
    is_available BOOLEAN DEFAULT 1,    -- เปิด/ปิดการขาย
    is_pos_enabled BOOLEAN DEFAULT 1,  -- แสดงใน POS หรือไม่
    display_order INTEGER DEFAULT 0,   -- ลำดับการแสดง
    quick_code TEXT,                   -- รหัสลัด เช่น A01
    image_url TEXT,
    preparation_time INTEGER DEFAULT 10, -- นาที
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (bom_id) REFERENCES boms(id) ON DELETE SET NULL,
    FOREIGN KEY (category_id) REFERENCES pos_categories(id),
    UNIQUE(tenant_id, product_id)
  );

  -- POS Menu Ingredients (วัตถุดิบที่ใช้ต่อ 1 ชิ้น - สำหรับหักสต็อก)
  CREATE TABLE IF NOT EXISTS pos_menu_ingredients (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    pos_menu_id TEXT NOT NULL,         -- เชื่อมกับ pos_menu_configs
    stock_item_id TEXT NOT NULL,       -- เชื่อมกับ stock_items
    quantity_used REAL NOT NULL,       -- จำนวนที่ใช้ต่อ 1 ชิ้น
    unit_id TEXT,                      -- หน่วยนับ
    is_optional BOOLEAN DEFAULT 0,     -- เป็นวัตถุดิบเสริมหรือไม่
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pos_menu_id) REFERENCES pos_menu_configs(id) ON DELETE CASCADE,
    FOREIGN KEY (stock_item_id) REFERENCES stock_items(id)
  );

  -- Running Bills (Open Bill/Tab - ไม่ผูกกับโต๊ะ)
  CREATE TABLE IF NOT EXISTS pos_running_bills (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    bill_number TEXT NOT NULL,         -- เลขที่บิล POS-2024-00001
    display_name TEXT NOT NULL,        -- ชื่อที่แสดง: "โต๊ะ 1", "บิล 1", "คุณสมชาย"
    customer_name TEXT,                -- ชื่อลูกค้า (optional)
    customer_phone TEXT,               -- เบอร์โทร (optional)
    customer_count INTEGER DEFAULT 1,  -- จำนวนลูกค้า
    status TEXT DEFAULT 'OPEN',        -- OPEN, PENDING_PAYMENT, PAID, CANCELLED
    opened_at TEXT DEFAULT CURRENT_TIMESTAMP,
    closed_at TEXT,
    subtotal REAL DEFAULT 0,
    tax_rate REAL DEFAULT 7,
    tax_amount REAL DEFAULT 0,
    service_charge_rate REAL DEFAULT 10,
    service_charge_amount REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    total_amount REAL DEFAULT 0,
    notes TEXT,
    created_by TEXT,
    closed_by TEXT,
    UNIQUE(tenant_id, bill_number)
  );

  -- Bill Items (รายการในบิล)
  CREATE TABLE IF NOT EXISTS pos_bill_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    bill_id TEXT NOT NULL,             -- อ้างอิง pos_running_bills
    pos_menu_id TEXT NOT NULL,         -- อ้างอิง pos_menu_configs
    product_name TEXT NOT NULL,        -- cache ชื่อสินค้า
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL,
    total_price REAL NOT NULL,
    special_instructions TEXT,         -- เช่น "ไม่ใส่ผัก", "พิเศษ"
    status TEXT DEFAULT 'PENDING',     -- PENDING, PREPARING, READY, SERVED
    sent_to_kds BOOLEAN DEFAULT 0,     -- ส่งไปครัวแล้วหรือยัง
    added_at TEXT DEFAULT CURRENT_TIMESTAMP,
    served_at TEXT,
    created_by TEXT,
    FOREIGN KEY (bill_id) REFERENCES pos_running_bills(id) ON DELETE CASCADE,
    FOREIGN KEY (pos_menu_id) REFERENCES pos_menu_configs(id)
  );

  -- POS Payments (การชำระเงิน)
  CREATE TABLE IF NOT EXISTS pos_payments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    bill_id TEXT NOT NULL,             -- อ้างอิง pos_running_bills
    payment_method TEXT NOT NULL,      -- CASH, QR_CODE, CREDIT_CARD, TRANSFER
    amount REAL NOT NULL,
    received_amount REAL,              -- สำหรับเงินสด (เงินที่รับมา)
    change_amount REAL,                -- เงินทอน
    reference TEXT,                    -- เลขอ้างอิง (สลิป, ใบเสร็จ)
    paid_at TEXT DEFAULT CURRENT_TIMESTAMP,
    received_by TEXT NOT NULL,
    FOREIGN KEY (bill_id) REFERENCES pos_running_bills(id) ON DELETE CASCADE
  );

  -- POS Stock Deductions (บันทึกการตัดสต็อก)
  CREATE TABLE IF NOT EXISTS pos_stock_deductions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    bill_item_id TEXT NOT NULL,        -- อ้างอิง pos_bill_items
    stock_item_id TEXT NOT NULL,       -- อ้างอิง stock_items
    quantity_deducted REAL NOT NULL,
    unit_id TEXT,
    deducted_at TEXT DEFAULT CURRENT_TIMESTAMP,
    returned BOOLEAN DEFAULT 0,        -- คืนสต็อกหรือยัง (ตอนยกเลิก)
    returned_at TEXT,
    FOREIGN KEY (bill_item_id) REFERENCES pos_bill_items(id) ON DELETE CASCADE,
    FOREIGN KEY (stock_item_id) REFERENCES stock_items(id)
  );

  -- POS Clearing Transfers (การโอนยอดจาก Clearing สู่ Cash/Bank)
  CREATE TABLE IF NOT EXISTS pos_clearing_transfers (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    transfer_date TEXT NOT NULL,       -- วันที่โอน
    total_amount REAL NOT NULL,        -- ยอดรวมที่โอน
    cash_amount REAL DEFAULT 0,        -- ยอดที่เป็นเงินสด
    bank_amount REAL DEFAULT 0,        -- ยอดที่โอนเข้าธนาคาร
    reference TEXT,                    -- เลขที่อ้างอิง/สลิป
    notes TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- POS Clearing Transfer Items (รายการบิลที่โอนในแต่ละครั้ง)
  CREATE TABLE IF NOT EXISTS pos_clearing_transfer_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    transfer_id TEXT NOT NULL,         -- อ้างอิง pos_clearing_transfers
    bill_id TEXT NOT NULL,             -- อ้างอิง pos_running_bills
    amount REAL NOT NULL,
    FOREIGN KEY (transfer_id) REFERENCES pos_clearing_transfers(id) ON DELETE CASCADE,
    FOREIGN KEY (bill_id) REFERENCES pos_running_bills(id)
  );

  -- POS Daily Sales Summary (Z-Report สรุปยอดขายประจำวัน)
  CREATE TABLE IF NOT EXISTS pos_daily_sales (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    summary_number TEXT NOT NULL,      -- POS-SUM-20240228-001
    sales_date TEXT NOT NULL,          -- วันที่ขาย
    total_revenue REAL NOT NULL,       -- รายได้รวม
    total_tax REAL DEFAULT 0,          -- ภาษีทั้งหมด
    total_service_charge REAL DEFAULT 0, -- Service charge
    total_discount REAL DEFAULT 0,     -- ส่วนลด
    estimated_cogs REAL DEFAULT 0,     -- ต้นทุนขาย (COGS)
    net_profit REAL DEFAULT 0,         -- กำไรขาดสุทธิ
    cash_amount REAL DEFAULT 0,        -- ยอดเงินสด
    bank_amount REAL DEFAULT 0,        -- ยอดโอน/ธนาคาร
    other_amount REAL DEFAULT 0,       -- ยอดอื่นๆ
    bill_count INTEGER DEFAULT 0,      -- จำนวนบิล
    notes TEXT,
    closed_by TEXT,                    -- ผู้ปิดกะ
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (closed_by) REFERENCES users(id),
    UNIQUE(tenant_id, sales_date)
  );

  -- POS Daily Sales Bills (บิลที่อยู่ในสรุปประจำวัน)
  CREATE TABLE IF NOT EXISTS pos_daily_sales_bills (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    daily_sales_id TEXT NOT NULL,      -- อ้างอิง pos_daily_sales
    bill_id TEXT NOT NULL,             -- อ้างอิง pos_running_bills
    amount REAL NOT NULL,
    FOREIGN KEY (daily_sales_id) REFERENCES pos_daily_sales(id) ON DELETE CASCADE,
    FOREIGN KEY (bill_id) REFERENCES pos_running_bills(id),
    UNIQUE(tenant_id, bill_id)
  );

  -- ==================== POS INDEXES ====================
  CREATE INDEX IF NOT EXISTS idx_pos_categories_tenant ON pos_categories(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_pos_menu_tenant ON pos_menu_configs(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_pos_menu_category ON pos_menu_configs(category_id);
  CREATE INDEX IF NOT EXISTS idx_pos_menu_product ON pos_menu_configs(product_id);
  -- Note: idx_pos_menu_bom จะถูกสร้างหลัง migration 
  CREATE INDEX IF NOT EXISTS idx_pos_menu_enabled ON pos_menu_configs(tenant_id, is_pos_enabled);
  CREATE INDEX IF NOT EXISTS idx_pos_ingredients_menu ON pos_menu_ingredients(pos_menu_id);
  CREATE INDEX IF NOT EXISTS idx_pos_bills_tenant ON pos_running_bills(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_pos_bills_status ON pos_running_bills(tenant_id, status);
  CREATE INDEX IF NOT EXISTS idx_pos_bills_open ON pos_running_bills(tenant_id, status) WHERE status = 'OPEN';
  CREATE INDEX IF NOT EXISTS idx_pos_bill_items_bill ON pos_bill_items(bill_id);
  CREATE INDEX IF NOT EXISTS idx_pos_payments_bill ON pos_payments(bill_id);
  CREATE INDEX IF NOT EXISTS idx_pos_stock_deductions_bill_item ON pos_stock_deductions(bill_item_id);
  CREATE INDEX IF NOT EXISTS idx_pos_clearing_transfers_date ON pos_clearing_transfers(tenant_id, transfer_date);
  CREATE INDEX IF NOT EXISTS idx_pos_clearing_transfer_items_transfer ON pos_clearing_transfer_items(transfer_id);
  CREATE INDEX IF NOT EXISTS idx_pos_daily_sales_date ON pos_daily_sales(tenant_id, sales_date);
  CREATE INDEX IF NOT EXISTS idx_pos_daily_sales_bills_summary ON pos_daily_sales_bills(daily_sales_id);

  -- ==================== KDS TICKETS ====================
  CREATE TABLE IF NOT EXISTS pos_kds_tickets (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    bill_id TEXT NOT NULL,
    bill_number TEXT NOT NULL,
    table_name TEXT NOT NULL,
    round INTEGER NOT NULL DEFAULT 1,
    status TEXT DEFAULT 'PENDING',     -- PENDING, IN_PROGRESS, DONE
    sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bill_id) REFERENCES pos_running_bills(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS pos_kds_ticket_items (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    bill_item_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    special_instructions TEXT,
    status TEXT DEFAULT 'PENDING',     -- PENDING, DONE
    FOREIGN KEY (ticket_id) REFERENCES pos_kds_tickets(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_kds_tickets_tenant ON pos_kds_tickets(tenant_id, status);
  CREATE INDEX IF NOT EXISTS idx_kds_tickets_bill ON pos_kds_tickets(bill_id);
  CREATE INDEX IF NOT EXISTS idx_kds_ticket_items_ticket ON pos_kds_ticket_items(ticket_id);

  -- ==================== LINE BOT CONFIG ====================
  CREATE TABLE IF NOT EXISTS line_channels (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    channel_name TEXT NOT NULL,
    channel_secret TEXT NOT NULL,
    channel_access_token TEXT NOT NULL,
    is_active BOOLEAN DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id)
  );

  CREATE TABLE IF NOT EXISTS line_user_mappings (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,             -- อ้างอิงตาราง users
    line_user_id TEXT NOT NULL,        -- LINE user ID จาก webhook
    role TEXT NOT NULL,                -- MASTER, MANAGER, USER (copy from users)
    notify_events TEXT DEFAULT '[]',   -- JSON array of events to notify
    linked_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, user_id),
    UNIQUE(tenant_id, line_user_id)
  );
`)

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
      INSERT OR IGNORE INTO pos_menu_configs_new SELECT * FROM pos_menu_configs;
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

console.log('✅ SQLite database initialized at:', dbPath)

export default db
export const getDb = () => db
