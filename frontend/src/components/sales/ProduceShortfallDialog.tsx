import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { X, AlertTriangle, CheckCircle, Package, Layers } from 'lucide-react'
import toast from 'react-hot-toast'
import salesService, {
  type ProductionPlan,
} from '../../services/sales.service'
import { useModalClose } from '../../hooks/useModalClose'

export interface ProduceShortfallDialogProps {
  salesOrderId: string
  soNumber?: string
  onClose: () => void
  onSuccess?: (workOrders: any[]) => void | Promise<void>
  initialPlan?: ProductionPlan | null
}

export function ProduceShortfallDialog({
  salesOrderId,
  soNumber,
  onClose,
  onSuccess,
  initialPlan = null,
}: ProduceShortfallDialogProps) {
  useModalClose(onClose)

  const [plan, setPlan] = useState<ProductionPlan | null>(initialPlan)
  const [loading, setLoading] = useState<boolean>(!initialPlan)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<boolean>(false)

  const loadPlan = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await salesService.getProductionPlan(salesOrderId)
      setPlan(data)
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'ไม่สามารถโหลดแผนการสั่งผลิตได้'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!initialPlan && salesOrderId) {
      loadPlan()
    }
  }, [salesOrderId, initialPlan])

  const handleProduceAndConfirm = async () => {
    if (!plan?.ok || submitting) return
    setSubmitting(true)
    try {
      // 1. สั่งผลิตสินค้าส่วนที่ขาด
      const produceRes = await salesService.produceShortfall(salesOrderId)
      const workOrders: Array<{ id: string; wo_number: string; product_name?: string; quantity?: number; status?: string }> =
        produceRes?.workOrders || (produceRes as any)?.data?.workOrders || []
      const woNumbers = workOrders.map(w => w.wo_number).filter(Boolean)

      // 2. ส่งคำขอยืนยันใบขายซ้ำตามเดิม
      const confirmRes = await salesService.updateSOStatus(salesOrderId, 'CONFIRMED')

      // 3. แสดง toast แจ้งผลพร้อมหมายเลขใบสั่งผลิต
      const woList = woNumbers.length > 0 ? ` (${woNumbers.join(', ')})` : ''
      if (confirmRes?.pending_approval) {
        toast.success(`สั่งผลิตสำเร็จ${woList} · ${confirmRes.message || 'ส่งคำขออนุมัติแล้ว กรุณารอ Approver ยืนยัน'}`)
      } else {
        toast.success(`สั่งผลิตสำเร็จ${woList} และยืนยันใบขายเรียบร้อย`)
      }

      // 4. รีเฟรชรายการ/รายละเอียด และปิดหน้าต่าง
      await onSuccess?.(workOrders)
      onClose()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'เกิดข้อผิดพลาดในการสั่งผลิตและยืนยันใบขาย')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-4xl flex flex-col"
        style={{ maxHeight: 'calc(100vh - 2rem)' }}
      >
        {/* Header */}
        <div className="p-5 border-b border-[var(--border)] flex items-start justify-between gap-3 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <Package className="w-5 h-5 text-[var(--primary)]" />
              <h2 className="text-lg font-bold text-[var(--fg-1)]">
                สั่งผลิตสินค้าตามคำสั่งขาย (Make-to-Order)
              </h2>
            </div>
            {soNumber && (
              <p className="text-xs text-[var(--fg-4)] font-mono mt-1">
                ใบสั่งขาย: {soNumber}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิด"
            className="p-1.5 hover:bg-[var(--surface-2)] rounded-lg text-[var(--fg-3)] shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-phopy-indigo mx-auto" />
              <p className="text-xs text-[var(--fg-4)] mt-3">กำลังตรวจสอบสต็อกและสูตรการผลิต (BOM)...</p>
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <AlertTriangle className="w-8 h-8 text-danger mx-auto mb-2" />
              <p className="text-sm text-danger font-medium">{error}</p>
              <button
                type="button"
                onClick={loadPlan}
                className="mt-3 px-3 py-1.5 text-xs bg-[var(--surface-2)] text-[var(--fg-2)] rounded-lg hover:bg-[var(--border)]"
              >
                ลองใหม่อีกครั้ง
              </button>
            </div>
          ) : plan ? (
            <>
              {/* Blockers listed at top in warning box */}
              {plan.blockers && plan.blockers.length > 0 && (
                <div className="bg-[var(--warning-soft)] text-[var(--warning-strong)] border border-warning/30 rounded-xl p-4">
                  <div className="flex items-center gap-2 font-semibold text-sm mb-1.5">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>ไม่สามารถสั่งผลิตอัตโนมัติได้</span>
                  </div>
                  <ul className="list-disc list-inside text-xs space-y-1">
                    {plan.blockers.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Table 1: สินค้าที่ต้องผลิต */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Package className="w-4 h-4 text-[var(--primary)]" />
                  <h3 className="text-sm font-semibold text-[var(--fg-1)]">
                    สินค้าที่ต้องผลิต
                  </h3>
                </div>
                <div className="border border-[var(--border)] rounded-xl overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] text-xs text-[var(--fg-3)]">
                        <th className="text-left px-3 py-2 font-medium">ชื่อสินค้า</th>
                        <th className="text-right px-3 py-2 font-medium">สั่ง</th>
                        <th className="text-right px-3 py-2 font-medium">มีในสต็อก</th>
                        <th className="text-right px-3 py-2 font-medium">ต้องผลิต</th>
                        <th className="text-center px-3 py-2 font-medium">หน่วย</th>
                        <th className="text-left px-3 py-2 font-medium">ปัญหา / หมายเหตุ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]/50">
                      {plan.items.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="text-center py-4 text-xs text-[var(--fg-4)]">
                            ไม่มีสินค้าที่ต้องผลิต
                          </td>
                        </tr>
                      ) : (
                        plan.items.map((item, idx) => (
                          <tr key={item.soItemId || idx} className="hover:bg-[var(--surface-2)]/50">
                            <td className="px-3 py-2 font-medium text-[var(--fg-1)]">{item.name}</td>
                            <td className="px-3 py-2 text-right text-[var(--fg-2)]">{item.orderedQty}</td>
                            <td className="px-3 py-2 text-right text-[var(--fg-3)]">{item.stockQty}</td>
                            <td className="px-3 py-2 text-right font-semibold text-warning">{item.produceQty}</td>
                            <td className="px-3 py-2 text-center text-xs text-[var(--fg-3)]">{item.unit}</td>
                            <td className="px-3 py-2 text-xs">
                              {item.problem ? (
                                <span className="text-danger font-medium">{item.problem}</span>
                              ) : (
                                <span className="text-[var(--fg-4)]">-</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Table 2: วัตถุดิบที่ต้องใช้ */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Layers className="w-4 h-4 text-[var(--primary)]" />
                  <h3 className="text-sm font-semibold text-[var(--fg-1)]">
                    วัตถุดิบที่ต้องใช้
                  </h3>
                </div>
                <div className="border border-[var(--border)] rounded-xl overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] text-xs text-[var(--fg-3)]">
                        <th className="text-left px-3 py-2 font-medium">ชื่อวัตถุดิบ</th>
                        <th className="text-right px-3 py-2 font-medium">ต้องใช้</th>
                        <th className="text-right px-3 py-2 font-medium">มีในสต็อก</th>
                        <th className="text-right px-3 py-2 font-medium">ขาด</th>
                        <th className="text-center px-3 py-2 font-medium">หน่วย</th>
                        <th className="text-center px-3 py-2 font-medium">สถานะ</th>
                        <th className="text-left px-3 py-2 font-medium">ปัญหา / หมายเหตุ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]/50">
                      {plan.materials.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="text-center py-4 text-xs text-[var(--fg-4)]">
                            ไม่มีรายการวัตถุดิบที่ต้องใช้
                          </td>
                        </tr>
                      ) : (
                        plan.materials.map((mat, idx) => {
                          const isShort = mat.shortQty > 0
                          return (
                            <tr key={mat.materialId || idx} className="hover:bg-[var(--surface-2)]/50">
                              <td className="px-3 py-2 font-medium text-[var(--fg-1)]">{mat.name}</td>
                              <td className="px-3 py-2 text-right text-[var(--fg-2)]">{mat.requiredQty}</td>
                              <td className="px-3 py-2 text-right text-[var(--fg-3)]">{mat.stockQty}</td>
                              <td className="px-3 py-2 text-right font-semibold">
                                {isShort ? (
                                  <span className="text-danger">{mat.shortQty}</span>
                                ) : (
                                  <span className="text-[var(--fg-4)]">0</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-center text-xs text-[var(--fg-3)]">{mat.unit}</td>
                              <td className="px-3 py-2 text-center">
                                {isShort ? (
                                  <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-[var(--danger-soft)] text-[var(--danger-strong)]">
                                    ไม่พอ
                                  </span>
                                ) : (
                                  <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-[var(--success-soft)] text-[var(--success-strong)]">
                                    พอ
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-xs">
                                {mat.problem ? (
                                  <span className="text-danger font-medium">{mat.problem}</span>
                                ) : (
                                  <span className="text-[var(--fg-4)]">-</span>
                                )}
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-[var(--border)] flex justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm text-[var(--fg-3)] hover:text-[var(--fg-1)] rounded-lg border border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={handleProduceAndConfirm}
            disabled={!plan?.ok || submitting}
            className="px-4 py-2 bg-phopy-indigo text-white font-semibold rounded-lg hover:bg-phopy-indigo/80 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm transition-opacity"
          >
            {submitting ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <CheckCircle className="w-4 h-4" />
            )}
            สั่งผลิตและยืนยันใบขาย
          </button>
        </div>
      </motion.div>
    </div>
  )
}
export default ProduceShortfallDialog
