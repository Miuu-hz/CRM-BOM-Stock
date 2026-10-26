import db from '../../db/sqlite'
import { IMcpServer } from '../sdk-compat'
import { z } from 'zod'

export const ERP_INSTRUCTIONS = `Phopy Mini-ERP (Thai SME). The server re-validates every call; an error message tells you what to fix, so fix that instead of retrying the same call. Reply to users in their language.
1. Resolve real ids before creating or binding: \`search\` for stock items/BOMs/customers, \`get_suppliers\` for suppliers. Never guess by name. If a result returns candidates ("ตัวเลือก"/ambiguous), ask the user which one; never pick for them.
2. Any unit other than the item's base unit needs a conversion rule. On "ไม่พบการแปลงหน่วย", run \`check_unit_issues\`, ask the user for the factor, then \`manage_unit_conversion\`. Never guess factors.
3. Purchase lines that are not inventory (consumables, packaging, fuel, services) need \`skipStock: true\` + \`expenseAccountCode\`, or the PO cannot be submitted.
4. Stock moves only through documents: in = PO → goods receipt (GR), out = sales/production. \`record_stock_movement\` is for counted adjustments; its quantity is the new total, not a delta.
5. Documents you create are drafts behind approval gates. "ส่งคำขออนุมัติแล้ว" means nothing changed yet; it waits for an approver in the web app. Do not work around it.
6. Sales: you can only create quotations; sales invoices and customer payments are done in the web app. Purchase invoices come only from confirmed GRs. Closed accounting periods reject back-dated entries.
7. A tool you cannot see is a permission boundary (e.g. trial balance/ledger are MASTER/ADMIN only). Tell the user; do not substitute another tool.
8. Dates are YYYY-MM-DD, Gregorian year.
Before multi-step work in an area, call \`get_erp_guide(topic)\` for its call order and pitfalls.`

export const GUIDE_TOPICS: Record<string, string> = {
  overview: `(a) Area tools:
- search(...): find stock items, BOMs, and customers using DB-anchored retrieval
- summary: get_summary(...), get_sales(...), get_orders(...)
- purchase: create_purchase_request(...), update_purchase_request(...), approve_purchase_request(...), reject_purchase_request(...), get_purchase_requests(...), convert_pr_to_po(...), create_draft_po(...), update_purchase_order(...), update_po_status(...), create_goods_receipt(...), confirm_goods_receipt(...), get_suppliers(...), attach_document_evidence(...)
- binding: bind_document_item(...)
- purchase_billing: create_purchase_invoice(...), edit_purchase_invoice(...), pay_supplier(...), complete_purchase_bill(...)
- stock: record_stock_movement(...), manage_unit_conversion(...), check_unit_issues(...), get_stock_movements(...), set_product_image(...)
- sales: create_quotation(...), get_sales_orders(...)
- production_bom: create_bom(...), explode_bom(...), create_work_order(...), update_work_order_status(...)
- finance: get_ar_aging(...), get_ap_aging(...), get_financial_summary(...), get_trial_balance(...), get_ledger(...)
- crm: get_customer_insights(...), get_quotations(...), get_lead_source_performance(...)
- marketing: list_marketing_shops(...)
- platform_month: platform_submit_file(...), platform_month_status(...), platform_propose_sku_mapping(...)
- guide: get_erp_guide(...)
(b) Role & scope gating:
- Cashiers: cashier-only roles use POS; MCP registers zero tools.
- Basic user: finance and platform_month tools are completely suppressed.
- Readonly scope (mcp_scope='readonly'): only read-only allowlist tools are exposed; all write tools are omitted.
- Master / Admin: master API key bypasses readonly; get_trial_balance(...) and get_ledger(...) require MASTER or ADMIN role.
(c) How search(...) works:
- Uses SQLite database vocabulary via DB-Anchored Token Intersection.
- Pass natural Thai queries directly to search(...); do not extract keywords manually.
- Always resolve real entity IDs (stock item, BOM, customer, supplier) before calling write tools.
(d) Pitfalls & fixes:
- Ambiguous query results: when search(...) returns multiple candidates, prompt user to select; never guess.
- Missing tools: if a tool is not visible, it indicates a permission or scope boundary; never substitute unrelated tools.`,

  purchase: `(a) Area tools:
- create_purchase_request(...): draft a new purchase request (PR).
- update_purchase_request(...): modify PR details or replace items while DRAFT or PENDING.
- approve_purchase_request(...): approve PR (DRAFT/PENDING -> APPROVED).
- reject_purchase_request(...): reject PR (DRAFT/PENDING -> REJECTED).
- get_purchase_requests(...): query PR list filtered by status.
- get_suppliers(...): find supplier by name or code to get supplier_id.
- convert_pr_to_po(...): convert approved PR into draft purchase order (PO).
- create_draft_po(...): create draft PO from line items or uploaded receipt/invoice.
- update_purchase_order(...): edit draft PO lines, date, or supplier.
- update_po_status(...): advance PO status (SUBMITTED, APPROVED, CANCELLED).
- bind_document_item(...): inspect and link document line items to stock items.
- create_goods_receipt(...): create draft goods receipt (GR) from PO.
- confirm_goods_receipt(...): confirm receipt, moving goods into inventory.
- attach_document_evidence(...): attach image slip or evidence to document.
(b) Call-order recipes:
- PR to GR: create_purchase_request(...) -> approve_purchase_request(...) -> get_suppliers(...) -> convert_pr_to_po(...) -> update_po_status(...) -> create_goods_receipt(...) -> confirm_goods_receipt(...).
- Direct PO: get_suppliers(...) -> create_draft_po(...) -> (if unbound lines, bind_document_item(...)) -> update_po_status(...) -> create_goods_receipt(...) -> confirm_goods_receipt(...).
(c) Server guards & Thai errors:
- Role & dept: requires purchasing department ("ไม่มีสิทธิ์สร้างใบสั่งซื้อ — ต้องเป็นฝ่ายจัดซื้อ"), receiving requires warehouse/purchase ("ไม่มีสิทธิ์ยืนยันรับสินค้า — ต้องเป็นฝ่ายจัดซื้อ/ฝ่ายคลัง").
- Approval limits: exceeding threshold blocks action ("วงเงินอนุมัติของคุณไม่เพียงพอ").
- Unbound items on submit/approve: rejects if stock lines are unbound without skip_stock ("ส่งอนุมัติ/อนุมัติไม่ได้ — มี X รายการที่รับเข้าคลังไม่ได้").
- Duplicate protection: detects duplicate slips, reference numbers, or identical PO lines ("บิลซ้ำ: ...").
- Non-inventory lines (consumables, services): requires skipStock: true and valid expenseAccountCode.
(d) Pitfalls & fixes:
- Unbound PO lines: inspect via bind_document_item(...) and bind to stock, or set skipStock: true + expenseAccountCode.
- Converting PR without supplier: invoke get_suppliers(...) to obtain supplier_id before convert_pr_to_po(...).
- Closed accounting period: confirm_goods_receipt(...) rejects if period is closed ("งวด ... ปิดแล้ว ยืนยันรับสินค้าวันที่นี้ไม่ได้"); change date to open period.`,

  purchase_billing: `(a) Area tools:
- create_purchase_invoice(...): issue purchase invoice (PI) from confirmed goods receipts (GR).
- edit_purchase_invoice(...): update PI amounts, dates, or vendor invoice number.
- pay_supplier(...): record payment against outstanding purchase invoice.
- complete_purchase_bill(...): execute full pipeline (PO approval -> GR -> PI -> payment) in one step.
(b) Call-order recipes:
- Standard billing: confirm_goods_receipt(...) -> create_purchase_invoice(...) -> pay_supplier(...).
- One-click pipeline: bind document items -> complete_purchase_bill(...) with dry_run=true -> complete_purchase_bill(...) with dry_run=false.
(c) Server guards & Thai errors:
- Billing roles: requires accounting, purchasing, or admin ("ไม่มีสิทธิ์ออกใบแจ้งหนี้ซื้อ — ต้องอยู่ฝ่ายจัดซื้อ/ฝ่ายบัญชี หรือเป็น ADMIN/MASTER", "ไม่มีสิทธิ์จ่ายเงินผู้ขาย").
- Unconfirmed GR: cannot bill unconfirmed GR ("ต้องยืนยันรับของ (GR) ก่อนออกใบแจ้งหนี้ — ใบแจ้งหนี้ออกจากของที่รับจริงเท่านั้น", "ใบรับสินค้า ... ต้องยืนยันแล้วก่อนสร้างใบแจ้งหนี้").
- Invoiced GR reuse: cannot bill same GR twice ("ใบรับสินค้า ... ถูกใช้สร้างใบแจ้งหนี้ไปแล้ว").
- Mixed vendors or tax: cannot combine GRs from different tax entities or differing VAT treatments ("ใบรับสินค้า ... เป็นของผู้ขายคนละราย รวมเข้าบิลเดียวกันไม่ได้").
- Duplicate vendor invoice: rejects duplicate vendor invoice number ("เลขที่ใบแจ้งหนี้/ใบกำกับภาษีผู้ขาย ... ซ้ำกับใบแจ้งหนี้ซื้อ ...").
- Closed period: rejects posting in closed period ("งวด ... ปิดแล้ว บันทึกใบแจ้งหนี้วันที่นี้ไม่ได้", "งวด ... ปิดแล้ว บันทึกการจ่ายเงินวันที่นี้ไม่ได้").
- Overpayment: payment cannot exceed invoice balance ("Payment amount exceeds invoice balance").
(d) Pitfalls & fixes:
- Invoicing directly from PO: always create and confirm GR via confirm_goods_receipt(...) before create_purchase_invoice(...).
- Changing GRs on invoice: edit_purchase_invoice(...) cannot re-link GRs; cancel invoice and create a new one.
- Withholding tax: in pay_supplier(...), amount is the gross amount settled INCLUDING the withholding tax (cash paid + WHT), and withholding_tax is the WHT part. Example: pay 5,000 with 150 WHT -> amount=5000, withholding_tax=150 (cash out 4,850).`,

  stock_units: `(a) Area tools:
- record_stock_movement(...): adjust physical stock balance to actual counted quantity (ADJUST).
- manage_unit_conversion(...): create, update, or delete unit conversion factors.
- check_unit_issues(...): find document unit pairs lacking conversion factors.
- get_stock_movements(...): view historical stock movement audit trail.
- set_product_image(...): assign or remove product image URL.
(b) 3-tier units rule:
- Three tiers: Purchase unit (bottle/tank/pack on POs, priced per unit) -> Base unit (ml/g/m/pcs, stock is deducted and costed in it) -> BOM usage unit (tsp/scoop/g on production recipes).
- Conversion rules: joined by manage_unit_conversion(...); a per-item rule beats a global rule; a global 1 ml ≈ 1 g cooking rule exists, so dense liquids need a per-item rule.
(c) Call-order recipes:
- Missing unit conversion: check_unit_issues(...) -> ask user for factor -> manage_unit_conversion(...) with action="create".
- Physical stock adjustment: search(...) -> get item ID -> record_stock_movement(...) with actual counted quantity.
(d) Server guards & Thai errors:
- Movement types: IN and OUT are strictly rejected ("เครื่องมือนี้ปรับยอดสต็อกได้อย่างเดียว — รับของเข้าให้ทำผ่านใบสั่งซื้อ/ใบรับสินค้า ตัดของออกให้ทำผ่านใบขายหรือใบสั่งผลิต").
- Absolute count semantics: quantity in record_stock_movement(...) is the new physical total, never a delta.
- Approval threshold: large adjustment values trigger approval gate ("ส่งคำขออนุมัติแล้ว ... สต็อกจะเปลี่ยนเมื่อผู้อนุมัติยืนยัน").
- Image constraints: URL must use http:// or https://, end with .jpg/.png/.webp/.gif, and product must match exactly.
(e) Pitfalls & fixes:
- Passing deltas or IN/OUT: record_stock_movement(...) accepts only absolute counted totals; receive incoming stock via confirm_goods_receipt(...).
- Ambiguous product in set_product_image(...): search(...) first to find unique SKU, then pass SKU to set_product_image(...).`,

  sales: `(a) Area tools:
- create_quotation(...): create draft sales quotation (QT).
- get_sales_orders(...): list sales orders (SO) filtered by status and count.
(b) Sales scope boundary:
- Quotations only: create_quotation(...) is the ONLY sales document an AI client can create.
- Web app operations: converting quotations into sales orders, generating sales invoices, and collecting payments must be completed in the web app, as they deduct stock and post to financial ledgers.
(c) Call-order recipe:
- search(...) (find finished goods and customer) -> create_quotation(...) -> review with user -> customer confirms in web app.
(d) Server guards & Thai errors:
- VAT registration: cannot quote tax if business is not VAT-registered ("กิจการยังไม่จดทะเบียน VAT — ขายแบบมี VAT ไม่ได้").
- Non-sellable items: raw materials and WIP cannot be sold ("เป็นสินค้าหมวด ... ขายไม่ได้ — ขายได้เฉพาะสินค้าสำเร็จรูป/กึ่งสำเร็จรูป/บริการ").
- Unmatched item pricing: unlinked free-text items require explicit unitPrice ("ไม่ได้ผูกกับสินค้าในสต็อก ต้องระบุ unitPrice เอง").
- Missing conversion rule: line unit differing from base unit without conversion requires explicit unitPrice ("ไม่มีกฎแปลงหน่วย ... คิดราคาต่อ ... ให้ไม่ได้ ต้องระบุ unitPrice เอง").
(e) Pitfalls & fixes:
- Requesting sales invoice tools: explain that ERP safety controls restrict sales invoices and receipts to the web app.
- Quoting raw materials: filter search(...) with stock_type="finished" before calling create_quotation(...).
- Missing unit prices: provide unitPrice for custom items not present in the inventory catalog.`,

  production_bom: `(a) Area tools:
- create_bom(...): create draft bill of materials (BOM) with raw material items.
- explode_bom(...): calculate flattened multi-level raw material requirements by multiplier.
- create_work_order(...): create draft work order (WO) referencing a product and BOM.
- update_work_order_status(...): change WO status (PLANNED, IN_PROGRESS, COMPLETED, CANCELLED).
(b) Call-order recipes:
- Production lifecycle: search(...) (find product and materials) -> create_bom(...) -> create_work_order(...) -> update_work_order_status(...) (PLANNED) -> update_work_order_status(...) (IN_PROGRESS) -> update_work_order_status(...) (COMPLETED).
- Material planning: search(...) (find BOM) -> explode_bom(...) with multiplier to verify inventory before ordering.
(c) Server guards & Thai errors:
- Status sequence: must follow DRAFT -> PLANNED -> IN_PROGRESS -> COMPLETED; jumping states is rejected ("ไม่สามารถเปลี่ยนสถานะจาก ... เป็น ... ได้").
- Material deduction: setting IN_PROGRESS auto-deducts materials and rejects on stock shortage ("สต็อกไม่พอสำหรับ ...") or missing conversion ("ไม่พบการแปลงหน่วย ...").
- QC gate on completion: if QC gate is active, closing requires a passed inspection ("ต้องผ่านการตรวจ QC ก่อนปิดใบสั่งงาน"). Missing finished unit conversion blocks completion.
- Role permissions: closing or cancelling requires manager role ("ไม่มีสิทธิ์ยกเลิก/ปิดใบสั่งผลิต — ต้องเป็น ADMIN/MANAGER/MASTER/POWERUSER").
(d) Pitfalls & fixes:
- Skipping PLANNED state: always advance DRAFT to PLANNED before calling IN_PROGRESS in update_work_order_status(...).
- Duplicate BOM version: specify a new version string (e.g. "v2") if "v1" already exists ("BOM สำหรับ ... มีอยู่แล้ว").
- Material IDs: supply stock item IDs from search(...), not raw ingredient names.`,

  finance: `(a) Area tools:
- get_ar_aging(...): accounts receivable aging breakdown by customer and overdue days.
- get_ap_aging(...): accounts payable aging breakdown by supplier and overdue days.
- get_financial_summary(...): billed revenue, purchase spend, unpaid AR/AP balances, and net cash flow.
- get_trial_balance(...): trial balance debit/credit opening, period movements, and ending balances.
- get_ledger(...): general ledger transactions and running balance for a specific account code.
(b) Role & permission gating:
- Basic users cannot access any finance tools.
- get_trial_balance(...) and get_ledger(...) are restricted to MASTER and ADMIN roles.
(c) Call-order recipes:
- Aging inspection: get_ar_aging(...) (or get_ap_aging(...)) with overdue_only=true -> inspect overdue documents.
- General ledger audit: get_trial_balance(...) (find account discrepancy) -> get_ledger(...) (inspect entries for account_code).
(d) Server guards & Thai errors:
- Account existence: querying non-existent account code returns error ("ไม่พบรหัสบัญชี ...").
- Date format: start_date and end_date require YYYY-MM-DD Gregorian calendar format.
(e) Pitfalls & fixes:
- Misinterpreting net cash flow: net_cash_flow in get_financial_summary(...) reflects cash collected minus cash paid, not net profit.
- Period selection: period="30d" is a rolling 30-day window; use period="mtd" for current calendar month.
- Permission boundaries: if get_trial_balance(...) is hidden, caller lacks MASTER/ADMIN privileges.`,

  crm: `(a) Area tools:
- get_customer_insights(...): customer intelligence in dormant mode (inactive accounts) or profile mode (briefing before visit).
- get_quotations(...): list quotations with status, expiry warnings, and monthly totals.
- get_lead_source_performance(...): conversion win rate, pipeline value, and revenue by campaign or channel.
(b) Call-order recipes:
- Customer briefing: get_customer_insights(...) (mode="profile", customer="name/code") -> if ambiguous, pick ID -> review spend and pending quotations.
- Marketing audit: get_lead_source_performance(...) (group_by="campaign", period="all") -> compare win rates and closed revenue.
(c) Server guards & Thai errors:
- Profile target required: mode="profile" without customer fails ("ต้องระบุ customer (รหัส/ชื่อ/id ลูกค้า) เมื่อ mode=profile").
- Ambiguity guard: multiple matches return ambiguous=true with candidate list; never auto-select candidates.
(d) Pitfalls & fixes:
- Ambiguous customer name: prompt user to choose from candidates, then recall get_customer_insights(...) with exact ID.
- Quotation default filters: get_quotations(...) defaults to open quotations in current month; pass status="all" and month="all" for full history.`,

  platform_month: `(a) Area tools:
- list_marketing_shops(...): list registered e-commerce shops across SHOPEE, LAZADA, TIKTOK, and FACEBOOK.
- platform_submit_file(...): submit monthly reconciliation files (income, balance, products, ads, stats, orders).
- platform_month_status(...): check file submission status and cross-file reconciliation equation results.
- platform_propose_sku_mapping(...): propose warehouse SKU mappings for platform product variants.
(b) Call-order recipes:
- Monthly reconciliation: list_marketing_shops(...) -> platform_month_status(...) (identify missing files) -> platform_submit_file(...) for all 6 files -> platform_month_status(...) (verify balanced equations) -> platform_propose_sku_mapping(...) (propose SKU links).
(c) Server guards & Thai errors:
- Basic user gating: suppressed for basic users.
- Closed month: cannot submit or modify after closing ("รอบเดือนนี้ปิดแล้ว (status = ...) ส่งไฟล์เพิ่ม/แก้ไม่ได้").
- Calendar boundaries: dates outside the target month are rejected ("วันที่อยู่นอกช่วงรอบเดือน").
- Submission order: platform_propose_sku_mapping(...) requires products file first ("ไม่พบรอบเดือนนี้ — ส่งไฟล์ products เข้ารอบนี้ก่อน"). Unknown SKU throws ("ไม่พบ SKU ... ในคลัง").
(d) Pitfalls & fixes:
- Reversing fee signs: keep Shopee fees negative as reported to balance equations.
- Order row limits: pre-aggregate order rows per variant before calling platform_submit_file(...).
- Deprecated tools: do not look for CSV uploaders; use platform_submit_file(...).`
}

const TOPICS = Object.keys(GUIDE_TOPICS) as [string, ...string[]]

export function registerGuideTool(server: IMcpServer, tenantId: string): void {
  server.tool(
    'get_erp_guide',
    `Get the ERP workflow guide (call order, server guards, pitfalls) for one area. Topics: ${TOPICS.join(', ')}`,
    { topic: z.enum(TOPICS) },
    async ({ topic }) => {
      let text = GUIDE_TOPICS[topic]
      // expenseAccountCode ต้องเป็นบัญชี EXPENSE ของกิจการนี้ (เงื่อนไขเดียวกับที่ create_draft_po ใช้ตรวจ) — ให้ดูรหัสจริงแทนการเดา
      if (topic === 'purchase' || topic === 'purchase_billing') {
        const rows = db.prepare("SELECT code, name FROM accounts WHERE tenant_id = ? AND type = 'EXPENSE' ORDER BY code LIMIT 80")
          .all(tenantId) as { code: string; name: string }[]
        text += '\n\nExpense accounts usable as expenseAccountCode:\n' + (rows.length ? rows.map(r => `${r.code} ${r.name}`).join('\n') : '(none set up for this business)')
      }
      return { content: [{ type: 'text', text }] }
    }
  )
}
