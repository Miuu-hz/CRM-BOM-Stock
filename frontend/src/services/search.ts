import api from './api'

export interface SearchResultItem {
  id: string
  type: 'customer' | 'order' | 'product' | 'material' | 'bom' | 'stock' | 'supplier' | 'purchase_order' | 'work_order' | 'sales_order' | 'quotation' | 'invoice'
  label: string
  subtitle: string
  [key: string]: any
}

export interface SearchResults {
  customers: SearchResultItem[]
  orders: SearchResultItem[]
  products: SearchResultItem[]
  materials: SearchResultItem[]
  boms: SearchResultItem[]
  stock: SearchResultItem[]
  suppliers: SearchResultItem[]
  purchase_orders: SearchResultItem[]
  work_orders: SearchResultItem[]
  sales_orders: SearchResultItem[]
  quotations: SearchResultItem[]
  invoices: SearchResultItem[]
}

export const searchService = {
  async search(query: string): Promise<SearchResults> {
    if (!query || query.trim().length < 2) {
      return {
        customers: [],
        orders: [],
        products: [],
        materials: [],
        boms: [],
        stock: [],
        suppliers: [],
        purchase_orders: [],
        work_orders: [],
        sales_orders: [],
        quotations: [],
        invoices: [],
      }
    }

    const response = await api.get('/search', {
      params: { q: query.trim() },
    })

    return response.data?.data
  },
}

export default searchService
