import { useState, useEffect } from 'react'
import { MessageSquare, Save, RefreshCw, AlertCircle, CheckCircle } from 'lucide-react'
import { getLineConfig, updateLineConfig, testLineMessage, LineConfig } from '../../services/lineBot'
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

    useEffect(() => {
        loadConfig()
    }, [])

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

            const res = await updateLineConfig(config)
            if (res.success) {
                setSuccess('บันทึกการตั้งค่าสำเร็จ')
                setTimeout(() => setSuccess(''), 3000)
            } else {
                setError(res.message || 'บันทึกไม่สำเร็จ')
            }
        } catch (err: any) {
            setError('เกิดข้อผิดพลาดในการบันทึกข้อมูล')
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
                    Webhook URL: <span className="font-mono text-cyber-primary px-2 py-1 bg-cyber-primary/10 rounded">https://bbpillow.com/api/line/webhook</span>
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
        </div>
    )
}
