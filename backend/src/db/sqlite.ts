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
  CREATE TABLE IF NOT EXISTS boms (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    product_id TEXT NOT NULL,
    version TEXT NOT NULL,
    status TEXT DEFAULT 'DRAFT',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES stock_items(id),
    UNIQUE(tenant_id, product_id, version)
  );

  CREATE TABLE IF NOT EXISTS bom_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    bom_id TEXT NOT NULL,
    material_id TEXT NOT NULL,
    quantity REAL NOT NULL,
    -- unit ถูกลบออก - ดึงจาก materials แทน
    FOREIGN KEY (bom_id) REFERENCES boms(id) ON DELETE CASCADE,
    FOREIGN KEY (material_id) REFERENCES materials(id)
  );

  -- ==================== STOCK ITEMS ====================
  CREATE TABLE IF NOT EXISTS stock_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
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
    status TEXT NOT NULL,
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
    -- unit ถูกลบออก - ดึงจาก materials แทน
    status TEXT DEFAULT 'PENDING',
    FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (material_id) REFERENCES materials(id)
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
`)

console.log('✅ SQLite database initialized at:', dbPath)

export default db
export const getDb = () => db
