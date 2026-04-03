import { useEffect, useRef } from 'react'

/**
 * Stack-based modal close hook
 * - ESC key closes the TOPMOST open modal only
 * - Each modal registers onClose on mount, unregisters on unmount
 * Usage: call `useModalClose(onClose)` inside any modal component
 */

const closeStack: Array<() => void> = []

// Single global ESC listener — added once when the module is first imported
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' && closeStack.length > 0) {
      e.preventDefault()
      closeStack[closeStack.length - 1]()
    }
  })
}

export function useModalClose(onClose: () => void) {
  // Keep a ref so the stack always has the latest onClose even if it changes
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const fn = () => onCloseRef.current()
    closeStack.push(fn)
    return () => {
      const idx = closeStack.lastIndexOf(fn)
      if (idx !== -1) closeStack.splice(idx, 1)
    }
  }, [])
}
