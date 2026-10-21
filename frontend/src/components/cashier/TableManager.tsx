import { useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Printer, RefreshCw, Trash2, X } from 'lucide-react'
import api from '../../services/api'
import companySettingsService from '../../services/companySettings.service'
import { useAuth } from '../../contexts/AuthContext'
import { useModalClose } from '../../hooks/useModalClose'
import type { PosTable, QrSettings } from './TableBoard'
import { printTableStickers } from './qrPrint'

type Props = {
  tables: PosTable[]
  settings: QrSettings
  onClose: () => void
  onChanged: () => void
}

const errMsg = (e: any, fallback: string) => e?.response?.data?.message || fallback

// "T-01, T-02" หรือขึ้นบรรทัดใหม่ → รายชื่อโต๊ะ
const parseNames = (s: string) => [...new Set(s.split(/[,\n]/).map(x => x.trim()).filter(Boolean))]

// เติมโต๊ะต่อจากเลขที่มีอยู่: มี T-01..T-04 แล้ว → T-05..T-14
function nextBatch(existing: string[], count = 10): string[] {
  const nums = existing.map(n => /^T-(\d+)$/.exec(n)?.[1]).filter(Boolean).map(Number)
  const start = (nums.length ? Math.max(...nums) : 0) + 1
  return Array.from({ length: count }, (_, i) => `T-${String(start + i).padStart(2, '0')}`)
}

export default function TableManager({ tables, settings, onClose, onChanged }: Props) {
  useModalClose(onClose)
  const { user } = useAuth()
  const canConfigMode = user?.role === 'ADMIN' || user?.role === 'MASTER'
  const [names, setNames] = useState('')
  const [saving, setSaving] = useState(false)

  const add = async (list: string[]) => {
    if (!list.length) return
    setSaving(true)
    try {
      await api.post('/pos/tables', { names: list })
      toast.success(`เพิ่ม ${list.length} โต๊ะแล้ว`)
      setNames('')
      onChanged()
    } catch (e) {
      toast.error(errMsg(e, 'เพิ่มโต๊ะไม่สำเร็จ'))
    } finally {
      setSaving(false)
    }
  }

  const rename = async (t: PosTable, input: HTMLInputElement) => {
    const next = input.value.trim()
    if (next === t.name) return
    if (!next) { input.value = t.name; return }
    try { await api.patch(`/pos/tables/${t.id}`, { name: next }); onChanged() } catch (e) { toast.error(errMsg(e, 'เปลี่ยนชื่อไม่สำเร็จ')); input.value = t.name }
  }
  const batch = nextBatch(tables.map(t => t.name))

  const remove = async (t: PosTable) => {
    if (!confirm(`ลบโต๊ะ ${t.name}? QR ของโต๊ะนี้จะใช้ไม่ได้อีก`)) return
    try { await api.delete(`/pos/tables/${t.id}`); onChanged() } catch (e) { toast.error(errMsg(e, 'ลบโต๊ะไม่สำเร็จ')) }
  }

  const regenerate = async (t: PosTable) => {
    if (!confirm(`สร้าง QR ใหม่ให้โต๊ะ ${t.name}? สติกเกอร์เดิมจะสแกนไม่ได้ ต้องพิมพ์ติดใหม่`)) return
    try { await api.post(`/pos/tables/${t.id}/regenerate-qr`); toast.success('สร้าง QR ใหม่แล้ว อย่าลืมพิมพ์สติกเกอร์ใหม่') } catch (e) { toast.error(errMsg(e, 'สร้าง QR ใหม่ไม่สำเร็จ')) }
  }

  // ADMIN/MASTER เท่านั้น (PUT /settings/company) — ผู้จัดการกดแล้ว server ตอบ 403
  const saveSettings = async (patch: { pos_qr_mode?: QrSettings['mode'] }) => {
    try { await companySettingsService.update(patch); onChanged() } catch (e) { toast.error(errMsg(e, 'บันทึกไม่สำเร็จ — เฉพาะ Admin ตั้งค่านี้ได้')) }
  }

  const stickers = () => {
    const w = window.open('', '_blank', 'width=900,height=1200')
    if (w) printTableStickers(w)
    else toast.error('กรุณาอนุญาต pop-up เพื่อพิมพ์สติกเกอร์')
  }

  return (
    <div className="fixed inset-0 bg-[var(--fg-1)]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="table-manager-title" onClick={e => e.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 space-y-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 id="table-manager-title" className="text-lg font-bold text-[var(--fg-1)]">จัดการโต๊ะ / QR</h2>
          <button onClick={onClose} aria-label="ปิด" className="p-2 rounded-lg text-[var(--fg-3)] hover:bg-[var(--surface-2)]"><X className="w-5 h-5" /></button>
        </div>

        {/* โหมด QR */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-[var(--fg-2)]">แบบของ QR</p>
            {!canConfigMode && <span className="text-xs text-[var(--fg-4)]">เฉพาะ Admin / Master เปลี่ยนได้</span>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {([['static', 'QR ถาวรบนโต๊ะ', 'พิมพ์สติกเกอร์ครั้งเดียว ใช้ได้เมื่อแคชเชียร์เปิดโต๊ะ'],
               ['rotate', 'เปลี่ยนทุกรอบ', 'พิมพ์ใบ QR ใหม่ตอนเปิดโต๊ะ ใบเก่าใช้ไม่ได้ทันทีที่ปิดบิล']] as const).map(([mode, label, sub]) => (
              <button key={mode} disabled={!canConfigMode} onClick={() => saveSettings({ pos_qr_mode: mode })} aria-pressed={settings.mode === mode}
                className={`p-3 rounded-xl border text-left transition-all ${settings.mode === mode ? 'border-phopy-indigo bg-[var(--primary-soft)]' : 'border-[var(--border)] hover:border-[var(--border-strong)]'} ${!canConfigMode ? 'opacity-50 cursor-not-allowed' : ''}`}>
                <p className={`text-sm font-semibold ${settings.mode === mode ? 'text-[var(--primary)]' : 'text-[var(--fg-2)]'}`}>{label}</p>
                <p className="text-xs text-[var(--fg-4)] mt-0.5">{sub}</p>
              </button>
            ))}
          </div>
        </section>

        {/* เพิ่มโต๊ะ */}
        <section className="space-y-2">
          <p className="text-sm font-semibold text-[var(--fg-2)]">เพิ่มโต๊ะ</p>
          <div className="flex gap-2">
            <input value={names} onChange={e => setNames(e.target.value)} maxLength={500}
              onKeyDown={e => { if (e.key === 'Enter') add(parseNames(names)) }}
              placeholder="เช่น T-01, T-02, ห้อง VIP" className="phopy-input flex-1 min-w-0" aria-label="ชื่อโต๊ะที่จะเพิ่ม" />
            <button onClick={() => add(parseNames(names))} disabled={saving || !parseNames(names).length}
              className="px-4 rounded-lg bg-[var(--primary)] text-white text-sm font-medium disabled:opacity-40">เพิ่ม</button>
          </div>
          <button onClick={() => add(batch)} disabled={saving}
            className="flex items-center gap-1.5 text-sm text-[var(--primary)] hover:underline disabled:opacity-40">
            <Plus className="w-4 h-4" /> เพิ่มเร็ว 10 โต๊ะ ({batch[0]} – {batch[batch.length - 1]})
          </button>
        </section>

        {/* รายการโต๊ะ */}
        {tables.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-[var(--fg-2)]">โต๊ะทั้งหมด ({tables.length})</p>
              <button onClick={stickers} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-[var(--border)] text-[var(--fg-2)] hover:border-phopy-indigo/50">
                <Printer className="w-4 h-4" /> พิมพ์สติกเกอร์ QR ทุกโต๊ะ
              </button>
            </div>
            <ul className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-xl">
              {tables.map(t => (
                <li key={t.id} className="flex items-center gap-2 px-3 py-2">
                  <input defaultValue={t.name} maxLength={20} aria-label={`ชื่อโต๊ะ ${t.name}`}
                    onBlur={e => rename(t, e.target)} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                    className="flex-1 min-w-0 bg-transparent px-2 py-1 rounded-md text-sm font-medium text-[var(--fg-1)] hover:bg-[var(--surface-2)] focus:bg-[var(--surface-2)]" />
                  {t.bill_id && <span className="text-xs text-[var(--primary)]">เปิดอยู่</span>}
                  <button onClick={() => regenerate(t)} title="สร้าง QR ใหม่ (สติกเกอร์เดิมใช้ไม่ได้)" aria-label={`สร้าง QR ใหม่ โต๊ะ ${t.name}`}
                    className="p-1.5 rounded-md text-[var(--fg-3)] hover:text-[var(--primary)] hover:bg-[var(--surface-2)]"><RefreshCw className="w-4 h-4" /></button>
                  <button onClick={() => remove(t)} disabled={!!t.bill_id} title={t.bill_id ? 'ปิดบิลก่อนจึงลบได้' : 'ลบโต๊ะ'} aria-label={`ลบโต๊ะ ${t.name}`}
                    className="p-1.5 rounded-md text-[var(--fg-3)] hover:text-danger hover:bg-[var(--danger-soft)] disabled:opacity-30"><Trash2 className="w-4 h-4" /></button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
