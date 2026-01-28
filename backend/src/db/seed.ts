import db, { generateId } from './database'

console.log('🌱 Starting database seeding...')

// Clear existing data (in correct order due to foreign keys)
try {
  db.prepare('DELETE FROM order_items').run()
  db.prepare('DELETE FROM orders').run()
  db.prepare('DELETE FROM stock_movements').run()
  db.prepare('DELETE FROM stock_items').run()
  db.prepare('DELETE FROM bom_items').run()
  db.prepare('DELETE FROM boms').run()
  db.prepare('DELETE FROM materials').run()
  db.prepare('DELETE FROM products').run()
  db.prepare('DELETE FROM customers').run()
  console.log('✅ Cleared existing data')
} catch (error) {
  console.log('⚠️  No existing data to clear')
}

// Create Customers
const customers = [
  {
    id: generateId(),
    code: 'CUS-001',
    name: 'Hotel Grand Deluxe',
    type: 'HOTEL',
    contact_name: 'John Smith',
    email: 'john@hotelgrand.com',
    phone: '+66 2-345-6789',
    address: '123 Sukhumvit Road',
    city: 'Bangkok',
    credit_limit: 500000,
    status: 'ACTIVE'
  },
  {
    id: generateId(),
    code: 'CUS-002',
    name: 'ABC Trading Co.',
    type: 'WHOLESALE',
    contact_name: 'Sarah Johnson',
    email: 'sarah@abctrading.com',
    phone: '+66 2-456-7890',
    address: '456 Chang Klan Road',
    city: 'Chiang Mai',
    credit_limit: 300000,
    status: 'ACTIVE'
  },
  {
    id: generateId(),
    code: 'CUS-003',
    name: 'Resort Paradise',
    type: 'HOTEL',
    contact_name: 'Mike Wilson',
    email: 'mike@resortparadise.com',
    phone: '+66 76-234-567',
    address: '789 Beach Road',
    city: 'Phuket',
    credit_limit: 400000,
    status: 'ACTIVE'
  },
  {
    id: generateId(),
    code: 'CUS-004',
    name: 'Sleep Well Store',
    type: 'RETAIL',
    contact_name: 'Emma Davis',
    email: 'emma@sleepwell.com',
    phone: '+66 2-567-8901',
    address: '321 Ratchadaphisek Road',
    city: 'Bangkok',
    credit_limit: 150000,
    status: 'ACTIVE'
  }
]

const insertCustomer = db.prepare(`
  INSERT INTO customers (id, code, name, type, contact_name, email, phone, address, city, credit_limit, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

customers.forEach(c => {
  insertCustomer.run(c.id, c.code, c.name, c.type, c.contact_name, c.email, c.phone, c.address, c.city, c.credit_limit, c.status)
})
console.log(`✅ Created ${customers.length} customers`)

// Create Materials
const materials = [
  { id: generateId(), code: 'MAT-001', name: 'Foam Layer', unit: 'kg', unit_cost: 600, min_stock: 500, max_stock: 2000 },
  { id: generateId(), code: 'MAT-002', name: 'Spring Coils', unit: 'units', unit_cost: 5, min_stock: 2000, max_stock: 8000 },
  { id: generateId(), code: 'MAT-003', name: 'Fabric Cover', unit: 'meters', unit_cost: 250, min_stock: 100, max_stock: 500 },
  { id: generateId(), code: 'MAT-004', name: 'Thread', unit: 'roll', unit_cost: 200, min_stock: 50, max_stock: 200 },
  { id: generateId(), code: 'MAT-005', name: 'Zipper', unit: 'unit', unit_cost: 50, min_stock: 500, max_stock: 2000 },
  { id: generateId(), code: 'MAT-006', name: 'Memory Foam', unit: 'kg', unit_cost: 800, min_stock: 200, max_stock: 1000 },
  { id: generateId(), code: 'MAT-007', name: 'Cotton Cover', unit: 'meters', unit_cost: 200, min_stock: 100, max_stock: 500 }
]

const insertMaterial = db.prepare(`
  INSERT INTO materials (id, code, name, unit, unit_cost, min_stock, max_stock)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`)

materials.forEach(m => {
  insertMaterial.run(m.id, m.code, m.name, m.unit, m.unit_cost, m.min_stock, m.max_stock)
})
console.log(`✅ Created ${materials.length} materials`)

// Create Products
const products = [
  {
    id: generateId(),
    code: 'PROD-001',
    name: 'King Size Mattress Premium',
    category: 'Mattress',
    description: 'Premium king size mattress with spring coils',
    status: 'ACTIVE'
  },
  {
    id: generateId(),
    code: 'PROD-002',
    name: 'Queen Size Mattress',
    category: 'Mattress',
    description: 'Standard queen size mattress',
    status: 'ACTIVE'
  },
  {
    id: generateId(),
    code: 'PROD-003',
    name: 'Premium Pillow Set',
    category: 'Pillow',
    description: 'Memory foam pillow set (2 pieces)',
    status: 'ACTIVE'
  },
  {
    id: generateId(),
    code: 'PROD-004',
    name: 'Luxury Blanket',
    category: 'Blanket',
    description: 'Soft fleece blanket',
    status: 'ACTIVE'
  }
]

const insertProduct = db.prepare(`
  INSERT INTO products (id, code, name, category, description, status)
  VALUES (?, ?, ?, ?, ?, ?)
`)

products.forEach(p => {
  insertProduct.run(p.id, p.code, p.name, p.category, p.description, p.status)
})
console.log(`✅ Created ${products.length} products`)

// Create BOMs
const bom1Id = generateId()
const bom2Id = generateId()

db.prepare(`
  INSERT INTO boms (id, product_id, version, status)
  VALUES (?, ?, ?, ?)
`).run(bom1Id, products[0].id, 'v2.1', 'ACTIVE')

db.prepare(`
  INSERT INTO boms (id, product_id, version, status)
  VALUES (?, ?, ?, ?)
`).run(bom2Id, products[2].id, 'v1.5', 'ACTIVE')

// BOM Items for King Mattress
const bom1Items = [
  { bom_id: bom1Id, material_id: materials[0].id, quantity: 2.5, unit: 'kg' },
  { bom_id: bom1Id, material_id: materials[1].id, quantity: 800, unit: 'units' },
  { bom_id: bom1Id, material_id: materials[2].id, quantity: 3.5, unit: 'meters' },
  { bom_id: bom1Id, material_id: materials[3].id, quantity: 1, unit: 'roll' },
  { bom_id: bom1Id, material_id: materials[4].id, quantity: 1, unit: 'unit' }
]

// BOM Items for Pillow Set
const bom2Items = [
  { bom_id: bom2Id, material_id: materials[5].id, quantity: 0.5, unit: 'kg' },
  { bom_id: bom2Id, material_id: materials[6].id, quantity: 0.8, unit: 'meters' },
  { bom_id: bom2Id, material_id: materials[3].id, quantity: 0.5, unit: 'roll' }
]

const insertBomItem = db.prepare(`
  INSERT INTO bom_items (id, bom_id, material_id, quantity, unit)
  VALUES (?, ?, ?, ?, ?)
`)

;[...bom1Items, ...bom2Items].forEach(item => {
  insertBomItem.run(generateId(), item.bom_id, item.material_id, item.quantity, item.unit)
})
console.log('✅ Created 2 BOMs with materials')

// Create Stock Items
const stockItems = [
  {
    id: generateId(),
    sku: 'RM-FOAM-001',
    name: 'Foam Material',
    category: 'RAW_MATERIAL',
    material_id: materials[0].id,
    quantity: 150,
    unit: 'kg',
    min_stock: 500,
    max_stock: 2000,
    location: 'Warehouse A - Zone 1',
    status: 'CRITICAL'
  },
  {
    id: generateId(),
    sku: 'RM-SPRING-002',
    name: 'Spring Coils',
    category: 'RAW_MATERIAL',
    material_id: materials[1].id,
    quantity: 5400,
    unit: 'units',
    min_stock: 2000,
    max_stock: 8000,
    location: 'Warehouse A - Zone 2',
    status: 'ADEQUATE'
  },
  {
    id: generateId(),
    sku: 'FG-MATT-K-PREM',
    name: 'King Mattress Premium',
    category: 'FINISHED_GOODS',
    product_id: products[0].id,
    quantity: 180,
    unit: 'units',
    min_stock: 50,
    max_stock: 200,
    location: 'Warehouse C - Zone 1',
    status: 'ADEQUATE'
  },
  {
    id: generateId(),
    sku: 'FG-PILL-PREM',
    name: 'Premium Pillow',
    category: 'FINISHED_GOODS',
    product_id: products[2].id,
    quantity: 850,
    unit: 'units',
    min_stock: 200,
    max_stock: 600,
    location: 'Warehouse C - Zone 2',
    status: 'OVERSTOCK'
  }
]

const insertStockItem = db.prepare(`
  INSERT INTO stock_items (id, sku, name, category, product_id, material_id, quantity, unit, min_stock, max_stock, location, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

stockItems.forEach(item => {
  insertStockItem.run(
    item.id,
    item.sku,
    item.name,
    item.category,
    item.product_id || null,
    item.material_id || null,
    item.quantity,
    item.unit,
    item.min_stock,
    item.max_stock,
    item.location,
    item.status
  )
})
console.log(`✅ Created ${stockItems.length} stock items`)

// Create Orders
const order1Id = generateId()
const order2Id = generateId()
const order3Id = generateId()

const insertOrder = db.prepare(`
  INSERT INTO orders (id, order_number, customer_id, order_date, delivery_date, total_amount, status, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`)

insertOrder.run(
  order1Id,
  'ORD-1234',
  customers[0].id,
  '2024-01-15',
  '2024-02-01',
  125000,
  'PROCESSING',
  'Urgent order for hotel renovation'
)

insertOrder.run(
  order2Id,
  'ORD-1233',
  customers[1].id,
  '2024-01-14',
  '2024-01-28',
  80000,
  'COMPLETED',
  null
)

insertOrder.run(
  order3Id,
  'ORD-1232',
  customers[2].id,
  '2024-01-14',
  null,
  60000,
  'PENDING',
  null
)

// Create Order Items
const insertOrderItem = db.prepare(`
  INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, total_price)
  VALUES (?, ?, ?, ?, ?, ?)
`)

insertOrderItem.run(generateId(), order1Id, products[0].id, 50, 2500, 125000)
insertOrderItem.run(generateId(), order2Id, products[2].id, 200, 400, 80000)
insertOrderItem.run(generateId(), order3Id, products[1].id, 30, 2000, 60000)

console.log('✅ Created 3 orders with items')

console.log('🎉 Database seeding completed successfully!')
