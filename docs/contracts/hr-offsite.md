# สัญญากลาง: ปักหมุดจุดเช็คอินบนแผนที่ + ขอทำงานนอกสถานที่

2026-11-17 · branch `hr/billinbox`

## ข้อตกลงกับเจ้าของ

- จุดเช็คอิน: **จุดเดียวต่อร้าน** (ตาราง `hr_checkin_locations` เดิม) เพิ่มแผนที่ลาก/แตะปักหมุดในหน้าตั้งค่า HR
- ทำงานนอกสถานที่: **ขออนุมัติล่วงหน้า** ผ่านกล่องอนุมัติเดิม · วันที่อนุมัติแล้วเช็คอินได้ทุกที่ ระบบเก็บพิกัดจริงและติดป้าย "นอกสถานที่"

```
พนักงานยื่นคำขอ (วัน + สถานที่) ─► กล่องอนุมัติ / การ์ด LINE ─► หัวหน้าแผนกตรง หรือ ADMIN อนุมัติ
วันนั้น: เช็คอิน ─► อยู่นอกรัศมีก็ผ่าน ─► attendance_logs.offsite_request_id
```

## T0 ทำแล้ว (ห้ามแก้ไฟล์เหล่านี้ ยกเว้นที่ระบุว่าเป็นของงานตัวเอง)

- ตาราง `offsite_requests` + คอลัมน์ `attendance_logs.offsite_request_id` (`db/migrations.ts`)
- หมวดอนุมัติ `'offsite'` (`approvalGate.service.ts`: GateCategory, CATEGORY_RESOURCE = hr, `isLeaveManagerFor(..., 'offsite')`, `canApprove`)
- `approval.routes.ts`: กล่องอนุมัติเห็นคำขอของลูกทีม · อนุมัติ → `offsite_requests.status = 'APPROVED'` · ปฏิเสธ → `'REJECTED'` (reference_type = `'offsite_requests'`)
- LINE: ป้ายการ์ด + กดอนุมัติในแชทได้ (`IN_CHAT_APPROVAL`)
- `index.ts`: mount `routes/hr.offsite.routes.ts` ที่ `/api/hr` (ไฟล์เปล่า รอ O1) + CSP อนุญาตรูปจาก `https://tile.openstreetmap.org`
- frontend: `hr.service.ts` มี type `OffsiteRequest`, `OffsiteRequestInput`, `OffsiteStatus`, field `offsite?` ใน `CheckinResult`/`MyAttendanceLog`, และฟังก์ชัน `getOffsiteRequests`, `createOffsiteRequest`, `cancelOffsiteRequest` · `ApprovalInbox.tsx` มีป้าย/ไอคอนหมวด offsite
- frontend dependency: `leaflet` + `@types/leaflet` ติดตั้งแล้ว

## ตาราง `offsite_requests`

id, tenant_id, employee_id, start_date, end_date (YYYY-MM-DD รวมปลายทั้งสองด้าน), place, reason,
status `PENDING | APPROVED | REJECTED | CANCELLED`, approval_request_id, requested_by (user id), decided_by, decided_at, created_at, updated_at

## O1 — backend: endpoint คำขอ

เจ้าของไฟล์: `backend/src/routes/hr.offsite.routes.ts`, `backend/src/routes/hr.offsite.test.ts` (ใหม่)
แม่แบบ: `backend/src/routes/hr.leave.routes.ts` ส่วน `/leave-requests` (GET บรรทัด ~356, POST ~470, cancel ~650) — ใช้ helper/แนวสิทธิ์/รูปแบบ response เดียวกัน (`{ success, data }` / `{ success: false, message }`)

Row ที่ส่งออกทุก endpoint (= `OffsiteRequest` ใน `frontend/src/services/hr.service.ts`):
`{ id, employee_id, employee_code, employee_name, start_date, end_date, place, reason, status, decided_at, created_at }` (`employee_name` = first_name + last_name)

| endpoint | สิทธิ์ | กติกา |
|---|---|---|
| `GET /hr/offsite-requests?mine=1&status=&from=&to=` | `mine=1` = พนักงานที่ผูกกับ user นี้ (ไม่มีทะเบียน → 403) · ไม่ส่ง mine = ต้องมี hr:read | เรียง start_date ใหม่ก่อน · from/to กรองช่วงที่ทับกัน · จำกัด 200 แถว |
| `POST /hr/offsite-requests` | ไม่ส่ง `employee_id` = ขอให้ตัวเอง (ต้องมีทะเบียนพนักงาน ACTIVE ผูกกับ user) · ส่ง `employee_id` ของคนอื่นต้องมี hr:write | ดูด้านล่าง |
| `POST /hr/offsite-requests/:id/cancel` | เจ้าของคำขอยกเลิกได้เมื่อ PENDING · hr:write ยกเลิกได้ทั้ง PENDING และ APPROVED | → `CANCELLED` + ยกเลิก approval request ที่ค้าง (ทำแบบเดียวกับ cancel ของใบลา) · สถานะอื่น → 409 |

POST validation (400 พร้อมข้อความไทย): วันที่ต้องเป็น ISO `YYYY-MM-DD` จริง · `start_date <= end_date` · ช่วงไม่เกิน 31 วัน ·
`start_date` ต้องไม่ย้อนหลัง (เทียบวันไทย ใช้ `thaiDateStr()` จาก `utils/id`) · `place` ต้องไม่ว่าง ยาวไม่เกิน 200 · `reason` ไม่เกิน 500 ·
ช่วงวันทับกับคำขอ PENDING/APPROVED เดิมของพนักงานคนเดียวกัน → 409 "มีคำขอทำงานนอกสถานที่ช่วงนี้อยู่แล้ว"

การอนุมัติ: ทำตาม POST ของใบลา **ทุกประการ** (ใช้ `hasBypass` / `createRequest` / `recordAutoAction` ชุดเดียวกัน) แต่ `category: 'offsite'`, `refType: 'offsite_requests'`, `amount: 0`,
description = `ขอทำงานนอกสถานที่ {start_date}–{end_date} · {place} ({employee_name})` (วันเดียวแสดงวันเดียว)
ถ้าใบลาส่งแจ้งเตือน LINE หลัง createRequest ก็ทำแบบเดียวกัน

เทสต์ครอบ: ขอให้ตัวเอง → PENDING + มี approval request หมวด offsite · ไม่มีทะเบียน → 403 · ขอย้อนหลัง/วันสลับ/place ว่าง → 400 · ช่วงทับ → 409 ·
พนักงานทั่วไปขอแทนคนอื่น → 403 · ยกเลิกของตัวเอง → CANCELLED · ร้านอื่นมองไม่เห็น · `mine=1` เห็นเฉพาะของตัวเอง

## O2 — backend: เช็คอินนอกสถานที่

เจ้าของไฟล์: `backend/src/routes/hr.checkin.routes.ts`, `backend/src/routes/hr.checkinOffsite.test.ts` (ใหม่)

- ใน `executeCheckin` (ใช้โดย `POST /hr/checkin` และ `POST /hr/checkin/face` = เช็คอินด้วยตัวเอง): หา `offsite_requests` ของพนักงานที่ `status = 'APPROVED'` และ `start_date <= วันนี้(ไทย) <= end_date`
  - เจอ: **ข้ามด่านรัศมี** และไม่บังคับ GPS · ถ้าส่งพิกัดถูกต้องมาก็เก็บ lat/lng และ `distance_m` (เมื่อร้านตั้งจุดไว้) ตามเดิม · INSERT `attendance_logs.offsite_request_id` = id คำขอ · response `data.offsite = true`
  - ไม่เจอ: พฤติกรรมเดิมทุกอย่าง, `data.offsite = false`
- ตู้ kiosk (`/checkin/pin`, `/checkin/face-kiosk`) **ไม่เปลี่ยน** — ตู้อยู่ที่ร้าน ถ้าทั้งสองทางใช้ `executeCheckin` ร่วมกันให้ส่ง flag เพื่อปิดทางนี้
- `GET /hr/me/attendance`: แต่ละ log เพิ่ม `offsite: boolean` (จาก `offsite_request_id IS NOT NULL`)
- ข้อความเมื่ออยู่นอกรัศมีและไม่มีคำขอ: เติมท้ายข้อความเดิมว่า ` · ถ้าทำงานนอกสถานที่ให้ยื่นคำขอก่อน`

เทสต์ (INSERT แถว `offsite_requests` ตรงด้วย SQL ไม่เรียก endpoint ของ O1): ร้านตั้งจุด + อยู่ไกล + ไม่มีคำขอ → 400 · มีคำขอ APPROVED วันนี้ → 200, `offsite: true`, แถว log มี `offsite_request_id` ·
คำขอ PENDING / ของวันอื่น / ของพนักงานคนอื่น → ยัง 400 · มีคำขอแต่ไม่ส่งพิกัด → 200 · `/me/attendance` คืน `offsite`

## O3 — frontend: หน้า "ของฉัน"

เจ้าของไฟล์: `frontend/src/pages/HR/MyOffsite.tsx` (ใหม่), `frontend/src/pages/HR/MyOffsite.test.tsx` (ใหม่), `frontend/src/pages/HR/MyHr.tsx` (เฉพาะจุดวาง component + ป้ายนอกสถานที่)

- `MyOffsite`: การ์ด "ทำงานนอกสถานที่" — ฟอร์ม (วันเริ่ม, วันสิ้นสุด default = วันเริ่ม, สถานที่ *, เหตุผล) ปุ่ม "ส่งคำขอ" · รายการคำขอของฉัน (`getOffsiteRequests({ mine: 1 })`) พร้อมป้ายสถานะ (รออนุมัติ/อนุมัติแล้ว/ไม่อนุมัติ/ยกเลิก) · ปุ่มยกเลิกเฉพาะ PENDING · แสดง error จาก server ตรง ๆ
- วางใน `MyHr.tsx` ใกล้ส่วนขอลา ใช้ pattern การ์ด/ปุ่ม/สีเดียวกับส่วนขอลาในไฟล์นั้น (ตัวแปร CSS `var(--...)` ห้าม hardcode สี)
- หลังเช็คอิน ถ้า `res.offsite` ต่อท้ายข้อความสำเร็จว่า ` · นอกสถานที่` · ในรายการเวลาเข้าออกของฉัน log ที่ `offsite` ขึ้นป้ายเล็ก "นอกสถานที่"
- เทสต์ตามแบบ `MyHr.test.tsx` (mock `hrService`): ส่งฟอร์ม → เรียก `createOffsiteRequest` ด้วยค่าที่กรอก · place ว่าง → ไม่เรียก · ยกเลิก → เรียก `cancelOffsiteRequest`

## O4 — frontend: แผนที่ปักหมุด

เจ้าของไฟล์: `frontend/src/components/hr/LocationPickerMap.tsx` (ใหม่), `frontend/src/pages/HR/HrSettings.tsx` (เฉพาะส่วนจุดเช็คอิน)

- `LocationPickerMap({ lat, lng, radius, onChange })`: Leaflet ล้วน (ไม่ใช้ react-leaflet) import `leaflet/dist/leaflet.css` · tile `https://tile.openstreetmap.org/{z}/{x}/{y}.png` + attribution "© OpenStreetMap contributors"
  - แตะแผนที่หรือลากหมุด → `onChange(lat, lng)` (ปัด 6 ตำแหน่ง) · วงกลมรัศมี `radius` เมตรรอบหมุด ขยับตาม props
  - ไม่มีพิกัด: กลางแผนที่ = กรุงเทพฯ (13.7563, 100.5018) zoom 12 ยังไม่มีหมุด · มีพิกัด: zoom 17
  - หมุดใช้ `L.divIcon` (ห้ามพึ่งรูป marker ของ leaflet — bundler หารูปไม่เจอ) · ล้าง map ใน cleanup ของ effect
- `HrSettings.tsx`: โหลด component ด้วย `React.lazy` + `Suspense` (chunk แยก) วางเหนือช่องกรอก lat/lng เดิม · ช่องกรอกและปุ่ม "ใช้ตำแหน่งปัจจุบัน" เดิมคงไว้และซิงก์สองทางกับแผนที่ · สูง 280px มุมโค้งตามการ์ดเดิม
- ไม่ต้องเขียนเทสต์แผนที่ (jsdom รัน leaflet ไม่ได้) แต่เทสต์เดิมของ frontend ต้องยังผ่าน — ถ้ามีเทสต์ที่ render `HrSettings` ให้ mock component นี้

## O5 — frontend: ฝ่ายบุคคลดูคำขอ

เจ้าของไฟล์: `frontend/src/pages/HR/OffsiteList.tsx` (ใหม่), `frontend/src/pages/HR/Leave.tsx` (เฉพาะจุดวาง component)

- `OffsiteList`: ตารางคำขอทำงานนอกสถานที่ทั้งร้าน (`getOffsiteRequests({ status })`) คอลัมน์ พนักงาน / ช่วงวัน / สถานที่ / เหตุผล / สถานะ · ตัวกรองสถานะ (ทั้งหมด + 4 สถานะ) · ปุ่ม "ยกเลิก" สำหรับ PENDING และ APPROVED (`cancelOffsiteRequest`) · ว่าง = ข้อความ "ยังไม่มีคำขอ"
- วางเป็นส่วนท้ายของหน้า `Leave.tsx` หัวข้อ "ทำงานนอกสถานที่" ใช้ pattern ตารางเดียวกับหน้านั้น · การอนุมัติทำที่กล่องอนุมัติ ไม่ต้องมีปุ่มอนุมัติที่นี่

## ที่ตั้งใจไม่ทำรอบนี้

- หลายจุดเช็คอิน/หลายสาขา · เช็คอินนอกสถานที่แบบไม่ขอล่วงหน้า · แนบรูปตอนเช็คอิน · ป้ายนอกสถานที่ในสรุปเวลาทำงาน/ค่าแรง (ข้อมูลเก็บแล้วที่ `attendance_logs.offsite_request_id`)
