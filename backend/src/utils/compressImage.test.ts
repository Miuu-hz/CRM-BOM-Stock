import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { compressImage, MAX_ATTACHMENT_BYTES } from './compressImage'

// รูป A4 ที่ 300dpi (2480×3508) ใส่ noise ให้บีบยาก ใกล้รูปถ่ายบิลจริง
async function a4Photo(): Promise<Buffer> {
  const w = 2480, h = 3508
  const px = Buffer.alloc(w * h * 3)
  for (let i = 0; i < px.length; i++) px[i] = 128 + ((i * 2654435761) >>> 24) % 100
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).toBuffer()
}

describe('compressImage', () => {
  it('บีบรูป A4 ใหญ่ให้ไม่เกินเพดาน และด้านยาวไม่เกิน 1754px', async () => {
    const big = await a4Photo()
    expect(big.length).toBeGreaterThan(MAX_ATTACHMENT_BYTES)
    const out = await compressImage(big)
    expect(out).not.toBeNull()
    expect(out!.buffer.length).toBeLessThanOrEqual(MAX_ATTACHMENT_BYTES)
    const meta = await sharp(out!.buffer).metadata()
    expect(meta.format).toBe('jpeg')
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1754)
  }, 30000)

  it('ผลลัพธ์เหมือนเดิมทุกครั้ง (ตรวจรูปซ้ำต้องพึ่งข้อนี้)', async () => {
    const big = await a4Photo()
    const [a, b] = await Promise.all([compressImage(big), compressImage(big)])
    expect(a!.buffer.equals(b!.buffer)).toBe(true)
  }, 30000)

  it('ไม่แตะไฟล์ที่เล็กอยู่แล้วหรือไม่ใช่รูป', async () => {
    expect(await compressImage(Buffer.from('%PDF-1.4 ' + 'x'.repeat(MAX_ATTACHMENT_BYTES)))).toBeNull()
    const small = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#fff' } }).png().toBuffer()
    expect(await compressImage(small)).toBeNull()
  })
})

describe('compressImage — รูปสินค้า', () => {
  it('ย่อรูปสินค้าเหลือด้านยาว 800px ไม่เกิน 150KB', async () => {
    const { PRODUCT_IMAGE } = await import('./compressImage')
    const out = await compressImage(await a4Photo(), PRODUCT_IMAGE)
    expect(out!.buffer.length).toBeLessThanOrEqual(PRODUCT_IMAGE.maxBytes)
    const meta = await sharp(out!.buffer).metadata()
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(800)
  }, 30000)
})

describe('compressDataUrl — โลโก้', () => {
  it('บีบโลโก้เป็น PNG ≤100KB และยังโปร่งใส', async () => {
    const { compressDataUrl, LOGO_IMAGE } = await import('./compressImage')
    const w = 2000, h = 2000
    const px = Buffer.alloc(w * h * 4)
    for (let i = 0; i < w * h; i++) { px[i * 4] = (i * 7) % 256; px[i * 4 + 1] = (i >> 3) % 256; px[i * 4 + 2] = 90; px[i * 4 + 3] = i % w < w / 2 ? 0 : 255 }
    const png = await sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
    const out = await compressDataUrl(`data:image/png;base64,${png.toString('base64')}`, LOGO_IMAGE)
    expect(out.startsWith('data:image/png;base64,')).toBe(true)
    const buf = Buffer.from(out.split(',')[1], 'base64')
    expect(buf.length).toBeLessThanOrEqual(LOGO_IMAGE.maxBytes)
    const meta = await sharp(buf).metadata()
    expect(meta.hasAlpha).toBe(true)
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(600)
  }, 30000)

  it('ไม่ใช่ data URL รูป → คืนค่าเดิม', async () => {
    const { compressDataUrl, LOGO_IMAGE } = await import('./compressImage')
    expect(await compressDataUrl('https://x/logo.png', LOGO_IMAGE)).toBe('https://x/logo.png')
  })
})
