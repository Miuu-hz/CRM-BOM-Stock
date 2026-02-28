const Database = require("better-sqlite3");
const db = new Database("backend/dev.db");

// Check customers table schema
const result = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='customers'").get();
console.log("=== Customers Table Schema ===");
console.log(result ? result.sql : "Table not found");

// Check stock_items table schema  
const result2 = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='stock_items'").get();
console.log("\n=== Stock Items Table Schema ===");
console.log(result2 ? result2.sql : "Table not found");

db.close();
