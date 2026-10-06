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
  /** โหมด VAT ล่าสุดที่ใช้กับลูกค้ารายนี้ — backend อัปเดตอัตโนมัติจากเอกสารล่าสุด, แก้มือได้ที่ฟอร์มลูกค้า */
  vat_mode?: 'NONE' | 'INCLUSIVE' | 'EXCLUSIVE' | null
  /** แคมเปญของลูกค้ารายนี้ — ใบเสนอราคาใหม่ใช้เป็นค่าเริ่มต้นถ้าไม่ระบุเอง */
  campaign?: string | null
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
  /** แถวนี้คือ "ชื่อเรียกแทน" ของสินค้า id เดียวกัน (ชื่อ SKU จริง) — ไม่มี = สินค้าจริง */
  alias_of?: string
  /** หน่วยที่ผูกกับชื่อเรียกแทน + จำนวนหน่วยฐานต่อ 1 หน่วยนั้น (เช่น แพ็ค = 15 ขวด) */
  alias_unit?: string
  alias_factor?: number
}

/** ชื่อเรียกแทน SKU จาก GET /stock/aliases — ปิดฟีเจอร์ที่ ตั้งค่า = backend คืนว่าง (ไม่ต้องเช็คเอง) */
export interface StockAlias {
  id: string
  name: string
  stock_item_id: string
  stock_item_name: string
  /** หน่วยที่ผูก (normalize แล้ว) + จำนวนหน่วยฐานต่อ 1 หน่วยนั้น — ไม่ผูก = undefined */
  unit?: string
  factor?: number
}

/** ใช้ร่วมกันทั้งหน้าขาย (Sales) และหน้าซื้อ (Purchase) · โหลดไม่ได้ = ไม่มีชื่อเรียกแทน (ไม่บล็อกหน้า) */
export async function fetchStockAliases(): Promise<StockAlias[]> {
  try {
    const { data } = await api.get('/stock/aliases')
    return (data?.data || []).map((a: any) => ({
      id: a.id, name: a.name, stock_item_id: a.stock_item_id, stock_item_name: a.stock_item_name,
      unit: a.unit && Number(a.factor) > 0 ? normalizeUnit(a.unit) : undefined,
      factor: a.unit && Number(a.factor) > 0 ? Number(a.factor) : undefined,
    }))
  } catch {
    return []
  }
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
  vatInclusive?: boolean
  extraChargeAmount?: number
  extraChargeLabel?: string
  discountAmount?: number
  notes?: string
  /** แคมเปญที่ผูกดีลนี้ไว้ — ไม่ส่งมา = backend เอาแคมเปญของลูกค้าเป็นค่าเริ่มต้นให้ */
  campaign?: string
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
  searchCustomers: async (q: string): Promise<Customer[]> => {
    const { data } = await api.get(`/customers/search?q=${encodeURIComponent(q)}&limit=20`)
    return data.data || []
  },

  createCustomer: async (payload: {
    code: string; name: string; type: string
    contactName: string; phone: string; email?: string
    vatMode?: 'NONE' | 'INCLUSIVE' | 'EXCLUSIVE' | null
  }): Promise<Customer> => {
    const { data } = await api.post('/customers', payload)
    return data.data
  },

  // Products (stock_items with sell price) — เฉพาะที่ขายได้ (FINISHED/WIP/SERVICE) ไม่ใช่วัตถุดิบ
  // + ชื่อเรียกแทน SKU (ต่อท้าย สินค้าจริงมาก่อนเสมอ — find ตาม id จะได้ตัวจริง) ปิดฟีเจอร์ = backend คืนว่าง
  getProducts: async (): Promise<Product[]> => {
    const [{ data }, aliasRows] = await Promise.all([
      api.get('/stock?limit=500&sellable=1'),
      fetchStockAliases(),
    ])
    const products: Product[] = (data.data || []).map((p: any) => ({
      id: p.id,
      code: p.sku || p.code,
      name: p.name,
      unit: normalizeUnit(p.unit),
      base_unit: p.base_unit ? normalizeUnit(p.base_unit) : undefined,
      sale_unit: p.sale_unit ? normalizeUnit(p.sale_unit) : undefined,
      sell_price: p.unit_price || p.unitCost || 0,
    }))
    const byId = new Map(products.map(p => [p.id, p]))
    const aliases: Product[] = aliasRows
      .filter(a => byId.has(a.stock_item_id)) // เฉพาะปลายทางที่ขายได้ (อยู่ในรายการด้านบน)
      .map(a => ({
        ...byId.get(a.stock_item_id)!,
        name: a.name,
        alias_of: a.stock_item_name,
        alias_unit: a.unit,
        alias_factor: a.factor,
      }))
    return [...products, ...aliases]
  },

  // Quotations
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
  createCreditNote: async (payload: {
    invoiceId: string; reason: string; creditDate?: string
    /** ระบุเมื่อโหมด "รับคืนสินค้า" เท่านั้น — ไม่ส่ง = โหมด "ลดราคา/ส่วนลด" (ไม่แตะสต็อก) */
    items?: { invoiceItemId: string; productId?: string; quantity: number; unitPrice: number; reason?: string }[]
  }) => {
    const { data } = await api.post('/sales/credit-notes', payload)
    return data
  },
}

export default salesService
