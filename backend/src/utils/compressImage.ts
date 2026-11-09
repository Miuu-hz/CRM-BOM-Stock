import sharp from 'sharp'

// รูปหลักฐาน (บิล/สลิป/ใบส่งของ) เก็บไม่เกิน ~350KB แต่ยังอ่านตัวหนังสือบน A4 ออก
// A4 ที่ 150dpi = 1240×1754 → ด้านยาวไม่เกิน 1754px แล้วไล่ลดคุณภาพ/ขนาดจนต่ำกว่าเพดาน
export const MAX_ATTACHMENT_BYTES = 350 * 1024
const STEPS: [number, number][] = [[1754, 82], [1754, 72], [1754, 62], [1500, 60], [1240, 55], [1000, 50]]

// คืน null = เก็บไฟล์เดิม (PDF, ไฟล์ที่เล็กอยู่แล้ว, ไฟล์ที่ sharp อ่านไม่ได้)
export async function compressImage(input: Buffer): Promise<{ buffer: Buffer; ext: '.jpg' } | null> {
  if (input.length <= MAX_ATTACHMENT_BYTES) return null
  let meta: sharp.Metadata
  try { meta = await sharp(input).metadata() } catch { return null }
  if (!meta.format || meta.format === 'gif' || meta.format === 'svg') return null

  let out: Buffer | null = null
  for (const [edge, quality] of STEPS) {
    out = await sharp(input)
      .rotate() // หมุนตาม EXIF — รูปจากมือถือจะได้ไม่ตะแคง
      .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }) // PNG โปร่งใส → พื้นขาว
      .jpeg({ quality, mozjpeg: true })
      .toBuffer()
    if (out.length <= MAX_ATTACHMENT_BYTES) break
  }
  return out && out.length < input.length ? { buffer: out, ext: '.jpg' } : null
}
