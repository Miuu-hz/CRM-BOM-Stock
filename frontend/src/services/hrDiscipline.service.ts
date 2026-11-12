import api from './api'

export type DisciplinaryLevel = 'VERBAL' | 'WRITTEN'
export type DisciplinaryAcknowledgedVia = 'SELF' | 'WITNESS'

export interface WorkRule {
  id: string
  clause_no: string
  title: string
  body?: string | null
  announced_on?: string | null
  is_active: boolean
  created_at?: string
}

export interface WorkRuleInput {
  clause_no: string
  title: string
  body?: string | null
  announced_on?: string | null
  is_active?: boolean
}

export interface DisciplinaryRecord {
  id: string
  employee_id: string
  employee_code?: string
  employee_name?: string
  incident_date: string
  category: string
  detail: string
  level: DisciplinaryLevel
  work_rule_id?: string | null
  clause_no?: string | null
  work_rule_title?: string | null
  expires_on: string
  active: boolean
  acknowledged_at?: string | null
  acknowledged_via?: DisciplinaryAcknowledgedVia | null
  witness_name?: string | null
  created_by?: string | null
  created_at?: string
  attachment_count?: number
}

export interface DisciplinaryInput {
  employee_id: string
  incident_date: string
  category: string
  detail: string
  level: DisciplinaryLevel
  work_rule_id?: string | null
}

export interface DisciplinaryUpdate {
  incident_date?: string
  category?: string
  detail?: string
  level?: DisciplinaryLevel
  work_rule_id?: string | null
}

export const hrDisciplineService = {
  // ---------- ข้อบังคับการทำงาน (Work Rules) ----------
  async getWorkRules(params?: { active?: 1 }): Promise<WorkRule[]> {
    const res = await api.get('/hr/work-rules', { params })
    return res.data.data || []
  },

  async createWorkRule(data: WorkRuleInput): Promise<WorkRule> {
    const res = await api.post('/hr/work-rules', data)
    return res.data.data
  },

  async updateWorkRule(id: string, data: Partial<WorkRuleInput>): Promise<WorkRule> {
    const res = await api.put(`/hr/work-rules/${id}`, data)
    return res.data.data
  },

  async deleteWorkRule(id: string): Promise<void> {
    await api.delete(`/hr/work-rules/${id}`)
  },

  // ---------- บันทึกวินัย (Disciplinary Records) ----------
  async getDisciplinaryRecords(params?: { employee_id?: string }): Promise<DisciplinaryRecord[]> {
    const res = await api.get('/hr/disciplinary', { params })
    return res.data.data || []
  },

  async getDisciplinaryRecord(id: string): Promise<DisciplinaryRecord> {
    const res = await api.get(`/hr/disciplinary/${id}`)
    return res.data.data
  },

  async createDisciplinaryRecord(data: DisciplinaryInput): Promise<DisciplinaryRecord> {
    const res = await api.post('/hr/disciplinary', data)
    return res.data.data
  },

  async updateDisciplinaryRecord(id: string, data: DisciplinaryUpdate): Promise<DisciplinaryRecord> {
    const res = await api.put(`/hr/disciplinary/${id}`, data)
    return res.data.data
  },

  async acknowledgeWitness(id: string, witness_name: string): Promise<DisciplinaryRecord> {
    const res = await api.post(`/hr/disciplinary/${id}/acknowledge-witness`, { witness_name })
    return res.data.data
  },

  // ---------- ส่วนของพนักงานตนเอง (/me/disciplinary) ----------
  async getMyDisciplinary(): Promise<DisciplinaryRecord[]> {
    const res = await api.get('/hr/me/disciplinary')
    return res.data.data || []
  },

  async acknowledgeSelf(id: string): Promise<DisciplinaryRecord> {
    const res = await api.post(`/hr/me/disciplinary/${id}/acknowledge`)
    return res.data.data
  },
}

export default hrDisciplineService
