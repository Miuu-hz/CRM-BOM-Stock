import { useState } from 'react'
import toast from 'react-hot-toast'
import { ArrowRight, ArrowRightLeft, GitMerge, X } from 'lucide-react'
import api from '../../services/api'
import { useModalClose } from '../../hooks/useModalClose'
import type { PosTable } from './TableBoard'

type Props = {
  sourceTable: PosTable
  tables: PosTable[]
  onClose: () => void
  onSuccess: () => void
}

export default function MoveTableDialog({ sourceTable, tables, onClose, onSuccess }: Props) {
  useModalClose(onClose)
  const [confirming, setConfirming] = useState<{ type: 'move' | 'merge'; target: PosTable } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const otherTables = tables.filter(t => t.id !== sourceTable.id)
  const freeTables = otherTables.filter(t => !t.bill_id)
  const occupiedTables = otherTables.filter(t => !!t.bill_id)

  const handleConfirm = async () => {
    if (!confirming || !sourceTable.bill_id) return
    setSubmitting(true)
    try {
      if (confirming.type === 'move') {
        const res = await api.post(`/pos/bills/${sourceTable.bill_id}/move`, {
          table_id: confirming.target.id,
        })
        toast.success(res.data?.message || 'ย้ายโต๊ะสำเร็จ')
      } else {
        const res = await api.post(`/pos/bills/${sourceTable.bill_id}/merge`, {
          target_bill_id: confirming.target.bill_id,
        })
        toast.success(res.data?.message || 'รวมโต๊ะสำเร็จ')
      }
      onSuccess()
      onClose()
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'ทำรายการไม่สำเร็จ'
      toast.error(msg)
      setConfirming(null)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-[var(--fg-1)]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-table-dialog-title"
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] flex flex-col bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-xl overflow-hidden"
      >
        {/* Header */}
        <div className="p-5 border-b border-[var(--border)] flex items-center justify-between">
          <div>
            <h2 id="move-table-dialog-title" className="text-lg font-bold text-[var(--fg-1)] flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5 text-[var(--primary)]" />
              ย้าย / รวมโต๊ะ
            </h2>
            <p className="text-xs text-[var(--fg-3)] mt-1">
              โต๊ะต้นทาง:{' '}
              <span className="font-semibold text-[var(--fg-1)]">{sourceTable.name}</span>
              {sourceTable.bill_number && ` (บิล ${sourceTable.bill_number})`} · ฿
              {(sourceTable.total_amount || 0).toLocaleString()}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="ปิด"
            className="p-2 rounded-lg text-[var(--fg-3)] hover:bg-[var(--surface-2)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-5">
          {confirming ? (
            /* One-step confirmation inside the dialog */
            <div className="space-y-4 py-2">
              <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] space-y-2.5">
                <div className="flex items-center gap-2 text-[var(--fg-1)] font-semibold text-base">
                  {confirming.type === 'move' ? (
                    <>
                      <ArrowRight className="w-5 h-5 text-[var(--primary)]" />
                      ยืนยันการย้ายโต๊ะ
                    </>
                  ) : (
                    <>
                      <GitMerge className="w-5 h-5 text-[var(--primary)]" />
                      ยืนยันการรวมโต๊ะ
                    </>
                  )}
                </div>

                {confirming.type === 'move' ? (
                  <p className="text-sm text-[var(--fg-2)] leading-relaxed">
                    ย้ายบิลจากโต๊ะ <span className="font-bold text-[var(--fg-1)]">{sourceTable.name}</span> ไปยังโต๊ะ{' '}
                    <span className="font-bold text-[var(--primary)]">{confirming.target.name}</span>
                    <br />
                    <span className="text-xs text-[var(--fg-4)] mt-1 inline-block">
                      • ตั๋วครัวที่กำลังทำอยู่จะเปลี่ยนชื่อโต๊ะให้อัตโนมัติ
                      <br />• ลูกค้าที่สแกน QR โต๊ะเดิมอยู่สามารถสั่งต่อได้ทันที
                    </span>
                  </p>
                ) : (
                  <p className="text-sm text-[var(--fg-2)] leading-relaxed">
                    รวมบิลจากโต๊ะ <span className="font-bold text-[var(--fg-1)]">{sourceTable.name}</span> เข้ากับโต๊ะ{' '}
                    <span className="font-bold text-[var(--primary)]">{confirming.target.name}</span>
                    {confirming.target.bill_number && ` (${confirming.target.bill_number})`}
                    <br />
                    <span className="text-xs text-[var(--fg-4)] mt-1 inline-block">
                      • รายการอาหารและตั๋วครัวทั้งหมดจะย้ายเข้าโต๊ะ {confirming.target.name}
                      <br />• บิลเดิมจะถูกยกเลิกและปลดโต๊ะ {sourceTable.name} ให้ว่าง
                    </span>
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirming(null)}
                  disabled={submitting}
                  className="px-4 py-2 rounded-xl text-sm font-medium border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors disabled:opacity-50"
                >
                  กลับ
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={submitting}
                  className="px-4 py-2 rounded-xl text-sm font-semibold bg-[var(--primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {submitting
                    ? 'กำลังดำเนินการ…'
                    : confirming.type === 'move'
                    ? 'ยืนยันย้ายโต๊ะ'
                    : 'ยืนยันรวมโต๊ะ'}
                </button>
              </div>
            </div>
          ) : otherTables.length === 0 ? (
            <div className="text-center py-8 text-[var(--fg-4)]">
              <p className="text-sm">ไม่มีโต๊ะอื่นในระบบให้ย้ายหรือรวม</p>
            </div>
          ) : (
            <div className="space-y-5">
              {/* โต๊ะว่าง -> ย้ายไปโต๊ะนี้ */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-3)] mb-2.5">
                  โต๊ะว่าง — ย้ายไปโต๊ะนี้ ({freeTables.length})
                </p>
                {freeTables.length === 0 ? (
                  <p className="text-xs text-[var(--fg-4)] italic py-1">ไม่มีโต๊ะว่าง</p>
                ) : (
                  <div className="space-y-2">
                    {freeTables.map(t => (
                      <div
                        key={t.id}
                        className="flex items-center justify-between p-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] hover:border-phopy-indigo/40 transition-colors"
                      >
                        <div>
                          <p className="font-bold text-sm text-[var(--fg-1)]">{t.name}</p>
                          <p className="text-xs text-[var(--fg-4)]">โต๊ะว่าง</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setConfirming({ type: 'move', target: t })}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-2)] hover:border-phopy-indigo hover:text-[var(--primary)] transition-all"
                        >
                          ย้ายไปโต๊ะนี้
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* โต๊ะที่เปิดอยู่ -> รวมเข้าโต๊ะนี้ */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-3)] mb-2.5">
                  โต๊ะที่เปิดบิลอยู่ — รวมเข้าโต๊ะนี้ ({occupiedTables.length})
                </p>
                {occupiedTables.length === 0 ? (
                  <p className="text-xs text-[var(--fg-4)] italic py-1">ไม่มีโต๊ะอื่นที่เปิดบิลอยู่</p>
                ) : (
                  <div className="space-y-2">
                    {occupiedTables.map(t => (
                      <div
                        key={t.id}
                        className="flex items-center justify-between p-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] hover:border-phopy-indigo/40 transition-colors"
                      >
                        <div>
                          <p className="font-bold text-sm text-[var(--fg-1)]">{t.name}</p>
                          <p className="text-xs text-[var(--primary)] font-medium">
                            บิล {t.bill_number || '-'} · ฿{(t.total_amount || 0).toLocaleString()}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setConfirming({ type: 'merge', target: t })}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--primary-soft)] text-[var(--primary)] border border-phopy-indigo/40 hover:bg-phopy-indigo hover:text-white transition-all"
                        >
                          รวมเข้าโต๊ะนี้
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
