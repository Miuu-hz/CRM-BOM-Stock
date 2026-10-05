// ซ่อมบิลซื้อที่ป้อนผ่าน MCP (create_draft_po, notes ขึ้นต้น '[AI Draft]') แล้วค้างกลางสาย
// PO → GR → ใบแจ้งหนี้ซื้อ → จ่ายเงิน — เดินต่อให้ครบด้วย services/purchaseChain.service.ts
// (ตัวเดียวกับ MCP complete_purchase_bill) ทุกเอกสารลงวันที่ตาม order_date ของ PO
//
// ค่าเริ่มต้น = ดูอย่างเดียว (dry-run) ไม่เขียน DB · ต้องใส่ --apply ถึงจะบันทึกจริง
// ตัวเลือก:
//   --tenant <tenant_id>              เฉพาะเทแนนต์นี้
//   --po <เลขที่ PO หรือ id>            เฉพาะใบนี้ (ซ้ำได้)
//   --date PO-xxx=YYYY-MM-DD          แก้วันที่บนบิลก่อนเดินสาย (ซ้ำได้) — บิลที่ป้อนก่อนมี bill_date ได้วันที่ป้อนแทน
//   --dates-file dates.csv            เหมือน --date แต่อ่านจากไฟล์ บรรทัดละ  PO-xxx,YYYY-MM-DD  (บรรทัดหัว/ว่างข้ามได้)
// แก้วันที่ได้เฉพาะ PO ที่ยังไม่มีใบรับสินค้า/ใบแจ้งหนี้ และไม่อยู่งวดที่ปิดแล้ว · เลขที่ PO คงเดิม ไม่ออกเลขใหม่
//
// ── วิธีใช้ (รันใน LXC 100 ที่ /opt/crm/backend) ──
// 1) ทำสำเนา DB แล้วลองกับสำเนาก่อน (import src จะรัน migration ใส่ DB ที่ SQLITE_DB_PATH ชี้ — ห้ามลองกับของจริง):
//      cd /opt/crm/backend
//      node -e "require('better-sqlite3')('dev.db',{readonly:true}).backup('/tmp/devcopy.db').then(()=>console.log('ok'))"
//      env JWT_SECRET=x AGENT_JWT_SECRET=x SQLITE_DB_PATH=/tmp/devcopy.db node_modules/.bin/ts-node-transpile-only scripts/repair-mcp-bills-2026-10-06.ts --date PO-xxx=2026-09-28
//    ตรวจตาราง ถ้าวันที่ผิดก็แก้ --date แล้วรันซ้ำ จนพอใจ (อยากเห็นผลจริงบนสำเนา ใส่ --apply กับสำเนาได้)
// 2) รันจริง (สำรอง DB ไว้ก่อนด้วยปุ่ม Backup ในหน้าตั้งค่าก็ดี — สคริปต์สำรองให้อีกชั้นอัตโนมัติ):
//      env JWT_SECRET=x AGENT_JWT_SECRET=x node_modules/.bin/ts-node-transpile-only scripts/repair-mcp-bills-2026-10-06.ts --date PO-xxx=2026-09-28 --apply
//    --apply สำรองไฟล์ DB ไปที่ backend/backups/dev.db.before-repair-mcp-bills-<เวลา>.bak ก่อนเขียนเสมอ (สำรองไม่ได้ = ไม่ทำต่อ)
//    ย้อนกลับ: หยุด backend แล้ว copy ไฟล์ .bak ทับ dev.db
import fs from 'fs'
import path from 'path'
import db from '../src/db/sqlite'
import { completePurchaseChain, findStuckMcpPurchaseOrders, type PurchaseChainResult } from '../src/services/purchaseChain.service'
import { changePurchaseOrderDate } from '../src/services/purchaseOrderUpdate.service'

const ACTOR = 'repair-mcp-bills-2026-10-06'
const ROLLBACK = Symbol('dry-run rollback')

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const valuesOf = (flag: string) => argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]] : []))
const tenant = valuesOf('--tenant')[0]
const onlyPos = valuesOf('--po')

/** PO (เลขที่หรือ id) → วันที่ใหม่ · พังตั้งแต่ตอนอ่าน ดีกว่าไปเจอครึ่งทาง */
function parseDates(): Map<string, string> {
  const pairs: string[] = [...valuesOf('--date')]
  for (const file of valuesOf('--dates-file')) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const cells = line.split(/[,;\t]/).map(c => c.trim().replace(/^"|"$/g, ''))
      if (cells.length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(cells[1])) pairs.push(`${cells[0]}=${cells[1]}`)
    }
  }
  const map = new Map<string, string>()
  for (const p of pairs) {
    const m = /^(.+)=(\d{4}-\d{2}-\d{2})$/.exec(p.trim())
    if (!m) throw new Error(`--date "${p}" ผิดรูปแบบ — ต้องเป็น PO-xxx=YYYY-MM-DD`)
    map.set(m[1].trim(), m[2])
  }
  return map
}

// ความกว้างที่ตาเห็น — สระบน/ล่างและวรรณยุกต์ไทยไม่กินช่อง ไม่งั้นตารางเบี้ยว
const width = (s: string) => [...s].filter(ch => !/[ัิ-ฺ็-๎]/.test(ch)).length
const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - width(s)))
const clip = (s: string, w: number) => (width(s) <= w ? s : [...s].slice(0, w - 1).join('') + '…')

interface Row { po: string; supplier: string; date: string; total: string; ok: boolean; what: string }

function processPo(po: any, newDate: string | undefined): Row {
  const supplier = (db.prepare('SELECT name FROM suppliers WHERE id = ?').get(po.supplier_id) as any)?.name || '(ไม่มีผู้ขาย)'
  const oldDate = String(po.order_date || '').slice(0, 10)
  const base = {
    po: po.po_number,
    supplier,
    date: newDate && newDate !== oldDate ? `${oldDate}→${newDate}` : oldDate,
    total: `฿${Number(po.total_amount || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  }
  let r: PurchaseChainResult
  let dateNote = ''
  try {
    // dry-run: แก้วันที่ใน transaction แล้วถอยกลับ — ให้ตรวจงวดปิด/เลขเอกสารตามวันใหม่ได้จริงโดยไม่เขียนอะไร
    // apply: แก้วันที่ก่อน (commit) แล้วเดินสาย — สายติดกลางทาง วันที่ใหม่ยังอยู่ รันซ้ำได้
    const step = () => {
      if (newDate && newDate !== oldDate) {
        changePurchaseOrderDate(po.tenant_id, po.id, newDate)
        dateNote = `แก้วันที่บิลเป็น ${newDate} (เลข PO คงเดิม)`
      }
      // ponytail: ผู้อนุมัติ/ผู้รับของ = ชื่อสคริปต์ ไม่ใช่ user จริง — ตามรอยได้จาก approved_by/received_by
      r = completePurchaseChain(po.tenant_id, ACTOR, ACTOR, po.id, { dryRun: !apply })
      if (!apply) throw ROLLBACK
    }
    if (apply) step()
    else {
      try { db.transaction(step)() } catch (e) { if (e !== ROLLBACK) throw e }
    }
  } catch (e: any) {
    return { ...base, ok: false, what: `ติด: ${e?.message || e}` }
  }
  const steps = [dateNote, ...r!.steps].filter(Boolean)
  if (r!.blocker) {
    return { ...base, ok: false, what: `ติด: ${r!.blocker}${steps.length ? ` · ${apply ? 'ทำไปแล้ว' : 'ก่อนติดจะทำ'}: ${steps.join(' → ')}` : ''}` }
  }
  return { ...base, ok: true, what: steps.join(' → ') || '(ครบแล้ว ไม่มีอะไรต้องทำ)' }
}

function printTable(rows: Row[]) {
  const head: Row = { po: 'เลขที่ PO', supplier: 'ผู้ขาย', date: 'วันที่บิล', total: 'ยอดรวม', ok: true, what: apply ? 'ผลที่ทำ' : 'จะทำ / เหตุที่ติด' }
  const cols = {
    po: Math.max(...[head, ...rows].map(r => width(r.po))),
    supplier: Math.min(24, Math.max(...[head, ...rows].map(r => width(r.supplier)))),
    date: Math.max(...[head, ...rows].map(r => width(r.date))),
    total: Math.max(...[head, ...rows].map(r => width(r.total))),
  }
  const line = (r: Row, mark: string) => [
    mark, pad(r.po, cols.po), pad(clip(r.supplier, cols.supplier), cols.supplier), pad(r.date, cols.date),
    ' '.repeat(cols.total - width(r.total)) + r.total, r.what.replace(/\n/g, ' '),
  ].join(' │ ')
  console.log(line(head, '  '))
  console.log('─'.repeat(cols.po + cols.supplier + cols.date + cols.total + 30))
  for (const r of rows) console.log(line(r, r.ok ? '✅' : '❌'))
}

async function main() {
  const dates = parseDates()
  const stuck = findStuckMcpPurchaseOrders(tenant)
    .filter(po => onlyPos.length === 0 || onlyPos.includes(po.po_number) || onlyPos.includes(po.id))
  const dateFor = (po: any) => dates.get(po.po_number) ?? dates.get(po.id)
  const unknown = [...dates.keys()].filter(k => !stuck.some(po => po.po_number === k || po.id === k))

  console.log(apply ? '🔧 บันทึกจริง (--apply)' : '🔍 ดูอย่างเดียว ยังไม่บันทึก (ใส่ --apply เพื่อบันทึกจริง)')
  console.log(`DB: ${db.name}`)
  if (apply && stuck.length > 0) {
    const dir = path.join(__dirname, '../backups')
    fs.mkdirSync(dir, { recursive: true })
    const dest = path.join(dir, `${path.basename(db.name)}.before-repair-mcp-bills-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.bak`)
    await db.backup(dest)
    console.log(`สำรอง DB แล้ว: ${dest}`)
  }
  console.log(`พบบิล MCP ค้างสาย ${stuck.length} ใบ\n`)

  const rows = stuck.map(po => processPo(po, dateFor(po)))
  if (rows.length) printTable(rows)

  const ok = rows.filter(r => r.ok).length
  const blocked = rows.length - ok
  console.log(`\nสรุป: ${apply ? 'ทำสำเร็จ' : 'ทำได้'} ${ok} ใบ · ติด ${blocked} ใบ${blocked ? ' (แก้ตามข้อความแล้วรันซ้ำได้ — ใบที่ทำแล้วจะไม่ทำซ้ำ)' : ''}`)
  if (unknown.length) console.log(`⚠️ ไม่พบในรายการบิลค้าง (เช็คเลขที่ PO): ${unknown.join(', ')}`)
  if (!apply && ok > 0) console.log('ตรวจแล้วถูกต้อง → รันคำสั่งเดิมเติม --apply')
  return blocked
}

main()
  .then(blocked => { db.close(); process.exit(blocked ? 1 : 0) })
  .catch(e => { console.error(`❌ ${e?.message || e}`); db.close(); process.exit(2) })
