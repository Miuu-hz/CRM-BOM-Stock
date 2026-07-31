const Database = require('better-sqlite3');
const db = new Database('dev.db');
const tables = db.prepare("select name from sqlite_master where type='table'").all();
console.log(tables.map(t => t.name).join('\n'));
