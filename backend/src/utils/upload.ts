import path from 'path'
import fs from 'fs'

// Safe image extensions and MIME types we are willing to serve.
const ALLOWED_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp'])
const ALLOWED_IMAGE_MIMETYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

// ponytail: naive but sufficient magic-byte check for the image types we accept.
// Upgrade path: use a proper file-type library if more formats are needed.
function hasImageMagicBytes(buffer: Buffer): boolean {
  if (buffer.length < 4) return false
  const hex = buffer.toString('hex', 0, 4).toLowerCase()
  // JPEG
  if (hex.startsWith('ffd8ff')) return true
  // PNG
  if (hex === '89504e47') return true
  // GIF
  if (hex.startsWith('47494638')) return true
  // WEBP: RIFF....WEBP
  if (hex.startsWith('52494646') && buffer.length >= 12) {
    const webp = buffer.toString('ascii', 8, 12).toLowerCase()
    if (webp === 'webp') return true
  }
  return false
}

export function isValidImageFile(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r')
    const buffer = Buffer.alloc(512)
    const bytesRead = fs.readSync(fd, buffer, 0, 512, 0)
    fs.closeSync(fd)
    if (bytesRead < 4) return false
    return hasImageMagicBytes(buffer.subarray(0, bytesRead))
  } catch {
    return false
  }
}

export function isAllowedImageExt(ext: string): boolean {
  return ALLOWED_IMAGE_EXTS.has(ext.toLowerCase())
}

export function isAllowedImageMimetype(mimetype: string): boolean {
  return ALLOWED_IMAGE_MIMETYPES.has(mimetype.toLowerCase())
}

// Sanitize a filename for safe storage / display. Does not guarantee uniqueness.
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim()
    .substring(0, 200)
}

// Extract a safe extension for image uploads. Falls back to empty string.
export function getSafeImageExtension(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase()
  return ALLOWED_IMAGE_EXTS.has(ext) ? ext : ''
}
