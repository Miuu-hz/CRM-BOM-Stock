import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Gift, ImagePlus, Megaphone, Plus, Tag, Trash2 } from 'lucide-react'
import api from '../../services/api'

// Settings → QR โปร / แลกแต้ม / โฆษณา — สิ่งที่ลูกค้าเห็นในแท็บ "โปรและแลกแต้ม" และ Pop-up บนหน้า QR สั่งที่โต๊ะ
// backend: routes/qr-marketing.routes.ts

interface Menu { id: string; product_name: string }
interface Promo { id: string; title: string; description: string | null; pos_menu_id: string | null; starts_on: string | null; ends_on: string | null; members_only: number; is_active: number }
interface Reward { id: string; name: string; points_cost: number; pos_menu_id: string; is_active: number; used_count: number }
interface AdSlot { image_url: string | null; link_type: 'none' | 'promo' | 'menu'; link_menu_id: string | null; starts_on: string | null; ends_on: string | null; daily_start: string | null; daily_end: string | null; is_enabled: number }
interface AdData { addon: boolean; slot: AdSlot | null; stats: { shown: number; tap: number; close: number } }

const BASE = '/pos/qr-marketing'
const errMsg = (e: any, fallback: string) => e?.response?.data?.message || fallback
const input = 'phopy-input w-full'
const card = 'p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] space-y-3'
const MAX_AD_MB = 5

function MenuSelect({ menus, value, onChange, placeholder }: { menus: Menu[]; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <select className={input} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {menus.map(m => <option key={m.id} value={m.id}>{m.product_name}</option>)}
    </select>
  )
}

export default function QrMarketingSettings() {
  const [menus, setMenus] = useState<Menu[]>([])
  const [promos, setPromos] = useState<Promo[]>([])
  const [rewards, setRewards] = useState<Reward[]>([])
  const [ad, setAd] = useState<AdData | null>(null)
  const [promoForm, setPromoForm] = useState({ title: '', description: '', pos_menu_id: '', starts_on: '', ends_on: '', members_only: false })
  const [rewardForm, setRewardForm] = useState({ name: '', points_cost: '', pos_menu_id: '' })
  const [adForm, setAdForm] = useState<AdSlot>({ image_url: null, link_type: 'none', link_menu_id: null, starts_on: null, ends_on: null, daily_start: null, daily_end: null, is_enabled: 1 })
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const [m, p, r, a] = await Promise.all([
        api.get('/pos/menu-configs'), api.get(`${BASE}/promotions`), api.get(`${BASE}/rewards`), api.get(`${BASE}/ad`),
      ])
      setMenus(m.data.data || [])
      setPromos(p.data.data || [])
      setRewards(r.data.data || [])
      setAd(a.data.data)
      if (a.data.data?.slot) setAdForm(a.data.data.slot)
    } catch (e) {
      toast.error(errMsg(e, 'โหลดข้อมูลไม่สำเร็จ'))
    }
  }, [])
  useEffect(() => { load() }, [load])

  const menuName = (id: string | null) => menus.find(m => m.id === id)?.product_name || '-'
  const run = async (fn: () => Promise<unknown>, ok: string, fail: string) => {
    try { await fn(); toast.success(ok); await load() } catch (e) { toast.error(errMsg(e, fail)) }
  }

  const addPromo = () => run(async () => {
    await api.post(`${BASE}/promotions`, { ...promoForm, pos_menu_id: promoForm.pos_menu_id || null })
    setPromoForm({ title: '', description: '', pos_menu_id: '', starts_on: '', ends_on: '', members_only: false })
  }, 'เพิ่มโปรแล้ว', 'เพิ่มโปรไม่สำเร็จ')
  const togglePromo = (p: Promo) => run(() => api.put(`${BASE}/promotions/${p.id}`, { ...p, members_only: p.members_only === 1, is_active: p.is_active !== 1 }), 'บันทึกแล้ว', 'บันทึกไม่สำเร็จ')
  const deletePromo = (p: Promo) => { if (confirm(`ลบโปร "${p.title}"?`)) run(() => api.delete(`${BASE}/promotions/${p.id}`), 'ลบแล้ว', 'ลบไม่สำเร็จ') }

  const addReward = () => run(async () => {
    await api.post(`${BASE}/rewards`, { ...rewardForm, points_cost: Number(rewardForm.points_cost) })
    setRewardForm({ name: '', points_cost: '', pos_menu_id: '' })
  }, 'เพิ่มรางวัลแล้ว', 'เพิ่มรางวัลไม่สำเร็จ')
  const stopReward = (r: Reward) => { if (confirm(`ปิดรางวัล "${r.name}"? ลูกค้าจะแลกไม่ได้อีก`)) run(() => api.delete(`${BASE}/rewards/${r.id}`), 'ปิดรางวัลแล้ว', 'ไม่สำเร็จ') }

  const uploadAd = (file?: File) => {
    if (!file) return
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { toast.error('รองรับเฉพาะ JPG, PNG หรือ WebP'); return }
    if (file.size > MAX_AD_MB * 1024 * 1024) { toast.error(`ไฟล์ใหญ่ ${(file.size / 1048576).toFixed(1)} MB เกิน ${MAX_AD_MB} MB กรุณาย่อรูปก่อน`); return }
    const fd = new FormData()
    fd.append('image', file)
    run(() => api.post(`${BASE}/ad/image`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }), 'อัปโหลดรูปแล้ว (แทนรูปเดิม)', 'อัปโหลดไม่สำเร็จ')
  }
  const saveAd = () => run(() => api.put(`${BASE}/ad`, { ...adForm, is_enabled: adForm.is_enabled === 1 }), 'บันทึกการตั้งค่า Pop-up แล้ว', 'บันทึกไม่สำเร็จ')

  return (
    <div className="space-y-8 max-w-2xl">
      <p className="text-sm text-[var(--fg-3)]">ลูกค้าเห็นสิ่งเหล่านี้บนหน้า QR สั่งที่โต๊ะ (แท็บ "โปรและแลกแต้ม" และ Pop-up ตอนเปิดเมนู)</p>

      {/* ---------- โปรโมชัน ---------- */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold text-[var(--fg-1)] flex items-center gap-2"><Tag className="w-5 h-5 text-[var(--primary)]" /> โปรโมชัน</h2>
        <div className={card}>
          <input className={input} placeholder="ชื่อโปร เช่น ชาไทยปั่น 1 แถม 1" maxLength={80} value={promoForm.title} onChange={e => setPromoForm({ ...promoForm, title: e.target.value })} />
          <input className={input} placeholder="รายละเอียด/เงื่อนไข (ไม่บังคับ)" maxLength={200} value={promoForm.description} onChange={e => setPromoForm({ ...promoForm, description: e.target.value })} />
          <MenuSelect menus={menus} value={promoForm.pos_menu_id} onChange={v => setPromoForm({ ...promoForm, pos_menu_id: v })} placeholder="ปุ่ม 'สั่งเลย' ใส่เมนู… (ไม่บังคับ)" />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-[var(--fg-3)]">เริ่ม<input type="date" className={input} value={promoForm.starts_on} onChange={e => setPromoForm({ ...promoForm, starts_on: e.target.value })} /></label>
            <label className="text-xs text-[var(--fg-3)]">สิ้นสุด<input type="date" className={input} value={promoForm.ends_on} onChange={e => setPromoForm({ ...promoForm, ends_on: e.target.value })} /></label>
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--fg-2)]">
            <input type="checkbox" checked={promoForm.members_only} onChange={e => setPromoForm({ ...promoForm, members_only: e.target.checked })} /> เฉพาะสมาชิก
          </label>
          <button onClick={addPromo} disabled={!promoForm.title.trim()} className="phopy-btn-primary px-4 py-2 rounded-lg text-sm flex items-center gap-1.5 disabled:opacity-40">
            <Plus className="w-4 h-4" /> เพิ่มโปร
          </button>
        </div>
        {promos.length > 0 && (
          <ul className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-xl">
            {promos.map(p => (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <div className="flex-1 min-w-0">
                  <p className={`font-medium ${p.is_active ? 'text-[var(--fg-1)]' : 'text-[var(--fg-4)] line-through'}`}>{p.title}{p.members_only ? ' · สมาชิก' : ''}</p>
                  <p className="text-xs text-[var(--fg-4)]">{p.pos_menu_id ? `เมนู ${menuName(p.pos_menu_id)} · ` : ''}{p.starts_on || 'ตั้งแต่วันนี้'} – {p.ends_on || 'ไม่มีกำหนด'}</p>
                </div>
                <button onClick={() => togglePromo(p)} className="text-xs text-[var(--primary)] hover:underline">{p.is_active ? 'ปิด' : 'เปิด'}</button>
                <button onClick={() => deletePromo(p)} aria-label={`ลบโปร ${p.title}`} className="p-1.5 text-[var(--fg-3)] hover:text-danger"><Trash2 className="w-4 h-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------- รางวัลแลกแต้ม ---------- */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold text-[var(--fg-1)] flex items-center gap-2"><Gift className="w-5 h-5 text-warning" /> รางวัลแลกแต้ม (ของแถม)</h2>
        <p className="text-xs text-[var(--fg-4)]">สมาชิกที่แคชเชียร์ยืนยันแล้วกดแลกจากมือถือได้ · ของแถมเข้าบิลราคา 0 ตัดสต็อกตามสูตร · แต้มถูกจองตอนสั่ง ตัดจริงตอนรับชำระ (ลบรายการของแถมออก = ไม่ตัดแต้ม)</p>
        <div className={card}>
          <input className={input} placeholder="ชื่อรางวัล เช่น น้ำมะพร้าวฟรี 1 ลูก" maxLength={60} value={rewardForm.name} onChange={e => setRewardForm({ ...rewardForm, name: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <input type="number" min={1} step={1} className={input} placeholder="ใช้กี่แต้ม" value={rewardForm.points_cost} onChange={e => setRewardForm({ ...rewardForm, points_cost: e.target.value })} />
            <MenuSelect menus={menus} value={rewardForm.pos_menu_id} onChange={v => setRewardForm({ ...rewardForm, pos_menu_id: v })} placeholder="เมนูของแถม…" />
          </div>
          <button onClick={addReward} disabled={!rewardForm.name.trim() || !rewardForm.points_cost || !rewardForm.pos_menu_id}
            className="phopy-btn-primary px-4 py-2 rounded-lg text-sm flex items-center gap-1.5 disabled:opacity-40">
            <Plus className="w-4 h-4" /> เพิ่มรางวัล
          </button>
        </div>
        {rewards.length > 0 && (
          <ul className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-xl">
            {rewards.map(r => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <div className="flex-1 min-w-0">
                  <p className={`font-medium ${r.is_active ? 'text-[var(--fg-1)]' : 'text-[var(--fg-4)] line-through'}`}>{r.name}</p>
                  <p className="text-xs text-[var(--fg-4)]">{r.points_cost.toLocaleString()} แต้ม · {menuName(r.pos_menu_id)} · แลกไปแล้ว {r.used_count} ครั้ง</p>
                </div>
                {r.is_active === 1 && <button onClick={() => stopReward(r)} className="text-xs text-danger hover:underline">ปิด</button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------- Pop-up โฆษณา ---------- */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold text-[var(--fg-1)] flex items-center gap-2"><Megaphone className="w-5 h-5 text-[var(--primary)]" /> Pop-up โฆษณา <span className="text-xs font-normal text-[var(--fg-4)]">Add-on ฿19/เดือน</span></h2>
        {!ad ? null : !ad.addon ? (
          <div className={card}>
            <p className="text-sm text-[var(--fg-2)]">ลงรูปโปรของร้าน 1 รูป ขึ้นเต็มจอตอนลูกค้าเปิดเมนู มีปุ่มปิดชัดเจน ไม่มีนับถอยหลัง พร้อมสถิติการแสดงและการแตะ</p>
            <Link to="/settings?tab=subscription" className="inline-block phopy-btn-primary px-4 py-2 rounded-lg text-sm">ซื้อ Add-on ฿19/เดือน</Link>
          </div>
        ) : (
          <div className={card}>
            <div className="flex gap-4 items-start">
              <div className="w-24 aspect-[4/5] rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--surface-2)] grid place-items-center text-xs text-[var(--fg-4)] shrink-0">
                {ad.slot?.image_url ? <img src={ad.slot.image_url} alt="รูป Pop-up ปัจจุบัน" className="w-full h-full object-cover" /> : 'ยังไม่มีรูป'}
              </div>
              <div className="space-y-2 min-w-0">
                <p className="text-xs text-[var(--fg-4)]">1 ร้าน 1 รูป · อัปโหลดใหม่แทนรูปเดิม · แนะนำ 1080 × 1350 px (4:5) · JPG/PNG/WebP ไม่เกิน {MAX_AD_MB} MB</p>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => { uploadAd(e.target.files?.[0]); e.target.value = '' }} />
                <div className="flex gap-2">
                  <button onClick={() => fileRef.current?.click()} className="px-3 py-1.5 rounded-lg text-sm border border-[var(--border)] flex items-center gap-1.5"><ImagePlus className="w-4 h-4" /> {ad.slot?.image_url ? 'อัปโหลดรูปแทน' : 'อัปโหลดรูป'}</button>
                  {ad.slot?.image_url && <button onClick={() => run(() => api.delete(`${BASE}/ad/image`), 'ลบรูปแล้ว Pop-up จะไม่ขึ้น', 'ลบไม่สำเร็จ')} className="px-3 py-1.5 rounded-lg text-sm text-danger">ลบรูป</button>}
                </div>
              </div>
            </div>
            <label className="text-xs text-[var(--fg-3)] block">เมื่อลูกค้าแตะรูป
              <select className={input} value={adForm.link_type} onChange={e => setAdForm({ ...adForm, link_type: e.target.value as AdSlot['link_type'] })}>
                <option value="none">ไม่ทำอะไร</option>
                <option value="promo">ไปแท็บโปรและแลกแต้ม</option>
                <option value="menu">ไปที่เมนู…</option>
              </select>
            </label>
            {adForm.link_type === 'menu' && <MenuSelect menus={menus} value={adForm.link_menu_id || ''} onChange={v => setAdForm({ ...adForm, link_menu_id: v || null })} placeholder="เลือกเมนู" />}
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-[var(--fg-3)]">เริ่มวันที่<input type="date" className={input} value={adForm.starts_on || ''} onChange={e => setAdForm({ ...adForm, starts_on: e.target.value || null })} /></label>
              <label className="text-xs text-[var(--fg-3)]">ถึงวันที่<input type="date" className={input} value={adForm.ends_on || ''} onChange={e => setAdForm({ ...adForm, ends_on: e.target.value || null })} /></label>
              <label className="text-xs text-[var(--fg-3)]">แสดงตั้งแต่ (ไม่บังคับ)<input type="time" className={input} value={adForm.daily_start || ''} onChange={e => setAdForm({ ...adForm, daily_start: e.target.value || null })} /></label>
              <label className="text-xs text-[var(--fg-3)]">ถึงเวลา<input type="time" className={input} value={adForm.daily_end || ''} onChange={e => setAdForm({ ...adForm, daily_end: e.target.value || null })} /></label>
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--fg-2)]">
              <input type="checkbox" checked={adForm.is_enabled === 1} onChange={e => setAdForm({ ...adForm, is_enabled: e.target.checked ? 1 : 0 })} /> เปิดใช้ Pop-up
            </label>
            <button onClick={saveAd} className="phopy-btn-primary px-4 py-2 rounded-lg text-sm">บันทึก</button>
            <div className="grid grid-cols-3 gap-px bg-[var(--border)] rounded-lg overflow-hidden text-center">
              {([['shown', 'แสดง'], ['tap', 'แตะรูป'], ['close', 'กดปิด']] as const).map(([k, l]) => (
                <div key={k} className="bg-[var(--surface-2)] py-2"><p className="text-lg font-bold text-[var(--fg-1)]">{ad.stats[k].toLocaleString()}</p><p className="text-xs text-[var(--fg-4)]">{l} (30 วัน)</p></div>
              ))}
            </div>
            <p className="text-xs text-[var(--fg-4)]">ร้านรับผิดชอบเนื้อหารูป ห้ามโฆษณาเครื่องดื่มแอลกอฮอล์ (พ.ร.บ.ควบคุมเครื่องดื่มแอลกอฮอล์ ม.32) — ผู้ดูแลระบบระงับรูปที่ผิดข้อกำหนดได้</p>
          </div>
        )}
      </section>
    </div>
  )
}
