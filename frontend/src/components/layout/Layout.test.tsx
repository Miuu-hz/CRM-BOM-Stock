import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Layout from './Layout'

// ponytail: mock minimal context values and API stubs for Sidebar/Header (< 40 lines)
// to test the real Sidebar component and its classes without heavy application providers.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Test User', role: 'ADMIN', email: 'test@example.com', tenant_id: 't1' },
    isMaster: false,
    allTenants: [],
    tenant: null,
    originalTenantId: null,
    switchTenant: vi.fn(),
    logout: vi.fn(),
  }),
}))
vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}))
vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'th', toggleLanguage: vi.fn() }),
}))
vi.mock('../../contexts/SubscriptionContext', () => ({
  useSubscription: () => ({ subscription: { features: [] } }),
}))
vi.mock('../../services/api', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: { data: [] } }),
    post: vi.fn().mockResolvedValue({ data: { data: {} } }),
  },
}))
vi.mock('../../services/search', () => ({
  default: { search: vi.fn().mockResolvedValue({}) },
}))

function stubMatchMedia(activeQueries: string[] = []) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: activeQueries.includes(query),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Layout responsive modes', () => {
  it('โหมด phone (< 768px): เริ่มต้นไม่แสดง aside, กดปุ่มเมนูเปิด drawer dialog ที่มี aside, กด Escape ปิด', () => {
    stubMatchMedia(['(max-width: 767px)'])
    render(
      <MemoryRouter>
        <Layout>
          <div>Phone Content</div>
        </Layout>
      </MemoryRouter>
    )

    // เริ่มต้น: ไม่แสดง aside และไม่มี dialog
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()

    // กดปุ่มเมนูที่ header (aria-label = 'header.openMenu')
    const menuButton = screen.getByRole('button', { name: 'header.openMenu' })
    fireEvent.click(menuButton)

    // แสดง drawer role="dialog" ที่มี aside อยู่ภายใน
    const dialog = screen.getByRole('dialog')
    expect(dialog).not.toBeNull()
    const aside = screen.getByRole('complementary')
    expect(dialog.contains(aside)).toBe(true)

    // กด Escape ปิด drawer
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('ตั้งแต่ 768px (Fold กาง/แท็บเล็ต/จอคอม): เมนูเต็ม w-[280px] และกด ☰ ย่อเป็นแถบไอคอน w-16', () => {
    stubMatchMedia(['(min-width: 768px)'])
    render(
      <MemoryRouter>
        <Layout>
          <div>Wide Content</div>
        </Layout>
      </MemoryRouter>
    )

    const aside = screen.getByRole('complementary')
    expect(aside.classList.contains('w-[280px]')).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'header.openMenu' }))
    expect(screen.getByRole('complementary').classList.contains('w-16')).toBe(true)
  })
})
