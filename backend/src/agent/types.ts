// ─── Lean Agent Types ───────────────────────────────────────────────────────
// No classes, no deep hierarchies — just plain interfaces.

export interface PaperclipHeartbeat {
  runId: string
  agentId: string
  companyId: string
  context: {
    taskId?: string
    wakeReason: string
    commentId?: string
  }
}

export interface AgentContext {
  tenantId: string
  db: any
  user?: { userId: string; email: string; role: string }
}

export interface AgentJob {
  id: string
  tenantId: string
  command: string
  payload: string
  paperclipCompanyId: string
  paperclipIssueId: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  result: string | null
  error: string | null
  attempts: number
  createdAt: string
  updatedAt: string
}

export type AgentCommand = (
  ctx: AgentContext,
  payload: any
) => Promise<any>
