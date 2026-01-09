# 🛏️ CRM-BOM-Stock Management System

ระบบบริหารจัดการครบวงจรสำหรับโรงงานผลิตเครื่องนอน พร้อม UI แบบ **Futuristic Design**

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## ✨ Features

### 🤝 CRM (Customer Relationship Management)
- จัดการข้อมูลลูกค้า (โรงแรม, ร้านค้าปลีก, ขายส่ง)
- ติดตามประวัติการสั่งซื้อ
- จัดการ Credit Limit
- รายงานยอดขายตามลูกค้า

### 📋 BOM (Bill of Materials)
- สูตรการผลิตสินค้า
- รายการวัตถุดิบและปริมาณที่ใช้
- คำนวณต้นทุนการผลิต
- Version control ของสูตร
- รองรับหลายประเภทผลิตภัณฑ์

### 📦 Stock (Inventory Management)
- คลังวัตถุดิบ (Raw Material)
- คลังสินค้ากึ่งสำเร็จ (WIP - Work in Progress)
- คลังสินค้าสำเร็จรูป (Finished Goods)
- Stock Alert (แจ้งเตือนเมื่อของใกล้หมด)
- ติดตามการเข้า-ออกสินค้า
- รายงาน Stock Movement

### 📊 Dashboard
- สรุปภาพรวมธุรกิจแบบ Real-time
- กราฟยอดขายและการผลิต
- แจ้งเตือนสินค้าคงคลังต่ำ
- รายการคำสั่งซื้อล่าสุด

## 🎨 UI Design

ใช้ **Futuristic/Cyberpunk Theme** ที่ทันสมัยและสวยงาม:

- 🌊 สีหลัก: Cyan/Neon Blue (#00f0ff, #0066ff)
- 💜 สีรอง: Purple/Magenta (#9d00ff, #ff00ff)
- ✨ สีเน้น: Neon Green (#00ff88)
- 🌑 สีพื้นหลัง: Deep Space (#0a0e27, #1a1d35)
- Glow Effects และ Smooth Animations
- Glass Morphism Cards

## 🚀 Tech Stack

### Frontend
- **React 18** - UI Library
- **TypeScript** - Type Safety
- **Vite** - Fast Build Tool
- **TailwindCSS** - Utility-first CSS
- **Framer Motion** - Animation Library
- **Recharts** - Data Visualization
- **React Query** - Data Fetching
- **Zustand** - State Management
- **React Router** - Routing

### Backend
- **Node.js** - Runtime
- **Express** - Web Framework
- **TypeScript** - Type Safety
- **Prisma** - ORM
- **PostgreSQL** - Database
- **JWT** - Authentication
- **Zod** - Validation

## 📁 Project Structure

```
CRM-BOM-Stock/
├── frontend/                 # React Frontend
│   ├── src/
│   │   ├── components/      # Reusable Components
│   │   │   ├── dashboard/   # Dashboard Components
│   │   │   └── layout/      # Layout Components
│   │   ├── pages/           # Page Components
│   │   │   ├── Dashboard.tsx
│   │   │   ├── CRM.tsx
│   │   │   ├── BOM.tsx
│   │   │   ├── Stock.tsx
│   │   │   └── Login.tsx
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.css
│   ├── package.json
│   └── vite.config.ts
│
├── backend/                 # Node.js Backend
│   ├── src/
│   │   ├── routes/         # API Routes
│   │   │   ├── auth.routes.ts
│   │   │   ├── customer.routes.ts
│   │   │   ├── order.routes.ts
│   │   │   ├── bom.routes.ts
│   │   │   ├── stock.routes.ts
│   │   │   └── dashboard.routes.ts
│   │   └── index.ts
│   ├── prisma/
│   │   └── schema.prisma   # Database Schema
│   ├── package.json
│   └── tsconfig.json
│
├── package.json            # Root Package
└── README.md
```

## 🛠️ Installation

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- npm หรือ yarn

### 1. Clone Repository

```bash
git clone <repository-url>
cd CRM-BOM-Stock
```

### 2. Install Dependencies

```bash
# Install root dependencies
npm install

# Install frontend dependencies
cd frontend
npm install

# Install backend dependencies
cd ../backend
npm install
```

### 3. Setup Database

```bash
cd backend

# Copy environment file
cp .env.example .env

# Edit .env and update DATABASE_URL
# DATABASE_URL="postgresql://user:password@localhost:5432/crm_bom_stock"

# Generate Prisma Client
npm run prisma:generate

# Run migrations
npm run prisma:migrate
```

### 4. Run Development Servers

```bash
# From root directory
npm run dev

# หรือรันแยกกัน

# Terminal 1 - Frontend (Port 3000)
cd frontend
npm run dev

# Terminal 2 - Backend (Port 5000)
cd backend
npm run dev
```

## 🌐 Access Application

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:5000/api
- **API Health**: http://localhost:5000/api/health

### Demo Login
- **Email**: `admin@example.com`
- **Password**: `admin123`

## 📊 Database Schema

### Main Tables
- `users` - ผู้ใช้งานระบบ
- `customers` - ข้อมูลลูกค้า
- `orders` - คำสั่งซื้อ
- `order_items` - รายการสินค้าในคำสั่งซื้อ
- `products` - สินค้า
- `boms` - สูตรการผลิต
- `bom_items` - รายการวัตถุดิบในสูตร
- `materials` - วัตถุดิบ
- `stock_items` - สินค้าคงคลัง
- `stock_movements` - การเคลื่อนไหวสต็อก

## 🎯 API Endpoints

### Authentication
- `POST /api/auth/login` - Login
- `POST /api/auth/register` - Register

### Customers
- `GET /api/customers` - Get all customers
- `GET /api/customers/:id` - Get customer by ID
- `POST /api/customers` - Create customer
- `PUT /api/customers/:id` - Update customer
- `DELETE /api/customers/:id` - Delete customer

### Orders
- `GET /api/orders` - Get all orders
- `GET /api/orders/:id` - Get order by ID
- `POST /api/orders` - Create order
- `PUT /api/orders/:id` - Update order
- `DELETE /api/orders/:id` - Delete order

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

### Dashboard
- `GET /api/dashboard/stats` - Get dashboard statistics
- `GET /api/dashboard/activities` - Get recent activities

## 🏗️ Build for Production

### Frontend

```bash
cd frontend
npm run build
# Output: frontend/dist
```

### Backend

```bash
cd backend
npm run build
# Output: backend/dist

# Start production server
npm start
```

## 📝 Development Workflow

1. **Feature Development**: สร้าง branch ใหม่จาก `main`
2. **Testing**: ทดสอบ features ให้ครบถ้วน
3. **Code Review**: ตรวจสอบโค้ดก่อน merge
4. **Deployment**: Deploy ผ่าน CI/CD pipeline

## 🐛 Known Issues

- Backend API routes ยังเป็น mock data (ต้อง implement Prisma queries)
- Authentication ยังไม่มี JWT implementation
- ยังไม่มี unit tests

## 🔮 Future Enhancements

- [ ] Implement full authentication & authorization
- [ ] Add data export (Excel, PDF)
- [ ] Barcode/QR Code scanning
- [ ] Mobile responsive optimization
- [ ] Email notifications
- [ ] Advanced reporting & analytics
- [ ] Multi-language support
- [ ] Real-time updates with WebSocket

## 🤝 Contributing

1. Fork the project
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License.

## 👨‍💻 Author

Developed for Bedding Factory Management

---

**Note**: ระบบนี้ยังอยู่ในช่วงพัฒนา (Development Phase) API endpoints บางส่วนยังเป็น mock data และต้องการการ implement เพิ่มเติม
