// สคริปต์ one-off รันไปแล้วเมื่อ 2026-10-14 สำหรับ tenant_bb_pillow ห้ามรันซ้ำ เก็บไว้เป็นบันทึกประวัติเท่านั้น
// รวม SKU ซ้ำนูเทลล่า: เก็บ ING-NUT ลบ ING-N01 ถาวร (tenant_bb_pillow)
// ใช้: node 2026-10-14-merge-nutella.js            -> dry-run (ไม่เขียนอะไร)
//     node 2026-10-14-merge-nutella.js --apply      -> ของจริง (backup ก่อนเขียนเสมอ)
const path = require('path')
const D = require('/opt/crm/backend/node_modules/better-sqlite3')

const DB_PATH = '/opt/crm/backend/dev.db'
const BACKUP_PATH = '/root/dev.db.bak.merge-nutella-20261014'
const TENANT = 'tenant_bb_pillow'
const N01 = 'de3d1884249149bfa9923309a' // ING-N01 (ลบ)
const NUT = 'bc2002900ac2467fbed621d76' // ING-NUT (เก็บ)
const APPLY = process.argv.includes('--apply')
const now = new Date().toISOString()

function genId() {
  return require('crypto').randomBytes(12).toString('hex')
}

async function main() {
  if (!process.argv.includes('--i-know-this-was-run')) {
    console.error('สคริปต์ one-off รันไปแล้วเมื่อ 2026-10-14 สำหรับ tenant_bb_pillow ห้ามรันซ้ำ เก็บไว้เป็นบันทึกประวัติเท่านั้น')
    process.exit(1)
  }

  // เปิด read-only ก่อนเสมอเพื่อตรวจสภาพ ไม่เสี่ยงเขียนพลาดตอน dry-run
  let db = new D(DB_PATH, { readonly: !APPLY })

  const n01 = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(N01, TENANT)
  const nut = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(NUT, TENANT)

  if (!n01 || !nut) {
    console.error('ไม่พบแถวใดแถวหนึ่ง (N01 หรือ NUT) — หยุด', { n01: !!n01, nut: !!nut })
    process.exit(1)
  }
  console.log('ก่อนแก้ — ING-N01:', { qty: n01.quantity, sealed: n01.sealed_qty, unit: n01.unit, base_unit: n01.base_unit, status: n01.status })
  console.log('ก่อนแก้ — ING-NUT:', { qty: nut.quantity, sealed: nut.sealed_qty, unit: nut.unit, base_unit: nut.base_unit, status: nut.status })

  if (n01.base_unit !== nut.base_unit || n01.unit !== nut.unit) {
    console.error('หน่วยไม่ตรงกัน ต้องแปลงก่อนย้าย — หยุดตามกฎ (ห้ามย้ายตัวเลขดิบข้ามหน่วย)')
    process.exit(1)
  }

  // bom_items ที่ยังชี้ N01 (คาดว่า 0 แถว จากรอบ merge 2026-10-11 ที่ทำไปแล้ว)
  const bomRows = db.prepare('SELECT * FROM bom_items WHERE material_id = ?').all(N01)
  console.log('bom_items ที่ยังชี้ ING-N01:', bomRows.length)
  for (const r of bomRows) {
    console.log('  ', JSON.stringify(r))
  }

  const movRows = db.prepare('SELECT * FROM stock_movements WHERE stock_item_id = ?').all(N01)
  const adjRows = db.prepare('SELECT * FROM stock_adjustments WHERE stock_item_id = ?').all(N01)
  const posRows = db.prepare('SELECT * FROM pos_menu_configs WHERE product_id = ?').all(N01)
  console.log('stock_movements อ้าง N01:', movRows.length)
  console.log('stock_adjustments อ้าง N01:', adjRows.length)
  console.log('pos_menu_configs อ้าง N01:', posRows.length)

  const baselineFk = db.prepare('PRAGMA foreign_key_check').all()
  const baselineCount = baselineFk.length
  console.log('foreign_key_check ก่อนแก้ (baseline ที่มีอยู่แล้ว ไม่เกี่ยวกับงานนี้):', baselineCount, 'แถว (คาดว่าเป็น pos_daily_sales->users เดิม)')

  if (!APPLY) {
    console.log('\n=== DRY RUN เท่านั้น — จะทำสิ่งต่อไปนี้ถ้ารัน --apply ===')
    if (n01.quantity > 0) {
      console.log(`- โอนสต็อก ${n01.quantity} ${n01.unit} จาก ING-N01 เข้า ING-NUT ผ่าน stock movement (type IN, reason: รวม SKU ซ้ำ ING-N01→ING-NUT)`)
    } else {
      console.log('- ไม่มีสต็อกให้โอน (quantity=0)')
    }
    for (const r of bomRows) console.log(`- ย้าย bom_items ${r.id} (bom ${r.bom_id}) material_id -> ING-NUT`)
    for (const r of movRows) console.log(`- repoint stock_movements ${r.id} -> ING-NUT`)
    for (const r of adjRows) console.log(`- repoint stock_adjustments ${r.id} (${r.adjustment_number}) -> ING-NUT`)
    for (const r of posRows) console.log(`- repoint pos_menu_configs ${r.id} -> ING-NUT`)
    console.log('- DELETE stock_items ING-N01')
    db.close()
    return
  }

  // ===== APPLY =====
  db.close()
  // backup ด้วย better-sqlite3 .backup() (รวม WAL) ก่อนเขียนจริง
  const backupSrc = new D(DB_PATH, { readonly: true })
  await backupSrc.backup(BACKUP_PATH)
  backupSrc.close()
  console.log('backup แล้ว:', BACKUP_PATH)

  db = new D(DB_PATH)
  db.pragma('foreign_keys = ON')

  const tx = db.transaction(() => {
    const n01now = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(N01, TENANT)
    const nutNow = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(NUT, TENANT)
    if (!n01now || !nutNow) throw new Error('แถวหายไปตอน apply ผิดปกติ หยุด')
    if (n01now.base_unit !== nutNow.base_unit || n01now.unit !== nutNow.unit) {
      throw new Error('หน่วยไม่ตรงกันตอน apply (เปลี่ยนไปจาก dry-run) หยุด')
    }

    const results = { bomMoved: [], movementsRepointed: [], adjustmentsRepointed: [], posConfigsRepointed: [], transferQty: 0 }

    // 1) ย้าย bom_items ที่ชี้ N01 -> NUT (ถ้ามี ชนกันในบอมเดียวกันให้รวมแถว, ถ้าหน่วยต่างหยุด)
    const bomRowsNow = db.prepare('SELECT * FROM bom_items WHERE material_id = ?').all(N01)
    for (const r of bomRowsNow) {
      const existing = db.prepare('SELECT * FROM bom_items WHERE bom_id = ? AND material_id = ? AND id != ?').get(r.bom_id, NUT, r.id)
      if (existing) {
        if (existing.unit !== r.unit) {
          throw new Error(`BOM ${r.bom_id}: หน่วยไม่ตรงกันระหว่างบรรทัด N01 (${r.unit}) กับ NUT (${existing.unit}) — ต้องแปลงหน่วยเอง หยุด`)
        }
        db.prepare('UPDATE bom_items SET quantity = quantity + ? WHERE id = ?').run(r.quantity, existing.id)
        db.prepare('DELETE FROM bom_items WHERE id = ?').run(r.id)
        results.bomMoved.push({ bomId: r.bom_id, merged_into: existing.id, qtyAdded: r.quantity, unit: r.unit })
      } else {
        db.prepare('UPDATE bom_items SET material_id = ? WHERE id = ?').run(NUT, r.id)
        results.bomMoved.push({ bomId: r.bom_id, lineId: r.id, qty: r.quantity, unit: r.unit })
      }
    }

    // 2) โอนสต็อกผ่าน stock_movements (เลียนแบบ applyStockMovement type IN แบบย่อ เพราะ unit_cost ทั้งคู่ = 0 ไม่ต้องลง journal)
    if (n01now.quantity > 0) {
      const movId = genId()
      db.prepare(`
        INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by)
        VALUES (?, ?, ?, 'IN', ?, ?, ?, ?, ?, ?, ?)
      `).run(movId, TENANT, NUT, n01now.quantity, n01now.unit, n01now.quantity, 'MERGE ING-N01->ING-NUT', 'รวม SKU ซ้ำ ING-N01→ING-NUT', now, 'system-merge-script')
      db.prepare('UPDATE stock_items SET quantity = quantity + ?, updated_at = ? WHERE id = ?').run(n01now.quantity, now, NUT)
      db.prepare('UPDATE stock_items SET quantity = 0, updated_at = ? WHERE id = ?').run(now, N01)
      results.transferQty = n01now.quantity
      results.transferMovementId = movId
    }

    // 3) repoint ประวัติที่ชี้ N01 -> NUT เพื่อไม่ให้ลบแล้ว FK พัง
    const movRowsNow = db.prepare('SELECT id FROM stock_movements WHERE stock_item_id = ?').all(N01)
    for (const r of movRowsNow) {
      db.prepare('UPDATE stock_movements SET stock_item_id = ? WHERE id = ?').run(NUT, r.id)
      results.movementsRepointed.push(r.id)
    }
    const adjRowsNow = db.prepare('SELECT id, adjustment_number FROM stock_adjustments WHERE stock_item_id = ?').all(N01)
    for (const r of adjRowsNow) {
      db.prepare('UPDATE stock_adjustments SET stock_item_id = ? WHERE id = ?').run(NUT, r.id)
      results.adjustmentsRepointed.push(r)
    }
    const posRowsNow = db.prepare('SELECT id FROM pos_menu_configs WHERE product_id = ?').all(N01)
    for (const r of posRowsNow) {
      const conflict = db.prepare('SELECT id FROM pos_menu_configs WHERE tenant_id = ? AND product_id = ? AND id != ?').get(TENANT, NUT, r.id)
      if (conflict) {
        // ING-NUT มี config อยู่แล้ว กันชน UNIQUE(tenant_id, product_id) -> ลบของ N01 ทิ้ง (ซ้ำซ้อน)
        db.prepare('DELETE FROM pos_menu_configs WHERE id = ?').run(r.id)
        results.posConfigsRepointed.push({ id: r.id, action: 'deleted_duplicate' })
      } else {
        db.prepare('UPDATE pos_menu_configs SET product_id = ? WHERE id = ?').run(NUT, r.id)
        results.posConfigsRepointed.push({ id: r.id, action: 'repointed' })
      }
    }

    // 4) ลบ ING-N01 ถาวร
    db.prepare('DELETE FROM stock_items WHERE id = ? AND tenant_id = ?').run(N01, TENANT)

    // 5) ตรวจ FK ทันทีในทรานแซกชัน ต้องไม่มีแถวใหม่ (เทียบกับ baseline เดิม)
    const fkAfter = db.prepare('PRAGMA foreign_key_check').all()
    if (fkAfter.length > baselineCount) {
      throw new Error('foreign_key_check พบแถวพังเพิ่มขึ้นหลังแก้ — rollback. ' + JSON.stringify(fkAfter))
    }

    return results
  })

  const results = tx()
  db.pragma('wal_checkpoint(TRUNCATE)')

  const nutAfter = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(NUT)
  const n01After = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(N01)
  console.log('\n=== ผลลัพธ์ ===')
  console.log('bomMoved:', JSON.stringify(results.bomMoved, null, 2))
  console.log('transferQty:', results.transferQty, 'movementId:', results.transferMovementId)
  console.log('movementsRepointed:', results.movementsRepointed)
  console.log('adjustmentsRepointed:', JSON.stringify(results.adjustmentsRepointed))
  console.log('posConfigsRepointed:', JSON.stringify(results.posConfigsRepointed))
  console.log('ING-NUT หลังแก้:', nutAfter ? { qty: nutAfter.quantity, status: nutAfter.status } : null)
  console.log('ING-N01 หลังแก้ (ควรเป็น undefined = ลบแล้ว):', n01After)

  const fkFinal = db.prepare('PRAGMA foreign_key_check').all()
  console.log('foreign_key_check สุดท้าย:', fkFinal.length, 'แถว (baseline เดิม', baselineCount, ')')
  db.close()
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
