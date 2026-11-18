# SO make-to-order (ผลิตอัตโนมัติจากใบขาย) — contract, 2026-11-18

## Owner's goal (bedding factory, tenant_msqy2xbn)
Finished goods have no stock, so confirming a Sales Order (SO) fails "สต็อกไม่เพียงพอ".
Wanted flow:
1. User confirms SO. If finished goods are short, the system offers to produce the shortfall.
2. It explodes each product's ACTIVE BOM (including semi-finished child BOMs) and checks RAW MATERIAL stock is enough.
3. If enough, the user confirms "สั่งผลิตและยืนยันใบขาย": the system creates one Work Order (WO, ใบสั่งผลิต) per short product, LINKED to the SO, and runs it through the normal process to the end in one go
   (DRAFT → PLANNED → IN_PROGRESS [raw materials deducted] → COMPLETED [finished goods added, cost settled]).
   The WO must appear in the production module (WorkOrders page) with the normal statuses/stock movements, exactly as if done by hand.
4. Then the SO confirm runs as usual (approval gate, stock deduction, etc. unchanged) and the SO continues its normal process.

## Backend (session mto-backend) — files it owns
- NEW backend/src/services/workOrderTransition.service.ts
  - Move the body of `PUT /work-orders/:id/status` (backend/src/routes/workOrder.routes.ts lines ~224-440) into
    `transitionWorkOrder(tenantId: string, woId: string, toStatus: string, actor: { email: string; role: string; isMaster: boolean }, opts?: { notify?: boolean }): any /* updated WO row */`
    which throws `WorkOrderTransitionError` (class with `status: number` (400/403/404) and `message`) instead of writing responses.
    Behaviour MUST stay identical (sequence check workOrderStatusError, RBAC WO_PRIVILEGED_ROLES, unit conversion, auto-unpack, allow_negative_stock, QC gate resolveWorkOrderCompletion, settleWorkOrderCost, cancel restock, LINE notify when opts.notify !== false).
    The route becomes a thin wrapper. Same for creation: extract `createWorkOrder(tenantId, input)` from `POST /work-orders` (keeps validation, resolveStockItemId, WO number, unit fallback, materials insert); route calls it.
- Migration: add `work_orders.sales_order_id TEXT` (follow the existing `ALTER TABLE ... ADD COLUMN` pattern in backend/src/db/migrations.ts, guarded so it runs once; also add to CREATE TABLE in backend/src/db/schema.ts).
- NEW backend/src/services/salesOrderProduction.service.ts
  - `planSalesOrderProduction(tenantId, soId)` returns
    ```ts
    { ok: boolean,
      allowNegativeStock: boolean,
      items: Array<{ soItemId: string; stockItemId: string; name: string; unit: string /* product stock base unit */;
                     orderedQty: number; stockQty: number; shortQty: number; produceQty: number /* ceil(shortQty) */;
                     bomId: string | null; problem: string | null }>,          // only lines that are short
      materials: Array<{ materialId: string; name: string; unit: string /* material stock unit */;
                         requiredQty: number; stockQty: number; shortQty: number; problem: string | null }>,
      blockers: string[] }   // Thai messages; ok === (blockers.length === 0)
    ```
    - Shortage per SO line must use the SAME logic as the SO confirm stock check in backend/src/routes/sales/salesOrders.ts (~line 420-485: unit conversion to base unit, sealed packs, service items skipped). Extract that check into a shared exported helper and use it in both places — do not duplicate.
    - BOM choice: ACTIVE bom with boms.product_id = stock item (if several, the most recently updated). No ACTIVE BOM → problem 'ไม่มีสูตรการผลิต (BOM) ที่ใช้งาน' and a blocker.
    - Explode with the existing recursive helper `getBomIngredientsRecursive` in backend/src/services/pos-stock.service.ts if it fits (scale by produceQty / bom.output_qty); semi-finished child BOMs explode to their raw materials.
    - Sum material requirements across all products, convert to each material's stock unit with `convertQuantityBidirectional(qty, fromUnit, toUnit, tenantId, materialId)`; no conversion → problem 'ไม่มีการแปลงหน่วย X → Y' + blocker. Count sealed packs like the SO check. Short material → blocker unless allowNegativeStock.
  - `produceForSalesOrder(tenantId, soId, actor)` → re-plans; if !ok throw WorkOrderTransitionError(400, blockers.join(' · ')).
    In ONE db.transaction: for each item create WO via createWorkOrder (bomId, productName, quantity=produceQty, unit=item.unit, sales_order_id=soId, notes `ผลิตอัตโนมัติจากใบขาย ${so_number}`, materials = that product's exploded materials in BOM units like the WorkOrders page sends), then transitionWorkOrder through PLANNED, IN_PROGRESS, COMPLETED with `notify: false` (no LINE pushes — central LINE quota is only 300/month). Any failure rolls back everything. Returns `{ workOrders: Array<{ id, wo_number, product_name, quantity, status }> }`.
    SO must be DRAFT (or the status from which confirm is allowed); otherwise 400.
- Routes in backend/src/routes/sales/salesOrders.ts:
  - `GET  /api/sales-orders/:id/production-plan` → `{ success: true, data: Plan }`
  - `POST /api/sales-orders/:id/produce-shortfall` → `{ success: true, data: { workOrders } }`; RBAC: MASTER or role in WO_PRIVILEGED_ROLES, else 403 Thai message.
  - `GET /api/sales-orders/:id` additionally returns `work_orders: Array<{ id, wo_number, status, quantity, product_name, completed_date }>` linked by sales_order_id.
  - When confirm fails for stock, keep the existing 400 message but add `code: 'INSUFFICIENT_STOCK'` to the JSON.
- `GET /api/work-orders` and `GET /api/work-orders/:id` add `sales_order_id` and `so_number` (LEFT JOIN sales_orders).
- MCP backend/src/mcp/tools/production.ts: if it duplicates the status logic, switch it to transitionWorkOrder only if trivial; otherwise leave it and say so.
- Tests (vitest, backend/src/services/salesOrderProduction.test.ts): see "Done".

## Frontend (session mto-frontend) — files it owns
- frontend/src/pages/Sales.tsx (+ a NEW component frontend/src/components/sales/ProduceShortfallDialog.tsx)
  - When confirming an SO (DRAFT → CONFIRMED) returns 400 with `code === 'INSUFFICIENT_STOCK'`, open ProduceShortfallDialog instead of only a toast.
  - Dialog loads `GET /sales-orders/:id/production-plan`; shows two tables (Thai UI):
    "สินค้าที่ต้องผลิต" (name, สั่ง, มีในสต็อก, ต้องผลิต, unit, problem) and "วัตถุดิบที่ต้องใช้" (name, ต้องใช้, มีในสต็อก, ขาด, unit, problem), status chip พอ / ไม่พอ.
    Blockers listed at top in a warning box (use the app's warning tokens: bg-[var(--warning-soft)] text-[var(--warning-strong)]).
  - Button "สั่งผลิตและยืนยันใบขาย" enabled only when plan.ok → `POST /sales-orders/:id/produce-shortfall` then re-send the SAME confirm request the page already uses; toast success listing WO numbers; refresh list/detail. If confirm then goes to approval (202 pending_approval), show that message as the page already does.
  - SO detail view: section "ใบสั่งผลิตที่เชื่อมกับใบขายนี้" listing `work_orders` (wo_number, product, qty, status) when non-empty.
- frontend/src/pages/WorkOrders.tsx: show `so_number` (e.g. small badge "จาก SO-2026-00012") in the list row and detail when present.
- Use the existing api client and toast like the surrounding code. No new dependencies. Thai copy.

## Done
- Backend tests: (1) SO with finished product short, BOM with 2 raw materials (one needing unit conversion e.g. in2 → m via a material rule) and one semi-finished child BOM: plan.ok true → produce → WO COMPLETED with sales_order_id, raw OUT + FG IN stock_movements referencing `WO: <number>`, then SO confirm passes. (2) raw material short → plan.ok false, produce 400, nothing written (no WO rows, stock unchanged). (3) product with no BOM → blocker. (4) existing work order tests still pass unchanged.
- Frontend: tsc clean; a small vitest for ProduceShortfallDialog rendering blockers and enabling the button only when ok.
