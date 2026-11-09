import sharp from 'sharp'

// รูปหลักฐาน (บิล/สลิป/ใบส่งของ) เก็บไม่เกิน ~350KB แต่ยังอ่านตัวหนังสือบน A4 ออก
// A4 ที่ 150dpi = 1240×1754 → ด้านยาวไม่เกิน 1754px แล้วไล่ลดคุณภาพ/ขนาดจนต่ำกว่าเพดาน
export const MAX_ATTACHMENT_BYTES = 350 * 1024
// [สัดส่วนของด้านยาวสูงสุด, คุณภาพ JPEG] ไล่ทีละขั้นจนต่ำกว่าเพดาน
const STEPS: [number, number][] = [[1, 82], [1, 72], [1, 62], [0.85, 60], [0.7, 55], [0.57, 50]]

// รูปสินค้าโชว์แค่การ์ดเมนู POS / หน้าสั่ง QR บนมือถือ — 800px พอ
export const PRODUCT_IMAGE = { maxEdge: 800, maxBytes: 150 * 1024 }

// คืน null = เก็บไฟล์เดิม (PDF, ไฟล์ที่เล็กอยู่แล้ว, ไฟล์ที่ sharp อ่านไม่ได้)
export async function compressImage(
  input: Buffer,
  { maxEdge = 1754, maxBytes = MAX_ATTACHMENT_BYTES } = {}
): Promise<{ buffer: Buffer; ext: '.jpg' } | null> {
  if (input.length <= maxBytes) return null
  let meta: sharp.Metadata
  try { meta = await sharp(input).metadata() } catch { return null }
  if (!meta.format || meta.format === 'gif' || meta.format === 'svg') return null

  let out: Buffer | null = null
  for (const [scale, quality] of STEPS) {
    const edge = Math.round(maxEdge * scale)
    out = await sharp(input)
      .rotate() // หมุนตาม EXIF — รูปจากมือถือจะได้ไม่ตะแคง
      .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }) // PNG โปร่งใส → พื้นขาว
      .jpeg({ quality, mozjpeg: true })
      .toBuffer()
    if (out.length <= maxBytes) break
  }
  return out && out.length < input.length ? { buffer: out, ext: '.jpg' } : null
}
