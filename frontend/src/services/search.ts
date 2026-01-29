import api from './api'

export interface SearchResult {
  id: string
  type: 'customer' | 'order' | 'product' | 'material' | 'bom' | 'stock'
  label: string
  title: string
  subtitle: string
  navigateTo: string
}

export interface SearchResponse {
  query: string
  results: SearchResult[]
  total: number
}

export const searchService = {
  search: async (query: string): Promise<SearchResponse> => {
    const response = await api.get<SearchResponse>(
      `/search?q=${encodeURIComponent(query)}`
    )
    return response.data || { query, results: [], total: 0 }
  },
}

export default searchService
