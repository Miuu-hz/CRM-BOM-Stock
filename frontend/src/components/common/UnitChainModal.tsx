import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Lock, X } from 'lucide-react'
import api from '../../services/api'
import { invalidateUnitsCache } from '../../hooks/useUnits'
import { useModalClose } from '../../hooks/useModalClose'
import UnitChainEditor, { type UnitConversionRow } from './UnitChainEditor'

interface Props {
  /** สินค้าที่จะผูกกฎ · null = กฎกลางทั้งระบบ (material_id ว่าง) */
  materialId?: string | null
  /** หน่วยฐาน/หน่วยสต็อกของสินค้า — ปลายทางของเส้นที่ขาด */
  baseUnit: string
  /** หน่วยที่ยังแปลงไม่ถึง — ยังไม่มีในระบบก็ได้ บันทึกกฎแล้วหน่วยนี้จะเกิดขึ้นเอง */
  unit: string
  onClose: () => void
  /** เรียกเมื่อบันทึกกฎเพิ่มสำเร็จ (ไม่นับการลบ) — ช่องหน่วยที่เปิดหน้าต่างนี้ใช้เลือกหน่วยนั้นให้หลังปิด */
  onAdded?: () => void
}

/** ข้อความผิดพลาดที่คนอ่านเข้าใจ — 401/402/403 = ไม่มีสิทธิ์/แพ็กเกจไม่ครอบคลุม */
export function unitChainLoadError(err: unknown): string {
  const status = (err as { response?: { status?: number } })?.response?.status
  if (status === 401 || status === 402 || status === 403) {
    return 'บัญชีนี้ไม่มีสิทธิ์ตั้งค่าการแปลงหน่วย — ให้ผู้ดูแลระบบเพิ่มกฎให้ หรือขอสิทธิ์โมดูลสต็อก'
  }
  return 'โหลดกฎแปลงหน่วยไม่สำเร็จ ลองใหม่อีกครั้ง'
}

/**
 * ผังแปลงหน่วยแบบหน้าต่างซ้อน เปิดจากคำเตือน "แปลงไม่ถึงหน่วยฐาน" กลางบิล/สูตรผลิต
 * เดิมปุ่มพาไป /settings?tab=units — บิลที่กรอกค้างไว้หายหมด
 * หน้าต่างนี้ซ้อนบนฟอร์มเดิม ปิดแล้วกรอกต่อได้ ส่วน invalidateUnitsCache() ทำให้ช่องหน่วยทุกช่องโหลดใหม่เอง
 */
export default function UnitChainModal({ materialId = null, baseUnit, unit, onClose, onAdded }: Props) {
  const [convs, setConvs] = useState<UnitConversionRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Esc ปิดเฉพาะหน้าต่างบนสุด (หน้าต่างนี้) ไม่ปิดบิลข้างล่าง
  useModalClose(onClose)

  const qs = materialId ? `?materialId=${encodeURIComponent(materialId)}` : ''
  const reload = useCallback(async () => {
    const res = await api.get(`/materials/unit-conversions${qs}`)
    setConvs(res.data?.data ?? [])
  }, [qs])

  useEffect(() => {
    reload().catch(err => setError(unitChainLoadError(err)))
  }, [reload])

  // ปิดแล้วคืนโฟกัสให้ปุ่มที่เปิด — คีย์บอร์ดจะได้กรอกบิลต่อจากจุดเดิม
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    return () => opener?.focus?.()
  }, [])

  const afterChange = async () => {
    await reload()
    invalidateUnitsCache()
  }

  const initialEdge = unit && baseUnit && unit !== baseUnit ? { from: unit, to: baseUnit } : null

  let body
  if (error) {
    body = (
      <div className="fixed inset-0 bg-[var(--fg-1)]/70 flex items-center justify-center p-4">
        <div className="phopy-card p-5 w-full max-w-sm">
          <div className="flex items-start gap-3">
            <Lock className="w-5 h-5 text-warning shrink-0 mt-0.5" />
            <p className="text-sm text-[var(--fg-2)] flex-1">{error}</p>
            <button type="button" onClick={onClose} aria-label="ปิด" className="p-1 rounded-lg hover:bg-[var(--bg)]">
              <X className="w-4 h-4 text-[var(--fg-3)]" />
            </button>
          </div>
        </div>
      </div>
    )
  } else if (!convs) {
    body = (
      <div className="fixed inset-0 bg-[var(--fg-1)]/70 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--surface)]" />
      </div>
    )
  } else {
    body = (
      <UnitChainEditor
        conversions={convs}
        materialId={materialId}
        baseUnit={baseUnit}
        displayUnit={unit}
        initialEdge={initialEdge}
        onAdd={async (from, to, factor, force) => {
          await api.post('/materials/unit-conversions', {
            material_id: materialId, from_unit: from, to_unit: to, conversion_factor: factor,
            ...(force ? { force: true } : {}),
          })
          await afterChange()
          onAdded?.()
        }}
        onDelete={async id => {
          await api.delete(`/materials/unit-conversions/${id}`)
          await afterChange()
        }}
        onClose={onClose}
      />
    )
  }

  // portal ออกไปที่ body ให้พ้น overflow/z-index ของบิล · z-[70] ให้อยู่เหนือ modal บิล (z-50)
  // กัน click ไหลย้อนตาม React tree ขึ้นไปถึง backdrop ของบิล (onClick={onClose}) — ไม่งั้นคลิกในผังแล้วบิลปิด
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="ผังการแปลงหน่วย"
      className="relative z-[70]"
      onClick={e => e.stopPropagation()}
    >
      {body}
    </div>,
    document.body,
  )
}
