import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import FaceCapture from './FaceCapture'
import { captureFaceDescriptor, startCamera, stopCamera } from '../../lib/faceScan'

vi.mock('../../lib/faceScan', () => ({
  startCamera: vi.fn().mockResolvedValue({ getTracks: () => [] }),
  stopCamera: vi.fn(),
  captureFaceDescriptor: vi.fn(),
}))

const mockStartCamera = startCamera as unknown as ReturnType<typeof vi.fn>
const mockStopCamera = stopCamera as unknown as ReturnType<typeof vi.fn>
const mockCaptureFace = captureFaceDescriptor as unknown as ReturnType<typeof vi.fn>

describe('FaceCapture component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStartCamera.mockResolvedValue({ getTracks: () => [] })
  })

  it('stops camera tracks on unmount', async () => {
    const stop = vi.fn()
    mockStartCamera.mockResolvedValue({ getTracks: () => [{ stop }] })
    const { unmount } = render(<FaceCapture onCapture={vi.fn()} onClose={vi.fn()} />)
    const captureBtn = screen.getByRole('button', { name: 'ถ่าย' })
    await waitFor(() => expect((captureBtn as HTMLButtonElement).disabled).toBe(false))
    unmount()
    expect(stop).toHaveBeenCalled()
  })

  it('renders video element, camera title and buttons', async () => {
    render(<FaceCapture onCapture={vi.fn()} onClose={vi.fn()} />)

    expect(screen.getByText('สแกนใบหน้า')).toBeTruthy()
    expect(screen.getByTestId('face-video')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'ยกเลิก' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'ถ่าย' })).toBeTruthy()

    await waitFor(() => {
      expect(mockStartCamera).toHaveBeenCalled()
    })
  })

  it('calls onCapture with descriptor when clicking "ถ่าย"', async () => {
    const onCapture = vi.fn().mockResolvedValue(undefined)
    mockCaptureFace.mockResolvedValueOnce([1, 2, 3])

    render(<FaceCapture onCapture={onCapture} onClose={vi.fn()} />)

    const captureBtn = screen.getByRole('button', { name: 'ถ่าย' })
    await waitFor(() => expect((captureBtn as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(captureBtn)

    await waitFor(() => {
      expect(mockCaptureFace).toHaveBeenCalled()
      expect(onCapture).toHaveBeenCalledWith([1, 2, 3])
    })
  })

  it('displays error text when capture fails', async () => {
    mockCaptureFace.mockRejectedValueOnce(new Error('ไม่พบใบหน้า กรุณาหันหน้าเข้ากล้อง'))

    render(<FaceCapture onCapture={vi.fn()} onClose={vi.fn()} />)

    const captureBtn = screen.getByRole('button', { name: 'ถ่าย' })
    await waitFor(() => expect((captureBtn as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(captureBtn)

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('ไม่พบใบหน้า กรุณาหันหน้าเข้ากล้อง')).toBeTruthy()
  })

  it('calls stopCamera and onClose when clicking cancel', async () => {
    const onClose = vi.fn()
    render(<FaceCapture onCapture={vi.fn()} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }))
    expect(mockStopCamera).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
