import crypto from 'crypto'

export const FACE_MATCH_MIN = 0.6
export const FACE_MATCH_MARGIN = 0.05

function getFaceKey(): Buffer {
  const secret = process.env.FACE_KEY || process.env.JWT_SECRET
  if (!secret) throw new Error('FACE_KEY หรือ JWT_SECRET ยังไม่ได้ตั้งค่า')
  return crypto.createHash('sha256').update(secret).digest()
}

/**
 * Encrypt a face descriptor array using AES-256-GCM.
 * Stored as base64 "iv:tag:ciphertext".
 */
export function encryptDescriptor(descriptor: number[]): string {
  if (!Array.isArray(descriptor)) {
    throw new Error('Descriptor must be an array')
  }
  const key = getFaceKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const json = JSON.stringify(descriptor)
  const ciphertext = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return `${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`
}

/**
 * Decrypt base64 "iv:tag:ciphertext" back into number[] descriptor.
 */
export function decryptDescriptor(descriptorEnc: string): number[] {
  if (typeof descriptorEnc !== 'string') {
    throw new Error('Invalid descriptor_enc format')
  }
  const parts = descriptorEnc.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid descriptor_enc components')
  }
  const [ivB64, tagB64, cipherB64] = parts
  const iv = Buffer.from(ivB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  const ciphertext = Buffer.from(cipherB64, 'base64')

  const key = getFaceKey()
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  const parsed = JSON.parse(plaintext)
  if (!Array.isArray(parsed)) {
    throw new Error('Decrypted descriptor is not an array')
  }
  return parsed as number[]
}

/**
 * Calculate similarity between two face descriptor vectors.
 * This mirrors @vladmandic/human match.similarity with order 2, multiplier 25.
 * Returns 0 when lengths differ or are 0;
 * otherwise dist = 25 * Σ (a_i - b_i)^2 ; similarity = Math.max(0, 1 - Math.sqrt(dist)).
 */
export function faceSimilarity(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0
  }
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }
  const dist = 25 * sum
  return Math.max(0, 1 - Math.sqrt(dist))
}
