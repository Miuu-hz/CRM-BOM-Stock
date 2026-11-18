import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  Check,
  CheckCircle,
  Copy,
  Link,
  MessageSquare,
  RefreshCw,
  Unlink,
  UserCheck,
  Users,
} from 'lucide-react'
import { generateLinkToken, getLinkStatus, unlinkLine, getLinkedUsers, unlinkUserLine } from '../../services/lineBot'
import { useAuth } from '../../contexts/AuthContext'
import companySettingsService from '../../services/companySettings.service'
import toast from 'react-hot-toast'

export default function LineSettings() {
  const { t } = useTranslation()
  const { isMaster } = useAuth()
  // Account Linking state
  const [linkStatus, setLinkStatus] = useState<{ linked: boolean; linkedAt: string | null } | null>(null)
  const [linkToken, setLinkToken] = useState('')
  const [generatingToken, setGeneratingToken] = useState(false)
  const [tokenCopied, setTokenCopied] = useState(false)
  const [unlinking, setUnlinking] = useState(false)

  // Linked users list (master only)
  const [linkedUsers, setLinkedUsers] = useState<any[]>([])
  const [unlinkingUserId, setUnlinkingUserId] = useState<string | null>(null)

  useEffect(() => {
    loadLinkStatus()
    if (isMaster) loadLinkedUsers()
  }, [])

  const loadLinkedUsers = async () => {
    try {
      const res = await getLinkedUsers()
      if (res.success) setLinkedUsers(res.data)
    } catch { /* ignore */ }
  }

  const loadLinkStatus = async () => {
    try {
      const res = await getLinkStatus()
      if (res.success) setLinkStatus(res.data)
    } catch { /* ignore */ }
  }

  const handleGenerateToken = async () => {
    try {
      setGeneratingToken(true)
      setLinkToken('')
      const res = await generateLinkToken()
      if (res.success) {
        setLinkToken(res.data.token)
        setTimeout(loadLinkStatus, 500)
      }
    } catch { /* ignore */ } finally {
      setGeneratingToken(false)
    }
  }

  const handleUnlink = async () => {
    try {
      setUnlinking(true)
      await unlinkLine()
      setLinkStatus({ linked: false, linkedAt: null })
      setLinkToken('')
      loadLinkedUsers()
    } catch { /* ignore */ } finally {
      setUnlinking(false)
    }
  }

  const handleUnlinkUser = async (userId: string) => {
    try {
      setUnlinkingUserId(userId)
      await unlinkUserLine(userId)
      setLinkedUsers(prev => prev.filter(u => u.user_id !== userId))
    } catch { /* ignore */ } finally {
      setUnlinkingUserId(null)
    }
  }

  const copyToken = () => {
    navigator.clipboard.writeText(t('settings.line.accountLinking.tokenPrefix', { token: linkToken }))
    setTokenCopied(true)
    setTimeout(() => setTokenCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      {/* ทุกบริษัทใช้ OA กลางตัวเดียว — ไม่มีฟอร์มกรอก Channel รายร้านแล้ว */}
      <div className="phopy-card p-6 border-l-4 border-phopy-indigo">
        <h3 className="text-lg font-semibold text-[var(--fg-1)] mb-2 flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-[var(--primary)]" />
          LINE OA กลาง: Phopy-ERP
        </h3>
        <p className="text-[var(--fg-3)] text-sm mb-4">
          ทุกบริษัทใช้ LINE Official Account เดียวกัน ไม่ต้องตั้งค่า Channel เอง
          ระบบส่งแจ้งเตือนเฉพาะคนและกลุ่มที่ผูกด้วยรหัส 6 หลักแล้วเท่านั้น ใครยังไม่ผูกจะไม่ได้รับข้อความใดๆ
        </p>
        <a href="https://line.me/R/ti/p/@060cskax" target="_blank" rel="noopener noreferrer"
          className="phopy-btn-primary inline-flex items-center gap-2 text-sm">
          <Users className="w-4 h-4" /> เพิ่มเพื่อน @060cskax
        </a>
        <p className="text-xs text-[var(--fg-4)] mt-3">
          ผูกกลุ่ม: เชิญ Phopy-ERP เข้ากลุ่ม แล้วผู้ดูแล (Admin/Master) สร้างรหัสด้านล่างและพิมพ์รหัสในกลุ่มนั้น
        </p>
      </div>
      {/* Account Linking */}
      <div className="phopy-card p-6 border-l-4 border-success">
        <h3 className="text-lg font-semibold text-[var(--fg-1)] mb-1 flex items-center gap-2">
          <UserCheck className="w-5 h-5 text-success" />
          {t('settings.line.accountLinking.title')}
        </h3>
        <p className="text-[var(--fg-3)] text-sm mb-5">
          {t('settings.line.accountLinking.subtitle')}
        </p>

        {/* Status */}
        {linkStatus && (
          <div className={`mb-4 p-3 rounded-lg flex items-center justify-between gap-3 text-sm ${
            linkStatus.linked
              ? 'bg-success/10 border border-success/30 text-success'
              : 'bg-[var(--warning-soft)] border border-warning/30 text-warning'
          }`}>
            <span className="flex items-center gap-2">
              {linkStatus.linked
                ? <><CheckCircle className="w-4 h-4 flex-shrink-0" /> {t('settings.line.accountLinking.linked')}{linkStatus.linkedAt ? t('settings.line.accountLinking.linkedOn', { date: new Date(linkStatus.linkedAt).toLocaleDateString('th-TH') }) : ''}</>
                : <><AlertCircle className="w-4 h-4 flex-shrink-0" /> {t('settings.line.accountLinking.notLinked')}</>
              }
            </span>
            {linkStatus.linked && (
              <button
                onClick={handleUnlink}
                disabled={unlinking}
                className="flex items-center gap-1 px-2 py-1 rounded border border-danger/40 text-danger hover:bg-[var(--danger-soft)] text-xs transition-all"
              >
                {unlinking ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Unlink className="w-3 h-3" />}
                {t('settings.line.accountLinking.unlink')}
              </button>
            )}
          </div>
        )}

        {/* Steps */}
        <div className="bg-[var(--surface-2)] rounded-lg p-4 mb-4 text-sm space-y-2 text-[var(--fg-2)]">
          <p className="font-medium text-[var(--fg-2)] mb-2">{t('settings.line.accountLinking.stepsTitle')}</p>
          <p>{t('settings.line.accountLinking.step1')}</p>
          <p>{t('settings.line.accountLinking.step2')}</p>
          <p className="text-[var(--fg-4)] text-xs">{t('settings.line.accountLinking.tokenExpiry')}</p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleGenerateToken}
            disabled={generatingToken}
            className="phopy-btn-primary flex items-center gap-2 text-sm"
          >
            {generatingToken
              ? <RefreshCw className="w-4 h-4 animate-spin" />
              : <Link className="w-4 h-4" />
            }
            {t('settings.line.accountLinking.generateToken')}
          </button>

          {linkToken && (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="flex-1 font-mono text-sm bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--primary)] select-all">
                {t('settings.line.accountLinking.tokenPrefix', { token: linkToken })}
              </div>
              <button
                onClick={copyToken}
                className="flex items-center gap-1 px-3 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--fg-2)] hover:text-[var(--fg-1)] hover:border-phopy-indigo transition-all whitespace-nowrap"
              >
                <Copy className="w-3.5 h-3.5" />
                {tokenCopied ? <>{t('settings.line.accountLinking.copied')} <Check className="w-3.5 h-3.5 inline" /></> : t('settings.line.accountLinking.copyToken')}
              </button>
            </div>
          )}
        </div>
      </div>

      <ShiftExpenseGroupToggle />

      {/* Linked Users List (master only) */}
      {isMaster && (
        <div className="phopy-card p-6 border-l-4 border-phopy-indigo/50">
          <h3 className="text-lg font-semibold text-[var(--fg-1)] mb-1 flex items-center gap-2">
            <Users className="w-5 h-5 text-[var(--primary)]" />
            {t('settings.line.linkedUsers.title')}
          </h3>
          <p className="text-[var(--fg-3)] text-sm mb-4">{t('settings.line.linkedUsers.subtitle')}</p>

          {linkedUsers.length === 0 ? (
            <p className="text-[var(--fg-4)] text-sm">{t('settings.line.linkedUsers.none')}</p>
          ) : (
            <div className="space-y-2">
              {linkedUsers.map(u => (
                <div key={u.user_id} className="flex items-center justify-between p-3 bg-[var(--surface-2)] rounded-lg border border-[var(--border)]">
                  <div>
                    <p className="text-[var(--fg-2)] text-sm font-medium">
                      {u.user_name || u.user_id}
                      <span className="ml-2 text-xs text-[var(--fg-4)]">{u.role}</span>
                    </p>
                    {u.user_email && <p className="text-[var(--fg-4)] text-xs">{u.user_email}</p>}
                    <p className="text-[var(--fg-4)] text-xs mt-0.5">
                      {t('settings.line.linkedUsers.linkedAt', { date: u.linked_at ? new Date(u.linked_at).toLocaleDateString('th-TH') : '-' })}
                    </p>
                  </div>
                  <button
                    onClick={() => handleUnlinkUser(u.user_id)}
                    disabled={unlinkingUserId === u.user_id}
                    className="flex items-center gap-1 px-2 py-1 rounded border border-danger/40 text-danger hover:bg-[var(--danger-soft)] text-xs transition-all"
                  >
                    {unlinkingUserId === u.user_id
                      ? <RefreshCw className="w-3 h-3 animate-spin" />
                      : <Unlink className="w-3 h-3" />
                    }
                    {t('settings.line.accountLinking.unlink')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// การ์ดสรุปปิดกะ ส่ง LINE หา admin รายคนเสมอ — ไม่ push เข้ากลุ่ม (นับโควตาตามสมาชิก) · ติ๊กนี้ให้คนในกลุ่มพิมพ์ "สรุปการปิดกะ" ดูเองได้ (bot reply ฟรี)
function ShiftExpenseGroupToggle() {
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => {
    companySettingsService.get().then(d => setOn(Number(d.line_shift_expense_groups) === 1)).catch(() => setOn(false))
  }, [])
  const toggle = async (v: boolean) => {
    setOn(v)
    try {
      await companySettingsService.update({ line_shift_expense_groups: v })
      toast.success('บันทึกแล้ว')
    } catch (err: any) {
      setOn(!v)
      toast.error(err?.response?.data?.message || 'บันทึกไม่สำเร็จ')
    }
  }
  if (on === null) return null
  return (
    <div className="phopy-card p-6">
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="line_shift_expense_groups"
          checked={on}
          onChange={(e) => toggle(e.target.checked)}
          className="rounded bg-[var(--bg)] border-[var(--border)] text-[var(--primary)] focus:ring-phopy-indigo"
        />
        <label htmlFor="line_shift_expense_groups" className="text-[var(--fg-2)]">
          ให้คนในกลุ่ม LINE พิมพ์ "สรุปการปิดกะ" เพื่อดูยอดปิดกะได้
          <span className="block text-xs text-[var(--fg-4)]">บอทตอบกลับในกลุ่ม ไม่กินโควตาข้อความ · ระบบไม่ส่งการ์ดปิดกะเข้ากลุ่มเองแล้ว เพราะการส่งเข้ากลุ่มนับโควตาตามจำนวนสมาชิก</span>
        </label>
      </div>
    </div>
  )
}
