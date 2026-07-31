const db = require('better-sqlite3')('dev.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('TABLES:', tables.map(r => r.name).join(', '));

function safeCount(t) {
  try {
    const c = db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get();
    return c.c;
  } catch (e) {
    return 'ERR:' + e.message;
  }
}

['users', 'tenants', 'companies', 'organizations'].forEach(t => {
  console.log(t, '=>', safeCount(t));
});
