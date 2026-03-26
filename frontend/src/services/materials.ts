import api from './api'

export interface MaterialCategory {
  id: string
  code: string
  name: string
  defaultUnit: string
  description?: string
}

export interface Material {
  id: string
  categoryId?: string
  categoryName?: string
  categoryDefaultUnit?: string
  code: string
  name: string
  unit: string
  unitCost: number
  minStock: number
  maxStock: number
  currentStock?: number
  stockStatus?: string
  usedInBOMs?: number
  stockItem?: StockItem
}

export interface StockItem {
  id: string
  sku: string
  name: string
  category: string
  quantity: number
  unit: string
  minStock: number
  maxStock: number
  location: string
  status: string
}

export interface MaterialStats {
  totalMaterials: number
  lowStockCount: number
  totalValue: number
  activeItems: number
}

export interface CreateMaterialInput {
  code: string
  name: string
  categoryId: string
  unitCost: number
  minStock?: number
  maxStock?: number
  initialStock?: number
}

export interface UpdateMaterialInput {
  code?: string
  name?: string
  categoryId?: string
  unitCost?: number
  minStock?: number
  maxStock?: number
}

export interface StockAdjustment {
  type: 'IN' | 'OUT' | 'ADJUST'
  quantity: number
  notes?: string
}

export const materialsService = {
  // Get all material categories
  getCategories: async (): Promise<MaterialCategory[]> => {
    const response = await api.get<any>('/materials/categories')
    return response.data?.data || []
  },

  // Create new category (admin only)
  createCategory: async (input: { code: string; name: string; defaultUnit: string; description?: string }): Promise<MaterialCategory> => {
    const response = await api.post<any>('/materials/categories', input)
    return response.data?.data
  },

  // Get all materials with stock info
  getAll: async (): Promise<Material[]> => {
    const response = await api.get<any>('/materials')
    return response.data?.data || []
  },

  // Get material by ID
  getById: async (id: string): Promise<Material> => {
    const response = await api.get<any>(`/materials/${id}`)
    if (!response.data?.data) {
      throw new Error('Material not found')
    }
    return response.data?.data
  },

  // Get materials statistics
  getStats: async (): Promise<MaterialStats> => {
    const response = await api.get<any>('/materials/stats')
    return response.data?.data || {
      totalMaterials: 0,
      lowStockCount: 0,
      totalValue: 0,
      activeItems: 0,
    }
  },

  // Create new material
  create: async (input: CreateMaterialInput): Promise<Material> => {
    const response = await api.post<any>('/materials', input)
    if (!response.data?.data) {
      throw new Error('Failed to create material')
    }
    return response.data?.data
  },

  // Update material
  update: async (id: string, input: UpdateMaterialInput): Promise<Material> => {
    const response = await api.put<any>(`/materials/${id}`, input)
    if (!response.data?.data) {
      throw new Error('Failed to update material')
    }
    return response.data?.data
  },

  // Delete material
  delete: async (id: string): Promise<void> => {
    await api.delete(`/materials/${id}`)
  },

  // Adjust stock for material
  adjustStock: async (id: string, adjustment: StockAdjustment): Promise<any> => {
    const response = await api.post(`/materials/${id}/stock`, adjustment)
    return response.data
  },
}

export default materialsService
