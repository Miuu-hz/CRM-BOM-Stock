# ระบบ Approval Workflow - สรุป

## ✅ ระบบที่สร้างเสร็จแล้ว

### 1. Database Tables (5 ตาราง)

```sql
approval_settings          # ตั้งค่าการอนุมัติตาม Role (Master ID only)
approval_requests          # คำขออนุมัติ
approval_logs              # Audit trail
user_approval_permissions  # สิทธิ์ผู้ใช้ (ใครอนุมัติอะไรได้)
stock_adjustments          # การปรับ Stock แบบ Manual
```

### 2. Backend API Endpoints

#### Approval Settings (Master ID only)
```
GET    /api/approval/settings
POST   /api/approval/settings          # ตั้งค่า approval ตาม role
DELETE /api/approval/settings/:id
```

#### User Permissions (Master ID only)
```
GET    /api/approval/permissions
POST   /api/approval/permissions       # ให้สิทธิ์ user
DELETE /api/approval/permissions/:id
```

#### Approval Check
```
GET    /api/approval/check-required?moduleType=PRODUCTION&amount=50000
```

#### Approval Requests
```
GET    /api/approval/pending           # รายการรออนุมัติ (สำหรับผู้อนุมัติ)
GET    /api/approval/my-requests       # รายการที่ฉันขอ
GET    /api/approval/requests/:id
POST   /api/approval/requests          # สร้างคำขออนุมัติ
PUT    /api/approval/requests/:id/decision   # อนุมัติ/ปฏิเสธ
```

#### Stock Adjustments
```
GET    /api/approval/stock-adjustments
POST   /api/approval/stock-adjustments # ปรับ stock (จะสร้าง approval request อัตโนมัติ)
```

---

## 🎯 Module Types ที่รองรับ

| Module Type | ใช้เมื่อ | อนุมัติโดย |
|-------------|----------|------------|
| `PRODUCTION` | สั่งผลิตก่อนเพิ่ม stock | หัวหน้าฝ่ายผลิต → Master ID |
| `PURCHASE_PAYMENT` | จ่ายเงินผู้ขาย | หัวหน้าบัญชี → Master ID |
| `SALES_RECEIPT` | ออกใบเสร็จรับเงิน | หัวหน้าฝ่ายขาย → Master ID |
| `STOCK_ADJUSTMENT` | ปรับ stock แบบ manual | หัวหน้าคลัง → Master ID |

---

## ⚙️ การตั้งค่า Approval (ผ่าน API)

### 1. ตั้งค่าให้ Production Manager ต้องอนุมัติก่อนสั่งผลิต
```bash
POST /api/approval/settings
{
  "role": "PRODUCTION_MANAGER",
  "moduleType": "PRODUCTION",
  "approvalRequired": true,
  "autoApproveThreshold": 0  # ไม่มี auto-approve
}
```

### 2. ให้สิทธิ์ User อนุมัติได้
```bash
POST /api/approval/permissions
{
  "userId": "user-123",
  "moduleType": "PRODUCTION",
  "canApprove": true,
  "canApproveUnlimited": false,
  "approvalLimit": 100000,  # อนุมัติได้สูงสุด 100,000
  "isMasterApprover": false
}
```

### 3. ให้สิทธิ์ Master Approver
```bash
POST /api/approval/permissions
{
  "userId": "admin-001",
  "moduleType": "PRODUCTION",
  "canApprove": true,
  "canApproveUnlimited": true,
  "isMasterApprover": true
}
```

---

## 🔄 Flow การใช้งาน

### 1. ตรวจสอบว่าต้องขออนุมัติหรือไม่
```javascript
// ก่อนสร้าง Work Order
const check = await fetch('/api/approval/check-required?moduleType=PRODUCTION&amount=50000')
// ถ้า required: true → ต้องสร้าง approval request ก่อน
// ถ้า required: false → ทำได้เลย
```

### 2. สร้างคำขออนุมัติ
```bash
POST /api/approval/requests
{
  "moduleType": "PRODUCTION",
  "referenceType": "work_orders",
  "referenceId": "wo-123",
  "amount": 50000,
  "description": "สั่งผลิตผ้าปูที่นอน 6ฟุต จำนวน 100 ชุด"
}
# จะได้ approval request number: APR-2024-00001
```

### 3. ผู้อนุมัติดูรายการรออนุมัติ
```bash
GET /api/approval/pending
# แสดงเฉพาะรายการที่ user มีสิทธิ์อนุมัติ
```

### 4. อนุมัติ/ปฏิเสธ
```bash
PUT /api/approval/requests/APR-2024-00001/decision
{
  "decision": "APPROVED",  # หรือ "REJECTED"
  "comment": "อนุมัติตามที่ขอ",
  "level": 1  # Level 1 = หัวหน้าฝ่าย, Level 2 = Master ID
}
```

### 5. ถ้าอนุมัติแล้ว ระบบจะดำเนินการอัตโนมัติ
- Work Order: เปลี่ยน status เป็น 'APPROVED'
- Payment: เปลี่ยน status เป็น 'APPROVED' พร้อมจ่ายเงินได้
- Stock Adjustment: ปรับ stock ทันที

---

## ⚠️ สิ่งที่ต้องปรับปรุงต่อ (Integration)

### 1. ปรับ Work Order Route
ไฟล์: `workOrder.routes.ts`
```typescript
// ก่อนสร้าง Work Order ต้องเช็ค approval
router.post('/', async (req, res) => {
  // Check if approval required
  const approvalCheck = checkApprovalRequired('PRODUCTION', amount)
  
  if (approvalCheck.required) {
    // Create Work Order with status 'PENDING_APPROVAL'
    // Create Approval Request
    // Return message: "Work order created and pending approval"
  } else {
    // Create Work Order normally
  }
})
```

### 2. ปรับ Supplier Payment Route
ไฟล์: `purchase.routes.ts`
```typescript
// ก่อนจ่ายเงินต้องเช็ค approval
router.post('/payments', async (req, res) => {
  const approvalCheck = checkApprovalRequired('PURCHASE_PAYMENT', amount)
  
  if (approvalCheck.required) {
    // Create payment with status 'PENDING_APPROVAL'
    // Create Approval Request
  } else {
    // Process payment normally
  }
})
```

### 3. ปรับ Sales Receipt Route
ไฟล์: `sales.routes.ts`
```typescript
// ก่อนออกใบเสร็จต้องเช็ค approval
router.post('/receipts', async (req, res) => {
  const approvalCheck = checkApprovalRequired('SALES_RECEIPT', amount)
  
  if (approvalCheck.required) {
    // Create receipt with status 'PENDING_APPROVAL'
    // Create Approval Request
  } else {
    // Create receipt normally
  }
})
```

---

## 📊 ตัวอย่างการใช้งาน

### สถานการณ์: สั่งผลิตสินค้า

1. **พนักงานฝ่ายผลิต** ต้องการสั่งผลิต
   ```bash
   POST /api/work-orders
   # ระบบตรวจสอบ: Production Manager ต้องอนุมัติ
   # Work Order ถูกสร้างด้วย status 'PENDING_APPROVAL'
   ```

2. **สร้างคำขออนุมัติอัตโนมัติ**
   ```bash
   POST /api/approval/requests
   # สร้าง APR-2024-00001
   ```

3. **หัวหน้าฝ่ายผลิต** เห็นรายการรออนุมัติ
   ```bash
   GET /api/approval/pending
   # เห็น APR-2024-00001
   ```

4. **หัวหน้าฝ่ายผลิต** อนุมัติ
   ```bash
   PUT /api/approval/requests/APR-2024-00001/decision
   { "decision": "APPROVED", "level": 1 }
   ```

5. **Master ID** เห็นรายการรออนุมัติ (Level 2)
   ```bash
   GET /api/approval/pending
   # เห็น APR-2024-00001 (รอ Level 2)
   ```

6. **Master ID** อนุมัติขั้นสุดท้าย
   ```bash
   PUT /api/approval/requests/APR-2024-00001/decision
   { "decision": "APPROVED", "level": 2 }
   # ระบบ execute อัตโนมัติ: Work Order status → 'APPROVED'
   ```

---

## ✅ พร้อมใช้งานแล้ว!

ระบบ Approval Workflow พร้อมใช้งานแล้วครับ แต่ต้องปรับ integration ในแต่ละ module ให้เรียกใช้ API นี้ก่อนดำเนินการ 🎯
