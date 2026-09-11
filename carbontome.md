# 🏭 Carbon ERP - System Architecture & Development Guide

> เอกสารสถาปัตยกรรมระบบ CRM-BOM-Stock ERP และแผนการพัฒนา
> อัปเดตล่าสุด: 20 กรกฎาคม 2026

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
| **Marketing** | ✅ | Campaign Analytics (Shopee/Lazada integration) |
| **Calculator** | ✅ | Cost & Profit Analysis |
| **POS/Cashier** | ✅ | Open Bill System, Stock Integration, Accounting Link |
| **POS Shift System** | ✅ | เปิด/ปิดกะ, กรอกเงินเปิดกะ, นับเงินปิดกะ, ผลต่าง |
| **POS Clearing Transfer** | ✅ | นำเงินเข้าบัญชีประจำวัน, เลือกวันที่, Cash Over/Short (5901) |
| **Bill Void** | ✅ | ยกเลิกบิล (PAID→VOID) + Reversal Journal Entry อัตโนมัติ |
| **Accounting** | ✅ | Chart of Accounts, Journal Entries (T-account UX), VAT |
| **Tax Management** | ✅ | VAT ทิศทาง WHT ครบ, ภ.ง.ด.3/53, ภาษีซื้อต้องห้าม, ภาษีขายครบช่องทาง, CIT ขั้นบันได SME, alerts กำหนดยื่น |
| **WHT Certificate (50 ทวิ)** | ✅ | ออก/พิมพ์/ยกเลิก, เลขรัน พ.ศ., ตัวอักษรบาทไทย |
| **Period Closing** | ✅ | ปิดงวด + ล็อก JE + ปิดบัญชีสิ้นปีเข้ากำไรสะสม (3103) |
| **Budget vs Actual** | ✅ | ตั้งงบรายบัญชี×เดือน เทียบผลจริงจาก ledger |
| **Multi-Currency (PO)** | ✅ | สกุลเงิน+เรท, PO แปลงเข้า THB เต็มรูปแบบ (UI เลือกสกุลเงินในฟอร์ม Sales/Purchase ยังไม่ทำ — ไฟล์ 3,800+ บรรทัด รอ refactor) |
| **Approval System** | ✅ | Multi-level approval workflow |
| **Platform Order Fulfillment** | ✅ | CSV Upload, SKU Matching, Auto Stock Deduction, Ad Spend JE Approval |
| **Sales Invoice Attachments** | ✅ | อัปโหลดรูป/ไฟล์แนบใบแจ้งหนี้ (max 10MB), gallery preview, lightbox |
| **Invoice Detail Modal** | ✅ | redesign max-w-4xl, items table, payment history, attachment gallery |
| **Purchase List/Card View** | ✅ | สลับ list/card view (list default), pagination 25/50/100 per page |
| **Smart Unit Conversion** | ✅ | BFS chain conversion, sealed stock, auto-unpack, LLM advisor, spelling tolerant |
| **Phopy Board (Business Unit P&L)** | ✅ | ตัวเลขจาก ledger จริง (ไม่นับ closing entry), การ์ด "กำไรขาดทุนตามหน่วยธุรกิจ" Retail/Wholesale/Online, tag `business_unit` จาก `reference_type` ของ JE ต้นทาง |

#### 🧮 Smart Unit Conversion (May 2026)
สรุปสั้น ๆ: ระบบแปลงหน่วยอัจฉริยะที่แก้ปัญหา 6 อย่าง — (1) **BFS chain conversion** แปลงหน่วยหลายขั้นต่อเนื่องอัตโนมัติ เช่น `แพ็ค → ขวด → ลิตร` (2) **Sealed stock** แยก stock ที่ยังไม่แกะ (`sealed_qty`) ออกจากที่แกะแล้ว (3) **Auto-unpack** ถ้าของหลักหมด → แกะแพ็คอัตโนมัติเพื่อเบิก/ขายต่อ (4) **Spelling tolerant** รับคำเขียนผิดเช่น `แพค/แพ๊ค/แพ็ค` ทั้งหมด map เป็น `pack` (5) **LLM Advisor** ช่วยแนะนำค่า conversion factor ตอนตั้งค่า (6) **List view UX** หน้า Purchase (GR/PO) คลิก row ได้เหมือน card view พร้อมปุ่ม action ครบ

### ✅ Online Channel / Platform Integration

| Feature | Status |
|---------|--------|
| Platform CSV Upload (Shopee Ads) | ✅ |
| SKU Matching & Manual Linking | ✅ |
| Auto Stock Deduction (PLATFORM_SALE) | ✅ |
| Ad Spend → Pending JE Queue | ✅ |
| JE Approval Workflow | ✅ |
| Import History | ✅ |
| Organic vs Paid Analytics | 🚧 (รอไฟล์ยอดขายรวมจาก Shopee/Lazada) |
| Business Unit P&L (Retail/Wholesale/Online) | ✅ (Phopy Board, ledger-accurate) |

### 🚧 อยู่ระหว่างพัฒนา (In Progress)

| โมดูล | สถานะ | รายละเอียด |
|--------|--------|------------|
| **MRP** | 🚧 | Material Requirements Planning |
| **COGS Recording** | 🚧 | Cost of Goods Sold auto-calculation |
| ~~**POS KDS**~~ | ✅ | ใช้งาน production แล้ว (ticket-based, polling 3 วิ, เสียง+notification) — ย้ายขึ้นหัวข้อพร้อมใช้งานได้ |
| **Sales Journal Preview** | 🚧 | Dr/Cr preview + เลือก account ก่อนบันทึก (3 จุด: Invoice/Receipt/CreditNote) |

### ❌ ยังไม่มี (Planned)

| โมดูล | ความสำคัญ | รายละเอียด |
|--------|-----------|---------|
| **RBAC** | 🚧 บางส่วน | มีแล้ว: `services/rbac.service.ts`, `PermissionSettings.tsx`, `user_approval_permissions`, role gate ใน MCP tools — ยังไม่ครบทุกหน้า |
| ~~**Credit Note**~~ | ✅ | มีแล้ว `routes/sales/creditNotes.ts` mount ที่ `/api/sales/credit-notes` |
| **Financial Statements** | 🚧 บางส่วน | มี route งบดุลแล้ว + P&L แยกหน่วยธุรกิจบน Phopy Board — ยังไม่ auto-generate เต็มรูปแบบ |
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
│  ├── platform_imports      (import header per CSV upload)        │
│  ├── platform_import_items (per-SKU rows with match status)      │
│  ├── sku_mappings          (platform SKU → stock_item mapping)   │
│  └── platform_pending_je   (ad spend JE approval queue)          │
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
- [ ] Organic vs Paid Analytics (รอไฟล์ยอดขายรวมจาก Shopee/Lazada)
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
