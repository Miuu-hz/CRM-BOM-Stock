import api from './api'

export type PaperSize = 'A4' | 'A5' | 'THERMAL'

export type DocTypeKey =
  | 'qt' | 'so' | 'inv' | 'dn' | 'rc' | 'cn'
  | 'pr' | 'po' | 'gr' | 'pi' | 'payment' | 'return' | 'wo'

export interface DocumentSettingsColumns {
  discount: boolean
  vat: boolean
  wht: boolean
  sku: boolean
}

export interface DocumentSettingsBranding {
  logoBase64: string | null
  isFreePlan: boolean
}

export interface DocumentSettings {
  brandColor: string
  companyTagline: string
  defaultPaper: Record<DocTypeKey, PaperSize>
  marginMm: number
  fontSizePt: number
  columns: DocumentSettingsColumns
  showBankInfo: boolean
  showPaymentQr: boolean
  defaultBankAccountId: string | null
  signatureSlots: string[]
  footerNotes: Record<string, string>
  branding: DocumentSettingsBranding
}

// Mirrors the defaults documented in the backend API contract — used both as
// the initial state and as a fallback when GET /settings/documents 404s
// (backend not deployed yet / feature rolling out).
export const DEFAULT_DOCUMENT_SETTINGS: DocumentSettings = {
  brandColor: '#5b5bd6',
  companyTagline: '',
  defaultPaper: {
    qt: 'A4', so: 'A4', inv: 'A4', dn: 'A4', rc: 'THERMAL', cn: 'A4',
    pr: 'A4', po: 'A4', gr: 'A4', pi: 'A4', payment: 'A4', return: 'A4', wo: 'A4',
  },
  marginMm: 13,
  fontSizePt: 12,
  columns: { discount: true, vat: true, wht: false, sku: true },
  showBankInfo: true,
  showPaymentQr: true,
  defaultBankAccountId: null,
  signatureSlots: ['ผู้ออกเอกสาร (ผู้ขาย)', 'ผู้อนุมัติ (ผู้ขาย)', 'ผู้รับเอกสาร (ลูกค้า)', 'ตราประทับ (ลูกค้า)'],
  footerNotes: {},
  branding: { logoBase64: null, isFreePlan: false },
}

export type DocumentSettingsPayload = Omit<DocumentSettings, 'branding'>

const documentSettingsService = {
  async get(): Promise<DocumentSettings> {
    const { data } = await api.get('/settings/documents')
    return { ...DEFAULT_DOCUMENT_SETTINGS, ...(data.data || {}) }
  },

  async update(payload: DocumentSettingsPayload): Promise<DocumentSettings> {
    const { data } = await api.put('/settings/documents', payload)
    return { ...DEFAULT_DOCUMENT_SETTINGS, ...(data.data || {}) }
  },
}

export default documentSettingsService
