/* Phopy ERP — Testshop demo data TOP-OFF seed (2026-09-09).
 * PURPOSE: the previous extend run (seed_testshop_extend.js, 2026-09-08) used too tight a
 * per-line stock cap (10%) which made Aug10-Sep8 sales_orders/invoices ~16x too small
 * (avg ~1,000/order vs the historical ~16,400/order). This script does NOT delete or touch
 * any existing row. It is purely ADDITIVE:
 *   1) restocks finished goods (extra goods receipts of raw materials + extra completed work
 *      orders) so there is real inventory to sell, and lifts FG-011 off zero stock
 *   2) adds ~30 extra sales_orders + invoices + legacy orders + balanced journal entries +
 *      loyalty_transactions dated within 2026-08-10..2026-09-08, skewed toward larger
 *      corporate baskets (same tiering logic as the original demo seed), sized so the
 *      30-day total lands at roughly +10-15% over the previous-30-day baseline (789,266.4)
 *      instead of -92%.
 * Scoped strictly to tenant_id='Testshop'. Idempotent guard: skips if already run (checks for
 * a marker note on the JOURNAL sequence range it would create).
 * Run: node seed_testshop_topoff.js
 */
const crypto = require('crypto');
const Database = require('/opt/crm/backend/node_modules/better-sqlite3');
const db = new Database('/opt/crm/backend/dev.db');
db.pragma('foreign_keys = OFF');

const T = 'Testshop';
const id = () => crypto.randomBytes(12).toString('hex');
const iso = (t) => new Date(t).toISOString();
const r2 = (n) => Math.round(n * 100) / 100;
const pad = (n, l) => String(n).padStart(l, '0');
const ymd = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`; };
function mul(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const ADMIN_UID = '08f297c733c207d23d53fefe'; // Tester@phopy.com
const TODAY = new Date(); // fictional "today"

const WSTART = new Date('2026-08-10T00:00:00.000Z');
const WEND = new Date('2026-09-08T00:00:00.000Z');
const days = [];
for (let t = +WSTART; t <= +WEND; t += 86400000) days.push(new Date(t));

// ---------- idempotency guard ----------
const already = db.prepare("SELECT COUNT(*) n FROM sales_orders WHERE tenant_id=? AND notes='ปรับยอดขายให้สมเหตุสมผล (top-off 2026-09-09)'").get(T).n;
if (already > 0) {
  console.log(`Already topped-off (${already} marker rows found) — skipping (idempotent).`);
  db.close();
  process.exit(0);
}

const S = { gr: 0, wo: 0, so: 0, inv: 0, orders: 0, journals: 0, jlines: 0, loyalty: 0, stockmv: 0, po: 0 };

const tx = db.transaction(() => {
  // ---------- reference data (live, post any prior runs) ----------
  const cust = db.prepare("SELECT id,code,name,type,loyalty_points,total_spent FROM customers WHERE tenant_id=?").all(T);
  const fg = db.prepare("SELECT id,sku,name,quantity,unit_cost,unit_price FROM stock_items WHERE tenant_id=? AND category='finished'").all(T);
  const fgBySku = {}; fg.forEach(f => fgBySku[f.sku] = f);
  const products = db.prepare("SELECT id,code,name FROM products WHERE tenant_id=?").all(T);
  const fgToProdId = {}; products.forEach(p => { if (fgBySku[p.code]) fgToProdId[fgBySku[p.code].id] = p.id; });
  const raw = db.prepare("SELECT id,sku,name,quantity,unit_cost FROM stock_items WHERE tenant_id=? AND category='raw'").all(T);
  const rawBySku = {}; raw.forEach(r => rawBySku[r.sku] = r);
  const materials = db.prepare("SELECT id,code,name,unit_cost FROM materials WHERE tenant_id=?").all(T);
  const matById = {}; materials.forEach(m => matById[m.id] = m);
  const matIdToRaw = {}; materials.forEach(m => { if (rawBySku[m.code]) matIdToRaw[m.id] = rawBySku[m.code]; });
  const boms = db.prepare("SELECT id,product_id FROM boms WHERE tenant_id=? AND status='ACTIVE'").all(T); // product_id here = stock_item.id (schema quirk, matches original seed script)
  const bomItems = db.prepare("SELECT * FROM bom_items WHERE tenant_id=?").all(T);
  const bomItemsByBom = {}; bomItems.forEach(bi => { (bomItemsByBom[bi.bom_id] = bomItemsByBom[bi.bom_id] || []).push(bi); });
  const suppliers = db.prepare("SELECT id,code,name FROM suppliers WHERE tenant_id=?").all(T);
  const supByCode = {}; suppliers.forEach(s => supByCode[s.code] = s);
  const accCode = {}; db.prepare("SELECT id,code FROM accounts WHERE tenant_id=?").all(T).forEach(a => accCode[a.code] = a.id);
  const A = { CASH: accCode['1101'], BANK: accCode['1102'], AR: accCode['1104'], INV: accCode['1106'], REV: accCode['4101'], VAT: accCode['2104'], COGS: accCode['5101'] };
  const UNITS = [['ONLINE', 0.45], ['RETAIL', 0.30], ['WHOLESALE', 0.20], ['OTHER', 0.05]];
  const pickUnit = rng => { let x = rng(), c = 0; for (const [u, w] of UNITS) { c += w; if (x <= c) return u; } return 'OTHER'; };
  const pickPay = rng => { const x = rng(); return x < 0.4 ? A.CASH : (x < 0.85 ? A.BANK : A.AR); };

  const fgQty = {}; fg.forEach(f => fgQty[f.id] = f.quantity);
  const rawQty = {}; raw.forEach(r => rawQty[r.id] = r.quantity);

  // ---------- starting sequence numbers (live max, continuing from wherever prior runs left off) ----------
  const maxN = (tbl, col, pfx, off) => db.prepare(`SELECT COALESCE(MAX(CAST(substr(${col},${off}) AS INTEGER)),0) m FROM ${tbl} WHERE tenant_id=? AND ${col} LIKE ?`).get(T, pfx + '%').m;
  let soN = maxN('sales_orders', 'so_number', 'SO-2026-', 9);
  let invN = maxN('invoices', 'invoice_number', 'INV-2026-', 10);
  let poN = maxN('purchase_orders', 'po_number', 'PO-', 4);
  let grN = maxN('goods_receipts', 'gr_number', 'GR-2026-', 9);
  let woN = maxN('work_orders', 'wo_number', 'WO-', 4);
  let jSeq2026 = db.prepare("SELECT COALESCE(MAX(CAST(substr(entry_number,9) AS INTEGER)),0) m FROM journal_entries WHERE tenant_id=? AND entry_number LIKE 'JV-2026-%'").get(T).m;
  const nextJ = () => ++jSeq2026;
  // per-day legacy order counter — continue from whatever the extend run already used for these dates
  const orderDaySeq = {};
  days.forEach(d => {
    const dstr = ymd(+d); const dc = Number(dstr.replace(/-/g, ''));
    const row = db.prepare("SELECT last_number FROM document_sequences WHERE tenant_id=? AND doc_type='ORDER' AND year=?").get(T, dc);
    orderDaySeq[dstr] = row ? row.last_number - 9000 : 0; // stored as 9000+n
  });

  // ---------- prepared statements (same shapes as seed_testshop_extend.js) ----------
  const insOrder = db.prepare(`INSERT INTO orders (id,order_number,customer_id,order_date,delivery_date,subtotal,total_amount,status,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insOI = db.prepare(`INSERT INTO order_items (id,order_id,product_id,quantity,unit_price,total_price) VALUES (?,?,?,?,?,?)`);
  const insSO = db.prepare(`INSERT INTO sales_orders (id,tenant_id,so_number,quotation_id,customer_id,order_date,delivery_date,subtotal,discount_amount,tax_rate,tax_amount,total_amount,status,payment_status,notes,created_by,approved_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insSOI = db.prepare(`INSERT INTO sales_order_items (id,tenant_id,sales_order_id,stock_item_id,product_id,product_name,quotation_item_id,quantity,delivered_qty,unit_price,discount_percent,total_price,notes,unit) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insInv = db.prepare(`INSERT INTO invoices (id,tenant_id,invoice_number,sales_order_id,customer_id,invoice_date,due_date,subtotal,discount_amount,tax_rate,tax_amount,total_amount,paid_amount,balance_amount,status,payment_status,notes,created_by,created_at,updated_at,currency_code,exchange_rate) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insJE = db.prepare(`INSERT INTO journal_entries (id,tenant_id,entry_number,date,reference_type,reference_id,source_number,so_number,description,total_debit,total_credit,is_auto_generated,is_posted,notes,created_by,created_at,updated_at,is_closing_entry,business_unit) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insJL = db.prepare(`INSERT INTO journal_lines (id,tenant_id,journal_entry_id,account_id,line_number,description,debit,credit) VALUES (?,?,?,?,?,?,?,?)`);
  const insLoy = db.prepare(`INSERT INTO loyalty_transactions (id,tenant_id,customer_id,type,points,balance_after,reference_type,reference_id,note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insMv = db.prepare(`INSERT INTO stock_movements (id,tenant_id,stock_item_id,type,quantity,movement_unit,movement_quantity,reference,notes,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const updQty = db.prepare(`UPDATE stock_items SET quantity=?, updated_at=? WHERE id=? AND tenant_id=?`);
  const insPO = db.prepare(`INSERT INTO purchase_orders (id,tenant_id,po_number,supplier_id,status,order_date,expected_date,received_date,subtotal,tax_rate,tax_amount,total_amount,notes,created_by,approved_by,created_at,updated_at,currency_code,exchange_rate) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insPOI = db.prepare(`INSERT INTO purchase_order_items (id,tenant_id,purchase_order_id,material_id,description,quantity,unit_price,total_price,received_qty,notes,unit) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insGR = db.prepare(`INSERT INTO goods_receipts (id,tenant_id,gr_number,purchase_order_id,supplier_id,receipt_date,received_by,status,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insGRI = db.prepare(`INSERT INTO goods_receipt_items (id,tenant_id,goods_receipt_id,purchase_order_item_id,material_id,ordered_qty,received_qty,accepted_qty,rejected_qty,lot_number,location,notes,stock_item_id,stock_qty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insWO = db.prepare(`INSERT INTO work_orders (id,tenant_id,wo_number,bom_id,product_name,quantity,completed_qty,scrap_qty,status,priority,start_date,due_date,completed_date,assigned_to,notes,estimated_cost,actual_cost,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insWOM = db.prepare(`INSERT INTO work_order_materials (id,tenant_id,work_order_id,material_id,material_name,required_qty,issued_qty,status,unit) VALUES (?,?,?,?,?,?,?,?,?)`);
  const upSeq = db.prepare(`INSERT INTO document_sequences (tenant_id,doc_type,year,last_number,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(tenant_id,doc_type,year) DO UPDATE SET last_number=excluded.last_number, updated_at=excluded.updated_at`);

  function postJournal(dateStr, unit, refId, srcNum, desc, lines) {
    const tdb = r2(lines.reduce((s, l) => s + l.debit, 0)), tc = r2(lines.reduce((s, l) => s + l.credit, 0));
    if (Math.abs(tdb - tc) > 0.01) throw new Error('UNBALANCED journal ' + desc + ' ' + tdb + ' vs ' + tc);
    const jid = id(); const now = iso(Date.now());
    insJE.run(jid, T, 'JV-2026-' + pad(nextJ(), 5), dateStr, 'INVOICE', refId, srcNum, null, desc, tdb, tc, 1, 1, null, 'system', now, now, 0, unit);
    lines.forEach((l, i) => insJL.run(id(), T, jid, l.acc, i + 1, l.desc, r2(l.debit), r2(l.credit)));
    S.journals++; S.jlines += lines.length;
  }

  function moveStock(stockItemId, isFg, delta, type, ref, note, tms) {
    const tracker = isFg ? fgQty : rawQty;
    const nq = r2(tracker[stockItemId] + delta);
    if (nq < 0) throw new Error('NEGATIVE stock for ' + stockItemId + ' delta=' + delta + ' have=' + tracker[stockItemId]);
    tracker[stockItemId] = nq;
    updQty.run(nq, iso(tms), stockItemId, T);
    insMv.run(id(), T, stockItemId, type, Math.abs(delta), null, null, ref, note, iso(tms), 'system');
    S.stockmv++;
  }

  // ============ STEP 1: extra raw-material purchases + receipts (buffer stock for production) ============
  // needed (with ~10-15% buffer) to cover the WO batches in step 2, on top of current raw stock.
  const rawTopUp = [
    ['MAT-001', 'SUP-003', 1900], ['MAT-002', 'SUP-002', 2450], ['MAT-004', 'SUP-006', 1200],
    ['MAT-005', 'SUP-004', 2700], ['MAT-006', 'SUP-004', 3300], ['MAT-007', 'SUP-005', 3660], ['MAT-008', 'SUP-005', 2350],
  ];
  const grDate = +new Date('2026-08-09T09:00:00.000Z');
  for (const [matSku, supCode, qty] of rawTopUp) {
    const m = materials.find(x => x.code === matSku); const sup = supByCode[supCode]; const rawItem = rawBySku[matSku];
    poN++; const ponum = 'PO-' + pad(poN, 4); const poid = id();
    const unitPrice = m.unit_cost * 1.02; const sub = r2(qty * unitPrice); const vat = r2(sub * 0.07); const total = r2(sub + vat);
    insPO.run(poid, T, ponum, sup.id, 'RECEIVED', iso(grDate), iso(grDate + 3 * 86400000), iso(grDate + 1 * 86400000), sub, 7, vat, total, 'สั่งซื้อวัตถุดิบเพิ่ม รองรับยอดขายที่เติบโต (top-off)', ADMIN_UID, ADMIN_UID, iso(grDate), iso(Date.now()), 'THB', 1);
    const poiId = id();
    insPOI.run(poiId, T, poid, m.id, m.name, qty, unitPrice, sub, qty, null, 'pcs');
    S.po++;
    grN++; const grnum = 'GR-2026-' + pad(grN, 5); const grid = id(); const rt = grDate + 1 * 86400000;
    insGR.run(grid, T, grnum, poid, sup.id, iso(rt), ADMIN_UID, 'CONFIRMED', 'รับวัตถุดิบเข้าคลัง รองรับยอดขายที่เติบโต (top-off)', iso(rt), iso(rt));
    insGRI.run(id(), T, grid, poiId, m.id, qty, qty, qty, 0, null, 'Main Warehouse', null, rawItem.id, qty);
    S.gr++;
    moveStock(rawItem.id, false, qty, 'IN', grnum, `รับของ ${grnum} (top-off)`, rt);
  }

  // ============ STEP 2: extra completed work orders (produce finished goods) ============
  function makeWO(dateOffsetMs, productSku, qty) {
    const t = grDate + dateOffsetMs; const fgItem = fgBySku[productSku];
    const bom = boms.find(b => b.product_id === fgItem.id);
    const items = bom ? (bomItemsByBom[bom.id] || []) : [];
    woN++; const wonum = 'WO-' + pad(woN, 4); const woid = id();
    const estCost = r2(items.reduce((s, bi) => { const rawItem = matIdToRaw[bi.material_id]; return s + (rawItem ? rawItem.unit_cost * bi.quantity * qty : 0); }, 0));
    insWO.run(woid, T, wonum, bom ? bom.id : null, fgItem.name, qty, qty, 0, 'COMPLETED', 'NORMAL', ymd(t), ymd(t + 4 * 86400000), ymd(t + 4 * 86400000), 'Tester@phopy.com', 'ผลิตเพิ่มรองรับยอดขายที่เติบโต (top-off)', estCost, estCost, iso(t), iso(Date.now()));
    items.forEach(bi => {
      const reqQty = bi.quantity * qty;
      insWOM.run(id(), T, woid, bi.material_id, matById[bi.material_id] ? matById[bi.material_id].name : null, reqQty, reqQty, 'ISSUED', bi.unit);
      const rawItem = matIdToRaw[bi.material_id];
      if (rawItem) moveStock(rawItem.id, false, -reqQty, 'OUT', wonum, `เบิกวัตถุดิบผลิต ${wonum}`, t);
    });
    moveStock(fgItem.id, true, qty, 'IN', wonum, `ผลิตเสร็จ ${wonum} (top-off)`, t + 4 * 86400000);
    S.wo++;
  }
  const DAY = 86400000;
  makeWO(1 * DAY, 'FG-001', 450);
  makeWO(2 * DAY, 'FG-002', 325);
  makeWO(3 * DAY, 'FG-003', 240);
  makeWO(4 * DAY, 'FG-005', 15);
  makeWO(4 * DAY, 'FG-011', 12);
  makeWO(11 * DAY, 'FG-001', 450);
  makeWO(12 * DAY, 'FG-002', 325);
  makeWO(13 * DAY, 'FG-003', 240);

  // ============ STEP 3: extra sales — bigger, mostly-corporate baskets, Aug10..Sep8 ============
  const rngSales = mul(55221);
  const custTier = c => c.type === 'CORPORATE' ? { min: 15000, max: 45000 } : c.type === 'RETAIL' ? { min: 4000, max: 12000 } : { min: 1000, max: 4500 };
  const pickCustomer = rng => { const x = rng(); const type = x < 0.68 ? 'CORPORATE' : x < 0.88 ? 'RETAIL' : 'INDIVIDUAL'; const pool = cust.filter(c => c.type === type); return pool[Math.floor(rng() * pool.length)] || cust[Math.floor(rng() * cust.length)]; };
  const loyaltyBal = {}; cust.forEach(c => loyaltyBal[c.id] = c.loyalty_points || 0);
  const REPLENISHED = ['FG-001', 'FG-002', 'FG-003', 'FG-005', 'FG-011'];
  function pickFgWeighted(rng) {
    const pool = REPLENISHED.map(sku => fgBySku[sku]).filter(f => f && fgQty[f.id] > 0);
    const weights = pool.map(f => Math.sqrt(fgQty[f.id]));
    const total = weights.reduce((a, b) => a + b, 0);
    let x = rng() * total, c = 0;
    for (let i = 0; i < pool.length; i++) { c += weights[i]; if (x <= c) return pool[i]; }
    return pool[pool.length - 1];
  }
  function makeLines(rng, target) {
    const n = 1 + Math.floor(rng() * 3); const used = new Set(); const L = []; let sub = 0;
    for (let k = 0; k < n; k++) {
      let f = pickFgWeighted(rng); let g = 0;
      while (f && (used.has(f.id) || fgQty[f.id] < 1) && g++ < 12) f = pickFgWeighted(rng);
      if (!f || fgQty[f.id] < 1) continue;
      used.add(f.id);
      const price = f.unit_price || (f.unit_cost * 1.9);
      let desiredQty = Math.max(1, Math.round((target / n) / price));
      const cap = Math.max(1, Math.floor(fgQty[f.id] * 0.25)); // restored cap — safe now that stock is replenished
      const qty = Math.max(1, Math.min(desiredQty, cap, fgQty[f.id]));
      const tot = r2(qty * price); sub += tot;
      L.push({ f, qty, price, tot, cogs: r2(qty * f.unit_cost) });
    }
    return { L, sub: r2(sub) };
  }

  const N_EXTRA = 30;
  for (let i = 0; i < N_EXTRA; i++) {
    const d = days[Math.floor(rngSales() * days.length)];
    const c = pickCustomer(rngSales);
    const tier = custTier(c);
    const target = tier.min + Math.floor(rngSales() * (tier.max - tier.min));
    const { L, sub } = makeLines(rngSales, target);
    if (!L.length) continue;
    const vat = r2(sub * 0.07), total = r2(sub + vat);
    const cogsTotal = r2(L.reduce((s, l) => s + l.cogs, 0));
    const t = +d + Math.floor(rngSales() * 10 * 3600000) + 9 * 3600000;
    const unit = pickUnit(rngSales); const payAcc = pickPay(rngSales);
    const dstr = ymd(t);

    const ageDays = (TODAY - t) / 86400000;
    const roll = rngSales();
    let invStatus, paid, bal, payStatus, soStatus;
    if (ageDays > 25) { if (roll < 0.85) { invStatus = 'PAID'; paid = total; bal = 0; payStatus = 'PAID'; soStatus = 'COMPLETED'; } else if (roll < 0.95) { invStatus = 'OVERDUE'; paid = 0; bal = total; payStatus = 'UNPAID'; soStatus = 'DELIVERED'; } else { invStatus = 'ISSUED'; paid = 0; bal = total; payStatus = 'UNPAID'; soStatus = 'READY'; } }
    else if (ageDays > 10) { if (roll < 0.55) { invStatus = 'PAID'; paid = total; bal = 0; payStatus = 'PAID'; soStatus = 'COMPLETED'; } else if (roll < 0.80) { invStatus = 'OVERDUE'; paid = 0; bal = total; payStatus = 'UNPAID'; soStatus = 'DELIVERED'; } else { invStatus = 'ISSUED'; paid = 0; bal = total; payStatus = 'UNPAID'; soStatus = 'PROCESSING'; } }
    else { if (roll < 0.30) { invStatus = 'PAID'; paid = total; bal = 0; payStatus = 'PAID'; soStatus = 'COMPLETED'; } else if (roll < 0.90) { invStatus = 'ISSUED'; paid = 0; bal = total; payStatus = 'UNPAID'; soStatus = 'CONFIRMED'; } else { invStatus = 'ISSUED'; paid = r2(total * 0.4); bal = r2(total - paid); payStatus = 'PARTIAL'; soStatus = 'PARTIAL'; } }

    soN++; const sonum = 'SO-2026-' + pad(soN, 5); const soid = id();
    insSO.run(soid, T, sonum, null, c.id, iso(t), iso(t + 5 * 86400000), sub, 0, 7, vat, total, soStatus, payStatus, 'ปรับยอดขายให้สมเหตุสมผล (top-off 2026-09-09)', 'system', soStatus === 'COMPLETED' ? 'system' : null, iso(t), iso(Date.now()));
    L.forEach(l => insSOI.run(id(), T, soid, l.f.id, fgToProdId[l.f.id] || null, l.f.name, null, l.qty, l.qty, l.price, 0, l.tot, null, 'ชิ้น'));
    S.so++;

    invN++; const invnum = 'INV-2026-' + pad(invN, 5); const iid = id();
    insInv.run(iid, T, invnum, soid, c.id, iso(t + 86400000), iso(t + 16 * 86400000), sub, 0, 7, vat, total, paid, bal, invStatus, payStatus, 'ปรับยอดขายให้สมเหตุสมผล (top-off 2026-09-09)', 'system', iso(t), iso(Date.now()), 'THB', 1);
    S.inv++;

    orderDaySeq[dstr] = (orderDaySeq[dstr] || 0) + 1; const oid = id();
    insOrder.run(oid, 'ORD-' + dstr.replace(/-/g, '') + '-' + pad(9000 + orderDaySeq[dstr], 4), c.id, iso(t), ymd(t + 3 * 86400000), sub, total, soStatus === 'COMPLETED' ? 'DELIVERED' : 'PROCESSING', 'ปรับยอดขายให้สมเหตุสมผล (top-off)', iso(t), iso(t));
    L.forEach(l => insOI.run(id(), oid, fgToProdId[l.f.id] || l.f.id, l.qty, l.price, l.tot));
    S.orders++;

    L.forEach(l => moveStock(l.f.id, true, -l.qty, 'OUT', invnum, `ขาย ${invnum} (top-off)`, t));

    postJournal(dstr, unit, iid, invnum, `ขายสินค้า ${invnum} (${unit}) (top-off)`, [
      ...(paid > 0 ? [{ acc: payAcc, debit: paid, credit: 0, desc: 'รับชำระ' }] : []),
      ...(bal > 0 ? [{ acc: A.AR, debit: bal, credit: 0, desc: 'ลูกหนี้การค้าคงค้าง' }] : []),
      { acc: A.REV, debit: 0, credit: sub, desc: 'รายได้ขายสินค้า' },
      { acc: A.VAT, debit: 0, credit: vat, desc: 'ภาษีขาย' },
      { acc: A.COGS, debit: cogsTotal, credit: 0, desc: 'ต้นทุนสินค้าขาย' },
      { acc: A.INV, debit: 0, credit: cogsTotal, desc: 'ตัดสต็อกสินค้า' },
    ]);

    const pts = Math.max(1, Math.round(total * 0.02)); loyaltyBal[c.id] += pts;
    insLoy.run(id(), T, c.id, 'EARN', pts, loyaltyBal[c.id], 'ORDER', invnum, `ได้รับแต้มจากการซื้อ ฿${Math.round(total).toLocaleString()}`, 'system', iso(t));
    S.loyalty++;
  }

  // ---------- refresh customers cache ----------
  cust.forEach(c => {
    const spent = db.prepare("SELECT COALESCE(SUM(total_amount),0) v FROM orders WHERE customer_id=?").get(c.id).v;
    db.prepare("UPDATE customers SET total_spent=?, loyalty_points=?, updated_at=? WHERE id=? AND tenant_id=?").run(r2(spent), loyaltyBal[c.id], iso(Date.now()), c.id, T);
  });

  // ---------- document_sequences sync ----------
  const now2 = iso(Date.now());
  upSeq.run(T, 'SALES_ORDER', 2026, soN, now2);
  upSeq.run(T, 'INVOICE', 2026, invN, now2);
  upSeq.run(T, 'JOURNAL', 2026, jSeq2026, now2);
  upSeq.run(T, 'PO', 2026, poN, now2);
  upSeq.run(T, 'GOODS_RECEIPT', 2026, grN, now2);
  upSeq.run(T, 'WORK_ORDER', 2026, woN, now2);
  Object.keys(orderDaySeq).forEach(dstr => {
    const dc = Number(dstr.replace(/-/g, ''));
    upSeq.run(T, 'ORDER', dc, 9000 + orderDaySeq[dstr], now2);
  });
});

tx();
db.pragma('wal_checkpoint(TRUNCATE)');
console.log('TOP-OFF SEED DONE', JSON.stringify(S));
db.close();
