import { describe, it, expect } from 'vitest'
import { McpServer } from './sdk-compat'
import { registerTools, READ_ONLY_TOOLS, NO_READONLY_HINT } from './tools'

/* eslint-disable @typescript-eslint/no-var-requires */
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js')

/**
 * Client ใช้ readOnlyHint ตัดสินว่าตอบจากผลที่จำไว้ได้ไหม โดยไม่เรียกซ้ำ
 * ถ้าติดป้ายผิดบน tool เขียนข้อมูล คำสั่งครั้งที่สองจะไม่ถูกทำจริง จึงล็อกไว้ทั้งสองทาง ผ่าน tools/list จริง
 */
async function listedTools() {
  const server = new McpServer({ name: 'test', version: '1' })
  registerTools(server, 'test-tenant', 'master')
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '1' })
  await server.connect(b)
  await client.connect(a)
  const { tools } = await client.listTools()
  await client.close()
  await server.close()
  return tools as Array<{ name: string; annotations?: { readOnlyHint?: boolean } }>
}

describe('readOnlyHint', () => {
  it('marks exactly the tools in READ_ONLY_TOOLS, minus the ones a client must not keep', async () => {
    const tools = await listedTools()
    const marked = tools.filter((t) => t.annotations?.readOnlyHint === true).map((t) => t.name).sort()
    expect(marked).toEqual([...READ_ONLY_TOOLS].filter((n) => !NO_READONLY_HINT.has(n)).sort())
  })

  it('keeps employee attendance listed but unmarked, and still in the read-only scope', async () => {
    const tools = await listedTools()
    const hr = tools.find((t) => t.name === 'hr_attendance_summary')
    expect(hr).toBeDefined()
    expect(hr?.annotations?.readOnlyHint).not.toBe(true)
    expect(READ_ONLY_TOOLS.has('hr_attendance_summary')).toBe(true)
  })

  it('never marks a tool that writes', async () => {
    const tools = await listedTools()
    for (const name of ['pay_supplier', 'approve_purchase_request', 'create_draft_po', 'record_stock_movement', 'submit_close_adjustments']) {
      const tool = tools.find((t) => t.name === name)
      expect(tool, name).toBeDefined()
      expect(tool?.annotations?.readOnlyHint, name).not.toBe(true)
    }
  })
})
