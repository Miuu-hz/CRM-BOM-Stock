import React, { useState, useEffect, useRef } from 'react'
import {
  AlertCircle,
  Bell,
  BellOff,
  Check,
  ChefHat,
  ClipboardList,
  Clock,
  Maximize,
  Minimize,
  MonitorPlay,
  RefreshCw,
  Star,
  XCircle,
} from 'lucide-react'
import kdsService, { KDSTicket, KDSTicketItem } from '../services/kds.service'

// สีการ์ดตามเวลาที่ตั๋วยังทำไม่เสร็จ (นับจากเวลาส่งครัว) — ทีละ 5 นาที
const TIME_TONES = [
  { upTo: 5, label: '< 5 นาที', border: 'border-emerald-500', header: 'bg-emerald-500/15', text: 'text-emerald-600 dark:text-emerald-400', swatch: 'bg-emerald-500' },
  { upTo: 10, label: '5–10', border: 'border-yellow-400', header: 'bg-yellow-400/20', text: 'text-yellow-600 dark:text-yellow-400', swatch: 'bg-yellow-400' },
  { upTo: 15, label: '10–15', border: 'border-orange-500', header: 'bg-orange-500/20', text: 'text-orange-600 dark:text-orange-400', swatch: 'bg-orange-500' },
  { upTo: Infinity, label: '15+ นาที', border: 'border-red-500', header: 'bg-red-500/20', text: 'text-red-600 dark:text-red-400', swatch: 'bg-red-500' },
]
const timeTone = (minutes: number) => TIME_TONES.find(t => minutes < t.upTo)!

/** รายการที่ยังต้องทำจริง (ไม่นับที่ถูกยกเลิกทั้งรายการ) */
const isItemGone = (item: KDSTicketItem) => item.status === 'CANCELLED' || (item.void_qty || 0) >= item.quantity

const KDS: React.FC = () => {
  const [tickets, setTickets] = useState<KDSTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try {
      return localStorage.getItem('kds_sound_enabled') === 'true'
    } catch {
      return false
    }
  })
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(
    'Notification' in window ? Notification.permission : 'denied'
  )
  const [isFullscreen, setIsFullscreen] = useState(false)
  const isFirstLoad = useRef(true)
  const seenTicketIds = useRef<Set<string>>(new Set())
  // id → สถานะ|เวลาแก้ล่าสุด — ใช้จับว่าตั๋วเดิมถูกยกเลิก/ลดรายการ เพื่อส่งเสียงเตือนครัว
  const seenVersions = useRef<Map<string, string>>(new Map())
  const audioRef = useRef<HTMLAudioElement | null>(null)
  // ติ๊กรายเมนูที่ยังรอ server ตอบ — ทับผล polling ไว้ก่อน ไม่งั้นติ๊กแล้วเด้งกลับชั่วครู่
  const pendingItemDone = useRef<Map<string, 'DONE' | 'PENDING'>>(new Map())
  const applyPendingItems = (list: KDSTicket[]) => pendingItemDone.current.size === 0 ? list : list.map(t => ({
    ...t,
    items: t.items.map(i => pendingItemDone.current.has(i.id) ? { ...i, status: pendingItemDone.current.get(i.id)! } : i),
  }))

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {})
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {})
    }
  }

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  // Auto-init audio if previously enabled
  useEffect(() => {
    if (soundEnabled && !audioRef.current) {
      try {
        const audio = new Audio('/sounds/order-voice.m4a')
        audio.volume = 1.0
        audio.load()
        audioRef.current = audio
      } catch {}
    }
  }, [soundEnabled])

  const unlockAudio = async () => {
    try {
      const audio = new Audio('/sounds/order-voice.m4a')
      audio.volume = 1.0
      await audio.load()
      audioRef.current = audio
      setSoundEnabled(true)
      localStorage.setItem('kds_sound_enabled', 'true')
    } catch {}
    const perm = await kdsService.requestNotificationPermission()
    setNotifPermission(perm)
  }

  const fetchTickets = async () => {
    try {
      const data = await kdsService.getTickets()
      setTickets(applyPendingItems(data))

      const currentIds = new Set(data.map(t => t.id))
      if (!isFirstLoad.current) {
        const newTickets = data.filter(t => !seenTicketIds.current.has(t.id))
        if (newTickets.length > 0) {
          playNotificationSound()
          kdsService.notifyNewTickets(newTickets.length)
        }
        // ตั๋วเดิมที่เพิ่งถูกยกเลิกทั้งบิล หรือมีรายการถูกลด/ลบ → เตือนอีกรอบ
        const changed = data.some(t => {
          const prev = seenVersions.current.get(t.id)
          return prev !== undefined && prev !== `${t.status}|${t.updated_at}`
        })
        if (changed) playNotificationSound()
      }
      seenTicketIds.current = currentIds
      seenVersions.current = new Map(data.map(t => [t.id, `${t.status}|${t.updated_at}`]))
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
      const audio = audioRef.current
      if (!audio) return
      audio.currentTime = 0
      audio.play()
    } catch {}
  }

  const stopNotificationSound = () => {
    const audio = audioRef.current
    if (!audio) return
    audio.pause()
    audio.currentTime = 0
  }

  const handleUserTap = () => {
    stopNotificationSound()
    unlockAudio()
  }

  const handleStatus = async (ticketId: string, status: 'IN_PROGRESS' | 'DONE' | 'CANCEL_ACK') => {
    stopNotificationSound()
    try {
      await kdsService.updateTicketStatus(ticketId, status)
      if (status === 'DONE' || status === 'CANCEL_ACK') {
        setTickets(prev => prev.filter(t => t.id !== ticketId))
        // ponytail: fetchTickets is the only writer of lastCount. Decrementing here
        // double-counts when a poll lands during the await above.
      } else {
        setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, status } : t))
      }
    } catch {
      alert('ไม่สามารถอัปเดตสถานะได้')
    }
  }

  // ติ๊ก/เอาติ๊กออกรายเมนู — สลับได้เสมอ รายการไม่หาย (กันกดพลาด)
  const toggleItemDone = async (ticketId: string, item: KDSTicketItem) => {
    stopNotificationSound()
    const next: 'DONE' | 'PENDING' = item.status === 'DONE' ? 'PENDING' : 'DONE'
    const setItemStatus = (status: KDSTicketItem['status']) => setTickets(prev => prev.map(t => t.id !== ticketId ? t : {
      ...t, items: t.items.map(i => i.id === item.id ? { ...i, status } : i),
    }))
    pendingItemDone.current.set(item.id, next)
    setItemStatus(next)
    try {
      await kdsService.setItemDone(ticketId, item.id, next === 'DONE')
    } catch (e: any) {
      setItemStatus(item.status)
      alert(e?.response?.data?.message || 'ไม่สามารถอัปเดตรายการได้')
    } finally {
      pendingItemDone.current.delete(item.id)
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
    PENDING: { label: 'รอรับ', bg: 'bg-[var(--warning-soft)]', border: 'border-warning/50', text: 'text-warning', dot: 'bg-warning' },
    IN_PROGRESS: { label: 'กำลังทำ', bg: 'bg-[var(--info-soft)]', border: 'border-[var(--primary)]/50', text: 'text-[var(--primary)]', dot: 'bg-[var(--primary)]' },
    DONE: { label: 'เสร็จแล้ว', bg: 'bg-[var(--success-soft)]', border: 'border-success/50', text: 'text-success', dot: 'bg-success' },
    CANCELLED: { label: 'ยกเลิกทั้งบิล', bg: 'bg-[var(--danger-soft)]', border: 'border-danger', text: 'text-danger', dot: 'bg-danger' },
  }

  return (
    <div className="flex flex-col h-full bg-[var(--bg)] text-[var(--fg-2)]" onClick={handleUserTap}>
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--primary)] flex items-center gap-2">
            <MonitorPlay className="w-6 h-6" />
            Kitchen Display System
          </h1>
          <p className="text-[var(--fg-3)] text-sm mt-1">Polling ทุก 3 วินาที · {tickets.length} ticket ที่รอดำเนินการ</p>
          <div className="flex items-center gap-3 mt-1.5 text-xs text-[var(--fg-3)]" aria-label="สีการ์ดตามเวลาที่รอ">
            {TIME_TONES.map(t => (
              <span key={t.label} className="flex items-center gap-1">
                <span className={`w-2.5 h-2.5 rounded-sm ${t.swatch}`} /> {t.label}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={unlockAudio}
            className={`px-3 py-2 rounded-lg border text-sm font-medium flex items-center gap-2 transition-colors ${
              soundEnabled && notifPermission === 'granted'
                ? 'bg-success/10 border-success/40 text-success'
                : 'bg-[var(--warning-soft)] border-yellow-500/40 text-warning animate-pulse'
            }`}
          >
            {soundEnabled && notifPermission === 'granted'
              ? <><Bell className="w-4 h-4" /> เสียง + แจ้งเตือนเปิด</>
              : soundEnabled
              ? <><Bell className="w-4 h-4" /> เสียงเปิด · กดขออนุญาตแจ้งเตือน</>
              : <><BellOff className="w-4 h-4" /> กดเพื่อเปิดเสียง + แจ้งเตือน</>}
          </button>
          <div className="px-4 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-lg flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
            <span className="text-sm font-medium">Live</span>
          </div>
          <button
            onClick={fetchTickets}
            className="p-2 bg-[var(--primary-soft)] hover:bg-phopy-indigo/40 text-[var(--primary)] rounded-lg transition-colors border border-phopy-indigo/50"
            title="รีเฟรช"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={toggleFullscreen}
            className="p-2 bg-[var(--surface)] hover:bg-[var(--surface-2)] text-[var(--fg-3)] hover:text-[var(--fg-1)] rounded-lg transition-colors border border-[var(--border)]"
            title={isFullscreen ? 'ออกจากโหมดเต็มจอ' : 'เต็มจอ (เหมาะสำหรับครัว)'}
          >
            {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-[var(--danger-soft)] border border-danger/30 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-danger" />
          <p className="text-danger">{error}</p>
        </div>
      )}

      {/* Tickets Grid */}
      {loading && isFirstLoad.current ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="w-12 h-12 border-4 border-phopy-indigo/30 border-t-phopy-indigo rounded-full animate-spin" />
        </div>
      ) : tickets.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center border-2 border-dashed border-[var(--border)] rounded-xl bg-[var(--surface-2)]">
          <ClipboardList className="w-16 h-16 text-[var(--fg-4)] mb-4" />
          <h3 className="text-xl font-bold text-[var(--fg-3)]">ไม่มี ticket ที่รอดำเนินการ</h3>
          <p className="text-[var(--fg-4)] text-sm mt-1">รอ POS ส่งออร์เดอร์มาครัว...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6 overflow-y-auto phopy-scrollbar pr-2 pb-6">
          {tickets.map(ticket => {
            const cfg = statusConfig[ticket.status]
            const elapsed = getElapsedMinutes(ticket.sent_at)
            const isCancelled = ticket.status === 'CANCELLED'
            const canTick = ticket.status === 'IN_PROGRESS'
            const activeItems = ticket.items.filter(i => !isItemGone(i))
            const doneCount = activeItems.filter(i => i.status === 'DONE').length
            const allDone = activeItems.length > 0 && doneCount === activeItems.length
            // ทำครบทุกเมนูแล้ว = เขียวตลอด (รอแค่กดเสร็จ) · ยังไม่ครบ = สีตามเวลาที่รอ
            const tone = allDone ? TIME_TONES[0] : timeTone(elapsed)
            return (
              <div
                key={ticket.id}
                className={`bg-[var(--surface)] border-2 rounded-xl shadow-lg flex flex-col transition-colors ${isCancelled ? 'border-danger ring-4 ring-danger/20' : tone.border}`}
                aria-label={isCancelled ? `บิล ${ticket.bill_number} ถูกยกเลิก หยุดทำ` : undefined}
              >
                {/* Ticket Header */}
                <div className={`p-4 border-b border-[var(--border)] ${isCancelled ? cfg.bg : tone.header} rounded-t-xl`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-[var(--fg-1)]">{ticket.table_name}</h3>
                        <span className="px-2 py-0.5 bg-[var(--bg)] rounded text-xs text-[var(--primary)] font-mono">
                          รอบ {ticket.round}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--fg-3)] font-mono mt-0.5">{ticket.bill_number}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${cfg.text}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${ticket.status === 'PENDING' ? 'animate-pulse' : ''}`} />
                        {cfg.label}
                      </div>
                      <div className={`flex items-center gap-1 text-xs font-semibold ${isCancelled ? 'text-[var(--fg-3)]' : tone.text}`}>
                        <Clock className="w-3 h-3" />
                        {getElapsed(ticket.sent_at)}
                      </div>
                      {canTick && activeItems.length > 0 && (
                        <div className={`text-xs font-bold ${allDone ? 'text-success' : 'text-[var(--fg-2)]'}`}>
                          เสร็จ {doneCount}/{activeItems.length}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {isCancelled && (
                  <div className="mx-3 mt-3 p-3 rounded-lg bg-danger text-white font-bold flex items-center gap-2" role="alert">
                    <XCircle className="w-5 h-5 shrink-0" /> บิลนี้ถูกยกเลิก — หยุดทำทุกรายการ
                  </div>
                )}

                {/* Items */}
                <div className="p-3 flex-1 space-y-2">
                  {canTick && (
                    <p className="text-[11px] text-[var(--fg-4)] px-1">แตะเมนูเพื่อติ๊กว่าทำเสร็จ · แตะซ้ำเพื่อเอาติ๊กออก</p>
                  )}
                  {ticket.items.map(item => {
                    const voided = item.void_qty || 0
                    const gone = isCancelled || isItemGone(item)
                    const itemDone = !gone && item.status === 'DONE'
                    const tickable = canTick && !gone
                    return (
                    <div
                      key={item.id}
                      role={tickable ? 'checkbox' : undefined}
                      aria-checked={tickable ? itemDone : undefined}
                      tabIndex={tickable ? 0 : undefined}
                      onClick={tickable ? (e) => { e.stopPropagation(); toggleItemDone(ticket.id, item) } : undefined}
                      onKeyDown={tickable ? (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleItemDone(ticket.id, item) } } : undefined}
                      className={`flex items-start gap-3 rounded-lg p-3 border-2 transition-colors ${
                        gone ? 'bg-[var(--danger-soft)] border-transparent'
                        : itemDone ? 'bg-[var(--success-soft)] border-success/60'
                        : voided ? 'bg-[var(--warning-soft)] border-transparent'
                        : 'bg-[var(--surface-2)] border-transparent'
                      } ${tickable ? 'cursor-pointer select-none hover:border-success/40' : ''}`}
                    >
                      {tickable && (
                        <span className={`mt-0.5 w-6 h-6 shrink-0 rounded-md border-2 flex items-center justify-center ${itemDone ? 'bg-success border-success text-white' : 'border-[var(--fg-4)]'}`}>
                          {itemDone && <Check className="w-4 h-4" />}
                        </span>
                      )}
                      {voided > 0 && !gone ? (
                        <span className="font-bold text-lg leading-none whitespace-nowrap" aria-label={`จาก ${item.quantity} เหลือ ${item.quantity - voided}`}>
                          <s className="text-[var(--fg-4)]">{item.quantity}</s> <span className="text-warning">→ {item.quantity - voided}×</span>
                        </span>
                      ) : (
                        <span className={`font-bold text-lg leading-none ${gone ? 'text-danger line-through' : 'text-success'}`}>{item.quantity}×</span>
                      )}
                      <div className="flex-1">
                        <p className={`font-semibold ${gone ? 'text-danger line-through' : itemDone ? 'text-success' : 'text-[var(--fg-1)]'}`}>
                          {item.product_name}
                          {itemDone && <span className="ml-2 text-xs font-bold">✓ เสร็จแล้ว</span>}
                        </p>
                        {(gone || voided > 0) && !isCancelled && (
                          <p className={`text-xs font-bold mt-1 ${gone ? 'text-danger' : 'text-warning'}`}>
                            {gone ? '❌ ยกเลิกรายการนี้' : `⚠️ ลดลง ${voided}`}{item.void_reason ? ` · ${item.void_reason}` : ''}
                          </p>
                        )}
                        {item.special_instructions && (
                          <p className="text-xs text-warning mt-1 bg-[var(--warning-soft)] px-2 py-0.5 rounded inline-block border border-yellow-400/20">
                            <Star className="w-3 h-3 inline" /> {item.special_instructions}
                          </p>
                        )}
                      </div>
                    </div>
                    )
                  })}
                </div>

                {/* Action buttons */}
                <div className="p-3 border-t border-[var(--border)] flex gap-2">
                  {isCancelled && (
                    <button
                      onClick={() => handleStatus(ticket.id, 'CANCEL_ACK')}
                      className="flex-1 py-2.5 rounded-lg bg-danger text-white hover:bg-danger/90 transition-all text-sm font-bold flex items-center justify-center gap-1"
                    >
                      <Check className="w-4 h-4" />
                      รับทราบ (เอาการ์ดออก)
                    </button>
                  )}
                  {ticket.status === 'PENDING' && (
                    <button
                      onClick={() => handleStatus(ticket.id, 'IN_PROGRESS')}
                      className="flex-1 py-2 rounded-lg bg-[var(--info-soft)] border border-[var(--primary)]/50 text-[var(--primary)] hover:bg-[var(--primary-soft)] transition-all text-sm font-medium flex items-center justify-center gap-1"
                    >
                      <ChefHat className="w-4 h-4" />
                      รับงาน
                    </button>
                  )}
                  {ticket.status === 'IN_PROGRESS' && (
                    <button
                      onClick={() => handleStatus(ticket.id, 'DONE')}
                      className="flex-1 py-2 rounded-lg bg-[var(--success-soft)] border border-success/50 text-success hover:bg-success/30 transition-all text-sm font-medium flex items-center justify-center gap-1"
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
