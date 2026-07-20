import { useState, useEffect, useCallback } from 'react'
import { Coins, RefreshCw, Save, ToggleLeft, ToggleRight } from 'lucide-react'
import api from '../../services/api'
import toast from 'react-hot-toast'

interface Currency {
  tenant_id: string
  code: string
  name: string
  symbol: string
  exchange_rate: number
  is_active: number
  updated_at: string
}

export default function CurrencySettings() {
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [drafts, setDrafts] = useState<Record<string, { name: string; exchange_rate: number; is_active: boolean }>>({})
  const [loading, setLoading] = useState(true)
  const [savingCode, setSavingCode] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/currencies')
      const rows: Currency[] = data.data || []
      setCurrencies(rows)
      const nextDrafts: Record<string, { name: string; exchange_rate: number; is_active: boolean }> = {}
      for (const c of rows) {
        nextDrafts[c.code] = { name: c.name, exchange_rate: c.exchange_rate, is_active: c.is_active === 1 }
      }
      setDrafts(nextDrafts)
    } catch {
      toast.error('โหลดสกุลเงินไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const updateDraft = (code: string, patch: Partial<{ name: string; exchange_rate: number; is_active: boolean }>) =>
    setDrafts((prev) => ({ ...prev, [code]: { ...prev[code], ...patch } }))

  const save = async (code: string) => {
    const draft = drafts[code]
    if (!draft) return
    if (code !== 'THB' && (!Number.isFinite(draft.exchange_rate) || draft.exchange_rate <= 0)) {
      toast.error('อัตราแลกเปลี่ยนต้องมากกว่า 0')
      return
    }
    setSavingCode(code)
    try {
      await api.put(`/currencies/${code}`, {
        name: draft.name,
        exchangeRate: draft.exchange_rate,
        isActive: draft.is_active,
      })
      toast.success(`บันทึกสกุลเงิน ${code} แล้ว`)
      await load()
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'บันทึกไม่สำเร็จ')
    } finally {
      setSavingCode(null)
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
          <Coins className="w-5 h-5 text-[var(--primary)]" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-[var(--fg-1)]">สกุลเงิน</h2>
          <p className="text-sm text-[var(--fg-3)]">บาท (THB) เป็นสกุลเงินหลักของระบบบัญชีเสมอ — สกุลเงินอื่นใช้สำหรับบันทึกที่ระดับเอกสารเท่านั้น ไม่มีการปรับมูลค่าย้อนหลัง</p>
        </div>
        <button onClick={load} className="ml-auto p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--fg-3)] hover:text-[var(--fg-1)] transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-[var(--fg-3)] border-b border-[var(--border)] bg-[var(--surface-2)]/30">
              <th className="text-left px-4 py-3 font-medium">รหัส</th>
              <th className="text-left px-2 py-3 font-medium">ชื่อ</th>
              <th className="text-right px-2 py-3 font-medium">อัตราแลกเปลี่ยน (บาทต่อ 1 หน่วย)</th>
              <th className="text-center px-2 py-3 font-medium">ใช้งาน</th>
              <th className="text-right px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {currencies.map((c) => {
              const draft = drafts[c.code] || { name: c.name, exchange_rate: c.exchange_rate, is_active: c.is_active === 1 }
              const isThb = c.code === 'THB'
              return (
                <tr key={c.code} className="hover:bg-[var(--surface-2)]/20">
                  <td className="px-4 py-2.5 font-mono font-semibold text-[var(--fg-1)]">{c.symbol} {c.code}</td>
                  <td className="px-2 py-2.5">
                    <input
                      value={draft.name}
                      onChange={(e) => updateDraft(c.code, { name: e.target.value })}
                      className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)]"
                    />
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <input
                      type="number"
                      min={isThb ? 1 : 0.0001}
                      step="0.0001"
                      value={draft.exchange_rate}
                      disabled={isThb}
                      onChange={(e) => updateDraft(c.code, { exchange_rate: parseFloat(e.target.value) || 0 })}
                      onFocus={(e) => e.target.select()}
                      className="w-32 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm text-right text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)] disabled:opacity-40"
                      title={isThb ? 'สกุลเงินหลัก อัตราคงที่ที่ 1' : undefined}
                    />
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <button
                      type="button"
                      disabled={isThb}
                      onClick={() => updateDraft(c.code, { is_active: !draft.is_active })}
                      className="disabled:opacity-40"
                      title={isThb ? 'สกุลเงินหลักต้องเปิดใช้งานเสมอ' : undefined}
                    >
                      {draft.is_active
                        ? <ToggleRight className="w-7 h-7 text-[var(--primary)]" />
                        : <ToggleLeft className="w-7 h-7 text-[var(--fg-4)]" />}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => save(c.code)}
                      disabled={savingCode === c.code}
                      className="phopy-btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5 ml-auto disabled:opacity-50"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {savingCode === c.code ? 'กำลังบันทึก...' : 'บันทึก'}
                    </button>
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
