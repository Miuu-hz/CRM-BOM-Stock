// ============================================================
// ขอบเขตของบัญชี "แคชเชียร์" — ใช้ได้เฉพาะงานหน้าร้าน (POS + จอครัว)
// ------------------------------------------------------------
// แคชเชียร์ = ผู้ใช้ที่มีแผนก POS แผนกเดียว (Admin/Master ไม่เข้าข่าย)
// เดิมไม่มี route ไหนตรวจสิทธิ์ตามแผนกเลย แคชเชียร์เข้าไปสร้าง PO/แก้ราคาทุน/ลงสมุดรายวันได้
// จึงตรวจที่ authenticate ตัวเดียว (ทุก API ผ่านตรงนี้) ด้วยรายการ "อนุญาต" แทนรายการ "ห้าม"
// — API ใหม่ที่ยังไม่ได้ใส่รายการ = แคชเชียร์ใช้ไม่ได้ไว้ก่อน ปลอดภัยกว่าลืมห้าม
//
// ponytail: รายการเขียนมือจากสิ่งที่หน้าแคชเชียร์/จอครัว/แถบหัวเรียกจริง (2026-09-29)
// ถ้าหน้าแคชเชียร์เพิ่ม API ใหม่แล้วแคชเชียร์โดน 403 ให้มาเพิ่มที่ READ/WRITE ด้านล่าง
// ============================================================

export function isCashierOnly(role: string | undefined, departments: string[] | undefined): boolean {
  if (!role || role === 'MASTER' || role === 'ADMIN') return false
  return !!departments && departments.length > 0 && departments.every(d => d === 'POS')
}

/** path ไม่มี /api นำหน้าและไม่มี query */
const READ: RegExp[] = [
  /^\/pos(\/|$)/,                        // บิล เมนู จอครัว สินค้าขายได้
  /^\/sales\/pos-shifts(\/|$)/,          // กะ + เงินเข้า-ออกลิ้นชัก
  /^\/sales\/pos-running-bills\//,       // ยกเลิกบิล (ผ่านระบบอนุมัติ)
  /^\/customers\/search/,                // ค้นหาสมาชิก
  /^\/settings\/(company|documents)$/,   // หัวบิล/แม่แบบพิมพ์
  /^\/bank-accounts$/,                   // บัญชีรับโอน/QR
  /^\/accounts$/,                        // รายชื่อบัญชีเงินสด/ธนาคาร ตอนรับเงิน
  /^\/attachments\//,                    // สลิป
  /^\/approval\//,                       // คำขออนุมัติของตัวเอง
  /^\/materials\/unit-conversions/,      // ชื่อหน่วย
  /^\/stock\/stats$/,
  /^\/auth\//,
]
const WRITE: RegExp[] = [
  /^\/pos(\/|$)/,
  /^\/sales\/pos-shifts\//,
  /^\/sales\/pos-running-bills\//,
  /^\/customers$/,                       // สมัครสมาชิกที่หน้าร้าน
  /^\/attachments\//,
  /^\/approval\//,
  /^\/auth\//,
  /^\/password\//,
]
/** ทับรายการอนุญาต — โอนเงินพักหน้าร้านเข้าธนาคารเป็นงานบัญชี */
const DENY: RegExp[] = [/^\/pos\/clearing(\/|$)/]

export function cashierAllowed(method: string, originalUrl: string): boolean {
  const path = originalUrl.split('?')[0].replace(/^\/api(?=\/)/, '')
  if (DENY.some(r => r.test(path))) return false
  const list = method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? READ : WRITE
  return list.some(r => r.test(path))
}
