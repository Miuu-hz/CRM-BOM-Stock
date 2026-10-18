
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import db from '../../db/sqlite'
import { registerPurchaseTools } from './purchase'
import { invoiceUploadDir } from '../../routes/sales/shared'
import { createGoodsReceipt, confirmGoodsReceipt } from '../../services/goodsReceipt.service'
import { createPurchaseInvoice } from '../../services/purchaseBilling.service'

function fakeServer() {
  const tools: Record<string, any> = {}
  return {
    server: { tool: (name: string, _d: any, _s: any, handler: any) => { tools[name] = handler } } as any,
    call: (name: string, args: any) => tools[name](args),
  }
}
const parse = (res: any) => JSON.parse(res.content[0].text)

describe('Direct Purchase Flow (Cash Purchase Memory & Evidence Lineage)', () => {
  it('บันทึกข้อมูลจ่ายเงินและสลิปจาก PO -> GR -> INV Auto-settle สมบูรณ์', async () => {
    const t = 'tn_cash_' + Math.random().toString(36).slice(2, 8)
    const u = 'u_cash_' + Math.random().toString(36).slice(2, 8)

    // Seed GL account for bank
    const glAccId = 'gl_' + Math.random().toString(36).slice(2, 8)
    db.prepare(`
      INSERT INTO accounts (id, tenant_id, code, name, type, category, normal_balance, is_active, created_at, updated_at)
      VALUES (?, ?, '1102-01', 'ธนาคารกสิกรไทย', 'ASSET', 'CURRENT_ASSET', 'DEBIT', 1, datetime('now'), datetime('now'))
    `).run(glAccId, t)

    // Seed bank account KBANK linked to GL account
    const bankId = 'ba_' + Math.random().toString(36).slice(2, 8)
    db.prepare(`
      INSERT INTO bank_accounts (id, tenant_id, bank_name, account_number, account_name, account_id, is_active, is_default, created_at, updated_at)
      VALUES (?, ?, 'ธนาคารกสิกรไทย (KBANK)', '012-3-45678-9', 'หจก. เอฟแอนด์บี', ?, 1, 1, datetime('now'), datetime('now'))
    `).run(bankId, t, glAccId)

    // Seed raw material item
    const matId = 'mat_' + Math.random().toString(36).slice(2, 8)
    db.prepare(`
      INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
      VALUES (?, ?, 'RAW-099', 'เนื้อหมูสันใน', 'raw', 50, 'kg', 'kg', 124.50, 'MAIN', 'ACTIVE')
    `).run(matId, t)

    const { server, call } = fakeServer()
    registerPurchaseTools(server, t, u, 'tester', 'ADMIN')

    // 1. Create Draft PO with Payment Info & Base64 Slip
    const sampleSlipBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const poRes = parse(await call('create_draft_po', {
      items: [
        { description: 'เนื้อหมูสันใน', quantity: 1, unitPrice: 124.50 },
      ],
      supplier_hint: 'CP Axtra PCL (สาขากาฬสินธุ์)',
      payment_method: 'โอนจ่าย QR KBANK (124.50 บาท)',
      payment_reference: '116010523634 (POS ID: E104600002A0974)',
      bank_hint: 'KBANK',
      is_paid: true,
      paid_amount: 124.50,
      image_base64: sampleSlipBase64,
      image_name: 'makro_receipt.jpg',
    }))

    expect(poRes.status).toBe('DRAFT')
    expect(poRes.poId).toBeDefined()
    expect(poRes.poNumber).toMatch(/^PO-/)
    expect(poRes.boundCount).toBe(1)
    expect(poRes.items[0].material_id).toBe(matId)

    // Verify PO in database
    const poRow = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(poRes.poId) as any
    expect(poRow.is_paid).toBe(1)
    expect(poRow.paid_amount).toBe(124.50)
    expect(poRow.payment_method).toBe('โอนจ่าย QR KBANK (124.50 บาท)')
    expect(poRow.payment_reference).toBe('116010523634 (POS ID: E104600002A0974)')
    expect(poRow.bank_account_id).toBe(bankId)

    // Verify Attachment in database & disk
    const attRow = db.prepare('SELECT * FROM payment_attachments WHERE ref_type = ? AND ref_id = ?').get('PURCHASE_ORDER', poRes.poId) as any
    expect(attRow).toBeDefined()
    expect(attRow.original_name).toBe('makro_receipt.jpg')
    const fullPath = path.resolve(invoiceUploadDir, attRow.file_path)
    expect(fs.existsSync(fullPath)).toBe(true)

    // 2. Test universal MCP tool: attach_document_evidence (with a distinct second image)
    const secondSlipBase64 = Buffer.from('second-slip-image-bytes-for-po').toString('base64')
    const attachRes = parse(await call('attach_document_evidence', {
      doc_type: 'PURCHASE_ORDER',
      doc_id_or_number: poRes.poNumber,
      image_base64: secondSlipBase64,
      file_name: 'second_slip.png',
    }))
    expect(attachRes.success).toBe(true)
    expect(attachRes.attachment.doc_number).toBe(poRes.poNumber)

    // Re-uploading the exact same image is blocked as duplicate
    const dupAttachRes = parse(await call('attach_document_evidence', {
      doc_type: 'PURCHASE_ORDER',
      doc_id_or_number: poRes.poNumber,
      image_base64: sampleSlipBase64,
      file_name: 'makro_receipt_copy.jpg',
    }))
    expect(dupAttachRes.success).toBe(false)
    expect(dupAttachRes.code).toBe('DUPLICATE_ATTACHMENT')

    const allAtts = db.prepare('SELECT * FROM payment_attachments WHERE ref_id = ?').all(poRes.poId) as any[]
    expect(allAtts.length).toBe(2)

    // 3. Receive Goods (GR)
    db.prepare("UPDATE purchase_orders SET status = 'APPROVED' WHERE id = ?").run(poRes.poId)
    const gr = createGoodsReceipt(t, 'tester', {
      purchaseOrderId: poRes.poId,
      deliveryNoteNo: poRow.payment_reference,
      items: [
        { poItemId: poRes.items[0].material_id ? db.prepare('SELECT id FROM purchase_order_items WHERE purchase_order_id = ?').get(poRes.poId).id : '',
          materialId: matId,
          orderedQty: 1,
          receivedQty: 1,
          acceptedQty: 1
        }
      ]
    }) as any
    confirmGoodsReceipt(t, 'tester', gr.id)

    // Verify GR delivery_note_no preserved
    const grRow = db.prepare('SELECT * FROM goods_receipts WHERE id = ?').get(gr.id) as any
    expect(grRow.delivery_note_no).toBe('116010523634 (POS ID: E104600002A0974)')

    // 4. Create Invoice with autoPay: true
    const inv = createPurchaseInvoice(t, 'tester', {
      purchaseOrderId: poRes.poId,
      supplierInvoiceNumber: poRow.payment_reference,
      invoiceDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date().toISOString().slice(0, 10),
      taxRate: 7,
      autoPay: true,
      paymentMethod: poRow.payment_method,
      paymentReference: poRow.payment_reference,
      bankAccountId: poRow.bank_account_id,
    }) as any

    // Verify Invoice is automatically PAID
    const invRow = db.prepare('SELECT * FROM purchase_invoices WHERE id = ?').get(inv.id) as any
    expect(invRow.payment_status).toBe('PAID')
    expect(invRow.supplier_invoice_number).toBe('116010523634 (POS ID: E104600002A0974)')

    // Verify Supplier Payment was created
    const payRow = db.prepare('SELECT * FROM supplier_payments WHERE purchase_invoice_id = ?').get(inv.id) as any
    expect(payRow).toBeDefined()
    expect(payRow.amount).toBe(invRow.total_amount)
    expect(payRow.payment_reference).toBe('116010523634 (POS ID: E104600002A0974)')

    // 5. Verify duplicate blocking across all 4 layers:
    // (a) Duplicate image_base64 on create_draft_po
    const dupImgPo = parse(await call('create_draft_po', {
      items: [{ description: 'เนื้อหมูสันใน', quantity: 2, unitPrice: 124.50 }],
      supplier_hint: 'CP Axtra PCL (สาขากาฬสินธุ์)',
      image_base64: sampleSlipBase64,
    }))
    expect(dupImgPo.success).toBe(false)
    expect(dupImgPo.code).toBe('DUPLICATE_BILL')
    expect(dupImgPo.message).toMatch(/รูปสลิป\/ใบเสร็จนี้เคยอัปโหลดไว้แล้ว/)

    // (b) Duplicate payment_reference on create_draft_po
    const dupRefPo = parse(await call('create_draft_po', {
      items: [{ description: 'เนื้อหมูสันใน', quantity: 2, unitPrice: 124.50 }],
      supplier_hint: 'CP Axtra PCL (สาขากาฬสินธุ์)',
      payment_reference: '116010523634 (POS ID: E104600002A0974)',
    }))
    expect(dupRefPo.success).toBe(false)
    expect(dupRefPo.code).toBe('DUPLICATE_BILL')
    expect(dupRefPo.message).toMatch(/เลขที่ใบเสร็จ\/อ้างอิง/)
    expect(dupRefPo.existingPoNumber).toBe(poRes.poNumber)

    // (c) Duplicate bill signature (same supplier + same date + same total + same items)
    const dupSigPo = parse(await call('create_draft_po', {
      items: [{ description: 'เนื้อหมูสันใน', quantity: 1, unitPrice: 124.50 }],
      supplier_hint: 'CP Axtra PCL (สาขากาฬสินธุ์)',
    }))
    expect(dupSigPo.success).toBe(false)
    expect(dupSigPo.code).toBe('DUPLICATE_BILL')
    expect(dupSigPo.message).toMatch(/รายการสินค้าเดียวกัน/)
    expect(dupSigPo.existingPoNumber).toBe(poRes.poNumber)

    // (d) Duplicate supplierInvoiceNumber for the same supplier
    const po2Res = parse(await call('create_draft_po', {
      items: [{ description: 'เนื้อหมูสันใน', quantity: 3, unitPrice: 124.50 }],
      supplier_hint: 'CP Axtra PCL (สาขากาฬสินธุ์)',
    }))
    expect(po2Res.poId).toBeDefined()
    db.prepare("UPDATE purchase_orders SET status = 'APPROVED' WHERE id = ?").run(po2Res.poId)
    const gr2 = createGoodsReceipt(t, 'tester', {
      purchaseOrderId: po2Res.poId,
      items: [{
        poItemId: (db.prepare('SELECT id FROM purchase_order_items WHERE purchase_order_id = ?').get(po2Res.poId) as any).id,
        materialId: matId,
        orderedQty: 3,
        receivedQty: 3,
        acceptedQty: 3,
      }],
    }) as any
    confirmGoodsReceipt(t, 'tester', gr2.id)

    expect(() =>
      createPurchaseInvoice(t, 'tester', {
        purchaseOrderId: po2Res.poId,
        supplierInvoiceNumber: poRow.payment_reference,
      })
    ).toThrow(/ซ้ำกับใบแจ้งหนี้ซื้อ/)

    console.log('ALL DIRECT PURCHASE FLOW CHECKS PASSED SUCCESSFULLY!')
  })
})
