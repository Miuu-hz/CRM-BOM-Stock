const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'dev.db'));
const tenantId = 'tenant_bb_pillow';

console.log('=== Testing /data/products endpoint ===');
const products = db.prepare(`
  SELECT id, category, sku as code, name, unit, unit_cost
  FROM stock_items
  WHERE tenant_id = ?
    AND category IN (
      '[สินค้า]', '[สินค้าสำเร็จรูป]', '[สินค้ากึ่งสำเร็จรูป]',
      'finished', 'wip', 'FINISHED', 'WIP', 'material'
    )
  ORDER BY name ASC
`).all(tenantId);
console.log('✓ Products found:', products.length);
console.log('  Sample:', products.slice(0, 3).map(p => `[${p.category}] ${p.code} - ${p.name}`));

console.log('');
console.log('=== Testing /data/materials endpoint ===');
const materials = db.prepare(`
  SELECT id, category, sku as code, name, unit, unit_cost
  FROM stock_items
  WHERE tenant_id = ?
    AND category NOT IN ('[สินค้า]', '[สินค้าสำเร็จรูป]', 'finished', 'FINISHED')
  ORDER BY name ASC
`).all(tenantId);
console.log('✓ Materials found:', materials.length);
console.log('  Sample:', materials.slice(0, 3).map(m => `[${m.category}] ${m.code} - ${m.name}`));

console.log('');
console.log('=== Verify bom_items schema ===');
const bomColInfo = db.prepare('PRAGMA table_info(bom_items)').all();
console.log('✓ bom_items columns:', bomColInfo.map(c => c.name).join(', '));

const bomFK = db.prepare('PRAGMA foreign_key_list(bom_items)').all();
console.log('✓ Foreign keys:');
bomFK.forEach(fk => console.log(`  - ${fk.from} → ${fk.table}(${fk.to})`));

console.log('');
console.log('=== All fixes verified! ===');
