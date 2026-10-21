import { randomBytes } from 'crypto'
import QRCode from 'qrcode'
import db from '../db/sqlite'

const APP_URL = process.env.APP_URL ?? 'https://erp.phopy.net'

export type QrMode = 'static' | 'rotate'

export interface QrSettings { mode: QrMode }

export function getQrSettings(tenantId: string): QrSettings {
  const r = db.prepare('SELECT pos_qr_mode FROM company_settings WHERE tenant_id = ?').get(tenantId) as any
  return { mode: r?.pos_qr_mode === 'rotate' ? 'rotate' : 'static' }
}

// 192 บิตสุ่ม เหมือน receipt token — เดาไม่ได้ ไม่ผูกกับ id
export const mintQrToken = (): string => randomBytes(24).toString('base64url')

export const qrUrl = (token: string): string => `${APP_URL}/qr/?t=${token}`
export const qrImage = (token: string): Promise<string> => QRCode.toDataURL(qrUrl(token), { margin: 1, width: 320 })

export interface ResolvedQr {
  state: 'open' | 'not_open' | 'closed' | 'rotate_only'
  tenantId: string
  table: { id: string; name: string } | null
  bill: any | null
  via?: 'table' | 'bill'
  sessionToken?: string
}

/**
 * token จาก QR → โต๊ะ/บิลที่ลูกค้ากำลังจะสั่ง
 *   QR ถาวรของโต๊ะ: ใช้ได้เมื่อโต๊ะมีบิลเปิดอยู่ · ร้านโหมด rotate ใช้ QR ถาวรไม่ได้ (ต้องใบที่พิมพ์ตอนเปิดโต๊ะ)
 *   QR ของรอบ (บิล): ใช้ได้เฉพาะตอนบิล OPEN — ปิดบิลแล้วลิงก์ตายทันที
 * null = token ไม่มีอยู่จริง
 */
export function resolveQrToken(token: string): ResolvedQr | null {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null
  const table = db.prepare('SELECT id, tenant_id, name FROM pos_tables WHERE qr_token = ? AND is_active = 1').get(token) as any
  if (table) {
    const t = { id: table.id, name: table.name }
    if (getQrSettings(table.tenant_id).mode === 'rotate') return { state: 'rotate_only', tenantId: table.tenant_id, table: t, bill: null, via: 'table' }
    const bill = db.prepare(`SELECT * FROM pos_running_bills WHERE tenant_id = ? AND table_id = ? AND status = 'OPEN'`).get(table.tenant_id, table.id) as any
    if (!bill) return { state: 'not_open', tenantId: table.tenant_id, table: t, bill: null, via: 'table' }
    // ponytail: บิลเปิดในโหมด static ต้องมี session token เสมอ — บิลรุ่นเก่าที่ยังไม่มีให้ออกใหม่ทันที
    let sessionToken = bill.qr_token
    if (!sessionToken) {
      sessionToken = mintQrToken()
      db.prepare('UPDATE pos_running_bills SET qr_token = ? WHERE id = ? AND tenant_id = ?').run(sessionToken, bill.id, table.tenant_id)
      bill.qr_token = sessionToken
    }
    return { state: 'open', tenantId: table.tenant_id, table: t, bill, via: 'table', sessionToken }
  }
  const bill = db.prepare('SELECT * FROM pos_running_bills WHERE qr_token = ?').get(token) as any
  if (!bill) return null

  // ponytail: ตามบิลที่ถูกรวมโต๊ะ (merged_into_bill_id) ไปหาบิลปลายทาง — ต้องอยู่ใน tenant เดียวกัน
  let activeBill = bill
  const visited = new Set<string>([bill.id])
  while (activeBill.status !== 'OPEN' && activeBill.merged_into_bill_id) {
    if (visited.has(activeBill.merged_into_bill_id)) break
    visited.add(activeBill.merged_into_bill_id)
    const nextBill = db.prepare('SELECT * FROM pos_running_bills WHERE id = ? AND tenant_id = ?').get(activeBill.merged_into_bill_id, bill.tenant_id) as any
    if (!nextBill) break
    activeBill = nextBill
  }

  const isTargetOpen = activeBill.status === 'OPEN'
  const target = isTargetOpen ? activeBill : bill
  const tbl = target.table_id ? db.prepare('SELECT id, name FROM pos_tables WHERE id = ? AND tenant_id = ?').get(target.table_id, target.tenant_id) as any : null

  if (isTargetOpen) {
    let sessionToken = target.qr_token
    if (!sessionToken) {
      sessionToken = mintQrToken()
      db.prepare('UPDATE pos_running_bills SET qr_token = ? WHERE id = ? AND tenant_id = ?').run(sessionToken, target.id, target.tenant_id)
      target.qr_token = sessionToken
    }
    return {
      state: 'open',
      tenantId: target.tenant_id,
      table: tbl ? { id: tbl.id, name: tbl.name } : { id: '', name: target.display_name },
      bill: target,
      via: 'bill',
      sessionToken,
    }
  }

  return {
    state: 'closed',
    tenantId: target.tenant_id,
    table: tbl ? { id: tbl.id, name: tbl.name } : { id: '', name: target.display_name },
    bill: target,
    via: 'bill',
  }
}
