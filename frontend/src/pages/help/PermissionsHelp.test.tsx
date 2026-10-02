import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import PermissionsHelp from './PermissionsHelp'

const ANCHORS = ['overview', 'roles', 'departments', 'presets', 'approval', 'custom', 'examples', 'limits']

describe('PermissionsHelp', () => {
  it('มีหัวข้อครบทุก section และ id ตรงกับ anchor ที่ปุ่ม ? ลิงก์ไป', () => {
    const { container, getByRole } = render(<PermissionsHelp />)

    getByRole('heading', { level: 1, name: /ระบบสิทธิ์ผู้ใช้/ })

    for (const id of ANCHORS) {
      expect(container.querySelector(`#${id}`)).toBeTruthy()
    }

    expect(getByRole('heading', { level: 2, name: /สิทธิ์ทำงานอย่างไร/ })).toBeTruthy()
    expect(getByRole('heading', { level: 2, name: 'ระดับสิทธิ์' })).toBeTruthy()
    expect(getByRole('heading', { level: 2, name: 'แผนก' })).toBeTruthy()
    expect(getByRole('heading', { level: 2, name: 'ตำแหน่งสำเร็จรูป' })).toBeTruthy()
    expect(getByRole('heading', { level: 2, name: 'การขออนุมัติ' })).toBeTruthy()
    expect(getByRole('heading', { level: 2, name: 'สิทธิ์รายคน' })).toBeTruthy()
    expect(getByRole('heading', { level: 2, name: 'ตัวอย่างการตั้งค่า' })).toBeTruthy()
    expect(getByRole('heading', { level: 2, name: /ข้อควรรู้/ })).toBeTruthy()
  })
})
