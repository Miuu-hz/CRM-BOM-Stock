/* Phopy ERP — Testshop TOP-OFF increment #2 (2026-09-09).
 * The first top-off (seed_testshop_topoff.js) under-shot the target because the per-line
 * stock cap (25% of *remaining* qty) compounds down across 30 sequential sales. This script
 * adds a further batch of sales only (stock already has ample headroom: FG-001=423, FG-002=328,
 * FG-003=210) to bring the Aug10-Sep8 total the rest of the way into the +5%..+20% target band.
 * Purely additive, same shapes/guards as topoff #1. Scoped to tenant_id='Testshop'.
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
const TODAY = new Date();

const WSTART = new Date('2026-08-10T00:00:00.000Z');
const WEND = new Date('2026-09-08T00:00:00.000Z');
const days = [];
for (let t = +WSTART; t <= +WEND; t += 86400000) days.push(new Date(t));

const already = db.prepare("SELECT COUNT(*) n FROM sales_orders WHERE tenant_id=? AND notes='ปรับยอดขายให้สมเหตุสมผล (top-off #2 2026-09-09)'").get(T).n;
if (already > 0) { console.log(`Already topped-off #2 — skipping.`); db.close(); process.exit(0); }

const S = { so: 0, inv: 0, orders: 0, journals: 0, jlines: 0, loyalty: 0, stockmv: 0 };

const tx = db.transaction(() => {
  const cust = db.prepare("SELECT id,code,name,type,loyalty_points,total_spent FROM customers WHERE tenant_id=?").all(T);
  const fg = db.prepare("SELECT id,sku,name,quantity,unit_cost,unit_price FROM stock_items WHERE tenant_id=? AND category='finished'").all(T);
  const fgBySku = {}; fg.forEach(f => fgBySku[f.sku] = f);
  const products = db.prepare("SELECT id,code,name FROM products WHERE tenant_id=?").all(T);
  const fgToProdId = {}; products.forEach(p => { if (fgBySku[p.code]) fgToProdId[fgBySku[p.code].id] = p.id; });
  const accCode = {}; db.prepare("SELECT id,code FROM accounts WHERE tenant_id=?").all(T).forEach(a => accCode[a.code] = a.id);
  const A = { CASH: accCode['1101'], BANK: accCode['1102'], AR: accCode['1104'], INV: accCode['1106'], REV: accCode['4101'], VAT: accCode['2104'], COGS: accCode['5101'] };
  const UNITS = [['ONLINE', 0.45], ['RETAIL', 0.30], ['WHOLESALE', 0.20], ['OTHER', 0.05]];
  const pickUnit = rng => { let x = rng(), c = 0; for (const [u, w] of UNITS) { c += w; if (x <= c) return u; } return 'OTHER'; };
  const pickPay = rng => { const x = rng(); return x < 0.4 ? A.CASH : (x < 0.85 ? A.BANK : A.AR); };

  const fgQty = {}; fg.forEach(f => fgQty[f.id] = f.quantity);

  const maxN = (tbl, col, pfx, off) => db.prepare(`SELECT COALESCE(MAX(CAST(substr(${col},${off}) AS INTEGER)),0) m FROM ${tbl} WHERE tenant_id=? AND ${col} LIKE ?`).get(T, pfx + '%').m;
  let soN = maxN('sales_orders', 'so_number', 'SO-2026-', 9);
  let invN = maxN('invoices', 'invoice_number', 'INV-2026-', 10);
  let jSeq2026 = db.prepare("SELECT COALESCE(MAX(CAST(substr(entry_number,9) AS INTEGER)),0) m FROM journal_entries WHERE tenant_id=? AND entry_number LIKE 'JV-2026-%'").get(T).m;
  const nextJ = () => ++jSeq2026;
  const orderDaySeq = {};
  days.forEach(d => {
    const dstr = ymd(+d); const dc = Number(dstr.replace(/-/g, ''));
    const row = db.prepare("SELECT last_number FROM document_sequences WHERE tenant_id=? AND doc_type='ORDER' AND year=?").get(T, dc);
    orderDaySeq[dstr] = row ? row.last_number - 9000 : 0;
  });

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
  const upSeq = db.prepare(`INSERT INTO document_sequences (tenant_id,doc_type,year,last_number,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(tenant_id,doc_type,year) DO UPDATE SET last_number=excluded.last_number, updated_at=excluded.updated_at`);

  function postJournal(dateStr, unit, refId, srcNum, desc, lines) {
    const tdb = r2(lines.reduce((s, l) => s + l.debit, 0)), tc = r2(lines.reduce((s, l) => s + l.credit, 0));
    if (Math.abs(tdb - tc) > 0.01) throw new Error('UNBALANCED journal ' + desc);
    const jid = id(); const now = iso(Date.now());
    insJE.run(jid, T, 'JV-2026-' + pad(nextJ(), 5), dateStr, 'INVOICE', refId, srcNum, null, desc, tdb, tc, 1, 1, null, 'system', now, now, 0, unit);
    lines.forEach((l, i) => insJL.run(id(), T, jid, l.acc, i + 1, l.desc, r2(l.debit), r2(l.credit)));
    S.journals++; S.jlines += lines.length;
  }
  function moveStock(stockItemId, delta, type, ref, note, tms) {
    const nq = r2(fgQty[stockItemId] + delta);
    if (nq < 0) throw new Error('NEGATIVE stock ' + stockItemId);
    fgQty[stockItemId] = nq;
    updQty.run(nq, iso(tms), stockItemId, T);
    insMv.run(id(), T, stockItemId, type, Math.abs(delta), null, null, ref, note, iso(tms), 'system');
    S.stockmv++;
  }

  const rngSales = mul(90210);
  const custTier = c => c.type === 'CORPORATE' ? { min: 15000, max: 40000 } : c.type === 'RETAIL' ? { min: 4000, max: 12000 } : { min: 1000, max: 4000 };
  const pickCustomer = rng => { const x = rng(); const type = x < 0.75 ? 'CORPORATE' : x < 0.90 ? 'RETAIL' : 'INDIVIDUAL'; const pool = cust.filter(c => c.type === type); return pool[Math.floor(rng() * pool.length)] || cust[Math.floor(rng() * cust.length)]; };
  const loyaltyBal = {}; cust.forEach(c => loyaltyBal[c.id] = c.loyalty_points || 0);
  // only the three high-stock BOM-backed runners this round — plenty of headroom (423/328/210)
  const HIGH_STOCK = ['FG-001', 'FG-002', 'FG-003'];
  function pickFgWeighted(rng) {
    const pool = HIGH_STOCK.map(sku => fgBySku[sku]).filter(f => f && fgQty[f.id] > 0);
    const weights = pool.map(f => Math.sqrt(fgQty[f.id]));
    const total = weights.reduce((a, b) => a + b, 0);
    let x = rng() * total, c = 0;
    for (let i = 0; i < pool.length; i++) { c += weights[i]; if (x <= c) return pool[i]; }
    return pool[pool.length - 1];
  }
  function makeLines(rng, target) {
    const n = 1 + Math.floor(rng() * 2); const used = new Set(); const L = []; let sub = 0;
    for (let k = 0; k < n; k++) {
      let f = pickFgWeighted(rng); let g = 0;
      while (f && (used.has(f.id) || fgQty[f.id] < 1) && g++ < 12) f = pickFgWeighted(rng);
      if (!f || fgQty[f.id] < 1) continue;
      used.add(f.id);
      const price = f.unit_price || (f.unit_cost * 1.9);
      let desiredQty = Math.max(1, Math.round((target / n) / price));
      const cap = Math.max(1, Math.floor(fgQty[f.id] * 0.35)); // headroom is large this round
      const qty = Math.max(1, Math.min(desiredQty, cap, fgQty[f.id]));
      const tot = r2(qty * price); sub += tot;
      L.push({ f, qty, price, tot, cogs: r2(qty * f.unit_cost) });
    }
    return { L, sub: r2(sub) };
  }

  const N_EXTRA = 13;
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
    insSO.run(soid, T, sonum, null, c.id, iso(t), iso(t + 5 * 86400000), sub, 0, 7, vat, total, soStatus, payStatus, 'ปรับยอดขายให้สมเหตุสมผล (top-off #2 2026-09-09)', 'system', soStatus === 'COMPLETED' ? 'system' : null, iso(t), iso(Date.now()));
    L.forEach(l => insSOI.run(id(), T, soid, l.f.id, fgToProdId[l.f.id] || null, l.f.name, null, l.qty, l.qty, l.price, 0, l.tot, null, 'ชิ้น'));
    S.so++;

    invN++; const invnum = 'INV-2026-' + pad(invN, 5); const iid = id();
    insInv.run(iid, T, invnum, soid, c.id, iso(t + 86400000), iso(t + 16 * 86400000), sub, 0, 7, vat, total, paid, bal, invStatus, payStatus, 'ปรับยอดขายให้สมเหตุสมผล (top-off #2 2026-09-09)', 'system', iso(t), iso(Date.now()), 'THB', 1);
    S.inv++;

    orderDaySeq[dstr] = (orderDaySeq[dstr] || 0) + 1; const oid = id();
    insOrder.run(oid, 'ORD-' + dstr.replace(/-/g, '') + '-' + pad(9000 + orderDaySeq[dstr], 4), c.id, iso(t), ymd(t + 3 * 86400000), sub, total, soStatus === 'COMPLETED' ? 'DELIVERED' : 'PROCESSING', 'ปรับยอดขายให้สมเหตุสมผล (top-off #2)', iso(t), iso(t));
    L.forEach(l => insOI.run(id(), oid, fgToProdId[l.f.id] || l.f.id, l.qty, l.price, l.tot));
    S.orders++;

    L.forEach(l => moveStock(l.f.id, -l.qty, 'OUT', invnum, `ขาย ${invnum} (top-off #2)`, t));

    postJournal(dstr, unit, iid, invnum, `ขายสินค้า ${invnum} (${unit}) (top-off #2)`, [
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

  cust.forEach(c => {
    const spent = db.prepare("SELECT COALESCE(SUM(total_amount),0) v FROM orders WHERE customer_id=?").get(c.id).v;
    db.prepare("UPDATE customers SET total_spent=?, loyalty_points=?, updated_at=? WHERE id=? AND tenant_id=?").run(r2(spent), loyaltyBal[c.id], iso(Date.now()), c.id, T);
  });

  const now2 = iso(Date.now());
  upSeq.run(T, 'SALES_ORDER', 2026, soN, now2);
  upSeq.run(T, 'INVOICE', 2026, invN, now2);
  upSeq.run(T, 'JOURNAL', 2026, jSeq2026, now2);
  Object.keys(orderDaySeq).forEach(dstr => {
    const dc = Number(dstr.replace(/-/g, ''));
    upSeq.run(T, 'ORDER', dc, 9000 + orderDaySeq[dstr], now2);
  });
});

tx();
db.pragma('wal_checkpoint(TRUNCATE)');
console.log('TOP-OFF #2 DONE', JSON.stringify(S));
db.close();
