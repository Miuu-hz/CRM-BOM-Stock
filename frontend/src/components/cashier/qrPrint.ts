import { waitForLayout } from '../../utils/printBill'
import api from '../../services/api'
import { getCachedCompanySettings } from '../../services/companySettings.service'

// พิมพ์ใบ QR โต๊ะ — ผู้เรียกต้อง window.open() เองตอนคลิก (เปิดหลัง await แล้วเบราว์เซอร์บล็อก pop-up)
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

function writeDoc(w: Window, title: string, css: string, body: string) {
  w.document.open()
  w.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>*{box-sizing:border-box}body{margin:0;font-family:'IBM Plex Sans Thai','Noto Sans Thai',sans-serif;color:#111}${css}</style></head>
<body>${body}</body></html>`)
  w.document.close()
}

/** thermal = ตั้งความยาวกระดาษเท่าเนื้อหา (เครื่องพิมพ์ใบเสร็จตัดกระดาษทุกหน้า — แบบเดียวกับ utils/printBill.ts) */
async function writeAndPrint(w: Window, title: string, css: string, body: string, thermal = false) {
  if (w.closed) return
  writeDoc(w, title, css, body)
  // รอรูป QR (data URL) ถอดรหัสเสร็จก่อน ไม่งั้นพิมพ์ออกมาเป็นกรอบว่าง
  await Promise.race([
    Promise.all(Array.from(w.document.images).map(img => img.decode().catch(() => undefined))),
    new Promise(resolve => setTimeout(resolve, 3000)),
  ])
  if (w.closed) return
  if (thermal) {
    await waitForLayout(w)
    if (w.closed) return
    const heightMm = Math.ceil((w.document.body.scrollHeight * 25.4) / 96) + 8
    const style = w.document.createElement('style')
    style.textContent = `@page { size: 80mm ${heightMm}mm; margin: 0 }`
    if (heightMm >= 40) w.document.head.appendChild(style) // สั้นผิดปกติ = ยังไม่ render อย่าตั้งหน้าเล็ก
  }
  w.focus()
  w.print()
}

const fail = (w: Window, msg: string) => {
  if (!w.closed) writeDoc(w, 'พิมพ์ไม่ได้', 'body{padding:24px;color:#B91C1C}', `<p>${esc(msg)}</p>`)
}

/** ใบเปิดโต๊ะ (กระดาษใบเสร็จ 80 มม.) — QR ที่ลูกค้าต้องสแกนตอนนี้ */
export async function printTableSlip(w: Window, tableId: string): Promise<void> {
  w.document.write('<p style="font-family:sans-serif;color:#888;padding:24px">กำลังเตรียมใบ QR…</p>')
  try {
    const { data } = await api.get(`/pos/tables/${tableId}/slip`)
    const s = data.data
    const shop = getCachedCompanySettings().name || ''
    await writeAndPrint(w, `QR โต๊ะ ${s.table}`,
      `body{width:72mm;margin:0 auto;padding:4mm 0;text-align:center}
       .shop{font-size:14px;font-weight:700}.tbl{font-size:34px;font-weight:800;margin:4px 0}
       img{width:56mm;height:56mm;image-rendering:pixelated}.hint{font-size:12px}
       .meta{font-size:10px;color:#555;margin-top:6px}`,
      `<div class="shop">${esc(shop)}</div><div class="tbl">โต๊ะ ${esc(s.table)}</div>
       <img src="${esc(s.qr)}" alt="QR สั่งอาหาร"><div class="hint">สแกนเพื่อดูเมนูและสั่งอาหาร</div>
       <div class="meta">${s.bill_number ? esc(s.bill_number) + ' · ' : ''}${s.opened_at ? esc(new Date(s.opened_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })) : ''}</div>`,
      true)
  } catch (e: any) {
    fail(w, e?.response?.data?.message || 'โหลดใบ QR ไม่สำเร็จ')
  }
}

/** สติกเกอร์ QR ถาวรทุกโต๊ะ (A4 3 คอลัมน์) — ติดโต๊ะ/ป้ายตั้งโต๊ะครั้งเดียว */
export async function printTableStickers(w: Window): Promise<void> {
  w.document.write('<p style="font-family:sans-serif;color:#888;padding:24px">กำลังเตรียมสติกเกอร์ QR…</p>')
  try {
    const { data } = await api.get('/pos/tables/qr')
    const shop = getCachedCompanySettings().name || ''
    const cards = (data.data as { name: string; qr: string }[]).map(t => `
      <div class="card"><div class="shop">${esc(shop)}</div><img src="${esc(t.qr)}" alt="QR โต๊ะ ${esc(t.name)}">
      <div class="tbl">${esc(t.name)}</div><div class="hint">สแกนเพื่อดูเมนูและสั่งอาหาร</div></div>`).join('')
    await writeAndPrint(w, 'สติกเกอร์ QR โต๊ะ',
      `@page{size:A4;margin:10mm}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6mm}
       .card{border:1px dashed #999;border-radius:4mm;padding:4mm;text-align:center;break-inside:avoid}
       .shop{font-size:12px;font-weight:700}img{width:48mm;height:48mm;image-rendering:pixelated}
       .tbl{font-size:26px;font-weight:800}.hint{font-size:11px;color:#444}`,
      `<div class="grid">${cards}</div>`)
  } catch (e: any) {
    fail(w, e?.response?.data?.message || 'โหลด QR ไม่สำเร็จ')
  }
}
