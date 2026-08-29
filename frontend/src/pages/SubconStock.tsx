import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Factory, Search, Loader2, Package, TrendingUp, Users } from 'lucide-react'

import subcontractService, { SubconStockRow, SubconStockSummary } from '../services/subcontract'
import { unitLabel } from '../hooks/useUnits'

function StatBox({ label, value, icon: Icon }: { label: string; value: string; icon: any }) {
  return (
    <div className="phopy-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-[var(--fg-3)] mb-1">{label}</p>
          <p className="text-2xl font-bold text-[var(--fg-1)]">{value}</p>
        </div>
        <Icon className="w-8 h-8 text-[var(--primary)] opacity-50" />
      </div>
    </div>
  )
}

function SubconStock() {
  const navigate = useNavigate()

  const [rows, setRows] = useState<SubconStockRow[]>([])
  const [summary, setSummary] = useState<SubconStockSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    load()
  }, [])

  const load = async () => {
    setLoading(true)
    try {
      const data = await subcontractService.getSubconStock()
      setRows(data.rows || [])
      setSummary(data.summary || null)
    } catch (err) {
      console.error('Failed to load subcon stock:', err)
    } finally {
      setLoading(false)
    }
  }

  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return rows
    return rows.filter(
      (r) => r.supplier_name.toLowerCase().includes(term) || r.item_name.toLowerCase().includes(term)
    )
  }, [rows, searchTerm])

  const groups = useMemo(() => {
    const map = new Map<string, { supplier_id: string; supplier_name: string; rows: SubconStockRow[] }>()
    for (const r of filteredRows) {
      const key = r.supplier_id
      if (!map.has(key)) map.set(key, { supplier_id: r.supplier_id, supplier_name: r.supplier_name, rows: [] })
      map.get(key)!.rows.push(r)
    }
    const list = Array.from(map.values())
    list.sort((a, b) => {
      const va = summary?.by_supplier.find((s) => s.supplier_id === a.supplier_id)?.value ?? 0
      const vb = summary?.by_supplier.find((s) => s.supplier_id === b.supplier_id)?.value ?? 0
      return vb - va
    })
    return list
  }, [filteredRows, summary])

  const getSupplierValue = (supplierId: string) =>
    summary?.by_supplier.find((s) => s.supplier_id === supplierId)?.value ?? 0

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      {/* Header */}
      <div>
        <button
          type="button"
          onClick={() => navigate('/stock')}
          className="flex items-center gap-2 text-sm text-[var(--fg-3)] hover:text-[var(--fg-1)] transition-colors mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          กลับไปหน้าสต๊อก
        </button>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-phopy-indigo/10 rounded-lg">
            <Factory className="w-6 h-6 text-[var(--primary)]" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-[var(--fg-1)]">สต็อกที่ผู้รับเหมา</h1>
            <p className="text-[var(--fg-3)]">วัตถุดิบที่เบิกออกไปแล้วแต่ยังค้างอยู่ที่ผู้รับเหมาช่วง จัดกลุ่มตามผู้รับเหมา</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatBox label="มูลค่ารวมทั้งหมด" value={`฿${(summary?.total_value ?? 0).toLocaleString()}`} icon={TrendingUp} />
        <StatBox label="จำนวนผู้รับเหมาที่มีของค้าง" value={(summary?.by_supplier.length ?? 0).toString()} icon={Users} />
        <StatBox label="จำนวนรายการทั้งหมด" value={rows.length.toString()} icon={Package} />
      </div>

      {/* Search */}
      <div className="phopy-card p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--fg-3)]" aria-hidden="true" />
          <input
            type="search"
            placeholder="ค้นหาชื่อผู้รับเหมา หรือ วัตถุดิบ..."
            aria-label="ค้นหา"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="phopy-input pl-10 w-full"
          />
        </div>
      </div>

      {/* Grouped list */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--primary)]" />
        </div>
      ) : groups.length === 0 ? (
        <div className="phopy-card p-10 text-center">
          <Factory className="w-10 h-10 text-[var(--fg-4)] mx-auto mb-3" />
          <p className="text-[var(--fg-3)]">
            {rows.length === 0 ? 'ไม่มีวัตถุดิบค้างอยู่ที่ผู้รับเหมา' : 'ไม่พบข้อมูลที่ตรงกับการค้นหา'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.supplier_id} className="phopy-card overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] bg-[var(--surface-2)]">
                <div className="flex items-center gap-2">
                  <Factory className="w-5 h-5 text-[var(--primary)]" />
                  <h2 className="text-lg font-bold text-[var(--fg-1)]">{g.supplier_name}</h2>
                </div>
                <span className="text-lg font-bold text-[var(--primary)]">
                  ฿{getSupplierValue(g.supplier_id).toLocaleString()}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      {['วัตถุดิบ', 'จำนวน', 'มูลค่า'].map((h) => (
                        <th key={h} className="text-left text-[var(--fg-3)] py-2 px-5 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((row) => (
                      <tr key={row.id} className="border-b border-[var(--border)] last:border-0">
                        <td className="py-2 px-5 text-[var(--fg-2)]">{row.item_name}</td>
                        <td className="py-2 px-5 text-[var(--fg-2)]">
                          {row.quantity.toLocaleString()} {unitLabel(row.unit)}
                        </td>
                        <td className="py-2 px-5 text-[var(--fg-2)]">฿{row.total_value.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  )
}

export default SubconStock
