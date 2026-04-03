# 🏭 Carbon ERP - System Architecture & Development Guide

> เอกสารสถาปัตยกรรมระบบ CRM-BOM-Stock ERP และแผนการพัฒนา
> อัปเดตล่าสุด: March 2026

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
| **Tax Management** | ✅ | VAT, Withholding Tax, Tax Periods |
| **Approval System** | ✅ | Multi-level approval workflow |
| **Platform Order Fulfillment** | ✅ | CSV Upload, SKU Matching, Auto Stock Deduction, Ad Spend JE Approval |
| **Sales Invoice Attachments** | ✅ | อัปโหลดรูป/ไฟล์แนบใบแจ้งหนี้ (max 10MB), gallery preview, lightbox |
| **Invoice Detail Modal** | ✅ | redesign max-w-4xl, items table, payment history, attachment gallery |
| **Purchase List/Card View** | ✅ | สลับ list/card view (list default), pagination 25/50/100 per page |

### ✅ Online Channel / Platform Integration

| Feature | Status |
|---------|--------|
| Platform CSV Upload (Shopee Ads) | ✅ |
| SKU Matching & Manual Linking | ✅ |
| Auto Stock Deduction (PLATFORM_SALE) | ✅ |
| Ad Spend → Pending JE Queue | ✅ |
| JE Approval Workflow | ✅ |
| Import History | ✅ |
| Organic vs Paid Analytics | 🚧 (ไฟล์ organic ยังไม่มี) |
| Business Unit P&L (Retail/Wholesale/Online) | 📋 Planned |

### 🚧 อยู่ระหว่างพัฒนา (In Progress)

| โมดูล | สถานะ | รายละเอียด |
|--------|--------|------------|
| **MRP** | 🚧 | Material Requirements Planning |
| **COGS Recording** | 🚧 | Cost of Goods Sold auto-calculation |
| **POS KDS** | 🚧 | Kitchen Display System for POS queue |
| **Sales Journal Preview** | 🚧 | Dr/Cr preview + เลือก account ก่อนบันทึก (3 จุด: Invoice/Receipt/CreditNote) |

### ❌ ยังไม่มี (Planned)

| โมดูล | ความสำคัญ | รายละเอียด |
|--------|-----------|---------|
| **RBAC** | 🟠 ปานกลาง | Role-Based Access Control |
| **Credit Note** | 🟠 ปานกลาง | ใบลดหนี้ (คืนสินค้าบางส่วน, ไม่ใช่ยกเลิกทั้งบิล) |
| **Period Closing** | 🟠 ปานกลาง | ปิดงวดบัญชี + ยอดยกมาอัตโนมัติ |
| **Financial Statements** | 🟠 ปานกลาง | งบดุล + งบกำไรขาดทุน auto-generate |
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

### 📋 Phase 4: Advanced Features (PLANNED)
- [ ] MRP (Material Requirements Planning)
- [ ] RBAC (Role-Based Access Control)
- [ ] Credit Note (ใบลดหนี้)
- [ ] Period Closing (ปิดงวดบัญชี)
- [ ] Financial Statements (งบดุล / P&L)
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

*Last Updated: 2026-03-26*
*Maintained by: Development Team*
