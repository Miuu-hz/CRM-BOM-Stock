import api from './api'

const posService = {
  // ==================== Categories ====================
  
  getCategories: async () => {
    const response = await api.get('/pos/categories')
    return response.data
  },

  createCategory: async (data: {
    name: string
    color?: string
    icon?: string
  }) => {
    const response = await api.post('/pos/categories', data)
    return response.data
  },

  updateCategory: async (id: string, data: {
    name?: string
    color?: string
    icon?: string
    is_active?: boolean
  }) => {
    const response = await api.put(`/pos/categories/${id}`, data)
    return response.data
  },

  deleteCategory: async (id: string) => {
    const response = await api.delete(`/pos/categories/${id}`)
    return response.data
  },

  // ==================== Menu Configs ====================
  
  getMenuConfigs: async (params?: {
    category_id?: string
    is_available?: boolean
  }) => {
    const response = await api.get('/pos/menu-configs', { params })
    return response.data
  },

  getMenuConfig: async (id: string) => {
    const response = await api.get(`/pos/menu-configs/${id}`)
    return response.data
  },

  createMenuConfig: async (data: {
    product_id: string
    bom_id?: string
    category_id?: string
    pos_price: number
    cost_price?: number
    is_available?: boolean
    display_order?: number
    quick_code?: string
    image_url?: string
    preparation_time?: number
    description?: string
  }) => {
    const response = await api.post('/pos/menu-configs', data)
    return response.data
  },

  updateMenuConfig: async (id: string, data: {
    bom_id?: string
    category_id?: string
    pos_price?: number
    cost_price?: number
    is_available?: boolean
    is_pos_enabled?: boolean
    display_order?: number
    quick_code?: string
    image_url?: string
    preparation_time?: number
    description?: string
  }) => {
    const response = await api.put(`/pos/menu-configs/${id}`, data)
    return response.data
  },

  deleteMenuConfig: async (id: string) => {
    const response = await api.delete(`/pos/menu-configs/${id}`)
    return response.data
  },

  toggleMenuAvailability: async (id: string, is_available: boolean) => {
    const response = await api.patch(`/pos/menu-configs/${id}/toggle`, { is_available })
    return response.data
  },

  // ==================== Ingredients ====================
  
  getMenuIngredients: async (menuId: string) => {
    const response = await api.get(`/pos/menu-configs/${menuId}/ingredients`)
    return response.data
  },

  addMenuIngredient: async (menuId: string, data: {
    stock_item_id: string
    quantity_used: number
    unit_id?: string
    is_optional?: boolean
  }) => {
    const response = await api.post(`/pos/menu-configs/${menuId}/ingredients`, data)
    return response.data
  },

  updateMenuIngredient: async (menuId: string, ingredientId: string, data: {
    quantity_used?: number
    unit_id?: string
    is_optional?: boolean
  }) => {
    const response = await api.put(`/pos/menu-configs/${menuId}/ingredients/${ingredientId}`, data)
    return response.data
  },

  deleteMenuIngredient: async (menuId: string, ingredientId: string) => {
    const response = await api.delete(`/pos/menu-configs/${menuId}/ingredients/${ingredientId}`)
    return response.data
  },

  // ==================== Products ====================
  
  getAvailableProducts: async (search?: string) => {
    const response = await api.get('/pos/available-products', {
      params: search ? { search } : undefined
    })
    return response.data
  },

  // ==================== Stock Check ====================
  
  getMenuStock: async (id: string, quantity?: number) => {
    const response = await api.get(`/pos/menu-configs/${id}/stock`, {
      params: quantity ? { quantity } : undefined
    })
    return response.data
  },

  // ==================== BOM Integration ====================
  
  getAvailableBOMs: async (productId?: string) => {
    const response = await api.get('/bom', {
      params: productId ? { product_id: productId } : undefined
    })
    return response.data
  },

  // ==================== Clearing Transfer ====================
  
  getClearingBalance: async () => {
    const response = await api.get('/pos/clearing/balance')
    return response.data
  },

  getPendingClearingBills: async (date?: string) => {
    const response = await api.get('/pos/clearing/pending-bills', { params: date ? { date } : {} })
    return response.data
  },

  createClearingTransfer: async (data: {
    transfer_date: string
    cash_amount: number
    bank_amount: number
    bill_ids: string[]
    reference?: string
    notes?: string
  }) => {
    const response = await api.post('/pos/clearing/transfer', data)
    return response.data
  },

  getClearingTransfers: async (params?: {
    date_from?: string
    date_to?: string
    limit?: number
  }) => {
    const response = await api.get('/pos/clearing/transfers', { params })
    return response.data
  },

  voidBill: async (id: string, reason: string) => {
    const response = await api.post(`/sales/pos-running-bills/${id}/void`, { reason })
    return response.data
  },
}

export default posService
