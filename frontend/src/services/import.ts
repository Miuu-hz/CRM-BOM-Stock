import api from './api'

export interface ImportResult {
  success: number
  failed: number
  errors: string[]
}

export interface ValidationResult {
  total: number
  valid: number
  invalid: number
  errors: string[]
}

export const importApi = {
  // Validate data before import
  validate: (type: 'customers' | 'stock', data: any[]) =>
    api.post('/import/validate', { type, data }),

  // Import customers
  importCustomers: (data: any[]) =>
    api.post('/import/customers', { data }),

  // Import stock items
  importStock: (data: any[]) =>
    api.post('/import/stock', { data }),
}

export default importApi
