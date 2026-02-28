import api from './api'

const posBillService = {
  // ==================== Bills ====================
  
  getBills: async (params?: { status?: string }) => {
    const response = await api.get('/pos/bills', { params })
    return response.data
  },

  getOpenBills: async () => {
    const response = await api.get('/pos/bills/open')
    return response.data
  },

  getBill: async (id: string) => {
    const response = await api.get(`/pos/bills/${id}`)
    return response.data
  },

  createBill: async (data: {
    display_name?: string
    customer_name?: string
    customer_phone?: string
    notes?: string
  }) => {
    const response = await api.post('/pos/bills', data)
    return response.data
  },

  updateBill: async (id: string, data: {
    display_name?: string
    customer_name?: string
    customer_phone?: string
    notes?: string
  }) => {
    const response = await api.put(`/pos/bills/${id}`, data)
    return response.data
  },

  deleteBill: async (id: string) => {
    const response = await api.delete(`/pos/bills/${id}`)
    return response.data
  },

  // ==================== Bill Items ====================
  
  addItem: async (billId: string, data: {
    pos_menu_id: string
    quantity: number
    special_instructions?: string
  }) => {
    const response = await api.post(`/pos/bills/${billId}/items`, data)
    return response.data
  },

  updateItem: async (billId: string, itemId: string, data: {
    quantity?: number
    special_instructions?: string
  }) => {
    const response = await api.put(`/pos/bills/${billId}/items/${itemId}`, data)
    return response.data
  },

  deleteItem: async (billId: string, itemId: string) => {
    const response = await api.delete(`/pos/bills/${billId}/items/${itemId}`)
    return response.data
  },

  // ==================== Payment ====================
  
  payBill: async (billId: string, data: {
    payment_method: 'CASH' | 'QR_CODE' | 'CREDIT_CARD' | 'TRANSFER'
    received_amount?: number
    reference?: string
  }) => {
    const response = await api.post(`/pos/bills/${billId}/pay`, data)
    return response.data
  },

  cancelBill: async (billId: string, data?: { reason?: string }) => {
    const response = await api.post(`/pos/bills/${billId}/cancel`, data)
    return response.data
  },
}

export default posBillService
