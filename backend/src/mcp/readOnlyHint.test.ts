import { describe, it, expect } from 'vitest'
import { McpServer } from './sdk-compat'
import { registerTools, READ_ONLY_TOOLS } from './tools'

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
  it('marks exactly the tools in READ_ONLY_TOOLS', async () => {
    const tools = await listedTools()
    const marked = tools.filter((t) => t.annotations?.readOnlyHint === true).map((t) => t.name).sort()
    expect(marked).toEqual([...READ_ONLY_TOOLS].sort())
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
