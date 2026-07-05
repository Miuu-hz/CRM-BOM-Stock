import { createContext, useContext, useState, useEffect, ReactNode } from "react"
import i18n from "../i18n"

type Language = "th" | "en"

interface LanguageContextType {
  language: Language
  toggleLanguage: () => void
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem("phopy-language") as Language | null
    if (saved === "th" || saved === "en") return saved
    return "th"
  })

  useEffect(() => {
    if (i18n.language !== language) {
      i18n.changeLanguage(language)
    }
    localStorage.setItem("phopy-language", language)
  }, [language])

  const toggleLanguage = () => {
    setLanguage(prev => prev === "th" ? "en" : "th")
  }

  return (
    <LanguageContext.Provider value={{ language, toggleLanguage }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) throw new Error("useLanguage must be used within a LanguageProvider")
  return context
}
