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
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import searchService from '../../services/search'
import { useAuth } from '../../contexts/AuthContext'

interface HeaderProps {
  onMenuClick: () => void
}

function Header({ onMenuClick }: HeaderProps) {
  const navigate = useNavigate()
  const { user, isMaster, logout } = useAuth()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [showResults, setShowResults] = useState(false)
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
          setShowResults(true)
        } catch (error) {
          console.error('Search error:', error)
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
      }
    },
    [navigate]
  )

  const clearSearch = () => {
    setSearchQuery('')
    setSearchResults(null)
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
      (searchResults.stock || []).length > 0)

  const totalResults = searchResults
    ? (searchResults.customers || []).length +
      (searchResults.orders || []).length +
      (searchResults.products || []).length +
      (searchResults.materials || []).length +
      (searchResults.boms || []).length +
      (searchResults.stock || []).length
    : 0

  return (
    <header className="bg-gradient-card backdrop-blur-xl border-b border-cyber-border px-6 py-4 sticky top-0 z-40">
      <div className="flex items-center justify-between">
        {/* Left Section */}
        <div className="flex items-center gap-4">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={onMenuClick}
            className="p-2 rounded-lg hover:bg-cyber-primary/10 transition-colors"
          >
            <Menu className="w-6 h-6 text-cyber-primary" />
          </motion.button>

          {/* Search Bar */}
          <div ref={searchRef} className="relative hidden md:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search orders, customers, products, materials... (Ctrl+K)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => searchQuery.length >= 2 && setShowResults(true)}
              className="cyber-input pl-10 pr-10 w-64 lg:w-96"
            />
            {isSearching ? (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-cyber-primary animate-spin" />
            ) : searchQuery ? (
              <button
                onClick={clearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-cyber-dark rounded"
              >
                <X className="w-4 h-4 text-gray-400 hover:text-gray-300" />
              </button>
            ) : null}

            {/* Search Results Dropdown */}
            <AnimatePresence>
              {showResults && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute top-full mt-2 left-0 right-0 w-[500px] max-h-[70vh] overflow-y-auto bg-cyber-card border border-cyber-border rounded-lg shadow-2xl"
                >
                  {!hasResults && !isSearching && searchQuery.length >= 2 && (
                    <div className="p-6 text-center text-gray-400">
                      <Search className="w-10 h-10 mx-auto mb-3 opacity-50" />
                      <p>No results found for "{searchQuery}"</p>
                      <p className="text-sm mt-1">Try different keywords</p>
                    </div>
                  )}

                  {hasResults && (
                    <div className="p-2">
                      <p className="px-3 py-2 text-xs text-gray-500 uppercase tracking-wider">
                        Found {totalResults} results
                      </p>

                      {/* Customers */}
                      {(searchResults.customers || []).length > 0 && (
                        <ResultSection
                          title="Customers"
                          icon={Users}
                          items={searchResults.customers}
                          onItemClick={handleResultClick}
                          color="text-blue-400"
                        />
                      )}

                      {/* Orders */}
                      {(searchResults.orders || []).length > 0 && (
                        <ResultSection
                          title="Orders"
                          icon={ShoppingCart}
                          items={searchResults.orders}
                          onItemClick={handleResultClick}
                          color="text-cyber-green"
                        />
                      )}

                      {/* Products */}
                      {(searchResults.products || []).length > 0 && (
                        <ResultSection
                          title="Products"
                          icon={Package}
                          items={searchResults.products}
                          onItemClick={handleResultClick}
                          color="text-cyber-purple"
                        />
                      )}

                      {/* Materials */}
                      {(searchResults.materials || []).length > 0 && (
                        <ResultSection
                          title="Materials"
                          icon={Layers}
                          items={searchResults.materials}
                          onItemClick={handleResultClick}
                          color="text-yellow-400"
                        />
                      )}

                      {/* BOMs */}
                      {(searchResults.boms || []).length > 0 && (
                        <ResultSection
                          title="Bill of Materials"
                          icon={Box}
                          items={searchResults.boms}
                          onItemClick={handleResultClick}
                          color="text-cyan-400"
                        />
                      )}

                      {/* Stock */}
                      {(searchResults.stock || []).length > 0 && (
                        <ResultSection
                          title="Stock Items"
                          icon={Package}
                          items={searchResults.stock}
                          onItemClick={handleResultClick}
                          color="text-orange-400"
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
        <div className="flex items-center gap-3">
          {/* Notifications */}
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className="relative p-2 rounded-lg hover:bg-cyber-primary/10 transition-colors group"
          >
            <Bell className="w-6 h-6 text-gray-400 group-hover:text-cyber-primary transition-colors" />
            <span className="absolute top-1 right-1 w-2 h-2 bg-cyber-green rounded-full animate-pulse" />
          </motion.button>

          {/* Cashier - Quick Access */}
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => navigate('/cashier')}
            className="relative p-2 rounded-lg hover:bg-cyber-primary/10 transition-colors group"
            title="ระบบขายหน้าร้าน"
          >
            <Store className="w-6 h-6 text-gray-400 group-hover:text-cyber-primary transition-colors" />
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-cyber-green rounded-full animate-pulse" />
          </motion.button>

          {/* Settings */}
          <motion.button
            whileHover={{ scale: 1.1, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => navigate('/settings')}
            className="p-2 rounded-lg hover:bg-cyber-primary/10 transition-colors group"
          >
            <Settings className="w-6 h-6 text-gray-400 group-hover:text-cyber-primary transition-colors" />
          </motion.button>

          {/* User Profile */}
          <motion.div
            whileHover={{ scale: 1.05 }}
            className="flex items-center gap-3 pl-3 pr-4 py-2 rounded-lg bg-cyber-card/50 border border-cyber-border hover:border-cyber-primary/50 transition-all cursor-pointer"
            onClick={() => navigate('/settings')}
          >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
              isMaster 
                ? 'bg-gradient-to-br from-cyber-green to-emerald-500 shadow-[0_0_10px_rgba(0,255,136,0.3)]' 
                : 'bg-gradient-to-br from-cyber-primary to-cyber-purple shadow-[0_0_10px_rgba(0,240,255,0.3)]'
            }`}>
              <User className="w-5 h-5 text-white" />
            </div>
            <div className="hidden lg:block">
              <p className="text-sm font-semibold text-gray-100">{user?.name || 'User'}</p>
              <p className={`text-xs ${isMaster ? 'text-cyber-green' : 'text-gray-400'}`}>
                {user?.role || 'USER'}
                {isMaster && ' ★'}
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
        <span className="text-xs bg-cyber-dark px-2 py-0.5 rounded-full">
          {items.length}
        </span>
      </div>
      <div className="space-y-1">
        {(items || []).map((item) => (
          <motion.button
            key={`${item.type}-${item.id}`}
            whileHover={{ x: 4 }}
            onClick={() => onItemClick(item)}
            className="w-full text-left px-4 py-2 rounded-lg hover:bg-cyber-primary/10 transition-colors group"
          >
            <p className="text-gray-200 group-hover:text-cyber-primary transition-colors">
              {item.label}
            </p>
            <p className="text-xs text-gray-500">{item.subtitle}</p>
          </motion.button>
        ))}
      </div>
    </div>
  )
}

export default Header
