import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import path from 'path'

const GATE_PATH   = process.env.MASTER_GATE_PATH || 'master-gate'
const GATE_PIN    = process.env.MASTER_GATE_PIN  || '000000'
const COOKIE_NAME = 'mg_access'
const COOKIE_TTL  = 8 * 60 * 60 * 1000  // 8 hours

function signToken(): string {
  const expires = Date.now() + COOKIE_TTL
  const raw     = `${expires}:${GATE_PIN}`
  const sig     = crypto.createHmac('sha256', process.env.JWT_SECRET || 'fallback')
                        .update(raw).digest('hex')
  return Buffer.from(`${expires}:${sig}`).toString('base64')
}

function verifyToken(token: string): boolean {
  try {
    const decoded  = Buffer.from(token, 'base64').toString()
    const [exStr, sig] = decoded.split(':')
    const expires  = parseInt(exStr, 10)
    if (Date.now() > expires) return false
    const expected = crypto.createHmac('sha256', process.env.JWT_SECRET || 'fallback')
                           .update(`${expires}:${GATE_PIN}`).digest('hex')
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  } catch {
    return false
  }
}

// HTML for the PIN gate page
function gateHtml(error = ''): string {
  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Phopy — Master Access</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      background: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .card {
      background: #1e293b; border: 1px solid #334155; border-radius: 16px;
      padding: 48px 40px; width: 360px; text-align: center;
    }
    .logo { font-size: 36px; font-weight: 800; color: #6366f1; letter-spacing: -1px; margin-bottom: 6px; }
    .sub  { color: #64748b; font-size: 13px; margin-bottom: 36px; }
    label { display: block; text-align: left; color: #94a3b8; font-size: 12px;
            font-weight: 600; margin-bottom: 6px; letter-spacing: 0.05em; text-transform: uppercase; }
    input[type=password] {
      width: 100%; padding: 12px 16px; border-radius: 8px; border: 1px solid #334155;
      background: #0f172a; color: #f1f5f9; font-size: 20px; letter-spacing: 6px;
      text-align: center; outline: none; transition: border-color 0.2s;
    }
    input[type=password]:focus { border-color: #6366f1; }
    .error { color: #ef4444; font-size: 13px; margin: 10px 0; min-height: 20px; }
    button {
      width: 100%; padding: 13px; margin-top: 12px; border-radius: 8px; border: none;
      background: #6366f1; color: white; font-size: 15px; font-weight: 600;
      cursor: pointer; transition: background 0.2s;
    }
    button:hover { background: #4f46e5; }
    .footer { margin-top: 28px; color: #334155; font-size: 11px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">✦ Phopy</div>
    <div class="sub">Master Access — ใส่รหัสเพื่อดำเนินการต่อ</div>
    <form method="POST" action="/api/master-gate/verify">
      <label>Access PIN</label>
      <input type="password" name="pin" inputmode="numeric" maxlength="8"
             autofocus autocomplete="off" placeholder="••••••" />
      <div class="error">${error}</div>
      <button type="submit">ยืนยัน →</button>
    </form>
    <div class="footer">erp.phopy.net</div>
  </div>
</body>
</html>`
}

// ── Middleware: protect /master route in the SPA catch-all ───────────────────
export function requireGateCookie(req: Request, res: Response, next: NextFunction): void {
  const cookies = req.cookies || {}
  const token   = cookies[COOKIE_NAME]
  if (token && verifyToken(token)) {
    next()
    return
  }
  // Redirect to gate page
  res.redirect(`/${GATE_PATH}`)
}

// ── Route handlers ────────────────────────────────────────────────────────────
export function serveGatePage(_req: Request, res: Response): void {
  res.setHeader('Content-Type', 'text/html')
  res.send(gateHtml())
}

export function verifyGatePin(req: Request, res: Response): void {
  const pin = (req.body?.pin || '').toString().trim()
  if (pin !== GATE_PIN) {
    res.setHeader('Content-Type', 'text/html')
    res.status(401).send(gateHtml('รหัสไม่ถูกต้อง กรุณาลองใหม่'))
    return
  }
  const token = signToken()
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   COOKIE_TTL,
    path:     '/',
  })
  res.redirect('/master')
}

export { GATE_PATH }
