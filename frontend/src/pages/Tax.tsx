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
import api from '../utils/api'

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
}

function Tax() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'vat' | 'wht' | 'cit' | 'filing'>('dashboard')
  const [dashboard, setDashboard] = useState<TaxDashboard | null>(null)
  const [periods, setPeriods] = useState<TaxPeriod[]>([])
  const [transactions, setTransactions] = useState<TaxTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPeriod, setSelectedPeriod] = useState<string>('')

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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'OPEN': return 'text-green-400'
      case 'CLOSED': return 'text-gray-400'
      case 'FILING': return 'text-yellow-400'
      default: return 'text-gray-400'
    }
  }

  const formatCurrency = (amount: number) => {
    return `฿${amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyber-primary"></div>
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
          <h1 className="text-3xl font-bold text-gray-100 mb-2">
            <span className="neon-text">Tax Management</span>
          </h1>
          <p className="text-gray-400">ระบบจัดการภาษีมูลค่าเพิ่ม ภาษีหัก ณ ที่จ่าย และภาษีเงินได้นิติบุคคล</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
            className="cyber-input"
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
            className="cyber-btn-secondary flex items-center gap-2"
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
                  ? 'bg-red-500/10 border-red-500/30' 
                  : alert.type === 'warning'
                  ? 'bg-yellow-500/10 border-yellow-500/30'
                  : 'bg-blue-500/10 border-blue-500/30'
              }`}
            >
              <div className="flex items-center gap-2">
                {alert.type === 'danger' ? (
                  <AlertCircle className="w-5 h-5 text-red-400" />
                ) : alert.type === 'warning' ? (
                  <AlertTriangle className="w-5 h-5 text-yellow-400" />
                ) : (
                  <CheckCircle className="w-5 h-5 text-blue-400" />
                )}
                <span className={
                  alert.type === 'danger' 
                    ? 'text-red-400' 
                    : alert.type === 'warning'
                    ? 'text-yellow-400'
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
      <div className="flex gap-2 border-b border-cyber-border pb-2">
        <TabButton
          active={activeTab === 'dashboard'}
          onClick={() => setActiveTab('dashboard')}
          icon={PieChart}
          label="ภาพรวม"
        />
        <TabButton
          active={activeTab === 'vat'}
          onClick={() => { setActiveTab('vat'); loadTransactions('VAT_OUTPUT') }}
          icon={Calculator}
          label="ภาษีมูลค่าเพิ่ม (VAT)"
        />
        <TabButton
          active={activeTab === 'wht'}
          onClick={() => { setActiveTab('wht'); loadTransactions('WHT') }}
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
          <div className="cyber-card p-6">
            <h3 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
              <Settings className="w-5 h-5 text-cyber-primary" />
              การดำเนินการด่วน
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <QuickActionButton
                icon={RefreshCw}
                title="ซิงค์ข้อมูลจากใบแจ้งหนี้"
                description="ดึงข้อมูล VAT จาก Sales Invoices"
                onClick={() => {}}
              />
              <QuickActionButton
                icon={ArrowRightLeft}
                title="ซิงค์ข้อมูลจากการซื้อ"
                description="ดึงข้อมูล WHT จาก Purchase Orders"
                onClick={() => {}}
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
          <div className="cyber-card p-6">
            <h3 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-cyber-primary" />
              ปฏิทินภาษี
            </h3>
            <div className="space-y-3">
              {periods.slice(0, 6).map((period) => (
                <div
                  key={period.id}
                  className="flex items-center justify-between p-3 bg-cyber-darker rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${getStatusColor(period.status)}`} />
                    <div>
                      <p className="text-gray-200 font-medium">
                        {period.month}/{period.year}
                      </p>
                      <p className="text-gray-500 text-sm">{period.period_type}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-gray-400 text-sm">
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
          <div className="cyber-card p-6">
            <h3 className="text-lg font-semibold text-gray-100 mb-4">รายการภาษีมูลค่าเพิ่ม</h3>
            <div className="overflow-x-auto">
              <table className="cyber-table w-full">
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
                      <td colSpan={7} className="text-center py-8 text-gray-500">
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
                        <td className="text-right text-cyber-primary">{formatCurrency(t.tax_amount)}</td>
                        <td>
                          <span className={`px-2 py-1 rounded text-xs ${
                            t.is_deductible 
                              ? 'bg-green-500/20 text-green-400' 
                              : 'bg-yellow-500/20 text-yellow-400'
                          }`}>
                            {t.is_deductible ? 'หักได้' : 'หักไม่ได้'}
                          </span>
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <TaxCard
              title="ภาษีหักได้รับ"
              amount={dashboard?.wht.collected || 0}
              icon={Wallet}
              color="green"
              description="ภาษีหักจากลูกค้า"
            />
            <TaxCard
              title="ภาษีหักจ่ายไป"
              amount={dashboard?.wht.paid || 0}
              icon={Wallet}
              color="red"
              description="ภาษีหักให้ผู้ขาย"
            />
            <TaxCard
              title="สุทธิ"
              amount={(dashboard?.wht.collected || 0) - (dashboard?.wht.paid || 0)}
              icon={Calculator}
              color="primary"
              description="ยอดคงเหลือ"
            />
          </div>

          <div className="cyber-card p-6">
            <h3 className="text-lg font-semibold text-gray-100 mb-4">รายการภาษีหัก ณ ที่จ่าย</h3>
            <div className="overflow-x-auto">
              <table className="cyber-table w-full">
                <thead>
                  <tr>
                    <th>วันที่</th>
                    <th>เลขที่เอกสาร</th>
                    <th>คู่ค้า</th>
                    <th>รายละเอียด</th>
                    <th>ยอดจ่าย</th>
                    <th>อัตรา WHT</th>
                    <th>ภาษีหัก</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-gray-500">
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
                        <td className="text-right text-cyber-primary">{formatCurrency(t.tax_amount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* CIT Tab */}
      {activeTab === 'cit' && (
        <div className="space-y-6">
          <div className="cyber-card p-6">
            <h3 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
              <Calculator className="w-5 h-5 text-cyber-primary" />
              การคำนวณภาษีเงินได้นิติบุคคล (CIT)
            </h3>
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 p-4 bg-cyber-darker rounded-lg">
                <div>
                  <p className="text-gray-400 text-sm">กำไรสุทธิตามบัญชี</p>
                  <p className="text-2xl font-bold text-gray-100">{formatCurrency(0)}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-sm">ปรับปรุงเพิ่ม (Add-backs)</p>
                  <p className="text-2xl font-bold text-red-400">{formatCurrency(0)}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 p-4 bg-cyber-darker rounded-lg">
                <div>
                  <p className="text-gray-400 text-sm">หักค่าใช้จ่ายเพิ่ม (Double Deductions)</p>
                  <p className="text-2xl font-bold text-green-400">{formatCurrency(0)}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-sm">กำไรสุทธิทางภาษี</p>
                  <p className="text-2xl font-bold text-cyber-primary">{formatCurrency(0)}</p>
                </div>
              </div>

              <div className="p-4 bg-cyber-primary/10 border border-cyber-primary/30 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-400 text-sm">ภาษีเงินได้นิติบุคคลโดยประมาณ</p>
                    <p className="text-3xl font-bold text-cyber-primary">{formatCurrency(0)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-gray-400 text-sm">อัตราภาษี</p>
                    <p className="text-xl font-bold text-gray-100">20%</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Tax Optimization Tips */}
          <div className="cyber-card p-6">
            <h3 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
              <Percent className="w-5 h-5 text-cyber-primary" />
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
          <div className="cyber-card p-6">
            <h3 className="text-lg font-semibold text-gray-100 mb-4">แบบฟอร์มภาษี</h3>
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
          ? 'bg-cyber-primary/20 text-cyber-primary border-b-2 border-cyber-primary'
          : 'text-gray-400 hover:text-gray-300 hover:bg-cyber-dark'
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
    red: 'text-red-400',
    green: 'text-green-400',
    yellow: 'text-yellow-400',
    primary: 'text-cyber-primary',
  }

  return (
    <div className="cyber-card p-6">
      <div className="flex items-center justify-between mb-2">
        <div className={`w-12 h-12 rounded-lg bg-cyber-dark flex items-center justify-center`}>
          <Icon className={`w-6 h-6 ${colorClasses[color]}`} />
        </div>
      </div>
      <p className="text-sm text-gray-400 mb-1">{title}</p>
      <p className={`text-2xl font-bold ${colorClasses[color]}`}>
        ฿{(amount || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </p>
      <p className="text-xs text-gray-500 mt-1">{description}</p>
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
      className="p-4 bg-cyber-darker border border-cyber-border rounded-lg hover:border-cyber-primary/50 transition-colors text-left"
    >
      <Icon className="w-8 h-8 text-cyber-primary mb-3" />
      <h4 className="text-gray-200 font-semibold mb-1">{title}</h4>
      <p className="text-gray-500 text-sm">{description}</p>
    </motion.button>
  )
}

// Component: Optimization Card
function OptimizationCard({ title, description, potentialSaving, action }: { title: string; description: string; potentialSaving: string; action: string }) {
  return (
    <div className="p-4 bg-cyber-darker border border-cyber-border rounded-lg">
      <h4 className="text-cyber-primary font-semibold mb-2">{title}</h4>
      <p className="text-gray-400 text-sm mb-3">{description}</p>
      <div className="flex items-center justify-between">
        <span className="text-green-400 text-sm font-medium">{potentialSaving}</span>
        <button className="text-cyber-primary text-sm hover:underline">{action} →</button>
      </div>
    </div>
  )
}

// Component: Filing Card
function FilingCard({ formCode, formName, dueDate, status, onGenerate }: { formCode: string; formName: string; dueDate: string; status: string; onGenerate: () => void }) {
  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-500/20 text-yellow-400',
    ready: 'bg-blue-500/20 text-blue-400',
    submitted: 'bg-green-500/20 text-green-400',
  }

  return (
    <div className="p-4 bg-cyber-darker border border-cyber-border rounded-lg">
      <div className="flex items-start justify-between mb-3">
        <div>
          <span className="text-2xl font-bold text-cyber-primary">{formCode}</span>
          <span className={`ml-2 px-2 py-0.5 rounded text-xs ${statusColors[status]}`}>
            {status === 'pending' ? 'รอดำเนินการ' : status === 'ready' ? 'พร้อมยื่น' : 'ยื่นแล้ว'}
          </span>
        </div>
      </div>
      <h4 className="text-gray-200 font-medium mb-2">{formName}</h4>
      <p className="text-gray-500 text-sm mb-4">กำหนดยื่น: {dueDate}</p>
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={onGenerate}
        className="w-full py-2 bg-cyber-primary/20 text-cyber-primary rounded-lg hover:bg-cyber-primary/30 transition-colors"
      >
        สร้างแบบฟอร์ม
      </motion.button>
    </div>
  )
}

export default Tax
