# สัญญากลาง HR Phase 7 — ตารางกะรายวัน / แลกกะ / ค่าแรงเทียบยอดขาย POS + ส่วนเสริม Phase 6 (ดอกเบี้ยเงินยืม, รับคืนเงินสด)

สัญญานี้ผูกมัดทุกงานย่อย ห้ามเปลี่ยนชื่อฟิลด์ รูปร่าง response หรือ status code ถ้าทำตามไม่ได้ให้รายงาน อย่าแก้เอง

## T0 (ทำแล้ว — ห้ามสร้างซ้ำหรือแก้)
- ตาราง (`backend/src/db/migrations.ts` บล็อก "HR Phase 7")
  - `shift_assignments(id, tenant_id, employee_id, work_date 'YYYY-MM-DD', shift_id NULL, created_by, created_at, updated_at, UNIQUE(tenant_id, employee_id, work_date))` — `shift_id NULL` = วันหยุดประจำสัปดาห์ที่จัดไว้ ไม่มีแถว = ใช้กะประจำ `employees.shift_id`
  - `shift_swaps(id, tenant_id, work_date, requester_employee_id, target_employee_id, reason, status, approval_request_id, requested_by, peer_decided_at, decided_by, decided_at, created_at, updated_at)` status: `PEER_PENDING` (รอเพื่อนตอบ) → `PENDING` (รออนุมัติ) → `APPROVED` / `REJECTED`; เพื่อนปฏิเสธ = `DECLINED`; ยกเลิก = `CANCELLED`
  - `employee_advances` + `interest_rate REAL` (% ต่อปี) + `interest_amount REAL` (ดอกเบี้ยรวมทั้งสัญญา)
  - `advance_repayments` + `interest REAL` (ส่วนที่เป็นดอกเบี้ยของแถวนี้) + `source TEXT 'PAYROLL'|'CASH'` — แถว CASH เก็บ id ของ JE รับเงินใน `run_id`
- `HrSettings` (backend `services/hr/payrollCalc.ts`, frontend `hr.service.ts`) + validation ใน PUT /hr/settings: `rosterMinStaff` (0 = ไม่เตือน), `laborCostTargetPct` (ค่าตั้งต้น 25), `loanInterestRatePct` (0–15, ค่าตั้งต้น 0)
- `services/hr/rosterData.ts`: `RosterShift`, `RosterCell`, `isIsoDate`, `addDays`, `weekDates`, `isMonday`, `shiftHours`, `listShifts`, `getEffectiveCells(tenantId, dates, employeeIds?)` — **ใช้ตัวนี้อ่านกะที่มีผล ห้ามเขียน query ซ้ำ**
- สรุปเวลาเข้าออก (`attendanceStore.getAttendanceSummary`) ใช้ตารางกะรายวันแล้ว: วันที่ shift_id NULL/ไม่มีกะ = `dayOff` ไม่นับขาด, มาสายคิดจากเวลาเริ่มกะของวันนั้น
- `advanceOutstanding` รวมดอกเบี้ยแล้ว; `interestPortion(tenantId, advanceId, pay)` (export จาก `hr.payroll.routes.ts`) — ต้องเรียก **ก่อน** INSERT แถวรับชำระ; รอบเงินเดือนลงบัญชี Cr 1115 เฉพาะเงินต้น + Cr 4202 (`ACC.INTEREST_INCOME`) ส่วนดอกเบี้ยแล้ว
- อนุมัติ: `GateCategory 'shift_swap'` (resource hr), กล่องอนุมัติ approve = สลับกะที่มีผลของสองคนในวันนั้น (upsert shift_assignments ทั้งคู่) + status APPROVED; reject = REJECTED; หัวหน้าแผนกตรงของผู้ขอแลกอนุมัติได้ (`isLeaveManagerFor(..., 'shift_swap')`)
- route ว่าง `routes/hr.roster.routes.ts`, `routes/hr.swap.routes.ts` mount ใต้ `/api/hr` แล้ว (มี authenticate + subscriptionGate('hr') จาก index.ts)
- frontend: types + `hrService` methods ทุกตัวด้านล่าง, route `/hr/roster` + เมนู "ตารางกะ" + i18n `sidebar.roster`, ป้าย `shift_swap: 'ขอแลกกะ'` ในกล่องอนุมัติ, หน้าเปล่า `pages/HR/Roster.tsx`

Envelope ทุก endpoint ใหม่: สำเร็จ `{ success: true, data }`, ผิด `{ success: false, message }` (ข้อความไทย) — 400 ข้อมูลผิด, 403 ไม่มีสิทธิ์, 404 ไม่พบ (รวม tenant อื่น), 409 สถานะไม่ถูก/ซ้ำ

## B7a ตารางกะ (`routes/hr.roster.routes.ts`, `services/hr/roster.ts` + tests)

### กติกากฎหมาย/คำนวณ (pure ใน `services/hr/roster.ts`, ไม่แตะ db)
```ts
export interface WorkDay { date: string; hours: number }   // เฉพาะวันที่ทำงานจริง (มีกะ ไม่ลา)
export function employeeWarnings(days: WorkDay[], breakShort: Array<{ date: string; shiftName: string }>, totalDays: number): string[]
export function dayLaborCost(employmentType: 'MONTHLY'|'DAILY'|'HOURLY', baseWage: number, hours: number, daysPerMonthForRate: number): number
export function laborPct(laborCost: number, avgSales: number | null): number | null
```
- `employeeWarnings` (ข้อความตรงตัว, เรียงตามนี้):
  - วันละ > 8 ชม.: `` `${date} เกิน 8 ชม. (OT ${ot} ชม.)` `` (ot = hours − 8, ทศนิยมไม่เกิน 2 ตัด 0 ท้าย ใช้ `String(Math.round(x*100)/100)`) — ม.23
  - กะที่ทำ > 5 ชม. แต่พัก < 60 นาที (ผู้เรียกส่งมาใน breakShort): `` `${date} ${shiftName} พักน้อยกว่า 1 ชม.` `` — ม.27
  - ผลรวม min(8, hours) > 48: `ชั่วโมงปกติเกิน 48 ชม./สัปดาห์` — ม.23
  - ผลรวม max(0, hours − 8) > 36: `OT เกิน 36 ชม./สัปดาห์`
  - `days.length >= totalDays` (ทำงานครบทุกวันในสัปดาห์): `ไม่มีวันหยุดในสัปดาห์ (ม.28)`
- `dayLaborCost`: MONTHLY = baseWage / daysPerMonthForRate, DAILY = baseWage, HOURLY = baseWage × hours; ปัด 2 ตำแหน่ง
- `laborPct`: avgSales null หรือ ≤ 0 → null, ไม่งั้น round(cost/sales×100, 1 ตำแหน่ง)

### R1 `GET /hr/roster?week_start=YYYY-MM-DD` — hr:read
- week_start ต้องเป็นวันจันทร์ (`isMonday`) ไม่งั้น 400 `week_start ต้องเป็นวันจันทร์`
- data: `RosterWeek` (ดู types) — employees = ACTIVE ทุกคน เรียง code; `cells` จาก `getEffectiveCells`; `default_shift_id` = employees.shift_id
- คนทำงานวันนั้น = cell.shift_id ไม่ null และ `!on_leave` (holiday ยังนับเป็นทำงานถ้ามีกะ — ร้านอาหารเปิดวันหยุด)
- `hours` / `labor_cost` ต่อคน = รวมวันที่ทำงาน (ชั่วโมงจาก `RosterShift.hours`, ค่าแรงจาก `dayLaborCost` ด้วย `employees.base_wage` + `getTenantHrSettings().daysPerMonthForRate`)
- `warnings` ต่อคน = `employeeWarnings(...)` (กะที่ shift_id ไม่พบใน shifts ให้ข้าม)
- days[i]: `staff` = จำนวนคนทำงาน, `labor_cost` = รวม dayLaborCost ของคนที่ทำงาน, `avg_sales` = ค่าเฉลี่ยยอด `pos_running_bills.total_amount` สถานะ `PAID` ของวันเดียวกัน 4 สัปดาห์ก่อน (date−7, −14, −21, −28 · วันที่บิลใช้ `date(COALESCE(closed_at, opened_at), '+7 hours')`) หาร 4 เสมอ — ถ้า 4 วันนั้นไม่มีบิล PAID เลย = null; `labor_pct` = `laborPct`
- days[i].warnings: `rosterMinStaff > 0 && staff < rosterMinStaff` → `` `คนไม่ถึงขั้นต่ำ (${staff}/${min})` ``; `labor_pct > laborCostTargetPct` → `` `ค่าแรงเกินเป้า ${labor_pct}%` ``
- `shifts` = `listShifts` (รวมที่ปิดใช้ เพื่อแสดงช่องเก่า), `settings` = `{ rosterMinStaff, laborCostTargetPct }`

### R2 `PUT /hr/roster/assignments` — hr:write
- body `{ items: RosterAssignmentInput[] }` 1–500 แถว ไม่งั้น 400
- ทุกแถว: employee ของ tenant (404 ถ้าไม่พบ), `isIsoDate(work_date)`, `clear` true → DELETE แถว; ไม่งั้น `shift_id` null = วันหยุด หรือ id กะของ tenant ที่ `is_active = 1` (400 ถ้าไม่ใช่) → UPSERT (ON CONFLICT(tenant_id, employee_id, work_date))
- ทั้งชุดใน `db.transaction` (ผิดแถวเดียว = ไม่บันทึกเลย) → data `{ updated, cleared }`

### R3 `POST /hr/roster/copy` — hr:write
- body `{ from_week_start, to_week_start, overwrite?: boolean }` ทั้งคู่ต้องเป็นวันจันทร์และไม่เท่ากัน
- คัดลอกเฉพาะแถว `shift_assignments` จริงของสัปดาห์ต้นทาง (ไม่ใช่กะประจำ) ไปวันเดียวกันของสัปดาห์ปลายทาง เฉพาะพนักงาน ACTIVE; มีแถวอยู่แล้ว: overwrite → ทับ, ไม่งั้นข้าม → data `{ copied, skipped }`

### R4 `GET /hr/me/roster?week_start=` — ผู้ใช้ที่ผูกพนักงาน (ไม่ผูก = 404 `บัญชีนี้ยังไม่ได้ผูกกับพนักงาน`)
- data `MyRosterWeek` — `days[i].shift` = RosterShift เต็มตัว (null เมื่อหยุด/ไม่มีกะ)

### R5 `GET /hr/me/roster/day?date=` — ผู้ใช้ที่ผูกพนักงาน
- data `ColleagueShift[]` = พนักงาน ACTIVE คนอื่นทุกคน (ไม่รวมตัวเอง) พร้อมกะที่มีผลวันนั้น (ลาอยู่ = ไม่ต้องแสดง) เรียงตาม start_time แล้วชื่อ — ใช้เลือกคนแลกกะ

## B7b แลกกะ (`routes/hr.swap.routes.ts` + test)
ผู้ใช้ "ผูกพนักงาน" = employees.user_id = req.user.userId (ลอก `getSelfEmployee`/`userHasHr` จาก `hr.leave.routes.ts`)
- S1 `POST /hr/me/shift-swaps` body `ShiftSwapInput` → 201 `ShiftSwap` status `PEER_PENDING`
  - work_date ต้อง ≥ วันนี้ (เวลาไทย `thaiDateStr()` จาก utils/id) ไม่งั้น 400; target ACTIVE ของ tenant และไม่ใช่ตัวเอง (400/404)
  - กะที่มีผลของสองคนวันนั้น (`getEffectiveCells`) เหมือนกัน → 400 `กะของทั้งสองคนเหมือนกัน ไม่ต้องแลก`; ใครคนใดลาวันนั้น → 400
  - มีคำขอแลกที่ยังเปิด (PEER_PENDING/PENDING) ของคนใดคนหนึ่งในวันนั้นอยู่แล้ว → 409
- S2 `GET /hr/me/shift-swaps` — รายการที่ตัวเองเป็นผู้ขอหรือผู้ถูกขอ ใหม่สุดก่อน (`ShiftSwap[]`)
- S3 `POST /hr/me/shift-swaps/:id/accept` — เฉพาะ target, ต้อง PEER_PENDING (409) → `createRequest` (`category: 'shift_swap'`, `refType: 'shift_swaps'`, `refId`, ชื่อ/คำอธิบายภาษาไทยที่มีชื่อสองคน+วันที่, amount 0) แล้ว status PENDING + approval_request_id + peer_decided_at · ถ้า createRequest บอกว่าไม่ต้องอนุมัติ (ดูวิธีจัดการใน hr.leave.routes.ts) ให้สลับกะทันทีแบบเดียวกับกล่องอนุมัติแล้ว APPROVED
- S4 `POST /hr/me/shift-swaps/:id/decline` — เฉพาะ target, ต้อง PEER_PENDING → DECLINED
- S5 `POST /hr/shift-swaps/:id/cancel` — ผู้ขอ หรือคนที่มี hr:write; ต้อง PEER_PENDING/PENDING (409) → CANCELLED + ยกเลิก approval request (ลอกบล็อกจาก cancel ของ hr.leave.routes.ts)
- S6 `GET /hr/shift-swaps?status=` — hr:read ทุกคำขอของ tenant
- `ShiftSwap.requester_shift/target_shift` = RosterShift ของกะที่มีผล ณ ตอนเรียก (หาจาก `getEffectiveCells` + `listShifts`)
- เรียกใครที่ไม่ใช่เจ้าของ/ไม่มีสิทธิ์ = 403, id ของ tenant อื่น = 404

## B6x ดอกเบี้ย + รับคืนเงินสด (`routes/hr.advance.routes.ts` + test)
- A1/A3 สร้าง: `interest_rate` — ADVANCE = 0 เสมอ; LOAN: HR ส่ง `interest_rate` ได้ (0–15 ไม่งั้น 400 `ดอกเบี้ยต้องอยู่ระหว่าง 0–15% ต่อปี`), ไม่ส่ง/ทางพนักงาน (A3 `/me/advances` ไม่รับฟิลด์นี้) = `getTenantHrSettings().loanInterestRatePct`
  - `interest_amount = round2(amount × rate/100 × installments/12)` (ดอกเบี้ยคงที่ คิดล่วงหน้าทั้งสัญญา)
  - `installment_amount = Math.ceil(Math.round((amount + interest_amount) × 100) / installments) / 100`; เพดาน ม.76 ตรวจกับ installment_amount ตัวนี้
- response ทุกตัวมี `interest_rate`, `interest_amount`; `outstanding` (รวมดอกเบี้ย) ใช้ `advanceOutstanding` เดิม; detail repayments มี `interest`, `source`
- A8 `POST /hr/advances/:id/repay-cash` — hr:write, body `AdvanceRepayCashInput`
  - ต้อง ACTIVE (409), `0 < amount ≤ outstanding` (400), วันที่ valid, บัญชีรับเงินเงื่อนไขเดียวกับ disburse (400), งวดบัญชีปิด → 400 (`closedPeriodLabel`)
  - ใน `db.transaction` เดียว: `interest = interestPortion(tenantId, id, amount)` → JE posted (แบบเดียวกับ disburse) date = body.date, referenceType `EMPLOYEE_ADVANCE`, referenceId = advance id: Dr บัญชีรับเงิน amount / Cr 1115 (amount − interest) / Cr 4202 interest (เฉพาะ > 0) → INSERT advance_repayments (`run_id = je.id`, `period = date.slice(0,7)`, amount, interest, `source 'CASH'`) → outstanding 0 → `CLOSED`
  - data = detail แบบ A2
  - ponytail: ปิดก่อนกำหนดยังเก็บดอกเบี้ยคงที่เต็มจำนวน (ไม่มีส่วนลดดอกเบี้ย)

## หน้าจอ
- F7a `pages/HR/Roster.tsx` (+test): ตารางสัปดาห์ (คน × 7 วัน), เลื่อนสัปดาห์, เลือกกะในช่อง (กะ / หยุด / "ใช้กะประจำ" = clear), ปุ่มบันทึก (ส่งเฉพาะช่องที่แก้), "คัดลอกสัปดาห์ก่อน", แถวสรุปใต้ตาราง (คน, ค่าแรง, ยอดขายเฉลี่ย, % พร้อมสี), คำเตือนรายคน/รายวัน, แท็บ "คำขอแลกกะ" (S6 + ยกเลิก)
- F7b `pages/HR/MyHr.tsx` (+test): การ์ด "ตารางกะของฉัน" + ขอแลกกะ + รายการแลกกะ (รับ/ปฏิเสธ/ยกเลิก)
- F6x `pages/HR/Advances.tsx`, `pages/HR/HrSettings.tsx` (+test Advances): ช่องดอกเบี้ยตอนสร้าง LOAN, คอลัมน์ดอกเบี้ย, ปุ่ม "รับคืนเงินสด", ช่องตั้งค่า 3 ตัวใหม่ในหน้าตั้งค่า

## ตัดไว้ก่อน
- ประกาศตารางกะใน LINE (รอ Phase 8b OA กลาง), จัดกะอัตโนมัติ, แลกข้ามวัน (แลกได้เฉพาะวันเดียวกัน), ส่วนลดดอกเบี้ยเมื่อปิดก่อนกำหนด, ภาษีธุรกิจเฉพาะของดอกเบี้ย (ให้นักบัญชีตัดสินเอง)
