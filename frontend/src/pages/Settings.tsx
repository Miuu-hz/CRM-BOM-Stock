import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Settings,
  Users,
  Shield,
  Clock,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle,
  X,
  RefreshCw,
  Key,
  Building2,
  Store,
} from 'lucide-react'
import POSMenuSettings from './settings/POSMenuSettings'
import { useAuth } from '../contexts/AuthContext'

interface ChildUser {
  id: string
  email: string
  name: string
  role: string
  status: string
  created_at: string
  last_login_at?: string
}

export default function SettingsPage() {
  const { user, isMaster, children, loadChildren, createChildUser, deleteChildUser } = useAuth()
  const [activeTab, setActiveTab] = useState<'general' | 'users' | 'security' | 'pos'>('general')
  const [showAddModal, setShowAddModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [localChildren, setLocalChildren] = useState<ChildUser[]>([])

  // Load children when tab changes to users
  useEffect(() => {
    if (activeTab === 'users' && isMaster) {
      loadChildrenData()
    }
  }, [activeTab, isMaster])

  // Update local state when children changes
  useEffect(() => {
    setLocalChildren(children as ChildUser[])
  }, [children])

  const loadChildrenData = async () => {
    setLoading(true)
    await loadChildren()
    setLoading(false)
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-100 mb-2 font-['Orbitron']">
            <span className="neon-text">Settings</span>
          </h1>
          <p className="text-gray-400">ตั้งค่าระบบและจัดการผู้ใช้งาน</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-cyber-border pb-2">
        <TabButton
          active={activeTab === 'general'}
          onClick={() => setActiveTab('general')}
          icon={Settings}
          label="ทั่วไป"
        />
        {isMaster && (
          <TabButton
            active={activeTab === 'users'}
            onClick={() => setActiveTab('users')}
            icon={Users}
            label="ผู้ใช้งาน"
            badge={localChildren.length}
          />
        )}
        <TabButton
          active={activeTab === 'security'}
          onClick={() => setActiveTab('security')}
          icon={Shield}
          label="ความปลอดภัย"
        />
        <TabButton
          active={activeTab === 'pos'}
          onClick={() => setActiveTab('pos')}
          icon={Store}
          label="POS Menu"
        />
      </div>

      {/* Content */}
      <div className="space-y-6">
        {activeTab === 'general' && <GeneralSettings />}
        
        {activeTab === 'users' && isMaster && (
          <UserManagement
            children={localChildren}
            loading={loading}
            onRefresh={loadChildrenData}
            onAdd={() => setShowAddModal(true)}
            onDelete={deleteChildUser}
          />
        )}
        
        {activeTab === 'security' && <SecuritySettings />}
        
        {activeTab === 'pos' && <POSMenuSettings />}
      </div>

      {/* Add User Modal */}
      <AnimatePresence>
        {showAddModal && (
          <AddChildModal
            onClose={() => setShowAddModal(false)}
            onSuccess={() => {
              setShowAddModal(false)
              loadChildrenData()
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// Tab Button Component
function TabButton({ active, onClick, icon: Icon, label, badge }: any) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-5 py-3 rounded-t-lg font-semibold transition-all ${
        active
          ? 'bg-cyber-primary/20 text-cyber-primary border-b-2 border-cyber-primary'
          : 'text-gray-400 hover:text-gray-300 hover:bg-cyber-dark'
      }`}
    >
      <Icon className="w-5 h-5" />
      <span>{label}</span>
      {badge !== undefined && (
        <span className="ml-1 px-2 py-0.5 bg-cyber-primary/30 text-cyber-primary rounded-full text-xs">
          {badge}
        </span>
      )}
    </button>
  )
}

// General Settings
function GeneralSettings() {
  const { user, tenant, isMaster } = useAuth()

  return (
    <div className="space-y-6">
      {/* Company Info */}
      <div className="cyber-card p-6">
        <h3 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
          <Building2 className="w-5 h-5 text-cyber-primary" />
          ข้อมูลองค์กร
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">รหัสองค์กร</label>
            <p className="text-gray-200 font-mono">{tenant?.code || '-'}</p>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">ชื่อองค์กร</label>
            <p className="text-gray-200">{tenant?.name || '-'}</p>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">ประเภทบัญชี</label>
            <p className={`font-semibold ${isMaster ? 'text-cyber-green' : 'text-cyber-primary'}`}>
              {isMaster ? 'Master Account' : 'Standard Account'}
            </p>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">สถานะ</label>
            <span className="px-2 py-1 bg-cyber-green/20 text-cyber-green rounded text-sm">
              Active
            </span>
          </div>
        </div>
      </div>

      {/* Master Account Info */}
      {isMaster && (
        <div className="cyber-card p-6 border-l-4 border-cyber-green">
          <h3 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5 text-cyber-green" />
            สิทธิ์ Master Account
          </h3>
          <ul className="space-y-2 text-gray-300">
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-cyber-green" />
              สามารถสร้างผู้ใช้งานลูกได้ไม่จำกัด
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-cyber-green" />
              แก้ไขข้อมูลได้ไม่จำกัดเวลา (ไม่ติด 24hr rule)
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-cyber-green" />
              จัดการสิทธิ์ผู้ใช้งานได้
            </li>
          </ul>
        </div>
      )}

      {/* Time Lock Info */}
      <div className="cyber-card p-6">
        <h3 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-cyber-primary" />
          กฎการแก้ไขข้อมูล (24 Hour Rule)
        </h3>
        <div className="space-y-3 text-gray-300">
          <p className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
            <span>
              ข้อมูลทุกรายการที่สร้างขึ้น <strong className="text-cyber-primary">สามารถแก้ไขได้ภายใน 24 ชั่วโมง</strong> หลังจากสร้าง
            </span>
          </p>
          <p className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <span>
              หากเกิน 24 ชั่วโมง จะไม่สามารถแก้ไขหรือลบได้ 
              {isMaster && <strong className="text-cyber-green"> (ยกเว้น Master Account)</strong>}
            </span>
          </p>
          <p className="flex items-start gap-2">
            <CheckCircle className="w-5 h-5 text-cyber-green flex-shrink-0 mt-0.5" />
            <span>
              ระบบจะคำนวณเวลาจาก <strong>เวลาปัจจุบัน - เวลาสร้าง</strong> โดยอัตโนมัติ
            </span>
          </p>
        </div>
      </div>
    </div>
  )
}

// User Management (Master Only)
function UserManagement({ children, loading, onRefresh, onAdd, onDelete }: any) {
  const [deleting, setDeleting] = useState<string | null>(null)

  const handleDelete = async (id: string) => {
    if (!confirm('ต้องการลบผู้ใช้งานนี้?')) return
    
    setDeleting(id)
    const result = await onDelete(id)
    setDeleting(null)
    
    if (!result.success) {
      alert(result.message || 'ลบไม่สำเร็จ')
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
          <Users className="w-5 h-5 text-cyber-primary" />
          รายชื่อผู้ใช้งานในสายงาน
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-2 text-gray-400 hover:text-cyber-primary rounded-lg hover:bg-cyber-primary/10 transition-colors"
            title="รีเฟรช"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onAdd}
            className="cyber-btn-primary flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            เพิ่มผู้ใช้งาน
          </button>
        </div>
      </div>

      {/* User List */}
      {children.length === 0 ? (
        <div className="cyber-card p-12 text-center">
          <Users className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-300 mb-2">ยังไม่มีผู้ใช้งานลูก</h3>
          <p className="text-gray-500 mb-4">เริ่มต้นสร้างผู้ใช้งานในสายงานของคุณ</p>
          <button onClick={onAdd} className="cyber-btn-primary">
            <Plus className="w-4 h-4 inline mr-2" />
            เพิ่มผู้ใช้งาน
          </button>
        </div>
      ) : (
        <div className="cyber-card overflow-hidden">
          <table className="w-full">
            <thead className="bg-cyber-dark/50">
              <tr>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">ชื่อ</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">อีเมล</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">สิทธิ์</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">สร้างเมื่อ</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">เข้าสู่ระบบล่าสุด</th>
                <th className="text-center py-3 px-4 text-gray-400 font-medium">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cyber-border">
              {children.map((child: ChildUser) => (
                <tr key={child.id} className="hover:bg-cyber-dark/30">
                  <td className="py-3 px-4 text-gray-200">{child.name}</td>
                  <td className="py-3 px-4 text-gray-400">{child.email}</td>
                  <td className="py-3 px-4">
                    <RoleBadge role={child.role} />
                  </td>
                  <td className="py-3 px-4 text-gray-400 text-sm">
                    {new Date(child.created_at).toLocaleDateString('th-TH')}
                  </td>
                  <td className="py-3 px-4 text-gray-400 text-sm">
                    {child.last_login_at 
                      ? new Date(child.last_login_at).toLocaleDateString('th-TH')
                      : '-'
                    }
                  </td>
                  <td className="py-3 px-4 text-center">
                    <button
                      onClick={() => handleDelete(child.id)}
                      disabled={deleting === child.id}
                      className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                      title="ลบ"
                    >
                      {deleting === child.id ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Role Badge
function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    ADMIN: 'bg-cyber-green/20 text-cyber-green',
    MANAGER: 'bg-cyber-primary/20 text-cyber-primary',
    USER: 'bg-blue-500/20 text-blue-400',
    VIEWER: 'bg-gray-500/20 text-gray-400',
  }
  
  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${colors[role] || colors.USER}`}>
      {role}
    </span>
  )
}

// Add Child Modal
function AddChildModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { createChildUser } = useAuth()
  const [form, setForm] = useState({
    email: '',
    password: '',
    name: '',
    role: 'USER',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    
    if (!form.email || !form.password || !form.name) {
      setError('กรุณากรอกข้อมูลให้ครบ')
      return
    }
    
    setSaving(true)
    const result = await createChildUser(form.email, form.password, form.name, form.role)
    setSaving(false)
    
    if (result.success) {
      onSuccess()
    } else {
      setError(result.message || 'สร้างไม่สำเร็จ')
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="cyber-card w-full max-w-md"
      >
        <div className="p-6 border-b border-cyber-border flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-100">เพิ่มผู้ใช้งานลูก</h2>
          <button onClick={onClose} className="p-2 hover:bg-cyber-dark rounded-lg">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm text-gray-400 mb-2">ชื่อ</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="cyber-input w-full"
              placeholder="ชื่อผู้ใช้งาน"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">อีเมล</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="cyber-input w-full"
              placeholder="email@example.com"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">รหัสผ่าน</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="cyber-input w-full"
              placeholder="รหัสผ่าน"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">สิทธิ์</label>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="cyber-input w-full"
            >
              <option value="USER">User - ผู้ใช้งานทั่วไป</option>
              <option value="MANAGER">Manager - ผู้จัดการ</option>
              <option value="VIEWER">Viewer - ดูอย่างเดียว</option>
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-cyber-border rounded-lg text-gray-400 hover:bg-cyber-dark"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={saving}
              className="cyber-btn-primary flex items-center gap-2"
            >
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              สร้างผู้ใช้งาน
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}

// Security Settings
function SecuritySettings() {
  return (
    <div className="space-y-6">
      <div className="cyber-card p-6">
        <h3 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
          <Key className="w-5 h-5 text-cyber-primary" />
          เปลี่ยนรหัสผ่าน
        </h3>
        <p className="text-gray-400 text-sm mb-4">
          ฟีเจอร์นี้จะพร้อมใช้งานในเร็วๆ นี้
        </p>
        <button disabled className="cyber-btn-primary opacity-50 cursor-not-allowed">
          เปลี่ยนรหัสผ่าน
        </button>
      </div>

      <div className="cyber-card p-6">
        <h3 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
          <Shield className="w-5 h-5 text-cyber-primary" />
          การยืนยันตัวตนแบบ 2 ชั้น (2FA)
        </h3>
        <p className="text-gray-400 text-sm mb-4">
          เพิ่มความปลอดภัยด้วยการยืนยันตัวตนแบบ 2 ชั้น
        </p>
        <button disabled className="cyber-btn-primary opacity-50 cursor-not-allowed">
          เปิดใช้งาน 2FA
        </button>
      </div>
    </div>
  )
}
