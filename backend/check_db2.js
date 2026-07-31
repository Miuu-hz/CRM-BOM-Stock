const db = require('better-sqlite3')('dev.db');

function schema(t) {
  const cols = db.prepare(`PRAGMA table_info(${t})`).all();
  console.log(`\n== ${t} ==`);
  cols.forEach(c => console.log(` ${c.name} (${c.type})${c.pk ? ' PK' : ''}`));
}

['subscription_plans', 'tenant_subscriptions', 'shops', 'users', 'company_settings'].forEach(schema);

console.log('\n== subscription_plans rows ==');
try { console.log(db.prepare('SELECT * FROM subscription_plans').all()); } catch (e) { console.log('ERR', e.message); }

console.log('\n== tenant_subscriptions rows (limit 10) ==');
try { console.log(db.prepare('SELECT * FROM tenant_subscriptions LIMIT 10').all()); } catch (e) { console.log('ERR', e.message); }

console.log('\n== shops rows (limit 10) ==');
try { console.log(db.prepare('SELECT id, name, created_at FROM shops LIMIT 10').all()); } catch (e) { console.log('ERR', e.message); }

console.log('\n== users rows ==');
try { console.log(db.prepare('SELECT id, email, role, tenant_id FROM users').all()); } catch (e) { console.log('ERR', e.message); }
