// MCP-style LLM hub — dynamically resolves provider per tenant
// Falls back to env vars if no DB record exists

import db from '../db/sqlite'

export interface ResolvedProvider {
  baseUrl: string
  apiKey: string
  model: string
}

export function getActiveProvider(tenantId?: string): ResolvedProvider | null {
  if (tenantId) {
    const row: any = db.prepare(
      `SELECT base_url, api_key, model FROM llm_providers
       WHERE tenant_id = ? AND is_active = 1 AND is_default = 1 LIMIT 1`
    ).get(tenantId)
    if (row) {
      return { baseUrl: row.base_url, apiKey: row.api_key, model: row.model }
    }
    const fallback: any = db.prepare(
      `SELECT base_url, api_key, model FROM llm_providers
       WHERE tenant_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1`
    ).get(tenantId)
    if (fallback) {
      return { baseUrl: fallback.base_url, apiKey: fallback.api_key, model: fallback.model }
    }
  }
  return null
}

export type IntentType =
    | 'CREATE_BOM'
    | 'SUGGEST_MENU'
    | 'QUERY_ERP'
    | 'CREATE_TASK'
    | 'CHAT'

export interface LLMIntent {
    intent: IntentType
    params: Record<string, any>
    replyDirect?: string
}

const SYSTEM_PROMPT = `คุณคือผู้ช่วย ERP สำหรับโรงงานผลิต/ร้านกาแฟ ชื่อ "ERP Bot"
วิเคราะห์ข้อความและตอบกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่น

รูปแบบ JSON:
{
  "intent": "<intent>",
  "params": { ... },
  "replyDirect": "<ข้อความตอบ ถ้า intent=CHAT>"
}

intent ที่รองรับ:
- CREATE_BOM: ผู้ใช้ต้องการเพิ่ม/สร้างสูตรการผลิต BOM
  params: { productName, items: [{name, qty, unit}] }
- SUGGEST_MENU: ผู้ใช้ต้องการให้แนะนำเมนูหรือสินค้าใหม่จากวัตถุดิบที่มี
  params: { description }
- QUERY_ERP: ผู้ใช้ถามข้อมูลใน ERP เช่น สต็อก ต้นทุน ออเดอร์
  params: { queryType: "stock"|"cost"|"order"|"bom", keyword }
- CREATE_TASK: งานซับซ้อนที่ต้องให้ทีม AI รับไปดำเนินการต่อ
  params: { title, description }
- CHAT: ไม่ใช่งาน ERP ตอบตรงได้เลย
  params: {}
  replyDirect: "<คำตอบสั้น กระชับ ภาษาไทย>"

ตัวอย่าง:
ข้อความ: "เพิ่มสูตรหมอนใหม่ ใยโพลี 500g ผ้า 1m"
→ {"intent":"CREATE_BOM","params":{"productName":"หมอนใหม่","items":[{"name":"ใยโพลีเอสเตอร์","qty":500,"unit":"g"},{"name":"ผ้า","qty":1,"unit":"m"}]}}

ข้อความ: "ออกเมนูกาแฟเย็นโดยใช้วัตถุดิบที่มีในร้านหน่อย"
→ {"intent":"SUGGEST_MENU","params":{"description":"กาแฟเย็นจากวัตถุดิบในร้าน"}}

ข้อความ: "สต็อกนมเหลือเท่าไหร่"
→ {"intent":"QUERY_ERP","params":{"queryType":"stock","keyword":"นม"}}

ข้อความ: "สวัสดีครับ"
→ {"intent":"CHAT","params":{},"replyDirect":"สวัสดีครับ! มีอะไรให้ช่วยไหมครับ"}
`

export async function detectIntent(userMessage: string, tenantId?: string): Promise<LLMIntent> {
    const provider = getActiveProvider(tenantId)
    if (!provider) {
        return { intent: 'CHAT', params: {}, replyDirect: 'ระบบ AI ยังไม่ได้ตั้งค่า กรุณาติดต่อผู้ดูแล' }
    }

    try {
        const res = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${provider.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: provider.model,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user',   content: userMessage },
                ],
                max_tokens: 300,
                temperature: 0.1,
            }),
            signal: AbortSignal.timeout(15_000),
        })

        if (!res.ok) {
            console.error('LLM API error:', res.status, await res.text())
            return fallbackIntent(userMessage)
        }

        const data: any = await res.json()
        const raw = data.choices?.[0]?.message?.content?.trim() ?? ''

        const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()
        const parsed = JSON.parse(jsonStr) as LLMIntent
        return parsed

    } catch (err) {
        console.error('detectIntent error:', err)
        return fallbackIntent(userMessage)
    }
}

const UNIT_SUGGEST_SYSTEM = `คุณเป็นผู้ช่วยตั้งค่าการแปลงหน่วยสำหรับระบบ ERP
ตอบด้วย JSON เท่านั้น ห้ามมีข้อความอื่นนอกจาก JSON
รูปแบบ: {"factor": <number>, "note": "<คำอธิบายสั้นภาษาไทย>"}`

export async function suggestUnitConversion(params: {
  from_unit: string
  to_unit: string
  material_name?: string
  existing_conversions: Array<{ from_unit: string; to_unit: string; factor: number }>
}, tenantId?: string): Promise<{ factor: number | null; note: string }> {
  const provider = getActiveProvider(tenantId)
  if (!provider) {
    return { factor: null, note: 'ระบบ AI ยังไม่ได้ตั้งค่า กรุณากรอกค่าเอง' }
  }

  const existingText = params.existing_conversions.length > 0
    ? params.existing_conversions.map(c => `1 ${c.from_unit} = ${c.factor} ${c.to_unit}`).join(', ')
    : 'ยังไม่มี'

  const userMsg = `สินค้า: ${params.material_name ?? 'ทั่วไป'}
ต้องการทราบ: 1 ${params.from_unit} เท่ากับกี่ ${params.to_unit}
การแปลงที่มีในระบบ: ${existingText}
แนะนำค่า factor ที่เหมาะสม พร้อมคำอธิบายสั้น`

  try {
    const res = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: 'system', content: UNIT_SUGGEST_SYSTEM },
          { role: 'user', content: userMsg },
        ],
        max_tokens: 100,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) throw new Error(`LLM error ${res.status}`)

    const data: any = await res.json()
    const raw = data.choices?.[0]?.message?.content?.trim() ?? ''
    const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(jsonStr)

    if (typeof parsed.factor === 'number' && parsed.factor > 0) {
      return { factor: parsed.factor, note: parsed.note ?? '' }
    }
    return { factor: null, note: 'AI ไม่สามารถแนะนำค่าได้ กรุณากรอกเอง' }

  } catch (err) {
    console.error('suggestUnitConversion error:', err)
    return { factor: null, note: 'กรุณากรอกค่าเอง' }
  }
}

function fallbackIntent(_message: string): LLMIntent {
    return {
        intent: 'CHAT',
        params: {},
        replyDirect: 'ขออภัย ระบบวิเคราะห์คำสั่งขัดข้องชั่วคราว\nลองพิมพ์ใหม่อีกครั้ง หรือพิมพ์ -help เพื่อดูคำสั่งที่รองรับครับ',
    }
}
