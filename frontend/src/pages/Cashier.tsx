import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link, useSearchParams } from 'react-router-dom'
import {Store, Plus, Receipt, CreditCard, Banknote, QrCode, Trash2, Minus, X, ChefHat, Clock, Search, Edit2, Package, RotateCcw, Check, Settings, Tag, ChevronDown, ChevronUp, UserPlus, Star, UserX, Printer, AlertTriangle, Scale, Utensils, ArrowLeft, Wallet, ArrowDownToLine, ArrowUpFromLine, History} from 'lucide-react'
import toast from 'react-hot-toast'
import { useApprovalGate } from '../components/common/ApprovalGate'
import posService, { shiftErrorCode, openBillNumbers, expectedShiftCash } from '../services/pos.service'
import { useTranslation } from 'react-i18next'
import posBillService from '../services/pos-bill.service'
import kdsService from '../services/kds.service'
import { loadBillingConfig, type BillingConfig, loadLoyaltyConfig, type LoyaltyConfig, loadShopConfig } from './Settings'
import { billTotals } from '../utils/posVat'
import { printPOSReceipt } from '../utils/printBill'
import { useModalClose } from '../hooks/useModalClose'
import { VatModeField } from '../components/common/VatModeSelector'
import bankAccountsService, { getCachedDefaultBankAccount } from '../services/bankAccounts.service'
import { accountsApi } from '../services/accounting'
import api from '../services/api'
import companySettingsService, { getCachedCompanySettings } from '../services/companySettings.service'
import TableBoard from '../components/cashier/TableBoard'

// ==================== Types ====================

interface POSMenu {
  id: string
  product_id: string
  product_name: string
  product_code: string
  category_id?: string
  category_name?: string
  category_color?: string
  pos_price: number
  is_available: boolean
  preparation_time: number
  description?: string
  image_url?: string
}

interface POSCategory {
  id: string
  name: string
  color: string
}

interface OpenBill {
  id: string
  bill_number: string
  display_name: string
  customer_id?: string
  customer_name?: string
  subtotal: number
  total_amount: number
  item_count: number
  opened_at: string
  closed_at?: string
  status?: string
  invoice_number?: string | null
}

interface BillItem {
  id: string
  product_name: string
  quantity: number
  unit_price: number
  total_price: number
  special_instructions?: string
  sent_to_kds: boolean
}

interface CRMCustomer {
  id: string
  code: string
  name: string
  phone: string
  loyalty_points: number
  total_spent: number
}

interface CurrentBill {
  id: string
  bill_number: string
  display_name: string
  status?: string
  customer_id?: string
  customer_name?: string
  customer_phone?: string
  customer_loyalty_points?: number
  customer_reserved_points?: number
  customer_code?: string
  customer_tax_id?: string
  customer_address?: string
  customer_tax_branch?: string
  items: BillItem[]
  subtotal: number
  tax_amount: number
  service_charge_amount: number
  total_amount: number
  receipt_url?: string
  receipt_qr?: string
  invoice?: { id: string; invoice_number: string; status: string } | null
  table_id?: string | null
  bill_requested_at?: string | null
  member_device_id?: string | null
  member_device_verified_at?: string | null
}

interface POSShift {
  id: string
  shift_number: string
  status: 'OPEN' | 'CLOSED'
  opened_at: string
  opening_cash: number
  stale?: boolean
  live?: { total_revenue: number; cash_revenue: number; bank_revenue: number; cash_in?: number; paid_out?: number }
}

interface CashMovement {
  id: string
  type: 'PAID_OUT' | 'CASH_IN' | 'OPENING_GAP'
  amount: number
  reason?: string
  account_name?: string
  created_at: string
}

interface TodaySale {
  id: string
  bill_number: string
  display_name?: string
  total_amount: number
  closed_at: string
  methods: string[]
}

// ==================== Components ====================

export default function Cashier() {
  const { t } = useTranslation()
  // State
  const [view, setView] = useState<'bills' | 'menu'>('bills')
  const [openBills, setOpenBills] = useState<OpenBill[]>([])
  // ร้านที่ใช้ผังโต๊ะ/QR เปิดหน้าจอมาแล้วเจอผังโต๊ะเลย — จำแท็บล่าสุดของเครื่องนี้ (ชำระแล้วไม่จำ เป็นแค่สรุป)
  const [billsMode, setBillsModeState] = useState<'OPEN' | 'PAID' | 'TABLES'>(() => {
    try { return localStorage.getItem('pos_bills_mode') === 'TABLES' ? 'TABLES' : 'OPEN' } catch { return 'OPEN' }
  })
  const setBillsMode = (m: 'OPEN' | 'PAID' | 'TABLES') => {
    setBillsModeState(m)
    try { if (m !== 'PAID') localStorage.setItem('pos_bills_mode', m) } catch { /* โหมดส่วนตัว: ไม่จำก็ได้ */ }
  }
  const [todaySales, setTodaySales] = useState<TodaySale[]>([])
  const [drawerMoves, setDrawerMoves] = useState<CashMovement[]>([])
  const [showInvoiceModal, setShowInvoiceModal] = useState(false)
  const [currentBill, setCurrentBill] = useState<CurrentBill | null>(null)
  const [menus, setMenus] = useState<POSMenu[]>([])
  const [categories, setCategories] = useState<POSCategory[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditNameModal, setShowEditNameModal] = useState(false)
  const [editingItemNote, setEditingItemNote] = useState<BillItem | null>(null)
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [showAssignMemberModal, setShowAssignMemberModal] = useState(false)
  const [showReceiptQR, setShowReceiptQR] = useState(false)
  const [scanningBarcode, setScanningBarcode] = useState(false)
  const [payActionIssues, setPayActionIssues] = useState<any[] | null>(null)
  const [currentShift, setCurrentShift] = useState<POSShift | null | undefined>(undefined)
  const [showShiftModal, setShowShiftModal] = useState<'open' | 'close' | null>(null)
  const [showCashMovementModal, setShowCashMovementModal] = useState(false)
  // กะค้างข้ามวันที่ยังมีบิลค้าง: ปล่อยให้ชำระ/ยกเลิกบิลเดิมได้ แต่ห้ามเปิดบิลใหม่
  const [managingStaleBills, setManagingStaleBills] = useState(false)
  // Discount & extra charge (local, per-session)
  const [discount, setDiscount] = useState<{ type: 'pct' | 'fixed'; value: number }>({ type: 'pct', value: 0 })
  const [extraCharge, setExtraCharge] = useState<{ label: string; amount: number }>({ label: 'ค่าบริการอื่น', amount: 0 })
  const [expandedRow, setExpandedRow] = useState<'discount' | 'extra' | null>(null)
  const [billing, setBilling] = useState<BillingConfig>(loadBillingConfig)
  // กิจการที่ยังไม่มีเลขผู้เสียภาษี = ยังไม่จด VAT → ออกใบกำกับภาษีไม่ได้ตามกฎหมาย
  // ซ่อนทางเข้าไปเลย ดีกว่าปล่อยให้กดแล้วเด้ง error (backend กันไว้อีกชั้นที่ SELLER_TAX_ID_REQUIRED)
  const vatRegistered = !!String(getCachedCompanySettings().tax_id || '').trim()
  const [loyalty, setLoyalty] = useState<LoyaltyConfig>(loadLoyaltyConfig)

  // Reload billing & loyalty config when window gains focus (user may have changed settings)
  useEffect(() => {
    const onFocus = () => {
      setBilling(loadBillingConfig())
      setLoyalty(loadLoyaltyConfig())
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  // อัตราแต้มอยู่ที่ server แล้ว — ดึงใหม่ตอนเปิดหน้า ไม่งั้นเครื่องที่ไม่เคยเปิดหน้าตั้งค่าใช้ค่าตั้งต้น
  // โหลดไม่ได้ (เน็ตหลุด) ใช้ค่าที่แคชไว้ต่อ — backend คิดแต้มจริงจากค่าของตัวเองอยู่แล้ว
  useEffect(() => {
    companySettingsService.get().then(() => setLoyalty(loadLoyaltyConfig()))
      .catch(err => console.warn('[Cashier] โหลดค่าแต้มสะสมไม่ได้ ใช้ค่าที่แคชไว้', err))
  }, [])

  // Prime the bank-account cache (used for the QR payment step + receipt printing)
  useEffect(() => { bankAccountsService.list().catch(() => {}) }, [])
  // เกณฑ์ % ส่วนลดที่ต้องขออนุมัติ — ค่าเดียวกับที่ backend ใช้ตัดสิน (Settings → การอนุมัติ) ที่นี่แค่ไว้เตือนล่วงหน้า
  const [approvalDiscountPct, setApprovalDiscountPct] = useState(40)
  useEffect(() => {
    api.get('/approval/settings').then(r => {
      const v = (r.data?.data || []).find((s: any) => s.role === 'USER' && s.module_type === 'pos_discount')?.max_discount_pct
      if (v != null) setApprovalDiscountPct(v)
    }).catch(() => {})
  }, [])

  const [sendingToKitchen, setSendingToKitchen] = useState(false)

  // Fetch data
  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const [billsRes, menusRes, categoriesRes] = await Promise.all([
        posBillService.getOpenBills(),
        posService.getMenuConfigs(),
        posService.getCategories(),
      ])
      
      if (billsRes.success) setOpenBills(billsRes.data || [])
      if (menusRes.success) setMenus((menusRes.data || []).filter((m: POSMenu) => m.is_available))
      if (categoriesRes.success) setCategories(categoriesRes.data || [])
    } catch (error) {
      toast.error('Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // แท็บ "ชำระแล้ว" = สรุปของวันนี้ (เงินในลิ้นชัก + รายการขาย/เงินเข้าออก) — ประวัติย้อนหลังอยู่ที่
  // /accounting/pos-clearing ซึ่งลิงก์กลับมาเปิดบิลที่นี่ด้วย ?bill= (ออกใบกำกับภาษี/พิมพ์ซ้ำ)
  // ponytail: ดึงบิล PAID ทั้งหมดแล้วกรองวันนี้ฝั่งจอ เพราะ ?date= ของ endpoint กรองด้วย DATE() แบบ UTC
  //   (บิล 00:00–06:59 น. ตกไปวันก่อน) เพดาน: บิลทั้งปีมาทุกครั้งที่เปิดแท็บ — วันละหลายร้อยบิลค่อยกรองที่ backend
  const fetchPaidBills = useCallback(async () => {
    try {
      const [billsRes, movesRes] = await Promise.all([
        posService.getPendingClearingBills(),
        currentShift ? posService.getShiftCashMovements(currentShift.id) : Promise.resolve(null),
      ])
      if (billsRes.success) {
        const today = new Date().toDateString()
        const byId = new Map<string, TodaySale>()
        // endpoint join pos_payments → บิลจ่ายหลายช่องทางมาหลายแถว รวมเป็นบิลเดียว
        for (const r of billsRes.data || []) {
          if (!r.closed_at || new Date(r.closed_at).toDateString() !== today) continue
          const sale: TodaySale = byId.get(r.id) || { id: r.id, bill_number: r.bill_number, display_name: r.display_name, total_amount: r.total_amount, closed_at: r.closed_at, methods: [] }
          if (r.payment_method && !sale.methods.includes(r.payment_method)) sale.methods.push(r.payment_method)
          byId.set(r.id, sale)
        }
        setTodaySales([...byId.values()])
      }
      setDrawerMoves(movesRes?.success ? movesRes.data || [] : [])
    } catch {
      toast.error('โหลดสรุปวันนี้ไม่สำเร็จ')
    }
  }, [currentShift])

  useEffect(() => {
    if (billsMode === 'PAID') fetchPaidBills()
  }, [billsMode, fetchPaidBills])

  // เปิดบิลจากลิงก์หน้าประวัติการขาย (/cashier?bill=<id>)
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const id = searchParams.get('bill')
    if (!id) return
    openBill(id)
    setSearchParams({}, { replace: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const displayedBills = openBills

  // แก้รายการ/ยอด/ชำระเงินซ้ำได้เฉพาะบิลที่ยังเปิดอยู่เท่านั้น — บิล PAID ดูได้อย่างเดียว
  const isBillEditable = (b: CurrentBill | null): b is CurrentBill => !!b && (b.status == null || b.status === 'OPEN')

  // POS shift (เปิด/ปิดกะ + เงินเข้า/ออกลิ้นชัก)
  const fetchShift = useCallback(async () => {
    try {
      const res = await posService.getCurrentShift()
      if (res.success) setCurrentShift(res.data)
    } catch { /* ไม่บล็อกหน้าจอถ้าดึงกะไม่ได้ */ }
  }, [])

  useEffect(() => {
    fetchShift()
    // กะอาจถูกเปิด/ปิดจากเครื่องอื่นหรือข้ามวันระหว่างที่จอค้างไว้ — เช็กใหม่ทุกครั้งที่กลับมาที่หน้าจอ
    const onVisible = () => { if (document.visibilityState === 'visible') fetchShift() }
    window.addEventListener('focus', fetchShift)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', fetchShift)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [fetchShift])

  // backend ปฏิเสธการขายเพราะไม่มีกะ/กะค้างข้ามวัน → แจ้งชัด ๆ แล้วดึงกะใหม่ให้ overlay บังคับขึ้นมา
  const handleShiftGuardError = (e: any): boolean => {
    const code = shiftErrorCode(e)
    if (code !== 'SHIFT_NOT_OPEN' && code !== 'SHIFT_STALE') return false
    toast.error(t(code === 'SHIFT_STALE' ? 'sales.pos.toastShiftStale' : 'sales.pos.toastShiftNotOpen'), { id: 'pos-shift-guard' })
    setShowPaymentModal(false)
    setShowCreateModal(false)
    fetchShift()
    return true
  }

  // ไม่มีกะ = บังคับเปิดกะ, กะค้างข้ามวัน = บังคับปิดกะเก่า — ปิด overlay ไม่ได้จนกว่าจะทำเสร็จ
  // ยกเว้นโหมด "จัดการบิลค้าง": ซ่อน overlay ไว้จนกว่าบิลค้างหมด แล้วเด้งกลับมาบังคับปิดกะเอง
  const isStaleShift = !!currentShift?.stale
  const inStaleBillsMode = isStaleShift && managingStaleBills && openBills.length > 0
  const blockingShiftMode: 'open' | 'close' | null = currentShift === null ? 'open' : isStaleShift && !inStaleBillsMode ? 'close' : null
  const shiftModalMode = blockingShiftMode || showShiftModal

  useEffect(() => {
    if (!isStaleShift) setManagingStaleBills(false)
  }, [isStaleShift])

  const openCreateBill = () => {
    if (isStaleShift) { toast.error(t('sales.pos.toastShiftStale'), { id: 'pos-shift-guard' }); return }
    setShowCreateModal(true)
  }

  // Filter menus
  const filteredMenus = menus.filter(item => {
    const matchesCategory = selectedCategory === 'all' || item.category_id === selectedCategory
    const matchesSearch = 
      item.product_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.product_code?.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesCategory && matchesSearch
  })

  // GS1 Barcode search
  const handleGs1Search = async (barcode: string) => {
    if (!barcode || barcode.length < 8) return
    
    setScanningBarcode(true)
    try {
      const res = await posBillService.searchByGs1Barcode(barcode)
      if (res.success && res.data) {
        // Check if menu already exists in list
        const existingMenu = menus.find(m => m.id === res.data.id)
        if (!existingMenu) {
          // Add to menus list temporarily
          const newMenu: POSMenu = {
            id: res.data.id,
            product_id: res.data.product_id,
            product_name: res.data.product_name,
            product_code: res.data.product_code,
            category_id: res.data.category_id,
            category_name: res.data.category_name,
            category_color: res.data.category_color,
            pos_price: res.data.pos_price,
            is_available: true,
            preparation_time: 0,
          }
          setMenus(prev => [...prev, newMenu])
        }
        
        // Add to bill if there's a current bill
        if (currentBill) {
          const menuToAdd = menus.find(m => m.id === res.data.id) || {
            id: res.data.id,
            product_id: res.data.product_id,
            product_name: res.data.product_name,
            product_code: res.data.product_code,
            category_id: res.data.category_id,
            category_name: res.data.category_name,
            category_color: res.data.category_color,
            pos_price: res.data.pos_price,
            is_available: true,
            preparation_time: 0,
          }
          await addToBill(menuToAdd as POSMenu)
          toast.success(`เพิ่ม ${res.data.product_name} แล้ว`)
        } else {
          toast.success(`พบสินค้า: ${res.data.product_name} (กรุณาเปิดบิลก่อน)`)
        }
        setSearchQuery('')
      } else {
        toast.error(res.message || 'ไม่พบสินค้าสำหรับ barcode นี้')
      }
    } catch (error) {
      toast.error('ไม่พบสินค้าสำหรับ barcode นี้')
    } finally {
      setScanningBarcode(false)
    }
  }

  // Handle search input change with GS1 detection
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSearchQuery(value)
    
    // Auto-detect GS1 barcode (numeric only, 8-14 digits)
    if (/^\d{8,14}$/.test(value)) {
      handleGs1Search(value)
    }
  }

  // Create new bill
  const createBill = async (displayName?: string, customerId?: string) => {
    if (isStaleShift) { toast.error(t('sales.pos.toastShiftStale'), { id: 'pos-shift-guard' }); return }
    try {
      const res = await posBillService.createBill({
        display_name: displayName || undefined,
        customer_id: customerId || undefined,
      })
      
      if (res.success) {
        toast.success('สร้างบิลใหม่แล้ว')
        await fetchData()
        // Open the new bill
        await openBill(res.data.id)
      }
    } catch (error) {
      if (handleShiftGuardError(error)) return
      toast.error('Failed to create bill')
    }
  }

  // เปิดโต๊ะจากผังโต๊ะ = บิลผูกโต๊ะ (ลูกค้าสแกน QR สั่งเข้าบิลนี้ได้) · อีกเครื่องเปิดไปก่อนแล้ว = ใช้บิลนั้น
  const createTableBill = async (tableId: string): Promise<{ id: string } | null> => {
    try {
      const res = await posBillService.createBill({ table_id: tableId })
      if (!res.success) return null
      fetchData()
      return { id: res.data.id }
    } catch (error: any) {
      if (handleShiftGuardError(error)) return null
      const body = error?.response?.data
      if (body?.code === 'TABLE_ALREADY_OPEN' && body.data?.bill_id) return { id: body.data.bill_id }
      toast.error(body?.message || 'เปิดโต๊ะไม่สำเร็จ')
      return null
    }
  }

  // บิลของโต๊ะที่เปิดดูอยู่: ลูกค้าสั่งเพิ่ม/เรียกเช็คบิลผ่าน QR ได้ตลอด → ดึงใหม่เป็นระยะ ไม่งั้นแคชเชียร์เก็บเงินขาด
  // ponytail: poll 8 วิ เฉพาะตอนเปิดบิลโต๊ะอยู่และไม่มีหน้าต่างชำระเงินค้าง — ถ้าร้านใหญ่ค่อยเปลี่ยนเป็น push
  useEffect(() => {
    const billId = currentBill?.table_id ? currentBill.id : null
    if (!billId || view !== 'menu' || showPaymentModal) return
    const refresh = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const res = await posBillService.getBill(billId)
        if (!res.success) return
        setCurrentBill(prev => {
          if (!prev || prev.id !== billId) return prev
          const changed = res.data.items?.length !== prev.items.length || res.data.total_amount !== prev.total_amount
            || res.data.bill_requested_at !== prev.bill_requested_at || res.data.status !== prev.status
            || res.data.customer_id !== prev.customer_id || res.data.member_device_verified_at !== prev.member_device_verified_at
          return changed ? res.data : prev
        })
      } catch { /* รอบหน้าลองใหม่ */ }
    }
    const id = setInterval(refresh, 8000)
    document.addEventListener('visibilitychange', refresh)  // สลับกลับมาที่จอนี้ = ดึงทันที
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', refresh) }
  }, [currentBill?.id, currentBill?.table_id, view, showPaymentModal])

  // Open bill
  const openBill = async (billId: string) => {
    try {
      const res = await posBillService.getBill(billId)
      if (res.success) {
        setCurrentBill(res.data)
        // ล้างส่วนลดและค่าบริการเสริมที่ค้างจากบิลก่อนหน้าทุกครั้งที่สลับบิล ป้องกันส่วนลดรั่วไหลข้ามบิล
        // ยกเว้นบิลที่เปิดอยู่และบันทึกส่วนลดไว้แล้ว (เช่น รออนุมัติ/อนุมัติแล้ว) ให้ดึงค่าที่บันทึกไว้ขึ้นมาแสดง
        const savedDiscount = Number(res.data?.discount_amount) || 0
        const savedExtra = Number(res.data?.extra_charge_amount) || 0
        setDiscount(savedDiscount > 0 ? { type: 'fixed', value: savedDiscount } : { type: 'pct', value: 0 })
        setExtraCharge({ label: res.data?.extra_charge_label || 'ค่าบริการอื่น', amount: savedExtra })
        setExpandedRow(null)
        setView('menu')
      }
    } catch (error) {
      toast.error('Failed to open bill')
    }
  }

  // Save item special instructions (note)
  const handleSaveItemNote = async (itemId: string, note: string) => {
    if (!currentBill) return
    try {
      const res = await posBillService.updateItem(currentBill.id, itemId, {
        special_instructions: note
      })
      if (res.success) {
        const billRes = await posBillService.getBill(currentBill.id)
        if (billRes.success) setCurrentBill(billRes.data)
        toast.success('บันทึกหมายเหตุสำเร็จ')
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'บันทึกหมายเหตุไม่สำเร็จ')
    }
  }

  // Add item to bill
  const addToBill = async (menu: POSMenu) => {
    if (!isBillEditable(currentBill)) return

    try {
      const res = await posBillService.addItem(currentBill.id, {
        pos_menu_id: menu.id,
        quantity: 1
      })

      if (res.success) {
        // Refresh bill data
        const billRes = await posBillService.getBill(currentBill.id)
        if (billRes.success) setCurrentBill(billRes.data)
        toast.success(`เพิ่ม ${menu.product_name}`)
      }
    } catch (error) {
      toast.error('Failed to add item')
    }
  }

  // Update item quantity
  const updateQuantity = async (itemId: string, delta: number, currentQty: number) => {
    if (!isBillEditable(currentBill)) return
    
    const newQty = currentQty + delta
    // รายการที่ส่งครัวแล้ว ลด/ลบต้องมีเหตุผล (backend ลงบันทึกความเคลื่อนไหวให้ Admin เห็น)
    // ponytail: ใช้ prompt ของเบราว์เซอร์ — ถ้าต้องการเลือกเหตุผลสำเร็จรูปค่อยทำเป็นโมดัล
    let reason: string | undefined
    if (delta < 0 && currentBill.items.find(i => i.id === itemId)?.sent_to_kds) {
      reason = window.prompt('รายการนี้ส่งครัวไปแล้ว — ระบุเหตุผลที่ลด/ลบ (เช่น ลูกค้ายกเลิก, คีย์ผิด)')?.trim()
      if (!reason) return
    }
    if (newQty <= 0) {
      // Delete item
      try {
        await posBillService.deleteItem(currentBill.id, itemId, reason)
        const billRes = await posBillService.getBill(currentBill.id)
        if (billRes.success) setCurrentBill(billRes.data)
      } catch (error: any) {
        toast.error(error.response?.data?.message || 'Failed to remove item')
      }
      return
    }

    try {
      await posBillService.updateItem(currentBill.id, itemId, { quantity: newQty, reason })
      const billRes = await posBillService.getBill(currentBill.id)
      if (billRes.success) setCurrentBill(billRes.data)
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to update quantity')
    }
  }

  // ส่วนลดเป็น % คิดจากยอดที่เรียกเก็บก่อนภาษี (สินค้า + ค่าบริการ + ค่าขนส่ง)
  const billDiscountAmount = (bill: any) => {
    if (discount.value <= 0) return 0
    if (discount.type !== 'pct') return discount.value
    const pct = Math.min(100, Math.max(0, discount.value))
    const t = billTotals(bill, billing, { extraCharge: extraCharge.amount })
    return Math.round((t.subtotal + t.serviceChargeAmount + t.extraCharge) * pct / 100)
  }
  const billDiscountPct = (bill: any) => {
    if (!bill || discount.value <= 0) return 0
    if (discount.type === 'pct') return Math.min(100, Math.max(0, discount.value))
    const t = billTotals(bill, billing, { extraCharge: extraCharge.amount })
    const base = t.subtotal + t.serviceChargeAmount + t.extraCharge
    return base > 0 ? Math.round((discount.value / base) * 1000) / 10 : 0
  }

  // Build receipt data for printing
  const buildReceiptData = (bill: any, method: string, cashReceived?: number, discountAmt = 0) => {
    const shop = loadShopConfig()
    const { subtotal, serviceChargeAmount: serviceAmt, extraCharge: extraAmt, taxAmount: vatAmt, totalAmount: total } =
      billTotals(bill, billing, { discount: discountAmt, extraCharge: extraCharge.amount })
    // แนบบัญชีหลักเสมอ ไม่ใช่เฉพาะตอนจ่ายด้วย QR — ลูกค้าที่จ่ายสดก็ยังต้องเห็น
    // เลขบัญชี/QR ไว้โอนรอบหน้า และหน้าตั้งค่าก็โฆษณาไว้ว่า "แสดงบนเอกสารขายและ POS"
    const bank = getCachedDefaultBankAccount()
    return {
      ...bill,
      subtotal,
      service_charge_amount: serviceAmt,
      extra_charge_amount: extraAmt,
      extra_charge_label: extraCharge.label,
      tax_amount: vatAmt,
      total_amount: total,
      _shopName: shop.name,
      _shopAddress: shop.address,
      _shopPhone: shop.phone,
      _shopTaxId: shop.taxId,
      _shopFooter: shop.footer,
      _vatEnabled: billing.vatEnabled,
      _vatRate: billing.vatRate,
      _vatInclusive: billing.vatInclusive,
      _supersededBy: bill.invoice?.invoice_number || bill.invoice_number || undefined,
      _serviceEnabled: billing.serviceEnabled,
      _serviceRate: billing.serviceRate,
      _paymentMethod: method,
      _cashReceived: cashReceived || 0,
      _discountAmount: discountAmt,
      _bankName: bank?.bank_name || '',
      _bankAccountName: bank?.account_name || '',
      _bankAccountNumber: bank?.account_number || '',
      _bankQrImage: bank?.qr_code_base64 || '',
    }
  }

  // Process payment
  const processPayment = async (method: 'CASH' | 'QR_CODE' | 'CREDIT_CARD', redeemPoints?: number, cashReceived?: number, bankAccountId?: string) => {
    if (!isBillEditable(currentBill)) return

    try {
      const res = await posBillService.payBill(currentBill.id, {
        payment_method: method,
        redeem_points: loyalty.enabled && redeemPoints ? redeemPoints : undefined,
        bank_account_id: bankAccountId,
        // ต้องส่งไปด้วย ไม่งั้น backend คิดยอด/VAT/บัญชีจากบิลเปล่า ๆ คนละยอดกับที่ลูกค้าจ่าย
        discount_amount: billDiscountAmount(currentBill),
        extra_charge_amount: extraCharge.amount,
        extra_charge_label: extraCharge.label,
      })

      // ติดด่านอนุมัติ (เช่น ส่วนลดเกิน 40%): ส่งคำขออนุมัติ + แจ้ง LINE แล้ว ยังไม่ตัดจ่ายบิล
      if (approvalGate.handleResponse(res)) {
        setShowPaymentModal(false)
        return
      }

      // ── Actionable response: cannot pay due to stock/conversion issues ──
      if (res.data?.canPay === false && res.data?.needsAction) {
        setPayActionIssues(res.data.issues || [])
        setShowPaymentModal(false)
        return
      }

      if (res.success) {
        const earned = res.data?.points_earned || 0
        const redeemed = res.data?.points_redeemed || 0
        if (earned > 0 && redeemed > 0) {
          toast.success(`ชำระเงินสำเร็จ! แลก ${redeemed.toLocaleString()} แต้ม + สะสม +${earned.toLocaleString()} แต้ม`, { icon: <Star className="w-4 h-4" /> })
        } else if (earned > 0) {
          toast.success(`ชำระเงินสำเร็จ! สะสมแต้ม +${earned.toLocaleString()} แต้ม`, { icon: <Star className="w-4 h-4" /> })
        } else {
          toast.success(`ชำระเงินสำเร็จ!`, { icon: <Banknote className="w-4 h-4" /> })
        }
        // Auto-print thermal receipt after payment
        // ส่วนลดจากแต้ม backend คิดเป็นส่วนลดท้ายบิลแล้ว — ใบเสร็จต้องเห็นยอดเดียวกัน
        const receiptData = buildReceiptData(currentBill, method, cashReceived, billDiscountAmount(currentBill) + (res.data?.redeem_discount || 0))
        printPOSReceipt(receiptData, 'thermal')
        setCurrentBill(null)
        setShowPaymentModal(false)
        setView('bills')
        await fetchData()
      }
    } catch (error: any) {
      if (handleShiftGuardError(error)) return
      toast.error(error.response?.data?.message || 'Failed to process payment')
    }
  }

  const approvalGate = useApprovalGate()

  // Cancel bill
  const cancelBill = async () => {
    if (!currentBill) return
    if (!confirm('ยกเลิกบิลนี้? สต็อกจะถูกคืน')) return

    try {
      const res = await posBillService.cancelBill(currentBill.id, { reason: 'Cancelled by cashier' })
      // ติดด่านอนุมัติ: บิลยังไม่ถูกยกเลิก จึงไม่ปิดบิลทิ้งและไม่ขึ้นข้อความว่าสำเร็จ
      if (approvalGate.handleResponse(res)) return
      toast.success('ยกเลิกบิลแล้ว')
      setCurrentBill(null)
      setView('bills')
      await fetchData()
    } catch (error) {
      toast.error('Failed to cancel bill')
    }
  }

  // Send unsent items to KDS
  const sendToKitchen = async () => {
    if (!isBillEditable(currentBill)) return
    setSendingToKitchen(true)
    try {
      const result = await kdsService.sendToKitchen(currentBill.id)
      toast.success(`ส่งครัวแล้ว ${result.item_count} รายการ (รอบที่ ${result.round})`, { icon: <ChefHat className="w-4 h-4" /> })
      const billRes = await posBillService.getBill(currentBill.id)
      if (billRes.success) setCurrentBill(billRes.data)
    } catch {
      toast.error('ส่งครัวไม่สำเร็จ')
    } finally {
      setSendingToKitchen(false)
    }
  }

  // Update bill name
  const updateBillName = async (newName: string) => {
    if (!currentBill || !newName.trim()) return

    try {
      await posBillService.updateBill(currentBill.id, { display_name: newName })
      setCurrentBill({ ...currentBill, display_name: newName })
      await fetchData()
      toast.success('อัปเดตชื่อบิลแล้ว')
    } catch (error) {
      toast.error('Failed to update bill name')
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      {approvalGate.modal}

      {/* Header */}
      <div className="bg-[var(--surface)] border-b border-[var(--border)] px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-gradient-to-br from-phopy-indigo to-purple-500 rounded-xl">
              <Store className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[var(--fg-1)]">ระบบขายหน้าร้าน</h1>
              <p className="text-sm text-[var(--fg-3)]">Open Bill / POS</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Shift widget — เปิด/ปิดกะ + เงินเข้า/ออกลิ้นชัก จากหน้า POS โดยตรง */}
            {currentShift ? (
              <div className="flex items-center gap-2">
                <span className="hidden md:flex items-center gap-1.5 px-3 py-2 rounded-lg bg-success/10 border border-success/30 text-xs text-success font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-success" /> กะ {currentShift.shift_number}
                </span>
                <button
                  onClick={() => setShowCashMovementModal(true)}
                  className="px-3 py-2 rounded-lg bg-[var(--bg)] text-[var(--fg-2)] text-sm hover:text-[var(--fg-1)] border border-[var(--border)]"
                >
                  เงินเข้า/ออกลิ้นชัก
                </button>
                <button
                  onClick={() => setShowShiftModal('close')}
                  className="px-3 py-2 rounded-lg bg-danger/10 text-danger text-sm hover:bg-danger/20 border border-danger/30"
                >
                  ปิดกะ
                </button>
              </div>
            ) : currentShift === null ? (
              <button
                onClick={() => setShowShiftModal('open')}
                className="px-3 py-2 rounded-lg bg-phopy-indigo/10 text-phopy-indigo text-sm hover:bg-phopy-indigo/20 border border-phopy-indigo/30 font-medium"
              >
                เปิดกะ
              </button>
            ) : null}
            <div className="flex bg-[var(--surface)] rounded-lg p-1">
              <button
                onClick={() => setView('bills')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md transition-all ${
                  view === 'bills' 
                    ? 'bg-[var(--primary-soft)] text-[var(--primary)]' 
                    : 'text-[var(--fg-3)] hover:text-[var(--fg-1)]'
                }`}
              >
                <Receipt className="w-4 h-4" />
                <span className="hidden sm:inline">บิล ({openBills.length})</span>
              </button>
              <button
                onClick={() => currentBill && setView('menu')}
                disabled={!currentBill}
                className={`flex items-center gap-2 px-4 py-2 rounded-md transition-all ${
                  view === 'menu' 
                    ? 'bg-[var(--primary-soft)] text-[var(--primary)]' 
                    : 'text-[var(--fg-3)] hover:text-[var(--fg-1)] disabled:opacity-50'
                }`}
              >
                <Package className="w-4 h-4" />
                <span className="hidden sm:inline">เมนู</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {inStaleBillsMode && (
        <div className="mx-6 mt-4 flex items-center gap-3 p-3 rounded-xl bg-[var(--warning-soft)] border border-warning/30 text-warning text-sm">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span className="flex-1 font-medium">{t('sales.pos.staleBillsBanner', { count: openBills.length })}</span>
          <button onClick={() => setShowShiftModal('close')}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-danger/10 text-danger font-medium border border-danger/30 hover:bg-danger/20">
            {t('sales.actions.closeShift')}
          </button>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:h-[calc(100vh-80px)]">
        {/* Left Panel */}
        <div className="flex-1 p-6 overflow-auto">
          <AnimatePresence mode="wait">
            {view === 'bills' ? (
              <motion.div
                key="bills"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                {/* Create Bill Button + โหมดเปิดอยู่/ชำระแล้ว */}
                <div className="flex justify-between items-center flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-semibold text-[var(--fg-1)]">
                      {billsMode === 'OPEN' ? 'บิลที่เปิดอยู่' : billsMode === 'TABLES' ? 'ผังโต๊ะ' : 'สรุปวันนี้'}
                    </h2>
                    <div className="flex bg-[var(--bg)] rounded-lg p-1">
                      <button
                        onClick={() => setBillsMode('TABLES')}
                        className={`px-3 py-1.5 rounded-md text-sm transition-all ${
                          billsMode === 'TABLES' ? 'bg-[var(--primary-soft)] text-[var(--primary)]' : 'text-[var(--fg-3)] hover:text-[var(--fg-1)]'
                        }`}
                      >
                        ผังโต๊ะ
                      </button>
                      <button
                        onClick={() => setBillsMode('OPEN')}
                        className={`px-3 py-1.5 rounded-md text-sm transition-all ${
                          billsMode === 'OPEN' ? 'bg-[var(--primary-soft)] text-[var(--primary)]' : 'text-[var(--fg-3)] hover:text-[var(--fg-1)]'
                        }`}
                      >
                        เปิดอยู่
                      </button>
                      <button
                        onClick={() => setBillsMode('PAID')}
                        className={`px-3 py-1.5 rounded-md text-sm transition-all ${
                          billsMode === 'PAID' ? 'bg-[var(--primary-soft)] text-[var(--primary)]' : 'text-[var(--fg-3)] hover:text-[var(--fg-1)]'
                        }`}
                      >
                        สรุปวันนี้
                      </button>
                    </div>
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={openCreateBill}
                    disabled={isStaleShift}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-phopy-indigo to-purple-500 text-white rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-4 h-4" />
                    สร้างบิลใหม่
                  </motion.button>
                </div>

                {/* Bills Grid */}
                {billsMode === 'TABLES' ? (
                  <TableBoard activeBillId={currentBill?.id} canOpenNew={!isStaleShift} onOpenBill={openBill} createTableBill={createTableBill} />
                ) : billsMode === 'PAID' ? (
                  <TodaySummary shift={currentShift} sales={todaySales} moves={drawerMoves} onOpenBill={openBill} />
                ) : loading ? (
                  <div className="text-center py-12">
                    <div className="w-8 h-8 border-2 border-phopy-indigo border-t-transparent rounded-full animate-spin mx-auto" />
                  </div>
                ) : displayedBills.length === 0 ? (
                  <div className="text-center py-12 bg-[var(--surface)] border border-[var(--border)] rounded-xl">
                    <Receipt className="w-12 h-12 mx-auto text-[var(--fg-4)] mb-3" />
                    <p className="text-[var(--fg-3)]">ยังไม่มีบิล</p>
                    <p className="text-sm text-[var(--fg-4)] mt-1">สร้างบิลใหม่เพื่อเริ่มขาย</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {displayedBills.map((bill) => (
                      <motion.button
                        key={bill.id}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => openBill(bill.id)}
                        className={`relative p-4 bg-[var(--surface)] border border-[var(--border)] rounded-xl text-left hover:border-phopy-indigo/50 transition-all ${
                          currentBill?.id === bill.id ? 'ring-2 ring-phopy-indigo' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-lg font-bold text-[var(--fg-1)] truncate">
                            {bill.display_name}
                          </span>
                          {bill.item_count > 0 && (
                            <span className="px-2 py-0.5 bg-[var(--primary-soft)] text-[var(--primary)] rounded text-xs">
                              {bill.item_count}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--fg-4)] flex items-center gap-1.5 flex-wrap">
                          <span>{bill.bill_number}</span>
                          {bill.invoice_number && (
                            <span className="px-1.5 py-0.5 rounded bg-success/15 text-success text-[10px] font-medium">
                              INV {bill.invoice_number}
                            </span>
                          )}
                        </p>
                        <p className="text-xl font-bold text-success mt-2">
                          ฿{(() => {
                            return billTotals(bill, billing).totalAmount.toLocaleString()
                          })()}
                        </p>
                        <div className="flex items-center gap-1 text-xs text-[var(--fg-4)] mt-2">
                          <Clock className="w-3 h-3" />
                          <span>
                            {new Date(bill.opened_at)
                              .toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </motion.button>
                    ))}
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="menu"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                {/* Search & Categories */}
                <div className="space-y-4">
                  <button
                    onClick={() => setView('bills')}
                    className="flex items-center gap-2 px-3 py-2 -ml-1 rounded-lg text-sm font-medium text-[var(--fg-2)] hover:bg-[var(--surface)] hover:text-[var(--fg-1)]"
                  >
                    <ArrowLeft className="w-4 h-4" /> บิลทั้งหมด ({openBills.length})
                  </button>
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--fg-3)]" />
                    <input
                      type="text"
                      placeholder="ค้นหาเมนู หรือสแกน barcode..."
                      value={searchQuery}
                      onChange={handleSearchChange}
                      disabled={scanningBarcode}
                      className="w-full pl-12 pr-12 py-3 bg-[var(--surface)] border border-[var(--border)] rounded-xl text-[var(--fg-1)] placeholder:text-[var(--fg-4)] focus:outline-none focus:border-phopy-indigo disabled:opacity-50"
                    />
                    {scanningBarcode && (
                      <div className="absolute right-4 top-1/2 -translate-y-1/2">
                        <div className="w-5 h-5 border-2 border-phopy-indigo border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex gap-2 overflow-x-auto flex-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                      <button
                        onClick={() => setSelectedCategory('all')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg whitespace-nowrap transition-all ${
                          selectedCategory === 'all'
                            ? 'bg-gradient-to-r from-phopy-indigo to-purple-500 text-white'
                            : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--fg-3)] hover:border-phopy-indigo/50'
                        }`}
                      >
                        <span>ทั้งหมด</span>
                      </button>
                      {categories.map((cat) => (
                        <button
                          key={cat.id}
                          onClick={() => setSelectedCategory(cat.id)}
                          className={`flex items-center gap-2 px-4 py-2 rounded-lg whitespace-nowrap transition-all ${
                            selectedCategory === cat.id
                              ? 'text-[var(--fg-1)]'
                              : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--fg-3)] hover:border-phopy-indigo/50'
                          }`}
                          style={{
                            background: selectedCategory === cat.id
                              ? `linear-gradient(135deg, ${cat.color}80, ${cat.color})`
                              : undefined
                          }}
                        >
                          <span>{cat.name}</span>
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setShowCategoryModal(true)}
                      className="flex-shrink-0 p-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--fg-3)] hover:border-phopy-indigo/50 hover:text-[var(--primary)] transition-all"
                      title="จัดการหมวดหมู่"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Menu Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {filteredMenus.map((menu) => (
                    <motion.button
                      key={menu.id}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => addToBill(menu)}
                      disabled={!isBillEditable(currentBill)}
                      className="p-4 bg-[var(--surface)] border border-[var(--border)] rounded-xl text-left hover:border-phopy-indigo/50 transition-all group disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-[var(--border)]"
                    >
                      <div
                        className="aspect-video rounded-lg mb-3 flex items-center justify-center overflow-hidden"
                        style={{ backgroundColor: menu.category_color ? `color-mix(in srgb, ${menu.category_color}, transparent 80%)` : 'var(--primary-soft)' }}
                      >
                        {menu.image_url ? (
                          <img src={menu.image_url} alt={menu.product_name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-4xl"><Utensils className="w-12 h-12" /></span>
                        )}
                      </div>
                      <h3 className="font-semibold text-[var(--fg-1)] group-hover:text-[var(--primary)] transition-colors truncate">
                        {menu.product_name}
                      </h3>
                      <p className="text-xs text-[var(--fg-4)]">{menu.product_code}</p>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-lg font-bold text-success">
                          ฿{menu.pos_price?.toLocaleString()}
                        </span>
                        {menu.preparation_time > 0 && (
                          <span className="text-xs text-[var(--fg-4)]">{menu.preparation_time}m</span>
                        )}
                      </div>
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right Panel - Current Bill */}
        <div className="w-full md:w-[400px] bg-[var(--surface)] border-l border-[var(--border)] flex flex-col">
          {currentBill ? (
            <>
              {/* Bill Header */}
              <div className="p-4 border-b border-[var(--border)]">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold text-[var(--fg-1)] truncate">{currentBill.display_name}</h2>
                      <button
                        onClick={() => setShowEditNameModal(true)}
                        className="p-1 rounded hover:bg-[var(--bg)] text-[var(--fg-3)] hover:text-[var(--primary)]"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="text-sm text-[var(--fg-3)]">
                      {currentBill.bill_number}
                      {currentBill.table_id && <span className="ml-2 text-[var(--primary)]">· สั่งผ่าน QR ได้</span>}
                    </p>
                  </div>
                  <button
                    onClick={() => { setCurrentBill(null); setView('bills') }}
                    aria-label="ปิดบิลนี้ กลับไปหน้าบิลทั้งหมด"
                    className="p-2 rounded-lg hover:bg-[var(--bg)] text-[var(--fg-3)] hover:text-[var(--fg-1)]"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                {currentBill.bill_requested_at && isBillEditable(currentBill) && (
                  <div className="mt-2 px-3 py-2 rounded-lg bg-[var(--warning-soft)] border border-warning/40 text-sm font-medium text-[var(--warning-strong)]">
                    ลูกค้าเรียกเช็คบิลจากมือถือ · {new Date(currentBill.bill_requested_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
                {/* Member row */}
                {currentBill.customer_id ? (
                  <div className="mt-2 flex items-center justify-between bg-phopy-indigo/10 border border-phopy-indigo/30 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Star className="w-4 h-4 text-warning shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--fg-1)] truncate">{currentBill.customer_name}</p>
                        <p className="text-xs text-[var(--fg-3)]">{currentBill.customer_phone} · แต้ม <span className="text-[var(--primary)] font-medium">{(currentBill.customer_loyalty_points ?? 0).toLocaleString()}</span>{(currentBill.customer_reserved_points ?? 0) > 0 && <span className="text-[var(--fg-4)]"> (จอง {currentBill.customer_reserved_points} แต้ม)</span>}</p>
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          await posBillService.assignMember(currentBill.id, null)
                          const r = await posBillService.getBill(currentBill.id)
                          if (r.success) setCurrentBill(r.data)
                        } catch { toast.error('ยกเลิกสมาชิกไม่สำเร็จ') }
                      }}
                      className="p-1 rounded text-[var(--fg-4)] hover:text-danger shrink-0"
                      title="ยกเลิกสมาชิก"
                    >
                      <UserX className="w-4 h-4" />
                    </button>
                  </div>
                ) : null}
                {/* ลูกค้าสมัคร/ผูกเบอร์เองจากมือถือ (ไม่มี OTP) — แคชเชียร์ยืนยันตัวตน 1 ครั้ง แล้วลูกค้าดูแต้ม/แลกแต้มได้ */}
                {currentBill.customer_id && currentBill.member_device_id && !currentBill.member_device_verified_at && isBillEditable(currentBill) && (
                  <div className="mt-2 flex items-center gap-2 rounded-lg px-3 py-2 bg-[var(--warning-soft)] border border-warning/40">
                    <p className="flex-1 text-xs text-[var(--warning-strong)]">
                      ลูกค้าใส่เบอร์เองผ่าน QR · ถามชื่อให้ตรงกับ <b>{currentBill.customer_name}</b> แล้วกดยืนยัน (ยืนยันแล้วจึงแลกแต้มได้)
                    </p>
                    <button
                      onClick={async () => {
                        try {
                          await posBillService.verifyMember(currentBill.id)
                          const r = await posBillService.getBill(currentBill.id)
                          if (r.success) setCurrentBill(r.data)
                          toast.success('ยืนยันสมาชิกแล้ว')
                        } catch (e: any) { toast.error(e?.response?.data?.message || 'ยืนยันสมาชิกไม่สำเร็จ') }
                      }}
                      className="shrink-0 px-2.5 py-1.5 rounded-md bg-[var(--primary)] text-white text-xs font-medium hover:opacity-90"
                    >
                      ยืนยันสมาชิก
                    </button>
                  </div>
                )}
                {!currentBill.customer_id && (
                  <button
                    onClick={() => setShowAssignMemberModal(true)}
                    className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-dashed border-[var(--border)] text-xs text-[var(--fg-4)] hover:text-[var(--primary)] hover:border-phopy-indigo/40 transition-colors"
                  >
                    <UserPlus className="w-3.5 h-3.5" /> + สมาชิก
                  </button>
                )}
              </div>

              {/* Bill Items */}
              <div className="flex-1 overflow-auto p-4 space-y-3">
                {currentBill.items.length === 0 ? (
                  <div className="text-center py-12 text-[var(--fg-4)]">
                    <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>ยังไม่มีรายการ</p>
                    <p className="text-sm mt-1">เลือกเมนูเพื่อเพิ่ม</p>
                  </div>
                ) : (
                  currentBill.items.map((item) => (
                    <motion.div
                      key={item.id}
                      layout
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="p-3 bg-[var(--bg)] rounded-lg group"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h4 className="font-medium text-[var(--fg-1)]">{item.product_name}</h4>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {item.special_instructions ? (
                              <button
                                type="button"
                                onClick={() => setEditingItemNote(item)}
                                disabled={!isBillEditable(currentBill)}
                                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-warning/15 text-warning hover:bg-warning/25 transition-colors border border-warning/30 font-medium"
                              >
                                <Star className="w-3 h-3 fill-warning text-warning" />
                                <span>{item.special_instructions}</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setEditingItemNote(item)}
                                disabled={!isBillEditable(currentBill)}
                                className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded text-[var(--fg-4)] hover:text-phopy-indigo hover:bg-[var(--surface)] transition-colors opacity-70 hover:opacity-100"
                              >
                                <span>+ โน้ต/หวาน</span>
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-4 mt-2">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => updateQuantity(item.id, -1, item.quantity)}
                                disabled={!isBillEditable(currentBill)}
                                className="p-1 rounded bg-[var(--surface)] hover:bg-[var(--primary-soft)] text-[var(--primary)] disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <span className="w-6 text-center text-sm">{item.quantity}</span>
                              <button
                                onClick={() => updateQuantity(item.id, 1, item.quantity)}
                                disabled={!isBillEditable(currentBill)}
                                className="p-1 rounded bg-[var(--surface)] hover:bg-[var(--primary-soft)] text-[var(--primary)] disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                            <span className="text-sm text-success">
                              ฿{item.total_price.toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>

              {/* Bill Footer */}
              {(() => {
                const discountAmt = billDiscountAmount(currentBill)
                const { subtotal, serviceChargeAmount: serviceAmt, taxAmount: vatAmt, totalAmount: finalTotal } =
                  billTotals(currentBill, billing, { discount: discountAmt, extraCharge: extraCharge.amount })
                return (
                  <>
                  <div className="p-4 border-t border-[var(--border)] space-y-3">
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between text-[var(--fg-3)]">
                        <span>ยอดรวม</span>
                        <span>฿{subtotal.toLocaleString()}</span>
                      </div>
                      {billing.serviceEnabled && (
                        <div className="flex justify-between text-[var(--primary)]">
                          <span>Service Charge ({billing.serviceRate}%)</span>
                          <span>+฿{serviceAmt.toLocaleString()}</span>
                        </div>
                      )}
                      {billing.vatEnabled && (
                        <div className="flex justify-between text-warning">
                          <span>VAT ({billing.vatRate}%)</span>
                          <span>+฿{vatAmt.toLocaleString()}</span>
                        </div>
                      )}

                      {/* Discount row */}
                      <div className="border-t border-[var(--border)]/50 pt-1">
                        <button
                          className="w-full flex items-center justify-between py-1 text-warning hover:text-warning transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          onClick={() => setExpandedRow(expandedRow === 'discount' ? null : 'discount')}
                          disabled={!isBillEditable(currentBill)}
                        >
                          <span className="flex items-center gap-1">
                            <Tag className="w-3.5 h-3.5" />
                            ส่วนลด
                            {discount.value > 0 && (
                              <span className="text-xs text-warning">
                                ({discount.type === 'pct' ? `${discount.value}%` : `฿${discount.value}`})
                              </span>
                            )}
                          </span>
                          <span className="flex items-center gap-1">
                            {discountAmt > 0 && <span className="text-warning">-฿{discountAmt.toLocaleString()}</span>}
                            {expandedRow === 'discount' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </span>
                        </button>
                        {expandedRow === 'discount' && (
                          <div className="mt-1 flex gap-2 items-center">
                            <div className="flex rounded-lg overflow-hidden border border-[var(--border)] text-xs">
                              <button
                                onClick={() => setDiscount(d => ({ type: 'pct', value: Math.min(100, Math.max(0, d.value)) }))}
                                className={`px-2 py-1 transition-colors ${discount.type === 'pct' ? 'bg-[var(--warning-soft)] text-warning' : 'bg-[var(--bg)] text-[var(--fg-3)]'}`}
                              >%</button>
                              <button
                                onClick={() => setDiscount(d => ({ ...d, type: 'fixed' }))}
                                className={`px-2 py-1 transition-colors ${discount.type === 'fixed' ? 'bg-[var(--warning-soft)] text-warning' : 'bg-[var(--bg)] text-[var(--fg-3)]'}`}
                              >฿</button>
                            </div>
                            <div className="flex gap-1 flex-1">
                              <input
                                type="number"
                                min={0}
                                max={discount.type === 'pct' ? 100 : undefined}
                                placeholder={discount.type === 'pct' ? 'จำนวน %' : 'จำนวน ฿'}
                                value={discount.value || ''}
                                onChange={e => {
                                  const raw = Number(e.target.value) || 0
                                  const next = Math.max(0, discount.type === 'pct' ? Math.min(100, raw) : raw)
                                  setDiscount(d => ({ ...d, value: next }))
                                }}
                                onKeyDown={e => e.key === 'Enter' && setExpandedRow(null)}
                                autoFocus
                                className="flex-1 px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-sm text-[var(--fg-1)] focus:outline-none focus:border-warning"
                              />
                            </div>
                            {discount.value > 0 && (
                              <button onClick={() => { setDiscount({ type: 'pct', value: 0 }); setExpandedRow(null) }}
                                className="text-[var(--fg-4)] hover:text-danger text-xs">ล้าง</button>
                            )}
                          </div>
                        )}
                        {billDiscountPct(currentBill) > approvalDiscountPct && (
                          <div className="mt-1.5 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--warning-soft)]/80 border border-warning/40 text-warning text-xs">
                            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>ส่วนลดเกิน {approvalDiscountPct}% ({billDiscountPct(currentBill)}%) — ต้องขออนุมัติก่อนชำระเงิน</span>
                          </div>
                        )}
                      </div>

                      {/* Extra charge row */}
                      <div>
                        <button
                          className="w-full flex items-center justify-between py-1 text-[var(--primary)] hover:text-[var(--primary)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          onClick={() => setExpandedRow(expandedRow === 'extra' ? null : 'extra')}
                          disabled={!isBillEditable(currentBill)}
                        >
                          <span className="flex items-center gap-1">
                            <Plus className="w-3.5 h-3.5" />
                            {extraCharge.amount > 0 ? extraCharge.label : 'เพิ่มค่าบริการ'}
                          </span>
                          <span className="flex items-center gap-1">
                            {extraCharge.amount > 0 && <span className="text-[var(--primary)]">+฿{extraCharge.amount.toLocaleString()}</span>}
                            {expandedRow === 'extra' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </span>
                        </button>
                        {expandedRow === 'extra' && (
                          <div className="mt-1 flex gap-2 items-center">
                            <input
                              type="text"
                              placeholder="ชื่อ"
                              value={extraCharge.label}
                              onChange={e => setExtraCharge(c => ({ ...c, label: e.target.value }))}
                              className="flex-1 px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-sm text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)]"
                            />
                            <input
                              type="number"
                              min={0}
                              placeholder="฿"
                              value={extraCharge.amount || ''}
                              onChange={e => setExtraCharge(c => ({ ...c, amount: Number(e.target.value) || 0 }))}
                              onKeyDown={e => e.key === 'Enter' && setExpandedRow(null)}
                              autoFocus
                              className="w-20 px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-sm text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)]"
                            />
                            {extraCharge.amount > 0 && (
                              <button onClick={() => { setExtraCharge({ label: 'ค่าบริการอื่น', amount: 0 }); setExpandedRow(null) }}
                                className="text-[var(--fg-4)] hover:text-danger text-xs">ล้าง</button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Grand total */}
                      <div className="border-t border-[var(--border)] pt-2 flex justify-between text-lg font-bold">
                        <span className="text-[var(--fg-1)]">ยอดสุทธิ</span>
                        <span className="text-success">฿{finalTotal.toLocaleString()}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={cancelBill}
                        className="px-3 py-3 rounded-lg border border-danger/50 text-danger hover:bg-[var(--danger-soft)] transition-all text-sm"
                      >
                        ยกเลิก
                      </button>
                      {(() => {
                        const unsentCount = currentBill.items.filter(i => !i.sent_to_kds).length
                        return (
                          <button
                            onClick={sendToKitchen}
                            disabled={sendingToKitchen || unsentCount === 0 || !isBillEditable(currentBill)}
                            className="relative px-3 py-3 rounded-lg bg-[var(--warning-soft)] border border-warning/50 text-warning hover:bg-warning/20 transition-all disabled:opacity-40 flex items-center justify-center gap-1 text-sm"
                          >
                            {sendingToKitchen
                              ? <div className="w-4 h-4 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
                              : <ChefHat className="w-4 h-4" />
                            }
                            ครัว
                            {unsentCount > 0 && (
                              <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-warning text-[var(--fg-1)] text-xs flex items-center justify-center font-bold">
                                {unsentCount}
                              </span>
                            )}
                          </button>
                        )
                      })()}
                      <button
                        onClick={() => fetchData()}
                        className="px-3 py-3 rounded-lg bg-[var(--bg)] text-[var(--fg-3)] hover:text-[var(--fg-1)] transition-all"
                      >
                        <RotateCcw className="w-4 h-4 mx-auto" />
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowPaymentModal(true)}
                        disabled={currentBill.items.length === 0 || !isBillEditable(currentBill)}
                        className="flex-1 px-4 py-4 rounded-xl bg-gradient-to-r from-phopy-indigo to-purple-500 text-white font-semibold hover:opacity-90 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        <CreditCard className="w-5 h-5" />
                        ชำระเงิน ฿{finalTotal.toLocaleString()}
                      </button>
                      <button
                        onClick={() => {
                          const rd = buildReceiptData(currentBill, 'CASH', 0, discountAmt)
                          printPOSReceipt(rd, 'thermal')
                        }}
                        disabled={currentBill.items.length === 0}
                        title="ใบเสร็จฉบับย่อ (80mm)"
                        className="px-3 py-4 rounded-xl bg-[var(--bg)] border border-[var(--border)] text-[var(--fg-3)] hover:text-warning hover:border-yellow-400/50 transition-all disabled:opacity-50 flex flex-col items-center gap-0.5"
                      >
                        <Printer className="w-4 h-4" />
                        <span className="text-[9px] leading-none">ย่อ</span>
                      </button>
                      {vatRegistered && (
                      <button
                        onClick={() => setShowInvoiceModal(true)}
                        disabled={currentBill.items.length === 0}
                        title={billing.vatEnabled ? 'ใบกำกับภาษี A4' : 'ใบเสร็จรับเงิน A4'}
                        className="px-3 py-4 rounded-xl bg-[var(--bg)] border border-[var(--border)] text-[var(--fg-3)] hover:text-[var(--primary)] hover:border-phopy-indigo/50 transition-all disabled:opacity-50 flex flex-col items-center gap-0.5"
                      >
                        <Printer className="w-4 h-4" />
                        <span className="text-[9px] leading-none">A4</span>
                      </button>
                      )}
                      <button
                        onClick={() => setShowReceiptQR(true)}
                        disabled={currentBill.items.length === 0 || !currentBill.receipt_qr}
                        title="ใบเสร็จดิจิทัล (QR)"
                        className="px-3 py-4 rounded-xl bg-[var(--bg)] border border-[var(--border)] text-[var(--fg-3)] hover:text-success hover:border-success/50 transition-all disabled:opacity-50 flex flex-col items-center gap-0.5"
                      >
                        <QrCode className="w-4 h-4" />
                        <span className="text-[9px] leading-none">QR</span>
                      </button>
                    </div>
                  </div>
                  <InvoiceCustomerModal
                    isOpen={showInvoiceModal}
                    onClose={() => setShowInvoiceModal(false)}
                    bill={currentBill}
                    discountAmt={discountAmt}
                    onBillUpdated={setCurrentBill}
                    onListRefresh={fetchPaidBills}
                    buildReceiptData={buildReceiptData}
                  />
                  </>
                )
              })()}
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-[var(--fg-4)] p-8">
              <Receipt className="w-16 h-16 mb-4 opacity-30" />
              <p className="text-lg font-medium">เลือกบิลหรือสร้างบิลใหม่</p>
              <button
                onClick={openCreateBill}
                disabled={isStaleShift}
                className="mt-6 px-6 py-3 rounded-xl bg-[var(--primary-soft)] text-[var(--primary)] hover:bg-phopy-indigo/30 transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
                สร้างบิลใหม่
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Create Bill Modal */}
      <CreateBillModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={createBill}
      />

      {/* Assign Member Modal */}
      {showAssignMemberModal && currentBill && (
        <AssignMemberModal
          onClose={() => setShowAssignMemberModal(false)}
          onAssign={async (customer) => {
            try {
              await posBillService.assignMember(currentBill.id, customer.id)
              const r = await posBillService.getBill(currentBill.id)
              if (r.success) setCurrentBill(r.data)
              toast.success(`เพิ่มสมาชิก ${customer.name} สำเร็จ`)
              setShowAssignMemberModal(false)
            } catch { toast.error('เพิ่มสมาชิกไม่สำเร็จ') }
          }}
        />
      )}

      {/* Digital Receipt QR Modal — customer scans instead of taking a paper slip */}
      {showReceiptQR && currentBill?.receipt_qr && (
        <div className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowReceiptQR(false)}>
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            onClick={e => e.stopPropagation()}
            className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-xs p-6 flex flex-col items-center gap-3 text-center"
          >
            <h2 className="text-base font-bold text-[var(--fg-1)]">สแกนดูใบเสร็จดิจิทัล</h2>
            <img src={currentBill.receipt_qr} alt="Receipt QR" className="w-48 h-48" />
            <p className="text-xs text-[var(--fg-3)]">ให้ลูกค้าสแกนด้วยกล้องมือถือแทนการรับใบเสร็จกระดาษ</p>
            <button
              onClick={() => setShowReceiptQR(false)}
              className="mt-2 px-4 py-2 rounded-lg bg-[var(--bg)] text-[var(--fg-2)] text-sm hover:bg-[var(--border)] transition-all"
            >
              ปิด
            </button>
          </motion.div>
        </div>
      )}

      {/* Item Note Modal */}
      {editingItemNote && (
        <ItemNoteModal
          isOpen={!!editingItemNote}
          onClose={() => setEditingItemNote(null)}
          itemName={editingItemNote.product_name}
          initialNote={editingItemNote.special_instructions || ''}
          onSave={(note) => {
            handleSaveItemNote(editingItemNote.id, note)
            setEditingItemNote(null)
          }}
        />
      )}

      {/* Edit Name Modal */}
      <EditNameModal
        isOpen={showEditNameModal}
        onClose={() => setShowEditNameModal(false)}
        currentName={currentBill?.display_name || ''}
        onSave={updateBillName}
      />

      {/* Payment Modal */}
      <PaymentModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        total={(() => {
          return billTotals(currentBill, billing,
            { discount: billDiscountAmount(currentBill), extraCharge: extraCharge.amount }).totalAmount
        })()}
        totalWithRedeem={(redeemBaht) => billTotals(currentBill, billing,
          { discount: billDiscountAmount(currentBill) + redeemBaht, extraCharge: extraCharge.amount }).totalAmount}
        onPay={processPayment}
        loyalty={loyalty}
        customerPoints={currentBill?.customer_id
          ? Math.max(0, (currentBill.customer_loyalty_points ?? 0) - (currentBill.customer_reserved_points ?? 0))
          : null}
        reservedPoints={currentBill?.customer_id ? (currentBill.customer_reserved_points ?? 0) : 0}
      />

      {/* Pay Action Issues Modal */}
      {payActionIssues && payActionIssues.length > 0 && (
        <div className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl max-w-lg w-full p-6 max-h-[80vh] overflow-y-auto"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-[var(--warning-soft)] flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-warning" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-[var(--fg-1)]">ไม่สามารถชำระเงินได้</h2>
                <p className="text-sm text-[var(--fg-3)]">พบปัญหาที่ต้องแก้ไขก่อน</p>
              </div>
            </div>

            <div className="space-y-3 mb-6">
              {payActionIssues.map((issue, idx) => (
                <div key={idx} className="p-3 bg-[var(--bg)] rounded-xl border border-[var(--border)]/50">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[var(--danger-soft)] flex items-center justify-center shrink-0 mt-0.5">
                      {issue.type === 'INSUFFICIENT_STOCK' ? (
                        <Package className="w-4 h-4 text-danger" />
                      ) : issue.type === 'MISSING_CONVERSION' ? (
                        <Scale className="w-4 h-4 text-warning" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-warning" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--fg-1)]">
                        {issue.type === 'INSUFFICIENT_STOCK' ? 'สต็อกไม่พอ' : issue.type === 'MISSING_CONVERSION' ? 'หน่วยไม่ครบ' : 'ปัญหาอื่น'}
                      </p>
                      <p className="text-xs text-[var(--fg-3)] mt-0.5">{issue.message}</p>
                      {issue.link && (
                        <button
                          onClick={() => { window.open(issue.link, '_blank'); setPayActionIssues(null) }}
                          className="mt-2 text-xs px-3 py-1.5 bg-phopy-indigo/15 text-[var(--primary)] rounded-lg hover:bg-phopy-indigo/25 transition-colors"
                        >
                          ไปแก้ไข
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setPayActionIssues(null)}
                className="flex-1 py-2.5 text-sm text-[var(--fg-3)] hover:text-[var(--fg-1)] bg-[var(--bg)] rounded-xl border border-[var(--border)] hover:border-[var(--border)]/80 transition-colors"
              >
                ปิด
              </button>
              <button
                onClick={() => { window.open('/stock', '_blank'); setPayActionIssues(null) }}
                className="flex-1 py-2.5 text-sm bg-phopy-indigo text-[var(--fg-1)] font-semibold rounded-xl hover:bg-phopy-indigo/80 transition-colors"
              >
                ไปหน้าสต็อก
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Category Manager Modal */}
      <CategoryManagerModal
        isOpen={showCategoryModal}
        onClose={() => setShowCategoryModal(false)}
        categories={categories}
        onRefresh={fetchData}
      />

      {/* Open/Close Shift Modal */}
      {shiftModalMode && (
        <ShiftModal
          key={shiftModalMode}
          mode={shiftModalMode}
          shift={currentShift || null}
          blocking={!!blockingShiftMode}
          hasOpenBills={openBills.length > 0}
          onManageBills={blockingShiftMode === 'close' ? () => { setManagingStaleBills(true); setView('bills'); setBillsMode('OPEN'); fetchData() } : undefined}
          onClose={() => setShowShiftModal(null)}
          onDone={() => { setShowShiftModal(null); fetchShift() }}
        />
      )}

      {/* Cash In/Out Modal */}
      {showCashMovementModal && currentShift && (
        <CashMovementModal
          shift={currentShift}
          onClose={() => setShowCashMovementModal(false)}
          onDone={fetchShift}
        />
      )}
    </div>
  )
}

// ==================== Sub Components ====================

// ==================== สรุปวันนี้ (แท็บ "สรุปวันนี้") ====================

const PAY_LABEL: Record<string, string> = { CASH: 'เงินสด', QR_CODE: 'QR', TRANSFER: 'โอน', CREDIT_CARD: 'บัตร' }
const baht = (n?: number) => `฿${(Number(n) || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })}`
const hhmm = (s: string) => new Date(s).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })

function TodaySummary({ shift, sales, moves, onOpenBill }: {
  shift: POSShift | null | undefined
  sales: TodaySale[]
  moves: CashMovement[]
  onOpenBill: (id: string) => void
}) {
  const live = shift?.live
  // เงินในลิ้นชักตอนนี้ = ยอดเดียวกับที่ปิดกะใช้เทียบ (expectedShiftCash) — ไม่ลงเงินออกก็จะโตตามยอดขายเงินสด
  const drawer = expectedShiftCash(shift)
  const rows = [
    ...sales.map(s => ({ key: `b-${s.id}`, at: s.closed_at, sale: s, move: null as CashMovement | null })),
    ...moves.map(m => ({ key: `m-${m.id}`, at: m.created_at, sale: null as TodaySale | null, move: m })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  const salesTotal = sales.reduce((s, b) => s + (b.total_amount || 0), 0)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-4 rounded-xl bg-[var(--surface)] border border-success/30">
          <p className="text-xs text-[var(--fg-3)] flex items-center gap-1.5"><Wallet className="w-4 h-4 text-success" /> เงินสดที่ควรมีในลิ้นชัก</p>
          {shift ? (
            <>
              <p className="text-2xl font-bold text-success mt-1">{baht(drawer)}</p>
              <div className="text-xs text-[var(--fg-3)] mt-2 space-y-0.5">
                <div className="flex justify-between"><span>เงินทอนเริ่มกะ</span><span>{baht(shift.opening_cash)}</span></div>
                <div className="flex justify-between"><span>+ ขายเงินสด</span><span>{baht(live?.cash_revenue)}</span></div>
                {(live?.cash_in || 0) > 0 && <div className="flex justify-between"><span>+ เงินเข้าลิ้นชัก</span><span>{baht(live?.cash_in)}</span></div>}
                {(live?.paid_out || 0) > 0 && <div className="flex justify-between text-danger"><span>− เงินออกลิ้นชัก</span><span>{baht(live?.paid_out)}</span></div>}
              </div>
            </>
          ) : (
            <p className="text-sm text-[var(--fg-4)] mt-2">ยังไม่ได้เปิดกะ</p>
          )}
        </div>
        <div className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--border)]">
          <p className="text-xs text-[var(--fg-3)] flex items-center gap-1.5"><QrCode className="w-4 h-4 text-blue-400" /> รับโอน / QR</p>
          <p className="text-2xl font-bold text-[var(--fg-1)] mt-1">{baht(live?.bank_revenue)}</p>
          <p className="text-xs text-[var(--fg-4)] mt-2">เข้าบัญชีธนาคาร ไม่อยู่ในลิ้นชัก</p>
        </div>
        <div className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--border)]">
          <p className="text-xs text-[var(--fg-3)] flex items-center gap-1.5"><Receipt className="w-4 h-4 text-[var(--primary)]" /> ยอดขายวันนี้</p>
          <p className="text-2xl font-bold text-[var(--fg-1)] mt-1">{baht(shift ? live?.total_revenue : salesTotal)}</p>
          <p className="text-xs text-[var(--fg-4)] mt-2">{sales.length} บิล</p>
        </div>
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
          <h3 className="font-semibold text-[var(--fg-1)] text-sm">รายการวันนี้</h3>
          <Link to="/accounting/pos-clearing" className="text-xs text-[var(--primary)] hover:underline flex items-center gap-1">
            <History className="w-3.5 h-3.5" /> ประวัติการขายย้อนหลัง
          </Link>
        </div>
        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-[var(--fg-4)]">ยังไม่มีการขายหรือเงินเข้า/ออกวันนี้</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {rows.map(r => r.sale ? (
              <li key={r.key}>
                <button onClick={() => onOpenBill(r.sale!.id)} className="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-[var(--bg)]">
                  <span className="text-xs text-[var(--fg-4)] w-12 shrink-0">{hhmm(r.at)}</span>
                  {r.sale.methods.includes('CASH') ? <Banknote className="w-4 h-4 text-warning shrink-0" /> : <QrCode className="w-4 h-4 text-blue-400 shrink-0" />}
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-[var(--fg-1)] truncate">{r.sale.display_name || r.sale.bill_number}</span>
                    <span className="block text-xs text-[var(--fg-4)]">{r.sale.bill_number} · {r.sale.methods.map(m => PAY_LABEL[m] || m).join(' + ') || 'ไม่มีรายการรับเงิน'}</span>
                  </span>
                  <span className="text-sm font-semibold text-success">+{baht(r.sale.total_amount)}</span>
                </button>
              </li>
            ) : (
              <li key={r.key} className="px-4 py-2.5 flex items-center gap-3">
                <span className="text-xs text-[var(--fg-4)] w-12 shrink-0">{hhmm(r.at)}</span>
                {r.move!.type === 'CASH_IN'
                  ? <ArrowDownToLine className="w-4 h-4 text-success shrink-0" />
                  : <ArrowUpFromLine className="w-4 h-4 text-danger shrink-0" />}
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-[var(--fg-1)] truncate">{r.move!.type === 'CASH_IN' ? 'เงินเข้าลิ้นชัก' : r.move!.type === 'OPENING_GAP' ? 'เงินออกก่อนเปิดกะ' : 'เงินออกลิ้นชัก'}{r.move!.reason ? ` — ${r.move!.reason}` : ''}</span>
                  {r.move!.account_name && <span className="block text-xs text-[var(--fg-4)]">{r.move!.account_name}</span>}
                </span>
                <span className={`text-sm font-semibold ${r.move!.type === 'CASH_IN' ? 'text-success' : 'text-danger'}`}>
                  {r.move!.type === 'CASH_IN' ? '+' : '−'}{baht(r.move!.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function CreateBillModal({ isOpen, onClose, onCreate }: {
  isOpen: boolean
  onClose: () => void
  onCreate: (name?: string, customerId?: string) => void
}) {
  useModalClose(onClose)
  const [name, setName] = useState('')
  const [memberQuery, setMemberQuery] = useState('')
  const [memberResults, setMemberResults] = useState<CRMCustomer[]>([])
  const [selectedMember, setSelectedMember] = useState<CRMCustomer | null>(null)
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!memberQuery.trim()) { setMemberResults([]); return }
    const t = setTimeout(async () => {
      try {
        setSearching(true)
        const res = await posBillService.searchCustomers(memberQuery)
        if (res.success) setMemberResults(res.data)
      } finally { setSearching(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [memberQuery])

  const handleCreate = () => {
    onCreate(name || undefined, selectedMember?.id)
    setName(''); setMemberQuery(''); setSelectedMember(null); setMemberResults([])
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-md p-6 max-h-[80vh] overflow-y-auto"
      >
        <h2 className="text-xl font-bold text-[var(--fg-1)] mb-4">สร้างบิลใหม่</h2>

        {/* Bill name */}
        <input
          type="text"
          placeholder="ชื่อบิล (เว้นว่างได้)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] placeholder:text-[var(--fg-4)] focus:outline-none focus:border-phopy-indigo mb-4"
        />

        {/* Member search */}
        <div className="mb-4">
          <label className="block text-sm text-[var(--fg-3)] mb-1.5 flex items-center gap-1.5">
            <Star className="w-3.5 h-3.5 text-warning" /> สมาชิก (ค้นหาชื่อหรือเบอร์โทร)
          </label>
          {selectedMember ? (
            <div className="flex items-center justify-between bg-phopy-indigo/10 border border-phopy-indigo/30 rounded-lg px-3 py-2">
              <div>
                <p className="text-sm font-medium text-[var(--fg-1)]">{selectedMember.name}</p>
                <p className="text-xs text-[var(--fg-3)]">{selectedMember.phone} · แต้ม {selectedMember.loyalty_points.toLocaleString()}</p>
              </div>
              <button onClick={() => { setSelectedMember(null); setMemberQuery('') }}
                className="p-1 text-[var(--fg-3)] hover:text-danger">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--fg-4)]" />
              <input
                type="text"
                placeholder="ค้นหา..."
                value={memberQuery}
                onChange={(e) => setMemberQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] placeholder:text-[var(--fg-4)] focus:outline-none focus:border-phopy-indigo text-sm"
              />
              {memberResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-xl z-10 max-h-48 overflow-y-auto">
                  {memberResults.map(c => (
                    <button key={c.id} onClick={() => { setSelectedMember(c); setMemberQuery(''); setMemberResults([]) }}
                      className="w-full px-4 py-2.5 text-left hover:bg-[var(--bg)] flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-[var(--fg-1)]">{c.name}</p>
                        <p className="text-xs text-[var(--fg-4)]">{c.phone}</p>
                      </div>
                      <span className="text-xs text-[var(--primary)]">{c.loyalty_points.toLocaleString()} แต้ม</span>
                    </button>
                  ))}
                </div>
              )}
              {searching && <p className="text-xs text-[var(--fg-4)] mt-1 px-1">กำลังค้นหา...</p>}
            </div>
          )}
          <p className="text-xs text-[var(--fg-4)] mt-1.5">เว้นว่างได้ — สามารถเพิ่มสมาชิกหลังเปิดบิลแล้วก็ได้</p>
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 text-[var(--fg-3)] hover:text-[var(--fg-1)] transition-colors">
            ยกเลิก
          </button>
          <button onClick={handleCreate}
            className="flex-1 px-4 py-2 bg-gradient-to-r from-phopy-indigo to-purple-500 text-white rounded-lg hover:opacity-90">
            สร้าง
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ==================== Assign Member Modal ====================

function AssignMemberModal({ onClose, onAssign }: {
  onClose: () => void
  onAssign: (customer: CRMCustomer) => void
}) {
  useModalClose(onClose)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CRMCustomer[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    const t = setTimeout(async () => {
      try {
        setSearching(true)
        const res = await posBillService.searchCustomers(query)
        if (res.success) setResults(res.data)
      } finally { setSearching(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  return (
    <div className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-sm max-h-[80vh] overflow-y-auto"
      >
        <div className="p-5 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--fg-1)] flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-[var(--primary)]" /> เพิ่มสมาชิก
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg)] text-[var(--fg-3)] hover:text-[var(--fg-1)]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--fg-4)]" />
            <input
              type="text"
              autoFocus
              placeholder="ค้นหาชื่อหรือเบอร์โทร..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] placeholder:text-[var(--fg-4)] focus:outline-none focus:border-phopy-indigo"
            />
          </div>

          {searching && <p className="text-sm text-center text-[var(--fg-4)]">กำลังค้นหา...</p>}

          {results.length > 0 && (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {results.map(c => (
                <button key={c.id} onClick={() => onAssign(c)}
                  className="w-full px-4 py-3 text-left hover:bg-[var(--bg)] rounded-lg flex items-center justify-between group">
                  <div>
                    <p className="text-sm font-medium text-[var(--fg-1)] group-hover:text-[var(--primary)]">{c.name}</p>
                    <p className="text-xs text-[var(--fg-4)]">{c.phone}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-[var(--primary)] font-medium">{c.loyalty_points.toLocaleString()} แต้ม</p>
                    <p className="text-xs text-[var(--fg-4)]">ยอดสะสม ฿{(c.total_spent || 0).toLocaleString()}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {query.length > 0 && !searching && results.length === 0 && (
            <p className="text-sm text-center text-[var(--fg-4)] py-4">ไม่พบสมาชิก</p>
          )}
        </div>
      </motion.div>
    </div>
  )
}

// ==================== Invoice Customer Modal ====================
// popup ผูกกับปุ่มพิมพ์ A4: กรอก/เลือกข้อมูลผู้ซื้อสำหรับใบกำกับภาษี แล้วออกใบกำกับได้เมื่อบิลจ่ายเงินแล้ว

function InvoiceCustomerModal({ isOpen, onClose, bill, discountAmt, onBillUpdated, onListRefresh, buildReceiptData }: {
  isOpen: boolean
  onClose: () => void
  bill: CurrentBill
  discountAmt: number
  onBillUpdated: (bill: CurrentBill) => void
  onListRefresh: () => void
  buildReceiptData: (bill: any, method: string, cashReceived?: number, discountAmt?: number) => any
}) {
  useModalClose(onClose)
  const [tab, setTab] = useState<'search' | 'new'>('search')
  const [editingCustomer, setEditingCustomer] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CRMCustomer[]>([])
  const [searching, setSearching] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [issueError, setIssueError] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', taxId: '', address: '', branchMode: 'HQ' as 'HQ' | 'BRANCH', branchNo: '', phone: '', vatMode: null as 'NONE' | 'INCLUSIVE' | 'EXCLUSIVE' | null })

  useEffect(() => {
    if (isOpen) {
      setTab('search'); setQuery(''); setResults([]); setEditingCustomer(false); setIssueError(null)
      setForm({ name: '', taxId: '', address: '', branchMode: 'HQ', branchNo: '', phone: '', vatMode: null })
    }
  }, [isOpen, bill.id])

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    const t = setTimeout(async () => {
      try {
        setSearching(true)
        const res = await posBillService.searchCustomers(query)
        if (res.success) setResults(res.data)
      } finally { setSearching(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  if (!isOpen) return null

  const hasInvoice = !!bill.invoice
  const showForm = !bill.customer_id || editingCustomer

  const assignCustomer = async (customerId: string) => {
    setAssigning(true)
    try {
      const res = await posBillService.assignMember(bill.id, customerId)
      if (res.success) {
        const r = await posBillService.getBill(bill.id)
        if (r.success) onBillUpdated(r.data)
        setEditingCustomer(false)
        toast.success('ผูกข้อมูลผู้ซื้อแล้ว')
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'ผูกข้อมูลผู้ซื้อไม่สำเร็จ')
    } finally { setAssigning(false) }
  }

  const handleCreateAndAssign = async () => {
    if (!form.name.trim()) { toast.error('กรุณากรอกชื่อผู้ซื้อ'); return }
    if (!form.address.trim()) { toast.error('กรุณากรอกที่อยู่'); return }
    if (form.taxId && !/^\d{13}$/.test(form.taxId.trim())) { toast.error('เลขผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก'); return }
    const taxBranch = form.branchMode === 'HQ'
      ? 'สำนักงานใหญ่'
      : `สาขาที่ ${(form.branchNo.trim() || '00001').padStart(5, '0')}`
    setSaving(true)
    try {
      const res = await api.post('/customers', {
        name: form.name.trim(),
        taxId: form.taxId.trim() || undefined,
        address: form.address.trim(),
        taxBranch,
        // เว้นว่างได้ — ไม่ยัด '-' เพราะมันจะพิมพ์ออกมาเป็น "โทร : -" บนใบกำกับภาษีจริง
        phone: form.phone.trim(),
        type: 'RETAIL',
        vatMode: form.vatMode,
      })
      const customerId = res.data?.data?.id
      if (customerId) await assignCustomer(customerId)
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'เพิ่มลูกค้าไม่สำเร็จ')
    } finally { setSaving(false) }
  }

  const handlePrint = () => {
    const rd = buildReceiptData(bill, 'CASH', 0, discountAmt)
    printPOSReceipt(rd, 'a4')
  }

  const issueInvoice = async () => {
    if (!bill.customer_id) { toast.error('กรุณาเลือกหรือเพิ่มผู้ซื้อก่อน'); return }
    setIssuing(true)
    setIssueError(null)
    try {
      const res = await api.post(`/pos/bills/${bill.id}/invoice`, { customerId: bill.customer_id })
      if (res.data?.success) {
        toast.success(`ออกใบกำกับภาษีสำเร็จ: ${res.data.data.invoice.invoice_number}`)
        const r = await posBillService.getBill(bill.id)
        if (r.success) onBillUpdated(r.data)
        onListRefresh()
      }
    } catch (e: any) {
      setIssueError(e.response?.data?.message || 'ออกใบกำกับภาษีไม่สำเร็จ')
    } finally { setIssuing(false) }
  }

  return (
    <div className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-lg p-6 max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[var(--fg-1)]">ข้อมูลผู้ซื้อสำหรับใบกำกับภาษี</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg)] text-[var(--fg-3)] hover:text-[var(--fg-1)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        {hasInvoice && (
          <div className="mb-4 p-3 bg-success/10 border border-success/30 rounded-xl">
            <p className="text-sm font-semibold text-success">ออกใบกำกับภาษีแล้ว {bill.invoice!.invoice_number}</p>
            <p className="text-xs text-[var(--fg-3)] mt-1">ต้องยกเลิกใบกำกับก่อนถ้าจะแก้ผู้ซื้อ (ผู้มีสิทธิ์อนุมัติเท่านั้น)</p>
          </div>
        )}

        {!showForm ? (
          <div className="mb-4 p-3 bg-[var(--bg)] rounded-xl border border-[var(--border)] space-y-1">
            <p className="text-sm font-medium text-[var(--fg-1)]">{bill.customer_name || '-'}</p>
            {bill.customer_tax_id && <p className="text-xs text-[var(--fg-3)]">เลขผู้เสียภาษี {bill.customer_tax_id}</p>}
            <p className="text-xs text-[var(--fg-3)]">{bill.customer_address || 'ไม่มีที่อยู่'}</p>
            <p className="text-xs text-[var(--fg-3)]">{bill.customer_tax_branch || 'สำนักงานใหญ่'}</p>
            {bill.customer_phone && <p className="text-xs text-[var(--fg-3)]">โทร {bill.customer_phone}</p>}
            {!hasInvoice && (
              <button onClick={() => setEditingCustomer(true)} className="text-xs text-[var(--primary)] hover:underline mt-1">
                เปลี่ยนผู้ซื้อ
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="flex gap-1 bg-[var(--bg)] rounded-lg p-1 mb-4">
              <button
                onClick={() => setTab('search')}
                className={`flex-1 py-1.5 rounded-md text-sm transition-all ${tab === 'search' ? 'bg-[var(--primary-soft)] text-[var(--primary)]' : 'text-[var(--fg-3)] hover:text-[var(--fg-1)]'}`}
              >
                ค้นหาจาก CRM
              </button>
              <button
                onClick={() => setTab('new')}
                className={`flex-1 py-1.5 rounded-md text-sm transition-all ${tab === 'new' ? 'bg-[var(--primary-soft)] text-[var(--primary)]' : 'text-[var(--fg-3)] hover:text-[var(--fg-1)]'}`}
              >
                เพิ่มลูกค้าใหม่
              </button>
            </div>

            {tab === 'search' ? (
              <div className="space-y-2 mb-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--fg-4)]" />
                  <input
                    type="text"
                    autoFocus
                    placeholder="ค้นหาชื่อ หรือเบอร์โทร..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] placeholder:text-[var(--fg-4)] focus:outline-none focus:border-phopy-indigo text-sm"
                  />
                </div>
                {searching && <p className="text-xs text-center text-[var(--fg-4)]">กำลังค้นหา...</p>}
                {results.length > 0 && (
                  <div className="space-y-1 max-h-56 overflow-y-auto">
                    {results.map(c => (
                      <button
                        key={c.id}
                        disabled={assigning}
                        onClick={() => assignCustomer(c.id)}
                        className="w-full px-3 py-2.5 text-left hover:bg-[var(--bg)] rounded-lg flex items-center justify-between disabled:opacity-50"
                      >
                        <div>
                          <p className="text-sm font-medium text-[var(--fg-1)]">{c.name}</p>
                          <p className="text-xs text-[var(--fg-4)]">{c.phone}</p>
                        </div>
                        <span className="text-xs text-[var(--fg-4)]">{c.code}</span>
                      </button>
                    ))}
                  </div>
                )}
                {query.length > 0 && !searching && results.length === 0 && (
                  <p className="text-xs text-center text-[var(--fg-4)] py-3">ไม่พบลูกค้า ลองแท็บ "เพิ่มลูกค้าใหม่"</p>
                )}
              </div>
            ) : (
              <div className="space-y-3 mb-4">
                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1">ชื่อผู้ซื้อ / นิติบุคคล *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1">เลขประจำตัวผู้เสียภาษี (ถ้ามี)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={13}
                    value={form.taxId}
                    onChange={(e) => setForm(f => ({ ...f, taxId: e.target.value.replace(/\D/g, '') }))}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo"
                  />
                  {form.taxId.length > 0 && form.taxId.length !== 13 && (
                    <p className="text-xs text-danger mt-1">เลขผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก (กรอกแล้ว {form.taxId.length} หลัก)</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1">ที่อยู่ *</label>
                  <textarea
                    rows={2}
                    value={form.address}
                    onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo resize-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1.5">สาขา</label>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-1.5 text-sm text-[var(--fg-2)]">
                      <input type="radio" checked={form.branchMode === 'HQ'} onChange={() => setForm(f => ({ ...f, branchMode: 'HQ' }))} />
                      สำนักงานใหญ่
                    </label>
                    <label className="flex items-center gap-1.5 text-sm text-[var(--fg-2)]">
                      <input type="radio" checked={form.branchMode === 'BRANCH'} onChange={() => setForm(f => ({ ...f, branchMode: 'BRANCH' }))} />
                      สาขาที่
                    </label>
                    {form.branchMode === 'BRANCH' && (
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="00001"
                        value={form.branchNo}
                        onChange={(e) => setForm(f => ({ ...f, branchNo: e.target.value.replace(/\D/g, '') }))}
                        className="w-20 px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-sm text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo"
                      />
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1">เบอร์โทร</label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo"
                  />
                </div>
                <VatModeField value={form.vatMode} onChange={(vatMode) => setForm(f => ({ ...f, vatMode }))} />
                <button
                  onClick={handleCreateAndAssign}
                  disabled={saving}
                  className="w-full py-2.5 bg-gradient-to-r from-phopy-indigo to-purple-500 text-white font-semibold rounded-lg hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? 'กำลังบันทึก...' : 'บันทึกและใช้ลูกค้ารายนี้'}
                </button>
              </div>
            )}
          </>
        )}

        {bill.customer_id && !showForm && (
          <div className="space-y-2 pt-3 border-t border-[var(--border)]">
            <button
              onClick={handlePrint}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[var(--fg-2)] hover:text-[var(--primary)] text-sm"
            >
              <Printer className="w-4 h-4" /> พิมพ์ A4
            </button>

            {hasInvoice ? (
              <button
                onClick={handlePrint}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-success/15 text-success font-semibold text-sm hover:bg-success/25"
              >
                <Printer className="w-4 h-4" /> พิมพ์ใบกำกับภาษี
              </button>
            ) : bill.status === 'PAID' ? (
              <>
                {issueError && <p className="text-xs text-danger text-center">{issueError}</p>}
                <button
                  onClick={issueInvoice}
                  disabled={issuing}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-phopy-indigo text-white font-semibold text-sm hover:bg-phopy-indigo/80 disabled:opacity-50"
                >
                  {issuing ? 'กำลังออกใบกำกับ...' : 'ยืนยันออกใบกำกับภาษี'}
                </button>
              </>
            ) : (
              <p className="text-xs text-center text-warning">ต้องชำระเงินก่อนจึงจะออกใบกำกับภาษีได้</p>
            )}
          </div>
        )}
      </motion.div>
    </div>
  )
}

function EditNameModal({ isOpen, onClose, currentName, onSave }: {
  isOpen: boolean
  onClose: () => void
  currentName: string
  onSave: (name: string) => void
}) {
  useModalClose(onClose)
  const [name, setName] = useState(currentName)

  useEffect(() => {
    setName(currentName)
  }, [currentName, isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-md p-6 max-h-[80vh] overflow-y-auto"
      >
        <h2 className="text-xl font-bold text-[var(--fg-1)] mb-4">แก้ไขชื่อบิล</h2>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo mb-4"
        />
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-[var(--fg-3)] hover:text-[var(--fg-1)] transition-colors"
          >
            ยกเลิก
          </button>
          <button
            onClick={() => {
              onSave(name)
              onClose()
            }}
            className="flex-1 px-4 py-2 bg-gradient-to-r from-phopy-indigo to-purple-500 text-white rounded-lg hover:opacity-90"
          >
            บันทึก
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ==================== Item Note Modal ====================

const QUICK_NOTES = [
  'หวานน้อย (50%)',
  'หวานปกติ (100%)',
  'ไม่หวาน (0%)',
  'หวาน 25%',
  'เพิ่มหวาน (125%)',
  'แยกน้ำแข็ง',
  'ไม่ใส่น้ำแข็ง',
  'ไม่ใส่นม',
  'ไม่ใส่ผัก',
  'ไม่ใส่กระเทียม',
  'ไม่เผ็ด',
  'เผ็ดน้อย',
  'เผ็ดมาก',
  'พิเศษ',
  'แยกน้ำ',
  'ใส่ถุงกลับบ้าน',
]

function ItemNoteModal({ isOpen, onClose, itemName, initialNote, onSave }: {
  isOpen: boolean
  onClose: () => void
  itemName: string
  initialNote: string
  onSave: (note: string) => void
}) {
  useModalClose(onClose)
  const [note, setNote] = useState(initialNote)

  useEffect(() => {
    setNote(initialNote)
  }, [initialNote, isOpen])

  if (!isOpen) return null

  const handleToggleChip = (chip: string) => {
    if (!note) {
      setNote(chip)
      return
    }
    const parts = note.split(',').map(p => p.trim()).filter(Boolean)
    if (parts.includes(chip)) {
      setNote(parts.filter(p => p !== chip).join(', '))
    } else {
      setNote([...parts, chip].join(', '))
    }
  }

  return (
    <div className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-md p-6 max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-[var(--fg-1)]">หมายเหตุ / ปรับแต่งรายการ</h2>
            <p className="text-xs text-[var(--fg-3)] mt-0.5">{itemName}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[var(--bg)] text-[var(--fg-3)]">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Chips */}
        <div className="mb-4">
          <label className="text-xs font-semibold text-[var(--fg-3)] mb-2 block">ตัวเลือกยอดนิยม</label>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_NOTES.map(chip => {
              const active = note.split(',').map(s => s.trim()).includes(chip)
              return (
                <button
                  key={chip}
                  type="button"
                  onClick={() => handleToggleChip(chip)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                    active
                      ? 'bg-phopy-indigo text-white border-phopy-indigo font-medium shadow-sm'
                      : 'bg-[var(--bg)] text-[var(--fg-2)] border-[var(--border)] hover:border-phopy-indigo/50'
                  }`}
                >
                  {chip}
                </button>
              )
            })}
          </div>
        </div>

        {/* Custom Textarea */}
        <div className="mb-5">
          <div className="flex justify-between items-center mb-1">
            <label className="text-xs font-semibold text-[var(--fg-3)]">รายละเอียดเพิ่มเติม</label>
            {note && (
              <button
                type="button"
                onClick={() => setNote('')}
                className="text-[11px] text-danger hover:underline"
              >
                ล้างข้อความ
              </button>
            )}
          </div>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="เช่น หวานน้อย 50%, ไม่ใส่ต้นหอม, สุกปานกลาง"
            className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo"
          />
        </div>

        {/* Footer Actions */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm text-[var(--fg-3)] hover:text-[var(--fg-1)] transition-colors"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={() => onSave(note.trim())}
            className="flex-1 px-4 py-2 bg-gradient-to-r from-phopy-indigo to-purple-500 text-white text-sm font-semibold rounded-lg hover:opacity-90"
          >
            บันทึก
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ==================== Category Manager Modal ====================

const PRESET_COLORS = [
  'var(--primary)', 'var(--success)', 'var(--warning)', 'var(--danger)', 'var(--info)',
  'var(--fg-4)', 'var(--fg-3)', 'var(--fg-2)', 'var(--fg-1)', 'var(--link)',
]

function CategoryManagerModal({ isOpen, onClose, categories, onRefresh }: {
  isOpen: boolean
  onClose: () => void
  categories: POSCategory[]
  onRefresh: () => void
}) {
  useModalClose(onClose)
  const [tab, setTab] = useState<'cats' | 'assign'>('cats')
  const [name, setName] = useState('')
  const [color, setColor] = useState(PRESET_COLORS[0])
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')
  const [menus, setMenus] = useState<POSMenu[]>([])
  const [menuCats, setMenuCats] = useState<Record<string, string | null>>({})
  const [assignSearch, setAssignSearch] = useState('')

  useEffect(() => {
    if (isOpen && tab === 'assign') {
      posService.getMenuConfigs().then(res => {
        const list = res.data || []
        setMenus(list)
        const map: Record<string, string | null> = {}
        list.forEach((m: POSMenu) => { map[m.id] = (m as any).category_id || null })
        setMenuCats(map)
      })
    }
  }, [isOpen, tab])

  const handleAdd = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      await posService.createCategory({ name: name.trim(), color })
      setName('')
      setColor(PRESET_COLORS[0])
      onRefresh()
    } catch { toast.error('เพิ่มหมวดหมู่ไม่สำเร็จ') }
    finally { setSaving(false) }
  }

  const handleEdit = async (id: string) => {
    if (!editName.trim()) return
    setSaving(true)
    try {
      await posService.updateCategory(id, { name: editName.trim(), color: editColor })
      setEditingId(null)
      onRefresh()
    } catch { toast.error('แก้ไขไม่สำเร็จ') }
    finally { setSaving(false) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('ลบหมวดหมู่นี้?')) return
    try {
      await posService.deleteCategory(id)
      onRefresh()
    } catch { toast.error('ลบไม่สำเร็จ') }
  }

  const handleAssign = async (menuId: string, catId: string | null) => {
    setMenuCats(prev => ({ ...prev, [menuId]: catId }))
    try {
      await posService.updateMenuConfig(menuId, { category_id: catId as any })
      onRefresh()
    } catch {
      toast.error('เปลี่ยนหมวดหมู่ไม่สำเร็จ')
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-lg p-6 max-h-[80vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[var(--fg-1)] flex items-center gap-2">
            <Settings className="w-5 h-5 text-[var(--primary)]" />
            จัดการหมวดหมู่
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--bg)] text-[var(--fg-3)]">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-[var(--bg)] rounded-lg p-1 mb-4">
          <button
            onClick={() => setTab('cats')}
            className={`flex-1 py-1.5 rounded-md text-sm transition-all ${tab === 'cats' ? 'bg-[var(--primary-soft)] text-[var(--primary)]' : 'text-[var(--fg-3)] hover:text-[var(--fg-1)]'}`}
          >
            หมวดหมู่
          </button>
          <button
            onClick={() => setTab('assign')}
            className={`flex-1 py-1.5 rounded-md text-sm transition-all ${tab === 'assign' ? 'bg-[var(--primary-soft)] text-[var(--primary)]' : 'text-[var(--fg-3)] hover:text-[var(--fg-1)]'}`}
          >
            จัดเมนู
          </button>
        </div>

        {tab === 'cats' ? (
          <>
            {/* Add new */}
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                placeholder="ชื่อหมวดหมู่ใหม่..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                className="flex-1 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] placeholder:text-[var(--fg-4)] focus:outline-none focus:border-phopy-indigo text-sm"
              />
              <div className="flex gap-1 items-center">
                {PRESET_COLORS.slice(0, 5).map(c => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`w-6 h-6 rounded-full transition-transform ${color === c ? 'scale-125 ring-2 ring-white' : 'opacity-70 hover:opacity-100'}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
              <button
                onClick={handleAdd}
                disabled={saving || !name.trim()}
                className="px-3 py-2 bg-[var(--primary-soft)] text-[var(--primary)] rounded-lg hover:bg-phopy-indigo/30 transition-all disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            {/* Category List */}
            <div className="flex-1 overflow-y-auto space-y-2">
              {categories.length === 0 && (
                <p className="text-center text-[var(--fg-4)] py-6 text-sm">ยังไม่มีหมวดหมู่</p>
              )}
              {categories.map((cat) => (
                <div key={cat.id} className="flex items-center gap-2 p-2 bg-[var(--bg)] rounded-lg">
                  {editingId === cat.id ? (
                    <>
                      <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: editColor }} />
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleEdit(cat.id)}
                        className="flex-1 px-2 py-1 bg-[var(--surface)] border border-[var(--border)] rounded text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo"
                        autoFocus
                      />
                      <div className="flex gap-1">
                        {PRESET_COLORS.slice(0, 5).map(c => (
                          <button
                            key={c}
                            onClick={() => setEditColor(c)}
                            className={`w-4 h-4 rounded-full ${editColor === c ? 'ring-1 ring-white' : 'opacity-60 hover:opacity-100'}`}
                            style={{ background: c }}
                          />
                        ))}
                      </div>
                      <button onClick={() => handleEdit(cat.id)} className="p-1 text-success hover:text-success">
                        <Check className="w-4 h-4" />
                      </button>
                      <button onClick={() => setEditingId(null)} className="p-1 text-[var(--fg-3)] hover:text-[var(--fg-1)]">
                        <X className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: cat.color }} />
                      <span className="flex-1 text-sm text-[var(--fg-1)]">{cat.name}</span>
                      <button
                        onClick={() => { setEditingId(cat.id); setEditName(cat.name); setEditColor(cat.color) }}
                        className="p-1 text-[var(--fg-3)] hover:text-[var(--primary)]"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button onClick={() => handleDelete(cat.id)} className="p-1 text-[var(--fg-3)] hover:text-danger">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          /* Assign menus to categories */
          <div className="flex flex-col flex-1 min-h-0 gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--fg-3)]" />
              <input
                type="text"
                placeholder="ค้นหาเมนู..."
                value={assignSearch}
                onChange={(e) => setAssignSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] placeholder:text-[var(--fg-4)] focus:outline-none focus:border-phopy-indigo text-sm"
              />
            </div>

            {/* Menu list */}
            <div className="flex-1 overflow-y-auto space-y-2">
              {menus.length === 0 && (
                <p className="text-center text-[var(--fg-4)] py-6 text-sm">ไม่มีเมนูใน POS</p>
              )}
              {menus
                .filter(m =>
                  !assignSearch ||
                  m.product_name?.toLowerCase().includes(assignSearch.toLowerCase()) ||
                  m.product_code?.toLowerCase().includes(assignSearch.toLowerCase())
                )
                .map((menu) => {
                  const currentCatId = menuCats[menu.id]
                  return (
                    <div key={menu.id} className="p-2 bg-[var(--bg)] rounded-lg space-y-2">
                      <div>
                        <p className="text-sm text-[var(--fg-1)]">{menu.product_name}</p>
                        <p className="text-xs text-[var(--fg-4)]">{menu.product_code}</p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <button
                          onClick={() => handleAssign(menu.id, null)}
                          className={`px-2 py-0.5 rounded-full text-xs transition-all ${
                            !currentCatId
                              ? 'bg-gray-500/30 text-[var(--fg-2)] ring-1 ring-gray-400'
                              : 'bg-[var(--surface)] text-[var(--fg-4)] hover:text-[var(--fg-2)]'
                          }`}
                        >
                          ไม่มี
                        </button>
                        {categories.map(cat => (
                          <button
                            key={cat.id}
                            onClick={() => handleAssign(menu.id, cat.id)}
                            className={`px-2 py-0.5 rounded-full text-xs transition-all ${
                              currentCatId === cat.id
                                ? 'ring-1 ring-white'
                                : 'opacity-50 hover:opacity-90'
                            }`}
                            style={{
                              background: `${cat.color}30`,
                              color: cat.color,
                              ...(currentCatId === cat.id ? { background: `${cat.color}50` } : {}),
                            }}
                          >
                            {cat.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  )
}

function PaymentModal({ isOpen, onClose, total, totalWithRedeem, onPay, loyalty, customerPoints, reservedPoints = 0 }: {
  isOpen: boolean
  onClose: () => void
  total: number
  /** ยอดเมื่อหักแต้มเป็นส่วนลดท้ายบิล (ก่อน VAT) — ต้องคิดแบบเดียวกับ backend ตอนรับชำระ */
  totalWithRedeem: (redeemBaht: number) => number
  onPay: (method: 'CASH' | 'QR_CODE' | 'CREDIT_CARD', redeemPoints?: number, cashReceived?: number, bankAccountId?: string) => void
  loyalty: LoyaltyConfig
  customerPoints: number | null
  reservedPoints?: number
}) {
  useModalClose(onClose)
  const [redeemInput, setRedeemInput] = useState(0)
  const [showQrConfirm, setShowQrConfirm] = useState(false)

  useEffect(() => { if (isOpen) setShowQrConfirm(false) }, [isOpen])

  if (!isOpen) return null

  const defaultBank = getCachedDefaultBankAccount()

  // Max redeemable: min(customerPoints, points that cover total)
  const maxRedeemable = customerPoints !== null && loyalty.enabled && loyalty.redeemRate > 0
    ? Math.min(customerPoints, Math.floor(total * loyalty.redeemRate))
    : 0
  const canRedeem = maxRedeemable >= (loyalty.minRedeemPoints || 0) && maxRedeemable > 0
  const redeemDiscount = redeemInput > 0 ? Math.floor(redeemInput / loyalty.redeemRate) : 0
  const finalTotal = redeemDiscount > 0 ? totalWithRedeem(redeemDiscount) : total

  const handlePay = (method: 'CASH' | 'QR_CODE' | 'CREDIT_CARD') => {
    // Show the QR to the customer first when a bank account with a QR image is
    // configured — otherwise fall back to paying immediately (no bank account
    // set up yet, same behavior as before this feature existed).
    if (method === 'QR_CODE' && defaultBank?.qr_code_base64) {
      setShowQrConfirm(true)
      return
    }
    onPay(method, redeemInput > 0 ? redeemInput : undefined)
  }

  const confirmQrPaid = () => {
    onPay('QR_CODE', redeemInput > 0 ? redeemInput : undefined, undefined, defaultBank?.id)
  }

  return (
    <div className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl max-w-md w-full p-6 max-h-[80vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-[var(--fg-1)]">{showQrConfirm ? 'สแกน QR เพื่อชำระเงิน' : 'ชำระเงิน'}</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[var(--bg)] text-[var(--fg-3)]">
            <X className="w-5 h-5" />
          </button>
        </div>

        {showQrConfirm ? (
          <div className="space-y-4">
            <div className="text-center">
              <p className="text-[var(--fg-3)] mb-1">ยอดที่ต้องชำระ</p>
              <p className="text-3xl font-bold text-success">฿{finalTotal.toLocaleString()}</p>
            </div>
            <div className="flex justify-center">
              <img src={defaultBank?.qr_code_base64 || ''} alt="QR" className="w-56 h-56 object-contain border border-[var(--border)] rounded-xl bg-[var(--bg)] p-3" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-[var(--fg-1)]">{defaultBank?.bank_name}</p>
              <p className="text-sm text-[var(--fg-3)]">{defaultBank?.account_name} · {defaultBank?.account_number}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setShowQrConfirm(false)} className="phopy-btn-secondary py-3">ย้อนกลับ</button>
              <button onClick={confirmQrPaid} className="phopy-btn-primary py-3">ยืนยันรับเงินแล้ว</button>
            </div>
          </div>
        ) : (
        <>
        {/* Redeem Points UI */}
        {canRedeem ? (
          <div className="mb-4 p-4 bg-[var(--warning-soft)] border border-warning/30 rounded-xl space-y-3">
            <div className="flex items-center gap-2">
              <Star className="w-4 h-4 text-warning" />
              <p className="text-sm font-medium text-warning">แลกแต้มสมาชิก</p>
              <div className="ml-auto text-right">
                <span className="text-xs text-[var(--fg-3)]">มี {customerPoints!.toLocaleString()} แต้ม</span>
                {reservedPoints > 0 && (
                  <span className="text-xs text-[var(--fg-4)] block">จองไว้กับของแถม {reservedPoints.toLocaleString()} แต้ม</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={redeemInput || ''}
                onChange={(e) => {
                  const v = Math.min(maxRedeemable, Math.max(0, parseInt(e.target.value) || 0))
                  setRedeemInput(v)
                }}
                placeholder="0"
                className="phopy-input w-28 text-center"
                min={0}
                max={maxRedeemable}
                step={loyalty.redeemRate}
              />
              <span className="text-[var(--fg-3)] text-sm flex-1">แต้ม = ลด ฿{redeemDiscount.toLocaleString()}</span>
              {redeemInput > 0 && (
                <button onClick={() => setRedeemInput(0)} className="text-xs text-[var(--fg-4)] hover:text-[var(--fg-2)]">ยกเลิก</button>
              )}
            </div>
            {redeemInput > 0 && redeemInput < loyalty.minRedeemPoints && (
              <p className="text-xs text-danger">ต้องแลกขั้นต่ำ {loyalty.minRedeemPoints} แต้ม</p>
            )}
            <button
              onClick={() => setRedeemInput(maxRedeemable)}
              className="text-xs text-warning hover:text-warning"
            >
              แลกทั้งหมด ({maxRedeemable.toLocaleString()} แต้ม = ลด ฿{Math.floor(maxRedeemable / loyalty.redeemRate).toLocaleString()})
            </button>
          </div>
        ) : (
          reservedPoints > 0 && customerPoints !== null && loyalty.enabled && (
            <div className="mb-4 p-3 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl flex items-center justify-between text-xs text-[var(--fg-3)]">
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 text-warning" />
                <span>แต้มสมาชิก (ใช้ได้ {customerPoints.toLocaleString()} แต้ม)</span>
              </div>
              <span className="text-[var(--fg-4)]">จองไว้กับของแถม {reservedPoints.toLocaleString()} แต้ม</span>
            </div>
          )
        )}

        <div className="text-center py-6 bg-[var(--bg)] rounded-xl mb-6">
          {redeemDiscount > 0 && (
            <p className="text-sm text-[var(--fg-4)] line-through mb-1">฿{total.toLocaleString()}</p>
          )}
          <p className="text-[var(--fg-3)] mb-2">ยอดที่ต้องชำระ</p>
          <p className="text-4xl font-bold text-success">฿{finalTotal.toLocaleString()}</p>
          {redeemDiscount > 0 && (
            <p className="text-xs text-warning mt-1">ลดด้วยแต้ม ฿{redeemDiscount.toLocaleString()}</p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <button onClick={() => handlePay('CASH')} className="p-4 bg-[var(--bg)] rounded-xl border border-[var(--border)] hover:border-phopy-indigo/50 flex flex-col items-center gap-2">
            <Banknote className="w-8 h-8 text-success" />
            <span className="text-sm text-[var(--fg-2)]">เงินสด</span>
          </button>
          <button onClick={() => handlePay('QR_CODE')} className="p-4 bg-[var(--bg)] rounded-xl border border-[var(--border)] hover:border-phopy-indigo/50 flex flex-col items-center gap-2">
            <QrCode className="w-8 h-8 text-[var(--primary)]" />
            <span className="text-sm text-[var(--fg-2)]">QR Code</span>
          </button>
          <button onClick={() => handlePay('CREDIT_CARD')} className="p-4 bg-[var(--bg)] rounded-xl border border-[var(--border)] hover:border-phopy-indigo/50 flex flex-col items-center gap-2">
            <CreditCard className="w-8 h-8 text-purple-400" />
            <span className="text-sm text-[var(--fg-2)]">บัตรเครดิต</span>
          </button>
        </div>
        </>
        )}
      </motion.div>
    </div>
  )
}

// เปิดกะ / ปิดกะ จากหน้า POS โดยตรง (คู่ขนานกับหน้า ขาย > POS ที่มีอยู่แล้ว)
function ShiftModal({ mode, shift, blocking = false, hasOpenBills = false, onManageBills, onClose: requestClose, onDone }: {
  mode: 'open' | 'close'
  shift: POSShift | null
  blocking?: boolean // true = ห้ามปิด (ESC/คลิกพื้นหลัง/ยกเลิก) จนกว่าจะเปิด/ปิดกะสำเร็จ
  hasOpenBills?: boolean
  onManageBills?: () => void // กะค้าง: ออกไปชำระ/ยกเลิกบิลค้างก่อน แล้วค่อยกลับมาปิดกะ
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useTranslation()
  const onClose = blocking ? () => {} : requestClose
  useModalClose(onClose)
  const [openingCash, setOpeningCash] = useState('0')
  const [lastClosedShift, setLastClosedShift] = useState<{ shift_number: string; closing_cash_counted: number } | null>(null)
  const [openBillsError, setOpenBillsError] = useState<{ message: string; bills: string[] } | null>(null)
  const [expenses, setExpenses] = useState<Array<{ id: string; reason: string; amount: string }>>([])
  const live = shift?.live
  const cashRevenue = live?.cash_revenue || 0
  const cashIn = live?.cash_in || 0
  const paidOut = live?.paid_out || 0
  const expectedCash = expectedShiftCash(shift)
  // ช่องนับเริ่มว่าง — เดิมเติมยอดควรมีไว้ให้ กดยืนยันได้โดยไม่ต้องนับเงินเลย เงินขาดจึงไม่เคยถูกจับ
  const [closingCash, setClosingCash] = useState('')
  const [notes, setNotes] = useState('')
  const [gapReason, setGapReason] = useState('')
  const [saving, setSaving] = useState(false)

  // ดึงเงินคงเหลือจากกะก่อนหน้าตอนเปิดกะ
  useEffect(() => {
    if (mode === 'open') {
      posService.getLastClosedShift().then((res: any) => {
        if (res.success && res.data) {
          setLastClosedShift(res.data)
          if (res.suggested_opening_cash !== undefined && res.suggested_opening_cash > 0) {
            setOpeningCash(res.suggested_opening_cash.toString())
          }
        }
      }).catch(() => {})
    }
  }, [mode])

  const totalNewExpenses = expenses.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0)
  const adjustedExpectedCash = Math.round((expectedCash - totalNewExpenses) * 100) / 100
  const diff = (parseFloat(closingCash) || 0) - adjustedExpectedCash

  // เงินเปิดกะน้อยกว่าที่นับได้ตอนปิดกะก่อน = มีคนเอาเงินออกจากลิ้นชักไปแล้ว
  const openingGap = lastClosedShift?.closing_cash_counted != null && openingCash.trim() !== ''
    ? Math.round(((lastClosedShift.closing_cash_counted || 0) - (parseFloat(openingCash) || 0)) * 100) / 100
    : 0

  const handleOpen = async () => {
    setSaving(true)
    try {
      const res = await posService.openShift(parseFloat(openingCash) || 0, notes || undefined, openingGap > 0 ? gapReason.trim() || undefined : undefined)
      if (res.success) {
        toast.success(`เปิดกะสำเร็จ: ${res.data.shift_number}`)
        onDone(); onClose()
      }
    } catch (e: any) { toast.error(e.response?.data?.message || 'เปิดกะไม่สำเร็จ') }
    finally { setSaving(false) }
  }

  const handleClose = async () => {
    if (!shift) return
    if (closingCash.trim() === '') { toast.error('นับเงินสดในลิ้นชักแล้วกรอกยอดก่อนปิดกะ'); return }
    setSaving(true)
    try {
      const validExpenses = expenses
        .filter(e => (parseFloat(e.amount) || 0) > 0 && e.reason.trim())
        .map(e => ({ reason: e.reason.trim(), amount: parseFloat(e.amount) || 0 }))

      const res = await posService.closeShift(
        shift.id,
        parseFloat(closingCash) || 0,
        notes || undefined,
        validExpenses.length > 0 ? validExpenses : undefined
      )
      if (res.success) {
        toast.success('ปิดกะสำเร็จ')
        onDone(); onClose()
      }
    } catch (e: any) {
      const message = e.response?.data?.message || 'ปิดกะไม่สำเร็จ'
      // ยังมีบิลค้างชำระ → ค้างโมดัลไว้ พร้อมบอกเลขบิลที่ต้องจัดการก่อน
      if (shiftErrorCode(e) === 'SHIFT_HAS_OPEN_BILLS') setOpenBillsError({ message, bills: openBillNumbers(e) })
      toast.error(message)
    }
    finally { setSaving(false) }
  }

  return (
    <div className={`fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm flex items-center justify-center p-4 ${blocking ? 'z-[60]' : 'z-50'}`} onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-sm p-6 max-h-[85vh] overflow-y-auto">
        <h2 className="text-xl font-bold text-[var(--fg-1)] mb-4">{mode === 'open' ? 'เปิดกะ' : `ปิดกะ — ${shift?.shift_number}`}</h2>
        {blocking && (
          <div className="p-3 mb-4 rounded-lg bg-[var(--warning-soft)] border border-warning/30 text-sm text-warning flex gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">{t(mode === 'open' ? 'sales.pos.shiftRequiredTitle' : 'sales.pos.staleShiftTitle')}</p>
              <p className="text-xs mt-0.5">{mode === 'open'
                ? t('sales.pos.shiftRequiredHint')
                : t('sales.pos.staleShiftHint', { number: shift?.shift_number || '', date: shift?.opened_at ? new Date(shift.opened_at).toLocaleString('th-TH') : '' })}</p>
            </div>
          </div>
        )}
        {openBillsError && (
          <div className="p-3 mb-4 rounded-lg bg-[var(--danger-soft)] border border-danger/30 text-sm text-danger">
            <p className="font-semibold">{openBillsError.message}</p>
            {openBillsError.bills.length > 0 && <p className="text-xs mt-1">{t('sales.pos.openBillsList', { bills: openBillsError.bills.join(', ') })}</p>}
          </div>
        )}
        {onManageBills && (openBillsError || hasOpenBills) && (
          <button onClick={onManageBills}
            className="w-full mb-4 py-2.5 rounded-lg bg-[var(--warning-soft)] border border-warning/30 text-warning text-sm font-semibold hover:opacity-80">
            {t('sales.pos.manageOpenBills')}
          </button>
        )}

        {mode === 'open' ? (
          <>
            <label className="block text-sm text-[var(--fg-3)] mb-1.5">เงินสดในลิ้นชัก (ยอดเริ่มต้น / เงินยกมา)</label>
            <div className="relative mb-2">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-3)] text-sm">฿</span>
              <input type="number" value={openingCash} onChange={e => setOpeningCash(e.target.value)} onFocus={e => e.target.select()}
                className="w-full pl-8 pr-3 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] text-xl font-bold focus:outline-none focus:border-phopy-indigo" />
            </div>
            {lastClosedShift && (lastClosedShift.closing_cash_counted ?? 0) > 0 && (
              <div className="mb-4 text-xs text-[var(--fg-3)] bg-[var(--bg)] p-2.5 rounded-lg border border-[var(--border)] flex items-center justify-between">
                <span>เงินคงเหลือจากกะก่อน ({lastClosedShift.shift_number}):</span>
                <span className="font-semibold text-success">฿{(lastClosedShift.closing_cash_counted || 0).toLocaleString()}</span>
              </div>
            )}
            {openingGap > 0 && (
              <div className="mb-4 p-3 rounded-lg bg-[var(--warning-soft)] border border-warning/30">
                <p className="text-sm font-semibold text-warning mb-1">เงินน้อยกว่ายอดปิดกะก่อน ฿{openingGap.toLocaleString()}</p>
                <p className="text-xs text-[var(--fg-3)] mb-2">ถ้าเอาเงินไปซื้อของ ให้ใส่หมายเหตุไว้ ระบบจะเก็บเป็น "เงินจาก POS" รอจับคู่กับบิลในหน้าจ่ายเงินซื้อ</p>
                <input type="text" value={gapReason} onChange={e => setGapReason(e.target.value)}
                  placeholder="เช่น พนักงานเอาไปซื้อน้ำแข็ง/ของสด"
                  className="w-full px-3 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo" />
              </div>
            )}
          </>
        ) : (
          <>
            <div className="p-3 bg-[var(--bg)] rounded-lg space-y-1 text-sm mb-4">
              <div className="flex justify-between text-[var(--fg-3)]"><span>เงินทอนเริ่มต้น</span><span>{(shift?.opening_cash || 0).toLocaleString()}</span></div>
              <div className="flex justify-between text-[var(--fg-3)]"><span>ยอดขายเงินสด</span><span>{cashRevenue.toLocaleString()}</span></div>
              {cashIn > 0 && <div className="flex justify-between text-success"><span>+ เงินเข้า</span><span>{cashIn.toLocaleString()}</span></div>}
              {paidOut > 0 && <div className="flex justify-between text-danger"><span>− เงินออกระหว่างกะ</span><span>{paidOut.toLocaleString()}</span></div>}
              {totalNewExpenses > 0 && (
                <div className="flex justify-between text-danger font-medium">
                  <span>− รายการใช้เงินก่อนปิดเก๊ะ ({expenses.filter(e => (parseFloat(e.amount) || 0) > 0).length} รายการ)</span>
                  <span>−{totalNewExpenses.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold text-[var(--fg-1)] border-t border-[var(--border)] pt-1.5 mt-1.5">
                <span>ยอดที่ควรมี</span><span>{adjustedExpectedCash.toLocaleString()}</span>
              </div>
            </div>

            {/* รายการใช้เงินสด / นำเงินออกจากเก๊ะ */}
            <div className="mb-4 border border-[var(--border)] rounded-xl p-3 bg-[var(--bg)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[var(--fg-2)] flex items-center gap-1.5">
                  <Receipt className="w-3.5 h-3.5 text-warning" />
                  รายการนำเงินไปใช้จ่าย ({expenses.length})
                </span>
                <button
                  type="button"
                  onClick={() => setExpenses(prev => [...prev, { id: Date.now().toString(), reason: '', amount: '' }])}
                  className="px-2.5 py-1 text-xs font-medium rounded-md bg-phopy-indigo/10 text-phopy-indigo hover:bg-phopy-indigo/20 flex items-center gap-1 border border-phopy-indigo/30 transition-colors"
                >
                  <Plus className="w-3 h-3" /> เพิ่มรายการใช้เงิน
                </button>
              </div>

              {diff < -0.01 && expenses.length === 0 && (
                <div className="mb-2 p-2 rounded-lg bg-danger/10 border border-danger/20 text-xs text-danger flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>เงินสดขาดไป {Math.abs(diff).toLocaleString()} บ. หากนำเงินไปซื้อของหรือมีค่าใช้จ่าย กรุณากด <strong>"+ เพิ่มรายการใช้เงิน"</strong> ด้านบน</span>
                </div>
              )}

              {expenses.length === 0 ? (
                <p className="text-xs text-[var(--fg-4)] py-1 italic text-center">ยังไม่มีรายการใช้เงิน (กดปุ่มด้านบนเพื่อเพิ่ม)</p>
              ) : (
                <div className="space-y-2 mt-2 max-h-48 overflow-y-auto pr-1">
                  {expenses.map((exp, idx) => (
                    <div key={exp.id} className="flex items-center gap-2 bg-[var(--surface)] p-2 rounded-lg border border-[var(--border)]">
                      <span className="text-xs text-[var(--fg-4)] w-4 text-center">{idx + 1}.</span>
                      <input
                        type="text"
                        placeholder="เอาเงินไปใช้อะไร (เช่น ซื้อน้ำแข็ง)"
                        value={exp.reason}
                        onChange={e => {
                          const val = e.target.value
                          setExpenses(prev => prev.map(item => item.id === exp.id ? { ...item, reason: val } : item))
                        }}
                        className="flex-1 min-w-0 px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-xs text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo"
                      />
                      <div className="relative w-24 shrink-0">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-[var(--fg-4)]">฿</span>
                        <input
                          type="number"
                          placeholder="0"
                          value={exp.amount}
                          onChange={e => {
                            const val = e.target.value
                            setExpenses(prev => prev.map(item => item.id === exp.id ? { ...item, amount: val } : item))
                          }}
                          className="w-full pl-5 pr-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-xs font-semibold text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo text-right"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setExpenses(prev => prev.filter(item => item.id !== exp.id))}
                        className="p-1 text-danger hover:bg-danger/10 rounded transition-colors"
                        title="ลบรายการ"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  {totalNewExpenses > 0 && (
                    <div className="flex justify-between items-center text-xs font-medium text-[var(--fg-2)] pt-1 px-1">
                      <span>รวมรายการใช้เงินทั้งหมด:</span>
                      <span className="text-danger font-bold">−฿{totalNewExpenses.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <label className="block text-sm text-[var(--fg-3)] mb-1.5">นับเงินสดจริงในลิ้นชัก</label>
            <div className="relative mb-3">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-3)] text-sm">฿</span>
              <input type="number" inputMode="decimal" min={0} value={closingCash} onChange={e => setClosingCash(e.target.value)} onFocus={e => e.target.select()}
                placeholder="นับแล้วกรอกยอด" aria-label="นับเงินสดจริงในลิ้นชัก" required
                className="w-full pl-8 pr-3 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] text-xl font-bold focus:outline-none focus:border-phopy-indigo" />
            </div>
            {closingCash.trim() !== '' && <div className={`flex justify-between items-center p-3 rounded-lg text-sm font-medium mb-4 ${
              Math.abs(diff) < 0.01 ? 'bg-success/10 border border-success/30 text-success'
              : diff > 0 ? 'bg-[var(--warning-soft)] border border-warning/30 text-warning'
              : 'bg-[var(--danger-soft)] border border-danger/30 text-danger'
            }`}>
              <span>ผลต่าง</span>
              <span>{diff >= 0 ? '+' : ''}{diff.toLocaleString()} {Math.abs(diff) < 0.01 ? '(ตรง)' : diff > 0 ? '(เกิน)' : '(ขาด)'}</span>
            </div>}
          </>
        )}

        <label className="block text-sm text-[var(--fg-3)] mb-1.5">หมายเหตุ (optional)</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
          className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo resize-none mb-4" />

        <div className="flex gap-3">
          {!blocking && <button onClick={onClose} className="px-4 py-2 text-[var(--fg-3)] hover:text-[var(--fg-1)] text-sm">ยกเลิก</button>}
          <button onClick={mode === 'open' ? handleOpen : handleClose} disabled={saving || (mode === 'close' && closingCash.trim() === '')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 font-semibold rounded-lg disabled:opacity-50 text-white ${mode === 'open' ? 'bg-phopy-indigo hover:bg-phopy-indigo/80' : 'bg-red-500/80 hover:bg-red-500'}`}>
            {saving ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
            {mode === 'open' ? 'เริ่มกะ' : 'ยืนยันปิดกะ'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// เงินเข้า/ออกลิ้นชักระหว่างกะ (petty cash) — บันทึกทันทีและลงบัญชีทันที (backend)
function CashMovementModal({ shift, onClose, onDone }: {
  shift: POSShift
  onClose: () => void
  onDone: () => void
}) {
  useModalClose(onClose)
  const [type, setType] = useState<'PAID_OUT' | 'CASH_IN'>('PAID_OUT')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [accounts, setAccounts] = useState<Array<{ id: string; code: string; name: string }>>([])
  const [accountId, setAccountId] = useState('')
  const [movements, setMovements] = useState<CashMovement[]>([])
  const [saving, setSaving] = useState(false)

  const loadMovements = () => {
    posService.getShiftCashMovements(shift.id).then((res: any) => { if (res.success) setMovements(res.data) }).catch(() => {})
  }

  useEffect(() => {
    accountsApi.getAll({ active: true }).then(({ data }: any) => { if (data.success) setAccounts((data.data?.list ?? []).filter((a: any) => a.level >= 2)) }).catch(() => {})
    loadMovements()
  }, [])

  const handleSubmit = async () => {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) { toast.error('กรุณาระบุจำนวนเงินให้ถูกต้อง'); return }
    if (!accountId) { toast.error('กรุณาเลือกบัญชี'); return }
    if (!reason.trim()) { toast.error('กรุณาระบุเหตุผล'); return }
    setSaving(true)
    try {
      const res = await posService.addShiftCashMovement(shift.id, { type, amount: amt, reason: reason || undefined, account_id: accountId })
      if (res.success) {
        toast.success('บันทึกเงินเข้า/ออกลิ้นชักสำเร็จ')
        setAmount(''); setReason('')
        loadMovements()
        onDone()
      }
    } catch (e: any) { toast.error(e.response?.data?.message || 'บันทึกไม่สำเร็จ') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-md p-6 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-[var(--fg-1)]">เงินเข้า/ออกลิ้นชัก</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg)] text-[var(--fg-3)] hover:text-[var(--fg-1)]"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex bg-[var(--bg)] rounded-lg p-1 mb-4">
          <button onClick={() => setType('PAID_OUT')}
            className={`flex-1 py-2 rounded-md text-sm font-medium ${type === 'PAID_OUT' ? 'bg-danger/15 text-danger' : 'text-[var(--fg-3)]'}`}>
            เงินออก (จ่าย)
          </button>
          <button onClick={() => setType('CASH_IN')}
            className={`flex-1 py-2 rounded-md text-sm font-medium ${type === 'CASH_IN' ? 'bg-success/15 text-success' : 'text-[var(--fg-3)]'}`}>
            เงินเข้า
          </button>
        </div>

        <label className="block text-sm text-[var(--fg-3)] mb-1.5">จำนวนเงิน</label>
        <div className="relative mb-3">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-3)] text-sm">฿</span>
          <input type="number" value={amount} onChange={e => setAmount(e.target.value)} onFocus={e => e.target.select()}
            className="w-full pl-8 pr-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] text-lg font-bold focus:outline-none focus:border-phopy-indigo" />
        </div>

        <label className="block text-sm text-[var(--fg-3)] mb-1.5">บัญชี</label>
        <select value={accountId} onChange={e => setAccountId(e.target.value)}
          className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo mb-3">
          <option value="">เลือกบัญชี</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
        </select>

        <label className="block text-sm text-[var(--fg-3)] mb-1.5">เหตุผล</label>
        <input type="text" required aria-required="true" value={reason} onChange={e => setReason(e.target.value)} placeholder="เช่น ซื้อวัตถุดิบเพิ่ม, เงินทอนไม่พอ"
          className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo mb-4" />

        <button onClick={handleSubmit} disabled={saving}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-phopy-indigo text-white font-semibold rounded-lg hover:bg-phopy-indigo/80 disabled:opacity-50 mb-5">
          {saving ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
          บันทึกรายการ
        </button>

        <p className="text-xs font-medium text-[var(--fg-3)] mb-2">รายการเงินเข้า/ออกในกะนี้</p>
        {movements.length === 0 ? (
          <p className="text-xs text-[var(--fg-4)]">ยังไม่มีรายการเงินเข้า/ออกในกะนี้</p>
        ) : (
          <div className="space-y-1.5">
            {movements.map(m => (
              <div key={m.id} className="flex justify-between items-center text-xs bg-[var(--bg)] rounded-lg px-3 py-2">
                <span className={m.type === 'CASH_IN' ? 'text-success' : 'text-danger'}>
                  {m.type === 'CASH_IN' ? '+' : '−'} {m.reason || (m.type === 'CASH_IN' ? 'เงินเข้า' : 'เงินออก')}
                  {m.account_name && <span className="text-[var(--fg-4)]"> ({m.account_name})</span>}
                </span>
                <span className="text-[var(--fg-2)] font-medium">{m.amount.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  )
}
