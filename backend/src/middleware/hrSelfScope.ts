/**
 * Token จากลิงก์ LINE (scope 'hr_self') ใช้ได้เฉพาะหน้า "ของฉัน" ของ HR
 * allowlist — เส้นทางใหม่ต้องเพิ่มที่นี่ถึงจะใช้ได้ (ลืมเพิ่ม = ใช้ไม่ได้ ไม่ใช่รั่ว)
 */
const ALLOW: [RegExp, RegExp][] = [
  [/^(GET|POST)$/, /^\/api\/hr\/me(\/[A-Za-z0-9_\-/]*)?$/],
  [/^DELETE$/, /^\/api\/hr\/me\/face$/],
  [/^GET$/, /^\/api\/hr\/checkin\/location$/],
  [/^POST$/, /^\/api\/hr\/checkin$/],
  [/^POST$/, /^\/api\/hr\/checkin\/face$/],
  [/^GET$/, /^\/api\/hr\/(leave-types|leave-balances)$/],
  [/^(GET|POST)$/, /^\/api\/hr\/leave-requests$/],
  [/^POST$/, /^\/api\/hr\/(leave-requests|advances|shift-swaps)\/[A-Za-z0-9_-]+\/cancel$/],
  [/^GET$/, /^\/api\/subscription\/me$/],
  [/^GET$/, /^\/api\/hr\/disciplinary\/[A-Za-z0-9_\-]+\/pdf$/],
]

export function hrSelfAllowed(method: string, originalUrl: string): boolean {
  const path = originalUrl.split('?')[0]
  return ALLOW.some(([m, p]) => m.test(method) && p.test(path))
}
