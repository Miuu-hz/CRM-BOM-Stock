import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bot, X, Send, RefreshCw, Minimize2, Paperclip, ImageOff } from 'lucide-react'
import { kimiChat } from '../../services/llm'

interface Message {
  role: 'user' | 'assistant'
  content: string
  image?: string  // data URL for preview
}

export default function FloatingChat() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [pendingImage, setPendingImage] = useState<{ dataUrl: string; ext: string } | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150)
  }, [open])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const reader = new FileReader()
    reader.onload = ev => {
      setPendingImage({ dataUrl: ev.target?.result as string, ext })
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const send = async () => {
    const msg = input.trim()
    if ((!msg && !pendingImage) || loading) return

    const imageSnapshot = pendingImage
    setInput('')
    setPendingImage(null)
    setMessages(prev => [...prev, {
      role: 'user',
      content: msg || '(รูปภาพ)',
      image: imageSnapshot?.dataUrl,
    }])
    setLoading(true)

    try {
      const res = await kimiChat(msg, imageSnapshot?.dataUrl, imageSnapshot?.ext)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: res.success ? res.reply : (res.message ?? 'เกิดข้อผิดพลาด'),
      }])
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? 'ระบบ AI ไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่'
      setMessages(prev => [...prev, { role: 'assistant', content: msg }])
    } finally {
      setLoading(false)
    }
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <>
      {/* Chat Panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            className="fixed bottom-20 right-6 z-50 w-80 flex flex-col phopy-card overflow-hidden shadow-2xl"
            style={{ height: '420px' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)] shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-phopy-indigo/20 flex items-center justify-center">
                  <Bot className="w-4 h-4 text-[var(--primary)]" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[var(--fg-1)]">Kimi AI</p>
                  <p className="text-[10px] text-[var(--fg-4)]">ผู้ช่วย ERP</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button
                    onClick={() => setMessages([])}
                    className="p-1.5 text-[var(--fg-4)] hover:text-[var(--fg-2)] hover:bg-[var(--bg)] rounded-lg transition-colors"
                    title="ล้างประวัติ"
                  >
                    <Minimize2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="p-1.5 text-[var(--fg-4)] hover:text-[var(--fg-2)] hover:bg-[var(--bg)] rounded-lg transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto phopy-scrollbar px-3 py-3 space-y-3">
              {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center gap-2 px-4">
                  <Bot className="w-10 h-10 text-[var(--fg-4)]" />
                  <p className="text-sm text-[var(--fg-3)]">สวัสดีครับ มีอะไรให้ช่วยไหม?</p>
                  <div className="flex flex-col gap-1.5 w-full mt-1">
                    {['หมูสับในสต็อกมีเท่าไหร่', 'ยอดขายวันนี้เป็นยังไง', 'PO ที่ค้างอยู่มีอะไรบ้าง'].map(q => (
                      <button
                        key={q}
                        onClick={() => { setInput(q); inputRef.current?.focus() }}
                        className="text-xs text-left px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--fg-3)] hover:text-[var(--primary)] hover:border-phopy-indigo/40 transition-colors"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {m.role === 'assistant' && (
                    <div className="w-6 h-6 rounded-full bg-phopy-indigo/20 flex items-center justify-center shrink-0 mr-2 mt-0.5">
                      <Bot className="w-3.5 h-3.5 text-[var(--primary)]" />
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
                      m.role === 'user'
                        ? 'bg-phopy-indigo text-white rounded-br-sm'
                        : 'bg-[var(--surface-2)] text-[var(--fg-2)] rounded-bl-sm border border-[var(--border)]'
                    }`}
                  >
                    {m.image && (
                      <img
                        src={m.image}
                        alt="แนบรูป"
                        className="rounded-lg mb-2 max-h-32 object-contain w-full"
                      />
                    )}
                    {m.content}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="w-6 h-6 rounded-full bg-phopy-indigo/20 flex items-center justify-center shrink-0 mr-2 mt-0.5">
                    <Bot className="w-3.5 h-3.5 text-[var(--primary)]" />
                  </div>
                  <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl rounded-bl-sm px-3 py-2">
                    <div className="flex gap-1 items-center h-5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--fg-4)] animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--fg-4)] animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--fg-4)] animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Image preview */}
            {pendingImage && (
              <div className="px-3 pt-2 shrink-0">
                <div className="relative inline-block">
                  <img
                    src={pendingImage.dataUrl}
                    alt="preview"
                    className="h-16 w-auto rounded-lg border border-[var(--border)] object-cover"
                  />
                  <button
                    onClick={() => setPendingImage(null)}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[var(--fg-3)] text-[var(--bg)] flex items-center justify-center"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Input */}
            <div className="px-3 py-3 border-t border-[var(--border)] bg-[var(--surface-2)] shrink-0">
              <div className="flex gap-2 items-end">
                {/* Image attach button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2 text-[var(--fg-4)] hover:text-[var(--primary)] hover:bg-[var(--bg)] rounded-xl transition-colors shrink-0"
                  title="แนบรูปภาพ"
                >
                  {pendingImage ? <ImageOff className="w-4 h-4 text-phopy-indigo" /> : <Paperclip className="w-4 h-4" />}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageSelect}
                />
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder="พิมพ์ข้อความ... (Enter ส่ง)"
                  className="phopy-input flex-1 resize-none text-sm"
                  rows={1}
                  style={{ maxHeight: '80px' }}
                  onInput={e => {
                    const el = e.target as HTMLTextAreaElement
                    el.style.height = 'auto'
                    el.style.height = Math.min(el.scrollHeight, 80) + 'px'
                  }}
                />
                <button
                  onClick={send}
                  disabled={loading || (!input.trim() && !pendingImage)}
                  className="p-2 rounded-xl bg-phopy-indigo text-white hover:bg-phopy-indigo/80 disabled:opacity-40 transition-colors shrink-0"
                >
                  {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Button */}
      <motion.button
        onClick={() => setOpen(o => !o)}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.95 }}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-2xl bg-phopy-indigo shadow-lg shadow-phopy-indigo/30 flex items-center justify-center text-white transition-colors hover:bg-phopy-indigo/90"
        title="Kimi AI Assistant"
      >
        <AnimatePresence mode="wait">
          {open
            ? <motion.div key="x" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.15 }}>
                <X className="w-5 h-5" />
              </motion.div>
            : <motion.div key="bot" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.15 }}>
                <Bot className="w-5 h-5" />
              </motion.div>
          }
        </AnimatePresence>
      </motion.button>
    </>
  )
}
