import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Brain,
  Plus,
  Trash2,
  CheckCircle,
  AlertCircle,
  X,
  RefreshCw,
  Send,
  Bot,
  User,
  ChevronDown,
  Eye,
  EyeOff,
  Power,
  Star,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  getLLMProviders,
  createLLMProvider,
  updateLLMProvider,
  deleteLLMProvider,
  testLLMProvider,
  testChat,
  type LLMProvider,
  type LLMProviderInput,
} from '../../services/llm'

const PROVIDER_TYPES = ['openai', 'moonshot', 'anthropic', 'ollama', 'custom']

const DEFAULT_FORM: LLMProviderInput = {
  name: '',
  provider_type: 'openai',
  base_url: 'https://api.openai.com/v1',
  api_key: '',
  model: 'gpt-4o',
  is_active: true,
  is_default: false,
}

export default function LLMSettings() {
  const [providers, setProviders] = useState<LLMProvider[]>([])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<LLMProviderInput>({ ...DEFAULT_FORM })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [showKey, setShowKey] = useState(false)

  // Playground
  const [playgroundProvider, setPlaygroundProvider] = useState<string>('')
  const [playgroundMsg, setPlaygroundMsg] = useState('')
  const [playgroundReply, setPlaygroundReply] = useState('')
  const [playgroundLoading, setPlaygroundLoading] = useState(false)

  useEffect(() => {
    loadProviders()
  }, [])

  const loadProviders = async () => {
    setLoading(true)
    try {
      const res = await getLLMProviders()
      if (res.success) {
        setProviders(res.data)
        if (res.data.length > 0 && !playgroundProvider) {
          setPlaygroundProvider(res.data[0].id)
        }
      }
    } catch {
      toast.error('โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  const openAdd = () => {
    setEditId(null)
    setForm({ ...DEFAULT_FORM })
    setShowKey(false)
    setShowModal(true)
  }

  const openEdit = (p: LLMProvider) => {
    setEditId(p.id)
    setForm({
      name: p.name,
      provider_type: p.provider_type,
      base_url: p.base_url,
      api_key: '', // don't prefill key for security; if empty on update, backend keeps old
      model: p.model,
      is_active: p.is_active === 1,
      is_default: p.is_default === 1,
    })
    setShowKey(false)
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!form.name || !form.base_url || !form.model) {
      toast.error('กรุณากรอกข้อมูลให้ครบ')
      return
    }
    if (!editId && !form.api_key) {
      toast.error('กรุณากรอก API Key')
      return
    }
    setSaving(true)
    try {
      if (editId) {
        const payload: Partial<LLMProviderInput> = { ...form }
        if (!payload.api_key) delete payload.api_key
        const res = await updateLLMProvider(editId, payload)
        if (res.success) {
          toast.success('บันทึกสำเร็จ')
          setShowModal(false)
          loadProviders()
        } else {
          toast.error(res.message || 'บันทึกไม่สำเร็จ')
        }
      } else {
        const res = await createLLMProvider(form)
        if (res.success) {
          toast.success('สร้างสำเร็จ')
          setShowModal(false)
          loadProviders()
        } else {
          toast.error(res.message || 'สร้างไม่สำเร็จ')
        }
      }
    } catch {
      toast.error('เกิดข้อผิดพลาด')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('ต้องการลบ provider นี้?')) return
    try {
      const res = await deleteLLMProvider(id)
      if (res.success) {
        toast.success('ลบสำเร็จ')
        loadProviders()
      } else {
        toast.error(res.message || 'ลบไม่สำเร็จ')
      }
    } catch {
      toast.error('เกิดข้อผิดพลาด')
    }
  }

  const handleTestConnection = async () => {
    if (!editId) {
      toast.error('กรุณาบันทึก provider ก่อนทดสอบ')
      return
    }
    setTesting(true)
    try {
      const res = await testLLMProvider(editId)
      if (res.success) {
        toast.success(`เชื่อมต่อสำเร็จ: ${res.reply}`)
      } else {
        toast.error(res.message || 'เชื่อมต่อไม่สำเร็จ')
      }
    } catch {
      toast.error('เชื่อมต่อไม่สำเร็จ')
    } finally {
      setTesting(false)
    }
  }

  const handlePlaygroundSend = async () => {
    if (!playgroundMsg.trim()) return
    setPlaygroundLoading(true)
    setPlaygroundReply('')
    try {
      const res = await testChat(playgroundMsg, playgroundProvider || undefined)
      if (res.success) {
        setPlaygroundReply(res.reply)
      } else {
        toast.error(res.message || 'ส่งข้อความไม่สำเร็จ')
      }
    } catch {
      toast.error('เกิดข้อผิดพลาด')
    } finally {
      setPlaygroundLoading(false)
    }
  }

  const toggleActive = async (p: LLMProvider) => {
    try {
      const res = await updateLLMProvider(p.id, { is_active: p.is_active !== 1 })
      if (res.success) loadProviders()
    } catch {
      toast.error('อัปเดตไม่สำเร็จ')
    }
  }

  const setDefault = async (p: LLMProvider) => {
    try {
      const res = await updateLLMProvider(p.id, { is_default: true })
      if (res.success) loadProviders()
    } catch {
      toast.error('อัปเดตไม่สำเร็จ')
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-100 flex items-center gap-2">
            <Brain className="w-5 h-5 text-cyber-primary" />
            AI / LLM Providers
          </h2>
          <p className="text-sm text-gray-400">จัดการและทดสอบการเชื่อมต่อ LLM Provider</p>
        </div>
        <button onClick={openAdd} className="cyber-btn-primary flex items-center gap-2 text-sm">
          <Plus className="w-4 h-4" />
          เพิ่ม Provider
        </button>
      </div>

      {/* Provider List */}
      <div className="cyber-card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin" /> กำลังโหลด...
          </div>
        ) : providers.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            <Bot className="w-12 h-12 mx-auto mb-3 text-gray-600" />
            <p>ยังไม่มี LLM Provider ที่ตั้งค่าไว้</p>
            <button onClick={openAdd} className="mt-3 text-cyber-primary hover:underline text-sm">
              เพิ่ม Provider แรก
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-cyber-dark/50">
                <tr>
                  <th className="text-left py-3 px-4 text-gray-400 font-medium">ชื่อ</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-medium">ประเภท</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-medium">Model</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-medium">Base URL</th>
                  <th className="text-center py-3 px-4 text-gray-400 font-medium">ค่าเริ่มต้น</th>
                  <th className="text-center py-3 px-4 text-gray-400 font-medium">เปิดใช้งาน</th>
                  <th className="text-center py-3 px-4 text-gray-400 font-medium">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cyber-border">
                {providers.map((p) => (
                  <tr key={p.id} className="hover:bg-cyber-dark/30">
                    <td className="py-3 px-4 text-gray-200 font-medium">{p.name}</td>
                    <td className="py-3 px-4 text-gray-400 capitalize">{p.provider_type}</td>
                    <td className="py-3 px-4 text-gray-400 text-sm">{p.model}</td>
                    <td className="py-3 px-4 text-gray-500 text-xs truncate max-w-[200px]">{p.base_url}</td>
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => setDefault(p)}
                        className={`p-1.5 rounded-lg transition-colors ${p.is_default ? 'text-yellow-400 hover:text-yellow-300' : 'text-gray-600 hover:text-gray-400'}`}
                        title={p.is_default ? 'ค่าเริ่มต้น' : 'ตั้งเป็นค่าเริ่มต้น'}
                      >
                        <Star className={`w-5 h-5 ${p.is_default ? 'fill-current' : ''}`} />
                      </button>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => toggleActive(p)}
                        className={`p-1.5 rounded-lg transition-colors ${p.is_active ? 'text-cyber-green hover:text-cyber-green/80' : 'text-gray-600 hover:text-gray-400'}`}
                        title={p.is_active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
                      >
                        <Power className="w-5 h-5" />
                      </button>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => openEdit(p)}
                          className="p-1.5 text-gray-400 hover:text-cyber-primary hover:bg-cyber-primary/10 rounded-lg transition-colors"
                          title="แก้ไข"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(p.id)}
                          className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                          title="ลบ"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* LLM Playground */}
      <div className="cyber-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-cyber-primary" />
          <h3 className="text-lg font-bold text-gray-100">LLM Playground</h3>
        </div>
        <p className="text-sm text-gray-400">ทดสอบส่งข้อความเพื่อตรวจสอบว่า Token/API ตอบสนองหรือไม่</p>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-1">
            <label className="block text-sm text-gray-400 mb-2">เลือก Provider</label>
            <div className="relative">
              <select
                value={playgroundProvider}
                onChange={(e) => setPlaygroundProvider(e.target.value)}
                className="cyber-input w-full appearance-none pr-8"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.provider_type})
                  </option>
                ))}
                {providers.length === 0 && <option value="">ไม่มี Provider</option>}
              </select>
              <ChevronDown className="w-4 h-4 text-gray-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          <div className="md:col-span-3">
            <label className="block text-sm text-gray-400 mb-2">ข้อความ</label>
            <div className="flex gap-2">
              <textarea
                value={playgroundMsg}
                onChange={(e) => setPlaygroundMsg(e.target.value)}
                placeholder="พิมพ์ข้อความที่ต้องการทดสอบ..."
                className="cyber-input w-full resize-none"
                rows={3}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handlePlaygroundSend()
                  }
                }}
              />
              <button
                onClick={handlePlaygroundSend}
                disabled={playgroundLoading || !playgroundMsg.trim()}
                className="cyber-btn-primary px-4 flex flex-col items-center justify-center gap-1 disabled:opacity-50"
              >
                {playgroundLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                <span className="text-xs">ส่ง</span>
              </button>
            </div>
          </div>
        </div>

        {playgroundReply && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 bg-cyber-darker rounded-xl border border-cyber-border space-y-2"
          >
            <div className="flex items-center gap-2 text-cyber-primary text-sm font-medium">
              <Bot className="w-4 h-4" />
              ตอบกลับจาก LLM
            </div>
            <div className="text-gray-200 whitespace-pre-wrap text-sm leading-relaxed">
              {playgroundReply}
            </div>
          </motion.div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="cyber-card w-full max-w-lg max-h-[85vh] overflow-y-auto"
            >
              <div className="p-5 border-b border-cyber-border flex items-center justify-between">
                <h3 className="font-semibold text-gray-100">
                  {editId ? 'แก้ไข Provider' : 'เพิ่ม Provider ใหม่'}
                </h3>
                <button onClick={() => setShowModal(false)} className="p-2 hover:bg-cyber-dark rounded-lg">
                  <X className="w-5 h-5 text-gray-400" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">ชื่อ Provider</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="cyber-input w-full"
                    placeholder="เช่น Kimi Production"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">ประเภท</label>
                    <div className="relative">
                      <select
                        value={form.provider_type}
                        onChange={(e) => setForm({ ...form, provider_type: e.target.value })}
                        className="cyber-input w-full appearance-none pr-8"
                      >
                        {PROVIDER_TYPES.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                      <ChevronDown className="w-4 h-4 text-gray-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Model</label>
                    <input
                      type="text"
                      value={form.model}
                      onChange={(e) => setForm({ ...form, model: e.target.value })}
                      className="cyber-input w-full"
                      placeholder="เช่น gpt-4o"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">Base URL</label>
                  <input
                    type="text"
                    value={form.base_url}
                    onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                    className="cyber-input w-full"
                    placeholder="https://api.openai.com/v1"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">API Key</label>
                  <div className="relative">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={form.api_key}
                      onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                      className="cyber-input w-full pr-10"
                      placeholder="sk-..."
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                    >
                      {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {editId && !form.api_key && (
                    <p className="text-xs text-gray-500 mt-1">เว้นว่างไว้หากไม่ต้องการเปลี่ยน API Key</p>
                  )}
                </div>

                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                      className="w-4 h-4 accent-cyber-primary rounded"
                    />
                    <span className="text-sm text-gray-300">เปิดใช้งาน</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.is_default}
                      onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
                      className="w-4 h-4 accent-cyber-primary rounded"
                    />
                    <span className="text-sm text-gray-300">ค่าเริ่มต้น</span>
                  </label>
                </div>
              </div>

              <div className="p-5 border-t border-cyber-border flex gap-3 justify-end">
                {editId && (
                  <button
                    onClick={handleTestConnection}
                    disabled={testing}
                    className="px-4 py-2 rounded-lg border border-cyber-primary/50 text-cyber-primary hover:bg-cyber-primary/10 transition-colors text-sm flex items-center gap-2"
                  >
                    {testing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                    ทดสอบการเชื่อมต่อ
                  </button>
                )}
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-lg border border-cyber-border text-gray-300 hover:bg-cyber-dark transition-colors text-sm"
                >
                  ยกเลิก
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="cyber-btn-primary px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-50"
                >
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  {saving ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
