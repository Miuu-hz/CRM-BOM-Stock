// ─── SQLite-backed Job Queue ────────────────────────────────────────────────
// Lean: no Redis, no BullMQ — just a SQLite table and simple SQL.

import db from '../db/sqlite'
import { randomUUID } from 'crypto'
import { AgentJob } from './types'

const MAX_ATTEMPTS = 3

// Ensure table exists (idempotent)
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_jobs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    command TEXT NOT NULL,
    payload TEXT,
    paperclip_company_id TEXT,
    paperclip_issue_id TEXT,
    status TEXT DEFAULT 'pending',
    result TEXT,
    error TEXT,
    attempts INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_agent_jobs_status ON agent_jobs(status, created_at);
`)

export function enqueue(job: Omit<AgentJob, 'id' | 'status' | 'result' | 'error' | 'attempts' | 'createdAt' | 'updatedAt'>): string {
  const id = randomUUID().replace(/-/g, '').substring(0, 25)
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO agent_jobs (id, tenant_id, command, payload, paperclip_company_id, paperclip_issue_id, status, attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
  ).run(
    id,
    job.tenantId,
    job.command,
    typeof job.payload === 'string' ? job.payload : JSON.stringify(job.payload ?? {}),
    job.paperclipCompanyId,
    job.paperclipIssueId,
    now,
    now
  )
  return id
}

export function dequeue(): AgentJob | null {
  // SQLite has implicit row locking per transaction; better-sqlite3 runs in auto-commit.
  // We SELECT the oldest pending job and immediately mark it running in one go.
  const job = db.prepare(
    `SELECT * FROM agent_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`
  ).get() as AgentJob | null

  if (!job) return null

  db.prepare(
    `UPDATE agent_jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?`
  ).run(new Date().toISOString(), job.id)

  return job
}

export function complete(id: string, result: string): void {
  db.prepare(
    `UPDATE agent_jobs SET status = 'completed', result = ?, updated_at = ? WHERE id = ?`
  ).run(result, new Date().toISOString(), id)
}

export function fail(id: string, error: string): void {
  const job = db.prepare(`SELECT attempts FROM agent_jobs WHERE id = ?`).get(id) as { attempts: number } | null
  const status = (job && job.attempts >= MAX_ATTEMPTS) ? 'failed' : 'pending'
  db.prepare(
    `UPDATE agent_jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?`
  ).run(status, error, new Date().toISOString(), id)
}

export function getJobById(id: string): AgentJob | null {
  return db.prepare(`SELECT * FROM agent_jobs WHERE id = ?`).get(id) as AgentJob | null
}
