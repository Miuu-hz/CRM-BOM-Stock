import { describe, it, expect, vi, beforeEach } from 'vitest'
import { captureFaceDescriptor, startCamera, stopCamera } from './faceScan'

const mockDetect = vi.fn()
const mockInit = vi.fn()

vi.mock('@vladmandic/human', () => {
  return {
    default: class MockHuman {
      init = mockInit
      detect = mockDetect
    },
    Human: class MockHuman {
      init = mockInit
      detect = mockDetect
    },
  }
})

describe('faceScan lib', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('โยนข้อผิดพลาด "ไม่พบใบหน้า กรุณาหันหน้าเข้ากล้อง" เมื่อไม่พบใบหน้า', async () => {
    mockDetect.mockResolvedValueOnce({ face: [] })
    const fakeVideo = document.createElement('video')

    await expect(captureFaceDescriptor(fakeVideo)).rejects.toThrow(
      'ไม่พบใบหน้า กรุณาหันหน้าเข้ากล้อง'
    )
  })

  it('โยนข้อผิดพลาด "พบมากกว่า 1 ใบหน้า" เมื่อพบมากกว่า 1 ใบหน้า', async () => {
    mockDetect.mockResolvedValueOnce({ face: [{ embedding: [1] }, { embedding: [2] }] })
    const fakeVideo = document.createElement('video')

    await expect(captureFaceDescriptor(fakeVideo)).rejects.toThrow(
      'พบมากกว่า 1 ใบหน้า'
    )
  })

  it('คืนค่า embedding เมื่อพบใบหน้า 1 ใบหน้า', async () => {
    const embedding = [0.1, 0.2, 0.3]
    mockDetect.mockResolvedValueOnce({ face: [{ embedding: new Float32Array(embedding) }] })
    const fakeVideo = document.createElement('video')

    const result = await captureFaceDescriptor(fakeVideo)
    expect(result).toEqual(Array.from(new Float32Array(embedding)))
  })

  it('startCamera เรียก getUserMedia ด้วย facingMode user และเปิดกล้อง', async () => {
    const mockTrack = { stop: vi.fn() }
    const mockStream = { getTracks: () => [mockTrack] }
    const getUserMedia = vi.fn().mockResolvedValue(mockStream)

    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      value: { getUserMedia },
      writable: true,
      configurable: true,
    })

    const fakeVideo = document.createElement('video')
    fakeVideo.play = vi.fn().mockResolvedValue(undefined)

    const stream = await startCamera(fakeVideo)
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: 'user' } })
    expect(fakeVideo.srcObject).toBe(mockStream)
    expect(stream).toBe(mockStream)
  })

  it('stopCamera หยุดทุก track และล้าง srcObject', () => {
    const mockTrack = { stop: vi.fn() }
    const mockStream = { getTracks: () => [mockTrack] }
    const fakeVideo = document.createElement('video')
    fakeVideo.srcObject = mockStream as any

    stopCamera(fakeVideo)
    expect(mockTrack.stop).toHaveBeenCalled()
    expect(fakeVideo.srcObject).toBeNull()
  })
})
