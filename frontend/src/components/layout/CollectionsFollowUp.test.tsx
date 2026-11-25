import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Header from './Header'
import { CollectionsFollowUpTab } from '../../pages/CRM'
import api from '../../services/api'
import thJson from '../../i18n/locales/th/translation.json'
import type { CollectionItem } from '../../services/sales.service'

const mockNavigate = vi.fn()
let mockRole = 'ADMIN'

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, any>) => {
      const raw = key.split('.').reduce<any>((acc, p) => (acc && acc[p] !== undefined ? acc[p] : undefined), thJson)
      let out = typeof raw === 'string' ? raw : (opts?.defaultValue ?? key)
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          if (k !== 'defaultValue') out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v))
        }
      }
      return out
    },
  }),
}))

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Test User', role: mockRole, email: 'test@example.com', tenant_id: 't1' },
    isMaster: mockRole === 'MASTER',
  }),
}))

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}))

vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'th', toggleLanguage: vi.fn() }),
}))

vi.mock('../../services/search', () => ({
  default: { search: vi.fn().mockResolvedValue({}) },
}))

vi.mock('../../services/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
}

const sampleItems: CollectionItem[] = [
  {
    kind: 'INVOICE',
    id: 'inv-1',
    number: 'INV-2026-001',
    customer_id: 'cust-1',
    customer_name: 'บริษัท ก ข จำกัด',
    customer_phone: '0812345678',
    due_date: '2026-11-22',
    next_follow_date: null,
    follow_date: '2026-11-22',
    days_left: -3,
    amount: 12500,
    last_follow: { note: 'โทรแจ้งยอดแล้ว', type: 'CALL', created_at: '2026-11-21T09:00:00Z', created_by: 'admin@test.com' },
  },
  {
    kind: 'SALES_ORDER',
    id: 'so-1',
    number: 'SO-2026-002',
    customer_id: 'cust-2',
    customer_name: 'ร้าน ข ค',
    due_date: '2026-11-25',
    next_follow_date: null,
    follow_date: '2026-11-25',
    days_left: 0,
    amount: 4000,
    last_follow: null,
  },
  {
    kind: 'QUOTATION',
    id: 'qt-1',
    number: 'QT-2026-003',
    customer_id: 'cust-3',
    customer_name: 'ร้าน ไกลวัน',
    due_date: '2026-12-05',
    next_follow_date: null,
    follow_date: '2026-12-05',
    days_left: 10,
    amount: 9000,
    last_follow: null,
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockRole = 'ADMIN'
})

describe('Header collections bell', () => {
  it('shows overdue + today badge count for allowed role and navigates to CRM collections tab on click', async () => {
    mockApi.get.mockResolvedValue({
      data: {
        success: true,
        data: {
          items: sampleItems,
          summary: { overdue: { count: 1, amount: 12500 }, today: { count: 1, amount: 4000 }, soon: { count: 0, amount: 0 } },
        },
      },
    })

    render(
      <MemoryRouter>
        <Header onMenuClick={vi.fn()} />
      </MemoryRouter>
    )

    const badge = await screen.findByTestId('bell-badge')
    expect(badge.textContent).toBe('2')
    expect(mockApi.get).toHaveBeenCalledWith('/sales/collections')

    fireEvent.click(screen.getByRole('button', { name: 'การแจ้งเตือน' }))

    await waitFor(() => {
      expect(screen.getByText('INV-2026-001')).toBeDefined()
      expect(screen.getByText('เกิน 3 วัน')).toBeDefined()
      expect(screen.getByText('ครบวันนี้')).toBeDefined()
    })
    expect(screen.queryByText('QT-2026-003')).toBeNull()

    fireEvent.click(screen.getByText('INV-2026-001'))
    expect(mockNavigate).toHaveBeenCalledWith('/crm?customer=cust-1&tab=collections')
  })

  it('caps badge at 99+ and hides badge when count is 0', async () => {
    mockApi.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: { items: [], summary: { overdue: { count: 60, amount: 0 }, today: { count: 50, amount: 0 }, soon: { count: 0, amount: 0 } } },
      },
    })

    const { unmount } = render(
      <MemoryRouter>
        <Header onMenuClick={vi.fn()} />
      </MemoryRouter>
    )
    expect((await screen.findByTestId('bell-badge')).textContent).toBe('99+')
    unmount()

    mockApi.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: { items: [], summary: { overdue: { count: 0, amount: 0 }, today: { count: 0, amount: 0 }, soon: { count: 0, amount: 0 } } },
      },
    })
    render(
      <MemoryRouter>
        <Header onMenuClick={vi.fn()} />
      </MemoryRouter>
    )
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('bell-badge')).toBeNull()
  })

  it('does not fetch collections or show badge for non-allowed role USER', () => {
    mockRole = 'USER'
    render(
      <MemoryRouter>
        <Header onMenuClick={vi.fn()} />
      </MemoryRouter>
    )
    expect(mockApi.get).not.toHaveBeenCalled()
    expect(screen.queryByTestId('bell-badge')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'การแจ้งเตือน' }))
    expect(screen.getByText('ยังไม่มีการแจ้งเตือน')).toBeDefined()
  })
})

describe('CRM CollectionsFollowUpTab form', () => {
  it('submits follow-up with docType, docId, and nextFollowDate then refreshes', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    mockApi.post.mockResolvedValueOnce({ data: { success: true, data: { id: 'act-1' } } })

    render(
      <CollectionsFollowUpTab
        customerId="cust-1"
        items={[sampleItems[0]]}
        loading={false}
        onRefresh={onRefresh}
      />
    )

    expect(screen.getByText('INV-2026-001')).toBeDefined()
    expect(screen.getByText('โทรแจ้งยอดแล้ว')).toBeDefined()

    const submitBtn = screen.getByRole('button', { name: 'บันทึกการติดตาม' }) as HTMLButtonElement
    expect(submitBtn.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText(/ช่องทาง/), { target: { value: 'EMAIL' } })
    fireEvent.change(screen.getByLabelText(/นัดติดตามถัดไป/), { target: { value: '2026-12-01' } })
    fireEvent.change(screen.getByLabelText(/บันทึกผลการติดตาม/), { target: { value: 'ส่งใบแจ้งยอดทางอีเมล' } })

    expect(submitBtn.disabled).toBe(false)
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/activities', {
        customerId: 'cust-1',
        type: 'EMAIL',
        note: 'ส่งใบแจ้งยอดทางอีเมล',
        docType: 'INVOICE',
        docId: 'inv-1',
        nextFollowDate: '2026-12-01',
      })
      expect(onRefresh).toHaveBeenCalledTimes(1)
    })
  })
})
