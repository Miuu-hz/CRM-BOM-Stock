import api from './api'

export interface CustomerRecommendation {
  id: string
  customerId: string
  productId: string
  productName: string
  productCategory?: string
  reason?: string
  priority: number
  status: 'PENDING' | 'OFFERED' | 'ACCEPTED' | 'REJECTED'
  offeredAt?: string
  offeredBy?: string
  notes?: string
  createdAt: string
}

export interface ProductSearchResult {
  id: string
  sku: string
  name: string
  category: string
  unit: string
}

export const customerRecommendationsApi = {
  // Get all recommendations for a customer
  getByCustomer: (customerId: string) =>
    api.get(`/customer-recommendations/customer/${customerId}`),

  // Add new recommendation
  create: (data: {
    customerId: string
    productId: string
    productName: string
    productCategory?: string
    reason?: string
    priority?: number
    notes?: string
  }) => api.post('/customer-recommendations', data),

  // Update recommendation status
  update: (id: string, data: { status?: string; notes?: string }) =>
    api.put(`/customer-recommendations/${id}`, data),

  // Delete recommendation
  delete: (id: string) =>
    api.delete(`/customer-recommendations/${id}`),

  // Search products
  searchProducts: (query: string) =>
    api.get(`/customer-recommendations/products/search?q=${encodeURIComponent(query)}`),
}

export default customerRecommendationsApi
