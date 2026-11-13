import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../services/hrRecruit.service', () => {
  const service = { getPostings: vi.fn(), createPosting: vi.fn(), updatePosting: vi.fn(), getApplicants: vi.fn(), getPostingQr: vi.fn(), updateApplicant: vi.fn(), hire: vi.fn() }
  return { default: service, hrRecruitService: service }
})

import svc from '../../services/hrRecruit.service'
import Recruit from './Recruit'

const m = svc as unknown as Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  vi.clearAllMocks()
  m.getPostings.mockResolvedValue([{ id: 'p1', title: 'แคชเชียร์', is_open: true, public_token: 'abc', applicant_count: 1, org_unit_id: null, description: null, created_at: '' }])
  m.getApplicants.mockResolvedValue([{ id: 'a1', posting_id: 'p1', posting_title: 'แคชเชียร์', full_name: 'สมชาย ใจดี', phone: '0812345678', stage: 'APPLIED' }])
})

describe('Recruit page', () => {
  it('renders postings and the applicant board', async () => {
    render(<Recruit />)
    expect(await screen.findByText('สมชาย ใจดี')).toBeTruthy()
    expect(screen.getAllByText('แคชเชียร์').length).toBeGreaterThan(0)
    expect(screen.getByText('สัมภาษณ์ (0)')).toBeTruthy()
  })

  it('moves an applicant to the next stage', async () => {
    m.updateApplicant.mockResolvedValue({})
    render(<Recruit />)
    fireEvent.click(await screen.findByText('ไปขั้นถัดไป'))
    await waitFor(() => expect(m.updateApplicant).toHaveBeenCalledWith('a1', { stage: 'INTERVIEW' }))
  })

  it('creates a posting', async () => {
    m.createPosting.mockResolvedValue({})
    render(<Recruit />)
    fireEvent.click(await screen.findByText(/เพิ่มตำแหน่ง/))
    fireEvent.change(screen.getByLabelText('ชื่อตำแหน่ง'), { target: { value: 'พนักงานครัว' } })
    fireEvent.click(screen.getByText('บันทึก'))
    await waitFor(() => expect(m.createPosting).toHaveBeenCalledWith({ title: 'พนักงานครัว', description: '' }))
  })

  it('shows the QR card for a posting', async () => {
    m.getPostingQr.mockResolvedValue({ url: 'https://x.test/apply/abc', qr: 'data:image/png;base64,AAA' })
    render(<Recruit />)
    fireEvent.click(await screen.findByText(/QR ใบสมัคร/))
    const img = await screen.findByAltText('QR ใบสมัคร')
    expect(img.getAttribute('src')).toBe('data:image/png;base64,AAA')
    expect(screen.getByText('https://x.test/apply/abc')).toBeTruthy()
    expect(m.getPostingQr).toHaveBeenCalledWith('p1')
  })
})
