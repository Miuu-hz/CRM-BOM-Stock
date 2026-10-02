import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HelpLink } from './HelpLink'

describe('HelpLink', () => {
  it('เปิดหน้าอธิบายสิทธิ์ในแท็บใหม่ ที่ anchor ที่ระบุ', () => {
    render(<HelpLink anchor="roles" />)
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('/help/permissions#roles')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })
})
