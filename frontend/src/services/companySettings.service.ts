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
  pos_vat_enabled?: number | boolean
  pos_vat_rate?: number
  pos_service_enabled?: number | boolean
  pos_service_rate?: number
  qc_gate_enabled?: number | boolean  // 1=บังคับผ่าน QC ก่อนปิดใบสั่งงาน, 0=ไม่บังคับ (default 0)
  show_subcon_stock_widget?: number | boolean  // 1=แสดงการ์ดมูลค่าสต็อกผู้รับเหมาในหน้า Stock, 0=ซ่อน (default 1)
  allow_negative_stock?: number | boolean  // 1=อนุญาตขาย/เบิกแม้สต็อกไม่พอ (POS/ใบสั่งขาย/ใบสั่งผลิต ติดลบได้), 0=บล็อกตามเดิม (default 0)
  require_pos_shift?: number | boolean  // 1=ต้องเปิดกะก่อนจึงจะรับชำระเงินที่ POS ได้, 0=ขายได้โดยไม่ต้องเปิดกะ (default 0)
  subscription_plan_code?: string  // read-only, attached by GET /settings/company from tenant_subscriptions
  subscription_plan_name?: string
  subscription_status?: string
  subscription_period_end?: string | null
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
