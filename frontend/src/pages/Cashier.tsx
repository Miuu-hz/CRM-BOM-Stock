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
  Settings,
  Tag,
  ChevronDown,
  ChevronUp,
  UserPlus,
  Star,
  UserX,
  Printer,
} from 'lucide-react'
import toast from 'react-hot-toast'
import posService from '../services/pos.service'
import posBillService from '../services/pos-bill.service'
import kdsService from '../services/kds.service'
import { loadBillingConfig, type BillingConfig, loadLoyaltyConfig, type LoyaltyConfig, loadShopConfig } from './Settings'
import { printPOSReceipt } from '../utils/purchasePrint'
import { useModalClose } from '../hooks/useModalClose'

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
  image_url?: string
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
  sent_to_kds: boolean
}

interface CRMCustomer {
  id: string
  code: string
  name: string
  phone: string
  loyalty_points: number
  total_spent: number
}

interface CurrentBill {
  id: string
  bill_number: string
  display_name: string
  customer_id?: string
  customer_name?: string
  customer_phone?: string
  customer_loyalty_points?: number
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
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [showAssignMemberModal, setShowAssignMemberModal] = useState(false)
  const [scanningBarcode, setScanningBarcode] = useState(false)
  // Discount & extra charge (local, per-session)
  const [discount, setDiscount] = useState<{ type: 'pct' | 'fixed'; value: number }>({ type: 'pct', value: 0 })
  const [extraCharge, setExtraCharge] = useState<{ label: string; amount: number }>({ label: 'ค่าบริการอื่น', amount: 0 })
  const [expandedRow, setExpandedRow] = useState<'discount' | 'extra' | null>(null)
  const [billing, setBilling] = useState<BillingConfig>(loadBillingConfig)
  const [loyalty, setLoyalty] = useState<LoyaltyConfig>(loadLoyaltyConfig)

  // Reload billing & loyalty config when window gains focus (user may have changed settings)
  useEffect(() => {
    const onFocus = () => {
      setBilling(loadBillingConfig())
      setLoyalty(loadLoyaltyConfig())
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
  const [sendingToKitchen, setSendingToKitchen] = useState(false)

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

  // GS1 Barcode search
  const handleGs1Search = async (barcode: string) => {
    if (!barcode || barcode.length < 8) return
    
    setScanningBarcode(true)
    try {
      const res = await posBillService.searchByGs1Barcode(barcode)
      if (res.success && res.data) {
        // Check if menu already exists in list
        const existingMenu = menus.find(m => m.id === res.data.id)
        if (!existingMenu) {
          // Add to menus list temporarily
          const newMenu: POSMenu = {
            id: res.data.id,
            product_id: res.data.product_id,
            product_name: res.data.product_name,
            product_code: res.data.product_code,
            category_id: res.data.category_id,
            category_name: res.data.category_name,
            category_color: res.data.category_color,
            pos_price: res.data.pos_price,
            is_available: true,
            preparation_time: 0,
          }
          setMenus(prev => [...prev, newMenu])
        }
        
        // Add to bill if there's a current bill
        if (currentBill) {
          const menuToAdd = menus.find(m => m.id === res.data.id) || {
            id: res.data.id,
            product_id: res.data.product_id,
            product_name: res.data.product_name,
            product_code: res.data.product_code,
            category_id: res.data.category_id,
            category_name: res.data.category_name,
            category_color: res.data.category_color,
            pos_price: res.data.pos_price,
            is_available: true,
            preparation_time: 0,
          }
          await addToBill(menuToAdd as POSMenu)
          toast.success(`เพิ่ม ${res.data.product_name} แล้ว`)
        } else {
          toast.success(`พบสินค้า: ${res.data.product_name} (กรุณาเปิดบิลก่อน)`)
        }
        setSearchQuery('')
      } else {
        toast.error(res.message || 'ไม่พบสินค้าสำหรับ barcode นี้')
      }
    } catch (error) {
      toast.error('ไม่พบสินค้าสำหรับ barcode นี้')
    } finally {
      setScanningBarcode(false)
    }
  }

  // Handle search input change with GS1 detection
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSearchQuery(value)
    
    // Auto-detect GS1 barcode (numeric only, 8-14 digits)
    if (/^\d{8,14}$/.test(value)) {
      handleGs1Search(value)
    }
  }

  // Create new bill
  const createBill = async (displayName?: string, customerId?: string) => {
    try {
      const res = await posBillService.createBill({
        display_name: displayName || undefined,
        customer_id: customerId || undefined,
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

  // Build receipt data for printing
  const buildReceiptData = (bill: any, method: string, cashReceived?: number, discountAmt = 0) => {
    const shop = loadShopConfig()
    const subtotal = bill.subtotal || 0
    const serviceAmt = billing.serviceEnabled ? Math.round(subtotal * billing.serviceRate / 100) : 0
    const vatAmt = billing.vatEnabled ? Math.round(subtotal * billing.vatRate / 100) : 0
    const total = subtotal + serviceAmt + vatAmt - discountAmt
    return {
      ...bill,
      service_charge_amount: serviceAmt,
      tax_amount: vatAmt,
      total_amount: total,
      _shopName: shop.name,
      _shopAddress: shop.address,
      _shopPhone: shop.phone,
      _shopTaxId: shop.taxId,
      _shopFooter: shop.footer,
      _vatEnabled: billing.vatEnabled,
      _vatRate: billing.vatRate,
      _serviceEnabled: billing.serviceEnabled,
      _serviceRate: billing.serviceRate,
      _paymentMethod: method,
      _cashReceived: cashReceived || 0,
      _discountAmount: discountAmt,
    }
  }

  // Process payment
  const processPayment = async (method: 'CASH' | 'QR_CODE' | 'CREDIT_CARD', redeemPoints?: number, cashReceived?: number) => {
    if (!currentBill) return

    try {
      const res = await posBillService.payBill(currentBill.id, {
        payment_method: method,
        earn_rate: loyalty.enabled ? loyalty.earnRate : undefined,
        redeem_points: loyalty.enabled && redeemPoints ? redeemPoints : undefined,
      })

      if (res.success) {
        const earned = res.data?.points_earned || 0
        const redeemed = res.data?.points_redeemed || 0
        if (earned > 0 && redeemed > 0) {
          toast.success(`ชำระเงินสำเร็จ! แลก ${redeemed.toLocaleString()} แต้ม + สะสม +${earned.toLocaleString()} แต้ม`, { icon: '⭐' })
        } else if (earned > 0) {
          toast.success(`ชำระเงินสำเร็จ! สะสมแต้ม +${earned.toLocaleString()} แต้ม`, { icon: '⭐' })
        } else {
          toast.success(`ชำระเงินสำเร็จ!`, { icon: '💰' })
        }
        // Auto-print thermal receipt after payment
        const receiptData = buildReceiptData(currentBill, method, cashReceived)
        printPOSReceipt(receiptData, 'thermal')
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

  // Send unsent items to KDS
  const sendToKitchen = async () => {
    if (!currentBill) return
    setSendingToKitchen(true)
    try {
      const result = await kdsService.sendToKitchen(currentBill.id)
      toast.success(`ส่งครัวแล้ว ${result.item_count} รายการ (รอบที่ ${result.round})`, { icon: '🍳' })
      const billRes = await posBillService.getBill(currentBill.id)
      if (billRes.success) setCurrentBill(billRes.data)
    } catch {
      toast.error('ส่งครัวไม่สำเร็จ')
    } finally {
      setSendingToKitchen(false)
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
                      placeholder="ค้นหาเมนู หรือสแกน barcode..."
                      value={searchQuery}
                      onChange={handleSearchChange}
                      disabled={scanningBarcode}
                      className="w-full pl-12 pr-12 py-3 bg-cyber-card border border-cyber-border rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-cyber-primary disabled:opacity-50"
                    />
                    {scanningBarcode && (
                      <div className="absolute right-4 top-1/2 -translate-y-1/2">
                        <div className="w-5 h-5 border-2 border-cyber-primary border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex gap-2 overflow-x-auto flex-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
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
                    <button
                      onClick={() => setShowCategoryModal(true)}
                      className="flex-shrink-0 p-2 rounded-lg bg-cyber-card border border-cyber-border text-gray-400 hover:border-cyber-primary/50 hover:text-cyber-primary transition-all"
                      title="จัดการหมวดหมู่"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
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
                        className="aspect-video rounded-lg mb-3 flex items-center justify-center overflow-hidden"
                        style={{ backgroundColor: `${menu.category_color || '#00f0ff'}20` }}
                      >
                        {menu.image_url ? (
                          <img src={menu.image_url} alt={menu.product_name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-4xl">🍽️</span>
                        )}
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
                {/* Member row */}
                {currentBill.customer_id ? (
                  <div className="mt-2 flex items-center justify-between bg-cyber-primary/10 border border-cyber-primary/30 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Star className="w-4 h-4 text-yellow-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">{currentBill.customer_name}</p>
                        <p className="text-xs text-gray-400">{currentBill.customer_phone} · แต้ม <span className="text-cyber-primary font-medium">{(currentBill.customer_loyalty_points ?? 0).toLocaleString()}</span></p>
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          await posBillService.assignMember(currentBill.id, null)
                          const r = await posBillService.getBill(currentBill.id)
                          if (r.success) setCurrentBill(r.data)
                        } catch { toast.error('ยกเลิกสมาชิกไม่สำเร็จ') }
                      }}
                      className="p-1 rounded text-gray-500 hover:text-red-400 shrink-0"
                      title="ยกเลิกสมาชิก"
                    >
                      <UserX className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowAssignMemberModal(true)}
                    className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-dashed border-cyber-border text-xs text-gray-500 hover:text-cyber-primary hover:border-cyber-primary/40 transition-colors"
                  >
                    <UserPlus className="w-3.5 h-3.5" /> + สมาชิก
                  </button>
                )}
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
              {(() => {
                const subtotal = currentBill.subtotal
                const serviceAmt = billing.serviceEnabled ? Math.round(subtotal * billing.serviceRate / 100) : 0
                const vatAmt = billing.vatEnabled ? Math.round(subtotal * billing.vatRate / 100) : 0
                const beforeDiscount = subtotal + serviceAmt + vatAmt
                const discountAmt = discount.type === 'pct'
                  ? Math.round(beforeDiscount * discount.value / 100)
                  : discount.value
                const finalTotal = Math.max(0, beforeDiscount - discountAmt + extraCharge.amount)
                return (
                  <div className="p-4 border-t border-cyber-border space-y-3">
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between text-gray-400">
                        <span>ยอดรวม</span>
                        <span>฿{subtotal.toLocaleString()}</span>
                      </div>
                      {billing.serviceEnabled && (
                        <div className="flex justify-between text-blue-400">
                          <span>Service Charge ({billing.serviceRate}%)</span>
                          <span>+฿{serviceAmt.toLocaleString()}</span>
                        </div>
                      )}
                      {billing.vatEnabled && (
                        <div className="flex justify-between text-yellow-400">
                          <span>VAT ({billing.vatRate}%)</span>
                          <span>+฿{vatAmt.toLocaleString()}</span>
                        </div>
                      )}

                      {/* Discount row */}
                      <div className="border-t border-cyber-border/50 pt-1">
                        <button
                          className="w-full flex items-center justify-between py-1 text-yellow-400 hover:text-yellow-300 transition-colors"
                          onClick={() => setExpandedRow(expandedRow === 'discount' ? null : 'discount')}
                        >
                          <span className="flex items-center gap-1">
                            <Tag className="w-3.5 h-3.5" />
                            ส่วนลด
                            {discount.value > 0 && (
                              <span className="text-xs text-yellow-500">
                                ({discount.type === 'pct' ? `${discount.value}%` : `฿${discount.value}`})
                              </span>
                            )}
                          </span>
                          <span className="flex items-center gap-1">
                            {discountAmt > 0 && <span className="text-yellow-400">-฿{discountAmt.toLocaleString()}</span>}
                            {expandedRow === 'discount' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </span>
                        </button>
                        {expandedRow === 'discount' && (
                          <div className="mt-1 flex gap-2 items-center">
                            <div className="flex rounded-lg overflow-hidden border border-cyber-border text-xs">
                              <button
                                onClick={() => setDiscount(d => ({ ...d, type: 'pct' }))}
                                className={`px-2 py-1 transition-colors ${discount.type === 'pct' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-cyber-dark text-gray-400'}`}
                              >%</button>
                              <button
                                onClick={() => setDiscount(d => ({ ...d, type: 'fixed' }))}
                                className={`px-2 py-1 transition-colors ${discount.type === 'fixed' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-cyber-dark text-gray-400'}`}
                              >฿</button>
                            </div>
                            <div className="flex gap-1 flex-1">
                              {discount.type === 'pct'
                                ? [5, 10, 15, 20].map(p => (
                                    <button key={p}
                                      onClick={() => { setDiscount({ type: 'pct', value: p }); setExpandedRow(null) }}
                                      className={`flex-1 py-1 rounded text-xs transition-colors ${discount.value === p ? 'bg-yellow-500/30 text-yellow-300' : 'bg-cyber-dark text-gray-400 hover:text-yellow-400'}`}
                                    >{p}%</button>
                                  ))
                                : (
                                  <input
                                    type="number"
                                    min={0}
                                    placeholder="จำนวน ฿"
                                    value={discount.value || ''}
                                    onChange={e => setDiscount(d => ({ ...d, value: Number(e.target.value) || 0 }))}
                                    onKeyDown={e => e.key === 'Enter' && setExpandedRow(null)}
                                    autoFocus
                                    className="flex-1 px-2 py-1 bg-cyber-dark border border-cyber-border rounded text-sm text-white focus:outline-none focus:border-yellow-500"
                                  />
                                )
                              }
                            </div>
                            {discount.value > 0 && (
                              <button onClick={() => { setDiscount({ type: 'pct', value: 0 }); setExpandedRow(null) }}
                                className="text-gray-500 hover:text-red-400 text-xs">ล้าง</button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Extra charge row */}
                      <div>
                        <button
                          className="w-full flex items-center justify-between py-1 text-blue-400 hover:text-blue-300 transition-colors"
                          onClick={() => setExpandedRow(expandedRow === 'extra' ? null : 'extra')}
                        >
                          <span className="flex items-center gap-1">
                            <Plus className="w-3.5 h-3.5" />
                            {extraCharge.amount > 0 ? extraCharge.label : 'เพิ่มค่าบริการ'}
                          </span>
                          <span className="flex items-center gap-1">
                            {extraCharge.amount > 0 && <span className="text-blue-400">+฿{extraCharge.amount.toLocaleString()}</span>}
                            {expandedRow === 'extra' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </span>
                        </button>
                        {expandedRow === 'extra' && (
                          <div className="mt-1 flex gap-2 items-center">
                            <input
                              type="text"
                              placeholder="ชื่อ"
                              value={extraCharge.label}
                              onChange={e => setExtraCharge(c => ({ ...c, label: e.target.value }))}
                              className="flex-1 px-2 py-1 bg-cyber-dark border border-cyber-border rounded text-sm text-white focus:outline-none focus:border-blue-500"
                            />
                            <input
                              type="number"
                              min={0}
                              placeholder="฿"
                              value={extraCharge.amount || ''}
                              onChange={e => setExtraCharge(c => ({ ...c, amount: Number(e.target.value) || 0 }))}
                              onKeyDown={e => e.key === 'Enter' && setExpandedRow(null)}
                              autoFocus
                              className="w-20 px-2 py-1 bg-cyber-dark border border-cyber-border rounded text-sm text-white focus:outline-none focus:border-blue-500"
                            />
                            {extraCharge.amount > 0 && (
                              <button onClick={() => { setExtraCharge({ label: 'ค่าบริการอื่น', amount: 0 }); setExpandedRow(null) }}
                                className="text-gray-500 hover:text-red-400 text-xs">ล้าง</button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Grand total */}
                      <div className="border-t border-cyber-border pt-2 flex justify-between text-lg font-bold">
                        <span className="text-white">ยอดสุทธิ</span>
                        <span className="text-cyber-green">฿{finalTotal.toLocaleString()}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={cancelBill}
                        className="px-3 py-3 rounded-lg border border-red-500/50 text-red-400 hover:bg-red-500/10 transition-all text-sm"
                      >
                        ยกเลิก
                      </button>
                      {(() => {
                        const unsentCount = currentBill.items.filter(i => !i.sent_to_kds).length
                        return (
                          <button
                            onClick={sendToKitchen}
                            disabled={sendingToKitchen || unsentCount === 0}
                            className="relative px-3 py-3 rounded-lg bg-orange-500/20 border border-orange-500/50 text-orange-400 hover:bg-orange-500/30 transition-all disabled:opacity-40 flex items-center justify-center gap-1 text-sm"
                          >
                            {sendingToKitchen
                              ? <div className="w-4 h-4 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
                              : <ChefHat className="w-4 h-4" />
                            }
                            ครัว
                            {unsentCount > 0 && (
                              <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-orange-500 text-white text-xs flex items-center justify-center font-bold">
                                {unsentCount}
                              </span>
                            )}
                          </button>
                        )
                      })()}
                      <button
                        onClick={() => fetchData()}
                        className="px-3 py-3 rounded-lg bg-cyber-dark text-gray-400 hover:text-white transition-all"
                      >
                        <RotateCcw className="w-4 h-4 mx-auto" />
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowPaymentModal(true)}
                        disabled={currentBill.items.length === 0}
                        className="flex-1 px-4 py-4 rounded-xl bg-gradient-to-r from-cyber-primary to-cyber-purple text-white font-semibold hover:opacity-90 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        <CreditCard className="w-5 h-5" />
                        ชำระเงิน ฿{finalTotal.toLocaleString()}
                      </button>
                      <button
                        onClick={() => {
                          const rd = buildReceiptData(currentBill, 'CASH', 0, discountAmt)
                          printPOSReceipt(rd, 'thermal')
                        }}
                        disabled={currentBill.items.length === 0}
                        title="ใบเสร็จฉบับย่อ (80mm)"
                        className="px-3 py-4 rounded-xl bg-cyber-dark border border-cyber-border text-gray-400 hover:text-yellow-400 hover:border-yellow-400/50 transition-all disabled:opacity-50 flex flex-col items-center gap-0.5"
                      >
                        <Printer className="w-4 h-4" />
                        <span className="text-[9px] leading-none">ย่อ</span>
                      </button>
                      <button
                        onClick={() => {
                          const rd = buildReceiptData(currentBill, 'CASH', 0, discountAmt)
                          printPOSReceipt(rd, 'a4')
                        }}
                        disabled={currentBill.items.length === 0}
                        title={billing.vatEnabled ? 'ใบกำกับภาษี A4' : 'ใบเสร็จรับเงิน A4'}
                        className="px-3 py-4 rounded-xl bg-cyber-dark border border-cyber-border text-gray-400 hover:text-cyber-primary hover:border-cyber-primary/50 transition-all disabled:opacity-50 flex flex-col items-center gap-0.5"
                      >
                        <Printer className="w-4 h-4" />
                        <span className="text-[9px] leading-none">A4</span>
                      </button>
                    </div>
                  </div>
                )
              })()}
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

      {/* Assign Member Modal */}
      {showAssignMemberModal && currentBill && (
        <AssignMemberModal
          onClose={() => setShowAssignMemberModal(false)}
          onAssign={async (customer) => {
            try {
              await posBillService.assignMember(currentBill.id, customer.id)
              const r = await posBillService.getBill(currentBill.id)
              if (r.success) setCurrentBill(r.data)
              toast.success(`เพิ่มสมาชิก ${customer.name} สำเร็จ`)
              setShowAssignMemberModal(false)
            } catch { toast.error('เพิ่มสมาชิกไม่สำเร็จ') }
          }}
        />
      )}

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
        total={(() => {
          const subtotal = currentBill?.subtotal || 0
          const serviceAmt = billing.serviceEnabled ? Math.round(subtotal * billing.serviceRate / 100) : 0
          const vatAmt = billing.vatEnabled ? Math.round(subtotal * billing.vatRate / 100) : 0
          const beforeDiscount = subtotal + serviceAmt + vatAmt
          const discountAmt = discount.type === 'pct'
            ? Math.round(beforeDiscount * discount.value / 100)
            : discount.value
          return Math.max(0, beforeDiscount - discountAmt + extraCharge.amount)
        })()}
        onPay={processPayment}
        loyalty={loyalty}
        customerPoints={currentBill?.customer_id ? (currentBill.customer_loyalty_points ?? null) : null}
      />

      {/* Category Manager Modal */}
      <CategoryManagerModal
        isOpen={showCategoryModal}
        onClose={() => setShowCategoryModal(false)}
        categories={categories}
        onRefresh={fetchData}
      />
    </div>
  )
}

// ==================== Sub Components ====================

function CreateBillModal({ isOpen, onClose, onCreate }: {
  isOpen: boolean
  onClose: () => void
  onCreate: (name?: string, customerId?: string) => void
}) {
  useModalClose(onClose)
  const [name, setName] = useState('')
  const [memberQuery, setMemberQuery] = useState('')
  const [memberResults, setMemberResults] = useState<CRMCustomer[]>([])
  const [selectedMember, setSelectedMember] = useState<CRMCustomer | null>(null)
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!memberQuery.trim()) { setMemberResults([]); return }
    const t = setTimeout(async () => {
      try {
        setSearching(true)
        const res = await posBillService.searchCustomers(memberQuery)
        if (res.success) setMemberResults(res.data)
      } finally { setSearching(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [memberQuery])

  const handleCreate = () => {
    onCreate(name || undefined, selectedMember?.id)
    setName(''); setMemberQuery(''); setSelectedMember(null); setMemberResults([])
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-cyber-card border border-cyber-border rounded-2xl w-full max-w-md p-6"
      >
        <h2 className="text-xl font-bold text-white mb-4">สร้างบิลใหม่</h2>

        {/* Bill name */}
        <input
          type="text"
          placeholder="ชื่อบิล (เว้นว่างได้)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          className="w-full px-4 py-3 bg-cyber-dark border border-cyber-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-cyber-primary mb-4"
        />

        {/* Member search */}
        <div className="mb-4">
          <label className="block text-sm text-gray-400 mb-1.5 flex items-center gap-1.5">
            <Star className="w-3.5 h-3.5 text-yellow-400" /> สมาชิก (ค้นหาชื่อหรือเบอร์โทร)
          </label>
          {selectedMember ? (
            <div className="flex items-center justify-between bg-cyber-primary/10 border border-cyber-primary/30 rounded-lg px-3 py-2">
              <div>
                <p className="text-sm font-medium text-white">{selectedMember.name}</p>
                <p className="text-xs text-gray-400">{selectedMember.phone} · แต้ม {selectedMember.loyalty_points.toLocaleString()}</p>
              </div>
              <button onClick={() => { setSelectedMember(null); setMemberQuery('') }}
                className="p-1 text-gray-400 hover:text-red-400">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                placeholder="ค้นหา..."
                value={memberQuery}
                onChange={(e) => setMemberQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 bg-cyber-dark border border-cyber-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-cyber-primary text-sm"
              />
              {memberResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-cyber-card border border-cyber-border rounded-lg shadow-xl z-10 max-h-48 overflow-y-auto">
                  {memberResults.map(c => (
                    <button key={c.id} onClick={() => { setSelectedMember(c); setMemberQuery(''); setMemberResults([]) }}
                      className="w-full px-4 py-2.5 text-left hover:bg-cyber-dark flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-white">{c.name}</p>
                        <p className="text-xs text-gray-500">{c.phone}</p>
                      </div>
                      <span className="text-xs text-cyber-primary">{c.loyalty_points.toLocaleString()} แต้ม</span>
                    </button>
                  ))}
                </div>
              )}
              {searching && <p className="text-xs text-gray-500 mt-1 px-1">กำลังค้นหา...</p>}
            </div>
          )}
          <p className="text-xs text-gray-600 mt-1.5">เว้นว่างได้ — สามารถเพิ่มสมาชิกหลังเปิดบิลแล้วก็ได้</p>
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 text-gray-400 hover:text-white transition-colors">
            ยกเลิก
          </button>
          <button onClick={handleCreate}
            className="flex-1 px-4 py-2 bg-gradient-to-r from-cyber-primary to-cyber-purple text-white rounded-lg hover:opacity-90">
            สร้าง
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ==================== Assign Member Modal ====================

function AssignMemberModal({ onClose, onAssign }: {
  onClose: () => void
  onAssign: (customer: CRMCustomer) => void
}) {
  useModalClose(onClose)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CRMCustomer[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    const t = setTimeout(async () => {
      try {
        setSearching(true)
        const res = await posBillService.searchCustomers(query)
        if (res.success) setResults(res.data)
      } finally { setSearching(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-cyber-card border border-cyber-border rounded-2xl w-full max-w-sm"
      >
        <div className="p-5 border-b border-cyber-border flex items-center justify-between">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-cyber-primary" /> เพิ่มสมาชิก
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-cyber-dark text-gray-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              autoFocus
              placeholder="ค้นหาชื่อหรือเบอร์โทร..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 bg-cyber-dark border border-cyber-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-cyber-primary"
            />
          </div>

          {searching && <p className="text-sm text-center text-gray-500">กำลังค้นหา...</p>}

          {results.length > 0 && (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {results.map(c => (
                <button key={c.id} onClick={() => onAssign(c)}
                  className="w-full px-4 py-3 text-left hover:bg-cyber-dark rounded-lg flex items-center justify-between group">
                  <div>
                    <p className="text-sm font-medium text-white group-hover:text-cyber-primary">{c.name}</p>
                    <p className="text-xs text-gray-500">{c.phone}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-cyber-primary font-medium">{c.loyalty_points.toLocaleString()} แต้ม</p>
                    <p className="text-xs text-gray-600">ยอดสะสม ฿{(c.total_spent || 0).toLocaleString()}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {query.length > 0 && !searching && results.length === 0 && (
            <p className="text-sm text-center text-gray-500 py-4">ไม่พบสมาชิก</p>
          )}
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
  useModalClose(onClose)
  const [name, setName] = useState(currentName)

  useEffect(() => {
    setName(currentName)
  }, [currentName, isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
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

// ==================== Category Manager Modal ====================

const PRESET_COLORS = [
  '#00f0ff', '#a855f7', '#22c55e', '#f59e0b', '#ef4444',
  '#3b82f6', '#ec4899', '#14b8a6', '#f97316', '#8b5cf6',
]

function CategoryManagerModal({ isOpen, onClose, categories, onRefresh }: {
  isOpen: boolean
  onClose: () => void
  categories: POSCategory[]
  onRefresh: () => void
}) {
  useModalClose(onClose)
  const [tab, setTab] = useState<'cats' | 'assign'>('cats')
  const [name, setName] = useState('')
  const [color, setColor] = useState(PRESET_COLORS[0])
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')
  const [menus, setMenus] = useState<POSMenu[]>([])
  const [menuCats, setMenuCats] = useState<Record<string, string | null>>({})
  const [assignSearch, setAssignSearch] = useState('')

  useEffect(() => {
    if (isOpen && tab === 'assign') {
      posService.getMenuConfigs().then(res => {
        const list = res.data || []
        setMenus(list)
        const map: Record<string, string | null> = {}
        list.forEach((m: POSMenu) => { map[m.id] = (m as any).category_id || null })
        setMenuCats(map)
      })
    }
  }, [isOpen, tab])

  const handleAdd = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      await posService.createCategory({ name: name.trim(), color })
      setName('')
      setColor(PRESET_COLORS[0])
      onRefresh()
    } catch { toast.error('เพิ่มหมวดหมู่ไม่สำเร็จ') }
    finally { setSaving(false) }
  }

  const handleEdit = async (id: string) => {
    if (!editName.trim()) return
    setSaving(true)
    try {
      await posService.updateCategory(id, { name: editName.trim(), color: editColor })
      setEditingId(null)
      onRefresh()
    } catch { toast.error('แก้ไขไม่สำเร็จ') }
    finally { setSaving(false) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('ลบหมวดหมู่นี้?')) return
    try {
      await posService.deleteCategory(id)
      onRefresh()
    } catch { toast.error('ลบไม่สำเร็จ') }
  }

  const handleAssign = async (menuId: string, catId: string | null) => {
    setMenuCats(prev => ({ ...prev, [menuId]: catId }))
    try {
      await posService.updateMenuConfig(menuId, { category_id: catId as any })
      onRefresh()
    } catch {
      toast.error('เปลี่ยนหมวดหมู่ไม่สำเร็จ')
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-cyber-card border border-cyber-border rounded-2xl w-full max-w-lg p-6 max-h-[80vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Settings className="w-5 h-5 text-cyber-primary" />
            จัดการหมวดหมู่
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-cyber-dark text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-cyber-dark rounded-lg p-1 mb-4">
          <button
            onClick={() => setTab('cats')}
            className={`flex-1 py-1.5 rounded-md text-sm transition-all ${tab === 'cats' ? 'bg-cyber-primary/20 text-cyber-primary' : 'text-gray-400 hover:text-white'}`}
          >
            หมวดหมู่
          </button>
          <button
            onClick={() => setTab('assign')}
            className={`flex-1 py-1.5 rounded-md text-sm transition-all ${tab === 'assign' ? 'bg-cyber-primary/20 text-cyber-primary' : 'text-gray-400 hover:text-white'}`}
          >
            จัดเมนู
          </button>
        </div>

        {tab === 'cats' ? (
          <>
            {/* Add new */}
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                placeholder="ชื่อหมวดหมู่ใหม่..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                className="flex-1 px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-cyber-primary text-sm"
              />
              <div className="flex gap-1 items-center">
                {PRESET_COLORS.slice(0, 5).map(c => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`w-6 h-6 rounded-full transition-transform ${color === c ? 'scale-125 ring-2 ring-white' : 'opacity-70 hover:opacity-100'}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
              <button
                onClick={handleAdd}
                disabled={saving || !name.trim()}
                className="px-3 py-2 bg-cyber-primary/20 text-cyber-primary rounded-lg hover:bg-cyber-primary/30 transition-all disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            {/* Category List */}
            <div className="flex-1 overflow-y-auto space-y-2">
              {categories.length === 0 && (
                <p className="text-center text-gray-500 py-6 text-sm">ยังไม่มีหมวดหมู่</p>
              )}
              {categories.map((cat) => (
                <div key={cat.id} className="flex items-center gap-2 p-2 bg-cyber-dark rounded-lg">
                  {editingId === cat.id ? (
                    <>
                      <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: editColor }} />
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleEdit(cat.id)}
                        className="flex-1 px-2 py-1 bg-cyber-card border border-cyber-border rounded text-white text-sm focus:outline-none focus:border-cyber-primary"
                        autoFocus
                      />
                      <div className="flex gap-1">
                        {PRESET_COLORS.slice(0, 5).map(c => (
                          <button
                            key={c}
                            onClick={() => setEditColor(c)}
                            className={`w-4 h-4 rounded-full ${editColor === c ? 'ring-1 ring-white' : 'opacity-60 hover:opacity-100'}`}
                            style={{ background: c }}
                          />
                        ))}
                      </div>
                      <button onClick={() => handleEdit(cat.id)} className="p-1 text-cyber-green hover:text-green-400">
                        <Check className="w-4 h-4" />
                      </button>
                      <button onClick={() => setEditingId(null)} className="p-1 text-gray-400 hover:text-white">
                        <X className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: cat.color }} />
                      <span className="flex-1 text-sm text-white">{cat.name}</span>
                      <button
                        onClick={() => { setEditingId(cat.id); setEditName(cat.name); setEditColor(cat.color) }}
                        className="p-1 text-gray-400 hover:text-cyber-primary"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button onClick={() => handleDelete(cat.id)} className="p-1 text-gray-400 hover:text-red-400">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          /* Assign menus to categories */
          <div className="flex flex-col flex-1 min-h-0 gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="ค้นหาเมนู..."
                value={assignSearch}
                onChange={(e) => setAssignSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-cyber-primary text-sm"
              />
            </div>

            {/* Menu list */}
            <div className="flex-1 overflow-y-auto space-y-2">
              {menus.length === 0 && (
                <p className="text-center text-gray-500 py-6 text-sm">ไม่มีเมนูใน POS</p>
              )}
              {menus
                .filter(m =>
                  !assignSearch ||
                  m.product_name?.toLowerCase().includes(assignSearch.toLowerCase()) ||
                  m.product_code?.toLowerCase().includes(assignSearch.toLowerCase())
                )
                .map((menu) => {
                  const currentCatId = menuCats[menu.id]
                  return (
                    <div key={menu.id} className="p-2 bg-cyber-dark rounded-lg space-y-2">
                      <div>
                        <p className="text-sm text-white">{menu.product_name}</p>
                        <p className="text-xs text-gray-500">{menu.product_code}</p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <button
                          onClick={() => handleAssign(menu.id, null)}
                          className={`px-2 py-0.5 rounded-full text-xs transition-all ${
                            !currentCatId
                              ? 'bg-gray-500/30 text-gray-300 ring-1 ring-gray-400'
                              : 'bg-cyber-card text-gray-500 hover:text-gray-300'
                          }`}
                        >
                          ไม่มี
                        </button>
                        {categories.map(cat => (
                          <button
                            key={cat.id}
                            onClick={() => handleAssign(menu.id, cat.id)}
                            className={`px-2 py-0.5 rounded-full text-xs transition-all ${
                              currentCatId === cat.id
                                ? 'ring-1 ring-white'
                                : 'opacity-50 hover:opacity-90'
                            }`}
                            style={{
                              background: `${cat.color}30`,
                              color: cat.color,
                              ...(currentCatId === cat.id ? { background: `${cat.color}50` } : {}),
                            }}
                          >
                            {cat.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  )
}

function PaymentModal({ isOpen, onClose, total, onPay, loyalty, customerPoints }: {
  isOpen: boolean
  onClose: () => void
  total: number
  onPay: (method: 'CASH' | 'QR_CODE' | 'CREDIT_CARD', redeemPoints?: number) => void
  loyalty: LoyaltyConfig
  customerPoints: number | null
}) {
  useModalClose(onClose)
  const [redeemInput, setRedeemInput] = useState(0)

  if (!isOpen) return null

  // Max redeemable: min(customerPoints, points that cover total)
  const maxRedeemable = customerPoints !== null && loyalty.enabled && loyalty.redeemRate > 0
    ? Math.min(customerPoints, Math.floor(total * loyalty.redeemRate))
    : 0
  const canRedeem = maxRedeemable >= (loyalty.minRedeemPoints || 0) && maxRedeemable > 0
  const redeemDiscount = redeemInput > 0 ? Math.floor(redeemInput / loyalty.redeemRate) : 0
  const finalTotal = Math.max(0, total - redeemDiscount)

  const handlePay = (method: 'CASH' | 'QR_CODE' | 'CREDIT_CARD') => {
    onPay(method, redeemInput > 0 ? redeemInput : undefined)
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-cyber-card border border-cyber-border rounded-2xl max-w-md w-full p-6"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">ชำระเงิน</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-cyber-dark text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Redeem Points UI */}
        {canRedeem && (
          <div className="mb-4 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl space-y-3">
            <div className="flex items-center gap-2">
              <Star className="w-4 h-4 text-yellow-400" />
              <p className="text-sm font-medium text-yellow-300">แลกแต้มสมาชิก</p>
              <span className="text-xs text-gray-400 ml-auto">มี {customerPoints!.toLocaleString()} แต้ม</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={redeemInput || ''}
                onChange={(e) => {
                  const v = Math.min(maxRedeemable, Math.max(0, parseInt(e.target.value) || 0))
                  setRedeemInput(v)
                }}
                placeholder="0"
                className="cyber-input w-28 text-center"
                min={0}
                max={maxRedeemable}
                step={loyalty.redeemRate}
              />
              <span className="text-gray-400 text-sm flex-1">แต้ม = ลด ฿{redeemDiscount.toLocaleString()}</span>
              {redeemInput > 0 && (
                <button onClick={() => setRedeemInput(0)} className="text-xs text-gray-500 hover:text-gray-300">ยกเลิก</button>
              )}
            </div>
            {redeemInput > 0 && redeemInput < loyalty.minRedeemPoints && (
              <p className="text-xs text-red-400">ต้องแลกขั้นต่ำ {loyalty.minRedeemPoints} แต้ม</p>
            )}
            <button
              onClick={() => setRedeemInput(maxRedeemable)}
              className="text-xs text-yellow-400 hover:text-yellow-300"
            >
              แลกทั้งหมด ({maxRedeemable.toLocaleString()} แต้ม = ลด ฿{Math.floor(maxRedeemable / loyalty.redeemRate).toLocaleString()})
            </button>
          </div>
        )}

        <div className="text-center py-6 bg-cyber-dark rounded-xl mb-6">
          {redeemDiscount > 0 && (
            <p className="text-sm text-gray-500 line-through mb-1">฿{total.toLocaleString()}</p>
          )}
          <p className="text-gray-400 mb-2">ยอดที่ต้องชำระ</p>
          <p className="text-4xl font-bold text-cyber-green">฿{finalTotal.toLocaleString()}</p>
          {redeemDiscount > 0 && (
            <p className="text-xs text-yellow-400 mt-1">ลดด้วยแต้ม ฿{redeemDiscount.toLocaleString()}</p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <button onClick={() => handlePay('CASH')} className="p-4 bg-cyber-dark rounded-xl border border-cyber-border hover:border-cyber-primary/50 flex flex-col items-center gap-2">
            <Banknote className="w-8 h-8 text-green-400" />
            <span className="text-sm text-gray-300">เงินสด</span>
          </button>
          <button onClick={() => handlePay('QR_CODE')} className="p-4 bg-cyber-dark rounded-xl border border-cyber-border hover:border-cyber-primary/50 flex flex-col items-center gap-2">
            <QrCode className="w-8 h-8 text-cyber-primary" />
            <span className="text-sm text-gray-300">QR Code</span>
          </button>
          <button onClick={() => handlePay('CREDIT_CARD')} className="p-4 bg-cyber-dark rounded-xl border border-cyber-border hover:border-cyber-primary/50 flex flex-col items-center gap-2">
            <CreditCard className="w-8 h-8 text-purple-400" />
            <span className="text-sm text-gray-300">บัตรเครดิต</span>
          </button>
        </div>
      </motion.div>
    </div>
  )
}
