import { useEffect, useState } from 'react'
import {
  Zap, KeyRound, Copy, Eye, EyeOff, RefreshCw, Check, X, Users,
  Loader2, ShieldCheck, PlugZap,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'

interface McpInfo {
  key: string | null
  endpointUrl: string
  role: string
  canManage: boolean
  hasKey: boolean
  quota: { used: number; limit: number | null }
}
interface TeamUser {
  id: string
  name: string
  email: string
  role: string
  hasKey: number
}

const fmtLimit = (n: number | null) => (n === null ? 'ไม่จำกัด' : n)

async function copy(text: string, msg: string) {
  try { await navigator.clipboard.writeText(text); toast.success(msg) }
  catch { toast.error('คัดลอกไม่สำเร็จ') }
}

function QuotaBar({ used, limit }: { used: number; limit: number | null }) {
  if (limit === null) {
    return <div className="h-2 w-full bg-[var(--surface-2)] rounded-full overflow-hidden"><div className="h-full w-full opacity-40 rounded-full" style={{ background: 'var(--success)' }} /></div>
  }
  const ratio = limit > 0 ? Math.min(used / limit, 1) : 0
  const color = ratio >= 1 ? 'var(--danger)' : ratio >= 0.8 ? 'var(--warning)' : 'var(--success)'
  return <div className="h-2 w-full bg-[var(--surface-2)] rounded-full overflow-hidden"><div className="h-full rounded-full transition-all" style={{ width: `${ratio * 100}%`, background: color }} /></div>
}

const ROLE_BADGE: Record<string, string> = {
  ADMIN: 'bg-[var(--success-soft)] text-[var(--success)]',
  MANAGER: 'bg-[var(--primary-soft)] text-[var(--primary)]',
  POWERUSER: 'bg-[var(--warning-soft)] text-[var(--warning)]',
  USER: 'bg-[var(--surface-2)] text-[var(--fg-3)]',
}

export default function MCPSettings() {
  const [info, setInfo] = useState<McpInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [revealSelf, setRevealSelf] = useState(false)
  const [regenBusy, setRegenBusy] = useState(false)
  const [testBusy, setTestBusy] = useState(false)
  const [testSteps, setTestSteps] = useState<Array<{ step: string; ok: boolean }> | null>(null)

  // team
  const [team, setTeam] = useState<TeamUser[]>([])
  const [teamQuota, setTeamQuota] = useState<{ used: number; limit: number | null }>({ used: 0, limit: null })
  const [teamLoading, setTeamLoading] = useState(false)
  const [acting, setActing] = useState<string | null>(null)
  const [grantedKeys, setGrantedKeys] = useState<Record<string, string>>({}) // userId -> key (shown after grant)

  useEffect(() => { loadInfo() }, [])

  const loadInfo = async () => {
    setLoading(true)
    try {
      const res = await api.get('/mcp-settings')
      if (res.data.success) {
        setInfo(res.data.data)
        if (res.data.data.canManage) loadTeam()
      }
    } catch { toast.error('โหลดข้อมูล MCP ไม่สำเร็จ') }
    finally { setLoading(false) }
  }

  const loadTeam = async () => {
    setTeamLoading(true)
    try {
      const res = await api.get('/mcp-settings/team')
      if (res.data.success) { setTeam(res.data.data.users); setTeamQuota(res.data.data.quota) }
    } catch { /* not a manager, ignore */ }
    finally { setTeamLoading(false) }
  }

  const regenerateSelf = async () => {
    setRegenBusy(true)
    try {
      const res = await api.post('/mcp-settings/regenerate-key')
      if (res.data.success) {
        setInfo(i => i ? { ...i, key: res.data.data.key, hasKey: true } : i)
        setRevealSelf(true)
        toast.success('สร้างคีย์ใหม่แล้ว')
        loadInfo()
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'สร้างคีย์ไม่สำเร็จ')
    } finally { setRegenBusy(false) }
  }

  const runTest = async () => {
    setTestBusy(true); setTestSteps(null)
    try {
      const res = await api.post('/mcp-settings/test')
      setTestSteps(res.data.steps || [])
      if (res.data.success) toast.success('ทดสอบผ่าน'); else toast.error('ทดสอบไม่ผ่าน')
    } catch { toast.error('ทดสอบไม่สำเร็จ') }
    finally { setTestBusy(false) }
  }

  const grant = async (u: TeamUser) => {
    setActing(u.id)
    try {
      const res = await api.post(`/mcp-settings/team/${u.id}/grant`)
      if (res.data.success) {
        setGrantedKeys(k => ({ ...k, [u.id]: res.data.data.key }))
        toast.success(`เปิดสิทธิ์ให้ ${u.name} แล้ว`)
        loadTeam(); loadInfo()
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'เปิดสิทธิ์ไม่สำเร็จ')
    } finally { setActing(null) }
  }

  const revoke = async (u: TeamUser) => {
    if (!window.confirm(`ปิดสิทธิ์ MCP ของ ${u.name}?`)) return
    setActing(u.id)
    try {
      const res = await api.post(`/mcp-settings/team/${u.id}/revoke`)
      if (res.data.success) {
        setGrantedKeys(k => { const n = { ...k }; delete n[u.id]; return n })
        toast.success(`ปิดสิทธิ์ ${u.name} แล้ว`)
        loadTeam(); loadInfo()
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'ปิดสิทธิ์ไม่สำเร็จ')
    } finally { setActing(null) }
  }

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[var(--primary)]" /></div>
  if (!info) return null

  const atQuota = info.quota.limit != null && info.quota.used >= info.quota.limit

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Zap className="w-5 h-5 text-[var(--primary)]" />
        <h2 className="text-lg font-bold text-[var(--fg-1)]">MCP / AI Connect</h2>
      </div>
      <p className="text-sm text-[var(--fg-3)] -mt-4">
        เชื่อมข้อมูลในระบบเข้ากับ AI (Claude, ChatGPT ฯลฯ) ผ่าน MCP — ใช้ URL + คีย์ด้านล่างตั้งค่าใน MCP client ของคุณ
      </p>

      {/* ── Your connection ── */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <PlugZap className="w-4 h-4 text-[var(--primary)]" />
          <h3 className="font-semibold text-[var(--fg-1)]">การเชื่อมต่อของคุณ</h3>
        </div>

        {/* endpoint URL */}
        <div>
          <label className="block text-xs text-[var(--fg-3)] mb-1">Endpoint URL</label>
          <div className="flex items-center gap-2">
            <input readOnly value={info.endpointUrl} className="flex-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-1)] text-sm font-mono" />
            <button onClick={() => copy(info.endpointUrl, 'คัดลอก URL แล้ว')} className="p-2 rounded-lg border border-[var(--border)] text-[var(--fg-3)] hover:text-[var(--primary)] hover:bg-[var(--surface-2)] transition-all"><Copy className="w-4 h-4" /></button>
          </div>
        </div>

        {/* your key */}
        <div>
          <label className="block text-xs text-[var(--fg-3)] mb-1">คีย์ของคุณ (API key)</label>
          {info.key ? (
            <div className="flex items-center gap-2">
              <input readOnly type={revealSelf ? 'text' : 'password'} value={info.key} className="flex-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-1)] text-sm font-mono" />
              <button onClick={() => setRevealSelf(v => !v)} title={revealSelf ? 'ซ่อน' : 'แสดง'} className="p-2 rounded-lg border border-[var(--border)] text-[var(--fg-3)] hover:text-[var(--primary)] hover:bg-[var(--surface-2)] transition-all">{revealSelf ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
              <button onClick={() => copy(info.key!, 'คัดลอกคีย์แล้ว')} title="คัดลอก" className="p-2 rounded-lg border border-[var(--border)] text-[var(--fg-3)] hover:text-[var(--primary)] hover:bg-[var(--surface-2)] transition-all"><Copy className="w-4 h-4" /></button>
            </div>
          ) : info.canManage ? (
            <p className="text-sm text-[var(--fg-3)]">คุณยังไม่มีคีย์ — กด “สร้างคีย์” เพื่อเปิดใช้ MCP ของตัวเอง</p>
          ) : (
            <div className="flex items-start gap-2 text-sm bg-[var(--warning-soft)] text-[var(--warning)] rounded-lg p-3">
              <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
              <span>คุณยังไม่ได้รับสิทธิ์ใช้งาน MCP — กรุณาติดต่อแอดมินของบริษัทเพื่อเปิดสิทธิ์ให้</span>
            </div>
          )}
        </div>

        {(info.key || info.canManage) && (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={regenerateSelf} disabled={regenBusy || (!info.key && atQuota)}
              title={!info.key && atQuota ? 'โควตาเต็ม' : ''}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--primary)] text-white hover:opacity-90 active:scale-95 transition-all text-sm font-medium disabled:opacity-50">
              {regenBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
              {info.key ? 'สร้างคีย์ใหม่ (rotate)' : 'สร้างคีย์'}
            </button>
            {info.key && (
              <button onClick={runTest} disabled={testBusy}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-all text-sm disabled:opacity-50">
                {testBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                ทดสอบการเชื่อมต่อ
              </button>
            )}
          </div>
        )}

        {testSteps && (
          <div className="space-y-1.5 pt-1">
            {testSteps.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                {s.ok ? <Check className="w-4 h-4 text-[var(--success)]" /> : <X className="w-4 h-4 text-[var(--danger)]" />}
                <span className={s.ok ? 'text-[var(--fg-2)]' : 'text-[var(--danger)]'}>{s.step}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Team management (ADMIN / MASTER) ── */}
      {info.canManage && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[var(--primary)]" />
            <h3 className="font-semibold text-[var(--fg-1)]">สิทธิ์ใช้งาน MCP ของทีม</h3>
            <button onClick={loadTeam} disabled={teamLoading} className="ml-auto p-1.5 rounded-lg text-[var(--fg-3)] hover:text-[var(--primary)] hover:bg-[var(--surface-2)] transition-all">
              <RefreshCw className={'w-4 h-4 ' + (teamLoading ? 'animate-spin' : '')} />
            </button>
          </div>

          {/* quota */}
          <div>
            <div className="flex items-center justify-between mb-1.5 text-sm">
              <span className="text-[var(--fg-3)]">ใช้ไป</span>
              <span className="text-[var(--fg-1)] font-medium">{teamQuota.used} / {fmtLimit(teamQuota.limit)} ผู้ใช้</span>
            </div>
            <QuotaBar used={teamQuota.used} limit={teamQuota.limit} />
            <p className="text-xs text-[var(--fg-4)] mt-1">โควตาตามแพ็กเกจที่ Master กำหนด · เปิดเกินโควตาไม่ได้</p>
          </div>

          {/* user list */}
          <div className="border border-[var(--border)] rounded-lg divide-y divide-[var(--border)] overflow-hidden">
            {team.length === 0 ? (
              <p className="text-sm text-[var(--fg-4)] text-center py-6">ไม่มีผู้ใช้ในบริษัท</p>
            ) : team.map(u => {
              const has = !!u.hasKey
              const teamAtQuota = teamQuota.limit != null && teamQuota.used >= teamQuota.limit
              const gk = grantedKeys[u.id]
              return (
                <div key={u.id} className="p-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-[var(--fg-1)] truncate">{u.name}</span>
                        <span className={'text-xs px-1.5 py-0.5 rounded font-medium ' + (ROLE_BADGE[u.role] ?? ROLE_BADGE.USER)}>{u.role}</span>
                        {has && <span className="text-xs px-1.5 py-0.5 rounded-full bg-[var(--success-soft)] text-[var(--success)] font-medium">เปิดแล้ว</span>}
                      </div>
                      <p className="text-xs text-[var(--fg-4)] font-mono truncate">{u.email}</p>
                    </div>
                    {has ? (
                      <button onClick={() => revoke(u)} disabled={acting === u.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--fg-3)] hover:text-[var(--danger)] hover:border-[var(--danger)] hover:bg-[var(--danger-soft)] transition-all text-sm disabled:opacity-50">
                        {acting === u.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />} ปิดสิทธิ์
                      </button>
                    ) : (
                      <button onClick={() => grant(u)} disabled={acting === u.id || teamAtQuota}
                        title={teamAtQuota ? 'โควตาเต็ม' : ''}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--primary)] text-white hover:opacity-90 active:scale-95 transition-all text-sm font-medium disabled:opacity-40">
                        {acting === u.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} เปิดสิทธิ์
                      </button>
                    )}
                  </div>
                  {gk && (
                    <div className="mt-2 flex items-center gap-2 bg-[var(--surface-2)] rounded-lg p-2">
                      <span className="text-xs text-[var(--fg-3)] shrink-0">คีย์ของ {u.name}:</span>
                      <code className="flex-1 text-xs font-mono text-[var(--fg-1)] truncate">{gk}</code>
                      <button onClick={() => copy(gk, 'คัดลอกคีย์แล้ว')} className="p-1.5 rounded text-[var(--fg-3)] hover:text-[var(--primary)]"><Copy className="w-3.5 h-3.5" /></button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <p className="text-xs text-[var(--fg-4)]">เมื่อเปิดสิทธิ์ ระบบจะสร้างคีย์ให้ผู้ใช้คนนั้น — คัดลอกส่งให้เขา หรือให้เขาเปิดดูเองที่หน้านี้</p>
        </div>
      )}
    </div>
  )
}
