import { useEffect, useState, useCallback } from 'react'
import { Settings as SettingsIcon, Plus, Sparkles, Pencil, Save, X, MapPin, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import hrService, { HrSettingsData, PayItem, PayItemCalc, CheckinLocation } from '../../services/hr.service'

const DEFAULT_SETTINGS: HrSettingsData = {
  workHoursPerDay: 8,
  daysPerMonthForRate: 30,
  ssoRate: 0.05,
  ssoMinBase: 1650,
  ssoMaxBase: 17500,
  ssoIncludesOT: false,
  personalAllowance: 60000,
  expenseDeductionRate: 0.5,
  expenseDeductionCap: 100000,
  ssoDeductionCapPerYear: 9000,
  rosterMinStaff: 0,
  laborCostTargetPct: 25,
  loanInterestRatePct: 0,
}

export default function HrSettings() {
  const [settings, setSettings] = useState<HrSettingsData>(DEFAULT_SETTINGS)
  const [payItems, setPayItems] = useState<PayItem[]>([])
  const [loading, setLoading] = useState(true)
  const [savingSettings, setSavingSettings] = useState(false)
  const [creatingStarter, setCreatingStarter] = useState(false)

  // Checkin location
  const [checkinLoc, setCheckinLoc] = useState<CheckinLocation | null>(null)
  const [locLat, setLocLat] = useState('')
  const [locLng, setLocLng] = useState('')
  const [locRadius, setLocRadius] = useState('150')
  const [savingLoc, setSavingLoc] = useState(false)

  // Pay item form
  const [editingItem, setEditingItem] = useState<PayItem | null>(null)
  const [itemName, setItemName] = useState('')
  const [itemCalc, setItemCalc] = useState<PayItemCalc>('FIXED')
  const [itemAmount, setItemAmount] = useState('0')
  const [itemTaxable, setItemTaxable] = useState(true)
  const [itemSsoable, setItemSsoable] = useState(false)
  const [itemActive, setItemActive] = useState(true)
  const [savingItem, setSavingItem] = useState(false)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [s, items, loc] = await Promise.all([
        hrService.getSettings(),
        hrService.getPayItems(),
        typeof hrService.getCheckinLocation === 'function' ? hrService.getCheckinLocation().catch(() => null) : Promise.resolve(null),
      ])
      if (s) setSettings({ ...DEFAULT_SETTINGS, ...s })
      setPayItems(items || [])
      if (loc) {
        setCheckinLoc(loc)
        setLocLat(String(loc.lat))
        setLocLng(String(loc.lng))
        setLocRadius(String(loc.radius_m ?? 150))
      } else {
        setCheckinLoc(null)
        setLocLat('')
        setLocLng('')
        setLocRadius('150')
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'โหลดการตั้งค่าเงินเดือนไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    if (
      settings.loanInterestRatePct !== undefined &&
      (settings.loanInterestRatePct < 0 || settings.loanInterestRatePct > 15)
    ) {
      toast.error('ดอกเบี้ยเงินยืมต้องอยู่ระหว่าง 0–15% ต่อปี')
      return
    }
    setSavingSettings(true)
    try {
      const updated = await hrService.updateSettings(settings)
      setSettings(updated)
      toast.success('บันทึกการตั้งค่าคำนวณเงินเดือนแล้ว')
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.response?.data?.error || 'บันทึกการตั้งค่าไม่สำเร็จ')
    } finally {
      setSavingSettings(false)
    }
  }

  const handleCreateStarter = async () => {
    setCreatingStarter(true)
    try {
      const items = await hrService.createStarterPayItems()
      setPayItems(items)
      toast.success('สร้างชุดสวัสดิการร้านอาหารเรียบร้อย')
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'สร้างชุดสวัสดิการไม่สำเร็จ')
    } finally {
      setCreatingStarter(false)
    }
  }

  const resetItemForm = () => {
    setEditingItem(null)
    setItemName('')
    setItemCalc('FIXED')
    setItemAmount('0')
    setItemTaxable(true)
    setItemSsoable(false)
    setItemActive(true)
  }

  const startEditItem = (item: PayItem) => {
    setEditingItem(item)
    setItemName(item.name)
    setItemCalc(item.calc)
    setItemAmount(String(item.default_amount))
    setItemTaxable(item.taxable !== 0)
    setItemSsoable(item.ssoable !== 0)
    setItemActive(item.is_active !== 0)
  }

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!itemName.trim()) {
      toast.error('กรุณาระบุชื่อรายการสวัสดิการ/รายได้')
      return
    }
    setSavingItem(true)
    try {
      const payload = {
        name: itemName.trim(),
        calc: itemCalc,
        default_amount: Number(itemAmount || 0),
        taxable: itemTaxable ? 1 : 0,
        ssoable: itemSsoable ? 1 : 0,
        is_active: itemActive ? 1 : 0,
      }
      if (editingItem) {
        await hrService.updatePayItem(editingItem.id, payload)
        toast.success('อัปเดตรายการสวัสดิการแล้ว')
      } else {
        await hrService.createPayItem(payload)
        toast.success('เพิ่มรายการสวัสดิการแล้ว')
      }
      resetItemForm()
      const items = await hrService.getPayItems()
      setPayItems(items)
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'บันทึกรายการไม่สำเร็จ')
    } finally {
      setSavingItem(false)
    }
  }

  const handleUseCurrentPosition = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      toast.error('เบราว์เซอร์ไม่รองรับ GPS')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocLat(pos.coords.latitude.toFixed(6))
        setLocLng(pos.coords.longitude.toFixed(6))
        toast.success('ดึงพิกัดปัจจุบันแล้ว')
      },
      (err) => {
        toast.error(err?.message || 'ไม่สามารถดึงตำแหน่งพิกัดได้')
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const handleSaveLocation = async (e: React.FormEvent) => {
    e.preventDefault()
    const latNum = parseFloat(locLat)
    const lngNum = parseFloat(locLng)
    const radiusNum = parseFloat(locRadius) || 150
    if (isNaN(latNum) || isNaN(lngNum)) {
      toast.error('กรุณาระบุพิกัดละติจูดและลองจิจูดให้ถูกต้อง')
      return
    }
    setSavingLoc(true)
    try {
      const updated = await hrService.setCheckinLocation({
        lat: latNum,
        lng: lngNum,
        radius_m: radiusNum,
      })
      setCheckinLoc(updated)
      if (updated) {
        setLocLat(String(updated.lat))
        setLocLng(String(updated.lng))
        setLocRadius(String(updated.radius_m ?? 150))
      }
      toast.success('บันทึกจุดเช็คอินแล้ว')
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.response?.data?.error || 'บันทึกจุดเช็คอินไม่สำเร็จ')
    } finally {
      setSavingLoc(false)
    }
  }

  const handleDeleteLocation = async () => {
    setSavingLoc(true)
    try {
      await hrService.setCheckinLocation(null)
      setCheckinLoc(null)
      setLocLat('')
      setLocLng('')
      setLocRadius('150')
      toast.success('ลบจุดเช็คอินแล้ว')
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.response?.data?.error || 'ลบจุดเช็คอินไม่สำเร็จ')
    } finally {
      setSavingLoc(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[var(--primary-soft)] flex items-center justify-center">
          <SettingsIcon className="w-5 h-5 text-[var(--primary)]" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-[var(--fg-1)]">ตั้งค่าเงินเดือนและสวัสดิการ</h1>
          <p className="text-xs text-[var(--fg-3)]">
            กำหนดอัตราประกันสังคม การคำนวณภาษีหัก ณ ที่จ่าย (ภ.ง.ด.1) และรายการเงินได้ประจำ (Pay Items)
          </p>
        </div>
      </div>

      {loading ? (
        <div className="phopy-card p-8 text-center text-sm text-[var(--fg-3)]">กำลังโหลด...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Calculation settings */}
          <form onSubmit={handleSaveSettings} className="phopy-card p-5 space-y-4">
            <h2 className="text-base font-bold text-[var(--fg-1)] border-b border-[var(--border)] pb-2">
              เกณฑ์คำนวณประกันสังคมและภาษีเงินได้ (ภ.ง.ด.1)
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  ชั่วโมงทำงานต่อวัน (ชม.)
                </label>
                <input
                  type="number"
                  min="1"
                  max="24"
                  step="0.5"
                  value={settings.workHoursPerDay}
                  onChange={(e) => setSettings({ ...settings, workHoursPerDay: Number(e.target.value) })}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  จำนวนวันต่อเดือน (คิดเรทรายเดือน)
                </label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={settings.daysPerMonthForRate}
                  onChange={(e) => setSettings({ ...settings, daysPerMonthForRate: Number(e.target.value) })}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  อัตราประกันสังคม (%)
                </label>
                <input
                  type="number"
                  min="0"
                  max="20"
                  step="0.1"
                  value={Number((settings.ssoRate * 100).toFixed(2))}
                  onChange={(e) => setSettings({ ...settings, ssoRate: Number(e.target.value) / 100 })}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  ฐานค่าจ้างขั้นต่ำ สปส. (฿)
                </label>
                <input
                  type="number"
                  min="0"
                  value={settings.ssoMinBase}
                  onChange={(e) => setSettings({ ...settings, ssoMinBase: Number(e.target.value) })}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  เพดานฐานค่าจ้างสูงสุด สปส. (฿)
                </label>
                <input
                  type="number"
                  min="0"
                  value={settings.ssoMaxBase}
                  onChange={(e) => setSettings({ ...settings, ssoMaxBase: Number(e.target.value) })}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  ค่าลดหย่อนส่วนตัวต่อปี (฿)
                </label>
                <input
                  type="number"
                  min="0"
                  value={settings.personalAllowance}
                  onChange={(e) => setSettings({ ...settings, personalAllowance: Number(e.target.value) })}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  เพดานหักค่าใช้จ่ายต่อปี (฿)
                </label>
                <input
                  type="number"
                  min="0"
                  value={settings.expenseDeductionCap}
                  onChange={(e) => setSettings({ ...settings, expenseDeductionCap: Number(e.target.value) })}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  เพดานลดหย่อน สปส. ต่อปี (฿)
                </label>
                <input
                  type="number"
                  min="0"
                  value={settings.ssoDeductionCapPerYear}
                  onChange={(e) => setSettings({ ...settings, ssoDeductionCapPerYear: Number(e.target.value) })}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                id="ssoIncludesOT"
                type="checkbox"
                checked={settings.ssoIncludesOT}
                onChange={(e) => setSettings({ ...settings, ssoIncludesOT: e.target.checked })}
              />
              <label htmlFor="ssoIncludesOT" className="text-sm text-[var(--fg-2)]">
                นำค่าล่วงเวลา (OT) มารวมเป็นฐานคำนวณประกันสังคม
              </label>
            </div>

            {/* ตารางกะ / เงินยืม */}
            <div className="pt-3 border-t border-[var(--border)] space-y-3">
              <h3 className="text-sm font-bold text-[var(--fg-1)]">ตารางกะ / เงินยืม</h3>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="rosterMinStaff" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                    คนขั้นต่ำต่อวัน (คน)
                  </label>
                  <input
                    id="rosterMinStaff"
                    type="number"
                    min="0"
                    step="1"
                    value={settings.rosterMinStaff ?? 0}
                    onChange={(e) => setSettings({ ...settings, rosterMinStaff: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                  <p className="text-[11px] text-[var(--fg-3)] mt-0.5">0 = ไม่เตือน</p>
                </div>

                <div>
                  <label htmlFor="laborCostTargetPct" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                    เป้าค่าแรง/ยอดขาย (%)
                  </label>
                  <input
                    id="laborCostTargetPct"
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={settings.laborCostTargetPct ?? 25}
                    onChange={(e) => setSettings({ ...settings, laborCostTargetPct: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                  <p className="text-[11px] text-[var(--fg-3)] mt-0.5">ค่าตั้งต้น 25%</p>
                </div>

                <div>
                  <label htmlFor="loanInterestRatePct" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                    ดอกเบี้ยเงินยืมตั้งต้น (% ต่อปี)
                  </label>
                  <input
                    id="loanInterestRatePct"
                    type="number"
                    min="0"
                    max="15"
                    step="any"
                    value={settings.loanInterestRatePct ?? 0}
                    onChange={(e) => setSettings({ ...settings, loanInterestRatePct: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                  <p className="text-[11px] text-[var(--fg-3)] mt-0.5">ป.พ.พ. ม.654 ไม่เกิน 15% ต่อปี</p>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-[var(--border)]">
              <button
                type="submit"
                disabled={savingSettings}
                className="phopy-btn-primary px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {savingSettings ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
              </button>
            </div>
          </form>

          {/* Pay Items CRUD */}
          <div className="phopy-card p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-2">
              <h2 className="text-base font-bold text-[var(--fg-1)]">รายการสวัสดิการ / รายได้ประจำ (Pay Items)</h2>
              <button
                type="button"
                onClick={handleCreateStarter}
                disabled={creatingStarter}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--primary-soft)] text-[var(--primary)] hover:opacity-90 flex items-center gap-1.5 disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {creatingStarter ? 'กำลังสร้าง...' : 'สร้างชุดสวัสดิการร้านอาหาร'}
              </button>
            </div>

            <form onSubmit={handleSaveItem} className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--fg-2)]">
                  {editingItem ? `แก้ไขรายการ: ${editingItem.name}` : 'เพิ่มรายการสวัสดิการใหม่'}
                </span>
                {editingItem && (
                  <button
                    type="button"
                    onClick={resetItemForm}
                    className="text-xs text-[var(--fg-3)] hover:text-[var(--fg-1)] flex items-center gap-1"
                  >
                    <X className="w-3.5 h-3.5" /> ยกเลิกแก้ไข
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1">ชื่อรายการ *</label>
                  <input
                    type="text"
                    value={itemName}
                    onChange={(e) => setItemName(e.target.value)}
                    placeholder="เช่น ค่าอาหาร, เบี้ยขยัน"
                    className="w-full px-2.5 py-1.5 text-sm rounded bg-[var(--surface)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1">วิธีคิด</label>
                  <select
                    value={itemCalc}
                    onChange={(e) => setItemCalc(e.target.value as PayItemCalc)}
                    className="w-full px-2.5 py-1.5 text-sm rounded bg-[var(--surface)] border border-[var(--border)] text-[var(--fg-1)]"
                  >
                    <option value="FIXED">คงที่ต่อเดือน (FIXED)</option>
                    <option value="PER_DAY">ตามวันทำงานจริง (PER_DAY)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1">จำนวนเงินเริ่มต้น (฿)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={itemAmount}
                    onChange={(e) => setItemAmount(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-sm rounded bg-[var(--surface)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--fg-2)]">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={itemTaxable}
                      onChange={(e) => setItemTaxable(e.target.checked)}
                    />
                    รวมคำนวณภาษี (Taxable)
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={itemSsoable}
                      onChange={(e) => setItemSsoable(e.target.checked)}
                    />
                    รวมฐาน สปส. (SSO)
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={itemActive}
                      onChange={(e) => setItemActive(e.target.checked)}
                    />
                    เปิดใช้งาน
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={savingItem}
                  className="phopy-btn-primary px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {editingItem ? 'บันทึกการแก้ไข' : 'เพิ่มรายการ'}
                </button>
              </div>
            </form>

            {payItems.length === 0 ? (
              <div className="p-6 text-center text-xs text-[var(--fg-3)]">
                ยังไม่มีรายการสวัสดิการ กดปุ่ม &ldquo;สร้างชุดสวัสดิการร้านอาหาร&rdquo; เพื่อเริ่มต้นอย่างรวดเร็ว
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="phopy-table w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-[var(--fg-3)]">
                      <th className="py-2 px-3">ชื่อรายการ</th>
                      <th className="py-2 px-3">วิธีคิด</th>
                      <th className="py-2 px-3 text-right">ค่าเริ่มต้น (฿)</th>
                      <th className="py-2 px-3 text-center">ภาษี</th>
                      <th className="py-2 px-3 text-center">สปส.</th>
                      <th className="py-2 px-3 text-center">สถานะ</th>
                      <th className="py-2 px-3 text-right">แก้ไข</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {payItems.map((item) => (
                      <tr key={item.id} className="hover:bg-[var(--surface-2)]/60">
                        <td className="py-2 px-3 font-medium text-[var(--fg-1)]">{item.name}</td>
                        <td className="py-2 px-3 text-[var(--fg-2)]">
                          {item.calc === 'PER_DAY' ? 'ต่อวัน (PER_DAY)' : 'คงที่ (FIXED)'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-[var(--fg-1)]">
                          {Number(item.default_amount || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-2 px-3 text-center">{item.taxable ? '✓' : '-'}</td>
                        <td className="py-2 px-3 text-center">{item.ssoable ? '✓' : '-'}</td>
                        <td className="py-2 px-3 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                              item.is_active
                                ? 'bg-[var(--success-soft)] text-[var(--success)]'
                                : 'bg-[var(--surface-2)] text-[var(--fg-3)]'
                            }`}
                          >
                            {item.is_active ? 'ใช้งาน' : 'ปิด'}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => startEditItem(item)}
                            className="p-1 rounded hover:bg-[var(--surface-2)] text-[var(--fg-2)]"
                            title="แก้ไข"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* จุดเช็คอิน (GPS) */}
          <div className="phopy-card p-5 space-y-4 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-2">
              <div>
                <h2 className="text-base font-bold text-[var(--fg-1)]">จุดเช็คอิน (GPS)</h2>
                <p className="text-xs text-[var(--fg-3)]">
                  ไม่ตั้งจุด = เช็คอินได้จากทุกที่
                </p>
              </div>
              {checkinLoc && (
                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--success-soft)] text-[var(--success-strong)]">
                  ตั้งจุดแล้ว ({checkinLoc.lat.toFixed(4)}, {checkinLoc.lng.toFixed(4)} · รัศมี {checkinLoc.radius_m} ม.)
                </span>
              )}
            </div>

            <form onSubmit={handleSaveLocation} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                    ละติจูด (Latitude)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={locLat}
                    onChange={(e) => setLocLat(e.target.value)}
                    placeholder="เช่น 13.7563"
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                    ลองจิจูด (Longitude)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={locLng}
                    onChange={(e) => setLocLng(e.target.value)}
                    placeholder="เช่น 100.5018"
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                    รัศมี (เมตร, ค่าเริ่มต้น 150)
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={locRadius}
                    onChange={(e) => setLocRadius(e.target.value)}
                    placeholder="150"
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--border)]">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleUseCurrentPosition}
                    className="px-3 py-2 rounded-lg text-xs font-semibold bg-[var(--surface-2)] hover:bg-[var(--surface-sunken)] text-[var(--fg-1)] border border-[var(--border)] flex items-center gap-1.5"
                  >
                    <MapPin className="w-3.5 h-3.5 text-[var(--primary)]" />
                    ใช้ตำแหน่งปัจจุบัน
                  </button>
                  {checkinLoc && (
                    <button
                      type="button"
                      onClick={handleDeleteLocation}
                      disabled={savingLoc}
                      className="px-3 py-2 rounded-lg text-xs font-semibold text-[var(--danger)] hover:bg-[var(--danger-soft)] flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      ลบจุดเช็คอิน
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={savingLoc}
                  className="phopy-btn-primary px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {savingLoc ? 'กำลังบันทึก...' : 'บันทึกจุดเช็คอิน'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
