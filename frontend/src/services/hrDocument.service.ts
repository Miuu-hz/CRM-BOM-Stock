import api from './api'

export type DocType = 'CONTRACT' | 'PROBATION' | 'WORK_PERMIT' | 'CERTIFICATE' | 'OTHER'
export type TemplateKind = 'CONTRACT' | 'PROBATION' | 'WARNING' | 'CERTIFICATE'

export interface EmployeeDocument {
  id: string
  employee_id: string
  employee_code: string
  employee_name: string
  doc_type: DocType
  title: string
  issued_on: string | null
  expires_on: string | null
  notes?: string | null
  days_left: number | null
  attachment_count: number
  created_at: string
}

export interface EmployeeDocumentInput {
  employee_id?: string
  doc_type: DocType
  title: string
  issued_on?: string | null
  expires_on?: string | null
  notes?: string | null
}

export interface ExpiringDocument {
  id: string
  employee_id: string
  employee_name: string
  doc_type: DocType
  title: string
  expires_on: string
  days_left: number
}

export interface DocTemplate {
  id: string
  kind: TemplateKind
  name: string
  body: string
  created_at: string
  updated_at: string
}

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  CONTRACT: 'สัญญาจ้าง',
  PROBATION: 'ทดลองงาน',
  WORK_PERMIT: 'ใบอนุญาตทำงาน',
  CERTIFICATE: 'ใบรับรอง',
  OTHER: 'อื่นๆ',
}

export const TEMPLATE_KIND_LABEL: Record<TemplateKind, string> = {
  CONTRACT: 'สัญญาจ้าง',
  PROBATION: 'ทดลองงาน',
  WARNING: 'หนังสือเตือน',
  CERTIFICATE: 'หนังสือรับรอง',
}

const hrDocumentService = {
  async getDocuments(params?: { employee_id?: string; doc_type?: DocType }): Promise<EmployeeDocument[]> {
    const res = await api.get('/hr/documents', { params })
    return res.data.data || []
  },
  async getExpiring(days = 60): Promise<ExpiringDocument[]> {
    const res = await api.get('/hr/documents/expiring', { params: { days } })
    return res.data.data || []
  },
  async createDocument(data: EmployeeDocumentInput): Promise<EmployeeDocument> {
    const res = await api.post('/hr/documents', data)
    return res.data.data
  },
  async updateDocument(id: string, data: Partial<EmployeeDocumentInput>): Promise<EmployeeDocument> {
    const res = await api.put(`/hr/documents/${id}`, data)
    return res.data.data
  },
  async deleteDocument(id: string): Promise<void> {
    await api.delete(`/hr/documents/${id}`)
  },
  async getTemplates(): Promise<DocTemplate[]> {
    const res = await api.get('/hr/doc-templates')
    return res.data.data || []
  },
  async createTemplate(data: { kind: TemplateKind; name: string; body: string }): Promise<DocTemplate> {
    const res = await api.post('/hr/doc-templates', data)
    return res.data.data
  },
  async updateTemplate(id: string, data: Partial<{ kind: TemplateKind; name: string; body: string }>): Promise<DocTemplate> {
    const res = await api.put(`/hr/doc-templates/${id}`, data)
    return res.data.data
  },
  async deleteTemplate(id: string): Promise<void> {
    await api.delete(`/hr/doc-templates/${id}`)
  },
  async renderTemplate(id: string, employee_id: string, extra?: Record<string, string>): Promise<string> {
    const res = await api.post(`/hr/doc-templates/${id}/render`, { employee_id, extra })
    return res.data.data.text
  },
  async getMyDocuments(): Promise<EmployeeDocument[]> {
    const res = await api.get('/hr/me/documents')
    return res.data.data || []
  },
}

export default hrDocumentService
