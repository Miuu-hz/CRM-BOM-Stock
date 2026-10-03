import { Router } from 'express'

// ponytail: no routes left here — GET /, GET /:id, POST /, PUT /:id, DELETE /:id
// all removed 2026-10-03 (orphan cleanup, zone B): no frontend caller anywhere
// (real sales-order flow lives at /api/sales/sales-orders instead), legacy
// orders/order_items tables joined against the dead `products` table. Kept as
// an empty router per deletion policy so the mount in index.ts (/api/orders)
// doesn't need touching.
const router = Router()

export default router
