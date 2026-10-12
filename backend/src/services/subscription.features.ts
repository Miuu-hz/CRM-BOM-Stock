// แพ็ก v2 = Base plan + Pack ตามประเภทธุรกิจ + Add-on (ดู Phopy_Price.xlsx ชีต Add-ons)
// Business เลือกได้ 1 Pack, Business+ 2 Pack (ซื้อเพิ่มได้) — Pro/Enterprise AI ใส่ฟีเจอร์ทุก Pack ไว้ใน plan แล้ว
// แยกไฟล์ไม่ให้แตะ DB: billing.catalog → scripts/stripeSetup import ไปใช้โดยไม่ต้องเปิด dev.db
// ponytail: mapping อยู่ในโค้ดเพราะผูกกับ gate ใน index.ts — ถ้าต้องให้ MASTER แก้เองค่อยย้ายเป็นตาราง
export const PACK_FEATURES: Record<string, string[]> = {
  shop: ['kds'],                          // + กะไม่จำกัด (ดู maxPosShifts ใน subscription.service)
  online: ['platform_settlement'],
  maker: ['bom', 'work_orders'],
  accounting: ['accounting', 'tax'],
}

// add-on ที่เป็นโมดูล (จำนวน > 0 = เปิด) — extra_users เป็นจำนวนที่นั่ง บวกเข้า maxUsers
export const ADDON_FEATURES = ['smart_unit', 'multi_currency', 'subcontract', 'api_access', 'backup'] as const
export const EXTRA_USERS = 'extra_users'
