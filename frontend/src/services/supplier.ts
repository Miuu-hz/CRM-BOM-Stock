import api from './api'

export interface Supplier {
  id: string
  code: string
  name: string
  type: string
  contact_name: string
  email: string
  phone: string
  address: string
  city: string
  tax_id: string
  payment_terms: string
  rating: number
  status: string
  notes: string
  total_orders?: number
  total_spent?: number
  created_at: string
  updated_at: string
  purchaseOrders?: any[]
}

export interface SupplierStats {
  totalSuppliers: number
  activeSuppliers: number
  totalPOs: number
  totalSpent: number
}

const supplierService = {
  async getAll(): Promise<Supplier[]> {
    const res = await api.get('/suppliers')
    return res.data?.data
  },

  async getById(id: string): Promise<Supplier> {
    const res = await api.get(`/suppliers/${id}`)
    return res.data?.data
  },

  async getStats(): Promise<SupplierStats> {
    const res = await api.get('/suppliers/stats')
    return res.data?.data
  },

  async create(data: Partial<Supplier>): Promise<Supplier> {
    const res = await api.post('/suppliers', data)
    return res.data?.data
  },

  async update(id: string, data: Partial<Supplier>): Promise<Supplier> {
    const res = await api.put(`/suppliers/${id}`, data)
    return res.data?.data
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/suppliers/${id}`)
  },
}

export default supplierService
