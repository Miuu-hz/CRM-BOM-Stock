# 🏭 Carbon ERP Comparison & Development Guide

> เอกสารเปรียบเทียบระหว่าง CRM-BOM-Stock (ระบบปัจจุบัน) กับ Carbon ERP
> และแนวทางการพัฒนาที่ควรนำมาใช้

---

## 📊 สรุปฟีเจอร์ปัจจุบัน

### ✅ มีแล้ว (Ready)

| โมดูล | สถานะ | รายละเอียด |
|--------|--------|------------|
| **CRM** | ✅ | Customers, Orders, Contacts |
| **BOM** | ✅ | Bill of Materials (1 ระดับ), Materials |
| **Stock** | ✅ | Inventory, Stock Movements |
| **Purchase Orders** | ✅ | ใบสั่งซื้อ, Suppliers |
| **Work Orders** | ✅ | ใบสั่งผลิต, MES เบื้องต้น |
| **Marketing** | ✅ | Campaign Analytics (Shopee/Lazada) |
| **Calculator** | ✅ | Cost & Profit Analysis |
| **User Management** | ⚠️ | Login ง่าย ไม่มี RBAC |

### ❌ ยังไม่มี (Missing)

| โมดูล | ความสำคัญ | ความยาก |
|--------|-----------|---------|
| **Accounting/บัญชี** | 🔴 สูงมาก | ⭐⭐⭐ |
| **MRP** | 🔴 สูง | ⭐⭐⭐ |
| **RBAC** | 🟠 ปานกลาง | ⭐⭐ |
| **Nested BOM** | 🟠 ปานกลาง | ⭐⭐⭐ |
| **QMS** | 🟡 ต่ำ | ⭐⭐⭐ |
| **Capacity Planning** | 🟡 ต่ำ | ⭐⭐⭐⭐ |

---

## 🏭 Carbon ERP Overview

### Technology Stack

| Layer | Technology |
|-------|------------|
| **Framework** | React Router |
| **Language** | TypeScript |
| **Styling** | Tailwind CSS |
| **UI Components** | Radix UI |
| **Database** | Supabase (PostgreSQL) |
| **Auth** | Supabase Auth |
| **Cache** | Upstash (Redis) |
| **Background Jobs** | Trigger.dev |
| **License** | AGPL (Open Source) |

### GitHub Repository
- **Repo:** https://github.com/crbnos/carbon
- **Docs:** https://learn.carbon.ms
- **Website:** https://carbon.ms
- **Stats:** 1.8k+ stars, 190+ forks

---

## 🎯 ฟีเจอร์ที่ควรดึงจาก Carbon ERP

### 1️⃣ Accounting / ระบบบัญชี (เร่งด่วน!)

#### Chart of Accounts (ผังบัญชี)
```typescript
// ตัวอย่างโครงสร้างบัญชีมาตรฐาน
interface Account {
  code: string;        // เช่น "1101" (สินทรัพย์หมุนเวียน)
  name: string;        // เช่น "เงินสด"
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  parentId?: string;   // สำหรับ grouping
  isActive: boolean;
}
```

#### Journal Entries (สมุดรายวัน)
```typescript
interface JournalEntry {
  id: string;
  date: Date;
  reference: string;   // เลขที่เอกสารอ้างอิง
  description: string;
  lines: JournalLine[];
  totalDebit: Decimal;
  totalCredit: Decimal;
}

interface JournalLine {
  accountId: string;
  debit: Decimal;
  credit: Decimal;
  description?: string;
}
```

#### Financial Reports
- **งบดุล (Balance Sheet)** - สินทรัพย์ = หนี้สิน + ส่วนของเจ้าของ
- **งบกำไรขาดทุน (P&L)** - รายได้ - ค่าใช้จ่าย
- **งบกระแสเงินสด (Cash Flow)** - เงินสดเข้า/ออก

#### การเชื่อมโยงกับระบบปัจจุบัน
```typescript
// เมื่อสร้าง Purchase Order → บันทึกภาระผูกพัน
// เมื่อรับสินค้า → บันทึกสต็อก + ภาษีซื้อ
// เมื่อขาย → บันทึกรายได้ + ต้นทุนขาย
// เมื่อจ่ายเงิน → ลดเงินสด/ธนาคาร
```

---

### 2️⃣ MRP (Material Requirements Planning)

#### Logic การคำนวณ
```typescript
interface MRPResult {
  materialId: string;
  materialName: string;
  requiredQty: number;      // จาก Work Orders
  availableQty: number;     // จาก Stock
  reservedQty: number;      // จาก Work Orders อื่น
  availableToUse: number;   // available - reserved
  toPurchaseQty: number;    // required - availableToUse
  needByDate: Date;         // วันที่ต้องใช้
  suggestedOrderDate: Date; // วันที่ควรสั่ง (lead time)
}
```

#### กระบวนการทำงาน
1. รวมความต้องการวัตถุดิบจากทุก Work Orders
2. หักลบด้วยสต็อกปัจจุบัน
3. หักลบด้วยวัตถุดิบที่จองไว้แล้ว
4. คำนวณวันที่ต้องสั่งซื้อ (อิงจาก lead time ของ supplier)
5. สร้าง Purchase Order อัตโนมัติ หรือแจ้งเตือน

---

### 3️⃣ RBAC (Role-Based Access Control)

#### Role Hierarchy
```typescript
type Role = 'ADMIN' | 'MANAGER' | 'SUPERVISOR' | 'OPERATOR' | 'VIEWER';

type Permission =
  // Orders
  | 'orders:create' | 'orders:read' | 'orders:update' | 'orders:delete' | 'orders:approve'
  // Work Orders
  | 'workorders:create' | 'workorders:read' | 'workorders:update' | 'workorders:complete'
  // Purchase Orders
  | 'purchaseorders:create' | 'purchaseorders:approve' | 'purchaseorders:receive'
  // Accounting
  | 'accounting:read' | 'accounting:write' | 'accounting:approve'
  // Reports
  | 'reports:view' | 'reports:export'
  // Settings
  | 'settings:manage';
```

#### User Groups (จาก Carbon ERP)
```typescript
interface UserGroup {
  id: string;
  name: string;
  permissions: Permission[];
  users: User[];
}

// ตัวอย่าง: กลุ่ม "ฝ่ายผลิต" มองเห็นเฉพาะ Work Orders
// ตัวอย่าง: กลุ่ม "ฝ่ายจัดซื้อ" มองเห็นเฉพาะ Purchase Orders
```

---

### 4️⃣ Nested BOM (BoM ซับซ้อน)

#### โครงสร้าง Multi-level
```
ที่นอนสปริง 6 ฟุต (Finished Good)
├── ตัวที่นอน (Semi-finished) - มี BOM ของตัวเอง
│   ├── สปริง (Raw Material)
│   ├── ไส้ผ้า (Raw Material)
│   └── ฟองน้ำ (Raw Material)
├── ฐานที่นอน (Semi-finished) - มี BOM ของตัวเอง
│   ├── ไม้ (Raw Material)
│   └── ขาตั้ง (Raw Material)
└── ผ้าหุ้ม (Raw Material)
```

#### Schema ที่ต้องแก้ไข
```prisma
model BOM {
  id        String    @id @default(cuid())
  productId String
  product   Product   @relation(fields: [productId], references: [id])
  parentId  String?   // ← เพิ่ม: อ้างอิง BOM แม่
  parent    BOM?      @relation("BOMHierarchy", fields: [parentId], references: [id])
  children  BOM[]     @relation("BOMHierarchy") // ← BOM ลูก
  version   String
  status    String    @default("DRAFT")
  // ...
}
```

---

### 5️⃣ QMS (Quality Management System)

#### Inspection Plans
```typescript
interface InspectionPlan {
  id: string;
  productId: string;
  checkpoints: Checkpoint[];
}

interface Checkpoint {
  name: string;           // เช่น "ความแข็งแรงของโครง"
  method: string;         // เช่น "ทดสอบแรงกด"
  standard: string;       // เกณฑ์ที่ต้องผ่าน
  tolerance?: string;     // ช่วงค่ายอมรับ
}
```

#### Quality Control Records
```typescript
interface QCRecord {
  id: string;
  workOrderId: string;
  checkpointId: string;
  result: 'PASS' | 'FAIL';
  measuredValue?: string;
  inspectorId: string;
  inspectedAt: Date;
  notes?: string;
}
```

---

### 6️⃣ Capacity Planning

```typescript
interface WorkCenter {
  id: string;
  name: string;           // เช่น "แผนกตัดผ้า"
  capacityPerDay: number; // หน่วย/วัน
  operatingHours: number; // ชั่วโมงทำงาน/วัน
}

interface CapacityCheck {
  workCenterId: string;
  date: Date;
  availableCapacity: number;
  plannedLoad: number;
  remainingCapacity: number;
  overloaded: boolean;
}
```

---

## 🛠️ แผนการพัฒนา (Development Roadmap)

### Phase 1: Core Accounting (Priority: 🔴 HIGH)
**ระยะเวลา:** 1-2 สัปดาห์

```
├── 1. Chart of Accounts
│   └── สร้างผังบัญชีมาตรฐาน (ตามประมวลบัญชีไทย)
│
├── 2. Journal Entries
│   └── ระบบบันทึกรายการคู่ (Double Entry)
│
├── 3. Integration
│   ├── PO → ภาระผูกพัน (Liability)
│   ├── รับสินค้า → สต็อก + ภาษีซื้อ
│   ├── ขาย → รายได้ + ลดสต็อก
│   └── จ่ายเงิน → เงินสด/ธนาคาร
│
└── 4. Reports
    ├── งบทดลอง (Trial Balance)
    ├── งบดุล
    └── งบกำไรขาดทุน
```

### Phase 2: MRP & Planning (Priority: 🔴 HIGH)
**ระยะเวลา:** 2 สัปดาห์

```
├── 1. Material Requirements Calculation
│   └── คำนวณจาก Work Orders + BOM
│
├── 2. Stock Reservation
│   └── จองวัตถุดิบสำหรับ Work Order
│
├── 3. Auto-generate PO
│   └── สร้าง Purchase Order อัตโนมัติ
│
└── 4. Alerts
    └── แจ้งเตือนวัตถุดิบต่ำกว่า min stock
```

### Phase 3: RBAC & Security (Priority: 🟠 MEDIUM)
**ระยะเวลา:** 1 สัปดาห์

```
├── 1. Role Management
│   └── สร้าง/แก้ไข Roles
│
├── 2. Permission Middleware
│   └── ตรวจสอบสิทธิ์ใน API
│
├── 3. UI Guards
│   └── ซ่อน/แสดงเมนูตามสิทธิ์
│
└── 4. Audit Logs
    └── บันทึกการใช้งานทั้งหมด
```

### Phase 4: Advanced Features (Priority: 🟡 LOW)
**ระยะเวลา:** ตามความจำเป็น

```
├── 1. Nested BOM
│   └── Multi-level Bill of Materials
│
├── 2. QMS
│   └── Quality Control & Traceability
│
├── 3. Capacity Planning
│   └── วางแผนกำลังการผลิต
│
└── 4. Advanced Reporting
    └── Dashboard แบบ Real-time
```

---

## 📁 โครงสร้างไฟล์ที่แนะนำ

```
CRM-BOM-Stock/
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── accounting/          # NEW
│   │   │   │   ├── accounts.routes.ts
│   │   │   │   ├── journal.routes.ts
│   │   │   │   └── reports.routes.ts
│   │   │   └── ...
│   │   │
│   │   ├── services/
│   │   │   ├── accounting/          # NEW
│   │   │   │   ├── ledger.service.ts
│   │   │   │   └── report.service.ts
│   │   │   ├── mrp/                 # NEW
│   │   │   │   └── mrp.service.ts
│   │   │   └── ...
│   │   │
│   │   ├── middleware/
│   │   │   ├── auth.middleware.ts
│   │   │   └── rbac.middleware.ts   # NEW
│   │   │
│   │   └── utils/
│   │       └── permissions.ts       # NEW
│   │
│   └── prisma/
│       └── schema.prisma            # ADD models
│
└── frontend/
    └── src/
        ├── pages/
        │   ├── Accounting/          # NEW
        │   │   ├── ChartOfAccounts.tsx
        │   │   ├── JournalEntries.tsx
        │   │   └── FinancialReports.tsx
        │   └── ...
        │
        ├── components/
        │   └── rbac/                # NEW
        │       ├── ProtectedRoute.tsx
        │       └── PermissionGuard.tsx
        │
        └── hooks/
            └── usePermissions.ts    # NEW
```

---

## 🔗 Quick Links

| Resource | URL |
|----------|-----|
| Carbon ERP GitHub | https://github.com/crbnos/carbon |
| Carbon ERP Docs | https://learn.carbon.ms |
| Carbon ERP Website | https://carbon.ms |
| Database Schema Ref | https://github.com/crbnos/carbon/tree/main/packages/database/src |

---

## 📝 Notes

- Carbon ERP ใช้ **AGPL License** - สามารถเรียนรู้และดึงแนวคิดมาใช้ได้ แต่ต้องเปิดเผย source code ถ้าแจกจ่าย
- ระบบคุณใช้ **SQLite** ส่วน Carbon ใช้ **PostgreSQL (Supabase)**
- ควรเริ่มจาก **Phase 1: Accounting** เพราะเป็นพื้นฐานของ ERP ที่แท้จริง
- ใช้ไฟล์นี้เป็น reference ในการพัฒนา - อัปเดตเมื่อมีการเพิ่มฟีเจอร์ใหม่

---

*Last Updated: 2026-02-02*
*Next Review: เมื่อเริ่ม Phase 2*
