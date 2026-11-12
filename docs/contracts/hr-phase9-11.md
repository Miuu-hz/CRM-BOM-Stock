# สัญญากลาง HR Phase 9–11 (เข้า-ออกงาน/ทรัพย์สิน · เอกสาร/วินัย · รับสมัคร)

ทุกคนที่ทำช่วงนี้ต้องทำตามไฟล์นี้ ถ้าทำตามไม่ได้ให้หยุดแล้วรายงาน อย่าเปลี่ยนสัญญาเอง
ตารางทั้งหมดสร้างไว้แล้วใน `backend/src/db/migrations.ts` (บล็อก "HR Phase 9-11") ห้ามแก้ migrations

## กติการ่วม (ลอกจาก hr.training.routes.ts)
- ทุก route อยู่ใต้ `/api/hr` (มี `authenticate, subscriptionGate('hr')` ครอบแล้วใน index.ts)
- สิทธิ์: อ่าน = `userHasHr(req,'read')`, เขียน = `userHasHr(req,'write')` (ห่อ `can(...)` จาก services/rbac.service) ไม่ผ่าน → 403
- `/me/*` ใช้ `getSelfEmployee(tenantId, userId)` ไม่ต้องมีสิทธิ์ hr ไม่พบพนักงาน → 404
- ทุก query ต้องมี `tenant_id = req.user!.tenantId` รวมถึงตอน JOIN · id ของบริษัทอื่น → 404
- ตอบ `{ success: true, data }` / `{ success: false, message: '<ไทย>' }` · 201 สร้าง, 400 ข้อมูลผิด, 403, 404, 409 ชนสถานะ
- id = `generateId()`, วันที่ = `YYYY-MM-DD` (ตรวจรูปแบบ), วันนี้ = `thaiDateStr()`, เขียนหลายแถวใช้ `db.transaction`
- ตรวจ input ทุกช่อง: ชนิด, ความยาว (ชื่อ ≤ 200, ข้อความยาว ≤ 5000), enum · ห้ามต่อ string เข้า SQL
- เทสต์: ลอกรูปแบบ hr.training.test.ts (mini express app + createTestUser + supertest) ต้องมีเทสต์ข้ามบริษัท (บริษัท B เรียก id ของ A → 404) และเทสต์สิทธิ์ (USER ไม่มี hr → 403)
- Frontend: หน้าเป็น Thai hardcode, ใช้ class `phopy-card` `phopy-table` `phopy-btn`, modal แบบ inline เหมือน Training.tsx, toast จาก react-hot-toast, icon จาก lucide-react · API client แยกไฟล์ตามที่ระบุด้านล่าง (ห้ามแก้ hr.service.ts)
- ห้ามแก้ไฟล์นอกรายการ "ไฟล์ของคุณ" ของงานตัวเอง ห้ามเพิ่ม dependency

## Phase 9A — เช็กลิสต์เข้า/ออกงาน + เงินงวดสุดท้าย
ไฟล์: `backend/src/routes/hr.lifecycle.routes.ts` (+ `.test.ts`), `frontend/src/services/hrLifecycle.service.ts`, `frontend/src/pages/HR/Lifecycle.tsx` (+ `.test.tsx`)

ตาราง `hr_checklist_templates` (แถวละ 1 ข้อ): id, tenant_id, kind `ONBOARD|OFFBOARD`, org_unit_id (NULL = ทุกแผนก), title, sort_order, auto_action `NULL|DISABLE_USER|UNLINK_LINE`, is_active, created_at
ตาราง `hr_checklist_items` (ข้อของพนักงานแต่ละคน): id, tenant_id, employee_id, kind, title, auto_action, sort_order, done_at, done_by, note, created_at

- `GET /checklist-templates?kind=` · `POST /checklist-templates` · `PUT /checklist-templates/:id` · `DELETE /checklist-templates/:id`
- `POST /checklist-templates/seed-defaults` → ใส่ชุดตั้งต้นถ้าบริษัทยังไม่มีแม่แบบเลย (ถ้ามีแล้ว 409)
  - ONBOARD: เซ็นสัญญาจ้าง · รับยูนิฟอร์ม · เปิดบัญชีผู้ใช้/POS · อบรมพนักงานใหม่ · ผูก LINE · แจ้งเข้า สปส.1-03 ภายใน 30 วัน
  - OFFBOARD: คืนทรัพย์สินของบริษัท · ปิดบัญชีผู้ใช้ ERP (`DISABLE_USER`) · ยกเลิกผูก LINE (`UNLINK_LINE`) · แจ้งออก สปส.6-09 ภายในวันที่ 15 ของเดือนถัดไป · จ่ายเงินงวดสุดท้าย + ค่าพักร้อนคงเหลือ + ค่าชดเชย · ออกหนังสือรับรองการทำงาน · ออก 50 ทวิ
- `POST /employees/:id/checklists` body `{ kind }` → คัดลอกแม่แบบที่ active ของ kind นั้น (org_unit_id ตรงกับพนักงาน หรือ NULL) เป็น items · ถ้ามี item ของ kind นั้นที่ยังไม่ done อยู่แล้ว → 409 · ไม่มีแม่แบบ → 400
  - export ฟังก์ชัน `startChecklist(tenantId, employeeId, kind, userId): number` (คืนจำนวนข้อที่สร้าง) ให้ Phase 11 เรียกใช้
- `GET /employees/:id/checklists?kind=` → items เรียง sort_order
- `PUT /checklist-items/:id` body `{ done: boolean, note? }`
  - done=true และ auto_action=`DISABLE_USER`: ถ้าพนักงานมี user_id → `UPDATE users SET status='inactive'` ของบริษัทนี้เท่านั้น · ห้ามปิดบัญชีของผู้ที่กดเอง (400) · ห้ามปิดบัญชี role MASTER/OWNER (400)
  - done=true และ auto_action=`UNLINK_LINE`: ลบ `line_user_mappings` ของ user นั้นในบริษัทนี้
  - auto action ทำใน transaction เดียวกับการติ๊ก · ยกเลิกติ๊ก (done=false) ไม่ย้อน auto action และต้องบอกใน message
- `GET /employees/:id/final-pay` → ตัวเลขแนะนำ (อ่านอย่างเดียว ไม่ลงบัญชี ไม่แตะ payroll):
  `{ dailyWage, tenureDays, severanceDays, severanceAmount, unusedAnnualLeaveDays, leavePayout, outstandingAdvances, unreturnedAssets: [{id, code, name, loaned_on}] }`
  - dailyWage: รายเดือน = base_wage/30, รายวัน = base_wage, รายชั่วโมง = base_wage×8
  - tenureDays = start_date ถึง end_date (ไม่มี end_date ใช้วันนี้)
  - severanceDays ตามอายุงาน: <120 วัน 0 · ≥120 วัน 30 · ≥1 ปี 90 · ≥3 ปี 180 · ≥6 ปี 240 · ≥10 ปี 300 · ≥20 ปี 400 (1 ปี = 365 วัน)
  - unusedAnnualLeaveDays: ใช้ตัวคำนวณยอดลาคงเหลือที่มีอยู่ใน hr.leave.routes.ts (ประเภทพักร้อน) ถ้าดึงมาใช้ตรงๆ ไม่ได้ให้ export helper จากไฟล์นั้นแบบไม่เปลี่ยนพฤติกรรม แล้วรายงาน
  - outstandingAdvances: ยอดเบิก/ยืมคงค้างจากตาราง employee_advances ตามวิธีที่ hr.advance.routes.ts คิด
  - ปัดเงิน 2 ตำแหน่ง · เป็น pure function `computeFinalPay(...)` แยกจาก handler และมี unit test ตามตารางอายุงานทุกขั้น
- หน้า `/hr/lifecycle`: แท็บ "แม่แบบ" (CRUD + ปุ่มใส่ชุดตั้งต้น) และแท็บ "พนักงาน" (เลือกพนักงาน → เริ่มเช็กลิสต์เข้า/ออกงาน, ติ๊กข้อ, ข้อ auto แสดงไอคอนและถามยืนยันก่อนติ๊ก, กล่อง "เงินงวดสุดท้าย (ตัวเลขแนะนำ)")

## Phase 9B — ทรัพย์สินที่ให้ยืม
ไฟล์: `backend/src/routes/hr.asset.routes.ts` (+ `.test.ts`), `frontend/src/services/hrAsset.service.ts`, `frontend/src/pages/HR/Assets.tsx` (+ `.test.tsx`)

ตาราง `hr_assets`: id, tenant_id, code (UNIQUE ต่อบริษัท), name, category, status `AVAILABLE|LOANED|RETIRED`, notes, created_at
ตาราง `hr_asset_loans`: id, tenant_id, asset_id, employee_id, loaned_on, returned_on (NULL = ยังไม่คืน), note, created_by, created_at

- `GET /assets?status=&q=` (แนบ `current_loan: {loan_id, employee_id, employee_name, loaned_on} | null`) · `POST /assets` · `PUT /assets/:id` (code ซ้ำ → 409; ตั้ง RETIRED ขณะ LOANED → 409)
- `POST /assets/:id/loan` body `{ employee_id, loaned_on, note? }` → ต้อง AVAILABLE (ไม่ใช่ → 409), พนักงานต้อง ACTIVE ของบริษัทนี้ · สร้าง loan + ตั้ง LOANED ใน transaction
- `POST /asset-loans/:id/return` body `{ returned_on }` → คืนแล้วซ้ำ → 409 · returned_on < loaned_on → 400 · ตั้ง AVAILABLE
- `GET /employees/:id/asset-loans` → ทั้งที่ยืมอยู่และประวัติ
- `GET /me/asset-loans` → ของตัวเอง
- รูปตอนส่งมอบ: ใช้ `<PaymentAttachments refType="ASSET_LOAN" refId=... dense />` (ref_type เพิ่มให้แล้ว)
- หน้า `/hr/assets`: ตารางทรัพย์สิน + กรองสถานะ, ปุ่มเพิ่ม/แก้, ให้ยืม, รับคืน, ประวัติการยืมของแต่ละชิ้น

## Phase 10A — เอกสารพนักงาน + วันหมดอายุ + แม่แบบเอกสาร
ไฟล์: `backend/src/routes/hr.document.routes.ts` (+ `.test.ts`), `frontend/src/services/hrDocument.service.ts`, `frontend/src/pages/HR/Documents.tsx` (+ `.test.tsx`), `frontend/src/pages/HR/DocumentPrint.tsx`

ตาราง `hr_employee_documents`: id, tenant_id, employee_id, doc_type `CONTRACT|PROBATION|WORK_PERMIT|CERTIFICATE|OTHER`, title, issued_on, expires_on (NULL ได้), notes, created_by, created_at
ตาราง `hr_doc_templates`: id, tenant_id, kind `CONTRACT|PROBATION|WARNING|CERTIFICATE`, name, body, created_at, updated_at

- `GET /documents?employee_id=&doc_type=` · `POST /documents` · `PUT /documents/:id` · `DELETE /documents/:id` (มีไฟล์แนบอยู่ → 409 เหมือน training)
- `POST /documents` ที่ doc_type=`PROBATION` และไม่ส่ง expires_on → ตั้งเป็น start_date ของพนักงาน + 119 วัน
- `GET /documents/expiring?days=60` → เอกสารที่ expires_on อยู่ในช่วง วันนี้−∞ ถึง วันนี้+days ของพนักงาน ACTIVE: `[{id, employee_id, employee_name, doc_type, title, expires_on, days_left}]` เรียง expires_on (days_left ติดลบ = หมดแล้ว)
- ไฟล์แนบ: `refType="EMPLOYEE_DOCUMENT"`
- `GET/POST/PUT/DELETE /doc-templates`
- `POST /doc-templates/:id/render` body `{ employee_id, extra?: Record<string,string> }` → `{ text }` แทนที่ `{{key}}`:
  company_name, employee_name, employee_code, position, org_unit, start_date, base_wage, national_id, today + key ใน extra · key ที่ไม่รู้จักคงไว้ตามเดิม · ผลเป็น plain text (frontend แสดงด้วย `white-space: pre-wrap` ห้ามใช้ dangerouslySetInnerHTML)
- `GET /me/documents` → เอกสารของตัวเอง (ไม่รวม notes)
- หน้า `/hr/documents`: แท็บ "ใกล้ครบกำหนด" (รวมกับ `hrService.getExpiringTraining(60)` ที่มีอยู่ แสดงในตารางเดียว ป้ายสีตาม days_left: ≤7 แดง, ≤30 เหลือง, อื่นเขียว), แท็บ "เอกสารพนักงาน", แท็บ "แม่แบบ" (แก้ body + ปุ่ม "สร้างเอกสาร" เลือกพนักงาน → เปิด `/hr/documents/print` แสดงข้อความพร้อมพิมพ์ ผ่าน sessionStorage)

## Phase 10B — วินัย หนังสือเตือน ข้อบังคับการทำงาน
ไฟล์: `backend/src/routes/hr.discipline.routes.ts` (+ `.test.ts`), `frontend/src/services/hrDiscipline.service.ts`, `frontend/src/pages/HR/Discipline.tsx` (+ `.test.tsx`)

ตาราง `hr_work_rules`: id, tenant_id, clause_no, title, body, announced_on, is_active, created_at
ตาราง `hr_disciplinary_records`: id, tenant_id, employee_id, incident_date, category, detail, level `VERBAL|WRITTEN`, work_rule_id (NULL ได้), expires_on, acknowledged_at, acknowledged_via `NULL|SELF|WITNESS`, witness_name, created_by, created_at

- `GET/POST/PUT /work-rules` (ลบ = is_active 0)
- `GET /disciplinary?employee_id=` (แนบ `active: boolean` = วันนี้ ≤ expires_on, ชื่อพนักงาน, clause_no) · `POST /disciplinary` → expires_on = incident_date + 1 ปี (ม.119) · incident_date ในอนาคต → 400 · work_rule_id ต้องเป็นของบริษัทนี้
- `PUT /disciplinary/:id` แก้ได้เฉพาะที่ยังไม่รับทราบ (รับทราบแล้ว → 409) · ไม่มี DELETE
- `POST /disciplinary/:id/acknowledge-witness` body `{ witness_name }` (hr write) → via=WITNESS
- `GET /me/disciplinary` → ของตัวเอง · `POST /me/disciplinary/:id/acknowledge` → via=SELF เฉพาะของตัวเอง (ของคนอื่น → 404) · รับทราบซ้ำ → 409
- ห้ามมีช่องหรือ logic ใดผูกกับการหักเงิน (ม.76)
- ไฟล์หลักฐาน: `refType="DISCIPLINARY_RECORD"`
- หน้า `/hr/discipline`: แท็บ "บันทึกวินัย" (ตาราง + ป้าย ยังมีผล/หมดผล + รับทราบแล้ว/ยัง + ปุ่มพยานลงชื่อ), แท็บ "ข้อบังคับการทำงาน"

## Phase 11 — รับสมัครงาน
ไฟล์: `backend/src/routes/hr.recruit.routes.ts` (+ `.test.ts`), `backend/src/routes/hr.recruit.public.routes.ts` (+ `.test.ts`), `frontend/src/services/hrRecruit.service.ts`, `frontend/src/pages/HR/Recruit.tsx` (+ `.test.tsx`), `frontend/src/pages/HR/ApplyPublic.tsx`

ตาราง `hr_job_postings`: id, tenant_id, title, org_unit_id, description, public_token (UNIQUE), is_open, created_at
ตาราง `hr_applicants`: id, tenant_id, posting_id, full_name, phone, email, note, source, stage `APPLIED|INTERVIEW|TRIAL|HIRED|REJECTED`, interview_at, interview_note, consent_at, purge_after, employee_id, created_at

- `GET/POST/PUT /job-postings` · public_token = `crypto.randomBytes(16).toString('hex')` สร้างตอน POST แก้ไม่ได้
- `GET /applicants?posting_id=&stage=` · `PUT /applicants/:id` body `{ stage?, interview_at?, interview_note? }` (HIRED ตั้งผ่าน hire เท่านั้น → 400)
  - ก่อนตอบ `GET /applicants` ให้ลบผู้สมัครของบริษัทนี้ที่ stage ≠ HIRED และ purge_after < วันนี้ (PDPA)
- `POST /applicants/:id/hire` body `{ code, employment_type, base_wage, start_date, org_unit_id? }` → สร้าง employees (ตรวจแบบเดียวกับ POST /employees ใน hr.routes.ts; code ซ้ำ → 409) + stage=HIRED + employee_id + เรียก `startChecklist(..., 'ONBOARD', ...)` จาก hr.lifecycle.routes (ไม่มีแม่แบบก็ไม่ล้ม) ใน transaction · จ้างซ้ำ → 409
- Public (ไม่ล็อกอิน, mount ที่ `/api/public/jobs`, มี rate limit 10 ครั้ง/15 นาที/IP ติดมากับ router):
  - `GET /:token` → `{ title, description, company_name }` เฉพาะที่ is_open=1 (ไม่เจอ/ปิด → 404) ห้ามคืน tenant_id หรือ id
  - `POST /:token/apply` body `{ full_name, phone, email?, note?, consent: true, website? }` → consent ต้องเป็น true (400) · `website` เป็น honeypot: มีค่า → ตอบ 201 แต่ไม่บันทึก · full_name 2–120, phone 9–20 ตัว (ตัวเลข + - เว้นวรรค), email ≤ 200, note ≤ 2000 · purge_after = วันนี้ + 183 วัน · source='PUBLIC' · ตอบ `{ success: true }` เท่านั้น
  - ไม่รับไฟล์แนบจากหน้าสาธารณะ
- หน้า `/hr/recruit`: รายการตำแหน่ง (เปิด/ปิด, คัดลอกลิงก์ `${location.origin}/apply/<token>`), บอร์ด 4 คอลัมน์ สมัคร → สัมภาษณ์ → ทดลองงาน → รับแล้ว (ย้ายขั้นด้วยปุ่ม ไม่ต้องลากวาง), นัดสัมภาษณ์ + บันทึกผล, ปุ่มรับเข้าทำงาน (ฟอร์ม hire), ปุ่มไม่รับ
- หน้า `/apply/:token` (สาธารณะ ไม่มี sidebar): ชื่อบริษัท + ตำแหน่ง + ฟอร์ม + ช่องติ๊กยินยอมพร้อมข้อความ "ข้อมูลใบสมัครจะถูกลบภายใน 6 เดือนหากไม่ได้รับเข้าทำงาน" + ช่อง honeypot ซ่อน · ส่งแล้วขึ้นข้อความขอบคุณ
