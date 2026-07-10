import { useState, useEffect, useCallback } from 'react'
import { Hash, Save, RefreshCw, Info } from 'lucide-react'
import api from '../../services/api'
import toast from 'react-hot-toast'

interface DocFormat {
  doc_type: string
  enabled: boolean
  prefix: string
  padding: number
  date_format: string
  separator: string
}

const DOC_TYPES: { value: string; label: string; defaultPrefix: string }[] = [
  { value: 'PURCHASE_REQUEST', label: 'ใบขอซื้อ (PR)',        defaultPrefix: 'PR' },
  { value: 'PO',               label: 'ใบสั่งซื้อ (PO)',       defaultPrefix: 'PO' },
  { value: 'GOODS_RECEIPT',    label: 'ใบรับของ (GR)',        defaultPrefix: 'GR' },
  { value: 'PURCHASE_INVOICE', label: 'ใบแจ้งหนี้ซื้อ (PI)',   defaultPrefix: 'PI' },
  { value: 'SUPPLIER_PAYMENT', label: 'ใบจ่ายเงิน (PAY)',     defaultPrefix: 'PAY' },
  { value: 'QUOTATION',        label: 'ใบเสนอราคา (QT)',      defaultPrefix: 'QT' },
  { value: 'SALES_ORDER',      label: 'ออเดอร์ขาย (SO)',      defaultPrefix: 'SO' },
  { value: 'DELIVERY_ORDER',   label: 'ใบส่งของ (DO)',        defaultPrefix: 'DO' },
  { value: 'INVOICE',          label: 'ใบแจ้งหนี้ขาย (INV)',   defaultPrefix: 'INV' },
  { value: 'RECEIPT',          label: 'ใบเสร็จ (RC)',          defaultPrefix: 'RC' },
  { value: 'CREDIT_NOTE',      label: 'ใบลดหนี้ (CN)',        defaultPrefix: 'CN' },
  { value: 'POS_BILL',         label: 'บิล POS',              defaultPrefix: 'POS' },
  { value: 'WORK_ORDER',       label: 'ใบสั่งผลิต (WO)',      defaultPrefix: 'WO' },
]

const DATE_FORMATS = [
  { value: 'NONE',   label: 'ไม่มีวันที่' },
  { value: 'DDMMYY', label: 'ววดดปป (090726)' },
  { value: 'YYMMDD', label: 'ปปดดวว (260709)' },
  { value: 'MMYY',   label: 'ดดปป (0726)' },
  { value: 'YYYY',   label: 'ปี ค.ศ. (2026)' },
]

function buildPreview(f: DocFormat): string {
  const num = '1'.padStart(f.padding, '0')
  const d = new Date()
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(-2)
  let dateStr = ''
  if (f.date_format === 'DDMMYY') dateStr = dd + mm + yy
  else if (f.date_format === 'YYMMDD') dateStr = yy + mm + dd
  else if (f.date_format === 'MMYY') dateStr = mm + yy
  else if (f.date_format === 'YYYY') dateStr = String(d.getFullYear())
  return dateStr ? `${f.prefix}${f.separator}${num}${f.separator}${dateStr}` : `${f.prefix}${f.separator}${num}`
}

export default function DocumentNumberSettings() {
  const [formats, setFormats] = useState<Record<string, DocFormat>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/settings/document-formats')
      const map: Record<string, DocFormat> = {}
      for (const dt of DOC_TYPES) {
        const existing = (data.data || []).find((r: any) => r.doc_type === dt.value)
        map[dt.value] = existing
          ? {
              doc_type: dt.value,
              enabled: existing.enabled === 1,
              prefix: existing.prefix,
              padding: existing.padding,
              date_format: existing.date_format || 'NONE',
              separator: existing.separator || '-',
            }
          : {
              doc_type: dt.value,
              enabled: false,
              prefix: dt.defaultPrefix,
              padding: 3,
              date_format: 'DDMMYY',
              separator: '-',
            }
      }
      setFormats(map)
    } catch {
      toast.error('โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const update = (docType: string, patch: Partial<DocFormat>) =>
    setFormats(prev => ({ ...prev, [docType]: { ...prev[docType], ...patch } }))

  const saveAll = async () => {
    setSaving(true)
    try {
      await api.post('/settings/document-formats', {
        formats: Object.values(formats).map(f => ({
          ...f,
          date_format: f.date_format === 'NONE' ? 'NONE' : f.date_format,
        })),
      })
      toast.success('บันทึกรูปแบบเลขเอกสารแล้ว')
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-[var(--primary)]/30 border-t-[var(--primary)] rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[var(--primary-soft)] flex items-center justify-center">
          <Hash className="w-5 h-5 text-[var(--primary)]" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-[var(--fg-1)]">รูปแบบเลขที่เอกสาร</h2>
          <p className="text-sm text-[var(--fg-3)]">กำหนด prefix, จำนวนหลัก และวันที่ต่อท้าย เช่น PO-001-090726</p>
        </div>
        <div className="ml-auto flex gap-2">
          <button onClick={load} className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--fg-3)] hover:text-[var(--fg-1)] transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={saveAll} disabled={saving}
            className="phopy-btn-primary flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-50">
            <Save className="w-4 h-4" /> {saving ? 'กำลังบันทึก...' : 'บันทึกทั้งหมด'}
          </button>
        </div>
      </div>

      <div className="flex gap-3 bg-[var(--info-soft)] border border-info/25 rounded-xl p-4 text-sm text-[var(--fg-2)]">
        <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
        <div>
          <p>เลขรันนิ่ง (xxx) เพิ่มอัตโนมัติต่อเนื่อง ไม่รีเซ็ตตามวัน — เอกสารที่ออกไปแล้วจะไม่เปลี่ยนเลข
            มีผลเฉพาะเอกสารใหม่ที่สร้างหลังเปิดใช้งาน</p>
        </div>
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-[var(--fg-3)] border-b border-[var(--border)] bg-[var(--surface-2)]/30">
              <th className="text-left px-4 py-3 font-medium">เอกสาร</th>
              <th className="text-center px-2 py-3 font-medium">ใช้งาน</th>
              <th className="text-left px-2 py-3 font-medium">Prefix</th>
              <th className="text-center px-2 py-3 font-medium">จำนวนหลัก</th>
              <th className="text-left px-2 py-3 font-medium">วันที่ต่อท้าย</th>
              <th className="text-center px-2 py-3 font-medium">คั่น</th>
              <th className="text-right px-4 py-3 font-medium">ตัวอย่าง</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {DOC_TYPES.map(dt => {
              const f = formats[dt.value]
              if (!f) return null
              return (
                <tr key={dt.value} className={`hover:bg-[var(--surface-2)]/20 ${!f.enabled ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-2.5 font-medium text-[var(--fg-1)]">{dt.label}</td>
                  <td className="px-2 py-2.5 text-center">
                    <button
                      onClick={() => update(dt.value, { enabled: !f.enabled })}
                      className={`relative w-9 h-5 rounded-full transition-colors ${f.enabled ? 'bg-[var(--primary)]' : 'bg-[var(--surface-2)]'}`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${f.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                    </button>
                  </td>
                  <td className="px-2 py-2.5">
                    <input
                      value={f.prefix} maxLength={10}
                      onChange={e => update(dt.value, { prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
                      disabled={!f.enabled}
                      className="w-20 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)] disabled:opacity-40 font-mono"
                    />
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <input
                      type="number" min={2} max={8} value={f.padding}
                      onChange={e => update(dt.value, { padding: Math.min(Math.max(Number(e.target.value) || 3, 2), 8) })}
                      disabled={!f.enabled}
                      className="w-14 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm text-center text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)] disabled:opacity-40"
                    />
                  </td>
                  <td className="px-2 py-2.5">
                    <select
                      value={f.date_format}
                      onChange={e => update(dt.value, { date_format: e.target.value })}
                      disabled={!f.enabled}
                      className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)] disabled:opacity-40"
                    >
                      {DATE_FORMATS.map(df => <option key={df.value} value={df.value}>{df.label}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <select
                      value={f.separator}
                      onChange={e => update(dt.value, { separator: e.target.value })}
                      disabled={!f.enabled}
                      className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)] disabled:opacity-40"
                    >
                      <option value="-">-</option>
                      <option value="/">/</option>
                    </select>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className={`font-mono text-xs px-2 py-1 rounded-lg ${f.enabled ? 'bg-[var(--primary-soft)] text-[var(--primary)]' : 'bg-[var(--surface-2)] text-[var(--fg-4)]'}`}>
                      {f.enabled ? buildPreview(f) : 'ค่าเริ่มต้นระบบ'}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
