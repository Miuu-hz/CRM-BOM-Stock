import { describe, it, expect } from 'vitest'
import {
  encryptDescriptor,
  decryptDescriptor,
  faceSimilarity,
  FACE_MATCH_MIN,
  FACE_MATCH_MARGIN,
} from './face'

describe('HR Face Service (pure unit tests)', () => {
  const dummyDescriptor = Array.from({ length: 128 }, (_, i) => Math.sin(i * 0.1))

  describe('encryptDescriptor / decryptDescriptor', () => {
    it('round-trip preserves descriptor array exactly', () => {
      const enc = encryptDescriptor(dummyDescriptor)
      expect(typeof enc).toBe('string')
      const dec = decryptDescriptor(enc)
      expect(dec).toHaveLength(dummyDescriptor.length)
      for (let i = 0; i < dummyDescriptor.length; i++) {
        expect(dec[i]).toBeCloseTo(dummyDescriptor[i], 10)
      }
    })

    it('stored descriptor_enc has 3 base64 segments and is not plaintext JSON', () => {
      const enc = encryptDescriptor(dummyDescriptor)
      const parts = enc.split(':')
      expect(parts).toHaveLength(3)
      // Check each part is valid base64
      for (const part of parts) {
        expect(Buffer.from(part, 'base64').toString('base64')).toBe(part)
      }
      // IV is 12 bytes -> 16 base64 chars
      expect(Buffer.from(parts[0], 'base64')).toHaveLength(12)
      // Tag is 16 bytes -> 24 base64 chars (or 22 without padding)
      expect(Buffer.from(parts[1], 'base64')).toHaveLength(16)
      // Must not be plaintext JSON
      expect(enc.includes('[')).toBe(false)
      expect(enc.includes(']')).toBe(false)
    })

    it('throws error when tampering with ciphertext or auth tag', () => {
      const enc = encryptDescriptor(dummyDescriptor)
      const parts = enc.split(':')
      // Tamper ciphertext
      const tamperedCipher = parts[0] + ':' + parts[1] + ':' + Buffer.from('corrupt_data').toString('base64')
      expect(() => decryptDescriptor(tamperedCipher)).toThrow()

      // Tamper tag
      const tamperedTag = parts[0] + ':' + Buffer.from('invalidtag123456').toString('base64') + ':' + parts[2]
      expect(() => decryptDescriptor(tamperedTag)).toThrow()

      // Invalid format
      expect(() => decryptDescriptor('not-valid')).toThrow()
    })

    it('handles non-array inputs defensively', () => {
      expect(() => encryptDescriptor(null as any)).toThrow()
      expect(() => encryptDescriptor('not-array' as any)).toThrow()
      expect(() => decryptDescriptor(null as any)).toThrow()
    })
  })

  describe('faceSimilarity', () => {
    it('returns 1.0 for identical vectors', () => {
      expect(faceSimilarity(dummyDescriptor, dummyDescriptor)).toBe(1)
    })

    it('returns 0 when lengths differ or either vector is empty', () => {
      const v127 = dummyDescriptor.slice(0, 127)
      expect(faceSimilarity(dummyDescriptor, v127)).toBe(0)
      expect(faceSimilarity([], [])).toBe(0)
      expect(faceSimilarity(dummyDescriptor, [])).toBe(0)
      expect(faceSimilarity([], dummyDescriptor)).toBe(0)
      expect(faceSimilarity(null as any, dummyDescriptor)).toBe(0)
    })

    it('computes similarity according to 1 - sqrt(25 * sum_diff_squared)', () => {
      // 128 elements, each differs by 0.005
      // sum = 128 * 0.000025 = 0.0032
      // dist = 25 * 0.0032 = 0.08
      // sqrt(0.08) ≈ 0.2828427
      // expected similarity ≈ 1 - 0.2828427 = 0.717157
      const near = dummyDescriptor.map((x) => x + 0.005)
      const sim = faceSimilarity(dummyDescriptor, near)
      expect(sim).toBeGreaterThan(0.7)
      expect(sim).toBeLessThan(0.73)
      expect(sim).toBeCloseTo(1 - Math.sqrt(25 * 128 * 0.005 * 0.005), 5)
    })

    it('returns 0 when distance is 1 or greater', () => {
      const far = dummyDescriptor.map((x) => x + 0.5)
      expect(faceSimilarity(dummyDescriptor, far)).toBe(0)
    })

    it('exports expected constants', () => {
      expect(FACE_MATCH_MIN).toBe(0.6)
      expect(FACE_MATCH_MARGIN).toBe(0.05)
    })
  })
})
