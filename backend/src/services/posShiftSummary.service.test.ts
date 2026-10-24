import { describe, it, expect } from "vitest"
import db from "../db/sqlite"
import { generateId } from "../utils/id"
import { buildShiftSummary } from "./posShiftSummary.service"
import { flexTemplates } from "./line-flex-templates"

describe("สรุปปิดกะส่ง LINE", () => {
  it("ขายดีเรียงตามยอดเงิน · ฝั่งซื้อรวมใบรับของ+ใบสั่งซื้อ+เงินออก โดยไม่นับ PO ที่รับของแล้วซ้ำ · นับป้ายแจ้งเตือนในช่วงกะ", () => {
    const T = generateId(), shiftId = generateId()
    const opened = "2026-10-16T02:00:00.000Z", closed = "2026-10-16T13:00:00.000Z" // 09:00–20:00 เวลาไทย
    db.prepare(`INSERT INTO pos_shifts (id, tenant_id, shift_number, status, opened_at, closed_at, opening_cash, expected_cash,
      closing_cash_counted, cash_difference, total_revenue, cash_revenue, bank_revenue, bill_count)
      VALUES (?, ?, \x27SHIFT-007-161026\x27, \x27CLOSED\x27, ?, ?, 500, 800, 756, -44, 1000, 300, 700, 2)`).run(shiftId, T, opened, closed)

    const stockId = generateId(), menuId = generateId()
    db.prepare("INSERT INTO stock_items (id, tenant_id, sku, name, category, unit, location, status) VALUES (?, ?, ?, 'm', 'FOOD', 'pcs', 'WH1', 'ACTIVE')").run(stockId, T, stockId)
    db.prepare("INSERT INTO pos_menu_configs (id, tenant_id, product_id, pos_price) VALUES (?, ?, ?, 1)").run(menuId, T, stockId)
    const bill = (status: string, items: [string, number, number][]) => {
      const id = generateId()
      db.prepare("INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, shift_id) VALUES (?, ?, ?, \x27t\x27, ?, ?)").run(id, T, id, status, shiftId)
      for (const [name, qty, price] of items)
        db.prepare("INSERT INTO pos_bill_items (id, tenant_id, bill_id, pos_menu_id, product_name, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .run(generateId(), T, id, menuId, name, qty, price, qty * price)
      return id
    }
    const first = bill("PAID", [["กะเพรา", 2, 89], ["โกโก้", 1, 95]])
    bill("PAID", [["กะเพรา", 1, 89], ["กุ้งทอด", 3, 99]])
    bill("CANCELLED", [["สเต็ก", 9, 500]]) // บิลยกเลิกห้ามนับ

    // ส่วนลดบิลแรก 70 = ลดเอง 50 + แลกแต้ม 20 บาท (อัตราเริ่มต้น 10 แต้ม = 1 บาท → 200 แต้ม)
    // แต้มที่ตัดจริง 300 = 200 ที่เคาน์เตอร์ + 100 แลกของแถม (ของแถมไม่นับเป็นส่วนลดบาท)
    db.prepare("UPDATE pos_running_bills SET discount_amount = 70 WHERE id = ?").run(first)
    db.prepare("INSERT INTO loyalty_transactions (id, tenant_id, customer_id, type, points, balance_after, reference_type, reference_id, created_at) VALUES (?, ?, \x27c\x27, \x27REDEEM\x27, -300, 0, \x27POS_BILL\x27, ?, ?)").run(generateId(), T, first, closed)
    db.prepare("INSERT INTO pos_redemptions (id, tenant_id, bill_id, customer_id, reward_id, bill_item_id, points, status, created_at) VALUES (?, ?, ?, \x27c\x27, \x27r\x27, \x27i\x27, 100, \x27USED\x27, ?)").run(generateId(), T, first, closed)

    const sup = generateId()
    db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, \x27Makro\x27, \x27-\x27)").run(sup, T, sup)
    const po = (approvedAt: string | null) => {
      const id = generateId(), item = generateId()
      db.prepare("INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, total_amount, approved_at) VALUES (?, ?, ?, ?, \x27APPROVED\x27, 400, ?)").run(id, T, `PO-${id.slice(0, 4)}`, sup, approvedAt)
      db.prepare("INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, quantity, unit_price) VALUES (?, ?, ?, 4, 100)").run(item, T, id)
      return { id, item }
    }
    const received = po("2026-10-16T03:00:00.000Z") // อนุมัติแล้วรับของในวันเดียวกัน → นับครั้งเดียวที่ใบรับของ
    po("2026-10-16T04:00:00.000Z")                    // อนุมัติแต่ยังไม่รับ → นับ 400
    po("2026-10-15T04:00:00.000Z")                    // อนุมัติก่อนเปิดกะ → ไม่นับ
    const gr = generateId()
    db.prepare("INSERT INTO goods_receipts (id, tenant_id, gr_number, purchase_order_id, supplier_id, status, receipt_date) VALUES (?, ?, \x27GR-061-161026\x27, ?, ?, \x27CONFIRMED\x27, \x272026-10-16\x27)").run(gr, T, received.id, sup)
    db.prepare("INSERT INTO goods_receipt_items (id, tenant_id, goods_receipt_id, purchase_order_item_id, received_qty) VALUES (?, ?, ?, ?, 3)").run(generateId(), T, gr, received.item)
    db.prepare("INSERT INTO pos_shift_cash_movements (id, tenant_id, shift_id, type, amount, reason, account_id) VALUES (?, ?, ?, \x27PAID_OUT\x27, 60, \x27น้ำแข็ง\x27, \x27x\x27)").run(generateId(), T, shiftId)

    const log = (mod: string, amount: number, at: string) => db.prepare(`INSERT INTO approval_requests (id, tenant_id, request_number, module_type,
      reference_type, reference_id, requester_id, requester_name, requester_role, amount, description, status, created_at)
      VALUES (?, ?, ?, ?, \x27x\x27, \x27x\x27, \x27u\x27, \x27u\x27, \x27USER\x27, ?, \x27d\x27, \x27AUTO\x27, ?)`).run(generateId(), T, generateId(), mod, amount, at)
    log("pos_void", 120, "2026-10-16T05:00:00.000Z")
    log("pos_discount", 300, "2026-10-16T06:00:00.000Z")
    log("pos_discount", 200, "2026-10-16T07:00:00.000Z")
    log("pos_void", 99, "2026-10-15T07:00:00.000Z") // นอกกะ

    const s = buildShiftSummary(T, shiftId)!
    expect(s.topSales.map(t => t.name)).toEqual(["กุ้งทอด", "กะเพรา", "โกโก้"])
    expect(s.topSales[1]).toEqual({ name: "กะเพรา", qty: 3, amount: 267 })
    expect(s.buys.top.map(b => b.amount)).toEqual([400, 300, 60])
    expect(s.buys.total).toBe(760)
    expect(s.alerts).toEqual({ voids: 1, itemVoids: 0, discountTotal: 50 }) // จากบิล (70 − แต้ม 20 บาท) ไม่ใช่ log (500)
    expect(s.difference).toBe(-44)

    const card = flexTemplates.shiftCloseCard({ ...s, webUrl: "https://erp.phopy.net" })
    expect(card.altText.length).toBeLessThanOrEqual(400)
    expect(card.altText).toContain("ขาด")
    expect(JSON.stringify(card)).not.toContain("undefined")
  })
})
