import { useState, useEffect, useRef, useCallback } from 'react'
import searchService, { SearchResult } from '../services/search'

export function useGlobalSearch(debounceMs = 300) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([])
      setIsOpen(false)
      setIsLoading(false)
      return
    }

    setIsLoading(true)

    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(async () => {
      try {
        const data = await searchService.search(query)
        setResults(data.results)
        setIsOpen(true)
      } catch {
        setResults([])
      } finally {
        setIsLoading(false)
      }
    }, debounceMs)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [query, debounceMs])

  const close = useCallback(() => {
    setIsOpen(false)
  }, [])

  const clear = useCallback(() => {
    setQuery('')
    setResults([])
    setIsOpen(false)
  }, [])

  return { query, setQuery, results, isOpen, isLoading, close, clear }
}
