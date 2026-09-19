import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { ACC, ACC_META } from '../config/accountCodes'

const router = Router()

router.use(authenticate)

// ชื่อแบบภาษาคน — เจ้าของร้านไม่ต้องรู้จักเลขบัญชีหรือเดบิต/เครดิต
const CLEARING_LABELS: Record<string, { title: string; zeroWhen: string }> = {
  [ACC.POS_CLEARING]:      { title: 'ขายหน้าร้านแล้วเงินยังไม่เข้าบัญชี',   zeroWhen: 'ปิดกะแล้วนำเงินเข้า' },
  [ACC.PLATFORM_CLEARING]: { title: 'ขายออนไลน์แล้วรอแพลตฟอร์มโอนเงิน',     zeroWhen: 'แพลตฟอร์มโอนเข้าบัญชีแล้ว' },
  [ACC.SUBCON_MATERIAL]:   { title: 'ส่งวัตถุดิบไปให้ผู้รับจ้างช่วง ยังไม่ได้คืน', zeroWhen: 'รับของคืนครบแล้ว' },
  [ACC.GRNI]:              { title: 'ของเข้าคลังแล้ว ผู้ขายยังไม่วางบิล',    zeroWhen: 'ได้ใบแจ้งหนี้ครบแล้ว' },
}

// ยอด "ค้าง" ของบัญชีพักหนึ่งตัว ปรับให้เป็นบวกเสมอตามทิศ normal balance ของบัญชี
// (GRNI เป็นหนี้สิน-เครดิต ตัวอื่นเป็นสินทรัพย์-เดบิต) เพื่อเทียบกับผลรวมรายการเอกสารได้ตรง ๆ
// โดยไม่ต้องให้ผู้ใช้หน้าบ้านรู้เรื่องเดบิต/เครดิต — และไม่กรอง reference_type เพราะบัญชีพัก
// อาจถูกแตะจากหลายจุด เช่น GRNI ปิดตอนออกใบแจ้งหนี้
function accountBalance(tenantId: string, code: string): { balance: number; accountId: string | null } {
  const acc = db.prepare(`SELECT id FROM accounts WHERE tenant_id = ? AND code = ?`).get(tenantId, code) as { id: string } | undefined
  if (!acc) return { balance: 0, accountId: null }
  const row = db.prepare(`
    SELECT COALESCE(SUM(debit - credit), 0) as balance
    FROM journal_lines
    WHERE tenant_id = ? AND account_id = ?
  `).get(tenantId, acc.id) as { balance: number }
  const normalized = ACC_META[code]?.normalBalance === 'CREDIT' ? -row.balance : row.balance
  return { balance: normalized, accountId: acc.id }
}

router.get('/reconcile', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId

    // ---------- 2109 GRNI: ใบรับสินค้าที่ยืนยันแล้วแต่ยังไม่ได้ใบแจ้งหนี้ ----------
    // มูลค่าต่อใบดึงจาก journal_lines ของสมุดรายวันที่เกิดตอนยืนยันใบรับสินค้านั้นเอง (reference_type='GOODS_RECEIPT')
    // ไม่คำนวณจากราคา PO ใหม่ เพื่อให้ตัวเลขในตารางตรงกับยอดบัญชีเป๊ะ ๆ เสมอ (นี่คือที่มาของธงเตือนด้านล่าง)
    const grniItems = db.prepare(`
      SELECT gr.id, gr.gr_number, gr.receipt_date, s.name as supplier_name,
             COALESCE((
               SELECT SUM(jl.credit - jl.debit)
               FROM journal_lines jl
               JOIN journal_entries je ON je.id = jl.journal_entry_id
               JOIN accounts a ON a.id = jl.account_id
               WHERE je.tenant_id = gr.tenant_id AND je.reference_type = 'GOODS_RECEIPT' AND je.reference_id = gr.id AND a.code = ?
             ), 0) as value
      FROM goods_receipts gr
      LEFT JOIN suppliers s ON s.id = gr.supplier_id AND s.tenant_id = gr.tenant_id
      WHERE gr.tenant_id = ? AND gr.status = 'CONFIRMED' AND gr.invoiced_at IS NULL
      ORDER BY gr.receipt_date DESC
    `).all(ACC.GRNI, tenantId) as Array<{ id: string; gr_number: string; receipt_date: string; supplier_name: string | null; value: number }>

    // ---------- 1180 POS clearing: บิล PAID ที่กะยังไม่ปิด ----------
    const posItems = db.prepare(`
      SELECT b.id, b.bill_number, b.closed_at, b.total_amount as value
      FROM pos_running_bills b
      LEFT JOIN pos_shifts sh ON sh.id = b.shift_id
      WHERE b.tenant_id = ? AND b.status = 'PAID' AND (b.shift_id IS NULL OR sh.status = 'OPEN')
        -- นับเฉพาะบิลที่ลงบัญชีพักไว้จริง: บิลยุคก่อนมีระบบกะลง Dr เงินสดตรง ๆ ไม่เคยแตะ 1180
        -- ถ้านับรวมมาด้วยจะกลายเป็นธงเตือนหลอก (ยอดบัญชี 0 แต่มีรายการค้าง) ทั้งที่บัญชีถูกแล้ว
        AND EXISTS (
          SELECT 1 FROM journal_lines jl
          JOIN journal_entries je ON je.id = jl.journal_entry_id
          JOIN accounts a ON a.id = jl.account_id
          WHERE je.tenant_id = b.tenant_id AND je.reference_id = b.id AND a.code = ? AND jl.debit > 0
        )
      ORDER BY b.closed_at DESC
    `).all(tenantId, ACC.POS_CLEARING) as Array<{ id: string; bill_number: string; closed_at: string; value: number }>

    // ---------- 1112 Subcon material: ของที่ยังอยู่กับผู้รับจ้างช่วง ----------
    const subconItems = db.prepare(`
      SELECT id, supplier_name, item_name, quantity, total_value as value
      FROM subcon_stock
      WHERE tenant_id = ? AND quantity > 0
      ORDER BY total_value DESC
    `).all(tenantId) as Array<{ id: string; supplier_name: string; item_name: string; quantity: number; value: number }>

    const buckets = [
      { code: ACC.GRNI, items: grniItems.map(r => ({ id: r.id, docNumber: r.gr_number, date: r.receipt_date, party: r.supplier_name || '-', value: r.value })) },
      { code: ACC.POS_CLEARING, items: posItems.map(r => ({ id: r.id, docNumber: r.bill_number, date: r.closed_at, party: '-', value: r.value })) },
      { code: ACC.SUBCON_MATERIAL, items: subconItems.map(r => ({ id: r.id, docNumber: r.item_name, date: null, party: r.supplier_name, quantity: r.quantity, value: r.value })) },
      { code: ACC.PLATFORM_CLEARING, items: [] as Array<{ id: string; docNumber: string; date: string | null; party: string; value: number }> }, // ยังไม่มีแหล่งข้อมูลจริง (ตามที่ระบุในโจทย์)
    ]

    const data = buckets.map(({ code, items }) => {
      const { balance, accountId } = accountBalance(tenantId, code)
      const itemsTotal = items.reduce((s, it) => s + (it.value || 0), 0)
      // ธงเตือน: ยอดบัญชีกับผลรวมรายการที่ค้างต่างกันเกิน 1 บาท แปลว่ามีอะไรไม่ตรงกันระหว่างเอกสารกับบัญชี
      const mismatch = accountId !== null && Math.abs(balance - itemsTotal) > 1
      return {
        code,
        name: ACC_META[code]?.name || code,
        title: CLEARING_LABELS[code]?.title || ACC_META[code]?.name || code,
        zeroWhen: CLEARING_LABELS[code]?.zeroWhen || '',
        balance,
        itemCount: items.length,
        itemsTotal,
        mismatch,
        items,
      }
    })

    res.json({ success: true, data })
  } catch (error) {
    console.error('Get clearing reconcile error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch clearing reconcile' })
  }
})

export default router
