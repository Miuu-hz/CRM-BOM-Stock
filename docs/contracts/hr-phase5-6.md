# สัญญากลาง HR Phase 5–6: บันทึกอบรม, เบิกล่วงหน้า/เงินยืม

เอกสารนี้คือข้อตกลงร่วมของทุกงานใน Phase 5–6 ทั้ง backend และ frontend ใช้ชื่อ field, รูปคำตอบ, error และสิทธิ์ตามนี้เท่านั้น
ถ้าข้อไหนทำไม่ได้จริง ให้หยุดแล้วรายงานกลับ ห้ามเปลี่ยนสัญญาเอง

ส่วนที่วางไว้แล้วใน T0 (ห้ามแก้ ยกเว้นงานที่ระบุว่าเป็นเจ้าของ):
- ตารางทั้งหมด: บล็อก `HR Phase 5-6` ท้าย `runMonthCloseMigrations` ใน `backend/src/db/migrations.ts`
- `payment_attachments` รับ `ref_type = 'TRAINING_RECORD'` แล้ว และ `attachments.routes.ts` map ไป `training_records` ด้วย feature `hr`
- บัญชี `1115 ลูกหนี้พนักงาน (เบิกล่วงหน้า/เงินยืม)` = `ACC.EMPLOYEE_RECEIVABLE`
- `GateCategory` มี `'advance'` (resource `hr`) และกล่องอนุมัติจัดการ `reference_type = 'employee_advances'` แล้ว:
  อนุมัติ → `APPROVED`, ไม่อนุมัติ → `REJECTED` (เฉพาะแถวที่ยัง `PENDING`)
- **รอบเงินเดือนหักเบิก/เงินยืมเองแล้ว** (`hr.payroll.routes.ts`): สร้างรอบ → `inputs.advanceDeductions`, ลงบัญชี → Cr 1115 + เขียน `advance_repayments` + ปิดรายการที่หมด, ยกเลิกรอบ → ลบ repayment + เปิดรายการกลับเป็น `ACTIVE`
  export `advanceOutstanding(tenantId, advanceId)` ให้ใช้ได้
- ไฟล์ route เปล่า `hr.training.routes.ts`, `hr.advance.routes.ts` mount ใต้ `/api/hr` แล้ว
- type + ฟังก์ชันเรียก API ทั้งหมดใน `frontend/src/services/hr.service.ts` (หัวข้อ "HR Phase 5-6")
- route `/hr/training`, `/hr/advances`, เมนู, คำแปล, หน้าเปล่า `Training.tsx`, `Advances.tsx`, ป้าย `advance` ในกล่องอนุมัติ, `AttachmentRefType` มี `'TRAINING_RECORD'`

## 1. กติการ่วม (เหมือน Phase 4)

- ทุก endpoint อยู่ใต้ `/api/hr` ซึ่งมี `authenticate` + `subscriptionGate('hr')` แล้ว ไม่ต้องใส่ซ้ำ
- สำเร็จ: `{ success: true, data: <T> }` สร้างใหม่ 201 ที่เหลือ 200
- ผิดพลาด: `{ success: false, message: '<ข้อความไทย>' }` · 400 ข้อมูลไม่ถูก · 403 ไม่มีสิทธิ์ · 404 ไม่พบ/เป็นของบริษัทอื่น · 409 ชนกัน
- ทุก query กรอง `tenant_id = req.user!.tenantId` · id ของบริษัทอื่นตอบ 404
- สิทธิ์ hr: ใช้ `can(req.user.role, req.user.departments || [], 'hr', 'read'|'write', req.user.customPermissions)` แบบ `userHasHr` ใน `hr.leave.routes.ts`
- **"พนักงานของฉัน"** = `employees` ที่ `user_id = req.user!.userId` และ `status = 'ACTIVE'` (ดู `getSelfEmployee` ใน `hr.leave.routes.ts`) · endpoint `/me/*` ไม่ต้องมีสิทธิ์ hr ไม่มีพนักงานของฉัน → 404 `บัญชีนี้ยังไม่ได้ผูกกับพนักงาน`
- วันนี้ตามเวลาไทย = `thaiDateStr()` จาก `utils/id` (เซิร์ฟเวอร์ TZ=UTC) · วันที่ `YYYY-MM-DD` · งวด `YYYY-MM`
- boolean ในคำตอบเป็น `true/false` · เงินปัด 2 ตำแหน่งด้วย `round2` จาก `services/hr/payrollCalc`
- `employee_name` = `first_name + ' ' + last_name` ตัดช่องว่าง

## 2. ตาราง (สร้างแล้ว)

```
training_courses(id, tenant_id, name, kind IN ('INTERNAL','EXTERNAL'), mandatory 0/1, validity_months INTEGER NULL /* null = ไม่หมดอายุ */, is_active, created_at, UNIQUE(tenant_id, name))
training_records(id, tenant_id, course_id, employee_id, trained_on, expires_on NULL, provider, notes, created_by /* users.id */, created_at)
employee_advances(id, tenant_id, employee_id, kind IN ('ADVANCE','LOAN'), amount, installments, installment_amount, start_period /* YYYY-MM งวดแรกที่หัก */,
                  reason, status IN ('PENDING','APPROVED','REJECTED','CANCELLED','ACTIVE','CLOSED'), approval_request_id, requested_by /* users.id */,
                  decided_by, decided_at, disbursed_on, pay_account_id, disburse_je_id, created_at, updated_at)
advance_repayments(id, tenant_id, advance_id, run_id, period, amount, created_at, UNIQUE(advance_id, run_id))   -- T0 เขียน/ลบเท่านั้น
```

สถานะเบิก: `PENDING` →(อนุมัติ)→ `APPROVED` →(ฝ่ายบุคคลจ่ายเงิน)→ `ACTIVE` →(หักครบในรอบเงินเดือน)→ `CLOSED`
ยกเลิกได้เฉพาะ `PENDING`/`APPROVED` → `CANCELLED` · `REJECTED` มาจากกล่องอนุมัติ

## 3. Type (ต้นฉบับ `frontend/src/services/hr.service.ts`; backend ต้องตอบตามนี้)

```ts
export type TrainingKind = 'INTERNAL' | 'EXTERNAL'
export interface TrainingCourse {
  id: string; name: string; kind: TrainingKind; mandatory: boolean
  validity_months: number | null; is_active: boolean
  record_count: number            // จำนวน training_records ของหลักสูตรนี้
}
export interface TrainingCourseInput { name: string; kind: TrainingKind; mandatory: boolean; validity_months: number | null; is_active?: boolean }
export interface TrainingRecord {
  id: string
  course_id: string; course_name: string; course_kind: TrainingKind
  employee_id: string; employee_code: string; employee_name: string
  trained_on: string; expires_on: string | null
  provider: string | null; notes: string | null
  days_left: number | null        // expires_on - วันนี้ (ไทย) เป็นจำนวนวัน ติดลบ = หมดแล้ว · null = ไม่หมดอายุ
  attachment_count: number        // แถวใน payment_attachments ที่ ref_type='TRAINING_RECORD' AND ref_id = id
  created_at: string
}
export interface TrainingRecordInput {
  course_id: string; employee_ids: string[]   // 1 รอบอบรม = หลายคน → สร้าง 1 แถวต่อคน
  trained_on: string
  expires_on?: string | null                  // ไม่ส่ง = คำนวณจาก validity_months · ส่ง null = ไม่หมดอายุ
  provider?: string | null; notes?: string | null
}
export interface TrainingRecordUpdate { trained_on?: string; expires_on?: string | null; provider?: string | null; notes?: string | null }

export type AdvanceKind = 'ADVANCE' | 'LOAN'   // ADVANCE = เบิกค่าจ้างที่ทำแล้ว หักงวดเดียว · LOAN = เงินยืม ผ่อนหลายงวด
export type AdvanceStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'ACTIVE' | 'CLOSED'
export interface EmployeeAdvance {
  id: string
  employee_id: string; employee_code: string; employee_name: string
  kind: AdvanceKind; amount: number; installments: number; installment_amount: number
  start_period: string; reason: string | null; status: AdvanceStatus
  approval_request_id: string | null; decided_at: string | null
  disbursed_on: string | null; disburse_je_id: string | null
  repaid: number                  // SUM(advance_repayments.amount)
  outstanding: number             // ACTIVE/CLOSED: amount - repaid · สถานะอื่น: amount (ยังไม่ได้จ่ายเงิน)
  created_at: string
}
export interface AdvanceRepayment { run_id: string; period: string; amount: number; created_at: string }
export interface EmployeeAdvanceDetail extends EmployeeAdvance { repayments: AdvanceRepayment[] }
export interface AdvanceInput { employee_id: string; kind: AdvanceKind; amount: number; installments?: number; start_period: string; reason?: string }
export type MyAdvanceInput = Omit<AdvanceInput, 'employee_id'>
export interface AdvanceDisburseInput { pay_account_id: string; date: string }

// รอบเงินเดือน (มีแล้วใน T0)
export interface AdvanceDeduction { advance_id: string; kind: AdvanceKind; name: string; amount: number }
// PayrollLineInputs.advanceDeductions?: AdvanceDeduction[] · PayrollRunLine.advance_deduction: number (รวมอยู่ใน other_deduction แล้ว)
```

## 4. Endpoint

### อบรม — `hr.training.routes.ts` (งาน B5)

| # | Method | Path | สิทธิ์ | Body/Query | ตอบ |
|---|---|---|---|---|---|
| T1 | GET | `/training/courses` | hr read | `?active=1` เฉพาะ is_active | `TrainingCourse[]` เรียงชื่อ |
| T2 | POST | `/training/courses` | hr write | `TrainingCourseInput` | 201 `TrainingCourse` · ชื่อซ้ำ 409 `มีหลักสูตรชื่อนี้แล้ว` |
| T3 | PUT | `/training/courses/:id` | hr write | `Partial<TrainingCourseInput>` | `TrainingCourse` |
| T4 | GET | `/training/records` | hr read | `?employee_id&course_id` | `TrainingRecord[]` เรียง trained_on ใหม่ก่อน |
| T5 | POST | `/training/records` | hr write | `TrainingRecordInput` | 201 `TrainingRecord[]` |
| T6 | PUT | `/training/records/:id` | hr write | `TrainingRecordUpdate` | `TrainingRecord` |
| T7 | DELETE | `/training/records/:id` | hr write | – | `{ id }` · มีไฟล์แนบ → 409 `ลบไฟล์ใบรับรองก่อน` |
| T8 | GET | `/training/expiring` | hr read | `?days=60` (1–365) | `TrainingRecord[]` — **แถวล่าสุด** (trained_on มากสุด) ต่อคู่ (employee, course) ของพนักงาน ACTIVE ที่ `expires_on <= วันนี้+days` เรียง days_left น้อยก่อน (รวมที่หมดแล้ว) |
| T9 | GET | `/me/training` | self | – | `TrainingRecord[]` ของพนักงานของฉัน |

กติกา B5:
- `name` ตัดช่องว่าง ห้ามว่าง · `validity_months` null หรือจำนวนเต็ม 1–120 · `kind` ต้องอยู่ใน enum
- T5: `course_id` ต้องเป็นของบริษัท · `employee_ids` ไม่ว่าง ไม่ซ้ำ ทุกคนต้องเป็นของบริษัท (ไม่จำกัดสถานะ) มีคนไหนไม่พบ → 400 ไม่สร้างสักแถว (ทำใน transaction)
- `expires_on` ไม่ส่งมา + หลักสูตรมี `validity_months` → `trained_on + validity_months เดือน` (ถ้าวันเกินสิ้นเดือนให้ใช้วันสุดท้ายของเดือน เช่น 2026-01-31 + 1 = 2026-02-28) · ต้องไม่ก่อน `trained_on`
- `created_by = req.user!.userId`

### เบิกล่วงหน้า / เงินยืม — `hr.advance.routes.ts` (งาน B6)

| # | Method | Path | สิทธิ์ | Body/Query | ตอบ |
|---|---|---|---|---|---|
| A1 | GET | `/advances` | hr read | `?employee_id&status` | `EmployeeAdvance[]` เรียง created_at ใหม่ก่อน |
| A2 | GET | `/advances/:id` | hr read | – | `EmployeeAdvanceDetail` (repayments เรียง period) |
| A3 | POST | `/advances` | hr write | `AdvanceInput` | 201 `EmployeeAdvance` สถานะ PENDING |
| A4 | GET | `/me/advances` | self | – | `EmployeeAdvance[]` ของพนักงานของฉัน |
| A5 | POST | `/me/advances` | self | `MyAdvanceInput` | 201 `EmployeeAdvance` |
| A6 | POST | `/advances/:id/cancel` | hr write หรือ self ที่เป็นเจ้าของ | – | `EmployeeAdvance` · ได้เฉพาะ PENDING/APPROVED อื่น ๆ 409 |
| A7 | POST | `/advances/:id/disburse` | hr write | `AdvanceDisburseInput` | `EmployeeAdvance` สถานะ ACTIVE · ได้เฉพาะ APPROVED อื่น ๆ 409 |

กติกา B6 (แตะเงิน — ห้ามลัด):
- พนักงานต้อง ACTIVE และเป็นของบริษัท · `amount` > 0 และ ≤ 1,000,000 ปัดด้วย `round2`
- `ADVANCE`: `installments` บังคับเป็น 1 · `LOAN`: จำนวนเต็ม 1–24
- `installment_amount = Math.ceil(round2(amount) * 100 / installments) / 100` (งวดสุดท้ายหักเท่าที่เหลือเอง)
- `start_period` รูปแบบ `YYYY-MM` และต้องไม่ก่อนงวดปัจจุบัน (`thaiDateStr().slice(0,7)`)
- ค่าจ้างประมาณต่อเดือน: MONTHLY = base_wage, DAILY = base_wage × 26, HOURLY = base_wage × 8 × 26
  - ADVANCE: amount ≤ ค่าจ้างประมาณต่อเดือน ไม่งั้น 400 `ยอดเบิกเกินค่าจ้างประมาณ 1 เดือน`
  - LOAN: installment_amount ≤ 10% ของค่าจ้างประมาณต่อเดือน ไม่งั้น 400 `ยอดผ่อนต่องวดเกิน 10% ของค่าจ้าง (ม.76) — เพิ่มจำนวนงวด` (รอบเงินเดือนยังตัดเพดาน 10% ของค่าจ้างจริงทุกงวดอีกชั้น)
- A3/A5: insert PENDING (`requested_by = req.user!.userId`) แล้ว `createRequest({ tenantId, user: req.user!, category: 'advance', refType: 'employee_advances', refId, description, amount })` ทำแบบ `hr.leave.routes.ts` แล้วเก็บ `approval_request_id`
  `description` เช่น `ขอเบิกล่วงหน้า 2,000.00 บาท · EMP-002 มาลี` / `ขอยืมเงิน 3,000.00 บาท ผ่อน 3 งวด · EMP-002 มาลี` ทั้ง insert + createRequest อยู่ใน transaction เดียว
- A6: ยกเลิกคำขออนุมัติที่ยัง PENDING ด้วยวิธีเดียวกับ cancel ใน `hr.leave.routes.ts` (UPDATE approval_requests + approval_logs CANCEL)
  self ยกเลิกได้เฉพาะรายการของพนักงานของฉัน
- A7 จ่ายเงิน:
  - `date` ISO และงวดบัญชีต้องไม่ปิด: `closedPeriodLabel(tenantId, date)` จาก `./journal.routes` → 400 `งวดบัญชี X ปิดแล้ว`
  - `pay_account_id` ต้องเป็น `accounts` ของบริษัทที่ `type = 'ASSET'` → ไม่ใช่ 400
  - ลงบัญชีด้วย `insertJournalEntry` + ตั้ง `is_posted = 1` แบบ `createRunPaymentJe` ใน `hr.payroll.routes.ts`:
    Dr `getOrCreateAccount(tenantId, ACC.EMPLOYEE_RECEIVABLE)` / Cr pay account = amount · `referenceType: 'EMPLOYEE_ADVANCE'`, `referenceId: advance.id`
    คำอธิบายใช้รหัสพนักงาน ไม่ใส่ชื่อ เช่น `จ่ายเงินเบิกล่วงหน้า · EMP-002` / `จ่ายเงินยืมพนักงาน · EMP-002`
  - UPDATE status ACTIVE, disbursed_on, pay_account_id, disburse_je_id — ทั้งหมดใน transaction เดียว
- `repaid`/`outstanding`: ใช้ `advanceOutstanding` จาก `./hr.payroll.routes` หรือ SUM เองก็ได้ ต้องได้ผลตามข้อ 3
- ponytail: ยังไม่มียกเลิกหลังจ่ายเงินแล้ว (ต้องทำ JV กลับเอง) และไม่คิดดอกเบี้ย

## 5. หน้าจอ

| งาน | ไฟล์ที่เป็นเจ้าของ | ทำอะไร |
|---|---|---|
| F5 | `pages/HR/Training.tsx`, `Training.test.tsx` | แท็บ หลักสูตร · บันทึกอบรม · ใกล้หมดอายุ (60 วัน) |
| F6a | `pages/HR/Advances.tsx`, `Advances.test.tsx` | รายการเบิก/เงินยืม, สร้างคำขอแทนพนักงาน, จ่ายเงิน, ดูประวัติหักรายงวด |
| F6b | `pages/HR/MyHr.tsx`, `pages/HR/Payroll.tsx`, `MyHr.test.tsx` | หน้าของฉัน: ขอเบิก/ยืม + รายการของฉัน + อบรมของฉัน · เงินเดือน: แสดง/แก้ยอดหักเบิกในโมดัลแก้บรรทัด |
