import { Bell, Menu, Search, Settings, User } from 'lucide-react'
import { motion } from 'framer-motion'

interface HeaderProps {
  onMenuClick: () => void
}

function Header({ onMenuClick }: HeaderProps) {
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
          <div className="relative hidden md:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search..."
              className="cyber-input pl-10 w-64 lg:w-96"
            />
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
