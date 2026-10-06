import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * โหมด audit (readonly) ต่อผู้ใช้ — select ในตารางทีมต้องยิง POST ไปเปลี่ยน scope จริง
 * ไม่ใช่แค่ set state ในเครื่อง ไม่งั้นรีโหลดหน้าแล้วย้อนกลับไปเป็น full เงียบ ๆ
 */
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}))
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../services/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))

import api from '../../services/api'
import MCPSettings from './MCPSettings'

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> }

function seedApi() {
  mockApi.get.mockImplementation((url: string) => {
    if (url === '/mcp-settings') {
      return Promise.resolve({
        data: {
          success: true,
          data: {
            key: 'abc123', endpointUrl: 'https://erp.phopy.net/mcp/sse', role: 'ADMIN',
            canManage: true, hasKey: true, quota: { used: 1, limit: 5 }, scope: 'full',
          },
        },
      })
    }
    if (url === '/mcp-settings/team') {
      return Promise.resolve({
        data: {
          success: true,
          data: {
            users: [{ id: 'u1', name: 'สมชาย', email: 's@example.com', role: 'USER', hasKey: 1, scope: 'full' }],
            quota: { used: 1, limit: 5 },
          },
        },
      })
    }
    return Promise.resolve({ data: { success: true, data: {} } })
  })
  mockApi.post.mockResolvedValue({ data: { success: true, data: { scope: 'readonly' } } })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MCPSettings — สลับสิทธิ์เต็ม/อ่านอย่างเดียวของทีม', () => {
  it('เปลี่ยน select ของผู้ใช้ในทีมเป็น readonly ต้องยิง POST ไปที่ /team/:id/scope', async () => {
    seedApi()
    render(<MCPSettings />)

    const select = await screen.findByTitle('สิทธิ์เต็ม / อ่านอย่างเดียว (ตรวจสอบ)')
    fireEvent.change(select, { target: { value: 'readonly' } })

    await waitFor(() =>
      expect(mockApi.post).toHaveBeenCalledWith('/mcp-settings/team/u1/scope', { scope: 'readonly' }),
    )
  })
})
