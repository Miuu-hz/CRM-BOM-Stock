import { describe, it, expect, vi } from 'vitest'
import { extractKey } from './server'
import { Request } from 'express'

describe('extractKey', () => {
  it('prioritizes Authorization Bearer header over query parameter', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const req = {
      headers: { authorization: 'Bearer header-secret' },
      query: { key: 'query-secret' },
      method: 'GET',
      path: '/mcp/test',
    } as unknown as Request

    const key = extractKey(req)
    expect(key).toBe('header-secret')
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('supports raw Authorization header without Bearer', () => {
    const req = {
      headers: { authorization: 'raw-secret' },
      query: {},
      method: 'GET',
      path: '/mcp/test',
    } as unknown as Request

    const key = extractKey(req)
    expect(key).toBe('raw-secret')
  })

  it('falls back to query parameter with a deprecation warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const req = {
      headers: {},
      query: { key: 'legacy-query-key' },
      method: 'GET',
      path: '/mcp/test',
    } as unknown as Request

    const key = extractKey(req)
    expect(key).toBe('legacy-query-key')
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[mcp] Notice: API key passed via query parameter')
    )
    warnSpy.mockRestore()
  })

  it('returns null when neither header nor query key is present', () => {
    const req = {
      headers: {},
      query: {},
      method: 'GET',
      path: '/mcp/test',
    } as unknown as Request

    expect(extractKey(req)).toBeNull()
  })
})
