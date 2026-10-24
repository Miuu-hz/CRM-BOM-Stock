import { gateOrCreate, CreateRequestArgs, GateUser } from './approvalGate.service'
import { canCancelPurchaseDirect } from './rbac.service'

/**
 * ยกเลิก/void เอกสารซื้อ — เจ้าของสั่ง 2026-10-24 (D3)
 * คนที่มีสิทธิ์แผนก (canCancelPurchaseDirect) ยกเลิกได้เลยแต่ถูกบันทึก (recordAutoAction)
 * คนอื่นได้ 202 + คำขอหมวด 'purchase_cancel' (ต้องอนุมัติเสมอ) แล้ว approval.routes.ts เรียก executor ตัวเดียวกัน
 * แบบเดียวกับ salesCancel.service.ts
 */

export type PurchaseCancelKind = 'purchase_order' | 'goods_receipt' | 'purchase_invoice' | 'supplier_payment' | 'purchase_return'

/** ยกเลิกไม่ได้ด้วยเหตุทางธุรกิจ — status = HTTP status, message ส่งถึงหน้าจอตรง ๆ */
export class PurchaseCancelError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

const KIND_LABEL: Record<PurchaseCancelKind, string> = {
  purchase_order: 'ใบสั่งซื้อ', goods_receipt: 'ใบรับสินค้า', purchase_invoice: 'ใบแจ้งหนี้ซื้อ',
  supplier_payment: 'ใบจ่ายเงินผู้ขาย', purchase_return: 'ใบคืนสินค้า',
}
const KIND_REF_TYPE: Record<PurchaseCancelKind, string> = {
  purchase_order: 'purchase_orders', goods_receipt: 'goods_receipts', purchase_invoice: 'purchase_invoices',
  supplier_payment: 'supplier_payments', purchase_return: 'purchase_returns',
}

/**
 * pending ไม่ใช่ null = ตอบ 202 แล้วหยุด · pending = null → ยกเลิกเลย แล้ว recordAutoAction(gateArgs)
 */
export function gatePurchaseCancel(input: {
  tenantId: string
  user: GateUser
  kind: PurchaseCancelKind
  refId: string
  docNumber: string
  amount?: number
}): { pending: any | null; gateArgs: CreateRequestArgs } {
  const amount = Math.round(Math.abs(Number(input.amount) || 0) * 100) / 100
  const gateArgs: CreateRequestArgs = {
    tenantId: input.tenantId,
    user: input.user,
    category: 'purchase_cancel',
    refType: KIND_REF_TYPE[input.kind],
    refId: input.refId,
    amount,
    description: `ขอยกเลิก${KIND_LABEL[input.kind]} ${input.docNumber} ยอด ฿${amount.toLocaleString()}`,
    payload: { kind: input.kind, refId: input.refId, docNumber: input.docNumber, severity: 'high' },
  }
  const pending = canCancelPurchaseDirect(input.user) ? null : gateOrCreate(gateArgs)
  return { pending, gateArgs }
}

/** body ของคำตอบ 202 — รูปเดียวกับ sales_cancel */
export function pendingPurchaseCancelBody(pending: any, docNumber: string) {
  return {
    success: true,
    pending_approval: true,
    request_id: pending.id,
    request_number: pending.request_number,
    message: `ส่งคำขออนุมัติแล้ว (${pending.request_number}) — ${docNumber} จะถูกยกเลิกเมื่อผู้อนุมัติยืนยัน`,
  }
}
