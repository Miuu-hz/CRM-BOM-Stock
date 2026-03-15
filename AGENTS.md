# CRM-BOM-Stock Management System - Agent Guide

## Project Overview

This is a **CRM-BOM-Stock Management System** for a bedding factory (โรงงานผลิตเครื่องนอน). The system provides comprehensive management for Customer Relations, Bill of Materials (BOM), and Inventory/Stock control with a futuristic cyberpunk-themed UI.

**Primary Language**: The project uses Thai language in UI, documentation, and some comments.

### Key Modules

1. **CRM (Customer Relationship Management)** - จัดการข้อมูลลูกค้า
   - Customer management (Hotels, Wholesale, Retail)
   - Order tracking
   - Credit limit management
   - Sales reports

2. **BOM (Bill of Materials)** - สูตรการผลิต
   - Production recipes/formulas
   - Raw material lists with quantities
   - Cost calculation
   - Version control

3. **Stock/Inventory** - คลังสินค้า
   - Raw materials, WIP (Work in Progress), Finished goods
   - Stock alerts (Critical, Low, Adequate, Overstock)
   - Stock movements tracking

4. **Marketing Module** - การตลาด
   - E-commerce platform integration (Shopee)
   - CSV upload for marketing metrics
   - Performance analytics (ROAS, ACOS, CTR, etc.)

5. **Calculator** - เครื่องมือคำนวณ
   - Production cost simulation
   - Saved BOM calculations

---

## Technology Stack

### Frontend
- **React 18** - UI Library
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **TailwindCSS** - Utility-first CSS
- **Framer Motion** - Animations
- **Recharts** - Data visualization
- **React Query (TanStack)** - Data fetching and caching
- **Zustand** - State management
- **React Router** - Client-side routing
- **Axios** - HTTP client
- **Lucide React** - Icons
- **date-fns** - Date utilities
- **react-hot-toast** - Toast notifications

### Backend
- **Node.js** - Runtime
- **Express.js** - Web framework
- **TypeScript** - Type safety
- **better-sqlite3** - SQLite database driver
- **bcryptjs** - Password hashing
- **jsonwebtoken** - JWT authentication
- **cors** - Cross-origin resource sharing
- **multer** - File upload handling
- **papaparse** - CSV parsing
- **zod** - Schema validation
- **express-validator** - Request validation

### Database
- **SQLite** - File-based database (data.db)
- Uses **better-sqlite3** for synchronous operations
- WAL mode enabled for better performance
- Single unified database file at `backend/data.db`

---

## Project Structure

```
CRM-BOM-Stock/
├── frontend/                    # React Frontend
│   ├── src/
│   │   ├── components/          # Reusable Components
│   │   │   ├── bom/             # BOM-specific components
│   │   │   ├── dashboard/       # Dashboard widgets
│   │   │   └── layout/          # Layout components (Header, Sidebar)
│   │   ├── pages/               # Page components
│   │   │   ├── Dashboard.tsx
│   │   │   ├── CRM.tsx
│   │   │   ├── BOM.tsx
│   │   │   ├── Stock.tsx
│   │   │   ├── Calculator.tsx
│   │   │   ├── Marketing.tsx
│   │   │   └── Login.tsx
│   │   ├── services/            # API service functions
│   │   ├── hooks/               # Custom React hooks
│   │   ├── App.tsx              # Main app component
│   │   ├── main.tsx             # Entry point
│   │   └── index.css            # Global styles (futuristic theme)
│   ├── package.json
│   ├── vite.config.ts           # Vite configuration with proxy
│   ├── tailwind.config.js       # Tailwind with cyberpunk colors
│   └── tsconfig.json
│
├── backend/                     # Node.js Backend
│   ├── src/
│   │   ├── routes/              # API route handlers
│   │   │   ├── auth.routes.ts
│   │   │   ├── customer.routes.ts
│   │   │   ├── order.routes.ts
│   │   │   ├── bom.routes.ts
│   │   │   ├── materials.routes.ts
│   │   │   ├── stock.routes.ts
│   │   │   ├── dashboard.routes.ts
│   │   │   ├── calculator.routes.ts
│   │   │   ├── data.routes.ts
│   │   │   ├── marketing.routes.ts
│   │   │   └── search.routes.ts
│   │   ├── repositories/        # Database access layer
│   │   │   ├── customer.repository.ts
│   │   │   ├── order.repository.ts
│   │   │   ├── product.repository.ts
│   │   │   ├── material.repository.ts
│   │   │   ├── bom.repository.ts
│   │   │   ├── stock.repository.ts
│   │   │   ├── marketing.repository.ts
│   │   │   ├── saved-bom.repository.ts
│   │   │   └── search.repository.ts
│   │   ├── services/            # Business logic
│   │   │   ├── costCalculation.service.ts
│   │   │   ├── csvParser.service.ts
│   │   │   └── platformFees.service.ts
│   │   ├── db/                  # Database setup
│   │   │   ├── database.ts      # SQLite connection & schema
│   │   │   └── seed.ts          # Seed data
│   │   └── index.ts             # Express app entry point
│   ├── prisma/
│   │   ├── schema.prisma        # Prisma schema (reference)
│   │   └── seed.ts              # Prisma seed script
│   ├── uploads/                 # Uploaded files (CSV, etc.)
│   ├── data.db                  # SQLite database file
│   ├── .env                     # Environment variables
│   ├── .env.example             # Environment template
│   └── package.json
│
├── package.json                 # Root package (concurrent dev)
├── README.md                    # Full documentation (Thai)
└── QUICKSTART.md                # Quick start guide
```

---

## Build and Development Commands

### Quick Start (from root)

```bash
# Install all dependencies (frontend + backend)
npm run install:all

# Run both frontend and backend concurrently
npm run dev
```

### Frontend Only

```bash
cd frontend
npm install
npm run dev          # Dev server on http://localhost:3000
npm run build        # Build for production
npm run preview      # Preview production build
npm run lint         # ESLint check
```

### Backend Only

```bash
cd backend
npm install
npm run dev          # Dev server with nodemon on http://localhost:5000
npm run build        # Compile TypeScript to dist/
npm start            # Run compiled code
```

### Root Package Scripts

The root `package.json` provides:
- `npm run dev` - Runs both frontend and backend concurrently

Note: There is no `install:all` script defined in current package.json. You need to install dependencies separately:
```bash
cd frontend && npm install
cd ../backend && npm install
```

---

## Configuration

### Backend Environment Variables (.env)

```bash
PORT=5000
NODE_ENV=development
DATABASE_URL="file:./prisma.db"  # Not actively used (uses data.db directly)
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRE=7d
CORS_ORIGIN=http://localhost:3000
```

### Frontend Vite Config

- Dev server runs on port 3000
- API proxy: `/api` → `http://localhost:5000`
- Path alias: `@/` maps to `./src`
- Allowed host: `bb.phopy.net` (for production)

### Tailwind Theme (Cyberpunk/Futuristic)

Custom colors defined in `tailwind.config.js`:
- `cyber-primary`: #00f0ff (Cyan/Neon Blue)
- `cyber-secondary`: #0066ff (Blue)
- `cyber-purple`: #9d00ff (Purple)
- `cyber-magenta`: #ff00ff (Magenta)
- `cyber-green`: #00ff88 (Neon Green)
- `cyber-dark`: #0a0e27 (Deep Space)
- `cyber-darker`: #1a1d35
- `cyber-card`: #151932
- `cyber-border`: #2d3250

---

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration

### Customers
- `GET /api/customers` - List all customers
- `GET /api/customers/summary` - CRM summary stats
- `GET /api/customers/:id` - Get customer by ID
- `GET /api/customers/:id/insights` - Detailed customer analytics
- `POST /api/customers` - Create customer
- `PUT /api/customers/:id` - Update customer
- `DELETE /api/customers/:id` - Delete customer

### Orders
- `GET /api/orders` - List all orders
- `GET /api/orders/:id` - Get order by ID
- `POST /api/orders` - Create order
- `PUT /api/orders/:id` - Update order
- `DELETE /api/orders/:id` - Delete order

### BOM
- `GET /api/bom` - List all BOMs
- `GET /api/bom/:id` - Get BOM by ID
- `POST /api/bom` - Create BOM
- `PUT /api/bom/:id` - Update BOM
- `DELETE /api/bom/:id` - Delete BOM

### Materials
- `GET /api/materials` - List all materials
- `GET /api/materials/:id` - Get material by ID
- `POST /api/materials` - Create material
- `PUT /api/materials/:id` - Update material
- `DELETE /api/materials/:id` - Delete material

### Stock
- `GET /api/stock` - List all stock items
- `GET /api/stock/:id` - Get stock item by ID
- `POST /api/stock` - Create stock item
- `POST /api/stock/movement` - Record stock movement
- `PUT /api/stock/:id` - Update stock item
- `DELETE /api/stock/:id` - Delete stock item

### Marketing
- `GET /api/marketing/shops` - List connected shops
- `POST /api/marketing/shops` - Add new shop
- `GET /api/marketing/files` - List uploaded files
- `POST /api/marketing/upload` - Upload CSV file
- `GET /api/marketing/metrics` - Get marketing metrics

### Calculator
- `GET /api/calculator/materials` - Get materials for calculator
- `POST /api/calculator/calculate` - Calculate production cost
- `GET /api/calculator/saved` - List saved calculations
- `POST /api/calculator/save` - Save calculation

### Dashboard
- `GET /api/dashboard/stats` - Dashboard statistics
- `GET /api/dashboard/activities` - Recent activities

### Search
- `GET /api/search?query=&type=` - Global search

### Health Check
- `GET /api/health` - API health status

---

## Code Style Guidelines

### TypeScript

- **Strict mode enabled** in both frontend and backend
- Use explicit types for function parameters and return values
- Path alias `@/` is configured for frontend imports
- Prefer interfaces over types for object definitions

### Backend Patterns

1. **Route Structure**:
   ```typescript
   import { Router } from 'express'
   const router = Router()
   // Define routes
   export default router
   ```

2. **Repository Pattern**: All database operations are abstracted in repository files under `src/repositories/`

3. **Error Handling**: Use try-catch blocks with consistent error response format:
   ```typescript
   res.status(500).json({ success: false, message: 'Error message' })
   ```

4. **Success Response Format**:
   ```typescript
   res.json({ success: true, data: result })
   res.json({ success: true, message: 'Success message', data: result })
   ```

### Frontend Patterns

1. **Component Structure**: Functional components with hooks
2. **State Management**: Zustand for global state, React Query for server state
3. **Styling**: TailwindCSS with custom cyberpunk color palette
4. **API Calls**: Use service functions in `src/services/`

---

## Database Schema

### Main Tables

1. **users** - System users
2. **customers** - Customer data (Hotels, Wholesale, Retail)
3. **orders** - Purchase orders
4. **order_items** - Items in each order
5. **products** - Product catalog
6. **boms** - Bill of Materials
7. **bom_items** - Materials in each BOM
8. **materials** - Raw materials catalog
9. **stock_items** - Inventory items
10. **stock_movements** - Stock transaction history
11. **shops** - E-commerce shop connections
12. **marketing_files** - Uploaded marketing CSV files
13. **marketing_metrics** - Parsed marketing data
14. **saved_boms** - Saved calculator configurations

### Database Helpers

The `database.ts` file provides:
- `generateId()` - Generate unique hex IDs (24 chars)
- `snakeToCamel(obj)` - Convert snake_case to camelCase
- `camelToSnake(obj)` - Convert camelCase to snake_case

---

## Testing

**Note**: The project currently has **no unit tests** configured. This is a known issue mentioned in the README.

For testing, use:
1. Manual testing via the UI
2. API testing with curl or Postman
3. Sample CSV files provided in root:
   - `shopee-sample-correct.csv`
   - `shopee-sample-multiday.csv`
   - `test-shopee-sample.csv`

---

## Security Considerations

1. **Authentication**: JWT-based auth is partially implemented but commented out in frontend (`App.tsx` sets `isAuthenticated = true`)
2. **Password Hashing**: bcryptjs is used for password hashing
3. **CORS**: Configured for localhost:3000 and bb.phopy.net
4. **Input Validation**: Use express-validator and zod for validation
5. **SQL Injection**: Protected by parameterized queries in better-sqlite3

---

## Demo Credentials

- **Email**: `admin@example.com`
- **Password**: `admin123`

---

## Known Issues & Limitations

1. **No real authentication**: Frontend has auth bypassed
2. **No unit tests**: Testing infrastructure not set up
3. **Marketing module**: Uses a separate database connection pattern
4. **File uploads**: Stored in `backend/uploads/` directory

---

## Development Tips

1. **Port Conflicts**: If port 5000 is in use, the backend will fail to start. Check `.env` for PORT configuration.

2. **Database Reset**: The SQLite database persists data. To reset:
   - Stop the backend
   - Delete `backend/data.db`
   - Restart backend (tables will be recreated)

3. **Frontend Hot Reload**: Vite provides fast HMR for development

4. **Backend Auto-restart**: nodemon watches for changes and restarts

5. **CSV Upload**: Marketing module accepts Shopee export CSV format

---

## Deployment Notes

1. Build frontend: `cd frontend && npm run build`
   - Output goes to `frontend/dist/`

2. Build backend: `cd backend && npm run build`
   - Output goes to `backend/dist/`

3. Production start: `cd backend && npm start`

4. Remember to:
   - Set proper JWT_SECRET in production
   - Configure CORS_ORIGIN for your domain
   - Set up proper database backup for SQLite file
