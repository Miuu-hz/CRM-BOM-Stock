import db from '../db/sqlite'
import { generateId, formatDocumentNumber } from '../utils/id'
import { ACC, ACC_META } from '../config/accountCodes'
import { getOrCreateAccount } from './accounting.service'

export interface SubcontractAccrualResult {
  contractId: string
  contractNumber: string
  billedQty: number
  amount: number
  journalEntryId: string
}

/**
 * เรียกจาก QC complete hook (qc.routes.ts) เมื่อ inspection ที่ผูกกับ Work Order มี passed_qty > 0
 *
 * หา wo_subcontracts ของ WO ที่ contract_type IN ('PIECE_RATE','OUTSOURCE') และยังไม่ปิดสัญญา
 * (status IN 'OPEN'/'MATERIAL_SENT'/'PARTIAL_RECEIVED'/'RECEIVED' — Phase 3 เพิ่ม OUTSOURCE ซึ่ง
 * เปลี่ยนสถานะไปตามขั้นตอนส่งวัตถุดิบ/รับของ ก่อนที่ QC จะตรวจเสร็จ) แล้วตั้งค่าแรงเหมา
 * ค้างจ่ายอัตโนมัติ (Dr ค่าจ้างเหมาช่วง 5106 / Cr ค่าใช้จ่ายค้างจ่าย 2107) โดย cap ยอดคิดค่าแรง
 * ไม่ให้เกิน agreed_qty ของแต่ละสัญญา (กันคิดซ้ำ/คิดเกินสัญญา)
 *
 * ทั้งหมดรันใน db.transaction เดียว ต่อการเรียกหนึ่งครั้ง (ครอบคลุมทุกสัญญาของ WO นั้น)
 */
export function accrueSubcontractLabor(
  tenantId: string,
  workOrderId: string,
  passedQty: number,
  createdBy?: string
): SubcontractAccrualResult[] {
  const qty = Number(passedQty) || 0
  if (qty <= 0) return []

  const contracts = db.prepare(`
    SELECT * FROM wo_subcontracts
    WHERE tenant_id = ? AND work_order_id = ?
      AND contract_type IN ('PIECE_RATE', 'OUTSOURCE')
      AND status IN ('OPEN', 'MATERIAL_SENT', 'PARTIAL_RECEIVED', 'RECEIVED')
    ORDER BY created_at ASC
  `).all(tenantId, workOrderId) as any[]

  if (contracts.length === 0) return []

  const wo = db.prepare('SELECT wo_number FROM work_orders WHERE id = ? AND tenant_id = ?').get(workOrderId, tenantId) as any
  const results: SubcontractAccrualResult[] = []

  const tx = db.transaction(() => {
    for (const contract of contracts) {
      const newBillable = Math.min(contract.billed_qty + qty, contract.agreed_qty) - contract.billed_qty
      if (newBillable <= 0) continue

      const amount = Math.round(newBillable * contract.rate_per_unit * 100) / 100
      if (amount <= 0) continue

      const laborAccId = getOrCreateAccount(
        tenantId, ACC.SUBCON_LABOR,
        ACC_META[ACC.SUBCON_LABOR]!.name, ACC_META[ACC.SUBCON_LABOR]!.type,
        ACC_META[ACC.SUBCON_LABOR]!.category, ACC_META[ACC.SUBCON_LABOR]!.normalBalance
      )
      const accruedAccId = getOrCreateAccount(
        tenantId, ACC.ACCRUED,
        ACC_META[ACC.ACCRUED]!.name, ACC_META[ACC.ACCRUED]!.type,
        ACC_META[ACC.ACCRUED]!.category, ACC_META[ACC.ACCRUED]!.normalBalance
      )

      const now = new Date().toISOString()
      const journalId = generateId()
      const journalNumber = formatDocumentNumber('JV', tenantId, 'JOURNAL', new Date(now).getFullYear(), 5)
      const desc = `ค่าจ้างเหมาช่วง ${contract.contract_number} - WO ${wo?.wo_number || workOrderId} (${newBillable} หน่วย)`

      db.prepare(`
        INSERT INTO journal_entries
          (id, tenant_id, entry_number, date, reference_type, reference_id, description,
           total_debit, total_credit, is_auto_generated, is_posted, posted_at, posted_by,
           notes, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'SUBCONTRACT', ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?)
      `).run(
        journalId, tenantId, journalNumber, now.substring(0, 10), contract.contract_number, desc,
        amount, amount, now, createdBy || 'system',
        `QC ตรวจผ่าน ${newBillable} หน่วย - สัญญา ${contract.contract_number}`,
        createdBy || 'system', now, now
      )

      const insertLine = db.prepare(`
        INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      insertLine.run(generateId(), tenantId, journalId, laborAccId, 1, desc, amount, 0)
      insertLine.run(generateId(), tenantId, journalId, accruedAccId, 2, desc, 0, amount)

      db.prepare(`
        UPDATE wo_subcontracts
        SET billed_qty = billed_qty + ?, labor_amount = labor_amount + ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run(newBillable, amount, now, contract.id, tenantId)

      db.prepare(`
        UPDATE work_orders SET actual_cost = actual_cost + ?, updated_at = ? WHERE id = ? AND tenant_id = ?
      `).run(amount, now, workOrderId, tenantId)

      results.push({ contractId: contract.id, contractNumber: contract.contract_number, billedQty: newBillable, amount, journalEntryId: journalId })
    }
  })
  tx()

  return results
}
