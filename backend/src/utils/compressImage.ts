import sharp from 'sharp'

// รูปหลักฐาน (บิล/สลิป/ใบส่งของ) เก็บไม่เกิน ~350KB แต่ยังอ่านตัวหนังสือบน A4 ออก
// A4 ที่ 150dpi = 1240×1754 → ด้านยาวไม่เกิน 1754px แล้วไล่ลดคุณภาพ/ขนาดจนต่ำกว่าเพดาน
export const MAX_ATTACHMENT_BYTES = 350 * 1024
// [สัดส่วนของด้านยาวสูงสุด, คุณภาพ] ไล่ทีละขั้นจนต่ำกว่าเพดาน
const STEPS: [number, number][] = [[1, 82], [1, 72], [1, 62], [0.85, 60], [0.7, 55], [0.57, 50]]

// รูปสินค้าโชว์แค่การ์ดเมนู POS / หน้าสั่ง QR บนมือถือ — 800px พอ
export const PRODUCT_IMAGE = { maxEdge: 800, maxBytes: 150 * 1024 }
// Pop-up โฆษณาหน้า QR แนะนำ 1080×1350 (4:5) — ลูกค้าโหลดผ่านมือถือ
export const QR_AD_IMAGE = { maxEdge: 1350, maxBytes: 250 * 1024 }
// โลโก้ติดหัวบิล/ใบเสนอราคา — PNG เพื่อเก็บพื้นโปร่งใส
export const LOGO_IMAGE = { maxEdge: 600, maxBytes: 100 * 1024, format: 'png' as const }

type Options = { maxEdge?: number; maxBytes?: number; format?: 'jpeg' | 'png' }

// คืน null = เก็บไฟล์เดิม (PDF, ไฟล์ที่เล็กอยู่แล้ว, ไฟล์ที่ sharp อ่านไม่ได้)
export async function compressImage(
  input: Buffer,
  { maxEdge = 1754, maxBytes = MAX_ATTACHMENT_BYTES, format = 'jpeg' }: Options = {}
): Promise<{ buffer: Buffer; ext: '.jpg' | '.png'; mime: string } | null> {
  if (input.length <= maxBytes) return null
  let meta: sharp.Metadata
  try { meta = await sharp(input).metadata() } catch { return null }
  if (!meta.format || meta.format === 'gif' || meta.format === 'svg') return null

  let out: Buffer | null = null
  for (const [scale, quality] of STEPS) {
    const edge = Math.round(maxEdge * scale)
    const img = sharp(input)
      .rotate() // หมุนตาม EXIF — รูปจากมือถือจะได้ไม่ตะแคง
      .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    out = format === 'png'
      ? await img.png({ palette: true, quality, compressionLevel: 9 }).toBuffer()
      : await img.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer() // PNG โปร่งใส → พื้นขาว
    if (out.length <= maxBytes) break
  }
  if (!out || out.length >= input.length) return null
  return format === 'png' ? { buffer: out, ext: '.png', mime: 'image/png' } : { buffer: out, ext: '.jpg', mime: 'image/jpeg' }
}

// สำหรับรูปที่เก็บเป็น data URL ใน DB (โลโก้) — ไม่ใช่รูป/บีบไม่ได้ คืนค่าเดิม
export async function compressDataUrl(dataUrl: string, opts: Options): Promise<string> {
  const m = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/)
  if (!m) return dataUrl
  const small = await compressImage(Buffer.from(m[1], 'base64'), opts)
  return small ? `data:${small.mime};base64,${small.buffer.toString('base64')}` : dataUrl
}
