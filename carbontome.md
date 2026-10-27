# 🏭 Carbon ERP - System Architecture & Development Guide

> เอกสารสถาปัตยกรรมระบบ CRM-BOM-Stock ERP และแผนการพัฒนา
> อัปเดตล่าสุด: 27 ตุลาคม 2026

---

## 📊 สรุปฟีเจอร์ปัจจุบัน (Current Status)

### ✅ พร้อมใช้งานแล้ว (Production Ready)

| โมดูล | สถานะ | รายละเอียด |
|--------|--------|------------|
| **CRM** | ✅ | Customers, Orders, Contacts, Activity Logs |
| **BOM** | ✅ | Bill of Materials (Multi-level), Materials Management |
| **Stock** | ✅ | Inventory, Stock Movements, Low Stock Alerts |
| **Purchase Orders** | ✅ | ใบสั่งซื้อ, Suppliers, Goods Receipt |
| **Work Orders** | ✅ | ใบสั่งผลิต, MES เบื้องต้น |
| **Marketing** | 🚧 | Ads analytics จาก CSV — กำลังรื้อเป็นแดชบอร์ดรายเดือนผ่าน MCP (ดูแผน 13 ต.ค. 2026 ท้ายไฟล์) |
| **Calculator** | ✅ | Cost & Profit Analysis |
| **POS/Cashier** | ✅ | Open Bill System, Stock Integration, Accounting Link |
| **POS Shift System** | ✅ | เปิด/ปิดกะ, กรอกเงินเปิดกะ, นับเงินปิดกะแบบ blind count, ผลต่าง, แท็บสรุปวันนี้ (เงินในลิ้นชัก/สด/โอน), ปิดกะแล้วส่งสรุปเข้า LINE ส่วนตัวของ Admin |
| **POS Clearing Transfer** | ✅ | นำเงินเข้าบัญชีประจำวัน, เลือกวันที่, Cash Over/Short (5901) |
| **QR สั่งที่โต๊ะ + สมาชิกเบอร์โทร** | 🚧 | ผังโต๊ะ, QR ถาวร/เปลี่ยนทุกรอบ, ลูกค้าสั่งเข้า KDS เอง, สมัครสมาชิกด้วยเบอร์ (แคชเชียร์ยืนยันแทน OTP) — เฟส 0–4 ครบ: + โปร/แลกแต้มเป็นของแถมบนมือถือ, Pop-up โฆษณา add-on ฿19 (ดู Session Log 19–20 ต.ค.)
| **Bill Void** | ✅ | ยกเลิกบิล (PAID→VOID) + Reversal Journal Entry อัตโนมัติ |
| **Accounting** | ✅ | Chart of Accounts, Journal Entries (T-account UX), VAT |
| **Tax Management** | ✅ | VAT ทิศทาง WHT ครบ, ภ.ง.ด.3/53, ภาษีซื้อต้องห้าม, ภาษีขายครบช่องทาง, CIT ขั้นบันได SME, alerts กำหนดยื่น |
| **WHT Certificate (50 ทวิ)** | ✅ | ออก/พิมพ์/ยกเลิก, เลขรัน พ.ศ., ตัวอักษรบาทไทย |
| **Period Closing** | ✅ | ปิดงวด + ล็อก JE + ปิดบัญชีสิ้นปีเข้ากำไรสะสม (3103) |
| **Budget vs Actual** | ✅ | ตั้งงบรายบัญชี×เดือน เทียบผลจริงจาก ledger |
| **Multi-Currency (PO)** | ✅ | สกุลเงิน+เรท, PO แปลงเข้า THB เต็มรูปแบบ (UI เลือกสกุลเงินในฟอร์ม Sales/Purchase ยังไม่ทำ — ไฟล์ 3,800+ บรรทัด รอ refactor) |
| **Approval System** | ✅ | Multi-level approval workflow + บันทึกความเคลื่อนไหวทุก action (AUTO) แยกหมวด + อีโมจิความร้ายแรง · เพดานส่วนลด POS |
| **Platform Settlement** | 🚧 | ลงบัญชี 3 ขั้นผ่าน 1181 มีแล้ว แต่รับไฟล์จริง Shopee ไม่ได้ — กำลังรื้อ (ดูแผน 13 ต.ค. 2026) · สาย Platform Order Fulfillment เดิมลบแล้ว 2026-09-22 |
| **Sales Invoice Attachments** | ✅ | อัปโหลดรูป/ไฟล์แนบใบแจ้งหนี้ (max 10MB), gallery preview, lightbox |
| **Invoice Detail Modal** | ✅ | redesign max-w-4xl, items table, payment history, attachment gallery |
| **Purchase List/Card View** | ✅ | สลับ list/card view (list default), pagination 25/50/100 per page |
| **Smart Unit Conversion** | ✅ | BFS chain conversion, sealed stock, auto-unpack, LLM advisor, spelling tolerant |
| **Phopy Board (Business Unit P&L)** | ✅ | ตัวเลขจาก ledger จริง (ไม่นับ closing entry), การ์ด "กำไรขาดทุนตามหน่วยธุรกิจ" Retail/Wholesale/Online, tag `business_unit` จาก `reference_type` ของ JE ต้นทาง |
| **Company Email** | ✅ | Cloudflare Email Routing + Brevo SMTP Relay (bbpillow.com, phopy.net) |

#### 🧮 Smart Unit Conversion (May 2026)
สรุปสั้น ๆ: ระบบแปลงหน่วยอัจฉริยะที่แก้ปัญหา 6 อย่าง — (1) **BFS chain conversion** แปลงหน่วยหลายขั้นต่อเนื่องอัตโนมัติ เช่น `แพ็ค → ขวด → ลิตร` (2) **Sealed stock** แยก stock ที่ยังไม่แกะ (`sealed_qty`) ออกจากที่แกะแล้ว (3) **Auto-unpack** ถ้าของหลักหมด → แกะแพ็คอัตโนมัติเพื่อเบิก/ขายต่อ (4) **Spelling tolerant** รับคำเขียนผิดเช่น `แพค/แพ๊ค/แพ็ค` ทั้งหมด map เป็น `pack` (5) **LLM Advisor** ช่วยแนะนำค่า conversion factor ตอนตั้งค่า (6) **List view UX** หน้า Purchase (GR/PO) คลิก row ได้เหมือน card view พร้อมปุ่ม action ครบ

### ✅ Online Channel / Platform Integration

| Feature | Status |
|---------|--------|
| Platform CSV Upload (Shopee Ads) | ⚠️ มีแต่ parser อ่านไฟล์จริงผิด — จะลบ แทนด้วย MCP |
| ~~SKU Matching / Auto Stock Deduction / Ad Spend JE Queue / Import History~~ | 🗑️ ลบแล้ว 2026-09-22 (ไม่เคยมีข้อมูล) |
| Platform Settlement 3 ขั้น (1181) | ⚠️ มี แต่ยังไม่เคยใช้จริง + มีบั๊ก (ดูแผน 13 ต.ค.) |
| รอบเดือน Shopee ผ่าน MCP · จับคู่ SKU · กำไรรายสินค้า · KPI 1/3/6/12 เดือน | 📋 วางแผนแล้ว 13 ต.ค. 2026 |
| Lazada | ⏳ รอไฟล์ตัวอย่างจากเจ้าของ — ใช้แบบ Shopee ไปก่อน |
| Business Unit P&L (Retail/Wholesale/Online) | ✅ (Phopy Board, ledger-accurate) |

### 🚧 อยู่ระหว่างพัฒนา (In Progress)

| โมดูล | สถานะ | รายละเอียด |
|--------|--------|------------|
| **MRP** | 🚧 | Material Requirements Planning |
| **COGS Recording** | 🚧 | Cost of Goods Sold auto-calculation |
| **MCP รายงานบัญชี (TB/Ledger)** | ✅ | ต่อ prompt บัญชี 24 ตัวเข้า ERP — แผนอยู่ใน Session Log 27 ก.ย. 2026 |
| ~~**POS KDS**~~ | ✅ | ใช้งาน production แล้ว (ticket-based, polling 3 วิ, เสียง+notification) — ย้ายขึ้นหัวข้อพร้อมใช้งานได้ |
| **Sales Journal Preview** | 🚧 | Dr/Cr preview + เลือก account ก่อนบันทึก (3 จุด: Invoice/Receipt/CreditNote) |

### ❌ ยังไม่มี (Planned)

| โมดูล | ความสำคัญ | รายละเอียด |
|--------|-----------|---------|
| **RBAC** | 🚧 บางส่วน | มีแล้ว: `services/rbac.service.ts`, `PermissionSettings.tsx`, `user_approval_permissions`, role gate ใน MCP tools — ยังไม่ครบทุกหน้า · สรุปการใช้ดู Session Log 22–23 ต.ค. 2026 |
| ~~**Credit Note**~~ | ✅ | มีแล้ว `routes/sales/creditNotes.ts` mount ที่ `/api/sales/credit-notes` |
| **Financial Statements** | ✅ | งบกำไรขาดทุนขั้นบันได + เทียบงวดก่อน, งบดุลรวมกำไรยังไม่ปิดงวด (เตือนถ้าไม่สมดุล), งบกระแสเงินสด 3 หมวด (21 ต.ค. 2026) |
| **QMS** | 🟡 ต่ำ | Quality Management System |
| **Capacity Planning** | 🟡 ต่ำ | Production capacity planning |

---

## 🏗️ System Architecture

### Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18 + TypeScript |
| **Build Tool** | Vite |
| **Styling** | Tailwind CSS |
| **UI Components** | Custom + Lucide Icons |
| **Animation** | Framer Motion |
| **State Management** | Zustand |
| **Data Fetching** | TanStack Query (React Query) |
| **Backend** | Node.js + Express + TypeScript |
| **Database** | SQLite (better-sqlite3) |
| **Authentication** | JWT |

### Database Schema Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CORE MODULES                              │
├─────────────────────────────────────────────────────────────────┤
│  👥 CRM           │  🏭 PRODUCTION      │  📦 INVENTORY         │
│  ├── customers    │  ├── boms           │  ├── stock_items      │
│  ├── orders       │  ├── bom_items      │  ├── stock_movements  │
│  └── activity_logs│  └── work_orders    │  └── materials        │
├─────────────────────────────────────────────────────────────────┤
│  🛒 SALES         │  💰 ACCOUNTING      │  🏪 POS SYSTEM        │
│  ├── quotations   │  ├── accounts       │  ├── pos_menu_configs │
│  ├── sales_orders │  ├── journal_entries│  ├── pos_running_bills│
│  ├── invoices     │  ├── vat_entries    │  ├── pos_bill_items   │
│  └── receipts     │  └── account_balances│  └── pos_payments    │
├─────────────────────────────────────────────────────────────────┤
│  🛍️ PURCHASE      │  📊 TAX            │  👤 USER MGMT         │
│  ├── purchase_orders│  ├── tax_periods   │  ├── users            │
│  ├── goods_receipts │  ├── tax_transactions│  └── user_approval_permissions│
│  └── suppliers      │  └── tax_filings   │
├─────────────────────────────────────────────────────────────────┤
│  🛒 PLATFORM (Online Channel)                                    │
│  ├── platform_settlements  (รอบลงบัญชี 3 ขั้นผ่าน 1181)            │
│  ├── platform_fee_mappings (ค่าธรรมเนียม → บัญชี)                  │
│  ├── shops / marketing_files / marketing_metrics (Ads CSV เดิม)    │
│  └── (แผน) shopee_months / shopee_month_products / shopee_days    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🍽️ POS System Architecture

### Overview
ระบบขายหน้าร้าน (Point of Sale) แบบ Open Bill ไม่ผูกกับโต๊ะ เชื่อมต่อกับ BOM และ Accounting

### Key Features

1. **Open Bill System**
   - ไม่ผูกกับโต๊ะ ตั้งชื่อบิลเองได้ ("โต๊ะ 1", "Grab 01", "คุณสมชาย")
   - บันทึกชื่อลูกค้า, เบอร์โทร optional
   - ค้างบิลไว้ได้ กลับมาแก้ไขทีหลังได้

2. **BOM Integration** ⭐ NEW
   ```
   pos_menu_configs.bom_id → boms.id → bom_items
   
   ขาย 1 ชิ้น → ตัด stock ตาม BOM ingredients อัตโนมัติ
   ```

3. **Stock Deduct Flow**
   ```
   Payment Received
        ↓
   Check Stock Availability (from BOM or pos_menu_ingredients)
        ↓
   Deduct stock_items.quantity
        ↓
   Create stock_movements (type: 'SALE')
        ↓
   Record pos_stock_deductions
   ```

4. **Accounting Integration (Clearing Account)**
   ```
   ตอนขาย (auto):
   Dr. ลูกหนี้การค้า-POS (1180)     ฿107
      Cr. รายได้จากการขาย (4100)     ฿100
      Cr. ภาษีขาย (2150)             ฿7

   ตอนนำเงินเข้าบัญชี (POSClearing):
   Dr. เงินสด (1101) / ธนาคาร (1102)     ฿xxx  ← ที่นับได้จริง
   [Dr. 5901 เงินขาด/เงินเกิน            ฿yyy] ← ถ้ายอดไม่ตรง
      Cr. ลูกหนี้การค้า-POS (1180)       ฿zzz  ← ยอดบิลจริง

   ตอนยกเลิกบิล (Bill Void):
   Dr. รายได้จากการขาย (4100)            ฿xxx  ← reverse รายได้
      Cr. ลูกหนี้การค้า-POS (1180)       ฿xxx  ← reverse clearing
   ```

5. **POS Shift System**
   - กรอกเงินสดเปิดกะก่อนเริ่มรับออเดอร์
   - ติดตาม total_revenue / cash_revenue / bank_revenue แบบ realtime
   - ปิดกะ: นับเงินจริง → คำนวณ expected = เปิดกะ + cash_revenue → แสดงผลต่าง

### Database Tables

```sql
-- POS Shifts (กะการขาย)
pos_shifts
├── id, tenant_id, shift_number
├── status: OPEN|CLOSED
├── opened_at, closed_at
├── opening_cash, closing_cash_counted
├── expected_cash, cash_difference
├── total_revenue, cash_revenue, bank_revenue, bill_count
└── opened_by, closed_by, notes

-- POS Menu Configuration (with BOM linkage)
pos_menu_configs
├── id, tenant_id
├── product_id → products.id
├── bom_id → boms.id          -- NEW: Link to BOM
├── category_id → pos_categories.id
├── pos_price, cost_price
├── is_available, is_pos_enabled
└── display_order, quick_code

-- Running Bills (Open Bill System)
pos_running_bills
├── id, tenant_id
├── bill_number               -- POS-2024-00001
├── display_name              -- Custom name (editable)
├── customer_name, customer_phone
├── status: OPEN|PENDING_PAYMENT|PAID|CANCELLED|VOID
├── subtotal, tax_amount, service_charge_amount
├── discount_amount, total_amount
└── created_by, closed_by

-- Bill Items
pos_bill_items
├── id, bill_id
├── pos_menu_id → pos_menu_configs.id
├── product_name (cache)
├── quantity, unit_price, total_price
├── special_instructions
└── status: PENDING|PREPARING|READY|SERVED

-- Stock Deduction Records
pos_stock_deductions
├── id, bill_item_id, stock_item_id
├── quantity_deducted
└── returned (for cancelled bills)
```

### API Endpoints

```typescript
// Menu Management
GET    /api/pos/menu-configs
POST   /api/pos/menu-configs              // With bom_id support
PUT    /api/pos/menu-configs/:id
DELETE /api/pos/menu-configs/:id
PATCH  /api/pos/menu-configs/:id/toggle

// Bill Management
GET    /api/pos/bills
GET    /api/pos/bills/open
POST   /api/pos/bills
POST   /api/pos/bills/:id/items
POST   /api/pos/bills/:id/pay            // + stock deduct + accounting
POST   /api/pos/bills/:id/cancel         // + stock return

// Stock Check
GET    /api/pos/menu-configs/:id/stock
GET    /api/pos/menu-configs/:id/stock-check

// POS Shifts (กะการขาย)
GET    /api/sales/pos-shifts              // ประวัติกะทั้งหมด
GET    /api/sales/pos-shifts/current      // กะที่เปิดอยู่ + live sales
POST   /api/sales/pos-shifts/open         // เปิดกะ (ต้องกรอก opening_cash)
POST   /api/sales/pos-shifts/:id/close    // ปิดกะ (กรอก closing_cash_counted)

// Bill Void
POST   /api/sales/pos-running-bills/:id/void  // ยกเลิกบิล PAID → VOID + reversal JE

// POS Clearing
GET    /api/pos/clearing/balance
GET    /api/pos/clearing/pending-bills?date=YYYY-MM-DD
POST   /api/pos/clearing/transfer         // นำเงินเข้าบัญชี (รองรับ over/short)
GET    /api/pos/clearing/transfers
GET    /api/pos/clearing/transfers/:id
```

---

## 📁 Project Structure

```
CRM-BOM-Stock/
├── backend/
│   ├── src/
│   │   ├── db/
│   │   │   └── sqlite.ts              # Database schema & migrations
│   │   ├── routes/
│   │   │   ├── pos-menu.routes.ts     # POS Menu API
│   │   │   ├── pos-bill.routes.ts     # POS Bill API
│   │   │   ├── accounts.routes.ts     # Chart of Accounts
│   │   │   ├── journal.routes.ts      # Journal Entries
│   │   │   └── ...
│   │   ├── services/
│   │   │   ├── pos-stock.service.ts   # Stock deduction logic
│   │   │   ├── pos-accounting.service.ts  # Accounting integration
│   │   │   └── ...
│   │   └── index.ts                   # Express app entry
│   └── dev.db                         # SQLite database
│
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Cashier.tsx            # POS main page
│   │   │   ├── settings/
│   │   │   │   └── POSMenuSettings.tsx    # Menu config with BOM
│   │   │   ├── Accounting/
│   │   │   │   ├── ChartOfAccounts.tsx
│   │   │   │   └── JournalEntries.tsx
│   │   │   └── ...
│   │   ├── services/
│   │   │   ├── pos.service.ts
│   │   │   └── pos-bill.service.ts
│   │   └── App.tsx
│   └── package.json
│
└── carbontome.md                      # This file
```

---

## 🔌 Module Integration

### 1. BOM → POS Integration
```typescript
// When BOM is linked to POS Menu
pos_menu_configs.bom_id = boms.id

// On Sale: Stock deduct from BOM items
bom_items → material_id → stock_items
```

### 2. POS → Stock Integration
```typescript
// Real-time stock deduction
pos_bill.payment → posStockService.deductStockOnPayment()
    → stock_items.quantity -= qty
    → stock_movements.create({ type: 'SALE' })
```

### 3. POS → Accounting Integration
```typescript
// Journal entry on payment
pos_bill.payment → posAccountingService.recordSale()
    → journal_entries.create()
    → vat_entries.create({ isOutputVat: true })
```

### 4. Sales → Production Integration
```typescript
// Sales order can create Work Order
sales_orders → work_orders
    → bom_items → material deduction
```

---

## 🚀 Development Roadmap

### ✅ Phase 1: Foundation (COMPLETED)
- [x] Core CRM (Customers, Orders)
- [x] BOM Management (Multi-level support)
- [x] Stock/Inventory
- [x] Purchase Orders
- [x] Work Orders

### ✅ Phase 2: POS System (COMPLETED)
- [x] Menu Management with Categories
- [x] Open Bill System (No table binding)
- [x] Stock auto-deduct on payment
- [x] BOM integration for ingredients
- [x] Clearing Account for accounting

### ✅ Phase 3: Accounting Enhancement (COMPLETED)
- [x] Chart of Accounts
- [x] Journal Entries (Double Entry, T-account UX)
- [x] VAT Recording
- [x] POS Clearing Transfer UI (นำเงินเข้าบัญชีประจำวัน)
- [x] Cash Over/Short Recording (account 5901)
- [x] Bill Void + Reversal Journal Entry
- [x] POS Shift System (เปิด/ปิดกะ + นับเงิน)
- [x] สรุปปิดกะส่งเข้า LINE ส่วนตัวของ Admin (Flex One UI 9, 16 ต.ค. 2026)
- [ ] POS Kitchen Display System (KDS)
- [ ] COGS auto-calculation on sale

### ✅ Phase 4: Advanced Accounting (COMPLETED — 19-20 July 2026)
- [x] Tax module ตรงหลักภาษีไทย (WHT ทิศทาง, ภ.ง.ด.3/53, ภาษีซื้อต้องห้าม, ภาษีขายครบช่องทาง, CIT ขั้นบันได SME, alerts)
- [x] Period Closing (ปิดงวด + ล็อก JE + ปิดบัญชีสิ้นปีเข้ากำไรสะสม 3103)
- [x] WHT Certificate 50 ทวิ (ออก/พิมพ์/ยกเลิก, เลขรัน พ.ศ., ตัวอักษรบาทไทย)
- [x] Budget vs Actual (งบรายบัญชี×เดือน เทียบผลจริงจาก ledger)
- [x] Multi-Currency ขั้นต่ำ (สกุลเงิน+เรท, PO แปลงเข้า THB เต็มรูปแบบ)
- [x] Phopy Board ledger-accurate + P&L แยกหน่วยธุรกิจ (Retail/Wholesale/Online)

### 📋 Phase 5: Remaining Advanced Features (PLANNED)
- [ ] MRP (Material Requirements Planning)
- [x] RBAC — มีโครงแล้ว (rbac.service + PermissionSettings + approval permissions) ยังไม่ครอบทุกหน้า
- [x] Credit Note (ใบลดหนี้) — เสร็จแล้ว
- [~] Financial Statements — มี route งบดุลแล้ว ยังไม่ auto-generate เต็มรูป
- [ ] UI เลือกสกุลเงินในฟอร์ม Sales/Purchase (รอ refactor ไฟล์ 3,800+ บรรทัด)
- [ ] Organic vs Paid Analytics → รวมอยู่ในแผนรอบเดือน Shopee 13 ต.ค. 2026 (ได้ไฟล์ยอดขายรวมแล้ว · Lazada ยังรอไฟล์)
- [ ] Advanced Reports & Dashboard
- [ ] Multi-warehouse support
- [ ] API for external integrations

---

## 💡 Key Design Decisions

### 1. Why Open Bill instead of Table-based?
- ยืดหยุ่นกว่า - ใช้ได้ทั้งร้านอาหาร, ร้านกาแฟ, ขายส่ง
- ไม่ต้องจัดการ master data โต๊ะ
- ตั้งชื่อตาม context ได้ (Grab, Lineman, คุณxxx)

### 2. Why BOM-POS Linkage?
- ลด duplication ของ ingredients
- BOM ใช้ทั้ง Production และ Sales
- เปลี่ยน recipe ที่ BOM แล้ว POS ได้ผลทันที

### 3. Why Clearing Account (1180)?
- แยกระหว่าง "ยอดขาย" กับ "เงินที่รับจริง"
- กันคนลักษณะอ่อน (หากบันทึกเงินสดทันที)
- ตรวจสอบยอดคงค้างระหว่างระบบ POS กับบัญชี

---

## 📝 Development Guidelines

### Backend
- ใช้ Repository Pattern สำหรับ database operations
- Services สำหรับ business logic
- Routes สำหรับ API endpoints เท่านั้น
- ใช้ snake_case ใน database, camelCase ใน TypeScript

### Frontend
- Functional components with hooks
- Zustand สำหรับ global state
- React Query สำหรับ server state
- Tailwind สำหรับ styling
- Cyberpunk theme colors

### Database
- SQLite with better-sqlite3 (synchronous)
- Foreign keys enabled
- Migrations ใน sqlite.ts
- Index สำหรับ query ที่ใช้บ่อย

### Scripts (จาก root `CRM-BOM-Stock/`)
```
npm run dev           — รัน backend + frontend พร้อมกัน (kill-port 5000/3000 ก่อน)
npm run dev:tunnel    — รัน Cloudflare tunnel ก่อน → delay 5s → รัน dev
npm run tunnel        — รัน Cloudflare tunnel อย่างเดียว (crm.phopy.net → localhost:5000)
npm run build         — build frontend (Vite)
npm run build:backend — build backend (tsc)
npm run build:all     — build backend แล้ว frontend
npm run start         — start backend production (node dist/)
npm run install:all   — npm install ทั้ง backend + frontend
```

---

## 🔗 Related Documentation

- [AGENTS.md](./AGENTS.md) - Agent-specific guidelines
- [README.md](./README.md) - Project overview (Thai)
- [QUICKSTART.md](./QUICKSTART.md) - Quick start guide

---

## 🏭 Carbon ERP Reference

| Resource | URL |
|----------|-----|
| Carbon ERP GitHub | https://github.com/crbnos/carbon |
| Carbon ERP Docs | https://learn.carbon.ms |
| Carbon ERP Website | https://carbon.ms |

---

---

## 🎨 UI/UX Review & Guidelines

> วิเคราะห์โดย UI/UX Pro Max Skill | อัปเดต: April 2026

### Design System (Recommended)
- **Pattern**: Data-Dense Dashboard (Enterprise Gateway)
- **Style**: Dark professional with minimal neon accents
- **Typography**: Orbitron → Inter (headings), Inter (body) — Orbitron ยากอ่านสำหรับข้อความยาว
- **Colors**: Dark bg `#0a0e27` + cyan accent `#00f0ff` + green positive `#00ff88`

### ✅ แก้ไขแล้ว (April 2026)

| ปัญหา | ไฟล์ | การแก้ไข |
|-------|------|---------|
| `background-attachment: fixed` lag บน mobile | `index.css:16` | เปลี่ยนเป็น `scroll` |
| `hover:scale-105` ทำ layout shift | `index.css:36,44` | เปลี่ยนเป็น `hover:brightness-110` |
| ไม่มี `prefers-reduced-motion` | `index.css` | เพิ่ม media query ท้ายไฟล์ |
| Logo icon หมุน infinite | `Sidebar.tsx:163` | เปลี่ยนเป็น static div |
| Icon buttons ไม่มี `aria-label` | `Header.tsx` | เพิ่ม aria-label ทุกปุ่ม |
| ไม่มี `role="navigation"` | `Sidebar.tsx:207` | เพิ่ม role + aria-label |
| Search input ไม่มี `role="search"` | `Header.tsx:159` | เพิ่ม role="search" + aria-label |
| Touch targets เล็กเกิน 44px | `Header.tsx` | เพิ่ม `min-h-[44px] min-w-[44px]` |
| Buttons ไม่มี focus-visible | `index.css` | เพิ่ม `focus-visible:ring-2` |

### ⚠️ ยังต้องแก้ (Backlog)

| ปัญหา | Priority | ไฟล์เป้าหมาย |
|-------|----------|-------------|
| ~~Orbitron font ยากอ่านสำหรับ heading ภาษาไทย~~ | ✅ แก้แล้ว | เปลี่ยนเป็น Inter + Noto Sans Thai ทุกไฟล์ |
| Tables ในหน้า BOM/Stock ต้องตรวจ overflow-x-auto | MEDIUM | `BOM.tsx`, `Stock.tsx` |
| `scan-line-effect` animation ยังรันบน browser ที่ไม่รองรับ reduced-motion | LOW | `index.css` |
| Skip link "ข้ามไปเนื้อหาหลัก" ยังไม่มี | LOW | `Layout.tsx` |
| Status badges ขนาดเล็ก (py-1) บน mobile | LOW | `index.css:114` |

### Mobile Compatibility
- **Viewport meta**: ✅ มีแล้ว
- **Responsive breakpoints**: ✅ md: lg: ใช้งานได้
- **Touch targets**: ✅ แก้แล้วใน Header buttons
- **Background attachment**: ✅ แก้แล้ว (scroll แทน fixed)
- **Sidebar on mobile**: ⚠️ 280px fixed width — ควรพิจารณา overlay mode บน sm:

*Last Updated: 2026-04-18*
*Maintained by: Development Team*


Phase 2 — Medium Risk · High Impact
#	ปัญหา	ไฟล์	Risk	Impact
2.1	~1,019 onClick ไม่มี cursor-pointer (วัดใหม่ 2026-09-06: onClick 1,105 จุด / cursor-pointer 86) — เดิมจด 679 ช่องว่างโตขึ้นเท่าตัว	ทุกไฟล์	🟡 Medium	High — UX พื้นฐาน
2.2	Mobile sidebar ไม่ใช่ overlay — sidebar 280px ดัน content เหลือ ~95px บนจอเล็ก	Layout.tsx	🟡 Medium	High — mobile unusable
2.3	aria-label มี 26 จุด (วัดใหม่ 2026-09-06, เดิม 8) — ยังครอบแค่ ~2% ของ onClick 1,105 จุด	ทุกหน้า	🟡 Medium	Medium — accessibility
2.4	Status badge py-1 (~8px) เล็กกว่า 44px minimum touch target	index.css:114	🟡 Medium	Medium — mobile tap accuracy
Phase 3 — Higher Risk · Architecture Change
#	ปัญหา	ไฟล์	Risk	Impact
3.1	Sidebar ไม่มี mobile breakpoint logic — ควรเปิดเป็น overlay บน < lg และปิดอัตโนมัติหลัง navigate	Layout.tsx + Sidebar.tsx	🔴 High	High — mobile experience
3.2	Z-index ไม่มีระบบ — z-[9999] หายแล้ว แต่ยังปน z-10/z-30/z-40/z-50/z-[60]/z-[100] (วัดใหม่ 2026-09-06) modal ซ้อน modal ยังผิดพลาดได้	App.tsx, BOMModal.tsx	🔴 High	Medium — modal stacking bugs
3.3	Background glow effects ใช้ animate-pulse-slow infinite บน Layout.tsx:32-33 — รันตลอดทุกหน้า	Layout.tsx	🟡 Medium	Low — battery/CP



🟢 Phase 3: Advanced Features (อนาคต)
ลำดับ	หัวข้อ	ความซับซ้อน	สถานะ
3.1	Year-End Closing Entries	ปิดบัญชีรายได้ → กำไรสะสม (3103), ปิดบัญชีค่าใช้จ่าย → กำไรสะสม	✅ เสร็จแล้ว (Period Closing)
3.2	WHT Certificate Tracking	ติดตามใบหัก ณ ที่จ่าย ภ.ง.ด. 3/53 พร้อมรายงาน	✅ เสร็จแล้ว (50 ทวิ)
3.3	Budget vs Actual	ตั้งงบประมาณรายบัญชี → เทียบกับ actual	✅ เสร็จแล้ว
3.4	Multi-Currency	รองรับธุรกรรมต่างประเทศ	✅ เสร็จแล้ว (PO), UI ฟอร์ม Sales/Purchase ค้าง
3.5	Fixed Asset Depreciation	คำนวณค่าเสื่อมอัตโนมัติ	📋 ยังไม่ทำ

---

## 📅 Session Log — 20 กรกฎาคม 2026 (รอบ 3: Phopy Board แม่นยำเชิงบัญชี)

**สิ่งที่ทำ:**
- Tag `business_unit` ที่ JE ต้นทาง — map ตรงจาก `reference_type` ที่มีอยู่แล้ว ไม่ต้องเดาจาก pattern: POS → RETAIL, ใบแจ้งหนี้/รับเงิน → WHOLESALE, ค่า ads → ONLINE, ลงมือเอง → OTHER พร้อม backfill ของเก่า (dev DB: 10 ใบ — RETAIL 3, OTHER 7)
- ตัวเลขบน Phopy Board ดึงจาก ledger จริง — รายได้/COGS/กราฟ 12 เดือน/ตาราง P&L มาจาก journal (ไม่นับ closing entry — ของเดิมลืมกันจุดนี้ไว้ด้วย แก้ไปพร้อมกัน) schema จริงเก็บ COGS เป็น `type=EXPENSE, category=COGS` — ตรวจเทียบกับ `reports.routes` แล้วถูกต้อง
- ครบ 3 ช่องทาง: หน้าร้าน (POS) / ขายส่ง / ออนไลน์ + การ์ด "กำไรขาดทุนตามหน่วยธุรกิจ" ใหม่ + relabel ยอดซื้อ PO ว่า "ไม่ใช่ COGS จริง" คู่กับการ์ด Ledger COGS

**พบระหว่างทาง (ยังไม่แก้):**
- `sales.routes.ts` (2,477 บรรทัด) เป็นโค้ดตายไม่ได้ mount — candidate ลบทิ้งรอบ refactor ถัดไป — ✅ **ลบไปแล้ว** (ไฟล์ไม่มีอยู่ในระบบแล้ว ณ 2026-09-06)
- JE จาก POS ต้อง post/approve ก่อนถึงเข้าตัวเลข ledger บน board (พฤติกรรมเดิมของระบบ ไม่ได้เกิดจากงานวันนี้) — ช่อง Retail ใน Zone 1 เห็นยอดทันทีเพราะอ่านจากบิลตรง แต่ P&L ต้องรอ post
- Backup ทุกอย่างอยู่บนเซิร์ฟเวอร์ (`.bak2/.bak3/.bak4` + `dev.db.bak-*`) — ใช้งานจริงสักพักแล้วค่อยลบ — ✅ **ลบแล้ว 2026-09-06** (136 ไฟล์ .bak, 26 ตัวหลุดขึ้น git ไปแล้ว) ดู session log ล่างสุด

---

## 📅 Session Log — 21 กรกฎาคม 2026 (Kimi CLI removal + MCP approval-bypass audit)

**สิ่งที่ทำ:**
- ถอด Kimi CLI (Moonshot AI remote coding agent) ออกจาก LXC 100 — เดิมรันเป็น root ผ่าน VS Code/Antigravity Remote-SSH server ที่ค้างอยู่บนเครื่อง production ตั้งแต่ boot (รวม `.antigravity-server` + `.vscode-server` + `.kimi-code` ~5.7GB มี credentials/oauth token อยู่ด้วย) ลบทิ้งหมด, ทำ snapshot `pre-kimi-removal-20260721` ไว้ก่อนแก้ (storage `local-lvm` รองรับ `pct snapshot`)
- Audit MCP tools (`src/mcp/tools/*.ts`, 2,276 บรรทัด) เทียบ logic กับ REST route validation ทีละไฟล์ — พบ 4 จุดที่ MCP อนุมัติ/ยืนยันเอกสารได้โดย **ข้าม approval gate ของ REST ทั้งหมด**: `approve_purchase_request`, `reject_purchase_request`, `update_po_status(APPROVED)` (ไม่เช็ค `user_approval_permissions`/`approval_settings`/วงเงินอนุมัติเลย) และ `update_sales_order_status(CONFIRMED)` (ยืนยัน+ตัดสต็อกทันทีโดยข้าม flow `PENDING_APPROVAL` ทั้งหมด — จุดร้ายแรงสุดเพราะเป็น business flow หลักที่เคย E2E test ไว้)
- แก้โดยเพิ่ม `checkApprovalPermission` / `checkCanApprove` ใน `mcp/tools/shared.ts` เลียนแบบ logic REST เป๊ะ (auto-approve threshold → `user_approval_permissions.can_approve`/`approval_limit`), ผูก role ของผู้ใช้จาก MCP API key เข้ากับทุก tool ที่แก้ (`registerTools` ใน `tools.ts` resolve role จาก `users` table, master key = role `MASTER`) — build ผ่าน, restart แล้ว, ทดสอบ end-to-end จริงผ่าน MCP session (init handshake + tool call) สำเร็จ
- ตรวจไฟล์ที่เหลือ (stock.ts, production.ts, bom.ts, finance.ts, search.ts, summary.ts) ครบ — ไม่มี divergence เพิ่มเติม เพราะ REST เองก็ไม่มี role-gate ให้ MCP ข้าม (record_stock_movement, create_work_order ฯลฯ) หรือเป็น read-only ล้วน (finance.ts, search.ts, summary.ts)

**พบระหว่างทาง (ยังไม่แก้) — ความเสี่ยง shared process / event loop:**

*ปัญหา:* `crm-backend` เป็น Node.js **single-thread** รันด้วย pm2 mode `fork` instance เดียว ต่อกับ **better-sqlite3** ซึ่งเป็น driver แบบ **synchronous** (ทุกครั้งที่เรียก `db.prepare().get()/.all()/.run()` เธรดหลักจะหยุดรอจนกว่า query จะเสร็จ ไม่ยอมสลับไปทำ request อื่นระหว่างนั้น) ทั้ง REST API ที่ลูกค้า/พนักงานใช้งานจริง **และ** MCP tool calls ที่ AI เรียก วิ่งอยู่บนโปรเซสและเธรดเดียวกันทั้งหมด ไม่มีการแยกทรัพยากรเลย

*จุดประสงค์ที่บันทึกไว้:* กันลืมว่านี่คือ known technical debt ที่ตัดสินใจ **ยอมรับความเสี่ยงไว้แบบตั้งใจ** (ไม่ใช่ bug ที่มองข้าม) — บันทึกเหตุผลไว้ให้คนอื่น/อนาคตอ่านว่าทำไมถึงไม่รีบแก้ตอนนี้ และมีเกณฑ์ชัดว่าต้องกลับมาดูเมื่อไหร่

*ยิ่งใช้งานยิ่งเป็นแบบไหน (growth trajectory):*
- **ตอนนี้** (scale เล็ก, query เร็วหลัก ms) → แทบไม่รู้สึกผลกระทบ
- **ข้อมูลสะสมเยอะขึ้น** (PR/PO/SO/stock_movements หลักหมื่น-แสนแถว) → query ที่เคย <10ms ค่อยๆ ยืดเป็นหลักร้อย ms ถึงระดับวินาที โดยไม่มี error ใดเตือนล่วงหน้า (เสื่อมแบบ silent)
- **มี AI conversation พร้อมกันหลายวง/หลาย tenant** → โอกาสที่ query หนักจากฝั่ง AI (เช่น `get_financial_summary(period="ytd")`, `explode_bom` หลายชั้น, `confirm_goods_receipt` ที่มีหลายรายการ) ชนจังหวะกับลูกค้าจริงกำลังใช้งานสูงขึ้นเรื่อยๆ
- **อาการที่จะเห็น:** เว็บ "ค้าง" เป็นพักๆ แบบสุ่ม ไม่มี error log ชัดเจน (ไม่ crash แค่รอคิวอยู่) — debug ยากเพราะดูเผินๆ เหมือนเน็ตช้า/เซิร์ฟเวอร์แรงไม่พอ ทั้งที่ต้นตอคือ 1 synchronous query บล็อกทุกอย่างพร้อมกัน

*แนวทางแก้ไข (เรียงจากง่าย → ใหญ่):*
1. **จำกัดขนาดงานที่ AI เรียกได้** — เพิ่ม LIMIT ให้เข้มกว่าเดิม, ตัด JOIN ที่ไม่จำเป็นใน tools ที่ AI ใช้บ่อย (`get_financial_summary`, `explode_bom`) — ต้นทุนต่ำสุด ทำได้ทันที แต่บรรเทาไม่หมด
2. **แยก MCP ออกจาก process หลัก** — รัน MCP server เป็น pm2 process แยก (คนละ Node process บนเครื่องเดียวกันได้) เปิด SQLite connection คนละตัวแบบ read-only กัน query จาก AI บล็อกเธรดที่ REST API ใช้ (ต้องดูแลให้ write ทั้งหมดผ่าน process หลักเท่านั้น กัน DB lock conflict)
3. **แยกไป LXC ต่างหาก + read replica** — ตามแผนที่เคยคุยกันไว้ก่อนหน้า (LXC แยกรัน AI + sync DB เป็นรอบๆ) แยก compute/DB โหลดออกจาก production เต็มรูปแบบ ไม่กระทบกันเลยแม้ query หนักแค่ไหน แลกกับ data staleness ตามรอบ sync (เหมาะกับ read-only queries; ส่วนที่ต้อง approve/write ยังต้องยิงกลับ REST API จริงเสมอ)
4. **เปลี่ยน DB engine เป็นแบบ async + connection pool** (เช่น Postgres แบบที่ Kanban ใช้อยู่แล้วบน LXC 103) — แก้ที่รากที่สุด แต่เป็น migration ใหญ่ที่สุด กระทบทั้งระบบ ควรทำเป็นโปรเจกต์แยกต่างหาก ไม่ใช่ patch เล็กๆ

*เกณฑ์ตัดสินใจกลับมาแก้จริงจัง:* เริ่มมี complaint ว่าเว็บค้างเป็นพักๆ โดยไม่มี error ชัดเจน, หรือจำนวน concurrent AI session เพิ่มขึ้นจนเห็น query time ใน log ยาวขึ้นชัดเจน

**อัปเดตเพิ่ม:** ตรวจ `sales.routes.ts` endpoint-by-endpoint เทียบกับ `routes/sales/*` แล้ว — migrate ครบ 47/48 (จุดเดียวที่ path เปลี่ยนคือ `from-template` แต่ไม่มีใครเรียกทั้งเก่า/ใหม่อยู่แล้ว) เช็คแล้วว่า unit conversion engine (`services/unitConversion.service.ts` + ตาราง `unit_conversions` 39 กฎ + `sealed_qty` auto-unpack) ไม่ได้อยู่ในไฟล์นี้ ไม่กระทบ และ `deductStockForSO` เวอร์ชันใหม่ใน `shared.ts` ดีกว่าเดิม (ห่อ transaction + throw เมื่อสต็อกไม่พอ แทน silent clamp) — **ลบ `backend/src/routes/sales.routes.ts` แล้ว** ยืนยัน `tsc --noEmit` ผ่านสะอาด

---

## 📅 Session Log — 6 กันยายน 2026 (KDS เสียงไม่หยุด + purge dead code)

**สิ่งที่ทำ:**
- แก้บั๊ก KDS เสียงแจ้งเตือนไม่ยอมหยุด (`frontend/src/pages/KDS.tsx`) — 2 ต้นเหตุ:
  1. `handleStatus` สั่ง `lastCount.current -= 1` ทั้งที่ `fetchTickets` เป็นคนเขียนค่านี้อยู่แล้วทุกรอบ พอ poll (ทุก 3 วิ) วิ่งมาถึงระหว่าง `await updateTicketStatus` ค่าจะถูกลดสองรอบ → ต่ำกว่าจำนวน ticket จริง → poll ถัดไปตีความว่า มีออร์เดอร์ใหม่ แล้วเล่นเสียงซ้ำ ยิ่งกดเร็วยิ่งเพี้ยนสะสมจนดังไม่หยุด ลบบรรทัดนั้นทิ้ง ให้ poll เป็นเจ้าของค่าคนเดียว
  2. `stopNotificationSound()` ถูกเรียกเฉพาะในปุ่ม รับงาน/เสร็จแล้ว ส่วน div ที่ครอบทั้งหน้าเรียก `unlockAudio` ซึ่งไม่หยุดเสียง → กดที่การ์ดหรือรายการอาหารเสียงไม่หยุด แก้เป็น `handleUserTap` ที่ stop + unlock
- ลบ dead code: `backend/src/db/sqlite-multitenant.ts` (เปิด `dev.db` ตัวเดียวกันแล้วสั่ง `CREATE TABLE tenants` ตอน import — ไม่มีไฟล์ไหน import มันเลย เป็นระเบิดเวลาที่ถ้าเผลอ import จะสร้าง 20+ ตารางลง production DB ทันที), `backend/public/` (11 ไฟล์ 5.4MB build เก่า ไม่มี `express.static` ชี้มา — ที่เสิร์ฟจริงคือ `frontend/dist` กับ `/uploads`), `backend/prisma/dev.db` (0 bytes)
- ลบไฟล์ `.bak` ทั้งหมด **136 ไฟล์** — 26 ตัว track อยู่ใน git (public repo) ลบด้วย `git rm`, อีก 110 ตัว untracked ลบด้วย `find -delete` รวมที่หายจาก git 15,522 บรรทัด
- อุดรูรั่ว `.gitignore` — เดิมมี `*.bak`, `*.bak.*`, `*.bak-*` แต่ **ไม่ครอบ `.bak2/.bak3/.bak4`** ซึ่งเป็นรูปแบบที่ session log 20 ก.ค. บันทึกว่าใช้เอง → 9 ไฟล์หลุดขึ้น git ทางนี้ (อีก 17 ตัว commit ไปก่อนกฎถูกเพิ่ม ซึ่ง gitignore ไม่มีผลย้อนหลัง) เพิ่ม `*.bak[0-9]*`

**ตรวจแล้วปลอดภัย:**
- `.env` และ `.env.bak.*` **ไม่เคย** ถูก track และไม่เคยอยู่ใน git history
- สแกน 26 ไฟล์ .bak ที่เคยหลุดขึ้น public repo หา hardcoded credential — ไม่พบ (`mcp/server.ts.bak` ใช้ parameterized SQL `WHERE mcp_api_key = ?` ทั้งหมด)

**สำรวจโค้ดทั้ง repo (2026-09-06):**
- ขนาดรวม **232 ไฟล์ / 98,158 บรรทัด** (.ts + .tsx ใน backend/src + frontend/src)
- **28 ไฟล์เกิน 800 บรรทัด** ซึ่งเป็นเพดานที่ตั้งไว้เอง — หนักสุด `Stock.tsx` 5,836, `Purchase.tsx` 4,307, `Sales.tsx` 4,190, `CRM.tsx` 2,286, `Cashier.tsx` 2,125, `Marketing.tsx` 2,040 ฝั่ง backend หนักสุด `purchase.routes.ts` 1,973, `db/schema.ts` 1,922, `db/migrations.ts` 1,775 — นี่คือสาเหตุที่งาน multi-currency UI ค้าง (ต้อง refactor ไฟล์ 4,000+ บรรทัดก่อน)
- **ไม่มี orphan route** — ตรวจทุกไฟล์ใน `routes/` เทียบกับ `index.ts` แล้ว ทั้ง 13 ไฟล์ใน `routes/sales/` mount ผ่าน `sales/index.ts` → `/api/sales` ครบ (อย่าเห็นว่าไม่มีชื่อใน index.ts แล้วสรุปว่าตาย — เคยเกือบพลาดตรงนี้)
- **console.log ค้าง 134 จุดใน 13 ไฟล์** — 104 จุดอยู่ใน `db/migrations.ts` (เป็น progress log ของ migration ตั้งใจไว้ ไม่ต้องแก้) เหลือ ~30 จุดกระจายใน `import.routes.ts` (8), `ImportModal.tsx` (4), `index.ts` (3), `backup.scheduler.ts` (3) ที่ควรเก็บกวาด

**⚠️ พบปัญหา repo ที่ต้องแก้ด้วยมือบน GitHub:**
- **default branch ของ repo ยังเป็น `claude/crm-bom-stock-webapp-AZaaM`** (branch เก่าที่ AI สร้างไว้) ทั้งที่ trunk จริงคือ `ui` — repo นี้เป็น **public** ใครเปิด github.com/Miuu-hz/CRM-BOM-Stock จะเห็นโค้ดเก่าเป็นหน้าแรก ไม่ใช่ของที่ใช้จริง
- `main` ค้างอยู่ที่ 2026-05-12 (`58c5949`) ขณะที่ `ui` = 2026-09-06 (`aba3124`) — ห่างกัน ~4 เดือน
- แก้ได้ที่ GitHub → Settings → Branches → Default branch → เปลี่ยนเป็น `ui` แล้วลบ branch `claude/*` ทิ้ง (ทำผ่าน git ไม่ได้ ต้องกดบนเว็บหรือ `gh repo edit --default-branch ui`)

**พบระหว่างทาง (ยังไม่แก้):**
- ไฟล์ที่ลบไป **ยังอยู่ใน git history** ของ public repo — `.git` = 5.9MB ตัดสินใจไม่ rewrite history เพราะไม่คุ้มกับการที่ commit hash เปลี่ยนทั้ง repo
- เหลือซาก 3 ไฟล์ที่ pattern รอบนี้ไม่ครอบ: `translation.json.pre-prdelete` (×2), `translation.json.CLOBBERED-en-20260808` — gitignore ครอบอยู่แล้ว ไม่หลุด git แค่รก
- `/root/.claude/file-history/` ใน LXC 100 โต 6.6MB — backup ของ Claude Code เอง คนละระบบกับ `.bak` ลบได้
- DB ยืนยันเป็นไฟล์เดียว `backend/dev.db` (3.6MB, 119 ตาราง) + `-wal`/`-shm` ไม่มี `ATTACH` ที่ไหนในโค้ด

---

## 📅 Session Log — 8 กันยายน 2026 (ตรวจก่อนนำเข้าข้อมูล หจก.เอฟแอนด์บี เบดดิ้ง)

**บริบท:** เตรียม import master data สินค้า/ลูกค้าจาก Excel (export จากโปรแกรมบัญชีเดิม) เข้า tenant โรงงานหมอน ตรวจสภาพปลายทาง + ตัวนำเข้าก่อนลงมือ ยังไม่ได้ import จริง

**ยืนยัน tenant ปลายทาง:**
- โรงงานหมอนตัวจริง = `tenant_msqy2xbn` (`หจก.เอฟแอนด์บี เบดดิ้ง`, tax 0463565001158) admin `bbpillowth@gmail.com` — **ว่างเปล่า** (stock_items / materials / customers / suppliers / boms / unit_conversions = 0 ทั้งหมด) แผน enterprise ACTIVE ถึง 2027-08-13
- `tenant_bb_pillow` = **Kids House Cafe** (ร้านอาหาร) มีข้อมูลจริง 474 stock_items / 228 boms / 5 users — ชื่อ tenant_id หลอก **ห้ามยัดข้อมูลหมอนลงตัวนี้**

**🔴 บั๊ก/ข้อจำกัดของ `POST /import/stock` (`backend/src/routes/import.routes.ts`) — ยังไม่แก้:**
1. `quantity: z.coerce.number().int().min(0)` — `.int()` ทำให้ทศนิยม **ตกทั้งแถว** (ไม่ปัดให้ Zod ตีตกเลย) ผ้าที่นับเป็นเมตร/ใยที่นับเป็น กก. มีทศนิยมเป็นปกติ → พังทั้งชุด และ `.min(0)` ตีตกยอดติดลบ (ไฟล์ต้นทางมี 263 ตัว)
2. **ราคาหายเงียบ** — `ImportModal.tsx` map `ราคาขาย → sale_price`, `ราคาซื้อ → purchase_price` ส่งขึ้นมาจริง แต่ `StockRowSchema` เป็น Zod strip mode ตัดทิ้ง และ `INSERT INTO stock_items` ไม่มีคอลัมน์ราคาเลย → ต้นทุน/ราคาขาย = 0 ทุกตัวหลัง import โดยไม่มี error เตือน
3. **ไม่ตั้งหน่วยซื้อ/หน่วยฐาน** — INSERT ไม่มี `base_unit` / `purchase_unit` / `sale_unit` → ระบบแปลงหน่วย (ม้วน→เมตร, ก้อน→กก., กก.→ใบ) ใช้ไม่ได้หลัง import ต้องตามใส่ทีหลังเอง
4. **SKU ซ้ำถูกเปลี่ยนชื่อเป็นรหัสมั่วแล้วแทรกเพิ่ม ไม่ใช่ skip** — `if (!sku || existingSkus.has(sku)) sku = generateSKU(category, existingCount + i)` ทำให้รัน import ซ้ำรอบสอง = ได้สินค้าซ้ำทั้งชุดพร้อม SKU ขยะแบบ `FA-0001` (โอกาสชน generateSKU ต่ำ เลยไม่โดน guard บรรทัดถัดไป) **ไม่มีโหมด upsert/แก้ทับ** import ได้ทางเดียวคือ insert
5. ไม่มี role gate — `router.use(authenticate)` อย่างเดียว USER ธรรมดา import ได้

**🟡 สภาพ tenant `tenant_msqy2xbn` ที่ต้องเก็บกวาดก่อนใช้จริง:**
- **ผังบัญชีมีแค่ 2 บัญชี** (`1101 เงินสด`, `4200 รายได้คืน` ทั้งคู่ `is_system=1` สร้าง 2026-08-15) เทียบกับ tenant อื่นที่มี 90-92 บัญชี → เกิดจาก auto-create ตอน POS_CANCEL ไม่ใช่การ seed ผังบัญชีจริง งบการเงิน/GL ใช้ไม่ได้จนกว่าจะ seed
- journal ค้าง 1 ใบ `JV-2026-000001` `reference_type=POS_CANCEL` **total_debit = total_credit = 0** (ซากบั๊ก POS cancel เดิม) + `pos_running_bills` ค้าง 2 บิลทดสอบ + เลขรัน `POS_BILL` = 150826
- `allow_negative_stock = 0` — ถ้า import ยอดยกมาเป็น 0 แล้วเปิดขาย/สั่งผลิต ระบบจะบล็อกทันที ต้องตัดสินใจก่อนว่าจะนับสต็อกจริงหรือเปิด flag ชั่วคราว

**📌 โครงสร้างที่ต้องจำ (ชื่อคอลัมน์หลอก):**
- `bom_items.material_id` → ชี้ **`stock_items.id`** ไม่ใช่ `materials.id` (ตรวจจริง 829/829 แถว resolve เข้า stock_items, เข้า materials 0 แถว)
- `boms.product_id` → ชี้ `stock_items.id` (233/233)
- แปลว่า **วัตถุดิบและสินค้าสำเร็จอยู่ใน `stock_items` ตารางเดียว** ตาราง `materials` ไม่ได้ถูกใช้ทำ BOM เลย ตัวแยกคือคอลัมน์ `category`
- `normalizeUnit()` แปลงได้: `เมตร→m` `ม้วน→roll` `กก./กิโลกรัม→kg` `หลา→yard` `ชิ้น→pcs` `ชุด→set` `โหล→dozen` `ถุง→bag` / **ไม่มีใน map** (เก็บเป็นไทยตามเดิม): `ใบ` `ก้อน` `ผืน` `อัน` `เส้น` — ไม่ถึงกับพัง แต่ conversion มาตรฐานไม่ทำงาน ต้องตั้ง `unit_conversions` รายตัวอยู่ดี (1 ม้วนยาวไม่เท่ากันในแต่ละผ้า)

**ทางเลือกที่เสนอไว้ (ยังไม่ตัดสิน):** (A) เขียนสคริปต์ node ยัด `stock_items` ตรงเข้า DB ครั้งเดียวให้ครบทั้ง sku/หน่วย/ราคา + สร้าง `unit_conversions` เลย (backup ก่อน) หรือ (B) แก้ `import.routes.ts` ทั้ง 5 ข้อข้างบนแล้ว build+restart ค่อยใช้หน้าเว็บ

### ✅ แก้แล้วในวันเดียวกัน — ผังบัญชี auto-gen + ยุบ getOrCreateAccount 6 สำเนา

**ต้นเหตุ:** `DEFAULT_CHART_OF_ACCOUNTS` (90 รายการ) ถูกขังอยู่ใน `routes/accounts.routes.ts` เรียกได้ทางเดียวคือปุ่มใน UI → `provisionTenant()` ไม่เคย seed ผังบัญชี → tenant ใหม่เกิดมามี 0 บัญชี → ธุรกรรมแรกไป `getOrCreateAccount()` ปั้นบัญชีกำพร้าทิ้งไว้ (level 0 ไม่มี parent) → `POST /accounts/init` ตีกลับ 400 `"already initialized"` เพราะ `existingCount > 0` **และ**หน้า `ChartOfAccounts.tsx` แสดงปุ่ม "สร้างผังบัญชี" เฉพาะตอน `accounts.length === 0` (บรรทัด 528) → ล็อก 2 ชั้น ไม่มีทางออกผ่าน UI เลย

**สิ่งที่ทำ:**
- **ไฟล์ใหม่ `backend/src/config/chartOfAccounts.ts`** — ย้ายผังบัญชีออกจาก route มาเป็น config กลาง + เพิ่ม 3 รหัสที่โค้ดเรียกใช้จริงแต่ไม่เคยอยู่ในผัง (`1180` ลูกหนี้การค้า-POS, `5901` เงินขาด/เงินเกิน, `5902` ค่าใช้จ่ายปรับปรุงสต็อก) → **93 รายการ** พร้อมฟังก์ชัน `seedChartOfAccounts(tenantId)` แบบ **idempotent** (ใส่เฉพาะรหัสที่ขาด ไม่แตะชื่อที่ผู้ใช้แก้เอง ไม่แตะบัญชีย่อยธนาคาร `1102-NN`) และรอบสองซ่อม `parent_id`/`level` ให้บัญชีกำพร้าที่ถูกปั้นสดไว้ก่อน
- `provisioning.ts` เรียก `seedChartOfAccounts()` ต่อท้ายการสร้าง user → **tenant ใหม่ได้ผังครบตั้งแต่วินาทีแรก** (ต้นเหตุจริง)
- `POST /accounts/init` เลิกตีกลับ 400 → เรียก seeder ตรงๆ เติมเฉพาะที่ขาด กดซ้ำได้ปลอดภัย (โค้ด route จาก 455 → 295 บรรทัด)
- `backfillChartOfAccounts()` รันตอน server start ใน `index.ts` — **ไม่ใส่ใน `migrations.ts` เพราะ `db/sqlite.ts` เรียก `runMigrations(db)` ก่อนบรรทัด `export default db`** ถ้า import chartOfAccounts จากในนั้นจะได้ `db` เป็น `undefined` (วงกลม import) กับดักตัวนี้จำไว้
- **ยุบ `getOrCreateAccount` ที่ก๊อปกัน 6 สำเนาเหลือ 1** (`services/accounting.service.ts`) — ลบสำเนาใน `purchase.routes.ts`, `stock.routes.ts`, `sales/shared.ts` (ตัวหลัง re-export ต่อให้ `sales/index.ts` + `sales/creditNotes.ts` ไม่ต้องแก้) และ closure `getAccountId()` ใน `pos-clearing.routes.ts`
- **บั๊กที่เจอตอนยุบ:** closure ใน `pos-clearing.routes.ts` ตั้ง `normal_balance = type === 'ASSET' ? 'DEBIT' : 'CREDIT'` → บัญชี `5901` ซึ่งเป็น EXPENSE ได้ normal_balance เป็น **CREDIT** (ผิดด้าน) และ category หยาบกว่าผังจริง
- **บั๊กชื่อบัญชีชนกัน:** `5901` ถูกเรียกด้วย 2 ชื่อ — `'เงินขาด/เงินเกิน'` (pos-clearing, pos.routes) กับ `'ค่าใช้จ่ายปรับปรุงสต็อก'` (stock.routes) ใครมาก่อนได้ชื่อนั้น แยกให้เป็น `5901` = เงินขาด/เงินเกิน, `5902` = ปรับปรุงสต็อก แล้วให้ทุก call site อ่านชื่อจาก `ACC_META` ที่เดียว (เพิ่ม `ACC.POS_CLEARING/OTHER_REVENUE/CASH_OVER_SHORT/STOCK_ADJUSTMENT`)
- เทสต์ใหม่ `config/chartOfAccounts.test.ts` 5 เคส — รวมเคสกันบัญชีกำพร้าเกิดใหม่: **ทุกรหัสใน `ACC`/`ACC_META` ต้องมีอยู่ในผัง** ถ้าใครเพิ่มรหัสใหม่แล้วลืมใส่ในผัง เทสต์จะแดงทันที

**ผลหลัง deploy (`npm run build` + `pm2 restart crm-backend`, ทั้ง `tsc --noEmit` และ vitest 33/33 ผ่าน):**
```
tenant_msqy2xbn    2 → 94 บัญชี   (seeded 92)
tenant_bb_pillow  92 → 95 บัญชี   (seeded 3)
Testshop          90 → 93 บัญชี   (seeded 3)
บัญชี level 0 ที่มี parent (รูปแบบผิด): 0 แถวทั้ง DB
```
backup: `backend/dev.db.bak-coa-20260908` (ผ่าน SQLite backup API ไม่ใช่ cp) + ซอร์สเดิมที่ `/tmp/coa-backup-20260908/`

**ยังเหลือ (ตั้งใจไม่แก้):**
- บัญชีกำพร้า `4100 รายได้จากการขาย` / `4200 รายได้คืน` ยังอยู่ — โค้ดที่ปั้นมันถูกลบไปแล้วตอน POS overhaul 26 ส.ค. แต่ตัวบัญชีมี journal_lines อ้างถึงจริง (bb_pillow 1 + 24 บรรทัด, msqy2xbn 1 บรรทัด) **ห้ามลบ** ถ้าจะเก็บกวาดต้อง reclass เข้า `4101`/`4302` แล้วย้าย journal_lines ซึ่งเป็นการแก้ ledger ต้องคุยก่อน
- หน้า `ChartOfAccounts.tsx` ยังไม่มีปุ่ม "ซ่อม/เติมผังบัญชี" ในมุมมองปกติ (ปุ่มโผล่เฉพาะตอน 0 บัญชี) — ตอนนี้ backfill ตอน boot ครอบให้แล้วเลยไม่จำเป็น ถ้าอยากได้ปุ่มค่อยเพิ่ม

---

## 📅 Session Log — 9-10 กันยายน 2026 (นำเข้า master data หจก.เอฟแอนด์บี เบดดิ้ง สำเร็จ)

**นำเข้าจริงแล้ว 2026-09-10** เข้า `tenant_msqy2xbn` จาก `สรุปพร้อมนำเข้า-ERP.xlsx` (4 ชีต)
```
สินค้า      0 -> 1,024    finished 744 · wip 249+2 INACTIVE · raw 27 · SERVICE 2
กฎแปลงหน่วย  0 ->    62    กฎกลาง 2 + เฉพาะสินค้า 60
ลูกค้า      0 ->   381    (มีเลขภาษี 124)
ผู้ขาย      0 ->    51    (มีเลขภาษี 36)
FK เสียหาย: 78 -> 78 (ไม่เพิ่ม, ของเดิมทั้งหมด)
```
สคริปต์: `/tmp/build_import_plan.py` (อ่าน Excel → `import_plan.json`) + `/tmp/apply_import.js` (เขียน DB, transaction เดียว, มีด่านกัน tenant ไม่ว่าง)
backup: `dev.db.bak-preimport-20260910` และ `dev.db.bak-import-20260910`

**กติกาข้อมูลที่เจ้าของยืนยัน (สำคัญกว่าตัวเลข):**
- **หน่วยซื้อ = หน่วยใหญ่ที่ยังไม่แกะ / หน่วยนับ = หน่วยย่อยหลังแกะ ถ้าสองอันไม่ตรงกัน = มีการแกะ = ต้องมีกฎแปลงเสมอ**
- ผ้า 1 ม้วน = **100 หลา** (= 91.44 เมตร) ต้นทุนในไฟล์คือ **ราคาต่อม้วน** → 1,700/ม้วน = 17 ฿/หลา = 18.59 ฿/เมตร
- **`ใบ` กับ `ชิ้น` คืออันเดียวกัน** ยุบเป็น `pcs` หมด (เดิมแยกเป็น 240/75 รายการ)
- `หลัง/ตัว/อัน/ก้อน/มัด` ยุบเป็น `ชิ้น` ด้วย — ยุบที่ `normalizeUnit()` ไม่ใช่ตอน import ใครพิมพ์ที่ไหนก็แปลงให้
- **wip = "วัตถุดิบแต่ขายได้"** (ผ้า/ใย/ถุง) ไม่ใช่ความหมาย WIP มาตรฐาน — **ปลอกหมอน = finished** ไม่ใช่ wip
- ใย POLY ซื้อเป็น **กก.** ไม่ใช่ ก้อน (ตามบิลจริง) → ซื้อ=นับ ไม่ต้องแปลง
- สต็อกยกมาในไฟล์ **ใช้ไม่ได้** ทุกตัว (263 ตัวติดลบ) → import เป็น 0 หมด รอนับจริง
- min_stock/max_stock = 0 ทั้งหมด (ยังไม่มีข้อมูลจุดสั่งซื้อ)

**⚠️ กับดักต้นทุนที่เกือบพลาด:** คอลัมน์ "ต้นทุน/หน่วย" ในไฟล์ **ปนกัน 2 ความหมาย** บางแถวเป็นราคาต่อหน่วยนับ (ถูก) บางแถวเป็นราคาต่อหน่วยซื้อ (ต้องหาร) ถ้าหารทั้งกระดานจะได้กระสอบใบละ 2 สตางค์ ถ้าไม่หารเลยจะได้ผ้าเมตรละ 1,700 บาท **วิธีแยก: เอาสต็อกยกมา × ต้นทุน เทียบกับมูลค่ายกมาในไฟล์** ถ้าตรง = ราคาต่อหน่วยนับอยู่แล้ว (B-001/B-003/BAG-64*50cm/D-001 ทั้ง 4 ตัวเข้าเกณฑ์นี้ ไม่หาร) สุดท้ายหาร 78 ไม่หาร 19
- BAG-011001 / BAG-20*30 ราคาลงเป็น "ต่อลูก" (2,100-2,200) ทั้งที่เพื่อนในตระกูลเป็น "ต่อโล" (55-105) ต่างกัน 30 เท่าพอดี = 1 ลูก 30 โล → เปลี่ยนหน่วยซื้อเป็นลูกแล้วหาร 30 เพิ่ม

**กฎแปลงหน่วย 2 ชั้น (แนวคิดเจ้าของ: สินค้าพิเศษ = พิเศษใหญ่→พิเศษเล็ก / ปกติ = สากล→พิเศษเล็ก):**
- engine มี **3 ชั้นเท่านั้น**: `material_id = ?` (priority 0) > `material_id IS NULL` (1) > `STANDARD_CONVERSIONS` (2) — **ไม่มีชั้น "หมวด/category"** และ `is_global` ไม่ใช่ชั้น มันคือธงล็อกไม่ให้แก้
- ใช้ชั้น tenant เป็นชั้นหมวดแทน → **262 กฎ เหลือ 62** (ลด 76%)
  - กฎกลาง: `roll→yard = 100` (ครอบผ้า 183 ตัว), `piece→kg = 30` (ครอบถุง 19 ตัว)
  - กฎเฉพาะสินค้า 60: `kg→pcs` 25 กฎ, `bag→sheet` 17 กฎ, อื่นๆ 18
- **ห้ามยกกฎที่ "เลขบังเอิญตรงกัน"** เช่น `kg→pcs=36` ซ้ำ 4 ตัว แต่ถุงขนาดอื่นใช้ 14/30/31 — ยกขึ้นกฎกลางจะทับผิดตัวทันที
- ทดสอบกับ engine จริงผ่าน 5/5 รวมเคสยาก: Elastic-001 มีกฎเฉพาะ `roll→m=40` **ชนะ**กฎกลาง (1 hop < 2 hops), BAG-40*60 มี `piece→kg=25` **ชนะ**กฎกลาง 30

**โค้ดที่แก้รอบนี้ (deploy แล้วทั้งหมด, tsc ผ่าน, vitest 37/37):**
- `unitConversion.service.ts` — เพิ่มหน่วยไทย `bai/phuen/rob/pip` (ภายหลัง `bai` ถูกยุบเป็น pcs) + ดักคำสะกดผิด `โล→kg`, `ชื้น→pcs`, `ปี๊บ/ปี๊ป→pip`, `มวน→roll` + ยุบ `หลัง/ตัว/อัน/ก้อน/มัด→pcs`
  - **สำคัญ: รายการหน่วยที่ผู้ใช้เลือกได้มาจาก `UNIT_LABELS` + `UNIT_CATEGORIES` + `STANDARD_CONVERSIONS` เท่านั้น** หน่วยที่ไม่อยู่ในนั้นเลือกไม่ได้เลยแม้ `normalizeUnit()` จะรับ
- **ไฟล์ใหม่ `services/stockItem.service.ts`** — `isServiceItem()` กันค่าขนส่ง/ค่าแพ็คไม่ให้ถูกตัดสต็อก ใส่ guard 4 จุด: `deductStockForSO`, `restoreStockForSO` (`routes/sales/shared.ts`), `routes/sales/deliveryOrders.ts`, และ**สำเนาใน `mcp/tools/sales.ts`** — ถ้าไม่กัน ยืนยันบิลจะฟ้อง `Insufficient stock` เพราะ tenant นี้ `allow_negative_stock = 0`
  - เทสต์ `routes/sales/serviceItem.test.ts` 4 เคส รวมเคสกัน guard เผลอปิดการเช็คสต็อกทั้งระบบ
  - ERP **มีช่องส่วนลดอยู่แล้ว** (`discount_amount` หัวบิล + `discount_percent` รายบรรทัด) แต่**ไม่มีช่องค่าขนส่ง/ค่าแพ็ค** เลยต้องทำเป็นสินค้าบริการ
- **`customers.tax_id`** — เดิมมีแค่ใน `suppliers` เพิ่มครบวง: `db/schema.ts` + `db/migrations.ts` (ALTER) + `customer.routes.ts` (POST/PUT รับ `taxId`, GET ใช้ `SELECT c.*` อยู่แล้ว) + `pages/CRM.tsx` (interface/state/ช่องกรอก 13 หลัก) + i18n ไทย/อังกฤษ
  - **ยังเหลือ:** `customers.address` มีคอลัมน์และ import เขียนลงแล้ว แต่ `customer.routes.ts` ไม่รับ/ไม่แก้ และ CRM UI ไม่มีช่อง — ที่อยู่ลูกค้า 351 รายจึงแก้ผ่านเว็บไม่ได้

**🔴 เจอบั๊กใหญ่ระหว่างทาง: test suite วิ่งใส่ `dev.db` ตัวจริงมาตลอด**
- `db/connection.ts` รองรับ `SQLITE_DB_PATH` อยู่แล้ว (คอมเมนต์บอกชัดว่ามีไว้ให้ test) แต่**ไม่เคยมีใครตั้ง** — `vitest.setup.ts` จึง `ALTER TABLE` ลง production ทุกครั้งที่รันเทสต์ ตามที่คอมเมนต์ในไฟล์นั้นเตือนไว้เอง
- เทสต์ที่ `INSERT company_settings`/`users` ไม่มี cleanup → ทิ้งขยะค้าง **4 tenant + 32 users + stock_items/pos bills** และ backfill ผังบัญชีไปหว่านให้อีก 372 แถว
- **แก้:** ตั้ง `env: { SQLITE_DB_PATH: .../test.db }` ใน `vitest.config.ts` — **ต้องตั้งที่ `test.env` เท่านั้น** ตั้งใน `vitest.setup.ts` ไม่ทันเพราะ import ถูก hoist ทำให้ `connection.ts` อ่าน path ไปก่อน statement แรกจะรัน ยืนยันด้วย md5: รันเทสต์ 37 ตัวแล้ว `dev.db` ไม่ถูกแตะ
- เก็บกวาดขยะ 432 แถวแล้ว (`/tmp/clean_junk.js` มีโหมด dry-run + guard กัน tenant จริง) และเพิ่มเงื่อนไข `WHERE EXISTS (users)` ใน `backfillChartOfAccounts()` กันหว่านให้ tenant ไร้ผู้ใช้

**ยังค้าง (ไม่บล็อกการใช้งาน):**
- 8 สินค้ายังไม่มีอัตราแปลง: `B-002`*, `BAG-20*60`, `BAG-30*40`, `BAG-001003` (กก.→ชิ้น), `BAG-001004`* (ลูก→ชิ้น), `P00237` คิ้วฟูก, `P00249` พลาสติกห่อฟูก (ม้วน→เมตร) — *= ตั้ง INACTIVE แล้ว ระบบจะเตือนตอนซื้อ ไม่พังเงียบ
- `FIB-001006-2300` มีหมายเหตุ "ทำที่นอนฟูกได้ 5 ตัว" = ข้อมูลผลผลิต (BOM) ไม่ใช่กฎแปลงหน่วย
- ราคาขายว่าง 753/1024 · ต้นทุนว่าง 927/1024 — เติมทีหลังตอนซื้อ-ขายจริง
- หมวดย่อย 12 หมวดของ Excel (ผ้า/หมอน/ที่นอน/ปลอก...) ไม่ได้เก็บเป็นฟิลด์ เพราะ `category` ถูกใช้เป็นตัวกรอง raw/wip/finished ในหน้าสต็อก — อ่านจาก prefix ของ SKU แทน (ดู skill `bedding-sku`)
- `SERVICE` ตกกลุ่ม `material` ("วัสดุ/อื่นๆ") ในหน้าสต็อก เพราะ `getCategoryGroup()` ไม่รู้จัก — ยังไม่ได้เพิ่มปุ่มกรอง "บริการ"

### ✅ 2026-09-11 — Template เอกสารกลาง + แท็บตั้งค่าเอกสาร + ล้าง/sync รายงานภาษีขายใหม่

**1. รวมตัวพิมพ์เอกสาร 2 ชุดเป็น template กลางตัวเดียว**
```
ลบ  utils/salesPrint.ts (695) + utils/purchasePrint.ts (797) = 1,492 บรรทัด
    17 ฟังก์ชัน template เขียนมือแยกกัน + CSS ก๊อป 2 ชุด
ได้ utils/printBill.ts (185) + components/bill/UnifiedBillTemplate (props ล้วน)
    + billStyles.ts (CSS แหล่งเดียว) · BillType 6 -> 13 ชนิด
```
- `printBill(type, data, format)` ใช้ลายเซ็นเดิม → หน้า Sales/Purchase/Cashier แก้แค่ import (8 จุด)
- เรนเดอร์ด้วย `renderToStaticMarkup` แล้วเปิดหน้าต่างพิมพ์ — **UnifiedBillTemplate ต้องเป็น props ล้วน** ห้ามมี `useBill()`/`useEffect`/`window` ตอน render ไม่งั้นพิมพ์ออกมาหน้าขาว (effect ไม่รันใน static render)
- CSS ฝังมากับ output เอง (`<style>{BILL_CSS}</style>`) ตัวห่อจึงไม่ต้องรู้จัก CSS
- React escape ให้เองแล้ว → ตัด `deepEscape()` ของเดิมทิ้งได้

**2. ปิดช่องว่างเลขภาษีที่เจอจาก audit**
- `customers.tax_id` เพิ่มครบวง (schema + migration + POST/PUT + ฟอร์ม CRM + i18n) — เดิมมีแค่ `suppliers`
- `customers.address` ต่อสายให้แก้ผ่านเว็บได้ (คอลัมน์มีอยู่ แต่ API ไม่รับ/UI ไม่มีช่อง ที่อยู่ 351 รายเลยมองไม่เห็น)
- **endpoint รายละเอียด qt/so/inv ไม่เคย `SELECT c.tax_id, c.address` เลย** → เติมแล้วทั้ง 3 จุด (ของเดิม template อ้าง `customer_address` อยู่แต่ช่องว่างมาตลอด)
- `purchaseOrder.routes.ts` / `purchase.routes.ts` ไม่เคย `SELECT s.tax_id` ทั้งที่ `purchasePrint.ts:295,454` มีช่องแสดงรออยู่ → เติม 2 บรรทัด
- `vat_entries.party_tax_id` ฝั่งขาย hardcode `null` ทั้งใน `sales/invoices.ts` และ `pos-accounting.service.ts` (ฝั่งซื้อทำถูกมาตลอด) → ดึงจาก customer จริง
- `tax_transactions` VAT_OUTPUT ไม่มีคอลัมน์ `partner_id`/`partner_tax_id` ใน INSERT เลย → เติมทั้ง POS_BILL และ SALES_INVOICE

**3. แท็บ "ตั้งค่าเอกสาร/หน้ากระดาษ" ใน Settings**
- ตาราง `document_settings(tenant_id PK, settings_json, updated_at)` — เก็บ JSON ก้อนเดียว เพิ่ม field ใหม่ได้โดยไม่ต้อง migrate
- `GET/PUT /api/settings/documents` · PUT มี `requireRole('ADMIN','MASTER')` · zod validate · **merge รายคีย์** (ส่ง `defaultPaper.inv` อย่างเดียวต้องไม่ล้าง `qt`)
- `GET` คืน `branding.isFreePlan` จาก `tenant_subscriptions.plan_code` → แพ็กฟรีบังคับใช้โลโก้ Phopy (`/brand/phopy-mark.png`) เปลี่ยนเองไม่ได้
- `printBill` ดึงค่านี้มาใช้จริง (cache + `invalidateDocumentSettings()`)

**4. ล้าง VAT_OUTPUT แล้ว sync ใหม่** (ระบบยังไม่ขึ้นใช้จริง เจ้าของเลือกทางนี้แทนการ UPDATE ย้อนหลัง)
```
Testshop  VAT_OUTPUT  289 -> 332   ตรงกับใบแจ้งหนี้ต้นทาง 332 พอดี
bb_pillow VAT_INPUT     4 -> 5     ตรงกับ PI ต้นทาง 5 พอดี
```
- **289 ไม่ใช่ตัวเลขที่ถูก** — `syncTaxData()` เป็น lazy รันตอนเปิดหน้า `/tax/dashboard` หรือ `/tax/periods` เท่านั้น ใบที่ออกหลังจากนั้นยังไม่เคยเข้ารายงาน การ resync เลยปิดช่องว่าง 43 ใบไปด้วย
- `partner_tax_id` ยังเป็น 0 ในสอง tenant นั้นเพราะ **ลูกค้าไม่มีเลขภาษีเลย** (Testshop 0/12, bb_pillow 0/1 — ข้อมูลสร้างก่อนมีคอลัมน์) ไม่ใช่โค้ดพัง — หลักฐานว่ากลไกทำงานคือฝั่งซื้อ `VAT_INPUT 5 แถว มีเลขภาษี 3`
- `tenant_msqy2xbn` มีลูกค้าที่มีเลขภาษี 124/381 แต่ยังไม่ได้ออกบิล พอออกใบแรกเลขภาษีจะติดไปเอง
- backup: `dev.db.bak-vatresync-20260911`

**5. กับดักที่เจอระหว่างทาง**
- `formatCurrency(amount: number)` พังเมื่อข้อมูลไม่ครบ → เอกสารพิมพ์ออกมาหน้าขาว แก้ให้ตกไป `0.00`
- `BillType` เดิมขาด **INVOICE และ CREDIT_NOTE** ซึ่งเป็นใบที่กฎหมายบังคับเลขภาษีผู้ซื้อ — ถ้าสลับไปใช้ทั้งที่ยังขาดจะพิมพ์ใบกำกับภาษีไม่ได้เลย
- ใบเสนอราคาตั้ง `showBuyerTaxId: false` ไม่ตรงกับตัวอย่างที่เจ้าของอนุมัติ → เปิดให้ตรง
- **มีเซสชันอื่นแก้ repo เดียวกันขนานอยู่** (ฟีเจอร์แนบสลิปโอนเงิน: `PaymentAttachments.tsx`, `AuthImage.tsx`, `Purchase.tsx`, `JournalEntries.tsx`) — ตรวจ `git status` ก่อน build เสมอ อย่าเหมาว่าเป็นงานของ agent ตัวเอง

**skill ใหม่:** `~/.claude/skills/erp-data-import/SKILL.md` — playbook นำเข้าข้อมูลลูกค้า 8 เฟส + กับดักที่เจอจริง

---

## 📅 Session Log — 12 กันยายน 2026 (เปิดใช้ระบบอนุมัติจริง + ประวัติการเคลื่อนไหว)

### 0. งานแถมตอนต้นเซสชัน
- **kanban.phopy.net หน้าขาว** — ไม่ใช่ service ล่ม (`systemctl active`, `curl localhost:1337` = 200 ตลอด) แต่มีคน build วันที่ 6 ก.ย. แล้วอัปเดต `views/index.ejs` ให้ชี้ asset hash ใหม่ **แต่ลืม `cp -r client/dist/* server/public/`** → HTML 200 แต่ JS bundle 404 ส่วน LINE ยังทำงานเพราะมาจาก BFF (LXC 105) คนละตัว
- **Sidebar ERP** — ลบบล็อก "สถานะระบบ" ทิ้ง ย้ายเป็น badge ท้ายเมนูคลังสินค้า (`/stock/stats` → `lowStockCount`, pack-aware และไม่มีเพดาน ต่างจาก `/dashboard/low-stock` ที่ติด `.slice(0,8)`) + ยุบ `<span>` badge 3 ก้อนที่ copy กันเหลือ map เดียว
  - เจอบั๊ก: `/purchase-orders?status=PENDING` — **backend ไม่เคยอ่าน query param** คืน PO ทุกใบ (24) มาให้นับ ป้ายบอก "รอดำเนินการ" แต่รวม RECEIVED 15 + CANCELLED 2 ด้วย แก้โดยเปลี่ยนไปใช้ `/purchase-orders/stats` ที่มี `draftOrders`+`pendingOrders` อยู่แล้ว
- **สถานะสต็อกมีแต่ "Adequate"** — ไม่ใช่บั๊ก แต่ไม่มีช่วงเตือนล่วงหน้าจริง เพิ่มสถานะ `nearLow` (`available <= min_stock * 1.5`) + ปุ่มกรอง + แปลป้ายสถานะเป็นไทยทั้งชุด (เดิม hardcode อังกฤษทั้งที่หน้าอื่นเป็นไทย) → ของ 22 ตัวใน Testshop: ปกติ 14 → ปกติ 8 + **ใกล้หมด 6** ที่เมื่อก่อนเงียบสนิท

### 1. ระบบอนุมัติเคยตายสนิท — 3 บั๊กที่ทำให้ไม่มีใครได้ใช้
ตาราง `approval_settings` / `approval_requests` / `approval_logs` / `user_approval_permissions`
+ หน้า ApprovalInbox **มีมาตั้งแต่แรก** แต่ทั้งระบบมีคำขอสะสม 1 ใบ และเป็นของ tenant อื่น

| # | ที่ | อาการ |
|---|-----|-------|
| 1 | `approval.routes.ts` `GET /pending` | คืน `[]` ทันทีถ้าผู้เรียกไม่มีแถวใน `user_approval_permissions` — ตารางนั้น **ว่าง 0 แถวทุก tenant** → เจ้าของบริษัทไม่เคยเห็นคำขอ |
| 2 | `ApprovalInbox.tsx` ส่ง `level: 1` ตายตัว แต่โค้ดรัน action เฉพาะ `level === 2` | กดอนุมัติแล้ว**ค้าง PENDING ตลอดกาล** |
| 3 | `PUT /requests/:id/decision` | เช็คสิทธิ์จากตารางว่างเดียวกัน → ADMIN โดน 403 |

แก้: ADMIN/MASTER เป็นผู้อนุมัติโดยปริยาย (`isBlanketApprover`) · อนุมัติครั้งเดียวถือเป็นครั้งสุดท้ายเสมอ · สิทธิ์ใช้ `canApprove()`

### 2. จุดที่เอามาใส่ด่าน — เดิม**ไม่มี role check เลยสักจุด**
```
POST /stock/movement                    ← ปุ่มรับเข้า/ตัดออก/ปรับสต๊อก ทั้ง 3
POST /pos/bills/:id/cancel
POST /sales/pos-running-bills/:id/void
PUT  /purchase-orders/:id               ← ไม่เช็คแม้แต่สถานะ (SELECT id อย่างเดียว)
```
`grep -c requireRole routes/stock.routes.ts` = **0** — พนักงานคนไหนก็ปรับสต็อก/ยกเลิกบิลที่จ่ายเงินแล้วได้

PO ยังเป็นรูเดียวที่เหลือของ "แก้เอกสารที่ออกไปแล้ว" — SO/ใบเสนอราคา/PR ล็อกด้วยสถานะอยู่แล้ว
ส่วนใบแจ้งหนี้/ใบเสร็จ/ใบส่งของ **ไม่มี route แก้เนื้อหาเลย** (มีแค่เปลี่ยนสถานะ)

### 3. ออกแบบผิดรอบแรก แล้วเจ้าของแก้ให้ (สำคัญ)
รอบแรกทำโหมด **"ขอปลดล็อกก่อนแล้วค่อยแก้"** — ผิดตั้งแต่แนวคิด เพราะผู้บริหารต้องเห็นว่าจะเปลี่ยนอะไร*ก่อน*เซ็น ไม่ใช่เซ็นเช็คเปล่า
```
ตอนนี้: แก้ได้เลยตามปกติ → กดบันทึก = ส่ง "ร่าง" เข้าคิว (payload เก็บ {before, update})
        → ผู้บริหารเปิดดู diff → กดยืนยัน → applyPurchaseOrderUpdate() เขียนทับให้
```
`consumeUnlock()` / `POST /approval/request-unlock` ลบทิ้งแล้ว (คอลัมน์ `expires_at` ยังอยู่เฉย ๆ)

**กับดักที่เจอตอนทำโหมดปลดล็อก (เผื่อรื้อกลับมาใช้):** `executeApprovedAction` เซ็ตสถานะเป็น `EXECUTED` ทับ `APPROVED` ทำให้ตัวหาสิทธิ์ปลดล็อก (หาเฉพาะ APPROVED) มองไม่เห็น

### 4. สิทธิ์ยกเว้น — ต่อกับระบบสิทธิ์เดิมของเจ้าของ
`hasBypass()` ใน `services/approvalGate.service.ts` ปล่อยผ่านถ้าอย่างใดอย่างหนึ่ง:
- **(ก)** `user_approval_permissions.can_bypass = 1` รายคนรายหมวด (ติ๊กในหน้าตั้งค่าการอนุมัติ)
- **(ข)** `can(role, departments, resource, 'approve', customPermissions)` จาก `services/rbac.service.ts`
  = **ระบบสิทธิ์ที่เจ้าของเขียนไว้เองก่อนหน้านี้** (`pages/settings/PermissionSettings.tsx` →
  `users.departments` / `users.custom_permissions`) แมป `stock_adjust→stock`, `pos_void→orders`, `doc_edit→purchase`

ทั้งสองทาง**ยังเขียนแถว `status='AUTO'`** ลง `approval_requests` เป็นประวัติ (ADMIN/MASTER ด้วย) → โผล่ในลิสต์ความเคลื่อนไหวแต่ไม่มีปุ่มให้กด

⚠️ **sub-agent ที่ทำ backend ไม่ได้ต่อข้อ (ข) ให้** ต้องมาต่อเอง — เจ้าของเป็นคนถามเองว่าระบบสิทธิ์ 2 ชุดเชื่อมกันหรือยัง ถ้าไม่ถามคงหลุด

### 5. ประวัติ / ลิสต์ความเคลื่อนไหว
- `GET /approval/history?from&to&moduleType&status&requesterId&limit&offset` → `{data, total, limit, offset}` — non-admin เห็นเฉพาะแถวตัวเอง
- `GET /approval/requests/:id/detail` → แถว + `payload` + `before` ให้ UI ทำ diff
- หน้า ApprovalInbox 3 แท็บ (รออนุมัติจากฉัน / คำขอของฉัน / ประวัติทั้งหมด) + preset วันที่ (วันนี้/7วัน/30วัน/กำหนดเอง) + แบ่งหน้า

**compare mode (เจ้าของเลือกแบบนี้):** ใบสั่งซื้อที่ขอแก้ → วาด**ใบเดียว** (ฉบับหลังอนุมัติ) แล้วมาร์กจุดที่ต่างในตัวเอกสาร ⟨ค่าเดิมขีดฆ่า → ค่าใหม่ตัวหนา⟩ พื้นเหลือง · แถวเพิ่มพื้นเขียว · แถวลบพื้นแดง + แถบสรุป "มี N จุดที่เปลี่ยน / ยอดรวม ±฿X" ข้างบน
→ `components/approval/PurchaseOrderCompare.tsx`
- **ต้อง normalize ก่อนเทียบ** ฝั่งเก่าเป็นแถวดิบจาก DB (`material_id`/`unit_price`) ฝั่งใหม่เป็น body จากหน้าจัดซื้อ (`materialId`/`unitPrice`) · จับคู่รายการด้วย material_id ไม่มีค่อยใช้ชื่อ → แยกได้ว่า แก้/เพิ่ม/ลบ
- ปรับสต็อก/ยกเลิกบิล POS **ไม่เข้า compare mode** เพราะเป็น "การกระทำ" ไม่มีเอกสารเดิมให้เทียบ

**ข้อความในลิสต์ต้องอ่านจบในบรรทัดเดียว** (เจ้าของสั่ง) — ประกอบตอนสร้างคำขอ เก็บใน `description`:
```
สินค้า ผ้าสปันบอนด์ ถูกปรับ 20 เป็น 40 ชิ้น เนื่องจาก นับสต๊อกประจำเดือน
สินค้า ใยสังเคราะห์ รับเข้า 25 ชิ้น (100 → 125) เนื่องจาก รับของจากซัพ
บิล POS-0042 ยอด ฿1,250 ขอยกเลิก เนื่องจาก ลูกค้าเปลี่ยนใจ
```
- **ไม่ยัดชื่อคนทำในข้อความ** — `requester_name` เป็นคอลัมน์แยกและหน้าเว็บโชว์คู่กันอยู่แล้ว (มีเทสต์กันไว้)
- **ถ้าหน่วยที่กรอกไม่ตรงหน่วยฐาน จะไม่โชว์ "จาก X เป็น Y"** เพราะตัวเลขคนละหน่วยเทียบกันไม่ได้ → โชว์ "ถูกปรับเป็น 40 ลัง" แทน

### 6. Refactor ที่จำเป็น (เพราะ executor ต้องรัน action เดิมซ้ำ ห้าม copy ตรรกะ)
- **`services/stockMovement.service.ts`** ← ยกทั้งก้อนออกจาก `stock.routes.ts POST /movement` (รวม `priceToBaseUnitCost` ที่ route import กลับไปใช้)
- **`services/purchaseOrderUpdate.service.ts`** ← ยกออกจาก `purchaseOrder.routes.ts PUT /:id`
- **`services/posBillCancel.service.ts`** ← cancel/void ใช้ร่วมกัน
  ⚠️ **เปลี่ยนพฤติกรรมบัญชีของ void โดยตั้งใจ**: เดิม void เขียน journal reversal เองในไฟล์ route (สลับ debit/credit บน `4101` ตรง ๆ, **ไม่มี guard กันลงซ้ำ**, อัปเดตสถานะบิลเป็น VOID *ก่อน* คืนสต็อก → พังกลางคันแล้ว retry ไม่ได้เพราะด่าน `status==='PAID'` ไม่ผ่านแล้ว) ตอนนี้เรียก `recordCancelledSale()` เหมือน cancel → เด้งรายได้ไป `SALES_RETURN (4302)` และได้ idempotency guard มาด้วย
- **`components/common/ApprovalGate.tsx`** — `useApprovalGate()` คืน `{ modal, handleResponse, handleError }` ใช้ที่ Stock / Purchase / Cashier / Sales
  **ผู้ใช้ต้องเห็น popup ภาษาไทยเสมอ ห้ามโชว์ status code หรือ error ดิบ** (เจ้าของสั่งชัด)
  - `services/stock.ts` `recordMovement()` เดิมโยน `Error('Failed to record movement')` เมื่อไม่มี `data.data` — ซึ่งคือเคส 202 พอดี ต้องปล่อย body ผ่านก่อน

### 7. เรื่องขนาดโค้ด (คุยแล้วยังไม่ลงมือ)
เจ้าของเสนอทำ template library ให้หน้าใหญ่ ๆ ดึงไปใช้ วัดของจริงแล้ว:
```
frontend/pages รวม 33,791 บรรทัด — Stock 5,888 · Purchase 4,320 · Sales 4,130
ของที่ชื่อซ้ำกันข้ามไฟล์: 1,047 บรรทัด
  StatCard 6 ที่ · StatusBadge 5 ที่ · DetailModal 2 ที่ · ModalShell/Field/TabButton/JournalPreview/Skeleton 2 ที่
Purchase.tsx ไฟล์เดียวมี *SearchInput ที่ทำงานเหมือนกัน 5 ตัว 323 บรรทัด
```
→ รวมแล้วลดได้ราว **4%** ของหน้าเว็บทั้งระบบ **ประโยชน์จริงคือ UI ตรงกันทุกหน้า** (ตอนนี้คำว่า "สถานะ" หน้าตาไม่เหมือนกัน 5 แบบ) ไม่ใช่จำนวนบรรทัด
ลำดับที่คุ้ม: StatusBadge → StatCard → SearchInput → ModalShell · **`DetailModal` ชื่อซ้ำแต่คนละเรื่อง อย่ารวม**

**`OrderModal` ใน Purchase.tsx import ไม่ได้** เพราะประกาศไว้*ข้างใน* `const Purchase` (บรรทัด 3214) ไม่ได้ export และ **ไม่รับ prop เลย** — หยิบ `orderForm`/`modalMode`/handlers จาก closure รอบตัว (14 ตัว) ถ้าจะทำให้ import ได้ต้องยกออกมาระดับบนสุด + ใส่พารามิเตอร์ + ย้าย helper ระดับ module อีก 6 ตัว (`ModalShell`/`Field`/`inputCls`/3 `*SearchInput`) ไปไฟล์กลางด้วย ไม่งั้น import วน
→ **เจ้าของตัดสินใจไม่ทำ** เลือกทำ compare mode แทน (คุ้มกว่า)

### 8. สถานะสุดท้าย
```
เทสต์ 14 ไฟล์ 99 เทสต์ผ่าน · tsc --noEmit สะอาดทั้ง backend/frontend · build+deploy ครบ
ไฟล์เทสต์ใหม่: services/{approvalGate.service,bypassLink}.test.ts
              routes/{approval.routes,stockApproval,posApproval,docEditApproval,requestDescription}.test.ts
backup: /root/approval-backup-20260912/ · DB: /root/dev.db.bak-20260912
```
**⚠️ `npm test` พัง** — script ชี้ `../node_modules/.bin/vitest` ที่ไม่มีอยู่ ใช้ `./node_modules/.bin/vitest run`

**ยังไม่ได้ทำ:**
- แจ้งเตือน LINE ตอนมีคำขอ/อนุมัติ (เจ้าของพักไว้เอง — ต้นแบบ `lineBotService.notifyPRStatus()`)
- `POST /stock/:id/unpack` ยังไม่ติดด่าน
- อนุมัติ 2 ระดับ (คอลัมน์ `approver_2_*` ยังอยู่ ปิดใช้)
- คืนแต้ม loyalty ตอนยกเลิกบิล POS — ช่องว่างเดิม ไม่เกี่ยวกับการอนุมัติ
- ตรรกะอนุมัติที่ copy กันอยู่ 3 ชุดเดิม (`purchase-request.routes.ts`, `sales/salesOrders.ts`, `mcp/tools/shared.ts`) ยังไม่ย้ายมาใช้ประตูกลาง
- **ยังไม่เคยเห็นหน้าจริงด้วยตา** — ต้องล็อกอินเป็น role `USER` ซึ่ง Testshop ยังไม่มี (มี ADMIN คนเดียวที่ข้ามทุกด่าน)

---

## 2026-09-13 — ใบส่งของที่ไม่เคยเกิด, แต้มสะสม 2 ตาราง, และเทสต์เดินสายขายทั้งเส้น

### สรุปคอมมิตรอบนี้ (branch `ui`)
```
b86bc15  ใบรับสินค้า/ใบส่งของ ไม่ควรมี QR รับเงิน
8013dda  ออกใบส่งของอัตโนมัติตอนกด "ส่งของแล้ว" + กันตัดสต็อกซ้ำ
17a9b52  อุด 3 รูในระบบอนุมัติ/แต้มสะสม
6eb911f  รวมตารางแต้มสะสม 2 ชุดให้เหลือชุดเดียว
6a9080a  เทสต์เดินสายขายทั้งเส้นผ่าน HTTP จริง
```

### 1. ใบส่งของไม่เคยเกิดขึ้นเลยสักใบ (ต้นเหตุลึกกว่าที่รายงาน)

เจ้าของรายงานว่า "กดสถานะส่งของแล้ว ใบไม่ถูกส่งไป ต้องไปสร้างใหม่เอง" — ของจริงคือ**สร้างเองก็ไม่ได้**

```
ไม่มีหน้าไหนเรียก POST /sales/delivery-orders เลยสักจุด
  └─ ต่อให้เรียก ก็เด้ง FOREIGN KEY constraint failed ทุกครั้ง
       delivery_order_items.product_id = NOT NULL REFERENCES products(id)
       แต่แถวขายจริงมี product_id ว่าง 661/685 แถว (products = แคตตาล็อกลอย 12 แถว)
  └─ ผล: ใบส่งของ 0 ใบทั้งระบบ / SO ส่งของแล้ว 307 ใบ / ป้าย "DO ×n" ไม่เคยขึ้น
```

**โรคเดียวกับ `credit_note_items` เป๊ะ ๆ** ที่เคยแก้ไปแล้ว ใช้สูตร rebuild เดิม
(`PRAGMA table_info` → `foreign_keys=OFF` → ตาราง `_new` ที่ product_id ว่างได้ → copy → DROP → RENAME
→ `foreign_key_check`) แล้วแก้ `schema.ts` ให้ตรงกันด้วย ไม่งั้นเครื่องที่ migrate ใหม่ได้ของเก่า

ที่ทำ:
- `routes/sales/shared.ts` → `createDeliveryOrderForSO()` เอาเฉพาะของค้างส่ง มีใบอยู่แล้วคืน `null`
- `routes/sales/salesOrders.ts` → SO เป็น DELIVERED/COMPLETED ออกใบให้เอง (ล้มแล้วไม่ทำให้สถานะล้ม)
- `Sales.tsx` โหลดใบส่งของใหม่หลังกด ป้าย DO จะได้ขึ้นทันที
- ชื่อสินค้าบนใบ `COALESCE(p.name, soi.product_name)` — join products ได้ NULL เกือบทุกแถว

**⚠️ กับดักตัดสต็อกซ้ำ** — สต็อกถูกตัดตั้งแต่ยืนยัน SO (`deductStockForSO`) แต่ใบส่งของตอน DELIVERED
ตัดอีกรอบ = ของหายสองเท่า (ไม่ระเบิดเพราะไม่เคยมีใบสักใบ) การ์ดคือ `soStockAlreadyDeducted()`
ดูจาก **stock_movements reference `SO: <เลขที่>`** ไม่ใช่เดาจากสถานะ SO (สถานะถูกดันเป็น PARTIAL
ได้โดยไม่เคยยืนยัน) นี่คือเหตุผลที่ใบเปิดที่สถานะ **SHIPPED ไม่ใช่ DELIVERED**

**backfill Testshop 307 ใบ** — ทั้งหมดเป็น tenant สาธิตล้วน บริษัทจริงยังไม่มี SO ที่ส่งของเลยสักใบ
สถานะ DELIVERED ลงวันที่เดิมของ SO เลขแยกตามปี (DO-2025-00001..00066, DO-2026-00001..00241)
ยืนยันด้วยผลรวมก่อน-หลังว่า **ไม่แตะสต็อก / delivered_qty / stock_movements**
ย้อนกลับ: `DELETE ... WHERE created_by = 'backfill-20260913'`
⚠️ seed ตั้ง `delivered_qty` เต็มไว้แล้ว `createDeliveryOrderForSO` จึงคืน null ทุกใบ ต้องใช้สคริปต์แยก

### 2. อุด 3 รู (แบ่ง sub-agent sonnet 3 ตัว แล้วตรวจงานเองทุกตัว)

| # | บั๊ก | ที่แก้ |
|---|---|---|
| A | แต้มสะสมไม่ถูกคืนตอนยกเลิกบิล POS — ลูกค้าเก็บแต้มจากบิลที่ยกเลิก + `total_spent` บวมถาวร | `posBillCancel.service.ts` |
| B | ปุ่มแกะแพ็คเลี่ยงระบบอนุมัติได้ — ขยับ sealed_qty→quantity เหมือน POST /movement แต่ไม่ผ่านประตู | `stock.routes.ts`, `stockMovement.service.ts`, `approval.routes.ts`, `Stock.tsx` |
| C | ตรรกะอนุมัติ SO copy-paste 2 ที่ — ไม่รู้จัก ADMIN/MASTER, ไม่รู้จัก can_bypass, ไม่ลง log, ตั้งเลขเอง `'APR-SO-'+Date.now()` | `sales/salesOrders.ts`, `mcp/tools/sales.ts` (ลบ 60 บรรทัด) |

**ที่ agent มองข้ามและต้องมาแก้เอง:**
- A: `UPDATE customers` กับแถว guard กันคืนซ้ำไม่ได้อยู่ธุรกรรมเดียวกัน → ถ้า guard เขียนไม่ติดหลังแต้มถูกปรับ รอบหน้าคืนซ้ำ
- C: เกณฑ์เปลี่ยนจาก `can_approve` เป็น `can_bypass` — ต้องไปเช็คของจริงว่าใครจะโดนบล็อกใหม่ (มีแถวของ tenant_bb_pillow อยู่ 1 แถว แต่ tenant นั้นไม่เคยเปิดหมวดนี้ เลยไม่กระทบ)

ข้อจำกัดที่รับไว้: คำขอแกะแพ็คไม่ถูก validate ตอนส่ง (ขอแกะ 10 ทั้งที่มี 3 ได้) ไปเด้ง 400 ตอนอนุมัติ
คำขอค้าง PENDING ให้แก้ได้ — เหมือน `POST /movement` ที่ขึ้นไปก่อนหน้า

### 3. แต้มสะสมมี 2 ตารางที่ไม่รู้จักกัน

```
crm_points_transactions   POS เขียนฝ่ายเดียว ไม่มีหน้าไหนอ่าน      0 แถว   ← ลบทิ้งแล้ว
loyalty_transactions      แท็บแต้มสะสมหน้า CRM อ่าน/เขียน       332 แถว   ← ตัวจริง
```
แต้มจากการซื้อผ่าน POS จึงไม่เคยโผล่ในประวัติแต้มของลูกค้า (ยอดรวมถูก แต่ไทม์ไลน์ขาดทั้งเส้น)
ยังไม่ระเบิดเพราะไม่เคยมีบิล POS ผูกลูกค้าจริง ตารางถึงว่าง → **ย้ายฝั่งได้ฟรี ไม่ต้อง migrate**

กติกาตารางปลายทางที่ต้องรู้ก่อนเขียนลงไป:
- สร้างจาก `customer.routes.ts` ไม่ใช่ `schema.ts` · **`CHECK(type IN ('EARN','REDEEM','ADJUST'))`**
  ใส่ค่าอื่นไม่ได้ ต้องแยกด้วย `reference_type` · **REDEEM เก็บ points เป็นเลขติดลบ**
- POS ใช้ `reference_type='POS_BILL'`, ยกเลิกใช้ ADJUST `reference_type='POS_CANCEL'` = ตัว guard กันคืนซ้ำ

### 4. เทสต์เดินสายขายทั้งเส้นผ่าน HTTP จริง (`salesFlow.e2e.test.ts`)

เจ้าของถามว่า "ส่งไปยันสุดทางมีการตัดสต็อกไหม ปุ่มส่งงานต่อกันไหม" — **ข้อมูลในฐานตอบไม่ได้**
เพราะเป็น seed ที่เขียนตรงเข้าตาราง SO ทั้ง 327 ใบของ Testshop ไม่มี stock_movements สักรายการ
แต่ GL กลับเครดิตสต็อกไปแล้ว (เช่น SO-2026-00333 → JV-2026-00328 เครดิตสต็อก 13,050)
= **ข้อมูลสาธิตขัดกันเอง ไม่ใช่หลักฐานว่าปุ่มพัง**

เลยเขียนเทสต์กดปุ่มจริงผ่าน supertest + auth จริง:
```
ขั้นที่กด                 สต็อก        ผล
สร้างใบเสนอราคา            100        —
แปลงเป็นคำสั่งขาย           100        ใบเสนอราคาถูกปิดเป็น ACCEPTED ให้เอง ✓
ยืนยัน                    100 → 90    ตัดที่นี่ที่เดียว 1 รายการ ✓
กำลังดำเนินการ/พร้อมส่ง       90        ไม่แตะสต็อก ✓
ส่งของแล้ว                   90        ออกใบส่งของให้เอง (SHIPPED) ไม่ตัดซ้ำ ✓
หน้างานกดรับของ              90        ไม่ตัดซ้ำ + บันทึก delivered_qty ✓
ออกใบแจ้งหนี้                90        สมุดรายวันใบที่ 1 ดุล ✓
รับชำระ                     90        ใบที่ 2 · invoice ปิดยอด · SO เป็น PAID ✓
เสร็จสิ้น                    90        ไม่ออกใบส่งของใบที่สอง ✓
รวม: ของออกครั้งเดียว · รายได้ 4101 บันทึกครั้งเดียว · ทุกใบดุล
ยกเลิก SO ที่ยืนยันแล้ว → ของกลับครบ · ยิงซ้ำของไม่งอก ✓
```

**⚠️ กับดักชื่อฟิลด์**: `POST /sales-orders` รับ `items[].productId` แต่เอาไปใส่คอลัมน์
`sales_order_items.stock_item_id` (ส่วน `product_id` ใส่ `null` เสมอ) — ต้องส่ง id ของ `stock_items`

### 5. สถานะ
```
เทสต์ 20 ไฟล์ 129 เทสต์ผ่าน · tsc สะอาดทั้ง backend/frontend · build + pm2 restart + deploy ครบ
backup: /root/approval-backup-20260912/
DB: /root/dev.db.bak-20260913-do, -loyalty, -prebackfill
```
**ยังไม่ได้ทำ / ค้างไว้:**
- `purchase-request.routes.ts` ยังเขียนตรรกะอนุมัติเอง (สำเนาสุดท้ายที่เหลือ)
- แจ้งเตือน LINE ตอนมีคำขอ/อนุมัติ · อนุมัติ 2 ระดับ (คอลัมน์ยังอยู่ ปิดใช้)
- ApprovalInbox ยัง render สรุป PO เอง ไม่ได้ใช้ `OrderModal` ของหน้าจัดซื้อ
- **ยังไม่เคยเห็นหน้าจริงด้วยตา** — ไม่มีรหัสล็อกอินของเจ้าของ ตรวจถึงระดับ query/HTTP เท่านั้น
- ตรวจ flow รอบใหญ่ (สายซื้อ PR→PO→GR→PI, แผนที่สต็อกทั้งระบบ, บัญชีทั้ง 2 สาย) — สั่ง agent ไว้ 3 ตัว ผลยังไม่ออก

---

## 📅 Session Log — 27 กันยายน 2026 (งบทดลองนับซ้ำ/ยอดหาย + MCP ลูกหนี้-เจ้าหนี้เขียน SQL ซ้ำ + แผนต่อ prompt บัญชี)

จุดเริ่ม: อยากให้ชุด prompt บัญชี 24 ตัว (เดิมมาจาก Uthen Power ต้องแนบไฟล์ Excel/PDF เอง) ดึงข้อมูลจาก ERP ได้โดยตรง
ตอนไล่ดูจุดเชื่อมเจอว่า ERP มี REST รายงานกับ MCP อยู่แล้ว **แต่ตัวเลขที่ส่งออกไปผิด** เลยแก้บั๊กก่อน ส่วน tool ตัวใหม่เก็บไว้เป็นแผน (ข้อ 4)

### 1. งบทดลอง (`routes/reports.routes.ts` → `buildTrialBalance()`)
- **ยอดผิดฝั่งหายจากงบ:** เดิมวางยอดตาม `normal_balance` (`DEBIT && x>0 ? x : 0`) ทำให้บัญชีเดบิตที่ติดลบถูกปัดเป็น 0 **ทั้งสองฝั่ง**
  ของจริง: tenant_bb_pillow ธนาคาร 1102 = **−6,965.34** ไม่ขึ้นในงบทดลองเลย ทั้งที่เป็นเคสที่ต้องจับที่สุด ("เงินฝากติดลบ")
  → แก้เป็นใช้ `net = Dr − Cr` แล้ววางตามเครื่องหมาย (response shape เดิม frontend ไม่ต้องแก้)
- **ไม่ส่ง startDate แล้วยอดเป็น 2 เท่า:** query ยอดยกมาไม่มีเงื่อนไขวันที่ → นับทุกรายการ แล้วนับความเคลื่อนไหวทุกรายการซ้ำอีกรอบ (เทสต์จับได้: เงินฝากติดลบ 1,000 ได้ 2,000)
  → ไม่มี startDate = ไม่มียอดยกมา (ไม่รัน query ยกมาเลย)
- แยก body ของ route ออกมาเป็น `export function buildTrialBalance(tenantId, startDate?, endDate?)` ให้เทสต์และ MCP ในอนาคตเรียกตัวเดียวกัน

### 2. MCP `get_ar_aging` / `get_ap_aging` (`mcp/tools/finance.ts`)
เดิมเขียน SQL เองแยกจาก REST `/api/receivables/ar-aging` แล้วหลุดไป 4 อย่าง:
| ปัญหา | ผลจริง (Testshop) |
|---|---|
| ไม่กรอง DRAFT/CANCELLED | ใบแจ้งหนี้ DRAFT 6 ใบถูกนับเป็นหนี้ |
| `LIMIT 50` | บิลค้างมี 111 ใบ → ยอดรวมและรายชื่อลูกหนี้ขาด |
| bucket/วันที่คนละแบบกับ REST (`julianday('now')`) | MCP กับหน้าเว็บให้ตัวเลขไม่ตรงกัน |
| ไม่มีที่อยู่/เลขผู้เสียภาษี | ทำจดหมายยืนยันยอดไม่ได้ |

→ `receivables.routes.ts` export `arAging()` / `apAging()` (SELECT เดิม + `address`, `tax_id`) ให้ทั้ง REST และ MCP เรียก **ลบ SQL และ bucket ชุดเก่าใน MCP ทิ้ง** เพิ่ม param `as_of` ส่วน `overdue_only` / `*_name` กรองบนผลลัพธ์แล้วคำนวณยอดรวมใหม่
(grep แล้วไม่มีใครใช้ output key เก่า `aging_buckets` / `invoices` / `total_unpaid_invoices`)

### 3. MCP `get_financial_summary`
ยอด AR/AP คงค้างและเกินกำหนด 4 query ไม่กรอง DRAFT/CANCELLED (ขณะที่ revenue/expense ในฟังก์ชันเดียวกันกรองแล้ว) → เพิ่มเงื่อนไข
⚠️ ยังไม่แก้: `gross_profit = เงินรับ − เงินจ่าย` เป็นเกณฑ์เงินสด แต่ตั้งชื่อว่ากำไรขั้นต้น ยังไม่เปลี่ยนชื่อ key เพราะเสี่ยงให้ consumer พัง ถ้าจะแก้ให้ใช้ journal (4101/5101) แบบ Phopy Board

### เทสต์ — `mcp/tools/finance.test.ts` (4 เทสต์, ใช้ test.db)
เงินฝากติดลบไปอยู่ฝั่งเครดิตและ ΣDr=ΣCr (มีและไม่มี startDate) · aging 55 ใบ + DRAFT + CANCELLED นับได้ 55 และ MCP = `arAging()` · กรอง overdue/ชื่อแล้วยอดตรงกับรายการ · summary ไม่รวม DRAFT

### ข้อมูลเพี้ยน (ไม่ใช่บั๊กโค้ด — ไม่ patch DB ให้นักบัญชีแก้ผ่าน UI)
- **Testshop — GL ลูกหนี้ไม่ตรงกับรายตัว:** GL 1104 = 1,215,065.47 แต่ใบแจ้งหนี้ค้าง = 2,049,032.88 (ต่าง 833,967)
  ตรวจโค้ดแล้วลงบัญชีถูก (`salesBilling.service.ts:150/362`, `routes/sales/shared.ts:86/102`: ออกบิล Dr ลูกหนี้ / รับเงิน Cr ลูกหนี้)
  สาเหตุคือข้อมูล seed: ใบ UNPAID 49 ใบลง Dr เงินสด/ธนาคาร (1.22M) และใบ PAID 34 ใบลง Dr ลูกหนี้โดยไม่มี JE รับชำระ (390k) · วันที่เป็นเที่ยงคืนเป๊ะแบบ seed
  → ถ้าจะใช้ Testshop สาธิตการยืนยันยอดลูกหนี้ ต้อง seed ใหม่ให้ตรง ไม่งั้นจดหมายไม่ตรงกับงบ
- **tenant_bb_pillow — `JV-FIX-0001`** (ซ่อม POS-2026-00007 ด้วยมือ): บรรทัด Dr 17.655 / Cr 16.155 แต่ header บอก 17.655/17.655 → งบทดลองต่าง 1.50 → ทำรายการปรับปรุงหรือกลับรายการผ่านหน้า Journal
- **tenant_msqy2xbn (F&B เบดดิ้ง):** ยังไม่มี journal · ลูกค้า 257/381 ไม่มีเลขผู้เสียภาษี, 77 ไม่มีที่อยู่ → จดหมายยืนยันยอดจะเว้นว่าง

### 4. แผนพัฒนาต่อ: ต่อ prompt บัญชี 24 ตัวเข้า MCP (ยังไม่ทำ)
prompt ทุกตัวเป็นแบบ 6 ส่วน (CONTEXT/ROLE/INPUT/INSTRUCTION/VALIDATION/OUTPUT) **ส่วนเดียวที่ผูกกับไฟล์แนบคือ INPUT** → ไม่ต้องเขียน prompt ใหม่ แค่ให้ tool ส่งข้อมูลแทนไฟล์

| prompt | ข้อมูลที่ต้องใช้ | แหล่งใน ERP | tool |
|---|---|---|---|
| AD001 ตรวจงบทดลองผิดปกติ · กระดาษทำการ 12 ช่อง · วิเคราะห์งบย่อส่วน · อัตราส่วน | TB + type/category | `buildTrialBalance()` | ✅ `get_trial_balance` (MASTER/ADMIN) |
| AD004 ยืนยันยอดลูกหนี้ · AD005 กระดาษทำการ AR · จดหมายติดตามหนี้ | AR รายบิล + ที่อยู่/เลขภาษี | `arAging()` | ✅ `get_ar_aging` (แก้แล้ว) |
| AD002 ยืนยันยอดเจ้าหนี้ | AP รายบิล + ที่อยู่ | `apAging()` | ✅ `get_ap_aging` (แก้แล้ว) |
| งบพิสูจน์ยอดธนาคาร | GL ธนาคาร (statement แนบเอง) | `buildLedger()` | ✅ `get_ledger` (MASTER/ADMIN) |
| หัวจดหมายทุกฉบับ | ชื่อ/ที่อยู่/เลขภาษีบริษัท | `company_settings` | แนบเป็น `company` block ใน tool ข้างบน |

**ทำอย่างไร (ห้ามเขียน SQL ชุดใหม่):**
1. `get_trial_balance(start_date?, end_date?)` → เรียก `buildTrialBalance()` + แนบ `company`
2. `get_ledger(account_code, start_date?, end_date?)` → แยก `/ledger/:accountId` เป็น `buildLedger()` แบบเดียวกับ TB หา id จาก `accounts.code` + tenant
3. งบย่อส่วน/อัตราส่วนคำนวณจาก TB + `accounts.type/category` ได้ (มี COGS, DEPRECIATION, ACCUM_DEPRECIATION ฯลฯ ครบ) **ยังไม่ต้องมี tool งบดุล/กำไรขาดทุนแยก** จะเพิ่มก็ต่อเมื่อต้องการ OCF ratio จริง (แยก `/cash-flow` แบบเดียวกัน)
4. **pre-flight ก่อนรัน prompt กลุ่ม AR/AP:** เทียบ GL 1104/2101 จาก TB กับ `totals.outstanding` ของ aging ถ้าไม่ตรงให้หยุดแล้วรายงานผลต่าง (กันกรณีแบบ Testshop)
5. ฝั่ง prompt: skill เดียวทำหน้าที่แมป prompt → tool → คอลัมน์ในส่วน INPUT และตัดข้อความขยะจาก UI Uthen Power (~110 บรรทัดแรกของทุกไฟล์: "Back / Uthen Power / My Space / … / Toggle show tool calls") ก่อนใช้

**prompt ที่ไม่ควรต่อ (ERP ไม่มีข้อมูล หรือเป็นงาน legal/design/OCR):** สัญญาเช่า, ผังงานเงินเดือน (ไม่มี employees/payroll), ผังงาน WHT, วิเคราะห์เอกสาร, ตรวจคุณภาพเอกสาร, ค้ำประกันเกินสิทธิ์, เชิญประชุมผู้ถือหุ้น (ไม่มี shareholders), วิเคราะห์การลงทุน, ซื้อสินทรัพย์ (**ไม่มี fixed_assets / ค่าเสื่อม**), ผลิต/ต้นทุน, ระบบจัดเอกสาร, วิเคราะห์กระบวนการขาย, ร่างจดหมายติดตามหนี้ (เทมเพลต)
→ ถ้าจะต่อ ต้องสร้างโมดูลใน ERP ก่อน: ทะเบียนสินทรัพย์+ค่าเสื่อม, bank statement import, payroll

### สถานะ
- แก้ 3 ไฟล์ + เทสต์ใหม่ 1 ไฟล์ · `tsc` สะอาด · **เทสต์ 62 ไฟล์ 355 เทสต์ผ่าน** · `npm run build` + `pm2 restart crm-backend` แล้ว (online)
- commit `5d28685` บน branch `ui`
- ยังไม่ได้ดูตัวเลขบนหน้าจอจริง (ต้องใช้ token ผู้ใช้): งบทดลอง tenant_bb_pillow ต้องขึ้น 1102 ฝั่งเครดิต 6,965.34 · งบทดลองที่ไม่เลือกวันเริ่มต้นจะเหลือครึ่งจากเดิม (ตัวเลขที่ถูกแล้ว)

### ไล่ `Update PO error: FOREIGN KEY constraint failed` ที่ค้างใน `crm-backend-error.log`
เห็นหลัง restart เลยไล่ต่อ สรุปว่า**เป็น log เก่า แก้ไปแล้ว ไม่ต้องแก้โค้ด**
- 8 ครั้งในไฟล์ log (ไฟล์เขียนล่าสุด 20 ก.ย.) ตรงกับเคส PO-2026-00033 เมื่อ 18 ก.ย. (แก้ครั้งสุดท้ายเวลา 09:32 ตามที่บันทึกไว้ในคอมเมนต์ของ service)
- stack ชี้ `purchaseOrderUpdate.service.ts:113` / `:130` ซึ่งไม่ตรงกับไฟล์ปัจจุบัน (`transaction()` ย้ายไปอยู่ราว ๆ บรรทัด 250) = โค้ดรุ่นก่อน commit `1afa68a` (19 ก.ย.) ที่เพิ่ม `blankToNull` / `resolveSupplierId` / ตรวจ `materialId` / แก้แถวเดิมแทนลบ-ใส่ใหม่
- ไล่ FK ครบทุกเส้นของการแก้ PO: `purchase_orders.supplier_id` (ตรวจแล้ว), `purchase_order_items.material_id` (ตรวจแล้ว), `goods_receipt_items` / `purchase_invoice_items` → `purchase_order_items` (กันลบแถวที่ถูกอ้างแล้ว) · `bank_account_id` ไม่มี FK
- มีเทสต์ครอบคลุมอยู่แล้วที่ `services/purchaseOrderUpdate.test.ts` (อยู่ใน 355 ที่ผ่าน)
- หมายเหตุข้างทาง (ยังไม่แก้): `PRAGMA foreign_key_check` เจอ `pos_daily_sales` ชี้ไปที่ `users` ที่ไม่มีอยู่แล้ว (ข้อมูลกำพร้า)

### ✅ `materialId` ข้ามบริษัทได้ — ปิดแล้ว
`materialId` ของรายการซื้อ = `stock_items.id` (ชื่อเก่าจากก่อนยุบ materials เข้า stock_items 16 ก.ย. ยังคงชื่อคีย์ไว้เพราะฟอร์ม/MCP ส่งมาด้วยชื่อนี้)
เดิมมีทางเข้า 6 ทางที่รับ id จากผู้ใช้โดยไม่เช็คเทแนนต์: แก้ PO (`WHERE id = ?` อย่างเดียว), สร้าง PO, MCP `update_purchase_order`, สร้างใบรับของ, ออกใบแจ้งหนี้ซื้อที่ส่ง items มาเอง, ใบคืนของ
ตัวที่ขยับสต็อก (ยืนยัน GR / ใบคืนของ) เช็ค `tenant_id` อยู่แล้ว สต็อกบริษัทอื่นจึงไม่ถูกแตะ แต่ id ต่างบริษัทยังเข้าไปอยู่ในเอกสารได้ แล้ว `LEFT JOIN stock_items` ที่ไม่มี tenant ก็เอาชื่อ/SKU ของบริษัทอื่นมาแสดง
→ helper เดียว `resolveStockItemId(tenantId, id, label?)` ใน `purchaseOrderUpdate.service.ts` (ข้างๆ `resolveSupplierId`) ใช้ครบทั้ง 6 ทาง · ตอบ 400 พร้อมข้อความ (GR ใช้ code `UNBOUND_ITEM`, PI ใช้ code ใหม่ `STOCK_ITEM_INVALID`)
เทสต์ข้ามเทแนนต์เพิ่มใน `purchaseOrderUpdate.test.ts` · ชุดเต็ม 62 ไฟล์ 356 เทสต์ผ่าน · build + restart แล้ว
✅ ปิดแล้ว (รอบถัดมา): MCP `update_purchase_order` เรียก `applyPurchaseOrderUpdate` ตัวเดียวกับ REST — ดูหัวข้อถัดไป

### ✅ MCP `update_purchase_order` ใช้ service ตัวเดียวกับ REST + ค้นทั้ง backend หาทางเข้า materialId ที่เหลือ
- `mcp/tools/purchase.ts` เลิกเขียน UPDATE/DELETE+INSERT เอง แล้วเรียก `applyPurchaseOrderUpdate` เลย ได้ครบในทีเดียว: แก้ที่แถวเดิม (id ไม่เปลี่ยน, `received_qty` ไม่หาย), VAT แบบรวมใน/แยกนอกตามใบ, หักส่วนลด, เช็คผู้ขาย/สินค้าข้ามเทแนนต์
  service เขียนทับ ยอด/วันที่/ภาษี/ส่วนลด ทุกครั้ง → ช่องที่ AI ไม่ได้ส่งมา tool จะส่งค่าเดิมเข้าไปแทน (ไม่ส่ง items = ส่งรายการเดิมพร้อม id)
- ค้นทั้ง `src/` (ไม่นับเทสต์) ด้วย grep: `*.materialId ||/??/,` · `FROM stock_items WHERE id = ?'` ที่ไม่มี tenant · `DELETE FROM purchase_order_items WHERE purchase_order_id`
  - ทุกจุดที่เขียน `materialId` จากฟอร์มลง DB ผ่าน `resolveStockItemId` แล้ว: สร้าง/แก้ PO, MCP แก้ PO, สร้าง GR, ออก PI, ใบคืนของ, **สร้างใบสั่งผลิต (`workOrder.routes.ts` — ค้นแล้วเจอเพิ่ม)**
  - `bom.routes.ts` เช็ค `AND tenant_id` เองอยู่แล้ว · `resolveMaterialId()` ใน `purchase.routes.ts` (สาย PR หาจาก id/sku/ชื่อ) เช็ค tenant ทุก query
  - ไม่เหลือ DELETE รายการ PO ทั้งใบ นอกจากตอนลบ PO ทั้งใบ (`DELETE /purchase-orders/:id`)
  - ที่ยังอ่าน `stock_items WHERE id = ?` โดยไม่ดู tenant เหลือเฉพาะการอ่านซ้ำหลังจาก id ผ่านการเช็คแล้ว (ดึงชื่อ/หน่วยมาแสดง) ไม่ใช่ทางเข้า
- ✅ ย้ายแล้ว: `resolveStockItemId` + `StockItemRefError` อยู่ที่ `services/stockItem.service.ts` · ผู้เรียกตรง (สร้าง PO, GR, PI, ใบคืนของ, ใบสั่งผลิต) จับ `StockItemRefError` → 400 · `applyPurchaseOrderUpdate` แปลงเป็น `PurchaseOrderUpdateError` ที่เดียว ผู้เรียก service (REST PUT, MCP, ผู้อนุมัติ) จึงไม่ต้องแก้ · 357 ผ่าน
- เทสต์ใหม่: MCP แก้แค่หมายเหตุแล้ว รายการ/ยอด/ส่วนลด/วันที่/`skip_stock` ต้องอยู่ครบ + ส่งสินค้าบริษัทอื่นต้องถูกปฏิเสธ · ชุดเต็ม 62 ไฟล์ 357 เทสต์ผ่าน · build + restart แล้ว

### ✅ MCP `get_trial_balance` / `get_ledger` (แผนข้อ 4 ข้อ 1–2)
- **เห็นเฉพาะ MASTER (master key) และ ADMIN** — `registerFinanceTools(server, tenantId, callerRole)` ไม่ลงทะเบียน 2 tool นี้ให้ role อื่นเลย AI ของ USER จึงมองไม่เห็น (AR/AP aging ยังเห็นทุก role เหมือนเดิม)
- `get_trial_balance(start_date?, end_date?)` → `buildTrialBalance()` + `company` (ชื่อ ที่อยู่ เลขภาษี สาขา)
- `get_ledger(account_code, start_date?, end_date?)` → หา id จาก `accounts.code` + tenant แล้วเรียก `buildLedger()` (แยกออกจาก `/reports/ledger/:accountId` ให้ route ใช้ร่วมกัน response เดิม)
- 🐛 **เจอบั๊กเดียวกับงบทดลองใน ledger:** ไม่ส่ง startDate → ยอดยกมารวมทุกรายการแล้วบวกรายการซ้ำ ยอดปิดเป็น 2 เท่า → แก้แล้ว (ไม่มี startDate = ยอดยกมา 0)
- เทสต์: role ที่มองเห็น tool · ledger ไม่เป็น 2 เท่า + ยอดยกมาเมื่อระบุวัน · TB ผ่าน MCP ดุล · ชุดเต็ม 62 ไฟล์ 359 ผ่าน · build + restart แล้ว
- ยังไม่ได้ทำ (แผนข้อ 4 ข้อ 4–5): pre-flight เทียบ GL 1104/2101 กับ aging ก่อนออกจดหมาย และ skill ฝั่ง prompt

### ✅ ชื่อรองของสินค้า — ยี่ห้อ B ใช้แทน SKU ยี่ห้อ A (ฝั่งซื้อ)
โจทย์: ของหมดเลยซื้อยี่ห้อ B ขนาดใกล้เคียงกันมาแทน A ผูกเข้า SKU A ด้วยมือครั้งแรกแล้ว ครั้งหน้าซื้อ B อีก ควรผูกให้เอง
- ตาราง `stock_item_aliases` (tenant, `name_norm` UNIQUE ต่อบริษัท, `stock_item_id`, `source_ref` = GR ที่ยืนยันครั้งแรก, ผู้ยืนยัน) · helper ทั้งหมดอยู่ใน `services/stockItem.service.ts`
- **จำตอนยืนยันใบรับของ** (คนเห็นของจริงแล้ว) ไม่ใช่ตอนผูกในร่าง PO: ชื่อบรรทัด PO ไม่ตรงกับชื่อ SKU ที่ผูก → `rememberAlias` (ผูกใหม่เป็นตัวอื่นแล้วยืนยัน = ทับของเดิม)
- **stock log จดชื่อจริง:** `stock_movements.notes` = `รับ "นมข้นหวาน ตรา B" · Received from purchase` ดูหน้าเคลื่อนไหวของ SKU A แล้วรู้ว่ารอบไหนรับยี่ห้อไหน (ใช้แทนการแยก SKU ตอนต้องย้อนหาล็อต)
- **ผูกให้เอง:** PR/PO ฝั่งซื้อ (MCP `matchStockItem` rawOnly + เว็บ `resolveMaterialId`) ลำดับ ชื่อ SKU ตรงเป๊ะ → ชื่อรอง → ไม่ผูก · ตาราง binding โชว์ "ผูกจากความจำ — ใช้แทน … (ยืนยันครั้งแรกใน GR-xxx) ถ้าไม่ใช่ให้ผูกใหม่" · **ฝั่งขายไม่ใช้** (ใบกำกับภาษีขายต้องตรงของจริง)
- **1 ชื่อ = 1 ที่:** ชื่อรองไม่ซ้ำกันเอง (UNIQUE) และไม่ซ้ำชื่อสินค้าหลักที่ยังใช้งาน (ไม่จำ ถ้าชนชื่อ SKU อื่น) · ชื่อ SKU ตรงเป๊ะชนะชื่อรองเสมอ · SKU ปลายทาง INACTIVE = ไม่ใช้ชื่อรองนั้น
- **สร้างสินค้าใหม่ชื่อชนชื่อรอง** (`POST /stock`, `POST /materials`) → 409 `ALIAS_CONFLICT` · หน้าเว็บ (`postWithAliasCheck` ใน `frontend/src/services/api.ts`) ถาม OK = แยกเป็นสินค้าใหม่ (ลบชื่อรอง) · Cancel = ใช้เป็นชื่อรองต่อ ไม่สร้าง · ทางอื่น (import, LINE bot) ไม่ถาม แต่ปลอดภัยเพราะชื่อ SKU ตรงชนะชื่อรองอยู่แล้ว
- เรื่องหน่วย/ขนาด: ไม่เก็บหน่วยใน key ตามที่ตกลง (ของในตลาดขนาดใกล้เคียงกัน อนุโลมได้) · ถ้าหน่วยต่างจนแปลงไม่ได้ ยืนยัน GR ติด `NO_CONVERSION` อยู่แล้ว เป็นด่านกันสุดท้าย
- 🐛 แก้ไปด้วย: `matchStockItem` เดิมกรอง `status = 'ACTIVE'` → ของที่ "หมด" (OUT 28 ตัว / LOW / ADEQUATE) ผูกด้วยชื่อตรงไม่ได้ → เปลี่ยนเป็น `!= 'INACTIVE'` (INACTIVE คือสถานะปิดใช้ตัวเดียว) · ลบ try/catch อ่าน `purchase_order_items.unit` แบบ schema เก่าใน confirm GR (คอลัมน์มีแล้ว = โค้ดตาย)
- ยังไม่มี: หน้าจอดู/ลบชื่อรองโดยตรง (ตอนนี้แก้ได้ด้วยการผูกใหม่แล้วยืนยัน GR หรือสร้าง SKU ชื่อนั้นแยก)
- เทสต์ `services/stockItemAlias.test.ts` 5 ตัว · ชุดเต็ม 63 ไฟล์ 364 ผ่าน · build backend+frontend + restart แล้ว · migration รันบน production แล้ว


---

## 📅 Session Log — 12 ตุลาคม 2026 (ของไม่นับสต็อกลงบัญชีผิดฝั่ง + แผน MCP instructions)

### ✅ ของไม่นับสต็อก (`skip_stock`) ลงบัญชีค่าใช้จ่ายแยกหมวด — commit `87b9f7a`
- บั๊ก: ใบแจ้งหนี้ซื้อ Dr 1107 สต็อกวัตถุดิบเต็มก้อน รวมบรรทัด `skip_stock` (น้ำมัน/ของใช้/บรรจุภัณฑ์) → 1107 พองเกินของจริง และ Phopy Board (Executive overview) ไม่เห็นค่าใช้จ่ายกลุ่มนี้ใน KPI/OPEX/กำไร (เห็นแค่ในก้อน "ไม่ระบุหมวด" ที่อ่านจาก PO)
- แก้: `purchase_order_items.expense_account_id` เลือกต่อบรรทัด (ว่าง = 5403) · `purchaseBilling.service.ts` Dr แยกตามบัญชีตามสัดส่วน (รวมส่วนลด/VAT ขอคืนไม่ได้) · บัญชีใหม่ 5313 ค่าวัสดุสิ้นเปลือง · Phopy Board ตัด skip_stock ออกจากก้อนซื้อตามหมวด · MCP `create_draft_po`/`update_purchase_order` รับ `expenseAccountCode` และไม่ทิ้ง skip_stock/notes
- ข้อมูลย้อนหลัง: `scripts/classifyNonStockLines.js` จัดหมวด 62 บรรทัด + `scripts/reclassSkipStockInvoices.js` JV `PURCHASE_INVOICE_RECLASS` 19 ใบ ฿7,992.43 (tenant_bb_pillow) ลงแล้ว
- ค้าง: 7 บรรทัดหมวดไม่ชัด (ถุงเท้า ELLE, DIY, ลูกบอลตกแต่ง) อยู่ 5403 รอเจ้าของยืนยัน · GL 1107 (48,787) ต่ำกว่ามูลค่าสต็อกจริง (49,514) ฿726 ยังไม่กระทบยอด — เริ่มดูจาก 5 ใบที่ย้ายได้ไม่เต็มเพราะส่วนต่างค้างใน 2109

### 📌 แผน: MCP `instructions` + `get_erp_guide` (✅ ทำแล้ว 26 ต.ค. 2026 — ดู Session Log 26 ต.ค.)
สภาพตอนนี้: `mcp/server.ts` สร้าง `new McpServer({ name, version })` เฉย ๆ ไม่มี `instructions` และไม่มี resources · มี 44 tools ซึ่งคำอธิบาย tool ทั้งหมดถูกส่งให้ agent ทุก request อยู่แล้ว

เทียบทางเลือก:

| | `instructions` | Schema Resources | tool `get_erp_guide(topic)` |
|---|---|---|---|
| ใครโหลด | client ใส่ system prompt ให้อัตโนมัติตอนเชื่อมต่อ | client/ผู้ใช้เลือกแนบเอง | โมเดลเลือกเรียกเอง |
| กิน token | ทุก request (มัก cache ได้) | เฉพาะตอนถูกอ่าน | เฉพาะตอนเรียก |
| agent เห็นแน่ไหม | แน่ | ไม่แน่ (หลาย client ไม่อ่าน resource) | บ่อยกว่า resource มาก |

ตัดสินใจ: ทำ 2 ชั้น — **ไม่ทำ resources** จนกว่าจะมี client ที่ใช้อยู่จริงและอ่าน resource แน่
1. `instructions` สั้น ~300–500 token: กฎเหล็ก 5–8 ข้อจากด่านที่ระบบบังคับอยู่แล้ว เช่น หา SKU ด้วย search ก่อนผูก · ของไม่นับสต็อกต้อง `skipStock` + `expenseAccountCode` · หน่วยต้องมีกฎแปลง · PO/PR ที่สร้างเป็นร่างเสมอ (approval gate) · tool บัญชีเห็นเฉพาะ MASTER/ADMIN · ถ้าต้องการรายละเอียดให้เรียก `get_erp_guide`
2. `get_erp_guide(topic)` read-only: schema ย่อ, กฎหน่วย 3 ชั้น, ผังบัญชีค่าใช้จ่าย, flow PO→GR→PI
- ก่อนลงจริง: วัดขนาด token ของ instructions + ทดสอบกับ Claude client จริงว่าโผล่ใน system prompt
- ข้อควรจำ: context ช่วยลดการเรียกผิด แต่แทนด่านตรวจฝั่ง server ไม่ได้ (บั๊กเก่าแบบ "ข้าวโพด" → "สลัดทูน่าข้าวโพด" หายเพราะ guard ไม่ใช่เพราะ context)

### ✅ แก้ไข Chart of Accounts: ยอดเงิน Root Account 1-5 Rollup และ 10 รายการล่าสุดใน Drawer
- **ปัญหา:** หน้า Chart of Accounts เดิมไม่คำนวณยอดสะสมของ Root Accounts (หมวด 1-5) และบัญชีแม่ที่มีย่อย ทำให้ยอดเงินหมวด 5 (ค่าใช้จ่าย) และหมวดอื่นๆ แสดงเป็น 0 หรือว่างเปล่า และใน Drawer ด้านขวายังไม่มีประวัติ 10 รายการล่าสุด
- **การแก้ไข:**
  - `backend/src/routes/reports.routes.ts`: ปรับปรุง endpoint ให้คำนวณยอดดุลแบบ Rollup จากลูกหลานทุกระดับขึ้นมาที่ Root/Parent Account และเพิ่มฟิลด์ `recent_transactions` ดึง 10 รายการเคลื่อนไหวล่าสุดพร้อม badge ระบุรหัสบัญชีย่อย
  - `frontend/src/pages/Accounting/ChartOfAccounts.tsx`: แสดงยอดรวมของบัญชีระดับ Root ทุกหมวด และแสดง 10 ธุรกรรมล่าสุดพร้อม badge ใน Drawer รายละเอียด
  - Build backend (`tsc`) + frontend (`vite build`) และ deploy รันบน LXC 100 เรียบร้อย

### 🎯 แผนยกระดับ CRM เป็น AI-Native CRM (ศึกษาเปรียบเทียบ Relaticle)

จากการวิเคราะห์สถาปัตยกรรมของ [Relaticle](https://github.com/relaticle/relaticle) (Open-source AI-native CRM) เปรียบเทียบกับ Phopy Mini-ERP/CRM ในปัจจุบัน ได้ข้อสรุปส่วนต่างและฟีเจอร์สำคัญ 6 ด้าน:

1. **Company vs People (1:N Contact Model):**
   - *สถานะปัจจุบัน:* Phopy รวมนิติบุคคลและผู้ติดต่อเป็น record เดียวใน `customers` (เหมาะกับ B2C / SME ซื้อง่ายขายคล่อง)
   - *สิ่งที่ต่าง:* Relaticle แยก `companies` กับ `contacts` (1 บริษัทมีหลายผู้ติดต่อ: ฝ่ายจัดซื้อ, การเงิน, ผู้บริหาร)
   - *ทิศทาง:* เพิ่มตาราง `customer_contacts` 1:N รองรับเมื่อขยายงานลูกค้าระดับองค์กร/โรงงานใหญ่

2. **Sales Pipeline & Opportunity Tracking (Lead/Deal Stages & Stale Days):**
   - *สถานะปัจจุบัน:* Phopy มี Document Flow (Quotation → Sales Order → Invoice) ชัดเจน แต่ยังไม่มี Sales Pipeline ก่อนออกใบเสนอราคา
   - *สิ่งที่ต่าง:* Relaticle มี Opportunity Kanban (Lead, Discovery, Proposal, Won/Lost) พร้อม Stale Alerts (แจ้งเตือนดีลที่ค้างนิ่งเกิน X วัน)
   - *ทิศทาง:* เพิ่ม Deal Stage และตัวนับ Stale Days ก่อนถึงขั้นตอนใบเสนอราคา

3. **Task Management & Follow-up Reminders (งานติดตามลูกค้า):** ⭐ *(User เลือก: กำหนดทำในแผนพัฒนา)*
   - *สถานะปัจจุบัน:* ยังไม่มีระบบบันทึก Task/สิ่งที่ต้องทำติดตามลูกค้าสำหรับทีมขาย
   - *สิ่งที่ต่าง:* Relaticle มี Actionable Tasks ผูกกับลูกค้า/ดีล มี Due Date, Assignee, Priority, Status (Todo, In Progress, Done)
   - *แนวทาง Phopy:* สร้างตาราง `crm_tasks` (customer_id, title, due_date, assigned_to, status, priority, reminder_at) แสดงบนหน้าลูกค้าและมีกระดานสรุปงานที่ต้องตาม

4. **Dynamic Custom Fields (ฟิลด์ยืดหยุ่นปรับแต่งเองได้):** ⭐ *(User เลือก: กำหนดทำในแผนพัฒนา)*
   - *สถานะปัจจุบัน:* ตาราง `customers` เป็น static schema (มีเฉพาะ `notes` และ `tags` แบบง่าย)
   - *สิ่งที่ต่าง:* Relaticle รองรับ Custom Properties ยืดหยุ่นตามประเภทธุรกิจ (เช่น ขนาดโรงแรม, จำนวนห้อง, รอบสั่งซื้อประจำ)
   - *แนวทาง Phopy:* เพิ่ม JSON column `custom_fields` ใน `customers` หรือตารางนิยาม schema ย่อย ช่วยให้แต่ละ tenant เก็บข้อมูลเฉพาะทางของลูกค้าได้โดยไม่ต้อง migrate schema ทุกครั้ง

5. **Unified Activity Timeline & Safety Buffer (ประวัติกิจกรรมรวมศูนย์และระบบถอยหลัง):** ⭐ *(User เลือก: กำหนดทำในแผนพัฒนา)*
   - *สถานะปัจจุบัน:* กิจกรรมกระจายอยู่ตามเอกสาร (Orders, Quotations, Invoices) ไม่มีหน้าเดียวที่รวมทุกความเคลื่อนไหว
   - *สิ่งที่ต่าง:* Relaticle รวมทุกการกระทำเป็น Unified Activity Feed (โทร, นัดหมาย, ส่งอีเมล, แก้ไขข้อมูล, สถานะเปลี่ยน) พร้อมระบบ Event Log / Safety Buffer
   - *แนวทาง Phopy:* สร้างตาราง `customer_activities` รวมประวัติการโทร, แชท, นัดหมาย, สเตตัสเปลี่ยน, บันทึกการพบลูกค้า ให้เซลส์เปิดโปรไฟล์ลูกค้าแล้วเห็นไทม์ไลน์ 360 องศา

6. **Field-Level Audit Trail + Approval System Link (บันทึกประวัติการแก้ระดับฟิลด์ + เชื่อม Approval Gate):** ⭐⭐ **(Priority สูงสุด — ต้องทำทันที!)**
   - *เหตุผลความจำเป็น:* Phopy มีระบบ **Multi-level Approval Gate** อยู่แล้ว (`approval_requests`, `approval_settings`, `services/approvalGate.service.ts`) สำหรับ PO/SO แต่การแก้ไขข้อมูลสำคัญของลูกค้า (เช่น วงเงินเครดิต `credit_limit`, เทอมชำระ `credit_days`, เลขภาษี `tax_id`, หรือสถานะ VAT) ยังสามารถแก้ตรงได้ทันทีโดยไม่มี audit log รายละเอียดและไม่มีการขออนุมัติ
   - *การเชื่อมต่อ (ทำได้ทันที ไม่ซับซ้อน):*
     1. **Audit Trail Table:** สร้าง `customer_audit_logs` (tenant_id, customer_id, field_name, old_value, new_value, changed_by, changed_at, reason, approval_request_id)
     2. **เชื่อม Approval Gate เดิม:** เมื่อมีการขอแก้ฟิลด์ Sensitive (วงเงินเครดิต, เทอมเครดิต, เลขภาษี) ให้ intercept ผ่าน `approvalGate.service.ts` สร้าง `approval_request` ประเภท `CUSTOMER_CREDIT_CHANGE` หรือ `CUSTOMER_SENSITIVE_EDIT`
     3. **Pending Changes:** ข้อมูลที่ยังไม่อนุมัติจะถูกพักไว้ใน pending buffer หรือ request payload เมื่อผู้มีอำนาจกดอนุมัติในระบบเดิม จึงจะ commit ค่าใหม่ลง `customers` และเขียนลง `customer_audit_logs`
     4. สำหรับฟิลด์ทั่วไป (เบอร์โทร, ที่อยู่, ชื่อผู้ติดต่อ) บันทึกลง `customer_audit_logs` ทันทีเพื่อความโปร่งใสโดยไม่ต้องขออนุมัติ

---

### 📋 สรุป Roadmap ลำดับความสำคัญ (ตามนโยบายผู้บริหาร)
- 🚀 **ระยะที่ 1 (เริ่มทันที):** ข้อ 6 — **Field-Level Audit Trail + Approval System Link** (ใช้ระบบอนุมัติเดิมที่เสร็จสมบูรณ์แล้วมาควบคุมการแก้ไขฟิลด์สำคัญ เช่น วงเงินเครดิต เทอมเครดิต และเลขประจำตัวผู้เสียภาษี)
- 📦 **ระยะที่ 2 (กำหนดทำในลำดับถัดไป):** ข้อ 3 (Tasks & Follow-up), ข้อ 4 (Custom Fields), ข้อ 5 (Unified Timeline)
- ⏳ **ระยะที่ 3 (ระยะยาวตามความจำเป็น):** ข้อ 1 (1:N Contacts), ข้อ 2 (Deal Pipeline)


---

## 📅 แผน — 12 ตุลาคม 2026 (นำราคา v2 จาก `Phopy_Price.xlsx` เข้าระบบ: Base + Pack + Add-on)

ที่มา: `Phopy_Price.xlsx` ชีต "แพ็กเกจ v2" / "Add-ons" / "คำนวณราคา" — 6 แพ็ก (Free 0 / Solo 299 / Business 690 / Business+ 950 / Pro 1,950 / Enterprise AI 3,490) + 4 Pack (Shop / Online / Maker / Accounting) + Add-on (User, Pack, Smart Unit, Multi-Currency, Subcontract, API, Backup, MCP key, LINE Bot, AI Credits)

### สภาพระบบตอนนี้ (สำรวจแล้ว)
- มีโครงอยู่แล้ว: `subscription_plans` (features เป็น JSON array + max_users/max_products/max_pos_shifts) · `tenant_subscriptions` (1 แถวต่อ tenant) · `services/subscription.service.ts` (`getSubscription` / `hasFeature` / `getLimits`) · `middleware/subscription.middleware.ts` (`subscriptionGate(feature)` → 403 `FEATURE_LOCKED`) · MasterPanel แก้แพ็ก/ต่ออายุได้ · frontend `api.ts` toast error code
- แพ็กที่ seed อยู่ใน DB จริง = ราคา v0 (free / starter 990 / business 2,490 / enterprise 5,990) ไม่ตรงทั้ง v1 และ v2
- tenant จริง: enterprise ACTIVE 3 (grandfather จาก backfill) · starter 1 · free 1
- **ช่องโหว่ที่ต้องแก้ก่อนขาย v2:**
  1. ไม่มีแนวคิด "Pack ที่ลูกค้าเลือก" และ "Add-on" — features ผูกกับแพ็กอย่างเดียว
  2. feature key หยาบเกินไป: `accounting` คุมทั้ง settlement / currencies / clearing · `pos` รวมกะและนำส่งเงิน · `work_orders` รวม subcontract — แต่ v2 แยกขายเป็นคนละ Pack/Add-on
  3. `platform-settlement` ถูก gate ด้วย `accounting` แต่ v2 จัดเป็น **Pack Online**
  4. route ที่ยังไม่ gate เลย: `/api/approval`, `/api/qc`, `/api/phopy-board`, `/api/backup`, `/api/kanban`, `/api/line` (ใช้ `subscriptionGate()` = เช็คแค่หมดอายุ หรือไม่มี gate)
  5. MCP quota = `max_users` ของแพ็ก และมี scope แค่ full/readonly — v2 ต้องการจำนวน key ตามแพ็ก + scope 3 ระดับ (อ่าน / Draft / เขียน) + โควตา call ต่อ key ต่อเดือน + tool เฉพาะโมดูลที่แพ็กมี
  6. frontend ไม่รู้ features — เมนูที่ล็อกยังโชว์ กดแล้วค่อยโดน 403

### ลำดับที่จะเริ่ม (เรียงตามสิ่งที่อย่างอื่นต้องพึ่ง)

**ระยะ 0 — แคตตาล็อก feature key (เอกสาร ไม่มีโค้ด) ← เริ่มตรงนี้**
แตกแถวใน Excel ให้เป็น key ระดับที่ขายแยกได้ แล้วผูกกับ route:

| key | แถวใน Excel | route ปัจจุบัน | ขายใน |
|---|---|---|---|
| `pos_shift`, `pos_clearing`, `pos_bom`, `kds` | POS Shift / Clearing / POS-BOM / KDS | `/api/pos/*` (แยก sub-route), `/api/clearing`, `/api/pos/kds` | Pack Shop |
| `settlement` | Shopee/Lazada Settlement | `/api/platform-settlement` | Pack Online |
| `bom`, `work_orders`, `qc`, `cost_calc` | BOM / WO / QC / Calculator | `/api/bom`, `/api/work-orders`, `/api/qc`, `/api/calculator` | Pack Maker |
| `accounting`, `tax` | ผังบัญชี JE TB Budget ปิดงวด VAT WHT CIT | `/api/accounts`, `/api/journal`, `/api/period-closing`, `/api/budgets`, `/api/tax`, `/api/wht-certificates` | Pack Accounting |
| `subcontract` | Subcontract | `/api/subcontracts` | Add-on 290 (ต้องมี Maker) |
| `multi_currency` | Multi-Currency | `/api/currencies` | Add-on 390 |
| `smart_unit` | Smart Unit | ใน stock service (ไม่ใช่ route แยก — ต้อง gate ที่ service) | Add-on 190 / Pro+ |
| `credit_note`, `crm_activity`, `stock_adjust`, `sku_alias` | ใบลดหนี้ / Activity / ปรับสต็อก / Alias | ย่อยใน `/api/sales`, `/api/activities`, `/api/stock` | Solo+ |
| `ar_aging`, `ap_aging`, `pr`, `approval`, `kanban_sso` | AR/AP Aging / PR / Approval / Kanban | `/api/receivables`, `/api/purchase-requests`, `/api/approval`, `/api/kanban` | Business+ |
| `phopy_board` | Phopy Board | `/api/phopy-board` | Business+ ขึ้นไป |
| `backup`, `api_access` | Backup / API & Webhook | `/api/backup`, `/api/agent` | Add-on |

**ระยะ 1 — โมเดลข้อมูล + จุดคำนวณจุดเดียว (backend)**
- เพิ่มคอลัมน์ใน `tenant_subscriptions`: `packs` (JSON เช่น `["shop","accounting"]`), `addons` (JSON เช่น `{"extra_users":1,"smart_unit":true,"mcp_keys":3,"line_bot":"lite"}`)
- ตาราง/ค่าคงที่ `PACK_FEATURES` (shop/online/maker/accounting → feature keys) ในโค้ด ไม่ต้องทำตาราง DB — เปลี่ยนน้อย
- `subscription_plans` เพิ่มคอลัมน์ `included_packs` (0/1/2/4), `included_mcp_keys`, `mcp_scope` (read/draft/write/full), `mcp_calls_per_key`
- แก้ `getSubscription()` ให้คืน **effective features** = แพ็ก ∪ Pack ที่เลือก ∪ Add-on และ `maxUsers` = แพ็ก + extra_users — ทุก gate (`subscriptionGate`, `hasFeature`, `getLimits`, MCP quota) วิ่งผ่านฟังก์ชันนี้อยู่แล้ว แก้ที่เดียวพอ
- validate ที่ MasterPanel/route: จำนวน Pack ≤ `included_packs` + pack ที่ซื้อเพิ่ม · Solo ซื้อ Pack ไม่ได้ · Subcontract ต้องมี Maker · เพดาน user (Solo +1, Business ≤5, Business+ ≤10)
- seed 6 แพ็กใหม่ด้วย code ใหม่ (`free`, `solo`, `business_v2`, `business_plus`, `pro`, `enterprise_ai`) แบบ `INSERT OR IGNORE` · แพ็กเก่าตั้ง `is_active=0` ไม่ลบ (tenant เดิมยังอ้างอยู่)
- test: `subscription.service` effective features ครบทุกแพ็ก × Pack (รันด้วย `SQLITE_DB_PATH=/tmp/x.db`)

**ระยะ 2 — ซอยด่านใน `index.ts`**
- เปลี่ยน `subscriptionGate('accounting')` ของ settlement → `settlement`, currencies → `multi_currency`, subcontracts → `subcontract`
- ใส่ key ให้ route ที่ยัง gate ว่าง: approval, qc, phopy-board, backup, kanban
- POS: ตอนนี้ `maxPosShifts` เป็นตัวเลขของแพ็ก → เปลี่ยนเป็น "ไม่มี `pos_shift` = 1 กะ/วัน" ตาม Excel แถว 18
- ฟีเจอร์ที่อยู่ในไฟล์ route เดียวกัน (ใบลดหนี้ใน `/api/sales`, ปรับสต็อกใน `/api/stock`, smart unit ใน service) ใส่ `hasFeature()` ที่ handler
- **ก่อน deploy:** ย้าย tenant เดิมไปแพ็ก v2 ก่อน (enterprise → `enterprise_ai`, starter → ตกลงกับลูกค้า, free → `free`) ไม่งั้นฟีเจอร์ที่ใช้อยู่หายทันที

**ระยะ 3 — Frontend รู้แพ็ก**
- endpoint `GET /api/subscription/me` คืน plan, packs, addons, effective features, limits
- ซ่อน/ล็อกเมนู sidebar ตาม features (แสดงกุญแจ + ปุ่ม "อัปเกรด" แทนการซ่อนเงียบ — เป็นช่องขาย)
- หน้า Settings แสดงแพ็ก + Pack + Add-on ปัจจุบัน
- MasterPanel: เลือก Pack / ติ๊ก Add-on / จำนวน user/key ต่อ tenant + แสดงยอดรวม/ด. และคำแนะนำ "≥ 85% ของแพ็กถัดไป → แนะนำอัปเกรด" (สูตรเดียวกับชีตคำนวณราคา)

**ระยะ 4 — MCP ตามแพ็ก**
- quota = `included_mcp_keys` + `addons.mcp_keys` แทน `max_users` (แก้ทั้ง `mcpSettings.routes.ts` และ `mcp/server.ts resolveTenant` — โค้ดคำนวณซ้ำกันอยู่ 2 ที่ ควรรวมเป็นฟังก์ชันเดียวใน subscription.service)
- scope 3 ระดับ: `read` (Solo) / `draft` (Business, Business+ — สร้างได้แค่ร่าง QT/PO/PR) / `write` (Pro — post เอกสาร, JE ผ่าน Approval) / `full` (Enterprise) — ต่อยอดจาก `mcp_scope` เดิม
- `registerTools` กรอง tool ตาม effective features (เช่น ไม่มี Pack Accounting → ไม่เห็น tool บัญชี)
- นับ call ต่อ key ต่อเดือน (ตาราง `mcp_usage(tenant_id, user_id, month, calls)`) และตัดที่โควตา

**ระยะ 5 — Add-on ที่ต้องมีระบบนับ/คิดเงิน (ทำทีหลัง เมื่อมีลูกค้าซื้อจริง)**
- LINE Bot tier (Notify / Lite / Staff / Full) — มี `line-bot.service.ts` แล้ว แค่ gate ความสามารถตาม tier + จำนวนคน LINE
- AI Credits — ต้องมีตารางยอดเครดิต + log ต้นทุน token จริง (Excel ระบุตั้งราคา ≥ 3 เท่าต้นทุน) · Pro 200 / Enterprise 2,000 ต่อเดือน หมดอายุสิ้นเดือน
- API / Webhook โควตา 10k calls · Backup รายสัปดาห์ vs รายวัน (มี `backup.service.ts` แล้ว)
- ราคารายปี (จ่าย 10 เดือน) — ตอนนี้คิดเงินมือผ่าน MasterPanel อยู่แล้ว ยังไม่ต้องมี payment gateway

### ข้อตัดสินใจที่ต้องให้เจ้าของยืนยันก่อนเริ่มระยะ 1
- tenant `starter` (990) ย้ายไปแพ็กไหน และ tenant enterprise 3 ราย ใช้ `enterprise_ai` แบบ grandfather ราคาเดิมหรือไม่
- ลูกค้าเลือก Pack เองตอนสมัคร (signup) หรือ MASTER ตั้งให้
- ล็อกเมนูแบบโชว์กุญแจ (แนะนำ) หรือซ่อน

---

## 📅 แผน — 13 ตุลาคม 2026 (ช่องทางขาย Shopee / Lazada: รอบเดือนผ่าน MCP แทนอัปโหลด CSV)

> ต้นแบบหน้าจอ (artifact): https://claude.ai/artifact/EwQmBJcXjkEnBTPsmBmyHV — ใช้ token สีจาก `frontend/src/index.css`
> **Lazada:** ยังไม่มีไฟล์ตัวอย่าง เจ้าของกำลังหา — ออกแบบตาม Shopee ไปก่อน โครงตาราง/MCP ต้องมีคอลัมน์ `platform` ไว้ อย่าผูกชื่อคอลัมน์ Shopee ตายตัวในตรรกะบัญชี

### ข้อตกลงกับเจ้าของ
- **ไม่อัปโหลด CSV ผ่านหน้าเว็บแล้ว** — แนบไฟล์ใน Claude แล้วส่งเข้าผ่าน MCP · ลบช่องอัปโหลดทั้งใน `Marketing.tsx` และ `Accounting/PlatformSettlement.tsx`
- **แยกหน้าตามหน้าที่เหมือนเดิม** (Settlement แตะ GL / Marketing ดูอย่างเดียว) แต่ข้อมูลเข้าทางเดียว = "รอบเดือน" 1 รอบต่อร้านต่อเดือน
- **MCP สร้างได้แค่ร่าง** — ตัดสต็อกและลงบัญชีต้องให้คนกดยืนยันในเว็บ
- ส่งเข้า MCP **เฉพาะตัวเลขที่ใช้** ไม่ส่งไฟล์ทั้งไฟล์ (Income ดิบ 1,543 แถว × 48 คอลัมน์ ≈ 200k token เกินไป · ส่งแบบสรุปทั้งเดือน < 30k token)
- ตัดออกจากขอบเขต: SOM, SAW, MER, คำแนะนำงบโฆษณาอัตโนมัติ

### 5 ไฟล์ต่อเดือน (Shopee — ทุกไฟล์ช่วงเดือนปฏิทินเดียวกัน)
| ไฟล์ | เมนู Seller Centre | ใช้ทำ |
|---|---|---|
| `Income.โอนเงินสำเร็จ` | การเงิน › รายรับของฉัน | ยอดขายเต็ม + ค่าธรรมเนียมทุกตัว + ชีต Adjustment |
| `my_balance_transaction_report` | การเงิน › ยอดเงินของฉัน | ถอนเข้าธนาคาร (รายครั้ง) + ยอดกระเป๋า |
| `parentskudetail` | ข้อมูลธุรกิจ › สินค้า | ชิ้นที่ขายแยก **รหัสตัวเลือก** → จับคู่ SKU → ตัดสต็อก → COGS + ยกเลิกรายสินค้า |
| `ข้อมูล-Shopee-Ads` (รายเดือน) | Shopee Ads › รายงาน | ค่า Ads + ROAS (**ไม่ใช้ลงบัญชี**) |
| `shop-stats` | ข้อมูลธุรกิจ › ภาพรวม | ยอดรายวัน, ยกเลิก, ลูกค้าใหม่/เดิม, funnel |
| (ไม่บังคับ) GMV Max ข้อมูลเชิงลึก | Shopee Ads › GMV Max | ค่า Ads รายสินค้าแบบแม่น แทนการแบ่งตามยอดขาย |

ไม่ใช้: Order "ที่ต้องจัดส่ง" (ไม่มีรหัสสินค้า มีแค่ชื่อ, ใช้แพ็กของอย่างเดียว), Keywords, กลุ่มโฆษณา

### ข้อเท็จจริงจากไฟล์จริง ร้าน bebozch (10/9–12/10) — ใช้เป็น golden test
- สมการตรวจข้ามไฟล์ (ผ่านทั้ง 4): Income `601,041 − 195,461 = 405,580` · Income โอนแล้ว = Balance เงินเข้าจากออเดอร์ `406,047 − 467` · ปรับปรุง `−486 = +535 − 1,021` · parentskudetail ยอดยืนยัน = shop-stats `586,743`
- ค่าธรรมเนียม 32.5% ของรายได้: คอม 96,522 · บริการ 51,404 · ธุรกรรม 27,300 · **AMS (Affiliate) 11,691** · **Ads หักจาก Escrow 6,307** · โครงสร้างพื้นฐาน 1,538 · ค่าส่งสุทธิ 699
- ค่า Ads ทั้งเดือน 66,112 แต่หักจาก Escrow แค่ 6,307 → **59,805 เติมเงินเองนอกระบบ ไม่อยู่ในไฟล์ไหน** ต้องลงจากใบเสร็จเติมเงิน
- ถอนเข้า SCB 10 ครั้ง 402,846 · เงินค้างกระเป๋าเพิ่ม 2,248 = `405,580 − 486 − 402,846` พอดี
- Shopee **ไม่มีรหัส SKU สักตัว** (945 ตัวเลือก) — ขายได้จริง 411 ตัวเลือก 2,228 ชิ้น
- tenant `tenant_msqy2xbn` (หจก.เอฟแอนด์บี เบดดิ้ง, `vat_registered=1`): สินค้า 1,024 มีทุน 97 · มีสต็อก 0 · BOM 0 สูตร

### บั๊ก/ช่องโหว่ที่เจอในโค้ดปัจจุบัน (ยังไม่แก้)
- `platformSettlement.service.ts` `previewSettlementCsv` อ่านได้แค่ CSV หัวตารางแถวแรก — Income เป็น xlsx หัวแถว 6
- alias ค่าธรรมเนียมไม่รู้จัก "ค่าธุรกรรมการชำระเงิน", "ค่าคอมมิชชั่น AMS", "เติมเงินโฆษณาจาก Escrow", "โครงสร้างพื้นฐานแพลตฟอร์ม", "จำนวนเงินทั้งหมดที่โอนแล้ว (฿)"
- **Shopee ให้ค่าธรรมเนียมเป็นเลขติดลบ** → `totalFees > 0` เป็นเท็จ → **ข้ามการลง JV ค่าธรรมเนียมทั้งก้อน**
- ขั้น 3 สมมติว่า 1 รอบโอน 1 ครั้ง ส่วนต่างลง 5901 เงินขาด → ของจริงจะลงเงินขาด 2,248 ผิด (เงินยังอยู่ในกระเป๋า Shopee)
- ค่าธรรมเนียมลงค่าใช้จ่ายรวม VAT ทั้งก้อน — ถ้ามีใบกำกับภาษีจาก Shopee ต้องแยกภาษีซื้อ (ให้ phopy-accounting ตรวจ)
- `csvParser.service.ts` อ่านชื่อแคมเปญจาก `ชื่อโฆษณา / ชื่อสินค้า` (ไฟล์กลุ่มโฆษณา) แต่ไฟล์หลักใช้ `ชื่อโฆษณา` · สถานะใช้ `สถานะ` ไม่ใช่ `สถานะโฆษณา` · ยอดทั้งเดือนถูกกระจายลงวันสุ่ม → กราฟรายวันปลอม
- ยังไม่มีข้อมูลจริงเข้าเลย (`marketing_metrics` = 0, `platform_settlements` = 0) → รื้อได้ไม่ต้อง migrate

### เฟสงาน
| เฟส | งาน | เสร็จเมื่อ |
|---|---|---|
| **0** ข้อมูลตั้งต้น (ทำขนานได้) | ทุนสินค้าสำเร็จ · สต็อกยกมา · BOM ปิกนิก/ท็อปเปอร์ — งานเจ้าของ ใช้เครื่องมือนำเข้าที่มี | ไม่บล็อกเฟสอื่น แต่ถ้ายังไม่เสร็จ กำไร/COGS ไม่ใช่ตัวเลขจริง |
| **1** ฐานข้อมูลรายเดือน + MCP | `shopee_months` (1 แถว/ร้าน/เดือน เก็บสรุป 5 ไฟล์ + ผลตรวจสมการ) · `shopee_month_products` · `shopee_days` · MCP 2 ตัว `shopee_submit_file` (ระบุชนิดไฟล์) + `shopee_month_status` · ลบช่องอัปโหลด CSV 2 หน้า | ส่ง 5 ไฟล์ ต.ค. ผ่าน MCP แล้วสมการ 4 ข้อผ่าน |
| **2** จับคู่ SKU + ยืนยันการขาย | ใช้ `stock_item_aliases` ที่มีอยู่: `source_ref = SHOPEE:รหัสตัวเลือก`, `factor` = ตัวคูณแพ็ก (เช่น หมอน 2 ใบ) · หน้ายืนยันคู่ (MCP เสนอ คนยืนยัน) · ตัวที่ยังไม่ผูกบล็อกการยืนยันการขาย · ยืนยันแล้วตัดสต็อกทีละรายการผ่าน `applyStockMovement()` แตก BOM ด้วย `getBomIngredientsRecursive()` · อ้างอิงรอบ ยกเลิกได้ทั้งก้อน · เคารพ `allow_negative_stock` | ผูกครบ 411 ตัวเลือก ตัดสต็อกรอบ ต.ค. ได้ |
| **3** เชื่อมบัญชี | JV ขาย (Dr 1181 / Cr รายได้+VAT) · JV ต้นทุนขาย (จากเฟส 2) · JV ค่าธรรมเนียม · JV ปรับปรุง · JV ถอนเงินรายครั้ง (Dr ธนาคาร / Cr 1181) · แก้บั๊กเลขติดลบ + ขั้นเงินโอน · ค่าธรรมเนียมประเภทใหม่ 5 ตัว · phopy-accounting ตรวจ VAT ค่าธรรมเนียม + ค่า Ads ที่เติมเอง | ยอด 1181 = ยอดในกระเป๋า Shopee |
| **4** แดชบอร์ด | กำไรต่อชิ้นรายสินค้า (เลือกหัก: ทุน BOM / GP / Ads / Affiliate / ค่าส่งส่วนเกิน / คืนเงิน) · KPI 4 หมวด: ยอดขาย&กำไร (ยอดขาย, กำไร, มาร์จิ้น, AOV, %ยกเลิก) · ต้นทุนแพลตฟอร์ม (GP%, Affiliate, ค่าส่งส่วนเกิน) · โฆษณา (ROAS, TACoS, CTR, CPL) · ลูกค้า (CAC, AR=ทิ้งตะกร้า, CRR, CLV, CLV:CAC) · ช่วงย้อนหลัง **1/3/6/12 เดือนแบบเลื่อน** (รอบ ต.ค. 69 → 12 เดือน = พ.ย. 68–ต.ค. 69; 1 เดือน = กราฟรายวัน) · list ยกเลิกมากสุด / กำไรมากสุด / ขาดทุน | ดึงจากตารางรายเดือนเฟส 1 ไม่คำนวณไฟล์ซ้ำ |
| **5** ส่งข้อมูลย้อนหลัง (ไม่บังคับ) | ส่ง 5 ไฟล์ 11 เดือนก่อนผ่าน MCP ตัวเดิม — เก็บเป็นสถิติอย่างเดียว ไม่ตัดสต็อก ไม่ลงบัญชีย้อนหลัง | กราฟ 12 เดือนครบ |

ลำดับ: 0 ขนาน · 1 → (2 → 3) และ 1 → 4 ได้เลย (เฟส 4 ใช้แค่ข้อมูลเฟส 1 + ทุนจากเฟส 0)

### ค่าประมาณที่ต้องบอกผู้ใช้บนหน้าจอ
- GP/ค่าส่ง/คืนเงินรายสินค้า = อัตราเฉลี่ยทั้งร้าน (Income แยกเงินรายออเดอร์ แต่ไม่บอกว่าออเดอร์ขายอะไร)
- Ads รายสินค้า = แบ่ง GMV Max ตามสัดส่วนยอดขาย (แม่นขึ้นถ้าส่งไฟล์ GMV Max ข้อมูลเชิงลึก)
- CPL ใช้ "ผู้ที่อาจจะซื้อ" แทน Lead · CRR/CLV แม่นขึ้นเมื่อสะสมหลายเดือน

---

## 📅 Session Log — 13 ตุลาคม 2026 (ระบบ Subscription Phase 1-3 สำเร็จ + Security Hardening + Global Theme)

### 1. ระบบจัดการแพ็กเกจและการจำกัดสิทธิ์ (Subscription System Phase 1-3)
ดำเนินการสร้างและต่อยอดระบบแพ็กเกจ v2 ตามราคา `Phopy_Price.xlsx`:

- **Phase 1 (Data Model & Catalog Engine):**
  - ออกแบบแคตตาล็อกราคา v2 ใน `src/services/billing.catalog.ts` และ `src/services/subscription.features.ts`
  - รองรับโครงสร้าง Base Plan (Free, Solo, Business, Business+, Pro, Enterprise AI) + 4 Pack (Shop, Online, Maker, Accounting) + Add-ons (User, Smart Unit, Multi-Currency, Subcontract, Backup, API)
  - ปรับปรุง `tenant_subscriptions` เก็บ `packs` และ `addons` ในรูปแบบ JSON
  - ฟังก์ชัน `getSubscription(tenantId)` คำนวณ Effective Features (Plan ∪ Packs ∪ Addons) และ `maxUsers` แบบจุดเดียว
  - ระบบ Lazy Expiry จัดการสถานะ `ACTIVE` ที่เลยกำหนดให้เป็น `EXPIRED` ทันทีโดยไม่ต้องพึ่ง Cron

- **Phase 2 (Route-level Subscription Gates ใน Backend `index.ts`):**
  - ปรับปรุงด่านตรวจให้ตรงกับแคตตาล็อก v2:
    - `/api/currencies`: เปลี่ยนเป็น `subscriptionGate('multi_currency')` (Add-on หรือ Business+)
    - `/api/subcontracts`: เปลี่ยนเป็น `subscriptionGate('subcontract')` (Add-on หรือ Pro+)
    - `/api/qc`: ปรับเป็น `subscriptionGate('work_orders')` เพื่อผูกกับ **Pack Maker**
    - `/api/kanban`: เสริม `subscriptionGate()` เพื่อป้องกัน tenant หมดอายุออก SSO token ไป Planka
  - เพิ่มชุดทดสอบ `src/middleware/subscription.middleware.test.ts` (5 ผ่าน 5) ครอบคลุมสิทธิ์ Master, สิทธิ์ Free ถูกล็อก 403, และการปลดล็อกตาม Pack/Add-on

- **Phase 3 (Frontend รู้แพ็กเกจ & ล็อกเมนู):**
  - **Endpoint `GET /api/subscription/me`:** สร้างใน `src/routes/subscription.routes.ts` ให้ผู้ใช้ทุก role ดึงข้อมูลแพ็กเกจ, effective features, และ limits ได้แม้หมดอายุ (เทสต์ 2 ผ่าน 2)
  - **Menu Permission Matrix:** ใน `src/config/menuPermissions.ts` เพิ่ม `MENU_REQUIRED_FEATURES` และ `isMenuLocked` (เทสต์ 5 ผ่าน 5)
  - **Subscription Context:** สร้าง `src/contexts/SubscriptionContext.tsx` ให้บริการ `useSubscription()` ตรวจสอบฟีเจอร์แบบเรียลไทม์
  - **Sidebar UX:** ใน `src/components/layout/Sidebar.tsx` แสดงกุญแจ 🔒 + ป้าย "อัปเกรด" สำหรับเมนูที่ล็อก พร้อมระบบ Click Interceptor แสดง Toast และนำ Admin ไปหน้าต่ออายุ แทนการปล่อยให้เข้าหน้าว่างที่พัง 403
  - **Settings:** ใน `src/pages/Settings.tsx` หมวดทั่วไป แสดงชื่อแพ็กเกจ, สถานะ, และป้าย Pack ที่เปิดใช้งาน
  - **MasterPanel:** ใน `src/pages/MasterPanel.tsx` คำนวณยอดชำระโดยประมาณรายเดือนเรียลไทม์ พร้อมกล่องแนะนำ "≥ 85% ของแพ็กเกจถัดไป → แนะนำอัปเกรด" ตามสูตรคำนวณราคา

### 2. ความปลอดภัย (Security Hardening บน LXC 106 และ LXC 100)
- ติดตั้ง Real-IP restoration ผ่าน `CF-Connecting-IP` ใน Nginx reverse proxy
- บล็อก Dotfiles (`.env`, `.git`) ทั้งหมดด้วย HTTP 404
- ปิด `server_tokens off;`
- ติดตั้ง Strict CORS Whitelist แบบ Regex ใน `kanban.conf`
- MCP Server ปรับปรุงระบบยืนยันตัวตนให้อ่านจาก `Authorization: Bearer <key>` เป็นหลัก
- กักกันไฟล์แบ็กอัปประวัติศาสตร์ฐานข้อมูล `dev.db.bak*` 71 ไฟล์ไว้ใน `storage/backups/` (สิทธิ์ 700/600)

### 3. ตกแต่ง UI Global Theme & Auto Dark Mode (phopy.net, LXC 106)
- เพิ่มเอฟเฟกต์แสง Limelight & Aurora Mesh ทั่วทั้ง 16 หน้า HTML
- ติดตั้งระบบ Auto Dark Mode ตามค่าระบบเครื่องผู้ใช้ (`prefers-color-scheme: dark`) ควบคู่กับปุ่มสลับพระอาทิตย์/พระจันทร์ manual toggle

---

## 📦 สารบัญฟังก์ชันทั้งหมดของระบบและการจัดหมวดหมู่ตามแพ็กเกจ (Comprehensive Feature Catalog by Package)

ตารางรวบรวมฟังก์ชันและโมดูลทั้งหมดในระบบ Phopy ERP/CRM พร้อมการแมปด่านตรวจ (Gate), เส้นทาง API (Routes), หน้าจอผู้ใช้ (Frontend), และเครื่องมือ AI (MCP Tools) เพื่อใช้เป็นเกณฑ์ในการแบ่งแพ็กเกจขายอย่างเป็นทางการ:

| หมวดหมู่แพ็กเกจ | โมดูล / ฟังก์ชัน | Feature Key | Backend Routes | Frontend Menu / Page | MCP Tools ที่เกี่ยวข้อง | รายละเอียดความสามารถ |
|---|---|---|---|---|---|---|
| **Base Plan**<br>*(ทุกแพ็กเกจ)* | จัดการลูกค้า (CRM) | `crm` | `/api/customers`<br>`/api/customer-recommendations`<br>`/api/activities` | `/crm` | `get_customer_insights`<br>`get_lead_source_performance` | ทะเบียนลูกค้า, แท็กกลุ่มลูกค้า, บันทึกการโทร/นัดหมาย (Activity), ระบบวิเคราะห์และแนะนำสินค้า |
| **Base Plan** | งานขาย (Sales & Invoicing) | `sales` | `/api/orders`<br>`/api/sales` (11 sub-routes) | `/sales`<br>`/receivables` | `get_sales`, `get_orders`<br>`get_sales_orders`<br>`get_quotations`<br>`create_sales_order`<br>`create_invoice` | ใบเสนอราคา (QT), ใบสั่งขาย (SO), ใบส่งของ (DO), ใบแจ้งหนี้ (INV), ใบเสร็จรับเงิน (RE), ใบลดหนี้ (CN), ระบบ Backorders |
| **Base Plan** | งานจัดซื้อ (Purchasing) | `purchase` | `/api/purchase`<br>`/api/purchase-orders`<br>`/api/purchase-requests`<br>`/api/suppliers` | `/purchase` | `get_purchase_requests`<br>`get_suppliers`<br>`create_purchase_order`<br>`create_goods_receipt` | ใบขอซื้อ (PR), ใบสั่งซื้อ (PO), ใบรับสินค้า (GR), ใบแจ้งหนี้ผู้ขาย (PI), ทะเบียนผู้ขาย/ซัพลายเออร์, เช็คราคาซื้อย้อนหลัง |
| **Base Plan** | สต็อก & วัตถุดิบ (Stock Inventory) | `stock` | `/api/stock`<br>`/api/materials` | `/stock` | `get_stock_movements`<br>`search`<br>`adjust_stock` | คลังสินค้า, ทะเบียนวัตถุดิบและสินค้าสำเร็จรูป, รับเข้า/เบิกออก, ตรวจนับสต็อก, จุดสั่งซื้อซ้ำ (Reorder point), ทุนซื้อจริง (purchase_price/purchase_unit) |
| **Base Plan** | POS ขายหน้าร้าน (พื้นฐาน) | `pos` | `/api/pos` (menu, bill, shift) | `/cashier` | - | เปิดโต๊ะ/เปิดบิล, คิดเงิน, สแกน QR รับเงิน, พิมพ์ใบเสร็จ/สลิปย่อ, ลิ้นชักเก็บเงิน (จำกัด 1 กะ/วัน ใน Base) |
| **Base Plan** | รายงาน & Dashboard | `reports` | `/api/reports`<br>`/api/dashboard`<br>`/api/receivables` | `/`<br>`/receivables` | `get_summary`<br>`get_ar_aging`<br>`get_ap_aging` | แดชบอร์ดสรุปยอดขาย, สินค้าขายดี, ยอดคงเหลือสต็อก, รายงานลูกหนี้ค้างชำระ (AR Aging), เจ้าหนี้ค้างชำระ (AP Aging) |
| **Base Plan** | ระบบผู้ใช้ & ตั้งค่าองค์กร | *(ไม่มี gate)* | `/api/users`<br>`/api/settings`<br>`/api/data`<br>`/api/search`<br>`/api/import` | `/settings`<br>`/users` | - | ข้อมูลบริษัท, เลขประจำตัวผู้เสียภาษี, โลโก้, ฟอร์แมตเลขที่เอกสาร, นำเข้า/ส่งออกข้อมูล, ระบบสิทธิ์ตามแผนก |
| **Pack Shop** | จอแสดงผลในครัว (KDS) | `kds` | `/api/pos/kds` | `/kds` | - | จอรับออเดอร์ในครัว/บาร์น้ำ, ลำดับคิว, นับเวลาปรุงอาหาร, แจ้งเตือนเสียง, เด้งอัปเดตสถานะปรุงเสร็จ |
| **Pack Shop** | เปิด-ปิดกะไม่จำกัด | `pos` *(กะไม่จำกัด)* | `/api/pos` (shift routes) | `/cashier` | - | ปลดล็อกเพดานกะ (`maxPosShifts: null`), ส่งมอบกะระหว่างวัน, บันทึกเงินสดนำเข้า/นำออก (Cash In/Out) |
| **Pack Online** | กระทบยอด Shopee / Lazada | `platform_settlement` | `/api/platform-settlement` | `/accounting/platform-settlement` | `platform_month_status`<br>`platform_submit_file`<br>`list_marketing_shops` | นำเข้ารายงานเดือน E-commerce 5 ไฟล์, สมการตรวจยอดข้ามไฟล์ 4 ข้อ, แมปรหัสตัวเลือกกับ SKU (`stock_item_aliases`), ตัดสต็อกและแตกสูตร BOM อัตโนมัติ, บันทึก JV ค่าธรรมเนียมและรายได้ |
| **Pack Maker** | สูตรการผลิต (BOM) | `bom` | `/api/bom`<br>`/api/calculator` | `/bom`<br>`/calculator` | `explode_bom` | โครงสร้างสูตรการผลิตหลายระดับ (Multi-level BOM), คำนวณต้นทุนวัตถุดิบและค่าแรงต่อชิ้น, เครื่องคำนวณและจำลองสัดส่วนผลิต |
| **Pack Maker** | ใบสั่งผลิต (Work Orders) | `work_orders` | `/api/work-orders` | `/work-orders` | `production.ts` tools | ออกใบสั่งผลิต (WO), จองสต็อกวัตถุดิบ, บันทึกผลการผลิตจริงและของเสีย, ตัดสต็อกวัตถุดิบและรับสินค้าสำเร็จรูปเข้าคลัง |
| **Pack Maker** | ตรวจสอบคุณภาพ (QC) | `work_orders` | `/api/qc` | `/qc` | - | เกณฑ์การตรวจรับ (Checklists), บันทึกผลการตรวจสอบคุณภาพชิ้นงานเชื่อมโยงใบสั่งผลิตและล็อตสินค้า |
| **Pack Accounting** | ผังบัญชี & สมุดรายวัน | `accounting` | `/api/accounts`<br>`/api/journal`<br>`/api/journal` (`/:id/source`) | `/accounting/chart-of-accounts`<br>`/accounting/journal-entries` | `get_trial_balance`<br>`get_ledger`<br>`get_financial_summary` | ผังบัญชี 5 หมวด, สมุดรายวันทั่วไป (JV), สมุดรายวันซื้อ/ขาย/รับ/จ่าย, ตรวจสอบเอกสารต้นทางย้อนกลับ (Audit Drill-down) |
| **Pack Accounting** | ปิดงวดบัญชี & งบประมาณ | `accounting` | `/api/period-closing`<br>`/api/budgets` | `/accounting/period-closing`<br>`/accounting/budget-vs-actual` | - | ปิดงวดบัญชีรายเดือน/สิ้นปี, ล็อกการแก้ไขเอกสารย้อนหลัง, เทียบงบประมาณกับยอดใช้จริง (Budget vs Actual) |
| **Pack Accounting** | กระทบยอดเงินโอน & ตัดรอบ POS | `accounting` | `/api/clearing`<br>`/api/bank-accounts` | `/accounting/pos-clearing`<br>`/accounting/reconcile` | - | บัญชีพักเงิน 1180, กระทบยอดสลิปโอนเงินธนาคาร, ตรวจสอบยอดเงินขาด/เกินจากเครื่อง POS และช่องทางโอน |
| **Pack Accounting** | ภาษีมูลค่าเพิ่ม & ภาษีหัก ณ ที่จ่าย | `tax` | `/api/tax`<br>`/api/wht-certificates` | `/tax` | - | รายงานภาษีซื้อ (ภ.พ.30), รายงานภาษีขาย, ออกหนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ ภ.ง.ด.3, 53) |
| **Pack Accounting** | Phopy Board | `accounting` | `/api/phopy-board` | `/accounting/phopy-board` | - | แดชบอร์ดสุขภาพการเงินของผู้บริหาร, วิเคราะห์รายรับ-รายจ่าย, งบกำไรขาดทุนเรียลไทม์ |
| **Add-on** | แปลงหน่วยอัจฉริยะ (Smart Unit) | `smart_unit` | ใน `unitConversion.service.ts` | `/settings?tab=units`<br>UnitPicker modal | `check_unit_issues` | สายการแปลงหน่วยหลายทอด (ลัง → แพ็ค → โหล → ชิ้น), แยกหน่วยซื้อ vs หน่วยสต็อกอัตโนมัติ (แถมใน Pro / Enterprise AI) |
| **Add-on** | หลายสกุลเงิน (Multi-Currency) | `multi_currency` | `/api/currencies` | `/settings?tab=currency` | - | จัดการอัตราแลกเปลี่ยน, บันทึกซื้อ/ขายด้วยเงินตราต่างประเทศ, คำนวณกำไรขาดทุนจากอัตราแลกเปลี่ยน (แถมใน Business+, Pro, Enterprise AI) |
| **Add-on** | จ้างผลิตภายนอก (Subcontract) | `subcontract` | `/api/subcontracts` | `/stock/subcontractors` | - | ทะเบียนผู้รับจ้างผลิต, จ่ายวัตถุดิบไปภายนอก, รับงานแปรรูปกลับเข้าคลัง, ตรวจนับสต็อกค้างที่โรงงานนอก (ต้องมี Pack Maker) |
| **Add-on** | สำรองข้อมูลบนคลาวด์ (Cloud Backup) | `backup` | `/api/backup` | `/settings?tab=backup` | - | แบ็กอัปฐานข้อมูล SQLite ส่งขึ้น Google Drive อัตโนมัติ (Daily/Weekly) (แถมใน Business+, Pro, Enterprise AI) |
| **Add-on** | API & Webhook Access | `api_access` | `/api/mcp-settings` | `/settings?tab=mcp` | - | เชื่อมต่อโปรแกรมภายนอก, ออก API Key, ยิง Webhook (แถมใน Enterprise AI) |
| **Add-on** | เพิ่มจำนวนผู้ใช้ (Extra Users) | `extra_users` | ใน `billing.catalog.ts` | `/settings?tab=subscription` | - | เพิ่มจำนวนที่นั่งใช้งานเกินกว่าโควตาของแพ็กเกจ (เช่น Solo +1, Business +2, Business+ +5) |
| **ระบบเชื่อมต่อ & AI** | Phopy MCP Server | `ai` / `api_access` | `/sse`<br>`/messages` | `/settings?tab=mcp` | ครอบคลุม 30+ tools | อินเทอร์เฟซ Model Context Protocol สำหรับ Claude Desktop / Cursor / Agent ทำงานอัตโนมัติ 3 ระดับสิทธิ์ (readonly / draft / full) |
| **ระบบเชื่อมต่อ & AI** | LINE Notification & Tasks | *(รอจัด tier)* | `/api/line` | `/settings?tab=line` | - | แจ้งเตือนงานอนุมัติเอกสารและงานเร่งด่วนผ่าน LINE Notify / LINE Bot · สรุปปิดกะ POS (ยอดขาย ลิ้นชัก ขายดี/ซื้อสูงสุด 5 อันดับ) เข้า LINE ส่วนตัวของ Admin |
| **ระบบเชื่อมต่อ & AI** | Phopy Kanban (Planka) SSO | *(expiry gate)* | `/api/kanban/sso` | แถบเมนูด้านข้าง | - | ระบบ Single Sign-On ส่งตัวไปยังกระดานจัดการงาน Kanban (kanban.phopy.net) |
| **Master & แอดมิน** | ระบบจัดการผู้เช่า (Master Panel) | MASTER only | `/api/master/*` | `/master` | - | จัดการ Tenant, สลับบริษัท, ตั้งแพ็กเกจและเลือก Pack/Add-on, กู้คืนฐานข้อมูล, ดูสถิติการใช้งาน |
### สถานะ ณ 13 ต.ค. 2026 (ทำตามเฟสด้วย sub-agent + ตรวจเองทุกเฟส) — **deploy แล้ว 14 ต.ค. 2026** (backup DB: /root/dev.db.bak-platform-20261014)
| เฟส | commit | หมายเหตุ |
|---|---|---|
| 1 รอบเดือน + MCP | `72355dc` `20a7a03` | ตาราง `platform_*` (ไม่ใช่ shopee_* เพื่อรองรับ Lazada) · tool `platform_submit_file` / `platform_month_status` · ลบ csvParser + upload ทั้ง 2 หน้า |
| 2 จับคู่ SKU + ตัดสต็อก | `6a99f36` `e58a808` | alias `SHOPEE:<variant>` · `platform_propose_sku_mapping` · ไม่ใช้ `applyStockMovement()` เพราะมันลง JV 1107 เองทุก OUT · แก้บั๊กยกเลิกรอบสองคืนสต็อกซ้ำ |
| 3 ลงบัญชี | `a8fe598` | 7 JV ผ่าน 1181 (ยอดยกมา→3103 ครั้งแรก, ขาย, ค่าส่งแยกเต็มในกระเป๋า Shopee, ต้นทุน, ค่าธรรมเนียม, ปรับปรุง, ถอนเงิน) · 1181 = 17,604.88 = ยอดกระเป๋า · ค่าส่งที่ลูกค้าจ่ายคิด VAT / เงินอุดหนุนค่าส่ง Shopee ไม่คิด VAT (Prosoft อ้าง iliketax — ให้ผู้ทำบัญชียืนยัน) · `vat_claimable` ปิดทุกตัว (ร้านยังไม่เคยขอใบกำกับจาก Shopee) · ไม่ทำ WHT |
| 4 แดชบอร์ด | `a072e3f` | `Marketing.tsx` เขียนใหม่ 2 แท็บ · `GET /api/marketing/platform-dashboard` · ลบ /shops /metrics /analytics/summary (marketing_metrics 0 แถว) |
| 5 ข้อมูลย้อนหลัง | — | ไม่ต้องเขียนโค้ด ส่งผ่าน MCP ตัวเดิม · **อย่ากดยืนยันการขาย/ลงบัญชีเดือนย้อนหลัง** (ปล่อย COLLECTING ไว้เป็นสถิติ) |


### อัปเดต 14 ต.ค. 2026 — blind review 2 รอบ แก้แล้ว deploy แล้ว (9661983, 0361beb · POS 17ae3ec)
- **ไฟล์ที่ 6 `orders`** (Seller Centre › คำสั่งซื้อของฉัน › ส่งออก **สถานะทั้งหมด** ช่วงเดียวกับ parentskudetail): ยอด/จำนวน "ยืนยันแล้ว" ของ Shopee ยังรวมออเดอร์ที่ยกเลิกหลังยืนยัน + คืนสินค้า (ต.ค. 37,993 บาท) · ไฟล์นี้ไม่มีรหัสสินค้า จับคู่ด้วยชื่อสินค้า+ชื่อตัวเลือก → `qty_net`/`sales_net` · **ยืนยันการขายต้องมีไฟล์นี้** ตัดสต็อกด้วย qty_net
- ตัดสต็อกแบบใบสั่งขาย: ไม่แตก BOM (ร้านผลิตผ่าน WO) · ข้าม SERVICE · แกะแพ็กอัตโนมัติ · ลงวันสิ้นงวด · ต้นทุน `unit_cost` (เป็น 0 = เตือน ไม่บล็อก)
- ลงบัญชี: ยอดยกมาลงเฉพาะเดือนแรกของร้าน · เดือนต่อไปต้องต่อจากเดือนล่าสุดที่ลงแล้วและยอดปิด = ยอดยกมา · ยกเลิกต้องจากเดือนล่าสุด · การ์ด 1181 หลังลงบัญชี = closing − opening ไม่ตรง rollback · เช็คงวดปิดทุกวันที่ของ JV
- **กติกาการใช้งาน:** ร้านเดียวกันห้ามลง 1181 ทั้งผ่านหน้า settlement เดิมและรอบเดือน — ยอดยกมาจะซ้อน (ระบบแยกยอดหน้าเดิมรายร้านไม่ได้)
- ค้าง: เศษ ±1 บาทต่อเดือนค้างใน 1181 (ยังไม่มีบัญชีปัดเศษ — รอเจ้าของเลือกรหัส)

---

## 📅 Session Log — 14–16 ตุลาคม 2026 (POS: เลขเอกสาร, สรุปวันนี้, คุมเงินสด/กันโกง + รวม SKU นูเทลล่า)

### 1. ข้อมูล Kids House (tenant_bb_pillow)
- **รวม SKU ซ้ำ ING-N01 → ING-NUT แล้วลบ ING-N01 ทิ้ง** — มีคนนับสต็อกแล้วปรับยอด 200 g ลงที่ ING-N01 ซึ่งปิดใช้งานไปแล้ว (ADJ-2026-00008) · สคริปต์ `backend/scripts/2026-10-14-merge-nutella.js` · backup `/root/dev.db.bak.merge-nutella-20261014` · **บทเรียน:** SKU ที่ตั้ง INACTIVE ยังถูกเลือกได้ตอนนับสต็อก ทางที่ชัวร์คือลบทิ้งไปเลย
- ผักเคล `STK-ING-CLE` (ไม่เคยซื้อเข้า สต็อก 0) ถูกเพิ่มเข้าสูตร "ไก่ซอสมะนาว" ด้วยมือเมื่อ พ.ค. ทำให้บิล POS-065-141026 จ่ายเงินไม่ได้ → มีคนลบผักเคลออกจากสูตรแล้ว บิลจึงจ่ายได้
- MCP ตรวจแล้วทำงานปกติ (initialize/tools-list ตอบ 200, ไม่มี key ได้ 401)

### 2. เลขที่เอกสาร (`71ff059`, `656c8f3`)
- หน้า Settings → เลขที่เอกสาร เพิ่มแถว **กะขาย POS (POS_SHIFT)** — เดิมไม่มีแถวนี้ เลขกะจึงใช้รูปแบบเดิม `SHIFT-2026-0007`
- **เลือกได้ว่าจะเริ่มเลข 001 ใหม่ทุกวัน / ทุกเดือน / ต่อเนื่องทั้งปี แยกตามชนิดเอกสาร** — เก็บใน `document_number_formats.reset_period` (ค่าเริ่มต้น YEAR = เหมือนเดิม) · ถังตัวนับคำนวณที่ `seqBucket()` ใน `utils/docSeq.ts` ได้ค่าแบบ 2026 / 202610 / 20261016 แล้วเก็บในคอลัมน์ `document_sequences.year` · ถ้าวันที่ในเลขละเอียดไม่พอ (เช่น MMYY แต่ตั้ง DAY) จะถอยไปใช้รอบที่ใหญ่ขึ้นเองเพื่อกันเลขชน

### 3. หน้าแคชเชียร์ (`99aa740`, `1012a4d`)
- ปุ่ม **"← บิลทั้งหมด"** ในหน้าเมนู · กด ✕ ปิดบิลแล้วกลับหน้าบิล (เดิมค้างอยู่หน้าเมนูเปล่า)
- แท็บ "ชำระแล้ว" เปลี่ยนเป็น **"สรุปวันนี้"**: เงินสดที่ควรมีในลิ้นชัก (สูตรเดียวกับปิดกะ) · รับโอน/QR · ยอดขาย · รายการขายและเงินเข้า/ออกลิ้นชักเรียงตามเวลา — ทุก role เห็นตามที่เจ้าของเลือก
- ประวัติการขายย้อนหลังย้ายไปที่ `/accounting/pos-clearing` (เลือกวันได้) · กดบิลแล้วเปิดที่ `/cashier?bill=<id>` เพื่อพิมพ์ซ้ำ/ออกใบกำกับ
- แก้โมดัลเงินเข้า/ออกลิ้นชักที่ทำหน้าจอพัง (`d.map is not a function`): `/accounts` ส่งกลับมาเป็น `{list, tree}` · ⚠️ ค้าง: `/pos/clearing/pending-bills?date=` กรองวันด้วย DATE() แบบ UTC ทำให้บิลช่วง 00:00–06:59 น. ไปอยู่วันก่อนหน้า

### 4. คุมเงินสด / กันโกง (`ab03b58`) — ตรวจโดย sonnet agent 2 ตัว (ตัวหนึ่งดูโค้ด อีกตัวดูข้อมูลจริง) แล้วยืนยันเองอีกรอบ
| ช่องโหว่ที่เจอ | สิ่งที่แก้ |
|---|---|
| ปิดกะแล้วช่องนับเงินมียอดที่ควรมีใส่รอไว้ (ไม่ใช่ blind count) | ช่องนับเงินเริ่มว่าง ต้องกรอกก่อนถึงปิดกะได้ |
| ลบ/ลดรายการที่ส่งครัวแล้วได้แบบไม่มีร่องรอย | ถ้า `sent_to_kds` ต้องมีเหตุผล (ไม่มีได้ 400) แล้วลง log หมวด `pos_item_void` |
| ส่วนลดไม่มีเพดาน | หมวดใหม่ `pos_discount` ใน Settings → การอนุมัติ · เกินเพดานได้ 403 ต้องให้ Admin เป็นคนกดชำระ · ส่วนลดทุกครั้งลง log |
| ยกเลิกบิลที่ไม่เกินเพดาน (500) ไม่มีบันทึกเลย | `recordAutoAction` บันทึก AUTO **ให้ทุกคน** (เดิมเฉพาะคนที่มี bypass) — เจ้าของตัดสินให้แคชเชียร์ยังยกเลิกเองได้ งานจะไม่สะดุดตอน Admin ไม่อยู่ |
| เงินเข้า/ออกลิ้นชักไม่ต้องใส่เหตุผล | บังคับใส่เหตุผล + ลง log `pos_cash_move` · ปิดกะลง log `pos_shift_close` พร้อมยอดขาด/เกิน |

- หน้า `/approvals` แท็บ **"บันทึกความเคลื่อนไหว"** (เดิมชื่อ "ประวัติทั้งหมด"): ชิปแยกหมวดพร้อมจำนวน (`/approval/history` ส่ง `counts` กลับมา) + อีโมจิระดับความร้ายแรงจาก `payload.severity` 🔴 high / 🟠 medium / 🟡 low / 🟢 info
- ยังไม่ทำ: บังคับเลขอ้างอิง QR (รอต่อ Stripe/PromptPay ของร้าน) · เหตุผลตอนลดรายการยังใช้กล่องถามของเบราว์เซอร์ (`window.prompt`)
- ข้อมูลจริงที่เจอ: `pos_shift_cash_movements` ว่างมาตลอด (เงินเกิน 108 บาทของกะ 0006 จึงหาที่มาไม่ได้) · QR ทั้ง 6 รายการไม่มีเลขอ้างอิง · POS-2026-00007 ที่หายไป = session ก่อนลบเองเมื่อ 12 ต.ค. (บิลทดสอบที่ journal ไม่สมดุล) · ปรับ fixture `vatGolden.json` (อยู่ใน gitignore) ให้ตรงกับข้อมูลปัจจุบันแล้ว
- เทสต์: backend 879/879 ผ่าน (`SQLITE_DB_PATH=/tmp/x.db` — ไฟล์ `test.db` เดิมบวมถึง 65MB จน vitest ค้าง)

### 5. สรุปปิดกะเข้า LINE ส่วนตัวของ Admin (16 ต.ค. 2026)
- เมื่อปิดกะสำเร็จ ระบบส่ง Flex การ์ดสไตล์ One UI 9 ที่ใช้สีของ Phopy ไปที่ LINE **ส่วนตัว** ของ ADMIN/MASTER เท่านั้น ไม่ส่งเข้ากลุ่ม (ตามที่เจ้าของสั่ง) · แบบร่างที่เจ้าของเลือก: `Desktop/pos-shift-line-mockup.html` (อยู่ในเครื่องเจ้าของ)
- เนื้อหาการ์ด: ยอดขาย/เงินสด/โอน · ลิ้นชักควรมี→นับได้ พร้อมป้ายขาด/เกิน/ตรง · ขายดี 5 อันดับ · ซื้อสูงสุด 5 อันดับ (ใบรับของที่รับในวันของกะ + ใบสั่งซื้อที่อนุมัติระหว่างกะซึ่งยังไม่มีใบรับของ + เงินออกลิ้นชัก) · ป้ายยกเลิกบิล/ลบรายการ/ส่วนลด นับจากบันทึกความเคลื่อนไหว
- โค้ด: `services/posShiftSummary.service.ts` (+test) · `flexTemplates.shiftCloseCard` · `lineBotService.notifyShiftClosed` (ดึงรายชื่อผู้รับเป็น `adminLineUsers()` ใช้ร่วมกับแจ้งเตือนคำขออนุมัติ) · จุดปิดกะเรียกแบบไม่รอผล ถ้าส่ง LINE พัง ปิดกะยังสำเร็จ (commit `3d0506a`)
- ตรวจกับ LINE `/v2/bot/message/validate/push` แล้ว ทั้งการ์ดเต็มและการ์ดว่างได้ 200 · มูลค่าใบรับของคิดจากจำนวนรับ × ราคาในใบสั่งซื้อ (ไม่รวม VAT) เป็นตัวเลขแจ้งเตือน ไม่ใช่ตัวเลขบัญชี

---

## 📅 แผน — 17 ตุลาคม 2026 (รับออเดอร์ Grab / LINE MAN / ShopeeFood เข้า POS) — ⏸️ พักไว้ ยังไม่สร้าง

> หลักคิด: หลังบ้านเหมือนกันทุกเฟส (บิล POS ติดป้ายช่องทาง → KDS → ตัดสต็อกตาม BOM → ลูกหนี้แพลตฟอร์มในบัญชีพัก 1181 → กระทบยอดตอนเงินโอนเข้า) แต่ละเฟสเปลี่ยนแค่ทางที่ออเดอร์เข้ามา

| เฟส | ทางเข้าออเดอร์ | ต้องได้สิทธิ์จากแพลตฟอร์มไหม | หมายเหตุ |
|---|---|---|---|
| 1 แมนนวล | แคชเชียร์คีย์ในหน้า POS: เลือกช่องทาง + ใส่เลขออเดอร์แพลตฟอร์ม (กันซ้ำ/ใช้กระทบยอด) | ไม่ | เงินไม่เข้าลิ้นชัก บันทึกเป็นลูกหนี้แพลตฟอร์ม · ตั้งราคาแยกตามช่องทางได้ (ไม่ตั้ง = ใช้ราคาหน้าร้าน) · ไหวถึงราววันละ 20–30 ใบ |
| 2A กระทบยอดจากไฟล์ | ร้านส่งไฟล์รายงานจากหน้าร้านค้าแพลตฟอร์มผ่าน MCP (ใช้แนวเดียวกับรอบเดือน Shopee / `platform_submit_file`) | ไม่ | จับคู่เลขออเดอร์กับบิล → ✅ตรง ⚠️ราคาไม่ตรง ❌มีในแพลตฟอร์มแต่ไม่มีบิล (ลืมคีย์/โกง) · ลง GP แล้วล้าง 1181 |
| 2B ส่งรูปให้ AI สร้างบิล | แคปหน้าจอออเดอร์ส่งเข้า LINE OA หรือ MCP → AI สร้างร่างบิล → พนักงานกดยืนยัน | ไม่ | ชื่อเมนูบนแอปจับคู่ด้วย `stock_item_aliases` |
| 3 อัตโนมัติ | webhook จากแพลตฟอร์มสร้างบิลเอง + ส่งเมนู/ราคา/ของหมดกลับไปที่แพลตฟอร์ม | ต้องได้ | ต่อตรงต้องสมัครเป็น POS partner ทีละเจ้า (ใช้เวลานาน เงื่อนไขยังไม่ได้ตรวจ) หรือผ่าน middleware ที่รวมหลายแพลตฟอร์ม (มีค่ารายเดือน) — ยื่นขอคู่ขนานกับเฟส 1–2 |

**บัญชี (ต้องตรวจกับสกิล phopy-accounting ก่อนทำ):** รายได้ลงยอดเต็มตามราคาที่ลูกค้าจ่ายบนแอป แล้วลง GP เป็นค่าใช้จ่ายแยก (ไม่ลงแค่ยอดสุทธิ) · แยกโปรที่ร้านออกเองกับโปรที่แพลตฟอร์มออกให้ · ถ้าร้านจด VAT ใบกำกับค่า GP ใช้เป็นภาษีซื้อได้

**คำถามที่ยังค้างถามเจ้าของ:** ร้านไหนใช้แพลตฟอร์มไหน และมีออเดอร์ delivery วันละกี่ใบ · ราคาบนแอปแยกจากหน้าร้านไหม · แต่ละแพลตฟอร์มโอนเงินถี่แค่ไหน และดาวน์โหลดรายงานเป็นไฟล์ได้ไหม (ขอไฟล์ตัวอย่าง) · จะทำเฟส 1 พร้อม 2A เลยไหม

---

## 📅 Session Log — 19–20 ตุลาคม 2026 (QR สั่งที่โต๊ะ + สมาชิกด้วยเบอร์โทร) — ✅ เฟส 0–2 เสร็จ ยังไม่ deploy

> worktree `/root/qr-wt` branch `feat/qr-table-order` (ยังไม่ commit) · ต้นแบบ/สเปก: ไฟล์ "สั่งที่โต๊ะ QR Menu.html" · ตารางราคา: `Phopy_Price (QR).xlsx`
> หลักคิด: ไม่ต้องมี "ตัวเชื่อม POS" แบบในต้นแบบ — QR เขียนลงบิล POS ของ ERP ตรง ๆ (บิลเปิด = รอบโต๊ะ, KDS, แต้ม, ledger มีอยู่แล้ว)

**ข้อตกลงกับเจ้าของ (19 ต.ค.)**
- ยืนยันเบอร์สมาชิก = **แคชเชียร์กดยืนยัน** แทน SMS OTP (ไม่มีค่า SMS) · กติกา "สะสมได้ทันที ดู/แลกแต้มต้องยืนยันก่อน"
- หน้าลูกค้าใช้ layout ตามต้นแบบ แต่สี/ฟอนต์จาก `frontend/src/index.css` (#5B5CF0, Plus Jakarta Sans + IBM Plex Sans Thai)
- ออเดอร์จาก QR **เข้า KDS ทันที** ไม่ต้องให้แคชเชียร์กดรับ
- QR อยู่ใน **Pack Shop** (ใช้ feature gate `kds` ร่วม) · Pop-up โฆษณา = add-on **฿19/เดือน**
- 20 ต.ค.: **ตัด PIN 4 หลักออก** (ลูกค้าตอบสนองไม่ดี) — กันคนถ่ายรูป QR ไปสั่งแกล้งด้วยโหมด "QR เปลี่ยนทุกรอบ" หรือปุ่มสร้าง QR ใหม่รายโต๊ะแทน

### เฟส 0 — ต้นเหตุ "เชื่อมเบอร์โทรไม่ได้" (บั๊กเดิม แก้แล้ว)
| ปัญหา | ต้นเหตุ | แก้ |
|---|---|---|
| บิลที่ผูกสมาชิก **จ่ายเงินไม่ผ่านทุกใบ** (500) | `/bills/:id/pay` อ่าน `company_settings.key/value` ที่ไม่มีอยู่จริง | อ่านจาก `services/loyaltySettings.ts` |
| ค้น `0812345678` ไม่เจอลูกค้า `081-234-5678` / `+66…` | `phone LIKE` บนข้อความดิบ | `utils/phone.ts` + ฟังก์ชัน SQL `phone_digits()` (ลงทะเบียนใน `db/connection.ts`) |
| อัตราแต้มต่างกันแต่ละเครื่อง | เก็บใน localStorage ไม่เคยถึง server | คอลัมน์ `company_settings.loyalty_*` ตั้งในหน้าตั้งค่าแต้ม (NULL = ค่าตั้งต้น ฿100=1 แต้ม) — **หลัง deploy ให้ admin กดบันทึกหน้าแต้มสะสม 1 ครั้ง** |
| แลกแต้มแล้วบัญชี/VAT บันทึกยอดเต็ม | ส่วนลดจากแต้มหักแค่บนจอ | server แปลงแต้มเป็นส่วนลดท้ายบิล + ตรวจขั้นต่ำ/แต้มคงเหลือ (`REDEEM_INVALID`) |

### เฟส 1 — โต๊ะ + QR + สั่งอาหาร
- ตาราง `pos_tables` (QR ถาวรต่อโต๊ะ) · `pos_running_bills.table_id / qr_token / bill_requested_at` · unique index "1 โต๊ะเปิดได้ทีละบิล" (`TABLE_ALREADY_OPEN`) · migration แยกไฟล์ `db/posQrMigrations.ts`
- API พนักงาน `routes/pos-tables.routes.ts` (`/api/pos/tables` ผังโต๊ะ, เพิ่ม/แก้/ซ่อนโต๊ะ, สร้าง QR ใหม่, ใบ QR, สติกเกอร์ทุกโต๊ะ) · เปิดโต๊ะ = `POST /api/pos/bills { table_id }`
- API สาธารณะ `routes/qr-public.routes.ts` ที่ **`/qr/api`** (นอก `/api` เพื่อไม่แย่ง rate limit กับเครื่องแคชเชียร์ที่ใช้ Wi-Fi เดียวกัน): `session`, `order`, `call-bill` · ราคา/ของหมดอ่านจากเมนูร้านเสมอ · POST ต้องเป็น JSON และไม่มาจากเว็บอื่น · body จำกัด 16kb
- ตั๋วครัวแยกเป็น `services/kdsTicket.service.ts` (ใช้ทั้ง `/kds/send` และ QR — QR ส่งเฉพาะรายการของตัวเอง)
- หน้าลูกค้า `frontend/public/qr/` (`index.html` + `app.js` vanilla — CSP ห้าม inline script) URL `erp.phopy.net/qr/?t=<token>` poll 10 วิ
- หน้าแคชเชียร์: แท็บ **ผังโต๊ะ** (`components/cashier/TableBoard.tsx`, `TableManager.tsx`, `qrPrint.ts`) poll 5 วิ แจ้งเตือน "เรียกเช็คบิล/สั่งเพิ่มผ่าน QR" · บิลโต๊ะที่เปิดดูอยู่ดึงใหม่ทุก 8 วิ

### เฟส 2 — สมาชิกด้วยเบอร์โทร (ไม่มี OTP)
- `services/posMember.service.ts` + ตาราง `pos_member_devices` (cookie httpOnly `phq_dev` 180 วัน เก็บแค่ hash) · `pos_running_bills.member_device_id` · `customers.pdpa_points_consent_at / marketing_consent_at`
- `POST /qr/api/member` สมัคร/ผูกเบอร์ — ตอบเหมือนกันไม่ว่าเบอร์มีอยู่แล้วหรือไม่ (กันสุ่มเบอร์ส่อง) · บิลละ 1 สมาชิก (คนแรก) · เครื่องที่เคยผูกแล้วผูกบิลรอบใหม่อัตโนมัติ
- ยังไม่ยืนยัน = เห็นแค่เบอร์ที่ปิดไว้ · แคชเชียร์กด **"ยืนยันสมาชิก"** (`POST /api/pos/bills/:id/verify-member`) → เครื่องนั้นเห็นชื่อ/แต้ม/ประวัติ และแลกแต้มได้ (ก่อนยืนยันแลกไม่ได้)
- PDPA: ยินยอม 2 ข้อไม่ติ๊กไว้ก่อน · ถอนความยินยอมข่าวสาร · ขอลบข้อมูล → ลง activity log ในหน้า CRM ให้ร้านดำเนินการ
- ยังไม่ทำ: แต้มต้อนรับสมาชิกใหม่ (ต้นแบบ 50 แต้ม)

### ทดสอบ
- เทสต์ใหม่ `posMemberPay.test.ts`, `qrOrder.test.ts`, `qrMember.test.ts`, `utils/phone.test.ts` · ทั้งชุด backend 900 ผ่าน (ล้ม 1 เดิม: encoding คอมเมนต์ใน `unitConversion.service.ts`) · frontend 196 ผ่าน
- E2E ในเบราว์เซอร์บนเซิร์ฟเวอร์ทดสอบแยก (`:4100`, `/tmp/qr-e2e.db`): เปิดโต๊ะ → สั่ง → KDS → เรียกเช็คบิล → จ่าย → QR หยุดรับ · flow สมาชิกทดสอบผ่าน API
- security review (sub-agent): ไม่มี CRITICAL/HIGH · แก้แล้ว: guard cookie ที่ไม่ใช่ string, ไม่รับ token ที่ client ตั้งเอง, ไม่โชว์เบอร์สมาชิกให้คนอื่นที่โต๊ะ, CSRF guard, `Secure` cookie, body limit, ledger ใช้ป้ายคงที่ (ไม่ส่งโน้ตพนักงาน), จำกัดสมัคร 10 ครั้ง/นาที/โต๊ะ
- ความเสี่ยงที่ยอมรับ: QR ถาวรถ้าถูกถ่ายรูปไป คนนอกยังเห็นบิล/สั่งได้ระหว่างโต๊ะเปิด (ไม่มี PIN แล้ว) → แนะนำร้านที่เจอปัญหาใช้โหมดเปลี่ยนทุกรอบ

### ก่อน deploy
- `/opt/crm` มีงานค้างของ session อื่น (`kds.routes.ts`, `migrations.ts`, `KDS.tsx` …) ชนไฟล์เดียวกัน — merge ให้เรียบร้อยก่อน · deploy backend = build + `pm2 restart crm-backend` · frontend build ขึ้นทันที (`public/qr` ติดไปกับ dist)

## 📅 เฟส 3–4 ของ QR สั่งที่โต๊ะ — ✅ สร้างแล้ว 20 ต.ค. 2026

**ทำจริง (ต่างจากแผนด้านล่างตรงไหนบอกไว้):**
- ตาราง `pos_promotions`, `pos_rewards`, `pos_redemptions`, `pos_ad_slots`, `pos_ad_events` (ใน `db/posQrMigrations.ts`) · service `services/qrRewards.service.ts` · API ร้าน `routes/qr-marketing.routes.ts` (`/api/pos/qr-marketing/*`) · หน้าตั้งค่า **Settings → QR โปร / แลกแต้ม / โฆษณา** (`pages/settings/QrMarketingSettings.tsx`)
- รางวัลแลกแต้มทำแบบ **ของแถมเท่านั้น** (เข้าบิลราคา 0 ตัดสต็อกตามสูตร) — ส่วนลดเป็นบาทใช้ "แลกแต้ม" ที่เคาน์เตอร์ที่มีอยู่แล้ว · แลกได้เฉพาะเครื่องที่แคชเชียร์ยืนยันแล้วและเป็นสมาชิกของบิลนั้น
- จองแต้มตอนส่งออเดอร์ → ตัดจริงใน transaction รับชำระ (`useBillRewards`) · แคชเชียร์ลบรายการของแถม = RETURNED ไม่ตัด · ถอด/เปลี่ยนสมาชิกที่บิลแล้วจ่าย = 409 `REWARD_MEMBER_MISMATCH` จนกว่าจะแก้ · แต้มที่ใช้ได้บนมือถือ = แต้มคงเหลือ − ที่จองกับบิลที่ยังเปิด
- Pop-up: add-on `qr_ad` ฿19/ด. ใน `subscription.features.ts` + `billing.catalog.ts` (ต้องมี Pack Shop) — **ต้องรัน `node dist/scripts/stripeSetup.js` เพื่อสร้าง price ใน Stripe** · รูป JPG/PNG/WebP ≤ 5MB เก็บ `uploads/qr-ads/` (ยังไม่ย่อเป็น WebP — ไม่มี sharp) · ขึ้นหลัง pop-up สมาชิก 0.8 วิ ครั้งเดียวต่อรอบโต๊ะต่อเครื่อง · สถิติ 30 วันในหน้าตั้งค่า
- ยังไม่ทำ: ปุ่ม MASTER ระงับรูป (มีคอลัมน์ `suspended_at` แล้ว) · ช่วงเวลาโปรรายวัน (มีแค่ช่วงวันที่)
- เทสต์ `routes/qrRewards.test.ts`

### แผนเดิม (อ้างอิง)

### เฟส 3 — แท็บ "โปรและแลกแต้ม" บนมือถือลูกค้า
| งาน | รายละเอียด |
|---|---|
| ตาราง | `pos_promotions` (ชื่อ, รูป, ช่วงวัน/เวลา, เงื่อนไข "สมาชิกเท่านั้น", ผูกเมนู `pos_menu_id`) · `pos_rewards` (ชื่อ, แต้มที่ใช้, ชนิด ของแถม=เมนูราคา 0 / ส่วนลดบาท) · `pos_redemptions` (bill, customer, reward, สถานะ จอง/ใช้แล้ว/คืน) |
| หลังร้าน | หน้าจัดการโปร/รางวัลใน Settings (หรือหน้า Marketing) |
| มือถือ | แท็บใหม่ "โปรและแลกแต้ม" — ปุ่ม "สั่งเลย" ใส่เมนูโปรลงตะกร้า · แลกแต้ม = **จองแต้มทันที** (เฉพาะสมาชิกที่ยืนยันแล้ว) แสดงแต้มคงเหลือหลังหักจอง |
| ตอนส่งออเดอร์ | ของแถมเข้าบิลเป็นรายการราคา 0 (ตัดสต็อกตามปกติ) · ส่วนลดเข้า `discount_amount` แบบเดียวกับแลกแต้มที่เคาน์เตอร์ |
| ตอนปิดบิล | จ่ายแล้ว = ตัดแต้มจริง (ledger REDEEM อ้างบิล) · ยกเลิกบิล/ปิดโต๊ะโดยไม่ส่ง = คืนแต้มที่จอง |
| เทสต์ | แลกเกินแต้ม, แลกซ้ำ, ยกเลิกบิลแล้วแต้มคืน, เครื่องยังไม่ยืนยันแลกไม่ได้ |

### เฟส 4 — Pop-up โฆษณา (add-on ฿19/เดือน)
| งาน | รายละเอียด |
|---|---|
| ราคา/สิทธิ์ | add-on `qr_ad` ใน `ADDON_FEATURES` + Stripe price ฿19/ด. (ต้องมี Pack Shop) · หมดอายุ = ไม่แสดง เก็บรูปไว้ 30 วัน |
| ตาราง | `pos_ad_slots` 1 แถวต่อร้าน (รูปปัจจุบัน, ลิงก์ในระบบ: เมนู/แท็บโปร/ไม่มี, ช่วงวันที่+เวลาแสดง, ระงับโดยผู้ดูแลแพลตฟอร์ม) · `pos_ad_events` (แสดง/แตะ/ปิด) |
| อัปโหลด | 1 รูป JPG/PNG/WebP ≤ 5MB แนะนำ 1080×1350 (4:5) ย่อเป็น WebP ราว 200KB · อัปโหลดใหม่แทนที่รูปเดิม |
| มือถือ | ขึ้นหลัง pop-up สมาชิกปิด 0.8 วิ (หรือหลังเมนูโหลดถ้าไม่มี) ครั้งเดียวต่อรอบโต๊ะต่อเครื่อง · ปุ่มปิดวงกลม 30px ใต้รูป พื้นที่กด 44px · ปิดด้วย Esc/ปุ่มย้อนกลับ · ไม่มีนับถอยหลัง |
| สถิติ | จำนวนแสดง/แตะ/ปิด + ยอดสั่งเมนูที่โฆษณา ก่อน-หลังลงรูป |
| เนื้อหา | ข้อกำหนดการใช้งาน: ร้านรับผิดชอบรูป ห้ามโฆษณาเครื่องดื่มแอลกอฮอล์ (พ.ร.บ.ควบคุมเครื่องดื่มแอลกอฮอล์ ม.32) · ปุ่ม MASTER ระงับรูป |

## 📅 Session Log — 21 ต.ค. 2026 (รีวิว + แก้ QR สั่งที่โต๊ะ, ย้าย/รวมโต๊ะ, จำลูกค้าทั่วไป) — ✅ เทสต์ผ่าน ยังไม่ deploy

> ทำในสำเนา `/root/crm-qrfix` (ไม่แตะ `/opt/crm`) · แก้โดย agy (Gemini Flash/Argon) ภายใต้การตรวจของ Claude · backend 958/959 (ล้ม 1 เดิม: encoding คอมเมนต์ `unitConversion.service.ts`) · frontend 196/196 · tsc ผ่านทั้งสองฝั่ง

**ข้อตกลงกับเจ้าของ (21 ต.ค.)**
- QR ถาวร: สติกเกอร์ = ทางเข้าเท่านั้น → redirect ไป **ลิงก์สุ่มประจำรอบ** (`pos_running_bills.qr_token`) · สั่ง/สมัคร/เรียกบิลด้วยสติกเกอร์ตรง ๆ = 409 `SESSION_REQUIRED` · จ่ายแล้วลิงก์รอบนั้นตาย · ไม่มี PIN (ยอมรับความเสี่ยงคนถ่ายรูปสติกเกอร์ — ใช้ปุ่มสร้าง QR ใหม่รายโต๊ะเมื่อเจอปัญหา)
- ย้าย + รวมโต๊ะ · cookie ลูกค้าทั่วไป (ต้องกดยินยอม) + แต้มย้อนหลังตอนสมัคร เพดาน 100 แต้ม (ตั้งได้ 0 = ปิด)

**แก้บั๊กจากรีวิว**
| เรื่อง | แก้ |
|---|---|
| แต้มที่จองกับของแถม QR ไม่ถูกหักตอนแลกที่เคาน์เตอร์/CRM → จ่ายไม่ผ่าน 500 | `availablePoints()` ใน `qrRewards.service.ts` ใช้ทุกจุด · `REDEEM_INVALID` 400 · หน้าจ่ายเงินโชว์ "จองไว้กับของแถม N แต้ม" (`customer_reserved_points`) |
| แก้จำนวนของแถม 1→10 ได้ | 409 `REWARD_ITEM_LOCKED` · เพิ่มเมนูไม่ merge เข้าแถวของแถม |
| ผูกสมาชิกหลังจ่ายไม่ได้แต้ม / เปลี่ยนสมาชิกหลังจ่ายแต้มไม่ย้าย | บิลที่จ่ายตอนไม่มีสมาชิก → ผูกทีหลังได้แต้มครั้งเดียว · มีแถว `POS_BILL` แล้ว = 409 `MEMBER_LOCKED_POINTS` |
| ยกเลิกบิลแล้วหักแต้มคืนไม่พอ ledger ไม่ตรงยอด | บันทึก delta ที่หักได้จริง + หมายเหตุส่วนที่ขาด |
| เน็ตหลุดแล้วกดส่งซ้ำ = ออเดอร์ซ้ำ | `orderKey` + ตาราง `pos_qr_order_keys` (ส่งซ้ำได้ผลเดิม) |
| เหตุผลยกเลิกบิลหายเมื่อ notes เป็น NULL · redemption ค้าง RESERVED | `COALESCE(notes,'')` · ยกเลิกบิล = RETURNED |
| toast โชว์ `<Star .../>` เป็นข้อความ · แจ้งเตือนสั่งเพิ่มหายถ้าเรียกบิลพร้อมกัน · pop-up ถูกบล็อกเงียบ · ผู้จัดการกดโหมด QR แล้ว 403 | แก้ทั้งหมด |
| dead code | `earn_rate` ใน /pay, import `generateId` ใน kds.routes, `customer_name` ในผังโต๊ะ, คอมเมนต์ PIN ในใบเปิดโต๊ะ |

**ฟีเจอร์ใหม่**
- ย้าย/รวมโต๊ะ: `POST /api/pos/bills/:id/move { table_id }` · `POST /api/pos/bills/:id/merge { target_bill_id }` (ใน `pos-tables.routes.ts`) + `components/cashier/MoveTableDialog.tsx` ปุ่ม "ย้าย/รวม" บนการ์ดโต๊ะ · บิลที่ถูกรวม = CANCELLED + `merged_into_bill_id` + หมายเหตุ "[รวมเข้าบิล X]" (จะโผล่ในรายงานบิลยกเลิก) · มือถือที่ถือลิงก์บิลเดิมตามไปบิลปลายทางเอง
- ลูกค้าทั่วไป: `services/posGuest.service.ts` · cookie httpOnly `phq_guest` 180 วัน เก็บแค่ hash · `POST /qr/api/guest`, `/guest/forget` · นับเข้าประวัติตอนบิลจ่ายแล้วเท่านั้น (`recordPaidBill` ใน payTx) · ยอดใช้จ่ายนับเฉพาะบิลที่ไม่มีสมาชิก · สมัครสมาชิก = แต้มย้อนหลัง `min(cap, floor(spent/earnRate))` ครั้งเดียว (`QR_GUEST_RETRO`) + บันทึก CRM + ลบแถว guest · มือถือ: การ์ดขอยินยอมในแท็บบิล, "ครั้งก่อนคุณสั่ง/สั่งซ้ำทั้งหมด", ลบข้อมูลในแท็บสมาชิก · ตั้งเพดานที่ Settings → แต้มสะสม (`loyalty_retro_cap`)
- ponytail: ผูกสมาชิกให้บิลหลังจ่าย (กติกา A5) ยอดบิลนั้นยังถูกนับเข้า guest spent ด้วย — แต้มย้อนหลังอาจเกินจริงไม่เกินเพดาน

**ก่อน deploy**: build backend + frontend แล้ว `pm2 restart crm-backend` — migration ใหม่อยู่ท้าย `db/posQrMigrations.ts` (รันซ้ำได้)

---

## 📅 Session Log — 21 ต.ค. 2026 (Phopy Board ตรงบัญชี, Reports, Dashboard รายจ่ายประจำ, Journal ตัวกรอง + เงินเดือน, เลขเอกสารรายวัน) — ✅ deploy แล้ว `7078cb3`

> แบ่งงาน 5 branch: Board/Dashboard/Journal = Claude Opus agent · เลขรัน = Sonnet agent + agy (Gemini 3.8 Flash) · Reports = agy — Claude ตรวจ diff + รันเทสต์เองทุก branch แล้วรวมเป็น `feat/accounting-board-2026-10` · backend 1008/1010 (ล้ม 2 + vatGolden โหลดไม่ขึ้น = ของเดิมบน `ui`) · frontend 205/205 · tsc ผ่าน · deploy ด้วยสคริปต์ที่ทดลองรวม WIP ของ session อื่นใน worktree ชั่วคราวก่อน แล้ว stash → ff → apply กลับ (สำรอง stash `499853e3`, DB `/root/dev.db.bak-20261021-162522`)

**Phopy Board** (`services/phopyBoard.service.ts` ใหม่, `PhopyBoardAccuracy.tsx` ใหม่)
| เรื่อง | ก่อน | หลัง |
|---|---|---|
| ต้นทุนขาย | ตามสูตรตอนขายอย่างเดียว กำไรบาน | การ์ด "ต้นทุนขาย 2 มุม": (ก) ตามสูตร/บัญชี (ข) ตามสต็อก = ต้นงวด + ซื้อเข้า − ปลายงวด (บัญชีสินค้าคงเหลือ 1106/1107) + ส่วนต่าง + กระทบยอดกับ COGS ในบัญชี + เทียบ `totalStockValue()` |
| "อื่นๆ" ต้นทุน 4,294 / ค้าปลีกค่าใช้จ่าย −150 | งง | = ปรับสต็อกหมูสับ 3,949 + ซื้อใช้ตรง 344 · −150 = เงินเกินปิดกะ (5901) → แยกคอลัมน์ "ขาด/เกิน·ปรับสต็อก" (59xx), POS_* หัว JV ที่ไม่มีหน่วย = หน้าร้าน, "อื่นๆ" → "ส่วนกลาง" + กดดูที่มาได้ |
| AP/AR aging | PO ที่ยังไม่ RECEIVED (฿310 = PO DRAFT ปี 2024) / ตาราง orders ที่ไม่มีใครเขียนแล้ว | ใบแจ้งหนี้ซื้อค้าง `balance_amount` / `invoices` + ยอดบัญชีคุม (1104/1180/1182, 2101/2102/2109) · สีแท่งผูกกับช่อง |
| Early Warning | ไม่มีคำอธิบาย · supplier concentration ใช้ PO ตลอดกาล | ปุ่ม ⓘ พลิกดู: คืออะไร/สูตร/เกณฑ์สี/ถ้าแดงทำอะไร · ใช้ใบแจ้งหนี้ซื้อในงวด |
| ยอดขาย POS | ไม่มี | บิล, เฉลี่ยต่อบิล, ช่องทางชำระ, กระทบกับรายได้ในบัญชี, บิลยกเลิก |
| เงินออกลิ้นชัก | ไม่เคลียร์ | แยก ค่าใช้จ่าย/ซื้อของ (1182)/เจ้าของถอน/อื่นๆ, รายการยังไม่ post, เงินหายระหว่างกะ, ขาด/เกิน เทียบ 5901 |
| เงินเดือน | ไม่มี | P&L รายเดือนมีคอลัมน์ เงินเดือน/ค่าแรง, ค่าใช้จ่ายอื่น, กำไรสุทธิ |
| อื่นๆ | expenseRatio หาร orders (=0), costTrend ใช้ PO, expByCat ไม่กรอง closing, wcTrend ใช้ endDate เดียวทุกเดือน, setMonth พังวันที่ 31 | ใช้ ledger ทั้งหมด, ยอด ณ สิ้นแต่ละเดือน, เดือนไม่ขึ้นกับ timezone, วันที่ผิดรูป = 400 |

**Reports** (`reports.routes.ts`, `FinancialReports.tsx`): P&L ขั้นบันได (รายได้→COGS→กำไรขั้นต้น→OpEx→กำไรสุทธิ) ป้ายกำไร/ขาดทุน, ติดลบเป็น `(1,234.00)` แดง, % ต่อรายได้, เทียบงวดก่อน (`comparison`) · งบดุลบวก `unclosedProfit` เข้าส่วนของเจ้าของ + `difference` · งบกระแสเงินสด: เงินสด = 1101/1102/category CASH, ลงทุน/จัดหาเงินตาม reference_type ที่เหลือ = ดำเนินงาน (เดิม POS/จ่ายผู้ขายหายจากงบ) · ปุ่ม เดือนนี้/เดือนก่อน/ไตรมาสนี้/ปีนี้ · งบทดลองและบัญชีแยกประเภท **ยังนับ** closing entry โดยตั้งใจ (ต้องเห็นการโอนเข้ากำไรสะสม) — กรองเฉพาะ P&L/งบดุล/กระแสเงินสด

**Dashboard**: การ์ด "รายจ่ายประจำ" (`GET /dashboard/opex`) = EXPENSE ≠ COGS เดือนนี้ vs เดือนก่อน top 8 + "อื่นๆ", ติดป้ายประจำ (มียอด ≥ 2 ใน 3 เดือน)/ครั้งคราว, กำไรหลังหักรายจ่าย · `cashflow-forecast` หักรายจ่ายประจำเฉลี่ย (`recurringOpex`)

**Journal entries**: ตัวกรองต่อคอลัมน์ฝั่ง DB ก่อนแบ่งหน้า (`entryNumber`, `startDate/endDate`, `referenceTypes` หลายค่า + `MANUAL`, `q`, `accountId`, `min/maxDebit`, `min/maxCredit`) + `meta.typeCounts` · จำใน URL · `components/accounting/JournalColumnFilters.tsx`

**เงินเดือน** (`POST /api/journal/payroll`, `PayrollModal.tsx`): JE ร่าง `reference_type='PAYROLL'` Dr 5301 (ก่อนหัก) + Dr 5314 สมทบนายจ้าง (บัญชีใหม่ — ไม่เจอ = 5301 + warning) / Cr บัญชีจ่าย (ค่าเริ่ม 1102) + 2106 ประกันสังคม + 2105 WHT + หักอื่นๆ (ค่าเริ่ม 2102) · รายคนเก็บใน `payroll_lines` (FK CASCADE กับ JE) · `GET /payroll/employees`, `/payroll/history` → autocomplete + "คนนี้รับไปแล้วเท่าไร" (งวดนี้/ทั้งปี/3 รายการล่าสุด) + เตือนเหลืองถ้างวดนี้จ่ายแล้ว (ไม่บล็อก — บางร้านจ่ายเดือนละ 2 รอบ) · ponytail: จับคู่พนักงานด้วยชื่อ (trim + ไม่สนตัวพิมพ์) ยังไม่มีตารางพนักงาน

**เลขเอกสาร**: JOURNAL/STOCK_ADJUSTMENT ตั้งได้ใน Settings, JV pad 5 ทุกจุด (เดิม 5/6 ปน), ส่ง `docDate` ของเอกสารตอนออกเลข (timestamp → เวลาไทย — ห้ามส่ง `toISOString().substring(0,10)` เพราะ 00:00–07:00 น. ได้วันที่เมื่อวาน), กันเลขซ้ำเมื่อเปลี่ยนรูปแบบ/รอบรีเซ็ต (`docNumberExists` + `DOC_NUMBER_TABLES` ใน `utils/docSeq.ts`) · ปุ่ม "ใช้ ลำดับ-ววดดปป รีเซ็ตทุกวัน กับทุกเอกสาร" · bb_pillow ตั้งทั้ง 16 ประเภทเป็น `PREFIX-ลำดับ-DDMMYY` รีเซ็ต **DAY** แล้ว (`scripts/2026-10-21-daily-doc-numbers.ts --tenant <id> [--apply]` รันด้วย `npx --prefix backend ts-node --transpile-only`)

**ข้อมูลร้านที่ต้องเคลียร์ (bb_pillow, พบตอนตรวจ)**
- นับสต็อกจริง: บัญชี 52,244 vs จำนวน×ทุนในระบบ ≥ 58,629
- ปรับลดหมูสับ 3,949 ลงต้นทุน ต.ค. ทั้งก้อน (น่าจะใช้ไปตั้งแต่ ก.ค.–ก.ย.)
- เงินออกลิ้นชัก 316 ยัง draft (แก๊ส 300, โค้ก 16) · เงินหายระหว่างกะ 1,027.65 (0001→0002) และ 80 (0007→0008)
- ยังไม่มีทุน/ยอดยกมา → เงินสดในบัญชี −54,276 · 2102 = 2,804 จากปรับเพิ่มสต็อก
- บรรทัดซื้อ skip_stock ไม่เลือกบัญชีตกไป 5403 (เช่นค่าน้ำ 326 ควรเป็น 5304) · แม็คโคร 4 ชื่อ · บิล POS-083-191026 ยอด 318 แต่รายการรวม 189

## 📅 Session Log — 22–23 ต.ค. 2026 (ตรวจระบบขาย Sales.tsx: บั๊ก / dead code / ช่องโหว่) — ✅ deploy แล้ว 24 ต.ค. 2026 (`3595d66`)

> ทำในสำเนา (ไม่แตะ `/opt/crm`): ต้นฉบับ `/root/review/crm-live-1022` ในเครื่องของเจ้าของ · รันเทสต์ในสำเนาทิ้งได้ `/root/crm-salesfix-*` ใน CT100 · patch: `/root/review/sales-fixes-2026-10-23.patch` (40 ไฟล์)
> แบ่งงาน: **agy Flash** = งานกลไก · **Sonnet** = บั๊ก logic · **Opus** = ช่องโหว่/บัญชี · Claude รวม/แก้ conflict/ตรวจซ้ำ
> backend 1070/1071 (ล้ม 1 เดิม: encoding `unitConversion.service.ts`) · frontend 216/216 · tsc ผ่านทั้งสองฝั่ง

### ระบบสิทธิ์ตาม role ที่มีอยู่แล้ว (ใช้ระบบนี้ อย่าสร้างใหม่)
| ชั้น | อยู่ที่ไหน | ใช้ทำอะไร |
|---|---|---|
| role | `users.role`: MASTER > ADMIN > MANAGER > POWERUSER > USER (`config/roles.ts`, ฝั่งหน้าเว็บ `config/menuPermissions.ts`) | MASTER/ADMIN ผ่านทุกอย่างในธุรกิจ · MANAGER ได้ read/write/approve/delete เฉพาะ resource ของแผนกตัวเอง |
| แผนก + สิทธิ์รายคน | `users.departments`, `users.custom_permissions` (`"resource:action": true/false`) ตั้งที่ Settings > สิทธิ์การใช้งาน / จัดการผู้ใช้ | `can(role, departments, resource, action, customPermissions)` ใน `services/rbac.service.ts` — สิทธิ์รายคนชนะค่าตามแผนก · resource: customers, suppliers, orders, purchase, stock, accounting, marketing, production, qc, users, settings |
| แตะเงิน | `canHandleBilling` (rbac.service) | ออกใบแจ้งหนี้/รับเงิน/สถานะใบแจ้งหนี้/หัก ณ ที่จ่าย |
| ขออนุมัติ | `services/approvalGate.service.ts` (`gateOrCreate`, `recordAutoAction`) + `approval_settings` + `user_approval_permissions` | คนอนุมัติได้ = ADMIN/MASTER/OWNER เสมอ · คนอื่นต้องให้ admin มอบสิทธิ์รายคน/รายหมวด (หน้า Settings > การอนุมัติ, `POST /approval/permissions` เฉพาะ ADMIN/MASTER) วงเงินไม่เกิน 5,000 · ห้ามอนุมัติคำขอของตัวเอง |

### ข้อตกลงกับเจ้าของ (22–23 ต.ค.)
- **ใบลดหนี้**: สร้าง/ออก/ยกเลิก เฉพาะ ADMIN/MANAGER (และ MASTER/OWNER)
- **ค่าใช้จ่ายตอนปิดกะ**: แคชเชียร์ต้องกรอกรายจ่ายที่ยังไม่ได้บันทึกในระบบ · ไม่ต้องอนุมัติ แต่ทุกรายการลงบันทึกความเคลื่อนไหว (`pos_shift_expense`) + ส่ง LINE หา Admin/Manager รายคน · เปิดให้ส่งเข้ากลุ่ม LINE ได้ที่ Settings > LINE (`company_settings.line_shift_expense_groups`, ค่าตั้งต้นปิด)
- **ห้ามยกเลิกใบขายนอกจากขออนุญาต**: ยกเลิก SO / ใบแจ้งหนี้ / void ใบเสร็จ / ยกเลิกใบลดหนี้ ต้องผ่านหมวด `sales_cancel` ซึ่ง **บังคับขออนุมัติเสมอ** (ไม่อ่าน approval_settings, ไม่มี bypass รายคน) · ADMIN/MASTER/OWNER ทำได้ทันทีแต่ลงประวัติ AUTO · คนอื่นได้ 202 "ส่งคำขออนุมัติแล้ว" อนุมัติแล้วระบบยกเลิกให้ (`executeSalesCancel` ใน `approval.routes.ts` → `services/salesCancel.service.ts`) · เอกสารในงวดภาษีที่ปิดแล้วใช้ทางเดียวกัน คำขอระบุว่างวดปิด
- **คนอนุมัติได้**: ต้องสูงกว่า MANAGER (ADMIN/MASTER/OWNER) หรือคนที่ admin มอบสิทธิ์อนุมัติให้ในขอบเขตหมวด/วงเงิน — ใช้ระบบเดิมด้านบน
- **อัตรา VAT**: admin ตั้งที่ Settings > บิล/VAT (`company_settings.pos_vat_rate`, ไม่ตั้ง = 7) · เอกสารขายรับแค่ 0% หรืออัตรานี้ (`vatRateError` ใน `utils/vatSettings.ts`) · คนอื่นเห็นและแก้แท็บนี้ได้เมื่อ admin ให้สิทธิ์ `settings:write` (หรือแผนก CEO/IT/CTO) — แก้ได้เฉพาะ 5 ช่องของแท็บ บิล/VAT ช่องอื่นของบริษัทยังเป็นของ ADMIN/MASTER · `GET /settings/company` ส่ง `can_edit_billing` ให้หน้าเว็บ

### ช่องโหว่ที่ปิด (Opus)
| เรื่อง | แก้ |
|---|---|
| ใครก็ออกใบลดหนี้ได้ + ราคาต่อหน่วยรับจากหน้าเว็บ (ล้างหนี้ลูกค้า / ใบลดหนี้ ฿0 เพื่อเพิ่มสต็อกกลบของหาย) | เช็ค role · ราคาเอาจาก `invoice_items.unit_price` · จำนวนไม่เกินที่เหลือ · ห้ามจากใบแจ้งหนี้ที่ยกเลิก/จากบิล POS |
| เปลี่ยนสถานะใบแจ้งหนี้ได้ทุกสถานะ (ปลุกใบยกเลิก, ตั้ง PAID เอง) | ตาราง transition · PAID/PARTIAL มาจากใบเสร็จเท่านั้น · CANCELLED จบ · ต้อง `canHandleBilling` · มีใบลดหนี้ ISSUED ห้ามยกเลิก |
| DO `isPartial` เปลี่ยน SO ที่ DRAFT/ยกเลิก เป็น PARTIAL (ข้ามอนุมัติ) · DO ส่งเกินจำนวน · ออกใบแจ้งหนี้จาก SO DRAFT | DO ได้เฉพาะ SO ที่ยืนยันแล้ว + จำกัดจำนวน · ใบแจ้งหนี้ต้องมาจาก SO ที่ตัดสต็อกแล้ว |
| ค่าใช้จ่ายปิดกะกลบเงินขาด · ตารางผิด `chart_of_accounts` (500) | ตามข้อตกลงด้านบน · แก้เป็น `accounts` |
| void บิล POS ที่ออกใบกำกับเต็มรูปแล้ว | 400 ทั้งทางตรงและทางอนุมัติ |
| อัตรา VAT ติดลบได้ (journal ไม่ balance) | ตามข้อตกลงด้านบน |
| หัก ณ ที่จ่ายไม่ validate · ยืนยัน SO ไม่ atomic · ยกเลิก SO ที่มีใบแจ้งหนี้ | validate + `canHandleBilling` · transaction เดียว · 409 |

### บั๊กที่แก้ (Sonnet)
ปิดกะใช้ยอดเก่า + ช่องว่างกลายเป็น 0 · race ในหน้าใบลดหนี้ · `key={i}` · ตัวกรองวันที่ UTC · แปลงใบเสนอราคาเป็น SO ซ้ำ (409) · รายการเทมเพลตติดลบ · ยอดรับเงินต่อ string · ใบที่ยกเลิกถูกนับในยอดสรุป/ลูกหนี้/ป้าย · ค่าขนส่งพิมพ์ซ้ำ

### งานกลไก (agy Flash)
ลบ import ไม่ใช้ (`AnimatePresence`, `stockService`) · ลบ router ว่าง `invoiceAttachments.routes.ts`, `productVariants.routes.ts` และ `dashboard.routes.ts.bak-20261005` · วันที่รับเงิน/ใบลดหนี้ใช้วันไทย (`todayStr`) · toast แสดงเหตุผลจาก server 8 จุด · dropdown ใบลดหนี้เห็นใบ DRAFT · `priceEdited` ตอนแปลงใบเสนอราคา · จำกัด `limit` ของ `/pos-shifts` · ใบลดหนี้รายใบมีเลขผู้เสียภาษี/ที่อยู่ลูกค้า

### ก่อน deploy
- ไฟล์ที่ patch แตะ 28 ไฟล์ตรงกับ `/opt/crm` ณ 23 ต.ค. (ไม่มี session อื่นแก้ทับ) · ใน `/opt/crm` ยังมีงานค้างไม่ commit ของ session อื่น 36 ไฟล์ — build แล้วจะขึ้นไปด้วย
- migration ใหม่: `company_settings.line_shift_expense_groups` (ใน `db/migrations.ts`, รันซ้ำได้)
- ยังไม่ทำ: ปุ่มยกเลิกใบลดหนี้บนหน้าเว็บ (เดิมก็ไม่มี) · `notifyShiftClosed` ยังโหลดด้วย `require` จึงไม่ถูกเทสต์

### อัปเดต 24 ต.ค. 2026 — ✅ deploy แล้ว + ตรวจงานค้างที่ไม่ได้ commit (push `origin/ui`)

**งานค้างไม่ได้ commit 35 ไฟล์** (session ก่อนหน้า stash ไว้แล้ววางกลับตอน fast-forward ไป `7078cb3` เมื่อ 21 ต.ค. 16:25 UTC และ build ขึ้น production ไปแล้วตั้งแต่ตอนนั้น) — commit ตามสภาพจริงแยกกลุ่ม: `5c81cf8` kds · `0e1e078` bom · `9e10c67` purchase (ตั้งหนี้จากเงินจาก POS 1182) · `58ed267` pos (ส่วนลดเกินเกณฑ์ขออนุมัติ) · `fb1996f` core · `bac5a73` sales (กรอง tenant_id)
แล้วตรวจด้วย sub-agent แบ่งตามความยาก ทุกตัวใช้ ponytail (`ponytail-review`; agy ติดตั้งเป็น plugin ของ Antigravity): agy Flash = กลุ่มเล็ก/สคริปต์ · Sonnet = KDS, BOM · Opus = core+sales, เงิน (จัดซื้อ/POS)

**แก้ (`003f4c9`)** — patch ฝั่งขายจากรอบ 22–23 ต.ค. อยู่ใน `3595d66`
| เรื่อง | แก้ | ทำโดย |
|---|---|---|
| ส่วนลดแต้มซ้ำ: pay บันทึก `manual + แต้ม` ลงบิลก่อนด่าน → 202 แล้วเปิดบิลจ่ายใหม่ได้ลดแต้ม 2 รอบ (ยังไม่เกิดจริง — ไม่มีร้านเปิดแต้ม) | ก่อนด่านเก็บแค่ส่วนลดมือ · บวกแต้มใน payTx ตอนจ่ายจริง | Opus |
| ส่วนลดที่ยังไม่อนุมัติค้างในบิล (ใบแจ้งยอด/QR เห็น) | 202 = คืนค่าส่วนลดเดิม + คำนวณยอดใหม่ | Opus |
| อนุมัติ/ปฏิเสธส่วนลดไปคำนวณยอดบิลที่จ่ายแล้วใหม่ | recalc เฉพาะเมื่อ UPDATE บิล OPEN ได้จริง | Opus |
| อนุมัติเช็กแค่บาท (ลบรายการแล้วกลายเป็นลด 100%) · ใช้คำขอค้างยอดเก่าซ้ำ | payload เก็บ `baseBeforeDiscount`/% · ใช้ซ้ำเมื่อยอดและ % ครอบคลุม | Opus |
| อนุมัติ void บิลพร้อมกัน 2 คน = ยกเลิก 2 ครั้ง | claim `PENDING→PROCESSING` ก่อน (ค้าง PROCESSING ได้ถ้าเครื่องดับกลางทาง — reset เอง) | Opus |
| เกณฑ์ 40% ฝังในโค้ด | **Settings > การอนุมัติ แถวส่วนลด POS: "ลดเกิน __% ต้องขออนุมัติเสมอ"** (`approval_settings.max_discount_pct`, NULL = 40, `posDiscountApprovalPct()`) — Cashier อ่านค่าเดียวกัน | Opus |
| KDS: แตะรัว, รับออเดอร์ซ้ำทับเมนูที่เสร็จ, ปิดตั๋วแล้วเมนูที่ยกเลิกกลายเป็นเสร็จ | กันแตะเฉพาะตอนคำขอยังไม่กลับ + กัน poll พลิก 4 วิ · IN_PROGRESS ซ้ำ = no-op · `status != 'CANCELLED'` | Sonnet |
| ส่วนลดรวมในสรุปกะนับแต้มด้วย | ใช้ส่วนลดในบิล − มูลค่าแต้มที่แลกหน้าเคาน์เตอร์ | Sonnet |
| ฝั่งขาย: productId/ลูกค้า/ใบค้างส่ง ไม่เช็กว่าเป็นของ tenant | `findUnknownProductId` ใน `routes/sales/shared.ts` · ลูกค้าไม่พบ = 400 | Sonnet |
| BOM calculator: ±% ปัด 2 ตำแหน่ง (ราคาต่อกรัมเพี้ยน) · แปลงหน่วยไม่ได้ใช้ตัวคูณ 1 เงียบ (ต้นทุนเพี้ยน 1000 เท่า) · สูตรย่อยไม่เช็กสต็อก · โหลดพังโชว์สูตรเก่า · วัตถุดิบซ้ำ | ปัด 4 ตำแหน่ง · เตือน + "?" + ไม่นับ · `/bom/explode` · ล้างสถานะ · รวมยอดต่อวัตถุดิบ — สูตรแยกเป็น `components/bom/productionCalc.ts` (+test) | agy Flash-high |
| dead code | ลบ `CostSimulation.tsx`, `authenticateAgent` (fallback ไป JWT_SECRET), `sme-campus.ts` (ไม่มีใคร import), ตัวแปร/import ไม่ใช้ 7 จุด, i18n 2 key · สคริปต์นูเทลล่าย้ายไป `backend/scripts/one-off/` ต้องใส่ `--i-know-this-was-run` ถึงรัน · `vatInclusive` ของ PO ไม่อ่าน "false" เป็น true | agy Flash-medium |

- เทสต์ก่อน deploy: backend 1082/1083 (ล้ม 1 เดิม encoding `unitConversion.service.ts`) · frontend 230/230 · tsc ผ่าน
- deploy 24 ต.ค. 2026 ~01:40 UTC: สำรองที่ CT100 `/root/pre-salesfix-20261024/` (dev.db, dist.tgz, HEAD, wip.diff) · migration ใหม่ `company_settings.line_shift_expense_groups`, `approval_settings.max_discount_pct` ลงแล้ว
- rollback: `git reset --hard 7078cb3` ไม่ได้ (จะทิ้งงานค้างที่ commit แล้ว) → ให้ `git revert 003f4c9 3595d66` แล้ว build ใหม่ หรือแตก `dist.tgz` กลับ + restart


## 📅 Session Log — 24 ต.ค. 2026: ติดตั้งระบบอีเมลองค์กร (Cloudflare + Brevo) & แผนระบบยืนยันตัวตนลูกค้า (Email + Phone Link)

### 1. ✅ ระบบอีเมลองค์กร (Company Email Infrastructure) — พร้อมใช้งานแล้ว
ตั้งค่าโครงสร้างพื้นฐานระบบอีเมลสำหรับแบรนด์และบริษัทครบทั้ง 2 โดเมน:
- **`contact@bbpillow.com`**: สำหรับแบรนด์เครื่องนอน F&B Bedding / BBPillow
- **`contact@phopy.net`**: สำหรับระบบ ERP, เทคโนโลยี, และติดต่องานบริษัทหลัก

| ส่วนการทำงาน | ผู้ให้บริการ | การตั้งค่า & สถานะ |
|---|---|---|
| **รับเมลเข้า (Inbound)** | Cloudflare Email Routing | Forwarding อัตโนมัติเข้า `haikihake@gmail.com` · MX records 3 ตัว (`route1-3.mx.cloudflare.net`) + SPF Locked สมบูรณ์ |
| **ส่งเมลออก (Outbound)** | Brevo SMTP Relay (`smtp-relay.brevo.com:587`) | ยืนยันตัวตนครบ 100% (**Authenticated** ทั้ง 2 โดเมน):<br>- **SPF**: รวม `include:_spf.mx.cloudflare.net include:spf.sendinblue.com ~all`<br>- **DKIM 1 & 2**: CNAME `brevo1._domainkey`, `brevo2._domainkey`<br>- **DMARC**: TXT `_dmarc` (`v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com`)<br>- **Brevo Code**: TXT `@` ยืนยันสิทธิ์เป็นเจ้าของโดเมน |
| **ความปลอดภัย SMTP** | Brevo Security | ปลดล็อก **Authorized IPs** สำหรับ SMTP keys (`Deactivated`) เพื่อให้เซิร์ฟเวอร์ภายนอกและ Gmail Mail Relay สามารถเชื่อมต่อส่งได้โดยไม่ติดบล็อก IP |
| **Client การใช้งาน** | Google Workspace / Gmail | ตั้งค่า **Send mail as (ส่งอีเมลในนาม)** ทั้ง 2 บัญชี พร้อมแยกตัวตน (`Treat as an alias = false`) และทำตัวกรอง (Filter) + ป้ายกำกับสี (Label) แยกโฟลเดอร์สำหรับ `BB Pillow` และ `Phopy` ชัดเจน |

---

### 2. 📋 แผนพัฒนาระบบถัดไป: Customer Identity Verification (Email + Phone Linking)
เป้าหมาย: สร้างระบบ Onboarding ลูกค้าที่สมัครสมาชิกให้มีความน่าเชื่อถือ ป้องกันการสมัครซ้ำ และเชื่อมโยงข้อมูลลูกค้าข้ามทุกช่องทาง (POS / KDS / QR สั่งอาหาร / หน้าเว็บ / CRM)

1. **ระบบยืนยันอีเมลลูกค้า (Customer Email Verification Flow)**:
   - ส่งอีเมลยืนยันตัวตนอัตโนมัติ (Verification Link / 6-digit OTP) ออกผ่าน Brevo SMTP (`contact@phopy.net` หรือ `contact@bbpillow.com` ตามแบรนด์ที่สมัคร)
   - หน้า Landing Page ยืนยันอีเมลสำเร็จ พร้อมอัปเดตสถานะลูกค้าในฐานข้อมูล `customers.email_verified = 1`
2. **ระบบผูกอีเมลคู่เบอร์โทรศัพท์ (Dual-Identifier: Email & Phone Pairing)**:
   - รวมตัวตนลูกค้า: ใช้เบอร์โทรศัพท์ (จากระบบ POS/QR สมาชิกหน้าร้าน) พ่วงเข้ากับอีเมลที่ยืนยันแล้ว
   - การรวมประวัติ (Merge Profiles): หากลูกค้าเคยสั่งผ่าน POS ด้วยเบอร์โทร และต่อมาสมัครผ่านเว็บด้วยอีเมล ระบบจะจับคู่และดึงแต้มสะสม / ประวัติบิลมารวมเป็น Profile เดียวกัน
   - ป้องกันการสวมสิทธิ์: กำหนดขั้นตอนเมื่อเปลี่ยนเบอร์โทรหรือเปลี่ยนอีเมล ต้องยืนยันผ่านช่องทางเดิมก่อน

## 📅 Session Log — 24 ต.ค. 2026 (ตรวจ + แก้ระบบจัดซื้อ Purchase) — ✅ deploy แล้ว (`c9e69d3`)

> ตรวจด้วย agent แบ่งตามความยาก (ทุกตัวใช้ ponytail): agy Flash = dead code · Sonnet = หน้า Purchase.tsx · Opus = สิทธิ์/ความปลอดภัย · Opus = บัญชี/สต็อก — แก้ใน worktree แยก รวมที่ `p-integrate` · backend 1130 ผ่าน (ล้ม 1 เดิม encoding) · frontend 234/234 · สำรอง CT100 `/root/pre-purchasefix-20261024/`

**ข้อตกลงกับเจ้าของ (24 ต.ค.)**
- PO ที่ SUBMITTED/APPROVED **แก้ไม่ได้** (409) สถานะคงเดิม — ต้อง reopen ก่อน
- **ผู้ใช้พื้นฐาน** = role USER ไม่มีแผนก: ใช้ POS/ปิดกะ/ส่วน POS ในหน้าขาย และ**ร่าง** PR/PO (เว็บ+MCP) ได้ · ส่งอนุมัติ/รับของ/ตั้งหนี้/จ่าย/แก้ผู้ขายไม่ได้ · เข้าบัญชี ภาษี รายงาน ลูกหนี้ไม่ได้ (`basicUserDenied` ใน `cashierScope.ts`, เมนูซ่อนผ่าน `canViewMenu`) — ผู้ใช้แผนกอื่นร่าง PR/PO ได้เช่นกัน ขั้นถัดไปต้องมีสิทธิ์ตามแผนก (`canDraftPurchase`, `canReceivePurchase`, `userCan` ใน `rbac.service.ts`)
- **MANAGER** แก้/ยกเลิกเอกสารได้เฉพาะแผนกตัวเอง นอกนั้นขออนุมัติ — หมวดใหม่ `purchase_cancel` (ต้องอนุมัติเสมอ แบบ `sales_cancel`) ครอบ ยกเลิก GR/ใบแจ้งหนี้/void จ่ายเงิน/PO/ใบคืน · executor ใน `services/purchaseCancel.service.ts` + `approval.routes.ts`
- **GM** = ADMIN/MASTER/OWNER หรือแผนก CEO (`isGm`, `gmActsOn` ใน `approvalGate.service.ts`) — ทำ/อนุมัติ `sales_cancel` และ `purchase_cancel` ได้ทันที ไม่ต้องมอบสิทธิ์ ไม่ติดเพดาน 5,000 · เห็นคำขอในกล่อง + เมนู `/approvals` แม้ role เป็น USER

**แก้หลัก**
| เรื่อง | แก้ |
|---|---|
| แก้ราคา PO ที่อนุมัติแล้วได้ (ข้ามวงเงินผู้อนุมัติ) | ล็อก D1 ทั้ง REST/MCP/คำขอ doc_edit ที่ค้าง |
| GR ใส่รายการของ PO อื่นได้ | `PO_ITEM_MISMATCH` · ยืนยัน/ยกเลิกค้นด้วย tenant + PO |
| MCP ข้ามสิทธิ์ (ยืนยัน GR, ยกเลิก PO, แปลง PR, อนุมัติ PR ซ้ำ) | `loadPermUser` + helper เดียวกับ REST · แคชเชียร์ไม่มี MCP tools |
| สถานะย้อนได้ทุกทาง · ไม่บันทึกผู้อนุมัติ (PO รับแล้ว 71 ใบไม่มีชื่อ) | `PO_/PR_/RETURN_TRANSITIONS` · เขียน `approved_by/approved_at` |
| 2109 ปิดไม่หมด · ส่วนลด PO หักซ้ำทุกใบแจ้งหนี้ · แก้ใบแจ้งหนี้แล้วบัญชีเด้งกลับ 1107/2101 | GR ตั้ง 2109 ด้วยต้นทุนจริง ใบแจ้งหนี้ปิดเต็ม ส่วนต่าง Cr 1107 · ส่วนลดใช้ส่วนที่ยังเหลือของ PO · เก็บ `dr_account_id/cr_account_id` |
| จ่ายผู้ขายติดลบ/WHT เกิน/ผู้ขายไม่ตรง · auto-pay จ่ายเต็มทั้งที่ PO จ่ายบางส่วน | validate + `postJournal` · `poPaymentTarget` ใน transaction เดียว |
| คืนของ: VAT 7% ฝังตาย, ราคาจาก client, Dr AP ทั้งที่ยังไม่ตั้งหนี้ | อ้างบรรทัด GR, ราคา/VAT จาก PO, ยังไม่ตั้งหนี้ = Dr 2109 (`grni_return`) |
| ยกเลิก GR ไม่คืน received_qty (ไม่นับสต็อก), แพ็กที่แกะแล้วค้าง, ไม่คืน unit_cost · ยืนยัน GR ลงงวดที่ปิด | แก้ครบ (`prev_unit_cost`, `PERIOD_CLOSED`) |
| หน้า Purchase: PR สร้างแล้วราคา 0 (เกิดจริง 2 ใบ), แก้ PO ส่วนลดหาย, ของที่ปฏิเสธเข้าสต็อก, VAT mode ไม่มีผล, WHT ไม่บันทึก, วันที่ UTC, ชื่อพนักงานในใบพิมพ์ | แก้ 16 ข้อ · ส่วนลดใบแจ้งหนี้: ไม่แตะช่อง = ใช้ส่วนลด PO ที่เหลือ |
| dead code | `timeLock.middleware.ts`, `canEditRecord/checkEditPermission`, `services/purchaseOrder.ts`, `GET /purchase-orders/stats`, import/schema ค้างใน PR routes · JOIN ฝั่ง GET กรอง tenant · 500 ไม่ส่งข้อความภายใน |

**ค้าง — ให้ฝ่ายบัญชีลงเอง (สมุดรายวันทั่วไป งวดที่เปิดอยู่):** 2109 เหลือ 406.18 บาทจากใบแจ้งหนี้ก่อน fix `6ed0b14` (14 ต.ค.) ร้านไม่จด VAT + PO ราคารวม VAT → VAT ถูกนับเข้า 1107 สองรอบ — **Dr 2109 / Cr 1107**: PO-050-040826 11.85 · PO-057-280826 41.66 · PO-052-090826 92.46 · PO-054-180826 109.20 · PO-061-121026 151.01 (ลงเป็นรายการเดียว 5 คู่ หรือยอดรวม 406.18 ก็ได้) · สคริปต์วิเคราะห์ `backend/scripts/one-off/2026-10-24-analyze-2109.js` (อ่านอย่างเดียว)
**ยังไม่ทำ:** `/dashboard` ยังเปิดให้ผู้ใช้พื้นฐาน · WHT คิดจากยอดรวม VAT (รอนโยบายบัญชี) · ใบแจ้งหนี้ก่อน 29 ก.ย. ที่ไม่มี GR · rollback: `git revert c9e69d3` แล้ว build หรือแตก `dist.tgz`

---

## 🤖 แผนพัฒนา: ระบบกระทบยอดบัญชี-ธนาคารอัจฉริยะ (AI-Assisted Smart Bank Reconciliation & CRM Custom Skill)
> บันทึกเมื่อ: 25 ตุลาคม 2026

### 1. ปัญหาและที่มา (Problem Statement & Context)
ในชีวิตจริงของธุรกิจ SME, ห้างหุ้นส่วน (หจก.) และบริษัทจำกัด (บจก.) ในไทย มีอุปสรรคสำคัญในการทำบัญชี 3 ประการ:
1. **การปะปนระหว่างเงินส่วนตัวกับเงินธุรกิจ:** เจ้าของมักใช้บัญชีธนาคารร้านซื้อของส่วนตัว (เช่น ซื้อของให้ลูก, ถอนเงินส่วนตัว, โอนค่าใช้จ่ายในบ้าน) หรือควักเงินตัวเองจ่ายค่าของแทนร้าน
2. **ความผิดพลาดในการลงช่องทางชำระเงิน:** พนักงานจัดซื้อ/หน้าร้านมักลงข้อมูลผิด เช่น จ่ายโอนผ่านแอปธนาคารจริง แต่เผลอกดเลือกเป็น "เงินสด" ส่งผลให้บัญชีเงินสดติดลบและยอดในธนาคารไม่ตรงกับสเตทเมนต์
3. **ธนาคารปกปิดชื่อผู้โอน (Masked Bank Names):** ใน Bank Statement (KBank, SCB, Krungsri ฯลฯ) มักจะตัดทอนหรือเซนเซอร์ชื่อผู้โอน เช่น *"นาย ส... ส..."* หรือแสดงเพียงเลขบัญชีบางส่วน ทำให้ระบบอัตโนมัติแบบเดิมจับคู่ไม่ได้

---

### 2. สถาปัตยกรรมระบบ 5 ขั้นตอน (End-to-End Workflow Architecture)

```
[ 1. Phopy ERP ] ──── Export ────> [ Reconciliation Sheet (Excel/CSV) ]
                                                    │
[ Bank Statement ] ─────────────────────────────────┤
 (PDF / CSV ของแบงก์)                                │
                                                    ▼
                                    [ 2. Client-side Local AI ]
                                    (จับคู่ Amount + Date + Description)
                                    (ตรวจจับชื่อที่โดน Mask เพื่อยืนยัน)
                                                    │
                                                    ▼
                                    [ 3. Human Confirmation & Review ]
                                    (ลูกค้าตรวจ/ยืนยันชื่อคู่ค้าที่ธนาคารปิดไว้)
                                                    │
                                                    ▼
[ 4. Phopy Ingestion ] <── Upload ── [ Matched & Reconciled Dataset ]
   ├── Match สำเร็จ ──────> บันทึกเข้า DB
   └── ตัวค้าง/ตกหล่น ─────> แสดงผลบน UI / ดาวน์โหลดไปกรอกมือกลับมา
                                                    │
                                                    ▼
[ 5. The Catch-All ] ──────────────> [ Reclassification Journal Voucher ]
                                     (ล้างยอดผิดช่องทาง / โอนเข้าบัญชีกรรมการ)
                                                    │
                                                    ▼
[ 6. CRM Learning Loop ] ──────────> [ Customer/Supplier Aliases & Custom Skill ]
```

---

### 3. รายละเอียดการทำงานแต่ละส่วน (Component Specifications)

#### ขั้นที่ 1: ระบบส่งออกข้อมูลเปรียบเทียบ (Phopy Reconciliation Feed / Export)
- Phopy ERP มีปุ่มกด Export รายรับ-รายจ่าย (Transactions Feed) ในช่วงวันที่กำหนด ออกมาเป็นไฟล์ `Excel (.xlsx)` หรือ `CSV`
- **โครงสร้างคอลัมน์มาตรฐาน:**
  - `tx_id`: รหัสอ้างอิงธุรกรรมในระบบ
  - `tx_date`: วันที่เกิดรายการ
  - `type`: ประเภท (SALES, PURCHASE_PAYMENT, POS_SALE, EXPENSE, CASH_MOVEMENT)
  - `doc_number`: เลขที่เอกสาร (เช่น INV-xxxx, PAY-xxxx, POS-xxxx)
  - `contact_name`: ชื่อลูกค้า / ผู้ขาย
  - `amount`: จำนวนเงิน
  - `payment_method`: ช่องทางที่บันทึกไว้ในระบบ (เงินสด, โอนธนาคาร, QR)
  - `account_code`: รหัสบัญชีที่ลงไว้ (เช่น 1101, 1102-01)
  - `reconcile_status`: สถานะการจับคู่ (UNMATCHED / MATCHED / MANUAL)

#### ขั้นที่ 2: การประมวลผลด้วย AI ฝั่งลูกค้า (Client-side AI Matching Engine)
- ลูกค้านำไฟล์ Bank Statement (PDF หรือ CSV) และ Reconciliation Sheet จาก Phopy มาให้ AI ของลูกค้าประมวลผล (ผ่าน Antigravity Agent, Local LLM, หรือ MCP Tool)
- **ตรรกะการจับคู่ (Matching Heuristics):**
  - **Match ระดับ 1 (ยอดเงิน + วันที่):** ยอดเงินตรงกันเป๊ะ และวันที่อยู่ในช่วง $\pm 1$ ถึง 3 วัน
  - **ตรวจจับชื่อที่ถูก Mask (Masked Name Detection):** หากชื่อในสเตทเมนต์เป็นแบบย่อ (เช่น "นาย วิ... ภ...") AI จะนำไปเทียบกับฐานข้อมูลลูกค้าใน Sheet และตั้งสถานะ `FLAG_NEEDS_CONFIRMATION` เพื่อให้มนุษย์ตรวจสอบ

#### ขั้นที่ 3: การตรวจยืนยันและการส่งข้อมูลกลับเข้า Phopy (Ingestion & Exception Handling)
- เมื่อลูกค้าตรวจยืนยันชื่อคู่ค้าเสร็จสิ้น ให้อัปโหลดไฟล์กลับเข้า Phopy ERP
- **Phopy Backend ประมวลผล:**
  1. บันทึกประวัติการกระทบยอดลงในตารางกระทบยอด (`bank_reconciliation_records`)
  2. กรองและแยก **"รายการตกหล่น / รายการค้าง (Exceptions / Unmatched)"** ออกมาแสดงผลอย่างชัดเจนบนหน้า Web UI
  3. ผู้ใช้สามารถเลือกแก้ไข/จับคู่ด้วยตนเองได้ 2 ทาง:
     - กรอกมือบนหน้าจอ (Interactive Grid Edit)
     - ดาวน์โหลดเฉพาะรายการตกหล่นเป็น Excel นำไปกรอกแล้ว Upload กลับเข้ามาใหม่

#### ขั้นที่ 4: การใช้ "ใบปรับปรุงโอนย้ายประเภทบัญชี" เป็นไพ่ตาย (Reclassification JV Engine)
สำหรับรายการที่ยอดไม่ตรง หรือไม่พบบิลในระบบ ERP:
1. **กรณีพนักงานคีย์ช่องทางผิด (เช่น โอนจริง แต่ลงเงินสด):**
   - ระบบมีปุ่มสร้าง **Reclassification JV** อัตโนมัติ:
     - `Dr. 1101 เงินสด` (คืนเงินสดที่เผลอตัด)
     - `Cr. 1102-xx เงินฝากธนาคาร` (ตัดออกจากธนาคารตามสเตทเมนต์จริง)
2. **กรณีรายการส่วนตัวของเจ้าของ (ซื้อของให้ลูก / ถอนส่วนตัว / ทุนส่วนตัว):**
   - สรุปรวมยอดสิ้นเดือน และสร้าง **Monthly Batch Adjustment JV**:
     - `Dr. 1105 เงินให้กู้ยืมแก่กรรมการ / เงินทดรองกรรมการ` (กรณีเงินบริษัทจ่ายส่วนตัว)
     - `Cr. 1102-xx เงินฝากธนาคาร`
     *(ทำให้ตัวเลขในงบการเงินและสเตทเมนต์ดุลกัน 100% ถูกต้องตามหลักภาษีสรรพากร ไม่ปนเป็นค่าใช้จ่ายต้องห้าม)*

#### ขั้นที่ 5: การสร้าง Custom AI Skill & ผลกระทบต่อระบบ CRM (CRM Memory & Learning Loop)
เพื่อให้ AI ฉลาดขึ้นเรื่อยๆ ตามบริบทของแต่ละร้านค้า:
1. **การเชื่อมโยงกับฐานข้อมูล CRM (`customers` & `suppliers`):**
   - เพิ่มฟิลด์ใน CRM เช่น:
     - `bank_aliases`: รายชื่อบัญชี/ชื่อย่อในสเตทเมนต์ที่เชื่อมโยงกับลูกค้ารายนี้ (เช่น `["นาย สม... ส...", "SOMSAK S", "PromptPay-081xxxxxxx"]`)
     - `preferred_payment_channel`: ช่องทางประจำที่ลูกค้าใช้
2. **Auto-Learning จากการยืนยันของผู้ใช้:**
   - เมื่อผู้ใช้กดยืนยันว่า "นาย สม... ส... โอนเงิน 1,500 บาท" คือลูกค้ารหัส `CUST-0042`
   - ระบบจะบันทึก Alias นี้ลงใน Profile ของลูกค้าใน CRM ทันที
3. **Client Custom AI Skill File:**
   - ลูกค้าสามารถเซฟ Rules และความจำเฉพาะร้านลงใน AI Skill ของตนเอง (เช่น กฎว่า "ยอดโอน Lotus Express 120 บาทค่านมลูก ให้แท็กเป็นเงินทดรองกรรมการเสมอ")
   - ในรอบการกระทบยอดเดือนถัดไป AI จะดึง Custom Skill + CRM Data มาจับคู่ได้ถูกต้องโดยอัตโนมัติทันที
---

## 👥 แผนพัฒนา: Phopy HR (แยกหมวด HR ออกจาก Journal) + LINE OA กลาง
> บันทึกเมื่อ: 25 ตุลาคม 2026 · สถานะ: **แผน ยังไม่ได้เริ่มเขียนโค้ด** · UI ตัวอย่าง + ตารางเต็มอยู่ใน artifact "แผน Phopy HR" (claude.ai/artifact/RccQX7RwUGEaWv3URpiwi5 เปิดได้เฉพาะเจ้าของ)

### ปัญหาที่เจอ
- ช่อง **"หน่วยธุรกิจ"** ใน `frontend/src/components/accounting/PayrollModal.tsx` (`BUSINESS_UNITS`) คือแท็กช่องทางขาย RETAIL/WHOLESALE/ONLINE ที่ยืมมาจากหน้าซื้อของ เอาไว้ให้ Phopy Board แยกต้นทุน ไม่ได้เป็นแหล่งจ่ายเงิน แต่หน้าตาชวนให้เข้าใจผิด
- `payroll_lines.employee_name` เก็บชื่อเป็นข้อความเปล่าๆ ไม่มีทะเบียนพนักงาน ไม่ผูกกับ `users` → ต้องกรอกใหม่ทุกเดือน และประวัติก็จับคู่ได้แค่จากชื่อ
- **แนวทางแก้:** เอาช่องนี้ออกจากฟอร์มเงินเดือน แล้วไปผูก "ช่องทางต้นทุน" ไว้ที่ **แผนก** แทน บอร์ดก็ยังแยกต้นทุนได้เหมือนเดิม

### ขอบเขต 15 หมวด (เมนู HR แยกจากบัญชี)
| กลุ่ม | หมวด |
|---|---|
| หลัก | ทะเบียนพนักงาน · ผังองค์กร (แผนกผูกช่องทางต้นทุน) · เวลาเข้าออก · การลา · รอบเงินเดือนอัตโนมัติ · สวัสดิการ · บันทึกอบรม |
| รอบ 2 (เจ้าของเลือก 25 ต.ค.) | จัดกะ + ค่าแรงเทียบยอดขาย POS · LINE self-service · เบิกล่วงหน้า/เงินกู้แบบผ่อน (รวมไว้ที่เดียว) · รับสมัครงาน · เข้างาน/ออกงาน · ทรัพย์สินที่ให้ยืม · สัญญา + เอกสารหมดอายุ · วินัย/หนังสือเตือน |

**เวลาเข้าออก:** รับได้ 4 ทาง → `attendance_logs` (เก็บแค่รายการดิบ ตัวสรุปคำนวณตอนเรียกดู)
- นำเข้าไฟล์ attlog.dat / CSV / XLS
- MCP `hr_import_attendance` ใน `backend/src/mcp/tools/hr.ts`
- เครื่องส่งเข้ามาเองทาง ZKTeco ADMS `/iclock/cdata`
- เช็คอินเว็บด้วย PIN + GPS ก่อน แล้วค่อยเพิ่มสแกนหน้า (@vladmandic/human) เก็บแค่เวกเตอร์ที่เข้ารหัส ต้องได้ความยินยอมตาม PDPA ม.26 และต้องมีทางเลือก PIN ให้เสมอ

**เงินเดือน:** ร่าง → ตรวจ → อนุมัติ → ลงบัญชีผ่าน service เดิม (5314, 2102) · `payroll_lines` เพิ่ม `run_id`, `employee_id` · อัตรากฎหมายเก็บใน `hr_settings` ไม่ hardcode
- สปส. 5% ฐาน 1,650–17,500 หักสูงสุด 875 (ปี 2569) — **ต้องตรวจกับ สปส.**
- ภ.ง.ด.1 แบบเฉลี่ยทั้งปี

### ตารางใหม่ (SQLite)
- **หลัก:** `departments`, `employees` (`user_id`, `device_pin`), `shifts`, `attendance_logs`, `leave_types`, `leave_requests`, `pay_items`, `employee_pay_items`, `payroll_runs`, `training_courses`, `training_records`, `hr_settings`, `biometric_consents`
- **รอบ 2:** `shift_assignments`, `shift_swaps`, `advances`, `applicants`, `checklist_templates`, `checklist_items`, `assets`, `asset_loans`, `employee_documents`, `disciplinary_records`
- **LINE:** `line_user_mappings` เพิ่ม `employee_id` (`user_id` เว้นว่างได้) + ตารางใหม่ `line_active_tenant`, `line_invites`
- **ย้ายข้อมูล:** เอาชื่อจาก `payroll_lines` เดิมมาสร้างพนักงาน แล้วเติม `employee_id` ย้อนหลัง

### LINE OA กลาง (ตัดสินใจ 25 ต.ค.)
- **ตอนนี้:** แต่ละบริษัทตั้ง OA เองใน `line_channels` แล้ว webhook ไล่เทียบลายเซ็นกับ secret ของทุกบริษัท ณ 25 ต.ค. มีแค่ `tenant_bb_pillow` ที่ตั้งไว้ ผูกผู้ใช้แล้ว 3 คน
- **ใหม่:** Phopy OA ตัวเดียวใช้กับคนในบริษัททุกบริษัท ลงทะเบียนผูกด้วย QR เชิญผ่าน LIFF คนเดียวผูกได้หลายบริษัท สลับบริษัทจากริชเมนู
- **ไม่แยก OA ผู้บริหาร:** ใช้ OA เดียว แล้วเลือกริชเมนูตามตำแหน่ง (พนักงาน / หัวหน้า / ผู้บริหาร) ส่วนสิทธิ์ยังตรวจฝั่ง server อยู่ ถ้าวันหลังต้องแยก ให้เพิ่มคอลัมน์ `purpose` (staff/exec) ใน `line_channels` แล้วเปิด OA ที่สองใน provider เดียวกัน
- **OA ของร้านเก็บไว้:** ใช้กับงานที่คุยกับลูกค้า (QR สั่งอาหาร, การตลาด)
- **ต้องแก้ก่อนเปิด OA กลาง:**
  - `tryLinkAccount` ตอนนี้ใช้เลข 6 หลักจาก `Math.random` และค้นภายในบริษัทเดียว พอค้นข้ามทุกบริษัทจะเดาสุ่มได้ → เปลี่ยนเป็นลิงก์ LIFF + โทเคนจาก `crypto` + จำกัดจำนวนครั้งที่กรอกผิด
  - `handleEvent` ต้องรับบริษัทจากการผูกบัญชีเท่านั้น พร้อม test ว่าข้อมูลแต่ละบริษัทไม่ปนกัน
  - webhook ตรวจด้วย secret ของ Phopy ก่อน ถ้าไม่ตรงค่อยลองแบบเดิม
- **ค่าข้อความ push:** Phopy จ่ายรวม → ทำเป็น addon ใน `billing.catalog.ts`

### ลำดับงาน (ราว 6 สัปดาห์)
0. เอาช่องหน่วยธุรกิจออกจาก PayrollModal (ครึ่งวัน)
1. ทะเบียนพนักงาน + ผังองค์กร + เมนู HR + ย้ายข้อมูลชื่อ (2–3 วัน) ← **แนะนำให้เริ่มที่ 0+1**
2. รอบเงินเดือนอัตโนมัติ + สวัสดิการ + สลิป/สปส.1-10/ภ.ง.ด.1 (3–4 วัน)
3. เวลาเข้าออก + MCP นำเข้าไฟล์ + ADMS (3 วัน)
4. การลา + เช็คอินเว็บ (3 วัน)
5. บันทึกอบรม (1–2 วัน)
6. เบิกล่วงหน้า/เงินกู้ + ตรวจ ม.76 (2 วัน)
7. จัดกะ + labor cost % (2–3 วัน)
8. LINE OA กลาง + self-service + ริชเมนู 3 แบบ (4–5 วัน) — ส่วน OA กลางทำก่อนได้เลย ไม่ต้องรอ HR
9. เข้า-ออกงาน + ทรัพย์สิน (2 วัน)
10. สัญญา/เอกสารหมดอายุ + วินัย (2–3 วัน)
11. รับสมัครงาน (2–3 วัน)

**แบ่งงาน:** agy ทำ UI/parser/แม่แบบ · Claude ทำสูตรเงิน, migration, endpoint ที่เปิดออกนอก (ADMS, LINE webhook, ฟอร์มสมัครงาน) และรีวิวทั้งหมด

### อ้างอิง
- **เอาแค่ไอเดีย** (repo นี้เป็นสาธารณะ ห้ามคัดโค้ด GPL/AGPL): frappe/hrms, horilla, Odoo hr, ever-gauzy, OrangeHRM, pyzk
- **ใช้โค้ดได้:** node-zklib / zkteco-js (MIT), line-bot-sdk-nodejs (Apache-2.0), CompreFace (Apache-2.0)

### รอเจ้าของตอบ
- เครื่องสแกนรุ่นอะไร (ขอไฟล์ attlog ตัวอย่าง 1 ไฟล์)
- สแกนหน้าผ่านแท็บเล็ตหน้าร้าน หรือให้ใช้มือถือตัวเอง
- ชื่อและ provider ของ OA กลาง / จะย้าย BB-pillow มาใช้เลยไหม
- มีแม่แบบสัญญาหรือหนังสือเตือนอยู่แล้วไหม
- **ให้นักบัญชียืนยัน:**
  - เพดาน สปส. ปี 2569
  - OT กับเบี้ยขยันนับรวมในฐาน สปส. หรือไม่
  - เบิกค่าจ้างล่วงหน้านับในเพดาน ม.76 หรือไม่

---

## 📅 Session Log — 26 ต.ค. 2026 (MCP `instructions` + `get_erp_guide` ครบ 9 หมวด) — ✅ deploy แล้ว
ทำตามแผน 12 ต.ค. ("แผน: MCP `instructions` + `get_erp_guide`") · สำรวจ 45 tool จากโค้ดจริงด้วย agy 2 ตัวขนานกัน แล้วสุ่มเทียบกับโค้ดก่อนใช้

```
agent ต่อ MCP ──► ชั้น 1  instructions (~400 token, client ใส่ system prompt ให้เอง)
                       กฎกลาง 8 ข้อ + "ก่อนทำงานหลายขั้นให้เรียก get_erp_guide(topic)"
              └─► ชั้น 2  get_erp_guide(topic)  (อ่านอย่างเดียว, โมเดลเรียกเองเมื่อจะทำงานในหมวดนั้น)
```

### หมวดที่ทำแล้ว (ทุกหมวดมี: tool ในหมวด · ลำดับการเรียก · ด่านที่ server บล็อก + ข้อความ error ไทย · กับดัก + วิธีแก้)
| topic | ครอบคลุม tool | สถานะ |
|---|---|---|
| `overview` | แผนที่ tool ทุกหมวด, สิทธิ์ cashier/basic/readonly/MASTER-ADMIN, วิธีใช้ `search` | ✅ |
| `purchase` | PR → PO → GR, `bind_document_item`, กันบิลซ้ำ 3 ชั้น, ของไม่นับสต็อก + **รายการบัญชีค่าใช้จ่ายจริงของ tenant** (ใช้เป็น `expenseAccountCode`) | ✅ |
| `purchase_billing` | PI จาก GR, `pay_supplier` (amount รวม WHT แล้ว), `complete_purchase_bill`, งวดปิด + รายการบัญชีค่าใช้จ่าย | ✅ |
| `stock_units` | ปรับยอด (ยอดหลังปรับ ไม่ใช่ส่วนต่าง, IN/OUT ปิด), กฎหน่วย 3 ชั้น ซื้อ/เก็บ/ใช้, `manage_unit_conversion`, รูปสินค้า | ✅ |
| `sales` | ออกได้แค่ใบเสนอราคา, VAT/ของขายไม่ได้/ต้องใส่ unitPrice, ที่เหลือทำในเว็บ | ✅ |
| `production_bom` | BOM + WO DRAFT→PLANNED→IN_PROGRESS→COMPLETED, ตัดวัตถุดิบ, QC gate, สิทธิ์ปิด/ยกเลิก | ✅ |
| `finance` | aging AR/AP, สรุปการเงิน (cash basis), งบทดลอง/แยกประเภทเฉพาะ MASTER/ADMIN | ✅ |
| `crm` | insights dormant/profile (ambiguous → ถามผู้ใช้), ใบเสนอราคา, lead source | ✅ |
| `platform_month` | รอบเดือน 6 ไฟล์, สถานะ/สมการ, เสนอจับคู่ SKU, `list_marketing_shops` | ✅ |

### ไฟล์ (backend/src)
- `mcp/tools/guide.ts` ใหม่ — `ERP_INSTRUCTIONS`, `GUIDE_TOPICS` (9 หมวด), `registerGuideTool` (enum หัวข้อดึงจาก key ของ GUIDE_TOPICS)
- `mcp/server.ts` ส่ง `{ instructions }` เข้า `new McpServer` · `mcp/sdk-compat.ts` เปิดรับ options · `mcp/tools.ts` ลงทะเบียน + ใส่ `get_erp_guide` ใน READ_ONLY_TOOLS
- `mcp/tools/guide.test.ts` ใหม่ — instructions ≤ 2000 ตัวอักษร, ทุกหัวข้อตอบได้, **ชื่อ tool ใน guide/instructions ต้องมีจริง** (กันคู่มือเก่าเมื่อลบ/เปลี่ยนชื่อ tool)
- `routes/mcpSettings.scope.test.ts` เพิ่ม `get_erp_guide` ใน allowlist สำเนา
- แถม: `services/unitConversion.service.ts:65` คอมเมนต์ไทยพังเป็น `????` ตั้งแต่ `3e850da` (18 ต.ค.) ทำให้ `textEncoding.guard.test` ล้ม — กู้ข้อความแล้ว (คอมเมนต์อย่างเดียว)

### ตัดสินใจ
- instructions เขียน**ภาษาอังกฤษ** เพราะส่งทุก session: ภาษาไทยชุดเดียวกันยาว 3,123 ตัวอักษร (~1,500–2,400 token) เกินงบ 300–500 · คงคำไทยที่ตรงกับ error ของระบบไว้ ("ตัวเลือก", "ไม่พบการแปลงหน่วย", "ส่งคำขออนุมัติแล้ว")
- ไม่ทำ MCP resources ตามแผนเดิม · context ช่วยลดการเรียกผิด แต่ด่านฝั่ง server ยังเป็นตัวกันจริง

### ตรวจแล้ว
- tsc ผ่าน · เทสต์ทั้งชุด 166 ไฟล์ผ่าน · build + `pm2 restart crm-backend` · log ขึ้นปกติ
- MCP client ต่อ server ในโปรเซส (dist จริง, in-memory transport, ไม่ใช้ key): ได้ instructions ครบ 1,632 ตัวอักษร · tool 46 ตัว (เดิม 45 + guide) · หัวข้อผิดถูกปฏิเสธ · tenant_bb_pillow ได้รายการบัญชีค่าใช้จ่ายจริง

### ค้าง
- ทดสอบกับ Claude client จริงด้วย key ของผู้ใช้ ว่า instructions โผล่ใน system prompt (ต้องให้เจ้าของต่อ connector เอง)
- เพิ่ม tool ใหม่เมื่อไร: ใส่ชื่อในหัวข้อ guide ที่ตรงหมวด · ถ้าเป็น tool อ่านอย่างเดียวให้เพิ่มทั้ง `READ_ONLY_TOOLS` และสำเนาใน `mcpSettings.scope.test.ts`

## 📅 Session Log — 26 ต.ค. 2026 (CFO close + Dashboard + Phopy Board รอบ 1) — ✅ deploy แล้ว `3b00be5`
งานรอบที่ 1 ตามสเปก CTO-BRIEF: สร้างฐานปิดบัญชีรายเดือน (สาย A), รวมเมนูบัญชี 10→6 (สาย B), และหน้าผู้บริหาร Dashboard ชีพจรเช้านี้ + Phopy Board 7 บท (สาย C) รวม 5 คอมมิต (`e3284b6`..`3b00be5`)

```
AI ลูกค้า (MCP) ──► get_close_pack / submit_close_adjustments (13 ประเภท)
                         │ (ตรวจทุกบรรทัด + สมการปิดยอด)
                         ▼
เว็บปิดงวด ────────► ตรวจด่าน 11 ข้อ ──► อนุมัติทีละกลุ่ม (close_adjust) ──► ล็อกงวด (/close/:id)
```

### สรุปสิ่งที่สร้างตามสายงาน
| สายงาน | รายการที่สร้าง | รายละเอียดสำคัญ |
|---|---|---|
| **A: ตัวเลขถูก** | ห้ามลงบัญชีหัว | trigger `trg_journal_lines_no_header` คุมระดับ DB (ยกเว้นขากลับ/ย้ายยอดเดิมออก) |
| | รูปแบบกิจการ + ผังบัญชี | `company_settings.entity_type` (INDIVIDUAL/PARTNERSHIP/COMPANY/NULL), บัญชีใหม่ +1113, +1114, +1190, +2110, +3106, +3107 |
| | ด่านตรวจ 11 ข้อ | `closeChecklist.service.ts` แต่ละข้อมี severity block (กันปิดงวด) หรือ warn (เตือน) เช่น งบทดลองดุล, กระทบยอดเงินฝาก + บัญชีพักรอตรวจสอบ, นับเงินสด, ไม่มีร่างค้าง, ไม่มียอดค้างบัญชีหัว |
| | ชุดปิดเดือน & MCP | `buildClosePack` (.xlsx สร้างในเบราว์เซอร์ / MCP `get_close_pack`), คำสั่ง AI (.md ดาวน์โหลดได้ / MCP หัวข้อ `month_close` ใน `get_erp_guide`) |
| | รับรายการปรับปรุง | `submit_close_adjustments` 13 ประเภท (12 ตามสเปก + TIMING) เก็บเป็นร่างเท่านั้น, ตรวจทุกบรรทัด, สมการปิดยอด, ป้องกันส่งซ้ำด้วย dedupe key |
| | อนุมัติ & ล็อกงวด | หมวด `close_adjust` ใน approvalGate, ประตู `POST /close/:id` บล็อกถ้างบทดลองหรือด่านข้อ block ไม่ผ่าน, แนบหลักฐาน TAX_PERIOD / JOURNAL_ENTRY |
| | ถอย/กลับรายการ & บันทึกด่วน | `journal_unposts` เก็บประวัติถอยวันเดียวกับที่ post, `POST /journal/:id/reverse`, บันทึกด่วนกรองเฉพาะ CASH ไม่ใช่หัว และเลิก preselect 1102 |
| **B: เมนู** | เมนูบัญชี 10 → 6 | Phopy Board ขึ้นระดับบนใต้ Dashboard; เมนูย่อยบัญชีเหลือ 5 หมวด (สมุดบัญชี, กระทบยอด, ปิดงวด, รายงาน, ภาษี), เลิกหน้า POS Clearing, ซ่อนปุ่ม mock ในภาษี |
| **C: ผู้บริหาร** | Dashboard "ชีพจรเช้านี้" | 6 สัญญาณชีพ (เงินพอใช้, ยอดขายเมื่อวาน, ต้นทุน COGS 7 วัน, คาดการณ์เงิน 7 วัน, ลูกหนี้เกินกำหนด, การควบคุม) + กราฟแท่งเทียน 3 แผง (recharts custom shape) + แถบงานปฏิบัติการ (ผู้ใช้พื้นฐานเห็นเฉพาะแถบงาน) |
| | Phopy Board 7 บท | 7 บท (1 สรุป CFO จากกฎ, 2 เงินสด, 3 เติบโต, 4 ประสิทธิภาพ, 5 ตลาด, 6 ด่านตรวจ, 7 แผนเทียบจริง) + ตัวกรองช่วง/เทียบงวด + แท็บลูกหนี้/เจ้าหนี้ |

### ประเภทรายการปรับปรุงปิดเดือน (13 ประเภท)
- `MISSING_EXPENSE`: Dr. ค่าใช้จ่าย (52xx/53xx/54xx) / Cr. บัญชีกระทบยอด (ห้ามลงภาษีซื้อ 1110)
- `BANK_FEE`: Dr. 5309 ค่าธรรมเนียมธนาคาร / Cr. บัญชีกระทบยอด
- `INTEREST_INCOME`: Dr. บัญชีกระทบยอด / Cr. 4202 รายได้ดอกเบี้ย
- `WRONG_CHANNEL`: Dr./Cr. ย้ายยอดจากบัญชีของ ref_line_id ไป account_code (หรือบัญชีกระทบยอด)
- `WRONG_ACCOUNT`: Dr./Cr. ย้ายยอดจากบัญชีหัวของ ref_line_id ไปบัญชีย่อย account_code
- `OWNER_PERSONAL`: Dr. 3106 ถอนใช้ส่วนตัว (บุคคลธรรมดา) หรือ 1114 เงินให้กู้ยืมกรรมการ (หจก./บจก.) / Cr. บัญชีกระทบยอด
- `OWNER_PAID`: Dr. ค่าใช้จ่าย หรือบัญชีเงินของ ref_line_id / Cr. 2110 เงินทดรองจากเจ้าของ (หรือ 3101 ทุน)
- `OWNER_CAPITAL`: Dr. บัญชีกระทบยอด / Cr. 3101 ทุน (บุคคลธรรมดา) หรือ 2110 เงินกู้ยืมกรรมการ (หจก./บจก.)
- `UNRECORDED_RECEIPT`: Dr. บัญชีกระทบยอด / Cr. ลูกหนี้ผ่าน `recordCustomerPayment` (ถ้ามี invoice_id) หรือ 4xxx รายได้
- `DUPLICATE`: กลับรายการเดิมทั้งใบ (ใบจ่ายผู้ขายเรียก `reverseSupplierPayment`, ทั่วไปสร้าง reverse JV)
- `CASH_COUNT_DIFF`: คู่กับ 5901 เงินขาด/เงินเกิน (OUT = Dr. 5901/Cr. เงินสด, IN = Dr. เงินสด/Cr. 5901)
- `UNIDENTIFIED`: คู่กับ 1190 บัญชีพักรอตรวจสอบ (OUT = Dr. 1190/Cr. เงินฝาก, IN = Dr. เงินฝาก/Cr. 1190)
- `TIMING`: รายการระหว่างทาง — **ไม่ลงบัญชี** (ไม่มีขา Dr./Cr., สถานะ `TIMING`, นำมาหักลบยอดผลต่างกระทบยอดเพื่อปิดยอดให้ตรง)

### DB วัตถุใหม่ (จาก migrations.ts)
- **ตารางใหม่**: `journal_unposts`, `bank_reconciliations`, `bank_reconciliation_records`
- **Trigger ใหม่**: `trg_journal_lines_no_header` (BEFORE INSERT ON `journal_lines`)
- **คอลัมน์/เงื่อนไขใหม่**: `company_settings.entity_type`, `payment_attachments.ref_type` (rebuild ตารางขยาย CHECK เพิ่ม `'JOURNAL_ENTRY'`, `'TAX_PERIOD'`)

### ไฟล์
- `backend/src/services/`: `closeChecklist.service.ts`, `closeAdjustments.service.ts`, `closePack.service.ts`, `monthClose.service.ts`, `phopyBoard.service.ts`
- `backend/src/routes/`: `monthClose.routes.ts`, `dashboard.routes.ts`, `phopy-board.routes.ts`, `journal.routes.ts`, `period-closing.routes.ts`
- `backend/src/mcp/tools/`: `monthClose.ts`, `guide.ts` (เพิ่มหมวด `month_close`)
- `backend/src/config/`: `accountCodes.ts`, `thresholds.ts` (ศูนย์กลางเกณฑ์ไฟสัญญาณและด่านตรวจทั้งระบบ)
- `backend/src/db/migrations.ts` (ฟังก์ชัน `runMonthCloseMigrations`)
- `frontend/src/pages/`: `Dashboard.tsx`, `Accounting/PhopyBoard.tsx`, `Accounting/MonthClose.tsx`, `Accounting/AccountingBooks.tsx`, `Accounting/AccountingReconcile.tsx`, `Accounting/AccountingReports.tsx`
- `frontend/src/components/`: `charts/CandleChart.tsx`, `layout/Sidebar.tsx`

### ตัดสินใจ / ต่างจากสเปก
1. **เพิ่มประเภทปรับปรุงที่ 13 `TIMING` (รายการระหว่างทาง)**: สเปกกำหนด 12 ประเภท แต่ในทางปฏิบัติมีกรณีเงินฝากระหว่างทางหรือเช็คค้างจ่ายที่บันทึกบัญชีแล้วแต่ยังไม่ตัดใน statement สิ้นงวด หากไม่บันทึกอธิบายไว้ ผลต่างสมการกระทบยอดจะไม่เป็น 0 และปิดงวดไม่ได้ โค้ดจึงเพิ่มประเภท `TIMING` ซึ่งไม่ลงบัญชี (no journal legs) แต่ให้ผลกระทบยอด (`effect = -d`) เพื่อให้สมการกระทบยอดดุล `closeAdjustments.service.ts:35-36, 381-394`
2. **ห้ามลงบัญชีหัวด้วย Trigger ระดับ DB แทนฟังก์ชันกลาง**: สเปก A1 สั่งให้ตรวจที่ฟังก์ชันกลางจุดเดียว แต่การ `INSERT INTO journal_lines` ในระบบเดิมกระจายอยู่ ~30 จุดใน 12 ไฟล์โดยไม่มีฟังก์ชันกลาง จึงสร้าง trigger `trg_journal_lines_no_header` บนฐานข้อมูล พร้อมข้อยกเว้นยอมให้ลงรายการที่ "ย้ายยอดเดิมออก" (ทิศทางตรงข้ามยอดคงเหลือและยอดไม่เกินยอดเดิม) เพื่อให้กลับรายการหรือย้ายยอดเดิมใน 1102 ออกได้ `migrations.ts:2839-2856`
3. **ด่านตรวจข้อ 6 ตรวจยอดคงเหลือแทนการตรวจจำนวนรายการ**: สเปกระบุ "ไม่มีรายการลงบัญชีหัว" แต่ข้อมูลเดิม (เช่น ร้าน Kids House) มียอดบันทึกค้างใน 1102 อยู่แล้ว ด่านตรวจจึงตรวจ `postedBalance !== 0` หากย้ายยอดออกหมดแล้วจะถือว่าผ่าน `closeChecklist.service.ts:324-356`
4. **ด่านตรวจข้อ 2 บล็อกเมื่อเงินพักรอตรวจสอบเกินเพดาน 500 บาท**: สเปกวางบัญชีพักไว้ในด่านข้อ 7 (ระดับเตือน) แต่ตารางประเภทปรับปรุงข้อ 4 ระบุว่า UNIDENTIFIED ต้องไม่เกินเพดาน 500 บาทจึงจะปิดงวดได้ โค้ดจึงนำเงื่อนไขนี้มาบล็อกในด่านข้อ 2 (`bank_reconciled`) ด้วย `closeChecklist.service.ts:123, 144-150`
5. **กำหนด MA กราฟแท่งเทียนระดับปี (year) เป็น [2, 3]**: สเปก C2 ไม่ได้ระบุค่า MA สำหรับรายปี โค้ดจึงกำหนดค่าเริ่มต้น `year: [2, 3]` ใน `GRAIN_MA` `phopyBoard.service.ts:692-696`

### ตรวจแล้ว
- เทสต์รายการปรับปรุงปิดเดือน 15 กรณีผ่านทั้งหมด (ครอบคลุม TIMING, ตัดยอดใบแจ้งหนี้, กันซ้ำ DUPLICATE, สิทธิ์ผู้ใช้, ด่านยอดเงิน) ตามคอมมิต `3b00be5`
- tsc และ build ฝั่ง backend/frontend ผ่านทั้งหมด และ deploy ขึ้น production บน commit `3b00be5`

### ค้าง (Known Issues พบหลังตรวจโดย CFO — รอแก้รอบถัดไป)
- agy เปลี่ยน line endings จาก LF เป็น CRLF ใน 24 ไฟล์ (มีคอมมิตตามแก้อีกครั้ง)
- cash high/low ในแท่งเทียนถูกคำนวณแยกต่อบรรทัดแทนที่จะคำนวณจากยอดคงเหลือสะสมรายวัน
- ชุดรายการปรับปรุงที่ถูกปฏิเสธ (rejected batch) ยังคงบันทึกหัวตาราง `bank_reconciliations`
- กราฟแท่งเทียนรายสัปดาห์ดึงข้อมูลนับรวมวันนี้เข้าไปด้วย
- Sidebar โหมด mobile แสดงผลไม่สมบูรณ์
- ป้ายลูกหนี้ครบกำหนด 7 วัน (AR due-7) แสดงข้อความไม่ตรง
- รูปแบบวันที่/ปี พ.ศ.-ค.ศ. บางจุดยังไม่สอดคล้อง
- การ์ด KPI ใน Phopy Board บทที่ 1 มีแถวซ้ำ
- การตัดปลายไส้เทียน (wick cap) ของกราฟแท่งเทียน

## 📅 Session Log — 27 ต.ค. 2026 (รอบแก้หลัง CFO ตรวจรับ: Dashboard / Board / ปิดเดือน 10 ข้อ) — ✅ deploy แล้ว `54f3b6e`
CTO คนใหม่รับช่วงต่อ · เขียนโค้ดผ่าน agy (Argon = เงิน, Flash = UI) · CTO ตรวจ diff + รันเทสต์เอง · backup `/root/dev.db.bak-20261027-cto-fix`

```
ก่อน (คิดทีละบรรทัด)                  หลัง (สุทธิต่อรายการบัญชี)
ฝากเงินสด→ธนาคาร 2.74 ล.             ฝากเงินสด→ธนาคาร 2.74 ล.
  Dr ธนาคาร  +2.74 ล. → สูงสุด 5.74 ล.   สุทธิในชุดเงินสด = 0
  Cr เงินสด  −2.74 ล. → กลับ 3.00 ล.     สูงสุด = ต่ำสุด = 3.00 ล.
```

| # | เรื่อง | แก้อย่างไร | commit |
|---|---|---|---|
| 1 | จุดสูง/ต่ำเงินคงเหลือพุ่งปลอมตอนโอนภายใน | `dailySeries` รวม `SUM(debit−credit)` ต่อ `je.id` ก่อนเดินยอด (ตัวเดียวกันทั้ง Dashboard และ Board) | `b45c5a0` |
| 2 | ส่งรายการปรับปรุงที่ถูกปฏิเสธ ยังบันทึกหัวกระทบยอด | มีบรรทัด rejected แม้ 1 บรรทัด = ไม่บันทึกทั้งชุด (หัว/บรรทัด/JV/เลขเอกสาร) บรรทัดที่ผ่านได้ `not_saved` · `lines: []` ยังบันทึกได้ · แก้คำอธิบาย MCP + guide | `d9d33e8` |
| 3 | agy เปลี่ยน LF→CRLF | คืน LF 24 ไฟล์ (19 เดิม LF + 5 ไฟล์ใหม่) · ไฟล์เดิม CRLF 3 ไฟล์คงไว้ · `--ignore-cr-at-eol` ว่าง | `8622c63` |
| 4 | กราฟรายสัปดาห์รวมวันนี้ | `trendSeries(..., yesterday)` · เช้าวันจันทร์ไม่มีแท่งสัปดาห์ใหม่ | `f1bd0c5` |
| 5 | มือถือ 390px sidebar กางค้าง | พฤติกรรมเดิมของ `Layout` (เริ่ม `'full'` เสมอ) → เริ่ม `'rail'` เมื่อจอ < 768px · grid/flex ของ Dashboard + Board ห่อบรรทัดได้ · main `p-4 sm:p-6` | `ec46d8a` |
| 6 | การ์ด "ลูกหนี้ครบกำหนด 7 วัน" = ยอดเกินกำหนดทั้งหมด | นับเฉพาะครบกำหนดวันนี้ถึง +7 วัน + ใบไม่มีวันครบกำหนด · ป้าย "ลูกหนี้ถึงกำหนดใน 7 วัน" | `90eea83`, `54f3b6e` |
| 7 | วันที่/ปี | แกนกราฟเงินคงเหลือ `4 พ.ค.` (`toLocaleDateString('th-TH')`) · "ตั้งงบประมาณปี" และหัวการ์ดงบประมาณเป็น พ.ศ. | `1992e3b` |
| 8 | Board บท 1 มี KPI แถวเก่าซ้ำ + Gross Margin ไม่มี % | ลบแถวเก่า (การ์ด 44 ไม่มี % อยู่ในแถวนั้น) | `c901e0b` |
| 9 | ไส้แท่งรายเดือนถูกตัด | `capFor` = min(ไส้สูงสุด, max(1.6 × แท่ง/MA สูงสุด, p90 ของไส้บน)) ใช้ร่วมทั้งสองหน้า | `0846626` |
| 10 | ไม่มี session log | หัวข้อนี้ + รอบ 1 ด้านบน | (commit นี้) |

### ตัดสินใจ / ต่างจากที่ CFO สั่ง
- **ข้อ 2 ไม่บันทึกทั้งชุด ไม่ใช่แค่หัว**: CFO สั่งว่า "มีบรรทัดถูกปฏิเสธ ไม่บันทึกหรือแก้หัว" แต่ `bank_reconciliation_records.reconciliation_id` เป็น NOT NULL FK ไปที่หัว บันทึกบรรทัดที่ผ่านโดยไม่มีหัวไม่ได้ และชุดที่มีบรรทัดอ่านผิดไม่ควรทิ้งสถานะกระทบยอดครึ่งเดียว จึงทำเป็น atomic ทั้งชุด · เทสต์เดิมที่ส่งชุดผสมถูกแยกเป็น 2 ครั้ง (ชุดผิด/ชุดถูก) assertion เดิมอยู่ครบ
- **ข้อ 6 ใบไม่มีวันครบกำหนดนับเป็น "ถึงกำหนดแล้ว"**: `arAging` ไม่เคยนับใบแบบนี้เป็นเกินกำหนด ถ้าตัดทิ้งจะหายจากทั้งสองที่
- **ข้อ 5 เปลี่ยน default sidebar บนจอเล็ก**: CFO ขอแค่ให้อ่านได้เมื่อปิด sidebar แต่ต้นเหตุคือเริ่มกางเสมอ แก้บรรทัดเดียวที่ `Layout`

### ข้อมูลที่ซ่อม
- ลบหัวกระทบยอดขยะ Testshop งวด 2026-08 (`7b53189f…`, ยอด statement 1,171,476.55, ไม่มีบรรทัดลูก) หลัง backup

### ตรวจแล้ว
- backend: 171 ไฟล์ (170 ผ่าน + 1 ข้าม `vatGolden`) · 1,189 ผ่าน + 1 ข้าม (ก่อนรอบนี้ 1,183 + 1) · frontend 44 ไฟล์ / 273 เคส · tsc ผ่านทั้งสองฝั่ง
- เทสต์ใหม่ทุกตัวเห็นแดงก่อนแก้: หัวกระทบยอด (A, B), จุดสูงพุ่ง 5,740,000 แทน 3,000,000, `to` ของแท่งสุดท้าย = วันนี้, ลูกหนี้ 7 วันนับได้ 3 ใบแทน 2
- `index.html` บน erp.phopy.net ชี้ bundle ใหม่ ไม่มีแถว KPI เก่า · pm2 ขึ้นปกติ
- รันเทสต์ backend ต้องตั้ง `JWT_SECRET` (ค่าหลอกได้) ไม่งั้นหลายไฟล์ล้มตอน import
- มือถือ 390px บนเว็บจริงหลัง deploy (headless Chrome, ไม่กด toggle): sidebar เป็น rail 64px เอง · Dashboard + Board บท 1–7 ทั้ง 8 หน้า `scrollWidth` = 390 = ความกว้างจอ, element ล้นจอนอกกราฟ 0 ตัว · ที่เลื่อนแนวนอนได้มีแค่แถบเลือกบทและตารางที่ตั้งใจให้เลื่อน (บท 3, 5)

### ค้าง
- worktree `/root/crm-cto`, `/root/crm-fa`, `/root/crm-fb` รวมเข้า `ui` หมดแล้ว ลบได้ · branch `cto/w1..w8` เก็บไว้ (worktree ลบแล้ว งานอยู่ใน `ui` ครบ)

---

## 📅 Session Log — 27 ต.ค. 2026 (Stripe: Checkout Studio + หน้า Master ทำงานผ่าน Stripe) — ✅ deploy แล้ว `493822b` `51b78f4` `a4a7cd6` `bebfd58`

```
ก่อน                                         หลัง
Master เปลี่ยนแพ็ก → เขียน DB ตรง             → สั่ง Stripe แล้ว webhook เขียนสิทธิ์ให้
  webhook ทับกลับ, Stripe ตัดแพ็กเดิมต่อ         อัปเกรดตัดส่วนต่างทันที (ให้ดูยอดก่อนยืนยัน)
Master ต่ออายุ +30 → ยืดวันใน DB              → เลื่อนวันตัดเงินด้วย trial_end ไม่เก็บเงินช่วงแถม
ปิดใช้งาน / ลบถาวร → Stripe ตัดบัตรต่อ 🔴      → ไม่ต่ออายุ / ยกเลิกทันที (Stripe ล้ม = ไม่ทำอะไร)
แก้ราคาแพ็กหน้า Master → แก้แค่ตัวเลขโชว์       → อ่านอย่างเดียว ดึงจาก billing.catalog (ราคาที่ Stripe เก็บจริง)
```

| # | เรื่อง | แก้อย่างไร | commit |
|---|---|---|---|
| 1 | ค่าจาก Stripe Checkout Studio | ใส่แค่ `ui_mode: hosted_page`, `name_collection` (บุคคล/บริษัท ไม่บังคับ), `phone_number_collection`, `allow_promotion_codes: false` · SDK 23.0.0 | `493822b` |
| 2 | Master แก้สิทธิ์ทับ Stripe | `/subscriptions` คืน `stripe` (ลิงก์ Dashboard test/live ตาม key, cancelAt, pendingChange) + `billingCycle` · ราคาแพ็กมาจาก catalog, PATCH ราคา = 400 | `51b78f4` |
| 3 | ปิดใช้งาน/ลบถาวรแล้วยังโดนตัดเงิน | `stopBilling(tenantId, immediate)` ใน billing.service: ปิดใช้งาน = `cancel_at_period_end` ก่อนปิดผู้ใช้ · ลบถาวร = ล้าง `tenant_id` ใน metadata แล้ว cancel ทันที (webhook ข้าม ไม่สร้างแถวผีกลับ) · Stripe ล้ม = 502 ไม่ปิด/ไม่ลบ | `a4a7cd6` |
| 4 | เปลี่ยนแพ็ก/ต่ออายุจาก Master | `changeSubscription` = ทางเดียวกับลูกค้า (`checkout` → changeParams / scheduleDowngrade) · เลือก Free = `stopBilling(false)` · `extendSubscription` = `trial_end` +N วัน `proration_behavior: none` · `POST /master/tenant/:id/subscription/preview` ให้ UI โชว์ยอดตัดบัตรก่อนยืนยัน · Stripe ปฏิเสธ (บัตรไม่ผ่าน) = 502 พร้อมเหตุผล | `bebfd58` |
| 5 | ฟอร์มแพ็กใน Master เปิดเป็นรายเดือนเสมอ | ใช้ `billing_cycle` จริงของบริษัท (กันบริษัทรายปีโดนสลับเป็นรายเดือนตอนกดบันทึก) | `bebfd58` |

### ตัดสินใจ / ต่างจากที่ Checkout Studio สั่ง
- **ไม่ใส่** `automatic_tax` (ใช้คู่กับ `default_tax_rates` VAT 7% ไม่ได้ → สร้าง session ไม่ได้), `payment_method_collection: always` (ช่วงทดลองต้องไม่ใส่บัตร), `billing_address_collection: auto` (ใบกำกับภาษีเต็มรูปต้องมีที่อยู่), `shipping_address_collection` (ขายซอฟต์แวร์), `submit_type` / `saved_payment_method_options` (ใช้ได้เฉพาะ mode payment), `integration_identifier` / `origin_context` (ไม่ได้ยืนยันว่า Stripe รับ) · **ไม่ลบ** param เดิม (customer/metadata/subscription_data/tax_id_collection/locale) ไม่งั้น webhook หา tenant ไม่เจอ · ไม่สร้าง `STRIPE_INTEGRATION_TODO.md` เพราะไม่มีค่า placeholder
- **ต่ออายุใช้ trial_end**: subscription ที่จ่ายอยู่จะกลายเป็น `trialing` จนถึงวันใหม่ แล้วตัดเงินรอบถัดไปตามปกติ · มีลดแพ็กตั้งเวลาไว้ (schedule) = ต่ออายุไม่ได้ ต้องยกเลิกการลดแพ็กก่อน
- **ปิดใช้งานไม่คืนเงิน** ใช้ได้ถึงสิ้นรอบที่จ่าย · กดผิดยกเลิกการยกเลิกได้ใน Stripe Dashboard

### ตรวจแล้ว
- backend 171 ไฟล์ / 1,201 ผ่าน · tsc ผ่านทั้งสองฝั่ง · `masterSubscription.test.ts` mock billing.service ครอบทาง Stripe ทุกปุ่ม + บัตรถูกปฏิเสธ + Stripe ล้มตอนปิดใช้งาน
- ยิงจริงด้วย test key (ลูกค้าทิ้งแล้วลบ): Checkout Session แบบจ่ายเลย/ทดลอง ✅ · cancel_at_period_end / ล้าง metadata + cancel ✅ · แถม 30 วัน → trialing, ตัดเงินถัดไป +30 วัน, invoice ช่วงแถม 0 ✅ · อัปเกรด 19 → 3,490 ตัด 3,471 (หักที่จ่ายไว้) ✅
- pm2 online, `/api/health` 200

### ค้าง / ควรรู้
- server ยังใช้ `sk_test` — ก่อนเปิดรับเงินจริงต้องเปลี่ยน live key + รัน `dist/scripts/stripeSetup.js` ฝั่ง live (Price + Tax Rate VAT 7%)
- บริษัทเดียวที่จ่ายผ่าน Stripe ตอนนี้: `tenant_bb_pillow` (Enterprise AI, subscription test mode) ไม่ได้แตะ
- ไม่มีปุ่ม "เปิดใช้งานกลับ" — เปิดเองต้องไปยกเลิกการยกเลิกใน Stripe Dashboard ด้วย
- เช็ค upgrade ด้วยการ require `dist/` ทำให้ migration (idempotent) รันบน `dev.db` 1 ครั้ง ไม่มีข้อมูลเปลี่ยน
- backup ไฟล์ก่อนแก้: `/tmp/*.bak-20261027`, `*.bak2-20261027`, `*.bak3-20261027` บน LXC 100
