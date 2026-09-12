import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ShieldCheck, Clock, X } from 'lucide-react'

/**
 * Popup กลางของระบบอนุมัติ — ใช้ซ้ำทุกหน้าที่มีปุ่มติดด่าน
 *
 * 202 pending_approval → "ส่งคำขอให้แล้ว รอผู้อนุมัติ" (ปรับสต็อก / ยกเลิกบิล POS / แก้เอกสาร)
 *
 * โหมด "locked/needs_approval" (403 + ปุ่มขอสิทธิ์ปลดล็อก) ถูกถอดออกแล้ว —
 * flow ใหม่คือ "แก้ไข บันทึก กลายเป็นร่างรออนุมัติ" ไม่มีการบล็อกแก้ไขอีกต่อไป
 * และ endpoint /approval/request-unlock ถูกลบไปแล้วที่ backend
 *
 * ผู้ใช้ต้องไม่เห็นรหัสสถานะหรือข้อความ error ดิบ — หน้าเว็บอ่านธงจาก body เท่านั้น
 */

type Mode = { kind: 'sent'; message: string; requestNumber?: string }

export function useApprovalGate() {
  const [mode, setMode] = useState<Mode | null>(null)

  /** ใช้กับ response ปกติ — คืน true ถ้าคำขอถูกส่งเข้าคิวอนุมัติแทนการทำงานจริง */
  const handleResponse = useCallback((data: any): boolean => {
    if (!data?.pending_approval) return false
    setMode({
      kind: 'sent',
      message: data.message || 'ส่งคำขออนุมัติแล้ว กรุณารอผู้อนุมัติ',
      requestNumber: data.request_number,
    })
    return true
  }, [])

  /** ด่าน "locked" ถูกถอดออกแล้ว — เก็บ handleError ไว้เฉยๆ ให้ผู้เรียกเดิมยัง compile ผ่าน */
  const handleError = useCallback((_err: any): boolean => false, [])

  const close = () => setMode(null)

  const modal = (
    <AnimatePresence>
      {mode && (
        <motion.div
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={e => e.target === e.currentTarget && close()}
        >
          <motion.div
            className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-2xl"
            initial={{ scale: 0.95, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full flex items-center justify-center bg-[var(--primary-soft)]">
                  <ShieldCheck className="w-4 h-4 text-[var(--primary)]" />
                </div>
                <h3 className="font-semibold text-[var(--fg-1)]">ส่งคำขออนุมัติแล้ว</h3>
              </div>
              <button onClick={close} className="text-[var(--fg-3)] hover:text-[var(--fg-1)] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm text-[var(--fg-2)] leading-relaxed">{mode.message}</p>

              {mode.requestNumber && (
                <div className="bg-[var(--surface-2)] rounded-lg p-3">
                  <p className="text-[var(--fg-3)] text-xs mb-0.5">เลขที่คำขอ</p>
                  <p className="font-semibold text-[var(--fg-1)]">{mode.requestNumber}</p>
                </div>
              )}

              <p className="flex items-center gap-1.5 text-xs text-[var(--fg-3)]">
                <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                ติดตามสถานะได้ที่เมนู “การอนุมัติ” แท็บ “คำขอของฉัน”
              </p>
            </div>

            <div className="flex justify-end gap-2 px-6 py-4 border-t border-[var(--border)]">
              <button onClick={close} className="px-4 py-2 text-sm rounded-lg text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors">
                ปิด
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )

  return { modal, handleResponse, handleError }
}
