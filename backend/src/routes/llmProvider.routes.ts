import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import { spawn } from 'child_process'
import { getDb } from '../db/sqlite'
import { detectIntent, getActiveProvider } from '../services/llm.service'

const router = Router()
router.use(authenticate)

const KIMI_BIN = process.env.KIMI_BIN || '/root/.kimi-code/bin/kimi'
const KIMI_TIMEOUT_MS = 30_000

// Kimi CLI — spawn from /tmp to avoid codebase exploration
function runKimiChat(message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const prompt = `คุณคือผู้ช่วย ERP ชื่อ "Kimi AI" ตอบเป็นภาษาไทย กระชับ ไม่เกิน 3 ประโยค ห้ามอ่านไฟล์หรือรันคำสั่งใดๆ\n\nคำถาม: ${message}`
    const proc = spawn(KIMI_BIN, ['-p', prompt], {
      env: { ...process.env, HOME: '/root' },
      cwd: '/tmp',
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', d => { stdout += d.toString() })
    proc.stderr.on('data', d => { stderr += d.toString() })

    const timer = setTimeout(() => { proc.kill(); reject(new Error('timeout')) }, KIMI_TIMEOUT_MS)

    proc.on('close', code => {
      clearTimeout(timer)
      if (code !== 0 && !stdout) return reject(new Error(stderr || 'Kimi CLI error'))
      resolve(stdout.replace(/\nTo resume this session:.*$/ms, '').trim())
    })

    proc.on('error', err => { clearTimeout(timer); reject(err) })
  })
}

// ── ERP query helpers ─────────────────────────────────────────────────────────

function queryPendingPOs(tenantId: string): string {
  const db = getDb()
  const rows = db.prepare(`
    SELECT po.po_number, po.status, po.total_amount, po.created_at, s.name AS supplier_name
    FROM purchase_orders po
    LEFT JOIN suppliers s ON po.supplier_id = s.id
    WHERE po.tenant_id = ? AND po.status NOT IN ('RECEIVED','CANCELLED')
    ORDER BY po.created_at DESC LIMIT 10
  `).all(tenantId) as any[]

  if (rows.length === 0) return 'ไม่มี PO ที่ค้างอยู่ครับ ✅'

  const lines = rows.map((r: any) => {
    const date = (r.created_at ?? '').slice(0, 10)
    const amount = r.total_amount ? ` ฿${Number(r.total_amount).toLocaleString('th-TH')}` : ''
    const supplier = r.supplier_name ? ` — ${r.supplier_name}` : ''
    return `• ${r.po_number} [${r.status}]${supplier}${amount} (${date})`
  })
  return `PO ที่ค้างอยู่ ${rows.length} รายการ:\n\n${lines.join('\n')}`
}

function queryStock(tenantId: string, keyword: string): string {
  const db = getDb()
  const rows = db.prepare(`
    SELECT name, quantity, unit
    FROM stock_items
    WHERE tenant_id = ? AND name LIKE ? AND status = 'ACTIVE'
    ORDER BY name LIMIT 8
  `).all(tenantId, `%${keyword}%`) as any[]

  if (rows.length === 0) return `ไม่พบ "${keyword}" ในสต็อกครับ`

  const lines = rows.map((r: any) => `• ${r.name}: ${r.quantity} ${r.unit ?? ''}`.trimEnd())
  return `ผลการค้นหา "${keyword}":\n\n${lines.join('\n')}`
}

function queryAllStock(tenantId: string): string {
  const db = getDb()
  const rows = db.prepare(`
    SELECT name, quantity, unit
    FROM stock_items
    WHERE tenant_id = ? AND status = 'ACTIVE'
    ORDER BY name LIMIT 15
  `).all(tenantId) as any[]

  if (rows.length === 0) return 'ยังไม่มีสินค้าในสต็อกครับ'

  const lines = rows.map((r: any) => `• ${r.name}: ${r.quantity} ${r.unit ?? ''}`.trimEnd())
  return `สต็อกทั้งหมด ${rows.length} รายการ:\n\n${lines.join('\n')}`
}

function queryRecentSalesOrders(): string {
  const db = getDb()
  try {
    const rows = db.prepare(`
      SELECT order_number, status, total_amount, order_date
      FROM orders ORDER BY created_at DESC LIMIT 5
    `).all() as any[]

    if (rows.length === 0) return 'ยังไม่มีออเดอร์ขายในระบบครับ'

    const lines = rows.map((r: any) => {
      const amount = r.total_amount ? ` ฿${Number(r.total_amount).toLocaleString('th-TH')}` : ''
      return `• ${r.order_number} [${r.status}]${amount}`
    })
    return `ออเดอร์ขายล่าสุด:\n\n${lines.join('\n')}`
  } catch {
    return 'ไม่สามารถดึงข้อมูลออเดอร์ได้ครับ'
  }
}

function queryBOM(tenantId: string, keyword: string): string {
  const db = getDb()
  const product = db.prepare(`
    SELECT id, name FROM stock_items WHERE tenant_id = ? AND name LIKE ? LIMIT 1
  `).get(tenantId, `%${keyword}%`) as any

  if (!product) return `ไม่พบสินค้า "${keyword}" ในระบบครับ`

  const bom = db.prepare(`
    SELECT id, version FROM boms
    WHERE product_id = ? AND tenant_id = ?
    ORDER BY CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END, created_at DESC LIMIT 1
  `).get(product.id, tenantId) as any

  if (!bom) return `ยังไม่มีสูตรการผลิตสำหรับ "${product.name}" ครับ`

  const items = db.prepare(`
    SELECT bi.quantity, si.name, si.unit, si.unit_cost
    FROM bom_items bi LEFT JOIN stock_items si ON bi.material_id = si.id
    WHERE bi.bom_id = ? ORDER BY bi.sort_order
  `).all(bom.id) as any[]

  const totalCost = items.reduce((s: number, i: any) => s + (i.quantity * (i.unit_cost ?? 0)), 0)
  const lines = items.map((i: any) =>
    `• ${i.name ?? '?'}: ${i.quantity} ${i.unit ?? ''} — ฿${((i.unit_cost ?? 0) * i.quantity).toFixed(2)}`
  )
  return [`สูตร: ${product.name} (${bom.version})`, '', ...lines, '', `ต้นทุนรวม: ฿${totalCost.toFixed(2)}`].join('\n')
}

// ── Keyword routing (no LLM provider required) ────────────────────────────────

function handleKeyword(message: string, tenantId: string): string | null {
  const m = message

  if (/\bpo\b|ใบสั่งซื้อ|สั่งซื้อ|ค้างชำระ|ค้างอยู่|purchase.?order/i.test(m))
    return queryPendingPOs(tenantId)

  const stockKw = m.match(/สต็อก\s*(.+)|(.+?)\s*เหลือเท่าไหร่|(.+?)\s*เหลือกี่|(.+?)\s*มีเหลือไหม/)
  if (stockKw) {
    const kw = (stockKw[1] || stockKw[2] || stockKw[3] || stockKw[4] || '').trim().replace(/[?？ๆ\s]+$/, '')
    return kw ? queryStock(tenantId, kw) : queryAllStock(tenantId)
  }

  if (/สต็อกทั้งหมด|ของในคลัง|คลังสินค้า/.test(m)) return queryAllStock(tenantId)

  if (/ออเดอร์|order|คำสั่งขาย/.test(m)) return queryRecentSalesOrders()

  const bomKw = m.match(/สูตร\s*(.+)|bom\s*(.+)|วัตถุดิบ\s*(.+)/i)
  if (bomKw) {
    const kw = (bomKw[1] || bomKw[2] || bomKw[3] || '').trim()
    if (kw) return queryBOM(tenantId, kw)
  }

  return null
}

// GET /api/llm-providers/status
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const version = await new Promise<string>((resolve, reject) => {
      const proc = spawn(KIMI_BIN, ['--version'], { env: { ...process.env, HOME: '/root' } })
      let out = ''
      proc.stdout.on('data', d => { out += d.toString() })
      proc.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error('not found')))
      proc.on('error', reject)
    })
    res.json({ success: true, provider: 'kimi-code', version })
  } catch {
    res.status(502).json({ success: false, message: 'Kimi CLI not available' })
  }
})

// POST /api/llm-providers/chat
router.post('/chat', async (req: Request, res: Response) => {
  const { message } = req.body
  if (!message) return res.status(400).json({ success: false, message: 'Message is required' })

  const tenantId: string = (req as any).user?.tenantId ?? ''

  try {
    // 1. LLM-based routing (when provider configured in DB)
    const provider = getActiveProvider(tenantId)
    if (provider) {
      const intent = await detectIntent(message, tenantId)
      let reply: string
      switch (intent.intent) {
        case 'QUERY_ERP': {
          const { queryType, keyword } = intent.params
          if (queryType === 'stock' && keyword) reply = queryStock(tenantId, keyword)
          else if (queryType === 'stock') reply = queryAllStock(tenantId)
          else if (queryType === 'bom' && keyword) reply = queryBOM(tenantId, keyword)
          else if (queryType === 'order') reply = queryRecentSalesOrders()
          else reply = queryPendingPOs(tenantId)
          break
        }
        case 'CHAT':
          reply = intent.replyDirect ?? 'มีอะไรให้ช่วยไหมครับ?'
          break
        default:
          reply = intent.replyDirect ?? 'ฟีเจอร์นี้ใช้ผ่าน LINE ได้ครับ'
      }
      return res.json({ success: true, reply })
    }

    // 2. Keyword routing (fast path, no LLM needed)
    const keywordReply = handleKeyword(message, tenantId)
    if (keywordReply) return res.json({ success: true, reply: keywordReply })

    // 3. General chat via Kimi CLI from /tmp
    const reply = await runKimiChat(message)
    return res.json({ success: true, reply })

  } catch (err: any) {
    console.error('chat error:', err.message)
    return res.status(502).json({ success: false, message: 'ระบบ AI ไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่' })
  }
})

// POST /api/llm-providers/test-chat (backward compat)
router.post('/test-chat', async (req: Request, res: Response) => {
  const { message } = req.body
  if (!message) return res.status(400).json({ success: false, message: 'Message is required' })

  const tenantId: string = (req as any).user?.tenantId ?? ''
  const keywordReply = handleKeyword(message, tenantId)
  if (keywordReply) return res.json({ success: true, reply: keywordReply })

  try {
    const reply = await runKimiChat(message)
    res.json({ success: true, reply })
  } catch (err: any) {
    res.status(502).json({ success: false, message: err.message || 'Kimi CLI failed' })
  }
})

export default router
