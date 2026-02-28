# ระบบบัญชี - Sales & Accounting Module Flowchart

## 🔄 กระบวนการทำงานหลัก (Main Workflow)

```mermaid
flowchart TD
    Start([เริ่มต้น]) --> Customer{มีลูกค้า<br/>ในระบบ?}
    Customer -->|ไม่มี| AddCustomer[เพิ่มลูกค้าใหม่<br/>customers]
    Customer -->|มีอยู่แล้ว| Quotation[สร้างใบเสนอราคา<br/>quotations]
    AddCustomer --> Quotation
    
    Quotation --> QTItems[เพิ่มรายการ<br/>quotation_items]
    QTItems --> QTSent{ส่งใบเสนอราคา}
    QTSent -->|ลูกค้าอนุมัติ| CreateSO[สร้างคำสั่งขาย<br/>sales_orders]
    QTSent -->|ลูกค้าปฏิเสธ| QTCancel[ยกเลิกใบเสนอราคา<br/>quotations.status = 'REJECTED']
    QTSent -->|รอตอบกลับ| QTWait[รอลูกค้าตอบกลับ<br/>quotations.status = 'SENT']
    
    CreateSO --> SOItems[เพิ่มรายการ<br/>sales_order_items]
    SOItems --> CheckStock{ตรวจสอบ<br/>สต็อก}
    
    CheckStock -->|สต็อกพอ| ConfirmSO[ยืนยันคำสั่งขาย<br/>sales_orders.status = 'CONFIRMED']
    CheckStock -->|สต็อกไม่พอ| CreateWO[สร้างใบสั่งผลิต<br/>work_orders]
    
    CreateWO --> WODone[ผลิตเสร็จ<br/>work_orders.status = 'COMPLETED']
    WODone --> UpdateStock[เพิ่มสต็อกสินค้า<br/>stock_items, stock_movements]
    UpdateStock --> ConfirmSO
    
    ConfirmSO --> CreateDO[สร้างใบส่งของ<br/>delivery_orders]
    CreateDO --> DOItems[เพิ่มรายการส่ง<br/>delivery_order_items]
    DOItems --> Deliver{ส่งสินค้า}
    
    Deliver -->|ส่งสำเร็จ| DeductStock[ตัดสต็อก<br/>stock_items, stock_movements]
    DeductStock --> CreateInvoice[สร้างใบแจ้งหนี้<br/>invoices]
    
    CreateInvoice --> InvItems[เพิ่มรายการ<br/>invoice_items]
    InvItems --> IssueInv[ออกใบแจ้งหนี้<br/>invoices.status = 'ISSUED']
    
    IssueInv --> Payment{ชำระเงิน}
    Payment -->|ชำระเต็ม| FullPayment[บันทึกรับเงิน<br/>receipts]
    FullPayment --> UpdateInvFull[อัปเดตใบแจ้งหนี้<br/>invoices.status = 'PAID']
    
    Payment -->|ชำระบางส่วน| PartialPayment[บันทึกรับเงินบางส่วน<br/>receipts]
    PartialPayment --> UpdateInvPartial[อัปเดตใบแจ้งหนี้<br/>invoices.status = 'PARTIAL']
    UpdateInvPartial --> Payment
    
    UpdateInvFull --> End([จบกระบวนการ])
    
    Deliver -->|ส่งไม่สำเร็จ| DOReturn[ส่งคืน/เลื่อน<br/>delivery_orders.status = 'CANCELLED']
    DOReturn --> End
```

---

## 📊 ตาราง Database ที่ใช้ในแต่ละขั้นตอน

### 1. ขั้นตอน CRM (ลูกค้า)
| ขั้นตอน | ตารางหลัก | ตารางที่เชื่อมโยง | คำอธิบาย |
|---------|----------|------------------|---------|
| เพิ่มลูกค้า | `customers` | - | เก็บข้อมูลลูกค้า |

**ข้อมูลที่ดึง:**
- `customers.id` → ใช้เป็น `customer_id` ในทุกตาราง

---

### 2. ขั้นตอน Quotation (ใบเสนอราคา)
| ขั้นตอน | ตารางหลัก | ตารางที่เชื่อมโยง | คำอธิบาย |
|---------|----------|------------------|---------|
| สร้าง QT | `quotations` | `customers` | เก็บข้อมูลใบเสนอราคา |
| เพิ่มรายการ | `quotation_items` | `quotations`, `products` | รายละเอียดสินค้า |

**ข้อมูลที่ดึง:**
```sql
-- จาก customers
SELECT id, name, code, email, phone, address 
FROM customers WHERE id = ?

-- จาก products (สำหรับเพิ่มรายการ)
SELECT id, name, code 
FROM products WHERE id = ?
```

---

### 3. ขั้นตอน Sales Order (คำสั่งขาย)
| ขั้นตอน | ตารางหลัก | ตารางที่เชื่อมโยง | คำอธิบาย |
|---------|----------|------------------|---------|
| สร้าง SO | `sales_orders` | `customers`, `quotations` | คำสั่งซื้อที่ยืนยันแล้ว |
| เพิ่มรายการ | `sales_order_items` | `sales_orders`, `products`, `quotation_items` | รายละเอียดสินค้า |

**ข้อมูลที่ดึง:**
```sql
-- จาก quotations (ถ้าสร้างจาก QT)
SELECT * FROM quotations WHERE id = ?

-- จาก quotation_items (copy รายการ)
SELECT * FROM quotation_items WHERE quotation_id = ?

-- จาก stock_items (ตรวจสอบสต็อก)
SELECT quantity FROM stock_items 
WHERE product_id = ? AND tenant_id = ?
```

---

### 4. ขั้นตอน Stock Check (ตรวจสอบสต็อก)
| ขั้นตอน | ตารางหลัก | ตารางที่เชื่อมโยง | คำอธิบาย |
|---------|----------|------------------|---------|
| ตรวจสอบสต็อก | `stock_items` | `products` | เช็คจำนวนคงเหลือ |
| สร้างใบสั่งผลิต | `work_orders` | `boms`, `sales_orders` | สั่งผลิตเพิ่ม |

**ข้อมูลที่ดึง:**
```sql
-- ตรวจสอบสต็อก
SELECT si.quantity, si.id 
FROM stock_items si 
WHERE si.product_id = ? AND si.tenant_id = ?

-- ดึง BOM สำหรับผลิต
SELECT b.id, b.version 
FROM boms b 
WHERE b.product_id = ? AND b.tenant_id = ?

-- ดึงวัตถุดิบจาก BOM
SELECT bi.material_id, bi.quantity, m.unit_cost
FROM bom_items bi
JOIN materials m ON bi.material_id = m.id
WHERE bi.bom_id = ?
```

---

### 5. ขั้นตอน Work Order (การผลิต)
| ขั้นตอน | ตารางหลัก | ตารางที่เชื่อมโยง | คำอธิบาย |
|---------|----------|------------------|---------|
| สร้าง WO | `work_orders` | `boms` | ใบสั่งผลิต |
| วัตถุดิบ | `work_order_materials` | `work_orders`, `materials` | รายการวัตถุดิบ |

**ข้อมูลที่ดึง:**
```sql
-- ดึง BOM Items
SELECT bi.material_id, bi.quantity, m.name, m.unit
FROM bom_items bi
JOIN materials m ON bi.material_id = m.id
WHERE bi.bom_id = ?
```

---

### 6. ขั้นตอน Delivery (การส่งสินค้า)
| ขั้นตอน | ตารางหลัก | ตารางที่เชื่อมโยง | คำอธิบาย |
|---------|----------|------------------|---------|
| สร้าง DO | `delivery_orders` | `sales_orders`, `customers` | ใบส่งของ |
| รายการส่ง | `delivery_order_items` | `delivery_orders`, `sales_order_items`, `products` | รายละเอียด |

**ข้อมูลที่ดึง:**
```sql
-- จาก sales_order_items
SELECT soi.id, soi.product_id, soi.quantity, soi.delivered_qty
FROM sales_order_items soi
WHERE soi.sales_order_id = ?

-- ตัดสต็อกเมื่อส่งสำเร็จ
UPDATE stock_items 
SET quantity = quantity - ? 
WHERE product_id = ? AND tenant_id = ?

-- บันทึก movement
INSERT INTO stock_movements 
(stock_item_id, type, quantity, reference, notes)
VALUES (?, 'OUT', ?, ?, ?)
```

---

### 7. ขั้นตอน Invoicing (ใบแจ้งหนี้)
| ขั้นตอน | ตารางหลัก | ตารางที่เชื่อมโยง | คำอธิบาย |
|---------|----------|------------------|---------|
| สร้าง INV | `invoices` | `sales_orders`, `customers` | ใบแจ้งหนี้ |
| รายการ | `invoice_items` | `invoices`, `sales_order_items`, `products` | รายละเอียด |

**ข้อมูลที่ดึง:**
```sql
-- จาก sales_orders
SELECT subtotal, discount_amount, tax_rate, tax_amount, total_amount
FROM sales_orders WHERE id = ?

-- จาก sales_order_items
SELECT soi.id, soi.product_id, soi.quantity, soi.unit_price, soi.total_price
FROM sales_order_items soi
WHERE soi.sales_order_id = ?
```

---

### 8. ขั้นตอน Payment (การรับชำระ)
| ขั้นตอน | ตารางหลัก | ตารางที่เชื่อมโยง | คำอธิบาย |
|---------|----------|------------------|---------|
| รับเงิน | `receipts` | `invoices`, `customers` | ใบเสร็จรับเงิน |

**ข้อมูลที่ดึง:**
```sql
-- จาก invoices
SELECT total_amount, paid_amount, balance_amount
FROM invoices WHERE id = ?

-- อัปเดตใบแจ้งหนี้
UPDATE invoices 
SET paid_amount = paid_amount + ?,
    balance_amount = total_amount - (paid_amount + ?),
    payment_status = CASE 
      WHEN balance_amount = 0 THEN 'PAID'
      ELSE 'PARTIAL'
    END
WHERE id = ?
```

---

## 🔄 Entity Relationship Diagram

```mermaid
erDiagram
    customers ||--o{ quotations : "สร้าง"
    customers ||--o{ sales_orders : "สั่งซื้อ"
    customers ||--o{ delivery_orders : "รับสินค้า"
    customers ||--o{ invoices : "ออกใบ"
    customers ||--o{ receipts : "ชำระเงิน"
    
    quotations ||--o{ quotation_items : "มีรายการ"
    quotations ||--o{ sales_orders : "สร้างเป็น"
    
    sales_orders ||--o{ sales_order_items : "มีรายการ"
    sales_orders ||--o{ delivery_orders : "ส่งสินค้า"
    sales_orders ||--o{ invoices : "ออกใบ"
    
    delivery_orders ||--o{ delivery_order_items : "มีรายการ"
    
    invoices ||--o{ invoice_items : "มีรายการ"
    invoices ||--o{ receipts : "รับชำระ"
    
    products ||--o{ quotation_items : "อยู่ใน"
    products ||--o{ sales_order_items : "อยู่ใน"
    products ||--o{ delivery_order_items : "อยู่ใน"
    products ||--o{ invoice_items : "อยู่ใน"
    products ||--o{ stock_items : "คงคลัง"
    
    stock_items ||--o{ stock_movements : "มีการเคลื่อนไหว"
    
    sales_order_items ||--o{ delivery_order_items : "ส่ง"
    sales_order_items ||--o{ invoice_items : "ออกใบ"
    
    quotation_items ||--o{ sales_order_items : "copy"
    
    boms ||--o{ work_orders : "ใช้ผลิต"
    work_orders ||--o{ work_order_materials : "ใช้วัตถุดิบ"
    materials ||--o{ work_order_materials : "เป็นวัตถุดิบ"
    materials ||--o{ bom_items : "อยู่ใน"
    boms ||--o{ bom_items : "มีรายการ"
    
    customers {
        string id PK
        string code
        string name
        string type
        string email
        string phone
        string address
        real credit_limit
        string status
    }
    
    quotations {
        string id PK
        string quotation_number
        string customer_id FK
        string quotation_date
        string expiry_date
        real subtotal
        real discount_amount
        real tax_rate
        real tax_amount
        real total_amount
        string status
    }
    
    quotation_items {
        string id PK
        string quotation_id FK
        string product_id FK
        real quantity
        real unit_price
        real discount_percent
        real total_price
    }
    
    sales_orders {
        string id PK
        string so_number
        string quotation_id FK
        string customer_id FK
        string order_date
        string delivery_date
        real subtotal
        real discount_amount
        real tax_rate
        real tax_amount
        real total_amount
        string status
        string payment_status
    }
    
    sales_order_items {
        string id PK
        string sales_order_id FK
        string product_id FK
        string quotation_item_id FK
        real quantity
        real delivered_qty
        real unit_price
        real discount_percent
        real total_price
    }
    
    delivery_orders {
        string id PK
        string do_number
        string sales_order_id FK
        string customer_id FK
        string delivery_date
        string delivery_address
        string driver_name
        string vehicle_plate
        string status
    }
    
    delivery_order_items {
        string id PK
        string delivery_order_id FK
        string sales_order_item_id FK
        string product_id FK
        real quantity
    }
    
    invoices {
        string id PK
        string invoice_number
        string sales_order_id FK
        string customer_id FK
        string invoice_date
        string due_date
        real subtotal
        real discount_amount
        real tax_rate
        real tax_amount
        real total_amount
        real paid_amount
        real balance_amount
        string status
        string payment_status
    }
    
    invoice_items {
        string id PK
        string invoice_id FK
        string sales_order_item_id FK
        string product_id FK
        real quantity
        real unit_price
        real total_price
    }
    
    receipts {
        string id PK
        string receipt_number
        string invoice_id FK
        string customer_id FK
        string receipt_date
        string payment_method
        real amount
    }
    
    products {
        string id PK
        string code
        string name
        string category
        string status
    }
    
    stock_items {
        string id PK
        string product_id FK
        string sku
        integer quantity
        string unit
        string location
        string status
    }
    
    stock_movements {
        string id PK
        string stock_item_id FK
        string type
        integer quantity
        string reference
        string notes
    }
    
    boms {
        string id PK
        string product_id FK
        string version
        string status
    }
    
    bom_items {
        string id PK
        string bom_id FK
        string material_id FK
        real quantity
    }
    
    work_orders {
        string id PK
        string wo_number
        string bom_id FK
        integer quantity
        string status
        string priority
    }
    
    work_order_materials {
        string id PK
        string work_order_id FK
        string material_id FK
        real required_qty
        real issued_qty
    }
    
    materials {
        string id PK
        string code
        string name
        string unit
        real unit_cost
    }
```

---

## 📋 API Endpoints Summary

### Sales Module Routes (`/api/sales`)

| Method | Endpoint | คำอธิบาย | ตารางที่ใช้ |
|--------|----------|---------|------------|
| GET | `/summary` | ดูสถิติรวม | sales_orders, invoices, receipts |
| GET | `/quotations` | รายการใบเสนอราคา | quotations, quotation_items |
| POST | `/quotations` | สร้างใบเสนอราคา | quotations, quotation_items |
| GET | `/quotations/:id` | ดูรายละเอียด QT | quotations, quotation_items |
| PUT | `/quotations/:id/status` | อัปเดตสถานะ QT | quotations |
| GET | `/sales-orders` | รายการคำสั่งขาย | sales_orders, sales_order_items |
| POST | `/sales-orders` | สร้างคำสั่งขาย | sales_orders, sales_order_items |
| GET | `/sales-orders/:id` | ดูรายละเอียด SO | sales_orders, sales_order_items |
| PUT | `/sales-orders/:id/status` | อัปเดตสถานะ SO | sales_orders |
| GET | `/delivery-orders` | รายการใบส่งของ | delivery_orders, delivery_order_items |
| POST | `/delivery-orders` | สร้างใบส่งของ | delivery_orders, delivery_order_items |
| PUT | `/delivery-orders/:id/status` | อัปเดตสถานะ DO + ตัดสต็อก | delivery_orders, stock_items, stock_movements |
| GET | `/invoices` | รายการใบแจ้งหนี้ | invoices, invoice_items |
| POST | `/invoices` | สร้างใบแจ้งหนี้ | invoices, invoice_items |
| PUT | `/invoices/:id/status` | อัปเดตสถานะ INV | invoices |
| POST | `/receipts` | บันทึกการรับเงิน | receipts, invoices |

---

## 🎯 สรุป

ระบบ Sales Module ประกอบด้วย:

1. **9 ตารางใหม่:**
   - `quotations`, `quotation_items`
   - `sales_orders`, `sales_order_items`
   - `delivery_orders`, `delivery_order_items`
   - `invoices`, `invoice_items`
   - `receipts`

2. **เชื่อมโยงกับตารางเดิม:**
   - `customers` - ข้อมูลลูกค้า
   - `products` - ข้อมูลสินค้า
   - `stock_items`, `stock_movements` - การจัดการสต็อก
   - `boms`, `work_orders` - การผลิต (กรณีสต็อกไม่พอ)

3. **Flow หลัก:**
   ```
   QT → SO → (ตรวจสต็อก → WO ถ้าขาด) → DO → INV → Receipt
   ```
