// 2026-10-05-restore-minmax.js
// Restores stock_items.min_stock / max_stock / gs1_barcode for tenant_bb_pillow
// that a frontend bug wiped (every "save" in the Stock edit dialog overwrote
// these fields with 0 / '' regardless of what the user actually typed).
//
// Strategy: for each stock item whose current value is empty (0/NULL for the
// numeric fields, ''/NULL for the barcode), scan every readable dev.db.bak*
// snapshot in chronological order and take the value from the LAST
// (most recent) backup that still had a non-empty value. If the history shows
// a dip-and-recover (empty, then non-empty again in a later backup, before
// landing on the current empty value) that looks like an intentional edit
// rather than the bug, so it's reported separately and never auto-restored.
//
// ponytail: plain script, no migration framework — this is a one-time data
// repair, not a recurring job. Backup-ordering is by file mtime (name formats
// are inconsistent across the dev.db.bak* history), which is a fine proxy
// here because every backup in /opt/crm/backend was taken shortly before it
// was used and never touched again.
//
// Usage:
//   node scripts/2026-10-05-restore-minmax.js                                   # dry run (default, safe)
//   node scripts/2026-10-05-restore-minmax.js --apply --backup=/root/erp-backup-<ts>.db   # apply
//
// --apply requires --backup=<path to a fresh pre-change backup, <30 min old>.
// The apply step is idempotent: it only updates rows that are still empty,
// so running it twice (or on a backup that's already been applied) is safe.

const path = require('path');
const fs = require('fs');
const Database = require('/opt/crm/backend/node_modules/better-sqlite3');

const DB_DIR = '/opt/crm/backend';
const LIVE_DB = path.join(DB_DIR, 'dev.db');
const TENANT = 'tenant_bb_pillow';
const MAX_BACKUP_AGE_MIN = 30;

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const backupArg = args.find(a => a.startsWith('--backup='));
const BACKUP_PATH = backupArg ? backupArg.slice('--backup='.length) : null;

function isEmptyNum(v) { return v === null || v === undefined || v === 0; }
function isEmptyStr(v) { return v === null || v === undefined || v === ''; }

const FIELDS = [
  { key: 'min_stock', empty: isEmptyNum },
  { key: 'max_stock', empty: isEmptyNum },
  { key: 'gs1_barcode', empty: isEmptyStr },
];

function listBackups() {
  const files = fs.readdirSync(DB_DIR).filter(f =>
    /^dev\.db\.bak/.test(f) && !f.endsWith('-wal') && !f.endsWith('-shm')
  );
  const withTime = files.map(f => ({
    file: f,
    full: path.join(DB_DIR, f),
    mtime: fs.statSync(path.join(DB_DIR, f)).mtime.getTime(),
  }));
  withTime.sort((a, b) => a.mtime - b.mtime);
  return withTime;
}

function openReadonly(file) {
  try {
    const db = new Database(file, { readonly: true, fileMustExist: true });
    db.prepare('SELECT 1 FROM stock_items LIMIT 1').get();
    return db;
  } catch (e) {
    return null;
  }
}

function main() {
  if (APPLY) {
    if (!BACKUP_PATH) { console.error('ERROR: --apply requires --backup=<path>'); process.exit(1); }
    if (!fs.existsSync(BACKUP_PATH)) { console.error('ERROR: backup not found: ' + BACKUP_PATH); process.exit(1); }
    const ageMin = (Date.now() - fs.statSync(BACKUP_PATH).mtime.getTime()) / 60000;
    if (ageMin > MAX_BACKUP_AGE_MIN) {
      console.error(`ERROR: backup is ${ageMin.toFixed(1)} min old (>${MAX_BACKUP_AGE_MIN}min), refusing to apply. Take a fresh backup first.`);
      process.exit(1);
    }
  }

  const live = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
  const currentRows = live.prepare(
    `SELECT id, sku, name, min_stock, max_stock, gs1_barcode, updated_at
     FROM stock_items WHERE tenant_id = ?`
  ).all(TENANT);
  live.close();

  const backups = listBackups();
  console.log(`Found ${backups.length} backup files (chronological order):`);
  backups.forEach(b => console.log('  ' + b.file + '  (mtime ' + new Date(b.mtime).toISOString() + ')'));
  console.log('');

  const openBackups = [];
  for (const b of backups) {
    const db = openReadonly(b.full);
    if (!db) { console.log(`SKIP (cannot open / no stock_items table): ${b.file}`); continue; }
    openBackups.push({ ...b, db });
  }
  console.log(`\n${openBackups.length}/${backups.length} backups usable for history lookup.\n`);

  const restorePlan = [];
  const ambiguous = [];

  for (const row of currentRows) {
    for (const f of FIELDS) {
      const currentVal = row[f.key];
      if (!f.empty(currentVal)) continue; // not wiped — never touch

      const history = [];
      for (const b of openBackups) {
        let r;
        try {
          r = b.db.prepare(`SELECT ${f.key} as v FROM stock_items WHERE id = ? AND tenant_id = ?`).get(row.id, TENANT);
        } catch (e) { r = undefined; }
        if (r === undefined) continue; // item/column not present in this backup
        history.push({ backup: b.file, value: r.v });
      }
      if (history.length === 0) continue; // no history anywhere

      // dip-and-recover detection: an empty value followed later by a non-empty one
      let sawEmpty = false;
      let ambiguousFound = false;
      for (const h of history) {
        if (f.empty(h.value)) {
          sawEmpty = true;
        } else if (sawEmpty) {
          ambiguousFound = true;
        }
      }

      let lastGood = null;
      for (let i = history.length - 1; i >= 0; i--) {
        if (!f.empty(history[i].value)) { lastGood = history[i]; break; }
      }
      if (!lastGood) continue; // every backup already empty too — nothing to restore

      if (ambiguousFound) {
        ambiguous.push({
          id: row.id, sku: row.sku, name: row.name, field: f.key,
          updated_at: row.updated_at,
          history: history.map(h => `${h.backup}=${JSON.stringify(h.value)}`).join(' -> '),
        });
        continue;
      }

      restorePlan.push({
        id: row.id, sku: row.sku, name: row.name, field: f.key,
        from: currentVal, to: lastGood.value, sourceBackup: lastGood.backup,
        updated_at: row.updated_at,
      });
    }
  }

  openBackups.forEach(b => b.db.close());

  console.log('='.repeat(100));
  const itemCount = new Set(restorePlan.map(r => r.id)).size;
  console.log(`RESTORE CANDIDATES (tenant=${TENANT}): ${restorePlan.length} field(s) across ${itemCount} item(s)`);
  console.log('='.repeat(100));

  const byItem = {};
  for (const r of restorePlan) {
    (byItem[r.id] = byItem[r.id] || { sku: r.sku, name: r.name, updated_at: r.updated_at, fields: [] }).fields.push(r);
  }
  for (const [id, info] of Object.entries(byItem)) {
    console.log(`\n${info.sku}  ${info.name}  (id=${id}, updated_at=${info.updated_at})`);
    for (const r of info.fields) {
      console.log(`  ${r.field}: ${JSON.stringify(r.from)} -> ${JSON.stringify(r.to)}   [from ${r.sourceBackup}]`);
    }
  }

  console.log('\n' + '='.repeat(100));
  console.log(`AMBIGUOUS ROWS (reported only, NOT restored): ${ambiguous.length}`);
  console.log('='.repeat(100));
  for (const a of ambiguous) {
    console.log(`\n${a.sku}  ${a.name}  (id=${a.id}, field=${a.field}, updated_at=${a.updated_at})`);
    console.log(`  history: ${a.history}`);
  }

  if (!APPLY) {
    console.log('\n' + '='.repeat(100));
    console.log('DRY RUN ONLY. No changes written.');
    console.log('To apply: node scripts/2026-10-05-restore-minmax.js --apply --backup=/root/erp-backup-<ts>.db');
    console.log('='.repeat(100));
    return;
  }

  const live2 = new Database(LIVE_DB);
  const upd = {
    min_stock: live2.prepare(`UPDATE stock_items SET min_stock = ? WHERE id = ? AND tenant_id = ? AND (min_stock IS NULL OR min_stock = 0)`),
    max_stock: live2.prepare(`UPDATE stock_items SET max_stock = ? WHERE id = ? AND tenant_id = ? AND (max_stock IS NULL OR max_stock = 0)`),
    gs1_barcode: live2.prepare(`UPDATE stock_items SET gs1_barcode = ? WHERE id = ? AND tenant_id = ? AND (gs1_barcode IS NULL OR gs1_barcode = '')`),
  };
  const tx = live2.transaction((plan) => {
    let applied = 0;
    for (const r of plan) {
      const res = upd[r.field].run(r.to, r.id, TENANT);
      applied += res.changes;
    }
    return applied;
  });
  const applied = tx(restorePlan);
  live2.pragma('wal_checkpoint(TRUNCATE)');
  live2.close();
  console.log(`\nAPPLIED ${applied}/${restorePlan.length} field update(s) (idempotent — rows already non-empty were skipped). Backup used: ${BACKUP_PATH}`);
}

main();
