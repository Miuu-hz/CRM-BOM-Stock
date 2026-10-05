// ซ่อมบิลซื้อที่ป้อนผ่าน MCP (create_draft_po, notes ขึ้นต้น '[AI Draft]') แล้วค้างกลางสาย
// PO → GR → ใบแจ้งหนี้ซื้อ → จ่ายเงิน — เดินต่อให้ครบด้วย services/purchaseChain.service.ts
// (ตัวเดียวกับ MCP complete_purchase_bill) ทุกเอกสารลงวันที่ตาม order_date ของ PO
//
// ค่าเริ่มต้น = --dry-run (แสดงอย่างเดียว ไม่เขียน DB) · ต้องใส่ --apply ถึงจะบันทึกจริง
// ตัวเลือก: --tenant <tenant_id>  --po <PO number หรือ id> (ซ้ำได้)
//
// ⚠️ import src จะรัน migration ใส่ DB ที่ SQLITE_DB_PATH ชี้ — ลองกับสำเนาก่อนเสมอ:
//   node -e "require(\"better-sqlite3\")(\"dev.db\",{readonly:true}).backup(\"/tmp/devcopy.db\")"
//   JWT_SECRET=x AGENT_JWT_SECRET=x SQLITE_DB_PATH=/tmp/devcopy.db npx tsx scripts/repair-mcp-bills-2026-10-06.ts
//   ... ตรวจผลแล้วค่อยรันจริงด้วย --apply
import db from '../src/db/sqlite'
import { completePurchaseChain, findStuckMcpPurchaseOrders } from '../src/services/purchaseChain.service'

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const valuesOf = (flag: string) => argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]] : []))
const tenant = valuesOf('--tenant')[0]
const onlyPos = valuesOf('--po')

const ACTOR = 'repair-mcp-bills-2026-10-06'
const stuck = findStuckMcpPurchaseOrders(tenant)
  .filter(po => onlyPos.length === 0 || onlyPos.includes(po.po_number) || onlyPos.includes(po.id))

console.log(`${apply ? '🔧 APPLY' : '🔍 DRY-RUN (ใส่ --apply เพื่อบันทึกจริง)'} — พบบิล MCP ค้างสาย ${stuck.length} ใบ\n`)

let done = 0
let blocked = 0
for (const po of stuck) {
  const head = `[${po.tenant_id}] ${po.po_number} ${String(po.order_date).slice(0, 10)} ${po.status} ฿${po.total_amount}${po.is_paid ? ' (จ่ายแล้ว)' : ''}`
  try {
    // ponytail: ผู้อนุมัติ/ผู้รับของ = ชื่อสคริปต์ ไม่ใช่ user จริง — ตามรอยได้จาก approved_by/received_by
    const r = completePurchaseChain(po.tenant_id, ACTOR, ACTOR, po.id, { dryRun: !apply })
    if (r.blocker) {
      blocked++
      console.log(`❌ ${head}\n   ติด: ${r.blocker.replace(/\n/g, '\n   ')}${r.steps.length ? `\n   ทำไปแล้ว: ${r.steps.join(' → ')}` : ''}`)
    } else {
      done++
      console.log(`✅ ${head}\n   ${r.steps.join(' → ') || '(ไม่มีอะไรต้องทำ)'}`)
    }
  } catch (e: any) {
    blocked++
    console.log(`❌ ${head}\n   error: ${e?.message || e}`)
  }
}

console.log(`\nสรุป: ${apply ? 'ทำสำเร็จ' : 'ทำได้'} ${done} · ติด ${blocked} (แก้ตามข้อความแล้วรันซ้ำได้)`)
db.close()
process.exit(blocked ? 1 : 0)
