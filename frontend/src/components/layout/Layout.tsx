import { ReactNode, useState } from 'react'
import Sidebar, { SidebarMode } from './Sidebar'
import Header from './Header'

interface LayoutProps {
  children: ReactNode
}

function Layout({ children }: LayoutProps) {
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('full')

  const toggleSidebar = () =>
    setSidebarMode(m => (m === 'full' ? 'rail' : 'full'))

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-phopy-indigo focus:text-white focus:font-semibold focus:rounded-md"
      >
        ข้ามไปเนื้อหาหลัก
      </a>

      <Sidebar mode={sidebarMode} />

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Header onMenuClick={toggleSidebar} />
        <main id="main-content" className="flex-1 overflow-y-auto overflow-x-hidden phopy-scrollbar p-6">
          <div className="max-w-[1920px] mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}

export default Layout
