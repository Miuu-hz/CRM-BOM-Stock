import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Printer, XCircle, X } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'

// ==================== Types ====================

export interface WhtCertificate {
  id: string
  cert_number: string
  tax_transaction_id: string
  issue_date: string
  payer_name: string | null
  payer_tax_id: string | null
  payer_address: string | null
  payee_name: string | null
  payee_tax_id: string | null
  payee_address: string | null
  income_type: string
  income_section: string
  wht_form: 'PND3' | 'PND53' | null
  base_amount: number
  tax_rate: number
  tax_amount: number
  status: 'ISSUED' | 'CANCELLED'
}

interface TaxTransactionLite {
  id: string
  base_amount: number
  tax_amount: number
}

const INCOME_SECTIONS = ['40(2)', '40(3)', '40(4)', '40(6)', '40(7)', '40(8)']

const fmt = (n: number) =>
  (n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ==================== Thai baht-text (ตัวอักษร) ====================
// ponytail: standard bahttext digit-grouping algorithm (groups of 6 -> ล้าน). Covers amounts
// used in practice for a supplier WHT certificate; self-checked in wht-certificate-check.js.

const THAI_DIGITS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า']
const THAI_POSITIONS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน']

function convertIntegerToThai(numStr: string): string {
  let result = ''
  const len = numStr.length
  for (let i = 0; i < len; i++) {
    const digit = Number(numStr[i])
    const position = len - i - 1
    const posInMillion = position % 6
    if (digit !== 0) {
      if (posInMillion === 0 && digit === 1 && i > 0) {
        result += 'เอ็ด'
      } else if (posInMillion === 1 && digit === 2) {
        result += 'ยี่' + THAI_POSITIONS[1]
      } else if (posInMillion === 1 && digit === 1) {
        result += THAI_POSITIONS[1]
      } else {
        result += THAI_DIGITS[digit] + THAI_POSITIONS[posInMillion]
      }
    }
    if (posInMillion === 0 && position > 0) result += 'ล้าน'
  }
  return result
}

export function numberToThaiBaht(amount: number): string {
  const rounded = Math.round((Math.abs(amount) + Number.EPSILON) * 100) / 100
  const baht = Math.floor(rounded)
  const satang = Math.round((rounded - baht) * 100)
  const bahtText = baht === 0 ? 'ศูนย์' : convertIntegerToThai(String(baht))
  const satangText = satang === 0 ? 'ถ้วน' : `${convertIntegerToThai(String(satang))}สตางค์`
  return `${bahtText}บาท${satangText}`
}

// ==================== Action button + issue modal ====================
// Rendered inside Tax.tsx's WHT transactions table as the "ออก 50 ทวิ" action column.

export function WhtCertActionButton({
  txn,
  certs,
  onIssued,
}: {
  txn: TaxTransactionLite
  certs: WhtCertificate[]
  onIssued: () => void
}) {
  const [open, setOpen] = useState(false)
  const [incomeType, setIncomeType] = useState('ค่าบริการ')
  const [incomeSection, setIncomeSection] = useState('40(2)')
  const [saving, setSaving] = useState(false)

  const existing = certs.find((c) => c.tax_transaction_id === txn.id && c.status !== 'CANCELLED')

  if (existing) {
    return (
      <span className="px-2 py-1 rounded text-xs bg-[var(--success-soft)] text-success font-mono whitespace-nowrap">
        {existing.cert_number}
      </span>
    )
  }

  const issue = async () => {
    if (!incomeType.trim()) { toast.error('กรุณาระบุประเภทเงินได้'); return }
    setSaving(true)
    try {
      const res = await api.post(`/wht-certificates/from-transaction/${txn.id}`, { incomeType, incomeSection })
      toast.success(res.data.message)
      setOpen(false)
      onIssued()
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'ออกหนังสือรับรองไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="phopy-btn-secondary text-xs px-2 py-1 whitespace-nowrap">
        ออก 50 ทวิ
      </button>
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="phopy-card p-6 w-full max-w-sm"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-[var(--fg-1)]">ออกหนังสือรับรองหัก ณ ที่จ่าย</h3>
                <button onClick={() => setOpen(false)}><X className="w-5 h-5 text-[var(--fg-4)]" /></button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-sm text-[var(--fg-3)]">ประเภทเงินได้</label>
                  <input
                    value={incomeType}
                    onChange={(e) => setIncomeType(e.target.value)}
                    className="phopy-input w-full mt-1"
                    placeholder="เช่น ค่าบริการ, ค่าเช่า"
                  />
                </div>
                <div>
                  <label className="text-sm text-[var(--fg-3)]">มาตราประเภทเงินได้</label>
                  <select
                    value={incomeSection}
                    onChange={(e) => setIncomeSection(e.target.value)}
                    className="phopy-input w-full mt-1"
                  >
                    {INCOME_SECTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <button disabled={saving} onClick={issue} className="phopy-btn-primary w-full mt-2 disabled:opacity-50">
                  {saving ? 'กำลังออก...' : 'ยืนยันออกหนังสือรับรอง'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}

// ==================== Issued certificates list + print ====================
// Rendered below the WHT transactions table in Tax.tsx.

function PrintableCert({ cert }: { cert: WhtCertificate }) {
  return (
    <div id="wht-print-area" className="hidden print:block p-8 text-black bg-white text-sm">
      <h2 className="text-center text-lg font-bold mb-1">หนังสือรับรองการหักภาษี ณ ที่จ่าย</h2>
      <p className="text-center mb-4">ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</p>
      <p className="mb-2">เลขที่: {cert.cert_number}</p>
      <p className="mb-4">วันที่ออกหนังสือรับรอง: {new Date(cert.issue_date).toLocaleDateString('th-TH')}</p>

      <div className="border border-black p-3 mb-3">
        <p className="font-semibold">ผู้จ่ายเงิน (ผู้มีหน้าที่หักภาษี ณ ที่จ่าย)</p>
        <p>ชื่อ: {cert.payer_name || '-'}</p>
        <p>เลขประจำตัวผู้เสียภาษี: {cert.payer_tax_id || '-'}</p>
        <p>ที่อยู่: {cert.payer_address || '-'}</p>
      </div>

      <div className="border border-black p-3 mb-3">
        <p className="font-semibold">ผู้ถูกหักภาษี ณ ที่จ่าย</p>
        <p>ชื่อ: {cert.payee_name || '-'}</p>
        <p>เลขประจำตัวผู้เสียภาษี: {cert.payee_tax_id || '-'}</p>
        <p>ที่อยู่: {cert.payee_address || '-'}</p>
      </div>

      <table className="w-full border-collapse border border-black mb-3">
        <thead>
          <tr>
            <th className="border border-black p-1">ประเภทเงินได้พึงประเมินที่จ่าย</th>
            <th className="border border-black p-1">มาตรา</th>
            <th className="border border-black p-1">จำนวนเงินที่จ่าย</th>
            <th className="border border-black p-1">อัตราภาษี</th>
            <th className="border border-black p-1">ภาษีที่หักและนำส่ง</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border border-black p-1 text-center">{cert.income_type}</td>
            <td className="border border-black p-1 text-center">{cert.income_section}</td>
            <td className="border border-black p-1 text-right">{fmt(cert.base_amount)}</td>
            <td className="border border-black p-1 text-center">{cert.tax_rate}%</td>
            <td className="border border-black p-1 text-right">{fmt(cert.tax_amount)}</td>
          </tr>
        </tbody>
      </table>

      <p className="mb-1">แบบยื่นรายการที่เกี่ยวข้อง: {cert.wht_form === 'PND3' ? 'ภ.ง.ด.3' : cert.wht_form === 'PND53' ? 'ภ.ง.ด.53' : '-'}</p>
      <p className="mb-6">จำนวนภาษีที่หัก ({fmt(cert.tax_amount)} บาท) ตัวอักษร: {numberToThaiBaht(cert.tax_amount)}</p>

      <div className="flex justify-end mt-12">
        <div className="text-center">
          <p>ลงชื่อ .......................................... ผู้จ่ายเงิน</p>
          <p className="mt-2">( {cert.payer_name || '-'} )</p>
        </div>
      </div>
    </div>
  )
}

export function WhtCertificateList({
  certs,
  onChanged,
}: {
  certs: WhtCertificate[]
  onChanged: () => void
}) {
  const [printCert, setPrintCert] = useState<WhtCertificate | null>(null)

  const handlePrint = (cert: WhtCertificate) => {
    setPrintCert(cert)
    // Wait one tick for the printable node to render before invoking the browser print dialog.
    setTimeout(() => window.print(), 50)
  }

  const handleCancel = async (cert: WhtCertificate) => {
    if (!confirm(`ต้องการยกเลิกหนังสือรับรอง ${cert.cert_number} หรือไม่?`)) return
    try {
      const res = await api.post(`/wht-certificates/${cert.id}/cancel`)
      toast.success(res.data.message)
      onChanged()
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'ยกเลิกไม่สำเร็จ')
    }
  }

  return (
    <div className="phopy-card p-6">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #wht-print-area, #wht-print-area * { visibility: visible; }
          #wht-print-area { position: absolute; top: 0; left: 0; width: 100%; }
        }
      `}</style>

      <h3 className="text-lg font-semibold text-[var(--fg-1)] mb-4">หนังสือรับรองที่ออกแล้ว (50 ทวิ)</h3>
      <div className="overflow-x-auto">
        <table className="phopy-table w-full">
          <thead>
            <tr>
              <th>เลขที่</th>
              <th>วันที่ออก</th>
              <th>ผู้ถูกหัก</th>
              <th>ภาษีที่หัก</th>
              <th>แบบฟอร์ม</th>
              <th>สถานะ</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {certs.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 text-[var(--fg-4)]">ยังไม่มีหนังสือรับรองที่ออก</td></tr>
            ) : (
              certs.map((c) => (
                <tr key={c.id} className={c.status === 'CANCELLED' ? 'opacity-50' : ''}>
                  <td className="font-mono">{c.cert_number}</td>
                  <td>{new Date(c.issue_date).toLocaleDateString('th-TH')}</td>
                  <td>{c.payee_name || '-'}</td>
                  <td className="text-right text-[var(--primary)]">{fmt(c.tax_amount)}</td>
                  <td>
                    <span className="px-2 py-1 rounded text-xs bg-[var(--primary-soft)] text-[var(--primary)]">
                      {c.wht_form === 'PND3' ? 'ภ.ง.ด.3' : c.wht_form === 'PND53' ? 'ภ.ง.ด.53' : '-'}
                    </span>
                  </td>
                  <td>
                    <span className={`px-2 py-1 rounded text-xs ${c.status === 'ISSUED' ? 'bg-[var(--success-soft)] text-success' : 'bg-[var(--surface-sunken)] text-[var(--fg-4)]'}`}>
                      {c.status === 'ISSUED' ? 'ออกแล้ว' : 'ยกเลิกแล้ว'}
                    </span>
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <button onClick={() => handlePrint(c)} className="p-1.5 text-[var(--fg-3)] hover:text-[var(--primary)]" title="พิมพ์">
                      <Printer className="w-4 h-4" />
                    </button>
                    {c.status === 'ISSUED' && (
                      <button onClick={() => handleCancel(c)} className="p-1.5 text-[var(--fg-3)] hover:text-danger" title="ยกเลิก">
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {printCert && <PrintableCert cert={printCert} />}
    </div>
  )
}
