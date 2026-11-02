# สัญญากลาง HR Phase 4: การลา, วันหยุด, เช็คอินเว็บ, หน้าของฉัน

เอกสารนี้คือข้อตกลงร่วมของทุกงานใน Phase 4 ทั้ง backend และ frontend ใช้ชื่อ field, รูปคำตอบ, error และสิทธิ์ตามนี้เท่านั้น
ถ้าข้อไหนในนี้ทำไม่ได้จริง ให้หยุดแล้วรายงานกลับ ห้ามเปลี่ยนสัญญาเอง

ส่วนที่วางไว้แล้วใน T0 (ห้ามแก้ ยกเว้นงานที่ระบุว่าเป็นเจ้าของ):
- ตารางทั้งหมดของ Phase 4: บล็อก `HR Phase 4` ท้าย `runMonthCloseMigrations` ใน `backend/src/db/migrations.ts`
- `GateCategory` เพิ่ม `'leave'` และ map `leave` เป็น resource `'hr'` ใน `backend/src/services/approvalGate.service.ts`
- ไฟล์ route เปล่า `backend/src/routes/hr.leave.routes.ts` และ `hr.checkin.routes.ts` ซึ่ง mount ใต้ `/api/hr` แล้ว
- type และฟังก์ชันเรียก API ทั้งหมดใน `frontend/src/services/hr.service.ts` (หัวข้อ "HR Phase 4")
- route, เมนู, คำแปล และหน้าเปล่าของ `Leave.tsx`, `MyHr.tsx`, `CheckinKiosk.tsx`
- ป้าย `leave` ในกล่องอนุมัติ

## 1. กติการ่วม

- ทุก endpoint อยู่ใต้ `/api/hr` ซึ่งมี `authenticate` และ `subscriptionGate('hr')` แล้ว ไม่ต้องใส่ซ้ำ
- คำตอบที่สำเร็จ: `{ success: true, data: <T> }` สร้างใหม่ตอบ 201 ที่เหลือตอบ 200
- คำตอบที่ผิดพลาด: `{ success: false, message: '<ข้อความไทย>' }` ใช้รหัสดังนี้
  400 ข้อมูลไม่ถูก · 403 ไม่มีสิทธิ์ · 404 ไม่พบหรือเป็นของบริษัทอื่น · 409 ชนกัน/ซ้ำ · 429 ล็อกชั่วคราว
- ทุก query ต้องกรอง `tenant_id = req.user!.tenantId` ถ้า id เป็นของบริษัทอื่นให้ตอบ 404 ไม่ใช่ 403
- ตัวผู้ใช้ปัจจุบันคือ `req.user!.userId`
- **"พนักงานของฉัน"** คือแถว `employees` ที่ `tenant_id` ตรงกัน, `user_id = req.user!.userId` และ `status = 'ACTIVE'`
- สิทธิ์ตรวจด้วย `requirePermission('hr','read'|'write')` หรือ `can()` แบบที่ `hr.routes.ts` ใช้
  สิทธิ์แบบ "self" คือผู้ใช้ทุก role ที่มีพนักงานของฉัน โดยไม่ต้องมีสิทธิ์ hr
- วันที่ใช้รูปแบบ `YYYY-MM-DD` เวลาใช้ `YYYY-MM-DD HH:mm:ss` ตามเวลาไทย เหมือน `attendance_logs.punched_at`
  เซิร์ฟเวอร์รันด้วย TZ=UTC เวลาปัจจุบันจึงต้องแปลงเป็นเวลาไทยฝั่งเซิร์ฟเวอร์เอง ห้ามเชื่อเวลาจาก client
- ค่า boolean ในคำตอบเป็น `true/false` ไม่ใช่ 0/1 (แปลงจาก INTEGER ตอนส่งออก)
- จำนวนวันลาเป็นทวีคูณของ 0.5

## 2. ตาราง (สร้างแล้ว)

```
leave_types(id, tenant_id, code, name, paid INTEGER 0/1, days_per_year REAL NULL /* null = ไม่มีโควตา */, is_active, created_at, UNIQUE(tenant_id, code))
leave_requests(id, tenant_id, employee_id, leave_type_id, start_date, end_date, days REAL, reason,
               status IN ('PENDING','APPROVED','REJECTED','CANCELLED'), approval_request_id, requested_by /* users.id */,
               decided_by /* users.id */, decided_at, created_at, updated_at)
public_holidays(id, tenant_id, date, name, created_at, UNIQUE(tenant_id, date))
hr_checkin_locations(tenant_id PK, lat, lng, radius_m DEFAULT 150, updated_at)   -- 1 จุดต่อบริษัท
attendance_logs  + lat REAL, lng REAL, distance_m REAL   (NULL ได้)
employees        + checkin_pin_hash TEXT                 (ห้ามส่งออกใน API ใดๆ)
```

## 3. Type (ต้นฉบับอยู่ใน `frontend/src/services/hr.service.ts` และ backend ต้องตอบตามนี้)

```ts
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

export interface LeaveType {
  id: string; code: string; name: string
  paid: boolean
  days_per_year: number | null
  is_active: boolean
}
export interface LeaveTypeInput { code: string; name: string; paid: boolean; days_per_year: number | null; is_active?: boolean }

export interface LeaveRequest {
  id: string
  employee_id: string; employee_code: string; employee_name: string /* first_name + ' ' + last_name ตัดช่องว่าง */
  org_unit_name: string | null
  leave_type_id: string; leave_type_code: string; leave_type_name: string; paid: boolean
  start_date: string; end_date: string; days: number
  reason: string | null
  status: LeaveStatus
  approval_request_id: string | null
  requested_by: string | null; decided_by: string | null; decided_at: string | null
  created_at: string
}
export interface LeaveRequestInput {
  employee_id: string; leave_type_id: string
  start_date: string; end_date: string; days: number
  reason?: string
}

export interface LeaveBalance {
  leave_type_id: string; code: string; name: string; paid: boolean
  quota: number | null      // = days_per_year
  used: number              // APPROVED ที่ start_date อยู่ในปีนั้น
  pending: number           // PENDING ที่ start_date อยู่ในปีนั้น
  remaining: number | null  // quota - used (null เมื่อไม่มีโควตา)
}

export interface PublicHoliday { id: string; date: string; name: string }

export interface CheckinLocation { lat: number; lng: number; radius_m: number }
export interface CheckinGeo { lat?: number; lng?: number; accuracy?: number }
export interface CheckinPinInput extends CheckinGeo { employee_code: string; pin: string }
export interface CheckinResult {
  punched_at: string
  kind: 'IN' | 'OUT'          // IN = รายการแรกของวันนั้น (เวลาไทย) ของ pin นี้ ที่เหลือเป็น OUT
  employee_name: string
  distance_m: number | null   // null เมื่อบริษัทยังไม่ได้ตั้งจุดเช็คอิน
}

export interface MyAttendanceLog { punched_at: string; source: 'FILE' | 'MCP' | 'WEB' | 'DEVICE'; distance_m: number | null }
export interface MyAttendance {
  employee: { id: string; code: string; name: string; device_pin: string | null; shift_name: string | null }
  logs: MyAttendanceLog[]            // เรียงใหม่ไปเก่า
  days: DaySummary[]                 // ใช้ DaySummary เดิม ([] เมื่อยังไม่มีกะ)
  totals: PeriodTotals | null        // ใช้ PeriodTotals เดิม (null เมื่อยังไม่มีกะ)
}
```

ฟิลด์ที่เพิ่มในของเดิม (optional เพื่อไม่ให้ของเก่าพัง):
- `PeriodTotals` เพิ่ม `leaveDays?: number` และ `holidayDays?: number` (งาน B3)
- `Employee` เพิ่ม `has_checkin_pin?: boolean` (งาน B5)
- `EmployeeInput` เพิ่ม `checkin_pin?: string | null` ให้เป็นตัวเลข 4–6 หลัก ส่ง `null` เพื่อลบ PIN (งาน B5)

## 4. Endpoint

| # | Method + path | สิทธิ์ | body / query | data ที่ตอบ | เจ้าของ |
|---|---|---|---|---|---|
| L1 | `GET /leave-types` | hr:read **หรือ self** | `?active=1` | `LeaveType[]` เรียงตาม code | B1 |
| L2 | `POST /leave-types` | hr:write | `LeaveTypeInput` | `LeaveType` (201) · code ซ้ำ 409 | B1 |
| L3 | `PUT /leave-types/:id` | hr:write | `Partial<LeaveTypeInput>` (แก้ code ไม่ได้) | `LeaveType` | B1 |
| L4 | `POST /leave-types/starter` | hr:write | — | `{ created: number }` | B1 |
| L5 | `GET /holidays` | hr:read **หรือ self** | `?year=YYYY` (ไม่ส่งก็ใช้ปีปัจจุบัน) | `PublicHoliday[]` เรียงตามวันที่ | B1 |
| L6 | `POST /holidays` | hr:write | `{ date, name }` | `PublicHoliday` (201) · วันซ้ำ 409 | B1 |
| L7 | `DELETE /holidays/:id` | hr:write | — | `{ id }` | B1 |
| L8 | `GET /leave-requests` | hr:read (self เห็นได้แค่ของตัวเอง) | `?status=&employee_id=&from=&to=` กรองช่วงที่ซ้อนทับกัน | `LeaveRequest[]` ใหม่ไปเก่า สูงสุด 500 | B1 |
| L9 | `POST /leave-requests` | self (ของตัวเองเท่านั้น) หรือ hr:write (ของใครก็ได้) | `LeaveRequestInput` | `LeaveRequest` (201) | B1 |
| L10 | `POST /leave-requests/:id/cancel` | เจ้าของคำขอ หรือ hr:write | — | `LeaveRequest` | B1 |
| L11 | `GET /leave-balances` | hr:read หรือ self ของตัวเอง | `?employee_id=&year=` | `LeaveBalance[]` เฉพาะประเภทที่ active | B1 |
| C1 | `GET /checkin/location` | hr:read **หรือ self** | — | `CheckinLocation \| null` | B4 |
| C2 | `PUT /checkin/location` | hr:write | `CheckinLocation` หรือ `null` เพื่อลบ | `CheckinLocation \| null` | B4 |
| C3 | `POST /checkin` | self | `CheckinGeo` | `CheckinResult` (201) | B4 |
| C4 | `POST /checkin/pin` | hr:read (แท็บเล็ตที่ล็อกอินด้วยบัญชีหัวหน้า) | `CheckinPinInput` | `CheckinResult` (201) | B4 |
| C5 | `GET /me/attendance` | self | `?from=&to=` (ค่าเริ่มต้น 14 วันล่าสุด ช่วงไม่เกิน 62 วัน) | `MyAttendance` | B4 |

ของเดิมที่ใช้ต่อ: `GET /me` (พนักงานของฉัน, 404 เมื่อไม่ได้ผูก) และ `GET /me/slips`

### กฎของการลา (B1)
- L9 ตรวจ: ประเภทลาและพนักงานต้องเป็นของบริษัทนี้ (ไม่ใช่ 404) และ active, `end_date ≥ start_date`,
  `days > 0` เป็นทวีคูณของ 0.5 และไม่เกินจำนวนวันตามปฏิทินในช่วงนั้น ถ้าข้อมูลผิดตอบ 400
- ถ้าซ้อนทับคำขอ PENDING/APPROVED ของคนเดียวกันตอบ 409
- ลาเกินโควตาได้ (ให้หัวหน้าเป็นคนตัดสิน) แต่ใส่คำว่า `เกินโควตา` ใน description ของคำขออนุมัติ
- สร้างแถวสถานะ PENDING แล้วเรียก `createRequest({ tenantId, user, category: 'leave', refType: 'leave_requests', refId, description, amount: 0 })`
  description ใช้รูปแบบ `ลาป่วย 2 วัน · สมชาย ใจดี · 2026-11-03 ถึง 2026-11-04` แล้วเก็บ `approval_request_id`
- L10: ยกเลิกได้เมื่อเป็น PENDING หรือ APPROVED ที่ `start_date` ยังไม่ถึง (เวลาไทย) ถ้าไม่ใช่ตอบ 409
  ถ้าคำขออนุมัติยัง PENDING ให้ตั้งเป็น `CANCELLED` พร้อมเขียน `approval_logs` แบบที่ approval.routes.ts ทำตอนยกเลิก
  (ถ้าไม่มีสถานะ CANCELLED ให้ใช้ REJECTED พร้อม comment `ผู้ขอยกเลิกเอง`)
- ชุดตั้งต้น L4 (ข้าม code ที่มีอยู่แล้ว):
  `SICK ลาป่วย paid 30 · PERSONAL ลากิจ paid 3 · VACATION ลาพักร้อน paid 6 · MATERNITY ลาคลอด paid 120 · STERILIZATION ลาทำหมัน paid null · MILITARY ลารับราชการทหาร paid 60 · TRAINING ลาฝึกอบรม paid null · UNPAID ลาไม่รับค่าจ้าง unpaid null`

### กฎของการอนุมัติลา (B2)
- คนที่อนุมัติได้คือคนที่ `canApprove()` ผ่านอยู่แล้ว **บวก** ผู้ใช้ที่เป็น `user_id` ของ `org_units.manager_employee_id`
  ของแผนกที่พนักงานคนนั้นสังกัด (เฉพาะแผนกตรง ไม่ไล่ขึ้นแผนกแม่ ให้ใส่ `ponytail:` ไว้)
  หัวหน้าห้ามอนุมัติคำขอของตัวเอง
- เมื่ออนุมัติ: `executeApprovedAction` ตั้ง `leave_requests` เป็น APPROVED พร้อม `decided_by` และ `decided_at` ต้องกดซ้ำได้โดยผลไม่เปลี่ยน
  ถ้าคำขอไม่ใช่ PENDING แล้ว (ถูกยกเลิกไป) ให้ข้าม
- เมื่อปฏิเสธ: ตั้ง REJECTED พร้อม `decided_by` และ `decided_at`
- กล่องอนุมัติของหัวหน้าต้องเห็นคำขอ `leave` ของลูกทีมด้วย ให้ตรวจ query รายการ pending ใน approval.routes.ts ว่ากรองตาม role หรือไม่ ถ้ากรองให้เพิ่มเงื่อนไขนี้

### กฎของการนำข้อมูลลาไปใช้ (B3)
- `POST /payroll-runs`: ค่าเริ่มต้นของ `inputs.unpaidLeaveDays` = ผลรวม `days` ของคำขอ APPROVED ที่ประเภทลา `paid=0` และซ้อนทับกับงวดนั้น
  ถ้าคำขอคร่อมงวด ให้คิดตามสัดส่วน `days × (จำนวนวันที่อยู่ในงวด ÷ จำนวนวันตามปฏิทินของคำขอ)` แล้วปัดเป็นทวีคูณ 0.5
- สรุปเวลาเข้าออก (ฟังก์ชันใน `attendanceStore.ts` ที่ REST และ MCP ใช้ร่วมกัน):
  วันที่เป็นวันหยุดบริษัท หรืออยู่ในคำขอลา APPROVED ห้ามนับเป็น `absent` ให้นับใน `holidayDays` หรือ `leaveDays` แทน
  (วันที่เป็นทั้งสองอย่างให้นับเป็นวันหยุด) และใช้ API ของ engine `attendance.ts` เหมือนเดิม

### กฎของการเช็คอิน (B4)
- พนักงานที่ยังไม่มี `device_pin` จะได้ `W` + ตัวเลข 4 หลักที่ไม่ซ้ำในบริษัทตอนเช็คอินเว็บครั้งแรก (บันทึกลง employees) ให้ใส่ `ponytail:` ไว้
- บันทึกลง `attendance_logs` ด้วย `source='WEB'` และบันทึก `lat`, `lng`, `distance_m` เมื่อมีค่า
  ถ้าชน UNIQUE ในวินาทีเดียวกันให้ถือเป็นรายการซ้ำและตอบ 409
- เมื่อตั้งจุดเช็คอินไว้แล้ว: ไม่ส่ง lat/lng มาตอบ 400 `ต้องเปิดตำแหน่ง (GPS) เพื่อเช็คอิน`
  ใช้ระยะ haversine เกิน `radius_m + min(accuracy ?? 0, 100)` ตอบ 400 `อยู่นอกพื้นที่ร้าน (ห่าง N ม.)`
- ถ้ายังไม่ได้ตั้งจุดเช็คอิน รับได้โดยไม่ต้องส่ง GPS แต่ถ้า client ส่งพิกัดมาก็เก็บไว้ (`distance_m` เป็น null)
- pin เดียวกันกดซ้ำภายใน 120 วินาทีตอบ 409 `เพิ่งบันทึกไปเมื่อ HH:mm`
- C4: ใช้ `employee_code` หา `employees.code` ที่ ACTIVE แล้วเทียบ `pin` กับ `checkin_pin_hash` ด้วย lib แฮชรหัสผ่านที่ auth ใช้อยู่แล้ว
  ถ้าผิดตอบ 400 `รหัสพนักงานหรือ PIN ไม่ถูกต้อง` ข้อความเดียวกันทั้งตอนหาพนักงานไม่เจอและตอน PIN ผิด
  ผิด 5 ครั้งติดกันภายใน 5 นาที ล็อก 5 นาทีแล้วตอบ 429 (นับต่อ tenant+employee_code เก็บใน Map ในหน่วยความจำ ใส่ `ponytail:` ว่าใช้ได้แค่ process เดียว)
- C5: หากะของพนักงานจาก `shift_id` แล้วเรียกฟังก์ชันสรุปเดิมใน `attendanceStore.ts` กับ pin ของตัวเอง ห้ามเขียนสูตรใหม่

### กฎของ PIN ในทะเบียนพนักงาน (B5)
- `PUT /employees/:id` (hr:write) รับ `checkin_pin`: ถ้าเป็นสตริงตัวเลข 4–6 หลักให้เก็บเป็น hash, ถ้าเป็น `null` ให้ลบ, รูปแบบอื่นตอบ 400
- `GET /employees` และ `/employees/:id` และ `/me` ตอบ `has_checkin_pin: boolean` และห้ามมี `checkin_pin_hash` ในคำตอบทุกกรณี

## 5. หน้าจอ

| route | ไฟล์ | ใครเห็น | เจ้าของ |
|---|---|---|---|
| `/hr/leave` | `pages/HR/Leave.tsx` | hr:read | F1 |
| `/hr/me` | `pages/HR/MyHr.tsx` | ทุกคนในบริษัทที่มี feature hr | F2 |
| `/hr/kiosk` | `pages/HR/CheckinKiosk.tsx` | hr:read | F3 |
| ส่วน "จุดเช็คอิน" ใน `HrSettings.tsx` + ช่อง PIN ใน `Employees.tsx` + ลิงก์ไป kiosk ใน `Attendance.tsx` | | hr:write | F3 |

- เรียก API ผ่าน `hrService` เท่านั้น ห้ามเรียก `api.*` ในหน้าโดยตรง
- ข้อความ error ใช้ `err.response?.data?.message` ถ้าไม่มีให้ใช้ข้อความ fallback ภาษาไทย
- สีและคอมโพเนนต์ให้ลอกจากหน้า HR เดิม (`Payroll.tsx`, `Attendance.tsx`) ที่ใช้ CSS variable `--surface`, `--fg-2` และอื่นๆ ห้ามใช้สี hard-code
