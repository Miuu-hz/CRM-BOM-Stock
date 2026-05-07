# Smart Unit Conversion — สรุปสิ่งที่ทำไปแล้ว

> อัปเดตล่าสุด: 2026-05-04

---

## ปัญหาที่แก้

1. **Chain conversion**: `แพ็ค → ขวด → ลิตร` ต้องเชื่อม 2 ขั้นอัตโนมัติ ไม่ error
2. **Spelling mismatch**: `แพค / แพ๊ค / แพ็ค` ทั้งหมดหมายถึง `pack`
3. **Sealed stock**: แยก stock ที่ยังไม่แกะ (แพ็ค) กับที่แกะแล้ว (ขวด)
4. **Auto-unpack**: ถ้า stock หลวยหมด → แกะแพ็คอัตโนมัติ
5. **LLM Advisor**: ช่วยแนะนำค่า factor ตอนตั้งค่า (ไม่ใช่ตอน transaction)
6. **UI list view**: GR และ PO list view ให้คลิกได้และมีปุ่มเหมือน card view

---

## สิ่งที่ทำไปแล้ว (Completed)

### 1. BFS Graph-Based Chain Conversion

**ไฟล์**: `backend/src/services/unitConversion.service.ts`

- เพิ่ม `buildConversionGraph(tenantId, materialId?)` — สร้าง adjacency graph จาก DB + STANDARD_CONVERSIONS (ทั้ง 2 ทิศทาง)
- เพิ่ม `findConversionChain(from, to, tenantId, materialId?)` — BFS หา multi-hop path (max depth 5) คืน `{ factor, path }` หรือ `null`
- เพิ่ม in-memory cache per tenant (TTL 5 นาที) + `invalidateConversionGraphCache()`
- แก้ `convertQuantityBidirectional()`: `direct → reverse → BFS → null`
- Invalidate cache เมื่อ create/update/delete conversion

### 2. Sealed Stock (sealed_qty)

**DB Migration** (`backend/src/db/sqlite.ts`):
```sql
ALTER TABLE stock_items ADD COLUMN sealed_qty INTEGER DEFAULT 0
```

**PO-GR** (`backend/src/routes/purchase.routes.ts`):
- รับสินค้าเข้า `sealed_qty` เมื่อหน่วย PO ตรงกับ `display_unit` ของ stock item
- รับสินค้าเข้า `quantity` (แปลงหน่วย) เมื่อหน่วย PO ตรงกับ base unit

**Frontend** (`frontend/src/services/stock.ts`):
- เพิ่ม `sealed_qty?: number` ใน `StockItem` interface

**Stock display** (`frontend/src/pages/Stock.tsx`):
- แสดง sealed qty แยกจาก quantity เมื่อ `sealed_qty > 0`
- เช่น `5 แพ็ค + 2 ขวด`

### 3. Auto-Unpack

**ไฟล์**: `backend/src/services/unitConversion.service.ts`

- เพิ่ม `autoUnpackIfNeeded(stockItem, neededInBase, tenantId)` → `AutoUnpackResult | null`
- Logic: `while (quantity < needed && sealed_qty > 0) { sealed_qty--; quantity += packFactor }`
- หา packFactor ผ่าน BFS (display_unit → base_unit)

**ใช้ใน 3 routes**:
- `stock.routes.ts` — OUT movement
- `workOrder.routes.ts` — เบิกวัตถุดิบตอน IN_PROGRESS
- `sales.routes.ts` — ส่งสินค้าตอน delivery

บันทึก stock movement type `'UNPACK'` ทุกครั้งที่แกะแพ็ค (audit trail)

### 4. BFS ครอบคลุมทุก Route

เปลี่ยนจาก `convertQuantity` (direct only) → `convertQuantityBidirectional` (direct + reverse + BFS) ใน:
- `backend/src/routes/bom.routes.ts` — คำนวณต้นทุน BOM
- `backend/src/routes/workOrder.routes.ts` — เบิกวัตถุดิบ
- `backend/src/routes/sales.routes.ts` — ส่งสินค้า
- `backend/src/routes/purchase.routes.ts` — รับสินค้า
- `backend/src/routes/stock.routes.ts` — OUT/ADJUST movement

### 5. Expand UNIT_NAME_MAP (ทั้ง Backend + Frontend)

`backend/src/services/unitConversion.service.ts` และ `frontend/src/pages/settings/UnitConversions.tsx`:

```typescript
'แพค': 'pack',      // ขาด mai ek
'แพ๊ค': 'pack',
'ลัง': 'case',
'กล่อง': 'box',
'ขวด': 'bottle',
'ซอง': 'sachet',
'ถุง': 'bag',
'หลอด': 'tube',
'กระป๋อง': 'can',
'แผ่น': 'sheet',
'เม็ด': 'tablet',
'กุรอส': 'gross',
```

### 6. LLM Settings Advisor

**`backend/src/services/llm.service.ts`**:
- เพิ่ม `suggestUnitConversion(from, to, materialName, existing)` → `{ factor, note }`
- ใช้ pre-defined system prompt → LLM ตอบ JSON เท่านั้น
- Fallback: `{ factor: null, note: "กรุณากรอกเอง" }` ถ้า ThaiLLM ไม่พร้อม

**`backend/src/routes/materials.routes.ts`**:
- `POST /unit-conversions/check-path` — BFS check (ไม่มี LLM) คืน path หรือ gap
- `POST /unit-conversions/suggest` — เรียก LLM แนะนำ factor

**`frontend/src/pages/settings/UnitConversions.tsx`**:
- เพิ่ม Path Advisor Panel ใน modal
- Flow: ตรวจสอบ → แสดง gap → AI แนะนำ → กด "ใช้ค่านี้" → auto-fill form

### 7. GR List View (Purchase.tsx)

- แต่ละ row คลิกได้ → เปิด modal detail
- ปุ่ม action ตรงกับ card view: Print A4, 🧾 thermal, ✓ ยืนยัน (DRAFT), Trash (DRAFT)
- `stopPropagation` บนปุ่ม ป้องกัน row click ทับ

### 8. PO List View (Purchase.tsx)

- แต่ละ row คลิกได้ → เปิด modal detail
- ปุ่ม action ตาม status: Print, ส่งอนุมัติ/อนุมัติ/รับสินค้า/วางบิล + ลบ (DRAFT)
- ตรงกับ card view ทุก state

### 9. UnitChainEditor — Visual Node Graph for Unit Conversions

**ไฟล์**: `frontend/src/pages/Stock.tsx` (component ภายใน)

**Features**:
- **Visual node canvas**: แสดงหน่วยเป็นโหนดบน canvas พร้อม grid background แบบ radial
- **Auto-layout BFS tree**: จัดตำแหน่งโหนดอัตโนมัติตามลำดับชั้น โดยเริ่มจาก `baseUnit` → `displayUnit` → หน่วยอื่นๆ
- **Draggable nodes**: ลากโหนดย้ายตำแหน่งได้ จำกัดไม่ให้หลุด canvas
- **Interactive edge creation**: คลิกปุ่ม → (ArrowRight) บนโหนดต้นทาง → คลิกโหนดปลายทาง → กรอก factor → บันทึก
- **SVG edges with Bezier curves**: เส้นเชื่อมแบบ cubic-bezier พร้อน marker arrow และ label `×factor` กลางเส้น
- **Node type indicators**: 
  - `baseUnit` = ขอบสีม่วง + dot ม่วง
  - `displayUnit` = ขอบสี cyan + dot cyan
  - ทั่วไป = ขอบเทา
- **Conversion tags**: แสดงรายการ conversion ด้านล่าง canvas เป็น chip แบบ pill กดลบได้
- **Add/remove nodes**: เพิ่มหน่วยจาก dropdown หรือลบโหนด (พร้อมลบ edges ที่เกี่ยวข้อง)
- **Keyboard support**: `Esc` ยกเลิกการเชื่อมต่อ, `Enter` ยืนยัน factor

**Integration**:
- เปิดจากปุ่ม "เปิด Chain Editor (ผังหน่วยแบบ Visual)" ใน Stock Item Edit Modal
- ใช้ `itemConversions` (จาก `fetchItemConversions`) + `availableUnits` (จาก `useUnits`)
- เรียก API `POST /materials/unit-conversions` เมื่อสร้าง edge ใหม่
- เรียก `onDelete` (ลบ conversion) เมื่อลบ edge หรือโหนด

---

## ไฟล์ที่แก้ไข

| ไฟล์ | การเปลี่ยนแปลง |
|------|----------------|
| `backend/src/db/sqlite.ts` | migration เพิ่ม `sealed_qty` column |
| `backend/src/services/unitConversion.service.ts` | BFS graph, auto-unpack, expand UNIT_NAME_MAP |
| `backend/src/services/llm.service.ts` | `suggestUnitConversion()` |
| `backend/src/routes/materials.routes.ts` | `check-path`, `suggest` endpoints |
| `backend/src/routes/purchase.routes.ts` | sealed_qty GR logic, BFS conversion |
| `backend/src/routes/stock.routes.ts` | auto-unpack OUT movement |
| `backend/src/routes/workOrder.routes.ts` | BFS + auto-unpack |
| `backend/src/routes/sales.routes.ts` | BFS + auto-unpack |
| `backend/src/routes/bom.routes.ts` | BFS conversion |
| `frontend/src/services/stock.ts` | `sealed_qty` ใน interface |
| `frontend/src/pages/Stock.tsx` | แสดง sealed qty + UnitChainEditor component |
| `frontend/src/pages/settings/UnitConversions.tsx` | Path Advisor panel, expand UNIT_NAME_MAP |
| `frontend/src/pages/Purchase.tsx` | GR + PO list view clickable + action buttons |

---

## Architecture

```
Settings UI → check-path (BFS, no LLM) → show gap
           → suggest (LLM) → แนะนำ factor → user กด save

Transaction (PO/WO/Sales/Stock) → convertQuantityBidirectional()
  ├─ direct conversion (DB)
  ├─ reverse conversion (1/factor)
  └─ BFS chain (multi-hop, max depth 5)

Stock OUT → autoUnpackIfNeeded()
  └─ ถ้า quantity < needed → แกะ sealed pack → บันทึก UNPACK movement
```
