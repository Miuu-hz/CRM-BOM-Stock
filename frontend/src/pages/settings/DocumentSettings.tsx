import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Save, RefreshCw, AlertTriangle, Palette, Plus, Trash2, ImageOff, Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'
import documentSettingsService, {
  DEFAULT_DOCUMENT_SETTINGS,
  type DocumentSettings as DocumentSettingsData,
  type DocTypeKey,
  type PaperSize,
} from '../../services/documentSettings.service'
import bankAccountsService, { type BankAccount } from '../../services/bankAccounts.service'

const DOC_TYPE_KEYS: DocTypeKey[] = ['qt', 'so', 'inv', 'dn', 'rc', 'cn', 'pr', 'po', 'gr', 'pi', 'payment', 'return', 'wo']
const PAPER_OPTIONS: { value: PaperSize; label: string }[] = [
  { value: 'A4', label: 'A4' },
  { value: 'A5', label: 'A5' },
  { value: 'THERMAL', label: '80mm (ความร้อน)' },
]
const MAX_SIGNATURE_SLOTS = 4
const HEX_RE = /^#[0-9A-Fa-f]{6}$/

function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      className={`relative w-9 h-5 rounded-full transition-colors disabled:opacity-40 ${checked ? 'bg-[var(--primary)]' : 'bg-[var(--surface-2)]'}`}
    >
      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  )
}

export default function DocumentSettings() {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<DocumentSettingsData>(DEFAULT_DOCUMENT_SETTINGS)
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    const [settingsResult, banksResult] = await Promise.allSettled([
      documentSettingsService.get(),
      bankAccountsService.list(),
    ])
    if (settingsResult.status === 'fulfilled') {
      setSettings(settingsResult.value)
    } else {
      setSettings(DEFAULT_DOCUMENT_SETTINGS)
      setLoadError(true)
    }
    if (banksResult.status === 'fulfilled') setBankAccounts(banksResult.value)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const setPaper = (docType: DocTypeKey, value: PaperSize) =>
    setSettings((prev) => ({ ...prev, defaultPaper: { ...prev.defaultPaper, [docType]: value } }))

  const setColumn = (key: keyof DocumentSettingsData['columns']) =>
    setSettings((prev) => ({ ...prev, columns: { ...prev.columns, [key]: !prev.columns[key] } }))

  const setSlot = (idx: number, value: string) =>
    setSettings((prev) => ({ ...prev, signatureSlots: prev.signatureSlots.map((s, i) => (i === idx ? value : s)) }))

  const addSlot = () =>
    setSettings((prev) => (prev.signatureSlots.length >= MAX_SIGNATURE_SLOTS ? prev : { ...prev, signatureSlots: [...prev.signatureSlots, ''] }))

  const removeSlot = (idx: number) =>
    setSettings((prev) => ({ ...prev, signatureSlots: prev.signatureSlots.filter((_, i) => i !== idx) }))

  const save = async () => {
    if (!HEX_RE.test(settings.brandColor)) {
      toast.error(t('settings.documents.brand.invalidColor'))
      return
    }
    if (settings.marginMm < 5 || settings.marginMm > 30) {
      toast.error(t('settings.documents.paper.invalidMargin'))
      return
    }
    if (settings.fontSizePt < 8 || settings.fontSizePt > 16) {
      toast.error(t('settings.documents.paper.invalidFontSize'))
      return
    }
    setSaving(true)
    try {
      const { branding, ...payload } = settings
      const updated = await documentSettingsService.update(payload)
      setSettings(updated)
      setLoadError(false)
      toast.success(t('settings.documents.saveSuccess'))
    } catch (err: any) {
      toast.error(err.response?.data?.message || t('settings.documents.saveError'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-[var(--primary)]/30 border-t-[var(--primary)] rounded-full animate-spin" />
    </div>
  )

  const { branding } = settings

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[var(--primary-soft)] flex items-center justify-center">
          <FileText className="w-5 h-5 text-[var(--primary)]" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-[var(--fg-1)]">{t('settings.documents.title')}</h2>
          <p className="text-sm text-[var(--fg-3)]">{t('settings.documents.subtitle')}</p>
        </div>
        <div className="ml-auto flex gap-2">
          <button onClick={load} className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--fg-3)] hover:text-[var(--fg-1)] transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={save} disabled={saving} className="phopy-btn-primary flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-50">
            <Save className="w-4 h-4" /> {saving ? t('settings.documents.saving') : t('settings.documents.save')}
          </button>
        </div>
      </div>

      {loadError && (
        <div className="flex gap-3 bg-[var(--warning-soft,rgba(234,179,8,0.1))] border border-amber-500/30 rounded-xl p-4 text-sm text-[var(--fg-2)]">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <p>{t('settings.documents.loadError')}</p>
        </div>
      )}

      {/* โลโก้ & แบรนด์ */}
      <section className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 space-y-4">
        <h3 className="text-sm font-bold text-[var(--fg-1)]">{t('settings.documents.groups.brand')}</h3>

        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-lg border border-[var(--border)] bg-[var(--bg)] flex items-center justify-center overflow-hidden shrink-0">
            {branding.isFreePlan
              ? <img src="/brand/phopy-mark.png" alt="Phopy" className="w-full h-full object-contain" />
              : branding.logoBase64
                ? <img src={branding.logoBase64} alt="logo" className="w-full h-full object-contain" />
                : <ImageOff className="w-8 h-8 text-[var(--fg-4)]" />}
          </div>
          <div>
            <p className="text-sm text-[var(--fg-2)]">{t('settings.documents.brand.logoLabel')}</p>
            {branding.isFreePlan ? (
              <p className="text-sm text-amber-500 flex items-center gap-1.5 mt-1">
                <Sparkles className="w-3.5 h-3.5" /> {t('settings.documents.brand.freePlanUpgrade')}
              </p>
            ) : (
              <p className="text-xs text-[var(--fg-4)] mt-1">{t('settings.documents.brand.logoHint')}</p>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm text-[var(--fg-3)] mb-1">{t('settings.documents.brand.tagline')}</label>
          <input
            value={settings.companyTagline}
            onChange={(e) => setSettings((p) => ({ ...p, companyTagline: e.target.value }))}
            placeholder={t('settings.documents.brand.taglinePlaceholder') as string}
            maxLength={200}
            className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)]"
          />
        </div>

        <div>
          <label className="block text-sm text-[var(--fg-3)] mb-1 flex items-center gap-1.5">
            <Palette className="w-3.5 h-3.5" /> {t('settings.documents.brand.color')}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={HEX_RE.test(settings.brandColor) ? settings.brandColor : '#5b5bd6'}
              onChange={(e) => setSettings((p) => ({ ...p, brandColor: e.target.value }))}
              className="w-10 h-10 rounded-lg border border-[var(--border)] bg-transparent cursor-pointer"
            />
            <input
              value={settings.brandColor}
              onChange={(e) => setSettings((p) => ({ ...p, brandColor: e.target.value }))}
              placeholder="#5b5bd6"
              className="w-32 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm font-mono text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)]"
            />
          </div>
        </div>
      </section>

      {/* กระดาษ & ขนาด */}
      <section className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 space-y-4">
        <h3 className="text-sm font-bold text-[var(--fg-1)]">{t('settings.documents.groups.paper')}</h3>
        <p className="text-xs text-[var(--fg-4)] -mt-2">{t('settings.documents.paper.defaultPaper')}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {DOC_TYPE_KEYS.map((key) => (
            <div key={key} className="flex items-center justify-between gap-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2">
              <span className="text-sm text-[var(--fg-2)] truncate">{t(`settings.documents.docTypes.${key}`)}</span>
              <select
                value={settings.defaultPaper[key]}
                onChange={(e) => setPaper(key, e.target.value as PaperSize)}
                className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-2 py-1 text-sm text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)]"
              >
                {PAPER_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <div>
            <label className="block text-sm text-[var(--fg-3)] mb-1">{t('settings.documents.paper.margin')}</label>
            <input
              type="number" min={5} max={30}
              value={settings.marginMm}
              onChange={(e) => setSettings((p) => ({ ...p, marginMm: Math.min(Math.max(Number(e.target.value) || 0, 5), 30) }))}
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)]"
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--fg-3)] mb-1">{t('settings.documents.paper.fontSize')}</label>
            <input
              type="number" min={8} max={16}
              value={settings.fontSizePt}
              onChange={(e) => setSettings((p) => ({ ...p, fontSizePt: Math.min(Math.max(Number(e.target.value) || 0, 8), 16) }))}
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)]"
            />
          </div>
        </div>
      </section>

      {/* คอลัมน์ในตาราง */}
      <section className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 space-y-3">
        <h3 className="text-sm font-bold text-[var(--fg-1)]">{t('settings.documents.groups.columns')}</h3>
        {(['discount', 'vat', 'wht', 'sku'] as const).map((key) => (
          <div key={key} className="flex items-center justify-between py-1">
            <span className="text-sm text-[var(--fg-2)]">{t(`settings.documents.columns.${key}`)}</span>
            <Switch checked={settings.columns[key]} onChange={() => setColumn(key)} />
          </div>
        ))}
      </section>

      {/* ท้ายเอกสาร */}
      <section className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 space-y-4">
        <h3 className="text-sm font-bold text-[var(--fg-1)]">{t('settings.documents.groups.footer')}</h3>

        <div className="flex items-center justify-between py-1">
          <span className="text-sm text-[var(--fg-2)]">{t('settings.documents.footer.showBankInfo')}</span>
          <Switch checked={settings.showBankInfo} onChange={() => setSettings((p) => ({ ...p, showBankInfo: !p.showBankInfo }))} />
        </div>
        <div className="flex items-center justify-between py-1">
          <span className="text-sm text-[var(--fg-2)]">{t('settings.documents.footer.showPaymentQr')}</span>
          <Switch checked={settings.showPaymentQr} onChange={() => setSettings((p) => ({ ...p, showPaymentQr: !p.showPaymentQr }))} />
        </div>

        <div>
          <label className="block text-sm text-[var(--fg-3)] mb-1">{t('settings.documents.footer.defaultBankAccount')}</label>
          {bankAccounts.length === 0 ? (
            <p className="text-xs text-[var(--fg-4)]">{t('settings.documents.footer.noBankAccount')}</p>
          ) : (
            <select
              value={settings.defaultBankAccountId || ''}
              onChange={(e) => setSettings((p) => ({ ...p, defaultBankAccountId: e.target.value || null }))}
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)]"
            >
              <option value="">{t('settings.documents.footer.autoBankAccount')}</option>
              {bankAccounts.map((acc) => (
                <option key={acc.id} value={acc.id}>{acc.bank_name} - {acc.account_number}</option>
              ))}
            </select>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm text-[var(--fg-3)]">{t('settings.documents.footer.signatureSlots')}</label>
            <span className="text-xs text-[var(--fg-4)]">{settings.signatureSlots.length}/{MAX_SIGNATURE_SLOTS}</span>
          </div>
          <div className="space-y-2">
            {settings.signatureSlots.map((slot, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  value={slot}
                  onChange={(e) => setSlot(idx, e.target.value)}
                  className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)]"
                />
                <button onClick={() => removeSlot(idx)} className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-danger">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          {settings.signatureSlots.length < MAX_SIGNATURE_SLOTS && (
            <button
              onClick={addSlot}
              className="mt-2 text-sm text-[var(--primary)] hover:underline flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> {t('settings.documents.footer.addSlot')}
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
