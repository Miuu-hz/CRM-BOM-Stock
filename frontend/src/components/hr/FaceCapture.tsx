import { useEffect, useRef, useState } from 'react'
import { Camera, X, AlertCircle, RefreshCw } from 'lucide-react'
import { captureFaceDescriptor, startCamera, stopCamera } from '../../lib/faceScan'

export interface FaceCaptureProps {
  title?: string
  onCapture: (descriptor: number[]) => Promise<void> | void
  onClose: () => void
}

export default function FaceCapture({ title = 'สแกนใบหน้า', onCapture, onClose }: FaceCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [cameraLoading, setCameraLoading] = useState(true)
  const [capturing, setCapturing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    const init = async () => {
      if (!videoRef.current) return
      setCameraLoading(true)
      setError(null)
      try {
        await startCamera(videoRef.current)
      } catch (err: any) {
        if (mounted) {
          setError(err?.message || 'ไม่สามารถเปิดกล้องได้')
        }
      } finally {
        if (mounted) {
          setCameraLoading(false)
        }
      }
    }

    init()

    return () => {
      mounted = false
      if (videoRef.current) {
        stopCamera(videoRef.current)
      }
    }
  }, [])

  const handleClose = () => {
    if (videoRef.current) {
      stopCamera(videoRef.current)
    }
    onClose()
  }

  const handleCapture = async () => {
    if (!videoRef.current || capturing) return
    setError(null)
    setCapturing(true)
    try {
      const descriptor = await captureFaceDescriptor(videoRef.current)
      await onCapture(descriptor)
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'สแกนใบหน้าไม่สำเร็จ'
      setError(msg)
    } finally {
      setCapturing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="phopy-card w-full max-w-md p-6 space-y-4 shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
          <h3 className="font-bold text-base sm:text-lg text-[var(--fg)] flex items-center gap-2">
            <Camera className="w-5 h-5 text-phopy-indigo" />
            <span>{title}</span>
          </h3>
          <button
            type="button"
            onClick={handleClose}
            aria-label="ปิด"
            className="p-1 rounded-lg hover:bg-[var(--surface-2)] text-[var(--fg-3)] hover:text-[var(--fg)] transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="relative rounded-xl overflow-hidden bg-black aspect-video flex items-center justify-center">
          <video
            ref={videoRef}
            playsInline
            autoPlay
            muted
            data-testid="face-video"
            className="w-full h-full object-cover"
          />
          {cameraLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white text-sm gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>กำลังเปิดกล้อง...</span>
            </div>
          )}
        </div>

        {error && (
          <div
            role="alert"
            data-testid="face-capture-error"
            className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs sm:text-sm font-medium text-center flex items-center justify-center gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={handleClose}
            disabled={capturing}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold border border-[var(--border)] hover:bg-[var(--surface-2)] text-[var(--fg-2)] transition"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={handleCapture}
            disabled={capturing || cameraLoading}
            data-testid="capture-face-btn"
            className="phopy-btn-primary px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 shadow-sm disabled:opacity-50 transition"
          >
            <Camera className="w-4 h-4" />
            <span>{capturing ? 'กำลังประมวลผล...' : 'ถ่าย'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
