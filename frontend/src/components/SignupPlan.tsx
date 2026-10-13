import { useEffect, useState } from 'react'
import api from '../services/api'

// แถบแพ็กที่เลือกมาจากหน้าราคา phopy.net (?plan=) — โชว์ราคา + ให้เลือก Pack แล้วทดลองแพ็กนั้นได้ทันที 30 วัน
interface CatalogPlan { code: string; name: string; monthly: number; includedPacks: number | 'all'; canBuyPacks: boolean }
interface Catalog { yearlyMonths: number; packPrice: number; packs: string[]; plans: CatalogPlan[] }

const PACK_LABEL: Record<string, string> = {
  shop: 'Shop — ร้าน/คาเฟ่ (KDS, ปิดกะ)',
  online: 'Online — Shopee/Lazada',
  maker: 'Maker — ผลิต (BOM, ใบสั่งผลิต)',
  accounting: 'Accounting — บัญชี/ภาษี',
}

type Props = {
  plan: string
  cycle: 'monthly' | 'yearly'
  packs: string[]
  onPacksChange: (packs: string[]) => void
}

export default function SignupPlan({ plan, cycle, packs, onPacksChange }: Props) {
  const [catalog, setCatalog] = useState<Catalog | null>(null)

  useEffect(() => {
    api.get('/billing/catalog').then(res => setCatalog(res.data.data)).catch(() => setCatalog(null))
  }, [])

  const p = catalog?.plans.find(x => x.code === plan)
  if (!catalog || !p) return null

  const price = cycle === 'yearly' ? p.monthly * catalog.yearlyMonths : p.monthly
  const included = p.includedPacks === 'all' ? null : p.includedPacks
  const extra = included === null ? 0 : Math.max(0, packs.length - included)

  return (
    <div className="mb-5 p-4 rounded-xl border-2 border-[var(--primary)] bg-[var(--primary-soft)]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold text-[var(--fg-1)]">แพ็ก {p.name}</span>
        <span className="font-bold text-[var(--fg-1)] tabular-nums">
          ฿{price.toLocaleString('th-TH')}<span className="text-xs font-normal text-[var(--fg-3)]">/{cycle === 'yearly' ? 'ปี' : 'เดือน'} + VAT</span>
        </span>
      </div>
      {cycle === 'yearly' && (
        <p className="text-xs tabular-nums mt-0.5">
          <s className="text-[var(--fg-4)]">฿{(p.monthly * 12).toLocaleString('th-TH')}</s>{' '}
          <span className="text-[var(--success)]">ประหยัด ฿{(p.monthly * 12 - price).toLocaleString('th-TH')}</span>
        </p>
      )}
      <p className="text-xs text-[var(--success)] mt-1">ใช้ได้ทันทีฟรี 30 วัน ไม่ต้องใส่บัตร · ครบแล้วไม่สมัครต่อ = กลับเป็น Free ข้อมูลอยู่ครบ</p>
      <a href="https://phopy.net/compare/" target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--primary)] underline underline-offset-2">แพ็กนี้ได้อะไรบ้าง? ดูตารางเปรียบเทียบ</a>
      {p.canBuyPacks && included !== null && (
        <fieldset className="mt-3">
          <legend className="text-xs text-[var(--fg-3)] mb-1.5">
            เลือก {included} Pack ตามธุรกิจ{extra > 0 && ` · เกิน ${extra} Pack +฿${(extra * catalog.packPrice * (cycle === 'yearly' ? catalog.yearlyMonths : 1)).toLocaleString('th-TH')}/${cycle === 'yearly' ? 'ปี' : 'เดือน'}`}
          </legend>
          <div className="grid gap-1.5">
            {catalog.packs.map(code => (
              <label key={code} className="flex items-center gap-2 text-sm text-[var(--fg-2)] cursor-pointer">
                <input type="checkbox" checked={packs.includes(code)}
                  onChange={() => onPacksChange(packs.includes(code) ? packs.filter(c => c !== code) : [...packs, code])} />
                {PACK_LABEL[code] ?? code}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  )
}
