const r2 = (n: number) => Math.round(n * 100) / 100

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
