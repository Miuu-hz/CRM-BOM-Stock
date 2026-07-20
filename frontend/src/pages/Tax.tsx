import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Calculator,
  FileText,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Calendar,
  CheckCircle,
  AlertTriangle,
  Download,
  RefreshCw,
  Building2,
  Percent,
  Wallet,
  ArrowRightLeft,
  PieChart,
  Settings,
} from 'lucide-react'
import api from '../services/api'
import { WhtCertActionButton, WhtCertificateList, type WhtCertificate } from './tax/WhtCertificateSection'

// Types
interface TaxDashboard {
  periodId: string
  vat: {
    output: number
    input: number
    undeductible: number
    net: number
  }
  wht: {
    collected: number
    paid: number
    pnd3: number
    pnd53: number
  }
  cit: {
    revenue: number
    expense: number
    netProfit: number
    estimatedTax: number
    taxRate: number
    isSme: boolean
    effectiveRate: number
  }
  alerts: Array<{
    type: 'warning' | 'danger' | 'info'
    message: string
    action: string
  }>
}

interface TaxPeriod {
  id: string
  year: number
  month: number
  period_type: string
  status: string
  vat_due_date: string
  wht_due_date: string
}

interface TaxTransaction {
  id: string
  transaction_type: string
  document_number: string
  document_date: string
  partner_name: string
  description: string
  base_amount: number
  tax_amount: number
  tax_rate?: number
  is_deductible: number
  wht_form?: 'PND3' | 'PND53' | null
}

function Tax() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'vat' | 'wht' | 'cit' | 'filing'>('dashboard')
  const [dashboard, setDashboard] = useState<TaxDashboard | null>(null)
  const [periods, setPeriods] = useState<TaxPeriod[]>([])
  const [transactions, setTransactions] = useState<TaxTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPeriod, setSelectedPeriod] = useState<string>('')
  const [whtCerts, setWhtCerts] = useState<WhtCertificate[]>([])

  useEffect(() => {
    loadData()
  }, [selectedPeriod])

  const loadData = async () => {
    setLoading(true)
    try {
      const [dashboardRes, periodsRes] = await Promise.all([
        api.get('/tax/dashboard', { params: { periodId: selectedPeriod || undefined } }),
        api.get('/tax/periods'),
      ])
      setDashboard(dashboardRes.data.data)
      setPeriods(periodsRes.data.data)
      if (dashboardRes.data.data.periodId && !selectedPeriod) {
        setSelectedPeriod(dashboardRes.data.data.periodId)
      }
    } catch (error) {
      console.error('Failed to load tax data:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadTransactions = async (type?: string) => {
    try {
      const res = await api.get('/tax/transactions', { 
        params: { type, periodId: selectedPeriod } 
      })
      setTransactions(res.data.data)
    } catch (error) {
      console.error('Failed to load transactions:', error)
    }
  }

  const loadWhtCerts = async () => {
    try {
      const res = await api.get('/wht-certificates')
      setWhtCerts(res.data.data)
    } catch (error) {
      console.error('Failed to load WHT certificates:', error)
    }
  }

  const toggleDeductible = async (id: string, current: number) => {
    try {
      await api.patch(`/tax/transactions/${id}/deductible`, { isDeductible: !current })
      await loadTransactions('VAT')
      await loadData()
    } catch (error) {
      console.error('Failed to toggle deductible status:', error)
    }
  }

  const syncTaxData = async () => {
    setLoading(true)
    try {
      await api.post('/tax/sync')
      await loadData()
      if (activeTab === 'vat') await loadTransactions('VAT')
      if (activeTab === 'wht') await loadTransactions('WHT')
    } catch (error) {
      console.error('Failed to sync tax data:', error)
    } finally {
      setLoading(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'OPEN': return 'text-success'
      case 'CLOSED': return 'text-[var(--fg-3)]'
      case 'FILING': return 'text-warning'
      default: return 'text-[var(--fg-3)]'
    }
  }

  const formatCurrency = (amount: number) => {
    return `฿${amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-phopy-indigo"></div>
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--fg-1)] mb-2">
            <span className="text-[var(--fg-1)]">Tax Management</span>
          </h1>
          <p className="text-[var(--fg-3)]">ระบบจัดการภาษีมูลค่าเพิ่ม ภาษีหัก ณ ที่จ่าย และภาษีเงินได้นิติบุคคล</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
            className="phopy-input"
          >
            <option value="">เลือกงวดภาษี</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.month}/{p.year} ({p.period_type})
              </option>
            ))}
          </select>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={loadData}
            className="phopy-btn-secondary flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            รีเฟรช
          </motion.button>
        </div>
      </div>

      {/* Alerts */}
      {dashboard?.alerts && dashboard.alerts.length > 0 && (
        <div className="space-y-2">
          {dashboard.alerts.map((alert, idx) => (
            <div
              key={idx}
              className={`p-4 rounded-lg border ${
                alert.type === 'danger' 
                  ? 'bg-[var(--danger-soft)] border-danger/30' 
                  : alert.type === 'warning'
                  ? 'bg-[var(--warning-soft)] border-warning/30'
                  : 'bg-blue-500/10 border-info/30'
              }`}
            >
              <div className="flex items-center gap-2">
                {alert.type === 'danger' ? (
                  <AlertCircle className="w-5 h-5 text-danger" />
                ) : alert.type === 'warning' ? (
                  <AlertTriangle className="w-5 h-5 text-warning" />
                ) : (
                  <CheckCircle className="w-5 h-5 text-blue-400" />
                )}
                <span className={
                  alert.type === 'danger' 
                    ? 'text-danger' 
                    : alert.type === 'warning'
                    ? 'text-warning'
                    : 'text-blue-400'
                }>
                  {alert.message}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex gap-2 border-b border-[var(--border)] pb-2">
        <TabButton
          active={activeTab === 'dashboard'}
          onClick={() => setActiveTab('dashboard')}
          icon={PieChart}
          label="ภาพรวม"
        />
        <TabButton
          active={activeTab === 'vat'}
          onClick={() => { setActiveTab('vat'); loadTransactions('VAT') }}
          icon={Calculator}
          label="ภาษีมูลค่าเพิ่ม (VAT)"
        />
        <TabButton
          active={activeTab === 'wht'}
          onClick={() => { setActiveTab('wht'); loadTransactions('WHT'); loadWhtCerts() }}
          icon={Wallet}
          label="ภาษีหัก ณ ที่จ่าย (WHT)"
        />
        <TabButton
          active={activeTab === 'cit'}
          onClick={() => setActiveTab('cit')}
          icon={Building2}
          label="ภาษีเงินได้นิติบุคคล (CIT)"
        />
        <TabButton
          active={activeTab === 'filing'}
          onClick={() => setActiveTab('filing')}
          icon={FileText}
          label="การยื่นแบบ"
        />
      </div>

      {/* Dashboard Tab */}
      {activeTab === 'dashboard' && dashboard && (
        <div className="space-y-6">
          {/* VAT Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <TaxCard
              title="ภาษีขาย (Output VAT)"
              amount={dashboard.vat.output}
              icon={TrendingUp}
              color="red"
              description="ภาษีที่เรียกเก็บจากลูกค้า"
            />
            <TaxCard
              title="ภาษีซื้อ (Input VAT)"
              amount={dashboard.vat.input}
              icon={TrendingDown}
              color="green"
              description="ภาษีที่จ่ายให้ผู้ขาย"
            />
            <TaxCard
              title="ภาษีคงเหลือ"
              amount={dashboard.vat.net}
              icon={Calculator}
              color={dashboard.vat.net >= 0 ? 'red' : 'green'}
              description={dashboard.vat.net >= 0 ? 'ต้องนำส่ง' : 'ขอคืนได้'}
            />
            <TaxCard
              title="ภาษีซื้อต้องห้าม"
              amount={dashboard.vat.undeductible}
              icon={AlertCircle}
              color="yellow"
              description="ไม่สามารถนำมาหักได้"
            />
          </div>

          {/* Quick Actions */}
          <div className="phopy-card p-6">
            <h3 className="text-lg font-semibold text-[var(--fg-1)] mb-4 flex items-center gap-2">
              <Settings className="w-5 h-5 text-[var(--primary)]" />
              การดำเนินการด่วน
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <QuickActionButton
                icon={RefreshCw}
                title="ซิงค์ข้อมูลภาษี"
                description="ดึง VAT/WHT จากเอกสารต้นทาง"
                onClick={syncTaxData}
              />
              <QuickActionButton
                icon={ArrowRightLeft}
                title="ซิงค์ข้อมูลการซื้อ"
                description="ดึงข้อมูล WHT จากการจ่ายเงิน"
                onClick={syncTaxData}
              />
              <QuickActionButton
                icon={Download}
                title="ส่งออกรายงาน"
                description="ดาวน์โหลดไฟล์ภ.พ.30, ภ.ง.ด."
                onClick={() => {}}
              />
            </div>
          </div>

          {/* Tax Calendar */}
          <div className="phopy-card p-6">
            <h3 className="text-lg font-semibold text-[var(--fg-1)] mb-4 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-[var(--primary)]" />
              ปฏิทินภาษี
            </h3>
            <div className="space-y-3">
              {periods.slice(0, 6).map((period) => (
                <div
                  key={period.id}
                  className="flex items-center justify-between p-3 bg-[var(--surface-2)] rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${getStatusColor(period.status)}`} />
                    <div>
                      <p className="text-[var(--fg-2)] font-medium">
                        {period.month}/{period.year}
                      </p>
                      <p className="text-[var(--fg-4)] text-sm">{period.period_type}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[var(--fg-3)] text-sm">
                      กำหนดยื่น VAT: {new Date(period.vat_due_date).toLocaleDateString('th-TH')}
                    </p>
                    <p className={`text-sm ${getStatusColor(period.status)}`}>
                      {period.status}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* VAT Tab */}
      {activeTab === 'vat' && (
        <div className="space-y-6">
          <div className="phopy-card p-6">
            <h3 className="text-lg font-semibold text-[var(--fg-1)] mb-4">รายการภาษีมูลค่าเพิ่ม</h3>
            <div className="overflow-x-auto">
              <table className="phopy-table w-full">
                <thead>
                  <tr>
                    <th>วันที่</th>
                    <th>เลขที่เอกสาร</th>
                    <th>คู่ค้า</th>
                    <th>รายละเอียด</th>
                    <th>มูลค่าก่อนภาษี</th>
                    <th>ภาษี</th>
                    <th>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-[var(--fg-4)]">
                        ไม่พบรายการ
                      </td>
                    </tr>
                  ) : (
                    transactions.map((t) => (
                      <tr key={t.id}>
                        <td>{new Date(t.document_date).toLocaleDateString('th-TH')}</td>
                        <td className="font-mono">{t.document_number}</td>
                        <td>{t.partner_name}</td>
                        <td className="max-w-xs truncate">{t.description}</td>
                        <td className="text-right">{formatCurrency(t.base_amount)}</td>
                        <td className="text-right text-[var(--primary)]">{formatCurrency(t.tax_amount)}</td>
                        <td>
                          {t.transaction_type.startsWith('VAT_INPUT') ? (
                            <button
                              onClick={() => toggleDeductible(t.id, t.is_deductible)}
                              className={`px-2 py-1 rounded text-xs hover:opacity-80 transition-opacity ${
                                t.is_deductible
                                  ? 'bg-[var(--success-soft)] text-success'
                                  : 'bg-[var(--warning-soft)] text-warning'
                              }`}
                            >
                              {t.is_deductible ? 'หักได้' : 'หักไม่ได้'}
                            </button>
                          ) : (
                            <span className="px-2 py-1 rounded text-xs bg-[var(--surface-2)] text-[var(--fg-4)]">
                              -
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* WHT Tab */}
      {activeTab === 'wht' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="phopy-card p-6">
              <div className="flex items-center justify-between mb-2">
                <div className="w-12 h-12 rounded-lg bg-[var(--bg)] flex items-center justify-center">
                  <Wallet className="w-6 h-6 text-danger" />
                </div>
              </div>
              <p className="text-sm text-[var(--fg-3)] mb-1">ภาษีหัก ณ ที่จ่าย ที่เราหักคู่ค้า (ต้องนำส่งสรรพากร)</p>
              <p className="text-2xl font-bold text-danger">{formatCurrency(dashboard?.wht.paid || 0)}</p>
              <p className="text-xs text-[var(--fg-4)] mt-1">ยอดที่ต้องนำส่งผ่าน ภ.ง.ด.3 / ภ.ง.ด.53</p>
              <div className="mt-3 pt-3 border-t border-[var(--border)] grid grid-cols-2 gap-2">
                <div>
                  <p className="text-xs text-[var(--fg-4)]">ภ.ง.ด.3</p>
                  <p className="text-sm font-semibold text-[var(--fg-2)]">{formatCurrency(dashboard?.wht.pnd3 || 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--fg-4)]">ภ.ง.ด.53</p>
                  <p className="text-sm font-semibold text-[var(--fg-2)]">{formatCurrency(dashboard?.wht.pnd53 || 0)}</p>
                </div>
              </div>
            </div>
            <TaxCard
              title="ภาษีถูกหัก ณ ที่จ่าย (เครดิตภาษีเงินได้)"
              amount={dashboard?.wht.collected || 0}
              icon={Wallet}
              color="green"
              description="ลูกค้าหักไว้ ใช้เครดิตตอนยื่น ภ.ง.ด.50"
            />
          </div>

          <div className="phopy-card p-6">
            <h3 className="text-lg font-semibold text-[var(--fg-1)] mb-4">รายการภาษีหัก ณ ที่จ่าย</h3>
            <div className="overflow-x-auto">
              <table className="phopy-table w-full">
                <thead>
                  <tr>
                    <th>วันที่</th>
                    <th>เลขที่เอกสาร</th>
                    <th>คู่ค้า</th>
                    <th>รายละเอียด</th>
                    <th>ยอดจ่าย</th>
                    <th>อัตรา WHT</th>
                    <th>ภาษีหัก</th>
                    <th>แบบฟอร์ม</th>
                    <th>50 ทวิ</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center py-8 text-[var(--fg-4)]">
                        ไม่พบรายการ
                      </td>
                    </tr>
                  ) : (
                    transactions.map((t) => (
                      <tr key={t.id}>
                        <td>{new Date(t.document_date).toLocaleDateString('th-TH')}</td>
                        <td className="font-mono">{t.document_number}</td>
                        <td>{t.partner_name}</td>
                        <td className="max-w-xs truncate">{t.description}</td>
                        <td className="text-right">{formatCurrency(t.base_amount)}</td>
                        <td>{t.tax_rate}%</td>
                        <td className="text-right text-[var(--primary)]">{formatCurrency(t.tax_amount)}</td>
                        <td>
                          {t.wht_form ? (
                            <span className="px-2 py-1 rounded text-xs bg-[var(--primary-soft)] text-[var(--primary)]">
                              {t.wht_form === 'PND3' ? 'ภ.ง.ด.3' : 'ภ.ง.ด.53'}
                            </span>
                          ) : (
                            <span className="text-[var(--fg-4)]">-</span>
                          )}
                        </td>
                        <td>
                          <WhtCertActionButton txn={t} certs={whtCerts} onIssued={loadWhtCerts} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <WhtCertificateList certs={whtCerts} onChanged={loadWhtCerts} />
        </div>
      )}

      {/* CIT Tab */}
      {activeTab === 'cit' && (
        <div className="space-y-6">
          <div className="phopy-card p-6">
            <h3 className="text-lg font-semibold text-[var(--fg-1)] mb-4 flex items-center gap-2">
              <Calculator className="w-5 h-5 text-[var(--primary)]" />
              การคำนวณภาษีเงินได้นิติบุคคล (CIT)
            </h3>
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 p-4 bg-[var(--surface-2)] rounded-lg">
                <div>
                  <p className="text-[var(--fg-3)] text-sm">รายได้</p>
                  <p className="text-2xl font-bold text-[var(--fg-1)]">{formatCurrency(dashboard?.cit?.revenue || 0)}</p>
                </div>
                <div>
                  <p className="text-[var(--fg-3)] text-sm">ค่าใช้จ่าย</p>
                  <p className="text-2xl font-bold text-danger">{formatCurrency(dashboard?.cit?.expense || 0)}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 p-4 bg-[var(--surface-2)] rounded-lg">
                <div>
                  <p className="text-[var(--fg-3)] text-sm">กำไรสุทธิตามบัญชี</p>
                  <p className="text-2xl font-bold text-success">{formatCurrency(dashboard?.cit?.netProfit || 0)}</p>
                </div>
                <div>
                  <p className="text-[var(--fg-3)] text-sm">กำไรสุทธิทางภาษี (ประมาณการ — ยังไม่ปรับปรุงรายการบวกกลับ)</p>
                  <p className="text-2xl font-bold text-[var(--primary)]">{formatCurrency(dashboard?.cit?.netProfit || 0)}</p>
                </div>
              </div>

              <div className="p-4 bg-phopy-indigo/10 border border-phopy-indigo/30 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[var(--fg-3)] text-sm">ภาษีเงินได้นิติบุคคลโดยประมาณ</p>
                    <p className="text-3xl font-bold text-[var(--primary)]">{formatCurrency(dashboard?.cit?.estimatedTax || 0)}</p>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-2 justify-end">
                      <p className="text-[var(--fg-3)] text-sm">อัตราภาษีที่แท้จริง</p>
                      {dashboard?.cit?.isSme && (
                        <span className="px-2 py-0.5 rounded text-xs bg-[var(--success-soft)] text-success">SME</span>
                      )}
                    </div>
                    <p className="text-xl font-bold text-[var(--fg-1)]">{(dashboard?.cit?.effectiveRate ?? dashboard?.cit?.taxRate ?? 20).toFixed(2)}%</p>
                  </div>
                </div>
                {dashboard?.cit?.isSme && (
                  <div className="mt-4 pt-4 border-t border-phopy-indigo/20 space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[var(--fg-3)]">กำไรสุทธิ ≤ 300,000 บาท</span>
                      <span className="text-success font-medium">ยกเว้น</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[var(--fg-3)]">300,001 - 3,000,000 บาท</span>
                      <span className="text-[var(--fg-2)] font-medium">15%</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[var(--fg-3)]">มากกว่า 3,000,000 บาท</span>
                      <span className="text-[var(--fg-2)] font-medium">20%</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Tax Optimization Tips */}
          <div className="phopy-card p-6">
            <h3 className="text-lg font-semibold text-[var(--fg-1)] mb-4 flex items-center gap-2">
              <Percent className="w-5 h-5 text-[var(--primary)]" />
              แนะนำการวางแผนภาษี (Tax Optimization)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <OptimizationCard
                title="ค่าอบรมสัมมนา"
                description="หักค่าใช้จ่ายได้ 200% ตามมาตรการส่งเสริมการพัฒนาทักษะ"
                potentialSaving="สูงสุด 200,000 บาท/ปี"
                action="บันทึกค่าอบรม"
              />
              <OptimizationCard
                title="ระบบ Automation"
                description="ลงทุนในเครื่องจักร/ระบบอัตโนมัติ หักได้ 2-3 เท่า"
                potentialSaving="ตามมูลค่าการลงทุน"
                action="ดูรายละเอียด BOI"
              />
              <OptimizationCard
                title="จ้างงานผู้สูงอายุ"
                description="จ้างงานผู้สูงอายุ 60+ ปี หักค่าใช้จ่ายได้เพิ่ม"
                potentialSaving="100% ของค่าจ้าง"
                action="บันทึกค่าจ้าง"
              />
              <OptimizationCard
                title="ค่าเสื่อมราคาเร่งด่วน (SME)"
                description="คอมพิวเตอร์หัก 40% ในปีแรกที่ได้มา"
                potentialSaving="ลดกำไรปีแรก"
                action="ตั้งค่าสินทรัพย์"
              />
            </div>
          </div>
        </div>
      )}

      {/* Filing Tab */}
      {activeTab === 'filing' && (
        <div className="space-y-6">
          <div className="phopy-card p-6">
            <h3 className="text-lg font-semibold text-[var(--fg-1)] mb-4">แบบฟอร์มภาษี</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <FilingCard
                formCode="ภ.พ.30"
                formName="แบบแสดงรายการภาษีมูลค่าเพิ่ม"
                dueDate="15 ของเดือนถัดไป"
                status="pending"
                onGenerate={() => {}}
              />
              <FilingCard
                formCode="ภ.ง.ด.3"
                formName="แบบแสดงรายการภาษีหัก ณ ที่จ่าย (เงินได้ส่วนบุคคล)"
                dueDate="7 ของเดือนถัดไป"
                status="pending"
                onGenerate={() => {}}
              />
              <FilingCard
                formCode="ภ.ง.ด.53"
                formName="แบบแสดงรายการภาษีหัก ณ ที่จ่าย (นิติบุคคล)"
                dueDate="7 ของเดือนถัดไป"
                status="pending"
                onGenerate={() => {}}
              />
              <FilingCard
                formCode="ภ.ง.ด.50"
                formName="แบบแสดงรายการภาษีเงินได้นิติบุคคล"
                dueDate="สิ้นเดือนพฤษภาคม (รอบปี)"
                status="pending"
                onGenerate={() => {}}
              />
              <FilingCard
                formCode="ภ.ง.ด.51"
                formName="แบบแสดงรายการภาษีเงินได้นิติบุคคล (ครึ่งปี)"
                dueDate="สิ้นเดือนสิงหาคม"
                status="pending"
                onGenerate={() => {}}
              />
            </div>
          </div>
        </div>
      )}
    </motion.div>
  )
}

// Component: Tab Button
function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-5 py-3 rounded-t-lg font-semibold transition-all ${
        active
          ? 'bg-[var(--primary-soft)] text-[var(--primary)] border-b-2 border-phopy-indigo'
          : 'text-[var(--fg-3)] hover:text-[var(--fg-2)] hover:bg-[var(--bg)]'
      }`}
    >
      <Icon className="w-5 h-5" />
      <span>{label}</span>
    </button>
  )
}

// Component: Tax Card
function TaxCard({ title, amount, icon: Icon, color, description }: { title: string; amount: number; icon: any; color: string; description: string }) {
  const colorClasses: Record<string, string> = {
    red: 'text-danger',
    green: 'text-success',
    yellow: 'text-warning',
    primary: 'text-[var(--primary)]',
  }

  return (
    <div className="phopy-card p-6">
      <div className="flex items-center justify-between mb-2">
        <div className={`w-12 h-12 rounded-lg bg-[var(--bg)] flex items-center justify-center`}>
          <Icon className={`w-6 h-6 ${colorClasses[color]}`} />
        </div>
      </div>
      <p className="text-sm text-[var(--fg-3)] mb-1">{title}</p>
      <p className={`text-2xl font-bold ${colorClasses[color]}`}>
        ฿{(amount || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </p>
      <p className="text-xs text-[var(--fg-4)] mt-1">{description}</p>
    </div>
  )
}

// Component: Quick Action Button
function QuickActionButton({ icon: Icon, title, description, onClick }: { icon: any; title: string; description: string; onClick: () => void }) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="p-4 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg hover:border-phopy-indigo/50 transition-colors text-left"
    >
      <Icon className="w-8 h-8 text-[var(--primary)] mb-3" />
      <h4 className="text-[var(--fg-2)] font-semibold mb-1">{title}</h4>
      <p className="text-[var(--fg-4)] text-sm">{description}</p>
    </motion.button>
  )
}

// Component: Optimization Card
function OptimizationCard({ title, description, potentialSaving, action }: { title: string; description: string; potentialSaving: string; action: string }) {
  return (
    <div className="p-4 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg">
      <h4 className="text-[var(--primary)] font-semibold mb-2">{title}</h4>
      <p className="text-[var(--fg-3)] text-sm mb-3">{description}</p>
      <div className="flex items-center justify-between">
        <span className="text-success text-sm font-medium">{potentialSaving}</span>
        <button className="text-[var(--primary)] text-sm hover:underline">{action} →</button>
      </div>
    </div>
  )
}

// Component: Filing Card
function FilingCard({ formCode, formName, dueDate, status, onGenerate }: { formCode: string; formName: string; dueDate: string; status: string; onGenerate: () => void }) {
  const statusColors: Record<string, string> = {
    pending: 'bg-[var(--warning-soft)] text-warning',
    ready: 'bg-[var(--info-soft)] text-blue-400',
    submitted: 'bg-[var(--success-soft)] text-success',
  }

  return (
    <div className="p-4 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg">
      <div className="flex items-start justify-between mb-3">
        <div>
          <span className="text-2xl font-bold text-[var(--primary)]">{formCode}</span>
          <span className={`ml-2 px-2 py-0.5 rounded text-xs ${statusColors[status]}`}>
            {status === 'pending' ? 'รอดำเนินการ' : status === 'ready' ? 'พร้อมยื่น' : 'ยื่นแล้ว'}
          </span>
        </div>
      </div>
      <h4 className="text-[var(--fg-2)] font-medium mb-2">{formName}</h4>
      <p className="text-[var(--fg-4)] text-sm mb-4">กำหนดยื่น: {dueDate}</p>
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={onGenerate}
        className="w-full py-2 bg-[var(--primary-soft)] text-[var(--primary)] rounded-lg hover:bg-phopy-indigo/30 transition-colors"
      >
        สร้างแบบฟอร์ม
      </motion.button>
    </div>
  )
}

export default Tax
