import { IMcpServer } from '../sdk-compat'

/**
 * MCP tools สำหรับ 2 จุดเดียวที่สายขายลงบัญชี: ออกใบแจ้งหนี้ + รับชำระเงิน
 *
 * เจ้าของตัดสินใจ 2026-09-14 ว่า AI ยังออกเอกสาร 2 ชนิดนี้ไม่ได้ — ต้องทำในระบบเอง
 * เพราะเป็นขั้นที่ตัดสต็อก/ลงบัญชีจริง (ดู mcp/tools/sales.test.ts ที่ยืนยันว่าไม่มี
 * tool สร้างใบแจ้งหนี้/รับชำระเงินให้ AI เรียก)
 *
 * ponytail: ฟังก์ชันเปล่าตั้งใจ ไม่ใช่ลืมเขียน — เหลือไว้เป็นจุดลงทะเบียนให้ mcp/tools.ts
 * เรียกได้โดยไม่ต้องแก้ที่นั่น ถ้าวันหน้าเจ้าของกลับคำ ตรรกะจริงอยู่ที่
 * services/salesBilling.service.ts (createInvoiceFromSO/recordCustomerPayment) อยู่แล้ว
 * แค่ import มาต่อ ไม่ต้องเขียนใหม่
 */
export function registerSalesBillingTools(server: IMcpServer, tenantId: string, userId: string, callerName: string, callerRole: string): void {
}
