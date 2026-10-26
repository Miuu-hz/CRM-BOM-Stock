import { describe, it, expect } from 'vitest'
import { registerGuideTool, ERP_INSTRUCTIONS, GUIDE_TOPICS } from './guide'
import { registerTools } from '../tools'
import { IMcpServer } from '../sdk-compat'

function fakeServer() {
  const tools: Record<string, (args: any) => Promise<any>> = {}
  const server: IMcpServer = {
    tool: (name: string, _desc: any, _schema: any, handler: any) => {
      tools[name] = handler
    },
    connect: async () => {},
    close: async () => {},
  }
  return { server, tools }
}

describe('mcp/tools/guide', () => {
  it('ERP_INSTRUCTIONS is <= 2000 chars and mentions get_erp_guide', () => {
    expect(ERP_INSTRUCTIONS.length).toBeLessThanOrEqual(2000)
    expect(ERP_INSTRUCTIONS).toContain('get_erp_guide')
  })

  it('every topic in the enum returns non-empty text through the registered handler', async () => {
    const { server, tools } = fakeServer()
    registerGuideTool(server, 'test-tenant')
    expect(tools['get_erp_guide']).toBeTypeOf('function')

    const topics = [
      'overview',
      'purchase',
      'purchase_billing',
      'stock_units',
      'sales',
      'production_bom',
      'finance',
      'crm',
      'platform_month',
    ] as const

    for (const topic of topics) {
      const res = await tools['get_erp_guide']({ topic })
      expect(res).toBeDefined()
      expect(res.content).toBeDefined()
      expect(res.content.length).toBeGreaterThan(0)
      expect(res.content[0].type).toBe('text')
      expect(res.content[0].text.trim().length).toBeGreaterThan(0)
    }
  })

  it('no stale tool names mentioned in GUIDE_TOPICS or ERP_INSTRUCTIONS', () => {
    const { server, tools } = fakeServer()
    registerTools(server, 'test-tenant', 'master')

    const registeredToolNames = new Set(Object.keys(tools))
    expect(registeredToolNames.size).toBeGreaterThan(0)

    const extractNames = (text: string, includeBackticks: boolean): string[] => {
      const names = new Set<string>()
      const reParen = /([a-z][a-z_]*[a-z])\(/g
      let match: RegExpExecArray | null
      while ((match = reParen.exec(text)) !== null) {
        names.add(match[1])
      }
      if (includeBackticks) {
        const reBacktick = /`([a-z][a-z_]*[a-z])`/g
        while ((match = reBacktick.exec(text)) !== null) {
          names.add(match[1])
        }
      }
      return [...names]
    }

    // ERP_INSTRUCTIONS via /([a-z][a-z_]*[a-z])\(/g and /`([a-z][a-z_]*[a-z])`/g
    const instructionTools = extractNames(ERP_INSTRUCTIONS, true)
    for (const name of instructionTools) {
      expect(
        registeredToolNames.has(name),
        `ERP_INSTRUCTIONS references tool "${name}" which is not registered`
      ).toBe(true)
    }

    // Every GUIDE_TOPICS text via /([a-z][a-z_]*[a-z])\(/g
    for (const [topic, text] of Object.entries(GUIDE_TOPICS)) {
      const topicTools = extractNames(text, false)
      for (const name of topicTools) {
        expect(
          registeredToolNames.has(name),
          `GUIDE_TOPICS[${topic}] references tool "${name}" which is not registered`
        ).toBe(true)
      }
    }
  })
})
