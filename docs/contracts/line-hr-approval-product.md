# LINE: HR approval by slash command + /สินค้า (owner decisions 2026-11-24)

Baseline: 6ec6369 (branch line-master)
Targets: Modify backend/src/services/line-bot.service.ts, backend/src/services/line-flex-templates.ts, backend/src/services/stockCostBasis.service.ts
(add one function only; getCostBasis/getBuyLog/getSellLog untouched) · Create backend/src/services/lineHrApprovalProduct.test.ts ·
existing lineInChatApproval.test.ts only where the 30-minute rule changes an expectation.
Do not touch: anything else. No new table, column, dependency, frontend change. All answers are replyMessage (free), never push.
Both features: PRIVATE chat only (group/room: no data, ever; a linked user gets "ใช้ได้ในแชทส่วนตัวเท่านั้น", others silence).
Parsed near the other "/" commands, after the registration gate (needs a linked user `me`, or a floating Master); existing commands unchanged.

## A. HR approval (IN_CHAT_APPROVAL modules only; everything else stays "เปิดในเว็บ")
- 30 minutes counted from approval_requests.created_at (ISO, UTC). Older: cannot be decided in LINE by command OR by the card buttons
  (approve_req/reject_req postback) → "เลย 30 นาทีแล้ว อนุมัติในเว็บ <APP_URL>/approvals". One shared private helper decides for button and command;
  it keeps today's checks (tenant of the request for a floating Master, package expired, IN_CHAT_APPROVAL, handleDecision as the only decision maker).
- `/อนุมัติ` without number: list (max 10) of HR requests of the tenant the user may decide (canApprove, as handlePendingApprovals): PENDING within 30 min first
  (oldest first, message-action buttons `/อนุมัติ <number>`), then PENDING past 30 min marked "ต้องอนุมัติในเว็บ", then those decided in the last 30 minutes with ✅/❌.
- `/อนุมัติ <number>` and `/ไม่อนุมัติ <number> [reason]`: show number, module label, requester, description, amount if >0, company, minutes left, then
  "ต้องการ(ไม่)อนุมัติ <number> จริงหรือไม่ ตอบ /ใช่ หรือ /ไม่ใช่". Store ONE row per LINE user in line_pending_tasks (type 'hr_approve' | 'hr_reject', tenant_id = request tenant,
  title = request id, description = reason, expires_at = created_at + 30 min, ISO); a new question replaces the old one (same transaction).
  The existing task/menu confirm code must never pick these rows up.
- `/ใช่`: take the row (delete it first, so it runs once), re-check 30 minutes and status, decide via the shared helper, reply with the result. No row or expired → say so.
  `/ไม่ใช่`: drop the row, "ยกเลิกแล้ว คำขอยังรออยู่". `/ใช่` `/ไม่ใช่` from someone with no row = normal flow of today (only these exact words, with the slash).
- Reject reason goes to the comment ("ทาง LINE: <reason>").
- request_number is NOT unique across companies (verified live). Member: own tenant. Floating Master: any tenant; more than one match → buttons `/อนุมัติ <number> tenant <id>`, never guess.
  Demo Master: refused.
- Never reveal a request the user may not decide: same answer as "ไม่พบคำขอนี้".

## B. /สินค้า <name>
- Who: role MASTER/ADMIN/OWNER, or users.departments contains IT, PURCHASE, SALES, STOCK or PRODUCTION. Others: "🔒 สำหรับ..." refusal, no data.
  Tenant = resolved tenant (Master: view_tenant_id). Purchase prices are sensitive: private chat only.
- Match, status != 'INACTIVE', by name, sku (exact) and stock_item_aliases.name (only if company_settings.stock_alias_enabled is not 0). normName first.
  Score = 1 if the text contains the query, else shared character bigrams / query bigrams (multiset, so typos and partial names work). Keep score >= 0.8, best 10, shorter name first on ties.
  Query shorter than 2 characters → ask for more. 0 → "ไม่พบสินค้า". 1 → history. >1 → message-action buttons sending `/สินค้า sku <SKU>` (label = name, ≤20 chars; several names repeat, SKU is unique per tenant).
- History function getItemHistory(tenantId, stockItemId) in stockCostBasis.service.ts, read only:
  BUY rows: goods_receipts CONFIRMED, date = receipt_date (NOT the movement date: it differs on 276 of 1029 live rows, up to 95 days), doc = gr_number, supplier,
  qty = accepted_qty in poi.unit, price = poi.unit_price per poi.unit. Item = COALESCE(gri.stock_item_id, gri.material_id). Do not drop rows without stock_qty.
  SELL rows: sales_orders not CANCELLED and not DRAFT (date, so_number, customer, qty, unit, unit_price); POS = pos_stock_deductions not returned, summed per Thai day, qty only, price null (POS stores no ingredient price).
- Card: item name, SKU, quantity on hand + unit, then 10 lines newest first: up to 5 buy + 5 sell; if one side has fewer, fill with the other.
  Each line: date (d/m/yy), 🟢ซื้อ or 🔴ขาย, qty unit, ฿price/unit or "ไม่มีราคา", and doc + supplier/customer (small). Never invent a price. Note once "ราคาตามเอกสาร อาจรวมหรือไม่รวม VAT". No cost/profit.
- Tests must cover: every department allowed/denied, Master/Admin, other tenant's items invisible, group silent, typo match, duplicate names, alias on/off, receipt_date vs created_at, DRAFT/CANCELLED excluded,
  GR linked only by material_id, row without stock_qty, POS per-day sum, 5+5 fill; for A: 29 vs 31 minutes (command and button), /ใช่ twice, two users' rows separate, permission, same number in two tenants, reject reason, non-HR module refused, task/menu confirm untouched.
