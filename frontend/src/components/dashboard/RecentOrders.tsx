import { motion } from 'framer-motion'
import { ShoppingCart, ArrowRight } from 'lucide-react'

interface Order {
  id: string
  customer: string
  product: string
  quantity: number
  amount: string
  status: 'pending' | 'processing' | 'completed'
  date: string
}

const orders: Order[] = [
  {
    id: 'ORD-1234',
    customer: 'Hotel Grand',
    product: 'King Size Mattress',
    quantity: 50,
    amount: '฿125,000',
    status: 'processing',
    date: '2024-01-15',
  },
  {
    id: 'ORD-1233',
    customer: 'ABC Trading',
    product: 'Pillow Set',
    quantity: 200,
    amount: '฿80,000',
    status: 'completed',
    date: '2024-01-14',
  },
  {
    id: 'ORD-1232',
    customer: 'Resort Paradise',
    product: 'Queen Mattress',
    quantity: 30,
    amount: '฿60,000',
    status: 'pending',
    date: '2024-01-14',
  },
  {
    id: 'ORD-1231',
    customer: 'Mall Store',
    product: 'Blanket Premium',
    quantity: 100,
    amount: '฿35,000',
    status: 'completed',
    date: '2024-01-13',
  },
]

function RecentOrders() {
  return (
    <div className="phopy-card p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ShoppingCart className="w-6 h-6 text-phopy-indigo" />
          <h2 className="text-xl font-bold text-[var(--fg-1)]">
            Recent Orders
          </h2>
        </div>
        <button className="text-sm text-phopy-indigo hover:text-phopy-indigo-600 transition-colors flex items-center gap-1 group">
          View All
          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="phopy-table">
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Customer</th>
              <th>Product</th>
              <th>Quantity</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(orders || []).map((order, index) => (
              <motion.tr
                key={order.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <td>
                  <span className="text-phopy-indigo font-semibold">
                    {order.id}
                  </span>
                </td>
                <td>
                  <span className="text-[var(--fg-2)]">{order.customer}</span>
                </td>
                <td>
                  <span className="text-[var(--fg-3)]">{order.product}</span>
                </td>
                <td>
                  <span className="text-[var(--fg-3)]">{order.quantity}</span>
                </td>
                <td>
                  <span className="text-success font-semibold">
                    {order.amount}
                  </span>
                </td>
                <td>
                  <StatusBadge status={order.status} />
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: Order['status'] }) {
  const statusConfig = {
    pending: {
      label: 'Pending',
      className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    },
    processing: {
      label: 'Processing',
      className: 'bg-phopy-indigo-50 text-phopy-indigo border-phopy-indigo/30',
    },
    completed: {
      label: 'Completed',
      className: 'bg-success-soft text-success border-success/30',
    },
  }

  const config = statusConfig[status]

  return (
    <span className={`status-badge ${config.className}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      {config.label}
    </span>
  )
}

export default RecentOrders
