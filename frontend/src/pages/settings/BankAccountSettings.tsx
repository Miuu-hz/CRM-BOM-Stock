import { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { Landmark, Plus, Pencil, Trash2, Star, X, QrCode, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import bankAccountsService, { type BankAccount, type BankAccountInput } from '../../services/bankAccounts.service'

const emptyForm: BankAccountInput = { bankName: '', accountName: '', accountNumber: '', qrCodeBase64: '', isDefault: false }

export default function BankAccountSettings() {
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<BankAccount | null>(null)
  const [form, setForm] = useState<BankAccountInput>(emptyForm)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await bankAccountsService.list()
      setAccounts(rows)
    } catch {
      toast.error('โหลดบัญชีธนาคารไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setShowModal(true)
  }

  const openEdit = (acc: BankAccount) => {
    setEditing(acc)
    setForm({
      bankName: acc.bank_name,
      accountName: acc.account_name,
      accountNumber: acc.account_number,
      qrCodeBase64: acc.qr_code_base64 || '',
      isDefault: Number(acc.is_default) === 1,
    })
    setShowModal(true)
  }

  const handleQrChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setForm((prev) => ({ ...prev, qrCodeBase64: ev.target?.result as string }))
    reader.readAsDataURL(file)
  }

  const save = async () => {
    if (!form.bankName.trim() || !form.accountName.trim() || !form.accountNumber.trim()) {
      toast.error('กรุณากรอกชื่อธนาคาร ชื่อบัญชี และเลขบัญชีให้ครบ')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        await bankAccountsService.update(editing.id, form)
        toast.success('แก้ไขบัญชีธนาคารแล้ว')
      } else {
        await bankAccountsService.create(form)
        toast.success('เพิ่มบัญชีธนาคารแล้ว — สร้างบัญชีย่อยในผังบัญชีให้อัตโนมัติ')
      }
      setShowModal(false)
      await load()
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const setDefault = async (acc: BankAccount) => {
    try {
      await bankAccountsService.update(acc.id, { isDefault: true })
      toast.success(`ตั้ง ${acc.bank_name} เป็นบัญชีหลักแล้ว`)
      await load()
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'บันทึกไม่สำเร็จ')
    }
  }

  const remove = async (acc: BankAccount) => {
    if (!confirm(`ลบบัญชี ${acc.bank_name} - ${acc.account_number}?`)) return
    try {
      await bankAccountsService.remove(acc.id)
      toast.success('ลบบัญชีธนาคารแล้ว')
      await load()
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'ลบไม่สำเร็จ — บัญชีนี้อาจมีประวัติการรับ/จ่ายเงินแล้ว')
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-[var(--primary)]/30 border-t-[var(--primary)] rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[var(--primary-soft)] flex items-center justify-center">
          <Landmark className="w-5 h-5 text-[var(--primary)]" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-[var(--fg-1)]">บัญชีธนาคาร / QR รับเงิน</h2>
          <p className="text-sm text-[var(--fg-3)]">
            แสดง QR + เลขบัญชีบนเอกสารขายและหน้าจ่ายเงิน POS — แต่ละบัญชีจะได้บัญชีย่อยในผังบัญชีอัตโนมัติ
            เพื่อให้เงินเข้า/ออกผ่านบัญชีนี้ลงบัญชีถูกจุดโดยไม่ต้องเลือกเอง
          </p>
        </div>
        <button onClick={load} className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--fg-3)] hover:text-[var(--fg-1)] transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
        <button onClick={openCreate} className="phopy-btn-primary flex items-center gap-2 text-sm px-4 py-2">
          <Plus className="w-4 h-4" />
          เพิ่มบัญชี
        </button>
      </div>

      {accounts.length === 0 ? (
        <div className="bg-[var(--surface)] border border-dashed border-[var(--border)] rounded-2xl p-10 text-center">
          <Landmark className="w-10 h-10 text-[var(--fg-4)] mx-auto mb-3" />
          <p className="text-[var(--fg-3)]">ยังไม่มีบัญชีธนาคาร — เพิ่มบัญชีแรกเพื่อแสดง QR รับเงินบนเอกสารและ POS</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {accounts.map((acc) => (
            <div key={acc.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 flex gap-4">
              <div className="w-20 h-20 rounded-lg border border-[var(--border)] bg-[var(--bg)] flex items-center justify-center overflow-hidden shrink-0">
                {acc.qr_code_base64
                  ? <img src={acc.qr_code_base64} alt="QR" className="w-full h-full object-contain" />
                  : <QrCode className="w-8 h-8 text-[var(--fg-4)]" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-[var(--fg-1)] truncate">{acc.bank_name}</p>
                  {Number(acc.is_default) === 1 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--primary-soft)] text-[var(--primary)] flex items-center gap-1 shrink-0">
                      <Star className="w-3 h-3 fill-current" /> บัญชีหลัก
                    </span>
                  )}
                </div>
                <p className="text-sm text-[var(--fg-3)] truncate">{acc.account_name}</p>
                <p className="text-sm font-mono text-[var(--fg-2)]">{acc.account_number}</p>
                <p className="text-xs text-[var(--fg-4)] mt-1">ผังบัญชี: {acc.gl_code} {acc.gl_name}</p>
                <div className="flex items-center gap-3 mt-2">
                  {Number(acc.is_default) !== 1 && (
                    <button onClick={() => setDefault(acc)} className="text-xs text-[var(--primary)] hover:underline">
                      ตั้งเป็นบัญชีหลัก
                    </button>
                  )}
                  <button onClick={() => openEdit(acc)} className="text-xs text-[var(--fg-3)] hover:text-[var(--fg-1)] flex items-center gap-1">
                    <Pencil className="w-3 h-3" /> แก้ไข
                  </button>
                  <button onClick={() => remove(acc)} className="text-xs text-danger hover:underline flex items-center gap-1">
                    <Trash2 className="w-3 h-3" /> ลบ
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col"
          >
            <div className="flex items-center justify-between p-6 border-b border-[var(--border)]">
              <h2 className="text-xl font-bold text-[var(--fg-1)]">{editing ? 'แก้ไขบัญชีธนาคาร' : 'เพิ่มบัญชีธนาคาร'}</h2>
              <button onClick={() => setShowModal(false)} className="p-2 rounded-lg hover:bg-[var(--bg)] text-[var(--fg-3)] hover:text-[var(--fg-1)]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-6 space-y-4">
              <div className="flex items-center gap-4">
                <div
                  className="w-20 h-20 rounded-lg border-2 border-dashed border-[var(--border)] flex items-center justify-center cursor-pointer hover:border-phopy-indigo/50 transition-colors overflow-hidden bg-[var(--bg)] shrink-0"
                  onClick={() => fileRef.current?.click()}
                >
                  {form.qrCodeBase64
                    ? <img src={form.qrCodeBase64} alt="QR" className="w-full h-full object-contain" />
                    : <QrCode className="w-8 h-8 text-[var(--fg-4)]" />}
                </div>
                <div>
                  <button type="button" onClick={() => fileRef.current?.click()} className="text-sm text-[var(--primary)] hover:underline">
                    อัปโหลดรูป QR
                  </button>
                  {form.qrCodeBase64 && (
                    <button type="button" onClick={() => setForm((p) => ({ ...p, qrCodeBase64: '' }))} className="ml-3 text-sm text-danger hover:underline">
                      ลบรูป
                    </button>
                  )}
                  <p className="text-xs text-[var(--fg-4)] mt-1">รูป QR จากแอปธนาคาร (PromptPay หรืออื่นๆ)</p>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleQrChange} />
                </div>
              </div>

              <div>
                <label className="block text-sm text-[var(--fg-3)] mb-1">ชื่อธนาคาร</label>
                <input
                  value={form.bankName}
                  onChange={(e) => setForm((p) => ({ ...p, bankName: e.target.value }))}
                  placeholder="เช่น ไทยพาณิชย์"
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)]"
                />
              </div>
              <div>
                <label className="block text-sm text-[var(--fg-3)] mb-1">ชื่อบัญชี</label>
                <input
                  value={form.accountName}
                  onChange={(e) => setForm((p) => ({ ...p, accountName: e.target.value }))}
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)]"
                />
              </div>
              <div>
                <label className="block text-sm text-[var(--fg-3)] mb-1">เลขที่บัญชี</label>
                <input
                  value={form.accountNumber}
                  onChange={(e) => setForm((p) => ({ ...p, accountNumber: e.target.value }))}
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm font-mono text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)]"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-[var(--fg-2)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!form.isDefault}
                  onChange={(e) => setForm((p) => ({ ...p, isDefault: e.target.checked }))}
                  className="w-4 h-4"
                />
                ตั้งเป็นบัญชีหลัก (ใช้แสดงบนเอกสาร/POS โดยอัตโนมัติ)
              </label>
            </div>

            <div className="flex items-center justify-end gap-3 p-6 border-t border-[var(--border)]">
              <button onClick={() => setShowModal(false)} className="phopy-btn-secondary text-sm px-4 py-2">ยกเลิก</button>
              <button onClick={save} disabled={saving} className="phopy-btn-primary text-sm px-4 py-2 disabled:opacity-50">
                {saving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}
