import db from '../db/sqlite'
import { generateId, formatDocumentNumber } from '../utils/id'
import { convertQuantityBidirectional, normalizeUnit, findConversionChain } from './unitConversion.service'
import { roundQty } from '../utils/qty'
import { priceToBaseUnitCost } from './stockMovement.service'

/**
 * ตรรกะ "สร้าง GR" และ "ยืนยัน GR" ยกออกมาจาก routes/purchase.routes.ts (ตัวที่ครบสุด)
 * เพื่อให้ routes/purchase.routes.ts (REST) และ mcp/tools/purchase.ts (MCP) เรียกตัวเดียวกัน
 * — เดิมแต่ละฝั่งมีสำเนาของตัวเองที่ต่างกันหลายจุด (ดู project_erp_purchase_unit_guard และ
 * รายงานตรวจ GR 2026-09-14): เลขที่ GR ฝั่ง MCP นับจาก COUNT(*)+1 (ชนกับของ REST ได้),
 * จับคู่รายการด้วย description.includes() สองทาง (ผิดใบ), ยืนยัน GR ที่ CANCELLED ซ้ำได้
 * (เช็คแค่ === 'CONFIRMED'), ไม่มีเพดานยอดค้างรับ
 *
 * cancel/reverse ยังอยู่ที่ purchase.routes.ts เดิม (reverseGoodsReceiptStock) — ไม่มี MCP
 * tool ที่ยกเลิก GR อยู่แล้ว จึงไม่มีสำเนาที่ต้องรวม
 */

const PACK_EPS = 1e-9

export class GoodsReceiptError extends Error {
  constructor(
    public code:
      | 'PO_NOT_FOUND'
      | 'PO_RECEIVED'
      | 'PO_CANCELLED'
      | 'DRAFT_EXISTS'
      | 'OVER_PENDING_QTY'
      | 'GR_NOT_FOUND'
      | 'NOT_DRAFT'
      | 'NO_CONVERSION',
    message: string
  ) {
    super(message)
  }
}

export interface PendingPoItem {
  id: string
  purchase_order_id: string
  material_id: string | null
  description: string
  quantity: number
  unit_price: number
  unit: string | null
  received_qty: number
  pending_qty: number
}

/** รายการ PO ที่ยังรับไม่ครบ — ใช้ทั้งตอน cap ยอดรับใน createGoodsReceipt และตอน MCP
 * ต้อง default "รับทั้งหมดที่ค้าง" เมื่อผู้ใช้ไม่ระบุ items มา */
export function getPendingPoItems(tenantId: string, purchaseOrderId: string): PendingPoItem[] {
  return db.prepare(`
    SELECT *, (quantity - COALESCE(received_qty, 0)) as pending_qty
    FROM purchase_order_items
    WHERE purchase_order_id = ? AND tenant_id = ? AND quantity > COALESCE(received_qty, 0)
  `).all(purchaseOrderId, tenantId) as PendingPoItem[]
}

/**
 * จับคู่รายการที่ผู้ใช้พิมพ์ชื่อมา (MCP) กับรายการค้างรับใน PO — ต้อง exact match เท่านั้น
 * (ตัดช่องว่างหัวท้าย + ไม่สนตัวพิมพ์เล็กใหญ่) ห้ามใช้ includes() สองทางเหมือนเดิม เพราะ
 * "กล่อง" จะไปจับคู่กับ "กล่องของขวัญเปล่า" ผิดใบ (โรคเดิมของ project_erp_purchase_unit_guard)
 * ไม่เจอคืน null ให้ผู้เรียกแจ้ง error แทนเดา
 */
export function matchPendingItemByDescription(pendingItems: PendingPoItem[], description: string): PendingPoItem | null {
  const norm = (s: string) => s.trim().toLowerCase()
  const target = norm(description)
  return pendingItems.find(p => norm(p.description || '') === target) || null
}

export interface CreateGoodsReceiptLine {
  poItemId: string
  materialId?: string | null
  orderedQty: number
  receivedQty: number
  acceptedQty?: number
  rejectedQty?: number
  lotNumber?: string | null
  location?: string | null
  notes?: string
}

export interface CreateGoodsReceiptPayload {
  purchaseOrderId: string
  receiptDate?: string
  receivedBy?: string
  notes?: string
  deliveryNoteNo?: string | null
  items?: CreateGoodsReceiptLine[]
}

/** สร้าง GR แบบ DRAFT จาก PO — ยังไม่แตะสต็อก (ตัดตอน confirmGoodsReceipt) */
export function createGoodsReceipt(tenantId: string, receivedByEmail: string, payload: CreateGoodsReceiptPayload) {
  const { purchaseOrderId, receiptDate, receivedBy, notes, deliveryNoteNo, items } = payload

  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(purchaseOrderId, tenantId) as any
  if (!po) throw new GoodsReceiptError('PO_NOT_FOUND', 'Purchase order not found')
  if (po.status === 'RECEIVED') throw new GoodsReceiptError('PO_RECEIVED', 'ใบสั่งซื้อนี้รับสินค้าครบแล้ว')
  if (po.status === 'CANCELLED') throw new GoodsReceiptError('PO_CANCELLED', 'ใบสั่งซื้อนี้ถูกยกเลิกไปแล้ว')

  const existingDraft = db.prepare(
    "SELECT id, gr_number FROM goods_receipts WHERE purchase_order_id = ? AND tenant_id = ? AND status = 'DRAFT'"
  ).get(purchaseOrderId, tenantId) as any
  if (existingDraft) {
    throw new GoodsReceiptError(
      'DRAFT_EXISTS',
      `มีใบรับสินค้าร่าง ${existingDraft.gr_number} รออยู่ — กรุณายืนยันหรือลบก่อนสร้างใหม่`
    )
  }

  // Bug #4: เพดานยอดรับ — ห้ามรับเกินยอดค้าง (quantity - received_qty) ของแต่ละรายการใน PO
  // เดิมไม่มีเช็คนี้เลยที่ชั้น API ทั้ง REST และ MCP
  if (items && items.length > 0) {
    const poItemById = new Map(
      (db.prepare(
        'SELECT id, quantity, COALESCE(received_qty, 0) as received_qty, description FROM purchase_order_items WHERE purchase_order_id = ? AND tenant_id = ?'
      ).all(purchaseOrderId, tenantId) as any[]).map(i => [i.id, i])
    )
    for (const item of items) {
      const poItem = poItemById.get(item.poItemId)
      if (!poItem) continue // free-text line ไม่ผูกกับ PO item — ไม่มีอะไรให้ cap
      const pendingQty = poItem.quantity - poItem.received_qty
      const acceptedQty = item.acceptedQty ?? item.receivedQty
      if (acceptedQty > pendingQty + PACK_EPS) {
        throw new GoodsReceiptError(
          'OVER_PENDING_QTY',
          `รับ "${poItem.description}" เกินยอดค้าง — ค้างรับอยู่ ${pendingQty} แต่พยายามรับ ${acceptedQty}`
        )
      }
    }
  }

  const id = generateId()
  // Bug #1: ตัวนับกลาง — เดิม MCP ใช้ COUNT(*)+1 ชนกับเลขที่ REST ออกได้ (ลบใบเดียวแล้วสร้าง
  // ใหม่ได้เลขซ้ำ) ตอนนี้ทั้ง REST และ MCP เดินผ่าน document_sequences ตัวเดียวกัน
  const grNumber = formatDocumentNumber('GR', tenantId, 'GOODS_RECEIPT', new Date().getFullYear(), 5)
  const now = new Date().toISOString()

  db.transaction(() => {
    db.prepare(`
      INSERT INTO goods_receipts (id, tenant_id, gr_number, purchase_order_id, supplier_id, receipt_date,
        received_by, status, notes, delivery_note_no, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)
    `).run(id, tenantId, grNumber, purchaseOrderId, po.supplier_id, receiptDate || now,
      receivedBy || receivedByEmail, notes || '', deliveryNoteNo || null, now, now)

    if (items && items.length > 0) {
      const insertItem = db.prepare(`
        INSERT INTO goods_receipt_items (id, tenant_id, goods_receipt_id, purchase_order_item_id, material_id,
          ordered_qty, received_qty, accepted_qty, rejected_qty, lot_number, location, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const item of items) {
        insertItem.run(
          generateId(), tenantId, id, item.poItemId, item.materialId || null,
          item.orderedQty, item.receivedQty, item.acceptedQty ?? item.receivedQty,
          item.rejectedQty || 0, item.lotNumber || null, item.location || null, item.notes || ''
        )
      }
    }
  })()

  const receipt = db.prepare('SELECT * FROM goods_receipts WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any
  const receiptItems = db.prepare('SELECT * FROM goods_receipt_items WHERE goods_receipt_id = ?').all(id)
  return { ...receipt, items: receiptItems }
}

function findGoodsReceipt(tenantId: string, grIdOrNumber: string): any {
  let gr = db.prepare('SELECT * FROM goods_receipts WHERE id = ? AND tenant_id = ?').get(grIdOrNumber, tenantId) as any
  if (!gr) gr = db.prepare('SELECT * FROM goods_receipts WHERE gr_number = ? AND tenant_id = ?').get(grIdOrNumber, tenantId) as any
  return gr
}

/**
 * ยืนยัน GR: เข้าสต็อก + บวก received_qty + ดันสถานะ PO — ไม่ลงบัญชี (ลงตอนออกใบแจ้งหนี้ PI)
 *
 * ทางเลือกที่ตัดสินใจ (ตามที่ต้องเลือกทางเดียว): ถ้า resolve stock_items ไม่ได้จาก material_id
 * จะสร้างสต็อกใหม่จาก materials ให้เอง (พฤติกรรมเดิมของ REST) แทนการ throw (ที่ MCP เพิ่งแก้ไปทาง
 * นั้น) — เพราะ BOM material ที่ยังไม่เคยมีแถวใน stock_items เป็นเคสที่เกิดขึ้นจริงในการใช้งานปกติ
 * (ไม่ใช่ข้อมูลเสีย) การ throw จะบล็อกการรับของที่ถูกต้องทั้งใบ ส่วนการสร้างอัตโนมัติมีขอบเขตชัดแล้ว
 * (ใช้ materials.unit เป็น base_unit ของแถวใหม่ + แปลงราคาต่อหน่วยฐานเหมือนกัน) จึงปลอดภัยกว่า
 */
export function confirmGoodsReceipt(tenantId: string, userId: string, grIdOrNumber: string) {
  const gr = findGoodsReceipt(tenantId, grIdOrNumber)
  if (!gr) throw new GoodsReceiptError('GR_NOT_FOUND', 'Goods receipt not found')

  // Bug #3: เดิมเช็คแค่ === 'CONFIRMED' — ยืนยัน GR ที่ CANCELLED ซ้ำได้ = ของเข้าสต็อก 2 รอบ
  if (gr.status !== 'DRAFT') {
    throw new GoodsReceiptError(
      'NOT_DRAFT',
      gr.status === 'CONFIRMED'
        ? 'Goods receipt already confirmed'
        : 'ใบรับสินค้านี้ถูกยกเลิกไปแล้ว ยืนยันไม่ได้'
    )
  }

  const items = db.prepare('SELECT * FROM goods_receipt_items WHERE goods_receipt_id = ?').all(gr.id) as any[]
  const now = new Date().toISOString()

  db.transaction(() => {
    db.prepare("UPDATE goods_receipts SET status = 'CONFIRMED', updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(now, gr.id, tenantId)

    for (const item of items) {
      if (item.material_id && item.accepted_qty > 0) {
        let poItem: any
        try {
          poItem = db.prepare('SELECT unit_price, unit FROM purchase_order_items WHERE id = ?').get(item.purchase_order_item_id) as any
        } catch (e) {
          poItem = db.prepare('SELECT unit_price FROM purchase_order_items WHERE id = ?').get(item.purchase_order_item_id) as any
        }
        const unitPrice = poItem?.unit_price || 0
        const poUnit = normalizeUnit(poItem?.unit || '')

        // หา stock item: ก่อนด้วย material_id (สาย BOM) แล้วค่อยตรงด้วย id (สาย stock ล้วน)
        let stockItem = db.prepare('SELECT * FROM stock_items WHERE material_id = ? AND tenant_id = ?').get(item.material_id, tenantId) as any
        if (!stockItem) {
          stockItem = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(item.material_id, tenantId) as any
        }

        let stockQty = roundQty(Number(item.accepted_qty))
        let movementNotes = `Received from purchase`
        let addToSealed = false
        let appliedFactor = 1
        let sealedPacks = 0

        const stockUnit = normalizeUnit(stockItem?.base_unit || stockItem?.unit || '')
        const displayUnit = normalizeUnit(stockItem?.display_unit || '')

        const displayToBaseChain = (!!displayUnit && displayUnit !== stockUnit)
          ? findConversionChain(displayUnit, stockUnit, tenantId, item.material_id)
          : null
        const canUnpackDisplay = !!displayToBaseChain

        if (stockItem && poUnit && displayUnit && poUnit === displayUnit && canUnpackDisplay) {
          addToSealed = true
          const packFactor = displayToBaseChain?.factor ?? 1
          sealedPacks = Math.floor(Number(item.accepted_qty) + PACK_EPS)
          stockQty = roundQty((Number(item.accepted_qty) - sealedPacks) * packFactor)
          appliedFactor = packFactor
          movementNotes = sealedPacks > 0 && stockQty > 0
            ? `Received ${item.accepted_qty} ${poUnit}: sealed ${sealedPacks} ${poUnit} (ยังไม่แกะ) + เศษ ${stockQty} ${stockUnit}`
            : sealedPacks > 0
              ? `Received as sealed ${poUnit}: ${sealedPacks} ${poUnit} (ยังไม่แกะ)`
              : `Received ${item.accepted_qty} ${poUnit} → ${stockQty} ${stockUnit} (ไม่ถึงหนึ่งแพ็ค)`
        } else if (stockItem && poUnit && poUnit !== stockUnit) {
          const converted = convertQuantityBidirectional(Number(item.accepted_qty), poUnit, stockUnit, tenantId, item.material_id)
          if (!converted) {
            const materialName = (db.prepare('SELECT name FROM materials WHERE id = ?').get(item.material_id) as any)?.name
              || stockItem.name
              || item.material_id
            throw new GoodsReceiptError(
              'NO_CONVERSION',
              `ไม่พบการแปลงหน่วย ${poUnit} → ${stockUnit} สำหรับ "${materialName}" กรุณาตั้งค่า Unit Conversion ก่อน`
            )
          }
          stockQty = roundQty(converted.converted)
          appliedFactor = converted.factor
          movementNotes = `Received from purchase (converted: ${item.accepted_qty} ${poUnit} → ${stockQty} ${stockUnit}, factor: ${converted.factor})`
        }

        if (stockItem) {
          if (addToSealed) {
            // sealed path เก็บ qty เป็น display_unit (แพ็คที่ยังไม่แกะ) แต่ unit_cost ต้องเป็น
            // ต่อ base_unit เสมอ ไม่ว่าตัวเลข quantity จะพักอยู่หน่วยไหนก็ตาม
            const sealedCostFactor = displayToBaseChain?.factor ?? 1
            const sealedUnitCost = unitPrice
              ? priceToBaseUnitCost(unitPrice, sealedCostFactor, `sealed ${poUnit}→${stockUnit} (material ${item.material_id})`)
              : stockItem.unit_cost
            db.prepare('UPDATE stock_items SET sealed_qty = COALESCE(sealed_qty, 0) + ?, quantity = quantity + ?, unit_cost = ?, purchase_price = COALESCE(?, purchase_price), purchase_unit = COALESCE(?, purchase_unit), unit = COALESCE(base_unit, unit), updated_at = ? WHERE id = ? AND tenant_id = ?')
              .run(sealedPacks, stockQty, sealedUnitCost, unitPrice || null, unitPrice ? (poUnit || null) : null, now, stockItem.id, tenantId)
          } else {
            const newUnitCost = unitPrice
              ? priceToBaseUnitCost(unitPrice, appliedFactor, `${poUnit || stockUnit}→${stockUnit} (material ${item.material_id})`)
              : stockItem.unit_cost
            db.prepare('UPDATE stock_items SET quantity = quantity + ?, unit_cost = ?, purchase_price = COALESCE(?, purchase_price), purchase_unit = COALESCE(?, purchase_unit), unit = COALESCE(base_unit, unit), updated_at = ? WHERE id = ? AND tenant_id = ?')
              .run(stockQty, newUnitCost, unitPrice || null, unitPrice ? (poUnit || stockUnit || null) : null, now, stockItem.id, tenantId)
          }
        } else {
          // สร้าง stock item ใหม่ (BOM material ที่ยังไม่เคยเข้าสต็อก) — materials มีแค่คอลัมน์
          // unit เดียว (ไม่มี base/display split) จึงใช้เป็น base_unit ของแถวใหม่นี้ด้วย
          const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(item.material_id) as any
          if (material) {
            const newStockId = generateId()
            const newItemUnit = normalizeUnit(material.unit || 'pcs')
            let newItemCostFactor = 1
            if (poUnit && newItemUnit && poUnit !== newItemUnit) {
              const conv = convertQuantityBidirectional(1, poUnit, newItemUnit, tenantId, item.material_id)
              if (conv && conv.factor > 0) {
                newItemCostFactor = conv.factor
              } else {
                console.warn(`[unit_cost] no conversion ${poUnit}→${newItemUnit} for new stock item (material ${item.material_id}); storing price un-converted`)
              }
            }
            const newUnitCost = priceToBaseUnitCost(unitPrice, newItemCostFactor, `new stock item ${poUnit}→${newItemUnit} (material ${item.material_id})`)
            db.prepare(`
              INSERT INTO stock_items (id, tenant_id, sku, name, category, material_id, quantity, unit, base_unit, unit_cost, location, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'STOCK', 'ACTIVE', ?, ?)
            `).run(newStockId, tenantId, material.code, material.name, 'RAW_MATERIAL', item.material_id,
              stockQty, newItemUnit, newItemUnit, newUnitCost, now, now)
            stockItem = { id: newStockId }
          }
        }

        if (stockItem) {
          db.prepare(`
            INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
            VALUES (?, ?, ?, 'IN', ?, ?, ?, ?, ?)
          `).run(generateId(), tenantId, stockItem.id,
            addToSealed ? roundQty(sealedPacks * appliedFactor + stockQty) : stockQty, `GR: ${gr.gr_number}`,
            movementNotes, now, userId)

          // เก็บ snapshot สิ่งที่เข้าสต็อกจริง — ยกเลิก GR อ่านค่านี้กลับแทนการคำนวณใหม่
          try {
            db.prepare(`UPDATE goods_receipt_items
              SET stock_item_id = ?, stock_qty = ?, stock_sealed_qty = ?, stock_factor = ?
              WHERE id = ?`).run(
              stockItem.id,
              stockQty,
              addToSealed ? sealedPacks : 0,
              appliedFactor,
              item.id
            )
          } catch (e) {
            console.error('⚠️ could not record GR stock snapshot (migration pending?):', e)
          }
        }
      }

      if (item.accepted_qty > 0) {
        db.prepare('UPDATE purchase_order_items SET received_qty = received_qty + ? WHERE id = ? AND tenant_id = ?')
          .run(item.accepted_qty, item.purchase_order_item_id, tenantId)
      }
    }

    const poItems = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(gr.purchase_order_id) as any[]
    const allReceived = poItems.every((i: any) => i.received_qty >= i.quantity)

    if (allReceived) {
      db.prepare("UPDATE purchase_orders SET status = 'RECEIVED', received_date = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(now, now, gr.purchase_order_id, tenantId)
    } else {
      db.prepare("UPDATE purchase_orders SET status = 'PARTIAL', updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(now, gr.purchase_order_id, tenantId)
    }
  })()

  return db.prepare('SELECT * FROM goods_receipts WHERE id = ? AND tenant_id = ?').get(gr.id, tenantId)
}
