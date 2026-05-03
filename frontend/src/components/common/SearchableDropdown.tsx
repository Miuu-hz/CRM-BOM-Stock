import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import { createPortal } from 'react-dom'

interface SearchableDropdownProps {
  value: string
  onChange: (value: string) => void
  options: { id: string; label: string; searchText?: string }[]
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function SearchableDropdown({
  value,
  onChange,
  options,
  placeholder = 'เลือก...',
  disabled = false,
  className = '',
}: SearchableDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 })

  const selectedOption = options.find((opt) => opt.id === value)

  // Update dropdown position when opened
  useEffect(() => {
    if (isOpen && containerRef.current) {
      const updatePos = () => {
        const rect = containerRef.current!.getBoundingClientRect()
        setDropdownPos({
          top: rect.bottom + 4,
          left: rect.left,
          width: rect.width,
        })
      }
      updatePos()
      window.addEventListener('resize', updatePos)
      window.addEventListener('scroll', updatePos, true)
      return () => {
        window.removeEventListener('resize', updatePos)
        window.removeEventListener('scroll', updatePos, true)
      }
    }
  }, [isOpen])

  // Filter options based on search term
  const filteredOptions = searchTerm
    ? options.filter(
        (opt) =>
          opt.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
          opt.searchText?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : options

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Reset search when closed
  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('')
    }
  }, [isOpen])

  const handleSelect = (id: string) => {
    onChange(id)
    setIsOpen(false)
    setSearchTerm('')
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange('')
  }

  const dropdownContent = (
    <div
      className="fixed z-[100] bg-cyber-card border border-cyber-border rounded-lg shadow-xl max-h-80 flex flex-col"
      style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
    >
      {/* Search Input */}
      <div className="p-2 border-b border-cyber-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="ค้นหา..."
            className="w-full bg-cyber-dark border border-cyber-border rounded-lg pl-9 pr-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-cyber-primary"
            autoFocus
          />
        </div>
      </div>

      {/* Options List */}
      <div className="overflow-y-auto max-h-60">
        {filteredOptions.length === 0 ? (
          <div className="p-3 text-center text-gray-500 text-sm">
            ไม่พบข้อมูล
          </div>
        ) : (
          filteredOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => handleSelect(option.id)}
              className={`w-full px-3 py-2 text-left text-sm hover:bg-cyber-primary/20 transition-colors ${
                value === option.id
                  ? 'bg-cyber-primary/20 text-cyber-primary'
                  : 'text-gray-300'
              }`}
            >
              {option.label}
            </button>
          ))
        )}
      </div>
    </div>
  )

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`cyber-input w-full flex items-center justify-between text-left ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
        }`}
      >
        <span className={selectedOption ? 'text-gray-200' : 'text-gray-500'}>
          {selectedOption?.label || placeholder}
        </span>
        <div className="flex items-center gap-1">
          {value && !disabled && (
            <div
              onClick={handleClear}
              className="p-0.5 hover:bg-cyber-dark rounded cursor-pointer"
              role="button"
            >
              <X className="w-4 h-4 text-gray-400 hover:text-gray-300" />
            </div>
          )}
          <ChevronDown
            className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {/* Dropdown via Portal */}
      {isOpen && createPortal(dropdownContent, document.body)}
    </div>
  )
}
