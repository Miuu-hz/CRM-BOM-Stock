import { z } from 'zod'
import { IMcpServer } from '../sdk-compat'
import { ok } from './shared'
import { isValidCalendarDate } from '../../services/platformMonth.service'
import {
  submitOnlineOrders,
  getOnlineSummary,
  getUnlinkedLines,
  proposeOnlineMapping,
  OnlineOrderError,
  type OnlineSummaryGroupBy,
} from '../../services/onlineOrders.service'

const num = () => z.number().finite().min(-1e10).max(1e10)
const cnt = () => z.number().finite().min(0).max(1e10)
const cntPos = () => z.number().finite().positive().max(1e10)
const dateStr = () =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ต้องเป็นรูปแบบ YYYY-MM-DD').refine(isValidCalendarDate, 'วันที่นี้ไม่มีอยู่จริงในปฏิทิน')
const shopKeyStr = () =>
  z.string().min(1).transform((s) => s.trim().replace(/\s+/g, ' ')).refine((s) => s.length > 0, 'ต้องระบุ shop_key')

const orderRowSchema = z.object({
  order_no: z.string().min(1),
  order_time: z.string().min(1).describe('เวลาสั่งซื้อ รูปแบบ ISO หรือ YYYY-MM-DD HH:mm'),
  status: z.string().min(1),
  buyer_name: z.string().nullable().optional(),
  buyer_phone: z.string().nullable().optional(),
  full_address: z.string().nullable().optional(),
  province: z.string().nullable().optional(),
  district: z.string().nullable().optional(),
  postal_code: z.string().nullable().optional(),
  product_name: z.string().min(1),
  variant_name: z.string().nullable().optional(),
  qty: cntPos(),
  qty_returned: cnt().default(0),
  list_price: num().nullable().optional(),
  net_price: num(),
  tracking_no: z.string().nullable().optional(),
  payment_method: z.string().nullable().optional(),
  shipping_option: z.string().nullable().optional(),
})

const submitOrdersSchema = z.object({
  platform: z.enum(['SHOPEE']),
  shop_key: shopKeyStr(),
  rows: z.array(orderRowSchema).min(1, 'ต้องมีอย่างน้อย 1 แถว').max(150, 'ส่งได้ไม่เกิน 150 แถวต่อครั้ง — แบ่งส่งหลายครั้งได้'),
})

const queryOrdersSchema = z.object({
  from: dateStr(),
  to: dateStr(),
  group_by: z.enum(['province', 'district', 'product', 'variant', 'shop', 'day', 'month']),
  platform: z.enum(['SHOPEE']).optional(),
  shop_key: shopKeyStr().optional(),
})

const proposeMappingSchema = z.object({
  pairs: z.array(z.object({
    source_ref: z.string().min(1),
    sku: z.string().optional(),
    stock_item_id: z.string().optional(),
    factor: z.number().finite().positive().default(1),
  })).min(1, 'ต้องมีอย่างน้อย 1 คู่'),
})

export function registerOnlineOrderTools(server: IMcpServer, tenantId: string, userId = 'mcp-agent'): void {
  // ── online_submit_orders ──────────────────────────────────────────────────
  server.tool(
    'online_submit_orders',
    `ส่งข้อมูลออเดอร์ออนไลน์รายออเดอร์ (1 แถว = 1 บรรทัดสินค้าของออเดอร์) จากไฟล์ส่งออกคำสั่งซื้อของแพลตฟอร์ม
(Shopee Seller Centre > คำสั่งซื้อของฉัน > ส่งออก — ไม่ลงบัญชี ไม่ตัดสต็อก เก็บไว้วิเคราะห์ยอดและตรวจรับคืนข้ามเดือน)

แม็บคอลัมน์ Shopee → ฟิลด์:
  หมายเลขคำสั่งซื้อ→order_no, วันที่ทำการสั่งซื้อ→order_time, สถานะการสั่งซื้อ→status,
  ชื่อผู้รับ→buyer_name, หมายเลขโทรศัพท์→buyer_phone, ที่อยู่ในการจัดส่ง→full_address,
  จังหวัด→province, เขต/อำเภอ→district, รหัสไปรษณีย์→postal_code,
  ชื่อสินค้า→product_name, ชื่อตัวเลือก→variant_name, จำนวน→qty, จำนวนที่ส่งคืน→qty_returned,
  ราคาตั้งต้น→list_price, ราคาขายสุทธิ→net_price, หมายเลขติดตามพัสดุ→tracking_no,
  ช่องทางการชำระเงิน→payment_method, ตัวเลือกการจัดส่ง→shipping_option

กฎสำคัญ:
- ส่งทุกแถวของออเดอร์เดียวกันในครั้งเดียว (ถ้าส่งออเดอร์เดิมซ้ำจะแทนที่บรรทัดทั้งออเดอร์และอัปเดตสถานะ)
- เกิน 150 แถวแบ่งส่งหลายครั้ง (อย่าตัดแถวของออเดอร์เดียวกันแยกคนละครั้ง)
- ห้ามคำนวณตัวเลขเอง ส่งตัวเลขตรงตามไฟล์ (net_price = ราคาขายสุทธิของบรรทัดรวมทั้งบรรทัดตามไฟล์)
- ใบปะหน้า (shipping label) ไม่มีราคา ห้ามใช้เป็นแหล่งข้อมูล
- ข้อมูลส่วนตัว (ชื่อ เบอร์ ที่อยู่) จะถูกมาสก์ฝั่งระบบและแยกเก็บอย่างปลอดภัย ผลลัพธ์จะไม่คืน PII กลับ`,
    {
      platform: z.enum(['SHOPEE']).describe('แพลตฟอร์ม — รองรับ SHOPEE ก่อน'),
      shop_key: shopKeyStr().describe('ชื่อ/รหัสร้านที่คงที่ เช่น bebozch'),
      rows: z.array(orderRowSchema).min(1).max(150).describe('รายการบรรทัดสินค้าของออเดอร์ (1–150 แถวต่อครั้ง)'),
    },
    async (args) => {
      const parsed = submitOrdersSchema.safeParse(args)
      if (!parsed.success) {
        return ok({
          success: false,
          message: `ข้อมูลไม่ตรงรูปแบบ: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        })
      }

      try {
        const result = submitOnlineOrders(
          tenantId,
          {
            platform: parsed.data.platform,
            shopKey: parsed.data.shop_key,
            rows: parsed.data.rows.map((r) => ({
              orderNo: r.order_no,
              orderTime: r.order_time,
              status: r.status,
              buyerName: r.buyer_name,
              buyerPhone: r.buyer_phone,
              fullAddress: r.full_address,
              province: r.province,
              district: r.district,
              postalCode: r.postal_code,
              productName: r.product_name,
              variantName: r.variant_name,
              qty: r.qty,
              qtyReturned: r.qty_returned,
              listPrice: r.list_price,
              netPrice: r.net_price,
              trackingNo: r.tracking_no,
              paymentMethod: r.payment_method,
              shippingOption: r.shipping_option,
            })),
          },
          userId,
        )

        // ผลลัพธ์ห้ามมี PII เด็ดขาด
        return ok({
          success: true,
          batchId: result.batchId,
          ordersInserted: result.ordersInserted,
          ordersUpdated: result.ordersUpdated,
          linesUnlinked: result.linesUnlinked,
          returnEvents: result.returnEvents,
          unlinkedNames: result.unlinkedNames,
          message: `บันทึกออเดอร์ออนไลน์แล้ว — ใหม่ ${result.ordersInserted}, อัปเดต ${result.ordersUpdated}, ยังไม่ผูกสินค้า ${result.linesUnlinked} บรรทัด${result.returnEvents ? `, พบรับคืนเพิ่ม ${result.returnEvents} รายการ` : ''}`,
        })
      } catch (err: any) {
        const message = err instanceof OnlineOrderError ? err.message : 'บันทึกออเดอร์ออนไลน์ไม่สำเร็จ'
        return ok({ success: false, message })
      }
    },
  )

  // ── online_orders_query (อ่านอย่างเดียว) ─────────────────────────────────
  server.tool(
    'online_orders_query',
    `สรุปยอดขายออเดอร์ออนไลน์แยกตามจังหวัด/อำเภอ/สินค้า/ตัวเลือก/ร้าน/วัน/เดือน พร้อมจำนวนรายการที่ยังไม่ผูกสินค้าในคลัง
(อ่านอย่างเดียว — ไม่คืนข้อมูลส่วนตัวผู้ซื้อ นับเฉพาะออเดอร์ ACTIVE/COMPLETED/RETURNED)`,
    {
      from: dateStr().describe('วันที่เริ่มต้น รูปแบบ YYYY-MM-DD'),
      to: dateStr().describe('วันที่สิ้นสุด รูปแบบ YYYY-MM-DD'),
      group_by: z.enum(['province', 'district', 'product', 'variant', 'shop', 'day', 'month']).describe('มิติที่ต้องการจัดกลุ่ม'),
      platform: z.enum(['SHOPEE']).optional().describe('กรองแพลตฟอร์ม (ไม่ระบุ = ทั้งหมด)'),
      shop_key: shopKeyStr().optional().describe('กรองร้าน (ไม่ระบุ = ทั้งหมด)'),
    },
    async (args) => {
      const parsed = queryOrdersSchema.safeParse(args)
      if (!parsed.success) {
        return ok({
          success: false,
          message: `พารามิเตอร์ไม่ถูกต้อง: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        })
      }

      try {
        const rows = getOnlineSummary(tenantId, {
          from: parsed.data.from,
          to: parsed.data.to,
          groupBy: parsed.data.group_by as OnlineSummaryGroupBy,
          platform: parsed.data.platform,
          shopKey: parsed.data.shop_key,
        })
        const unlinked = getUnlinkedLines(tenantId, {
          from: parsed.data.from,
          to: parsed.data.to,
          platform: parsed.data.platform,
          shopKey: parsed.data.shop_key,
        })
        return ok({
          success: true,
          from: parsed.data.from,
          to: parsed.data.to,
          groupBy: parsed.data.group_by,
          rows,
          unlinkedCount: unlinked.length,
        })
      } catch (err: any) {
        const message = err instanceof OnlineOrderError ? err.message : (err?.message || String(err))
        return ok({ success: false, message })
      }
    },
  )

  // ── online_propose_mapping ────────────────────────────────────────────────
  server.tool(
    'online_propose_mapping',
    `เสนอคู่จับคู่ SKU ให้บรรทัดออเดอร์ออนไลน์ที่ยังไม่ผูกสินค้า (ใช้ตาราง proposals เดิม — ยังไม่ผูกจริง รอคนยืนยันที่หน้าเว็บ)
ระบุ source_ref คู่กับ sku หรือ stock_item_id อย่างใดอย่างหนึ่ง และ factor (ตัวคูณแพ็ก ค่าเริ่มต้น 1)`,
    {
      pairs: z.array(z.object({
        source_ref: z.string().min(1).describe('source_ref ของบรรทัดที่ยังไม่ผูก (เช่น SHOPEE:V1 หรือ SHOPEE:N...)'),
        sku: z.string().optional().describe('รหัส SKU ในคลัง (ระบุ sku หรือ stock_item_id)'),
        stock_item_id: z.string().optional().describe('รหัสสินค้าในคลัง (ระบุ sku หรือ stock_item_id)'),
        factor: z.number().finite().positive().default(1).describe('ตัวคูณจำนวนฐานต่อ 1 หน่วยขาย (ค่าเริ่มต้น 1)'),
      })).min(1),
    },
    async (args) => {
      const parsed = proposeMappingSchema.safeParse(args)
      if (!parsed.success) {
        return ok({
          success: false,
          message: `ข้อมูลไม่ตรงรูปแบบ: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        })
      }

      try {
        const result = proposeOnlineMapping(
          tenantId,
          parsed.data.pairs.map((p) => ({
            sourceRef: p.source_ref,
            sku: p.sku,
            stockItemId: p.stock_item_id,
            factor: p.factor ?? 1,
          })),
          userId,
        )
        return ok({
          success: true,
          ...result,
          message: `เสนอคู่จับคู่แล้ว ${result.accepted} คู่ (รอคนยืนยันที่หน้าเว็บ)${result.rejected.length ? ` — ปฏิเสธ ${result.rejected.length} คู่` : ''}`,
        })
      } catch (err: any) {
        const message = err instanceof OnlineOrderError ? err.message : (err?.message || String(err))
        return ok({ success: false, message })
      }
    },
  )
}

export default registerOnlineOrderTools
