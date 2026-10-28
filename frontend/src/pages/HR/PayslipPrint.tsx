import { useEffect, useState } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { Printer, ArrowLeft, X } from 'lucide-react'
import hrService, { PayrollRunLine, PayrollSlipLine } from '../../services/hr.service'
import companySettingsService from '../../services/companySettings.service'

interface PayslipPrintProps {
  slips?: PayrollRunLine[]
  period?: string
  payDate?: string | null
  companyName?: string
  onClose?: () => void
}

const fmt = (n: number | undefined | null) =>
  Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function PayslipPrint(props: PayslipPrintProps) {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()

  const [slips, setSlips] = useState<PayrollRunLine[]>(props.slips || [])
  const [period, setPeriod] = useState<string>(props.period || '')
  const [payDate, setPayDate] = useState<string | null>(props.payDate ?? null)
  const [companyName, setCompanyName] = useState<string>(props.companyName || '')
  const [loading, setLoading] = useState<boolean>(!props.slips && Boolean(id))

  useEffect(() => {
    if (props.slips) {
      setSlips(props.slips)
      if (props.period) setPeriod(props.period)
      if (props.payDate !== undefined) setPayDate(props.payDate)
    }
  }, [props.slips, props.period, props.payDate])

  useEffect(() => {
    if (!props.companyName) {
      companySettingsService
        .get()
        .then((s) => {
          if (s?.name) {
            setCompanyName(s.name)
          }
        })
        .catch(() => {})
    }
  }, [props.companyName])

  useEffect(() => {
    if (!props.slips && id) {
      setLoading(true)
      hrService
        .getPayrollRunSlips(id)
        .then((res) => {
          const params = new URLSearchParams(location.search)
          const lineId = params.get('lineId')
          const list = lineId ? (res.slips || []).filter((s: PayrollRunLine) => s.id === lineId) : res.slips || []
          setSlips(list)
          setPeriod(res.period || res.run?.period || '')
          setPayDate(res.pay_date ?? res.run?.pay_date ?? null)
        })
        .catch(() => {})
        .finally(() => setLoading(false))
    }
  }, [id, props.slips, location.search])

  const content = (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-2">
          {props.onClose ? (
            <button
              type="button"
              onClick={props.onClose}
              className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border)] text-[var(--fg-2)] flex items-center gap-1.5"
            >
              <X className="w-4 h-4" />
              ปิดหน้าต่าง
            </button>
          ) : (
            <button
              type="button"
              onClick={() => navigate('/hr/payroll')}
              className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border)] text-[var(--fg-2)] flex items-center gap-1.5"
            >
              <ArrowLeft className="w-4 h-4" />
              กลับหน้ารอบเงินเดือน
            </button>
          )}
          <span className="text-sm text-[var(--fg-3)]">
            สลิปเงินเดือน งวด {period} ({slips.length} รายการ)
          </span>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="phopy-btn-primary px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2"
        >
          <Printer className="w-4 h-4" />
          สั่งพิมพ์ (Print)
        </button>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-[var(--fg-3)]">กำลังโหลดสลิปเงินเดือน...</div>
      ) : slips.length === 0 ? (
        <div className="p-8 text-center text-sm text-[var(--fg-3)]">ไม่พบข้อมูลสลิปเงินเดือน</div>
      ) : (
        <div className="space-y-6 print:space-y-4">
          {slips.map((slip) => {
            const res = slip.result
            const slipLines: PayrollSlipLine[] = res?.lines || []
            const earningLines = slipLines.filter((l: PayrollSlipLine) => l.amount >= 0)
            const deductionLines = slipLines.filter((l: PayrollSlipLine) => l.amount < 0)

            return (
              <div
                key={slip.id}
                className="max-w-xl mx-auto bg-white text-slate-900 border border-slate-300 rounded-xl p-6 shadow-sm print:shadow-none print:break-inside-avoid"
              >
                <div className="flex items-start justify-between border-b border-slate-200 pb-3 mb-4">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      {companyName || 'ใบแจ้งยอดเงินเดือน (Pay Slip)'}
                    </h2>
                    <p className="text-xs text-slate-500">ใบแจ้งรายการเงินได้และรายการหัก (Pay Slip)</p>
                  </div>
                  <div className="text-right text-xs text-slate-600">
                    <div>
                      <span className="font-semibold">งวดเดือน:</span> {period || slip.period || '-'}
                    </div>
                    {payDate && (
                      <div>
                        <span className="font-semibold">วันที่จ่าย:</span> {payDate}
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs mb-4 bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <div>
                    <span className="text-slate-500">รหัส / ชื่อ-สกุล: </span>
                    <span className="font-semibold text-slate-900">
                      {slip.code || slip.employee_code || ''} {slip.first_name} {slip.last_name || ''}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">แผนก / ตำแหน่ง: </span>
                    <span className="font-semibold text-slate-900">
                      {slip.org_unit_name || '-'} {slip.position ? `(${slip.position})` : ''}
                    </span>
                  </div>
                  {slip.bank_account && (
                    <div className="col-span-2">
                      <span className="text-slate-500">บัญชีรับเงิน: </span>
                      <span className="font-mono text-slate-800">
                        {slip.bank_name ? `${slip.bank_name} ` : ''}
                        {slip.bank_account}
                      </span>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4 text-xs">
                  {/* Earnings */}
                  <div className="border border-slate-200 rounded-lg p-3 flex flex-col justify-between">
                    <div>
                      <div className="font-bold text-slate-700 border-b border-slate-200 pb-1.5 mb-2">
                        รายการเงินได้ (Earnings)
                      </div>
                      <div className="space-y-1.5">
                        {earningLines.length > 0 ? (
                          earningLines.map((item: PayrollSlipLine, idx: number) => (
                            <div key={idx} className="flex justify-between">
                              <span>{item.label}</span>
                              <span className="font-mono">{fmt(item.amount)}</span>
                            </div>
                          ))
                        ) : (
                          <>
                            <div className="flex justify-between">
                              <span>ค่าจ้าง ({res?.basePay ?? fmt(slip.base_wage)})</span>
                              <span className="font-mono">{fmt(res?.basePay)}</span>
                            </div>
                            {Number(res?.otPay || 0) > 0 && (
                              <div className="flex justify-between">
                                <span>ค่าล่วงเวลา (OT)</span>
                                <span className="font-mono">{fmt(res?.otPay)}</span>
                              </div>
                            )}
                            {Number(res?.payItemsTotal || 0) > 0 && (
                              <div className="flex justify-between">
                                <span>สวัสดิการและเงินได้อื่น</span>
                                <span className="font-mono">{fmt(res?.payItemsTotal)}</span>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="border-t border-slate-200 pt-2 mt-3 flex justify-between font-semibold text-slate-900">
                      <span>รวมเงินได้</span>
                      <span className="font-mono">{fmt(slip.gross)}</span>
                    </div>
                  </div>

                  {/* Deductions */}
                  <div className="border border-slate-200 rounded-lg p-3 flex flex-col justify-between">
                    <div>
                      <div className="font-bold text-slate-700 border-b border-slate-200 pb-1.5 mb-2">
                        รายการหัก (Deductions)
                      </div>
                      <div className="space-y-1.5">
                        {deductionLines.length > 0 ? (
                          deductionLines.map((ded: PayrollSlipLine, idx: number) => (
                            <div key={idx} className="flex justify-between">
                              <span>{ded.label}</span>
                              <span className="font-mono">{fmt(Math.abs(ded.amount))}</span>
                            </div>
                          ))
                        ) : (
                          <>
                            {slip.late > 0 && (
                              <div className="flex justify-between">
                                <span>หักมาสาย</span>
                                <span className="font-mono">{fmt(slip.late)}</span>
                              </div>
                            )}
                            <div className="flex justify-between">
                              <span>ประกันสังคม (สปส.)</span>
                              <span className="font-mono">{fmt(slip.sso_employee)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>ภาษีหัก ณ ที่จ่าย (ภ.ง.ด.1)</span>
                              <span className="font-mono">{fmt(slip.wht)}</span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="border-t border-slate-200 pt-2 mt-3 flex justify-between font-semibold text-slate-900">
                      <span>รวมรายการหัก</span>
                      <span className="font-mono">
                        {fmt(slip.late + slip.sso_employee + slip.wht + slip.other_deduction)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t-2 border-slate-800 flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-900">เงินได้สุทธิ (Net Pay)</span>
                  <span className="text-lg font-bold font-mono text-emerald-700">{fmt(slip.net)} บาท</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  if (props.onClose) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 overflow-y-auto p-4 print:static print:bg-transparent print:p-0">
        <div className="max-w-3xl mx-auto bg-[var(--surface)] rounded-xl p-6 shadow-xl print:shadow-none print:p-0 print:bg-transparent">
          {content}
        </div>
      </div>
    )
  }

  return <div className="p-6">{content}</div>
}
