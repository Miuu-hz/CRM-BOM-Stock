import { useState, useEffect, useRef } from 'react'
import { Network, ArrowRight, X, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import { UNIT_LABELS } from '../../hooks/useUnits'

type NodePos = { x: number; y: number }

export interface UnitConversionRow {
  id: string
  from_unit: string
  to_unit: string
  conversion_factor: number
}

interface Props {
  conversions: UnitConversionRow[]
  availableUnits: Array<{ value: string; label: string }>
  onAdd: (from: string, to: string, factor: number) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onClose: () => void
  baseUnit?: string
  displayUnit?: string
}

const CANVAS_H = 360
const NODE_W = 130
const NODE_H = 46

const ul = (u: string) => UNIT_LABELS[u] ?? u

function autoLayout(
  units: string[],
  convs: UnitConversionRow[],
  baseUnit?: string,
): Record<string, NodePos> {
  if (units.length === 0) return {}
  const adj: Record<string, string[]> = {}
  units.forEach(u => { adj[u] = [] })
  convs.forEach(c => { if (adj[c.from_unit]) adj[c.from_unit].push(c.to_unit) })
  const root = baseUnit && units.includes(baseUnit) ? baseUnit : units[0]
  const visited = new Set<string>()
  const levels: string[][] = []
  let queue = [root]
  visited.add(root)
  while (queue.length > 0) {
    levels.push([...queue])
    const next: string[] = []
    for (const u of queue) {
      for (const v of (adj[u] || [])) {
        if (!visited.has(v)) { visited.add(v); next.push(v) }
      }
    }
    queue = next
  }
  const unvisited = units.filter(u => !visited.has(u))
  for (let i = 0; i < unvisited.length; i += 2) levels.push(unvisited.slice(i, i + 2))
  const positions: Record<string, NodePos> = {}
  levels.forEach((lvl, li) => {
    const x = 20 + li * (NODE_W + 50)
    lvl.forEach((u, ui) => {
      const totalH = lvl.length * (NODE_H + 24)
      const y = (CANVAS_H - totalH) / 2 + ui * (NODE_H + 24)
      positions[u] = { x, y: Math.max(10, Math.min(y, CANVAS_H - NODE_H - 10)) }
    })
  })
  return positions
}

export default function UnitChainEditor({
  conversions,
  availableUnits,
  onAdd,
  onDelete,
  onClose,
  baseUnit = '',
  displayUnit = '',
}: Props) {
  const markerIdRef = useRef(`uce-arrow-${Math.random().toString(36).slice(2)}`)
  const markerId = markerIdRef.current

  const [nodePositions, setNodePositions] = useState<Record<string, NodePos>>(() => {
    const set = new Set<string>()
    if (baseUnit) set.add(baseUnit)
    if (displayUnit) set.add(displayUnit)
    conversions.forEach(c => { set.add(c.from_unit); set.add(c.to_unit) })
    return autoLayout(Array.from(set), conversions, baseUnit)
  })
  const [dragging, setDragging] = useState<{ unit: string; ox: number; oy: number } | null>(null)
  const [connectFrom, setConnectFrom] = useState<string | null>(null)
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null)
  const [pendingEdge, setPendingEdge] = useState<{ from: string; to: string } | null>(null)
  const [factorInput, setFactorInput] = useState('')
  const [edgeAdding, setEdgeAdding] = useState(false)
  const [addingUnit, setAddingUnit] = useState(false)
  const [newUnitValue, setNewUnitValue] = useState('')
  const canvasRef = useRef<HTMLDivElement>(null)

  const activeUnits = Object.keys(nodePositions)

  useEffect(() => {
    const units = new Set<string>()
    if (baseUnit) units.add(baseUnit)
    if (displayUnit) units.add(displayUnit)
    conversions.forEach(c => { units.add(c.from_unit); units.add(c.to_unit) })
    setNodePositions(prev => {
      const next = { ...prev }
      let changed = false
      units.forEach(u => {
        if (!next[u]) {
          const count = Object.keys(next).length
          next[u] = { x: 20 + (count % 3) * (NODE_W + 50), y: 20 + Math.floor(count / 3) * (NODE_H + 30) }
          changed = true
        }
      })
      return changed ? next : prev
    })
  }, [conversions, baseUnit, displayUnit])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setConnectFrom(null); setMousePos(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const getCanvasPos = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const handleNodeMouseDown = (e: React.MouseEvent, unit: string) => {
    if (connectFrom !== null) return
    e.preventDefault(); e.stopPropagation()
    const pos = getCanvasPos(e)
    const np = nodePositions[unit] ?? { x: 0, y: 0 }
    setDragging({ unit, ox: pos.x - np.x, oy: pos.y - np.y })
  }

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    const pos = getCanvasPos(e)
    if (dragging) {
      setNodePositions(prev => ({
        ...prev,
        [dragging.unit]: {
          x: Math.max(0, pos.x - dragging.ox),
          y: Math.max(0, Math.min(CANVAS_H - NODE_H, pos.y - dragging.oy)),
        },
      }))
    }
    if (connectFrom !== null) setMousePos(pos)
  }

  const handleCanvasMouseUp = () => { setDragging(null) }

  const handleNodeClick = (unit: string) => {
    if (!connectFrom) return
    if (connectFrom === unit) { setConnectFrom(null); setMousePos(null); return }
    const exists = conversions.some(c =>
      (c.from_unit === connectFrom && c.to_unit === unit) ||
      (c.from_unit === unit && c.to_unit === connectFrom),
    )
    if (exists) { toast.error('มีการแปลงหน่วยนี้อยู่แล้ว'); setConnectFrom(null); setMousePos(null); return }
    setPendingEdge({ from: connectFrom, to: unit })
    setConnectFrom(null); setMousePos(null); setFactorInput('')
  }

  const handleConfirmEdge = async () => {
    if (!pendingEdge || !factorInput || Number(factorInput) <= 0) return
    setEdgeAdding(true)
    try {
      await onAdd(pendingEdge.from, pendingEdge.to, Number(factorInput))
      setPendingEdge(null); setFactorInput('')
      toast.success('เพิ่มการแปลงหน่วยแล้ว')
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'เกิดข้อผิดพลาด')
    } finally {
      setEdgeAdding(false)
    }
  }

  const handleAddNode = () => {
    if (!newUnitValue) return
    if (nodePositions[newUnitValue]) { toast.error('หน่วยนี้มีอยู่แล้ว'); return }
    const count = activeUnits.length
    setNodePositions(prev => ({
      ...prev,
      [newUnitValue]: { x: 20 + (count % 3) * (NODE_W + 50), y: 20 + Math.floor(count / 3) * (NODE_H + 30) },
    }))
    setNewUnitValue(''); setAddingUnit(false)
  }

  const handleRemoveNode = async (unit: string) => {
    const toDelete = conversions.filter(c => c.from_unit === unit || c.to_unit === unit)
    try {
      await Promise.all(toDelete.map(c => onDelete(c.id)))
      setNodePositions(prev => { const next = { ...prev }; delete next[unit]; return next })
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'ลบไม่สำเร็จ')
    }
  }

  const edgePath = (from: string, to: string) => {
    const fp = nodePositions[from]; const tp = nodePositions[to]
    if (!fp || !tp) return ''
    const x1 = fp.x + NODE_W, y1 = fp.y + NODE_H / 2
    const x2 = tp.x, y2 = tp.y + NODE_H / 2
    const cx = (x1 + x2) / 2
    return `M ${x1} ${y1} C ${cx} ${y1} ${cx} ${y2} ${x2} ${y2}`
  }

  const edgeMid = (from: string, to: string) => {
    const fp = nodePositions[from]; const tp = nodePositions[to]
    if (!fp || !tp) return { x: 0, y: 0 }
    return { x: (fp.x + NODE_W + tp.x) / 2, y: (fp.y + tp.y + NODE_H) / 2 }
  }

  return (
    <>
      <style>{`
        .uce-theme {
          --uce-bg: #0d0d1a;
          --uce-grid: color-mix(in oklab, var(--primary) 18%, transparent);
          --uce-node: rgba(18, 18, 42, 0.95);
          --uce-accent: #8b5cf6;
          --uce-accent-soft: #c4b5fd;
          --uce-accent-btn: #9333ea;
          --uce-accent-btn-hover: #a855f7;
          --uce-tag: #1a1a2e;
          --uce-blue: #3b82f6;
          --uce-blue-soft: #93c5fd;
          --uce-blue-dark: #1e3a8a;
          --uce-muted: #4b5563;
          --uce-input-bg: rgba(55, 65, 81, 0.5);
          --uce-placeholder: #6b7280;
        }
      `}</style>
      <div className="fixed inset-0 bg-[var(--fg-1)]/70 z-50 flex items-center justify-center p-4 uce-theme">
      <div className="phopy-card w-full max-w-2xl flex flex-col" style={{ maxHeight: 'calc(100vh - 2rem)' }}>

        {/* Header */}
        <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <Network className="w-4 h-4 text-[var(--uce-accent)]" />
            <h3 className="text-sm font-semibold text-[var(--fg-1)]">Unit Chain Editor</h3>
            <span className="text-xs text-[var(--fg-4)] hidden sm:block">ลากโหนดได้ · คลิก → เชื่อม · Esc ยกเลิก</span>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 hover:bg-[var(--bg)] rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center">
            <X className="w-4 h-4 text-[var(--fg-3)]" />
          </button>
        </div>

        {/* Canvas */}
        <div
          ref={canvasRef}
          className="relative overflow-hidden flex-shrink-0 select-none bg-[var(--uce-bg)]"
          style={{
            height: CANVAS_H,
            cursor: dragging ? 'grabbing' : connectFrom ? 'crosshair' : 'default',
            backgroundImage: 'radial-gradient(var(--uce-grid) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
        >
          {/* SVG edges */}
          <svg className="absolute inset-0 pointer-events-none" style={{ width: '100%', height: '100%' }}>
            <defs>
              <marker id={markerId} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="var(--uce-accent)" />
              </marker>
            </defs>
            {conversions.map(conv => {
              const path = edgePath(conv.from_unit, conv.to_unit)
              const mid = edgeMid(conv.from_unit, conv.to_unit)
              if (!path) return null
              return (
                <g key={conv.id}>
                  <path d={path} stroke="var(--uce-accent)" strokeWidth="2" fill="none" markerEnd={`url(#${markerId})`} strokeOpacity="0.8" />
                  <rect x={mid.x - 26} y={mid.y - 10} width={52} height={20} rx={10} fill="var(--uce-tag)" stroke="var(--uce-accent)" strokeWidth="1" strokeOpacity="0.5" />
                  <text x={mid.x} y={mid.y + 4} textAnchor="middle" fill="var(--uce-accent-soft)" fontSize="11" fontFamily="monospace">
                    ×{conv.conversion_factor}
                  </text>
                </g>
              )
            })}
            {connectFrom && mousePos && nodePositions[connectFrom] && (() => {
              const fp = nodePositions[connectFrom]
              return <line x1={fp.x + NODE_W} y1={fp.y + NODE_H / 2} x2={mousePos.x} y2={mousePos.y} stroke="var(--primary)" strokeWidth="2" strokeDasharray="6,3" strokeOpacity="0.8" />
            })()}
          </svg>

          {/* Nodes */}
          {activeUnits.map(unit => {
            const pos = nodePositions[unit] ?? { x: 20, y: 20 }
            const isBase = unit === baseUnit
            const isDisplay = unit === displayUnit && unit !== baseUnit
            const isSource = connectFrom === unit
            return (
              <div
                key={unit}
                className={`absolute rounded-xl border transition-shadow ${
                  isSource ? 'border-[var(--uce-blue)] shadow-[0_0_12px_color-mix(in_oklab,var(--uce-blue)_50%,transparent)]'
                  : isBase ? 'border-[var(--uce-accent)] shadow-[0_0_10px_color-mix(in_oklab,var(--uce-accent)_35%,transparent)]'
                  : isDisplay ? 'border-phopy-indigo/70'
                  : 'border-[var(--border)]/60 hover:border-phopy-indigo/40'
                } bg-[var(--uce-node)]`}
                style={{
                  left: pos.x, top: pos.y,
                  width: NODE_W, height: NODE_H,
                  cursor: connectFrom ? 'pointer' : 'grab',
                  zIndex: dragging?.unit === unit ? 10 : 1,
                  userSelect: 'none',
                }}
                onMouseDown={(e) => handleNodeMouseDown(e, unit)}
                onClick={() => connectFrom && handleNodeClick(unit)}
              >
                <div className="flex items-center h-full px-2 gap-1.5">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isBase ? 'bg-[var(--uce-accent-soft)]' : isDisplay ? 'bg-phopy-indigo' : 'bg-[var(--uce-muted)]'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[var(--fg-2)] truncate leading-tight">{ul(unit)}</p>
                    <p className="text-[10px] text-[var(--fg-4)] font-mono truncate leading-tight">{unit}</p>
                  </div>
                  <button
                    type="button"
                    className={`p-1 rounded transition-colors flex-shrink-0 ${isSource ? 'bg-[var(--uce-blue)]/30 text-[var(--uce-blue-soft)]' : 'hover:bg-[var(--uce-accent)]/20 text-[var(--uce-accent)]/70 hover:text-[var(--uce-accent-soft)]'}`}
                    title="เชื่อมต่อ"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (connectFrom === unit) { setConnectFrom(null); setMousePos(null) }
                      else setConnectFrom(unit)
                    }}
                  >
                    <ArrowRight className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    className="p-1 rounded hover:bg-[var(--danger-soft)] text-[var(--fg-4)] hover:text-danger transition-colors flex-shrink-0"
                    title="ลบโหนด"
                    onClick={(e) => { e.stopPropagation(); handleRemoveNode(unit) }}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )
          })}

          {activeUnits.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-[var(--fg-4)] text-sm pointer-events-none">
              ยังไม่มีหน่วย — เพิ่มหน่วยด้านล่าง
            </div>
          )}

          {connectFrom && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-[var(--uce-blue-dark)]/70 border border-[var(--uce-blue)]/40 rounded-full text-xs text-[var(--uce-blue-soft)] pointer-events-none whitespace-nowrap">
              เชื่อมจาก "{ul(connectFrom)}" — คลิกโหนดปลายทาง หรือ Esc เพื่อยกเลิก
            </div>
          )}
        </div>

        {/* Conversion tags */}
        {conversions.length > 0 && (
          <div className="px-4 py-2 border-t border-[var(--border)]/40 flex-shrink-0 overflow-x-auto">
            <div className="flex flex-wrap gap-1.5">
              {conversions.map(conv => (
                <div key={conv.id} className="flex items-center gap-1 px-2 py-0.5 bg-[var(--uce-accent)]/10 border border-[var(--uce-accent)]/20 rounded-full text-xs text-[var(--uce-accent-soft)] whitespace-nowrap">
                  <span className="font-mono">{ul(conv.from_unit)} →×{conv.conversion_factor}→ {ul(conv.to_unit)}</span>
                  <button type="button" onClick={() => onDelete(conv.id)} className="text-purple-400/50 hover:text-danger transition-colors ml-0.5">
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[var(--border)] flex items-center gap-2 flex-shrink-0 flex-wrap">
          {addingUnit ? (
            <>
              <select
                value={newUnitValue}
                onChange={e => setNewUnitValue(e.target.value)}
                className="flex-1 min-w-[140px] px-2.5 py-1.5 bg-[var(--uce-input-bg)] border border-[var(--border-strong)]/50 rounded-lg text-xs text-[var(--fg-2)] focus:outline-none focus:border-[var(--uce-accent)]/50"
                autoFocus
              >
                <option value="">เลือกหน่วย</option>
                {availableUnits.filter(u => !nodePositions[u.value]).map(u => (
                  <option key={u.value} value={u.value}>{u.label} ({u.value})</option>
                ))}
              </select>
              <button type="button" onClick={handleAddNode} disabled={!newUnitValue} className="px-3 py-1.5 bg-[var(--uce-accent-btn)] hover:bg-[var(--uce-accent-btn-hover)] disabled:opacity-40 text-white rounded-lg text-xs font-medium min-h-[44px]">
                เพิ่ม
              </button>
              <button type="button" onClick={() => { setAddingUnit(false); setNewUnitValue('') }} className="px-3 py-1.5 border border-[var(--border)] text-[var(--fg-3)] rounded-lg text-xs min-h-[44px]">
                ยกเลิก
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setAddingUnit(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--uce-accent)]/10 border border-[var(--uce-accent)]/30 text-[var(--uce-accent-soft)] rounded-lg text-xs hover:bg-[var(--uce-accent)]/20 transition-colors min-h-[44px]"
            >
              <Plus className="w-3.5 h-3.5" />
              เพิ่มหน่วย
            </button>
          )}
          <button type="button" onClick={onClose} className="px-4 py-1.5 border border-[var(--border)] text-[var(--fg-3)] rounded-lg text-xs hover:text-[var(--fg-2)] ml-auto min-h-[44px]">
            ปิด
          </button>
        </div>
      </div>

      {/* Factor input dialog */}
      {pendingEdge && (
        <div className="fixed inset-0 bg-[var(--fg-1)]/40 z-50 flex items-center justify-center">
          <div className="phopy-card p-5 w-80">
            <h4 className="text-sm font-semibold text-[var(--fg-2)] mb-1">ตั้งค่าการแปลงหน่วย</h4>
            <p className="text-xs text-[var(--fg-3)] mb-3">
              <span className="font-mono text-[var(--uce-accent-soft)]">{ul(pendingEdge.from)}</span>
              <span className="mx-1 text-[var(--fg-4)]">→</span>
              <span className="font-mono text-[var(--primary)]">{ul(pendingEdge.to)}</span>
            </p>
            <label className="text-xs text-[var(--fg-4)] block mb-1">
              1 {ul(pendingEdge.from)} = ? {ul(pendingEdge.to)}
            </label>
            <input
              type="number"
              value={factorInput}
              onChange={e => setFactorInput(e.target.value)}
              placeholder="เช่น 24"
              min="0.000001"
              step="any"
              className="phopy-input w-full text-sm mb-3"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleConfirmEdge(); if (e.key === 'Escape') setPendingEdge(null) }}
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => setPendingEdge(null)} className="flex-1 py-2 border border-[var(--border)] text-[var(--fg-3)] rounded-lg text-xs min-h-[44px]">
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleConfirmEdge}
                disabled={edgeAdding || !factorInput || Number(factorInput) <= 0}
                className="flex-1 py-2 bg-[var(--uce-accent-btn)] hover:bg-[var(--uce-accent-btn-hover)] disabled:opacity-40 text-white rounded-lg text-xs font-medium min-h-[44px]"
              >
                {edgeAdding ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  )
}
