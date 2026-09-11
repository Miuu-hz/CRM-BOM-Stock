import { useEffect, useState, type MouseEvent } from 'react'
import { ImageOff, Loader2 } from 'lucide-react'
import api from '../../services/api'

interface AuthImageProps {
  /** attachment id — fetched via GET /api/attachments/:id/file (JWT-authenticated) */
  attachmentId: string
  alt?: string
  className?: string
  onClick?: (e: MouseEvent<HTMLImageElement>) => void
}

// Fetches an attachment through the authenticated axios instance (so it carries
// the same JWT as every other API call) and renders it as a blob object URL.
// Used anywhere a payment-attachment image is shown — the old public
// `/uploads/invoice-attachments/...` path is gone.
export function AuthImage({ attachmentId, alt, className, onClick }: AuthImageProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    let url: string | null = null
    setObjectUrl(null)
    setError(false)

    api.get(`/attachments/${attachmentId}/file`, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return
        url = URL.createObjectURL(res.data)
        setObjectUrl(url)
      })
      .catch(() => { if (!cancelled) setError(true) })

    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [attachmentId])

  if (error) {
    return (
      <div className={`flex items-center justify-center bg-[var(--surface-2)] ${className || ''}`}>
        <ImageOff className="w-5 h-5 text-[var(--fg-4)]" />
      </div>
    )
  }

  if (!objectUrl) {
    return (
      <div className={`flex items-center justify-center bg-[var(--surface-2)] ${className || ''}`}>
        <Loader2 className="w-5 h-5 text-[var(--fg-4)] animate-spin" />
      </div>
    )
  }

  return <img src={objectUrl} alt={alt} className={className} onClick={onClick} />
}
