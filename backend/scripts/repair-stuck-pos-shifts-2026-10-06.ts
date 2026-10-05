// ซ่อมกะ POS ที่ "ปิดค้าง": สถานะ CLOSED แต่ไม่มี journal POS_SHIFT_CLOSE (journal_entries.reference_id = id กะ)
// สาเหตุ: โค้ดปิดกะเดิมเปลี่ยนสถานะเป็น CLOSED ก่อนลงบัญชีและไม่อยู่ใน transaction — postJournal โยน
// (เช่น "เดบิต 27.65 ไม่เท่ากับเครดิต 27.66") กะก็ปิดไปแล้ว บัญชีพัก 1180 ค้างยอด และกดปิดซ้ำไม่ได้
// สคริปต์นี้ลง journal ปิดกะย้อนหลังจากยอดที่กะเก็บไว้ตอนปิด (total_revenue / bank_revenue / cash_difference)
// สูตรเดียวกับ route ปิดกะที่แก้แล้ว (services/posShiftRepair.service.ts) ลงวันที่ตาม closed_at ของกะ
//
// ข้าม (ไม่ถือว่าพัง): กะก่อนเปลี่ยนมาใช้บัญชีพัก 1180 (บิลในกะไม่ได้ Dr 1180) · กะที่มี journal แล้ว
// ติด (ต้องดูเอง): งวดบัญชีปิดแล้ว · ข้อมูลปิดกะไม่ครบ · ลงบัญชีไม่ผ่าน
// รันซ้ำได้: กะที่ลงแล้วมี journal POS_SHIFT_CLOSE จะไม่ถูกหยิบมาอีก
//
// ค่าเริ่มต้น = ดูอย่างเดียว (dry-run) ไม่เขียน DB · ต้องใส่ --apply ถึงจะบันทึกจริง
// ตัวเลือก:
//   --tenant <tenant_id>     เฉพาะเทแนนต์นี้
//
// ── วิธีใช้ (รันใน LXC 100 ที่ /opt/crm/backend) ──
// 1) ทำสำเนา DB แล้วลองกับสำเนาก่อน (import src จะรัน migration ใส่ DB ที่ SQLITE_DB_PATH ชี้ — ห้ามลองกับของจริง):
//      cd /opt/crm/backend
//      node -e "require('better-sqlite3')('dev.db',{readonly:true}).backup('/tmp/devcopy.db').then(()=>console.log('ok'))"
//      env JWT_SECRET=x AGENT_JWT_SECRET=x SQLITE_DB_PATH=/tmp/devcopy.db node_modules/.bin/ts-node-transpile-only scripts/repair-stuck-pos-shifts-2026-10-06.ts
//    ตรวจตาราง (อยากเห็นผลจริงบนสำเนา ใส่ --apply กับสำเนาได้ แล้วรันซ้ำต้องไม่เจออะไร)
// 2) รันจริง:
//      env JWT_SECRET=x AGENT_JWT_SECRET=x node_modules/.bin/ts-node-transpile-only scripts/repair-stuck-pos-shifts-2026-10-06.ts --apply
//    --apply สำรองไฟล์ DB ไปที่ backend/backups/dev.db.before-repair-stuck-pos-shifts-<เวลา>.bak ก่อนเขียนเสมอ (สำรองไม่ได้ = ไม่ทำต่อ)
//    ย้อนกลับ: หยุด backend แล้ว copy ไฟล์ .bak ทับ dev.db
import fs from 'fs'
import path from 'path'
import db from '../src/db/sqlite'
import { findStuckClosedShifts, repairStuckShift, type ShiftRepairResult } from '../src/services/posShiftRepair.service'

const ACTOR = 'repair-stuck-pos-shifts-2026-10-06'

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const valuesOf = (flag: string) => argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]] : []))
const tenant = valuesOf('--tenant')[0]

// ความกว้างที่ตาเห็น — สระบน/ล่างและวรรณยุกต์ไทยไม่กินช่อง ไม่งั้นตารางเบี้ยว
const width = (s: string) => [...s].filter(ch => !/[ัิ-ฺ็-๎]/.test(ch)).length
const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - width(s)))
const money = (n: any) => `฿${Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

interface Row { shift: string; date: string; total: string; diff: string; status: ShiftRepairResult['status']; what: string }

function printTable(rows: Row[]) {
  const head: Row = { shift: 'เลขที่กะ', date: 'วันที่ปิด', total: 'ยอดบิล', diff: 'ขาด/เกิน', status: 'posted', what: apply ? 'ผลที่ทำ' : 'จะทำ / เหตุที่ข้าม-ติด' }
  const all = [head, ...rows]
  const w = (k: 'shift' | 'date' | 'total' | 'diff') => Math.max(...all.map(r => width(r[k])))
  const cols = { shift: w('shift'), date: w('date'), total: w('total'), diff: w('diff') }
  const right = (s: string, n: number) => ' '.repeat(n - width(s)) + s
  const mark = { posted: '✅', skip: '⏭️', blocked: '❌' }
  const line = (r: Row, m: string) => [
    m, pad(r.shift, cols.shift), pad(r.date, cols.date), right(r.total, cols.total), right(r.diff, cols.diff), r.what,
  ].join(' │ ')
  console.log(line(head, '  '))
  console.log('─'.repeat(cols.shift + cols.date + cols.total + cols.diff + 30))
  for (const r of rows) console.log(line(r, mark[r.status]))
}

async function main() {
  const stuck = findStuckClosedShifts(tenant)

  console.log(apply ? '🔧 บันทึกจริง (--apply)' : '🔍 ดูอย่างเดียว ยังไม่บันทึก (ใส่ --apply เพื่อบันทึกจริง)')
  console.log(`DB: ${db.name}`)
  if (apply && stuck.length > 0) {
    const dir = path.join(__dirname, '../backups')
    fs.mkdirSync(dir, { recursive: true })
    const dest = path.join(dir, `${path.basename(db.name)}.before-repair-stuck-pos-shifts-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.bak`)
    await db.backup(dest)
    console.log(`สำรอง DB แล้ว: ${dest}`)
  }
  console.log(`พบกะปิดแล้วแต่ไม่มี journal ปิดกะ ${stuck.length} กะ\n`)

  const rows: Row[] = stuck.map(s => {
    const r = repairStuckShift(s, ACTOR, { dryRun: !apply })
    return {
      shift: `${s.shift_number}${tenant ? '' : ` (${String(s.tenant_id).slice(0, 8)})`}`,
      date: r.date || '-',
      total: money(s.total_revenue),
      diff: money(s.cash_difference),
      status: r.status,
      what: r.message,
    }
  })
  if (rows.length) printTable(rows)

  const count = (st: ShiftRepairResult['status']) => rows.filter(r => r.status === st).length
  const blocked = count('blocked')
  console.log(`\nสรุป: ${apply ? 'ลงบัญชีแล้ว' : 'ลงได้'} ${count('posted')} กะ · ข้าม ${count('skip')} กะ · ติด ${blocked} กะ${blocked ? ' (แก้ตามข้อความแล้วรันซ้ำได้ — กะที่ลงแล้วจะไม่ลงซ้ำ)' : ''}`)
  if (!apply && count('posted') > 0) console.log('ตรวจแล้วถูกต้อง → รันคำสั่งเดิมเติม --apply')
  return blocked
}

main()
  .then(blocked => { db.close(); process.exit(blocked ? 1 : 0) })
  .catch(e => { console.error(`❌ ${e?.message || e}`); db.close(); process.exit(2) })
