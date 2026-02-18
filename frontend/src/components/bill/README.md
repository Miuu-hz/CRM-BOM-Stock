# Bill Printing System

ระบบพิมพ์เอกสารอเนกประสงค์สำหรับ CRM-BOM-Stock

## Features

- **Unified Template**: ใช้ Template เดียวกันสำหรับทุก type ของเอกสาร
- **Context-based**: เปลี่ยนบริบทตามประเภทเอกสาร (สั่งซื้อ/สั่งขาย/สั่งผลิต)
- **Multi-size**: รองรับ A4, A5, Thermal (80mm)
- **Print-ready**: รองรับการพิมพ์ทันที

## Supported Document Types

| Type | ชื่อไทย | ใช้สำหรับ |
|------|---------|-----------|
| QUOTATION | ใบเสนอราคา | เสนอราคาลูกค้า |
| SALE | ใบสั่งขาย | ออเดอร์ขาย |
| DELIVERY | ใบส่งของ | ส่งมอบสินค้า |
| RECEIPT | ใบเสร็จรับเงิน | รับชำระเงิน |
| PURCHASE | ใบสั่งซื้อ | สั่งซื้อจากผู้ขาย |
| WORK_ORDER | ใบสั่งผลิต | สั่งผลิตในโรงงาน |

## Usage

### 1. Quick Print Button

```tsx
import { QuickPrintButton } from '../components/bill'

// ใน Component
<QuickPrintButton
  type="SALE"
  documentId={order.id}
  label="พิมพ์ใบสั่งขาย"
/>
```

### 2. Bill Viewer Modal

```tsx
import { BillViewer } from '../components/bill'

// เปิด Modal ดูเอกสาร
<BillViewer
  type="PURCHASE"
  documentId="PO-2024001"
  onClose={() => setShowBill(false)}
/>
```

### 3. With Context (Advanced)

```tsx
import { BillProvider, useBill, UnifiedBillTemplate } from '../components/bill'

function MyComponent() {
  return (
    <BillProvider initialType="SALE">
      <BillContent />
    </BillProvider>
  )
}

function BillContent() {
  const { config, data, loadBillData } = useBill()
  
  // โหลดข้อมูล
  useEffect(() => {
    loadBillData('SALE', 'SO-001')
  }, [])
  
  return <UnifiedBillTemplate size="A4" />
}
```

## Configuration

แต่ละ Bill Type มีการตั้งค่า (config) ที่แตกต่างกัน:

```typescript
const config: BillConfig = {
  type: 'SALE',
  title: { th: 'ใบสั่งขาย', en: 'SALES ORDER' },
  fields: {
    showBuyerCode: true,
    showBuyerTaxId: true,
    showRefNumber: true,
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
  themeColor: '#00f0ff',
}
```

## Styling

- Theme Color: แต่ละ type มีสีประจำตัว
- Print Media Query: รองรับการพิมพ์โดยเฉพาะ
- Responsive: รองรับทั้ง desktop และ mobile

## Integration with Backend

ตัวอย่างการดึงข้อมูล:

```typescript
// hooks/useBillData.ts
export function useBillData(type: BillType, id: string) {
  const endpoints = {
    SALE: `/api/sales/orders/${id}`,
    PURCHASE: `/api/purchase-orders/${id}`,
    WORK_ORDER: `/api/work-orders/${id}`,
    // ...
  }
  
  return useQuery({
    queryKey: ['bill', type, id],
    queryFn: () => api.get(endpoints[type]).then(r => r.data),
  })
}
```

## Future Enhancements

- [ ] PDF Export
- [ ] Email Sending
- [ ] Digital Signature
- [ ] QR Code Payment
- [ ] Multi-language (EN/TH)
