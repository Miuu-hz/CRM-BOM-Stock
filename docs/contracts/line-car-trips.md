# Contract: LINE Staff Car Trips & Staff Rich Menu Sub-Menu

## Goal
Enable employees to record car trips (start, up to 10 stops, end, history) from a new LINE staff sub rich menu via the existing one-time login link into the HR self-service web (`/hr/me/trips`), with PDPA location consent, odometer + Google Routes API road distance, automatic 12-hour incomplete closure, server-side anomaly flags, and a manager HR view + company car list (`/hr/trips`).

## Baseline
Commit: `e22f1fe2a68ace99caf06dacfe66b5ef72ff78c9`
Repo: `/root/review/crm-1124-line` (backend: TypeScript + Express + better-sqlite3 + vitest; frontend: React + TypeScript + Tailwind + vitest).

## Targets (Every File Modify / Create)

### W1 — Backend Data, API, Google Routes, Flags, Scheduler, Tests
- **Modify** `backend/src/db/migrations.ts`
- **Modify** `backend/src/index.ts`
- **Create** `backend/src/services/hr/carTripFlags.ts`
- **Create** `backend/src/services/hr/googleRoutes.service.ts`
- **Create** `backend/src/services/hr/carTrip.service.ts`
- **Create** `backend/src/routes/hr.trip.routes.ts`
- **Create** `backend/src/routes/hr.trip.test.ts`

### W2 — LINE Bot, Rich Menu, Aliases, Image Generator, PNGs, Tests
- **Modify** `backend/src/services/line-richmenu.service.ts`
- **Modify** `backend/src/services/line-bot.service.ts`
- **Modify** `backend/src/services/line-flex-templates.ts`
- **Modify** `backend/scripts/gen-richmenu.mjs`
- **Modify** `backend/assets/line-richmenu/staff.png`
- **Create** `backend/assets/line-richmenu/staff_car.png`
- **Create** `backend/src/services/line-richmenu.test.ts`
- **Create** `backend/src/services/line-bot.trips.test.ts`

### W3 — Frontend Pages, API Client, Routing, Nav, i18n, Tests
- **Modify** `frontend/src/App.tsx`
- **Modify** `frontend/src/pages/LineLogin.tsx`
- **Modify** `frontend/src/pages/HR/MyHr.tsx`
- **Modify** `frontend/src/components/layout/HrTabs.tsx`
- **Modify** `frontend/src/components/layout/HrTabs.test.tsx`
- **Modify** `frontend/src/config/menuPermissions.ts`
- **Modify** `frontend/src/i18n/locales/th/translation.json`
- **Modify** `frontend/src/i18n/locales/en/translation.json`
- **Create** `frontend/src/services/hrTrip.service.ts`
- **Create** `frontend/src/pages/HR/MyTrips.tsx`
- **Create** `frontend/src/pages/HR/CarTrips.tsx`
- **Create** `frontend/src/pages/HR/MyTrips.test.tsx`
- **Create** `frontend/src/pages/HR/CarTrips.test.tsx`
- **Create** `frontend/src/pages/LineLogin.test.tsx`

## Do Not Touch
- Payroll or accounting files/tables (`hr.payroll.*`, `journal*`, `accounts*`, `Payroll.tsx`, `HrSettings.tsx`).
- Existing check-in (`hr.checkin.routes.ts`, `CheckinKiosk.tsx`, `LocationPickerMap.tsx`, check-in section of `MyHr.tsx`).
- Approvals (`approval.routes.ts`, `approvalGate.service.ts`, `ApprovalInbox.tsx`).
- LINE push / quota code (`pushToUser`, `pushToRole`, `claimPush`, `line_push_counts`, `hrExpiry.scheduler.ts`).
- `backend/src/middleware/hrSelfScope.ts`, `backend/src/routes/auth.routes.ts`, `frontend/src/services/hr.service.ts`.
- `/opt/crm` or `/root` (no temp/backup files).
- `package.json` / lockfiles (no new npm dependencies).

## Constraints
- **No new npm dependency** (use Node 20 built-in `fetch` + `AbortController`, existing `@line/bot-sdk`, `node-cron`, `better-sqlite3`, `lucide-react`, `react-hot-toast`).
- **Tenant isolation everywhere**: every SQL query and JOIN filters `tenant_id = req.user!.tenantId`; cross-tenant IDs return `404` (never `403`).
- **Audit-friendly**: no hard delete of trips (`DELETE /api/hr/trips*` must not exist); vehicles deactivate via `is_active = 0`.
- **No push messages** anywhere in this feature; LINE bot uses `replyMessage` only (free).
- **No straight-line / haversine distance fallback** for car trips.
- **No logging of secrets or coordinates**: never log `GOOGLE_ROUTES_API_KEY` or `lat`/`lng` in `console.*`, `route_error`, or `line_event_logs`.
- **Zero background GPS tracking**: GPS is read only on user-initiated Start, Add Stop, and End actions.
- **Response envelope**: `{ success: true, data }` (201 on create, 200 otherwise) / `{ success: false, message: '<Thai>', code?: '<CODE>' }`.
- **CSS & UI**: use existing `phopy-card`, `phopy-table`, `phopy-btn-primary`, and CSS variables (`var(--surface)`, `var(--fg-1)`, etc.) — no hardcoded hex colors for surfaces/text.
- **Do not use `<Link>` / `useNavigate` inside `MyHr.tsx`** (`MyHr.test.tsx` renders `<MyHr />` without Router) — use `<a href="/hr/me/trips">`.

## Done When
1. `cd backend && npm run build && npm test` passes with all existing + new tests green.
2. `cd frontend && npm run build && npm test` passes with all existing + new tests green.
3. All numbered checklist steps below and all test cases in Section (4) pass.
4. No files modified outside Targets; no `.bak` or scratch files left behind.

---

## Numbered Implementation Steps

### Step 1 — Database DDL (`backend/src/db/migrations.ts`)
- [ ] Append inside `runMonthCloseMigrations(db)` wrapped in `try { db.exec(\`...\`) } catch (e) { console.error('⚠️ HR Car Trips migration error:', e) }`:

```sql
CREATE TABLE IF NOT EXISTS hr_vehicles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  plate_no TEXT NOT NULL,
  label TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, plate_no)
);
CREATE INDEX IF NOT EXISTS idx_hr_vehicles_tenant ON hr_vehicles(tenant_id, is_active);

CREATE TABLE IF NOT EXISTS hr_trip_consents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  UNIQUE(tenant_id, employee_id, consent_version)
);
CREATE INDEX IF NOT EXISTS idx_hr_trip_consents_emp ON hr_trip_consents(tenant_id, employee_id);

CREATE TABLE IF NOT EXISTS hr_car_trips (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  vehicle_id TEXT NULL,
  car_type TEXT NOT NULL CHECK (car_type IN ('COMPANY', 'PRIVATE')),
  plate_no TEXT NOT NULL,
  vehicle_label TEXT,
  purpose TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'COMPLETED', 'INCOMPLETE')),
  started_at TEXT NOT NULL,
  start_odometer REAL NOT NULL,
  start_lat REAL NOT NULL,
  start_lng REAL NOT NULL,
  start_accuracy_m REAL,
  prev_vehicle_end_odometer REAL,
  ended_at TEXT,
  end_odometer REAL,
  end_lat REAL,
  end_lng REAL,
  end_accuracy_m REAL,
  odometer_km REAL,
  duration_sec INTEGER,
  map_distance_m INTEGER,
  map_distance_km REAL,
  map_duration_sec INTEGER,
  route_status TEXT NOT NULL DEFAULT 'NONE' CHECK (route_status IN ('NONE', 'PENDING', 'OK', 'FAILED', 'UNAVAILABLE', 'SKIPPED')),
  route_error TEXT,
  route_fetched_at TEXT,
  flags_json TEXT NOT NULL DEFAULT '[]',
  close_reason TEXT,
  auto_closed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Enforces at most ONE OPEN trip per employee even under concurrent race conditions
CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_car_trips_open_emp
  ON hr_car_trips(tenant_id, employee_id) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_hr_car_trips_tenant_started
  ON hr_car_trips(tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_hr_car_trips_emp
  ON hr_car_trips(tenant_id, employee_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_hr_car_trips_vehicle
  ON hr_car_trips(tenant_id, vehicle_id, status, ended_at DESC);

CREATE TABLE IF NOT EXISTS hr_car_trip_stops (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  trip_id TEXT NOT NULL REFERENCES hr_car_trips(id),
  seq INTEGER NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  accuracy_m REAL,
  note TEXT,
  recorded_at TEXT NOT NULL,
  UNIQUE(trip_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_hr_car_trip_stops_trip ON hr_car_trip_stops(tenant_id, trip_id, seq);
```

### Step 2 — Validation, Flags & Constants (`backend/src/services/hr/carTripFlags.ts`)
- [ ] Export constants & pure functions:
  - `export const TRIP_CONSENT_VERSION = '1.0'`
  - `export const TRIP_MAX_OPEN_MS = 12 * 60 * 60 * 1000`
  - `export const TRIP_MAX_STOPS = 10`
  - `export const POOR_GPS_ACCURACY_M = 150`
  - `export const ODOMETER_DIFF_RATIO = 0.20`
  - `export const DURATION_RATIO = 2.0`
  - `export const DURATION_MIN_EXCESS_SEC = 30 * 60`
  - `export type TripFlagCode = 'ODOMETER_MISMATCH' | 'DURATION_EXCESSIVE' | 'ODOMETER_ROLLBACK' | 'POOR_GPS'`
  - `export function validateCoords(input: { lat?: unknown; lng?: unknown; accuracy_m?: unknown }): { ok: true; lat: number; lng: number; accuracy_m: number | null } | { ok: false; message: string }`
    - Reject non-finite, boolean, empty string, `lat < -90 || lat > 90`, `lng < -180 || lng > 180`, or `(lat === 0 && lng === 0)` → `'พิกัด GPS ไม่ถูกต้อง กรุณาเปิดตำแหน่งแล้วลองใหม่'`.
    - If `accuracy_m` is present and not `null`: reject non-finite, boolean, `< 0`, or `> 100000` → `'ค่าความแม่นยำ GPS ไม่ถูกต้อง'`.
  - `export function validateOdometer(val: unknown): { ok: true; value: number } | { ok: false; message: string }`
    - Reject boolean, empty, non-finite, `< 0`, `> 9_999_999` → `'เลขไมล์ต้องเป็นตัวเลขตั้งแต่ 0 ถึง 9,999,999'`.
  - `export function computeTripFlags(input: { carType: 'COMPANY' | 'PRIVATE'; startOdometer: number; prevVehicleEndOdometer: number | null; odometerKm: number | null; mapDistanceKm: number | null; durationSec: number | null; mapDurationSec: number | null; accuracies: (number | null)[] }): TripFlagCode[]`
    - `ODOMETER_MISMATCH`: `odometerKm != null && mapDistanceKm != null && (mapDistanceKm > 0 ? Math.abs(odometerKm - mapDistanceKm) > mapDistanceKm * 0.20 : odometerKm >= 1)`.
    - `DURATION_EXCESSIVE`: `durationSec != null && mapDurationSec != null && durationSec > mapDurationSec * 2 && (durationSec - mapDurationSec) >= 1800`.
    - `ODOMETER_ROLLBACK`: `carType === 'COMPANY' && prevVehicleEndOdometer != null && startOdometer < prevVehicleEndOdometer`.
    - `POOR_GPS`: `accuracies.some(a => a === null || !Number.isFinite(a) || a > POOR_GPS_ACCURACY_M)`.

### Step 3 — Google Routes API Client (`backend/src/services/hr/googleRoutes.service.ts`)
- [ ] Export:
  - `export interface RoutePoint { lat: number; lng: number }`
  - `export type RouteComputeResult = { status: 'OK'; distanceMeters: number; distanceKm: number; durationSec: number } | { status: 'UNAVAILABLE'; errorCode: 'NO_API_KEY' } | { status: 'FAILED'; errorCode: string }`
  - `export async function computeRoadRoute(origin: RoutePoint, destination: RoutePoint, intermediates: RoutePoint[], opts?: { apiKey?: string; timeoutMs?: number; fetchFn?: typeof fetch }): Promise<RouteComputeResult>`
- [ ] Behavior:
  - Read `apiKey = (opts?.apiKey ?? process.env.GOOGLE_ROUTES_API_KEY ?? '').trim()`.
  - If `!apiKey` → immediately return `{ status: 'UNAVAILABLE', errorCode: 'NO_API_KEY' }` without calling `fetch`.
  - Call `POST https://routes.googleapis.com/directions/v2:computeRoutes` with `AbortController` timeout `opts?.timeoutMs ?? Number(process.env.GOOGLE_ROUTES_TIMEOUT_MS || 5000)`.
  - Headers: `'Content-Type': 'application/json'`, `'X-Goog-Api-Key': apiKey`, `'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration'`.
  - Body: `{ origin: { location: { latLng: { latitude, longitude } } }, destination: { ... }, ...(intermediates.length ? { intermediates: [...] } : {}), travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE' }`.
  - Parse `routes[0].distanceMeters` (finite number `>= 0`) and `routes[0].duration` (`/^(\d+(?:\.\d+)?)s$/`). If `routes` is empty/malformed → `{ status: 'FAILED', errorCode: 'NO_ROUTE' }`.
  - On HTTP non-2xx → `{ status: 'FAILED', errorCode: \`HTTP_${res.status}\` }`.
  - On abort/timeout → `{ status: 'FAILED', errorCode: 'TIMEOUT' }`.
  - On network/parse error → `{ status: 'FAILED', errorCode: 'NETWORK_ERROR' }`.
  - **NEVER** compute haversine/straight-line fallback. **NEVER** log `apiKey` or coordinates.

### Step 4 — Trip Service, Lazy + Scheduled 12h Close (`backend/src/services/hr/carTrip.service.ts`)
- [ ] Export:
  - `export function closeExpiredTrips(opts?: { tenantId?: string; employeeId?: string; nowMs?: number }): number`
    - Cutoff `cutoffIso = new Date((opts?.nowMs ?? Date.now()) - TRIP_MAX_OPEN_MS).toISOString()`.
    - Updates `hr_car_trips SET status = 'INCOMPLETE', ended_at = NULL, end_odometer = NULL, odometer_km = NULL, duration_sec = NULL, map_distance_m = NULL, map_distance_km = NULL, map_duration_sec = NULL, route_status = 'SKIPPED', close_reason = 'EXPIRED_12H', auto_closed_at = ?, updated_at = ? WHERE status = 'OPEN' AND started_at <= ?` (scoped by `tenant_id` / `employee_id` when passed).
  - `export function startCarTripExpiryScheduler(): void`
    - Uses `cron.schedule('*/15 * * * *', () => { try { closeExpiredTrips() } catch (e) { console.error('[CarTrip] expiry sweep failed', e) } })` (no push messages).
  - `export function buildGoogleMapsLinks(trip, stops)`:
    - `start_map_url`: `https://www.google.com/maps/search/?api=1&query=${trip.start_lat},${trip.start_lng}`
    - `end_map_url`: `trip.end_lat != null && trip.end_lng != null ? https://www.google.com/maps/search/?api=1&query=${trip.end_lat},${trip.end_lng} : null`
    - `route_map_url`: when `end_lat != null && end_lng != null`, `https://www.google.com/maps/dir/?api=1&origin=${start_lat},${start_lng}&destination=${end_lat},${end_lng}` + (stops.length ? `&waypoints=${stops.map(s => `${s.lat},${s.lng}`).join('|')}` : '') + `&travelmode=driving`; else `start_map_url`.
    - Each stop also gets `map_url: https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`.

### Step 5 — Backend REST API (`backend/src/routes/hr.trip.routes.ts` + mount in `backend/src/index.ts`)
- [ ] Mount `app.use('/api/hr', hrTripRoutes)` in `backend/src/index.ts` (under existing `authenticate, subscriptionGate('hr')`) and call `startCarTripExpiryScheduler()` in `app.listen(...)`.
- [ ] Fixed Shared API Shape (used unchanged by W1 and W3):

```ts
export type CarType = 'COMPANY' | 'PRIVATE'
export type TripStatus = 'OPEN' | 'COMPLETED' | 'INCOMPLETE'
export type RouteStatus = 'NONE' | 'PENDING' | 'OK' | 'FAILED' | 'UNAVAILABLE' | 'SKIPPED'
export type TripFlagCode = 'ODOMETER_MISMATCH' | 'DURATION_EXCESSIVE' | 'ODOMETER_ROLLBACK' | 'POOR_GPS'

export interface HrVehicle {
  id: string
  plate_no: string
  label: string | null
  is_active: boolean
  notes: string | null
  last_end_odometer: number | null
  created_at: string
  updated_at: string
}

export interface MyVehicleOption {
  id: string
  plate_no: string
  label: string | null
}

export interface TripConsentStatus {
  accepted: boolean
  version: string
  accepted_at: string | null
  notice_text: string
}

export interface CarTripStop {
  id: string
  seq: number
  lat: number
  lng: number
  accuracy_m: number | null
  note: string | null
  recorded_at: string
  map_url: string
}

export interface CarTripBase {
  id: string
  employee_id: string
  employee_code: string
  employee_name: string
  vehicle_id: string | null
  car_type: CarType
  plate_no: string
  vehicle_label: string | null
  purpose: string | null
  status: TripStatus
  started_at: string
  start_odometer: number
  start_lat: number
  start_lng: number
  start_accuracy_m: number | null
  ended_at: string | null
  end_odometer: number | null
  end_lat: number | null
  end_lng: number | null
  end_accuracy_m: number | null
  odometer_km: number | null
  duration_sec: number | null
  map_distance_km: number | null
  map_duration_sec: number | null
  route_status: RouteStatus
  close_reason: string | null
  stops: CarTripStop[]
  start_map_url: string
  end_map_url: string | null
  route_map_url: string
}

// Manager view ONLY (never returned by /api/hr/me/trips*)
export interface ManagerCarTrip extends CarTripBase {
  flags: TripFlagCode[]
  prev_vehicle_end_odometer: number | null
  route_error: string | null
  route_fetched_at: string | null
}

export interface MyTripsStatus {
  consent: TripConsentStatus
  open_trip: CarTripBase | null
  vehicles: MyVehicleOption[]
  max_stops: number // 10
}
```

- [ ] Endpoints & **Security Checks Per Endpoint**:

| # | Method & Path | Permission / Scope | Security & Validation Checks | Response |
|---|---|---|---|---|
| T1 | `GET /api/hr/me/trips/status` | Self (`hr_self` allowed) | `authenticate` + `subscriptionGate('hr')` + `getSelfEmployee(tenantId, userId)` (`ACTIVE`, else `404`). Lazily runs `closeExpiredTrips({ tenantId, employeeId })`. Omits `flags`, `route_error`, `prev_vehicle_end_odometer`. | `200` `MyTripsStatus` |
| T2 | `GET /api/hr/me/vehicles` | Self (`hr_self` allowed) | `getSelfEmployee` (`ACTIVE`, else `404`). Filters `tenant_id = ? AND is_active = 1`. | `200` `MyVehicleOption[]` |
| T3 | `POST /api/hr/me/trips/consent` | Self (`hr_self` allowed) | `getSelfEmployee` (`ACTIVE`, else `404`). Body `{ consent: true, version?: '1.0' }`; if `consent !== true` → `400 'กรุณายอมรับเงื่อนไขการเก็บตำแหน่ง (PDPA)'`. Upserts `hr_trip_consents` with `(tenant_id, employee_id, user_id, '1.0', now)`. | `200` `TripConsentStatus` |
| T4 | `POST /api/hr/me/trips/start` | Self (`hr_self` allowed) | `getSelfEmployee` (`ACTIVE`, else `404`). **Consent check**: row for `(tenantId, emp.id, '1.0')` must exist else `403` `code: 'CONSENT_REQUIRED'` (save nothing). Validate `lat`/`lng`/`accuracy_m` (`400`), `start_odometer` (`400`), `car_type` (`COMPANY` requires active `vehicle_id` in same tenant else `400`/`404`; `PRIVATE` requires trimmed `plate_no` 1–30 chars else `400`), `purpose` ≤ 500 chars. Inside `db.transaction`: call `closeExpiredTrips({ tenantId, employeeId })`, lookup `prev_vehicle_end_odometer` (if `COMPANY`), compute initial flags (`ODOMETER_ROLLBACK`, `POOR_GPS`), `INSERT` into `hr_car_trips` (catch `SQLITE_CONSTRAINT_UNIQUE` → `409 'คุณมีทริปที่เปิดอยู่แล้ว กรุณาจบทริปเดิมก่อน'`). | `201` `CarTripBase` (no `flags`) |
| T5 | `POST /api/hr/me/trips/:id/stops` | Self (`hr_self` allowed) | `getSelfEmployee` (`ACTIVE`, else `404`). **Consent check** (`403 CONSENT_REQUIRED`). Validate `lat`/`lng`/`accuracy_m` (`400`), optional `note` ≤ 200 chars (`400`). Inside `db.transaction`: fetch trip by `id AND tenant_id AND employee_id` (else `404 'ไม่พบทริปนี้'`), run `closeExpiredTrips({ tenantId, employeeId })`, re-check status: if `INCOMPLETE` → `409 'ทริปเปิดเกิน 12 ชั่วโมง ระบบปิดเป็นไม่สมบูรณ์แล้ว'`, if `COMPLETED` → `409 'ทริปนี้ถูกปิดไปแล้ว'`, count stops: if `>= 10` → `409 'แวะจุดได้สูงสุด 10 จุดต่อทริป'`, insert stop with `seq = count + 1`, recompute `POOR_GPS` flag. | `201` `CarTripBase` (no `flags`) |
| T6 | `POST /api/hr/me/trips/:id/end` | Self (`hr_self` allowed) | `getSelfEmployee` (`ACTIVE`, else `404`). **Consent check** (`403 CONSENT_REQUIRED`). Validate `lat`/`lng`/`accuracy_m` (`400`), `end_odometer` (`400`). Inside `db.transaction`: fetch trip by `id AND tenant_id AND employee_id` (else `404`), run `closeExpiredTrips({ tenantId, employeeId })`, re-check status (`INCOMPLETE` → `409`, `COMPLETED` → `409`), check `end_odometer >= start_odometer` (else `400 'เลขไมล์สิ้นสุดต้องมากกว่าหรือเท่ากับเลขไมล์เริ่มต้น'`), compute `odometer_km` & `duration_sec`, save `status = 'COMPLETED'`, `route_status = hasKey ? 'PENDING' : 'UNAVAILABLE'`, `route_error = hasKey ? null : 'NO_API_KEY'`, initial flags. **After commit**: if `hasKey`, call `computeRoadRoute(start, end, stops)` (timeout 5s, never throws), then `UPDATE` `map_distance_m/km`, `map_duration_sec`, `route_status`, `route_error`, `route_fetched_at`, and recomputed `flags_json`. Return saved `CarTripBase` (no `flags`). | `200` `CarTripBase` (no `flags`) |
| T7 | `GET /api/hr/me/trips` | Self (`hr_self` allowed) | `getSelfEmployee` (`ACTIVE`, else `404`). Lazily runs `closeExpiredTrips({ tenantId, employeeId })`. Optional `?from=&to=` (`YYYY-MM-DD`, Thai date). Strictly filters `tenant_id = ? AND employee_id = ?`, `LIMIT 200`, `ORDER BY started_at DESC`. Omits `flags`. | `200` `CarTripBase[]` |
| T8 | `GET /api/hr/trips` | `hr:read` (`hr_self` blocked `403`) | `requirePermission('hr', 'read')`. Lazily runs `closeExpiredTrips({ tenantId })`. Filters strictly by `t.tenant_id = ?` + optional `?from=&to=&employee_id=&vehicle_id=&car_type=&plate=&status=&flagged=1`. Validates `from`/`to` ISO dates (`400`). `ORDER BY t.started_at DESC LIMIT 500`. Returns `ManagerCarTrip[]` (includes `flags`, `prev_vehicle_end_odometer`, `route_error`, map links). | `200` `ManagerCarTrip[]` |
| T9 | `POST /api/hr/trips/:id/retry-route` | `hr:write` (`hr_self` blocked `403`) | `requirePermission('hr', 'write')`. Fetch trip by `id AND tenant_id` (else `404`). Must be `COMPLETED` (else `409 'คำนวณใหม่ได้เฉพาะทริปที่จบแล้ว'`). If `route_status === 'OK'` → `409 'คำนวณระยะทางแผนที่เรียบร้อยแล้ว'`. If no API key → `503 'ยังไม่ได้ตั้งค่า Google Routes API Key'` (no outbound request). Calls `computeRoadRoute`, updates DB + recomputes flags, returns updated `ManagerCarTrip`. | `200` `ManagerCarTrip` |
| T10 | `GET /api/hr/vehicles` | `hr:read` (`hr_self` blocked `403`) | `requirePermission('hr', 'read')`. Filters `v.tenant_id = ?` (+ optional `?active=1`), attaches `last_end_odometer` from latest `COMPLETED` trip in same tenant. `ORDER BY v.is_active DESC, v.plate_no ASC`. | `200` `HrVehicle[]` |
| T11 | `POST /api/hr/vehicles` | `hr:write` (`hr_self` blocked `403`) | `requirePermission('hr', 'write')`. `plate_no` required (trimmed, 1–30 chars), `label` ≤ 100 chars, `notes` ≤ 500 chars. Duplicate `(tenant_id, plate_no)` → `409 'มีทะเบียนรถนี้ในระบบแล้ว'`. | `201` `HrVehicle` |
| T12 | `PUT /api/hr/vehicles/:id` | `hr:write` (`hr_self` blocked `403`) | `requirePermission('hr', 'write')`. Lookup by `id AND tenant_id` (else `404 'ไม่พบรถบริษัท'`). Update `plate_no`, `label`, `is_active`, `notes`. Duplicate plate → `409`. | `200` `HrVehicle` |

### Step 6 — LINE Rich Menu, Sub-Menu, Aliases & Generator (W2)
- [ ] `backend/src/services/line-richmenu.service.ts`:
  - Keep `export type MenuKey = 'guest' | 'staff' | 'manager' | 'exec'` and add `export type RichMenuKey = MenuKey | 'staff_car'`.
  - Add helper `export function getMyTasksUrl(): string | null`: reads `process.env.MY_TASKS_URL?.trim()`; validates `new URL(v)` with `protocol === 'https:' || protocol === 'http:'`; returns URL string or `null`.
  - Add `richMenuSwitch = (aliasId: string, to: RichMenuKey) => ({ type: 'richmenuswitch', richMenuAliasId: aliasId, data: \`action=richmenu_switch&to=${to}\` })`.
  - Export `export const RICH_MENU_ALIASES: Record<'staff' | 'staff_car', string> = { staff: 'phopy-staff', staff_car: 'phopy-staff-car' }`.
  - Keep `exec`, `manager`, `guest` identical to baseline.
  - Update `staff` (4×2):
    - Row 1: `['เช็คอิน', msg('เช็คอิน')]`, `['ขอลา', msg('ขอลา')]`, `['ตารางกะ', msg('ตารางกะ')]`, `['ขอเบิก', msg('ขอเบิก')]`
    - Row 2: `['งานของฉัน', myTasksUrl ? uri(myTasksUrl) : msg('งานของฉัน')]`, `['ใช้งานรถยนต์', richMenuSwitch('phopy-staff-car', 'staff_car')]`, `MINE`, `ACCOUNT`
    - Build `staff` action for `งานของฉัน` dynamically inside `buildRichMenu('staff')` (so env change in tests/runtime takes effect cleanly) and include `getMyTasksUrl() ?? ''` and `RICH_MENU_ALIASES` in `version()`.
  - Add `staff_car` (4×1, `2500 × 843`):
    - `chatBarText: 'ใช้งานรถยนต์'`, `label: 'ใช้งานรถยนต์'`, `cols: 4`, buttons:
      1. `['เริ่ม/จบทริป', msg('เริ่ม/จบทริป')]`
      2. `['แวะจุด', msg('แวะจุด')]`
      3. `['ประวัติทริป', msg('ประวัติทริป')]`
      4. `['กลับเมนูหลัก', richMenuSwitch('phopy-staff', 'staff')]`
  - In `create()` (order is critical):
    1. Create all 5 rich menus (`guest`, `staff`, `staff_car`, `manager`, `exec`) and upload `<key>.png`.
    2. Upsert both aliases (`phopy-staff -> ids.staff`, `phopy-staff-car -> ids.staff_car`) **BEFORE** deleting old rich menus: try `api.updateRichMenuAlias(aliasId, { richMenuId })`; if 404 (not found), call `api.createRichMenuAlias({ richMenuAliasId: aliasId, richMenuId })`.
    3. `await api.setDefaultRichMenu(ids.guest)`.
    4. Save `JSON.stringify({ version: ver, ids, aliases: RICH_MENU_ALIASES })` in `line_channels.rich_menus`.
    5. Relink existing users using `menuKeyForRole(effectiveRole(u))` (never `'staff_car'`).
    6. Delete old rich menu IDs from `saved?.ids` (safe now that aliases point to new IDs).
    7. Delete any stale `phopy-*` alias returned by `getRichMenuAliasList()` that is not in `Object.values(RICH_MENU_ALIASES)` (best-effort `try/catch`).
  - In `syncUser(tenantId, token, lineUserId, key: MenuKey | null, opts?: { force?: boolean })`:
    - Cache key: `lineUserId`, cache value: `${ver}:${key ?? 'guest'}` (base role menu family, NOT raw `richMenuId`).
    - If `!opts?.force && linkedMenu.get(lineUserId) === tag`, return immediately (does NOT call `linkRichMenuIdToUser`, so user stays in `staff_car`).
    - On cache miss when `!opts?.force && key === 'staff'`: call `api.getRichMenuIdOfUser(lineUserId)` (wrapped in `try/catch`); if current menu ID is `ids.staff` OR `ids.staff_car`, set `linkedMenu.set(lineUserId, tag)` and return without relinking!
    - Otherwise link `ids[key]` (or `unlinkRichMenuIdFromUser` when `key === null`) and set `linkedMenu.set(lineUserId, tag)`.
  - Export `resetRichMenuCache()` for unit tests (clears `VER`, `ensuring`, `linkedMenu`).
- [ ] `backend/scripts/gen-richmenu.mjs` + regenerate `staff.png` & create `staff_car.png`:
  - Compute `rows = Math.ceil(btns.length / 4)` and `height = 843 * rows` (so 4×2 = `2500×1686`, 4×1 = `2500×843`).
  - `staff` cards: `['เช็คอิน', 'ลงเวลาเข้างาน', 'log-in']`, `['ขอลา', 'ยื่นใบลา', 'calendar-x', 'amber']`, `['ตารางกะ', 'กะงานของฉัน', 'calendar-days', 'blue']`, `['ขอเบิก', 'เบิกเงินล่วงหน้า', 'hand-coins', 'amber']`, `['งานของฉัน', 'ระบบจัดการงาน', 'briefcase', 'blue']`, `['ใช้งานรถยนต์', 'เริ่ม/จบทริป · แวะจุด', 'car', 'green']`, `['ของฉัน', 'สลิป · เอกสาร · ข้อมูล', 'user-round', 'green']`, `['บัญชีของฉัน', 'บริษัท · ตำแหน่ง', 'circle-user-round', 'gray']`.
  - `staff_car` cards: `['เริ่ม/จบทริป', 'บันทึกไมล์ · GPS', 'car']`, `['แวะจุด', 'ปักพิกัดจุดแวะ', 'map-pin', 'amber']`, `['ประวัติทริป', 'รายการเดินทางของฉัน', 'history', 'blue']`, `['กลับเมนูหลัก', 'เมนูพนักงาน', 'arrow-left', 'gray']`.
- [ ] `backend/src/services/line-bot.service.ts` + `line-flex-templates.ts`:
  - Update `createLoginLink(tenantId: string, userId: string, target?: 'trips' | 'trips_stop' | 'trips_history'): string` → appends `&to=${target}` only when `target` is provided.
  - Handle `"งานของฉัน"` (before LLM fallback):
    - If `getMyTasksUrl()` returns URL → reply buttons template `{ title: 'งานของฉัน', text: 'เปิดระบบงานภายนอก', actions: [{ type: 'uri', label: 'เปิดงานของฉัน', uri: url }] }`.
    - If `null` → reply `{ type: 'text', text: 'ระบบงานของฉันยังไม่เปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ' }`.
  - Handle car trip commands (`'เริ่ม/จบทริป'`, `'เริ่มทริป'`, `'จบทริป'`, `'ใช้งานรถยนต์'` → target `'trips'`; `'แวะจุด'` → target `'trips_stop'`; `'ประวัติทริป'` → target `'trips_history'`):
    - Same guards as `selfCmd`: private chat only (`src !== 'user'` → `🔒 "${text}" ใช้ได้ในแชทส่วนตัวกับบอทเท่านั้นครับ`), linked `ACTIVE` employee (`SELECT 1 FROM employees WHERE tenant_id = ? AND user_id = ? AND status = 'ACTIVE'`, else `'บัญชีนี้ยังไม่ได้ผูกกับทะเบียนพนักงาน\nให้ฝ่ายบุคคลผูกบัญชีผู้ใช้ในหน้าพนักงานก่อนครับ'`).
    - Reply with free `replyMessage` buttons template using `this.createLoginLink(tenantId, me.user_id, target)` (`'ลิงก์ใช้ได้ครั้งเดียว ภายใน 5 นาที'`).
  - Keep existing typed commands (`สลิป`, `สต็อก xxx`, `สถานะ`) working unchanged.
  - In `postback` handler: if `action === 'richmenu_switch'`, return immediately without replying (silent ack).
  - Update `helpCard('staff')` in `line-flex-templates.ts` to include `เริ่ม/จบทริป`, `แวะจุด`, `ประวัติทริป` alongside typed commands (`สลิป`, `สต็อก [ชื่อ]`, `สถานะ`).

### Step 7 — Frontend Self-Service & Manager Web (W3)
- [ ] `frontend/src/pages/LineLogin.tsx`:
  - Map `?to=` strictly through allowlist:
    `const TARGETS: Record<string, string> = { trips: '/hr/me/trips', trips_stop: '/hr/me/trips?action=stop', trips_history: '/hr/me/trips?tab=history' }`
  - `window.location.replace(TARGETS[to] ?? '/hr/me')`.
- [ ] `frontend/src/App.tsx`:
  - In `scope === 'hr_self'` branch: render `<MyTrips />` if `location.pathname === '/hr/me/trips'`, else `<MyHr />`.
  - In main `<Routes>`: add `<Route path="/hr/trips" element={<Guard path="/hr/trips"><CarTrips /></Guard>} />` inside `<Route element={<HrTabs />}>`, and `<Route path="/hr/me/trips" element={<Guard path="/hr/me/trips"><MyTrips /></Guard>} />` next to `/hr/me`.
- [ ] `frontend/src/components/layout/HrTabs.tsx`, `HrTabs.test.tsx`, `menuPermissions.ts`, `th/translation.json`, `en/translation.json`:
  - Add `{ path: '/hr/trips', tKey: 'sidebar.hrTrips' }` to `hrTime` in `HrTabs.tsx` and update `HrTabs.test.tsx`.
  - Add `'/hr/trips'` and `'/hr/me/trips'` to `MENU_PERMISSIONS` (`ALL_ROLES`) and `MENU_REQUIRED_FEATURES` (`'hr'`).
  - Add `sidebar.hrTrips`: TH `"ใช้งานรถยนต์"`, EN `"Car Trips"`.
- [ ] `frontend/src/pages/HR/MyHr.tsx`:
  - Add a compact "ใช้งานรถยนต์" card with `<a href="/hr/me/trips">` button `"เปิดหน้าบันทึกการใช้งานรถยนต์"` (no `react-router-dom` hook/component so `MyHr.test.tsx` remains green).
- [ ] `frontend/src/services/hrTrip.service.ts`:
  - Implements typed methods for T1–T12 using `api` from `./api`.
- [ ] `frontend/src/pages/HR/MyTrips.tsx`:
  - Back link `<a href="/hr/me">← กลับหน้าของฉัน</a>`.
  - Tabs: `บันทึกทริป` / `ประวัติทริป` (initial tab `'history'` when `?tab=history`).
  - **PDPA Consent Gate**: if `!status.consent.accepted`, render Thai PDPA notice + checkbox + `"ยินยอมและดำเนินการต่อ"` button; hide/disable start form until accepted.
  - **GPS helper**: `navigator.geolocation.getCurrentPosition` with `{ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }`; displays accuracy (`±N ม.`); clear Thai permission-denied instructions + retry button.
  - **Start Trip Form** (when `!open_trip`): car type toggle (`รถบริษัท` dropdown / `รถส่วนตัว` plate input), required typed odometer number (no photo upload), optional purpose, submit button `"เริ่มทริป"`.
  - **Open Trip View** (when `open_trip`): prominent success/status banner `"บันทึกเริ่มทริปแล้ว — ออกเดินทางได้เลยครับ"` (and ongoing `"กำลังเดินทาง"`), car, start time, start odometer, stops list (`N/10`), `"แวะจุด"` form (auto-focused if `?action=stop`, disabled at 10 stops), `"จบทริป"` form (end odometer `>= start_odometer` + fresh GPS).
  - **History Tab**: own trips list (no manager flags).
- [ ] `frontend/src/pages/HR/CarTrips.tsx`:
  - Two tabs: `"บันทึกการเดินทาง"` and `"รถบริษัท"`.
  - Trips tab: filters (`from`, `to`, `employee_id`, `vehicle_id`, `status`, `flagged` checkbox), summary strip, table showing date/time, employee, car + purpose, status badge, odometer start→end & km, map km (or pending/unavailable/failed badge + `"คำนวณใหม่"` retry button), actual vs map duration, flags badges (Thai labels), Google Maps links (`เส้นทาง`, `จุดเริ่ม`, `จุดแวะ`, `จุดจบ` with `target="_blank" rel="noopener noreferrer"`). No delete button.
  - Vehicles tab: list of company cars (`plate_no`, `label`, `last_end_odometer`, status active/inactive, notes) + add/edit/toggle-active modal.

### Exact Thai Texts
- **PDPA Notice (`NOTICE_TEXT`, version `'1.0'`)**:
  `"ระบบจะบันทึกพิกัดตำแหน่ง (GPS) เฉพาะตอนที่คุณกดเริ่มทริป แวะจุด และจบทริปเท่านั้น ไม่มีการติดตามตำแหน่งพื้นหลัง พิกัดและเลขไมล์ใช้เพื่อคำนวณระยะทางและตรวจสอบการใช้งานรถยนต์ของบริษัท โดยพิกัดเส้นทางอาจถูกส่งไปคำนวณระยะทางถนนผ่าน Google Routes API โดยไม่ส่งชื่อหรือข้อมูลส่วนตัวของคุณ"`
- **Flag labels (Manager UI)**:
  - `ODOMETER_MISMATCH`: `"ระยะไมล์ต่างจากแผนที่ >20%"`
  - `DURATION_EXCESSIVE`: `"ใช้เวลานานกว่าแผนที่มาก"`
  - `ODOMETER_ROLLBACK`: `"ไมล์เริ่มต่ำกว่าไมล์จบครั้งก่อน"`
  - `POOR_GPS`: `"ความแม่นยำ GPS ต่ำ (>150 ม.)"`
- **Route status labels**: `OK` = `"คำนวณแล้ว"`, `PENDING` = `"รอคำนวณ"`, `UNAVAILABLE` = `"ยังไม่ตั้งค่าแผนที่"`, `FAILED` = `"คำนวณแผนที่ไม่สำเร็จ"`, `SKIPPED` = `"ไม่คำนวณ (ไม่สมบูรณ์)"`.
- **Trip status labels**: `OPEN` = `"กำลังเดินทาง"`, `COMPLETED` = `"จบแล้ว"`, `INCOMPLETE` = `"ไม่สมบูรณ์ (เกิน 12 ชม.)"`.
- **LINE `"งานของฉัน"` when empty**: `"ระบบงานของฉันยังไม่เปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ"`.
- **Post-start web banner**: `"บันทึกเริ่มทริปแล้ว — ออกเดินทางได้เลยครับ"`.

---

## (3) Parallel Worker Tasks (Zero Overlapping Files)

All three workers share only the fixed API contract above and touch completely disjoint file sets, so they can execute concurrently.

### W1 — Backend Data, API, Google Routes, Flags & Tests
- **Owns**: `backend/src/db/migrations.ts`, `backend/src/index.ts`, `backend/src/services/hr/carTripFlags.ts`, `backend/src/services/hr/googleRoutes.service.ts`, `backend/src/services/hr/carTrip.service.ts`, `backend/src/routes/hr.trip.routes.ts`, `backend/src/routes/hr.trip.test.ts`
- **Deliverables**:
  1. Add the 4 tables + `uq_hr_car_trips_open_emp` partial unique index in `migrations.ts`.
  2. Implement `carTripFlags.ts` (validators + pure `computeTripFlags`), `googleRoutes.service.ts` (`computeRoutes`, `X-Goog-FieldMask: routes.distanceMeters,routes.duration`, timeout, no-key skip, no straight-line fallback, zero secret/coord logging), `carTrip.service.ts` (`closeExpiredTrips`, 15-min `startCarTripExpiryScheduler`, Google Maps URL builders).
  3. Implement `hr.trip.routes.ts` (T1–T12 with all security/consent/tenant/race checks) and mount + start scheduler in `index.ts`.
  4. Write `hr.trip.test.ts` covering all backend test cases in Section (4). Verify `cd backend && npm run build && npx vitest run src/routes/hr.trip.test.ts`.

### W2 — LINE Bot, Rich Menu, Aliases, Image Generator & Tests
- **Owns**: `backend/src/services/line-richmenu.service.ts`, `backend/src/services/line-bot.service.ts`, `backend/src/services/line-flex-templates.ts`, `backend/scripts/gen-richmenu.mjs`, `backend/assets/line-richmenu/staff.png`, `backend/assets/line-richmenu/staff_car.png`, `backend/src/services/line-richmenu.test.ts`, `backend/src/services/line-bot.trips.test.ts`
- **Deliverables**:
  1. Update `line-richmenu.service.ts`: new `staff` 4×2 menu, new `staff_car` 4×1 menu, `MY_TASKS_URL` env handling, alias upsert (`phopy-staff`, `phopy-staff-car`) before old-menu deletion + stale `phopy-*` alias cleanup, `syncUser` preserving `staff_car` across messages and cold-cache restarts while still relinking on role/menu-family change.
  2. Update `gen-richmenu.mjs` for dynamic `843 * rows` height and regenerate `staff.png` + generate `staff_car.png`.
  3. Update `line-bot.service.ts`: `createLoginLink(..., target?)`, reply-only private-chat handlers for `เริ่ม/จบทริป`/`เริ่มทริป`/`จบทริป`/`ใช้งานรถยนต์`, `แวะจุด`, `ประวัติทริป`, `งานของฉัน`, silent `richmenu_switch` postback ack; keep typed `สลิป`/`สต็อก`/`สถานะ` intact; update `helpCard('staff')` in `line-flex-templates.ts`.
  4. Write `line-richmenu.test.ts` and `line-bot.trips.test.ts` (including `POST /api/auth/line-login` one-time exchange/replay test). Verify `cd backend && npm run build && npx vitest run src/services/line-richmenu.test.ts src/services/line-bot.trips.test.ts`.

### W3 — Frontend Pages, API Client, Routing, Nav & Tests
- **Owns**: `frontend/src/App.tsx`, `frontend/src/pages/LineLogin.tsx`, `frontend/src/pages/HR/MyHr.tsx`, `frontend/src/components/layout/HrTabs.tsx`, `frontend/src/components/layout/HrTabs.test.tsx`, `frontend/src/config/menuPermissions.ts`, `frontend/src/i18n/locales/th/translation.json`, `frontend/src/i18n/locales/en/translation.json`, `frontend/src/services/hrTrip.service.ts`, `frontend/src/pages/HR/MyTrips.tsx`, `frontend/src/pages/HR/CarTrips.tsx`, `frontend/src/pages/HR/MyTrips.test.tsx`, `frontend/src/pages/HR/CarTrips.test.tsx`, `frontend/src/pages/LineLogin.test.tsx`
- **Deliverables**:
  1. Implement `hrTrip.service.ts` matching the exact contract types & endpoints.
  2. Update `LineLogin.tsx` (allowlisted `?to=` redirect), `App.tsx` (`/hr/me/trips` for both `hr_self` and full layout; `/hr/trips` under `HrTabs`), `HrTabs.tsx` + `HrTabs.test.tsx`, `menuPermissions.ts`, `th`/`en` translations, and add `<a href="/hr/me/trips">` card in `MyHr.tsx`.
  3. Implement `MyTrips.tsx` (PDPA consent gate, high-accuracy GPS, start/stop/end forms, open-trip driving banner, 10-stop cap, history tab) and `CarTrips.tsx` (manager trip table, filters, odometer/map km, retry button, duration, flags badges, Google Maps links, company cars management tab).
  4. Write `MyTrips.test.tsx`, `CarTrips.test.tsx`, `LineLogin.test.tsx`. Verify `cd frontend && npm run build && npm test`.

---

## (4) Exact Test Cases

| Category | Test Case | Expected Result | Suite |
|---|---|---|---|
| **Replay / double start** | Sequential `POST /api/hr/me/trips/start` twice for same employee | 1st `201 OPEN`; 2nd `409` (`คุณมีทริปที่เปิดอยู่แล้ว...`), 1 open row in DB | W1 `hr.trip.test.ts` |
| **Replay end** | Call `POST /api/hr/me/trips/:id/end` twice on same trip | 1st `200 COMPLETED`; 2nd `409` (`ทริปนี้ถูกปิดไปแล้ว`), no second Google call | W1 `hr.trip.test.ts` |
| **Race of two starts** | Concurrent `Promise.all([start(), start()])` + direct DB second `OPEN` insert | Exactly 1 `201` + 1 `409`; `uq_hr_car_trips_open_emp` blocks second `OPEN` row | W1 `hr.trip.test.ts` |
| **Other tenant** | Tenant B manager calls `GET /api/hr/trips`, `POST /api/hr/trips/:idA/retry-route`, `PUT /api/hr/vehicles/:vehA`; Employee B starts with `vehA` | List excludes A; retry/update return `404`; start with cross-tenant `vehA` returns `400`/`404` | W1 `hr.trip.test.ts` |
| **Other employee** | Employee B (same tenant) calls `POST /me/trips/:idA/stops`, `POST /me/trips/:idA/end`, `GET /me/trips` | Stop/end return `404`; `GET /me/trips` returns only B's trips; `flags` omitted on `/me/trips*` | W1 `hr.trip.test.ts` |
| **Permissions & no delete** | `USER` without HR perm and `hr_self` token call `/api/hr/trips`, `/api/hr/vehicles`, `/retry-route`; HR read-only user calls `POST /vehicles` & `retry-route`; `DELETE /api/hr/trips/:id` | `403` for unauthorized; `404` on `DELETE /api/hr/trips/:id`; unlinked / `RESIGNED` employee on `/me/trips*` → `404` | W1 `hr.trip.test.ts` |
| **12h close (lazy + sweep)** | Seed `OPEN` trip `started_at = now - 12h05m` (and another `now - 11h55m`) | `GET /me/trips/status` closes expired trip to `INCOMPLETE` (`odometer_km=null`, `map_distance_km=null`, `route_status='SKIPPED'`, `close_reason='EXPIRED_12H'`); `/start` closes expired & creates new `201`; `/stops` & `/end` on expired return `409` + mark `INCOMPLETE`; `closeExpiredTrips()` closes expired only, leaves 11h55m `OPEN` | W1 `hr.trip.test.ts` |
| **Google: no key** | Unset `GOOGLE_ROUTES_API_KEY`, end a trip | Checkout `200 COMPLETED`; `fetch` called `0` times; `route_status='UNAVAILABLE'`, `map_distance_km=null`, `odometer_km` saved (no haversine); manager retry returns `503` without calling `fetch` | W1 `hr.trip.test.ts` |
| **Google: HTTP error / malformed** | Mock `fetch` returning `500` or `{ routes: [] }` | Checkout still `200 COMPLETED`; `route_status='FAILED'`, `map_distance_km=null`; spy on `console.*` + DB `route_error` confirms neither API key nor `lat`/`lng` logged; manager `POST /retry-route` with mocked `200` updates `route_status='OK'`, `map_distance_km`, `map_duration_sec`, and recomputes flags | W1 `hr.trip.test.ts` |
| **Google: timeout & field mask** | Mock hanging `fetch` (abort on signal) & valid `fetch` with 2 stops | Timeout aborts → checkout `200`, `route_status='FAILED'`, `route_error='TIMEOUT'`; valid call verifies URL `directions/v2:computeRoutes`, header `X-Goog-FieldMask: routes.distanceMeters,routes.duration`, `X-Goog-Api-Key`, and 2 `intermediates` in order | W1 `hr.trip.test.ts` |
| **Consent missing** | Call `/start` (and `/stops`, `/end` if version differs) without consent; call `/consent` with `consent: false` | `/start`/`/stops`/`/end` return `403 CONSENT_REQUIRED` with 0 GPS rows written; `consent: false` → `400`; `consent: true` stores `employee_id`, `user_id`, `accepted_at`, `consent_version: '1.0'` and unblocks `/start` | W1 `hr.trip.test.ts` |
| **Invalid coords, odometer & stop limit** | `lat=95`, `lng=-200`, `lat=0,lng=0`, `lat='abc'`, `accuracy_m=-5`, `end_odometer < start_odometer`, negative odometer, 11th stop | Invalid coords/odometer → `400`; `end < start` → `400`; 10 stops succeed (`201`), 11th stop → `409` | W1 `hr.trip.test.ts` |
| **Flags** | Unit + integration cases for all 4 flags | `ODOMETER_MISMATCH`: `odo=12, map=10` (20% exact) → off; `odo=12.1, map=10` → on; `odo=7.9, map=10` → on. `DURATION_EXCESSIVE`: `3600s` vs `1800s` → off; `3660s` vs `1800s` → on; `1200s` vs `300s` (diff 15m < 30m) → off. `ODOMETER_ROLLBACK`: company car `start < last end` → on; `start == last end` → off; private car → off. `POOR_GPS`: any point `accuracy_m > 150` or `null` → on; all `<= 150` → off. | W1 `hr.trip.test.ts` |
| **Alias handling & menus** | `richMenus.ensure()` on fresh channel and version upgrade; `MY_TASKS_URL` empty vs set | Creates 5 menus (`staff_car` is `2500×843`); upserts `phopy-staff` & `phopy-staff-car` **before** `deleteRichMenu` on old IDs (assert call order); update-404 falls back to create; `exec`/`manager`/`guest` unchanged; `MY_TASKS_URL` empty → `message` action, valid URL → `uri` action | W2 `line-richmenu.test.ts` |
| **Sub menu kept after message** | Staff user switches to `staff_car`, then sends messages (warm cache & cold cache after `resetRichMenuCache()`); then role changes to `manager` / unlinks | Warm cache: `syncUser` makes 0 link calls. Cold cache: `getRichMenuIdOfUser` returns `ids.staff_car` → `syncUser` does NOT relink to `ids.staff`. Role change to `manager` (or `null`) → calls `linkRichMenuIdToUser(..., ids.manager)` (or `unlinkRichMenuIdFromUser`) | W2 `line-richmenu.test.ts` |
| **One-time link & LINE bot commands** | Send `เริ่ม/จบทริป`, `แวะจุด`, `ประวัติทริป`, `งานของฉัน` (empty & set), `สลิป`, `สถานะ`, `richmenu_switch` postback; group chat; non-employee; exchange token twice via `POST /api/auth/line-login` | Replies (never pushes) with `?t=<64hex>&to=trips\|trips_stop\|trips_history`; group chat blocked; unlinked/inactive employee blocked; `งานของฉัน` replies Thai disabled msg when empty and URI button when set; `richmenu_switch` postback silent; `POST /api/auth/line-login` succeeds once (`scope: 'hr_self'`, no refresh token), 2nd attempt & expired token return `401` | W2 `line-bot.trips.test.ts` |
| **Frontend flows & open-redirect** | Render `MyTrips`, `CarTrips`, `LineLogin` | `MyTrips`: consent gate blocks start until checked & submitted; geolocation high-accuracy called; start shows `"บันทึกเริ่มทริปแล้ว — ออกเดินทางได้เลยครับ"`; stop disabled at 10; end rejects `end < start`; history tab renders own trips. `CarTrips`: filters call API, flags & Google Maps links render, retry button calls `retryRoute`, vehicle modal creates/updates. `LineLogin`: `to=trips` → `/hr/me/trips`, `to=trips_stop` → `/hr/me/trips?action=stop`, `to=https://evil.com` → `/hr/me` | W3 `MyTrips.test.tsx`, `CarTrips.test.tsx`, `LineLogin.test.tsx` |

---

## Addendum (overrides the steps above where they differ)

### 1. Orphan Menus, Alias Rollback & Retry Cool-Down (overrides Step 6 `create()` / `ensure()`)
- [ ] In `backend/src/services/line-richmenu.service.ts`, add per-token failure cool-down: `const retryAfter = new Map<string, number>()` with `export const RETRY_COOLDOWN_MS = 60_000` (cleared in `resetRichMenuCache()`).
  - In `ensure(tenantId, token)`: if `Date.now() < (retryAfter.get(token) ?? 0)`, return `Promise.resolve(null)` immediately without calling LINE API.
  - On `create()` rejection: set `retryAfter.set(token, Date.now() + RETRY_COOLDOWN_MS)` before `ensuring.delete(key)`.
- [ ] In `create()`, track `createdIds: string[] = []`, `updatedAliases: Array<{ aliasId: string; prevRichMenuId: string | null }> = []`, and `defaultChanged = false`:
  - **Commit phase** (wrapped in `try/catch`):
    1. Create all 5 menus (`guest`, `staff`, `staff_car`, `manager`, `exec`) — push each `richMenuId` into `createdIds` immediately after `createRichMenu`, then call `setRichMenuImage`.
    2. Upsert `phopy-staff` → `ids.staff` and `phopy-staff-car` → `ids.staff_car`; before each upsert record `{ aliasId, prevRichMenuId: saved?.ids?.[k] ?? null }` into `updatedAliases` once the upsert succeeds (note: if `createRichMenuAlias` ran for a brand-new alias, `prevRichMenuId` is `null`).
    3. Call `api.setDefaultRichMenu(ids.guest)` and set `defaultChanged = true`.
    4. Persist `UPDATE line_channels SET rich_menus = ? WHERE channel_access_token = ?`.
  - **Rollback on any failure in steps 1–4** (so old menus stay usable and no live alias points at a deleted menu):
    1. If `defaultChanged && saved?.ids?.guest`: best-effort `api.setDefaultRichMenu(saved.ids.guest)`.
    2. For each `{ aliasId, prevRichMenuId }` in `updatedAliases` (reverse order): if `prevRichMenuId`, best-effort `api.updateRichMenuAlias(aliasId, { richMenuId: prevRichMenuId })`; else best-effort `api.deleteRichMenuAlias(aliasId)`.
    3. Delete every ID in `createdIds` best-effort (`api.deleteRichMenu(id)`). Never delete `saved?.ids`. Re-throw so `ensure()` applies the cool-down.
  - **Post-commit** (only after DB update succeeds): relink users best-effort, delete old `saved?.ids` best-effort, and remove stale `phopy-*` aliases best-effort.

### 2. Existing Rich Menu Tests (overrides W2 Targets & Step 6)
- [ ] **Remove** `backend/src/services/line-richmenu.test.ts` (Create) from W2 Targets; **Modify** existing `backend/src/services/lineRichMenu.test.ts` instead.
- [ ] Exact assertion changes in `backend/src/services/lineRichMenu.test.ts`:
  - Line 6 & 12: import `RichMenuKey` and iterate `Object.keys(MENUS) as RichMenuKey[]` (adds `'staff_car'`).
  - Lines 27–29: keep PNG byte-size & dimension assertions for all existing PNGs (`guest`, `exec`, `manager`, `staff`), and check `staff_car.png` conditionally with `if (fs.existsSync(pngPath))` so worker tests do not fail before the advisor generates `staff_car.png`.
  - Lines 33–44: keep all existing `exec`/`manager`/`staff`/`guest` assertions intact; add `staff_car` assertion (`size: { width: 2500, height: 843 }`, 4 buttons, `625` width each).
  - Line 93 (`syncUser` spy call): keep unchanged by omitting the optional 5th `opts` argument on normal message `syncUser(...)` calls.
- [ ] **Other existing tests checked for old staff buttons (`สลิป`, `เช็คสต็อก`, `งานผลิต`)**: `backend/src/services/lineRichMenu.test.ts`, `backend/src/routes/lineLogin.test.ts`, `backend/src/services/lineMasterFloat.test.ts`, `backend/src/services/lineLog.test.ts`, and `backend/src/routes/hr.lineInvite.test.ts` do **not** assert the old staff button list. *(Note: without a glob/grep tool in read-only mode, advisor should run a quick grep for `MENUS\.staff|เช็คสต็อก|งานผลิต` across `backend/src/**/*.test.ts` before merging.)*

### 3. Lazy 12h Close Outside Transaction & Atomic Transitions (overrides Step 5 T4/T5/T6/T9)
- [ ] Run `closeExpiredTrips({ tenantId, employeeId: emp.id })` as a **standalone statement BEFORE `db.transaction(...)`** in **T4** (`/start`), **T5** (`/:id/stops`), and **T6** (`/:id/end`) so a `409`/`400` never rolls back the `INCOMPLETE` closure.
- [ ] Inside `db.transaction(...)` in T5 and T6, return `{ status, body }` result objects instead of throwing for `4xx`, and enforce atomic transitions checking `changes === 1`:
  - **T5 (`/:id/stops`)**: after inserting the stop, run `UPDATE hr_car_trips SET flags_json = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND employee_id = ? AND status = 'OPEN'` and verify `changes === 1` (if `0`, throw sentinel to roll back the inserted stop and return `409 'ทริปนี้ถูกปิดไปแล้ว'`).
  - **T6 (`/:id/end`)**: run `UPDATE hr_car_trips SET status = 'COMPLETED', ended_at = ?, end_odometer = ?, end_lat = ?, end_lng = ?, end_accuracy_m = ?, odometer_km = ?, duration_sec = ?, route_status = ?, route_error = ?, flags_json = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND employee_id = ? AND status = 'OPEN'` and verify `changes === 1` (if `0`, return `409 'ทริปนี้ถูกปิดไปแล้ว'`). Post-commit Google Routes update uses `WHERE id = ? AND tenant_id = ? AND status = 'COMPLETED'`.
  - **T9 (`/:id/retry-route`)**: update uses `WHERE id = ? AND tenant_id = ? AND status = 'COMPLETED' AND route_status <> 'OK'` and checks `changes === 1` (if `0`, return `409`).

### 4. Advisor Generates PNGs & Runs Build/Tests (overrides W2 Targets, Done When, Deliverables)
- [ ] **Remove** `backend/assets/line-richmenu/staff.png` and `backend/assets/line-richmenu/staff_car.png` from W2 Targets and deliverables. W2 edits `backend/scripts/gen-richmenu.mjs` only; the **advisor** runs `gen-richmenu.mjs` to generate both PNGs and runs `tsc` / `vitest` for all workers.
- [ ] Keep existing missing-asset handling in `line-richmenu.service.ts`: `version()` reads each `<key>.png` via `fs.readFileSync`; if `staff_car.png` (or any asset) is missing (`ENOENT`), `ensure()` catches it, logs `'richmenu assets missing'`, and resolves `null` without crashing or calling LINE API.
- [ ] Tests in `lineRichMenu.test.ts` must not depend on `staff_car.png` existing on disk (stub asset loading / `fs.readFileSync` when testing `ensure()`/`create()`).

### 5. Repo Confirmations (`subscriptionGate`, `hr_self`, `getSelfEmployee`)
- [ ] **`hr_self` scope + `subscriptionGate('hr')` confirmed**:
  - `hrSelfScope.ts:6` allows `[/^(GET|POST)$/, /^\/api\/hr\/me(\/[A-Za-z0-9_\-/]*)?$/]`; all T1–T7 endpoints are `GET`/`POST` under `/api/hr/me/*` (25-char hex IDs from `generateId()` match), so `hr_self` lets them through and rejects T8–T12 (`/api/hr/trips*`, `/api/hr/vehicles*`) with `403 SCOPE_LIMITED`.
  - `index.ts:543` mounts `/api/hr` behind `authenticate, subscriptionGate('hr')`; `subscription.middleware.ts:20-47` passes any tenant whose plan includes `'hr'` (or `status === 'NONE'` when no `tenant_subscriptions` row exists) and blocks expired/locked plans (`402`/`403`) consistently with all other `/api/hr/me/*` routes.
- [ ] **`getSelfEmployee` confirmed NOT shared**: it is duplicated locally across 10 HR route files (`hr.checkin.routes.ts:133`, `hr.face.routes.ts:10`, `hr.asset.routes.ts:35`, `hr.offsite.routes.ts:22`, `hr.leave.routes.ts:36`, `hr.advance.routes.ts:35`, `hr.discipline.routes.ts:29`, `hr.swap.routes.ts:22`, `hr.roster.routes.ts:28`, `hr.training.routes.ts:35`). Export `getSelfEmployee(tenantId: string, userId: string)` (`WHERE tenant_id = ? AND user_id = ? AND status = 'ACTIVE'`) from W1's new `backend/src/services/hr/carTrip.service.ts` and import it in `backend/src/routes/hr.trip.routes.ts` (do not modify other HR route files).

### Added / Changed Test Cases
- [ ] **W2 `backend/src/services/lineRichMenu.test.ts` (extended, replaces `line-richmenu.test.ts`)**:
  - **Mid-create failure rollback (image upload / alias / default / DB failure)**: fail on 3rd `setRichMenuImage` or 2nd alias upsert or `setDefaultRichMenu` → asserts all newly created menu IDs are deleted via `deleteRichMenu`, previously updated live aliases are restored to `saved.ids` (or newly created alias deleted) **before** deleting new menus, old `saved.ids` are NOT deleted, and `line_channels.rich_menus` is unchanged.
  - **Retry cool-down**: after a failed `ensure()`, an immediate second `ensure()` within `RETRY_COOLDOWN_MS` returns `null` with `0` LINE API calls; after advancing clock past `RETRY_COOLDOWN_MS`, retry proceeds.
  - **Missing `staff_car.png`**: when `staff_car.png` throws `ENOENT`, `ensure()` returns `null` without calling LINE API or throwing.
- [ ] **W1 `backend/src/routes/hr.trip.test.ts` (added assertions)**:
  - **12h lazy close persists on 409**: calling `POST /api/hr/me/trips/:id/stops` or `POST /api/hr/me/trips/:id/end` on a >12h open trip returns `409` **and** a subsequent DB read confirms `status === 'INCOMPLETE'` (was NOT rolled back).
  - **Concurrent end race (`changes === 1`)**: two concurrent `POST /api/hr/me/trips/:id/end` calls yield exactly one `200` and one `409`, with Google Routes called at most once.
  - **`hr_self` + `subscriptionGate('hr')` integration**: mint a real `hr_self` token via `POST /api/auth/line-login` and mount `authenticate, subscriptionGate('hr'), hrTripRoutes` → `POST /api/hr/me/trips/consent`, `/start`, `/:id/stops`, `/:id/end` return `200`/`201`, while `GET /api/hr/trips` and `POST /api/hr/vehicles` return `403`.
