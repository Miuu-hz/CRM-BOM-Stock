import { motion } from 'framer-motion'
import { ShoppingCart, ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export interface Order {
  id?: string
  so_number?: string
  customer?: string
  customer_name?: string
  product?: string
  product_name?: string
  quantity?: number
  item_count?: number
  amount?: string | number
  total_amount?: string | number
  total?: string | number
  status?: string
  date?: string
  order_date?: string
  created_at?: string
}

export interface RecentOrdersProps {
  orders?: Order[]
  onViewAll?: () => void
}

const defaultOrders: Order[] = [
  {
    id: 'ORD-1234',
    so_number: 'SO-2024-001',
    customer: 'Hotel Grand',
    customer_name: 'Hotel Grand',
    product: 'King Size Mattress',
    product_name: 'King Size Mattress',
    quantity: 50,
    item_count: 50,
    amount: '฿125,000',
    total_amount: 125000,
    status: 'PROCESSING',
    date: '2024-01-15',
  },
  {
    id: 'ORD-1233',
    so_number: 'SO-2024-002',
    customer: 'ABC Trading',
    customer_name: 'ABC Trading',
    product: 'Pillow Set',
    product_name: 'Pillow Set',
    quantity: 200,
    item_count: 200,
    amount: '฿80,000',
    total_amount: 80000,
    status: 'COMPLETED',
    date: '2024-01-14',
  },
  {
    id: 'ORD-1232',
    so_number: 'SO-2024-003',
    customer: 'Resort Paradise',
    customer_name: 'Resort Paradise',
    product: 'Queen Mattress',
    product_name: 'Queen Mattress',
    quantity: 30,
    item_count: 30,
    amount: '฿60,000',
    total_amount: 60000,
    status: 'DRAFT',
    date: '2024-01-14',
  },
  {
    id: 'ORD-1231',
    so_number: 'SO-2024-004',
    customer: 'Mall Store',
    customer_name: 'Mall Store',
    product: 'Blanket Premium',
    product_name: 'Blanket Premium',
    quantity: 100,
    item_count: 100,
    amount: '฿35,000',
    total_amount: 35000,
    status: 'CONFIRMED',
    date: '2024-01-13',
  },
]

function formatAmount(order: Order): string {
  const val = order.total_amount ?? order.amount ?? order.total
  if (val === undefined || val === null || val === '') return '-'
  if (typeof val === 'number') {
    return `฿${val.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
  }
  const num = Number(val)
  if (!isNaN(num) && typeof val === 'string' && !val.includes('฿') && !val.includes(',')) {
    return `฿${num.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
  }
  return String(val)
}

function RecentOrders({ orders: propOrders, onViewAll }: RecentOrdersProps = {}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const displayOrders = propOrders || defaultOrders

  const handleNavigate = () => {
    if (onViewAll) {
      onViewAll()
    } else {
      navigate('/sales')
    }
  }

  return (
    <div className="phopy-card p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ShoppingCart className="w-6 h-6 text-[var(--primary)]" />
          <h2 className="text-xl font-bold text-[var(--fg-1)]">
            {t('dashboard.recentOrders.title', 'คำสั่งขายล่าสุด')}
          </h2>
        </div>
        <button
          onClick={handleNavigate}
          className="text-sm text-[var(--primary)] hover:text-phopy-indigo-600 transition-colors flex items-center gap-1 group cursor-pointer"
        >
          {t('dashboard.recentOrders.viewAll', 'ดูทั้งหมด')}
          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="phopy-table">
          <thead>
            <tr>
              <th>{t('dashboard.recentOrders.orderId', 'เลขที่คำสั่งขาย')}</th>
              <th>{t('dashboard.recentOrders.customer', 'ลูกค้า')}</th>
              <th>{t('dashboard.recentOrders.product', 'สินค้า')}</th>
              <th>{t('dashboard.recentOrders.quantity', 'จำนวน')}</th>
              <th>{t('dashboard.recentOrders.amount', 'ยอดเงิน')}</th>
              <th>{t('dashboard.recentOrders.statusHeader', 'สถานะ')}</th>
            </tr>
          </thead>
          <tbody>
            {(displayOrders || []).map((order, index) => {
              const orderId = order.so_number || order.id || '-'
              const customerName = order.customer_name || order.customer || '-'
              const productName = order.product_name || order.product || '-'
              const quantityDisplay = order.item_count !== undefined
                ? `${order.item_count} รายการ`
                : (order.quantity !== undefined ? order.quantity : '-')

              return (
                <motion.tr
                  key={order.id || order.so_number || index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  onClick={handleNavigate}
                  className="cursor-pointer hover:bg-[var(--surface-2)]/50 transition-colors"
                >
                  <td>
                    <span className="text-[var(--primary)] font-semibold font-mono">
                      {orderId}
                    </span>
                  </td>
                  <td>
                    <span className="text-[var(--fg-2)]">{customerName}</span>
                  </td>
                  <td>
                    <span className="text-[var(--fg-3)]">{productName}</span>
                  </td>
                  <td>
                    <span className="text-[var(--fg-3)]">{quantityDisplay}</span>
                  </td>
                  <td>
                    <span className="text-success font-semibold">
                      {formatAmount(order)}
                    </span>
                  </td>
                  <td>
                    <StatusBadge status={order.status} />
                  </td>
                </motion.tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const statusConfig: Record<string, { className: string; labelKey?: string; defaultLabel: string }> = {
  DRAFT: {
    className: 'bg-[var(--warning-soft)] text-warning border-warning/30',
    labelKey: 'dashboard.recentOrders.status.draft',
    defaultLabel: 'ฉบับร่าง',
  },
  CONFIRMED: {
    className: 'bg-[var(--info-soft)] text-info border-info/30',
    labelKey: 'dashboard.recentOrders.status.confirmed',
    defaultLabel: 'ยืนยันแล้ว',
  },
  APPROVED: {
    className: 'bg-[var(--success-soft)] text-success border-success/30',
    labelKey: 'dashboard.recentOrders.status.approved',
    defaultLabel: 'อนุมัติแล้ว',
  },
  PROCESSING: {
    className: 'bg-[var(--primary-soft)] text-[var(--primary)] border-phopy-indigo/30',
    labelKey: 'dashboard.recentOrders.status.processing',
    defaultLabel: 'กำลังดำเนินการ',
  },
  DELIVERED: {
    className: 'bg-[var(--info-soft)] text-info border-info/30',
    labelKey: 'dashboard.recentOrders.status.delivered',
    defaultLabel: 'จัดส่งแล้ว',
  },
  COMPLETED: {
    className: 'bg-[var(--success-soft)] text-success border-success/30',
    labelKey: 'dashboard.recentOrders.status.completed',
    defaultLabel: 'เสร็จสมบูรณ์',
  },
  CANCELLED: {
    className: 'bg-[var(--danger-soft)] text-danger border-danger/30',
    labelKey: 'dashboard.recentOrders.status.cancelled',
    defaultLabel: 'ยกเลิก',
  },
  PENDING: {
    className: 'bg-[var(--warning-soft)] text-warning border-warning/30',
    labelKey: 'dashboard.recentOrders.status.pending',
    defaultLabel: 'รอดำเนินการ',
  },
}

const fallbackConfig = {
  className: 'bg-[var(--surface-2)] text-[var(--fg-3)] border-[var(--border)]',
  defaultLabel: 'ไม่ระบุ',
}

function StatusBadge({ status }: { status?: string }) {
  const { t } = useTranslation()
  const s = (status || '').toUpperCase().trim()
  const config = statusConfig[s] || fallbackConfig
  const label = config.labelKey ? t(config.labelKey, config.defaultLabel) : (status || config.defaultLabel)

  return (
    <span className={`status-badge ${config.className}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      {label}
    </span>
  )
}

export default RecentOrders
