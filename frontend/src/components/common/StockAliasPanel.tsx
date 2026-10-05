import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import { unitLabelTh } from '../../utils/unitNormalize'

/**
 * ชื่อเรียกแทน SKU ของสินค้าตัวเดียว (หน้าต่างรายละเอียดสินค้า หน้า Stock)
 * เช่น SKU "น้ำดื่ม" (นับเป็นขวด): "น้ำดื่มสิงห์" 1 แพ็ค = 15 ขวด · "น้ำดื่มทั่วไป" 1 แพ็ค = 12 ขวด
 * ใช้ได้ทั้งใบซื้อ ใบขาย และ AI (MCP) — ตรรกะอยู่ที่ backend services/stockItem.service.ts
 * ปิดฟีเจอร์ที่ ตั้งค่า > ทั่วไป แล้ว backend ตอบ enabled=false → ซ่อนทั้งกล่อง
 */
interface AliasRow {
  id: string
  name: string
  unit: string | null
  factor: number | null
  source_ref: string | null
}

export default function StockAliasPanel({ stockItemId, baseUnit }: { stockItemId: string; baseUnit: string }) {
  const [rows, setRows] = useState<AliasRow[]>([])
  const [enabled, setEnabled] = useState(false)
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('')
  const [factor, setFactor] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => api.get('/stock/aliases', { params: { stockItemId } })
    .then(r => { setRows(r.data?.data ?? []); setEnabled(r.data?.enabled !== false) })
    .catch(() => setEnabled(false))

  useEffect(() => { load() }, [stockItemId])

  if (!enabled) return null

  const add = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      const r = await api.post('/stock/aliases', {
        name, stockItemId, unit: unit.trim() || null, factor: unit.trim() ? Number(factor) : null,
      })
      setRows(r.data?.data ?? [])
      setName(''); setUnit(''); setFactor('')
      toast.success('บันทึกชื่อเรียกแทนแล้ว')
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    try {
      await api.delete(`/stock/aliases/${id}`)
      setRows(prev => prev.filter(r => r.id !== id))
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'ลบไม่สำเร็จ')
    }
  }

  const base = unitLabelTh(baseUnit)
  const inputCls = 'px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo'

  return (
    <div>
      <p className="text-sm font-semibold text-[var(--fg-2)] mb-1">ชื่อเรียกแทน SKU</p>
      <p className="text-[11px] text-[var(--fg-4)] mb-2">
        ชื่อที่ผู้ขาย/ลูกค้าใช้แต่ไม่ตรงชื่อสินค้านี้ — ซื้อหรือขายด้วยชื่อนี้จะตัด/รับสต็อกเข้าสินค้านี้
        ผูกหน่วยได้ถ้าแพ็คของชื่อนี้คนละขนาดกับของ SKU (ไม่ผูก = ใช้กฎแปลงหน่วยของสินค้า)
      </p>
      {rows.length > 0 && (
        <div className="border border-[var(--border)] rounded-xl overflow-hidden mb-2">
          {rows.map(r => (
            <div key={r.id} className="flex items-center gap-2 px-3 py-2 text-xs border-b border-[var(--border)]/50 last:border-b-0">
              <span className="flex-1 min-w-0 truncate text-[var(--fg-1)]">{r.name}</span>
              <span className="text-[var(--fg-3)] tabular-nums">
                {r.unit && r.factor ? `1 ${unitLabelTh(r.unit)} = ${r.factor} ${base}` : 'ใช้หน่วยของสินค้า'}
              </span>
              {r.source_ref && <span className="font-mono text-[10px] text-[var(--fg-4)]">{r.source_ref}</span>}
              <button type="button" onClick={() => remove(r.id)} aria-label={`ลบชื่อเรียกแทน ${r.name}`}
                className="p-1 text-[var(--fg-4)] hover:text-danger rounded">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="ชื่อเรียกแทน เช่น น้ำดื่มสิงห์"
          className={`${inputCls} flex-1 min-w-[10rem]`} />
        <span className="text-xs text-[var(--fg-4)]">1</span>
        <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="หน่วย (ไม่บังคับ) เช่น แพ็ค"
          className={`${inputCls} w-32`} />
        <span className="text-xs text-[var(--fg-4)]">=</span>
        <input type="number" min={0} step="any" value={factor} onChange={e => setFactor(e.target.value)}
          disabled={!unit.trim()} placeholder="15" className={`${inputCls} w-20 disabled:opacity-50`} />
        <span className="text-xs text-[var(--fg-4)]">{base}</span>
        <button type="button" onClick={add} disabled={saving || !name.trim()}
          className="h-8 px-3 rounded-lg bg-phopy-indigo text-white text-sm font-semibold flex items-center gap-1 disabled:opacity-50">
          <Plus className="w-3.5 h-3.5" /> เพิ่ม
        </button>
      </div>
    </div>
  )
}
