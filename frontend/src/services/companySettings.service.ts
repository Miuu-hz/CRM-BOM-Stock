import api from './api'

export interface CompanySettings {
  tenant_id?: string
  name?: string
  address?: string
  phone?: string
  email?: string
  tax_id?: string
  logo_base64?: string
  pos_bom_deduct?: number | boolean  // 1=ตัด stock ตาม BOM, 0=ไม่ตัด (default 1)
}

const LS_KEY = 'crm_company_settings'

export function getCachedCompanySettings(): CompanySettings {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}')
  } catch {
    return {}
  }
}

function cacheCompanySettings(data: CompanySettings) {
  localStorage.setItem(LS_KEY, JSON.stringify(data))
}

const companySettingsService = {
  async get(): Promise<CompanySettings> {
    const { data } = await api.get('/settings/company')
    const settings = data.data || {}
    cacheCompanySettings(settings)
    return settings
  },

  async update(payload: CompanySettings): Promise<CompanySettings> {
    const { data } = await api.put('/settings/company', payload)
    const settings = data.data || {}
    cacheCompanySettings(settings)
    return settings
  },
}

export default companySettingsService
