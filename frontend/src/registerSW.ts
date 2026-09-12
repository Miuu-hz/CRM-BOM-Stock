export function registerSW() {
  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => {
        // Check for updates every 60 seconds
        setInterval(() => reg.update(), 60_000)
      })
      .catch(err => console.warn('[SW] Registration failed:', err))
  })
}


// ═══════════════════════════════════════════════════════════════════════════
// เฝ้าดูว่ามี build ใหม่ขึ้น production หรือยัง แล้วรีเฟรชให้เอง
//
// เครื่องแคชเชียร์เปิดหน้าค้างไว้ทั้งวัน ไม่มีใครกด F5 — พอ deploy โค้ดใหม่
// เครื่องจึงยังรันของเก่าไปเรื่อย ๆ (เจอจริง 12 ก.ย. 69: แก้ความเข้มใบเสร็จ
// แล้ว deploy ไปแล้ว แต่หน้าร้านยังพิมพ์ใบจาง ๆ ของเวอร์ชันเก่าอยู่)
//
// index.html ถูก serve แบบ no-cache และชื่อไฟล์ bundle มี hash อยู่แล้ว
// จึงเทียบได้ตรง ๆ ว่าไฟล์ที่เสิร์ฟอยู่ตอนนี้ยังเป็นตัวเดียวกับที่โหลดมาหรือเปล่า
// ═══════════════════════════════════════════════════════════════════════════

const BUNDLE_RE = /assets\/index-[A-Za-z0-9_-]+\.js/

function loadedBundle(): string | null {
  for (const el of Array.from(document.querySelectorAll('script[src]'))) {
    const m = (el as HTMLScriptElement).src.match(BUNDLE_RE)
    if (m) return m[0]
  }
  return null
}

export function watchForNewBuild() {
  const current = loadedBundle()
  if (!current) return   // dev server ไม่มี bundle hash ข้ามไป

  let pendingReload = false
  let lastActivity = Date.now()
  const bump = () => { lastActivity = Date.now() }
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(ev, bump, { passive: true })
  }

  // ponytail: ใช้ "ว่าง 60 วิ" เป็นตัวแทนของ "ไม่ได้อยู่กลางบิล" — ง่ายและปลอดภัยพอ
  // สำหรับหน้าร้าน ถ้าวันหลังต้องแม่นกว่านี้ค่อยให้หน้า POS บอกสถานะตัวเองมา
  const IDLE_MS = 60_000

  const reloadWhenSafe = () => {
    if (document.hidden || Date.now() - lastActivity > IDLE_MS) {
      window.location.reload()
      return
    }
    setTimeout(reloadWhenSafe, 15_000)
  }

  const check = async () => {
    if (pendingReload) return
    try {
      const html = await fetch('/?v=' + Date.now(), { cache: 'no-store' }).then(r => r.text())
      const next = html.match(BUNDLE_RE)?.[0]
      if (next && next !== current) {
        pendingReload = true
        console.info('[update] เจอเวอร์ชันใหม่', next, '— จะรีเฟรชเมื่อหน้าจอว่าง')
        reloadWhenSafe()
      }
    } catch { /* เน็ตหลุดก็ข้ามรอบนี้ไป */ }
  }

  setInterval(check, 3 * 60_000)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check() })
  check()
}
