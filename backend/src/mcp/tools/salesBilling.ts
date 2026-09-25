import { z } from 'zod'
import db from '../../db/sqlite'
import { IMcpServer } from '../sdk-compat'
import { ok } from './shared'
import { canHandleBillingByUserId } from '../../services/rbac.service'
import {
  createInvoiceFromSO, recordCustomerPayment, findActiveInvoiceForSO, SalesBillingError,
} from '../../services/salesBilling.service'

/**
 * MCP tools สำหรับ 2 จุดเดียวที่สายขายลงบัญชี: ออกใบแจ้งหนี้ + รับชำระเงิน
 * ตรรกะจริงทั้งหมดอยู่ที่ services/salesBilling.service.ts (ตัวเดียวกับที่
 * routes/sales/invoices.ts และ routes/sales/receipts.ts เรียก) — ไฟล์นี้มีหน้าที่แค่
 * รับ args จาก AI, resolve SO/invoice จาก id หรือเลขที่เอกสาร, แล้วพับผลลัพธ์เป็นตาราง
 * ให้ผู้ใช้ตรวจก่อนเชื่อ (ตามที่เจ้าของสั่ง 2026-09-14) ห้ามมีตรรกะบัญชี/กันซ้ำซ้อนอยู่ในนี้เอง
 */

const findSalesOrder = (soId: string, tenantId: string): any => {
  let so = db.prepare('SELECT * FROM sales_orders WHERE id = ? AND tenant_id = ?').get(soId, tenantId) as any
  if (!so) so = db.prepare('SELECT * FROM sales_orders WHERE so_number = ? AND tenant_id = ?').get(soId, tenantId) as any
  return so
}

const findInvoice = (invoiceId: string, tenantId: string): any => {
  let inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(invoiceId, tenantId) as any
  if (!inv) inv = db.prepare('SELECT * FROM invoices WHERE invoice_number = ? AND tenant_id = ?').get(invoiceId, tenantId) as any
  return inv
}

const money = (n: number) => `฿${Number(n || 0).toLocaleString()}`

export function registerSalesBillingTools(server: IMcpServer, tenantId: string, userId: string, callerName: string, callerRole: string): void {
}
