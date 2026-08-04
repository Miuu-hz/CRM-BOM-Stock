# Phopy ERP

ERP ระบบเดียวสำหรับธุรกิจอาหาร/ร้านค้า (Thai food & restaurant business) ครอบคลุมตั้งแต่จัดซื้อ, สต็อก, สูตรการผลิต (BOM), ขาย/POS, ครัว (KDS), QC, บัญชี/ภาษี ไปจนถึง AI assistant ที่คุยผ่าน LINE ได้โดยตรง

This is a **live production ERP**, not a scaffold. It runs today under `pm2` inside an LXC container and is actively used by real staff. This README describes the system as it actually exists in this repo — not an early prototype plan.

> Older versions of this README described an early "CRM-BOM-Stock" scaffold for a bedding/mattress factory on PostgreSQL + Prisma. That was scaffolding from the very first iteration of the project and does not reflect the codebase anymore — see [Tech Stack](#tech-stack) below for what is actually wired up today.

## What it does

- **Purchase** — purchase requests → purchase orders → supplier management (`backend/src/routes/purchase-request.routes.ts`, `purchaseOrder.routes.ts`, `purchase.routes.ts`, `supplier.routes.ts`)
- **Sales** — quotations, sales orders, invoices, receipts, credit notes, delivery orders, backorders, product variants (`backend/src/routes/sales/*`)
- **POS / Cashier / KDS** — point-of-sale billing, register clearing, kitchen display system (`pos-menu.routes.ts`, `pos-bill.routes.ts`, `pos-clearing.routes.ts`, `kds.routes.ts`)
- **Stock** — raw material / WIP / finished goods movements (`stock.routes.ts`, `materials.routes.ts`)
- **BOM & Production** — recipes/bills of materials, work orders, subcontract production (`bom.routes.ts`, `workOrder.routes.ts`, `subcontract.routes.ts`)
- **QC** — quality control checkpoints (`qc.routes.ts`)
- **Accounting & Tax** — chart of accounts, journal entries, budgets, multi-currency, tax, withholding tax (WHT) certificates, period closing (`accounts.routes.ts`, `journal.routes.ts`, `budget.routes.ts`, `currency.routes.ts`, `tax.routes.ts`, `wht-certificate.routes.ts`, `period-closing.routes.ts`)
- **RBAC / Master panel** — role + department based permissions (`MASTER/ADMIN/MANAGER/POWERUSER/USER` × departments), plus a master-only tenant/subscription admin panel (`master.routes.ts`, `middleware/auth.middleware.ts`, `middleware/subscription.middleware.ts`, `config/roles.ts`, `services/rbac.service.ts`)
- **Backup** — scheduled DB backups with Google Drive upload, master-only (`backup.routes.ts`, `services/backup.scheduler.ts`)
- **Kanban SSO** — signed-token single sign-on handoff into a separate Planka/Kanban board (`kanban-sso.routes.ts`)
- **Marketing, approvals, activity log, customer recommendations, dashboard/reports** — supporting modules (`marketing.routes.ts`, `approval.routes.ts`, `activity.routes.ts`, `customerRecommendations.routes.ts`, `dashboard.routes.ts`, `reports.routes.ts`)
- **AI / MCP assistant** — an MCP server exposing search, purchase, sales, stock, production, BOM, and finance tools directly against the live DB (`backend/src/mcp/tools/`: `search.ts`, `summary.ts`, `purchase.ts`, `sales.ts`, `stock.ts`, `production.ts`, `bom.ts`, `finance.ts`). Every create/update tool takes effect immediately and drops a **Draft** for a human to confirm in the web UI — see root [`CLAUDE.md`](./CLAUDE.md) for the exact parsing rules (Thai receipt formats, unit codes, cross-checking bill totals) the assistant follows.
- **LINE bot** — the same MCP tools are also reachable as a LINE chat bot (`backend/src/routes/line-bot.routes.ts`, using `@line/bot-sdk`), so staff can create draft POs/PRs and query stock/sales straight from LINE.

## Tech Stack

### Backend
- **Node.js + Express + TypeScript**
- **Database: raw SQLite via `better-sqlite3`** — schema is hand-written SQL in `backend/src/db/schema.ts` (`applySchema`), migrations in `backend/src/db/migrations.ts`, connection in `backend/src/db/connection.ts` / `backend/src/db/sqlite.ts`. The DB file is `backend/dev.db`.
- **JWT auth** (`jsonwebtoken`), **RBAC** via `services/rbac.service.ts` + `config/roles.ts`
- **Zod** for validation, **express-validator** for route-level checks, **helmet** + **express-rate-limit** for hardening
- **`@modelcontextprotocol/sdk`** for the MCP server (`backend/src/mcp/`)
- **`@line/bot-sdk`** for the LINE bot integration
- **`node-cron`** for scheduled jobs (backups, etc.)

**Prisma and PostgreSQL are dead leftovers, not the real data layer.** `backend/package.json` still lists `@prisma/client`, `prisma`, and `pg` as dependencies, and `backend/prisma/schema.prisma` still exists, but nothing in `backend/src` imports from `db/prisma.ts` — it's an orphaned file left over from the original scaffold. All actual reads/writes go through `better-sqlite3` (`backend/src/db/connection.ts`). Treat any Prisma/`pg` references you find in `package.json` as historical, not active.

### Frontend
- **React 18 + TypeScript + Vite**
- **TailwindCSS**, **Framer Motion**, **Recharts**
- **TanStack Query** for server state, **Zustand** for client state, **React Router**
- **i18next** for Thai/English localization

## Project Structure

```
backend/
  src/
    routes/          # feature route modules (purchase, sales/, pos-*, stock, bom, work orders,
                      #   subcontract, qc, accounts/journal/tax/wht/budget/period-closing,
                      #   master, backup, kanban-sso, marketing, line-bot, ...)
    mcp/
      tools/          # MCP tool groups: search, summary, purchase, sales, stock, production, bom, finance
      server.ts       # MCP server wiring (per-tenant, per-user)
    db/
      schema.ts       # hand-written SQLite schema (applySchema)
      migrations.ts   # incremental migrations run at boot
      connection.ts   # better-sqlite3 connection (real DB layer)
      sqlite.ts       # applies schema + migrations on startup
    middleware/       # auth, RBAC/subscription gating, master gate, rate/time locks
    services/         # rbac, backup, subscription, and other business logic
    agent/            # background job worker + webhook routes (Paperclip issue-tracker integration)
    config/roles.ts   # Role/Department/Resource/Action definitions for RBAC
  dev.db              # SQLite database file (NOT committed, do not touch in production)
frontend/
  src/
    pages/            # Dashboard, CRM, Purchase(+Orders/Requests), Sales, Stock, BOM, WorkOrders,
                       #   Cashier, KDS, QC, Accounting/, Tax/, MasterPanel, Settings, Users/, ...
CLAUDE.md              # AI/MCP assistant behavior rules (Thai bill parsing, unit codes, etc.)
```

## Local Dev Quick Start

```bash
# from repo root
npm run install:all      # installs backend/ and frontend/ deps
npm run dev               # runs backend (nodemon) + frontend (vite) concurrently
```

- Frontend dev server: http://localhost:3000
- Backend API: http://localhost:5000/api

You need `backend/.env` with at least `JWT_SECRET`, `AGENT_JWT_SECRET`, `KANBAN_SSO_SECRET`, `PORT`, `CORS_ORIGIN`, `APP_URL`. Optional integrations (only needed if you use them): `GOOGLE_SERVICE_ACCOUNT_JSON` + `GOOGLE_DRIVE_FOLDER_ID` (DB backup upload), `KANBAN_URL`/`KANBAN_INTERNAL_URL` (Kanban SSO), `PAPERCLIP_URL`/`PAPERCLIP_API_KEY`/`PAPERCLIP_AGENT_ID`/`PAPERCLIP_COMPANY_ID` (issue-tracker webhook agent), `MASTER_GATE_PATH`/`MASTER_GATE_PIN` (master panel gate). No `DATABASE_URL`/Postgres setup is required — the SQLite file is created automatically on first run.

To build for production locally:

```bash
npm run build:all   # tsc for backend, tsc+vite build for frontend
npm start            # node backend/dist/index.js, serves frontend/dist as static files too
```

## Production Deployment

The live system does **not** run via `npm run dev`. It runs as a `pm2` process named `crm-backend` inside a Proxmox LXC container, serving both the API and the built frontend (`express.static`) from the same Node process:

```bash
pm2 list                       # crm-backend
pm2 logs crm-backend
pm2 restart crm-backend        # only after a reviewed, built change — this is live prod
```

The production SQLite database lives at `backend/dev.db` on that same checkout — treat it as a real production database (back it up before any destructive migration, never overwrite it from a dev/test run).

## AI / MCP Assistant

`backend/src/mcp/server.ts` exposes an MCP server per tenant/user with tools grouped by domain (search, summary, purchase, sales, stock, production, bom, finance). The same tool layer backs the LINE bot (`line-bot.routes.ts`), so the assistant works identically whether it's driven through an MCP-compatible client or through a LINE chat. Behavioral rules for the assistant — how to read Thai handwritten market bills vs. tax invoices, unit-code normalization, draft-then-confirm flow — are documented in [`CLAUDE.md`](./CLAUDE.md).

## License

MIT
