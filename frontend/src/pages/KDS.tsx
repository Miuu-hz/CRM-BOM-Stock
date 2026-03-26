import React, { useState, useEffect, useRef } from 'react'
import { Check, ClipboardList, Clock, AlertCircle, MonitorPlay, ChefHat, RefreshCw } from 'lucide-react'
import kdsService, { KDSTicket } from '../services/kds.service'

const KDS: React.FC = () => {
  const [tickets, setTickets] = useState<KDSTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [soundEnabled, setSoundEnabled] = useState(false)
  const isFirstLoad = useRef(true)
  const lastCount = useRef(0)
  const audioCtxRef = useRef<AudioContext | null>(null)

  const unlockAudio = () => {
    if (soundEnabled) return
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      audioCtxRef.current = ctx
      // play silent buffer to unlock
      const buf = ctx.createBuffer(1, 1, 22050)
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(ctx.destination)
      src.start(0)
      setSoundEnabled(true)
    } catch {}
  }

  const fetchTickets = async () => {
    try {
      const data = await kdsService.getTickets()
      setTickets(data)

      const count = data.length
      if (!isFirstLoad.current && count > lastCount.current) {
        playNotificationSound()
      }
      lastCount.current = count
      isFirstLoad.current = false
      setError(null)
    } catch (err) {
      setError('ไม่สามารถดึงข้อมูลได้')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTickets()
    const interval = setInterval(fetchTickets, 3000)
    return () => clearInterval(interval)
  }, [])

  const playNotificationSound = () => {
    try {
      const ctx = audioCtxRef.current
      if (!ctx) return
      if (ctx.state === 'suspended') ctx.resume()

      const playBeep = (startTime: number, freq: number, duration: number) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0, startTime)
        gain.gain.linearRampToValueAtTime(0.6, startTime + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(startTime)
        osc.stop(startTime + duration)
      }

      const t = ctx.currentTime
      playBeep(t, 880, 0.15)
      playBeep(t + 0.2, 1100, 0.15)
      playBeep(t + 0.4, 880, 0.2)
    } catch {}
  }

  const handleStatus = async (ticketId: string, status: 'IN_PROGRESS' | 'DONE') => {
    try {
      await kdsService.updateTicketStatus(ticketId, status)
      if (status === 'DONE') {
        setTickets(prev => prev.filter(t => t.id !== ticketId))
        lastCount.current -= 1
      } else {
        setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, status } : t))
      }
    } catch {
      alert('ไม่สามารถอัปเดตสถานะได้')
    }
  }

  const getElapsed = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime()
    const m = Math.floor(diff / 60000)
    if (m < 1) return 'เพิ่งส่ง'
    return `${m} นาทีที่แล้ว`
  }

  const getElapsedMinutes = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 60000)

  const statusConfig = {
    PENDING: { label: 'รอรับ', bg: 'bg-yellow-500/20', border: 'border-yellow-500/50', text: 'text-yellow-400', dot: 'bg-yellow-400' },
    IN_PROGRESS: { label: 'กำลังทำ', bg: 'bg-blue-500/20', border: 'border-blue-500/50', text: 'text-blue-400', dot: 'bg-blue-400' },
    DONE: { label: 'เสร็จแล้ว', bg: 'bg-green-500/20', border: 'border-green-500/50', text: 'text-cyber-green', dot: 'bg-cyber-green' },
  }

  return (
    <div className="flex flex-col h-full bg-cyber-dark text-gray-200" onClick={unlockAudio}>
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-cyber-primary font-['Orbitron'] flex items-center gap-2">
            <MonitorPlay className="w-6 h-6" />
            Kitchen Display System
          </h1>
          <p className="text-gray-400 text-sm mt-1">Polling ทุก 3 วินาที · {tickets.length} ticket ที่รอดำเนินการ</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={unlockAudio}
            className={`px-3 py-2 rounded-lg border text-sm font-medium flex items-center gap-2 transition-colors ${
              soundEnabled
                ? 'bg-cyber-green/10 border-cyber-green/40 text-cyber-green'
                : 'bg-yellow-500/10 border-yellow-500/40 text-yellow-400 animate-pulse'
            }`}
          >
            {soundEnabled ? '🔔 เสียงเปิด' : '🔕 กดเพื่อเปิดเสียง'}
          </button>
          <div className="px-4 py-2 bg-cyber-card border border-cyber-border rounded-lg flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-cyber-green animate-pulse" />
            <span className="text-sm font-medium">Live</span>
          </div>
          <button
            onClick={fetchTickets}
            className="p-2 bg-cyber-primary/20 hover:bg-cyber-primary/40 text-cyber-primary rounded-lg transition-colors border border-cyber-primary/50"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-400" />
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {/* Tickets Grid */}
      {loading && isFirstLoad.current ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="w-12 h-12 border-4 border-cyber-primary/30 border-t-cyber-primary rounded-full animate-spin" />
        </div>
      ) : tickets.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center border-2 border-dashed border-cyber-border rounded-xl bg-cyber-card/30">
          <ClipboardList className="w-16 h-16 text-gray-500 mb-4" />
          <h3 className="text-xl font-bold text-gray-400">ไม่มี ticket ที่รอดำเนินการ</h3>
          <p className="text-gray-500 text-sm mt-1">รอ POS ส่งออร์เดอร์มาครัว...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6 overflow-y-auto cyber-scrollbar pr-2 pb-6">
          {tickets.map(ticket => {
            const cfg = statusConfig[ticket.status]
            const elapsed = getElapsedMinutes(ticket.sent_at)
            const isUrgent = elapsed >= 10 && ticket.status !== 'DONE'
            return (
              <div
                key={ticket.id}
                className={`bg-cyber-card border rounded-xl shadow-lg flex flex-col transition-all ${isUrgent ? 'border-red-500/70 shadow-red-500/10' : cfg.border}`}
              >
                {/* Ticket Header */}
                <div className={`p-4 border-b border-cyber-border ${cfg.bg} rounded-t-xl`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-white">{ticket.table_name}</h3>
                        <span className="px-2 py-0.5 bg-cyber-dark rounded text-xs text-cyber-primary font-mono">
                          รอบ {ticket.round}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 font-mono mt-0.5">{ticket.bill_number}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${cfg.text}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${ticket.status === 'PENDING' ? 'animate-pulse' : ''}`} />
                        {cfg.label}
                      </div>
                      <div className={`flex items-center gap-1 text-xs ${isUrgent ? 'text-red-400 font-bold' : 'text-gray-400'}`}>
                        <Clock className="w-3 h-3" />
                        {getElapsed(ticket.sent_at)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Items */}
                <div className="p-3 flex-1 space-y-2">
                  {ticket.items.map(item => (
                    <div key={item.id} className="flex items-start gap-3 bg-black/20 rounded-lg p-3">
                      <span className="text-cyber-green font-bold text-lg leading-none">{item.quantity}×</span>
                      <div className="flex-1">
                        <p className="font-semibold text-white">{item.product_name}</p>
                        {item.special_instructions && (
                          <p className="text-xs text-yellow-400 mt-1 bg-yellow-400/10 px-2 py-0.5 rounded inline-block border border-yellow-400/20">
                            ★ {item.special_instructions}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Action buttons */}
                <div className="p-3 border-t border-cyber-border flex gap-2">
                  {ticket.status === 'PENDING' && (
                    <button
                      onClick={() => handleStatus(ticket.id, 'IN_PROGRESS')}
                      className="flex-1 py-2 rounded-lg bg-blue-500/20 border border-blue-500/50 text-blue-400 hover:bg-blue-500/30 transition-all text-sm font-medium flex items-center justify-center gap-1"
                    >
                      <ChefHat className="w-4 h-4" />
                      รับงาน
                    </button>
                  )}
                  {ticket.status === 'IN_PROGRESS' && (
                    <button
                      onClick={() => handleStatus(ticket.id, 'DONE')}
                      className="flex-1 py-2 rounded-lg bg-cyber-green/20 border border-cyber-green/50 text-cyber-green hover:bg-cyber-green/30 transition-all text-sm font-medium flex items-center justify-center gap-1"
                    >
                      <Check className="w-4 h-4" />
                      เสร็จแล้ว
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default KDS
