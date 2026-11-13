import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DocumentPrint, { PRINT_KEY } from './DocumentPrint'

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../services/hrDocument.service', () => {
  const service = {
    downloadTemplatePdf: vi.fn(),
    downloadPdf: vi.fn(),
  }
  return {
    default: service,
    hrDocumentService: service,
  }
})

import hrDocumentService from '../../services/hrDocument.service'
const mockDocService = hrDocumentService as unknown as {
  downloadTemplatePdf: ReturnType<typeof vi.fn>
  downloadPdf: ReturnType<typeof vi.fn>
}

describe('DocumentPrint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
  })

  it('renders print text and clicking ดาวน์โหลด PDF calls downloadTemplatePdf', async () => {
    sessionStorage.setItem(PRINT_KEY, 'สัญญาจ้างทดสอบ\nข้อความสัญญา')
    sessionStorage.setItem('hr_document_print_tpl', 'tpl-101')
    sessionStorage.setItem('hr_document_print_emp', 'emp-202')

    mockDocService.downloadTemplatePdf.mockResolvedValue(undefined)

    render(
      <MemoryRouter>
        <DocumentPrint />
      </MemoryRouter>
    )

    expect(screen.getByTestId('print-text').textContent).toContain('สัญญาจ้างทดสอบ')
    const dlBtn = screen.getByRole('button', { name: /ดาวน์โหลด PDF/i })
    expect(dlBtn).toBeTruthy()

    fireEvent.click(dlBtn)

    await waitFor(() => {
      expect(mockDocService.downloadTemplatePdf).toHaveBeenCalledWith('tpl-101', 'emp-202')
    })
  })

  it('displays fallback message when no document text in sessionStorage', () => {
    render(
      <MemoryRouter>
        <DocumentPrint />
      </MemoryRouter>
    )

    expect(screen.getByText('ไม่มีเอกสารให้พิมพ์ กรุณาสร้างเอกสารจากหน้าแม่แบบ')).toBeTruthy()
  })
})
