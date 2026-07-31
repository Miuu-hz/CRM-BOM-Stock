const Database = require("/opt/crm/backend/node_modules/better-sqlite3");
const assert = require("assert");
const db = new Database("backend/dev.db");

// Self-check ระบบ subscription — fail ถ้าตรรกะ/ข้อมูลแพ็กเกจพัง (รันจาก /opt/crm)
const plans = db.prepare("SELECT * FROM subscription_plans").all();
assert.strictEqual(plans.length, 4, "expected exactly 4 subscription plans");
const byCode = Object.fromEntries(
  plans.map((p) => [p.code, { ...p, features: JSON.parse(p.features || "[]") }])
);

// Free: 1 user, 100 สินค้า, 1 กะ, ไม่มี crm
const free = byCode.free;
assert(free, "free plan missing");
assert.strictEqual(free.max_users, 1, "free.max_users must be 1");
assert.strictEqual(free.max_products, 100, "free.max_products must be 100");
assert.strictEqual(free.max_pos_shifts, 1, "free.max_pos_shifts must be 1");
assert(!free.features.includes("crm"), "free must NOT include crm");

// Feature matrix (เหมือน hasFeature ใน subscription.service.ts)
const hasFeature = (code, f) => byCode[code].features.includes(f);
assert(!hasFeature("starter", "bom"), "starter must NOT include bom");
assert(hasFeature("business", "bom"), "business must include bom");
assert(!hasFeature("business", "api_access"), "business must NOT include api_access");
const ALL_FEATURES = ["stock","sales","purchase","crm","pos","bom","work_orders","kds","accounting","tax","ai","reports","api_access"];
for (const f of ALL_FEATURES) {
  assert(hasFeature("enterprise", f), `enterprise must include ${f}`);
}

// ทุก tenant ใน company_settings ต้องมี subscription
const tenants = db.prepare("SELECT tenant_id FROM company_settings").all();
const missing = tenants.filter(
  (t) => !db.prepare("SELECT 1 FROM tenant_subscriptions WHERE tenant_id = ?").get(t.tenant_id)
);
assert.strictEqual(missing.length, 0, `tenants without subscription: ${missing.map((t) => t.tenant_id).join(", ")}`);

// Free subscriptions ต้องไม่มีวันหมดอายุ (current_period_end IS NULL)
const badFree = db.prepare(
  "SELECT tenant_id FROM tenant_subscriptions WHERE plan_code = 'free' AND current_period_end IS NOT NULL"
).all();
assert.strictEqual(badFree.length, 0, `free subscriptions with period end: ${badFree.map((r) => r.tenant_id).join(", ")}`);

console.log("✅ check-subscription: all asserts passed");
db.close();
