import { ReactNode, useState } from 'react'
import { useLocation } from 'react-router-dom'
import Sidebar, { SidebarMode } from './Sidebar'
import Header from './Header'

interface LayoutProps {
  children: ReactNode
}

function Layout({ children }: LayoutProps) {
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('full')
  const location = useLocation()
  const path = location.pathname

  const toggleSidebar = () =>
    setSidebarMode(m => (m === 'full' ? 'rail' : 'full'))

  // Tier 3: ปิดแสงสำหรับหน้าที่ต้องการความคมชัดสูงสุด / POS / จอครัว / เอกสารบัญชีภาษี
  const noLimelightRoutes = ['/cashier', '/kds', '/accounting', '/tax']
  const isNoLight = noLimelightRoutes.some(r => path.startsWith(r))

  // Tier 2: แสงระดับนุ่มนวล (ลด opacity 50%) สำหรับหน้าทำงานข้อมูลตารางหนาแน่น
  const subtleRoutes = ['/stock', '/sales', '/purchase', '/bom', '/work-orders', '/qc', '/crm', '/receivables']
  const isSubtle = subtleRoutes.some(r => path.startsWith(r))

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-phopy-indigo focus:text-white focus:font-semibold focus:rounded-md"
      >
        ข้ามไปเนื้อหาหลัก
      </a>

      <Sidebar mode={sidebarMode} />

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
          className={`relative z-10 flex-1 overflow-y-auto overflow-x-hidden phopy-scrollbar p-6 ${isSubtle ? 'limelight-subtle' : ''}`}
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
