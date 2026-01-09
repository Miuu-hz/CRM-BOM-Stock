import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Users,
  Search,
  Plus,
  Filter,
  MoreVertical,
  Phone,
  Mail,
  MapPin,
  Building2,
} from 'lucide-react'

interface Customer {
  id: string
  name: string
  type: 'hotel' | 'retail' | 'wholesale'
  contact: string
  email: string
  phone: string
  location: string
  totalOrders: number
  totalRevenue: string
  creditLimit: string
  status: 'active' | 'inactive'
}

const customers: Customer[] = [
  {
    id: 'CUS-001',
    name: 'Hotel Grand Deluxe',
    type: 'hotel',
    contact: 'John Smith',
    email: 'john@hotelgrand.com',
    phone: '+66 2-345-6789',
    location: 'Bangkok',
    totalOrders: 45,
    totalRevenue: '฿2.5M',
    creditLimit: '฿500K',
    status: 'active',
  },
  {
    id: 'CUS-002',
    name: 'ABC Trading Co.',
    type: 'wholesale',
    contact: 'Sarah Johnson',
    email: 'sarah@abctrading.com',
    phone: '+66 2-456-7890',
    location: 'Chiang Mai',
    totalOrders: 32,
    totalRevenue: '฿1.8M',
    creditLimit: '฿300K',
    status: 'active',
  },
  {
    id: 'CUS-003',
    name: 'Resort Paradise',
    type: 'hotel',
    contact: 'Mike Wilson',
    email: 'mike@resortparadise.com',
    phone: '+66 76-234-567',
    location: 'Phuket',
    totalOrders: 28,
    totalRevenue: '฿1.5M',
    creditLimit: '฿400K',
    status: 'active',
  },
  {
    id: 'CUS-004',
    name: 'Sleep Well Store',
    type: 'retail',
    contact: 'Emma Davis',
    email: 'emma@sleepwell.com',
    phone: '+66 2-567-8901',
    location: 'Bangkok',
    totalOrders: 18,
    totalRevenue: '฿850K',
    creditLimit: '฿150K',
    status: 'active',
  },
]

function CRM() {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedType, setSelectedType] = useState<string>('all')

  const filteredCustomers = customers.filter((customer) => {
    const matchesSearch =
      customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer.contact.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesType = selectedType === 'all' || customer.type === selectedType
    return matchesSearch && matchesType
  })

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-100 mb-2 font-['Orbitron']">
            <span className="neon-text">Customer Management</span>
          </h1>
          <p className="text-gray-400">
            Manage your customers and relationships
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="cyber-btn-primary flex items-center gap-2"
        >
          <Plus className="w-5 h-5" />
          Add Customer
        </motion.button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard
          label="Total Customers"
          value="1,248"
          icon={Users}
          color="primary"
        />
        <StatCard
          label="Active Accounts"
          value="1,156"
          icon={Building2}
          color="green"
        />
        <StatCard
          label="Total Revenue"
          value="฿8.2M"
          icon={Users}
          color="purple"
        />
        <StatCard
          label="Avg. Order Value"
          value="฿62.5K"
          icon={Users}
          color="primary"
        />
      </div>

      {/* Filters and Search */}
      <div className="cyber-card p-6">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search customers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="cyber-input pl-10 w-full"
            />
          </div>

          {/* Type Filter */}
          <div className="flex gap-2">
            <button
              onClick={() => setSelectedType('all')}
              className={`px-4 py-2 rounded-lg transition-all ${
                selectedType === 'all'
                  ? 'bg-cyber-primary/20 text-cyber-primary border border-cyber-primary/50'
                  : 'bg-cyber-darker text-gray-400 border border-cyber-border hover:border-cyber-primary/30'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setSelectedType('hotel')}
              className={`px-4 py-2 rounded-lg transition-all ${
                selectedType === 'hotel'
                  ? 'bg-cyber-primary/20 text-cyber-primary border border-cyber-primary/50'
                  : 'bg-cyber-darker text-gray-400 border border-cyber-border hover:border-cyber-primary/30'
              }`}
            >
              Hotels
            </button>
            <button
              onClick={() => setSelectedType('wholesale')}
              className={`px-4 py-2 rounded-lg transition-all ${
                selectedType === 'wholesale'
                  ? 'bg-cyber-primary/20 text-cyber-primary border border-cyber-primary/50'
                  : 'bg-cyber-darker text-gray-400 border border-cyber-border hover:border-cyber-primary/30'
              }`}
            >
              Wholesale
            </button>
            <button
              onClick={() => setSelectedType('retail')}
              className={`px-4 py-2 rounded-lg transition-all ${
                selectedType === 'retail'
                  ? 'bg-cyber-primary/20 text-cyber-primary border border-cyber-primary/50'
                  : 'bg-cyber-darker text-gray-400 border border-cyber-border hover:border-cyber-primary/30'
              }`}
            >
              Retail
            </button>
          </div>
        </div>
      </div>

      {/* Customers List */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filteredCustomers.map((customer, index) => (
          <CustomerCard key={customer.id} customer={customer} index={index} />
        ))}
      </div>
    </motion.div>
  )
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string
  value: string
  icon: any
  color: string
}) {
  return (
    <div className="cyber-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-400 mb-1">{label}</p>
          <p className="text-2xl font-bold text-cyber-primary font-['Orbitron']">
            {value}
          </p>
        </div>
        <Icon className="w-8 h-8 text-cyber-primary/50" />
      </div>
    </div>
  )
}

function CustomerCard({
  customer,
  index,
}: {
  customer: Customer
  index: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      whileHover={{ scale: 1.02 }}
      className="cyber-card p-6 glow-effect"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-cyber-primary to-cyber-purple flex items-center justify-center shadow-neon">
            <Building2 className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-100">{customer.name}</h3>
            <p className="text-sm text-gray-400">{customer.id}</p>
          </div>
        </div>
        <button className="p-2 rounded-lg hover:bg-cyber-card/50 transition-colors">
          <MoreVertical className="w-5 h-5 text-gray-400" />
        </button>
      </div>

      <div className="space-y-3 mb-4">
        <div className="flex items-center gap-2 text-sm">
          <Users className="w-4 h-4 text-cyber-primary" />
          <span className="text-gray-400">Contact:</span>
          <span className="text-gray-300">{customer.contact}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Mail className="w-4 h-4 text-cyber-primary" />
          <span className="text-gray-400">{customer.email}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Phone className="w-4 h-4 text-cyber-primary" />
          <span className="text-gray-400">{customer.phone}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="w-4 h-4 text-cyber-primary" />
          <span className="text-gray-400">{customer.location}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 pt-4 border-t border-cyber-border">
        <div>
          <p className="text-xs text-gray-400 mb-1">Orders</p>
          <p className="text-sm font-semibold text-cyber-primary">
            {customer.totalOrders}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">Revenue</p>
          <p className="text-sm font-semibold text-cyber-green">
            {customer.totalRevenue}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">Credit</p>
          <p className="text-sm font-semibold text-cyber-purple">
            {customer.creditLimit}
          </p>
        </div>
      </div>
    </motion.div>
  )
}

export default CRM
