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

  it('redirects to /hr/me/trips when to=trips', async () => {
    setSearch('?t=abc123&to=trips')
    mockSuccessFetch()
    localStorage.setItem('crm_refresh_token', 'old-refresh')
    localStorage.setItem('crm_original_tenant', 'old-tenant')

    render(<LineLogin />)

    await waitFor(() => {
      expect(replaceSpy).toHaveBeenCalledWith('/hr/me/trips')
    })
    expect(localStorage.getItem('crm_refresh_token')).toBeNull()
    expect(localStorage.getItem('crm_original_tenant')).toBeNull()
    expect(localStorage.getItem('crm_token')).toBe('jwt-hr-self')
  })

  it('redirects to /hr/me/trips?action=stop when to=trips_stop', async () => {
    setSearch('?t=abc123&to=trips_stop')
    mockSuccessFetch()

    render(<LineLogin />)

    await waitFor(() => {
      expect(replaceSpy).toHaveBeenCalledWith('/hr/me/trips?action=stop')
    })
  })

  it('redirects to /hr/me/trips?tab=history when to=trips_history', async () => {
    setSearch('?t=abc123&to=trips_history')
    mockSuccessFetch()

    render(<LineLogin />)

    await waitFor(() => {
      expect(replaceSpy).toHaveBeenCalledWith('/hr/me/trips?tab=history')
    })
  })

  it('blocks open-redirect attempts (to=https://evil.com) and falls back to /hr/me', async () => {
    setSearch('?t=abc123&to=https://evil.com')
    mockSuccessFetch()

    render(<LineLogin />)

    await waitFor(() => {
      expect(replaceSpy).toHaveBeenCalledWith('/hr/me')
    })
  })

  it('falls back to /hr/me when to is omitted or a prototype property', async () => {
    setSearch('?t=abc123&to=constructor')
    mockSuccessFetch()

    render(<LineLogin />)

    await waitFor(() => {
      expect(replaceSpy).toHaveBeenCalledWith('/hr/me')
    })
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
