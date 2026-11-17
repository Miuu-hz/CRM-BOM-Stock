import { ReactNode, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import Sidebar, { SidebarMode } from './Sidebar'
import Header from './Header'

interface LayoutProps {
  children: ReactNode
}

// มือถือทั่วไป + Fold ตอนพับ (~340-430px) = โหมดมือถือ: ซ่อนเมนูข้าง กด ☰ แล้วเลื่อนออกมาทับ
// ตั้งแต่ 768px (Fold ตอนกาง / แท็บเล็ต / จอคอม) = เมนูเต็ม ตามที่เจ้าของเลือก 2026-11-17 · แถบไอคอนเหลือไว้ให้กด ☰ ย่อเอง
// ฟังการเปลี่ยนขนาดจอสด ๆ เพราะพับ/กาง Fold คือ viewport เปลี่ยนโดยไม่โหลดหน้าใหม่
const PHONE_MQ = '(max-width: 767px)'
const WIDE_MQ = '(min-width: 768px)'
const matches = (q: string) => typeof window !== 'undefined' && window.matchMedia(q).matches

function Layout({ children }: LayoutProps) {
  const [isPhone, setIsPhone] = useState(() => matches(PHONE_MQ))
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(() => (matches(WIDE_MQ) ? 'full' : 'rail'))
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()
  const path = location.pathname

  useEffect(() => {
    const phone = window.matchMedia(PHONE_MQ)
    const wide = window.matchMedia(WIDE_MQ)
    const sync = () => {
      setIsPhone(phone.matches)
      setSidebarMode(wide.matches ? 'full' : 'rail')
      setDrawerOpen(false)
    }
    phone.addEventListener('change', sync)
    wide.addEventListener('change', sync)
    return () => {
      phone.removeEventListener('change', sync)
      wide.removeEventListener('change', sync)
    }
  }, [])

  // เลือกเมนูแล้วปิดลิ้นชักเอง
  useEffect(() => setDrawerOpen(false), [path])

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  const toggleSidebar = () =>
    isPhone ? setDrawerOpen(o => !o) : setSidebarMode(m => (m === 'full' ? 'rail' : 'full'))

  // Tier 3: ปิดแสงสำหรับหน้าที่ต้องการความคมชัดสูงสุด / POS / จอครัว / ภาษี
  const noLimelightRoutes = ['/cashier', '/kds', '/tax']
  const isNoLight = noLimelightRoutes.some(r => path.startsWith(r))

  // Tier 2: แสงระดับนุ่มนวล (ลด opacity 50%) สำหรับหน้าทำงานข้อมูลตารางหนาแน่น
  const subtleRoutes = ['/stock', '/sales', '/purchase', '/bom', '/work-orders', '/qc', '/crm', '/receivables', '/accounting']
  const isSubtle = subtleRoutes.some(r => path.startsWith(r))

  return (
    <div className="flex h-screen h-[100dvh] overflow-hidden bg-[var(--bg)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-phopy-indigo focus:text-white focus:font-semibold focus:rounded-md"
      >
        ข้ามไปเนื้อหาหลัก
      </a>

      {!isPhone && <Sidebar mode={sidebarMode} />}

      {/* ลิ้นชักมือถือ — ห้ามใส่ class "flex" ที่ตัว fixed inset-0 ไม่งั้นโดนกฎกลาง modal ใน index.css ตัดความสูง */}
      {isPhone && drawerOpen && (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          <div className="relative flex h-full w-[280px] max-w-[85vw] shadow-2xl">
            <Sidebar mode="full" />
          </div>
        </div>
      )}

      <div className="relative flex-1 flex flex-col overflow-hidden min-w-0">
        {/* แสงสาด Limelight Backdrop ส่องตั้งแต่ขอบบนสุดของหน้าต่าง
            ทะลุผ่าน Frosted Header ลงมายัง Main Content อย่างต่อเนื่องเป็นผืนเดียว ไร้รอยต่อ! */}
        {!isNoLight && (
          <div className="phopy-limelight-backdrop" aria-hidden="true">
            <div className="phopy-limelight-beam" />
            <div className="phopy-aurora-blob blob-left" />
            <div className="phopy-aurora-blob blob-center" />
            <div className="phopy-aurora-blob blob-right" />
          </div>
        )}

        <Header onMenuClick={toggleSidebar} />

        <main
          id="main-content"
          className={`relative flex-1 overflow-y-auto overflow-x-hidden phopy-scrollbar p-3 sm:p-6 ${isSubtle ? 'limelight-subtle' : ''}`}
        >
          <div className="max-w-[1920px] mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}

export default Layout
