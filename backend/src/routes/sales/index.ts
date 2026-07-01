import { Router } from 'express'
import { authenticate } from '../../middleware/auth.middleware'

// Re-export shared sales helpers so consumers can import from the sales module root.
export {
  invoiceUpload,
  invoiceUploadDir,
  createSalesJournal,
  deductStockForSO,
  getOrCreateAccount,
  updateAccountBalance,
  isValidImageFile,
  sanitizeFilename,
} from './shared'

// Domain routers
import quotationsRouter from './quotations'
import salesOrdersRouter from './salesOrders'
import deliveryOrdersRouter from './deliveryOrders'
import invoicesRouter from './invoices'
import receiptsRouter from './receipts'
import creditNotesRouter from './creditNotes'
import templatesRouter from './templates'

// Kept as-is sibling routers
import backordersRouter from './backorders.routes'
import productVariantsRouter from './productVariants.routes'
import posRouter from './pos.routes'
import summaryRouter from './summary.routes'
import invoiceAttachmentsRouter from './invoiceAttachments.routes'

const router = Router()

router.use(authenticate)

router.use('/quotations', quotationsRouter)
router.use('/sales-orders', salesOrdersRouter)
router.use('/delivery-orders', deliveryOrdersRouter)
router.use('/backorders', backordersRouter)
router.use('/invoices', invoicesRouter)
router.use('/credit-notes', creditNotesRouter)
router.use('/receipts', receiptsRouter)
router.use('/product-variants', productVariantsRouter)
router.use('/quotation-templates', templatesRouter)
router.use('/', posRouter)
router.use('/summary', summaryRouter)
router.use('/invoices', invoiceAttachmentsRouter)

export default router
