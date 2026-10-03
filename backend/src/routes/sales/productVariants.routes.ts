import { Router } from 'express'

// ponytail: all 3 routes that lived here (GET /, GET /product/:productId, POST /) were
// removed 2026-10-03 (orphan-endpoint cleanup — product_variants has 0 rows in production,
// no frontend page, service, or MCP tool ever reads/writes it or the word "variant").
// This file is mounted at /sales/product-variants in sales/index.ts (shared mount file)
// and is kept — empty — rather than deleting the file/mount per cleanup rules.
const router = Router()

export default router
