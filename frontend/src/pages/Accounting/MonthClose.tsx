import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import * as XLSX from 'xlsx'
import { subMonths, format } from 'date-fns'
import {
  Download, Upload, FileText, CheckCircle2, AlertTriangle, RefreshCw, Lock, X, ShieldCheck, Trash2, ExternalLink,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import {
  monthCloseApi, type ClosePack, type MonthCloseStatus, type MonthCloseGroup, type ChecklistItem,
} from '../../services/monthClose'

const fmt = (n: number | null | undefined) =>
  (n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const signed = (n: number) => `${n >= 0 ? '+' : ''}${fmt(n)}`

const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
function thaiPeriodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return `${THAI_MONTHS[(m || 1) - 1]} ${y + 543}`
}

const RECORD_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'ร่าง', PENDING_APPROVAL: 'รออนุมัติ', POSTED: 'ลงบัญชีแล้ว', DISCARDED: 'ทิ้งแล้ว', NOTED: 'ไม่ลงบัญชี',
}

const CHIP_CLASS: Record<ChecklistItem['status'], string> = {
  pass: 'bg-[var(--success-soft)] text-success',
  warn: 'bg-[var(--warning-soft)] text-warning',
  block: 'bg-[var(--danger-soft)] text-danger',
  na: 'bg-[var(--surface-sunken)] text-[var(--fg-4)]',
}
const CHIP_LABEL: Record<ChecklistItem['status'], string> = { pass: 'ผ่าน', warn: 'เตือน', block: 'บล็อก', na: 'ไม่เกี่ยว' }

// ─────────────────────────────────────────────────────────────────────────
// สร้าง workbook ชุดปิดเดือนในเบราว์เซอร์ — ฟังก์ชัน pure ล้วน (ไม่แตะ DOM/เครือข่าย)
// ลำดับชีตต้องตรงกับที่ระบุในบรีฟ W7 ทุกตัว — มีเทสต์คุมลำดับนี้อยู่
// ─────────────────────────────────────────────────────────────────────────
export function buildClosePackWorkbook(pack: ClosePack): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()

  // อ่านก่อน — คำสั่งสำหรับ AI หนึ่งบรรทัดต่อหนึ่งแถว ไม่มีหัวคอลัมน์ (เป็น markdown ดิบให้อ่านตรง ๆ)
  const instructionLines = (pack.instructions || '').split('\n').map((line) => [line])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(instructionLines), 'อ่านก่อน')

  // รายการในระบบ — ทุกบรรทัดของทุกบัญชี รหัสบัญชีมาก่อน
  const lineRows = pack.accounts.flatMap((acc) =>
    acc.lines.map((l) => ({
      รหัสบัญชี: acc.code,
      line_id: l.lineId,
      วันที่: l.date,
      เลขเอกสาร: l.entryNumber,
      ที่มา: l.source,
      คู่ค้า: l.counterparty || '',
      คำอธิบาย: l.description,
      เข้า: l.in,
      ออก: l.out,
      คงเหลือ: l.balance,
      'post แล้ว': l.posted ? 'ใช่' : 'ไม่',
    })),
  )
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lineRows), 'รายการในระบบ')

  // ยอดต่อบัญชี
  const accountRows = pack.accounts.map((acc) => ({
    code: acc.code, name: acc.name, kind: acc.kind, opening: acc.opening, closing: acc.closing, pending: acc.pending, statement: acc.statement,
  }))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(accountRows), 'ยอดต่อบัญชี')

  // บัญชีหัวค้างยอด
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pack.headerBalances), 'บัญชีหัวค้างยอด')

  // ผังบัญชี
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pack.chart), 'ผังบัญชี')

  // คู่ค้า — ผู้ขาย + ลูกค้า พร้อมคอลัมน์ประเภท
  const contactRows = [
    ...pack.contacts.suppliers.map((c) => ({ ...c, ประเภท: 'ผู้ขาย' })),
    ...pack.contacts.customers.map((c) => ({ ...c, ประเภท: 'ลูกค้า' })),
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(contactRows), 'คู่ค้า')

  // ใบแจ้งหนี้ค้าง — ขาย + ซื้อ พร้อมคอลัมน์ฝั่ง
  const invoiceRows = [
    ...pack.openInvoices.sales.map((i) => ({ ...i, ฝั่ง: 'ขาย' })),
    ...pack.openInvoices.purchase.map((i) => ({ ...i, ฝั่ง: 'ซื้อ' })),
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(invoiceRows), 'ใบแจ้งหนี้ค้าง')

  // ประเภทรายการ — needs/allowedAccounts เป็น array ต้องรวมเป็นสตริงก่อนลงชีต
  const typeRows = pack.types.map((t) => ({
    type: t.type, label: t.label, debit: t.debit, credit: t.credit,
    needs: (t.needs || []).join(', '), allowedAccounts: (t.allowedAccounts || []).join(', '), note: t.note,
  }))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(typeRows), 'ประเภทรายการ')

  // แบบฟอร์มส่งกลับ — หัวคอลัมน์ = lineFields, แถวเดียวเป็นตัวอย่าง
  const fields = pack.submitSchema.lineFields
  const example = (pack.submitSchema.example || {}) as Record<string, unknown>
  const formRows: any[][] = [fields, fields.map((f) => example[f] ?? '')]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(formRows), 'แบบฟอร์มส่งกลับ')

  return wb
}

interface AttachmentRow { id: string; original_name: string; file_size: number; created_at: string }

function formatSize(bytes: number) {
  if (!bytes) return '-'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function MonthClose() {
  const navigate = useNavigate()
  const [period, setPeriod] = useState(() => format(subMonths(new Date(), 1), 'yyyy-MM'))
  const [status, setStatus] = useState<MonthCloseStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [packBusy, setPackBusy] = useState(false)
  const [mdBusy, setMdBusy] = useState(false)
  const [busyGroup, setBusyGroup] = useState<string | null>(null)
  const [busyRecord, setBusyRecord] = useState<string | null>(null)

  const [attachments, setAttachments] = useState<AttachmentRow[]>([])
  const [uploading, setUploading] = useState(false)

  const [showLockModal, setShowLockModal] = useState(false)
  const [lockPassword, setLockPassword] = useState('')
  const [lockBusy, setLockBusy] = useState(false)
  const [lockBlockItems, setLockBlockItems] = useState<ChecklistItem[] | null>(null)

  const loadStatus = useCallback(async () => {
    setLoading(true)
    try {
      const res = await monthCloseApi.getStatus(period)
      setStatus(res.data.data)
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'โหลดสถานะปิดเดือนไม่สำเร็จ')
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [period])
  useEffect(() => { loadStatus() }, [loadStatus])

  const taxPeriodId = status?.taxPeriodId || null
  const loadAttachments = useCallback(async () => {
    if (!taxPeriodId) { setAttachments([]); return }
    try {
      const res = await api.get(`/attachments/TAX_PERIOD/${taxPeriodId}`)
      setAttachments(res.data?.data || [])
    } catch { /* หลักฐานไม่ใช่ข้อมูลหลักของหน้า — เงียบไว้พอ */ }
  }, [taxPeriodId])
  useEffect(() => { loadAttachments() }, [loadAttachments])

  // ───────────── a. ชุดปิดเดือน ─────────────
  const handleDownloadPack = async () => {
    setPackBusy(true)
    try {
      const res = await monthCloseApi.getPack(period)
      const wb = buildClosePackWorkbook(res.data.data)
      XLSX.writeFile(wb, `close-pack-${period}.xlsx`)
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'ดาวน์โหลดชุดปิดเดือนไม่สำเร็จ')
    } finally {
      setPackBusy(false)
    }
  }

  const handleDownloadInstructions = async () => {
    setMdBusy(true)
    try {
      const res = await api.get(`/month-close/${period}/instructions.md`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `month-close-instructions-${period}.md`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'ดาวน์โหลดคำสั่งสำหรับ AI ไม่สำเร็จ')
    } finally {
      setMdBusy(false)
    }
  }

  // ───────────── c. รายการปรับปรุงรอทบทวน ─────────────
  const handleApproveGroup = async (group: MonthCloseGroup) => {
    setBusyGroup(group.type)
    try {
      const res = await monthCloseApi.approveGroup(period, group.type)
      const data = res.data.data
      if (data.mode === 'posted') toast.success(`ลงบัญชีแล้ว ${data.posted ?? 0} รายการ`)
      else toast.success(`ส่งคำขอ ${data.requestNumber} แล้ว — รอผู้อนุมัติที่หน้า อนุมัติ`)
      await loadStatus()
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'ทำรายการไม่สำเร็จ')
    } finally {
      setBusyGroup(null)
    }
  }

  const handleDiscardRecord = async (recordId: string) => {
    const reason = window.prompt('เหตุผลที่ทิ้งรายการนี้ (อย่างน้อย 5 ตัวอักษร)')
    if (reason === null) return
    if (reason.trim().length < 5) { toast.error('เหตุผลต้องมีความยาวอย่างน้อย 5 ตัวอักษร'); return }
    setBusyRecord(recordId)
    try {
      await monthCloseApi.discardRecord(recordId, reason.trim())
      toast.success('ทิ้งรายการแล้ว')
      await loadStatus()
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'ทิ้งรายการไม่สำเร็จ')
    } finally {
      setBusyRecord(null)
    }
  }

  // ───────────── f. หลักฐานของงวด ─────────────
  const handleUploadAttachment = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !taxPeriodId) return
    if (file.size > 10 * 1024 * 1024) { toast.error('ไฟล์ต้องไม่เกิน 10 MB'); e.target.value = ''; return }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      await api.post(`/attachments/TAX_PERIOD/${taxPeriodId}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      toast.success('อัปโหลดหลักฐานแล้ว')
      await loadAttachments()
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'อัปโหลดไม่สำเร็จ')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const openAttachment = async (id: string) => {
    try {
      const res = await api.get(`/attachments/${id}/file`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch {
      toast.error('เปิดไฟล์ไม่สำเร็จ')
    }
  }

  // ───────────── g. ล็อกงวด ─────────────
  const handleLockPeriod = async () => {
    if (!taxPeriodId) return
    setLockBusy(true)
    try {
      await api.post(`/period-closing/close/${taxPeriodId}`, { password: lockPassword })
      toast.success(`ปิดงวด ${thaiPeriodLabel(period)} แล้ว`)
      setShowLockModal(false)
      setLockPassword('')
      setLockBlockItems(null)
      await loadStatus()
    } catch (err: any) {
      const items = err.response?.status === 400 ? err.response?.data?.data?.items : null
      if (Array.isArray(items)) setLockBlockItems((items as ChecklistItem[]).filter((i) => i.status === 'block'))
      toast.error(err.response?.data?.message || 'ปิดงวดไม่สำเร็จ')
    } finally {
      setLockBusy(false)
    }
  }

  const checklist = status?.checklist
  const blockItems = checklist?.items.filter((i) => i.status === 'block') || []
  // กลุ่ม TIMING (ไม่ลงบัญชี อธิบายผลต่างอย่างเดียว) ให้อยู่ท้ายสุดเสมอ
  const orderedGroups = status ? [...status.groups].sort((a, b) => (a.type === 'TIMING' ? 1 : 0) - (b.type === 'TIMING' ? 1 : 0)) : []

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-1)] flex items-center gap-2">
            <Lock className="w-6 h-6 text-[var(--primary)]" />
            ปิดเดือน
          </h1>
          <p className="text-[var(--fg-3)]">กระทบยอดธนาคาร/เงินสด ทบทวนรายการปรับปรุง ผ่านด่านตรวจ แล้วล็อกงวด</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-[var(--fg-3)]">งวด</label>
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="phopy-input" />
          <button onClick={loadStatus} className="phopy-btn-secondary flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />
            รีเฟรช
          </button>
        </div>
      </div>

      {loading ? (
        <div className="phopy-card p-6 text-center text-[var(--fg-4)]">กำลังโหลด...</div>
      ) : !status ? (
        <div className="phopy-card p-6 text-center text-[var(--fg-4)]">ไม่พบข้อมูลงวดนี้</div>
      ) : (
        <>
          {/* a. ชุดปิดเดือน */}
          <div className="phopy-card p-6 space-y-3">
            <h3 className="text-lg font-semibold text-[var(--fg-1)] flex items-center gap-2">
              <FileText className="w-5 h-5 text-[var(--primary)]" />
              ชุดปิดเดือน
            </h3>
            <div className="flex flex-wrap gap-2">
              <button disabled={packBusy} onClick={handleDownloadPack} className="phopy-btn-primary flex items-center gap-2 disabled:opacity-40">
                <Download className="w-4 h-4" />
                {packBusy ? 'กำลังสร้างไฟล์...' : `ดาวน์โหลดชุดปิดเดือน ${thaiPeriodLabel(period)}`}
              </button>
              <button disabled={mdBusy} onClick={handleDownloadInstructions} className="phopy-btn-secondary flex items-center gap-2 disabled:opacity-40">
                <Download className="w-4 h-4" />
                {mdBusy ? 'กำลังสร้างไฟล์...' : 'ดาวน์โหลดคำสั่งสำหรับ AI (.md)'}
              </button>
            </div>
            <p className="text-xs text-[var(--fg-4)]">
              AI ที่ต่อ MCP อยู่แล้วเรียก get_close_pack(period) ได้ข้อมูลชุดเดียวกัน แล้วส่งรายการกลับด้วย submit_close_adjustments
            </p>
          </div>

          {/* b. สถานะกระทบยอด */}
          <div className="phopy-card p-6 space-y-3">
            <h3 className="text-lg font-semibold text-[var(--fg-1)] flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[var(--primary)]" />
              สถานะกระทบยอด
            </h3>
            <div className="overflow-x-auto">
              <table className="phopy-table w-full">
                <thead>
                  <tr>
                    <th>บัญชี</th>
                    <th className="text-right">ยอดตามบัญชี</th>
                    <th className="text-right">+ ปรับปรุงรอ post</th>
                    <th className="text-right">รายการระหว่างทาง</th>
                    <th className="text-right">= หลังปรับ</th>
                    <th className="text-right">ตาม statement / นับจริง</th>
                    <th className="text-right">ผลต่าง</th>
                    <th>ส่งโดย/เวลา</th>
                  </tr>
                </thead>
                <tbody>
                  {status.recon.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-8 text-[var(--fg-4)]">ไม่มีบัญชีที่ต้องกระทบยอดในงวดนี้</td></tr>
                  ) : status.recon.map((r) => {
                    const after = r.book + r.pending + r.timing
                    const ok = r.difference !== null && Math.abs(r.difference) < 0.01
                    return (
                      <tr key={r.accountId}>
                        <td>
                          <div className="font-medium">{r.code} {r.name}</div>
                          {r.kind === 'CASH' ? (
                            <span className="inline-block mt-0.5 px-2 py-0.5 rounded text-[10px] bg-[var(--surface-sunken)] text-[var(--fg-3)]">เงินสด</span>
                          ) : (
                            <div className="text-xs text-[var(--fg-4)]">{r.bankName} {r.accountNumber}</div>
                          )}
                        </td>
                        <td className="text-right">{fmt(r.book)}</td>
                        <td className="text-right">{fmt(r.pending)}</td>
                        <td className="text-right">{fmt(r.timing)}</td>
                        <td className="text-right font-medium">{fmt(after)}</td>
                        <td className="text-right">{r.statement === null ? <span className="text-[var(--fg-4)]">ยังไม่ส่ง</span> : fmt(r.statement)}</td>
                        <td className="text-right">
                          {r.difference === null ? '-' : ok ? (
                            <span className="text-success font-medium inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />ตรง</span>
                          ) : (
                            <span className="text-danger font-medium">{signed(r.difference)}</span>
                          )}
                        </td>
                        <td className="text-xs text-[var(--fg-4)]">{r.submittedBy ? `${r.submittedBy} · ${r.submittedAt?.split('T')[0] || ''}` : '-'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-[var(--fg-4)]">
              ยอดตามบัญชี + รายการปรับปรุงรอ post + รายการระหว่างทาง = ยอดตาม statement → ผลต่างต้องเป็น 0
            </p>
          </div>

          {/* c. รายการปรับปรุงรอทบทวน */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-[var(--fg-1)]">รายการปรับปรุงรอทบทวน</h3>
            {orderedGroups.length === 0 ? (
              <div className="phopy-card p-6 text-center text-[var(--fg-4)]">ไม่มีรายการปรับปรุงรอทบทวนในงวดนี้</div>
            ) : orderedGroups.map((group) => (
              <div key={group.type} className="phopy-card p-6 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h4 className="font-semibold text-[var(--fg-1)]">{group.label}</h4>
                    <p className="text-xs text-[var(--fg-4)]">{group.count} รายการ · รวม {fmt(group.total)} บาท</p>
                  </div>
                  {group.status === 'PENDING_APPROVAL' ? (
                    <span className="px-3 py-1.5 rounded-lg text-xs bg-[var(--warning-soft)] text-warning">
                      รออนุมัติ {group.records[0]?.approvalRequestNumber || ''}
                    </span>
                  ) : group.status === 'NOTED' || group.type === 'TIMING' ? null : (
                    <button
                      disabled={busyGroup === group.type}
                      onClick={() => handleApproveGroup(group)}
                      className="phopy-btn-primary text-sm px-3 py-1.5 disabled:opacity-40"
                    >
                      {status.canApprove ? 'อนุมัติและลงบัญชีกลุ่มนี้' : 'ส่งขออนุมัติกลุ่มนี้'}
                    </button>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="phopy-table w-full text-sm">
                    <thead>
                      <tr>
                        <th>วันที่</th><th>บัญชีที่กระทบยอด</th><th className="text-right">จำนวนเงิน</th><th className="text-right">ผลต่อยอด</th>
                        <th>เดบิต</th><th>เครดิต</th><th>อ้าง statement</th><th>คำอธิบาย</th><th>เหตุผลจาก AI</th>
                        <th className="text-right">ความมั่นใจ</th><th>เลขร่าง JV</th><th>สถานะ</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.records.map((rec) => (
                        <tr key={rec.id}>
                          <td>{rec.date}</td>
                          <td>{rec.accountCode}</td>
                          <td className="text-right">{fmt(rec.amount)}</td>
                          <td className="text-right">{signed(rec.effect)}</td>
                          <td>{rec.debitAccount}</td>
                          <td>{rec.creditAccount}</td>
                          <td>{rec.statementRef || '-'}{rec.statementLineNo != null ? ` #${rec.statementLineNo}` : ''}</td>
                          <td className="max-w-[200px] truncate" title={rec.description}>{rec.description}</td>
                          <td className="max-w-[200px] truncate" title={rec.reason || ''}>{rec.reason || '-'}</td>
                          <td className="text-right">{rec.confidence != null ? `${Math.round(rec.confidence * 100)}%` : '-'}</td>
                          <td>{rec.entryNumber || '-'}</td>
                          <td>{RECORD_STATUS_LABEL[rec.status] || rec.status}</td>
                          <td>
                            {rec.status !== 'POSTED' && rec.status !== 'DISCARDED' && (
                              <button
                                disabled={busyRecord === rec.id}
                                onClick={() => handleDiscardRecord(rec.id)}
                                className="text-danger hover:underline text-xs flex items-center gap-1 disabled:opacity-40"
                              >
                                <Trash2 className="w-3 h-3" />
                                ทิ้ง
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>

          {/* d. ด่านตรวจ 11 ข้อ */}
          {checklist && (
            <div className="phopy-card p-6 space-y-3">
              <h3 className="text-lg font-semibold text-[var(--fg-1)] flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[var(--primary)]" />
                ด่านตรวจ 11 ข้อ
              </h3>
              <p className="text-sm text-[var(--fg-3)]">{checklist.label} · บล็อก {checklist.blocks} · เตือน {checklist.warns}</p>
              <div className="space-y-2">
                {checklist.items.map((item) => (
                  <div key={item.id} className="flex items-start gap-3 p-3 rounded-lg bg-[var(--surface-2)]">
                    <span className={`shrink-0 px-2 py-1 rounded text-xs font-medium ${CHIP_CLASS[item.status]}`}>{CHIP_LABEL[item.status]}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-[var(--fg-1)]">{item.id}. {item.title}</p>
                      <p className="text-sm text-[var(--fg-3)]">{item.detail}</p>
                    </div>
                    {item.link && (
                      <button onClick={() => navigate(item.link!)} className="shrink-0 phopy-btn-secondary text-xs px-3 py-1.5 flex items-center gap-1">
                        ไปแก้ <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* e. การถอยรายการในงวดนี้ */}
          {status.unposts.length > 0 && (
            <div className="phopy-card p-6 space-y-3">
              <h3 className="text-lg font-semibold text-[var(--fg-1)] flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-warning" />
                การถอยรายการในงวดนี้
              </h3>
              <div className="overflow-x-auto">
                <table className="phopy-table w-full">
                  <thead>
                    <tr><th>เลขรายการ</th><th>วันที่รายการ</th><th className="text-right">ยอด</th><th>เหตุผล</th><th>ผู้ถอย</th><th>เวลา</th></tr>
                  </thead>
                  <tbody>
                    {status.unposts.map((u, i) => (
                      <tr key={`${u.entryNumber}-${i}`}>
                        <td>{u.entryNumber}</td><td>{u.entryDate}</td><td className="text-right">{fmt(u.totalDebit)}</td>
                        <td>{u.reason}</td><td>{u.unpostedBy}</td><td>{u.unpostedAt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* f. หลักฐานของงวด */}
          {taxPeriodId && (
            <div className="phopy-card p-6 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-[var(--fg-1)] flex items-center gap-2">
                  <FileText className="w-5 h-5 text-[var(--primary)]" />
                  หลักฐานของงวด
                </h3>
                <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${uploading ? 'bg-[var(--bg)] text-[var(--fg-4)]' : 'bg-[var(--primary-soft)] text-[var(--primary)]'}`}>
                  {uploading ? <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  {uploading ? 'กำลังอัปโหลด...' : 'แนบไฟล์ (statement / ชุดปิดเดือน)'}
                  <input type="file" accept="image/*,application/pdf" className="hidden" onChange={handleUploadAttachment} disabled={uploading} />
                </label>
              </div>
              {attachments.length === 0 ? (
                <div className="border-2 border-dashed border-[var(--border)]/60 rounded-xl p-4 text-center text-sm text-[var(--fg-4)]">ยังไม่มีไฟล์แนบ</div>
              ) : (
                <div className="space-y-1">
                  {attachments.map((att) => (
                    <div key={att.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--surface-2)] text-sm">
                      <span className="truncate">{att.original_name} · {formatSize(att.file_size)} · {(att.created_at || '').split('T')[0]}</span>
                      <button onClick={() => openAttachment(att.id)} className="phopy-btn-secondary text-xs px-2 py-1 shrink-0">เปิด</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* g. ล็อกงวด */}
          <div className="phopy-card p-6 space-y-3">
            <h3 className="text-lg font-semibold text-[var(--fg-1)] flex items-center gap-2">
              <Lock className="w-5 h-5 text-[var(--primary)]" />
              ล็อกงวด
            </h3>
            {status.periodStatus === 'CLOSED' ? (
              <p className="text-sm text-success flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />ปิดงวดนี้แล้ว</p>
            ) : blockItems.length > 0 ? (
              <div className="p-3 rounded-lg bg-[var(--danger-soft)] text-sm text-danger space-y-1">
                <p className="font-medium">ปิดงวดไม่ได้จนกว่าจะแก้ {blockItems.length} ข้อนี้:</p>
                <ul className="list-disc pl-5">
                  {blockItems.map((i) => <li key={i.id}>{i.title} — {i.detail}</li>)}
                </ul>
              </div>
            ) : null}
            <button
              disabled={!status.checklist.canClose || status.periodStatus === 'CLOSED' || !taxPeriodId}
              onClick={() => { setLockBlockItems(null); setLockPassword(''); setShowLockModal(true) }}
              className="phopy-btn-primary flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Lock className="w-4 h-4" />
              {status.periodStatus === 'CLOSED' ? 'ปิดงวดแล้ว' : `ปิดงวด ${thaiPeriodLabel(period)}`}
            </button>
          </div>
        </>
      )}

      {showLockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="phopy-card w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[var(--fg-1)] flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[var(--primary)]" />
                ยืนยันการปิดงวด
              </h3>
              <button onClick={() => setShowLockModal(false)} className="text-[var(--fg-4)] hover:text-[var(--fg-2)]"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-[var(--fg-2)]">คุณกำลังจะ <span className="font-semibold">ปิดงวด {thaiPeriodLabel(period)}</span></p>
            {lockBlockItems && lockBlockItems.length > 0 && (
              <div className="p-3 rounded-lg bg-[var(--danger-soft)] text-sm text-danger space-y-1">
                <p className="font-medium">ปิดงวดไม่ได้ — ยังไม่ผ่าน {lockBlockItems.length} ข้อนี้:</p>
                <ul className="list-disc pl-5">
                  {lockBlockItems.map((i) => <li key={i.id}>{i.title} — {i.detail}</li>)}
                </ul>
              </div>
            )}
            <form onSubmit={(e) => { e.preventDefault(); handleLockPeriod() }} className="space-y-4">
              <div>
                <label className="block text-sm text-[var(--fg-3)] mb-1">ใส่รหัสผ่านของคุณเพื่อยืนยัน</label>
                <input
                  type="password" autoFocus autoComplete="current-password" value={lockPassword}
                  onChange={(e) => setLockPassword(e.target.value)} placeholder="รหัสผ่าน" className="phopy-input w-full"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setShowLockModal(false)} className="phopy-btn-secondary">ยกเลิก</button>
                <button type="submit" disabled={lockBusy || !lockPassword} className="phopy-btn-primary flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
                  <Lock className="w-4 h-4" />
                  {lockBusy ? 'กำลังยืนยัน...' : 'ยืนยัน'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </motion.div>
  )
}
