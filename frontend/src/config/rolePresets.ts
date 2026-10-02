// ตำแหน่งสำเร็จรูป (preset) ตอนตั้งสิทธิ์ผู้ใช้ — ใช้ร่วมกันทั้ง Settings > สิทธิ์ และหน้าจัดการผู้ใช้
// เดิมเขียนแยก 2 ที่แล้วไม่ตรงกัน: "แคชเชียร์" ล้างแผนกเป็น [] ทั้งคู่ (อีกที่แถม cashier:read/write
// ซึ่ง backend ไม่มี resource ชื่อนี้ = ไม่มีผลอะไร) → กดแล้วสิทธิ์หลุดหมด ออกใบกำกับจากบิล POS ไม่ได้
//
// แคชเชียร์ = แผนก POS (2026-09-29) — มีแผนกนี้แผนกเดียว = ใช้ได้แค่หน้าร้าน + จอครัว
// ตัวกันจริงอยู่ backend/src/middleware/cashierScope.ts · เมนูซ่อนตาม config/menuPermissions.ts
export const ROLE_PRESETS: { key: string; departments: string[] }[] = [
  { key: 'sales', departments: ['SALES'] },
  { key: 'cashier', departments: ['POS'] },
  { key: 'accountant', departments: ['ACCOUNTING', 'PURCHASE'] },
  { key: 'warehouseManager', departments: ['STOCK', 'PURCHASE'] },
  { key: 'factoryManager', departments: ['PRODUCTION', 'QC', 'STOCK'] },
  { key: 'ceo', departments: ['CEO'] },
]
