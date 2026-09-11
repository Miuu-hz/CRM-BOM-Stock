/* Corrective cleanup: precisely removes ONLY the rows inserted by the first (overly aggressive,
 * stock-depleting) run of seed_testshop_extend.js on Testshop, and restores mutated
 * stock_items.quantity / customers.loyalty_points / customers.total_spent / document_sequences
 * back to their exact pre-run values. Scoped strictly to tenant_id='Testshop'. */
const Database = require('/opt/crm/backend/node_modules/better-sqlite3');
const db = new Database('/opt/crm/backend/dev.db');
db.pragma('foreign_keys = OFF');
const T = 'Testshop';
const iso = () => new Date().toISOString();

// pre-run baselines captured via explore2.js BEFORE the bad run
const fgBaseline = { 'FG-001':45,'FG-002':32,'FG-003':28,'FG-004':120,'FG-005':8,'FG-006':70,'FG-007':55,'FG-008':40,'FG-009':95,'FG-010':200,'FG-011':4,'FG-012':25 };
const rawBaseline = { 'MAT-001':320,'MAT-002':850,'MAT-003':410,'MAT-004':30,'MAT-005':1200,'MAT-006':900,'MAT-007':600,'MAT-008':500,'MAT-009':150,'MAT-010':220 };
const custBaseline = {
  'TS-CUS-001': {lp:17559, ts:880282.9}, 'TS-CUS-002': {lp:2245, ts:119126.95}, 'TS-CUS-003': {lp:350, ts:17702.4},
  'TS-CUS-004': {lp:12289, ts:615877.05}, 'TS-CUS-005': {lp:17341, ts:870641}, 'TS-CUS-006': {lp:398, ts:20611.55},
  'TS-CUS-007': {lp:16905, ts:847556.95}, 'TS-CUS-008': {lp:2506, ts:132357.5}, 'TS-CUS-009': {lp:459, ts:23218.25},
  'TS-CUS-010': {lp:18674, ts:934897.55}, 'TS-CUS-011': {lp:14705, ts:737194.25}, 'TS-CUS-012': {lp:291, ts:14893.4},
};

const before = {};
for (const t of ['pos_daily_sales','sales_orders','invoices','quotations','purchase_orders','work_orders','journal_entries','journal_lines','orders','order_items','loyalty_transactions','activity_logs','customer_recommendations','stock_movements','purchase_requests','goods_receipts','sales_order_items','purchase_request_items','purchase_order_items','goods_receipt_items','work_order_materials'])
  before[t] = db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;

const tx = db.transaction(() => {
  // safety assertion: customer_recommendations to be deleted must equal exactly 6 (the count we inserted)
  const recToDelete = db.prepare("SELECT id FROM customer_recommendations WHERE tenant_id=? AND created_at>='2026-08-03'").all(T);
  if (recToDelete.length !== 6) throw new Error('SAFETY ABORT: expected exactly 6 customer_recommendations to remove, found ' + recToDelete.length);

  // children first
  db.prepare("DELETE FROM journal_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=? AND entry_number LIKE 'JV-2026-%' AND CAST(substr(entry_number,9) AS INTEGER)>215)").run(T);
  db.prepare("DELETE FROM journal_entries WHERE tenant_id=? AND entry_number LIKE 'JV-2026-%' AND CAST(substr(entry_number,9) AS INTEGER)>215").run(T);

  db.prepare("DELETE FROM sales_order_items WHERE tenant_id=? AND sales_order_id IN (SELECT id FROM sales_orders WHERE tenant_id=? AND CAST(substr(so_number,9) AS INTEGER)>228)").run(T, T);
  db.prepare("DELETE FROM sales_orders WHERE tenant_id=? AND CAST(substr(so_number,9) AS INTEGER)>228").run(T);

  db.prepare("DELETE FROM invoices WHERE tenant_id=? AND CAST(substr(invoice_number,10) AS INTEGER)>226").run(T);

  db.prepare(`DELETE FROM order_items WHERE order_id IN (SELECT o.id FROM orders o JOIN customers c ON o.customer_id=c.id WHERE c.tenant_id=? AND o.order_date>='2026-08-03')`).run(T);
  db.prepare(`DELETE FROM orders WHERE id IN (SELECT o.id FROM orders o JOIN customers c ON o.customer_id=c.id WHERE c.tenant_id=? AND o.order_date>='2026-08-03')`).run(T);

  db.prepare("DELETE FROM loyalty_transactions WHERE tenant_id=? AND created_at>='2026-08-03'").run(T);

  db.prepare("DELETE FROM purchase_request_items WHERE tenant_id=? AND purchase_request_id IN (SELECT id FROM purchase_requests WHERE tenant_id=? AND CAST(substr(pr_number,9) AS INTEGER)>6)").run(T, T);
  db.prepare("DELETE FROM purchase_requests WHERE tenant_id=? AND CAST(substr(pr_number,9) AS INTEGER)>6").run(T);

  db.prepare("DELETE FROM goods_receipt_items WHERE tenant_id=? AND goods_receipt_id IN (SELECT id FROM goods_receipts WHERE tenant_id=? AND CAST(substr(gr_number,9) AS INTEGER)>7)").run(T, T);
  db.prepare("DELETE FROM goods_receipts WHERE tenant_id=? AND CAST(substr(gr_number,9) AS INTEGER)>7").run(T);

  db.prepare("DELETE FROM purchase_order_items WHERE tenant_id=? AND purchase_order_id IN (SELECT id FROM purchase_orders WHERE tenant_id=? AND CAST(substr(po_number,4) AS INTEGER)>14)").run(T, T);
  db.prepare("DELETE FROM purchase_orders WHERE tenant_id=? AND CAST(substr(po_number,4) AS INTEGER)>14").run(T);

  db.prepare("DELETE FROM work_order_materials WHERE tenant_id=? AND work_order_id IN (SELECT id FROM work_orders WHERE tenant_id=? AND CAST(substr(wo_number,4) AS INTEGER)>7)").run(T, T);
  db.prepare("DELETE FROM work_orders WHERE tenant_id=? AND CAST(substr(wo_number,4) AS INTEGER)>7").run(T);

  db.prepare("DELETE FROM activity_logs WHERE tenant_id=? AND created_at>='2026-08-03'").run(T);
  recToDelete.forEach(r => db.prepare("DELETE FROM customer_recommendations WHERE id=?").run(r.id));

  db.prepare("DELETE FROM stock_movements WHERE tenant_id=? AND created_at>='2026-08-03'").run(T);
  db.prepare("DELETE FROM pos_daily_sales WHERE tenant_id=? AND sales_date>='20260803' AND sales_date<='20260908'").run(T);

  // document_sequences: delete the brand-new per-day rows, restore the touched running totals
  db.prepare("DELETE FROM document_sequences WHERE tenant_id=? AND doc_type='ORDER' AND year>=20260803 AND year<=20260908").run(T);
  db.prepare("DELETE FROM document_sequences WHERE tenant_id=? AND doc_type='POS_DAILY_SALES' AND year>=20260803 AND year<=20260908").run(T);
  const restoreSeq = db.prepare("UPDATE document_sequences SET last_number=?, updated_at=? WHERE tenant_id=? AND doc_type=? AND year=2026");
  restoreSeq.run(228, iso(), T, 'SALES_ORDER');
  restoreSeq.run(226, iso(), T, 'INVOICE');
  restoreSeq.run(215, iso(), T, 'JOURNAL');
  restoreSeq.run(6, iso(), T, 'PURCHASE_REQUEST');
  restoreSeq.run(14, iso(), T, 'PO');
  restoreSeq.run(7, iso(), T, 'GOODS_RECEIPT');
  restoreSeq.run(7, iso(), T, 'WORK_ORDER');

  // restore stock quantities
  const updQty = db.prepare("UPDATE stock_items SET quantity=?, updated_at=? WHERE tenant_id=? AND sku=?");
  for (const sku in fgBaseline) updQty.run(fgBaseline[sku], iso(), T, sku);
  for (const sku in rawBaseline) updQty.run(rawBaseline[sku], iso(), T, sku);

  // restore customer loyalty/spend cache
  const updCust = db.prepare("UPDATE customers SET loyalty_points=?, total_spent=?, updated_at=? WHERE tenant_id=? AND code=?");
  for (const code in custBaseline) updCust.run(custBaseline[code].lp, custBaseline[code].ts, iso(), T, code);
});

tx();
db.pragma('wal_checkpoint(TRUNCATE)');

const after = {};
for (const t of Object.keys(before)) after[t] = db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
console.log('table                        before  after  delta');
for (const t of Object.keys(before)) console.log(t.padEnd(28), String(before[t]).padStart(6), String(after[t]).padStart(6), String(after[t]-before[t]).padStart(6));
db.close();
console.log('\nCLEANUP DONE');
