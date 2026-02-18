import React, { createContext, useContext, useState, useCallback } from 'react'

// Types
export type BillType = 'SALE' | 'PURCHASE' | 'WORK_ORDER' | 'QUOTATION' | 'DELIVERY' | 'RECEIPT'

export interface BillConfig {
  type: BillType
  title: {
    th: string
    en: string
  }
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
  // กำหนด label ต่างๆ
  labels: {
    buyer: string      // ลูกค้า / ผู้ขาย / แผนกผลิต
    buyerCode: string  // รหัสลูกค้า / รหัสผู้ขาย / รหัสใบสั่ง
    docNumber: string  // เลขที่ใบสั่งขาย / เลขที่ใบสั่งซื้อ / เลขที่ใบสั่งผลิต
    refNumber: string  // อ้างอิงใบเสนอราคา / อ้างอิงใบสั่งขาย / -
  }
  // สีประจำ type
  themeColor: string
}

// Bill Configuration สำหรับแต่ละ type
export const BILL_CONFIGS: Record<BillType, BillConfig> = {
  SALE: {
    type: 'SALE',
    title: { th: 'ใบสั่งขาย', en: 'SALES ORDER' },
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
    themeColor: '#00f0ff', // cyber-primary
  },
  PURCHASE: {
    type: 'PURCHASE',
    title: { th: 'ใบสั่งซื้อ', en: 'PURCHASE ORDER' },
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
    themeColor: '#9d00ff', // cyber-purple
  },
  WORK_ORDER: {
    type: 'WORK_ORDER',
    title: { th: 'ใบสั่งผลิต', en: 'WORK ORDER' },
    fields: {
      showBuyerCode: false,
      showBuyerTaxId: false,
      showRefNumber: true,    // อ้างอิงใบสั่งขาย
      showDueDate: true,
      showPaymentTerms: false,
      showBankInfo: false,
      showSignatures: true,
      showQRCode: false,
    },
    labels: {
      buyer: 'แผนกผลิต',
      buyerCode: 'รหัสแผนก',
      docNumber: 'เลขที่ใบสั่งผลิต',
      refNumber: 'อ้างอิงใบสั่งขาย',
    },
    themeColor: '#00ff88', // cyber-green
  },
  QUOTATION: {
    type: 'QUOTATION',
    title: { th: 'ใบเสนอราคา', en: 'QUOTATION' },
    fields: {
      showBuyerCode: true,
      showBuyerTaxId: false,
      showRefNumber: false,
      showDueDate: true,      // วันที่หมดอายุใบเสนอราคา
      showPaymentTerms: true,
      showBankInfo: true,
      showSignatures: true,
      showQRCode: false,
    },
    labels: {
      buyer: 'ลูกค้า',
      buyerCode: 'รหัสลูกค้า',
      docNumber: 'เลขที่ใบเสนอราคา',
      refNumber: 'อ้างอิง',
    },
    themeColor: '#ff00ff', // cyber-magenta
  },
  DELIVERY: {
    type: 'DELIVERY',
    title: { th: 'ใบส่งของ', en: 'DELIVERY ORDER' },
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
    themeColor: '#0066ff', // cyber-secondary
  },
  RECEIPT: {
    type: 'RECEIPT',
    title: { th: 'ใบเสร็จรับเงิน', en: 'RECEIPT' },
    fields: {
      showBuyerCode: true,
      showBuyerTaxId: true,
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
    themeColor: '#00f0ff',
  },
}

// Bill Data Interface
export interface BillItem {
  id: string
  no: number
  name: string
  description?: string
  quantity: number
  unit: string
  price: number
  discount: number
  vat: number
  total: number
  // สำหรับ work order
  materialId?: string
  bomId?: string
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
  total: number
  
  // การชำระเงิน
  paymentMethod?: string
  paymentTerms?: string
  dueDate?: string
  
  // บัญชีธนาคาร (สำหรับรับเงิน)
  bankName?: string
  bankAccountName?: string
  bankAccountNumber?: string
  
  // เพิ่มเติม
  notes?: string
  qrCode?: string
  
  // สถานะ
  status: 'DRAFT' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED'
  
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
      
      // ดึงข้อมูลตาม type
      let endpoint = ''
      switch (type) {
        case 'SALE':
          endpoint = `/sales/orders/${id}`
          break
        case 'PURCHASE':
          endpoint = `/purchase-orders/${id}`
          break
        case 'WORK_ORDER':
          endpoint = `/work-orders/${id}`
          break
        case 'QUOTATION':
          endpoint = `/sales/quotations/${id}`
          break
        case 'RECEIPT':
          endpoint = `/sales/receipts/${id}`
          break
        default:
          throw new Error('Unknown bill type')
      }
      
      // TODO: เรียก API
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

// Mock Data Generator
function getMockData(type: BillType, id: string): BillData {
  const configs = {
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
        contactName: 'หัวหน้าแผนกผลิต',
      },
      items: [
        { id: '1', no: 1, name: 'ผลิตหมอนข้าง ขนาด 14×40 นิ้ว', quantity: 100, unit: 'ใบ', price: 0, discount: 0, vat: 0, total: 0, materialId: 'MAT-001' },
        { id: '2', no: 2, name: 'ผลิตหมอนหนุน ขนาด 19×29 นิ้ว', quantity: 200, unit: 'ใบ', price: 0, discount: 0, vat: 0, total: 0, materialId: 'MAT-002' },
      ],
      subtotal: 0,
      discountTotal: 0,
      vatTotal: 0,
      total: 0,
      dueDate: '2026-01-20',
    },
    QUOTATION: {
      seller: {
        name: 'ห้างหุ้นส่วนสำนักงาน เอฟแลนด์ปี้ เบดดิ้ง',
        address: 'เลขที่ 31 หมู่ 2 ตำบลหัววัว อำเภอเมือง จังหวัดสมุทรสาคร 74000',
        taxId: '0463565001158',
        tel: '02-123-4567',
      },
      buyer: {
        code: 'C-50100',
        name: 'โรงแรมเอ็กซ์คลูซีฟ',
        address: 'กรุงเทพฯ',
        contactName: 'คุณวิภา',
        tel: '081-234-5678',
      },
      items: [
        { id: '1', no: 1, name: 'ชุดผ้าปูที่นอน 6 ฟุต (พรีเมี่ยม)', quantity: 50, unit: 'ชุด', price: 2500, discount: 0, vat: 8750, total: 133750 },
        { id: '2', no: 2, name: 'หมอนหนุนโรงแรม', quantity: 100, unit: 'ใบ', price: 350, discount: 0, vat: 2450, total: 37450 },
      ],
      subtotal: 171250,
      discountTotal: 0,
      vatTotal: 11200,
      total: 182450,
      paymentTerms: 'มัดจำ 50%, จ่ายก่อนส่ง',
      dueDate: '2026-02-10', // วันหมดอายุใบเสนอราคา
    },
    RECEIPT: {
      seller: {
        name: 'ห้างหุ้นส่วนสำนักงาน เอฟแลนด์ปี้ เบดดิ้ง',
        address: 'เลขที่ 31 หมู่ 2 ตำบลหัววัว อำเภอเมือง จังหวัดสมุทรสาคร 74000',
        taxId: '0463565001158',
      },
      buyer: {
        code: 'C-50039',
        name: 'ร้านเพื่อนายพล',
        contactName: 'ปริญา กุลเฉลย',
      },
      items: [
        { id: '1', no: 1, name: 'ใยมะพร้าว', quantity: 50, unit: 'กก.', price: 120, discount: 0, vat: 0, total: 6000 },
        { id: '2', no: 2, name: 'Polyesters 3D×32', quantity: 50, unit: 'กก.', price: 60, discount: 0, vat: 0, total: 3000 },
      ],
      subtotal: 9000,
      discountTotal: 0,
      vatTotal: 0,
      total: 9000,
      paymentMethod: 'เงินโอน',
      refNumber: 'IV-20260100049',
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
  }
  
  const config = configs[type] || configs.SALE
  
  return {
    id,
    docNumber: `${type.substring(0, 2)}-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}00001`,
    docDate: new Date().toISOString().split('T')[0],
    ...config,
    status: 'CONFIRMED',
    createdBy: 'Admin',
    createdAt: new Date().toISOString(),
  } as BillData
}
