# Contract: ออเดอร์ออนไลน์รายออเดอร์ (Online orders) + แก้บั๊กที่เกี่ยวข้อง — 2026-11-23

ผู้คุม (supervisor): Claude Code · ผู้เขียนโค้ด: agy workers A/B/C · Baseline: `de021d5` (server branch `ui`)
เอกสารนี้คือข้อตกลงกลาง ถ้าโค้ดขัดกับเอกสาร ให้ถือเอกสารเป็นหลักและแจ้งผู้คุม ห้ามตัดสินใจเองนอกเอกสาร

## 0. เป้าหมาย (เจ้าของยืนยันแล้ว)
ร้านขาย Shopee ทุกวัน (tenant `tenant_msqy2xbn`, shop_key `bebozch`) ต้องการข้อมูล **รายออเดอร์** แยกหมวด ONLINE
เพื่อวิเคราะห์ยอดตาม จังหวัด/อำเภอผู้ซื้อ · สินค้า/ตัวเลือก(ลาย) · ช่องทาง/ร้าน · วัน/เดือน และต้องไม่ปนกับขายส่ง (SO)
- แหล่งข้อมูล: Shopee Seller Centre > คำสั่งซื้อของฉัน > ส่งออก (หนึ่งแถว = หนึ่งบรรทัดสินค้าของออเดอร์) — Gemini อ่านไฟล์แล้วส่งผ่าน MCP
- วันนี้ทำ SHOPEE · พรุ่งนี้จะเพิ่ม LAZADA → ทุกอย่างต้อง generic ตาม `platform` (ตาราง/ฟังก์ชันห้ามชื่อ shopee_*)
- **ข้อมูลรายออเดอร์ไม่ลงบัญชี ไม่ตัดสต็อก** — บัญชีและสต็อกยังมาจากสายรอบเดือนเดิม (`platform_submit_file` → `confirmSale` → `postMonth`, business_unit `ONLINE`) ห้ามสร้าง `sales_orders`/`invoices`/`journal_entries`/`stock_movements` จากข้อมูลรายออเดอร์ ยกเว้นข้อ 6 (รับคืนข้ามเดือน) ที่เจ้าของสั่งเพิ่ม

## 1. ข้อมูลส่วนตัว (PII) — กติกาเจ้าของ
- เก็บครบทุกช่อง แต่ **ชื่อผู้รับ เบอร์โทร ที่อยู่เต็ม** อยู่ในไฟล์ SQLite แยก `pii.db` เท่านั้น ห้ามลงฐานหลัก `dev.db`
- จังหวัด อำเภอ รหัสไปรษณีย์ เก็บในฐานหลักแบบไม่มาสก์ (ใช้วิเคราะห์)
- ฐานหลักเก็บค่ามาสก์ที่คำนวณด้วยโค้ด backend ตอนรับข้อมูลเข้า (ingest) ไม่ใช่ AI
- ทุก API/MCP/UI คืน **เฉพาะค่ามาสก์** ไม่มี endpoint คืนค่าดิบ (เจ้าของตอบข้อ 4: ไม่มีปุ่มดูดิบ)
- `pii.db` สำรองในเครื่องเท่านั้น **ห้ามอัปโหลด Google Drive** · ยังไม่ตั้ง purge อัตโนมัติ
- MCP tool ห้ามคืน PII กลับในผลลัพธ์ (แม้ค่าที่เพิ่งส่งมา)

### กติกามาสก์ (`backend/src/utils/piiMask.ts`)
- นับตาม **code point** (`Array.from(str)`) ไม่ใช่ grapheme — ตรงกับตัวอย่างเจ้าของ `ธัชพงษ์ → ธัชพxxx`
- `maskName(s)`: trim, ยุบช่องว่างซ้อน, มาสก์ **ทีละคำ** (แยกด้วยช่องว่าง): คำยาว ≥ 4 code point → เก็บ `len-3` ตัวแรก + `xxx`; คำยาว 1–3 → ตัวแรก + `xxx`; ว่าง/null → `''`
  - `ธัชพงษ์` → `ธัชพxxx` · `ทีปกร สะอาดถิ่น` → `ทีxxx สะอาดถxxx` · `อร` → `อxxx`
- `maskPhone(s)`: ถ้าไม่มีตัวเลข → คืนค่าเดิม; ไม่งั้นแทน **ตัวเลข 3 ตัวสุดท้าย** ด้วย `x` โดยคงอักขระอื่นไว้ตำแหน่งเดิม `081-234-5678` → `081-234-5xxx`, `66812345678` → `66812345xxx`
- `maskAddress(s)`: ซ่อน **เฉพาะบ้านเลขที่** แทนด้วย `xxx` ที่เหลือแสดงครบ
  - บ้านเลขที่ = ตัวเลขชุดแรก (`\d+(?:[/-]\d+)*`) ที่ไม่ได้ตามหลังคำนำหน้า `ม.` `หมู่` `หมู่ที่` `ซ.` `ซอย` `ถ.` `ถนน` `ต.` `อ.` `จ.` `ชั้น` `ห้อง` และไม่ใช่รหัสไปรษณีย์ 5 หลัก; ถ้ามีคำว่า `เลขที่` ให้ใช้ตัวเลขหลังคำนั้นก่อน
  - `เลขที่ 858/7 หมู่ที่ 4 หมู่บ้าน บ้านฟิวเจอร์โซน ตำบลรอบเมือง อำเภอเมืองชัยภูมิ จังหวัดชัยภูมิ 36000` → `เลขที่ xxx หมู่ที่ 4 หมู่บ้าน บ้านฟิวเจอร์โซน ตำบลรอบเมือง อำเภอเมืองชัยภูมิ จังหวัดชัยภูมิ 36000`
  - `โรงเรียนรัฐราษฏร์อัปถัมภ์ 196 ม.7 ต.อ่างทอง อ.เมือง จ.ราชบุรี 70000` → `โรงเรียนรัฐราษฏร์อัปถัมภ์ xxx ม.7 ต.อ่างทอง อ.เมือง จ.ราชบุรี 70000`
  - ไม่มีบ้านเลขที่ → คืนค่าเดิม

## 2. ฐานข้อมูล
### 2.1 ฐานหลัก (append ท้าย `runMigrations` ใน `backend/src/db/migrations.ts`, สไตล์ try/CREATE IF NOT EXISTS แบบเดียวกับ platform_months :2655)
```
online_orders(
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, platform TEXT NOT NULL, shop_key TEXT NOT NULL,
  order_no TEXT NOT NULL, order_time TEXT, order_date TEXT NOT NULL /*YYYY-MM-DD เวลาไทย*/, month TEXT NOT NULL /*YYYY-MM จาก order_date*/,
  status_raw TEXT, status_group TEXT NOT NULL /*ACTIVE|COMPLETED|CANCELLED|UNPAID|RETURNED*/,
  province TEXT, district TEXT, postal_code TEXT, payment_method TEXT, shipping_option TEXT, tracking_no TEXT,
  buyer_name_masked TEXT, buyer_phone_masked TEXT, address_masked TEXT,
  first_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_batch_id TEXT,
  UNIQUE(tenant_id, platform, shop_key, order_no))
  INDEX (tenant_id, order_date), (tenant_id, province, district), (tenant_id, status_group)
online_order_lines(
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, order_id TEXT NOT NULL REFERENCES online_orders(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL, product_name TEXT NOT NULL, variant_name TEXT, qty REAL NOT NULL, qty_returned REAL NOT NULL DEFAULT 0,
  list_price REAL, net_price REAL NOT NULL /*ราคาขายสุทธิของบรรทัด (รวมทั้งบรรทัด) ตามไฟล์*/, source_ref TEXT,
  UNIQUE(order_id, line_no))
  INDEX (tenant_id, product_name, variant_name), (tenant_id, source_ref)
online_import_batches(id, tenant_id, platform, shop_key, rows_received, orders_inserted, orders_updated, lines_unlinked, created_by, created_at)
online_return_events(
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, platform TEXT NOT NULL, shop_key TEXT NOT NULL, order_no TEXT NOT NULL,
  order_month TEXT NOT NULL, product_name TEXT NOT NULL, variant_name TEXT, source_ref TEXT, qty_delta REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' /*PENDING|RESTOCKED|SKIPPED*/, detected_at TEXT NOT NULL,
  resolved_at TEXT, resolved_by TEXT, stock_movement_id TEXT)
  INDEX (tenant_id, status)
```
- ไม่มีคอลัมน์ stock_item_id/link_status ในบรรทัด: การผูกสต็อก **คำนวณตอนอ่าน** จาก `source_ref` → `findPlatformAlias` (alias ตัวเดิม) เพื่อให้ผูกครั้งเดียวมีผลทันทีโดยไม่ต้อง relink
### 2.2 ฐาน PII `pii.db` (connection แยก ห้าม ATTACH)
- ไฟล์ `backend/src/db/piiConnection.ts`: `new Database(process.env.SQLITE_PII_DB_PATH ?? path.join(__dirname,'../../pii.db'))`, `PRAGMA busy_timeout=5000`, สร้างตารางเองด้วย `PRAGMA user_version` (v1) — ห้าม import `db/sqlite`
```
online_order_pii(tenant_id, platform, shop_key, order_no, buyer_name, buyer_phone, full_address, postal_code, created_at, updated_at,
  PRIMARY KEY(tenant_id, platform, shop_key, order_no))
```
- export: `piiDb`, `upsertOrderPii(rows)`, `deleteTenantPii(tenantId)`, `backupPiiTo(destPath)`
- เทสต์: `backend/vitest.config.ts` ตั้ง `SQLITE_PII_DB_PATH` → `test-pii.db` และ throw ถ้า path ลงท้าย `pii.db` ที่ไม่ใช่ test (แบบเดียวกับ guard dev.db)
- ลำดับเขียน: PII ก่อน (upsert) แล้วฐานหลัก (transaction เดียว) — ทั้งคู่ idempotent ส่งซ้ำซ่อมเองได้

## 3. Service `backend/src/services/onlineOrders.service.ts`
- `submitOnlineOrders(tenantId, {platform, shopKey, rows}, userId)` → `{batchId, ordersInserted, ordersUpdated, linesUnlinked, returnEvents, unlinkedNames[]}`
  - group rows ตาม order_no; ทุกแถวของออเดอร์เดียวกันต้องอยู่ใน payload เดียวกัน (ถ้าส่งออเดอร์เดิมมา = แทนที่บรรทัดทั้งออเดอร์)
  - `status_group` คำนวณจาก `status_raw` ด้วย `statusGroupOf(platform, raw, qtyReturnedSum)` (SHOPEE: มีคำว่า `ยกเลิก`→CANCELLED, `ที่ต้องชำระ`→UNPAID, มีคำว่า `คืน` หรือ qty_returned>0→RETURNED, `สำเร็จ`→COMPLETED, อื่นๆ→ACTIVE) — platform อื่นยัง throw `ยังไม่รองรับ`
  - order_date = วันที่ของ order_time ตามเวลาไทย (Asia/Bangkok); month = YYYY-MM ของ order_date
  - ก่อนแทนที่บรรทัด: เทียบ qty_returned เดิมต่อ (product_name, variant_name) ถ้า **เพิ่มขึ้น** → insert `online_return_events` (qty_delta = ส่วนที่เพิ่ม)
  - source_ref ต่อบรรทัด: หาแถว `platform_month_products` ของ tenant/platform/shop เดียวกัน ที่ชื่อ normalize ตรงกัน (ใช้กติกาเดียวกับ `matchOrdersToProducts` ใน platformMonth.service.ts — แยก helper ออกมาใช้ร่วม ห้าม copy) โดยเลือกเดือนเดียวกันก่อน ไม่มีค่อยใช้เดือนล่าสุด → `sourceRefOf(...)`; ชื่อชนกัน (ambiguous) หรือไม่เจอ → `${PLATFORM}:N${normName(product)}||${normName(variant)}`
  - ทั้งหมดใน transaction ฐานหลักเดียว; ไม่แตะตารางบัญชี/สต็อก
- `relinkOnlineLines(tenantId, platform, shopKey)`: อัปเดต source_ref ของบรรทัดที่ยังเป็น `:N` หลังมีไฟล์ products ใหม่ — เรียกจาก `submitFile` (platformMonth.service.ts) หลัง commit เมื่อ fileType = products; error ให้ log ไม่ throw
- `getOnlineSummary(tenantId, {from, to, platform?, shopKey?, groupBy, includeStatuses?})` groupBy ∈ province|district|product|variant|shop|day|month → แถว `{key, label, orders, qty, qtyReturned, sales, returnsValue, netSales}`; ค่าเริ่มต้นนับเฉพาะ ACTIVE/COMPLETED/RETURNED (ไม่นับ CANCELLED/UNPAID); returnsValue = net_price × qty_returned / qty
- `getUnlinkedLines(tenantId, filter)`: บรรทัดที่ source_ref ยังไม่มี alias → `{sourceRef, productName, variantName, qty, proposed?}` (ใช้ `platform_sku_proposals` เดิม)
- `getUnattributedReturns(tenantId, platform, shopKey, month)`: ถ้ารอบเดือนนั้นมีไฟล์ orders (`platform_months.orders_json`) → ต่อ (product, variant): monthly qty_returned − sum(qty_returned บรรทัดรายออเดอร์เดือนนั้น) ถ้า > 0 แสดงเป็น "คืนที่ไม่ระบุออเดอร์" (คำนวณสด ไม่เก็บ)
- `listReturnEvents` / `restockReturnEvents(tenantId, ids, userId)`: ข้อ 6
- Mapping ชื่อ (`:N` refs) ใช้ `upsertPlatformAlias` / `platform_sku_proposals` / `deletePlatformAlias` ตัวเดิม — เพิ่ม `confirmOnlineMapping(tenantId, {sourceRef, stockItemId, factor}, userId)` ที่ไม่ต้องมี monthId (name = product · variant ของบรรทัด)

## 4. MCP (`backend/src/mcp/tools/onlineOrders.ts`, ลงทะเบียนใน `mcp/tools.ts`)
- `online_submit_orders` {platform: enum['SHOPEE'], shop_key (shopKeyStr), rows: array(1..150)} แถวละ: order_no, order_time (ISO หรือ `YYYY-MM-DD HH:mm`), status, buyer_name?, buyer_phone?, full_address?, province?, district?, postal_code?, product_name, variant_name?, qty (cnt>0), qty_returned (cnt, default 0), list_price? (num), net_price (num), tracking_no?, payment_method?, shipping_option?
  - คำอธิบาย tool ต้องมีแม็บคอลัมน์ Shopee → ฟิลด์ (หมายเลขคำสั่งซื้อ→order_no, วันที่ทำการสั่งซื้อ→order_time, สถานะการสั่งซื้อ→status, ชื่อผู้รับ→buyer_name, หมายเลขโทรศัพท์→buyer_phone, ที่อยู่ในการจัดส่ง→full_address, จังหวัด→province, เขต/อำเภอ→district, รหัสไปรษณีย์→postal_code, ชื่อสินค้า→product_name, ชื่อตัวเลือก→variant_name, จำนวน→qty, จำนวนที่ส่งคืน→qty_returned, ราคาตั้งต้น→list_price, ราคาขายสุทธิ→net_price, หมายเลขติดตามพัสดุ→tracking_no, ช่องทางการชำระเงิน→payment_method, ตัวเลือกการจัดส่ง→shipping_option) + กฎ: ส่งทุกแถวของออเดอร์เดียวกันในครั้งเดียว, เกิน 150 แถวแบ่งส่งหลายครั้ง, ห้ามคำนวณตัวเลขเอง, ใบปะหน้า (shipping label) ไม่มีราคา ห้ามใช้เป็นแหล่งข้อมูล
  - ผลลัพธ์ห้ามมี PII
- `online_orders_query` (อ่านอย่างเดียว, เพิ่มใน `READ_ONLY_TOOLS`) {from, to, group_by, platform?, shop_key?} → getOnlineSummary + unlinked count
- `online_propose_mapping` {pairs: [{source_ref, sku | stock_item_id, factor}]} → proposals เดิม (ยังไม่ผูกจริง)
- MCP ทั้งกลุ่มแพลตฟอร์ม (platformMonth + onlineOrders) ต้องเช็ค feature `platform_settlement` แบบเดียวกับ REST (`index.ts:521`) — ถ้า tenant ไม่มี feature ไม่ต้องลงทะเบียน tool

## 5. REST (`backend/src/routes/platformSettlement.routes.ts`, ใต้ `/api/platform-settlement`)
- `GET /online-orders/summary?from&to&groupBy&platform&shopKey` · `GET /online-orders/list?from&to&status&q&page` (ค่ามาสก์เท่านั้น) · `GET /online-orders/unlinked` · `POST /online-orders/mapping/confirm` {sourceRef, stockItemId, factor} · `POST /online-orders/mapping/accept-all` · `GET /online-orders/returns?status` · `POST /online-orders/returns/restock` {ids[]} · `GET /online-orders/unattributed-returns?platform&shopKey&month`
- GET ทุกตัวใน router นี้ (รวมของเดิม mapping/posting-preview) ต้อง `requireRole('ADMIN','MASTER','MANAGER')`; POST เขียนตามเดิม
- ลบ endpoint ฟอร์มกรอกยอดแบบเก่า `GET /`, `POST /confirm`, `POST /:id/payout` (หน้าเว็บไม่เรียกแล้ว) **หลัง** grep ยืนยันว่าไม่มีผู้เรียกทั้ง frontend, MCP, เทสต์ — ฟังก์ชัน service ที่ไม่เหลือผู้เรียกให้ลบด้วย; ตาราง `platform_settlements` ไม่ลบ

## 6. รับคืนข้ามเดือน (เจ้าของ: "ทำระบบไว้คร่าวๆ")
- ภายในเดือนเดียวกัน รอบเดือนหักคืนจาก qty_net อยู่แล้ว (`applyOrdersDerivation`) → ไม่ต้องทำอะไร
- คืนของออเดอร์ที่ **รอบเดือนของมันยืนยันการขายแล้ว** (`platform_months.sale_confirmed_at` ไม่ null สำหรับ order_month) = สต็อกถูกตัดไปแล้วแต่ของกลับมา → `online_return_events` PENDING
- ปุ่ม "รับคืนเข้าสต็อก" ตอนสิ้นเดือน (`restockReturnEvents`): เฉพาะ event ที่ source_ref ผูก alias แล้ว และรอบเดือนของ order_month ยืนยันขายแล้ว → `stock_movements` IN ด้วย qty_delta × factor, reference `ONLINE_RETURN:<event id>`, ต้นทุนตาม `stock_items.unit_cost` แบบเดียวกับ confirmSale → event = RESTOCKED; รอบที่ยังไม่ยืนยัน → SKIPPED พร้อมเหตุผล "จะหักในรอบเดือนนั้นเอง"; ทำใน transaction; **ลงบัญชีต้นทุนกลับ** (เจ้าของสั่ง 2026-11-23): ต่อ event ที่ RESTOCKED → `postJournal` Dr บัญชีสินค้า (กติกาเดียวกับ confirmSale: FINISHED/WIP → `ACC.INVENTORY` อื่นๆ → `ACC.RAW_MATERIAL`) / Cr `ACC.COGS_PRODUCT` ยอด = qtyIn × unit_cost, referenceType `ONLINE_RETURN`, referenceId = event id, businessUnit `ONLINE`, วันที่ = วันที่กดรับคืน (เวลาไทย); งวดปิดแล้ว (`closedPeriodLabel`) → event นั้นไม่รับคืน (error) ; ต้นทุน 0 → รับคืนสต็อกแต่ไม่ลง JV และเตือน; ไม่ลงฝั่งยอดเงิน (ยอดเงินคืนอยู่ใน income ของ Shopee เดือนถัดไปแล้ว — refund_to_buyer)
- ยอดขายในรายงานวิเคราะห์ลดลงผ่าน qty_returned / returnsValue และ "คืนที่ไม่ระบุออเดอร์"

## 7. หน้าเว็บ (worker C)
- `frontend/src/pages/Accounting/PlatformSettlement.tsx`: เพิ่มแท็บย่อย "ออเดอร์ออนไลน์" ข้าง `PlatformMonthSale`
- ไฟล์ใหม่ `frontend/src/pages/Accounting/OnlineOrders.tsx`: ช่วงวันที่ + เลือก groupBy (จังหวัด/อำเภอ/สินค้า/ลาย/ร้าน/วัน/เดือน) ตารางสรุป, ตารางออเดอร์ (ค่ามาสก์), ส่วน "ยังไม่ผูกสินค้า" (dropdown สินค้าในคลัง + factor + ยืนยัน / ยอมรับข้อเสนอทั้งหมด — แบบเดียวกับ PlatformMonthSale), ส่วน "รับคืนข้ามเดือน" (รายการ PENDING + ปุ่มรับคืนเข้าสต็อก) และ "คืนที่ไม่ระบุออเดอร์"
- ข้อความ UI ภาษาไทย ใช้ component/สไตล์ที่ไฟล์ข้างเคียงใช้ ไม่เพิ่ม dependency
- Dashboard (`PhopyBoard.tsx` + `phopy-board.routes.ts`): ช่อง "ออนไลน์" จำนวนออเดอร์มาจาก `online_orders` (ACTIVE/COMPLETED/RETURNED) ยอดเงินมาจาก ledger ONLINE เดิม + ป้าย "ยังไม่ลงบัญชี" สำหรับยอดจากรายออเดอร์ของเดือนที่ยังไม่ post

## 8. บั๊กที่ต้องแก้ (worker B เว้นที่ระบุ)
| # | จุด | แก้ |
|---|---|---|
| B1 | `services/backup.service.ts:10` | ใช้ `process.env.SQLITE_DB_PATH` (fallback เดิม) |
| B2 | `backup.service.ts:100-107` | snapshot ด้วย `db.backup(dest)` ของ better-sqlite3 แล้วค่อย gzip (ไม่ copy ไฟล์สด) |
| B3 | `backup.service.ts:147` | retention 3 ไฟล์ต่อประเภท ตาม CLAUDE.md ข้อ 4 |
| B4 | backup | สำรอง `pii.db` ด้วย (`backupPiiTo`) ไฟล์แยกชื่อ `phopy-pii-<ts>.db.gz` retention 3 · **ห้ามอัป Drive** |
| B5 | `mcp/tools/sales.ts:31,:119-123` | `create_quotation`: บรรทัดที่ไม่ผูกสต็อกต้อง unitPrice > 0 (0 → `UNIT_PRICE_REQUIRED`); เพิ่มคำอธิบาย tool: ห้ามใช้กับออเดอร์ marketplace (Shopee/Lazada) ให้ใช้ `online_submit_orders` |
| B6 | `sales.ts:70` | ลบพารามิเตอร์ที่ไม่ใช้ของ `registerSalesTools` และแก้จุดเรียกใน `mcp/tools.ts` (แก้แค่บรรทัดเรียก) |
| B7 | `mcp/tools/binding.ts:118` | ผูกด้วยมือได้ทุกสถานะยกเว้น INACTIVE (ให้ตรง `shared.ts:154`) |
| B8 | `mcp/tools/shared.ts:154-157` | escape `%` `_` `\` ใน LIKE (`ESCAPE '\'`) |
| B9 | `platformMonthSale.service.ts:17-21,:152` | `sourceRefOf` throw ถ้าไม่มีทั้ง variant_id และ product_id (ไม่สร้าง `Pnull`) |
| B10 | `platformMonthSale.service.ts:196-205` | `acceptAllProposals` ทำใน `db.transaction` |
| B11 | `platformMonthSale.service.ts:73-110` | ตัด N+1 ใน `getMappingRows` (ดึง alias/proposal/stock ครั้งเดียวแล้ว map) ผลลัพธ์ต้องเหมือนเดิมทุกฟิลด์ |
| A-owned | `mcp/tools.ts:91` feature gate · routes requireRole · dead endpoints | worker A (ข้อ 4, 5) |
| C-owned | dashboard นับออนไลน์ | worker C (ข้อ 7) |
| ไม่ใช่บั๊ก | `routes/sales/shared.ts` business_unit `WHOLESALE` และ dashboard นับ SO เป็นขายส่ง | ตามแบบใหม่ SO = ช่องทางขายส่งโดยนิยาม ออนไลน์ไม่ผ่าน SO แล้ว ไม่แก้ |
| ไม่ใช่บั๊ก | `resolveCustomer` สร้างลูกค้าจากชื่อ | พฤติกรรมตั้งใจของใบเสนอราคา B2B ป้องกันด้วยคำอธิบาย tool (B5) |

## 9. ลบ tenant
- `routes/master.routes.ts:219-250` (purge) ต้องเรียก `deleteTenantPii(tenantId)` ด้วย (worker A)

## 10. กติกางาน (ทุก worker)
- อ่าน `CLAUDE.md` ก่อน · ห้ามสร้างไฟล์ใน /root · ห้ามไฟล์ .bak · ไม่เพิ่ม dependency
- แก้เฉพาะไฟล์ที่ได้รับมอบ (ดูตารางเจ้าของไฟล์ใน brief ของแต่ละ worker)
- ทุก logic ใหม่ต้องมีเทสต์ vitest ข้างไฟล์ (สไตล์เดียวกับ `mcp/tools/platformMonth.test.ts`)
- เจอบั๊ก/dead code นอกขอบเขต → **รายงาน ห้ามแก้**
- Done: `tsc --noEmit` ผ่านทั้ง backend/frontend และ vitest ผ่าน (ผู้คุมรันเองบน CT100)
