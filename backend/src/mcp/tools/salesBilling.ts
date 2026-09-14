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
  // ── create_sales_invoice ────────────────────────────────────────────────────
  server.tool(
    'create_sales_invoice',
    `ออกใบแจ้งหนี้จากคำสั่งขาย (SO) / Create a sales invoice from a confirmed sales order.
ใช้เมื่อผู้ใช้ต้องการออกใบแจ้งหนี้ วางบิล หรือเรียกเก็บเงินจากลูกค้าตาม SO ที่ส่งของแล้ว
1 ใบแจ้งหนี้ต่อ 1 SO เท่านั้น — ถ้า SO นี้มีใบแจ้งหนี้ที่ยังไม่ยกเลิกอยู่แล้วจะออกซ้ำไม่ได้ (กันรายได้ลงบัญชีซ้ำ)
ลงบัญชีทันที: DR ลูกหนี้การค้า / CR รายได้ขาย+ภาษีขาย (และ COGS/สต็อกถ้ามี)
ตัวอย่าง: "ออกใบแจ้งหนี้ SO-2026-00042" → create_sales_invoice(so_id="SO-2026-00042")`,
    {
      so_id: z.string().describe('ID หรือเลขที่ SO เช่น SO-2026-00001'),
      due_date: z.string().optional().describe('วันครบกำหนดชำระ (YYYY-MM-DD)'),
      notes: z.string().optional().describe('หมายเหตุบนใบแจ้งหนี้'),
    },
    async (args) => {
      if (!canHandleBillingByUserId(userId, callerRole, 'sales')) {
        return ok({ success: false, message: 'ไม่มีสิทธิ์ทำรายการนี้ — ต้องอยู่ฝ่ายขาย/ฝ่ายบัญชี หรือเป็น ADMIN/MASTER' })
      }
      const { so_id, due_date, notes } = args
      const so = findSalesOrder(so_id, tenantId)
      if (!so) return ok({ success: false, message: `ไม่พบ SO: ${so_id}` })

      let result: { invoice: any; items: any[] }
      try {
        result = createInvoiceFromSO(tenantId, { salesOrderId: so.id, dueDate: due_date, notes })
      } catch (err: any) {
        if (err instanceof SalesBillingError) return ok({ success: false, message: err.message })
        throw err
      }

      const { invoice } = result
      const table = [
        { รายการ: 'เลขที่ใบแจ้งหนี้', ค่า: invoice.invoice_number },
        { รายการ: 'อ้างอิง SO', ค่า: so.so_number },
        { รายการ: 'ยอดรวม', ค่า: money(invoice.total_amount) },
        { รายการ: 'ภาษีขาย', ค่า: money(invoice.tax_amount) },
        { รายการ: 'ยอดค้างชำระ', ค่า: money(invoice.balance_amount) },
        { รายการ: 'สถานะ', ค่า: invoice.status },
      ]

      return ok({
        success: true,
        invoiceNumber: invoice.invoice_number,
        invoiceId: invoice.id,
        soNumber: so.so_number,
        status: invoice.status,
        totalAmount: invoice.total_amount,
        balanceAmount: invoice.balance_amount,
        table,
        message: `ออกใบแจ้งหนี้ ${invoice.invoice_number} จาก ${so.so_number} แล้ว ยอด ${money(invoice.total_amount)} — ลงบัญชีแล้ว แสดงตารางให้ผู้ใช้ตรวจก่อนเสมอ`,
      })
    }
  )

  // ── record_customer_payment ─────────────────────────────────────────────────
  server.tool(
    'record_customer_payment',
    `รับชำระเงินจากลูกค้าเข้าใบแจ้งหนี้ / Record a customer payment against an invoice.
ใช้เมื่อลูกค้าโอนเงิน/จ่ายเงินสดมา ให้ระบุ invoice_id (เลขที่ใบแจ้งหนี้) หรือ so_id (จะหาใบแจ้งหนี้
ที่ยังไม่ยกเลิกของ SO นั้นให้เอง) — รับชำระบางส่วนได้ (สถานะจะเป็น PARTIAL) รับเกินยอดค้างไม่ได้
ลงบัญชีทันที: DR เงินสด/ธนาคาร / CR ลูกหนี้การค้า (คนละชุดจากตอนออกใบแจ้งหนี้ ไม่ซ้ำกัน)
ตัวอย่าง: "ลูกค้าโอนเงินมา 5000 บาทสำหรับ INV-2026-00010" → record_customer_payment(invoice_id="INV-2026-00010", amount=5000, payment_method="TRANSFER")`,
    {
      invoice_id: z.string().optional().describe('ID หรือเลขที่ใบแจ้งหนี้ เช่น INV-2026-00001'),
      so_id: z.string().optional().describe('ID หรือเลขที่ SO — ใช้แทน invoice_id ได้ถ้าไม่รู้เลขใบแจ้งหนี้'),
      amount: z.number().positive().describe('จำนวนเงินที่รับชำระ (บาท) — รับเกินยอดค้างไม่ได้'),
      payment_method: z.enum(['CASH', 'TRANSFER', 'CHEQUE', 'CREDIT_CARD', 'QR_CODE']).optional().describe('วิธีชำระ (default: CASH)'),
      payment_reference: z.string().optional().describe('เลขอ้างอิง เช่น เลขสลิปโอน/เช็ค'),
      receipt_date: z.string().optional().describe('วันที่รับชำระ (YYYY-MM-DD) — ไม่ระบุใช้วันนี้'),
      notes: z.string().optional().describe('หมายเหตุ'),
      bank_account_id: z.string().optional().describe('บัญชีธนาคารที่รับเงินเข้า (ถ้ามีตั้งไว้)'),
    },
    async (args) => {
      if (!canHandleBillingByUserId(userId, callerRole, 'sales')) {
        return ok({ success: false, message: 'ไม่มีสิทธิ์ทำรายการนี้ — ต้องอยู่ฝ่ายขาย/ฝ่ายบัญชี หรือเป็น ADMIN/MASTER' })
      }
      const { invoice_id, so_id, amount, payment_method, payment_reference, receipt_date, notes, bank_account_id } = args
      if (!invoice_id && !so_id) return ok({ success: false, message: 'ต้องระบุ invoice_id หรือ so_id อย่างน้อยหนึ่งอย่าง' })

      let invoice: any = null
      if (invoice_id) {
        invoice = findInvoice(invoice_id, tenantId)
        if (!invoice) return ok({ success: false, message: `ไม่พบใบแจ้งหนี้: ${invoice_id}` })
      } else {
        const so = findSalesOrder(so_id!, tenantId)
        if (!so) return ok({ success: false, message: `ไม่พบ SO: ${so_id}` })
        invoice = findActiveInvoiceForSO(tenantId, so.id)
        if (!invoice) return ok({ success: false, message: `SO ${so.so_number} ยังไม่มีใบแจ้งหนี้ที่ใช้งานอยู่ — ออกใบแจ้งหนี้ก่อนด้วย create_sales_invoice` })
      }

      const previousBalance = invoice.balance_amount
      const previousPaid = invoice.paid_amount

      let result: { receipt: any; invoice: any }
      try {
        result = recordCustomerPayment(tenantId, {
          invoiceId: invoice.id,
          amount,
          paymentMethod: payment_method,
          paymentReference: payment_reference,
          receiptDate: receipt_date,
          notes,
          bankAccountId: bank_account_id || null,
        })
      } catch (err: any) {
        if (err instanceof SalesBillingError) return ok({ success: false, message: err.message })
        throw err
      }

      const { receipt, invoice: updatedInvoice } = result
      const table = [
        { รายการ: 'ยอดใบแจ้งหนี้', ค่า: money(updatedInvoice.total_amount) },
        { รายการ: 'ยอดค้างก่อนรับชำระ', ค่า: money(previousBalance) },
        { รายการ: 'รับชำระครั้งนี้', ค่า: money(amount) },
        { รายการ: 'ยอดค้างหลังรับชำระ', ค่า: money(updatedInvoice.balance_amount) },
        { รายการ: 'ชำระแล้วสะสม', ค่า: money(updatedInvoice.paid_amount) },
        { รายการ: 'สถานะใบแจ้งหนี้', ค่า: updatedInvoice.status },
      ]

      return ok({
        success: true,
        receiptNumber: receipt.receipt_number,
        invoiceNumber: updatedInvoice.invoice_number,
        status: updatedInvoice.status,
        balanceAmount: updatedInvoice.balance_amount,
        table,
        message: `รับชำระ ${money(amount)} เข้า ${updatedInvoice.invoice_number} แล้ว (ใบเสร็จ ${receipt.receipt_number}) — สถานะ ${updatedInvoice.status} ลงบัญชีแล้ว แสดงตารางให้ผู้ใช้ตรวจก่อนเสมอ`,
      })
    }
  )
}
