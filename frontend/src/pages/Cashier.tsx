import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Store,
  Plus,
  Receipt,
  CreditCard,
  Banknote,
  QrCode,
  Trash2,
  Minus,
  X,
  ChefHat,
  Clock,
  Search,
  Edit2,
  Save,
  Package,
  MoreVertical,
  RotateCcw,
  Check,
} from 'lucide-react'
import toast from 'react-hot-toast'
import posService from '../services/pos.service'
import posBillService from '../services/pos-bill.service'

// ==================== Types ====================

interface POSMenu {
  id: string
  product_id: string
  product_name: string
  product_code: string
  category_id?: string
  category_name?: string
  category_color?: string
  pos_price: number
  is_available: boolean
  preparation_time: number
  description?: string
}

interface POSCategory {
  id: string
  name: string
  color: string
}

interface OpenBill {
  id: string
  bill_number: string
  display_name: string
  customer_name?: string
  total_amount: number
  item_count: number
  opened_at: string
}

interface BillItem {
  id: string
  product_name: string
  quantity: number
  unit_price: number
  total_price: number
  special_instructions?: string
}

interface CurrentBill {
  id: string
  bill_number: string
  display_name: string
  customer_name?: string
  items: BillItem[]
  subtotal: number
  tax_amount: number
  service_charge_amount: number
  total_amount: number
}

// ==================== Components ====================

export default function Cashier() {
  // State
  const [view, setView] = useState<'bills' | 'menu'>('bills')
  const [openBills, setOpenBills] = useState<OpenBill[]>([])
  const [currentBill, setCurrentBill] = useState<CurrentBill | null>(null)
  const [menus, setMenus] = useState<POSMenu[]>([])
  const [categories, setCategories] = useState<POSCategory[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditNameModal, setShowEditNameModal] = useState(false)

  // Fetch data
  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const [billsRes, menusRes, categoriesRes] = await Promise.all([
        posBillService.getOpenBills(),
        posService.getMenuConfigs(),
        posService.getCategories(),
      ])
      
      if (billsRes.success) setOpenBills(billsRes.data || [])
      if (menusRes.success) setMenus((menusRes.data || []).filter((m: POSMenu) => m.is_available))
      if (categoriesRes.success) setCategories(categoriesRes.data || [])
    } catch (error) {
      toast.error('Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Filter menus
  const filteredMenus = menus.filter(item => {
    const matchesCategory = selectedCategory === 'all' || item.category_id === selectedCategory
    const matchesSearch = 
      item.product_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.product_code?.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesCategory && matchesSearch
  })

  // Create new bill
  const createBill = async (displayName?: string) => {
    try {
      const res = await posBillService.createBill({
        display_name: displayName || undefined
      })
      
      if (res.success) {
        toast.success('สร้างบิลใหม่แล้ว')
        await fetchData()
        // Open the new bill
        await openBill(res.data.id)
      }
    } catch (error) {
      toast.error('Failed to create bill')
    }
  }

  // Open bill
  const openBill = async (billId: string) => {
    try {
      const res = await posBillService.getBill(billId)
      if (res.success) {
        setCurrentBill(res.data)
        setView('menu')
      }
    } catch (error) {
      toast.error('Failed to open bill')
    }
  }

  // Add item to bill
  const addToBill = async (menu: POSMenu) => {
    if (!currentBill) return

    try {
      const res = await posBillService.addItem(currentBill.id, {
        pos_menu_id: menu.id,
        quantity: 1
      })

      if (res.success) {
        // Refresh bill data
        const billRes = await posBillService.getBill(currentBill.id)
        if (billRes.success) setCurrentBill(billRes.data)
        toast.success(`เพิ่ม ${menu.product_name}`)
      }
    } catch (error) {
      toast.error('Failed to add item')
    }
  }

  // Update item quantity
  const updateQuantity = async (itemId: string, delta: number, currentQty: number) => {
    if (!currentBill) return
    
    const newQty = currentQty + delta
    if (newQty <= 0) {
      // Delete item
      try {
        await posBillService.deleteItem(currentBill.id, itemId)
        const billRes = await posBillService.getBill(currentBill.id)
        if (billRes.success) setCurrentBill(billRes.data)
      } catch (error) {
        toast.error('Failed to remove item')
      }
      return
    }

    try {
      await posBillService.updateItem(currentBill.id, itemId, { quantity: newQty })
      const billRes = await posBillService.getBill(currentBill.id)
      if (billRes.success) setCurrentBill(billRes.data)
    } catch (error) {
      toast.error('Failed to update quantity')
    }
  }

  // Process payment
  const processPayment = async (method: 'CASH' | 'QR_CODE' | 'CREDIT_CARD') => {
    if (!currentBill) return

    try {
      const res = await posBillService.payBill(currentBill.id, {
        payment_method: method
      })

      if (res.success) {
        toast.success(`ชำระเงินสำเร็จ!`, { icon: '💰' })
        setCurrentBill(null)
        setShowPaymentModal(false)
        setView('bills')
        await fetchData()
      }
    } catch (error) {
      toast.error('Failed to process payment')
    }
  }

  // Cancel bill
  const cancelBill = async () => {
    if (!currentBill) return
    if (!confirm('ยกเลิกบิลนี้? สต็อกจะถูกคืน')) return

    try {
      await posBillService.cancelBill(currentBill.id, { reason: 'Cancelled by cashier' })
      toast.success('ยกเลิกบิลแล้ว')
      setCurrentBill(null)
      setView('bills')
      await fetchData()
    } catch (error) {
      toast.error('Failed to cancel bill')
    }
  }

  // Update bill name
  const updateBillName = async (newName: string) => {
    if (!currentBill || !newName.trim()) return

    try {
      await posBillService.updateBill(currentBill.id, { display_name: newName })
      setCurrentBill({ ...currentBill, display_name: newName })
      await fetchData()
      toast.success('อัปเดตชื่อบิลแล้ว')
    } catch (error) {
      toast.error('Failed to update bill name')
    }
  }

  return (
    <div className="min-h-screen bg-cyber-dark">
      {/* Header */}
      <div className="bg-gradient-card border-b border-cyber-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-gradient-to-br from-cyber-primary to-cyber-purple rounded-xl">
              <Store className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">ระบบขายหน้าร้าน</h1>
              <p className="text-sm text-gray-400">Open Bill / POS</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex bg-cyber-card rounded-lg p-1">
              <button
                onClick={() => setView('bills')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md transition-all ${
                  view === 'bills' 
                    ? 'bg-cyber-primary/20 text-cyber-primary' 
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <Receipt className="w-4 h-4" />
                <span className="hidden sm:inline">บิล ({openBills.length})</span>
              </button>
              <button
                onClick={() => currentBill && setView('menu')}
                disabled={!currentBill}
                className={`flex items-center gap-2 px-4 py-2 rounded-md transition-all ${
                  view === 'menu' 
                    ? 'bg-cyber-primary/20 text-cyber-primary' 
                    : 'text-gray-400 hover:text-white disabled:opacity-50'
                }`}
              >
                <Package className="w-4 h-4" />
                <span className="hidden sm:inline">เมนู</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex h-[calc(100vh-80px)]">
        {/* Left Panel */}
        <div className="flex-1 p-6 overflow-auto">
          <AnimatePresence mode="wait">
            {view === 'bills' ? (
              <motion.div
                key="bills"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                {/* Create Bill Button */}
                <div className="flex justify-between items-center">
                  <h2 className="text-lg font-semibold text-white">บิลที่เปิดอยู่</h2>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setShowCreateModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-cyber-primary to-cyber-purple text-white rounded-lg hover:opacity-90"
                  >
                    <Plus className="w-4 h-4" />
                    สร้างบิลใหม่
                  </motion.button>
                </div>

                {/* Bills Grid */}
                {loading ? (
                  <div className="text-center py-12">
                    <div className="w-8 h-8 border-2 border-cyber-primary border-t-transparent rounded-full animate-spin mx-auto" />
                  </div>
                ) : openBills.length === 0 ? (
                  <div className="text-center py-12 bg-cyber-card border border-cyber-border rounded-xl">
                    <Receipt className="w-12 h-12 mx-auto text-gray-500 mb-3" />
                    <p className="text-gray-400">ยังไม่มีบิล</p>
                    <p className="text-sm text-gray-500 mt-1">สร้างบิลใหม่เพื่อเริ่มขาย</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {openBills.map((bill) => (
                      <motion.button
                        key={bill.id}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => openBill(bill.id)}
                        className={`relative p-4 bg-cyber-card border border-cyber-border rounded-xl text-left hover:border-cyber-primary/50 transition-all ${
                          currentBill?.id === bill.id ? 'ring-2 ring-cyber-primary' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-lg font-bold text-white truncate">
                            {bill.display_name}
                          </span>
                          {bill.item_count > 0 && (
                            <span className="px-2 py-0.5 bg-cyber-primary/20 text-cyber-primary rounded text-xs">
                              {bill.item_count}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500">{bill.bill_number}</p>
                        <p className="text-xl font-bold text-cyber-green mt-2">
                          ฿{bill.total_amount?.toLocaleString() || 0}
                        </p>
                        <div className="flex items-center gap-1 text-xs text-gray-500 mt-2">
                          <Clock className="w-3 h-3" />
                          <span>{new Date(bill.opened_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </motion.button>
                    ))}
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="menu"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                {/* Search & Categories */}
                <div className="space-y-4">
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="text"
                      placeholder="ค้นหาเมนู..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-12 pr-4 py-3 bg-cyber-card border border-cyber-border rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-cyber-primary"
                    />
                  </div>

                  <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                    <button
                      onClick={() => setSelectedCategory('all')}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg whitespace-nowrap transition-all ${
                        selectedCategory === 'all'
                          ? 'bg-gradient-to-r from-cyber-primary to-cyber-purple text-white'
                          : 'bg-cyber-card border border-cyber-border text-gray-400 hover:border-cyber-primary/50'
                      }`}
                    >
                      <span>ทั้งหมด</span>
                    </button>
                    {categories.map((cat) => (
                      <button
                        key={cat.id}
                        onClick={() => setSelectedCategory(cat.id)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg whitespace-nowrap transition-all ${
                          selectedCategory === cat.id
                            ? 'text-white'
                            : 'bg-cyber-card border border-cyber-border text-gray-400 hover:border-cyber-primary/50'
                        }`}
                        style={{
                          background: selectedCategory === cat.id 
                            ? `linear-gradient(135deg, ${cat.color}80, ${cat.color})`
                            : undefined
                        }}
                      >
                        <span>{cat.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Menu Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {filteredMenus.map((menu) => (
                    <motion.button
                      key={menu.id}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => addToBill(menu)}
                      className="p-4 bg-cyber-card border border-cyber-border rounded-xl text-left hover:border-cyber-primary/50 transition-all group"
                    >
                      <div 
                        className="aspect-video rounded-lg mb-3 flex items-center justify-center"
                        style={{ backgroundColor: `${menu.category_color || '#00f0ff'}20` }}
                      >
                        <span className="text-4xl">🍽️</span>
                      </div>
                      <h3 className="font-semibold text-white group-hover:text-cyber-primary transition-colors truncate">
                        {menu.product_name}
                      </h3>
                      <p className="text-xs text-gray-500">{menu.product_code}</p>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-lg font-bold text-cyber-green">
                          ฿{menu.pos_price?.toLocaleString()}
                        </span>
                        {menu.preparation_time > 0 && (
                          <span className="text-xs text-gray-500">{menu.preparation_time}m</span>
                        )}
                      </div>
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right Panel - Current Bill */}
        <div className="w-full md:w-[400px] bg-cyber-card border-l border-cyber-border flex flex-col">
          {currentBill ? (
            <>
              {/* Bill Header */}
              <div className="p-4 border-b border-cyber-border">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold text-white truncate">{currentBill.display_name}</h2>
                      <button
                        onClick={() => setShowEditNameModal(true)}
                        className="p-1 rounded hover:bg-cyber-dark text-gray-400 hover:text-cyber-primary"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="text-sm text-gray-400">{currentBill.bill_number}</p>
                  </div>
                  <button
                    onClick={() => setCurrentBill(null)}
                    className="p-2 rounded-lg hover:bg-cyber-dark text-gray-400 hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Bill Items */}
              <div className="flex-1 overflow-auto p-4 space-y-3">
                {currentBill.items.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>ยังไม่มีรายการ</p>
                    <p className="text-sm mt-1">เลือกเมนูเพื่อเพิ่ม</p>
                  </div>
                ) : (
                  currentBill.items.map((item) => (
                    <motion.div
                      key={item.id}
                      layout
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="p-3 bg-cyber-dark rounded-lg group"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h4 className="font-medium text-white">{item.product_name}</h4>
                          {item.special_instructions && (
                            <p className="text-xs text-gray-500 mt-1">{item.special_instructions}</p>
                          )}
                          <div className="flex items-center gap-4 mt-2">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => updateQuantity(item.id, -1, item.quantity)}
                                className="p-1 rounded bg-cyber-card hover:bg-cyber-primary/20 text-cyber-primary"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <span className="w-6 text-center text-sm">{item.quantity}</span>
                              <button
                                onClick={() => updateQuantity(item.id, 1, item.quantity)}
                                className="p-1 rounded bg-cyber-card hover:bg-cyber-primary/20 text-cyber-primary"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                            <span className="text-sm text-cyber-green">
                              ฿{item.total_price.toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>

              {/* Bill Footer */}
              <div className="p-4 border-t border-cyber-border space-y-3">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between text-gray-400">
                    <span>ยอดรวม</span>
                    <span>฿{currentBill.subtotal.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Service Charge (10%)</span>
                    <span>฿{currentBill.service_charge_amount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>VAT (7%)</span>
                    <span>฿{currentBill.tax_amount.toLocaleString()}</span>
                  </div>
                  <div className="border-t border-cyber-border pt-2 flex justify-between text-lg font-bold">
                    <span className="text-white">ยอดสุทธิ</span>
                    <span className="text-cyber-green">฿{currentBill.total_amount.toLocaleString()}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={cancelBill}
                    className="px-4 py-3 rounded-lg border border-red-500/50 text-red-400 hover:bg-red-500/10 transition-all"
                  >
                    ยกเลิก
                  </button>
                  <button
                    onClick={() => fetchData()}
                    className="px-4 py-3 rounded-lg bg-cyber-dark text-gray-400 hover:text-white transition-all"
                  >
                    <RotateCcw className="w-4 h-4 mx-auto" />
                  </button>
                </div>
                <button
                  onClick={() => setShowPaymentModal(true)}
                  disabled={currentBill.items.length === 0}
                  className="w-full px-4 py-4 rounded-xl bg-gradient-to-r from-cyber-primary to-cyber-purple text-white font-semibold hover:opacity-90 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <CreditCard className="w-5 h-5" />
                  ชำระเงิน
                </button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-500 p-8">
              <Receipt className="w-16 h-16 mb-4 opacity-30" />
              <p className="text-lg font-medium">เลือกบิลหรือสร้างบิลใหม่</p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="mt-6 px-6 py-3 rounded-xl bg-cyber-primary/20 text-cyber-primary hover:bg-cyber-primary/30 transition-all flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                สร้างบิลใหม่
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Create Bill Modal */}
      <CreateBillModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={createBill}
      />

      {/* Edit Name Modal */}
      <EditNameModal
        isOpen={showEditNameModal}
        onClose={() => setShowEditNameModal(false)}
        currentName={currentBill?.display_name || ''}
        onSave={updateBillName}
      />

      {/* Payment Modal */}
      <PaymentModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        total={currentBill?.total_amount || 0}
        onPay={processPayment}
      />
    </div>
  )
}

// ==================== Sub Components ====================

function CreateBillModal({ isOpen, onClose, onCreate }: { 
  isOpen: boolean
  onClose: () => void
  onCreate: (name?: string) => void
}) {
  const [name, setName] = useState('')

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-cyber-card border border-cyber-border rounded-2xl w-full max-w-md p-6"
      >
        <h2 className="text-xl font-bold text-white mb-4">สร้างบิลใหม่</h2>
        <input
          type="text"
          placeholder="ชื่อบิล (เว้นว่างได้)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-4 py-3 bg-cyber-dark border border-cyber-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-cyber-primary mb-4"
        />
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-gray-400 hover:text-white transition-colors"
          >
            ยกเลิก
          </button>
          <button
            onClick={() => {
              onCreate(name || undefined)
              setName('')
              onClose()
            }}
            className="flex-1 px-4 py-2 bg-gradient-to-r from-cyber-primary to-cyber-purple text-white rounded-lg hover:opacity-90"
          >
            สร้าง
          </button>
        </div>
      </motion.div>
    </div>
  )
}

function EditNameModal({ isOpen, onClose, currentName, onSave }: {
  isOpen: boolean
  onClose: () => void
  currentName: string
  onSave: (name: string) => void
}) {
  const [name, setName] = useState(currentName)

  useEffect(() => {
    setName(currentName)
  }, [currentName, isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-cyber-card border border-cyber-border rounded-2xl w-full max-w-md p-6"
      >
        <h2 className="text-xl font-bold text-white mb-4">แก้ไขชื่อบิล</h2>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-4 py-3 bg-cyber-dark border border-cyber-border rounded-lg text-white focus:outline-none focus:border-cyber-primary mb-4"
        />
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-gray-400 hover:text-white transition-colors"
          >
            ยกเลิก
          </button>
          <button
            onClick={() => {
              onSave(name)
              onClose()
            }}
            className="flex-1 px-4 py-2 bg-gradient-to-r from-cyber-primary to-cyber-purple text-white rounded-lg hover:opacity-90"
          >
            บันทึก
          </button>
        </div>
      </motion.div>
    </div>
  )
}

function PaymentModal({ isOpen, onClose, total, onPay }: {
  isOpen: boolean
  onClose: () => void
  total: number
  onPay: (method: 'CASH' | 'QR_CODE' | 'CREDIT_CARD') => void
}) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-cyber-card border border-cyber-border rounded-2xl max-w-md w-full p-6"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">ชำระเงิน</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-cyber-dark text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="text-center py-6 bg-cyber-dark rounded-xl mb-6">
          <p className="text-gray-400 mb-2">ยอดที่ต้องชำระ</p>
          <p className="text-4xl font-bold text-cyber-green">฿{total.toLocaleString()}</p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <button onClick={() => onPay('CASH')} className="p-4 bg-cyber-dark rounded-xl border border-cyber-border hover:border-cyber-primary/50 flex flex-col items-center gap-2">
            <Banknote className="w-8 h-8 text-green-400" />
            <span className="text-sm text-gray-300">เงินสด</span>
          </button>
          <button onClick={() => onPay('QR_CODE')} className="p-4 bg-cyber-dark rounded-xl border border-cyber-border hover:border-cyber-primary/50 flex flex-col items-center gap-2">
            <QrCode className="w-8 h-8 text-cyber-primary" />
            <span className="text-sm text-gray-300">QR Code</span>
          </button>
          <button onClick={() => onPay('CREDIT_CARD')} className="p-4 bg-cyber-dark rounded-xl border border-cyber-border hover:border-cyber-primary/50 flex flex-col items-center gap-2">
            <CreditCard className="w-8 h-8 text-purple-400" />
            <span className="text-sm text-gray-300">บัตรเครดิต</span>
          </button>
        </div>
      </motion.div>
    </div>
  )
}
