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
