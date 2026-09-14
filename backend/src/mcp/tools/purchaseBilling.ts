import { z } from 'zod'
import db from '../../db/sqlite'
import { IMcpServer } from '../sdk-compat'
import { ok } from './shared'
import { canHandleBillingByUserId } from '../../services/rbac.service'
import {
  createPurchaseInvoice,
  paySupplier,
  PurchaseBillingError,
} from '../../services/purchaseBilling.service'

// เงินออกจากบริษัทเป็นเรื่องใหญ่ — เจ้าของตัดสินใจ 2026-09-14 ว่า pay_supplier ต้องเช็คสิทธิ์
// REST เดิม (POST /payments) ไม่เช็ค role เลย (รายงานไว้แล้วในสรุปงาน) จึงยึดตาม role ที่ REST
// ใช้เช็คจุดที่ใกล้เคียงที่สุดในไฟล์เดียวกัน (ยกเลิกใบแจ้งหนี้ซื้อ / ยกเลิกการจ่ายเงิน)

function findGoodsReceipt(tenantId: string, idOrNumber: string): any {
  let gr = db.prepare('SELECT * FROM goods_receipts WHERE id = ? AND tenant_id = ?').get(idOrNumber, tenantId) as any
  if (!gr) gr = db.prepare('SELECT * FROM goods_receipts WHERE gr_number = ? AND tenant_id = ?').get(idOrNumber, tenantId) as any
  return gr
}

function findPurchaseInvoice(tenantId: string, idOrNumber: string): any {
  let pi = db.prepare('SELECT * FROM purchase_invoices WHERE id = ? AND tenant_id = ?').get(idOrNumber, tenantId) as any
  if (!pi) pi = db.prepare('SELECT * FROM purchase_invoices WHERE pi_number = ? AND tenant_id = ?').get(idOrNumber, tenantId) as any
  return pi
}

export function registerPurchaseBillingTools(server: IMcpServer, tenantId: string, userId: string, callerName: string, callerRole: string): void {
  // ── create_purchase_invoice ─────────────────────────────────────────────────
  server.tool(
    'create_purchase_invoice',
    `ออกใบแจ้งหนี้ซื้อ (Purchase Invoice) จากใบรับสินค้า (GR) ที่ยืนยันแล้ว / Create a purchase invoice from one or more confirmed goods receipts.
รับได้หลาย GR ต่อ 1 ใบแจ้งหนี้ (goods_receipt_ids) — ทุก GR ต้องมาจาก PO เดียวกัน ยืนยันแล้ว และยังไม่ถูกออกใบแจ้งหนี้มาก่อน
ระบบจะลงบัญชีอัตโนมัติ: Dr สต็อกวัตถุดิบ + Dr ภาษีซื้อ (ถ้ามี) = Cr เจ้าหนี้การค้า
ตัวอย่าง: "ออกใบแจ้งหนี้จาก GR-2026-00003" → create_purchase_invoice(goods_receipt_ids=["GR-2026-00003"])
ตัวอย่าง: "รวม GR-2026-00003 กับ GR-2026-00004 ออกใบแจ้งหนี้เดียว" → create_purchase_invoice(goods_receipt_ids=["GR-2026-00003","GR-2026-00004"])`,
    {
      goods_receipt_ids: z.array(z.string()).min(1).describe('ID หรือเลขที่ GR (gr_number) อย่างน้อย 1 ใบ — ทุกใบต้องมาจาก PO เดียวกัน'),
      supplier_invoice_number: z.string().optional().describe('เลขที่ใบแจ้งหนี้ของผู้ขาย (ถ้ามี)'),
      invoice_date: z.string().optional().describe('วันที่ใบแจ้งหนี้ (YYYY-MM-DD) — default วันนี้'),
      due_date: z.string().optional().describe('วันครบกำหนดจ่าย (YYYY-MM-DD)'),
      tax_rate: z.number().min(0).max(30).optional().describe('อัตราภาษี % — default ตาม PO หรือ 7%'),
      notes: z.string().optional().describe('หมายเหตุ'),
    },
    async (args) => {
      const { goods_receipt_ids, supplier_invoice_number, invoice_date, due_date, tax_rate, notes } = args

      const grRows: any[] = []
      for (const idOrNumber of goods_receipt_ids) {
        const gr = findGoodsReceipt(tenantId, idOrNumber)
        if (!gr) return ok({ success: false, message: `ไม่พบใบรับสินค้า: ${idOrNumber}` })
        grRows.push(gr)
      }
      const purchaseOrderId = grRows[0].purchase_order_id

      try {
        const invoice = createPurchaseInvoice(tenantId, callerName, {
          purchaseOrderId,
          goodsReceiptIds: grRows.map(g => g.id),
          supplierInvoiceNumber: supplier_invoice_number,
          invoiceDate: invoice_date,
          dueDate: due_date,
          taxRate: tax_rate,
          notes,
        }) as any

        // purchase_invoice_items.material_id ถูกปล่อย NULL เสมอ (ดู purchaseBilling.service.ts) —
        // ใช้ purchase_order_item_id หาชื่อรายการแทน
        const rows = (invoice.items || []).map((it: any) => ({
          รายการ: (it.purchase_order_item_id
            ? (db.prepare('SELECT description FROM purchase_order_items WHERE id = ?').get(it.purchase_order_item_id) as any)?.description
            : null) || '-',
          จำนวน: it.quantity,
          ราคาต่อหน่วย: it.unit_price,
          รวม: it.total_price,
        }))

        return ok({
          success: true,
          piNumber: invoice.pi_number,
          piId: invoice.id,
          goodsReceiptIds: grRows.map(g => g.gr_number),
          รายการ: rows,
          สรุปยอด: {
            มูลค่าก่อนภาษี: invoice.subtotal,
            ภาษีมูลค่าเพิ่ม: invoice.tax_amount,
            ยอดรวม: invoice.total_amount,
            ค้างจ่าย: invoice.balance_amount,
          },
          message: `ออกใบแจ้งหนี้ซื้อ ${invoice.pi_number} จาก ${grRows.length} GR แล้ว ยอดรวม ฿${invoice.total_amount.toLocaleString()}`,
        })
      } catch (error: any) {
        if (error instanceof PurchaseBillingError) return ok({ success: false, message: error.message })
        return ok({ success: false, message: error.message || 'ออกใบแจ้งหนี้ซื้อไม่สำเร็จ' })
      }
    }
  )

  // ── pay_supplier ────────────────────────────────────────────────────────────
  server.tool(
    'pay_supplier',
    `บันทึกจ่ายเงินให้ผู้ขาย (Supplier Payment) ตัดกับใบแจ้งหนี้ซื้อ / Record a payment to a supplier against a purchase invoice.
รองรับจ่ายบางส่วน (amount น้อยกว่ายอดค้าง) และภาษีหัก ณ ที่จ่าย (withholding_tax)
⚠️ เงินออกจากบริษัทจริง — ต้องมีสิทธิ์ ADMIN/MANAGER/MASTER/POWERUSER เท่านั้น
ตัวอย่าง: "จ่ายเงิน PI-2026-00002 เต็มจำนวน โอนธนาคาร" → pay_supplier(purchase_invoice_id="PI-2026-00002", amount=<ยอดค้าง>, payment_method="TRANSFER")
ตัวอย่าง: "จ่าย PI-2026-00002 ไปก่อน 5000 บาท หัก ณ ที่จ่าย 150" → pay_supplier(purchase_invoice_id="PI-2026-00002", amount=5000, withholding_tax=150)`,
    {
      purchase_invoice_id: z.string().describe('ID หรือเลขที่ใบแจ้งหนี้ซื้อ (pi_number) ที่จะจ่าย'),
      amount: z.number().positive().describe('จำนวนเงินที่จ่าย (รวมภาษีหัก ณ ที่จ่ายแล้ว ถ้ามี) — ต้องไม่เกินยอดค้างของใบแจ้งหนี้'),
      payment_method: z.enum(['CASH', 'TRANSFER']).optional().describe('วิธีจ่าย — default TRANSFER (โอนธนาคาร)'),
      payment_date: z.string().optional().describe('วันที่จ่าย (YYYY-MM-DD) — default วันนี้'),
      payment_reference: z.string().optional().describe('เลขอ้างอิง เช่น เลขที่เช็คหรือ transaction'),
      withholding_tax: z.number().min(0).optional().describe('ภาษีหัก ณ ที่จ่าย (บาท) ถ้ามี — amount ที่ส่งมาต้องรวมส่วนนี้แล้ว'),
      bank_account_id: z.string().optional().describe('ID บัญชีธนาคารที่จ่ายออก ถ้าระบุจะลงบัญชี GL ที่ผูกกับบัญชีนั้น'),
      notes: z.string().optional().describe('หมายเหตุ'),
    },
    async (args) => {
      if (!canHandleBillingByUserId(userId, callerRole, 'purchase')) {
        return ok({ success: false, message: 'ไม่มีสิทธิ์จ่ายเงินผู้ขาย — ต้องอยู่ฝ่ายจัดซื้อ/ฝ่ายบัญชี หรือเป็น ADMIN/MASTER' })
      }

      const { purchase_invoice_id, amount, payment_method, payment_date, payment_reference, withholding_tax, bank_account_id, notes } = args

      const invoice = findPurchaseInvoice(tenantId, purchase_invoice_id)
      if (!invoice) return ok({ success: false, message: `ไม่พบใบแจ้งหนี้ซื้อ: ${purchase_invoice_id}` })
      if (invoice.status === 'CANCELLED') return ok({ success: false, message: `ใบแจ้งหนี้ ${invoice.pi_number} ถูกยกเลิกไปแล้ว จ่ายเงินไม่ได้` })

      try {
        const payment = paySupplier(tenantId, callerName, {
          supplierId: invoice.supplier_id,
          purchaseInvoiceId: invoice.id,
          amount,
          paymentMethod: payment_method,
          paymentDate: payment_date,
          paymentReference: payment_reference,
          withholdingTax: withholding_tax,
          bankAccountId: bank_account_id,
          notes,
        }) as any

        return ok({
          success: true,
          paymentNumber: payment.payment_number,
          paymentId: payment.id,
          piNumber: invoice.pi_number,
          ตาราง: {
            ยอดจ่าย: payment.amount,
            ภาษีหัก_ณ_ที่จ่าย: payment.withholding_tax,
            เงินสดออกจริง: payment.net_amount,
            ยอดใบแจ้งหนี้ทั้งหมด: payment.invoice?.total_amount ?? invoice.total_amount,
            จ่ายไปแล้วสะสม: payment.invoice?.paid_amount ?? null,
            คงค้างหลังจ่าย: payment.invoice?.balance_amount ?? null,
            สถานะการจ่าย: payment.invoice?.payment_status ?? null,
          },
          message: `บันทึกจ่ายเงิน ${payment.payment_number} ให้ ${invoice.pi_number} แล้ว ฿${amount.toLocaleString()}${withholding_tax ? ` (หัก ณ ที่จ่าย ฿${withholding_tax.toLocaleString()})` : ''} — คงค้าง ฿${(payment.invoice?.balance_amount ?? 0).toLocaleString()}`,
        })
      } catch (error: any) {
        if (error instanceof PurchaseBillingError) return ok({ success: false, message: error.message })
        return ok({ success: false, message: error.message || 'บันทึกจ่ายเงินไม่สำเร็จ' })
      }
    }
  )
}
