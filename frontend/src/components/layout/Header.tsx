import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell,
  Menu,
  Search,
  Settings,
  User,
  Users,
  ShoppingCart,
  Package,
  Layers,
  Box,
  Loader2,
  X,
  Store,
  Truck,
  ClipboardList,
  Wrench,
  FileCheck,
  FileText,
  Receipt,
  Sparkles,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import searchService from '../../services/search'
import { useAuth } from '../../contexts/AuthContext'

interface HeaderProps {
  onMenuClick: () => void
}

function Header({ onMenuClick }: HeaderProps) {
  const navigate = useNavigate()
  const { user, isMaster } = useAuth()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const searchRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (searchQuery.trim().length >= 2) {
        setIsSearching(true)
        try {
          const results = await searchService.search(searchQuery)
          setSearchResults(results)
          setSearchError(null)
          setShowResults(true)
        } catch (error) {
          console.error('Search error:', error)
          setSearchError('เกิดข้อผิดพลาดในการค้นหา กรุณาลองใหม่อีกครั้ง')
          setSearchResults(null)
          setShowResults(true)
        } finally {
          setIsSearching(false)
        }
      } else {
        setSearchResults(null)
        setShowResults(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery])

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ctrl+K or Cmd+K to focus search
      if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
      }
      // Escape to close results
      if (event.key === 'Escape') {
        setShowResults(false)
        inputRef.current?.blur()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleResultClick = useCallback(
    (item: any) => {
      setShowResults(false)
      setSearchQuery('')

      switch (item.type) {
        case 'customer':
          navigate('/crm', { state: { highlightCustomer: item.id } })
          break
        case 'order':
          navigate('/crm', { state: { highlightOrder: item.id } })
          break
        case 'product':
          navigate('/bom', { state: { highlightProduct: item.id } })
          break
        case 'material':
          navigate('/bom', { state: { tab: 'materials', highlightMaterial: item.id } })
          break
        case 'bom':
          navigate('/bom', { state: { highlightBom: item.id } })
          break
        case 'stock':
          navigate('/stock', { state: { highlightStock: item.id } })
          break
        case 'supplier':
          navigate('/crm', { state: { tab: 'suppliers', highlightSupplier: item.id } })
          break
        case 'purchase_order':
          navigate('/purchase', { state: { highlightPO: item.id } })
          break
        case 'work_order':
          navigate('/work-orders', { state: { highlightWO: item.id } })
          break
        case 'sales_order':
          navigate('/sales', { state: { highlightSO: item.id } })
          break
        case 'quotation':
          navigate('/sales', { state: { highlightQuotation: item.id } })
          break
        case 'invoice':
          navigate('/sales', { state: { highlightInvoice: item.id } })
          break
      }
    },
    [navigate]
  )

  const clearSearch = () => {
    setSearchQuery('')
    setSearchResults(null)
    setSearchError(null)
    setShowResults(false)
    inputRef.current?.focus()
  }

  const hasResults =
    searchResults &&
    ((searchResults.customers || []).length > 0 ||
      (searchResults.orders || []).length > 0 ||
      (searchResults.products || []).length > 0 ||
      (searchResults.materials || []).length > 0 ||
      (searchResults.boms || []).length > 0 ||
      (searchResults.stock || []).length > 0 ||
      (searchResults.suppliers || []).length > 0 ||
      (searchResults.purchase_orders || []).length > 0 ||
      (searchResults.work_orders || []).length > 0 ||
      (searchResults.sales_orders || []).length > 0 ||
      (searchResults.quotations || []).length > 0 ||
      (searchResults.invoices || []).length > 0)

  const totalResults = searchResults
    ? (searchResults.customers || []).length +
      (searchResults.orders || []).length +
      (searchResults.products || []).length +
      (searchResults.materials || []).length +
      (searchResults.boms || []).length +
      (searchResults.stock || []).length +
      (searchResults.suppliers || []).length +
      (searchResults.purchase_orders || []).length +
      (searchResults.work_orders || []).length +
      (searchResults.sales_orders || []).length +
      (searchResults.quotations || []).length +
      (searchResults.invoices || []).length
    : 0

  return (
    <header className="bg-white/92 backdrop-blur-xl border-b border-[var(--border)] px-6 py-3 sticky top-0 z-40 h-16">
      <div className="flex items-center justify-between h-full">
        {/* Left Section */}
        <div className="flex items-center gap-4">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onMenuClick}
            className="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
            aria-label="เปิด/ปิดเมนู"
          >
            <Menu className="w-6 h-6 text-[var(--fg-2)]" />
          </motion.button>

          {/* Search Bar */}
          <div ref={searchRef} className="relative hidden md:block" role="search">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--fg-4)]" aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              placeholder="ค้นหา orders, ลูกค้า, สินค้า... (Ctrl+K)"
              aria-label="ค้นหาในระบบ"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => searchQuery.length >= 2 && setShowResults(true)}
              className="phopy-input pl-10 pr-10 w-64 lg:w-96"
            />
            {isSearching ? (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-phopy-indigo animate-spin" aria-hidden="true" />
            ) : searchQuery ? (
              <button
                onClick={clearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-[var(--surface-2)] rounded cursor-pointer"
                aria-label="ล้างการค้นหา"
              >
                <X className="w-4 h-4 text-[var(--fg-3)] hover:text-[var(--fg-2)]" />
              </button>
            ) : null}

            {/* Search Results Dropdown */}
            <AnimatePresence>
              {showResults && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute top-full mt-2 left-0 right-0 w-[500px] max-h-[70vh] overflow-y-auto bg-white border border-[var(--border)] rounded-lg shadow-3"
                >
                  {searchError && !isSearching && (
                    <div className="p-6 text-center text-danger">
                      <p>{searchError}</p>
                    </div>
                  )}

                  {!searchError && !hasResults && !isSearching && searchQuery.length >= 2 && (
                    <div className="p-6 text-center text-[var(--fg-3)]">
                      <Search className="w-10 h-10 mx-auto mb-3 opacity-50" />
                      <p>ไม่พบผลลัพธ์สำหรับ &quot;{searchQuery}&quot;</p>
                      <p className="text-sm mt-1">ลองใช้คำค้นหาอื่น</p>
                    </div>
                  )}

                  {hasResults && (
                    <div className="p-2">
                      <p className="px-3 py-2 text-xs text-[var(--fg-4)] uppercase tracking-wider">
                        Found {totalResults} results
                      </p>

                      {/* Customers */}
                      {(searchResults.customers || []).length > 0 && (
                        <ResultSection
                          title="Customers"
                          icon={Users}
                          items={searchResults.customers}
                          onItemClick={handleResultClick}
                          color="text-phopy-indigo"
                        />
                      )}

                      {/* Orders */}
                      {(searchResults.orders || []).length > 0 && (
                        <ResultSection
                          title="Orders"
                          icon={ShoppingCart}
                          items={searchResults.orders}
                          onItemClick={handleResultClick}
                          color="text-success"
                        />
                      )}

                      {/* Products */}
                      {(searchResults.products || []).length > 0 && (
                        <ResultSection
                          title="Products"
                          icon={Package}
                          items={searchResults.products}
                          onItemClick={handleResultClick}
                          color="text-phopy-mango"
                        />
                      )}

                      {/* Materials */}
                      {(searchResults.materials || []).length > 0 && (
                        <ResultSection
                          title="Materials"
                          icon={Layers}
                          items={searchResults.materials}
                          onItemClick={handleResultClick}
                          color="text-warning"
                        />
                      )}

                      {/* BOMs */}
                      {(searchResults.boms || []).length > 0 && (
                        <ResultSection
                          title="Bill of Materials"
                          icon={Box}
                          items={searchResults.boms}
                          onItemClick={handleResultClick}
                          color="text-info"
                        />
                      )}

                      {/* Stock */}
                      {(searchResults.stock || []).length > 0 && (
                        <ResultSection
                          title="Stock Items"
                          icon={Package}
                          items={searchResults.stock}
                          onItemClick={handleResultClick}
                          color="text-phopy-mango"
                        />
                      )}

                      {/* Suppliers */}
                      {(searchResults.suppliers || []).length > 0 && (
                        <ResultSection
                          title="Suppliers"
                          icon={Truck}
                          items={searchResults.suppliers}
                          onItemClick={handleResultClick}
                          color="text-phopy-indigo"
                        />
                      )}

                      {/* Purchase Orders */}
                      {(searchResults.purchase_orders || []).length > 0 && (
                        <ResultSection
                          title="Purchase Orders"
                          icon={ClipboardList}
                          items={searchResults.purchase_orders}
                          onItemClick={handleResultClick}
                          color="text-warning"
                        />
                      )}

                      {/* Work Orders */}
                      {(searchResults.work_orders || []).length > 0 && (
                        <ResultSection
                          title="Work Orders"
                          icon={Wrench}
                          items={searchResults.work_orders}
                          onItemClick={handleResultClick}
                          color="text-phopy-indigo"
                        />
                      )}

                      {/* Sales Orders */}
                      {(searchResults.sales_orders || []).length > 0 && (
                        <ResultSection
                          title="Sales Orders"
                          icon={FileCheck}
                          items={searchResults.sales_orders}
                          onItemClick={handleResultClick}
                          color="text-success"
                        />
                      )}

                      {/* Quotations */}
                      {(searchResults.quotations || []).length > 0 && (
                        <ResultSection
                          title="Quotations"
                          icon={FileText}
                          items={searchResults.quotations}
                          onItemClick={handleResultClick}
                          color="text-phopy-indigo"
                        />
                      )}

                      {/* Invoices */}
                      {(searchResults.invoices || []).length > 0 && (
                        <ResultSection
                          title="Invoices"
                          icon={Receipt}
                          items={searchResults.invoices}
                          onItemClick={handleResultClick}
                          color="text-danger"
                        />
                      )}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Right Section */}
        <div className="flex items-center gap-2">
          {/* Ask AI */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate('/ai')}
            className="hidden md:flex items-center gap-2 h-10 px-3 rounded-md bg-[var(--ink-900)] text-white text-sm font-semibold cursor-pointer hover:bg-[var(--ink-700)] transition-colors"
            aria-label="ถาม Phopy AI"
          >
            <Sparkles className="w-4 h-4" />
            <span>Ask AI</span>
          </motion.button>

          {/* Notifications */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="relative p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors group min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
            aria-label="แจ้งเตือน"
          >
            <Bell className="w-5 h-5 text-[var(--fg-3)] group-hover:text-phopy-indigo transition-colors" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-success rounded-full" aria-hidden="true" />
          </motion.button>

          {/* Cashier - Quick Access */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => navigate('/cashier')}
            className="relative p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors group min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
            aria-label="ระบบขายหน้าร้าน"
          >
            <Store className="w-5 h-5 text-[var(--fg-3)] group-hover:text-phopy-indigo transition-colors" />
          </motion.button>

          {/* Settings */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => navigate('/settings')}
            className="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors group min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
            aria-label="การตั้งค่า"
          >
            <Settings className="w-5 h-5 text-[var(--fg-3)] group-hover:text-phopy-indigo transition-colors" />
          </motion.button>

          {/* User Profile */}
          <motion.div
            whileHover={{ scale: 1.02 }}
            className="flex items-center gap-3 pl-3 pr-4 py-1.5 rounded-lg bg-white border border-[var(--border)] hover:border-[var(--border-strong)] transition-all cursor-pointer"
            onClick={() => navigate('/settings')}
          >
            <div className={`w-9 h-9 rounded-full flex items-center justify-center ${
              isMaster 
                ? 'bg-gradient-to-br from-phopy-mango to-phopy-mango-600' 
                : 'bg-gradient-to-br from-phopy-indigo to-phopy-indigo-700'
            }`}>
              <User className="w-5 h-5 text-white" />
            </div>
            <div className="hidden lg:block">
              <p className="text-sm font-semibold text-[var(--fg-1)]">{user?.name || 'User'}</p>
              <p className={`text-xs font-medium ${isMaster ? 'text-phopy-mango' : 'text-[var(--fg-3)]'}`}>
                {isMaster ? '★ MASTER' : (user?.role || 'USER')}
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </header>
  )
}

// Result Section Component
function ResultSection({
  title,
  icon: Icon,
  items,
  onItemClick,
  color,
}: {
  title: string
  icon: any
  items: any[]
  onItemClick: (item: any) => void
  color: string
}) {
  return (
    <div className="mb-2">
      <div className={`flex items-center gap-2 px-3 py-2 ${color}`}>
        <Icon className="w-4 h-4" />
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs bg-[var(--surface-2)] text-[var(--fg-3)] px-2 py-0.5 rounded-full">
          {items.length}
        </span>
      </div>
      <div className="space-y-1">
        {(items || []).map((item) => (
          <motion.button
            key={`${item.type}-${item.id}`}
            whileHover={{ x: 4 }}
            onClick={() => onItemClick(item)}
            className="w-full text-left px-4 py-2 rounded-lg hover:bg-phopy-indigo-50 transition-colors group"
          >
            <p className="text-[var(--fg-1)] group-hover:text-phopy-indigo transition-colors text-sm">
              {item.label}
            </p>
            <p className="text-xs text-[var(--fg-4)]">{item.subtitle}</p>
          </motion.button>
        ))}
      </div>
    </div>
  )
}

export default Header
