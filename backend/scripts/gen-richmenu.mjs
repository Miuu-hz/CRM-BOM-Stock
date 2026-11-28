// สร้างรูปริชเมนู exec/manager/staff (2500×1686, 4×2) และ staff_car (2500×843, 4×1) — guest.png ไม่แตะ
// รัน: mkdir /tmp/rm && cd /tmp/rm && npm i fontkit sharp lucide-static   (ไม่อยู่ใน package.json ของ repo)
//      cd /tmp/rm && node <repo>/backend/scripts/gen-richmenu.mjs <repo>/backend
// ลำดับ/ชื่อปุ่มต้องตรงกับ MENUS ใน src/services/line-richmenu.service.ts
import { createRequire } from 'module'
import fs from 'fs'
import path from 'path'
const require = createRequire(path.join(process.cwd(), 'x.js'))
const fontkit = require('fontkit'), sharp = require('sharp')
const backend = path.resolve(process.argv[2] ?? '.')
const bold = fontkit.openSync(path.join(backend, 'assets/fonts/Sarabun-Bold.ttf'))
const reg = fontkit.openSync(path.join(backend, 'assets/fonts/Sarabun-Regular.ttf'))
const iconSvg = n => fs.readFileSync(path.join(path.dirname(require.resolve('lucide-static/package.json')), 'icons', n + '.svg'), 'utf8')

const T = { blue: ['#EEF0FD', '#3B4CE6'], amber: ['#FEF3E0', '#D98A1E'], green: ['#DCFAE6', '#16A34A'], red: ['#FEE2E2', '#DC2626'], gray: ['#EBE4D6', '#6B6355'] }
// [ชื่อ, คำอธิบาย, ไอคอน lucide, สี]
const MENUS = {
    exec: [['ยอดขายวันนี้', 'บิล POS · ช่องทางจ่าย', 'trending-up'], ['กำไรเดือนนี้', 'รายได้ – ต้นทุน', 'chart-pie', 'green'], ['รออนุมัติ', 'คำขอที่ค้างอยู่', 'clipboard-check', 'amber'], ['สต็อกต่ำ', 'ต่ำกว่าจุดสั่งซื้อ', 'triangle-alert', 'red'],
        ['Phopy Board', 'เปิดภาพรวมในเว็บ', 'layout-dashboard', 'blue'], ['ออเดอร์', 'ใบสั่งขายล่าสุด', 'shopping-bag', 'green'], ['ของฉัน', 'เช็คอิน · ลา · สลิป', 'user-round', 'green'], ['บัญชีของฉัน', 'บริษัท · ตำแหน่ง', 'circle-user-round', 'gray']],
    manager: [['รออนุมัติ', 'คำขอที่ค้างอยู่', 'clipboard-check'], ['สต็อกต่ำ', 'ต่ำกว่าจุดสั่งซื้อ', 'triangle-alert', 'red'], ['เช็คสต็อก', 'พิมพ์ชื่อสินค้า', 'search', 'blue'], ['งานผลิต', 'กำลังผลิตอยู่', 'clipboard-list', 'blue'],
        ['ออเดอร์', 'ใบสั่งขายล่าสุด', 'shopping-bag', 'green'], ['ของฉัน', 'เช็คอิน · ลา · สลิป', 'user-round', 'amber'], ['บัญชีของฉัน', 'บริษัท · ตำแหน่ง', 'circle-user-round', 'gray'], ['เปิด ERP', 'erp.phopy.net', 'monitor', 'gray']],
    staff: [['เช็คอิน', 'ลงเวลาเข้างาน', 'log-in'], ['ขอลา', 'ยื่นใบลา', 'calendar-x', 'amber'], ['ตารางกะ', 'กะงานของฉัน', 'calendar-days', 'blue'], ['ขอเบิก', 'เบิกเงินล่วงหน้า', 'hand-coins', 'amber'],
        ['งานของฉัน', 'ระบบจัดการงาน', 'briefcase', 'blue'], ['ใช้งานรถยนต์', 'เริ่ม/จบทริป · แวะจุด', 'car', 'green'], ['ของฉัน', 'สลิป · เอกสาร · ข้อมูล', 'user-round', 'green'], ['บัญชีของฉัน', 'บริษัท · ตำแหน่ง', 'circle-user-round', 'gray']],
    staff_car: [['เริ่ม/จบทริป', 'บันทึกไมล์ · GPS', 'car'], ['แวะจุด/ส่งตำแหน่ง', 'เปิดแผนที่ปักพิกัด', 'map-pin', 'amber'], ['ประวัติทริป', 'รายการเดินทางของฉัน', 'history', 'blue'], ['กลับเมนูหลัก', 'เมนูพนักงาน', 'arrow-left', 'gray']],
}

// ข้อความ → <path> (fontkit จัดสระ/วรรณยุกต์ตาม GPOS); กึ่งกลางที่ cx, baseline y, หด font ถ้ากว้างเกิน maxW
function text(s, font, size, cx, y, fill, maxW) {
    const run = font.layout(s), sc0 = size / font.unitsPerEm
    const adv = run.positions.reduce((a, p) => a + p.xAdvance, 0) * sc0
    const sc = adv > maxW ? sc0 * maxW / adv : sc0
    let x = cx - adv * (sc / sc0) / 2, out = ''
    run.glyphs.forEach((g, i) => {
        const p = run.positions[i]
        out += `<path transform="translate(${(x + p.xOffset * sc).toFixed(1)} ${(y - p.yOffset * sc).toFixed(1)}) scale(${sc} ${-sc})" d="${g.path.toSVG()}"/>`
        x += p.xAdvance * sc
    })
    return `<g fill="${fill}">${out}</g>`
}

const W = 625, H = 843
function card([label, sub, icon, tone], i) {
    const x0 = (i % 4) * W, y0 = Math.floor(i / 4) * H, cx = x0 + W / 2, first = i === 0
    const [bg, fg] = first ? ['rgba(255,255,255,.18)', '#fff'] : T[tone ?? 'blue']
    const ix = cx - 95, iy = y0 + 235
    const ic = iconSvg(icon).replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<!--[\s\S]*?-->/g, '')
    return `<rect x="${x0 + 18}" y="${y0 + 24}" width="${W - 36}" height="${H - 48}" rx="56" fill="${first ? '#3B4CE6' : '#fff'}" filter="url(#sh)"/>
<rect x="${ix}" y="${iy}" width="190" height="190" rx="56" fill="${bg}"/>
<g transform="translate(${ix + 45} ${iy + 45}) scale(4.2)" fill="none" stroke="${fg}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ic}</g>
${text(label, bold, 82, cx, y0 + 575, first ? '#fff' : '#1D1A14', W - 70)}
${text(sub, reg, 40, cx, y0 + 655, first ? '#DDE1FB' : '#6B6355', W - 70)}`
}

for (const [k, btns] of Object.entries(MENUS)) {
    const rows = Math.ceil(btns.length / 4), height = 843 * rows
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2500" height="${height}"><defs><filter id="sh" x="-5%" y="-5%" width="110%" height="115%"><feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#6B5A30" flood-opacity=".16"/></filter></defs>
<rect width="2500" height="${height}" fill="#F5EFE2"/>${btns.map(card).join('\n')}</svg>`
    const out = path.join(backend, 'assets/line-richmenu', k + '.png')
    await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(out)
    console.log(out, fs.statSync(out).size)
}
