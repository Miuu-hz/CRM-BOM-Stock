import { useEffect, useState } from 'react'
import { Settings2, CheckCircle2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import PlatformMonthSale from './PlatformMonthSale'

// ==================== Types (ตรงกับ backend /api/platform-settlement) ====================

interface FeeMappingRow {
  id: string
  targetField: string // GROSS_SALES | VAT | COGS | PAYOUT | PERIOD_START | PERIOD_END | FEE
  feeType: string | null
  accountCode: string | null
  label: string
  columnAliases: string[]
  vatClaimable: boolean
  isActive: boolean
}

const PLATFORMS = [
  { key: 'SHOPEE', label: 'Shopee' },
  { key: 'LAZADA', label: 'Lazada' },
  { key: 'TIKTOK', label: 'TikTok Shop' },
] as const
type PlatformKey = (typeof PLATFORMS)[number]['key']

// ==================== Main Component ====================
// ข้อมูลเข้าทาง MCP เป็น "รอบเดือน" อย่างเดียวแล้ว — เลิกฟอร์มกรอกยอด/GP เอง (ตาราง platform_settlements ว่างทุก tenant)

export default function PlatformSettlement() {
  const [platform, setPlatform] = useState<PlatformKey>('SHOPEE')
  const [showSettings, setShowSettings] = useState(false)
  const [feeMappings, setFeeMappings] = useState<FeeMappingRow[]>([])

  const loadFeeMappings = async () => {
    try {
      const res = await api.get('/platform-settlement/fee-mappings')
      if (res.data.success) setFeeMappings(res.data.data)
    } catch {
      toast.error('โหลดการผูกค่าธรรมเนียมไม่สำเร็จ')
    }
  }

  useEffect(() => { loadFeeMappings() }, [])

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-1)]">บัญชีขายผ่านแพลตฟอร์ม</h1>
          <p className="text-[var(--fg-3)] mt-1 text-sm">รอบเดือนจากไฟล์แพลตฟอร์ม ส่งผ่าน AI (MCP) → จับคู่ SKU → ยืนยันการขาย → ลงบัญชี</p>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="p-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--fg-3)] hover:text-[var(--fg-1)]"
          title="ตั้งค่าผูกค่าธรรมเนียมกับบัญชี"
        >
          <Settings2 className="w-5 h-5" />
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {PLATFORMS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPlatform(p.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              platform === p.key
                ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--fg-1)]'
                : 'border-[var(--border)] text-[var(--fg-3)] hover:text-[var(--fg-1)]'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <PlatformMonthSale key={platform} platform={platform} />

      {showSettings && (
        <FeeMappingSettings
          mappings={feeMappings}
          onClose={() => setShowSettings(false)}
          onSaved={() => { loadFeeMappings(); setShowSettings(false) }}
        />
      )}
    </div>
  )
}

// ==================== Settings ====================

function FeeMappingSettings({ mappings, onClose, onSaved }: { mappings: FeeMappingRow[]; onClose: () => void; onSaved: () => void }) {
  const feeRows = mappings.filter((m) => m.targetField === 'FEE')
  const [edits, setEdits] = useState<Record<string, { accountCode: string; aliasesText: string; vatClaimable: boolean }>>(
    Object.fromEntries(feeRows.map((r) => [r.id, { accountCode: r.accountCode || '', aliasesText: r.columnAliases.join(', '), vatClaimable: r.vatClaimable }]))
  )
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    try {
      setSaving(true)
      const updates = feeRows.map((r) => ({
        id: r.id,
        accountCode: edits[r.id].accountCode,
        columnAliases: edits[r.id].aliasesText.split(',').map((s) => s.trim()).filter(Boolean),
        vatClaimable: edits[r.id].vatClaimable,
      }))
      const res = await api.put('/platform-settlement/fee-mappings', { updates })
      if (res.data.success) {
        toast.success('บันทึกการผูกค่าธรรมเนียมแล้ว')
        onSaved()
      }
    } catch {
      toast.error('บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="font-semibold text-[var(--fg-1)]">ผูกค่าธรรมเนียม ↔ บัญชี</h2>
          <button onClick={onClose} className="text-[var(--fg-3)] hover:text-[var(--fg-1)]"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-[var(--fg-4)]">
            ค่าธรรมเนียมแต่ละประเภทลงบัญชีที่ไหนตั้งไว้ล่วงหน้าแล้ว แก้ได้เฉพาะรหัสบัญชีปลายทาง กับชื่อคอลัมน์
            ในไฟล์จริงของแพลตฟอร์ม (ยังไม่มีไฟล์จริง — เจอชื่อคอลัมน์จริงเมื่อไหร่ค่อยเพิ่มทีละชื่อ คั่นด้วยจุลภาค)
          </p>
          {feeRows.map((r) => (
            <div key={r.id} className="border border-[var(--border)] rounded-lg p-3 space-y-2">
              <p className="text-sm font-medium text-[var(--fg-1)]">{r.label}</p>
              <div className="flex items-center gap-2">
                <label className="text-xs text-[var(--fg-3)] w-24 shrink-0">รหัสบัญชี</label>
                <input
                  value={edits[r.id]?.accountCode || ''}
                  onChange={(e) => setEdits({ ...edits, [r.id]: { ...edits[r.id], accountCode: e.target.value } })}
                  className="w-28 px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--fg-1)] text-sm font-mono"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-[var(--fg-3)] w-24 shrink-0">ชื่อคอลัมน์</label>
                <input
                  value={edits[r.id]?.aliasesText || ''}
                  onChange={(e) => setEdits({ ...edits, [r.id]: { ...edits[r.id], aliasesText: e.target.value } })}
                  placeholder="เช่น Commission Fee, ค่าคอมมิชชั่น"
                  className="flex-1 px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--fg-1)] text-sm"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-[var(--fg-3)]">
                <input
                  type="checkbox"
                  checked={edits[r.id]?.vatClaimable || false}
                  onChange={(e) => setEdits({ ...edits, [r.id]: { ...edits[r.id], vatClaimable: e.target.checked } })}
                />
                {r.feeType === 'SHIPPING_REVENUE' || r.feeType === 'SHIPPING_SUBSIDY' ? 'คิดภาษีขาย' : 'ขอคืนภาษีซื้อได้ (มีใบกำกับ)'}
              </label>
            </div>
          ))}
        </div>
        <div className="px-5 py-4 border-t border-[var(--border)] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--fg-3)] text-sm">ยกเลิก</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-sm font-medium disabled:opacity-50">
            {saving ? 'กำลังบันทึก...' : <span className="flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> บันทึก</span>}
          </button>
        </div>
      </div>
    </div>
  )
}
