# สัญญากลาง: กล่องรับบิลผ่าน LINE (Bill Inbox)

2026-11-17 · branch `hr/billinbox` (ฐาน `ui` 064fd2a)

## เป้าหมาย

พนักงานถ่ายรูปบิลซื้อส่งเข้า LINE OA กลาง → server บีบอัดแล้วเก็บเป็น "บิลรอลง" →
Claude (ต่อผ่าน MCP) เรียกดูรูป อ่านเอง ร่าง PO แล้วแนบรูปด้วย `inbox_id` โดยไม่ต้องส่ง base64

```
LINE (รูป) ─► bill_inbox PENDING ─► MCP get_bill_image ─► create_draft_po ─► attach_document_evidence(inbox_id)
                                                                              └► bill_inbox ATTACHED + payment_attachments
```

ไม่มี AI/OCR ฝั่ง server · ไม่มีหน้าเว็บใหม่ · ไม่เพิ่ม dependency

## ตาราง `bill_inbox` (migration ทำแล้วใน T0 — ห้ามแก้)

| คอลัมน์ | ความหมาย |
|---|---|
| id | `generateId()` |
| tenant_id | ร้านของผู้ส่ง (จาก `resolveTenant`) |
| line_message_id | UNIQUE — กัน webhook ส่งซ้ำ |
| line_user_id, user_id | ผู้ส่ง (user_id จาก `line_user_mappings`) |
| file_path | **ชื่อไฟล์ล้วน** ใน `invoiceUploadDir` (`routes/sales/shared.ts`) รูปแบบ `inbox-<id><ext>` |
| mime_type, file_size | ของไฟล์ที่เก็บจริง (หลังบีบ) |
| status | `PENDING` → `ATTACHED` หรือ `DISCARDED` (ทางเดียว ไม่ย้อน) |
| ref_type, ref_id, attachment_id | เอกสารที่แนบไป + แถวใน `payment_attachments` |
| discard_reason, processed_by, processed_at | ใครปิดรายการ เมื่อไร เพราะอะไร |
| created_at | ISO string |

กฎไฟล์: PENDING = ไฟล์เป็นของ inbox · ATTACHED = ไฟล์ **ย้ายเจ้าของ** ไปเป็นของแถว `payment_attachments`
(ใช้ชื่อไฟล์เดิม ไม่ copy — หน้าเว็บลบไฟล์แนบได้ตามปกติ) · DISCARDED = ลบไฟล์ทิ้ง
รูป 1 ใบแนบได้ 1 เอกสาร

## T1 — รับรูปจาก LINE

ไฟล์ที่เป็นเจ้าของ: `backend/src/services/billInbox.service.ts` (ใหม่), `backend/src/services/billInbox.test.ts` (ใหม่),
`backend/src/services/line-bot.service.ts` (เพิ่มกิ่ง image ใน `handleEvent` + เมธอดดึงไฟล์ใน client wrapper เท่านั้น)

```ts
// billInbox.service.ts
export const MAX_PENDING_PER_TENANT = 200
export type IntakeResult =
  | { ok: true; id: string; pending: number }
  | { ok: false; reason: 'DUPLICATE_MESSAGE' | 'DUPLICATE_IMAGE' | 'INBOX_FULL' | 'NOT_IMAGE'; docNum?: string; label?: string }
export async function intakeBillImage(p: {
  tenantId: string; lineUserId: string; userId: string | null; lineMessageId: string; raw: Buffer
}): Promise<IntakeResult>
```

กฎ `intakeBillImage` (เรียงตามลำดับ):
1. `line_message_id` มีอยู่แล้ว → `DUPLICATE_MESSAGE` (ไม่เขียนอะไร)
2. `sharp(raw).metadata()` อ่านไม่ได้ → `NOT_IMAGE`
3. PENDING ของร้าน ≥ `MAX_PENDING_PER_TENANT` → `INBOX_FULL`
4. บีบด้วย `compressImage(raw)` (ค่า default เดียวกับไฟล์แนบ) ได้ null = ใช้ไฟล์เดิม
5. ซ้ำกับไฟล์แนบเดิม: เรียก `findDuplicateAttachment(tenantId, raw.toString('base64'))` จาก `mcp/tools/shared.ts` เจอ → `DUPLICATE_IMAGE` พร้อม `docNum`, `label`
6. ซ้ำกับรูปที่ยัง PENDING ในร้านเดียวกัน (file_size เท่ากัน แล้วเทียบ `Buffer.equals` บนดิสก์) → `DUPLICATE_IMAGE` (ไม่มี docNum)
7. เขียนไฟล์ `inbox-<id>.jpg|.png|...` ลง `invoiceUploadDir` แล้ว INSERT · คืน `pending` = จำนวน PENDING ของร้านหลังเพิ่ม

กฎ `handleEvent` (กิ่งใหม่ `event.type === 'message' && event.message.type === 'image'`):
- รับเฉพาะแชทส่วนตัว (`sourceType(event) === 'user'`) · รูปในกลุ่ม/ห้อง **เงียบ ไม่ตอบ ไม่เก็บ**
- ยังไม่ผูกบัญชี (`tenantId === ''` หรือไม่มีแถว `line_user_mappings` ของ tenant+line_user_id) → ตอบวิธีผูก (ใช้ `handleHowToLinkCommand`) ไม่เก็บ
- ดึงไฟล์: `GET https://api-data.line.me/v2/bot/message/{messageId}/content` header `Authorization: Bearer <client.token>` ด้วย `fetch` ในตัว Node
  ทำเป็นเมธอด `getMessageContent(messageId): Promise<Buffer>` บน object ที่ `getClient()` คืน (เทสต์ mock `getClient` อยู่แล้ว จึง mock ตรงนี้ได้)
  เกิน 10MB หรือ HTTP ไม่ ok → ตอบ "ดึงรูปไม่สำเร็จ ลองส่งใหม่อีกครั้ง"
- รูปเป็นชุด (`event.message.imageSet`): เก็บทุกใบ แต่**ตอบครั้งเดียว**ตอน `index === total` (ไม่มี imageSet = ตอบทุกครั้ง)
- ข้อความตอบ (text ธรรมดา):
  - สำเร็จ: `📥 รับบิลแล้ว · รอลงบัญชี {pending} ใบ`
  - `DUPLICATE_IMAGE` มี docNum: `⚠️ รูปนี้เคยแนบไว้แล้วใน{label} {docNum} ไม่ได้เก็บซ้ำ`
  - `DUPLICATE_IMAGE` ไม่มี docNum: `⚠️ รูปนี้ส่งมาแล้ว และยังรอลงบัญชีอยู่ ไม่ได้เก็บซ้ำ`
  - `INBOX_FULL`: `⚠️ บิลรอลงเต็ม {MAX} ใบแล้ว แจ้งผู้ดูแลให้เคลียร์ก่อน`
  - `NOT_IMAGE`: `ไฟล์นี้อ่านเป็นรูปไม่ได้ ลองถ่ายใหม่อีกครั้ง`
  - `DUPLICATE_MESSAGE`: เงียบ
- ห้ามแตะกิ่ง text / postback / follow เดิม

เทสต์ (`billInbox.test.ts`, แบบเดียวกับ `lineCentralOA.test.ts`): สร้างรูปจริงด้วย `sharp({ create: ... })` (สุ่มสีพื้นให้ไม่ซ้ำกันระหว่างเคส)
ครอบ: ผูกแล้วส่งรูป → แถว PENDING + ไฟล์อยู่จริง + ข้อความตอบ · ยังไม่ผูก → ไม่มีแถว · รูปในกลุ่ม → ไม่มีแถว ไม่ตอบ ·
message id ซ้ำ → แถวเดียว · รูปเดิมส่งซ้ำ → DUPLICATE_IMAGE · ร้านอื่นไม่เห็นแถว · afterEach ลบแถว + ไฟล์ที่สร้าง

## T2 — เครื่องมือ MCP

ไฟล์ที่เป็นเจ้าของ: `backend/src/mcp/tools/billInbox.ts` (ใหม่), `backend/src/mcp/tools/billInbox.test.ts` (ใหม่),
`backend/src/mcp/tools/purchase.ts` (เฉพาะ `attach_document_evidence`), `backend/src/mcp/tools/shared.ts` (เฉพาะ type `ToolResult`),
`backend/src/mcp/sdk-compat.ts` (เฉพาะ type ของ handler), `backend/src/mcp/tools.ts`, `backend/src/mcp/tools/guide.ts`,
`backend/src/routes/mcpSettings.scope.test.ts`

T2 **ไม่ import** `services/billInbox.service.ts` (T1 ยังเขียนอยู่) — query `bill_inbox` ตรงใน `mcp/tools/billInbox.ts` แบบเดียวกับ tool อื่น

Type: ขยาย content ให้รับรูปได้
```ts
export type ToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
export type ToolResult = { content: ToolContent[] }
```
(`ok()` เดิมไม่เปลี่ยน · `sdk-compat.ts` handler return type ต้องรับ `ToolContent` ด้วย)

`registerBillInboxTools(server, tenantId, userId)` ลงทะเบียน 3 ตัว เรียกจาก `registerTools` ต่อจาก `registerPurchaseTools`:

| tool | args | ผล |
|---|---|---|
| `list_bill_inbox` | `status?: 'PENDING' \| 'ATTACHED' \| 'DISCARDED'` (default PENDING), `limit?` (default 20, max 50) | `ok({ success, total, items: [{ inbox_id, status, sent_by, created_at, file_size_bytes, doc_type, doc_number }] })` เรียงเก่าก่อน · `sent_by` = `users.name` (ไม่มี = "ไม่ทราบ") · `total` = จำนวนทั้งหมดของ status นั้น |
| `get_bill_image` | `inbox_id` | content 2 ชิ้น: `{ type: 'image', data: <base64 ของไฟล์>, mimeType }` ตามด้วย text JSON `{ success, inbox_id, status, sent_by, created_at }` · ไม่พบ/ไฟล์หาย → `ok({ success: false, message })` · ดูได้ทุก status ที่ไฟล์ยังอยู่ |
| `discard_bill_inbox` | `inbox_id`, `reason` (ต้องไม่ว่าง) | เฉพาะ PENDING → DISCARDED + ลบไฟล์ + `discard_reason`, `processed_by = userId`, `processed_at` · สถานะอื่น → `success: false` |

`attach_document_evidence` เพิ่ม `inbox_id?: string` และเปลี่ยน `image_base64` เป็น optional:
- ต้องส่ง **อย่างใดอย่างหนึ่ง** พอดี (ทั้งคู่/ไม่ส่งเลย → `success: false` ข้อความชัดเจน)
- ทาง `image_base64`: พฤติกรรมเดิมทุกอย่าง
- ทาง `inbox_id`: แถวต้องเป็นของ tenant + PENDING + ไฟล์อยู่จริง ไม่งั้น `success: false` · ใน transaction เดียว:
  INSERT `payment_attachments` (file_path = ไฟล์เดิมของ inbox, original_name = `file_name` ที่ส่งมา หรือ `bill-<created_at 10 ตัวแรก>-<inbox_id 6 ตัวแรก><ext>`,
  file_size, uploaded_by = `bill_inbox.user_id ?? userId`) แล้ว UPDATE inbox เป็น ATTACHED พร้อม ref_type/ref_id/attachment_id/processed_by/processed_at
  · ไม่ต้องตรวจรูปซ้ำอีก (ตรวจตอนรับเข้าแล้ว) · response รูปแบบเดียวกับทางเดิม + `inbox_id`
- คำอธิบาย tool ต้องบอกว่า "รูปจาก LINE ให้ส่ง inbox_id แทน image_base64"

สิทธิ์: `list_bill_inbox`, `get_bill_image` อ่านอย่างเดียว → ใส่ `READ_ONLY_TOOLS` (mcp/tools.ts) + สำเนาใน `routes/mcpSettings.scope.test.ts`
และใส่ `get_bill_image` ใน `NO_READONLY_HINT` (รูปบิลไม่ควรค้างใน cache ของ client)

Guide (`guide.ts`): เพิ่ม 3 tool ในรายการหมวด `purchase` (ทั้งบรรทัดสารบัญและ Area tools รูปแบบ `name(...)`) + flow ใหม่:
`list_bill_inbox(...) -> get_bill_image(...) -> search(...)/get_suppliers(...) -> create_draft_po(...) -> attach_document_evidence(...) with inbox_id`
+ pitfall: อ่านรูปไม่ชัด/ไม่ใช่บิล ให้ถามผู้ใช้ก่อน `discard_bill_inbox(...)` ห้ามทิ้งเอง · บิล 1 ใบ = 1 inbox_id

เทสต์ (`billInbox.test.ts`, แบบ `directPurchaseFlow.test.ts`): INSERT แถว `bill_inbox` + เขียนไฟล์ลง `invoiceUploadDir` เองด้วย SQL/fs
ครอบ: list เห็นเฉพาะ tenant ตัวเอง · get คืน content[0].type === 'image' และ data ถอดกลับได้ไฟล์เดิม ·
attach ด้วย inbox_id → มีแถว payment_attachments ชี้ไฟล์เดิม + inbox ATTACHED · attach ซ้ำ → false · ส่งทั้ง base64 และ inbox_id → false ·
inbox ของ tenant อื่น → false · discard → ไฟล์หาย + reason ถูกเก็บ · `guide.test.ts`, `readOnlyHint.test.ts`, `mcpSettings.scope.test.ts`, `directPurchaseFlow.test.ts` เดิมยังผ่าน

## ที่ตั้งใจไม่ทำรอบนี้

- หน้าเว็บดูบิลรอลง · PDF/ไฟล์จาก LINE (`message.type === 'file'`) · รูปจากกลุ่ม · ลบ PENDING ที่ค้างนานอัตโนมัติ
- `inbox_id` ใน `create_draft_po` (แนบทีหลังด้วย `attach_document_evidence` แทน)
