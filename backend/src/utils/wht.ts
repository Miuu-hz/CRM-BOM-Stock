const r2 = (n: number) => Math.round(n * 100) / 100

export interface InvoiceVatInfo {
  subtotal?: number | null
  tax_amount?: number | null
  total_amount?: number | null
  tax_rate?: number | null
}

/**
 * คำนวณฐานภาษีหัก ณ ที่จ่าย (ต้องคิดจากราคาก่อน VAT เสมอ ไม่คิดบนยอดจ่ายที่รวม VAT แล้ว)
 * - หากมีข้อมูลใบแจ้งหนี้ที่มี VAT จะถอด VAT ออกตามสัดส่วนของยอดที่จ่าย
 * - หากจ่ายเต็มจำนวน ใช้ subtotal (หรือ total - tax) ตรงๆ
 * - หากไม่มีข้อมูล VAT ในใบแจ้งหนี้ หรือไม่มีใบแจ้งหนี้ ให้ฐาน = ยอดจ่าย
 */
export function calcWhtBase(paymentAmount: number, invoice?: InvoiceVatInfo | null): number {
  const amount = r2(paymentAmount || 0)
  if (!invoice || !invoice.total_amount || invoice.total_amount <= 0) {
    return amount
  }

  const invoiceTotal = invoice.total_amount
  const invoiceTax = invoice.tax_amount ?? 0
  const invoiceSubtotal = invoice.subtotal ?? 0

  if (invoiceTax > 0) {
    // จ่ายเต็มยอดใบแจ้งหนี้
    if (Math.abs(amount - invoiceTotal) < 0.005) {
      return r2(invoiceTotal - invoiceTax) // ponytail: total-tax, subtotal may be before discount/service
    }
    // จ่ายบางส่วน: ถอด VAT ตามสัดส่วนภาษีของใบแจ้งหนี้
    const vatRatio = invoiceTax / invoiceTotal
    return r2(amount * (1 - vatRatio))
  }

  // กรณี tax_amount ไม่ได้บันทึกไว้ แต่ subtotal น้อยกว่า total_amount
  if (invoiceSubtotal > 0 && invoiceSubtotal < invoiceTotal) {
    if (Math.abs(amount - invoiceTotal) < 0.005) {
      return invoiceSubtotal
    }
    const vatRatio = (invoiceTotal - invoiceSubtotal) / invoiceTotal
    return r2(amount * (1 - vatRatio))
  }

  // ใบแจ้งหนี้ไม่มี VAT
  return amount
}

/**
 * คำนวณภาษีหัก ณ ที่จ่าย = rate × pre-VAT base
 */
export function calcWhtAmount(baseAmount: number, ratePct: number): number {
  return r2((baseAmount || 0) * (ratePct || 0) / 100)
}
