# 🚀 Quick Start Guide

ทดลองใช้ **CRM-BOM-Stock Web App** ได้ทันที โดยไม่ต้องติดตั้ง database!

## ⚡ รันในครั้งเดียว (5 นาที)

### 1. Clone Repository

```bash
git clone <repository-url>
cd CRM-BOM-Stock
```

### 2. Install Dependencies

```bash
# Install root dependencies
npm install

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### 3. Start Backend Server

```bash
# จาก backend directory
cd backend
npm run dev
```

Server จะรันที่ `http://localhost:5000`

### 4. Start Frontend App (Terminal ใหม่)

```bash
# จาก frontend directory
cd frontend
npm run dev
```

Frontend จะรันที่ `http://localhost:3000`

---

## 🎯 ทดสอบ API โดยตรง

### Health Check
```bash
curl http://localhost:5000/api/health
```

### Dashboard Stats
```bash
curl http://localhost:5000/api/dashboard/stats
```

### Get All Customers
```bash
curl http://localhost:5000/api/customers
```

### Get All Stock Items
```bash
curl http://localhost:5000/api/stock
```

### Get All BOMs
```bash
curl http://localhost:5000/api/bom
```

---

## 📊 ข้อมูลตัวอย่างที่มีใน Mock Database

### Customers (4 รายการ)
- **Hotel Grand Deluxe** (โรงแรม)
- **ABC Trading Co.** (ขายส่ง)
- **Resort Paradise** (โรงแรม)
- **Sleep Well Store** (ร้านค้าปลีก)

### Products (4 รายการ)
- King Size Mattress Premium
- Queen Size Mattress
- Premium Pillow Set
- Luxury Blanket

### Materials (5 รายการ)
- Foam Layer
- Spring Coils
- Fabric Cover
- Thread
- Zipper

### Stock Items (5 รายการ)
- Foam Material (CRITICAL - ต่ำกว่าจุดสั่งซื้อ)
- Spring Coils (ADEQUATE)
- King Mattress Premium (ADEQUATE)
- Premium Pillow (OVERSTOCK)
- Fabric Cover (LOW)

### Orders (4 รายการ)
- ORD-1234: Hotel Grand Deluxe - Processing
- ORD-1233: ABC Trading - Completed
- ORD-1232: Resort Paradise - Pending
- ORD-1231: Sleep Well Store - Completed

---

## 🎨 Features ที่ทดสอบได้

### ✅ Dashboard
- ดูสถิติภาพรวม (ลูกค้า, คำสั่งซื้อ, สต็อก, รายได้)
- กราฟยอดขายและการผลิต
- รายการ activities ล่าสุด
- Stock alerts สำหรับสินค้าใกล้หมด

### ✅ CRM Module
- ดูรายการลูกค้าทั้งหมด
- ค้นหาและกรองตามประเภท (Hotel, Wholesale, Retail)
- ดูสถิติแต่ละลูกค้า (จำนวนคำสั่งซื้อ, ยอดรวม)

### ✅ BOM Module
- ดูสูตรการผลิต (Bill of Materials)
- ดูรายการวัตถุดิบที่ใช้
- คำนวณต้นทุนการผลิตอัตโนมัติ

### ✅ Stock Module
- ดูสินค้าคงคลังทั้งหมด
- แยกประเภท (วัตถุดิบ, สินค้ากึ่งสำเร็จ, สินค้าสำเร็จรูป)
- ดู stock status (Critical, Low, Adequate, Overstock)
- กรองตาม category และ status

---

## 💡 ข้อดีของ Mock Database

1. **ไม่ต้องติดตั้ง PostgreSQL** - ข้อมูลเก็บใน memory
2. **รันได้ทันที** - ไม่ต้อง run migrations
3. **Reset ง่าย** - แค่ restart server ก็กลับมาเป็นข้อมูลเริ่มต้น
4. **เหมาะสำหรับ Development** - ทดสอบได้เร็ว ไม่ต้องกังวลเรื่อง database

---

## 🔄 ต้องการใช้ Database จริง?

ถ้าต้องการเปลี่ยนไปใช้ PostgreSQL จริง:

1. แก้ไข `backend/prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```

2. แก้ไข `backend/.env`:
   ```
   DATABASE_URL="postgresql://user:password@localhost:5432/crm_bom_stock"
   ```

3. Run migrations:
   ```bash
   cd backend
   npx prisma migrate dev
   npx prisma db seed
   ```

4. แก้ไข routes ให้ใช้ Prisma แทน mock data

---

## 📝 Demo Credentials (สำหรับ Login Page)

```
Email: admin@example.com
Password: admin123
```

---

## 🎯 API Endpoints ทั้งหมด

### Authentication
- `POST /api/auth/login` - Login
- `POST /api/auth/register` - Register

### Dashboard
- `GET /api/dashboard/stats` - Dashboard statistics
- `GET /api/dashboard/activities` - Recent activities

### Customers
- `GET /api/customers` - Get all customers
- `GET /api/customers/:id` - Get customer by ID
- `POST /api/customers` - Create customer
- `PUT /api/customers/:id` - Update customer
- `DELETE /api/customers/:id` - Delete customer

### BOM
- `GET /api/bom` - Get all BOMs
- `GET /api/bom/:id` - Get BOM by ID
- `POST /api/bom` - Create BOM
- `PUT /api/bom/:id` - Update BOM
- `DELETE /api/bom/:id` - Delete BOM

### Stock
- `GET /api/stock` - Get all stock items
- `GET /api/stock/:id` - Get stock item by ID
- `POST /api/stock` - Create stock item
- `POST /api/stock/movement` - Record stock movement
- `PUT /api/stock/:id` - Update stock item
- `DELETE /api/stock/:id` - Delete stock item

### Orders
- `GET /api/orders` - Get all orders
- `GET /api/orders/:id` - Get order by ID
- `POST /api/orders` - Create order
- `PUT /api/orders/:id` - Update order
- `DELETE /api/orders/:id` - Delete order

---

## ❓ Troubleshooting

### Port Already in Use
```bash
# หา process ที่ใช้ port 5000
lsof -i :5000
# ปิด process
kill -9 <PID>
```

### Cannot Connect to Backend
- เช็คว่า backend server รันอยู่หรือไม่
- เช็ค port ว่าตรงกับ config (5000)

### Frontend ไม่เชื่อม Backend
- เช็ค proxy setting ใน `frontend/vite.config.ts`
- ควรเป็น `http://localhost:5000`

---

**Happy Coding! 🚀**
