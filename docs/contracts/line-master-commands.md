# LINE Master commands + daily POS summary (owner decision 2026-11-24)

Baseline: 18dcf4965ab5ffb6b097ecf8da51a684b574b057
Goal: the Master types commands in any LINE group to see POS/income, binds a group to any company in one command, and the
daily summaries really reach someone (checked 2026-11-24: exec digest has never been sent, because there are no recipients).

Targets
- Modify backend/src/services/line-bot.service.ts, backend/src/services/line-flex-templates.ts,
  backend/src/services/execDigest.service.ts, backend/src/db/migrations.ts, backend/src/services/execDigest.test.ts (only if needed)
- Create backend/src/services/lineMasterCommands.test.ts
Do not touch: anything else. No new dependency, no frontend change, no new table.
Done when: backend tsc is clean and vitest passes (the lead runs them, not you).

## 1. Who may use them
`const ml = this.floatingLink(event.source.userId)` and `!ml.demo_role`. Anyone else typing these commands: exactly the
behaviour of today (group = silence, private = normal flow). Never trust text/buttons, only line_master_links.
Parsed at the top of the text branch, BEFORE the registration gate, and the message must start with "/" (raw text, exact
command word). Works in group, room and private chat unless stated. Every answer is replyMessage (free), never push.

## 2. Commands (Thai copy)
| Command | Result |
|---|---|
| `/pos [วันนี้\|เมื่อวาน\|เดือนนี้] [company]` (default วันนี้) | POS card from posSales(); title/alt/hero must say the real period |
| `/รายได้ [วันนี้\|เมื่อวาน\|เดือนนี้] [company]` (default เดือนนี้) | revenue-only card: ledgerRevenue + posSales revenue as a separate line with note "POS รวมอยู่ในรายได้แล้ว ไม่ต้องบวกกัน". NO cost/profit in this card |
| `/บริษัท <company>` | set line_master_links.view_tenant_id at once when exactly one match (then richMenus.syncUser like switch_tenant); private and group |
| `/ผูก pos <company>` (also `/ผูกpos`), group/room only | one command, works for ANY company whatever the Master is viewing |
| `/เลิกผูก pos` (also `/เลิกผูกpos`), group/room only | is_active=0, pos_daily=0 for this group |
| `/คำสั่ง` | text list of these commands |

Company resolution, one private helper used by all: match `name LIKE %q%` OR `tenant_id LIKE %q%` on company_settings
(escape % and _). Case-insensitive, trimmed. 0 match → "ไม่พบบริษัท". >1 → text + quickReply MESSAGE actions (not postback)
that send the same command with the full company name (an exact full-name match wins over LIKE matches). Max 13 buttons, label ≤ 20.
(Company "Kids House Cafe" has tenant_id tenant_bb_pillow, so both "kids" and "bb" must find it.)
No company given:
- private chat → view_tenant_id
- group bound → that group's company
- group not bound → quickReply company buttons (same message-action buttons). Never guess: the card is visible to the whole group.
Bound group + another company named → refuse: "🔒 กลุ่มนี้ล็อกไว้กับ <name>" for /pos and /รายได้.

`/ผูก pos <company>`: in ONE transaction: deactivate other companies' rows for this group (is_active=0, pos_daily=0), saveGroup,
set pos_daily=1, and INSERT OR IGNORE the Master's line_master_notify row kind 'daily' for that company (= "the person bound to the group
also gets it"). A Master may move a group from another company (the 6-digit-code rule for others stays unchanged).
Reply says: company, moved-from company if any, POS summary every day 09:00, members N → about N×30 messages per month,
company cap left (pushQuotaLeft), and warns when N×30 is more than BULK_PUSH_CAP(). Count lookup failure: still bind, say the count is unknown.
`/เลิกผูก pos` does not remove the Master's own 'daily' row; reply says how to turn it off (แจ้งเตือน in private chat).

## 3. Bound groups receive POS only
- New column line_group_mappings.pos_daily INTEGER NOT NULL DEFAULT 0 (ALTER, guarded like demo_role; place it AFTER the table's create/rebuild migration).
- Work orders: remove both pushToAllGroups calls and the method (dead then). notifyPRStatus: stop pushing to sourceGroupId (keep the type field).
- Groups bound by 6-digit code keep pos_daily=0: no push until a Master types `/ผูก pos`. Fix the wording of handleGroupLink's success text accordingly
  ("ดูสรุปปิดกะได้ในกลุ่มนี้ · แจ้งเตือน POS รายวัน ให้ Master พิมพ์ /ผูก pos").
- bot `leave` and handleGroupLink deactivation must also reset pos_daily (saveGroup by code must not resurrect an old pos_daily=1).

## 4. Daily 09:00 (inside sendExecDigests, same cron, after the private digests of that tenant)
- Exec digest to individuals: as today, plus on the card: POS bills count + payment methods, and a line "รายได้ตามบัญชี" = ledgerRevenue(yesterday).
  ExecDigest gets income, bills, byMethod. The skip-empty condition must also consider income.
  Donut keeps its three values.
- Group POS card: for every group of the tenant with is_active=1 AND pos_daily=1, yesterday's POS card (same builder as `/pos เมื่อวาน`),
  skipped when yesterday has no paid and no cancelled bill. Must run even when the tenant has no individual recipients or an empty exec digest.
- Dedupe per group per day with line_master_alerts key `pos_group:<tenant>:<group>:<date>` claimed synchronously before the first send await; if the push throws or
  quota refuses, it is NOT retried the same day, but is logged.
- Quota: a group push costs its member count. n = getGroupMembersCount / getRoomMembersCount (add both to the getClient wrapper, return .count).
  claimPush(tenantId, n = 1) becomes atomic for n (must not exceed the cap, also on first insert). Also check the OA quota when type is
  'limited': used + n > value → skip. Count unknown → skip. Any quota skip → alertMastersOnce(`pos_group_cap:<tenant>:<YYYY-MM>`, Thai text)
  so it never stops silently. Failure in one group/tenant never blocks others, nor the private digests.

## 5. Bug
execDigest.service.ts: the SQL `-- comment` swallows the status condition, so CANCELLED/DRAFT/VOID invoices are counted. Move the comment out of the SQL line
and add a regression test (DRAFT + CANCELLED + ISSUED + NULL status).

## 6. Tests (lineMasterCommands.test.ts; copy the rig pattern of lineMasterFloat.test.ts, clean up every row)
non-master silent in group for every command · demo Master silent · as_member Master silent · unbound group without company → buttons and no amounts ·
/pos with and without company · locked group refuses another company · /pos เมื่อวาน excludes today · /รายได้ card has no profit/cost ·
/ผูก pos while viewing another company · moving a group · /เลิกผูก pos · /บริษัท 0/1/many matches · % in query does not match everything ·
work order creates no group push · daily group push: once per day, cost = members, cap refusal alerts Master once, empty day skipped, code-bound group gets none.
- Also update helpCard exec list with one row: `/คำสั่ง` "คำสั่ง Master".
