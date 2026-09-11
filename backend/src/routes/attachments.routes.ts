import { Router, Request, Response } from 'express'
import path from 'path'
import fs from 'fs'
import multer from 'multer'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { invoiceUploadDir } from './sales/shared'
import { getSubscription } from '../services/subscription.service'
import {
  isValidAttachmentFile,
  isAllowedAttachmentExt,
  isAllowedAttachmentMimetype,
  getSafeAttachmentExtension,
  sanitizeFilename,
} from '../utils/upload'

const router = Router()

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
}

// Whitelist of ref_type -> table it must exist in, scoped by tenant_id. Kept
// in sync with the CHECK(ref_type IN (...)) constraint in schema.ts.
const REF_TYPE_TABLES: Record<string, string> = {
  RECEIPT: 'receipts',
  SUPPLIER_PAYMENT: 'supplier_payments',
  POS_PAYMENT: 'pos_payments',
  INVOICE: 'invoices',
}

// Which subscription feature gates each ref_type. Mount in index.ts is gate-free
// (authenticate only) because a single static feature there would lock out e.g.
// purchase-only tenants from attaching supplier payment slips (see index.ts).
const REF_TYPE_FEATURE: Record<string, string> = {
  RECEIPT: 'sales',
  INVOICE: 'sales',
  SUPPLIER_PAYMENT: 'purchase',
  POS_PAYMENT: 'pos',
}

// Mirrors subscriptionGate() in middleware/subscription.middleware.ts, but the
// feature isn't known until we've looked at the ref_type (from the URL, or from
// the attachment row for the id-only routes below). Sends the response itself
// and returns false when access is denied — caller must `return` immediately.
function checkFeature(req: Request, res: Response, feature: string): boolean {
  const user = req.user!
  if (user.role === 'MASTER') return true
  const sub = getSubscription(user.tenantId)
  if (sub.status === 'EXPIRED' || sub.status === 'CANCELLED') {
    if (user.role !== 'ADMIN') {
      res.status(402).json({ success: false, code: 'SUBSCRIPTION_EXPIRED', message: 'แพ็กเกจหมดอายุ กรุณาติดต่อผู้ดูแลบริษัทเพื่อต่ออายุ' })
      return false
    }
  }
  if (sub.status !== 'NONE' && !sub.features.includes(feature)) {
    res.status(403).json({ success: false, code: 'FEATURE_LOCKED', feature, plan: sub.planCode, message: `ฟีเจอร์นี้ไม่รวมในแพ็กเกจ ${sub.planName} กรุณาอัปเกรดแพ็กเกจ` })
    return false
  }
  return true
}

// Phase 2a: payment_attachments is the second source table — invoice_attachments
// stays wired for Sales.tsx's dedicated endpoint (sales/invoiceAttachments.routes.ts).
// Both tables share the same on-disk directory (storage/payment-attachments).
// invoice_attachments has no ref_type column of its own — every row there is
// conceptually an INVOICE attachment, so refType is hardcoded per-source instead.
const ATTACHMENT_SOURCES: { table: string; dir: string; refType?: string }[] = [
  { table: 'invoice_attachments', dir: invoiceUploadDir, refType: 'INVOICE' },
  { table: 'payment_attachments', dir: invoiceUploadDir },
]

function findAttachment(id: string, tenantId: string): { file_path: string; original_name: string; dir: string; refType: string } | null {
  for (const src of ATTACHMENT_SOURCES) {
    const cols = src.refType ? 'file_path, original_name' : 'file_path, original_name, ref_type'
    const row = db.prepare(`SELECT ${cols} FROM ${src.table} WHERE id = ? AND tenant_id = ?`)
      .get(id, tenantId) as { file_path: string; original_name: string; ref_type?: string } | undefined
    if (row) return { file_path: row.file_path, original_name: row.original_name, dir: src.dir, refType: src.refType || row.ref_type! }
  }
  return null
}

// GET /api/attachments/:id/file — auth-gated replacement for the old public
// /uploads/invoice-attachments static path. Payment slips carry bank account
// numbers + account holder names, so they're served only to the owning tenant.
// Registered before the generic '/:refType/:refId' routes below so a request
// like GET /xxx/file is never swallowed by the two-param pattern.
router.get('/:id/file', (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId
  const att = findAttachment(req.params.id, tenantId)
  // Wrong tenant and "doesn't exist" both 404 — never confirm a file exists
  // for an id the caller isn't allowed to see.
  if (!att) {
    res.status(404).json({ success: false, message: 'Not found' })
    return
  }
  if (!checkFeature(req, res, REF_TYPE_FEATURE[att.refType])) return

  const dir = path.resolve(att.dir)
  const filePath = path.resolve(dir, att.file_path)
  // file_path is our own multer-generated filename (no path separators), but
  // resolve+prefix-check anyway so a future source table can't be tricked by
  // a '../' value into serving something outside its storage dir.
  if (!filePath.startsWith(dir + path.sep) || !fs.existsSync(filePath)) {
    res.status(404).json({ success: false, message: 'Not found' })
    return
  }

  const mime = MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
  res.setHeader('Content-Type', mime)
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(att.original_name || path.basename(filePath))}"`)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  fs.createReadStream(filePath).pipe(res)
})

// ─── Phase 2a: unified payment_attachments API ─────────────────────────────
// (REF_TYPE_TABLES / REF_TYPE_FEATURE / checkFeature are defined up top, next
// to findAttachment, since GET /:id/file above needs them too.)

function refExists(refType: string, refId: string, tenantId: string): boolean {
  const table = REF_TYPE_TABLES[refType]
  if (!table) return false
  const row = db.prepare(`SELECT id FROM ${table} WHERE id = ? AND tenant_id = ?`).get(refId, tenantId)
  return !!row
}

// Phase 3: bulk evidence-count endpoint for Accounting > JournalEntries — avoids
// firing one /attachments/:refType/:refId request per journal row (N+1 the UI
// used to have no way around). Accepts either native attachment ref types
// (RECEIPT/SUPPLIER_PAYMENT/POS_PAYMENT/INVOICE) or journal reference_type
// values (PAYMENT/INVOICE/SUPPLIER_PAYMENT/POS_SALE) — the latter get mapped
// to the attachment-table refs that actually carry the evidence, confirmed
// against real reference_id linkage in journal.routes.ts callers, not guessed:
//   PAYMENT (journal)          -> receipts.id            (createSalesJournal 'RECEIPT' branch)
//   SUPPLIER_PAYMENT (journal) -> supplier_payments.id    (same id/name as attachment ref_type)
//   INVOICE (journal)          -> invoices.id + all receipts.id where invoice_id = that invoice
//   POS_SALE (journal)         -> pos_running_bills.id, resolved to pos_payments.id via bill_id
// Response is keyed by whatever token the caller sent, so both native and
// journal-style callers get counts back under the same key they passed in.
const MAX_COUNT_REFS = 300

router.get('/counts', (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId
  const raw = String(req.query.refs || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, MAX_COUNT_REFS)

  type Pair = { refType: string; refId: string }
  const keyToRefs = new Map<string, Pair[]>()
  const needInvoiceReceipts: { key: string; invoiceId: string }[] = []
  const needPosPayment: { key: string; billId: string }[] = []

  for (const token of raw) {
    const idx = token.indexOf(':')
    if (idx < 1) continue
    const type = token.slice(0, idx)
    const id = token.slice(idx + 1)
    if (!id) continue

    const refs: Pair[] = []
    if (type === 'PAYMENT') {
      refs.push({ refType: 'RECEIPT', refId: id })
    } else if (REF_TYPE_TABLES[type]) {
      refs.push({ refType: type, refId: id })
    }
    if (type === 'INVOICE') needInvoiceReceipts.push({ key: token, invoiceId: id })
    if (type === 'POS_SALE') needPosPayment.push({ key: token, billId: id })

    if (refs.length || type === 'INVOICE' || type === 'POS_SALE') keyToRefs.set(token, refs)
  }

  // Resolve INVOICE -> its receipts (the evidence of payment received lives on
  // the receipt, not just the invoice) in one bulk query.
  if (needInvoiceReceipts.length) {
    const ids = [...new Set(needInvoiceReceipts.map(x => x.invoiceId))]
    const rows = db.prepare(
      `SELECT id, invoice_id FROM receipts WHERE tenant_id = ? AND invoice_id IN (${ids.map(() => '?').join(',')})`
    ).all(tenantId, ...ids) as { id: string; invoice_id: string }[]
    const byInvoice = new Map<string, string[]>()
    for (const r of rows) {
      const arr = byInvoice.get(r.invoice_id) || []
      arr.push(r.id)
      byInvoice.set(r.invoice_id, arr)
    }
    for (const { key, invoiceId } of needInvoiceReceipts) {
      const arr = keyToRefs.get(key)!
      for (const rid of byInvoice.get(invoiceId) || []) arr.push({ refType: 'RECEIPT', refId: rid })
    }
  }

  // Resolve POS_SALE (journal reference_id = pos_running_bills.id) -> the
  // pos_payments row attachments actually key off.
  if (needPosPayment.length) {
    const ids = [...new Set(needPosPayment.map(x => x.billId))]
    const rows = db.prepare(
      `SELECT id, bill_id FROM pos_payments WHERE tenant_id = ? AND bill_id IN (${ids.map(() => '?').join(',')})`
    ).all(tenantId, ...ids) as { id: string; bill_id: string }[]
    const byBill = new Map<string, string[]>()
    for (const r of rows) {
      const arr = byBill.get(r.bill_id) || []
      arr.push(r.id)
      byBill.set(r.bill_id, arr)
    }
    for (const { key, billId } of needPosPayment) {
      const arr = keyToRefs.get(key)!
      for (const pid of byBill.get(billId) || []) arr.push({ refType: 'POS_PAYMENT', refId: pid })
    }
  }

  // Single bulk count across all resolved (refType, refId) pairs — one query
  // per source table, never a query per ref.
  const allPairs: Pair[] = []
  for (const arr of keyToRefs.values()) allPairs.push(...arr)
  const countByPair = new Map<string, number>()

  if (allPairs.length) {
    const refTypes = [...new Set(allPairs.map(p => p.refType))]
    const refIds = [...new Set(allPairs.map(p => p.refId))]
    const rows = db.prepare(
      `SELECT ref_type, ref_id, COUNT(*) as cnt FROM payment_attachments
       WHERE tenant_id = ? AND ref_type IN (${refTypes.map(() => '?').join(',')}) AND ref_id IN (${refIds.map(() => '?').join(',')})
       GROUP BY ref_type, ref_id`
    ).all(tenantId, ...refTypes, ...refIds) as { ref_type: string; ref_id: string; cnt: number }[]
    const wanted = new Set(allPairs.map(p => `${p.refType} ${p.refId}`))
    for (const r of rows) {
      const k = `${r.ref_type} ${r.ref_id}`
      if (wanted.has(k)) countByPair.set(k, (countByPair.get(k) || 0) + r.cnt)
    }

    // invoice_attachments has no ref_type column — every row there is an INVOICE ref.
    const invoiceIds = [...new Set(allPairs.filter(p => p.refType === 'INVOICE').map(p => p.refId))]
    if (invoiceIds.length) {
      const invRows = db.prepare(
        `SELECT invoice_id, COUNT(*) as cnt FROM invoice_attachments WHERE tenant_id = ? AND invoice_id IN (${invoiceIds.map(() => '?').join(',')}) GROUP BY invoice_id`
      ).all(tenantId, ...invoiceIds) as { invoice_id: string; cnt: number }[]
      for (const r of invRows) {
        const k = `INVOICE ${r.invoice_id}`
        countByPair.set(k, (countByPair.get(k) || 0) + r.cnt)
      }
    }
  }

  const result: Record<string, number> = {}
  for (const [key, refs] of keyToRefs.entries()) {
    let total = 0
    for (const p of refs) total += countByPair.get(`${p.refType} ${p.refId}`) || 0
    if (total > 0) result[key] = total
  }

  res.json({ success: true, data: result })
})


const paymentAttachmentStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, invoiceUploadDir),
  filename: (req, file, cb) => {
    const ext = getSafeAttachmentExtension(file.originalname) || '.jpg'
    // refType/refId are validated against REF_TYPE_TABLES + refExists() before
    // multer ever runs (see route below), but strip anything non-alphanumeric
    // here too as defense-in-depth against the filename escaping the upload dir.
    const safeRefType = String(req.params.refType || '').replace(/[^a-zA-Z0-9_-]/g, '')
    const safeRefId = String(req.params.refId || '').replace(/[^a-zA-Z0-9_-]/g, '')
    cb(null, `pay-${safeRefType}-${safeRefId}-${Date.now()}${ext}`)
  },
})

const paymentAttachmentUpload = multer({
  storage: paymentAttachmentStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (isAllowedAttachmentExt(ext) && isAllowedAttachmentMimetype(file.mimetype)) cb(null, true)
    else cb(new Error('Only image or PDF files allowed'))
  },
})

// POST /api/attachments/:refType/:refId — upload evidence for one document.
// multipart/form-data, file field name "file". 404s (not 400/403) if refId
// doesn't exist for this tenant, so attachments can never be attached to a
// dangling/foreign id.
router.post('/:refType/:refId', (req: Request, res: Response, next: any) => {
  const { refType } = req.params
  const feature = REF_TYPE_FEATURE[refType]
  if (!feature) {
    res.status(404).json({ success: false, message: 'Not found' })
    return
  }
  if (!checkFeature(req, res, feature)) return
  next()
}, (req: Request, res: Response, next: any) => {
  const tenantId = req.user!.tenantId
  const { refType, refId } = req.params
  if (!refExists(refType, refId, tenantId)) {
    res.status(404).json({ success: false, message: 'Not found' })
    return
  }
  next()
}, (req: Request, res: Response, next: any) => {
  paymentAttachmentUpload.single('file')(req, res, (err: any) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ success: false, message: 'ไฟล์ใหญ่เกินไป (สูงสุด 10MB)' })
    if (err) return res.status(400).json({ success: false, message: err.message })
    next()
  })
}, (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { refType, refId } = req.params
    const file = req.file
    if (!file) return res.status(400).json({ success: false, message: 'ไม่พบไฟล์' })

    const fullPath = path.join(invoiceUploadDir, file.filename)
    if (!isValidAttachmentFile(fullPath)) {
      try { fs.unlinkSync(fullPath) } catch { /* ignore */ }
      return res.status(400).json({ success: false, message: 'Invalid file' })
    }

    const attachmentId = generateId()
    const now = new Date().toISOString()
    const safeOriginalName = sanitizeFilename(file.originalname)
    db.prepare(`INSERT INTO payment_attachments (id, tenant_id, ref_type, ref_id, file_path, original_name, file_size, uploaded_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(attachmentId, tenantId, refType, refId, file.filename, safeOriginalName, file.size, req.user!.userId, now)

    res.json({
      success: true,
      data: { id: attachmentId, ref_type: refType, ref_id: refId, file_path: file.filename, original_name: safeOriginalName, file_size: file.size, created_at: now },
    })
  } catch (error) {
    console.error('Upload payment attachment error:', error)
    res.status(500).json({ success: false, message: 'Upload failed' })
  }
})

// GET /api/attachments/:refType/:refId — list attachments for one document.
// Registered after GET /:id/file above so ".../file" requests keep matching
// the more specific route first.
router.get('/:refType/:refId', (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId
  const { refType, refId } = req.params
  if (!REF_TYPE_TABLES[refType]) {
    res.status(404).json({ success: false, message: 'Not found' })
    return
  }
  if (!checkFeature(req, res, REF_TYPE_FEATURE[refType])) return
  const rows = db.prepare(
    `SELECT id, ref_type, ref_id, original_name, file_size, uploaded_by, created_at
     FROM payment_attachments WHERE tenant_id = ? AND ref_type = ? AND ref_id = ? ORDER BY created_at ASC`
  ).all(tenantId, refType, refId)
  res.json({ success: true, data: rows })
})

// DELETE /api/attachments/:id — works across both source tables (whichever
// one holds this id for the caller's tenant), mirroring findAttachment() above.
router.delete('/:id', (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId
  const { id } = req.params
  for (const src of ATTACHMENT_SOURCES) {
    const cols = src.refType ? 'file_path' : 'file_path, ref_type'
    const row = db.prepare(`SELECT ${cols} FROM ${src.table} WHERE id = ? AND tenant_id = ?`)
      .get(id, tenantId) as { file_path: string; ref_type?: string } | undefined
    if (row) {
      const refType = src.refType || row.ref_type!
      if (!checkFeature(req, res, REF_TYPE_FEATURE[refType])) return
      const dir = path.resolve(src.dir)
      const filePath = path.resolve(dir, row.file_path)
      if (filePath.startsWith(dir + path.sep) && fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath) } catch { /* ignore */ }
      }
      db.prepare(`DELETE FROM ${src.table} WHERE id = ? AND tenant_id = ?`).run(id, tenantId)
      res.json({ success: true })
      return
    }
  }
  res.status(404).json({ success: false, message: 'Not found' })
})

export default router
