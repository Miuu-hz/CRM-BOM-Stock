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

// Nested BOM Types
export interface BOMItem {
  id: string
  bomId?: string
  materialId?: string
  childBomId?: string
  itemType: 'MATERIAL' | 'CHILD_BOM'
  quantity: number
  unit?: string
  notes?: string
  sortOrder: number
  // Material info
  material?: {
    id: string
    code: string
    name: string
    unit: string
    unitCost: number
  }
  // Child BOM info
  childBomVersion?: string
  childBomProductName?: string
  childBomProductCode?: string
  childBOM?: BOMTreeNode
}

export interface BOMTreeNode {
  id: string
  productId: string
  productName: string
  productCode: string
  productCategory?: string
  version: string
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
  level: number
  isSemiFinished: boolean
  is_semi_finished?: number
  parentId?: string
  tenantId?: string
  totalCost: number
  items: BOMItem[]
  itemCount: number
  createdAt: string
  updatedAt: string
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
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
  level: number
  isSemiFinished: boolean
  is_semi_finished?: number
  parentId?: string
  createdAt: string
  updatedAt: string
  product: Product
  productName?: string
  productCode?: string
  productCategory?: string
  parentVersion?: string
  parentProductName?: string
  items?: BOMItem[]
  materials: BOMItemMaterial[] | BOMItem[]
  totalCost: number
  isTopLevel?: boolean
}

export interface BOMStats {
  totalBOMs: number
  activeBOMs: number
  semiFinishedBOMs: number
  totalMaterials: number
  avgCostPerUnit: number
}

export interface BOMItemInput {
  itemType: 'MATERIAL' | 'CHILD_BOM'
  materialId?: string
  childBomId?: string
  quantity: number
  notes?: string
}

export interface CreateBOMInput {
  productId: string
  version: string
  status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
  isSemiFinished?: boolean
  parentId?: string
  items?: BOMItemInput[]
  materials?: {
    materialId: string
    quantity: number
    unit: string
  }[]
}

export interface UpdateBOMInput {
  version?: string
  status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
  isSemiFinished?: boolean
  items?: BOMItemInput[]
  materials?: {
    materialId: string
    quantity: number
    unit: string
  }[]
}

// API Response wrapper
interface ApiResponse<T> {
  success: boolean
  data: T
  message?: string
}

// API functions
export const bomService = {
  // Get all BOMs with details
  getAll: async (): Promise<BOM[]> => {
    const response = await api.get<ApiResponse<BOM[]>>('/bom')
    return response.data?.data || []
  },

  // Get BOM by ID
  getById: async (id: string): Promise<BOM> => {
    const response = await api.get<ApiResponse<BOM>>(`/bom/${id}`)
    if (!response.data?.data) {
      throw new Error('BOM not found')
    }
    return response.data?.data
  },

  // Get BOM Tree (nested structure)
  getTree: async (id: string): Promise<BOMTreeNode> => {
    const response = await api.get<ApiResponse<BOMTreeNode>>(`/bom/tree/${id}`)
    if (!response.data?.data) {
      throw new Error('BOM tree not found')
    }
    return response.data?.data
  },

  // Get available child BOMs for selection
  getAvailableChildren: async (id?: string): Promise<BOM[]> => {
    const url = id ? `/bom/available-children/${id}` : '/bom/available-children'
    const response = await api.get<ApiResponse<BOM[]>>(url)
    return response.data?.data || []
  },

  // Explode BOM - get all raw materials
  explode: async (id: string, multiplier: number = 1): Promise<{
    bomId: string
    multiplier: number
    totalItems: number
    materials: Array<{
      materialId: string
      materialName: string
      materialCode: string
      unit: string
      quantity: number
      level: number
    }>
  }> => {
    const response = await api.get<ApiResponse<{
      bomId: string
      multiplier: number
      totalItems: number
      materials: Array<{
        materialId: string
        materialName: string
        materialCode: string
        unit: string
        quantity: number
        level: number
      }>
    }>>(`/bom/explode/${id}?multiplier=${multiplier}`)
    return response.data?.data as any
  },

  // Get BOM statistics
  getStats: async (): Promise<BOMStats> => {
    const response = await api.get<ApiResponse<BOMStats>>('/bom/stats')
    return response.data?.data || {
      totalBOMs: 0,
      activeBOMs: 0,
      semiFinishedBOMs: 0,
      totalMaterials: 0,
      avgCostPerUnit: 0,
    }
  },

  // Create new BOM
  create: async (input: CreateBOMInput): Promise<BOM> => {
    const response = await api.post<ApiResponse<BOM>>('/bom', input)
    if (!response.data?.data) {
      throw new Error('Failed to create BOM')
    }
    return response.data?.data
  },

  // Update BOM
  update: async (id: string, input: UpdateBOMInput): Promise<BOM> => {
    const response = await api.put<ApiResponse<BOM>>(`/bom/${id}`, input)
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
    const response = await api.get<ApiResponse<Material[]>>('/data/materials')
    return response.data?.data || []
  },

  // Get all products (for dropdown/selection)
  getProducts: async (): Promise<Product[]> => {
    const response = await api.get<ApiResponse<Product[]>>('/data/products')
    return response.data?.data || []
  },
}

export default bomService
