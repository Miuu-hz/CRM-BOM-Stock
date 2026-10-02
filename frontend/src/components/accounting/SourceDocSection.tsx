import { useState, useEffect } from 'react'
import api from '../../services/api'
import { PaymentAttachments } from '../common/PaymentAttachments'

// ==================== เอกสารต้นทาง ====================
// คนทำบัญชีเห็นแต่ Dr/Cr กับคำอธิบายบรรทัดเดียว แล้วตัดสินไม่ได้ว่ารายการถูกไหม
// ก้อนนี้ดึงตัวเอกสารจริงมาวางไว้ใต้ผัง T: เลขที่ วันที่ คู่กรณี รายการสินค้า
// หมายเหตุที่คนออกเอกสารเขียนไว้ และสลิปทุกใบที่เกี่ยวข้อง — ครบทั้งฝั่งซื้อและฝั่งขาย
// หลังบ้าน: GET /journal/:id/source, GET /journal/source/:kind/:refId (routes/journalSource.routes.ts)
// รองรับ "สายเอกสาร" ด้วย — คลิก chip ในสายเพื่อเปิดเอกสารอื่นในสายเดียวกันแบบไม่ออกจากที่นี่

export interface ChainNode { kind: string; refId: string; number: string | null; date: string | null; status: string | null }

export interface SourceDoc {
  kind: string; refId: string
  docNumber: string | null; docDate: string | null
  createdAt: string | null; status: string | null
  partyLabel: string | null; party: string | null; notes: string | null
  amounts: { subtotal?: number; discount?: number; tax?: number; total?: number; paid?: number; balance?: number } | null
  vatInclusive: boolean | null
  extra: { label: string; value: string }[]
  items: { name: string; quantity?: number; unit?: string; unitPrice?: number; total?: number }[]
  itemsNote: string | null
  attachments: { refType: string; refId: string; label: string }[]
  chain: ChainNode[]
  route: string | null
}

export const KIND_LABEL: Record<string, string> = {
  INVOICE: 'ใบแจ้งหนี้ขาย',
  PAYMENT: 'ใบเสร็จรับเงิน',
  PURCHASE_INVOICE: 'ใบแจ้งหนี้ซื้อ',
  SUPPLIER_PAYMENT: 'ใบจ่ายเงิน',
  GOODS_RECEIPT: 'ใบรับสินค้า',
  POS_SALE: 'บิลขายหน้าร้าน',
  POS_CANCEL: 'บิลขายหน้าร้าน (ยกเลิก)',
  STOCK_ADJUST: 'ใบปรับสต็อก',
  PURCHASE_REQUEST: 'ใบขอซื้อ',
  PURCHASE_ORDER: 'ใบสั่งซื้อ',
  SALES_ORDER: 'ใบสั่งขาย',
  CREDIT_NOTE: 'ใบลดหนี้',
}

const fmt = (n: number) =>
  (n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })

const fmtDateTime = (s: string) =>
  new Date(s).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function SourceDocSection({ entryId, kind, refId }: { entryId?: string; kind?: string; refId?: string }) {
  const [doc, setDoc] = useState<SourceDoc | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  // ประวัติเอกสารที่เปิดผ่านมาแล้วในสาย — เก็บตัวเอกสารเดิมไว้เลย กด "กลับ" ไม่ต้องยิง API ซ้ำ
  const [history, setHistory] = useState<SourceDoc[]>([])

  useEffect(() => {
    let alive = true
    setDoc(undefined)
    setFailed(false)
    setHistory([])
    const url = entryId ? `/journal/${entryId}/source` : `/journal/source/${kind}/${refId}`
    api.get(url)
      .then(res => { if (alive) setDoc(res.data?.data ?? null) })
      .catch(() => { if (alive) { setDoc(null); setFailed(true) } })
    return () => { alive = false }
  }, [entryId, kind, refId])

  const openNode = (node: ChainNode) => {
    if (!doc || (node.kind === doc.kind && node.refId === doc.refId)) return
    const current = doc
    setDoc(undefined)
    setFailed(false)
    api.get(`/journal/source/${node.kind}/${node.refId}`)
      .then(res => { setHistory(h => [...h, current]); setDoc(res.data?.data ?? null) })
      .catch(() => { setHistory(h => [...h, current]); setDoc(null); setFailed(true) })
  }

  const goBack = () => {
    setHistory(h => {
      if (h.length === 0) return h
      setDoc(h[h.length - 1])
      setFailed(false)
      return h.slice(0, -1)
    })
  }

  if (doc === undefined) return <div className="h-24 rounded-xl bg-[var(--surface-2)] animate-pulse" />
  if (failed) return <p className="text-xs text-[var(--fg-4)] px-1">โหลดเอกสารไม่สำเร็จ</p>
  // รายการที่คีย์มือไม่มีเอกสารต้นทาง ไม่ต้องโชว์อะไร
  if (!doc) return null

  const money = (n?: number) => n === undefined || n === null ? '-' : `฿${fmt(n)}`

  return (
    <div className="border border-[var(--border)] rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 bg-[var(--surface-2)] border-b border-[var(--border)] flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-2.5 flex-wrap">
          <span className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wide">เอกสารต้นทาง</span>
          <span className="text-xs text-[var(--fg-2)]">{KIND_LABEL[doc.kind] || doc.kind}</span>
          {doc.docNumber && <span className="font-mono text-sm text-[var(--primary)] font-semibold">{doc.docNumber}</span>}
          {doc.status && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--surface)] border border-[var(--border)] text-[var(--fg-3)] uppercase tracking-wide">{doc.status}</span>
          )}
        </div>
        <div className="flex flex-col items-end gap-0.5">
          {doc.docDate && <span className="text-xs text-[var(--fg-4)]">{fmtDate(doc.docDate)}</span>}
          {doc.createdAt && <span className="text-[10px] text-[var(--fg-4)]">สร้างเมื่อ {fmtDateTime(doc.createdAt)}</span>}
        </div>
      </div>

      <div className="p-4 space-y-3">
        {doc.chain.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wide shrink-0">สายเอกสาร</span>
            {history.length > 0 && (
              <button type="button" onClick={goBack} className="text-xs text-[var(--primary)] hover:underline shrink-0">← กลับ</button>
            )}
            <div className="flex items-center flex-wrap gap-1.5">
              {doc.chain.map((node, i) => {
                const isCurrent = node.kind === doc.kind && node.refId === doc.refId
                return (
                  <span key={`${node.kind}:${node.refId}`} className="flex items-center gap-1.5">
                    {i > 0 && <span className="text-[var(--fg-4)] text-xs">→</span>}
                    {isCurrent ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--primary)]/15 text-[var(--primary)] font-semibold">
                        {KIND_LABEL[node.kind] || node.kind}{node.number ? ` ${node.number}` : ''}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openNode(node)}
                        className="text-xs px-2 py-0.5 rounded-full bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface)] hover:border-[var(--primary)]"
                      >
                        {KIND_LABEL[node.kind] || node.kind}{node.number ? ` ${node.number}` : ''}
                        {node.status === 'CANCELLED' && <span className="text-danger ml-1">(ยกเลิก)</span>}
                      </button>
                    )}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {doc.party && (
          <div className="flex items-baseline gap-2 text-sm">
            <span className="text-[var(--fg-4)] text-xs">{doc.partyLabel || 'คู่กรณี'}</span>
            <span className="text-[var(--fg-1)] font-medium">{doc.party}</span>
          </div>
        )}

        {doc.extra.length > 0 && (
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            {doc.extra.map(e => (
              <span key={e.label} className="text-xs">
                <span className="text-[var(--fg-4)]">{e.label}: </span>
                <span className="text-[var(--fg-2)]">{e.value}</span>
              </span>
            ))}
          </div>
        )}

        {doc.itemsNote && <p className="text-xs text-[var(--fg-4)] italic">{doc.itemsNote}</p>}

        {doc.items.length > 0 && (
          <div className="rounded-lg border border-[var(--border)]/60 overflow-hidden">
            <div className="max-h-56 overflow-y-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--border)]/60 bg-[var(--bg)]">
                    <th className="px-3 py-1.5 text-left text-[var(--fg-4)] font-medium">รายการ</th>
                    <th className="px-3 py-1.5 text-right text-[var(--fg-4)] font-medium">จำนวน</th>
                    <th className="px-3 py-1.5 text-right text-[var(--fg-4)] font-medium">ราคา/หน่วย</th>
                    <th className="px-3 py-1.5 text-right text-[var(--fg-4)] font-medium">รวม</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]/40">
                  {doc.items.map((it, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-[var(--fg-2)]">{it.name}</td>
                      <td className="px-3 py-2 text-right text-[var(--fg-3)] whitespace-nowrap tabular-nums">
                        {it.quantity ?? '-'}{it.unit ? ` ${it.unit}` : ''}
                      </td>
                      <td className="px-3 py-2 text-right text-[var(--fg-3)] whitespace-nowrap tabular-nums">{money(it.unitPrice)}</td>
                      <td className="px-3 py-2 text-right text-[var(--fg-1)] font-medium whitespace-nowrap tabular-nums">{money(it.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {doc.amounts && (
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
            {doc.amounts.subtotal !== undefined && doc.amounts.subtotal !== null && (
              <span><span className="text-[var(--fg-4)]">ก่อนภาษี: </span><span className="text-[var(--fg-2)] tabular-nums">{money(doc.amounts.subtotal)}</span></span>
            )}
            {!!doc.amounts.discount && (
              <span><span className="text-[var(--fg-4)]">ส่วนลด: </span><span className="text-[var(--fg-2)] tabular-nums">{money(doc.amounts.discount)}</span></span>
            )}
            {!!doc.amounts.tax && (
              <span><span className="text-[var(--fg-4)]">VAT{doc.vatInclusive ? ' (ราคารวม VAT)' : ''}: </span><span className="text-[var(--fg-2)] tabular-nums">{money(doc.amounts.tax)}</span></span>
            )}
            {doc.amounts.total !== undefined && doc.amounts.total !== null && (
              <span><span className="text-[var(--fg-4)]">รวม: </span><span className="text-[var(--fg-1)] font-semibold tabular-nums">{money(doc.amounts.total)}</span></span>
            )}
            {!!doc.amounts.balance && (
              <span><span className="text-[var(--fg-4)]">คงค้าง: </span><span className="text-warning font-semibold tabular-nums">{money(doc.amounts.balance)}</span></span>
            )}
          </div>
        )}

        {doc.notes && (
          <div className="px-3 py-2 bg-[var(--bg)] rounded-lg text-sm text-[var(--fg-2)]">
            <span className="text-[var(--fg-4)] text-xs">หมายเหตุจากเอกสาร: </span>{doc.notes}
          </div>
        )}

        {doc.attachments.length > 0 && (
          <div className="space-y-3 pt-1">
            {doc.attachments.map(a => (
              <PaymentAttachments
                key={`${a.refType}:${a.refId}`}
                refType={a.refType as any}
                refId={a.refId}
                title={a.label}
                readOnly
                dense
                hideWhenEmpty
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
