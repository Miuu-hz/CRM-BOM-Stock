import db from '../db/sqlite'
import { generateId } from '../utils/id'

// บันทึกทุกอย่างที่วิ่งผ่าน LINE OA: IN = event จาก webhook, OUT = ข้อความที่ระบบส่งออก (reply/push)
// ห้าม throw — log พังต้องไม่ทำให้บอทพัง
export type LineLog = {
  tenantId?: string
  direction: 'IN' | 'OUT'
  kind: string                 // IN: message:text / message:image / postback / follow ... · OUT: reply / push
  sourceType?: string          // user | group | room
  target?: string              // line user id หรือ group id
  summary?: string
  ok?: boolean
  error?: unknown
  ms?: number
}

const cut = (s: unknown, n: number) => (s == null ? null : String(s).slice(0, n))

export function logLine(l: LineLog): void {
  try {
    db.prepare(`
      INSERT INTO line_event_logs (id, tenant_id, direction, kind, source_type, target, summary, status, error, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      generateId(), l.tenantId || '', l.direction, l.kind, l.sourceType ?? null, l.target ?? null,
      cut(l.summary, 500), l.ok === false ? 'ERROR' : 'OK',
      l.error == null ? null : cut((l.error as any)?.body ?? (l.error as any)?.message ?? l.error, 1000),
      l.ms ?? null, new Date().toISOString(),
    )
    // ponytail: ล้างของเก่ากว่า 90 วันแบบสุ่ม 1% ของการเขียน — ถ้า log โตเร็วกว่านี้ค่อยย้ายไป cron
    if (Math.random() < 0.01) db.prepare(`DELETE FROM line_event_logs WHERE created_at < ?`).run(new Date(Date.now() - 90 * 864e5).toISOString())
  } catch (e) {
    console.error('line log failed:', e)
  }
}

/** สรุป event ขาเข้า · คืน null = ไม่บันทึก (ข้อความคุยกันในกลุ่มไม่ใช่เรื่องของระบบ — ถ้าบอทตอบ จะเห็นจากแถว OUT อยู่แล้ว) */
export function describeEvent(event: any): { kind: string; summary: string } | null {
  const inGroup = (event.source?.type ?? 'user') !== 'user'
  if (event.type === 'message') {
    const m = event.message ?? {}
    if (m.type === 'text') return inGroup ? null : { kind: 'message:text', summary: m.text ?? '' }
    return { kind: `message:${m.type}`, summary: m.imageSet ? `รูป ${m.imageSet.index}/${m.imageSet.total}` : (m.fileName ?? '') }
  }
  if (event.type === 'postback') return { kind: 'postback', summary: event.postback?.data ?? '' }
  return { kind: String(event.type), summary: '' }
}

/** สรุปข้อความขาออก: ชนิด + ตัวหนังสือ/altText ของแต่ละก้อน */
export function describeMessages(messages: any): string {
  return (Array.isArray(messages) ? messages : [messages])
    .map(m => `[${m?.type}] ${m?.text ?? m?.altText ?? ''}`.trim()).join(' | ')
}
