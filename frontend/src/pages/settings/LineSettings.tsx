import { useState, useEffect } from 'react'
import { MessageSquare, Save, RefreshCw, AlertCircle, CheckCircle, Link, Copy, UserCheck, Unlink, Users } from 'lucide-react'
import { getLineConfig, updateLineConfig, testLineMessage, generateLinkToken, getLinkStatus, unlinkLine, getLinkedUsers, unlinkUserLine, LineConfig } from '../../services/lineBot'
import { useAuth } from '../../contexts/AuthContext'

export default function LineSettings() {
    const { isMaster } = useAuth()
    const [config, setConfig] = useState<Partial<LineConfig>>({
        channel_name: '',
        channel_secret: '',
        channel_access_token: '',
        is_active: true
    })
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [testing, setTesting] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')

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
        loadConfig()
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
                // Refresh status after a short delay to pick up any prior link
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
        navigator.clipboard.writeText(`ลิงก์ ${linkToken}`)
        setTokenCopied(true)
        setTimeout(() => setTokenCopied(false), 2000)
    }

    const loadConfig = async () => {
        try {
            setLoading(true)
            const res = await getLineConfig()
            if (res.success && res.data) {
                setConfig({
                    ...res.data,
                    // Clear masked values so they don't get saved accidentally if unchanged
                    channel_secret: '',
                    channel_access_token: ''
                })
            }
        } catch (err: any) {
            setError('ไม่สามารถโหลดข้อมูลการตั้งค่า LINE ได้')
        } finally {
            setLoading(false)
        }
    }

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!isMaster) return

        try {
            setSaving(true)
            setError('')
            setSuccess('')

            // When updating an existing config, strip empty secret/token so the backend
            // keeps the stored values instead of overwriting with empty strings.
            const payload: Partial<LineConfig> = { ...config }
            if (config.id) {
                if (!payload.channel_secret)       delete payload.channel_secret
                if (!payload.channel_access_token) delete payload.channel_access_token
            }

            const res = await updateLineConfig(payload)
            if (res.success) {
                setSuccess('บันทึกการตั้งค่าสำเร็จ')
                setTimeout(() => setSuccess(''), 3000)
                loadConfig() // reload to reflect saved state
            } else {
                setError(res.message || 'บันทึกไม่สำเร็จ')
            }
        } catch (err: any) {
            setError(err?.response?.data?.message || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล')
        } finally {
            setSaving(false)
        }
    }

    const handleTest = async () => {
        try {
            setTesting(true)
            setError('')
            setSuccess('')

            const res = await testLineMessage()
            if (res.success) {
                setSuccess('ส่งข้อความทดสอบสำเร็จ กรุณาตรวจสอบในแอป LINE')
                setTimeout(() => setSuccess(''), 3000)
            } else {
                setError(res.message || 'ส่งข้อความทดสอบไม่สำเร็จ')
            }
        } catch (err: any) {
            setError('เกิดข้อผิดพลาดในการส่งข้อความทดสอบ')
        } finally {
            setTesting(false)
        }
    }

    if (loading) {
        return (
            <div className="cyber-card p-12 text-center">
                <RefreshCw className="w-8 h-8 text-cyber-primary mx-auto animate-spin mb-4" />
                <p className="text-gray-400">กำลังโหลดข้อมูล...</p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="cyber-card p-6 border-l-4 border-cyber-primary">
                <h3 className="text-lg font-semibold text-gray-100 mb-2 flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-cyber-primary" />
                    การตั้งค่า LINE Messaging API
                </h3>
                <p className="text-gray-400 text-sm mb-6">
                    ตั้งค่าเพื่อใช้งาน LINE Bot สำหรับแจ้งเตือนใบสั่งผลิต แจ้งเตือนสถานะต่างๆ
                    Webhook URL: <span className="font-mono text-cyber-primary px-2 py-1 bg-cyber-primary/10 rounded">https://crm.phopy.net/api/line/webhook</span>
                </p>

                {error && (
                    <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-3 text-red-400">
                        <AlertCircle className="w-5 h-5 flex-shrink-0" />
                        <p>{error}</p>
                    </div>
                )}

                {success && (
                    <div className="mb-6 p-4 bg-cyber-green/10 border border-cyber-green/30 rounded-lg flex items-center gap-3 text-cyber-green">
                        <CheckCircle className="w-5 h-5 flex-shrink-0" />
                        <p>{success}</p>
                    </div>
                )}

                <form onSubmit={handleSave} className="space-y-5 max-w-2xl">
                    <div>
                        <label className="block text-sm text-gray-400 mb-2 flex items-center gap-2">
                            ชื่อ Channel (แสดงผลเท่านั้น)
                        </label>
                        <input
                            type="text"
                            value={config.channel_name}
                            onChange={(e) => setConfig({ ...config, channel_name: e.target.value })}
                            className="cyber-input w-full"
                            placeholder="เช่น BBPillow Bot"
                            disabled={!isMaster}
                        />
                    </div>

                    <div>
                        <label className="block text-sm text-gray-400 mb-2">
                            Channel Secret
                        </label>
                        <input
                            type="password"
                            value={config.channel_secret}
                            onChange={(e) => setConfig({ ...config, channel_secret: e.target.value })}
                            className="cyber-input w-full"
                            placeholder={config.id ? '•••••••••••••••• (เว้นว่างไว้ถ้าไม่ต้องการเปลี่ยน)' : 'กรอก Channel Secret'}
                            required={!config.id}
                            disabled={!isMaster}
                        />
                    </div>

                    <div>
                        <label className="block text-sm text-gray-400 mb-2">
                            Channel Access Token
                        </label>
                        <textarea
                            value={config.channel_access_token}
                            onChange={(e) => setConfig({ ...config, channel_access_token: e.target.value })}
                            className="cyber-input w-full h-24"
                            placeholder={config.id ? '•••••••••••••••• (เว้นว่างไว้ถ้าไม่ต้องการเปลี่ยน)' : 'กรอก Channel Access Token (long-lived)'}
                            required={!config.id}
                            disabled={!isMaster}
                        />
                    </div>

                    <div className="flex items-center gap-3 pt-2">
                        <input
                            type="checkbox"
                            id="is_active"
                            checked={config.is_active}
                            onChange={(e) => setConfig({ ...config, is_active: e.target.checked })}
                            className="rounded bg-cyber-dark border-cyber-border text-cyber-primary focus:ring-cyber-primary"
                            disabled={!isMaster}
                        />
                        <label htmlFor="is_active" className="text-gray-300">
                            เปิดใช้งาน LINE Bot (ส่งแจ้งเตือนและรับคำสั่ง)
                        </label>
                    </div>

                    <div className="pt-6 border-t border-cyber-border flex items-center gap-4">
                        {isMaster && (
                            <button
                                type="submit"
                                disabled={saving}
                                className="cyber-btn-primary flex items-center gap-2"
                            >
                                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                บันทึกการตั้งค่า
                            </button>
                        )}

                        <button
                            type="button"
                            onClick={handleTest}
                            disabled={testing || !config.id}
                            className="px-4 py-2 bg-cyber-dark border border-cyber-border text-gray-300 rounded-lg font-medium hover:bg-cyber-dark/80 hover:text-white transition-all flex items-center gap-2 disabled:opacity-50"
                        >
                            {testing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                            ทดสอบส่งข้อความ (เข้า Role ของคุณ)
                        </button>
                    </div>
                </form>
            </div>
        {/* Account Linking */}
        <div className="cyber-card p-6 border-l-4 border-cyber-green">
            <h3 className="text-lg font-semibold text-gray-100 mb-1 flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-cyber-green" />
                เชื่อมบัญชี LINE ของคุณ
            </h3>
            <p className="text-gray-400 text-sm mb-5">
                เชื่อมบัญชีเพื่อรับแจ้งเตือนและสั่งงานผ่าน LINE โดยตรง
            </p>

            {/* Status */}
            {linkStatus && (
                <div className={`mb-4 p-3 rounded-lg flex items-center justify-between gap-3 text-sm ${
                    linkStatus.linked
                        ? 'bg-cyber-green/10 border border-cyber-green/30 text-cyber-green'
                        : 'bg-yellow-500/10 border border-yellow-500/30 text-yellow-400'
                }`}>
                    <span className="flex items-center gap-2">
                        {linkStatus.linked
                            ? <><CheckCircle className="w-4 h-4 flex-shrink-0" /> เชื่อมบัญชีแล้ว{linkStatus.linkedAt ? ` · ${new Date(linkStatus.linkedAt).toLocaleDateString('th-TH')}` : ''}</>
                            : <><AlertCircle className="w-4 h-4 flex-shrink-0" /> ยังไม่ได้เชื่อมบัญชี LINE</>
                        }
                    </span>
                    {linkStatus.linked && (
                        <button
                            onClick={handleUnlink}
                            disabled={unlinking}
                            className="flex items-center gap-1 px-2 py-1 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 text-xs transition-all"
                        >
                            {unlinking ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Unlink className="w-3 h-3" />}
                            ยกเลิกการเชื่อม
                        </button>
                    )}
                </div>
            )}

            {/* Steps */}
            <div className="bg-cyber-dark/50 rounded-lg p-4 mb-4 text-sm space-y-2 text-gray-300">
                <p className="font-medium text-gray-200 mb-2">วิธีเชื่อมบัญชี:</p>
                <p>1. กดปุ่ม "สร้างรหัสเชื่อม" ด้านล่าง</p>
                <p>2. กด "คัดลอก" แล้วส่งข้อความนั้นในแชทกับ LINE OA</p>
                <p className="text-gray-500 text-xs">⏰ รหัสมีอายุ 10 นาที</p>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
                <button
                    onClick={handleGenerateToken}
                    disabled={generatingToken}
                    className="cyber-btn-primary flex items-center gap-2 text-sm"
                >
                    {generatingToken
                        ? <RefreshCw className="w-4 h-4 animate-spin" />
                        : <Link className="w-4 h-4" />
                    }
                    สร้างรหัสเชื่อม
                </button>

                {linkToken && (
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div className="flex-1 font-mono text-sm bg-cyber-dark border border-cyber-border rounded-lg px-3 py-2 text-cyber-primary select-all">
                            ลิงก์ {linkToken}
                        </div>
                        <button
                            onClick={copyToken}
                            className="flex items-center gap-1 px-3 py-2 rounded-lg border border-cyber-border text-sm text-gray-300 hover:text-white hover:border-cyber-primary transition-all whitespace-nowrap"
                        >
                            <Copy className="w-3.5 h-3.5" />
                            {tokenCopied ? 'คัดลอกแล้ว ✓' : 'คัดลอก'}
                        </button>
                    </div>
                )}
            </div>
        </div>

        {/* Linked Users List (master only) */}
        {isMaster && (
            <div className="cyber-card p-6 border-l-4 border-cyber-primary/50">
                <h3 className="text-lg font-semibold text-gray-100 mb-1 flex items-center gap-2">
                    <Users className="w-5 h-5 text-cyber-primary" />
                    ผู้ใช้ที่เชื่อมต่อ LINE แล้ว
                </h3>
                <p className="text-gray-400 text-sm mb-4">รายชื่อผู้ใช้ในระบบที่เชื่อมบัญชี LINE ไว้แล้ว</p>

                {linkedUsers.length === 0 ? (
                    <p className="text-gray-500 text-sm">ยังไม่มีผู้ใช้เชื่อมต่อ LINE</p>
                ) : (
                    <div className="space-y-2">
                        {linkedUsers.map(u => (
                            <div key={u.user_id} className="flex items-center justify-between p-3 bg-cyber-dark/50 rounded-lg border border-cyber-border">
                                <div>
                                    <p className="text-gray-200 text-sm font-medium">
                                        {u.user_name || u.user_id}
                                        <span className="ml-2 text-xs text-gray-500">{u.role}</span>
                                    </p>
                                    {u.user_email && <p className="text-gray-500 text-xs">{u.user_email}</p>}
                                    <p className="text-gray-600 text-xs mt-0.5">
                                        เชื่อมเมื่อ {u.linked_at ? new Date(u.linked_at).toLocaleDateString('th-TH') : '-'}
                                    </p>
                                </div>
                                <button
                                    onClick={() => handleUnlinkUser(u.user_id)}
                                    disabled={unlinkingUserId === u.user_id}
                                    className="flex items-center gap-1 px-2 py-1 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 text-xs transition-all"
                                >
                                    {unlinkingUserId === u.user_id
                                        ? <RefreshCw className="w-3 h-3 animate-spin" />
                                        : <Unlink className="w-3 h-3" />
                                    }
                                    ยกเลิก
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
