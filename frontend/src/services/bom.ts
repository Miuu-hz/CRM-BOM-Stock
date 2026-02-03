import api from './api'

// Types
export interface Material {
  id: string
  code: string
  name: string
  unit: string
  unitCost: number
}

export interface BOMItemMaterial {
  id: string
  materialId: string
  quantity: number
  unit: string
  material: Material
}

export interface Product {
  id: string
  code: string
  name: string
  category: string
  description?: string
  status: string
}

export interface BOM {
  id: string
  productId: string
  version: string
  status: 'DRAFT' | 'ACTIVE'
  createdAt: string
  updatedAt: string
  product: Product
  materials: BOMItemMaterial[]
  totalCost: number
}

export interface BOMStats {
  totalBOMs: number
  activeBOMs: number
  totalMaterials: number
  avgCostPerUnit: number
}

export interface CreateBOMInput {
  productId: string
  version: string
  status?: 'DRAFT' | 'ACTIVE'
  materials: {
    materialId: string
    quantity: number
    unit: string
  }[]
}

export interface UpdateBOMInput {
  version?: string
  status?: 'DRAFT' | 'ACTIVE'
  materials?: {
    materialId: string
    quantity: number
    unit: string
  }[]
}

// API functions
export const bomService = {
  // Get all BOMs with details
  getAll: async (): Promise<BOM[]> => {
    const response = await api.get<BOM[]>('/bom')
    return response.data?.data || []
  },

  // Get BOM by ID
  getById: async (id: string): Promise<BOM> => {
    const response = await api.get<BOM>(`/bom/${id}`)
    if (!response.data?.data) {
      throw new Error('BOM not found')
    }
    return response.data?.data
  },

  // Get BOM statistics
  getStats: async (): Promise<BOMStats> => {
    const response = await api.get<BOMStats>('/bom/stats')
    return response.data?.data || {
      totalBOMs: 0,
      activeBOMs: 0,
      totalMaterials: 0,
      avgCostPerUnit: 0,
    }
  },

  // Create new BOM
  create: async (input: CreateBOMInput): Promise<BOM> => {
    const response = await api.post<BOM>('/bom', input)
    if (!response.data?.data) {
      throw new Error('Failed to create BOM')
    }
    return response.data?.data
  },

  // Update BOM
  update: async (id: string, input: UpdateBOMInput): Promise<BOM> => {
    const response = await api.put<BOM>(`/bom/${id}`, input)
    if (!response.data?.data) {
      throw new Error('Failed to update BOM')
    }
    return response.data?.data
  },

  // Delete BOM
  delete: async (id: string): Promise<void> => {
    await api.delete(`/bom/${id}`)
  },

  // Get all materials (for dropdown/selection)
  getMaterials: async (): Promise<Material[]> => {
    const response = await api.get<Material[]>('/data/materials')
    return response.data?.data || []
  },

  // Get all products (for dropdown/selection)
  getProducts: async (): Promise<Product[]> => {
    const response = await api.get<Product[]>('/data/products')
    return response.data?.data || []
  },
}

export default bomService
