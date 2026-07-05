import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell,
  Box,
  ClipboardList,
  FileCheck,
  FileText,
  Layers,
  Loader2,
  Menu,
  Moon,
  Package,
  Receipt,
  Search,
  Settings,
  ShoppingCart,
  Star,
  Store,
  Sun,
  Truck,
  User,
  Users,
  Wrench,
  X,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import searchService from '../../services/search'
import { useAuth } from '../../contexts/AuthContext'
import { useTheme } from '../../contexts/ThemeContext'
import { useLanguage } from '../../contexts/LanguageContext'

interface HeaderProps {
  onMenuClick: () => void
}

function Header({ onMenuClick }: HeaderProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, isMaster } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { language, toggleLanguage } = useLanguage()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [showNotifications, setShowNotifications] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const notifRef = useRef<HTMLDivElement>(null)

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
          setSearchError(t('header.searchError'))
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
  }, [searchQuery, t])

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false)
      }
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifications(false)
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

  const sectionConfig = [
    { key: 'customers', items: searchResults?.customers, icon: Users, color: 'text-[var(--primary)]' },
    { key: 'orders', items: searchResults?.orders, icon: ShoppingCart, color: 'text-success' },
    { key: 'products', items: searchResults?.products, icon: Package, color: 'text-phopy-mango' },
    { key: 'materials', items: searchResults?.materials, icon: Layers, color: 'text-warning' },
    { key: 'billOfMaterials', items: searchResults?.boms, icon: Box, color: 'text-info' },
    { key: 'stockItems', items: searchResults?.stock, icon: Package, color: 'text-phopy-mango' },
    { key: 'suppliers', items: searchResults?.suppliers, icon: Truck, color: 'text-[var(--primary)]' },
    { key: 'purchaseOrders', items: searchResults?.purchase_orders, icon: ClipboardList, color: 'text-warning' },
    { key: 'workOrders', items: searchResults?.work_orders, icon: Wrench, color: 'text-[var(--primary)]' },
    { key: 'salesOrders', items: searchResults?.sales_orders, icon: FileCheck, color: 'text-success' },
    { key: 'quotations', items: searchResults?.quotations, icon: FileText, color: 'text-[var(--primary)]' },
    { key: 'invoices', items: searchResults?.invoices, icon: Receipt, color: 'text-danger' },
  ]

  return (
    <header className="phopy-header border-b border-[var(--border)] px-6 py-3 sticky top-0 z-40 h-16">
      <div className="flex items-center justify-between h-full">
        {/* Left Section */}
        <div className="flex items-center gap-4">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onMenuClick}
            className="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
            aria-label={t('header.openMenu')}
          >
            <Menu className="w-6 h-6 text-[var(--fg-2)]" />
          </motion.button>

          {/* Search Bar */}
          <div ref={searchRef} className="relative hidden md:block" role="search">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--fg-4)]" aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              placeholder={t('header.searchPlaceholder')}
              aria-label={t('header.searchLabel')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => searchQuery.length >= 2 && setShowResults(true)}
              className="phopy-input pl-10 pr-10 w-64 lg:w-96"
            />
            {isSearching ? (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--primary)] animate-spin" aria-hidden="true" />
            ) : searchQuery ? (
              <button
                onClick={clearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-[var(--surface-2)] rounded cursor-pointer"
                aria-label={t('header.clearSearch')}
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
                  className="absolute top-full mt-2 left-0 right-0 w-[500px] max-h-[70vh] overflow-y-auto bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-3"
                >
                  {searchError && !isSearching && (
                    <div className="p-6 text-center text-danger">
                      <p>{searchError}</p>
                    </div>
                  )}

                  {!searchError && !hasResults && !isSearching && searchQuery.length >= 2 && (
                    <div className="p-6 text-center text-[var(--fg-3)]">
                      <Search className="w-10 h-10 mx-auto mb-3 opacity-50" />
                      <p>{t('header.noResultsFor', { query: searchQuery })}</p>
                      <p className="text-sm mt-1">{t('header.tryDifferentKeyword')}</p>
                    </div>
                  )}

                  {hasResults && (
                    <div className="p-2">
                      <p className="px-3 py-2 text-xs text-[var(--fg-4)] uppercase tracking-wider">
                        {t('header.foundResults', { count: totalResults })}
                      </p>

                      {sectionConfig.map(({ key, items, icon, color }) =>
                        items && items.length > 0 ? (
                          <ResultSection
                            key={key}
                            title={t(`header.${key}`)}
                            icon={icon}
                            items={items}
                            onItemClick={handleResultClick}
                            color={color}
                          />
                        ) : null
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

          {/* Notifications */}
          <div ref={notifRef} className="relative">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowNotifications(v => !v)}
              className="relative p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors group min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
              aria-label={t('header.notifications')}
              aria-expanded={showNotifications}
            >
              <Bell className="w-5 h-5 text-[var(--fg-3)] group-hover:text-[var(--primary)] transition-colors" />
            </motion.button>
            <AnimatePresence>
              {showNotifications && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-2 w-72 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-3 z-50 overflow-hidden"
                >
                  <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
                    <span className="text-sm font-semibold text-[var(--fg-1)]">{t('header.notifications')}</span>
                    <span className="text-xs text-[var(--fg-4)]">{t('header.allNotifications')}</span>
                  </div>
                  <div className="py-10 flex flex-col items-center justify-center gap-2">
                    <Bell className="w-8 h-8 text-[var(--fg-4)]" />
                    <p className="text-sm text-[var(--fg-3)]">{t('header.noNotifications')}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Cashier - Quick Access */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => navigate('/cashier')}
            className="relative p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors group min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
            aria-label={t('header.cashier')}
          >
            <Store className="w-5 h-5 text-[var(--fg-3)] group-hover:text-[var(--primary)] transition-colors" />
          </motion.button>

          {/* Theme Toggle */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={toggleTheme}
            className="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors group min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
            aria-label={theme === 'light' ? t('header.darkTheme') : t('header.lightTheme')}
          >
            {theme === 'light' ? (
              <Moon className="w-5 h-5 text-[var(--fg-3)] group-hover:text-[var(--primary)] transition-colors" />
            ) : (
              <Sun className="w-5 h-5 text-[var(--fg-3)] group-hover:text-phopy-mango transition-colors" />
            )}
          </motion.button>

          {/* Language Toggle */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={toggleLanguage}
            className="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors group min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer text-sm font-semibold text-[var(--fg-3)] group-hover:text-[var(--primary)]"
            aria-label={language === 'th' ? 'Switch to English' : 'Switch to Thai'}
          >
            {language === 'th' ? 'TH' : 'EN'}
          </motion.button>

          {/* Settings */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => navigate('/settings')}
            className="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors group min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
            aria-label={t('header.settings')}
          >
            <Settings className="w-5 h-5 text-[var(--fg-3)] group-hover:text-[var(--primary)] transition-colors" />
          </motion.button>

          {/* User Profile */}
          <motion.div
            whileHover={{ scale: 1.02 }}
            className="flex items-center gap-3 pl-3 pr-4 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--border-strong)] transition-all cursor-pointer"
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
                {isMaster ? <><Star className="w-3 h-3 fill-current" /> MASTER</> : (user?.role || 'USER')}
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
            className="w-full text-left px-4 py-2 rounded-lg hover:bg-[var(--primary-soft)] transition-colors group"
          >
            <p className="text-[var(--fg-1)] group-hover:text-[var(--primary)] transition-colors text-sm">
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
