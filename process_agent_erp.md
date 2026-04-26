# ERP Agent Integration Architecture
## ระบบ ERP (CRM-BOM-Stock) + LINE Bot + Paperclip AI

> เอกสารนี้อธิบาย flow การทำงานของระบบ ERP ที่เชื่อมต่อกับ LINE Bot (MCP Agent) และ Paperclip AI รวมถึง Agent Module ใหม่ที่เพิ่มเข้ามา

---

## 1. ภาพรวมระบบ (System Overview)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                               USER (คน/ลูกค้า)                                  │
│                        ┌─────────────┐  ┌─────────────┐                        │
│                        │  LINE App   │  │  Web ERP    │                        │
│                        └──────┬──────┘  └──────┬──────┘                        │
└───────────────────────────────┼────────────────┼────────────────────────────────┘
                                │                │
                                ▼                ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           CRM-BOM-STOCK ERP BACKEND                             │
│                                                                                 │
│  ┌─────────────────────────────┐    ┌─────────────────────────────────────┐    │
│  │   HUMAN API (/api/*)        │    │   AGENT MODULE (/api/agent/*)       │    │
│  │   • Auth: JWT (user)        │    │   • Auth: HMAC + Agent JWT          │    │
│  │   • Rate limit: 200 req/min │    │   • Skip rate limit                 │    │
│  │   • Helmet CSP              │    │   • Server-to-server only           │    │
│  │   • CRUD operations         │    │   • Webhook + Queue + Worker        │    │
│  │                             │    │   • SQLite-backed job queue         │    │
│  └─────────────────────────────┘    └─────────────────────────────────────┘    │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                     LINE BOT SERVICE (/api/line/*)                      │   │
│  │  • Webhook receiver (raw body, HMAC signature)                        │   │
│  │  • Command parser (ขอซื้อ, สต็อก, งาน, บอม, สถานะ, etc.)            │   │
│  │  • LLM Intent Detection (ThaiLLM/OpenAI) → CREATE_TASK → Paperclip   │   │
│  │  • Account linking (6-digit OTP)                                      │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                     ANALYTICS MODULE (/api/analytics/*)                 │   │
│  │  • Executive Summary (KPI รวมทุก module)                              │   │
│  │  • Trends (time-series รายเดือน)                                       │   │
│  │  • Export (bulk data สำหรับวิเคราะห์องค์กร)                            │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌─────────────────┐  ┌──────────────┐  ┌─────────────────────────────────────┐│
│  │   SQLite DB     │  │  Job Queue   │  │   Paperclip API Client             ││
│  │   (multi-tenant)│  │  (agent_jobs)│  │   (report status / add comment)    ││
│  └─────────────────┘  └──────────────┘  └─────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL SYSTEMS                                   │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐  │
│  │  LINE Messaging API  │  │  Paperclip Control   │  │  ThaiLLM / OpenAI    │  │
│  │  (push/reply)        │  │  Plane (tasks)       │  │  (intent detection)  │  │
│  └──────────────────────┘  └──────────────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. ส่วนประกอบหลัก (Core Components)

### 2.1 Human API (`/api/*`)
- **ผู้ใช้**: คนทั่วไปที่ใช้ Web ERP หรือ Mobile
- **Authentication**: JWT (`Authorization: Bearer <jwt>`) อายุ 7 วัน
- **Roles**: MASTER, MANAGER, USER
- **Rate Limit**: 200 requests/minute
- **Security**: Helmet + CSP + CORS

### 2.2 Agent Module (`/api/agent/*`)
- **ผู้ใช้**: AI Agents จาก Paperclip
- **Authentication**: 
  - Webhook: HMAC-SHA256 (`X-Paperclip-Signature`)
  - API: Agent JWT (`Authorization: Bearer <agent-jwt>`) อายุ 1 ชั่วโมง
- **Rate Limit**: ไม่จำกัด (mounted ก่อน global rate limiter)
- **Queue**: SQLite-backed (`agent_jobs` table) แบบ polling ทุก 5 วินาที

### 2.3 LINE Bot Service (`/api/line/*`)
- **ผู้ใช้**: ลูกค้า/พนักงาน ที่คุยผ่าน LINE
- **Authentication**: LINE Channel Secret (HMAC signature verification)
- **Features**: 
  - รับคำสั่งภาษาไทย (`สต็อก`, `ขอซื้อ`, `งาน`, `บอม`)
  - LLM Intent Detection → แปลงข้อความธรรมชาติเป็นคำสั่งระบบ
  - สร้าง Paperclip Task สำหรับงานซับซ้อน

---

## 3. Authentication Flows

### 3.1 Human User → ERP
```
1. User login POST /api/auth/login → ได้ JWT token
2. ส่ง JWT ทุก request: Authorization: Bearer <jwt>
3. Server verify JWT ด้วย JWT_SECRET → ได้ { userId, email, role, tenantId }
4. Middleware ตรวจสอบ role (requireRole/requireMaster)
```

### 3.2 AI Agent → ERP
```
1. Agent ขอ token จากระบบ (หรือ admin สร้างให้)
2. ส่ง Agent JWT: Authorization: Bearer <agent-jwt>
3. Server verify ด้วย AGENT_JWT_SECRET → ได้ { agentId, tenantId, role: 'AI_AGENT' }
4. authenticateAgent middleware จัดการแยกจาก user JWT
```

### 3.3 Paperclip → ERP Webhook
```
1. Paperclip HTTP adapter ส่ง POST /api/agent/webhook
2. Header: X-Paperclip-Signature: <hmac-sha256>
3. Server หา mapping จาก paperclip_companies ตาม companyId
4. Verify HMAC ด้วย webhook_secret ของ tenant นั้น
5. ถูกต้อง → enqueue job → respond 200 ทันที
```

### 3.4 LINE → ERP
```
1. LINE Platform ส่ง webhook POST /api/line/webhook
2. Raw body + X-Line-Signature header
3. Server brute-force ลอง verify signature กับทุก active channel secret
4. เจอตัวตรง → รู้ tenant → ประมวลผล event
```

---

## 4. LINE Bot — MCP Agent Flow

### 4.1 คำสั่งที่รองรับ (Hard Commands)

| คำสั่ง | ตัวอย่าง | Action |
|--------|---------|--------|
| `สต็อก [query]` | "สต็อก นมสด" | ค้นหา stock items |
| `ขอซื้อ [รายละเอียด]` | "ขอซื้อ นมสด 10 ลิตร" | สร้าง Purchase Request |
| `บอม [ชื่อ]↵[วัตถุดิบ]` | "บอม หมอน↵ใยโพลี 500g" | สร้าง BOM draft |
| `สถานะ` | "สถานะ" | ดู Work Orders ที่กำลังทำ |
| `งาน [รายละเอียด]` | "งาน ตรวจสอบสต็อก" | สร้าง Paperclip Task |
| `ลิงก์ [6-digit]` | "ลิงก์ 123456" | เชื่อมบัญชี ERP กับ LINE |

### 4.2 LLM Intent Detection Flow
```
User message (Thai)
    │
    ▼
[ThaiLLM / OpenAI] detectIntent(message)
    │
    ├──► CREATE_BOM → askConfirmTask("create_bom")
    ├──► SUGGEST_MENU → askConfirmTask("suggest_menu")  
    ├──► QUERY_ERP → route ไป query_stock / query_bom / query_order
    ├──► CREATE_TASK → askConfirmTask("create_task") → Paperclip
    └──► CHAT → ตอบกลับทันที
```

### 4.3 LINE Account Linking
```
1. ERP User → Settings → LINE Bot → "สร้างรหัสเชื่อม"
2. System สร้าง 6-digit OTP เก็บใน line_link_tokens (10 นาที)
3. User ส่ง "ลิงก์ 123456" ใน LINE
4. Bot verify token → สร้าง line_user_mappings
5. User ได้รับ notification และสิทธิ์สร้าง task
```

---

## 5. Paperclip AI Integration

### 5.1 ERP → Paperclip (Outbound)
**ตอนนี้ทำงานผ่าน LINE Bot:**
```
User: "งาน ตรวจสอบสต็อกนมหมดอายุ"
    │
    ▼
line-bot.service.ts → createPaperclipTask(title, description)
    │
    ▼
POST https://paperclip/api/companies/{companyId}/issues
Body: { title, description, assigneeAgentId, priority: 'medium', status: 'todo' }
    │
    ▼
Trigger heartbeat → Agent รับงานทันที
```

### 5.2 Paperclip → ERP (Inbound — ใหม่)
**ผ่าน Agent Module:**
```
Paperclip Heartbeat fires
    │
    ▼
HTTP Adapter POST /api/agent/webhook
Body: { runId, agentId, companyId, context: { taskId, wakeReason } }
    │
    ▼
Webhook Handler:
  1. Verify HMAC signature
  2. Lookup paperclip_companies → ได้ tenantId + apiKey
  3. Fetch issue จาก Paperclip API → ได้ title/description
  4. parseIntent(title) → { command, payload }
  5. enqueue(job)
    │
    ▼
Respond 200 immediately (fire-and-forget)
    │
    ▼
Worker polls queue (ทุก 5 วิ)
  1. dequeue → ได้ job
  2. commands[job.command](ctx, payload)
  3. สำเร็จ → complete(job) + addComment กลับ Paperclip
  4. ล้มเหลว → fail(job) + addComment error กลับ
```

### 5.3 Commands ที่ Agent ทำได้

| Command | Input | Output | Action ใน ERP |
|---------|-------|--------|---------------|
| `query_stock` | `{ query: "นมสด" }` | Stock list | SELECT จาก stock_items |
| `query_sales` | `{ period: "30d" }` | Sales summary | Aggregate sales_orders |
| `get_executive_summary` | `{}` | KPI cards | Cross-module aggregation |
| `create_pr` | `{ description }` | PR number | INSERT purchase_requests |
| `create_wo` | `{ description, productId }` | WO number | INSERT work_orders |
| `approve_po` | `{ poId }` | status | UPDATE purchase_orders |

---

## 6. Analytics Module

### 6.1 Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/analytics/executive-summary` | GET | JWT/Agent | KPI รวม: stock, sales, purchase, production |
| `/api/analytics/trends` | GET | JWT/Agent | Time-series รายเดือน (sales + purchase) |
| `/api/analytics/export/:entity` | GET | JWT/Agent | Bulk export JSON (customers, orders, invoices, etc.) |

### 6.2 Use Case: Paperclip วิเคราะห์องค์กร
```
Paperclip CEO Agent → heartbeat → webhook
    │
    ▼
Command: get_executive_summary
    │
    ▼
Worker query ข้าม module:
  - stock_items (total, low_stock, value)
  - sales_orders (30d revenue)
  - purchase_orders (open POs)
  - work_orders (active WO)
    │
    ▼
Return JSON → Paperclip Agent วิเคราะห์ → สร้าง strategy
```

---

## 7. Database Schema ที่เกี่ยวข้อง

### 7.1 `paperclip_companies` (Mapping)
```sql
id                   TEXT PRIMARY KEY
tenant_id            TEXT NOT NULL UNIQUE    -- ERP tenant
paperclip_company_id TEXT NOT NULL UNIQUE    -- Paperclip company UUID
paperclip_api_key    TEXT NOT NULL            -- API key สำหรับ call Paperclip กลับ
webhook_secret       TEXT NOT NULL            -- HMAC secret สำหรับ verify webhook
is_active            INTEGER DEFAULT 1
created_at           TEXT DEFAULT CURRENT_TIMESTAMP
```

### 7.2 `agent_jobs` (Queue)
```sql
id                   TEXT PRIMARY KEY
tenant_id            TEXT NOT NULL
command              TEXT NOT NULL            -- e.g. 'query_stock', 'create_pr'
payload              TEXT                    -- JSON string
paperclip_company_id TEXT
paperclip_issue_id   TEXT
status               TEXT DEFAULT 'pending'  -- pending | running | completed | failed
result               TEXT                    -- JSON string
error                TEXT
attempts             INTEGER DEFAULT 0
created_at           TEXT DEFAULT CURRENT_TIMESTAMP
updated_at           TEXT DEFAULT CURRENT_TIMESTAMP
```

### 7.3 `line_user_mappings` (LINE Linking)
```sql
id           TEXT PRIMARY KEY
tenant_id    TEXT NOT NULL
user_id      TEXT NOT NULL
line_user_id TEXT NOT NULL
role         TEXT NOT NULL
notify_events TEXT DEFAULT '[]'
linked_at    TEXT DEFAULT CURRENT_TIMESTAMP
```

### 7.4 `line_link_tokens` (OTP)
```sql
id         TEXT PRIMARY KEY
tenant_id  TEXT NOT NULL
user_id    TEXT NOT NULL
token      TEXT UNIQUE NOT NULL
expires_at TEXT NOT NULL
created_at TEXT DEFAULT CURRENT_TIMESTAMP
```

---

## 8. Configuration (.env)

```bash
# User Auth
JWT_SECRET=your-user-jwt-secret

# Agent Auth (แยกจาก user)
AGENT_JWT_SECRET=your-agent-jwt-secret

# Paperclip (ทั้งหมด required — ไม่มี fallback แล้ว)
PAPERCLIP_URL=https://your-paperclip.com
PAPERCLIP_API_KEY=pcp_xxxxxxxx
PAPERCLIP_COMPANY_ID=xxxxxxxx
PAPERCLIP_AGENT_ID=xxxxxxxx

# LINE Bot
LINE_CHANNEL_SECRET=xxxx
LINE_CHANNEL_ACCESS_TOKEN=xxxx

# ThaiLLM
THAI_LLM_URL=https://api.aieat.or.th/v1
THAI_LLM_API_KEY=xxxx
THAI_LLM_MODEL=OpenThaiGPT-ThaiLLM-8B-Instruct-v7.2
```

---

## 9. Error Handling & Retry

### 9.1 Agent Job Retry
- Max attempts: 3
- ถ้า fail ครั้งที่ 3 → status = `failed` + addComment error กลับ Paperclip
- ถ้า fail ครั้งที่ 1-2 → status = `pending` (worker จะ pickup ใหม่)

### 9.2 Paperclip API Failure
- `addComment` / `updateIssueStatus` → catch error + console.error (ไม่ throw)
- ไม่ให้ Paperclip failure ทำให้ ERP crash

### 9.3 LINE Bot Failure
- Webhook ตอบ 200 เสมอ (LINE requirement)
- Processing error → log only → ไม่ throw

### 9.4 HMAC Verification Failure
- Invalid signature → log warning + return 200 (ไม่ process)
- ป้องกัน replay attack + unauthorized webhooks

---

## 10. Security Checklist

- [x] Helmet + CSP headers บน Human API
- [x] Global rate limiter (200 req/min) — ยกเว้น `/api/agent/webhook`
- [x] HMAC-SHA256 webhook signature verification
- [x] Agent JWT แยกจาก User JWT (AGENT_JWT_SECRET)
- [x] ลบ `AI_API_KEYS` global bypass (security risk)
- [x] ลบ hardcoded Paperclip credentials จาก source code
- [x] Path traversal fix ใน file upload/delete
- [x] SQL injection fix ใน sqlite-multitenant.ts
- [x] Analytics endpoints read-only + tenant-scoped
- [x] Queue jobs idempotent (same command twice = same result)

---

## 11. Future Extensions

| Feature | Description |
|---------|-------------|
| Bidirectional Sync | ERP event (low stock, approval required) → auto-create Paperclip issue |
| Agent Dashboard | Web UI ดู agent_jobs queue, retry failed jobs |
| More Commands | `create_invoice`, `create_so`, `query_customer`, `generate_report` |
| Streaming Export | `/analytics/export` ใช้ streaming แทน JSON ทั้งก้อน |
| Multi-Company | 1 ERP tenant → หลาย Paperclip companies |
| LLM-in-Agent | Agent worker เรียก LLM เพื่อ interpret payload ซับซ้อน |

---

*สร้างเมื่อ: 2026-04-26*  
*Version: 1.0 (Lean Agent Module)*
