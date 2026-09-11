import React, { createContext, useContext, useState, useCallback } from 'react'

// Types
export type BillType =
  // ฝั่งขาย
  | 'QUOTATION'
  | 'SALE'
  | 'INVOICE'
  | 'DELIVERY'
  | 'RECEIPT'
  | 'CREDIT_NOTE'
  // ฝั่งซื้อ
  | 'PURCHASE_REQUEST'
  | 'PURCHASE'
  | 'GOODS_RECEIPT'
  | 'PURCHASE_INVOICE'
  | 'PAYMENT'
  | 'PURCHASE_RETURN'
  // ผลิต
  | 'WORK_ORDER'

export interface BillConfig {
  type: BillType
  title: {
    th: string
    en: string
  }
  // รหัสย่อสำหรับ prefix เลขที่เอกสาร (qt/so/inv/dn/rc/cn/pr/po/gr/pi/payment/return/wo)
  docPrefix: string
  // กำหนดว่าฟิลด์ไหนโชว์/ซ่อน
  fields: {
    showBuyerCode: boolean
    showBuyerTaxId: boolean
    showRefNumber: boolean
    showDueDate: boolean
    showPaymentTerms: boolean
    showBankInfo: boolean
    showSignatures: boolean
    showQRCode: boolean
  }
  // กำหนด label ต่างๆ (buyer = คู่ค้าอีกฝั่งของเรา ไม่ว่าจะเป็นลูกค้าหรือผู้ขาย)
  labels: {
    buyer: string      // ลูกค้า / ผู้ขาย / แผนกผลิต
    buyerCode: string  // รหัสลูกค้า / รหัสผู้ขาย / รหัสใบสั่ง
    docNumber: string  // เลขที่ใบสั่งขาย / เลขที่ใบสั่งซื้อ / เลขที่ใบสั่งผลิต
    refNumber: string  // อ้างอิงใบเสนอราคา / อ้างอิงใบสั่งขาย / -
  }
  // สีประจำ type
  themeColor: string
  // ช่องเซ็นเริ่มต้น (ทับได้ด้วย settings.signatureSlots ที่ template รับมาจาก prop)
  defaultSignatureSlots: string[]
}

const SALES_SIGNATURE_SLOTS = ['ผู้ออกเอกสาร (ผู้ขาย)', 'ผู้อนุมัติ (ผู้ขาย)', 'ผู้รับเอกสาร (ลูกค้า)', 'ตราประทับ (ลูกค้า)']
const PURCHASE_SIGNATURE_SLOTS = ['ผู้ออกเอกสาร (ผู้ซื้อ)', 'ผู้อนุมัติ (ผู้ซื้อ)', 'ผู้ส่งเอกสาร (ผู้ขาย)', 'ตราประทับ (ผู้ขาย)']
const WORK_ORDER_SIGNATURE_SLOTS = ['ผู้สั่งผลิต', 'หัวหน้าฝ่ายผลิต', 'ผู้จ่ายวัตถุดิบ', 'QC ผู้ตรวจสอบ']

// Bill Configuration สำหรับแต่ละ type
export const BILL_CONFIGS: Record<BillType, BillConfig> = {
  // ══════════ ฝั่งขาย ══════════
  QUOTATION: {
    type: 'QUOTATION',
    title: { th: 'ใบเสนอราคา', en: 'QUOTATION' },
    docPrefix: 'QT',
    fields: {
      showBuyerCode: true,
      showBuyerTaxId: true,
      showRefNumber: false,
      showDueDate: true,      // วันที่หมดอายุใบเสนอราคา
      showPaymentTerms: true,
      showBankInfo: true,
      showSignatures: true,
      showQRCode: true,
    },
    labels: {
      buyer: 'ลูกค้า',
      buyerCode: 'รหัสลูกค้า',
      docNumber: 'เลขที่ใบเสนอราคา',
      refNumber: 'อ้างอิง',
    },
    themeColor: '#EC4899', // pink-500
    defaultSignatureSlots: SALES_SIGNATURE_SLOTS,
  },
  SALE: {
    type: 'SALE',
    title: { th: 'ใบสั่งขาย', en: 'SALES ORDER' },
    docPrefix: 'SO',
    fields: {
      showBuyerCode: true,
      showBuyerTaxId: true,
      showRefNumber: true,    // อ้างอิงใบเสนอราคา
      showDueDate: true,
      showPaymentTerms: true,
      showBankInfo: true,
      showSignatures: true,
      showQRCode: true,
    },
    labels: {
      buyer: 'ลูกค้า',
      buyerCode: 'รหัสลูกค้า',
      docNumber: 'เลขที่ใบสั่งขาย',
      refNumber: 'อ้างอิงใบเสนอราคา',
    },
    themeColor: '#3949E5', // phopy-indigo
    defaultSignatureSlots: SALES_SIGNATURE_SLOTS,
  },
  INVOICE: {
    type: 'INVOICE',
    title: { th: 'ใบแจ้งหนี้ / ใบกำกับภาษี', en: 'TAX INVOICE' },
    docPrefix: 'INV',
    fields: {
      showBuyerCode: true,
      showBuyerTaxId: true,   // บังคับตามกฎหมาย
      showRefNumber: true,    // อ้างอิงใบสั่งขาย
      showDueDate: true,      // ครบกำหนดชำระ
      showPaymentTerms: true,
      showBankInfo: true,
      showSignatures: true,
      showQRCode: true,
    },
    labels: {
      buyer: 'ลูกค้า',
      buyerCode: 'รหัสลูกค้า',
      docNumber: 'เลขที่ใบแจ้งหนี้',
      refNumber: 'อ้างอิงใบสั่งขาย',
    },
    themeColor: '#c2410c', // orange-700 — ตรงกับ mockup
    defaultSignatureSlots: SALES_SIGNATURE_SLOTS,
  },
  DELIVERY: {
    type: 'DELIVERY',
    title: { th: 'ใบส่งของ', en: 'DELIVERY ORDER' },
    docPrefix: 'DN',
    fields: {
      showBuyerCode: true,
      showBuyerTaxId: false,
      showRefNumber: true,    // อ้างอิงใบสั่งขาย
      showDueDate: false,
      showPaymentTerms: false,
      showBankInfo: false,
      showSignatures: true,
      showQRCode: true,
    },
    labels: {
      buyer: 'ลูกค้า',
      buyerCode: 'รหัสลูกค้า',
      docNumber: 'เลขที่ใบส่งของ',
      refNumber: 'อ้างอิงใบสั่งขาย',
    },
    themeColor: '#0066ff', // phopy-indigo-600
    defaultSignatureSlots: SALES_SIGNATURE_SLOTS,
  },
  RECEIPT: {
    type: 'RECEIPT',
    title: { th: 'ใบเสร็จรับเงิน', en: 'RECEIPT' },
    docPrefix: 'RC',
    fields: {
      showBuyerCode: true,
      showBuyerTaxId: true,   // ใบเสร็จ/ใบกำกับภาษีอย่างย่อ
      showRefNumber: true,    // อ้างอิงใบแจ้งหนี้
      showDueDate: false,
      showPaymentTerms: false,
      showBankInfo: true,
      showSignatures: true,
      showQRCode: true,
    },
    labels: {
      buyer: 'ลูกค้า',
      buyerCode: 'รหัสลูกค้า',
      docNumber: 'เลขที่ใบเสร็จ',
      refNumber: 'อ้างอิงใบแจ้งหนี้',
    },
    themeColor: '#047857', // emerald-700 — ตรงกับ mockup accent-rc
    defaultSignatureSlots: SALES_SIGNATURE_SLOTS,
  },
  CREDIT_NOTE: {
    type: 'CREDIT_NOTE',
    title: { th: 'ใบลดหนี้', en: 'CREDIT NOTE' },
    docPrefix: 'CN',
    fields: {
      showBuyerCode: true,
      showBuyerTaxId: true,   // บังคับตามกฎหมาย
      showRefNumber: true,    // อ้างอิงใบแจ้งหนี้เดิม
      showDueDate: false,
      showPaymentTerms: false,
      showBankInfo: true,
      showSignatures: true,
      showQRCode: false,
    },
    labels: {
      buyer: 'ลูกค้า',
      buyerCode: 'รหัสลูกค้า',
      docNumber: 'เลขที่ใบลดหนี้',
      refNumber: 'อ้างอิงใบแจ้งหนี้',
    },
    themeColor: '#DC2626', // red-600
    defaultSignatureSlots: SALES_SIGNATURE_SLOTS,
  },

  // ══════════ ฝั่งซื้อ ══════════
  PURCHASE_REQUEST: {
    type: 'PURCHASE_REQUEST',
    title: { th: 'ใบขอซื้อ', en: 'PURCHASE REQUEST' },
    docPrefix: 'PR',
    fields: {
      showBuyerCode: false,
      showBuyerTaxId: false,
      showRefNumber: false,
      showDueDate: true,      // ต้องการภายในวันที่
      showPaymentTerms: false,
      showBankInfo: false,
      showSignatures: true,   // สาย approve
      showQRCode: false,
    },
    labels: {
      buyer: 'แผนก/ผู้ขอซื้อ',
      buyerCode: 'รหัสแผนก',
      docNumber: 'เลขที่ใบขอซื้อ',
      refNumber: 'อ้างอิง',
    },
    themeColor: '#7C3AED', // violet-600
    defaultSignatureSlots: PURCHASE_SIGNATURE_SLOTS,
  },
  PURCHASE: {
    type: 'PURCHASE',
    title: { th: 'ใบสั่งซื้อ', en: 'PURCHASE ORDER' },
    docPrefix: 'PO',
    fields: {
      showBuyerCode: true,
      showBuyerTaxId: true,
      showRefNumber: true,    // อ้างอิงใบขอซื้อ
      showDueDate: true,
      showPaymentTerms: true,
      showBankInfo: false,    // ซื้อไม่ต้องโชว์บัญชีตัวเอง
      showSignatures: true,
      showQRCode: false,
    },
    labels: {
      buyer: 'ผู้ขาย',
      buyerCode: 'รหัสผู้ขาย',
      docNumber: 'เลขที่ใบสั่งซื้อ',
      refNumber: 'อ้างอิงใบขอซื้อ',
    },
    themeColor: '#9333EA', // purple-500
    defaultSignatureSlots: PURCHASE_SIGNATURE_SLOTS,
  },
  GOODS_RECEIPT: {
    type: 'GOODS_RECEIPT',
    title: { th: 'ใบรับสินค้า', en: 'GOODS RECEIPT' },
    docPrefix: 'GR',
    fields: {
      showBuyerCode: true,
      showBuyerTaxId: false,
      showRefNumber: true,    // อ้างอิงใบสั่งซื้อ
      showDueDate: false,
      showPaymentTerms: false,
      showBankInfo: false,
      showSignatures: true,
      showQRCode: true,
    },
    labels: {
      buyer: 'ผู้ขาย',
      buyerCode: 'รหัสผู้ขาย',
      docNumber: 'เลขที่ใบรับสินค้า',
      refNumber: 'อ้างอิงใบสั่งซื้อ',
    },
    themeColor: '#0D9488', // teal-600
    defaultSignatureSlots: PURCHASE_SIGNATURE_SLOTS,
  },
  PURCHASE_INVOICE: {
    type: 'PURCHASE_INVOICE',
    title: { th: 'ใบกำกับภาษีซื้อ', en: 'PURCHASE INVOICE' },
    docPrefix: 'PI',
    fields: {
      showBuyerCode: true,
      showBuyerTaxId: true,   // ใช้เครดิตภาษีซื้อ ต้องมีเลขผู้ขาย
      showRefNumber: true,    // อ้างอิงใบสั่งซื้อ/ใบรับสินค้า
      showDueDate: true,
      showPaymentTerms: true,
      showBankInfo: false,
      showSignatures: true,
      showQRCode: false,
    },
    labels: {
      buyer: 'ผู้ขาย',
      buyerCode: 'รหัสผู้ขาย',
      docNumber: 'เลขที่ใบกำกับภาษีซื้อ',
      refNumber: 'อ้างอิงใบสั่งซื้อ',
    },
    themeColor: '#B45309', // amber-700
    defaultSignatureSlots: PURCHASE_SIGNATURE_SLOTS,
  },
  PAYMENT: {
    type: 'PAYMENT',
    title: { th: 'ใบสำคัญจ่าย', en: 'PAYMENT VOUCHER' },
    docPrefix: 'PAYMENT',
    fields: {
      showBuyerCode: true,
      showBuyerTaxId: true,
      showRefNumber: true,    // อ้างอิงใบกำกับภาษีซื้อ
      showDueDate: false,
      showPaymentTerms: false,
      showBankInfo: true,     // บันทึกว่าจ่ายผ่านบัญชีไหน
      showSignatures: true,
      showQRCode: false,
    },
    labels: {
      buyer: 'ผู้ขาย',
      buyerCode: 'รหัสผู้ขาย',
      docNumber: 'เลขที่ใบสำคัญจ่าย',
      refNumber: 'อ้างอิงใบกำกับภาษีซื้อ',
    },
    themeColor: '#059669', // emerald-600
    defaultSignatureSlots: PURCHASE_SIGNATURE_SLOTS,
  },
  PURCHASE_RETURN: {
    type: 'PURCHASE_RETURN',
    title: { th: 'ใบคืนสินค้า (ซื้อ)', en: 'PURCHASE RETURN' },
    docPrefix: 'RETURN',
    fields: {
      showBuyerCode: true,
      showBuyerTaxId: true,
      showRefNumber: true,    // อ้างอิงใบสั่งซื้อ/ใบรับสินค้า
      showDueDate: false,
      showPaymentTerms: false,
      showBankInfo: false,
      showSignatures: true,
      showQRCode: false,
    },
    labels: {
      buyer: 'ผู้ขาย',
      buyerCode: 'รหัสผู้ขาย',
      docNumber: 'เลขที่ใบคืนสินค้า',
      refNumber: 'อ้างอิงใบรับสินค้า',
    },
    themeColor: '#B91C1C', // red-700
    defaultSignatureSlots: PURCHASE_SIGNATURE_SLOTS,
  },

  // ══════════ ผลิต ══════════
  WORK_ORDER: {
    type: 'WORK_ORDER',
    title: { th: 'ใบสั่งผลิต', en: 'WORK ORDER' },
    docPrefix: 'WO',
    fields: {
      showBuyerCode: false,
      showBuyerTaxId: false,
      showRefNumber: true,
      showDueDate: true,
      showPaymentTerms: false,
      showBankInfo: false,
      showSignatures: true,
      showQRCode: false,
    },
    labels: {
      buyer: 'แผนกผลิต / ผู้รับผิดชอบ',
      buyerCode: 'รหัสแผนก',
      docNumber: 'เลขที่ใบสั่งผลิต',
      refNumber: 'อ้างอิงใบสั่งขาย',
    },
    themeColor: '#F59E0B', // amber — production docs
    defaultSignatureSlots: WORK_ORDER_SIGNATURE_SLOTS,
  },
}

// Bill Data Interface
export interface BillItem {
  id: string
  no: number
  name: string
  description?: string
  sku?: string
  quantity: number
  unit: string
  price: number
  discount: number
  vat: number
  total: number
  // ป้ายอัตราหัก ณ ที่จ่ายต่อรายการ เช่น "ไม่มี", "3%"
  whtLabel?: string
  // สำหรับ work order
  materialId?: string
  bomId?: string
  stockQty?: number
  stockUnit?: string
  stockStatus?: 'ok' | 'short' | 'mismatch' | 'unknown'
  issuedQty?: number
}

export interface BillParty {
  code?: string
  name: string
  address?: string
  taxId?: string
  branch?: string
  contactName?: string
  tel?: string
  email?: string
}

export interface BillData {
  id: string
  docNumber: string
  docDate: string
  refNumber?: string
  refDate?: string

  // ผู้ขาย (เรา) - ดึงจาก company settings
  seller: BillParty

  // ผู้ซื้อ/ผู้ขาย/แผนก (คู่ค้า)
  buyer: BillParty

  // รายการ
  items: BillItem[]

  // สรุป
  subtotal: number
  discountTotal: number
  vatTotal: number
  whtTotal?: number
  total: number

  // การชำระเงิน
  paymentMethod?: string
  paymentTerms?: string
  dueDate?: string

  // บัญชีธนาคาร (สำหรับรับเงิน)
  bankName?: string
  bankAccountName?: string
  bankAccountNumber?: string
  bankAccountType?: string

  // เพิ่มเติม
  notes?: string
  qrCode?: string

  // สถานะ (WO เพิ่ม PLANNED | IN_PROGRESS | ON_HOLD)
  status: 'DRAFT' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'PLANNED' | 'IN_PROGRESS' | 'ON_HOLD'

  // Work Order specific fields
  woProductName?: string
  woQty?: number
  woCompletedQty?: number
  priority?: 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW'
  assignedTo?: string

  // Metadata
  createdBy: string
  createdAt: string
  approvedBy?: string
  approvedAt?: string
}

// Context Interface
interface BillContextType {
  config: BillConfig
  data: BillData | null
  loading: boolean
  error: string | null

  // Actions
  setBillType: (type: BillType) => void
  loadBillData: (type: BillType, id: string) => Promise<void>
  refreshData: () => Promise<void>

  // Print/Export
  printBill: () => void
  generatePDF: () => Promise<Blob | null>
  sendEmail: (email: string) => Promise<boolean>
}

const BillContext = createContext<BillContextType | undefined>(undefined)

// Provider
interface BillProviderProps {
  children: React.ReactNode
  initialType?: BillType
}

export function BillProvider({ children, initialType = 'SALE' }: BillProviderProps) {
  const [config, setConfig] = useState<BillConfig>(BILL_CONFIGS[initialType])
  const [data, setData] = useState<BillData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setBillType = useCallback((type: BillType) => {
    setConfig(BILL_CONFIGS[type])
  }, [])

  const loadBillData = useCallback(async (type: BillType, id: string) => {
    setLoading(true)
    setError(null)

    try {
      setConfig(BILL_CONFIGS[type])

      // TODO: เรียก API จริงตาม type เมื่อผูก route (ยังไม่ทำในเฟสนี้)
      // const response = await api.get(endpoint)
      // setData(transformResponseToBillData(response.data, type))

      // Mock data สำหรับทดสอบ
      await new Promise(resolve => setTimeout(resolve, 500))
      setData(getMockData(type, id))

    } catch (err: any) {
      setError(err.message || 'Failed to load bill data')
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshData = useCallback(async () => {
    if (data) {
      await loadBillData(config.type, data.id)
    }
  }, [config.type, data, loadBillData])

  const printBill = useCallback(() => {
    window.print()
  }, [])

  const generatePDF = useCallback(async () => {
    // TODO: Implement PDF generation
    console.log('Generating PDF...')
    return null
  }, [])

  const sendEmail = useCallback(async (email: string) => {
    // TODO: Implement email sending
    console.log('Sending email to:', email)
    return true
  }, [])

  return (
    <BillContext.Provider
      value={{
        config,
        data,
        loading,
        error,
        setBillType,
        loadBillData,
        refreshData,
        printBill,
        generatePDF,
        sendEmail,
      }}
    >
      {children}
    </BillContext.Provider>
  )
}

// Hook
export function useBill() {
  const context = useContext(BillContext)
  if (context === undefined) {
    throw new Error('useBill must be used within a BillProvider')
  }
  return context
}

// Mock Data Generator — ยังครอบคลุมแค่ type หลักที่ใช้งานจริงอยู่ก่อน
// type ที่เหลือจะ fallback ไปที่ SALE เป็นโครงตัวอย่าง (โครงสร้างเหมือนกันหมด ต่างแค่ config)
function getMockData(type: BillType, id: string): BillData {
  const configs: Partial<Record<BillType, Omit<BillData, 'id' | 'docNumber' | 'docDate' | 'status' | 'createdBy' | 'createdAt'>>> = {
    SALE: {
      seller: {
        name: 'ห้างหุ้นส่วนสำนักงาน เอฟแลนด์ปี้ เบดดิ้ง',
        address: 'เลขที่ 31 หมู่ 2 ตำบลหัววัว อำเภอเมือง จังหวัดสมุทรสาคร 74000',
        taxId: '0463565001158',
        branch: 'สำนักงานใหญ่',
        tel: '02-123-4567',
      },
      buyer: {
        code: 'C-50039',
        name: 'ร้านเพื่อนายพล',
        address: 'จังหวัดนครสวรรค์',
        contactName: 'ปริญา กุลเฉลย',
        tel: '096-269-3367',
        email: 'paweena096269@gmail.com',
      },
      items: [
        { id: '1', no: 1, name: 'ใยมะพร้าว', quantity: 50, unit: 'กก.', price: 120, discount: 0, vat: 0, total: 6000 },
        { id: '2', no: 2, name: 'Polyesters 3D×32', quantity: 50, unit: 'กก.', price: 60, discount: 0, vat: 0, total: 3000 },
      ],
      subtotal: 9000,
      discountTotal: 0,
      vatTotal: 0,
      total: 9000,
      paymentTerms: 'เครดิต 7 วัน',
      dueDate: '2026-01-17',
      bankName: 'ไทยพาณิชย์',
      bankAccountName: 'อลิษรัตน์ พี',
      bankAccountNumber: '7352438969',
    },
    PURCHASE: {
      seller: {
        name: 'ห้างหุ้นส่วนสำนักงาน เอฟแลนด์ปี้ เบดดิ้ง',
        address: 'เลขที่ 31 หมู่ 2 ตำบลหัววัว อำเภอเมือง จังหวัดสมุทรสาคร 74000',
        taxId: '0463565001158',
      },
      buyer: {
        code: 'SUP-001',
        name: 'บริษัท ผ้าทอไทย จำกัด',
        address: 'กรุงเทพฯ',
        taxId: '0123456789012',
        contactName: 'คุณสมชาย',
        tel: '02-987-6543',
      },
      items: [
        { id: '1', no: 1, name: 'ผ้าฝ้าย 100%', quantity: 100, unit: 'หลา', price: 45, discount: 0, vat: 315, total: 4815 },
        { id: '2', no: 2, name: 'ผ้า Polyester', quantity: 200, unit: 'หลา', price: 35, discount: 0, vat: 490, total: 7490 },
      ],
      subtotal: 12350,
      discountTotal: 0,
      vatTotal: 805,
      total: 13155,
      paymentTerms: 'เงินสด',
    },
    WORK_ORDER: {
      seller: {
        name: 'ห้างหุ้นส่วนสำนักงาน เอฟแลนด์ปี้ เบดดิ้ง',
        address: 'เลขที่ 31 หมู่ 2 ตำบลหัววัว อำเภอเมือง จังหวัดสมุทรสาคร 74000',
      },
      buyer: {
        name: 'แผนกผลิตที่ 1',
        contactName: 'คุณสมชาย มีสุข',
        tel: '081-234-5678',
      },
      items: [
        { id: '1', no: 1, name: 'ใยมะพร้าว', quantity: 25, unit: 'กก.', price: 0, discount: 0, vat: 0, total: 0, materialId: 'MAT-001', stockQty: 40, stockUnit: 'กก.', stockStatus: 'ok', issuedQty: 0 },
        { id: '2', no: 2, name: 'Polyesters 3D×32', quantity: 15, unit: 'กก.', price: 0, discount: 0, vat: 0, total: 0, materialId: 'MAT-002', stockQty: 8, stockUnit: 'กก.', stockStatus: 'short', issuedQty: 0 },
        { id: '3', no: 3, name: 'ผ้าคลุมหมอน (ผืน 14×40")', quantity: 100, unit: 'ผืน', price: 0, discount: 0, vat: 0, total: 0, materialId: 'MAT-003', stockQty: 120, stockUnit: 'ผืน', stockStatus: 'ok', issuedQty: 0 },
        { id: '4', no: 4, name: 'ด้ายเย็บ #60', quantity: 2, unit: 'ม้วน', price: 0, discount: 0, vat: 0, total: 0, materialId: 'MAT-004', stockQty: 5, stockUnit: 'ม้วน', stockStatus: 'ok', issuedQty: 0 },
      ],
      subtotal: 0, discountTotal: 0, vatTotal: 0, total: 0,
      dueDate: '2026-01-20',
      notes: 'ผลิตตามใบสั่งขาย SO-2026010039\nตรวจสอบคุณภาพทุกใบก่อนส่งออก',
      woProductName: 'หมอนข้าง ขนาด 14×40 นิ้ว',
      woQty: 100,
      woCompletedQty: 0,
      priority: 'HIGH',
      assignedTo: 'คุณสมชาย มีสุข',
    },
    QUOTATION: {
      seller: {
        name: 'หจก.เอฟแอนด์บี เบดดิ้ง',
        address: '31 ม.2 ต.หัวงัว อ.ยางตลาด จ.กาฬสินธุ์ 46120',
        taxId: '0463565001158',
        branch: 'สำนักงานใหญ่',
        tel: '091-803-3688',
      },
      buyer: {
        code: 'C-50100',
        name: 'หจก.ควีน บี พรีเมี่ยน',
        address: '44/170 หมู่บ้านภัสสร ซ.เฉลิมพระเกียรติ ร.๙ 87 แขวงประเวศ เขตประเวศ กรุงเทพ',
        taxId: '0103551018765',
        branch: 'สำนักงานใหญ่',
        contactName: 'ศศิพร ภูคงกิ่ง',
        tel: '091-803-3688',
      },
      items: [
        { id: '1', no: 1, name: 'หมอนหนุนบีบี สีขาวริ้ว 600 กรัม', sku: 'BB-0001-90', quantity: 500, unit: 'ชิ้น', price: 53.12, discount: 0, vat: 7, total: 26560, whtLabel: 'ไม่มี' },
        { id: '2', no: 2, name: 'หมอนหนุนรุ่นบีบี สีขาว เกรดเอ', sku: 'BB-011201', quantity: 300, unit: 'ชิ้น', price: 55.97, discount: 0, vat: 7, total: 16791, whtLabel: 'ไม่มี' },
        { id: '3', no: 3, name: 'ถุงพลาสติก 40*60', sku: 'BAG-40*60', quantity: 800, unit: 'ชิ้น', price: 120, discount: 0, vat: 7, total: 96000, whtLabel: 'ไม่มี' },
        { id: '4', no: 4, name: 'ค่าขนส่ง', sku: 'LO-01001 · หมวดบริการ', quantity: 1, unit: 'รอบ', price: 1500, discount: 0, vat: 7, total: 1500, whtLabel: 'ไม่มี' },
      ],
      subtotal: 140851,
      discountTotal: 0,
      vatTotal: 9859.57,
      total: 150710.57,
      paymentTerms: 'ยืนราคา 14 วัน · ส่งของภายใน 7 วันทำการ',
      dueDate: '2026-09-24',
    },
    RECEIPT: {
      seller: {
        name: 'หจก.เอฟแอนด์บี เบดดิ้ง',
        address: '31 ม.2 ต.หัวงัว อ.ยางตลาด จ.กาฬสินธุ์ 46120',
        taxId: '0463565001158',
        tel: '091-803-3688',
      },
      buyer: {
        code: 'C-50039',
        name: 'ห้างหุ้นส่วนจำกัด อามีนะห์ กรุ๊ป',
        taxId: '0103561006140',
        contactName: 'ฝ่ายจัดซื้อ',
      },
      items: [
        { id: '1', no: 1, name: 'หมอนหนุนบีบี สีขาวริ้ว', quantity: 10, unit: 'ชิ้น', price: 53.12, discount: 0, vat: 0, total: 531.2 },
        { id: '2', no: 2, name: 'ถุงพลาสติก 40*60', quantity: 5, unit: 'ชิ้น', price: 120, discount: 0, vat: 0, total: 600 },
        { id: '3', no: 3, name: 'ค่าขนส่ง', quantity: 1, unit: 'รอบ', price: 150, discount: 0, vat: 0, total: 150 },
      ],
      subtotal: 1281.2,
      discountTotal: 0,
      vatTotal: 89.68,
      total: 1370.88,
      paymentMethod: 'เงินสด',
      refNumber: 'IV-20260100049',
      bankName: 'กสิกรไทย',
      bankAccountName: 'เอฟแอนด์บี เบดดิ้ง',
      bankAccountNumber: '123-4-56789-0',
    },
    DELIVERY: {
      seller: {
        name: 'ห้างหุ้นส่วนสำนักงาน เอฟแลนด์ปี้ เบดดิ้ง',
        address: 'เลขที่ 31 หมู่ 2 ตำบลหัววัว อำเภอเมือง จังหวัดสมุทรสาคร 74000',
      },
      buyer: {
        code: 'C-50039',
        name: 'ร้านเพื่อนายพล',
        address: 'จังหวัดนครสวรรค์',
      },
      items: [
        { id: '1', no: 1, name: 'ใยมะพร้าว (ส่ง)', quantity: 50, unit: 'กก.', price: 0, discount: 0, vat: 0, total: 0 },
        { id: '2', no: 2, name: 'Polyesters 3D×32 (ส่ง)', quantity: 50, unit: 'กก.', price: 0, discount: 0, vat: 0, total: 0 },
      ],
      subtotal: 0,
      discountTotal: 0,
      vatTotal: 0,
      total: 0,
      refNumber: 'SO-20260100039',
    },
    INVOICE: {
      seller: {
        name: 'หจก.เอฟแอนด์บี เบดดิ้ง',
        address: '31 ม.2 ต.หัวงัว อ.ยางตลาด จ.กาฬสินธุ์ 46120',
        taxId: '0463565001158',
      },
      buyer: {
        name: 'ห้างหุ้นส่วนจำกัด อามีนะห์ กรุ๊ป',
        address: '35/14-15 ซอยพิบูลสงคราม 22 แยก 24 ต.บางเขน อ.เมือง จ.นนทบุรี',
        taxId: '0103561006140',
        tel: '063-818-8823',
      },
      items: [
        { id: '1', no: 1, name: 'ผ้าลายดาววิบวับ 85 กรัม', sku: 'FAB-003002-85 · ตัดจากม้วน 100 หลา', quantity: 91.44, unit: 'เมตร', price: 28, discount: 0, vat: 7, total: 2560.32, whtLabel: 'ไม่มี' },
        { id: '2', no: 2, name: 'ใยท็อปเปอร์ 3.5F 250 กรัม', sku: 'FIB-B-250F · ถุงละ 12 แผ่น', quantity: 120, unit: 'แผ่น', price: 12, discount: 0, vat: 7, total: 1440, whtLabel: 'ไม่มี' },
        { id: '3', no: 3, name: 'ค่าแพ็ค', sku: 'LO-01002 · หมวดบริการ ไม่ตัดสต็อก', quantity: 1, unit: 'รอบ', price: 800, discount: 0, vat: 7, total: 800, whtLabel: '3%' },
      ],
      subtotal: 4800.32,
      discountTotal: 0,
      vatTotal: 336.02,
      whtTotal: 24,
      total: 5136.34,
      dueDate: '2026-10-10',
      refNumber: 'SO-2026-00088',
      paymentTerms: 'เครดิต 30 วัน',
      notes: 'กรุณาชำระภายในกำหนด · ส่งหลักฐานการโอนกลับมาที่ bbpillowth@gmail.com',
      bankName: 'กสิกรไทย (KBank) · สาขายางตลาด',
      bankAccountName: 'หจก.เอฟแอนด์บี เบดดิ้ง',
      bankAccountNumber: '123-4-56789-0',
    },
  }

  const found = configs[type] ?? configs.SALE!

  return {
    id,
    docNumber: `${BILL_CONFIGS[type].docPrefix}-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}00001`,
    docDate: new Date().toISOString().split('T')[0],
    ...found,
    status: 'CONFIRMED',
    createdBy: 'Admin',
    createdAt: new Date().toISOString(),
  } as BillData
}
