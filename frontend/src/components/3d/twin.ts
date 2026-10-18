import { useCallback, useEffect, useState } from 'react'
import api from '../../services/api'

// ข้อมูลจาก GET /api/twin (backend/src/routes/twin.routes.ts) — ฉาก 3D และแผงข้างใช้ชุดเดียวกัน
export interface TwinDoc {
  id: string
  number: string
  status: string
  party: string | null
  eta: string | null
}
export interface TwinOutbound extends TwinDoc {
  driver: string | null
  plate: string | null
  address: string | null
  updatedAt: string | null
}
export interface TwinInbound extends TwinDoc {
  amount: number | null
}
export interface TwinWorkOrder {
  id: string
  number: string
  product: string | null
  quantity: number
  completed: number
  due: string | null
}
export interface TwinLowItem {
  id: string
  sku: string
  name: string
  quantity: number
  minStock: number
  unit: string
}
export interface TwinData {
  generatedAt: string
  site: { name: string; address: string }
  stock: {
    sku: number
    inStock: number
    low: number
    value: number | null
    categories: { category: string; sku: number; inStock: number }[]
    lowItems: TwinLowItem[]
  }
  inbound: { open: number; receivedToday: number; list: TwinInbound[] }
  outbound: { ready: number; shipped: number; deliveredToday: number; onTimePct: number | null; list: TwinOutbound[] }
  production: { active: number; list: TwinWorkOrder[] }
}

/** สิ่งที่คลิกได้ในฉาก — ฉากส่งออกมา แผงข้างเลือกว่าจะโชว์อะไร */
export type TwinPick =
  | { kind: 'shipment'; id: string }
  | { kind: 'inbound'; id: string }
  | { kind: 'rack' }
  | { kind: 'production' }
  | { kind: 'site' }

const POLL_MS = 30_000

/** ดึงสถานะคลังทุก 30 วิ (หยุดตอนแท็บถูกซ่อน) */
export function useTwinData() {
  const [data, setData] = useState<TwinData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/twin')
      setData(res.data?.data ?? null)
      setError(null)
    } catch (e: any) {
      setError(e?.response?.data?.message || 'โหลดข้อมูลคลังไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = window.setInterval(() => { if (!document.hidden) load() }, POLL_MS)
    return () => window.clearInterval(id)
  }, [load])

  return { data, error, loading, reload: load }
}

export const CATEGORY_LABEL: Record<string, string> = {
  raw: 'วัตถุดิบ',
  wip: 'ระหว่างผลิต',
  finished: 'สินค้าสำเร็จรูป',
}

export const DO_STATUS: Record<string, { label: string; step: number }> = {
  READY: { label: 'กำลังขึ้นของ', step: 0 },
  SHIPPED: { label: 'กำลังจัดส่ง', step: 1 },
  DELIVERED: { label: 'ส่งถึงแล้ว', step: 2 },
}

export function shortDate(s: string | null | undefined): string {
  if (!s) return '-'
  const d = new Date(s)
  if (isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
}
