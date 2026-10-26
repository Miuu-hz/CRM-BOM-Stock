// ด่านตรวจปิดงวด 11 ข้อ (A3) — service เดียวที่ทั้งการปิดงวด, Dashboard (สัญญาณการควบคุม + ป้ายความน่าเชื่อถือ),
// Phopy Board บท 6 และ MCP get_close_checklist ใช้ร่วมกัน
// TODO(A3 worker): แทนที่ตัวสตับนี้ด้วยของจริงตามสเปกในบรีฟ — ห้ามเปลี่ยน interface ด้านล่าง

export type CheckStatus = 'pass' | 'warn' | 'block' | 'na'

export interface CheckItem {
  /** 1–11 ตามตารางหัวข้อ 6 ของสเปกปิดบัญชีรายเดือน */
  id: number
  key: string
  title: string
  /** ระดับเมื่อไม่ผ่าน */
  severity: 'block' | 'warn'
  status: CheckStatus
  /** คำอธิบายภาษาไทยว่าเจออะไร/ต้องทำอะไร */
  detail: string
  count?: number
  amount?: number
  /** ลิงก์หน้าเว็บที่แก้ได้ */
  link?: string
  /** ตรวจได้รายวัน (ข้อ 1, 4, 5, 6) — Dashboard ใช้ทำสัญญาณการควบคุมระหว่างเดือน */
  daily: boolean
  /** ข้อมูลประกอบ (รายการบัญชี ฯลฯ) */
  rows?: Array<Record<string, unknown>>
}

export interface ChecklistResult {
  period: string
  start: string
  end: string
  periodStatus: 'OPEN' | 'CLOSED' | 'FILING' | 'NONE'
  items: CheckItem[]
  /** pass + na */
  passed: number
  total: number
  blocks: number
  warns: number
  /** "ผ่าน N/11" */
  label: string
  canClose: boolean
}

export function closeChecklist(_tenantId: string, period: string): ChecklistResult {
  return { period, start: `${period}-01`, end: `${period}-28`, periodStatus: 'NONE', items: [], passed: 0, total: 11, blocks: 0, warns: 0, label: 'ผ่าน 0/11', canClose: true }
}
