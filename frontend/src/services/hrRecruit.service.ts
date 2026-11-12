import api from './api'

export type ApplicantStage = 'APPLIED' | 'INTERVIEW' | 'TRIAL' | 'HIRED' | 'REJECTED'

export interface JobPosting {
  id: string
  title: string
  org_unit_id: string | null
  description: string | null
  public_token: string
  is_open: boolean
  created_at: string
  applicant_count: number
}

export interface Applicant {
  id: string
  posting_id: string
  posting_title: string | null
  full_name: string
  phone: string
  email: string | null
  note: string | null
  source: string | null
  stage: ApplicantStage
  interview_at: string | null
  interview_note: string | null
  consent_at: string
  purge_after: string
  employee_id: string | null
  created_at: string
}

export interface HireInput {
  code: string
  employment_type: 'MONTHLY' | 'DAILY' | 'HOURLY'
  base_wage: number
  start_date: string
  org_unit_id?: string
}

export const hrRecruitService = {
  async getPostings(): Promise<JobPosting[]> {
    return (await api.get('/hr/job-postings')).data.data || []
  },
  async createPosting(data: { title: string; description?: string }): Promise<JobPosting> {
    return (await api.post('/hr/job-postings', data)).data.data
  },
  async updatePosting(id: string, data: { title?: string; description?: string; is_open?: boolean }): Promise<JobPosting> {
    return (await api.put(`/hr/job-postings/${id}`, data)).data.data
  },
  async getApplicants(params?: { posting_id?: string; stage?: ApplicantStage }): Promise<Applicant[]> {
    return (await api.get('/hr/applicants', { params })).data.data || []
  },
  async updateApplicant(id: string, data: { stage?: ApplicantStage; interview_at?: string | null; interview_note?: string | null }): Promise<Applicant> {
    return (await api.put(`/hr/applicants/${id}`, data)).data.data
  },
  async hire(id: string, data: HireInput): Promise<Applicant> {
    return (await api.post(`/hr/applicants/${id}/hire`, data)).data.data
  },
}

export default hrRecruitService
