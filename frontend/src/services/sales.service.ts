import api from './api'
import { normalizeUnit } from '../utils/unitNormalize'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Customer {
  id: string
  code: string
  name: string
  phone?: string
  email?: string
  address?: string
}

export interface Product {
  id: string
  code: string
  name: string
  unit?: string
  /** หน่วยฐาน/หน่วยสต็อกจริงของสินค้า (stock_items.base_unit, fallback = unit) */
  base_unit?: string
  /** หน่วยที่ตั้งไว้ให้ขาย (stock_items.sale_unit) — ถ้ามี ให้ใช้เป็นค่าเริ่มต้นก่อน unit */
  sale_unit?: string
  sell_price?: number
}

export interface QuotationItem {
  productId?: string
  productName?: string
  quantity: number
  unitPrice: number
  discountPercent?: number
  notes?: string
}

export interface CreateQuotationPayload {
  customerId: string
  expiryDate?: string
  taxRate?: number
  discountAmount?: number
  notes?: string
  items: QuotationItem[]
}

export interface SOItem {
  productId?: string
  productName?: string
  quantity: number
  unitPrice: number
  discountPercent?: number
  quotationItemId?: string
  notes?: string
}

export interface CreateSOPayload {
  customerId: string
  quotationId?: string
  deliveryDate?: string
  taxRate?: number
  discountAmount?: number
  notes?: string
  items: SOItem[]
}

// ─── Service ──────────────────────────────────────────────────────────────────

const salesService = {
  // Customers
  getCustomers: async (): Promise<Customer[]> => {
    const { data } = await api.get('/customers?status=ACTIVE&limit=500')
    return data.data || []
  },

  searchCustomers: async (q: string): Promise<Customer[]> => {
    const { data } = await api.get(`/customers/search?q=${encodeURIComponent(q)}&limit=20`)
    return data.data || []
  },

  createCustomer: async (payload: {
    code: string; name: string; type: string
    contactName: string; phone: string; email?: string
  }): Promise<Customer> => {
    const { data } = await api.post('/customers', payload)
    return data.data
  },

  // Products (stock_items with sell price)
  getProducts: async (): Promise<Product[]> => {
    const { data } = await api.get('/stock?limit=500&is_pos_enabled=false')
    return (data.data || []).map((p: any) => ({
      id: p.id,
      code: p.sku || p.code,
      name: p.name,
      unit: normalizeUnit(p.unit),
      base_unit: p.base_unit ? normalizeUnit(p.base_unit) : undefined,
      sale_unit: p.sale_unit ? normalizeUnit(p.sale_unit) : undefined,
      sell_price: p.unit_price || p.unitCost || 0,
    }))
  },

  // Quotations
  getQuotations: async () => {
    const { data } = await api.get('/sales/quotations')
    return data
  },

  getQuotation: async (id: string) => {
    const { data } = await api.get(`/sales/quotations/${id}`)
    return data
  },

  createQuotation: async (payload: CreateQuotationPayload) => {
    const { data } = await api.post('/sales/quotations', payload)
    return data
  },

  updateQuotationStatus: async (id: string, status: string) => {
    const { data } = await api.put(`/sales/quotations/${id}/status`, { status })
    return data
  },

  updateQuotation: async (id: string, payload: CreateQuotationPayload) => {
    const { data } = await api.put(`/sales/quotations/${id}`, payload)
    return data
  },

  // Sales Orders
  getSalesOrders: async () => {
    const { data } = await api.get('/sales/sales-orders')
    return data
  },

  getSalesOrder: async (id: string) => {
    const { data } = await api.get(`/sales/sales-orders/${id}`)
    return data
  },

  createSalesOrder: async (payload: CreateSOPayload) => {
    const { data } = await api.post('/sales/sales-orders', payload)
    return data
  },

  updateSOStatus: async (id: string, status: string) => {
    const { data } = await api.put(`/sales/sales-orders/${id}/status`, { status })
    return data
  },

  updateSalesOrder: async (id: string, payload: CreateSOPayload) => {
    const { data } = await api.put(`/sales/sales-orders/${id}`, payload)
    return data
  },

  // Invoices
  getInvoices: async () => {
    const { data } = await api.get('/sales/invoices')
    return data
  },

  getInvoice: async (id: string) => {
    const { data } = await api.get(`/sales/invoices/${id}`)
    return data
  },

  createInvoice: async (salesOrderId: string, dueDate?: string, notes?: string) => {
    const { data } = await api.post('/sales/invoices', { salesOrderId, dueDate, notes })
    return data
  },

  recordPayment: async (invoiceId: string, payload: {
    amount: number
    paymentMethod: string
    receiptDate: string
    paymentReference?: string
    notes?: string
  }) => {
    const { data } = await api.post('/sales/receipts', { invoiceId, ...payload })
    return data
  },

  // Credit Notes
  getCreditNotes: async () => {
    const { data } = await api.get('/sales/credit-notes')
    return data
  },

  getCreditNote: async (id: string) => {
    const { data } = await api.get(`/sales/credit-notes/${id}`)
    return data
  },

  createCreditNote: async (payload: {
    invoiceId: string; reason: string; creditDate?: string
    /** ระบุเมื่อโหมด "รับคืนสินค้า" เท่านั้น — ไม่ส่ง = โหมด "ลดราคา/ส่วนลด" (ไม่แตะสต็อก) */
    items?: { invoiceItemId: string; productId?: string; quantity: number; unitPrice: number; reason?: string }[]
  }) => {
    const { data } = await api.post('/sales/credit-notes', payload)
    return data
  },

  updateCreditNoteStatus: async (id: string, status: string) => {
    const { data } = await api.put(`/sales/credit-notes/${id}/status`, { status })
    return data
  },

  // Backorders
  getBackorders: async () => {
    const { data } = await api.get('/sales/backorders')
    return data
  },

  getBackorder: async (id: string) => {
    const { data } = await api.get(`/sales/backorders/${id}`)
    return data
  },

  updateBackorderStatus: async (id: string, status: string) => {
    const { data } = await api.put(`/sales/backorders/${id}/status`, { status })
    return data
  },
}

export default salesService
