// ThaiLLM / OpenAI-compatible intent detection service
// Analyzes LINE messages that don't match hard-coded commands
// Returns structured intent so line-bot.service can route correctly

const LLM_BASE_URL = process.env.THAI_LLM_URL    ?? 'https://api.aieat.or.th/v1'
const LLM_API_KEY  = process.env.THAI_LLM_API_KEY ?? ''
const LLM_MODEL    = process.env.THAI_LLM_MODEL   ?? 'OpenThaiGPT-ThaiLLM-8B-Instruct-v7.2'

export type IntentType =
    | 'CREATE_BOM'      // สร้าง/เพิ่ม BOM สูตรการผลิต
    | 'SUGGEST_MENU'    // แนะนำเมนูจากวัตถุดิบที่มี
    | 'QUERY_ERP'       // ถามข้อมูลใน ERP (สต็อก, ต้นทุน, ออเดอร์)
    | 'CREATE_TASK'     // งานที่ซับซ้อน ส่ง Paperclip
    | 'CHAT'            // คำถามทั่วไป ตอบตรง

export interface LLMIntent {
    intent: IntentType
    params: Record<string, any>
    replyDirect?: string  // ถ้า LLM ตอบได้เลย (CHAT intent)
}

// System prompt — สอน LLM ให้ return JSON intent เสมอ
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

export async function detectIntent(userMessage: string): Promise<LLMIntent> {
    if (!LLM_API_KEY) {
        return { intent: 'CHAT', params: {}, replyDirect: 'ระบบ AI ยังไม่ได้ตั้งค่า กรุณาติดต่อผู้ดูแล' }
    }

    try {
        const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${LLM_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: LLM_MODEL,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user',   content: userMessage },
                ],
                max_tokens: 300,
                temperature: 0.1,  // ต่ำ = deterministic มากขึ้น เหมาะกับ JSON extraction
            }),
            signal: AbortSignal.timeout(15_000),
        })

        if (!res.ok) {
            console.error('ThaiLLM API error:', res.status, await res.text())
            return fallbackIntent(userMessage)
        }

        const data: any = await res.json()
        const raw = data.choices?.[0]?.message?.content?.trim() ?? ''

        // Strip markdown code fences if LLM wraps in ```json ... ```
        const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()
        const parsed = JSON.parse(jsonStr) as LLMIntent
        return parsed

    } catch (err) {
        console.error('detectIntent error:', err)
        return fallbackIntent(userMessage)
    }
}

// Fallback เมื่อ LLM ไม่ตอบหรือ error
function fallbackIntent(message: string): LLMIntent {
    return {
        intent: 'CREATE_TASK',
        params: { title: message, description: `ข้อความจาก LINE: "${message}"` },
    }
}
