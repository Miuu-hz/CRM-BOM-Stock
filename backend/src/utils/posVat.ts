// สาย POS ใช้ชื่อเดิม แต่ตรรกะย้ายไปอยู่ utils/vat.ts ที่เดียวกับเอกสารอื่นทั้งระบบแล้ว
// เก็บไฟล์นี้ไว้เป็น wrapper เพื่อไม่ต้องไล่แก้ call-site ของ POS ที่ทดสอบผ่านแล้ว
import { calcVat, type VatTotals } from './vat'

export interface PosBillingConfig {
  vatEnabled: boolean
  vatRate: number
  /** true = ราคาที่ติดป้ายรวม VAT แล้ว (ร้านอาหาร/ค้าปลีกไทยส่วนใหญ่) */
  vatInclusive?: boolean
  serviceEnabled: boolean
  serviceRate: number
}

export interface PosAdjustments {
  /** ส่วนลดท้ายบิล (บาท) — ลดฐานภาษี */
  discount?: number
  /** ค่าขนส่ง/ค่าบริการอื่นที่เรียกเก็บจากลูกค้า (บาท) — เพิ่มฐานภาษี */
  extraCharge?: number
}

export function calcPosTotals(lineTotal: number, cfg: PosBillingConfig, adj: PosAdjustments = {}): VatTotals {
  return calcVat(lineTotal, {
    rate: cfg.vatEnabled ? (cfg.vatRate || 0) : 0,
    roundTax: 'baht',  // เครื่องคิดเงินหน้าร้านไม่ทอนสตางค์
    inclusive: cfg.vatInclusive,
    serviceRate: cfg.serviceEnabled ? (cfg.serviceRate || 0) : 0,
    discountAmount: adj.discount,
    extraCharge: adj.extraCharge,
  })
}

/**
 * ยอดของบิล — คิดจากรายการจริงเสมอเมื่อมีรายการมาด้วย (หน้าจอแคชเชียร์กำลังแก้บิลอยู่)
 * ถ้าไม่มีรายการติดมา (การ์ดในรายการบิล) ใช้ยอดที่ backend คำนวณเก็บไว้
 */
export function billTotals(bill: any, cfg: PosBillingConfig, adj: PosAdjustments = {}): VatTotals {
  if (bill?.items?.length) {
    const lineTotal = bill.items.reduce((n: number, i: any) => n + (i.total_price || 0), 0)
    return calcPosTotals(lineTotal, cfg, adj)
  }
  if (bill && typeof bill.total_amount === 'number' && bill.total_amount > 0) {
    return {
      subtotal: bill.subtotal || 0,
      serviceChargeAmount: bill.service_charge_amount || 0,
      extraCharge: bill.extra_charge_amount || 0,
      discount: bill.discount_amount || 0,
      taxAmount: bill.tax_amount || 0,
      totalAmount: bill.total_amount,
    }
  }
  return calcPosTotals(bill?.subtotal || 0, cfg, adj)
}
