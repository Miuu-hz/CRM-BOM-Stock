import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import db from '../db/sqlite'
import { compressImage } from '../utils/compressImage'
import { findDuplicateAttachment } from '../mcp/tools/shared'
import { invoiceUploadDir } from '../routes/sales/shared'
import { generateId } from '../utils/id'

export const MAX_PENDING_PER_TENANT = 200

export type IntakeResult =
  | { ok: true; id: string; pending: number }
  | { ok: false; reason: 'DUPLICATE_MESSAGE' | 'DUPLICATE_IMAGE' | 'INBOX_FULL' | 'NOT_IMAGE'; docNum?: string; label?: string }

export async function intakeBillImage(p: {
  tenantId: string
  lineUserId: string
  userId: string | null
  lineMessageId: string
  raw: Buffer
}): Promise<IntakeResult> {
  // 1. line_message_id มีอยู่แล้ว → DUPLICATE_MESSAGE (ไม่เขียนอะไร)
  const existingMsg = db.prepare('SELECT id FROM bill_inbox WHERE line_message_id = ?').get(p.lineMessageId)
  if (existingMsg) {
    return { ok: false, reason: 'DUPLICATE_MESSAGE' }
  }

  // 2. sharp(raw).metadata() อ่านไม่ได้ → NOT_IMAGE
  let meta: sharp.Metadata
  try {
    meta = await sharp(p.raw).metadata()
  } catch {
    return { ok: false, reason: 'NOT_IMAGE' }
  }
  if (!meta || !meta.format) {
    return { ok: false, reason: 'NOT_IMAGE' }
  }

  // 3. PENDING ของร้าน ≥ MAX_PENDING_PER_TENANT → INBOX_FULL
  const pendingRow = db.prepare(
    "SELECT COUNT(*) AS c FROM bill_inbox WHERE tenant_id = ? AND status = 'PENDING'"
  ).get(p.tenantId) as { c: number } | undefined
  const pendingCount = pendingRow?.c ?? 0
  if (pendingCount >= MAX_PENDING_PER_TENANT) {
    return { ok: false, reason: 'INBOX_FULL' }
  }

  // 4. บีบด้วย compressImage(raw) (ค่า default เดียวกับไฟล์แนบ) ได้ null = ใช้ไฟล์เดิม
  const compressed = await compressImage(p.raw)
  const finalBuffer = compressed?.buffer ?? p.raw
  let ext: string | undefined = compressed?.ext
  let mimeType = compressed?.mime
  if (!ext || !mimeType) {
    if (meta.format === 'png') {
      ext = '.png'
      mimeType = 'image/png'
    } else if (meta.format === 'webp') {
      ext = '.webp'
      mimeType = 'image/webp'
    } else {
      ext = '.jpg'
      mimeType = 'image/jpeg'
    }
  }

  // 5. ซ้ำกับไฟล์แนบเดิม: เรียก findDuplicateAttachment(tenantId, raw.toString('base64')) จาก mcp/tools/shared.ts เจอ → DUPLICATE_IMAGE พร้อม docNum, label
  const dupAttachment = await findDuplicateAttachment(p.tenantId, p.raw.toString('base64'))
  if (dupAttachment) {
    return {
      ok: false,
      reason: 'DUPLICATE_IMAGE',
      docNum: dupAttachment.docNum,
      label: dupAttachment.label,
    }
  }

  // 6. ซ้ำกับรูปที่ยัง PENDING ในร้านเดียวกัน (file_size เท่ากัน แล้วเทียบ Buffer.equals บนดิสก์) → DUPLICATE_IMAGE (ไม่มี docNum)
  // ponytail: สแกนแถวที่ file_size เท่ากันก่อนแล้วค่อยเทียบ Buffer.equals บนดิสก์ — เพดาน 200 ใบต่อร้าน ไม่ต้องทำ hash index
  const pendingImages = db.prepare(
    "SELECT file_path FROM bill_inbox WHERE tenant_id = ? AND status = 'PENDING' AND file_size = ?"
  ).all(p.tenantId, finalBuffer.length) as { file_path: string }[]

  for (const row of pendingImages) {
    const diskPath = path.join(invoiceUploadDir, path.basename(row.file_path))
    if (fs.existsSync(diskPath)) {
      try {
        const diskBuf = fs.readFileSync(diskPath)
        if (diskBuf.equals(finalBuffer)) {
          return { ok: false, reason: 'DUPLICATE_IMAGE' }
        }
      } catch {
        continue
      }
    }
  }

  // 7. เขียนไฟล์ inbox-<id>.jpg|.png|... ลง invoiceUploadDir แล้ว INSERT · คืน pending = จำนวน PENDING ของร้านหลังเพิ่ม
  if (!fs.existsSync(invoiceUploadDir)) {
    fs.mkdirSync(invoiceUploadDir, { recursive: true })
  }

  const id = generateId()
  const fileName = `inbox-${id}${ext}`
  const diskPath = path.join(invoiceUploadDir, fileName)

  fs.writeFileSync(diskPath, finalBuffer)

  try {
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO bill_inbox (
        id, tenant_id, line_message_id, line_user_id, user_id,
        file_path, mime_type, file_size, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
    `).run(
      id,
      p.tenantId,
      p.lineMessageId,
      p.lineUserId,
      p.userId,
      fileName,
      mimeType,
      finalBuffer.length,
      now
    )
  } catch (err) {
    try { fs.unlinkSync(diskPath) } catch {}
    throw err
  }

  const updatedPending = (db.prepare(
    "SELECT COUNT(*) AS c FROM bill_inbox WHERE tenant_id = ? AND status = 'PENDING'"
  ).get(p.tenantId) as { c: number } | undefined)?.c ?? 1

  return { ok: true, id, pending: updatedPending }
}
