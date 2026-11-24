# Contract: LINE `/สรุป` EOS Shift Cards (incl. Live Open Shift) + `/สินค้า` Recipe Ingredient Prices

## Goal
- **A)** Make `/สรุป` (`วันนี้` / `เมื่อวาน`) reply with the exact same EOS shift summary card (`shiftCloseCard` from `buildShiftSummary`) that executives receive on shift close — one card per `CLOSED` shift on that Thai day plus, for `วันนี้`, any `OPEN` shift shown live (without counted cash or shortage). Reuse the shift cash/sales formula extracted from `pos.routes.ts`. Respect `company_settings.line_shift_expense_groups = 0` in groups by falling back to the current POS card (`buildPosCard`). Always show the platform/delivery section on `shiftCloseCard`. Keep `/สรุป เดือนนี้` and `/pos` on `buildPosCard`, and keep `สรุปการปิดกะ` behaviour while sharing code. Update `/คำสั่ง` and bind-success texts describing `/สรุป`.
- **B)** In `/สินค้า`, when an item has no confirmed goods receipt (`buys.length === 0`) and is made from a recipe (BOM), show a recipe ingredients section (max 15 + `และอีก N รายการ`) with each ingredient's latest confirmed GR receipt date and price per purchase unit (same source/rules as `getItemHistory` buys), or `ไม่มีใบรับซื้อ` when none. Hide `"ไม่มีใบรับซื้อของรายการนี้ จึงไม่มีราคาซื้อ"` when the recipe section is shown; keep it when the item has neither.

## Baseline
Commit `50d17648dbefa88a060eb3d381bf9d62de2373e8` in `/root/review/crm-1124-line`.

## Targets
- **Modify** `backend/src/services/posShiftSummary.service.ts`
- **Modify** `backend/src/routes/sales/pos.routes.ts`
- **Modify** `backend/src/services/stockCostBasis.service.ts`
- **Modify** `backend/src/services/line-flex-templates.ts`
- **Modify** `backend/src/services/line-bot.service.ts`
- **Create** `backend/src/services/lineShiftRecipeSummary.test.ts`
- **Modify** (only if an existing assertion fails due to intentional spec changes): `backend/src/services/lineMasterCommands.test.ts`, `backend/src/services/posShiftSummary.service.test.ts`

## Do not touch
- Accounting / journal posting (`accounting.service.ts`, `pos-accounting.service.ts`, `posShiftRepair.service.ts`, journal lines in `pos.routes.ts`)
- Shift close DB writes (`UPDATE pos_shifts ...` and `pos_shift_cash_movements` inserts in `pos.routes.ts`)
- HR approval code (`handleHrApprovalCommand`, `decideApprovalInChat`, `approval.routes.ts`)
- Push / quota code (`claimPush`, `pushQuotaLeft`, `notifyShiftClosed` push loop, `sendExecDigests`)
- Frontend (`frontend/`), `/opt/crm`, `db/schema.ts`, `db/migrations.ts`, `package.json`
- Unrelated bugs or dead code noticed elsewhere

## Done when
- `cd /root/review/crm-1124-line/backend && npm run build` (`tsc`) exits 0 with no errors.
- `cd /root/review/crm-1124-line/backend && npm test` (`vitest run`) passes 100%, including all new test cases in `lineShiftRecipeSummary.test.ts`.
- All answers for `/สรุป`, `สรุปการปิดกะ`, and `/สินค้า` use `replyMessage` only (never `pushMessage`).

## Constraints
- No new dependencies, no schema/migration changes.
- Tenant-scoped SQL everywhere (`tenant_id = ?` on every table lookup).
- Never copy the shift cash/sales calculation from `pos.routes.ts` — extract and reuse it; closing a shift must write and post the exact same values as before.
- Single builder (`buildShiftSummary`) + single card (`flexTemplates.shiftCloseCard`) for both executive shift-close notifications and `/สรุป` / `สรุปการปิดกะ`.
- On an `OPEN` shift card, counted cash and difference must NEVER render as `0`, `฿0`, `ขาด`, `เกิน`, or `ตรงพอดี`.
- On `/สินค้า`, never show recipe quantity/unit, never show cost (`ต้นทุน`) or profit (`กำไร`).
- Clean up all test DB rows created in tests (`afterEach`).

## Steps

### Part A — Shared Shift Formula, Live Open Shift Summary, Always-On Platform Section, `/สรุป` Routing

- [ ] 1. **Extract shift sales & cash helpers into `backend/src/services/posShiftSummary.service.ts`**:
  - Move and export from `posShiftSummary.service.ts`:
    - `export function getShiftCashMovementTotals(tenantId: string, shiftId: string): { cashIn: number; paidOut: number }` (exact SQL from `pos.routes.ts:48-56`: `COALESCE(SUM(CASE WHEN type = 'CASH_IN' THEN amount ELSE 0 END), 0)` and `PAID_OUT` from `pos_shift_cash_movements WHERE tenant_id = ? AND shift_id = ?`).
    - `export function getShiftSalesSummary(tenantId: string, shift: { id: string; opened_at: string }): { bill_count: number; total_revenue: number; cash_revenue: number; bank_revenue: number }` (exact SQL from `pos.routes.ts:85-101`).
    - `export function calcShiftExpectedCash(openingCash: number, cashRevenue: number, cashIn: number, paidOut: number): number` returning `r2((Number(openingCash) || 0) + (Number(cashRevenue) || 0) + (Number(cashIn) || 0) - (Number(paidOut) || 0))`.
  - In `backend/src/routes/sales/pos.routes.ts`:
    - Update line 10 import to `import { buildShiftSummary, getShiftCashMovementTotals, getShiftSalesSummary, calcShiftExpectedCash } from '../../services/posShiftSummary.service'`.
    - Delete the local `getShiftCashMovementTotals` (lines 48-56) and `getShiftSalesSummary` (lines 85-101).
    - Replace line 702 with `expectedCash = calcShiftExpectedCash(shift.opening_cash || 0, sales.cash_revenue || 0, movements.cashIn, movements.paidOut)`.
    - Leave all other lines in `pos.routes.ts` untouched.

- [ ] 2. **Support live `OPEN` shifts in `buildShiftSummary` (`backend/src/services/posShiftSummary.service.ts`)**:
  - Update `ShiftSummary` interface:
    - Add `status?: 'OPEN' | 'CLOSED'`
    - Add `openedByName?: string`
    - Change `closedAt: string | null`, `countedCash: number | null`, `difference: number | null`.
  - Update `buildShiftSummary(tenantId: string, shiftId: string): ShiftSummary | null`:
    - Query:
      ```sql
      SELECT s.*, uc.name AS closed_by_name, uo.name AS opened_by_name
      FROM pos_shifts s
      LEFT JOIN users uc ON uc.id = s.closed_by
      LEFT JOIN users uo ON uo.id = s.opened_by
      WHERE s.id = ? AND s.tenant_id = ? AND s.status IN ('CLOSED', 'OPEN')
      ```
    - Determine `const isOpen = s.status === 'OPEN'` and `const endAt: string = isOpen ? new Date().toISOString() : s.closed_at`.
    - Use `endAt` everywhere `s.closed_at` was previously used for date ranges (`toDate = thaiDateStr(endAt)`, `po.approved_at BETWEEN s.opened_at AND endAt`, `approval_requests.created_at BETWEEN s.opened_at AND endAt`, and the `b.shift_id IS NULL AND b.closed_at BETWEEN s.opened_at AND endAt` clauses in `discountBills`, `itemOverrideDiscount`, `deliveryBills`).
    - When `isOpen`:
      - Compute `const sales = getShiftSalesSummary(tenantId, s)` and `const movements = getShiftCashMovementTotals(tenantId, shiftId)`.
      - Set `billCount: sales.bill_count || 0`, `totalRevenue: r2(sales.total_revenue)`, `cashRevenue: r2(sales.cash_revenue)`, `bankRevenue: r2(sales.bank_revenue)`, `expectedCash: calcShiftExpectedCash(s.opening_cash || 0, sales.cash_revenue || 0, movements.cashIn, movements.paidOut)`, `countedCash: null`, `difference: null`, `closedAt: null`, `closedByName: ''`, `openedByName: s.opened_by_name || ''`, `status: 'OPEN'`.
    - When `!isOpen` (`CLOSED`):
      - Keep exact existing fields from `s` (`expectedCash: r2(s.expected_cash)`, `countedCash: r2(s.closing_cash_counted)`, `difference: r2(s.cash_difference)`, etc.), plus `status: 'CLOSED'`, `openedByName: s.opened_by_name || ''`.

- [ ] 3. **Update `flexTemplates.shiftCloseCard` in `backend/src/services/line-flex-templates.ts`**:
  - Update parameter type: `status?: 'OPEN' | 'CLOSED'`, `openedByName?: string`, `closedAt: string | null`, `countedCash: number | null`, `difference: number | null`.
  - Detect open shift: `const isOpen = s.status === 'OPEN' || s.countedCash === null || s.difference === null`.
  - **Header**:
    - Kicker: `isOpen ? '🟢 กะกำลังเปิดอยู่ (ยังไม่ปิดกะ)' : '🔒 ปิดกะแล้ว'`
    - Sub:
      - When `isOpen`: `[s.shopName, \`เปิด \${hhmm(s.openedAt)} – ปัจจุบัน\`, s.openedByName && \`เปิดโดย \${s.openedByName}\`].filter(Boolean).join(' · ')`
      - When closed: keep `[s.shopName, \`\${hhmm(s.openedAt)} – \${hhmm(s.closedAt!)}\`, s.closedByName && \`ปิดโดย \${s.closedByName}\`].filter(Boolean).join(' · ')`
  - **Drawer box**:
    - When `isOpen`:
      - Container background: `C.sand100`
      - Title: `'💰 เงินในลิ้นชัก (ยังไม่ปิดกะ)'`
      - Main text: `\`ควรมี \${baht(s.expectedCash)} · ยังไม่นับ\``
      - Pill: backgroundColor `C.ink500`, text `'⏳ ยังไม่นับ'`
    - When closed: keep exact existing `🔴 ขาด ...` / `🟠 เกิน ...` / `🟢 ตรงพอดี` rendering.
  - **`altText`** (capped at 400 chars):
    - When `isOpen`: `` `🟢 กะเปิดอยู่ ${s.shiftNumber}${s.shopName ? ` · ${s.shopName}` : ''} · ขาย ${baht(s.totalRevenue)} (${s.billCount} บิล)${deliveryText} · ส่วนลดรวม ${baht(s.alerts.discountTotal)} · ควรมีในลิ้นชัก ${baht(s.expectedCash)} (ยังไม่นับ)` ``
    - When closed: keep exact existing `altText`.
  - **Platform / Delivery section** (always shown — affects both exec notifications and `/สรุป`):
    - Replace the conditional `...(deliveryRows.length ? [...] : [])` at lines 1158-1160 with an unconditional call:
      ```ts
      section(
          '🛵 ยอด Delivery / ส่วนลด > 20%',
          deliveryRows.length ? `รวม ${s.deliveryDiscounts!.reduce((t, d) => t + d.count, 0)} บิล` : '0 บิล',
          deliveryRows,
          'ไม่มีรายการแพลตฟอร์มในกะนี้',
      ),
      ```
  - Keep all other sections and footer buttons unchanged.

- [ ] 4. **Unify `/สรุป` and `สรุปการปิดกะ` in `backend/src/services/line-bot.service.ts`**:
  - Add a shared private Thai-day normalizer (or reuse `thaiDateStr` after normalizing space-separated SQLite UTC strings to `...Z` so both `2026-11-23T17:30:00.000Z` and `2026-11-23 17:30:00` map to Thai day `2026-11-24`):
    ```ts
    private toThaiDayStr(ts: string): string {
        const s = String(ts || '').trim()
        const norm = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s) ? `${s.replace(' ', 'T')}Z` : s
        return thaiDateStr(norm)
    }
    ```
  - Add shared private helper:
    ```ts
    private buildShiftSummaryMessages(
        tenantId: string,
        day: string,
        opts: { includeOpen: boolean; emptyText: string; overflowText: (total: number, appUrl: string) => string }
    ): any[]
    ```
    - Query closed shifts for that Thai day:
      ```sql
      SELECT id, closed_at FROM pos_shifts
      WHERE tenant_id = ? AND status = 'CLOSED' AND closed_at IS NOT NULL
        AND closed_at >= date(?, '-1 day') AND closed_at < date(?, '+2 day')
      ORDER BY closed_at ASC, id ASC
      ```
      Filter in JS by `this.toThaiDayStr(r.closed_at) === day`.
    - If `opts.includeOpen`:
      Query open shifts:
      ```sql
      SELECT id FROM pos_shifts
      WHERE tenant_id = ? AND status = 'OPEN'
      ORDER BY opened_at ASC, id ASC
      ```
      Append their IDs after the closed shifts of `day`.
    - If combined shift ID list is empty, return `[{ type: 'text', text: opts.emptyText }]`.
    - LINE max 5 messages per reply:
      - `const appUrl = process.env.APP_URL ?? 'https://erp.phopy.net'`
      - `const total = shiftIds.length`
      - `const shown = total > 5 ? shiftIds.slice(-4) : shiftIds` (keeps latest 4, including live OPEN shift at the end).
      - Map each ID via `buildShiftSummary(tenantId, id)` → `flexTemplates.shiftCloseCard({ ...s, webUrl: appUrl })` (filter null).
      - If `total > 5`, push `{ type: 'text', text: opts.overflowText(total, appUrl) }`.
      - Return messages array (1..5 items).
  - Add shared private helper for `/สรุป` replies (used by both Master and bound-group members):
    ```ts
    private buildSummaryReply(
        tenantId: string,
        period: 'วันนี้' | 'เมื่อวาน' | 'เดือนนี้',
        src: 'user' | 'group' | 'room'
    ): any | any[]
    ```
    - If `period === 'เดือนนี้'` -> return `this.buildPosCard(tenantId, 'เดือนนี้')`.
    - If `src !== 'user' && !this.shiftToGroups(tenantId)` -> return `this.buildPosCard(tenantId, period)`.
    - Otherwise:
      - `const today = thaiToday()`
      - `const day = period === 'เมื่อวาน' ? addDaysStr(today, -1) : today`
      - `const includeOpen = period === 'วันนี้'`
      - Return `this.buildShiftSummaryMessages(tenantId, day, {`
        - `includeOpen,`
        - `emptyText: period === 'เมื่อวาน' ? 'เมื่อวานไม่มีกะที่ปิดครับ' : 'วันนี้ยังไม่มีกะที่เปิดหรือปิดครับ',`
        - `overflowText: (n, appUrl) => \`${period}มีทั้งหมด ${n} กะ (แสดง 4 กะล่าสุด) · ดูทั้งหมดในเว็บ ${appUrl}\`,`
      - `})`
  - Refactor `handleShiftSummaryCommand` (lines 1861-1889) to keep its exact permission checks (`src !== 'user' && !this.shiftToGroups(tenantId)` lock text; `src === 'user' && !['ADMIN', 'MASTER', 'MANAGER'].includes(me?.role)` lock text) and call:
    ```ts
    const messages = this.buildShiftSummaryMessages(tenantId, thaiToday(), {
        includeOpen: false,
        emptyText: 'วันนี้ยังไม่มีกะที่ปิดครับ',
        overflowText: (n, appUrl) => `วันนี้ปิดไปแล้ว ${n} กะ · ดูทั้งหมดในเว็บ ${appUrl}`,
    })
    await client.replyMessage(replyToken, messages)
    ```
  - Update `handleMasterCommand` (lines 928-967):
    - Distinguish `/สรุป` from `/pos`:
      ```ts
      const sumMatch = text.match(/^\/สรุป(?:\s+([\s\S]*))?$/)
      const posMatch = !sumMatch ? text.match(/^\/pos(?:\s+([\s\S]*))?$/i) : null
      const revMatch = !sumMatch && !posMatch ? text.match(/^\/รายได้(?:\s+([\s\S]*))?$/) : null
      ```
    - Set `cmd = sumMatch ? '/สรุป' : posMatch ? '/pos' : '/รายได้'`, default period `'วันนี้'` for `/สรุป` and `/pos` and `'เดือนนี้'` for `/รายได้`.
    - Keep exact company resolution & group-lock logic.
    - Dispatch:
      - `if (sumMatch) await client.replyMessage(replyToken, this.buildSummaryReply(targetId, period, src))`
      - `else if (posMatch) await client.replyMessage(replyToken, this.buildPosCard(targetId, period))`
      - `else` keep existing `/รายได้` branch.
  - Update bound-group member `/สรุป` path (lines 2202-2207):
    - Replace `this.buildPosCard(tenantId, ...)` with `this.buildSummaryReply(tenantId, (sum[1] ?? 'วันนี้') as 'วันนี้' | 'เมื่อวาน' | 'เดือนนี้', src)`.
  - Update `/คำสั่ง` help text and bind-success texts:
    - Line 914: split into two lines:
      - `'/สรุป [วันนี้|เมื่อวาน|เดือนนี้] [tenant <รหัส> หรือชื่อ] — สรุปกะ (ปิดกะ + กะที่เปิดอยู่) · เดือนนี้ดูยอด POS'`
      - `'/pos [วันนี้|เมื่อวาน|เดือนนี้] [tenant <รหัส> หรือชื่อ] — ยอดขาย POS'`
    - Line 918: `'/ผูก pos tenant <รหัส> — ผูกกลุ่ม ให้ทุกคนในกลุ่มพิมพ์ /สรุป ดูสรุปกะ/ยอด POS ได้ (ในกลุ่ม)'`
    - Line 1008 (`/ผูก pos` success): `'💬 ทุกคนในกลุ่มพิมพ์ /สรุป ดูสรุปกะของบริษัทนี้ได้ (ไม่กินโควตา · ต้องเปิดสิทธิ์สรุปปิดกะในกลุ่มที่ตั้งค่า ไม่งั้นแสดงยอด POS)'`
    - Line 807 (`handleGroupLink` success): keep line 1 `✅ ผูกกลุ่มนี้กับ ${companyName(row.tenant_id)} แล้ว` and update line 2 to `ดูสรุปปิดกะได้ในกลุ่มนี้ · ถ้าจะให้กลุ่มพิมพ์ /สรุป ดูสรุปกะ/ยอด POS ให้ Master พิมพ์ /ผูก pos tenant <รหัส>`.

---

### Part B — `/สินค้า` Recipe Ingredients & Latest Purchase Prices

- [ ] 5. **Add recipe ingredient purchase lookup in `backend/src/services/stockCostBasis.service.ts`**:
  - Export interface:
    ```ts
    export interface RecipeIngredientPrice {
      stockItemId: string
      name: string
      sku: string
      date: string | null
      unit: string | null
      price: number | null
    }
    ```
  - Extend `ItemHistory` with `recipeIngredients?: RecipeIngredientPrice[]`.
  - Extract private helper `queryItemBuys(tenantId: string, stockItemId: string, limit: number): ItemHistoryRow[]` using the exact SQL from `getItemHistory` lines 231-243 (with `LIMIT ?`):
    ```sql
    SELECT gr.receipt_date AS date, gr.gr_number AS doc, s.name AS party,
           gri.accepted_qty AS qty, poi.unit AS unit, poi.unit_price AS price
      FROM goods_receipt_items gri
      JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
      LEFT JOIN purchase_order_items poi ON poi.id = gri.purchase_order_item_id
      LEFT JOIN suppliers s ON s.id = gr.supplier_id
     WHERE COALESCE(NULLIF(gri.stock_item_id, ''), gri.material_id) = ?
       AND gr.tenant_id = ?
       AND gr.status = 'CONFIRMED'
     ORDER BY gr.receipt_date DESC, gr.gr_number DESC
     LIMIT ?
    ```
    Use `queryItemBuys(tenantId, stockItemId, 10)` in `getItemHistory`.
  - Add private helper `resolveRecipeBomId(tenantId: string, stockItemId: string): string | null`:
    1. Check menu config first (tenant-scoped and ensuring BOM exists in same tenant):
       ```sql
       SELECT b.id
         FROM pos_menu_configs pmc
         JOIN boms b ON b.id = pmc.bom_id AND b.tenant_id = pmc.tenant_id
        WHERE pmc.tenant_id = ? AND pmc.product_id = ?
          AND pmc.bom_id IS NOT NULL AND pmc.bom_id != ''
        LIMIT 1
       ```
    2. If not found, fall back to item's latest `ACTIVE` BOM:
       ```sql
       SELECT id FROM boms
        WHERE tenant_id = ? AND product_id = ? AND status = 'ACTIVE'
        ORDER BY created_at DESC, id DESC
        LIMIT 1
       ```
  - Add private helper `getRecipeIngredientsWithLatestPrice(tenantId: string, stockItemId: string): RecipeIngredientPrice[]`:
    - Resolve root BOM via `resolveRecipeBomId(tenantId, stockItemId)`. If `null`, return `[]`.
    - Constants: `const MAX_BOM_DEPTH = 4`.
    - Maintain `seenItems = new Set<string>()` (deduplicate output by `stock_item_id`, preserving `sort_order`), `out: RecipeIngredientPrice[] = []`, and an in-call cache `buyCache = new Map<string, ItemHistoryRow | null>()` for `queryItemBuys(tenantId, id, 1)[0] ?? null`.
    - Helper `latestBuy(id: string)` reads/populates `buyCache`.
    - Helper `activeBomOf(productId: string)`:
      ```sql
      SELECT id FROM boms
       WHERE tenant_id = ? AND product_id = ? AND status = 'ACTIVE'
       ORDER BY created_at DESC, id DESC
       LIMIT 1
      ```
    - Helper `pushItem(id: string, name: string, sku: string)`: if `!id || seenItems.has(id)` return; `seenItems.add(id)`; `const b = latestBuy(id)`; push `{ stockItemId: id, name, sku, date: b ? b.date : null, unit: b ? b.unit : null, price: b ? b.price : null }`.
    - Recursive `walk(bomId: string, depth: number, path: Set<string>): boolean` (returns `true` if it produced at least one item):
      - If `path.has(bomId)` return `false`.
      - `const nextPath = new Set(path); nextPath.add(bomId)`
      - Query `bom_items` (tenant-scoped):
        ```sql
        SELECT bi.item_type, bi.material_id, bi.child_bom_id,
               si.name AS mat_name, si.sku AS mat_sku,
               cb.id AS cb_valid_id, cb.product_id AS cb_product_id,
               csi.name AS cb_prod_name, csi.sku AS cb_prod_sku
          FROM bom_items bi
          LEFT JOIN stock_items si ON si.id = bi.material_id AND si.tenant_id = bi.tenant_id
          LEFT JOIN boms cb ON cb.id = bi.child_bom_id AND cb.tenant_id = bi.tenant_id
          LEFT JOIN stock_items csi ON csi.id = cb.product_id AND csi.tenant_id = cb.tenant_id
         WHERE bi.bom_id = ? AND bi.tenant_id = ?
         ORDER BY bi.sort_order ASC, bi.id ASC
        ```
      - Track `let added = false`.
      - For each row:
        - **If `row.item_type === 'CHILD_BOM' && row.cb_valid_id`**:
          - If `depth < MAX_BOM_DEPTH && !nextPath.has(row.cb_valid_id)`:
            - `const subAdded = walk(row.cb_valid_id, depth + 1, nextPath)`
            - If `subAdded`, `added = true`
            - Else if `row.cb_product_id && row.cb_prod_name` (empty child BOM): `pushItem(row.cb_product_id, row.cb_prod_name, row.cb_prod_sku ?? '')`; `added = true`.
          - Else if `!nextPath.has(row.cb_valid_id) && row.cb_product_id && row.cb_prod_name` (hit max depth):
            - `pushItem(row.cb_product_id, row.cb_prod_name, row.cb_prod_sku ?? '')`; `added = true`.
        - **Else if `row.material_id && row.mat_name`** (`MATERIAL`):
          - Check `latestBuy(row.material_id)` first!
          - If it HAS a confirmed GR -> `pushItem(row.material_id, row.mat_name, row.mat_sku ?? '')`; `added = true` (**do not recurse**).
          - Else (no confirmed GR):
            - Look up `const subBomId = depth < MAX_BOM_DEPTH ? activeBomOf(row.material_id) : null`.
            - If `subBomId && !nextPath.has(subBomId)`:
              - `const subAdded = walk(subBomId, depth + 1, nextPath)`
              - If `subAdded`, `added = true`
              - Else: `pushItem(row.material_id, row.mat_name, row.mat_sku ?? '')`; `added = true`.
            - Else:
              - `pushItem(row.material_id, row.mat_name, row.mat_sku ?? '')`; `added = true`.
      - Return `added`.
    - Run `walk(rootBomId, 0, new Set())` and return `out`.
  - In `getItemHistory(tenantId, stockItemId)`:
    - Only when `buys.length === 0`, compute `const recipeIngredients = getRecipeIngredientsWithLatestPrice(tenantId, stockItemId)`.
    - Return `{ item, buys, sells, lines, ...(recipeIngredients.length ? { recipeIngredients } : {}) }`.
    - Do NOT modify `getCostBasis`, `getBuyLog`, or `getSellLog`.

- [ ] 6. **Render recipe ingredients in `flexTemplates.itemHistoryCard` (`backend/src/services/line-flex-templates.ts`) and pass them from `line-bot.service.ts`**:
  - In `line-flex-templates.ts` (`itemHistoryCard`, lines 1341-1394):
    - Add optional `recipeIngredients?: { name: string; date: string | null; unit: string | null; price: number | null }[]` to the parameter object.
    - `const recipe = d.recipeIngredients ?? []`
    - `const hasRecipe = recipe.length > 0`
    - `const shownRecipe = recipe.slice(0, 15)`
    - Change the existing "no receipt" note condition at lines 1388-1390 to:
      ```ts
      ...(d.lines.length && !d.lines.some(r => r.side === 'buy') && !hasRecipe
          ? [txt('ไม่มีใบรับซื้อของรายการนี้ จึงไม่มีราคาซื้อ', { size: 'xs', color: P.ink500, margin: 'md', wrap: true })]
          : []),
      ```
    - When `hasRecipe`, render BEFORE the VAT disclaimer line (`ราคาตามเอกสาร อาจรวมหรือไม่รวม VAT`):
      ```ts
      ...(hasRecipe ? [
          sectionTitle('วัตถุดิบในสูตร (ราคาล่าสุด)'),
          ...shownRecipe.map(ing => {
              const hasGr = !!ing.date
              const priceStr = !hasGr
                  ? 'ไม่มีใบรับซื้อ'
                  : (ing.price === null || ing.price === undefined
                      ? 'ไม่มีราคา'
                      : (ing.unit ? `${baht(ing.price)}/${ing.unit}` : baht(ing.price)))
              const color = hasGr && ing.price !== null && ing.price !== undefined ? P.success : P.ink500
              return listRow(ing.name, hasGr ? dmy(ing.date!) : '', priceStr, color)
          }),
          ...(recipe.length > 15
              ? [txt(`และอีก ${recipe.length - 15} รายการ`, { size: 'xs', color: P.ink500, margin: 'sm' })]
              : []),
      ] : []),
      ```
    - Verify no recipe qty/unit and no words `ต้นทุน` or `กำไร` appear anywhere in the card.
  - In `backend/src/services/line-bot.service.ts` (`handleProductCommand` -> `sendHistory`, lines 1762-1770):
    - Pass `recipeIngredients: hist.recipeIngredients` into `flexTemplates.itemHistoryCard({ ... })`.

- [ ] 7. **Add comprehensive tests in `backend/src/services/lineShiftRecipeSummary.test.ts`** covering every test case in Section 4 below, and run `npm run build && npm test`.

---

## 4. Exact Test Cases to Cover & Existing Tests Analysis

### New Test Cases (`backend/src/services/lineShiftRecipeSummary.test.ts`)

#### Goal A — `/สรุป`, EOS Cards, Open Shift, Toggle, Midnight, Quota/Reply-Only
1. **Group vs Private, Master vs Member (toggle ON: `line_shift_expense_groups = 1`)**:
   - Bound group (`pos_daily = 1`): unregistered member, linked staff, demo Master, and floating Master typing `/สรุป` and `/สรุป วันนี้` all receive the **identical** EOS `shiftCloseCard` (drawer cash, sales, best sellers, platform section); `pushMessage` is never called.
   - Member in bound group typing `/สรุป tenant <other>` or `/สรุป <otherName>` gets **silence** (cannot name another company).
   - Master in **private chat** typing `/สรุป` (default `view_tenant_id`) and `/สรุป tenant <other>` gets EOS `shiftCloseCard` **even when `line_shift_expense_groups = 0`** (toggle only restricts groups).
   - Master in **unbound group** typing `/สรุป` without company gets quickReply message buttons whose `action.text` starts with `"/สรุป tenant "` (not `"/pos tenant "`) and leaks no amounts.
   - Master in **bound group** naming another company gets `"🔒 กลุ่มนี้ล็อกไว้กับ <name>"`.
2. **Toggle OFF (`line_shift_expense_groups = 0`) in groups**:
   - In a `pos_daily = 1` group with `line_shift_expense_groups = 0`, **both** member and Master typing `/สรุป` and `/สรุป เมื่อวาน` fall back to the POS card (`dailySalesCard`, e.g. `"ยอดขายวันนี้"` / `"ยอดขายเมื่อวาน"`), NOT `shiftCloseCard`.
   - In the same group, `"สรุปการปิดกะ"` keeps its existing lock refusal (`"🔒 บริษัทนี้ยังไม่เปิดให้ดูสรุปปิดกะในกลุ่ม"`), NOT POS fallback.
3. **`/สรุป เดือนนี้` and `/pos` unchanged**:
   - Both Master (private & group) and bound-group member typing `/สรุป เดือนนี้` get `dailySalesCard` (`"ยอดขายเดือนนี้"`), even when `line_shift_expense_groups = 1`.
   - Master typing `/pos`, `/pos วันนี้`, `/pos เมื่อวาน` still gets `dailySalesCard`, even when `line_shift_expense_groups = 1`.
4. **Open + Closed shifts on the same Thai day & Live Open Shift accuracy**:
   - Tenant has 1 `CLOSED` shift today + 1 `OPEN` shift today (`expected_cash = NULL`, `closing_cash_counted = NULL`, `cash_difference = NULL`):
     - `/สรุป` returns **2 cards** (closed card first, live open card second) in a single `replyMessage` call.
     - Closed card shows `"🔒 ปิดกะแล้ว"` and actual counted/difference badge.
     - Open card header shows `"🟢 กะกำลังเปิดอยู่ (ยังไม่ปิดกะ)"` (no `"Invalid Date"`).
     - Open shift money uses exact formula: `opening_cash` (e.g. `500`) + proportional cash share of split-payment PAID bill (e.g. `฿300` bill paid `฿100` CASH + `฿200` QR_CODE → `cash_revenue = 100`, `bank_revenue = 200`) + `CASH_IN` (`200`) - `PAID_OUT` (`150`) = `฿650`, ignoring `OPENING_GAP` (`100`) and ignoring `CANCELLED` bills.
     - Open shift card shows expected cash `฿650` and `"ยังไม่นับ"`, and **does NOT contain** `"ขาด"`, `"เกิน"`, `"ตรงพอดี"`, or `"→ ฿0"`.
     - Zero-activity open shift (`opening_cash = 0`, 0 bills) still shows `"ยังไม่นับ"` and never `"ขาด"` or `"ตรงพอดี"`.
   - `สรุปการปิดกะ` on the same day returns **only** the 1 `CLOSED` shift (keeps existing behaviour, excludes the `OPEN` shift).
5. **Yesterday across UTC / Thai midnight boundary**:
   - Shift A closed at `<day-2>T16:59:00.000Z` (= 23:59 Thai two days ago) → excluded from `เมื่อวาน`.
   - Shift B closed at `<day-2>T17:01:00.000Z` (= 00:01 Thai yesterday) → **included** in `/สรุป เมื่อวาน`.
   - Shift C closed at `<day-1>T16:59:00.000Z` (= 23:59 Thai yesterday) → **included** in `/สรุป เมื่อวาน`.
   - Shift D closed at `<day-1>T17:01:00.000Z` (= 00:01 Thai today) → excluded from `เมื่อวาน`, **included** in `/สรุป วันนี้`.
   - An `OPEN` shift is **excluded** from `/สรุป เมื่อวาน`.
6. **No shift on that day**:
   - `/สรุป วันนี้` with no closed and no open shift (toggle ON) → short Thai text `"วันนี้ยังไม่มีกะที่เปิดหรือปิดครับ"`.
   - `/สรุป เมื่อวาน` with no closed shift (toggle ON) → short Thai text `"เมื่อวานไม่มีกะที่ปิดครับ"`.
7. **>5 cards cap (LINE 5-message limit)**:
   - 5 `CLOSED` shifts + 1 `OPEN` shift today (total 6) → `replyMessage` receives an array of **exactly 5** messages: the 4 latest cards (3 latest closed + the live open card) + 1 text message mentioning `6` shifts and web URL.
   - 6 `CLOSED` shifts yesterday → **exactly 5** messages (4 latest closed + 1 overflow text).
8. **Other tenant isolation**:
   - Shifts, bills, cash movements, and platform sales belonging to Tenant B never appear in Tenant A's `/สรุป` or `buildShiftSummary(tenantA, shiftOfB)` (returns `null`).
9. **Platform / Delivery section always shown**:
   - Shift with **no** Shopee/LINE MAN/Grab/20%-discount bills still renders `'🛵 ยอด Delivery / ส่วนลด > 20%'` and `'ไม่มีรายการแพลตฟอร์มในกะนี้'` on `shiftCloseCard` (verified for both `/สรุป` and `notifyShiftClosed` exec push).
   - Shift **with** Shopee / LINE MAN / Grab bills renders each platform row and bill count total.
10. **Help & bind texts updated**:
    - `/คำสั่ง` mentions `/สรุป` for shift summary (separate from `/pos`) and updated `/ผูก pos` description.
    - `/ผูก pos tenant <id>` and 6-digit code group link success texts reflect `/สรุป` shift-summary behaviour.

#### Goal B — `/สินค้า` Recipe Ingredients & Latest GR Prices
11. **POS dish with no GR + recipe (`pos_menu_configs.bom_id` vs fallback `ACTIVE` BOM)**:
    - Item has POS sale lines, **no** GR, and `pos_menu_configs.bom_id` pointing to BOM-A while another `ACTIVE` BOM-B also exists → uses BOM-A's ingredients (menu's `bom_id` wins).
    - Item has **no** GR and `pos_menu_configs.bom_id = NULL` (or no menu config) → falls back to item's latest `ACTIVE` BOM (ignores `DRAFT`/`INACTIVE` BOMs).
    - Card shows both sale lines and `'วัตถุดิบในสูตร (ราคาล่าสุด)'`, with each ingredient's latest confirmed GR `receipt_date` (`d/m/yy`) and `฿price/unit` (from `poi.unit_price` / `poi.unit`), **without** recipe quantity/unit, **without** `ต้นทุน` or `กำไร`, and **without** `"ไม่มีใบรับซื้อของรายการนี้ จึงไม่มีราคาซื้อ"`.
12. **GR rules parity & tenant scoping**:
    - Picks latest by `receipt_date DESC` (not `created_at`), ignores `DRAFT`/`CANCELLED` GRs, matches GRs linked only by `material_id` (with `stock_item_id = NULL`), includes rows with `stock_qty = NULL`, and ignores GRs and BOMs from another tenant.
13. **`CHILD_BOM`, `MATERIAL` with its own BOM, deduplication, and loop guard**:
    - `bom_items` with `item_type = 'CHILD_BOM'` (`child_bom_id`) expands into the child BOM's ingredients with their latest GR prices.
    - `bom_items` with `item_type = 'MATERIAL'` whose stock item has its own `ACTIVE` BOM:
      - When that material **has** a confirmed GR → shows that material directly with its GR price (does **not** recurse deeper).
      - When that material has **no** confirmed GR → expands its `ACTIVE` BOM into its sub-ingredients.
    - Duplicate ingredient appearing in both root BOM and child BOM appears **once** (not duplicated).
    - Circular BOM (`BOM-A -> CHILD_BOM -> BOM-B -> CHILD_BOM -> BOM-A` and self-loop `BOM-A -> BOM-A`) terminates safely without stack overflow and still returns valid sibling ingredients.
14. **Ingredient without any confirmed GR**:
    - Ingredient with no GR (or only `DRAFT` GR) renders with `"ไม่มีใบรับซื้อ"`.
15. **>15 ingredients truncation**:
    - Recipe with 18 unique ingredients renders the first 15 ingredients and `"และอีก 3 รายการ"` (does not render items 16–18).
16. **Suppression vs preservation of `"ไม่มีใบรับซื้อของรายการนี้ จึงไม่มีราคาซื้อ"`**:
    - Item with GR **and** BOM → shows normal buy/sell history only (no recipe section, no "ไม่มีใบรับซื้อ..." line).
    - Item with **no** GR and **no** BOM (with sales) → keeps `"ไม่มีใบรับซื้อของรายการนี้ จึงไม่มีราคาซื้อ"` and shows no recipe section.
    - Item with **no** GR, **no** sales, and **has** BOM → shows `"ยังไม่มีประวัติซื้อ-ขาย"` + recipe section, and does **not** show `"ไม่มีใบรับซื้อของรายการนี้ จึงไม่มีราคาซื้อ"`.

### Existing Tests — Which Must Change and Why
- **[lineMasterCommands.test.ts](backend/src/services/lineMasterCommands.test.ts)**: **No mandatory breaking change expected** — Test 11 creates companies with default `line_shift_expense_groups = 0`, which now tests the required group toggle-off fallback to `buildPosCard`; Tests 6 & 9 only check substrings (`09:00`, `/สรุป`, `ไม่ส่งเข้ากลุ่ม`, `/pos`, `/รายได้`, `/ผูก pos`, `/เลิกผูก pos`) that are preserved in the updated texts. (Only update Test 11's description comment if desired to clarify it tests `line_shift_expense_groups = 0`.)
- **[posShiftSummary.service.test.ts](backend/src/services/posShiftSummary.service.test.ts)**: **No breaking change** — existing assertions on closed shifts and delivery tags remain valid; the newly always-shown platform section adds `'ไม่มีรายการแพลตฟอร์มในกะนี้'` without violating any assertion.
- **[lineHrApprovalProduct.test.ts](backend/src/services/lineHrApprovalProduct.test.ts)**: **No breaking change** — the POS dish test (lines 678–713) has no BOM, so it retains `'ไม่มีใบรับซื้อของรายการนี้'`, and all non-BOM items are unaffected.
- **[settings.billingPermission.test.ts](backend/src/routes/settings.billingPermission.test.ts)**, **[lineMasterFloat.test.ts](backend/src/services/lineMasterFloat.test.ts)**, **[lineInChatApproval.test.ts](backend/src/services/lineInChatApproval.test.ts)**: **No breaking change** (`shiftCloseCard`'s `status` is optional and defaults to `'CLOSED'`).
- *Caveat*: Because this review was strictly read-only without repo-wide grep, if `vitest run` reveals any other existing test file asserting either (a) `buildShiftSummary` returns `null` for an `OPEN` shift, (b) `shiftCloseCard` omits the delivery section when empty, or (c) exact old `/คำสั่ง` / `/ผูก pos` copy, the worker should update only those outdated expectations to match the new contract.

