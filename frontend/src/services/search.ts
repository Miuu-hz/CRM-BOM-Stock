import api from './api'

export interface SearchResultItem {
  id: string
  type: 'customer' | 'order' | 'product' | 'material' | 'bom' | 'stock'
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
      }
    }

    const response = await api.get('/search', {
      params: { q: query.trim() },
    })

    return response.data?.data
  },
}

export default searchService
