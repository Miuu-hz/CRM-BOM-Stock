import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import LineLogin from './LineLogin'

describe('LineLogin', () => {
  const originalLocation = window.location
  let replaceSpy: ReturnType<typeof vi.fn>

  const setSearch = (search: string) => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: {
        ...originalLocation,
        search,
        replace: replaceSpy,
      },
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    replaceSpy = vi.fn()
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    })
    vi.unstubAllGlobals()
  })

  const mockSuccessFetch = () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            token: 'jwt-hr-self',
            user: { id: 'u1', tenant_id: 't1', role: 'USER', scope: 'hr_self' },
          },
        }),
      })
    )
  }

  it('redirects to /hr/me when ?t=... is exchanged and clears old session keys', async () => {
    setSearch('?t=abc123')
    mockSuccessFetch()
    localStorage.setItem('crm_refresh_token', 'old-refresh')
    localStorage.setItem('crm_original_tenant', 'old-tenant')

    render(<LineLogin />)

    await waitFor(() => {
      expect(replaceSpy).toHaveBeenCalledWith('/hr/me')
    })
    expect(localStorage.getItem('crm_refresh_token')).toBeNull()
    expect(localStorage.getItem('crm_original_tenant')).toBeNull()
    expect(localStorage.getItem('crm_token')).toBe('jwt-hr-self')
  })

  it('always redirects to /hr/me even when to=trips or to=https://evil.com is present', async () => {
    for (const search of ['?t=abc123&to=trips', '?t=abc123&to=trips_stop', '?t=abc123&to=https://evil.com']) {
      replaceSpy.mockClear()
      setSearch(search)
      mockSuccessFetch()

      const { unmount } = render(<LineLogin />)

      await waitFor(() => {
        expect(replaceSpy).toHaveBeenCalledWith('/hr/me')
      })
      unmount()
    }
  })

  it('shows error message when token exchange fails', async () => {
    setSearch('?t=bad&to=trips')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ success: false, message: 'ลิงก์หมดอายุ' }),
      })
    )

    render(<LineLogin />)

    expect(await screen.findByText('ลิงก์หมดอายุ')).toBeTruthy()
    expect(replaceSpy).not.toHaveBeenCalled()
  })
})
