import api from './api'

export interface StockItem {
  id: string
  sku: string
  name: string
  category: string
  productId?: string
  materialId?: string
  quantity: number
  unit: string
  minStock: number
  maxStock: number
  location: string
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
  type: 'IN' | 'OUT' | 'ADJUST'
  quantity: number
  reference?: string
  notes?: string
  createdAt: string
  createdBy: string
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
  category: string
  productId?: string
  materialId?: string
  quantity?: number
  unit: string
  minStock?: number
  maxStock?: number
  location?: string
}

export interface UpdateStockInput {
  name?: string
  category?: string
  minStock?: number
  maxStock?: number
  location?: string
}

export interface StockMovementInput {
  stockItemId: string
  type: 'IN' | 'OUT' | 'ADJUST'
  quantity: number
  notes?: string
  reference?: string
}

export const stockService = {
  // Get all stock items
  getAll: async (): Promise<StockItem[]> => {
    const response = await api.get('/stock')
    return response.data?.data || []
  },

  // Get stock item by ID
  getById: async (id: string): Promise<StockItem> => {
    const response = await api.get<StockItem>(`/stock/${id}`)
    if (!response.data?.data) {
      throw new Error('Stock item not found')
    }
    return response.data?.data
  },

  // Get stock statistics
  getStats: async (): Promise<StockStats> => {
    const response = await api.get<StockStats>('/stock/stats')
    return response.data?.data || {
      totalItems: 0,
      lowStockCount: 0,
      criticalCount: 0,
      totalValue: 0,
    }
  },

  // Create stock item
  create: async (input: CreateStockInput): Promise<StockItem> => {
    const response = await api.post<StockItem>('/stock', input)
    if (!response.data?.data) {
      throw new Error('Failed to create stock item')
    }
    return response.data?.data
  },

  // Update stock item
  update: async (id: string, input: UpdateStockInput): Promise<StockItem> => {
    const response = await api.put<StockItem>(`/stock/${id}`, input)
    if (!response.data?.data) {
      throw new Error('Failed to update stock item')
    }
    return response.data?.data
  },

  // Delete stock item
  delete: async (id: string): Promise<void> => {
    await api.delete(`/stock/${id}`)
  },

  // Record stock movement
  recordMovement: async (input: StockMovementInput): Promise<StockItem> => {
    const response = await api.post<StockItem>('/stock/movement', input)
    if (!response.data?.data) {
      throw new Error('Failed to record movement')
    }
    return response.data?.data
  },

  // Get movements for a stock item
  getMovements: async (id: string): Promise<StockMovement[]> => {
    const response = await api.get<StockMovement[]>(`/stock/${id}/movements`)
    return response.data?.data || []
  },
}

export default stockService
