import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Menu, Search, Settings, User, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useGlobalSearch } from '../../hooks/useGlobalSearch'

interface HeaderProps {
  onMenuClick: () => void
}

const typeIcons: Record<string, string> = {
  customer: '👤',
  order: '📦',
  product: '🏭',
  material: '🧱',
  bom: '📋',
  stock: '📊',
}

function Header({ onMenuClick }: HeaderProps) {
  const navigate = useNavigate()
  const { query, setQuery, results, isOpen, isLoading, close, clear } = useGlobalSearch()
  const searchRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        close()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [close])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      close()
    }
  }

  const handleResultClick = (navigateTo: string) => {
    navigate(navigateTo)
    clear()
  }

  // Group results by label
  const grouped = results.reduce<Record<string, typeof results>>((acc, r) => {
    if (!acc[r.label]) acc[r.label] = []
    acc[r.label].push(r)
    return acc
  }, {})

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
          <div className="relative hidden md:block" ref={searchRef}>
            {isLoading ? (
              <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-cyber-primary animate-spin" />
            ) : (
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            )}
            <input
              type="text"
              placeholder="ค้นหา ลูกค้า, สินค้า, ออเดอร์, วัตถุดิบ..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => { if (results.length > 0) close() /* reopen handled by hook */ }}
              className="cyber-input pl-10 w-64 lg:w-96"
            />

            {/* Dropdown Results */}
            <AnimatePresence>
              {isOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.15 }}
                  className="absolute top-full left-0 mt-2 w-full min-w-[400px] bg-cyber-card border border-cyber-border rounded-lg shadow-2xl max-h-[400px] overflow-y-auto z-50"
                >
                  {Object.entries(grouped).map(([label, items]) => (
                    <div key={label}>
                      <div className="px-4 py-2 text-xs font-bold text-cyber-primary uppercase tracking-wider bg-cyber-dark/80 border-b border-cyber-border sticky top-0">
                        {label}
                      </div>
                      {items.map((item) => (
                        <button
                          key={`${item.type}-${item.id}`}
                          onClick={() => handleResultClick(item.navigateTo)}
                          className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-cyber-primary/10 transition-colors border-b border-cyber-border/30"
                        >
                          <span className="text-lg">{typeIcons[item.type] || '📄'}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-gray-100 truncate">
                              {item.title}
                            </div>
                            <div className="text-xs text-gray-400 truncate">
                              {item.subtitle}
                            </div>
                          </div>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyber-primary/20 text-cyber-primary whitespace-nowrap">
                            {item.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  ))}

                  {results.length === 0 && query.length >= 2 && !isLoading && (
                    <div className="px-4 py-6 text-center text-gray-400 text-sm">
                      ไม่พบผลลัพธ์สำหรับ "{query}"
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

          {/* Settings */}
          <motion.button
            whileHover={{ scale: 1.1, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
            className="p-2 rounded-lg hover:bg-cyber-primary/10 transition-colors group"
          >
            <Settings className="w-6 h-6 text-gray-400 group-hover:text-cyber-primary transition-colors" />
          </motion.button>

          {/* User Profile */}
          <motion.div
            whileHover={{ scale: 1.05 }}
            className="flex items-center gap-3 pl-3 pr-4 py-2 rounded-lg bg-cyber-card/50 hover:bg-cyber-card cursor-pointer border border-cyber-border hover:border-cyber-primary/50 transition-all"
          >
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyber-primary to-cyber-purple flex items-center justify-center shadow-neon">
              <User className="w-5 h-5 text-white" />
            </div>
            <div className="hidden lg:block">
              <p className="text-sm font-semibold text-gray-100">Admin User</p>
              <p className="text-xs text-gray-400">Administrator</p>
            </div>
          </motion.div>
        </div>
      </div>
    </header>
  )
}

export default Header
