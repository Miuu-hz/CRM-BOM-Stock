import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import { spawn } from 'child_process'

const router = Router()
router.use(authenticate)

const KIMI_BIN = process.env.KIMI_BIN || '/root/.kimi-code/bin/kimi'
const KIMI_TIMEOUT_MS = 90_000

function runKimiPrompt(message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(KIMI_BIN, ['-p', message], {
      env: { ...process.env, HOME: '/root' },
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', d => { stdout += d.toString() })
    proc.stderr.on('data', d => { stderr += d.toString() })

    const timer = setTimeout(() => {
      proc.kill()
      reject(new Error('Kimi CLI timeout'))
    }, KIMI_TIMEOUT_MS)

    proc.on('close', code => {
      clearTimeout(timer)
      if (code !== 0 && !stdout) return reject(new Error(stderr || 'Kimi CLI error'))
      const cleaned = stdout
        .replace(/\nTo resume this session:.*$/ms, '')
        .trim()
      resolve(cleaned)
    })

    proc.on('error', err => {
      clearTimeout(timer)
      reject(err)
    })
  })
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

  try {
    const reply = await runKimiPrompt(message)
    res.json({ success: true, reply })
  } catch (err: any) {
    console.error('kimi chat error:', err)
    res.status(502).json({ success: false, message: err.message || 'Kimi CLI failed' })
  }
})

// POST /api/llm-providers/test-chat (backward compat)
router.post('/test-chat', async (req: Request, res: Response) => {
  const { message } = req.body
  if (!message) return res.status(400).json({ success: false, message: 'Message is required' })

  try {
    const reply = await runKimiPrompt(message)
    res.json({ success: true, reply })
  } catch (err: any) {
    console.error('kimi test-chat error:', err)
    res.status(502).json({ success: false, message: err.message || 'Kimi CLI failed' })
  }
})

export default router
