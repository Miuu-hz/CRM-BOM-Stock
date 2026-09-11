/* Phopy ERP — Testshop demo data EXTENSION seed.
 * Extends existing Testshop demo data (last touched 2026-08-02) forward to "today"
 * so every dashboard/report filtered by "this month" / "last 30 days" has data.
 * ADDITIVE ONLY: never deletes/overwrites existing rows. Scoped strictly to tenant_id='Testshop'.
 * Idempotent: guarded by a pos_daily_sales date-range check — safe to re-run.
 * Run: node seed_testshop_extend.js
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
const ymd = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate() + 0, 2)}`; };
const ymdc = (t) => ymd(t).replace(/-/g, '');
function mul(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const ADMIN_UID = '08f297c733c207d23d53fefe'; // Tester@phopy.com

const START = new Date('2026-08-03T00:00:00.000Z');
const TODAY = new Date(); // server clock is set to the fictional "today" (2026-09-08)
const days = [];
for (let t = +START; t <= +new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate()); t += 86400000) days.push(new Date(t));

// ---------- idempotency guard ----------
const startC = ymdc(START), endC = ymdc(TODAY);
const already = db.prepare("SELECT COUNT(*) n FROM pos_daily_sales WHERE tenant_id=? AND sales_date>=? AND sales_date<=?").get(T, startC, endC).n;
if (already >= days.length) {
  console.log(`Already seeded ${already}/${days.length} days for ${startC}..${endC} — skipping (idempotent).`);
  db.close();
  process.exit(0);
}
console.log(`Seeding ${days.length} days (${startC}..${endC}). Existing pos_daily_sales in range: ${already}.`);

const S = { pos: 0, so: 0, inv: 0, orders: 0, journals: 0, jlines: 0, loyalty: 0, quotations: 0, pr: 0, po: 0, gr: 0, wo: 0, activity: 0, recs: 0, opex: 0, stockmv: 0 };

const tx = db.transaction(() => {
  // ---------- reference data ----------
  const cust = db.prepare("SELECT id,code,name,type,loyalty_points,total_spent FROM customers WHERE tenant_id=?").all(T);
  const fg = db.prepare("SELECT id,sku,name,quantity,unit_cost,unit_price,min_stock,max_stock FROM stock_items WHERE tenant_id=? AND category='finished'").all(T);
  const raw = db.prepare("SELECT id,sku,name,quantity,unit_cost,min_stock,max_stock FROM stock_items WHERE tenant_id=? AND category='raw'").all(T);
  const rawBySku = {}; raw.forEach(r => rawBySku[r.sku] = r);
  const materials = db.prepare("SELECT id,code,name,unit_cost FROM materials WHERE tenant_id=?").all(T);
  const matIdToRaw = {}; materials.forEach(m => { if (rawBySku[m.code]) matIdToRaw[m.id] = rawBySku[m.code]; });
  const products = db.prepare("SELECT id,code,name FROM products WHERE tenant_id=?").all(T);
  const fgBySku = {}; fg.forEach(f => fgBySku[f.sku] = f);
  const prodIdToFg = {}; products.forEach(p => { if (fgBySku[p.code]) prodIdToFg[p.id] = fgBySku[p.code]; });
  const fgToProdId = {}; products.forEach(p => { if (fgBySku[p.code]) fgToProdId[fgBySku[p.code].id] = p.id; });
  const boms = db.prepare("SELECT id,product_id FROM boms WHERE tenant_id=? AND status='ACTIVE'").all(T);
  const bomItems = db.prepare("SELECT * FROM bom_items WHERE tenant_id=?").all(T);
  const bomItemsByBom = {}; bomItems.forEach(bi => { (bomItemsByBom[bi.bom_id] = bomItemsByBom[bi.bom_id] || []).push(bi); });
  const suppliers = db.prepare("SELECT id,code,name FROM suppliers WHERE tenant_id=?").all(T);
  const accCode = {}; db.prepare("SELECT id,code FROM accounts WHERE tenant_id=?").all(T).forEach(a => accCode[a.code] = a.id);
  const A = { CASH: accCode['1101'], BANK: accCode['1102'], AR: accCode['1104'], INV: accCode['1106'], REV: accCode['4101'], VAT: accCode['2104'], COGS: accCode['5101'] };
  const EXP = { rent: accCode['5302'], salary: accCode['5301'], util: accCode['5303'], mkt: accCode['5201'] };
  const UNITS = [['ONLINE', 0.45], ['RETAIL', 0.30], ['WHOLESALE', 0.20], ['OTHER', 0.05]];
  const pickUnit = rng => { let x = rng(), c = 0; for (const [u, w] of UNITS) { c += w; if (x <= c) return u; } return 'OTHER'; };
  const pickPay = rng => { const x = rng(); return x < 0.4 ? A.CASH : (x < 0.85 ? A.BANK : A.AR); };

  // in-memory stock trackers (kept in sync with DB writes below)
  const fgQty = {}; fg.forEach(f => fgQty[f.id] = f.quantity);
  const rawQty = {}; raw.forEach(r => rawQty[r.id] = r.quantity);

  // ---------- starting sequence numbers (derived from actual max used, not from document_sequences legacy rows) ----------
  const maxN = (tbl, col, pfx, off) => db.prepare(`SELECT COALESCE(MAX(CAST(substr(${col},${off}) AS INTEGER)),0) m FROM ${tbl} WHERE tenant_id=? AND ${col} LIKE ?`).get(T, pfx + '%').m;
  let soN = maxN('sales_orders', 'so_number', 'SO-2026-', 9);
  let invN = maxN('invoices', 'invoice_number', 'INV-2026-', 10);
  let qtN = maxN('quotations', 'quotation_number', 'QT-2026-', 9);
  let poN = maxN('purchase_orders', 'po_number', 'PO-', 4);
  let prN = maxN('purchase_requests', 'pr_number', 'PR-2026-', 9);
  let grN = maxN('goods_receipts', 'gr_number', 'GR-2026-', 9);
  let woN = maxN('work_orders', 'wo_number', 'WO-', 4);
  const jSeq = {}; const nextJ = (y) => { if (jSeq[y] == null) jSeq[y] = db.prepare("SELECT COALESCE(MAX(CAST(substr(entry_number,9) AS INTEGER)),0) m FROM journal_entries WHERE tenant_id=? AND entry_number LIKE ?").get(T, 'JV-' + y + '-%').m; return ++jSeq[y]; };
  const orderDaySeq = {}; // per-day legacy order counter, matches original scheme (starts at 9001/day)

  // ---------- prepared statements ----------
  const insPos = db.prepare(`INSERT INTO pos_daily_sales (id,tenant_id,summary_number,sales_date,total_revenue,total_tax,total_service_charge,total_discount,estimated_cogs,net_profit,cash_amount,bank_amount,other_amount,bill_count,notes,closed_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insOrder = db.prepare(`INSERT INTO orders (id,order_number,customer_id,order_date,delivery_date,subtotal,total_amount,status,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insOI = db.prepare(`INSERT INTO order_items (id,order_id,product_id,quantity,unit_price,total_price) VALUES (?,?,?,?,?,?)`);
  const insSO = db.prepare(`INSERT INTO sales_orders (id,tenant_id,so_number,quotation_id,customer_id,order_date,delivery_date,subtotal,discount_amount,tax_rate,tax_amount,total_amount,status,payment_status,notes,created_by,approved_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insSOI = db.prepare(`INSERT INTO sales_order_items (id,tenant_id,sales_order_id,stock_item_id,product_id,product_name,quotation_item_id,quantity,delivered_qty,unit_price,discount_percent,total_price,notes,unit) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insInv = db.prepare(`INSERT INTO invoices (id,tenant_id,invoice_number,sales_order_id,customer_id,invoice_date,due_date,subtotal,discount_amount,tax_rate,tax_amount,total_amount,paid_amount,balance_amount,status,payment_status,notes,created_by,created_at,updated_at,currency_code,exchange_rate) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insJE = db.prepare(`INSERT INTO journal_entries (id,tenant_id,entry_number,date,reference_type,reference_id,source_number,so_number,description,total_debit,total_credit,is_auto_generated,is_posted,notes,created_by,created_at,updated_at,is_closing_entry,business_unit) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insJL = db.prepare(`INSERT INTO journal_lines (id,tenant_id,journal_entry_id,account_id,line_number,description,debit,credit) VALUES (?,?,?,?,?,?,?,?)`);
  const insLoy = db.prepare(`INSERT INTO loyalty_transactions (id,tenant_id,customer_id,type,points,balance_after,reference_type,reference_id,note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insMv = db.prepare(`INSERT INTO stock_movements (id,tenant_id,stock_item_id,type,quantity,movement_unit,movement_quantity,reference,notes,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const updFgQty = db.prepare(`UPDATE stock_items SET quantity=?, updated_at=? WHERE id=? AND tenant_id=?`);
  const updRawQty = updFgQty;
  const insQT = db.prepare(`INSERT INTO quotations (id,tenant_id,quotation_number,customer_id,quotation_date,expiry_date,subtotal,discount_amount,tax_rate,tax_amount,total_amount,status,notes,created_by,approved_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insQTI = db.prepare(`INSERT INTO quotation_items (id,tenant_id,quotation_id,stock_item_id,product_id,product_name,quantity,unit_price,discount_percent,total_price,notes,unit) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insPR = db.prepare(`INSERT INTO purchase_requests (id,tenant_id,pr_number,requester_id,requester_name,department,request_date,required_date,total_amount,status,priority,notes,approved_by,approved_date,created_at,updated_at,supplier_name,source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insPRI = db.prepare(`INSERT INTO purchase_request_items (id,tenant_id,purchase_request_id,material_id,description,quantity,unit,estimated_unit_price,estimated_total_price,notes,pr_id,item_name,sort_order,unit_price) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insPO = db.prepare(`INSERT INTO purchase_orders (id,tenant_id,po_number,supplier_id,status,order_date,expected_date,received_date,subtotal,tax_rate,tax_amount,total_amount,notes,created_by,approved_by,created_at,updated_at,currency_code,exchange_rate) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insPOI = db.prepare(`INSERT INTO purchase_order_items (id,tenant_id,purchase_order_id,material_id,description,quantity,unit_price,total_price,received_qty,notes,unit) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insGR = db.prepare(`INSERT INTO goods_receipts (id,tenant_id,gr_number,purchase_order_id,supplier_id,receipt_date,received_by,status,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insGRI = db.prepare(`INSERT INTO goods_receipt_items (id,tenant_id,goods_receipt_id,purchase_order_item_id,material_id,ordered_qty,received_qty,accepted_qty,rejected_qty,lot_number,location,notes,stock_item_id,stock_qty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insWO = db.prepare(`INSERT INTO work_orders (id,tenant_id,wo_number,bom_id,product_name,quantity,completed_qty,scrap_qty,status,priority,start_date,due_date,completed_date,assigned_to,notes,estimated_cost,actual_cost,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insWOM = db.prepare(`INSERT INTO work_order_materials (id,tenant_id,work_order_id,material_id,material_name,required_qty,issued_qty,status,unit) VALUES (?,?,?,?,?,?,?,?,?)`);
  const insAct = db.prepare(`INSERT INTO activity_logs (id,customer_id,type,note,created_by,tenant_id,created_at) VALUES (?,?,?,?,?,?,?)`);
  const insRec = db.prepare(`INSERT INTO customer_recommendations (id,tenant_id,customer_id,product_id,product_name,product_category,reason,priority,status,offered_at,offered_by,notes,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  function postJournal(dateStr, unit, refType, refId, srcNum, desc, lines) {
    const tdb = r2(lines.reduce((s, l) => s + l.debit, 0)), tc = r2(lines.reduce((s, l) => s + l.credit, 0));
    if (Math.abs(tdb - tc) > 0.01) throw new Error('UNBALANCED journal ' + desc + ' ' + tdb + ' vs ' + tc);
    const y = dateStr.slice(0, 4); const jid = id(); const now = iso(Date.now());
    insJE.run(jid, T, 'JV-' + y + '-' + pad(nextJ(y), 5), dateStr, refType, refId, srcNum, null, desc, tdb, tc, 1, 1, null, 'system', now, now, 0, unit);
    lines.forEach((l, i) => insJL.run(id(), T, jid, l.acc, i + 1, l.desc, r2(l.debit), r2(l.credit)));
    S.journals++; S.jlines += lines.length;
  }

  function moveStock(stockItemId, isFg, delta, type, ref, note, tms) {
    const tracker = isFg ? fgQty : rawQty;
    const nq = r2(tracker[stockItemId] + delta);
    if (nq < 0) throw new Error('NEGATIVE stock for ' + stockItemId + ' delta=' + delta);
    tracker[stockItemId] = nq;
    (isFg ? updFgQty : updRawQty).run(nq, iso(tms), stockItemId, T);
    insMv.run(id(), T, stockItemId, type, Math.abs(delta), null, null, ref, note, iso(tms), 'system');
    S.stockmv++;
  }

  // weighted pick: items with more stock get picked more often (protects already-low items)
  function pickFgWeighted(rng) {
    const weights = fg.map(f => Math.sqrt(Math.max(fgQty[f.id], 0) + 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let x = rng() * total, c = 0;
    for (let i = 0; i < fg.length; i++) { c += weights[i]; if (x <= c) return fg[i]; }
    return fg[fg.length - 1];
  }

  function makeLines(rng, target) {
    const n = 1 + Math.floor(rng() * 3); const used = new Set(); const L = []; let sub = 0;
    for (let k = 0; k < n; k++) {
      let f = pickFgWeighted(rng); let g = 0;
      while ((used.has(f.id) || fgQty[f.id] < 1) && g++ < 12) f = pickFgWeighted(rng);
      if (fgQty[f.id] < 1) continue;
      used.add(f.id);
      const price = f.unit_price || (f.unit_cost * 1.9);
      let desiredQty = Math.max(1, Math.round((target / n) / price));
      const cap = Math.max(1, Math.floor(fgQty[f.id] * 0.10)); // gentle depletion — leave headroom for 37 days of sales
      const qty = Math.max(1, Math.min(desiredQty, cap, fgQty[f.id]));
      const tot = r2(qty * price); sub += tot;
      L.push({ f, qty, price, tot, cogs: r2(qty * f.unit_cost) });
    }
    return { L, sub: r2(sub) };
  }

  // ============ 1) POS daily sales — one row per day, no gaps ============
  const rngPos = mul(7001);
  for (const d of days) {
    const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    const base = (isWeekend ? 22000 : 15000) * (0.6 + rngPos() * 0.9);
    const revenue = r2(base);
    const tax = r2(revenue * 0.0654);
    const discount = r2(revenue * (0.03 + rngPos() * 0.07));
    const cogs = r2(revenue * (0.52 + rngPos() * 0.10));
    const netProfit = r2(revenue - cogs - discount);
    const cashPct = 0.35 + rngPos() * 0.15, otherPct = 0.02 + rngPos() * 0.03;
    const cash = r2(revenue * cashPct), other = r2(revenue * otherPct), bank = r2(revenue - cash - other);
    const billCount = Math.round((isWeekend ? 38 : 26) * (0.7 + rngPos() * 0.6));
    const dc = ymdc(+d);
    insPos.run(id(), T, `POS-SUM-${dc}-001`, dc, revenue, tax, 0, discount, cogs, netProfit, cash, bank, other, billCount, null, 'Tester@phopy.com', iso(+d + 20 * 3600000 + 59 * 60000 + 37000));
    db.prepare(`INSERT INTO document_sequences (tenant_id,doc_type,year,last_number,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(tenant_id,doc_type,year) DO UPDATE SET last_number=excluded.last_number, updated_at=excluded.updated_at`).run(T, 'POS_DAILY_SALES', Number(dc), 1, iso(Date.now()));
    S.pos++;
  }

  // ============ 2) Sales orders + invoices + legacy orders + journals + loyalty (day by day) ============
  const rngSales = mul(8002);
  const custTier = c => c.type === 'CORPORATE' ? { min: 15000, max: 45000 } : c.type === 'RETAIL' ? { min: 2000, max: 9000 } : { min: 500, max: 3500 };
  const pickCustomer = rng => { const x = rng(); const type = x < 0.15 ? 'CORPORATE' : x < 0.55 ? 'RETAIL' : 'INDIVIDUAL'; const pool = cust.filter(c => c.type === type); return pool[Math.floor(rng() * pool.length)] || cust[Math.floor(rng() * cust.length)]; };
  const loyaltyBal = {}; cust.forEach(c => loyaltyBal[c.id] = c.loyalty_points || 0);
  const monthGross = {}; // 'YYYY-MM' -> {net,cogs}

  for (const d of days) {
    const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    const nSales = isWeekend ? 2 + Math.floor(rngSales() * 3) : 1 + Math.floor(rngSales() * 2);
    const dstr = ymd(+d);
    const monKey = dstr.slice(0, 7);
    monthGross[monKey] = monthGross[monKey] || { net: 0, cogs: 0 };
    const daySeqKey = dstr; orderDaySeq[daySeqKey] = orderDaySeq[daySeqKey] || 0;

    for (let k = 0; k < nSales; k++) {
      const c = pickCustomer(rngSales);
      const tier = custTier(c);
      const target = tier.min + Math.floor(rngSales() * (tier.max - tier.min));
      const { L, sub } = makeLines(rngSales, target);
      if (!L.length) continue;
      const vat = r2(sub * 0.07), total = r2(sub + vat);
      const cogsTotal = r2(L.reduce((s, l) => s + l.cogs, 0));
      monthGross[monKey].net += sub; monthGross[monKey].cogs += cogsTotal;
      const t = +d + Math.floor(rngSales() * 10 * 3600000) + 9 * 3600000; // sometime during business hours
      const unit = pickUnit(rngSales); const payAcc = pickPay(rngSales);

      // aging-aware payment status
      const ageDays = (TODAY - t) / 86400000;
      const roll = rngSales();
      let invStatus, paid, bal, payStatus, soStatus;
      if (ageDays > 25) { if (roll < 0.85) { invStatus = 'PAID'; paid = total; bal = 0; payStatus = 'PAID'; soStatus = 'COMPLETED'; } else if (roll < 0.95) { invStatus = 'OVERDUE'; paid = 0; bal = total; payStatus = 'UNPAID'; soStatus = 'DELIVERED'; } else { invStatus = 'ISSUED'; paid = 0; bal = total; payStatus = 'UNPAID'; soStatus = 'READY'; } }
      else if (ageDays > 10) { if (roll < 0.55) { invStatus = 'PAID'; paid = total; bal = 0; payStatus = 'PAID'; soStatus = 'COMPLETED'; } else if (roll < 0.80) { invStatus = 'OVERDUE'; paid = 0; bal = total; payStatus = 'UNPAID'; soStatus = 'DELIVERED'; } else { invStatus = 'ISSUED'; paid = 0; bal = total; payStatus = 'UNPAID'; soStatus = 'PROCESSING'; } }
      else { if (roll < 0.30) { invStatus = 'PAID'; paid = total; bal = 0; payStatus = 'PAID'; soStatus = 'COMPLETED'; } else if (roll < 0.90) { invStatus = 'ISSUED'; paid = 0; bal = total; payStatus = 'UNPAID'; soStatus = 'CONFIRMED'; } else { invStatus = 'ISSUED'; paid = r2(total * 0.4); bal = r2(total - paid); payStatus = 'PARTIAL'; soStatus = 'PARTIAL'; } }

      soN++; const sonum = 'SO-2026-' + pad(soN, 5); const soid = id();
      insSO.run(soid, T, sonum, null, c.id, iso(t), iso(t + 5 * 86400000), sub, 0, 7, vat, total, soStatus, payStatus, 'ต่อเนื่องข้อมูลสาธิต', 'system', soStatus === 'COMPLETED' ? 'system' : null, iso(t), iso(Date.now()));
      L.forEach(l => insSOI.run(id(), T, soid, l.f.id, fgToProdId[l.f.id] || null, l.f.name, null, l.qty, l.qty, l.price, 0, l.tot, null, 'ชิ้น'));
      S.so++;

      invN++; const invnum = 'INV-2026-' + pad(invN, 5); const iid = id();
      insInv.run(iid, T, invnum, soid, c.id, iso(t + 86400000), iso(t + 16 * 86400000), sub, 0, 7, vat, total, paid, bal, invStatus, payStatus, 'ต่อเนื่องข้อมูลสาธิต', 'system', iso(t), iso(Date.now()), 'THB', 1);
      S.inv++;

      const oy = dstr; orderDaySeq[oy]++; const oid = id();
      insOrder.run(oid, 'ORD-' + oy.replace(/-/g, '') + '-' + pad(9000 + orderDaySeq[oy], 4), c.id, iso(t), ymd(t + 3 * 86400000), sub, total, soStatus === 'COMPLETED' ? 'DELIVERED' : 'PROCESSING', 'ต่อเนื่องข้อมูลสาธิต', iso(t), iso(t));
      L.forEach(l => insOI.run(id(), oid, fgToProdId[l.f.id] || l.f.id, l.qty, l.price, l.tot));
      S.orders++;

      // deduct finished-goods stock + movement, tie to invoice
      L.forEach(l => moveStock(l.f.id, true, -l.qty, 'OUT', invnum, `ขาย ${invnum}`, t));

      postJournal(dstr, unit, 'INVOICE', iid, invnum, `ขายสินค้า ${invnum} (${unit})`, [
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
    if (orderDaySeq[dstr]) {
      db.prepare(`INSERT INTO document_sequences (tenant_id,doc_type,year,last_number,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(tenant_id,doc_type,year) DO UPDATE SET last_number=excluded.last_number, updated_at=excluded.updated_at`).run(T, 'ORDER', Number(dstr.replace(/-/g, '')), 9000 + orderDaySeq[dstr], iso(Date.now()));
    }
  }

  // update customers cache (loyalty_points + total_spent = sum of ALL orders incl. old)
  cust.forEach(c => {
    const spent = db.prepare("SELECT COALESCE(SUM(total_amount),0) v FROM orders WHERE customer_id=?").get(c.id).v;
    db.prepare("UPDATE customers SET total_spent=?, loyalty_points=?, updated_at=? WHERE id=? AND tenant_id=?").run(r2(spent), loyaltyBal[c.id], iso(Date.now()), c.id, T);
  });

  // ============ opex for the new period (proportional to gross profit, like original monthly pattern) ============
  const rngE = mul(9003);
  for (const monKey of Object.keys(monthGross)) {
    const { net, cogs } = monthGross[monKey];
    const gross = net - cogs; if (gross <= 0) continue;
    const targetOpex = r2(gross * 0.6);
    const [y, mo] = monKey.split('-').map(Number);
    const lastDayInRange = days.filter(d => ymd(+d).startsWith(monKey)).slice(-1)[0];
    const dstr = ymd(+lastDayInRange);
    const split = [[EXP.rent, 0.25, 'ค่าเช่าอาคาร (เพิ่มเติม)'], [EXP.salary, 0.45, 'เงินเดือนและค่าจ้าง (เพิ่มเติม)'], [EXP.util, 0.12, 'ค่าสาธารณูปโภค (เพิ่มเติม)'], [EXP.mkt, 0.18, 'ค่าโฆษณาและการตลาด (เพิ่มเติม)']];
    for (const [ea, frac, desc] of split) {
      const amt = r2(targetOpex * frac); if (amt <= 0) continue;
      postJournal(dstr, pickUnit(rngE), 'EXPENSE', null, null, desc, [{ acc: ea, debit: amt, credit: 0, desc }, { acc: A.BANK, debit: 0, credit: amt, desc: 'จ่ายค่าใช้จ่าย' }]);
      S.opex++;
    }
  }

  // ============ 3) Quotations — spread over range, mixed statuses incl. pending "SENT" near the end ============
  const rngQ = mul(1004);
  const qtPlan = [
    { offsetDay: 3, status: 'SENT' }, { offsetDay: 8, status: 'ACCEPTED' }, { offsetDay: 12, status: 'REJECTED' },
    { offsetDay: 16, status: 'DRAFT' }, { offsetDay: 20, status: 'EXPIRED' }, { offsetDay: 26, status: 'SENT' },
    { offsetDay: 31, status: 'ACCEPTED' }, { offsetDay: days.length - 3, status: 'SENT' }, { offsetDay: days.length - 1, status: 'SENT' },
  ];
  for (const plan of qtPlan) {
    const d = days[Math.min(plan.offsetDay, days.length - 1)]; if (!d) continue;
    const c = pickCustomer(rngQ); const tier = custTier(c);
    const target = tier.min * 1.5 + Math.floor(rngQ() * (tier.max * 1.5));
    const { L, sub } = makeLines(rngQ, target);
    if (!L.length) continue;
    // quotations do not consume stock (just a proposal)
    const vat = r2(sub * 0.07), total = r2(sub + vat);
    qtN++; const qtnum = 'QT-2026-' + pad(qtN, 5); const qid = id();
    const t = +d + 10 * 3600000;
    const expiry = plan.status === 'EXPIRED' ? t + 5 * 86400000 : t + 30 * 86400000;
    insQT.run(qid, T, qtnum, c.id, iso(t), iso(expiry), sub, 0, 7, vat, total, plan.status, 'ใบเสนอราคา (ต่อเนื่องข้อมูลสาธิต)', 'Tester@phopy.com', plan.status === 'ACCEPTED' ? 'Tester@phopy.com' : null, iso(t), iso(Date.now()));
    L.forEach(l => insQTI.run(id(), T, qid, l.f.id, fgToProdId[l.f.id] || null, l.f.name, l.qty, l.price, 0, l.tot, null, 'ชิ้น'));
    S.quotations++;
  }
  if (S.quotations) db.prepare(`INSERT INTO document_sequences (tenant_id,doc_type,year,last_number,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(tenant_id,doc_type,year) DO UPDATE SET last_number=excluded.last_number, updated_at=excluded.updated_at`).run(T, 'QUOTATION', 2026, qtN, iso(Date.now()));

  // ============ 4) Purchase requests + purchase orders + goods receipts ============
  const rngP = mul(2005);
  function makePR(dayOffset, status, matSku, qty) {
    const d = days[Math.min(dayOffset, days.length - 1)]; const m = materials.find(x => x.code === matSku);
    const t = +d + 9 * 3600000; prN++; const prnum = 'PR-2026-' + pad(prN, 5); const prid = id();
    const estTotal = r2(qty * m.unit_cost);
    insPR.run(prid, T, prnum, ADMIN_UID, 'Tester@phopy.com', 'คลังสินค้า', iso(t), iso(t + 7 * 86400000), estTotal, status, 'NORMAL', 'ขอเบิกซื้อวัตถุดิบเพิ่ม (ต่อเนื่องข้อมูลสาธิต)', status === 'APPROVED' ? ADMIN_UID : null, status === 'APPROVED' ? iso(t + 86400000) : null, iso(t), iso(Date.now()), null, 'MANUAL');
    insPRI.run(id(), T, prid, m.id, m.name, qty, m.unit, m.unit_cost, estTotal, null, prid, m.name, 0, m.unit_cost);
    S.pr++;
    return { prid, prnum, t };
  }
  function makePOWithGR(dayOffset, status, supplierCode, matSku, qty, receive) {
    const d = days[Math.min(dayOffset, days.length - 1)]; const sup = suppliers.find(s => s.code === supplierCode);
    const m = materials.find(x => x.code === matSku); const rawItem = matIdToRaw[m.id];
    const t = +d + 9 * 3600000; poN++; const ponum = 'PO-' + pad(poN, 5); const poid = id();
    const unitPrice = m.unit_cost * 1.02; const sub = r2(qty * unitPrice); const vat = r2(sub * 0.07); const total = r2(sub + vat);
    insPO.run(poid, T, ponum, sup.id, status, iso(t), iso(t + 7 * 86400000), receive ? iso(t + 3 * 86400000) : null, sub, 7, vat, total, 'สั่งซื้อวัตถุดิบ (ต่อเนื่องข้อมูลสาธิต)', ADMIN_UID, status !== 'SUBMITTED' && status !== 'DRAFT' ? ADMIN_UID : null, iso(t), iso(Date.now()), 'THB', 1);
    const poiId = id();
    insPOI.run(poiId, T, poid, m.id, m.name, qty, unitPrice, sub, receive ? qty : 0, null, m.unit);
    S.po++;
    if (receive) {
      grN++; const grnum = 'GR-2026-' + pad(grN, 5); const grid = id(); const rt = t + 3 * 86400000;
      insGR.run(grid, T, grnum, poid, sup.id, iso(rt), ADMIN_UID, 'CONFIRMED', 'รับสินค้าเข้าคลัง (ต่อเนื่องข้อมูลสาธิต)', iso(rt), iso(rt));
      insGRI.run(id(), T, grid, poiId, m.id, qty, qty, qty, 0, null, 'Main Warehouse', null, rawItem ? rawItem.id : null, qty);
      S.gr++;
      if (rawItem) moveStock(rawItem.id, false, qty, 'IN', grnum, `รับของ ${grnum}`, rt);
    }
    return { poid, ponum };
  }

  makePR(5, 'PENDING', 'MAT-004', 300);
  makePR(9, 'APPROVED', 'MAT-009', 500);
  makePR(days.length - 4, 'PENDING', 'MAT-002', 400); // recent pending -> "PR รออนุมัติ" screenshot
  makePOWithGR(11, 'RECEIVED', 'SUP-006', 'MAT-009', 500, true);
  makePOWithGR(13, 'RECEIVED', 'SUP-001', 'MAT-004', 300, true);
  makePOWithGR(days.length - 3, 'SUBMITTED', 'SUP-002', 'MAT-002', 400, false); // pending -> "PO รออนุมัติ" screenshot

  db.prepare(`INSERT INTO document_sequences (tenant_id,doc_type,year,last_number,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(tenant_id,doc_type,year) DO UPDATE SET last_number=excluded.last_number, updated_at=excluded.updated_at`).run(T, 'PURCHASE_REQUEST', 2026, prN, iso(Date.now()));
  db.prepare(`INSERT INTO document_sequences (tenant_id,doc_type,year,last_number,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(tenant_id,doc_type,year) DO UPDATE SET last_number=excluded.last_number, updated_at=excluded.updated_at`).run(T, 'PO', 2026, poN, iso(Date.now()));
  db.prepare(`INSERT INTO document_sequences (tenant_id,doc_type,year,last_number,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(tenant_id,doc_type,year) DO UPDATE SET last_number=excluded.last_number, updated_at=excluded.updated_at`).run(T, 'GOODS_RECEIPT', 2026, grN, iso(Date.now()));

  // ============ 5) Work orders — replenish general stock (never the intentionally-low showcase items) ============
  function makeWO(dayOffset, status, productSku, qty, completedQty) {
    const d = days[Math.min(dayOffset, days.length - 1)]; const fgItem = fgBySku[productSku];
    const bom = boms.find(b => b.product_id === fgItem.id); if (!bom) return;
    const items = bomItemsByBom[bom.id] || [];
    const t = +d + 8 * 3600000; woN++; const wonum = 'WO-' + pad(woN, 5); const woid = id();
    const estCost = r2(items.reduce((s, bi) => { const rawItem = matIdToRaw[bi.material_id]; return s + (rawItem ? rawItem.unit_cost * bi.quantity * qty : 0); }, 0));
    const issuing = status === 'IN_PROGRESS' || status === 'COMPLETED';
    insWO.run(woid, T, wonum, bom.id, fgItem.name, qty, completedQty, 0, status, 'NORMAL', ymd(t), ymd(t + 5 * 86400000), status === 'COMPLETED' ? ymd(t + 5 * 86400000) : null, 'Tester@phopy.com', 'ต่อเนื่องข้อมูลสาธิต', estCost, issuing ? estCost : 0, iso(t), iso(Date.now()));
    items.forEach(bi => {
      const reqQty = bi.quantity * qty;
      insWOM.run(id(), T, woid, bi.material_id, null, reqQty, issuing ? reqQty : 0, issuing ? 'ISSUED' : 'PLANNED', bi.unit);
      if (issuing) { const rawItem = matIdToRaw[bi.material_id]; if (rawItem) moveStock(rawItem.id, false, -reqQty, 'OUT', wonum, `เบิกวัตถุดิบผลิต ${wonum}`, t); }
    });
    if (completedQty > 0) moveStock(fgItem.id, true, completedQty, 'IN', wonum, `ผลิตเสร็จ ${wonum}`, t + 4 * 86400000);
    S.wo++;
  }
  // regular replenishment for the BOM-backed runners — NOT FG-011/FG-005 (kept low on purpose as the low-stock showcase)
  makeWO(4, 'COMPLETED', 'FG-002', 50, 50);
  makeWO(9, 'COMPLETED', 'FG-001', 50, 50);
  makeWO(14, 'COMPLETED', 'FG-003', 50, 50);
  makeWO(20, 'COMPLETED', 'FG-002', 50, 50);
  makeWO(25, 'COMPLETED', 'FG-001', 40, 40);
  makeWO(30, 'COMPLETED', 'FG-003', 40, 40);
  makeWO(days.length - 12, 'IN_PROGRESS', 'FG-001', 60, 30);
  makeWO(days.length - 2, 'PLANNED', 'FG-003', 50, 0);
  db.prepare(`INSERT INTO document_sequences (tenant_id,doc_type,year,last_number,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(tenant_id,doc_type,year) DO UPDATE SET last_number=excluded.last_number, updated_at=excluded.updated_at`).run(T, 'WORK_ORDER', 2026, woN, iso(Date.now()));

  // ============ 6) CRM activity: activity_logs + customer_recommendations ============
  const rngAct = mul(3006);
  const actTypes = ['CALL', 'EMAIL', 'MEETING', 'NOTE'];
  const actNotes = {
    CALL: 'โทรติดตามความพึงพอใจหลังส่งมอบสินค้า', EMAIL: 'ส่งอีเมลแนะนำโปรโมชั่นสินค้าใหม่',
    MEETING: 'นัดพบเพื่อเสนอราคาสินค้าล็อตใหญ่', NOTE: 'บันทึกความต้องการพิเศษของลูกค้า'
  };
  for (let i = 0; i < 16; i++) {
    const d = days[Math.floor(rngAct() * days.length)]; const c = cust[Math.floor(rngAct() * cust.length)];
    const type = actTypes[Math.floor(rngAct() * actTypes.length)];
    const t = +d + Math.floor(rngAct() * 10 * 3600000) + 9 * 3600000;
    insAct.run(id(), c.id, type, actNotes[type], 'Tester@phopy.com', T, iso(t));
    S.activity++;
  }
  const recReasons = ['ซื้อสม่ำเสมอ เหมาะเสนอสินค้าพรีเมียมเพิ่ม', 'ยังไม่เคยซื้อสินค้าหมวดนี้', 'ใกล้ช่วงเทศกาล น่าเสนอกิฟต์เซ็ต'];
  const existingRecPairs = new Set(db.prepare("SELECT customer_id,product_id FROM customer_recommendations WHERE tenant_id=?").all(T).map(r => r.customer_id + '|' + r.product_id));
  let recTries = 0;
  for (let i = 0; i < 6 && recTries < 60; ) {
    recTries++;
    const d = days[Math.floor(rngAct() * days.length)]; const c = cust[Math.floor(rngAct() * cust.length)]; const p = products[Math.floor(rngAct() * products.length)];
    const key = c.id + '|' + p.id;
    if (existingRecPairs.has(key)) continue;
    existingRecPairs.add(key);
    const t = +d + 9 * 3600000; const status = i % 3 === 0 ? 'OFFERED' : 'PENDING';
    insRec.run(id(), T, c.id, p.id, p.name, 'GIFT_SET', recReasons[i % recReasons.length], i % 2 === 0 ? 'HIGH' : 'NORMAL', status, status === 'OFFERED' ? iso(t) : null, status === 'OFFERED' ? 'Tester@phopy.com' : null, null, 'Tester@phopy.com', iso(t), iso(t));
    S.recs++; i++;
  }

  // ---------- final document_sequences sync (sales/invoice/journal — the high-volume ones) ----------
  const upSeq = db.prepare(`INSERT INTO document_sequences (tenant_id,doc_type,year,last_number,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(tenant_id,doc_type,year) DO UPDATE SET last_number=excluded.last_number, updated_at=excluded.updated_at`);
  const now2 = iso(Date.now());
  upSeq.run(T, 'SALES_ORDER', 2026, soN, now2);
  upSeq.run(T, 'INVOICE', 2026, invN, now2);
  for (const y in jSeq) upSeq.run(T, 'JOURNAL', Number(y), jSeq[y], now2);
});

tx();
db.pragma('wal_checkpoint(TRUNCATE)');
console.log('EXTEND SEED DONE', JSON.stringify(S));
db.close();
