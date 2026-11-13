import api from './api'

export type ChecklistKind = 'ONBOARD' | 'OFFBOARD'
export type AutoAction = 'DISABLE_USER' | 'UNLINK_LINE' | null

export interface ChecklistTemplate {
  id: string
  kind: ChecklistKind
  org_unit_id: string | null
  title: string
  sort_order: number
  auto_action: AutoAction
  is_active: boolean
}

export interface ChecklistTemplateInput {
  kind: ChecklistKind
  title: string
  sort_order?: number
  auto_action?: AutoAction
  is_active?: boolean
}

export interface ChecklistItem {
  id: string
  employee_id: string
  kind: ChecklistKind
  title: string
  auto_action: AutoAction
  sort_order: number
  done_at: string | null
  done_by: string | null
  note: string | null
}

export interface FinalPay {
  dailyWage: number
  tenureDays: number
  severanceDays: number
  severanceAmount: number
  unusedAnnualLeaveDays: number
  leavePayout: number
  outstandingAdvances: number
  unreturnedAssets: { id: string; code: string; name: string; loaned_on: string }[]
  retainWageUntil?: string
  retainTaxUntil?: string
}

export const hrLifecycleService = {
  async getTemplates(kind?: ChecklistKind): Promise<ChecklistTemplate[]> {
    const res = await api.get('/hr/checklist-templates', { params: kind ? { kind } : undefined })
    return res.data.data || []
  },
  async createTemplate(input: ChecklistTemplateInput): Promise<ChecklistTemplate> {
    const res = await api.post('/hr/checklist-templates', input)
    return res.data.data
  },
  async updateTemplate(id: string, input: Partial<ChecklistTemplateInput>): Promise<ChecklistTemplate> {
    const res = await api.put(`/hr/checklist-templates/${id}`, input)
    return res.data.data
  },
  async deleteTemplate(id: string): Promise<void> {
    await api.delete(`/hr/checklist-templates/${id}`)
  },
  async seedDefaults(): Promise<void> {
    await api.post('/hr/checklist-templates/seed-defaults')
  },
  async startChecklist(employeeId: string, kind: ChecklistKind): Promise<number> {
    const res = await api.post(`/hr/employees/${employeeId}/checklists`, { kind })
    return res.data.data.created
  },
  async getChecklist(employeeId: string, kind?: ChecklistKind): Promise<ChecklistItem[]> {
    const res = await api.get(`/hr/employees/${employeeId}/checklists`, { params: kind ? { kind } : undefined })
    return res.data.data || []
  },
  async setItemDone(id: string, done: boolean, note?: string): Promise<{ message: string; item: ChecklistItem }> {
    const res = await api.put(`/hr/checklist-items/${id}`, { done, note })
    return { message: res.data.message, item: res.data.data }
  },
  async getFinalPay(employeeId: string): Promise<FinalPay> {
    const res = await api.get(`/hr/employees/${employeeId}/final-pay`)
    return res.data.data
  },
  async applyFinalPay(employeeId: string, runId: string): Promise<{ added: { name: string; amount: number }[]; note: string }> {
    const res = await api.post(`/hr/employees/${employeeId}/final-pay/apply`, { run_id: runId })
    return res.data.data
  },
}

export default hrLifecycleService
