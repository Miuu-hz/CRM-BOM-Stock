// Mock Database for Development/Testing

// ==================== MATERIAL CATEGORIES ====================
// หมวดหมู่วัตถุดิบ - กำหนดหน่วยตามประเภทวัตถุดิบ (ไม่สามารถเปลี่ยนได้)
export const materialCategories = [
  {
    id: 'cat-001',
    code: 'SYNTHETIC_FIBER',
    name: 'ใยสังเคราะห์',
    defaultUnit: 'kg', // ใยสังเคราะห์ต้องเป็นหน่วย กิโลกรัม เท่านั้น
    description: 'ใยสังเคราะห์สำหรับเครื่องนอน เช่น Polyester Fiber, Hollow Fiber',
  },
  {
    id: 'cat-002',
    code: 'NATURAL_FIBER',
    name: 'ใยธรรมชาติ',
    defaultUnit: 'kg',
    description: 'ใยธรรมชาติ เช่น ใยขนสัตว์, ใยฝ้าย, Down Feather',
  },
  {
    id: 'cat-003',
    code: 'FABRIC',
    name: 'ผ้า/ตาข่าย',
    defaultUnit: 'm', // ผ้าเป็นหน่วย เมตร
    description: 'ผ้าหุ้ม, ตาข่าย, ผ้าคอตตอน, ผ้าไมโครไฟเบอร์',
  },
  {
    id: 'cat-004',
    code: 'FOAM',
    name: 'โฟม/ยางพารา',
    defaultUnit: 'kg',
    description: 'โฟมอัด, โฟมยางพารา, Memory Foam, Latex',
  },
  {
    id: 'cat-005',
    code: 'SPRING',
    name: 'สปริง/โครงสร้าง',
    defaultUnit: 'pcs', // สปริงเป็นหน่วย ชิ้น
    description: 'สปริง, ข้อต่อ, โครงเหล็ก, แผ่นไม้',
  },
  {
    id: 'cat-006',
    code: 'THREAD',
    name: 'ด้าย/เส้นใย',
    defaultUnit: 'roll', // ด้ายเป็นหน่วย ม้วน
    description: 'ด้ายเย็บ, ด้ายปั๊ม, เชือก, ริบบิ้น',
  },
  {
    id: 'cat-007',
    code: 'FASTENER',
    name: 'อุปกรณ์ปิดผนึก',
    defaultUnit: 'm', // ซิปเป็นหน่วย เมตร
    description: 'ซิป, กระดุม, ตะขอ, Velcro',
  },
  {
    id: 'cat-008',
    code: 'PACKAGING',
    name: 'บรรจุภัณฑ์',
    defaultUnit: 'pcs',
    description: 'กล่อง, ถุงพลาสติก, ป้าย tag, คู่มือ',
  },
  {
    id: 'cat-009',
    code: 'CHEMICAL',
    name: 'สารเคมี/กาว',
    defaultUnit: 'ltr', // ของเหลวเป็นลิตร
    description: 'กาว, น้ำยาทำความสะอาด, สารกันบูด',
  },
  {
    id: 'cat-010',
    code: 'ACCESSORY',
    name: 'อุปกรณ์เสริม',
    defaultUnit: 'pcs',
    description: 'ป้ายแบรนด์, อุปกรณ์ตกแต่ง, อุปกรณ์เสริมอื่นๆ',
  },
]

export const users = [
  {
    id: '1',
    email: 'admin@example.com',
    password: 'admin123',
    name: 'Admin User',
    role: 'ADMIN',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
]

export const customers = [
  {
    id: '1',
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
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: '2',
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
    createdAt: new Date('2024-01-02'),
    updatedAt: new Date('2024-01-02'),
  },
  {
    id: '3',
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
    createdAt: new Date('2024-01-03'),
    updatedAt: new Date('2024-01-03'),
  },
  {
    id: '4',
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
    createdAt: new Date('2024-01-04'),
    updatedAt: new Date('2024-01-04'),
  },
]

export const products = [
  {
    id: '1',
    code: 'PROD-001',
    name: 'King Size Mattress Premium',
    category: 'Mattress',
    description: 'Premium king size mattress with spring coils',
    status: 'ACTIVE',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: '2',
    code: 'PROD-002',
    name: 'Queen Size Mattress',
    category: 'Mattress',
    description: 'Standard queen size mattress',
    status: 'ACTIVE',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: '3',
    code: 'PROD-003',
    name: 'Premium Pillow Set',
    category: 'Pillow',
    description: 'Memory foam pillow set (2 pieces)',
    status: 'ACTIVE',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: '4',
    code: 'PROD-004',
    name: 'Luxury Blanket',
    category: 'Blanket',
    description: 'Soft fleece blanket',
    status: 'ACTIVE',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
]

export const materials = [
  {
    id: '1',
    categoryId: 'cat-004', // FOAM
    code: 'MAT-001',
    name: 'Foam Layer',
    unit: 'kg', // หน่วยถูกกำหนดตาม category
    unitCost: 600,
    minStock: 500,
    maxStock: 2000,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: '2',
    categoryId: 'cat-005', // SPRING
    code: 'MAT-002',
    name: 'Spring Coils',
    unit: 'pcs',
    unitCost: 5,
    minStock: 2000,
    maxStock: 8000,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: '3',
    categoryId: 'cat-003', // FABRIC
    code: 'MAT-003',
    name: 'Fabric Cover',
    unit: 'm',
    unitCost: 250,
    minStock: 100,
    maxStock: 500,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: '4',
    categoryId: 'cat-006', // THREAD
    code: 'MAT-004',
    name: 'Thread',
    unit: 'roll',
    unitCost: 200,
    minStock: 50,
    maxStock: 200,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: '5',
    categoryId: 'cat-007', // FASTENER
    code: 'MAT-005',
    name: 'Zipper',
    unit: 'm',
    unitCost: 50,
    minStock: 500,
    maxStock: 2000,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
]

export const boms = [
  {
    id: '1',
    productId: '1',
    version: 'v2.1',
    status: 'ACTIVE',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    materials: [
      // unit ถูกลบออก - ดึงจาก materials แทน
      { materialId: '1', quantity: 2.5 },
      { materialId: '2', quantity: 800 },
      { materialId: '3', quantity: 3.5 },
      { materialId: '4', quantity: 1 },
      { materialId: '5', quantity: 1 },
    ],
  },
  {
    id: '2',
    productId: '3',
    version: 'v1.5',
    status: 'ACTIVE',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    materials: [
      { materialId: '1', quantity: 0.5 },
      { materialId: '3', quantity: 0.8 },
      { materialId: '4', quantity: 0.5 },
    ],
  },
]

export const stockItems = [
  {
    id: '1',
    sku: 'RM-FOAM-001',
    name: 'Foam Material',
    category: 'RAW_MATERIAL',
    materialId: '1',
    productId: null,
    quantity: 150,
    unit: 'kg',
    minStock: 500,
    maxStock: 2000,
    location: 'Warehouse A - Zone 1',
    status: 'CRITICAL',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-15'),
  },
  {
    id: '2',
    sku: 'RM-SPRING-002',
    name: 'Spring Coils',
    category: 'RAW_MATERIAL',
    materialId: '2',
    productId: null,
    quantity: 5400,
    unit: 'units',
    minStock: 2000,
    maxStock: 8000,
    location: 'Warehouse A - Zone 2',
    status: 'ADEQUATE',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-15'),
  },
  {
    id: '3',
    sku: 'FG-MATT-K-PREM',
    name: 'King Mattress Premium',
    category: 'FINISHED_GOODS',
    materialId: null,
    productId: '1',
    quantity: 180,
    unit: 'units',
    minStock: 50,
    maxStock: 200,
    location: 'Warehouse C - Zone 1',
    status: 'ADEQUATE',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-15'),
  },
  {
    id: '4',
    sku: 'FG-PILL-PREM',
    name: 'Premium Pillow',
    category: 'FINISHED_GOODS',
    materialId: null,
    productId: '3',
    quantity: 850,
    unit: 'units',
    minStock: 200,
    maxStock: 600,
    location: 'Warehouse C - Zone 2',
    status: 'OVERSTOCK',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-15'),
  },
  {
    id: '5',
    sku: 'RM-FABRIC-003',
    name: 'Fabric Cover',
    category: 'RAW_MATERIAL',
    materialId: '3',
    productId: null,
    quantity: 80,
    unit: 'meters',
    minStock: 100,
    maxStock: 500,
    location: 'Warehouse A - Zone 3',
    status: 'LOW',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-15'),
  },
]

export const orders = [
  {
    id: '1',
    orderNumber: 'ORD-1234',
    customerId: '1',
    orderDate: new Date('2024-01-15'),
    deliveryDate: new Date('2024-02-01'),
    totalAmount: 125000,
    status: 'PROCESSING',
    notes: 'Urgent order for hotel renovation',
    createdAt: new Date('2024-01-15'),
    updatedAt: new Date('2024-01-15'),
    items: [
      {
        productId: '1',
        quantity: 50,
        unitPrice: 2500,
        totalPrice: 125000,
      },
    ],
  },
  {
    id: '2',
    orderNumber: 'ORD-1233',
    customerId: '2',
    orderDate: new Date('2024-01-14'),
    deliveryDate: new Date('2024-01-28'),
    totalAmount: 80000,
    status: 'COMPLETED',
    notes: '',
    createdAt: new Date('2024-01-14'),
    updatedAt: new Date('2024-01-14'),
    items: [
      {
        productId: '3',
        quantity: 200,
        unitPrice: 400,
        totalPrice: 80000,
      },
    ],
  },
  {
    id: '3',
    orderNumber: 'ORD-1232',
    customerId: '3',
    orderDate: new Date('2024-01-14'),
    deliveryDate: null,
    totalAmount: 60000,
    status: 'PENDING',
    notes: '',
    createdAt: new Date('2024-01-14'),
    updatedAt: new Date('2024-01-14'),
    items: [
      {
        productId: '2',
        quantity: 30,
        unitPrice: 2000,
        totalPrice: 60000,
      },
    ],
  },
  {
    id: '4',
    orderNumber: 'ORD-1231',
    customerId: '4',
    orderDate: new Date('2024-01-13'),
    deliveryDate: new Date('2024-01-27'),
    totalAmount: 35000,
    status: 'COMPLETED',
    notes: '',
    createdAt: new Date('2024-01-13'),
    updatedAt: new Date('2024-01-13'),
    items: [
      {
        productId: '4',
        quantity: 100,
        unitPrice: 350,
        totalPrice: 35000,
      },
    ],
  },
]

// Saved BOMs for Calculator
export const savedBOMs: any[] = [
  {
    id: '1',
    name: 'King Size Mattress - Standard',
    description: 'Standard king size mattress production cost',
    materials: [
      { name: 'Foam Layer', quantity: 2.5, unitPrice: 600, unit: 'kg' },
      { name: 'Spring Coils', quantity: 800, unitPrice: 5, unit: 'units' },
      { name: 'Fabric Cover', quantity: 3.5, unitPrice: 250, unit: 'meters' },
    ],
    operatingCost: 500,
    scrapValue: 50,
    totalCost: 5825,
    createdAt: new Date('2024-01-10'),
    updatedAt: new Date('2024-01-10'),
  },
  {
    id: '2',
    name: 'Premium Pillow - Memory Foam',
    description: 'Memory foam pillow production cost',
    materials: [
      { name: 'Memory Foam', quantity: 0.8, unitPrice: 800, unit: 'kg' },
      { name: 'Fabric Cover', quantity: 1.2, unitPrice: 250, unit: 'meters' },
      { name: 'Zipper', quantity: 1, unitPrice: 50, unit: 'unit' },
    ],
    operatingCost: 100,
    scrapValue: 10,
    totalCost: 1030,
    createdAt: new Date('2024-01-12'),
    updatedAt: new Date('2024-01-12'),
  },
]

// Marketing Module Data
export const shops: any[] = [
  {
    id: '1',
    name: 'My Shopee Store',
    platform: 'SHOPEE',
    shopId: 'shopee_12345',
    isActive: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
]

export const marketingFiles: any[] = []

export const marketingMetrics: any[] = []
