import { Router } from 'express'

// ponytail: POST /:id/attachments and DELETE /:id/attachments/:attachmentId were removed
// 2026-10-03 (orphan-endpoint cleanup — no caller anywhere; frontend uses the generic
// /api/attachments/:refType/:refId API for INVOICE refs, same invoice_attachments table).
// This file is mounted at /sales/invoices in sales/index.ts (shared mount file) and is kept
// — empty — rather than deleting the file/mount per cleanup rules.
const router = Router()

export default router
