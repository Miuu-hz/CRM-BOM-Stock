# Smart Unit Conversion — Graph Traversal + LLM Settings Advisor

## ปัญหาที่แก้

1. **ซื้อสินค้าได้หลายหน่วย**: ซอสฝาเขียว ซื้อได้ทั้ง `แพ็ค` และ `ขวด` → stock unit เดียวกัน (ขวด)
2. **Chain conversion**: stock unit = ลิตร, มี `แพ็ค→ขวด (×3)` + `ขวด→ลิตร (×1)` → ระบบควรเชื่อม 2 ขั้นอัตโนมัติ (1 แพ็ค = 3 ลิตร) โดยไม่ error
3. **Spelling mismatch**: `แพค / แพ๊ค / แพ็ค` ทั้งหมดหมายถึง `pack` แต่ normalizeUnit ขาดบาง variant

## Architecture Decision

- **LLM ทำงานเฉพาะตอนตั้งค่า** (Settings UI) ไม่มี LLM call ที่ transaction time
- **Pre-defined prompt templates** (ไม่ใช่ free-form chat) → JSON response เท่านั้น
- **Local ThaiLLM** ที่มีอยู่แล้ว → zero cost เพิ่ม
- **BFS graph traversal** แก้ chain ปัญหาหลัก — ไม่ต้องใช้ LLM

---

## Feature 1: Graph-Based Chain Conversion (Backend)

**ไฟล์**: `backend/src/services/unitConversion.service.ts`

### ฟังก์ชันใหม่

```typescript
// สร้าง adjacency graph จาก DB + STANDARD_CONVERSIONS
function buildConversionGraph(tenantId: string, materialId?: string): Graph

// BFS หา path และ factor รวม (max depth 5)
function findConversionChain(
  from: string, to: string, tenantId: string, materialId?: string
): { factor: number; path: string[] } | null
```

### In-memory Cache

```typescript
const graphCache = new Map<string, { graph: Graph; ts: number }>()
// TTL: 5 นาที
// Invalidate: เมื่อ create/update/delete conversion
```

### แก้ `convertQuantityBidirectional()` 

```
เดิม: direct → reverse → null (error)
ใหม่: direct → reverse → BFS chain → null (error)
```

---

## Feature 2: Smart Conversion Advisor (LLM + Settings UI)

### Backend Endpoints

**`POST /materials/unit-conversions/check-path`** (ไม่มี LLM)
```json
Request:  { "from_unit": "pack", "to_unit": "liter", "material_id": "xxx" }
Response: { "found": true, "path": ["pack","bottle","liter"], "factor": 3 }
          { "found": false, "gap": { "from": "bottle", "to": "liter" } }
```

**`POST /materials/unit-conversions/suggest`** (เรียก LLM)
```json
Request:  { "from_unit": "pack", "to_unit": "bottle", "material_name": "ซอสฝาเขียว", "existing_conversions": [...] }
Response: { "factor": 3, "note": "1 แพ็ค = 3 ขวด (ค่าที่นิยม)" }
```

### Pre-defined Prompt Template (ใน `llm.service.ts`)

```
SYSTEM: "คุณเป็นผู้ช่วยตั้งค่าการแปลงหน่วยในระบบ ERP 
         ตอบด้วย JSON เท่านั้น: {"factor": number, "note": "string"}"

USER:    "สินค้า: {material_name}
          ต้องการทราบ: 1 {from_unit} เท่ากับกี่ {to_unit}
          การแปลงที่มีในระบบ: {existing_conversions_json}
          แนะนำค่า factor ที่เหมาะสม"
```

Fallback: ถ้า ThaiLLM ไม่พร้อม → `{ factor: null, note: "กรุณากรอกเอง" }`

### UI Panel ใน UnitConversions Modal

```
┌──────────────────────────────────────────────────┐
│  🔍 ตรวจสอบเส้นทางการแปลง                         │
│                                                  │
│  from: [pack  ▾]   to: [liter  ▾]               │
│  สินค้า: [ซอสฝาเขียว ▾]                          │
│  [ตรวจสอบ]                                       │
│                                                  │
│  ✅ พบเส้นทาง:                                    │
│     pack → bottle (×3) → liter (×1) = 3 ลิตร    │
│  ──────────────────────────────────────────────  │
│  ⚠️  ขาด: bottle → liter                         │
│     AI แนะนำ: 1 bottle = 1 liter                 │
│     [เพิ่ม bottle→liter ทันที]                    │
└──────────────────────────────────────────────────┘
```

Flow:
1. กด "ตรวจสอบ" → `check-path` → แสดง path หรือ gap
2. ถ้ามี gap → `suggest` (LLM) → แสดง factor แนะนำ
3. กด "เพิ่ม X→Y ทันที" → auto-fill form → save

---

## Feature 3: Expand UNIT_NAME_MAP

เพิ่มใน **ทั้ง 2 ไฟล์** (backend + frontend):

```typescript
'แพค': 'pack',      // ขาด mai ek
'แพ๊ค': 'pack',     // mai tho ผิด
'ลัง': 'case',
'กล่อง': 'box',
'ขวด': 'bottle',
'ซอง': 'sachet',
'ถุง': 'bag',
'หลอด': 'tube',
'กระป๋อง': 'can',
'แผ่น': 'sheet',
```

---

## ไฟล์ที่ต้องแก้

| ไฟล์ | การเปลี่ยนแปลง |
|------|----------------|
| `backend/src/services/unitConversion.service.ts` | `buildConversionGraph()`, `findConversionChain()`, graph cache, แก้ `convertQuantityBidirectional()`, expand UNIT_NAME_MAP |
| `backend/src/services/llm.service.ts` | เพิ่ม `suggestUnitConversion()` |
| `backend/src/routes/materials.routes.ts` | เพิ่ม 2 endpoints: `check-path` และ `suggest` |
| `frontend/src/pages/settings/UnitConversions.tsx` | Path checker panel, expand UNIT_NAME_MAP |

---

## การทดสอบ

1. ตั้งค่า `pack→bottle (×3)` + `bottle→liter (×1)` → PO หน่วย pack, stock unit ลิตร → ยืนยันรับสินค้า → stock เพิ่ม 3× ลิตร (ไม่ error)
2. PO-A แพ็ค + PO-B ขวด ให้ material เดียวกัน → ทั้งคู่บันทึกได้ถูกต้อง
3. Settings advisor: ตรวจสอบ pack→liter → แสดง gap + LLM แนะนำ factor
4. กรอก from_unit "แพค" (ไม่มี mai ek) → บันทึกเป็น "pack"
5. ปิด ThaiLLM → กด suggest → แสดง "กรุณากรอกเอง" (ไม่ crash)
