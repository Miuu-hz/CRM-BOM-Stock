import api from './api'

export interface StockItem {
  id: string
  sku: string
  name: string
  gs1Barcode?: string
  category: string
  productId?: string
  materialId?: string
  quantity: number
  sealedQty?: number
  unit: string
  baseUnit?: string
  saleUnit?: string
  displayUnit?: string
  displayQuantity?: number
  minStock: number
  maxStock: number
  location: string
  isPosEnabled?: boolean
  unitCost?: number
  unitPrice?: number
  imageUrl?: string
  status: string
  createdAt: string
  updatedAt: string
  product?: {
    id: string
    code: string
    name: string
  }
  material?: {
    id: string
    code: string
    name: string
    unitCost: number
  }
  movements?: StockMovement[]
}

export interface StockMovement {
  id: string
  stockItemId: string
  type: 'IN' | 'OUT' | 'ADJUST' | 'PRICE_CHANGE'
  quantity: number
  movementUnit?: string
  movementQuantity?: number
  reference?: string
  notes?: string
  createdAt: string
  createdBy: string
  journalId?: string
  journalNumber?: string
}

export interface StockStats {
  totalItems: number
  lowStockCount: number
  criticalCount: number
  totalValue: number
}

export interface CreateStockInput {
  sku: string
  name: string
  gs1Barcode?: string
  category: string
  productId?: string
  materialId?: string
  quantity?: number
  unit: string
  baseUnit?: string
  saleUnit?: string
  displayUnit?: string
  minStock?: number
  maxStock?: number
  location?: string
  isPosEnabled?: boolean
  unitCost?: number
  unitPrice?: number
}

export interface UpdateStockInput {
  name?: string
  gs1Barcode?: string
  category?: string
  unit?: string
  baseUnit?: string
  saleUnit?: string
  displayUnit?: string
  minStock?: number
  maxStock?: number
  location?: string
  isPosEnabled?: boolean
  unitCost?: number
  unitPrice?: number
}

export interface StockMovementInput {
  stockItemId: string
  type: 'IN' | 'OUT' | 'ADJUST'
  quantity: number
  unit?: string
  notes?: string
  reference?: string
  unitCost?: number
}

function mapStockMovement(m: any): StockMovement {
  return {
    ...m,
    stockItemId: m.stock_item_id || m.stockItemId,
    movementUnit: m.movement_unit || m.movementUnit,
    movementQuantity: m.movement_quantity !== undefined ? m.movement_quantity : m.movementQuantity,
    createdAt: m.created_at || m.createdAt,
    createdBy: m.created_by || m.createdBy,
    journalId: m.journal_id || m.journalId,
    journalNumber: m.journal_number || m.journalNumber,
  }
}

function mapStockItem(item: any): StockItem {
  if (!item) return item
  const mapped: StockItem = {
    ...item,
    productId: item.product_id || item.productId,
    materialId: item.material_id || item.materialId,
    sealedQty: item.sealed_qty !== undefined ? item.sealed_qty : item.sealedQty,
    baseUnit: item.base_unit || item.baseUnit,
    saleUnit: item.sale_unit || item.saleUnit,
    displayUnit: item.display_unit || item.displayUnit,
    displayQuantity: item.display_quantity !== undefined ? item.display_quantity : item.displayQuantity,
    unitCost: item.unit_cost !== undefined ? item.unit_cost : item.unitCost,
    unitPrice: item.unit_price !== undefined ? item.unit_price : item.unitPrice,
    imageUrl: item.image_url || item.imageUrl,
    isPosEnabled: item.is_pos_enabled !== undefined ? item.is_pos_enabled : item.isPosEnabled,
    createdAt: item.created_at || item.createdAt,
    updatedAt: item.updated_at || item.updatedAt,
    movements: item.movements?.map(mapStockMovement),
  }
  return mapped
}

export const stockService = {
  // Get all stock items
  getAll: async (): Promise<StockItem[]> => {
    const response = await api.get('/stock')
    const items = response.data?.data || []
    return items.map(mapStockItem)
  },

  // Get stock item by ID
  getById: async (id: string): Promise<StockItem> => {
    const response = await api.get<any>(`/stock/${id}`)
    if (!response.data?.data) {
      throw new Error('Stock item not found')
    }
    return mapStockItem(response.data.data)
  },

  // Get stock statistics
  getStats: async (): Promise<StockStats> => {
    const response = await api.get<any>('/stock/stats')
    return response.data?.data || {
      totalItems: 0,
      lowStockCount: 0,
      criticalCount: 0,
      totalValue: 0,
    }
  },

  // Create stock item
  create: async (input: CreateStockInput): Promise<StockItem> => {
    const response = await api.post<any>('/stock', input)
    if (!response.data?.data) {
      throw new Error('Failed to create stock item')
    }
    return mapStockItem(response.data.data)
  },

  // Update stock item
  update: async (id: string, input: UpdateStockInput): Promise<StockItem> => {
    const response = await api.put<any>(`/stock/${id}`, input)
    if (!response.data?.data) {
      throw new Error('Failed to update stock item')
    }
    return mapStockItem(response.data.data)
  },

  // Delete stock item
  delete: async (id: string): Promise<void> => {
    await api.delete(`/stock/${id}`)
  },

  // Record stock movement
  recordMovement: async (input: StockMovementInput): Promise<StockItem> => {
    const response = await api.post<any>('/stock/movement', input)
    if (!response.data?.data) {
      throw new Error('Failed to record movement')
    }
    return mapStockItem(response.data.data)
  },

  // Upload image for stock item
  uploadImage: async (id: string, file: File): Promise<{ image_url: string }> => {
    const formData = new FormData()
    formData.append('image', file)
    const response = await api.post(`/stock/${id}/image`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return response.data.data
  },

  // Delete image for stock item
  deleteImage: async (id: string): Promise<void> => {
    await api.delete(`/stock/${id}/image`)
  },

  // Get movements for a stock item
  getMovements: async (id: string): Promise<StockMovement[]> => {
    const response = await api.get<any>(`/stock/${id}/movements`)
    return response.data?.data || []
  },
}

export default stockService
