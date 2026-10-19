// Migration ของสมาชิกหน้าร้าน + QR สั่งที่โต๊ะ — แยกไฟล์จาก migrations.ts (ยาวเกินแล้ว และมีงานอื่นแก้ค้างอยู่บ่อย)
// รันต่อจาก runMigrations ใน db/sqlite.ts · ทุกคำสั่งรันซ้ำได้ (IF NOT EXISTS / ADD COLUMN ซ้ำแล้วกลืน error)
export function runPosQrMigrations(db: any): void {
  ;[
    // ค่าแต้มสะสมเดิมเก็บใน localStorage ของเครื่องที่ตั้งค่า — backend ไม่เคยรู้อัตรา (ดู services/loyaltySettings.ts)
    // NULL = ร้านยังไม่เคยตั้ง ใช้ค่าตั้งต้น
    'ALTER TABLE company_settings ADD COLUMN loyalty_enabled INTEGER',
    'ALTER TABLE company_settings ADD COLUMN loyalty_earn_rate REAL',
    'ALTER TABLE company_settings ADD COLUMN loyalty_redeem_rate REAL',
    'ALTER TABLE company_settings ADD COLUMN loyalty_min_redeem INTEGER',

    // ==================== QR สั่งที่โต๊ะ ====================
    // โต๊ะของร้าน — 1 โต๊ะมี QR ถาวร 1 อัน (สติกเกอร์) · รอบโต๊ะ = บิลเปิด (pos_running_bills.table_id)
    `CREATE TABLE IF NOT EXISTS pos_tables (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      qr_token TEXT NOT NULL UNIQUE,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    // ชื่อซ้ำได้เฉพาะโต๊ะที่ลบไปแล้ว (is_active = 0 เก็บไว้ให้บิลเก่าอ้างถึง)
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_tables_name ON pos_tables(tenant_id, name) WHERE is_active = 1',
    'ALTER TABLE pos_running_bills ADD COLUMN table_id TEXT',
    // QR ของรอบนี้ (โหมดเปลี่ยนทุกรอบ) ใช้ได้เฉพาะตอนบิล OPEN — ปิดบิลแล้วลิงก์ตายเอง
    'ALTER TABLE pos_running_bills ADD COLUMN qr_token TEXT',
    'ALTER TABLE pos_running_bills ADD COLUMN bill_requested_at TEXT',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_bills_qr_token ON pos_running_bills(qr_token) WHERE qr_token IS NOT NULL',
    // 1 โต๊ะเปิดได้ทีละบิล — กันกดเปิดโต๊ะซ้ำจากสองเครื่องพร้อมกันที่ระดับฐานข้อมูล
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_bills_open_table ON pos_running_bills(tenant_id, table_id)
      WHERE table_id IS NOT NULL AND status = 'OPEN'`,
    // 'static' (ค่าตั้งต้น, QR ถาวรบนโต๊ะ) | 'rotate' (พิมพ์ QR ใหม่ทุกครั้งที่เปิดโต๊ะ)
    'ALTER TABLE company_settings ADD COLUMN pos_qr_mode TEXT',

    // ==================== สมาชิกด้วยเบอร์โทรผ่าน QR ====================
    // PDPA: ความยินยอม 2 ข้อแยกกัน — เก็บเบอร์เพื่อสะสมแต้ม (จำเป็น) / รับข่าวสาร (ไม่บังคับ) · NULL = ยังไม่ยินยอม/ถอนแล้ว
    'ALTER TABLE customers ADD COLUMN pdpa_points_consent_at TEXT',
    'ALTER TABLE customers ADD COLUMN marketing_consent_at TEXT',
    // มือถือที่ลูกค้าใส่เบอร์ไว้ (cookie httpOnly เก็บ token ดิบ, ตารางเก็บแค่ hash)
    // verified_at = แคชเชียร์ยืนยันตัวตนแล้ว → เครื่องนี้เห็นชื่อ/แต้ม และแลกแต้มได้ · NULL = แค่สะสมได้
    `CREATE TABLE IF NOT EXISTS pos_member_devices (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      consent_marketing INTEGER DEFAULT 0,
      verified_at TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      UNIQUE(tenant_id, token_hash)
    )`,
    // บิลนี้ผูกสมาชิกมาจากมือถือเครื่องไหน (รอแคชเชียร์ยืนยัน) · ผูกที่เคาน์เตอร์เอง = NULL
    'ALTER TABLE pos_running_bills ADD COLUMN member_device_id TEXT',

    // ==================== เฟส 3: โปรโมชัน + แลกแต้มเป็นของแถมบนหน้า QR ====================
    // โปร = ป้ายบนแท็บ "โปรและแลกแต้ม" + ปุ่มสั่งเมนูที่ผูกไว้ (ราคา/ส่วนลดจริงยังคิดที่ POS ตามปกติ)
    `CREATE TABLE IF NOT EXISTS pos_promotions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      pos_menu_id TEXT,
      starts_on TEXT,
      ends_on TEXT,
      members_only INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    // รางวัลแลกแต้ม = เมนูของแถม (เข้าบิลราคา 0 ตัดสต็อกตามปกติ)
    `CREATE TABLE IF NOT EXISTS pos_rewards (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      points_cost INTEGER NOT NULL CHECK (points_cost > 0),
      pos_menu_id TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    // จองแต้มตอนส่งออเดอร์ (RESERVED) → ตัดจริงตอนรับชำระ (USED) · รายการของแถมถูกลบ/บิลยกเลิก = ไม่ตัด (RETURNED)
    `CREATE TABLE IF NOT EXISTS pos_redemptions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      bill_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      reward_id TEXT NOT NULL,
      bill_item_id TEXT NOT NULL,
      points INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED', 'USED', 'RETURNED')),
      created_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_pos_redemptions_bill ON pos_redemptions(bill_id)',
    'CREATE INDEX IF NOT EXISTS idx_pos_redemptions_customer ON pos_redemptions(tenant_id, customer_id, status)',

    // ==================== เฟส 4: Pop-up โฆษณา (add-on qr_ad ฿19/ด.) ====================
    // 1 ร้าน 1 ช่อง 1 รูป (PRIMARY KEY tenant_id) · อัปโหลดใหม่ = แทนที่รูปเดิม
    `CREATE TABLE IF NOT EXISTS pos_ad_slots (
      tenant_id TEXT PRIMARY KEY,
      image_url TEXT,
      link_type TEXT DEFAULT 'none' CHECK (link_type IN ('none', 'promo', 'menu')),
      link_menu_id TEXT,
      starts_on TEXT,
      ends_on TEXT,
      daily_start TEXT,
      daily_end TEXT,
      is_enabled INTEGER DEFAULT 1,
      suspended_at TEXT,
      updated_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS pos_ad_events (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('shown', 'tap', 'close')),
      created_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_pos_ad_events ON pos_ad_events(tenant_id, created_at)',
  ].forEach(sql => {
    try { db.exec(sql) } catch (e: any) {
      // ADD COLUMN ซ้ำ = รันไปแล้ว · error อื่นต้องเห็น ไม่งั้นตารางหายเงียบ ๆ
      if (!/duplicate column name/i.test(String(e?.message))) console.error('⚠️ posQr migration error:', sql.slice(0, 80), e)
    }
  })
}
