import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // Make seed repeatable for local dev
  await prisma.orderItem.deleteMany()
  await prisma.order.deleteMany()
  await prisma.stockMovement.deleteMany().catch(() => undefined)
  await prisma.stockItem.deleteMany()
  await prisma.bOMItem.deleteMany()
  await prisma.bOM.deleteMany()
  await prisma.material.deleteMany()
  await prisma.product.deleteMany()
  await prisma.customer.deleteMany()

  // Create Users
  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      password: '$2a$10$YourHashedPasswordHere', // In production, hash this properly
      name: 'Admin User',
      role: 'ADMIN',
    },
  })

  console.log('✅ Created admin user')

  // Create Customers
  const customers = await Promise.all([
    prisma.customer.create({
      data: {
        code: 'CUS-001',
        name: 'Hotel Grand Deluxe',
        type: 'HOTEL',
        contactName: 'John Smith',
        email: 'john@hotelgrand.com',
        phone: '+66 2-345-6789',
        address: '123 Sukhumvit Road',
        city: 'Bangkok',
        creditLimit: 500000,
        status: 'ACTIVE',
      },
    }),
    prisma.customer.create({
      data: {
        code: 'CUS-002',
        name: 'ABC Trading Co.',
        type: 'WHOLESALE',
        contactName: 'Sarah Johnson',
        email: 'sarah@abctrading.com',
        phone: '+66 2-456-7890',
        address: '456 Chang Klan Road',
        city: 'Chiang Mai',
        creditLimit: 300000,
        status: 'ACTIVE',
      },
    }),
    prisma.customer.create({
      data: {
        code: 'CUS-003',
        name: 'Resort Paradise',
        type: 'HOTEL',
        contactName: 'Mike Wilson',
        email: 'mike@resortparadise.com',
        phone: '+66 76-234-567',
        address: '789 Beach Road',
        city: 'Phuket',
        creditLimit: 400000,
        status: 'ACTIVE',
      },
    }),
    prisma.customer.create({
      data: {
        code: 'CUS-004',
        name: 'Sleep Well Store',
        type: 'RETAIL',
        contactName: 'Emma Davis',
        email: 'emma@sleepwell.com',
        phone: '+66 2-567-8901',
        address: '321 Ratchadaphisek Road',
        city: 'Bangkok',
        creditLimit: 150000,
        status: 'ACTIVE',
      },
    }),
  ])

  console.log('✅ Created customers:', customers.length)

  // Create Materials
  const materials = await Promise.all([
    prisma.material.create({
      data: {
        code: 'MAT-001',
        name: 'Foam Layer',
        unit: 'kg',
        unitCost: 600,
        minStock: 500,
        maxStock: 2000,
      },
    }),
    prisma.material.create({
      data: {
        code: 'MAT-002',
        name: 'Spring Coils',
        unit: 'units',
        unitCost: 5,
        minStock: 2000,
        maxStock: 8000,
      },
    }),
    prisma.material.create({
      data: {
        code: 'MAT-003',
        name: 'Fabric Cover',
        unit: 'meters',
        unitCost: 250,
        minStock: 100,
        maxStock: 500,
      },
    }),
    prisma.material.create({
      data: {
        code: 'MAT-004',
        name: 'Thread',
        unit: 'roll',
        unitCost: 200,
        minStock: 50,
        maxStock: 200,
      },
    }),
    prisma.material.create({
      data: {
        code: 'MAT-005',
        name: 'Zipper',
        unit: 'unit',
        unitCost: 50,
        minStock: 500,
        maxStock: 2000,
      },
    }),
    prisma.material.create({
      data: {
        code: 'MAT-006',
        name: 'Memory Foam',
        unit: 'kg',
        unitCost: 800,
        minStock: 200,
        maxStock: 1000,
      },
    }),
    prisma.material.create({
      data: {
        code: 'MAT-007',
        name: 'Cotton Cover',
        unit: 'meters',
        unitCost: 200,
        minStock: 100,
        maxStock: 500,
      },
    }),
  ])

  console.log('✅ Created materials:', materials.length)

  // Create Products
  const products = await Promise.all([
    prisma.product.create({
      data: {
        code: 'PROD-001',
        name: 'King Size Mattress Premium',
        category: 'Mattress',
        description: 'Premium king size mattress with spring coils',
        status: 'ACTIVE',
      },
    }),
    prisma.product.create({
      data: {
        code: 'PROD-002',
        name: 'Queen Size Mattress',
        category: 'Mattress',
        description: 'Standard queen size mattress',
        status: 'ACTIVE',
      },
    }),
    prisma.product.create({
      data: {
        code: 'PROD-003',
        name: 'Premium Pillow Set',
        category: 'Pillow',
        description: 'Memory foam pillow set (2 pieces)',
        status: 'ACTIVE',
      },
    }),
    prisma.product.create({
      data: {
        code: 'PROD-004',
        name: 'Luxury Blanket',
        category: 'Blanket',
        description: 'Soft fleece blanket',
        status: 'ACTIVE',
      },
    }),
  ])

  console.log('✅ Created products:', products.length)

  // Create BOMs
  const bom1 = await prisma.bOM.create({
    data: {
      productId: products[0].id,
      version: 'v2.1',
      status: 'ACTIVE',
      materials: {
        create: [
          {
            materialId: materials[0].id,
            quantity: 2.5,
            unit: 'kg',
          },
          {
            materialId: materials[1].id,
            quantity: 800,
            unit: 'units',
          },
          {
            materialId: materials[2].id,
            quantity: 3.5,
            unit: 'meters',
          },
          {
            materialId: materials[3].id,
            quantity: 1,
            unit: 'roll',
          },
          {
            materialId: materials[4].id,
            quantity: 1,
            unit: 'unit',
          },
        ],
      },
    },
  })

  const bom2 = await prisma.bOM.create({
    data: {
      productId: products[2].id,
      version: 'v1.5',
      status: 'ACTIVE',
      materials: {
        create: [
          {
            materialId: materials[5].id,
            quantity: 0.5,
            unit: 'kg',
          },
          {
            materialId: materials[6].id,
            quantity: 0.8,
            unit: 'meters',
          },
          {
            materialId: materials[3].id,
            quantity: 0.5,
            unit: 'roll',
          },
        ],
      },
    },
  })

  console.log('✅ Created BOMs:', 2)

  // Create Stock Items
  const stockItems = await Promise.all([
    prisma.stockItem.create({
      data: {
        sku: 'RM-FOAM-001',
        name: 'Foam Material',
        category: 'RAW_MATERIAL',
        materialId: materials[0].id,
        quantity: 150,
        unit: 'kg',
        minStock: 500,
        maxStock: 2000,
        location: 'Warehouse A - Zone 1',
        status: 'CRITICAL',
      },
    }),
    prisma.stockItem.create({
      data: {
        sku: 'RM-SPRING-002',
        name: 'Spring Coils',
        category: 'RAW_MATERIAL',
        materialId: materials[1].id,
        quantity: 5400,
        unit: 'units',
        minStock: 2000,
        maxStock: 8000,
        location: 'Warehouse A - Zone 2',
        status: 'ADEQUATE',
      },
    }),
    prisma.stockItem.create({
      data: {
        sku: 'FG-MATT-K-PREM',
        name: 'King Mattress Premium',
        category: 'FINISHED_GOODS',
        productId: products[0].id,
        quantity: 180,
        unit: 'units',
        minStock: 50,
        maxStock: 200,
        location: 'Warehouse C - Zone 1',
        status: 'ADEQUATE',
      },
    }),
    prisma.stockItem.create({
      data: {
        sku: 'FG-PILL-PREM',
        name: 'Premium Pillow',
        category: 'FINISHED_GOODS',
        productId: products[2].id,
        quantity: 850,
        unit: 'units',
        minStock: 200,
        maxStock: 600,
        location: 'Warehouse C - Zone 2',
        status: 'OVERSTOCK',
      },
    }),
  ])

  console.log('✅ Created stock items:', stockItems.length)

  // Create Orders
  const orders = await Promise.all([
    prisma.order.create({
      data: {
        orderNumber: 'ORD-1234',
        customerId: customers[0].id,
        orderDate: new Date('2024-01-15'),
        deliveryDate: new Date('2024-02-01'),
        totalAmount: 125000,
        status: 'PROCESSING',
        notes: 'Urgent order for hotel renovation',
        items: {
          create: [
            {
              productId: products[0].id,
              quantity: 50,
              unitPrice: 2500,
              totalPrice: 125000,
            },
          ],
        },
      },
    }),
    prisma.order.create({
      data: {
        orderNumber: 'ORD-1233',
        customerId: customers[1].id,
        orderDate: new Date('2024-01-14'),
        deliveryDate: new Date('2024-01-28'),
        totalAmount: 80000,
        status: 'COMPLETED',
        items: {
          create: [
            {
              productId: products[2].id,
              quantity: 200,
              unitPrice: 400,
              totalPrice: 80000,
            },
          ],
        },
      },
    }),
    prisma.order.create({
      data: {
        orderNumber: 'ORD-1232',
        customerId: customers[2].id,
        orderDate: new Date('2024-01-14'),
        totalAmount: 60000,
        status: 'PENDING',
        items: {
          create: [
            {
              productId: products[1].id,
              quantity: 30,
              unitPrice: 2000,
              totalPrice: 60000,
            },
          ],
        },
      },
    }),
  ])

  console.log('✅ Created orders:', orders.length)

  console.log('🎉 Seeding completed successfully!')
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error('❌ Seeding failed:', e)
    await prisma.$disconnect()
    process.exit(1)
  })
