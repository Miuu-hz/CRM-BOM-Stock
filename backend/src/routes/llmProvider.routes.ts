import { Router } from 'express'

// ponytail: no routes left here — GET /status, POST /chat, POST /test-chat all
// removed 2026-10-03 (orphan cleanup, zone B): no frontend caller, no internal
// caller (line-bot.service calls detectIntent() directly as a function, not
// over HTTP). Kept as an empty router per deletion policy so the mount in
// index.ts (/api/llm-providers) doesn't need touching. Add routes back here
// if a real LLM-provider HTTP consumer shows up.
const router = Router()

export default router
