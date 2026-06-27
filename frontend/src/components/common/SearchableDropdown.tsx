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

  // Handle click outside to close dropdown (using mousedown on document, but ignore inside portal)
  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (containerRef.current && containerRef.current.contains(target)) return
      // If clicking inside portal dropdown, don't close
      const portalDropdown = document.querySelector('[data-searchable-dropdown-portal]')
      if (portalDropdown && portalDropdown.contains(target)) return
      setIsOpen(false)
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
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
      data-searchable-dropdown-portal
      className="fixed z-50 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-xl max-h-80 flex flex-col"
      style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
    >
      {/* Search Input */}
      <div className="p-2 border-b border-[var(--border)]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--fg-3)]" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="ค้นหา..."
            className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg pl-9 pr-3 py-2 text-sm text-[var(--fg-2)] focus:outline-none focus:border-phopy-indigo"
            autoFocus
          />
        </div>
      </div>

      {/* Options List */}
      <div className="overflow-y-auto max-h-60">
        {filteredOptions.length === 0 ? (
          <div className="p-3 text-center text-[var(--fg-4)] text-sm">
            ไม่พบข้อมูล
          </div>
        ) : (
          filteredOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                handleSelect(option.id)
              }}
              className={`w-full px-3 py-2 text-left text-sm hover:bg-[var(--primary-soft)] transition-colors min-h-[44px] flex items-center ${
                value === option.id
                  ? 'bg-[var(--primary-soft)] text-[var(--primary)]'
                  : 'text-[var(--fg-2)]'
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
        className={`phopy-input w-full flex items-center justify-between text-left ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
        }`}
      >
        <span className={selectedOption ? 'text-[var(--fg-2)]' : 'text-[var(--fg-4)]'}>
          {selectedOption?.label || placeholder}
        </span>
        <div className="flex items-center gap-1">
          {value && !disabled && (
            <div
              onClick={handleClear}
              className="p-0.5 hover:bg-[var(--bg)] rounded cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
              role="button"
            >
              <X className="w-4 h-4 text-[var(--fg-3)] hover:text-[var(--fg-2)]" />
            </div>
          )}
          <ChevronDown
            className={`w-4 h-4 text-[var(--fg-3)] transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {/* Dropdown via Portal */}
      {isOpen && createPortal(dropdownContent, document.body)}
    </div>
  )
}
