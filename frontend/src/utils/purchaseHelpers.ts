const r2 = (n: number) => Math.round(n * 100) / 100

export interface InvoiceVatInfo {
  subtotal?: number | null
  tax_amount?: number | null
  total_amount?: number | null
  tax_rate?: number | null
}

/**
 * คำนวณฐานภาษีหัก ณ ที่จ่าย (ต้องคิดจากราคาก่อน VAT เสมอ ไม่คิดบนยอดจ่ายที่รวม VAT แล้ว)
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
    if (Math.abs(amount - invoiceTotal) < 0.005) {
      return r2(invoiceTotal - invoiceTax) // ponytail: total-tax, subtotal may be before discount/service
    }
    const vatRatio = invoiceTax / invoiceTotal
    return r2(amount * (1 - vatRatio))
  }

  if (invoiceSubtotal > 0 && invoiceSubtotal < invoiceTotal) {
    if (Math.abs(amount - invoiceTotal) < 0.005) {
      return invoiceSubtotal
    }
    const vatRatio = (invoiceTotal - invoiceSubtotal) / invoiceTotal
    return r2(amount * (1 - vatRatio))
  }

  return amount
}

/** ภาษีหัก ณ ที่จ่าย = ยอด × อัตรา% ปัด 2 ตำแหน่ง */
export const calcWht = (amount: number, ratePct: number) => r2((amount || 0) * (ratePct || 0) / 100)

/** body ของ POST /purchase/requests — backend อ่าน camelCase เท่านั้น (เหมือน PUT) */
export function buildPurchaseRequestPayload(form: {
  department: string; required_date: string; priority: string; notes: string
  items: { material_id: string; description: string; quantity: number; unit: string; estimated_unit_price: number; notes: string }[]
}) {
  return {
    department: form.department,
    requiredDate: form.required_date || undefined,
    priority: form.priority,
    notes: form.notes,
    items: form.items.filter(i => i.material_id || i.description).map(i => ({
      materialId: i.material_id || undefined,
      description: i.description,
      quantity: i.quantity,
      unit: i.unit,
      estimatedUnitPrice: i.estimated_unit_price,
      estimatedTotalPrice: r2(i.quantity * i.estimated_unit_price),
      notes: i.notes,
    })),
  }
}
