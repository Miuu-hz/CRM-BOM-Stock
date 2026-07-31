const Database = require('better-sqlite3');
const db = new Database('dev.db');
for (const t of ['paperclip_companies', 'agent_jobs', 'line_channels']) {
  console.log('--- ' + t + ' ---');
  console.log(db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name).join(', '));
}
