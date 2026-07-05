import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import th from "./locales/th/translation.json";
import en from "./locales/en/translation.json";

const savedLanguage = localStorage.getItem("phopy-language")
const initialLanguage = savedLanguage === "en" ? "en" : "th"

i18n
  .use(initReactI18next)
  .init({
    resources: {
      th: { translation: th },
      en: { translation: en },
    },
    lng: initialLanguage,
    fallbackLng: ["th", "en"],
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
