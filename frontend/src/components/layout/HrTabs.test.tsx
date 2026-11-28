import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import HrTabs, { HR_GROUPS } from './HrTabs'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', role: 'ADMIN', departments: [] } }) }))

const at = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route element={<HrTabs />}>
        <Route path="/hr/:page" element={<div>page</div>} />
      </Route>
    </Routes>
  </MemoryRouter>
)

describe('HrTabs', () => {
  it('ทุกหน้า HR (ยกเว้นของฉัน/คีออสก์/พิมพ์) อยู่ในกลุ่มเดียวเท่านั้น', () => {
    const paths = HR_GROUPS.flatMap(g => g.tabs.map(t => t.path))
    expect(new Set(paths).size).toBe(paths.length)
    expect(paths.sort()).toEqual(['/hr/advances', '/hr/assets', '/hr/attendance', '/hr/discipline', '/hr/documents', '/hr/employees',
      '/hr/leave', '/hr/lifecycle', '/hr/org', '/hr/payroll', '/hr/recruit', '/hr/roster', '/hr/settings', '/hr/training', '/hr/trips', '/hr/vehicles'])
    expect(HR_GROUPS).toHaveLength(5)
    expect(HR_GROUPS[4]).toEqual({
      tKey: 'sidebar.hrCar',
      tabs: [
        { path: '/hr/trips', tKey: 'sidebar.hrTrips' },
        { path: '/hr/vehicles', tKey: 'sidebar.hrVehicles' },
      ],
    })
  })

  it('อยู่หน้าตารางกะ → เห็นแท็บของกลุ่มเวลาทำงาน 3 แท็บ และแท็บตารางกะ active', () => {
    at('/hr/roster')
    const links = screen.getAllByRole('link')
    expect(links.map(l => l.getAttribute('href'))).toEqual(['/hr/attendance', '/hr/roster', '/hr/leave'])
    expect(links[1].className).toContain('border-[var(--primary)]')
    expect(screen.getByText('page')).toBeTruthy()
  })

  it('อยู่หน้าประวัติการใช้รถหรือรถของบริษัท → เห็นแท็บกลุ่มรถยนต์ 2 แท็บ และไฮไลต์แท็บที่เปิดอยู่', () => {
    const first = at('/hr/trips')
    let links = screen.getAllByRole('link')
    expect(links.map(l => l.getAttribute('href'))).toEqual(['/hr/trips', '/hr/vehicles'])
    expect(links[0].className).toContain('border-[var(--primary)]')
    first.unmount()

    at('/hr/vehicles')
    links = screen.getAllByRole('link')
    expect(links.map(l => l.getAttribute('href'))).toEqual(['/hr/trips', '/hr/vehicles'])
    expect(links[1].className).toContain('border-[var(--primary)]')
  })
})
