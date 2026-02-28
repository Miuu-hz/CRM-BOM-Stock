import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShoppingCart,
  FileText,
  Package,
  Receipt,
  CreditCard,
  RotateCcw,
  Plus,
  Search,
  Filter,
  CheckCircle,
  Clock,
  AlertCircle,
  DollarSign,
  TrendingUp,
  Truck,
  Eye,
  Edit,
  X,
  Check,
  Trash2,
  ChevronDown,
  Calendar
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'
import toast from 'react-hot-toast'

// Types
interface Supplier {
  id: string
  code: string
  name: string
}

interface Material {
  id: string
  code: string
  name: string
  unit: string
}

interface PurchaseSummary {
  purchaseRequests: { total: number; draft: number; pending: number; approved: number; totalAmount: number }
  purchaseOrders: { total: number; draft: number; pending: number; received: number; partial: number; totalAmount: number }
  goodsReceipts: { confirmed: number }
  invoices: { total: number; unpaid: number; partial: number; paid: number; totalInvoiced: number; outstanding: number }
  payments: { total: number; totalPaid: number; totalWHT: number }
  returns: { total: number; totalAmount: number }
}

interface PurchaseRequest {
  id: string
  pr_number: string
  requester_name: string
  department: string
  request_date: string
  required_date: string
  total_amount: number
  status: string
  priority: string
  notes: string
  item_count?: number
  items?: any[]
}

interface PurchaseOrder {
  id: string
  po_number: string
  supplier_id: string
  supplier_name: string
  supplier_code: string
  order_date: string
  expected_date: string
  received_date: string
  subtotal: number
  tax_rate: number
  tax_amount: number
  total_amount: number
  status: string
  notes: string
  item_count?: number
  items?: any[]
}

interface GoodsReceipt {
  id: string
  gr_number: string
  purchase_order_id: string
  po_number: string
  supplier_id: string
  supplier_name: string
  receipt_date: string
  received_by: string
  status: string
  notes: string
  item_count?: number
  items?: any[]
  journal_entry_id?: string
  journal_entry_number?: string
}

interface PurchaseInvoice {
  id: string
  pi_number: string
  supplier_invoice_number: string
  purchase_order_id: string
  po_number: string
  supplier_id: string
  supplier_name: string
  supplier_code: string
  invoice_date: string
  due_date: string
  subtotal: number
  tax_rate: number
  tax_amount: number
  total_amount: number
  paid_amount: number
  balance_amount: number
  status: string
  payment_status: string
  notes: string
  journal_entry_id?: string
  journal_entry_number?: string
}

interface SupplierPayment {
  id: string
  payment_number: string
  supplier_id: string
  supplier_name: string
  purchase_invoice_id: string
  pi_number: string
  payment_date: string
  payment_method: string
  payment_reference: string
  amount: number
  withholding_tax: number
  net_amount: number
  notes: string
  journal_entry_id?: string
  journal_entry_number?: string
}

interface PurchaseReturn {
  id: string
  pr_number: string
  purchase_order_id: string
  po_number: string
  goods_receipt_id: string
  supplier_id: string
  supplier_name: string
  supplier_code: string
  return_date: string
  reason: string
  subtotal: number
  tax_rate: number
  tax_amount: number
  total_amount: number
  status: string
  notes: string
}

// Form item types
interface RequestItem {
  id?: string
  material_id: string
  description: string
  quantity: number
  unit: string
  estimated_unit_price: number
  estimated_total_price: number
  notes: string
}

interface OrderItem {
  id?: string
  material_id: string
  description: string
  quantity: number
  unit_price: number
  total_price: number
  received_qty?: number
  notes: string
}

interface ReceiptItem {
  id?: string
  purchase_order_item_id: string
  material_id: string
  ordered_qty: number
  received_qty: number
  accepted_qty: number
  rejected_qty: number
  notes: string
}

interface ReturnItem {
  id?: string
  material_id: string
  quantity: number
  unit_price: number
  total_price: number
  reason: string
}

const Purchase = () => {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<'overview' | 'requests' | 'orders' | 'receipts' | 'invoices' | 'payments' | 'returns'>('overview')
  const [summary, setSummary] = useState<PurchaseSummary | null>(null)
  const [requests, setRequests] = useState<PurchaseRequest[]>([])
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [receipts, setReceipts] = useState<GoodsReceipt[]>([])
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([])
  const [payments, setPayments] = useState<SupplierPayment[]>([])
  const [returns, setReturns] = useState<PurchaseReturn[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  // Modal states
  const [modalOpen, setModalOpen] = useState<string | null>(null)
  const [modalMode, setModalMode] = useState<'create' | 'edit' | 'view'>('create')
  const [modalData, setModalData] = useState<any>(null)
  const [formLoading, setFormLoading] = useState(false)

  // Form states
  const [requestForm, setRequestForm] = useState({
    department: '',
    required_date: '',
    priority: 'NORMAL',
    notes: '',
    items: [{ material_id: '', description: '', quantity: 1, unit: '', estimated_unit_price: 0, estimated_total_price: 0, notes: '' }] as RequestItem[]
  })

  const [orderForm, setOrderForm] = useState({
    supplier_id: '',
    expected_date: '',
    tax_rate: 7,
    notes: '',
    items: [{ material_id: '', description: '', quantity: 1, unit_price: 0, total_price: 0, notes: '' }] as OrderItem[]
  })

  const [receiptForm, setReceiptForm] = useState({
    purchase_order_id: '',
    receipt_date: new Date().toISOString().split('T')[0],
    received_by: user?.email || '',
    notes: '',
    items: [] as ReceiptItem[]
  })

  const [invoiceForm, setInvoiceForm] = useState({
    purchase_order_id: '',
    supplier_invoice_number: '',
    invoice_date: new Date().toISOString().split('T')[0],
    due_date: '',
    tax_rate: 7,
    notes: ''
  })

  const [paymentForm, setPaymentForm] = useState({
    supplier_id: '',
    purchase_invoice_id: '',
    payment_date: new Date().toISOString().split('T')[0],
    payment_method: 'TRANSFER',
    payment_reference: '',
    amount: 0,
    withholding_tax: 0,
    notes: ''
  })

  const [returnForm, setReturnForm] = useState({
    purchase_order_id: '',
    goods_receipt_id: '',
    reason: '',
    tax_rate: 7,
    notes: '',
    items: [{ material_id: '', quantity: 1, unit_price: 0, total_price: 0, reason: '' }] as ReturnItem[]
  })

  // Fetch data
  useEffect(() => {
    fetchSuppliers()
    fetchMaterials()
    if (activeTab === 'overview') fetchSummary()
    else if (activeTab === 'requests') fetchRequests()
    else if (activeTab === 'orders') fetchOrders()
    else if (activeTab === 'receipts') fetchReceipts()
    else if (activeTab === 'invoices') fetchInvoices()
    else if (activeTab === 'payments') fetchPayments()
    else if (activeTab === 'returns') fetchReturns()
  }, [activeTab])

  const handleApiError = (error: any, defaultMsg: string) => {
    console.error('API Error:', error)
    if (error.status === 401) {
      toast.error('Session expired. Please login again.')
    } else {
      toast.error(defaultMsg)
    }
  }

  const fetchSuppliers = async () => {
    try {
      const { data } = await api.get('/suppliers')
      if (data.success) setSuppliers(data.data)
    } catch (error) { console.error('Fetch suppliers error:', error) }
  }

  const fetchMaterials = async () => {
    try {
      const { data } = await api.get('/materials')
      if (data.success) setMaterials(data.data)
    } catch (error) { console.error('Fetch materials error:', error) }
  }

  const fetchSummary = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/purchase/summary')
      if (data.success) setSummary(data.data)
    } catch (error) { console.error('Fetch summary error:', error) }
    finally { setLoading(false) }
  }

  const fetchRequests = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/purchase/requests')
      if (data.success) setRequests(data.data)
    } catch (error: any) { handleApiError(error, 'ไม่สามารถดึงข้อมูลใบขอซื้อได้') }
    finally { setLoading(false) }
  }

  const fetchOrders = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/purchase-orders')
      if (data.success) setOrders(data.data)
    } catch (error: any) { handleApiError(error, 'ไม่สามารถดึงข้อมูลใบสั่งซื้อได้') }
    finally { setLoading(false) }
  }

  const fetchReceipts = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/purchase/goods-receipts')
      if (data.success) setReceipts(data.data)
    } catch (error: any) { handleApiError(error, 'ไม่สามารถดึงข้อมูลใบรับสินค้าได้') }
    finally { setLoading(false) }
  }

  const fetchInvoices = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/purchase/invoices')
      if (data.success) setInvoices(data.data)
    } catch (error: any) { handleApiError(error, 'ไม่สามารถดึงข้อมูลใบแจ้งหนี้ได้') }
    finally { setLoading(false) }
  }

  const fetchPayments = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/purchase/payments')
      if (data.success) setPayments(data.data)
    } catch (error: any) { handleApiError(error, 'ไม่สามารถดึงข้อมูลการจ่ายเงินได้') }
    finally { setLoading(false) }
  }

  const fetchReturns = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/purchase/returns')
      if (data.success) setReturns(data.data)
    } catch (error: any) { handleApiError(error, 'ไม่สามารถดึงข้อมูลการคืนสินค้าได้') }
    finally { setLoading(false) }
  }

  // CRUD Operations
  const handleCreateRequest = async () => {
    setFormLoading(true)
    try {
      const items = requestForm.items.filter(i => i.material_id || i.description).map(item => ({
        ...item,
        estimated_total_price: item.quantity * item.estimated_unit_price
      }))

      const { data } = await api.post('/purchase/requests', { ...requestForm, items })
      if (data.success) {
        toast.success('สร้างใบขอซื้อสำเร็จ')
        closeModal()
        fetchRequests()
      } else {
        toast.error(data.message || 'ไม่สามารถสร้างใบขอซื้อได้')
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'เกิดข้อผิดพลาดในการสร้างใบขอซื้อ')
    } finally {
      setFormLoading(false)
    }
  }

  const handleUpdateRequest = async () => {
    if (!modalData?.id) return
    setFormLoading(true)
    try {
      const res = await fetch(`/api/purchase/requests/${modalData.id}/status`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status: requestForm.status || modalData.status })
      })
      const data = await res.json()
      if (data.success) {
        toast.success('อัปเดตสถานะสำเร็จ')
        closeModal()
        fetchRequests()
      }
    } catch (error) {
      toast.error('เกิดข้อผิดพลาด')
    } finally {
      setFormLoading(false)
    }
  }

  const handleDeleteRequest = async (id: string) => {
    if (!confirm('ต้องการลบใบขอซื้อนี้?')) return
    try {
      await api.delete(`/purchase/requests/${id}`)
      toast.success('ลบใบขอซื้อสำเร็จ')
      fetchRequests()
    } catch (error) {
      toast.error('ไม่สามารถลบใบขอซื้อได้')
    }
  }

  const handleConvertRequestToOrder = async (requestId: string) => {
    if (!confirm('แปลงใบขอซื้อเป็นใบสั่งซื้อ?')) return
    try {
      const supplierId = prompt('กรุณาระบุ Supplier ID:')
      if (!supplierId) return

      const res = await fetch(`/api/purchase/requests/${requestId}/convert-to-po`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ supplierId })
      })
      const data = await res.json()
      if (data.success) {
        toast.success('แปลงเป็นใบสั่งซื้อสำเร็จ')
        fetchRequests()
        fetchOrders()
      }
    } catch (error) {
      toast.error('ไม่สามารถแปลงใบขอซื้อได้')
    }
  }

  const handleCreateOrder = async () => {
    setFormLoading(true)
    try {
      const items = orderForm.items.filter(i => i.material_id || i.description).map(item => ({
        ...item,
        total_price: item.quantity * item.unit_price
      }))
      const subtotal = items.reduce((sum, i) => sum + i.total_price, 0)
      const taxAmount = subtotal * (orderForm.tax_rate / 100)
      const totalAmount = subtotal + taxAmount

      const res = await fetch('/api/purchase-orders', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          ...orderForm,
          items,
          subtotal,
          taxAmount,
          totalAmount
        })
      })
      const data = await res.json()
      if (data.success) {
        toast.success('สร้างใบสั่งซื้อสำเร็จ')
        closeModal()
        fetchOrders()
      } else {
        toast.error(data.message || 'ไม่สามารถสร้างใบสั่งซื้อได้')
      }
    } catch (error) {
      toast.error('เกิดข้อผิดพลาด')
    } finally {
      setFormLoading(false)
    }
  }

  const handleDeleteOrder = async (id: string) => {
    if (!confirm('ต้องการลบใบสั่งซื้อนี้?')) return
    try {
      const res = await fetch(`/api/purchase-orders/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      })
      if (res.ok) {
        toast.success('ลบใบสั่งซื้อสำเร็จ')
        fetchOrders()
      }
    } catch (error) {
      toast.error('ไม่สามารถลบใบสั่งซื้อได้')
    }
  }

  const handleCreateReceipt = async () => {
    setFormLoading(true)
    try {
      const res = await fetch('/api/purchase/goods-receipts', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(receiptForm)
      })
      const data = await res.json()
      if (data.success) {
        toast.success('สร้างใบรับสินค้าสำเร็จ')
        closeModal()
        fetchReceipts()
      } else {
        toast.error(data.message || 'ไม่สามารถสร้างใบรับสินค้าได้')
      }
    } catch (error) {
      toast.error('เกิดข้อผิดพลาด')
    } finally {
      setFormLoading(false)
    }
  }

  const handleConfirmReceipt = async (id: string) => {
    try {
      const res = await fetch(`/api/purchase/goods-receipts/${id}/confirm`, {
        method: 'PUT',
        headers: getAuthHeaders()
      })
      const data = await res.json()
      if (data.success) {
        toast.success('ยืนยันการรับสินค้าสำเร็จ')
        fetchReceipts()
        fetchOrders()
      }
    } catch (error) {
      toast.error('ไม่สามารถยืนยันการรับสินค้าได้')
    }
  }

  const handleCreateInvoice = async () => {
    setFormLoading(true)
    try {
      const res = await fetch('/api/purchase/invoices', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(invoiceForm)
      })
      const data = await res.json()
      if (data.success) {
        toast.success('สร้างใบแจ้งหนี้สำเร็จ')
        closeModal()
        fetchInvoices()
      } else {
        toast.error(data.message || 'ไม่สามารถสร้างใบแจ้งหนี้ได้')
      }
    } catch (error) {
      toast.error('เกิดข้อผิดพลาด')
    } finally {
      setFormLoading(false)
    }
  }

  const handleCreatePayment = async () => {
    setFormLoading(true)
    try {
      const res = await fetch('/api/purchase/payments', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          ...paymentForm,
          net_amount: paymentForm.amount - paymentForm.withholding_tax
        })
      })
      const data = await res.json()
      if (data.success) {
        toast.success('บันทึกการจ่ายเงินสำเร็จ')
        closeModal()
        fetchPayments()
        fetchInvoices()
      } else {
        toast.error(data.message || 'ไม่สามารถบันทึกการจ่ายเงินได้')
      }
    } catch (error) {
      toast.error('เกิดข้อผิดพลาด')
    } finally {
      setFormLoading(false)
    }
  }

  const handleCreateReturn = async () => {
    setFormLoading(true)
    try {
      const items = returnForm.items.filter(i => i.material_id && i.quantity > 0).map(item => ({
        ...item,
        total_price: item.quantity * item.unit_price
      }))
      const subtotal = items.reduce((sum, i) => sum + i.total_price, 0)
      const taxAmount = subtotal * (returnForm.tax_rate / 100)
      const totalAmount = subtotal + taxAmount

      const res = await fetch('/api/purchase/returns', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          ...returnForm,
          items,
          subtotal,
          taxAmount,
          totalAmount
        })
      })
      const data = await res.json()
      if (data.success) {
        toast.success('สร้างใบคืนสินค้าสำเร็จ')
        closeModal()
        fetchReturns()
      } else {
        toast.error(data.message || 'ไม่สามารถสร้างใบคืนสินค้าได้')
      }
    } catch (error) {
      toast.error('เกิดข้อผิดพลาด')
    } finally {
      setFormLoading(false)
    }
  }

  const handleConfirmReturn = async (id: string) => {
    try {
      const res = await fetch(`/api/purchase/returns/${id}/confirm`, {
        method: 'PUT',
        headers: getAuthHeaders()
      })
      const data = await res.json()
      if (data.success) {
        toast.success('ยืนยันการคืนสินค้าสำเร็จ')
        fetchReturns()
      }
    } catch (error) {
      toast.error('ไม่สามารถยืนยันการคืนสินค้าได้')
    }
  }

  // Modal handlers
  const openModal = (type: string, mode: 'create' | 'edit' | 'view', data?: any) => {
    setModalOpen(type)
    setModalMode(mode)
    setModalData(data)

    if (data) {
      if (type === 'request') {
        setRequestForm({
          department: data.department || '',
          required_date: data.required_date?.split('T')[0] || '',
          priority: data.priority || 'NORMAL',
          notes: data.notes || '',
          items: data.items || [{ material_id: '', description: '', quantity: 1, unit: '', estimated_unit_price: 0, estimated_total_price: 0, notes: '' }]
        })
      } else if (type === 'order') {
        setOrderForm({
          supplier_id: data.supplier_id || '',
          expected_date: data.expected_date?.split('T')[0] || '',
          tax_rate: data.tax_rate || 7,
          notes: data.notes || '',
          items: data.items || [{ material_id: '', description: '', quantity: 1, unit_price: 0, total_price: 0, notes: '' }]
        })
      } else if (type === 'receipt') {
        setReceiptForm({
          purchase_order_id: data.purchase_order_id || '',
          receipt_date: data.receipt_date?.split('T')[0] || new Date().toISOString().split('T')[0],
          received_by: data.received_by || user?.email || '',
          notes: data.notes || '',
          items: data.items || []
        })
      } else if (type === 'invoice') {
        setInvoiceForm({
          purchase_order_id: data.purchase_order_id || '',
          supplier_invoice_number: data.supplier_invoice_number || '',
          invoice_date: data.invoice_date?.split('T')[0] || new Date().toISOString().split('T')[0],
          due_date: data.due_date?.split('T')[0] || '',
          tax_rate: data.tax_rate || 7,
          notes: data.notes || ''
        })
      } else if (type === 'payment') {
        setPaymentForm({
          supplier_id: data.supplier_id || '',
          purchase_invoice_id: data.purchase_invoice_id || '',
          payment_date: data.payment_date?.split('T')[0] || new Date().toISOString().split('T')[0],
          payment_method: data.payment_method || 'TRANSFER',
          payment_reference: data.payment_reference || '',
          amount: data.amount || 0,
          withholding_tax: data.withholding_tax || 0,
          notes: data.notes || ''
        })
      } else if (type === 'return') {
        setReturnForm({
          purchase_order_id: data.purchase_order_id || '',
          goods_receipt_id: data.goods_receipt_id || '',
          reason: data.reason || '',
          tax_rate: data.tax_rate || 7,
          notes: data.notes || '',
          items: data.items || [{ material_id: '', quantity: 1, unit_price: 0, total_price: 0, reason: '' }]
        })
      }
    } else {
      // Reset forms for create mode
      setRequestForm({
        department: '',
        required_date: '',
        priority: 'NORMAL',
        notes: '',
        items: [{ material_id: '', description: '', quantity: 1, unit: '', estimated_unit_price: 0, estimated_total_price: 0, notes: '' }]
      })
      setOrderForm({
        supplier_id: '',
        expected_date: '',
        tax_rate: 7,
        notes: '',
        items: [{ material_id: '', description: '', quantity: 1, unit_price: 0, total_price: 0, notes: '' }]
      })
      setReceiptForm({
        purchase_order_id: '',
        receipt_date: new Date().toISOString().split('T')[0],
        received_by: user?.email || '',
        notes: '',
        items: []
      })
      setInvoiceForm({
        purchase_order_id: '',
        supplier_invoice_number: '',
        invoice_date: new Date().toISOString().split('T')[0],
        due_date: '',
        tax_rate: 7,
        notes: ''
      })
      setPaymentForm({
        supplier_id: '',
        purchase_invoice_id: '',
        payment_date: new Date().toISOString().split('T')[0],
        payment_method: 'TRANSFER',
        payment_reference: '',
        amount: 0,
        withholding_tax: 0,
        notes: ''
      })
      setReturnForm({
        purchase_order_id: '',
        goods_receipt_id: '',
        reason: '',
        tax_rate: 7,
        notes: '',
        items: [{ material_id: '', quantity: 1, unit_price: 0, total_price: 0, reason: '' }]
      })
    }
  }

  const closeModal = () => {
    setModalOpen(null)
    setModalMode('create')
    setModalData(null)
  }

  // Form item handlers
  const addRequestItem = () => {
    setRequestForm(prev => ({
      ...prev,
      items: [...prev.items, { material_id: '', description: '', quantity: 1, unit: '', estimated_unit_price: 0, estimated_total_price: 0, notes: '' }]
    }))
  }

  const updateRequestItem = (index: number, field: keyof RequestItem, value: any) => {
    setRequestForm(prev => {
      const items = [...prev.items]
      items[index] = { ...items[index], [field]: value }
      if (field === 'quantity' || field === 'estimated_unit_price') {
        items[index].estimated_total_price = items[index].quantity * items[index].estimated_unit_price
      }
      return { ...prev, items }
    })
  }

  const removeRequestItem = (index: number) => {
    setRequestForm(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index)
    }))
  }

  const addOrderItem = () => {
    setOrderForm(prev => ({
      ...prev,
      items: [...prev.items, { material_id: '', description: '', quantity: 1, unit_price: 0, total_price: 0, notes: '' }]
    }))
  }

  const updateOrderItem = (index: number, field: keyof OrderItem, value: any) => {
    setOrderForm(prev => {
      const items = [...prev.items]
      items[index] = { ...items[index], [field]: value }
      if (field === 'quantity' || field === 'unit_price') {
        items[index].total_price = items[index].quantity * items[index].unit_price
      }
      return { ...prev, items }
    })
  }

  const removeOrderItem = (index: number) => {
    setOrderForm(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index)
    }))
  }

  const addReturnItem = () => {
    setReturnForm(prev => ({
      ...prev,
      items: [...prev.items, { material_id: '', quantity: 1, unit_price: 0, total_price: 0, reason: '' }]
    }))
  }

  const updateReturnItem = (index: number, field: keyof ReturnItem, value: any) => {
    setReturnForm(prev => {
      const items = [...prev.items]
      items[index] = { ...items[index], [field]: value }
      if (field === 'quantity' || field === 'unit_price') {
        items[index].total_price = items[index].quantity * items[index].unit_price
      }
      return { ...prev, items }
    })
  }

  const removeReturnItem = (index: number) => {
    setReturnForm(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index)
    }))
  }

  const loadPendingItems = async (poId: string) => {
    try {
      const { data } = await api.get(`/purchase/goods-receipts/pending-items/${poId}`)
      if (data.success) {
        setReceiptForm(prev => ({
          ...prev,
          purchase_order_id: poId,
          items: data.data.map((item: any) => ({
            purchase_order_item_id: item.id,
            material_id: item.material_id,
            ordered_qty: item.quantity,
            received_qty: 0,
            accepted_qty: 0,
            rejected_qty: 0,
            notes: ''
          }))
        }))
      }
    } catch (error) {
      toast.error('ไม่สามารถโหลดรายการที่ค้างรับได้')
    }
  }

  // Helpers
  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      'DRAFT': 'bg-gray-500',
      'PENDING': 'bg-yellow-500',
      'APPROVED': 'bg-green-500',
      'REJECTED': 'bg-red-500',
      'SUBMITTED': 'bg-blue-500',
      'CONFIRMED': 'bg-cyan-500',
      'RECEIVED': 'bg-green-600',
      'PARTIAL': 'bg-orange-500',
      'CANCELLED': 'bg-red-400',
      'ISSUED': 'bg-blue-500',
      'PAID': 'bg-green-500',
      'UNPAID': 'bg-red-500',
      'OVERDUE': 'bg-red-600',
    }
    return colors[status] || 'bg-gray-500'
  }

  const getStatusText = (status: string) => {
    const texts: Record<string, string> = {
      'DRAFT': 'ฉบับร่าง',
      'PENDING': 'รออนุมัติ',
      'APPROVED': 'อนุมัติแล้ว',
      'REJECTED': 'ปฏิเสธ',
      'SUBMITTED': 'ส่งอนุมัติ',
      'CONFIRMED': 'ยืนยัน',
      'RECEIVED': 'รับครบ',
      'PARTIAL': 'รับบางส่วน',
      'CANCELLED': 'ยกเลิก',
      'ISSUED': 'ออกใบแล้ว',
      'PAID': 'จ่ายแล้ว',
      'UNPAID': 'ค้างจ่าย',
      'OVERDUE': 'เกินกำหนด',
    }
    return texts[status] || status
  }

  const formatCurrency = (amount: number) => {
    return `฿${amount?.toLocaleString('th-TH') || 0}`
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('th-TH')
  }

  // Modal Components
  const RequestModal = () => (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-cyber-card rounded-xl border border-cyber-border w-full max-w-4xl max-h-[90vh] overflow-auto"
      >
        <div className="p-6 border-b border-cyber-border flex justify-between items-center">
          <h2 className="text-xl font-bold text-white">
            {modalMode === 'create' ? 'สร้างใบขอซื้อ' : modalMode === 'edit' ? 'แก้ไขใบขอซื้อ' : 'รายละเอียดใบขอซื้อ'}
          </h2>
          <button onClick={closeModal} className="p-2 hover:bg-cyber-dark rounded-lg">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">แผนก</label>
              <input
                type="text"
                value={requestForm.department}
                onChange={e => setRequestForm(prev => ({ ...prev, department: e.target.value }))}
                disabled={modalMode === 'view'}
                className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">ต้องการวันที่</label>
              <input
                type="date"
                value={requestForm.required_date}
                onChange={e => setRequestForm(prev => ({ ...prev, required_date: e.target.value }))}
                disabled={modalMode === 'view'}
                className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">ความสำคัญ</label>
              <select
                value={requestForm.priority}
                onChange={e => setRequestForm(prev => ({ ...prev, priority: e.target.value }))}
                disabled={modalMode === 'view'}
                className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white disabled:opacity-50"
              >
                <option value="LOW">ต่ำ</option>
                <option value="NORMAL">ปกติ</option>
                <option value="HIGH">สูง</option>
                <option value="URGENT">ด่วน</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">หมายเหตุ</label>
            <textarea
              value={requestForm.notes}
              onChange={e => setRequestForm(prev => ({ ...prev, notes: e.target.value }))}
              disabled={modalMode === 'view'}
              rows={2}
              className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white disabled:opacity-50"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm text-gray-400">รายการ</label>
              {modalMode !== 'view' && (
                <button
                  onClick={addRequestItem}
                  className="text-sm text-cyber-primary hover:underline flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" /> เพิ่มรายการ
                </button>
              )}
            </div>
            <div className="space-y-2">
              {requestForm.items.map((item, index) => (
                <div key={index} className="grid grid-cols-12 gap-2 p-3 bg-cyber-dark rounded-lg">
                  <div className="col-span-3">
                    <select
                      value={item.material_id}
                      onChange={e => updateRequestItem(index, 'material_id', e.target.value)}
                      disabled={modalMode === 'view'}
                      className="w-full px-2 py-1 bg-cyber-card border border-cyber-border rounded text-sm text-white disabled:opacity-50"
                    >
                      <option value="">เลือกวัตถุดิบ</option>
                      {materials.map(m => (
                        <option key={m.id} value={m.id}>{m.code} - {m.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-3">
                    <input
                      type="text"
                      placeholder="รายละเอียด"
                      value={item.description}
                      onChange={e => updateRequestItem(index, 'description', e.target.value)}
                      disabled={modalMode === 'view'}
                      className="w-full px-2 py-1 bg-cyber-card border border-cyber-border rounded text-sm text-white disabled:opacity-50"
                    />
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number"
                      placeholder="จำนวน"
                      value={item.quantity}
                      onChange={e => updateRequestItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                      disabled={modalMode === 'view'}
                      className="w-full px-2 py-1 bg-cyber-card border border-cyber-border rounded text-sm text-white disabled:opacity-50"
                    />
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number"
                      placeholder="ราคาต่อหน่วย"
                      value={item.estimated_unit_price}
                      onChange={e => updateRequestItem(index, 'estimated_unit_price', parseFloat(e.target.value) || 0)}
                      disabled={modalMode === 'view'}
                      className="w-full px-2 py-1 bg-cyber-card border border-cyber-border rounded text-sm text-white disabled:opacity-50"
                    />
                  </div>
                  <div className="col-span-1 flex items-center justify-end">
                    <span className="text-sm text-cyber-primary">{formatCurrency(item.estimated_total_price)}</span>
                  </div>
                  {modalMode !== 'view' && (
                    <div className="col-span-1 flex items-center justify-center">
                      <button
                        onClick={() => removeRequestItem(index)}
                        className="p-1 hover:bg-red-500/20 rounded text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-2">
              <span className="text-lg font-bold text-cyber-primary">
                รวม: {formatCurrency(requestForm.items.reduce((sum, i) => sum + i.estimated_total_price, 0))}
              </span>
            </div>
          </div>
        </div>

        {modalMode !== 'view' && (
          <div className="p-6 border-t border-cyber-border flex justify-end gap-2">
            <button
              onClick={closeModal}
              className="px-4 py-2 border border-cyber-border rounded-lg text-gray-300 hover:bg-cyber-dark"
            >
              ยกเลิก
            </button>
            <button
              onClick={modalMode === 'create' ? handleCreateRequest : handleUpdateRequest}
              disabled={formLoading}
              className="px-4 py-2 bg-cyber-primary text-cyber-dark font-semibold rounded-lg hover:bg-cyber-primary/80 disabled:opacity-50 flex items-center gap-2"
            >
              {formLoading && <div className="w-4 h-4 border-2 border-cyber-dark/30 border-t-cyber-dark rounded-full animate-spin" />}
              {modalMode === 'create' ? 'สร้าง' : 'บันทึก'}
            </button>
          </div>
        )}
      </motion.div>
    </div>
  )

  const OrderModal = () => (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-cyber-card rounded-xl border border-cyber-border w-full max-w-4xl max-h-[90vh] overflow-auto"
      >
        <div className="p-6 border-b border-cyber-border flex justify-between items-center">
          <h2 className="text-xl font-bold text-white">
            {modalMode === 'create' ? 'สร้างใบสั่งซื้อ' : 'รายละเอียดใบสั่งซื้อ'}
          </h2>
          <button onClick={closeModal} className="p-2 hover:bg-cyber-dark rounded-lg">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">ผู้ขาย <span className="text-red-400">*</span></label>
              <select
                value={orderForm.supplier_id}
                onChange={e => setOrderForm(prev => ({ ...prev, supplier_id: e.target.value }))}
                disabled={modalMode === 'view'}
                className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white disabled:opacity-50"
              >
                <option value="">เลือกผู้ขาย</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.code} - {s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">กำหนดส่ง</label>
              <input
                type="date"
                value={orderForm.expected_date}
                onChange={e => setOrderForm(prev => ({ ...prev, expected_date: e.target.value }))}
                disabled={modalMode === 'view'}
                className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">อัตราภาษี (%)</label>
              <input
                type="number"
                value={orderForm.tax_rate}
                onChange={e => setOrderForm(prev => ({ ...prev, tax_rate: parseFloat(e.target.value) || 0 }))}
                disabled={modalMode === 'view'}
                className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">หมายเหตุ</label>
            <textarea
              value={orderForm.notes}
              onChange={e => setOrderForm(prev => ({ ...prev, notes: e.target.value }))}
              disabled={modalMode === 'view'}
              rows={2}
              className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white disabled:opacity-50"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm text-gray-400">รายการ</label>
              {modalMode !== 'view' && (
                <button
                  onClick={addOrderItem}
                  className="text-sm text-cyber-primary hover:underline flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" /> เพิ่มรายการ
                </button>
              )}
            </div>
            <div className="space-y-2">
              {orderForm.items.map((item, index) => (
                <div key={index} className="grid grid-cols-12 gap-2 p-3 bg-cyber-dark rounded-lg">
                  <div className="col-span-3">
                    <select
                      value={item.material_id}
                      onChange={e => updateOrderItem(index, 'material_id', e.target.value)}
                      disabled={modalMode === 'view'}
                      className="w-full px-2 py-1 bg-cyber-card border border-cyber-border rounded text-sm text-white disabled:opacity-50"
                    >
                      <option value="">เลือกวัตถุดิบ</option>
                      {materials.map(m => (
                        <option key={m.id} value={m.id}>{m.code} - {m.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-3">
                    <input
                      type="text"
                      placeholder="รายละเอียด"
                      value={item.description}
                      onChange={e => updateOrderItem(index, 'description', e.target.value)}
                      disabled={modalMode === 'view'}
                      className="w-full px-2 py-1 bg-cyber-card border border-cyber-border rounded text-sm text-white disabled:opacity-50"
                    />
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number"
                      placeholder="จำนวน"
                      value={item.quantity}
                      onChange={e => updateOrderItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                      disabled={modalMode === 'view'}
                      className="w-full px-2 py-1 bg-cyber-card border border-cyber-border rounded text-sm text-white disabled:opacity-50"
                    />
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number"
                      placeholder="ราคาต่อหน่วย"
                      value={item.unit_price}
                      onChange={e => updateOrderItem(index, 'unit_price', parseFloat(e.target.value) || 0)}
                      disabled={modalMode === 'view'}
                      className="w-full px-2 py-1 bg-cyber-card border border-cyber-border rounded text-sm text-white disabled:opacity-50"
                    />
                  </div>
                  <div className="col-span-1 flex items-center justify-end">
                    <span className="text-sm text-cyber-primary">{formatCurrency(item.total_price)}</span>
                  </div>
                  {modalMode !== 'view' && (
                    <div className="col-span-1 flex items-center justify-center">
                      <button
                        onClick={() => removeOrderItem(index)}
                        className="p-1 hover:bg-red-500/20 rounded text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-2 text-sm">
              <span className="text-gray-400">ราคาก่อนภาษี: {formatCurrency(orderForm.items.reduce((sum, i) => sum + i.total_price, 0))}</span>
              <span className="text-cyber-primary font-bold">
                รวม: {formatCurrency(orderForm.items.reduce((sum, i) => sum + i.total_price, 0) * (1 + orderForm.tax_rate / 100))}
              </span>
            </div>
          </div>
        </div>

        {modalMode !== 'view' && (
          <div className="p-6 border-t border-cyber-border flex justify-end gap-2">
            <button
              onClick={closeModal}
              className="px-4 py-2 border border-cyber-border rounded-lg text-gray-300 hover:bg-cyber-dark"
            >
              ยกเลิก
            </button>
            <button
              onClick={handleCreateOrder}
              disabled={formLoading || !orderForm.supplier_id}
              className="px-4 py-2 bg-cyber-primary text-cyber-dark font-semibold rounded-lg hover:bg-cyber-primary/80 disabled:opacity-50 flex items-center gap-2"
            >
              {formLoading && <div className="w-4 h-4 border-2 border-cyber-dark/30 border-t-cyber-dark rounded-full animate-spin" />}
              สร้าง
            </button>
          </div>
        )}
      </motion.div>
    </div>
  )

  const ReceiptModal = () => (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-cyber-card rounded-xl border border-cyber-border w-full max-w-3xl max-h-[90vh] overflow-auto"
      >
        <div className="p-6 border-b border-cyber-border flex justify-between items-center">
          <h2 className="text-xl font-bold text-white">สร้างใบรับสินค้า</h2>
          <button onClick={closeModal} className="p-2 hover:bg-cyber-dark rounded-lg">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">เลือกใบสั่งซื้อ</label>
            <select
              value={receiptForm.purchase_order_id}
              onChange={e => {
                const poId = e.target.value
                setReceiptForm(prev => ({ ...prev, purchase_order_id: poId }))
                if (poId) loadPendingItems(poId)
              }}
              className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white"
            >
              <option value="">เลือก PO</option>
              {orders.filter(o => o.status === 'CONFIRMED' || o.status === 'PARTIAL').map(o => (
                <option key={o.id} value={o.id}>{o.po_number} - {o.supplier_name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">วันที่รับ</label>
              <input
                type="date"
                value={receiptForm.receipt_date}
                onChange={e => setReceiptForm(prev => ({ ...prev, receipt_date: e.target.value }))}
                className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">ผู้รับ</label>
              <input
                type="text"
                value={receiptForm.received_by}
                onChange={e => setReceiptForm(prev => ({ ...prev, received_by: e.target.value }))}
                className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white"
              />
            </div>
          </div>

          {receiptForm.items.length > 0 && (
            <div>
              <label className="block text-sm text-gray-400 mb-2">รายการรับ</label>
              <div className="space-y-2 max-h-60 overflow-auto">
                {receiptForm.items.map((item, index) => (
                  <div key={index} className="p-3 bg-cyber-dark rounded-lg">
                    <div className="flex justify-between mb-2">
                      <span className="text-white text-sm">
                        {materials.find(m => m.id === item.material_id)?.name || 'สินค้า'}
                      </span>
                      <span className="text-gray-400 text-sm">สั่ง: {item.ordered_qty}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-xs text-gray-500">รับ</label>
                        <input
                          type="number"
                          value={item.received_qty}
                          onChange={e => {
                            const val = parseFloat(e.target.value) || 0
                            setReceiptForm(prev => ({
                              ...prev,
                              items: prev.items.map((it, i) => i === index ? { ...it, received_qty: val, accepted_qty: val } : it)
                            }))
                          }}
                          className="w-full px-2 py-1 bg-cyber-card border border-cyber-border rounded text-sm text-white"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">รับเข้า</label>
                        <input
                          type="number"
                          value={item.accepted_qty}
                          onChange={e => setReceiptForm(prev => ({
                            ...prev,
                            items: prev.items.map((it, i) => i === index ? { ...it, accepted_qty: parseFloat(e.target.value) || 0 } : it)
                          }))}
                          className="w-full px-2 py-1 bg-cyber-card border border-cyber-border rounded text-sm text-white"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">เสียหาย</label>
                        <input
                          type="number"
                          value={item.rejected_qty}
                          onChange={e => setReceiptForm(prev => ({
                            ...prev,
                            items: prev.items.map((it, i) => i === index ? { ...it, rejected_qty: parseFloat(e.target.value) || 0 } : it)
                          }))}
                          className="w-full px-2 py-1 bg-cyber-card border border-cyber-border rounded text-sm text-white"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm text-gray-400 mb-1">หมายเหตุ</label>
            <textarea
              value={receiptForm.notes}
              onChange={e => setReceiptForm(prev => ({ ...prev, notes: e.target.value }))}
              rows={2}
              className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white"
            />
          </div>
        </div>

        <div className="p-6 border-t border-cyber-border flex justify-end gap-2">
          <button
            onClick={closeModal}
            className="px-4 py-2 border border-cyber-border rounded-lg text-gray-300 hover:bg-cyber-dark"
          >
            ยกเลิก
          </button>
          <button
            onClick={handleCreateReceipt}
            disabled={formLoading || !receiptForm.purchase_order_id}
            className="px-4 py-2 bg-cyber-primary text-cyber-dark font-semibold rounded-lg hover:bg-cyber-primary/80 disabled:opacity-50 flex items-center gap-2"
          >
            {formLoading && <div className="w-4 h-4 border-2 border-cyber-dark/30 border-t-cyber-dark rounded-full animate-spin" />}
            สร้าง
          </button>
        </div>
      </motion.div>
    </div>
  )

  const InvoiceModal = () => (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-cyber-card rounded-xl border border-cyber-border w-full max-w-lg"
      >
        <div className="p-6 border-b border-cyber-border flex justify-between items-center">
          <h2 className="text-xl font-bold text-white">สร้างใบแจ้งหนี้</h2>
          <button onClick={closeModal} className="p-2 hover:bg-cyber-dark rounded-lg">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">เลือกใบสั่งซื้อ</label>
            <select
              value={invoiceForm.purchase_order_id}
              onChange={e => {
                const poId = e.target.value
                const po = orders.find(o => o.id === poId)
                setInvoiceForm(prev => ({
                  ...prev,
                  purchase_order_id: poId,
                  due_date: po?.expected_date?.split('T')[0] || ''
                }))
              }}
              className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white"
            >
              <option value="">เลือก PO</option>
              {orders.filter(o => o.status === 'RECEIVED' || o.status === 'PARTIAL').map(o => (
                <option key={o.id} value={o.id}>{o.po_number} - {o.supplier_name} ({formatCurrency(o.total_amount)})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">เลขที่ใบแจ้งหนี้ผู้ขาย</label>
            <input
              type="text"
              value={invoiceForm.supplier_invoice_number}
              onChange={e => setInvoiceForm(prev => ({ ...prev, supplier_invoice_number: e.target.value }))}
              placeholder="INV-XXXX"
              className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">วันที่ใบแจ้งหนี้</label>
              <input
                type="date"
                value={invoiceForm.invoice_date}
                onChange={e => setInvoiceForm(prev => ({ ...prev, invoice_date: e.target.value }))}
                className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">วันครบกำหนด</label>
              <input
                type="date"
                value={invoiceForm.due_date}
                onChange={e => setInvoiceForm(prev => ({ ...prev, due_date: e.target.value }))}
                className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">อัตราภาษี (%)</label>
            <input
              type="number"
              value={invoiceForm.tax_rate}
              onChange={e => setInvoiceForm(prev => ({ ...prev, tax_rate: parseFloat(e.target.value) || 0 }))}
              className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">หมายเหตุ</label>
            <textarea
              value={invoiceForm.notes}
              onChange={e => setInvoiceForm(prev => ({ ...prev, notes: e.target.value }))}
              rows={2}
              className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white"
            />
          </div>
        </div>

        <div className="p-6 border-t border-cyber-border flex justify-end gap-2">
          <button
            onClick={closeModal}
            className="px-4 py-2 border border-cyber-border rounded-lg text-gray-300 hover:bg-cyber-dark"
          >
            ยกเลิก
          </button>
          <button
            onClick={handleCreateInvoice}
            disabled={formLoading || !invoiceForm.purchase_order_id}
            className="px-4 py-2 bg-cyber-primary text-cyber-dark font-semibold rounded-lg hover:bg-cyber-primary/80 disabled:opacity-50 flex items-center gap-2"
          >
            {formLoading && <div className="w-4 h-4 border-2 border-cyber-dark/30 border-t-cyber-dark rounded-full animate-spin" />}
            สร้าง
          </button>
        </div>
      </motion.div>
    </div>
  )

  const PaymentModal = () => (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-cyber-card rounded-xl border border-cyber-border w-full max-w-lg"
      >
        <div className="p-6 border-b border-cyber-border flex justify-between items-center">
          <h2 className="text-xl font-bold text-white">บันทึกการจ่ายเงิน</h2>
          <button onClick={closeModal} className="p-2 hover:bg-cyber-dark rounded-lg">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">ผู้ขาย</label>
            <select
              value={paymentForm.supplier_id}
              onChange={e => setPaymentForm(prev => ({ ...prev, supplier_id: e.target.value }))}
              className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white"
            >
              <option value="">เลือกผู้ขาย</option>
              {suppliers.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">ใบแจ้งหนี้</label>
            <select
              value={paymentForm.purchase_invoice_id}
              onChange={e => {
                const invId = e.target.value
                const inv = invoices.find(i => i.id === invId)
                setPaymentForm(prev => ({
                  ...prev,
                  purchase_invoice_id: invId,
                  amount: inv?.balance_amount || 0
                }))
              }}
              className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white"
            >
              <option value="">เลือกใบแจ้งหนี้</option>
              {invoices.filter(i => i.payment_status !== 'PAID').map(i => (
                <option key={i.id} value={i.id}>{i.pi_number} - {formatCurrency(i.balance_amount)}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">วันที่จ่าย</label>
              <input
                type="date"
                value={paymentForm.payment_date}
                onChange={e => setPaymentForm(prev => ({ ...prev, payment_date: e.target.value }))}
                className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">วิธีการจ่าย</label>
              <select
                value={paymentForm.payment_method}
                onChange={e => setPaymentForm(prev => ({ ...prev, payment_method: e.target.value }))}
                className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white"
              >
                <option value="CASH">เงินสด</option>
                <option value="TRANSFER">โอนเงิน</option>
                <option value="CHEQUE">เช็ค</option>
                <option value="CREDIT_CARD">บัตรเครดิต</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">จำนวนเงิน</label>
              <input
                type="number"
                value={paymentForm.amount}
                onChange={e => setPaymentForm(prev => ({ ...prev, amount: parseFloat(e.target.value) || 0 }))}
                className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">หัก ณ ที่จ่าย</label>
              <input
                type="number"
                value={paymentForm.withholding_tax}
                onChange={e => setPaymentForm(prev => ({ ...prev, withholding_tax: parseFloat(e.target.value) || 0 }))}
                className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">เลขที่อ้างอิง</label>
            <input
              type="text"
              value={paymentForm.payment_reference}
              onChange={e => setPaymentForm(prev => ({ ...prev, payment_reference: e.target.value }))}
              placeholder="เลขที่สลิป/เช็ค"
              className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white"
            />
          </div>

          <div className="p-3 bg-cyber-dark rounded-lg">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">จ่ายจริง:</span>
              <span className="text-cyber-primary font-bold">
                {formatCurrency(paymentForm.amount - paymentForm.withholding_tax)}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">หมายเหตุ</label>
            <textarea
              value={paymentForm.notes}
              onChange={e => setPaymentForm(prev => ({ ...prev, notes: e.target.value }))}
              rows={2}
              className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white"
            />
          </div>
        </div>

        <div className="p-6 border-t border-cyber-border flex justify-end gap-2">
          <button
            onClick={closeModal}
            className="px-4 py-2 border border-cyber-border rounded-lg text-gray-300 hover:bg-cyber-dark"
          >
            ยกเลิก
          </button>
          <button
            onClick={handleCreatePayment}
            disabled={formLoading || !paymentForm.supplier_id || !paymentForm.amount}
            className="px-4 py-2 bg-cyber-primary text-cyber-dark font-semibold rounded-lg hover:bg-cyber-primary/80 disabled:opacity-50 flex items-center gap-2"
          >
            {formLoading && <div className="w-4 h-4 border-2 border-cyber-dark/30 border-t-cyber-dark rounded-full animate-spin" />}
            บันทึก
          </button>
        </div>
      </motion.div>
    </div>
  )

  const ReturnModal = () => (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-cyber-card rounded-xl border border-cyber-border w-full max-w-4xl max-h-[90vh] overflow-auto"
      >
        <div className="p-6 border-b border-cyber-border flex justify-between items-center">
          <h2 className="text-xl font-bold text-white">สร้างใบคืนสินค้า</h2>
          <button onClick={closeModal} className="p-2 hover:bg-cyber-dark rounded-lg">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">ใบสั่งซื้อ</label>
              <select
                value={returnForm.purchase_order_id}
                onChange={e => setReturnForm(prev => ({ ...prev, purchase_order_id: e.target.value }))}
                className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white"
              >
                <option value="">เลือก PO</option>
                {orders.filter(o => o.status === 'RECEIVED' || o.status === 'PARTIAL').map(o => (
                  <option key={o.id} value={o.id}>{o.po_number} - {o.supplier_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">ใบรับสินค้า</label>
              <select
                value={returnForm.goods_receipt_id}
                onChange={e => setReturnForm(prev => ({ ...prev, goods_receipt_id: e.target.value }))}
                className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white"
              >
                <option value="">เลือก GR</option>
                {receipts.filter(r => r.status === 'CONFIRMED').map(r => (
                  <option key={r.id} value={r.id}>{r.gr_number}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">เหตุผลการคืน</label>
            <select
              value={returnForm.reason}
              onChange={e => setReturnForm(prev => ({ ...prev, reason: e.target.value }))}
              className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white"
            >
              <option value="">เลือกเหตุผล</option>
              <option value="DEFECTIVE">สินค้าเสียหาย</option>
              <option value="WRONG_ITEM">ส่งผิดรายการ</option>
              <option value="WRONG_QUANTITY">ส่งผิดจำนวน</option>
              <option value="QUALITY_ISSUE">คุณภาพไม่ตรง</option>
              <option value="EXPIRED">หมดอายุ</option>
              <option value="OTHER">อื่นๆ</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">หมายเหตุ</label>
            <textarea
              value={returnForm.notes}
              onChange={e => setReturnForm(prev => ({ ...prev, notes: e.target.value }))}
              rows={2}
              className="w-full px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm text-gray-400">รายการคืน</label>
              <button
                onClick={addReturnItem}
                className="text-sm text-cyber-primary hover:underline flex items-center gap-1"
              >
                <Plus className="w-4 h-4" /> เพิ่มรายการ
              </button>
            </div>
            <div className="space-y-2">
              {returnForm.items.map((item, index) => (
                <div key={index} className="grid grid-cols-12 gap-2 p-3 bg-cyber-dark rounded-lg">
                  <div className="col-span-4">
                    <select
                      value={item.material_id}
                      onChange={e => updateReturnItem(index, 'material_id', e.target.value)}
                      className="w-full px-2 py-1 bg-cyber-card border border-cyber-border rounded text-sm text-white"
                    >
                      <option value="">เลือกวัตถุดิบ</option>
                      {materials.map(m => (
                        <option key={m.id} value={m.id}>{m.code} - {m.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number"
                      placeholder="จำนวน"
                      value={item.quantity}
                      onChange={e => updateReturnItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                      className="w-full px-2 py-1 bg-cyber-card border border-cyber-border rounded text-sm text-white"
                    />
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number"
                      placeholder="ราคา"
                      value={item.unit_price}
                      onChange={e => updateReturnItem(index, 'unit_price', parseFloat(e.target.value) || 0)}
                      className="w-full px-2 py-1 bg-cyber-card border border-cyber-border rounded text-sm text-white"
                    />
                  </div>
                  <div className="col-span-3">
                    <input
                      type="text"
                      placeholder="เหตุผล"
                      value={item.reason}
                      onChange={e => updateReturnItem(index, 'reason', e.target.value)}
                      className="w-full px-2 py-1 bg-cyber-card border border-cyber-border rounded text-sm text-white"
                    />
                  </div>
                  <div className="col-span-1 flex items-center justify-center">
                    <button
                      onClick={() => removeReturnItem(index)}
                      className="p-1 hover:bg-red-500/20 rounded text-red-400"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-2">
              <span className="text-lg font-bold text-red-400">
                รวม: {formatCurrency(returnForm.items.reduce((sum, i) => sum + i.total_price, 0))}
              </span>
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-cyber-border flex justify-end gap-2">
          <button
            onClick={closeModal}
            className="px-4 py-2 border border-cyber-border rounded-lg text-gray-300 hover:bg-cyber-dark"
          >
            ยกเลิก
          </button>
          <button
            onClick={handleCreateReturn}
            disabled={formLoading || !returnForm.reason || returnForm.items.length === 0}
            className="px-4 py-2 bg-red-500 text-white font-semibold rounded-lg hover:bg-red-600 disabled:opacity-50 flex items-center gap-2"
          >
            {formLoading && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            สร้าง
          </button>
        </div>
      </motion.div>
    </div>
  )

  // Main render content... (Overview and other tabs)
  const OverviewContent = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-gradient-to-br from-cyber-primary/20 to-cyber-secondary/20 rounded-xl p-6 border border-cyber-primary/30">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">ยอดสั่งซื้อรวม</p>
              <p className="text-2xl font-bold text-cyber-primary">{formatCurrency(summary?.purchaseOrders.totalAmount || 0)}</p>
            </div>
            <div className="p-3 bg-cyber-primary/20 rounded-lg"><ShoppingCart className="w-6 h-6 text-cyber-primary" /></div>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-gradient-to-br from-cyber-purple/20 to-cyber-magenta/20 rounded-xl p-6 border border-cyber-purple/30">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">ใบสั่งซื้อ</p>
              <p className="text-2xl font-bold text-cyber-purple">{summary?.purchaseOrders.total || 0}</p>
            </div>
            <div className="p-3 bg-cyber-purple/20 rounded-lg"><FileText className="w-6 h-6 text-cyber-purple" /></div>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-gradient-to-br from-cyber-green/20 to-emerald-500/20 rounded-xl p-6 border border-cyber-green/30">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">จ่ายเงินวันนี้</p>
              <p className="text-2xl font-bold text-cyber-green">{formatCurrency(summary?.payments.totalPaid || 0)}</p>
            </div>
            <div className="p-3 bg-cyber-green/20 rounded-lg"><DollarSign className="w-6 h-6 text-cyber-green" /></div>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="bg-gradient-to-br from-orange-500/20 to-red-500/20 rounded-xl p-6 border border-orange-500/30">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">ยอดค้างจ่าย</p>
              <p className="text-2xl font-bold text-orange-400">{formatCurrency(summary?.invoices.outstanding || 0)}</p>
            </div>
            <div className="p-3 bg-orange-500/20 rounded-lg"><AlertCircle className="w-6 h-6 text-orange-400" /></div>
          </div>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="bg-cyber-card rounded-xl border border-cyber-border p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">ใบขอซื้อ</p>
              <p className="text-xl font-bold text-cyber-primary">{summary?.purchaseRequests.total || 0}</p>
              <p className="text-xs text-gray-500">{formatCurrency(summary?.purchaseRequests.totalAmount || 0)}</p>
            </div>
            <div className="p-3 bg-cyber-primary/20 rounded-lg"><FileText className="w-5 h-5 text-cyber-primary" /></div>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="bg-cyber-card rounded-xl border border-cyber-border p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">คืนสินค้า</p>
              <p className="text-xl font-bold text-red-400">{formatCurrency(summary?.returns.totalAmount || 0)}</p>
              <p className="text-xs text-gray-500">{summary?.returns.total || 0} รายการ</p>
            </div>
            <div className="p-3 bg-red-500/20 rounded-lg"><RotateCcw className="w-5 h-5 text-red-400" /></div>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }} className="bg-cyber-card rounded-xl border border-cyber-border p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">หัก ณ ที่จ่าย</p>
              <p className="text-xl font-bold text-yellow-400">{formatCurrency(summary?.payments.totalWHT || 0)}</p>
              <p className="text-xs text-gray-500">รวมทั้งหมด</p>
            </div>
            <div className="p-3 bg-yellow-500/20 rounded-lg"><Receipt className="w-5 h-5 text-yellow-400" /></div>
          </div>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="bg-cyber-card rounded-xl border border-cyber-border p-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5 text-cyber-primary" />
            สถานะใบสั่งซื้อ
          </h3>
          <div className="space-y-3">
            {[
              { label: 'ฉบับร่าง', value: summary?.purchaseOrders.draft || 0, color: 'text-gray-400' },
              { label: 'รอดำเนินการ', value: summary?.purchaseOrders.pending || 0, color: 'text-yellow-400' },
              { label: 'รับบางส่วน', value: summary?.purchaseOrders.partial || 0, color: 'text-orange-400' },
              { label: 'รับครบแล้ว', value: summary?.purchaseOrders.received || 0, color: 'text-green-400' },
            ].map((item) => (
              <div key={item.label} className="flex justify-between items-center p-3 bg-cyber-dark rounded-lg">
                <span className="text-gray-400">{item.label}</span>
                <span className={`text-xl font-semibold ${item.color}`}>{item.value}</span>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-cyber-card rounded-xl border border-cyber-border p-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-cyber-green" />
            สถานะการจ่ายเงิน
          </h3>
          <div className="space-y-3">
            {[
              { label: 'ค้างจ่าย', value: summary?.invoices.unpaid || 0, color: 'text-red-400' },
              { label: 'จ่ายบางส่วน', value: summary?.invoices.partial || 0, color: 'text-yellow-400' },
              { label: 'จ่ายครบแล้ว', value: summary?.invoices.paid || 0, color: 'text-green-400' },
            ].map((item) => (
              <div key={item.label} className="flex justify-between items-center p-3 bg-cyber-dark rounded-lg">
                <span className="text-gray-400">{item.label}</span>
                <span className={`text-xl font-semibold ${item.color}`}>{item.value}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  )

  const DataTable = ({ columns, data, renderRow }: { columns: any[], data: any[], renderRow: (item: any) => React.ReactNode }) => (
    <div className="bg-cyber-card rounded-xl border border-cyber-border overflow-hidden">
      <table className="w-full">
        <thead className="bg-cyber-dark border-b border-cyber-border">
          <tr>{columns.map((col) => <th key={col.key} className={`px-6 py-4 text-sm font-medium text-gray-400 ${col.align || 'text-left'}`}>{col.label}</th>)}</tr>
        </thead>
        <tbody>{data.map((item, idx) => renderRow(item))}</tbody>
      </table>
    </div>
  )

  const RequestsContent = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex gap-4 items-center">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="ค้นหาใบขอซื้อ..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-cyber-primary w-64" />
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-gray-300 hover:border-cyber-primary transition-colors">
            <Filter className="w-4 h-4" />กรอง
          </button>
        </div>
        <button onClick={() => openModal('request', 'create')} className="flex items-center gap-2 px-4 py-2 bg-cyber-primary text-cyber-dark font-semibold rounded-lg hover:bg-cyber-primary/80 transition-colors">
          <Plus className="w-4 h-4" />สร้างใบขอซื้อ
        </button>
      </div>

      <DataTable
        columns={[{ key: 'number', label: 'เลขที่ PR' }, { key: 'requester', label: 'ผู้ขอ' }, { key: 'date', label: 'วันที่ขอ' }, { key: 'required', label: 'ต้องการวันที่' }, { key: 'amount', label: 'จำนวนเงิน', align: 'text-right' }, { key: 'status', label: 'สถานะ', align: 'text-center' }, { key: 'actions', label: 'จัดการ', align: 'text-center' }]}
        data={requests.filter(r => r.pr_number?.toLowerCase().includes(searchQuery.toLowerCase()) || r.requester_name?.toLowerCase().includes(searchQuery.toLowerCase()))}
        renderRow={(req) => (
          <tr key={req.id} className="border-b border-cyber-border/50 hover:bg-cyber-dark/50 transition-colors">
            <td className="px-6 py-4"><span className="font-medium text-cyber-primary">{req.pr_number}</span></td>
            <td className="px-6 py-4"><div><p className="font-medium text-white">{req.requester_name}</p><p className="text-sm text-gray-500">{req.department}</p></div></td>
            <td className="px-6 py-4 text-gray-300">{formatDate(req.request_date)}</td>
            <td className="px-6 py-4 text-gray-300">{formatDate(req.required_date)}</td>
            <td className="px-6 py-4 text-right font-medium text-white">{formatCurrency(req.total_amount)}</td>
            <td className="px-6 py-4 text-center"><span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium text-white ${getStatusColor(req.status)}`}>{getStatusText(req.status)}</span></td>
            <td className="px-6 py-4">
              <div className="flex justify-center gap-2">
                <button onClick={() => openModal('request', 'view', req)} className="p-2 hover:bg-cyber-primary/20 rounded-lg transition-colors" title="ดูรายละเอียด"><Eye className="w-4 h-4 text-cyber-primary" /></button>
                {req.status === 'DRAFT' && <button onClick={() => openModal('request', 'edit', req)} className="p-2 hover:bg-cyber-primary/20 rounded-lg transition-colors" title="แก้ไข"><Edit className="w-4 h-4 text-cyber-primary" /></button>}
                {req.status === 'APPROVED' && <button onClick={() => handleConvertRequestToOrder(req.id)} className="p-2 hover:bg-cyber-green/20 rounded-lg transition-colors" title="แปลงเป็น PO"><FileText className="w-4 h-4 text-cyber-green" /></button>}
                {req.status === 'DRAFT' && <button onClick={() => handleDeleteRequest(req.id)} className="p-2 hover:bg-red-500/20 rounded-lg transition-colors" title="ลบ"><Trash2 className="w-4 h-4 text-red-400" /></button>}
              </div>
            </td>
          </tr>
        )}
      />
    </div>
  )

  const OrdersContent = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex gap-4 items-center">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="ค้นหาใบสั่งซื้อ..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-cyber-primary w-64" />
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-gray-300 hover:border-cyber-primary transition-colors">
            <Filter className="w-4 h-4" />กรอง
          </button>
        </div>
        <button onClick={() => openModal('order', 'create')} className="flex items-center gap-2 px-4 py-2 bg-cyber-primary text-cyber-dark font-semibold rounded-lg hover:bg-cyber-primary/80 transition-colors">
          <Plus className="w-4 h-4" />สร้างใบสั่งซื้อ
        </button>
      </div>

      <DataTable
        columns={[{ key: 'number', label: 'เลขที่ PO' }, { key: 'supplier', label: 'ผู้ขาย' }, { key: 'date', label: 'วันที่สั่ง' }, { key: 'expected', label: 'กำหนดส่ง' }, { key: 'amount', label: 'จำนวนเงิน', align: 'text-right' }, { key: 'status', label: 'สถานะ', align: 'text-center' }, { key: 'actions', label: 'จัดการ', align: 'text-center' }]}
        data={orders.filter(o => o.po_number?.toLowerCase().includes(searchQuery.toLowerCase()) || o.supplier_name?.toLowerCase().includes(searchQuery.toLowerCase()))}
        renderRow={(order) => (
          <tr key={order.id} className="border-b border-cyber-border/50 hover:bg-cyber-dark/50 transition-colors">
            <td className="px-6 py-4"><span className="font-medium text-cyber-primary">{order.po_number}</span></td>
            <td className="px-6 py-4"><div><p className="font-medium text-white">{order.supplier_name}</p><p className="text-sm text-gray-500">{order.supplier_code}</p></div></td>
            <td className="px-6 py-4 text-gray-300">{formatDate(order.order_date)}</td>
            <td className="px-6 py-4 text-gray-300">{formatDate(order.expected_date)}</td>
            <td className="px-6 py-4 text-right font-medium text-white">{formatCurrency(order.total_amount)}</td>
            <td className="px-6 py-4 text-center"><span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium text-white ${getStatusColor(order.status)}`}>{getStatusText(order.status)}</span></td>
            <td className="px-6 py-4">
              <div className="flex justify-center gap-2">
                <button onClick={() => openModal('order', 'view', order)} className="p-2 hover:bg-cyber-primary/20 rounded-lg transition-colors" title="ดูรายละเอียด"><Eye className="w-4 h-4 text-cyber-primary" /></button>
                {order.status === 'DRAFT' && <button onClick={() => handleDeleteOrder(order.id)} className="p-2 hover:bg-red-500/20 rounded-lg transition-colors" title="ลบ"><Trash2 className="w-4 h-4 text-red-400" /></button>}
              </div>
            </td>
          </tr>
        )}
      />
    </div>
  )

  const ReceiptsContent = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex gap-4 items-center">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="ค้นหาใบรับสินค้า..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-cyber-primary w-64" />
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-gray-300 hover:border-cyber-primary transition-colors">
            <Filter className="w-4 h-4" />กรอง
          </button>
        </div>
        <button onClick={() => openModal('receipt', 'create')} className="flex items-center gap-2 px-4 py-2 bg-cyber-primary text-cyber-dark font-semibold rounded-lg hover:bg-cyber-primary/80 transition-colors">
          <Plus className="w-4 h-4" />สร้างใบรับสินค้า
        </button>
      </div>

      <DataTable
        columns={[{ key: 'number', label: 'เลขที่ GR' }, { key: 'po', label: 'ใบสั่งซื้อ' }, { key: 'supplier', label: 'ผู้ขาย' }, { key: 'date', label: 'วันที่รับ' }, { key: 'journal', label: 'สมุดรายวัน' }, { key: 'status', label: 'สถานะ', align: 'text-center' }, { key: 'actions', label: 'จัดการ', align: 'text-center' }]}
        data={receipts.filter(r => r.gr_number?.toLowerCase().includes(searchQuery.toLowerCase()) || r.po_number?.toLowerCase().includes(searchQuery.toLowerCase()))}
        renderRow={(receipt) => (
          <tr key={receipt.id} className="border-b border-cyber-border/50 hover:bg-cyber-dark/50 transition-colors">
            <td className="px-6 py-4"><span className="font-medium text-cyber-primary">{receipt.gr_number}</span></td>
            <td className="px-6 py-4 text-gray-300">{receipt.po_number}</td>
            <td className="px-6 py-4 text-white">{receipt.supplier_name}</td>
            <td className="px-6 py-4 text-gray-300">{formatDate(receipt.receipt_date)}</td>
            <td className="px-6 py-4">
              {receipt.journal_entry_number ? (
                <a href={`/accounting/journal?entry=${receipt.journal_entry_id}`} className="text-cyber-primary hover:underline" target="_blank" rel="noopener noreferrer">
                  {receipt.journal_entry_number}
                </a>
              ) : (
                <span className="text-gray-500">-</span>
              )}
            </td>
            <td className="px-6 py-4 text-center"><span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium text-white ${getStatusColor(receipt.status)}`}>{getStatusText(receipt.status)}</span></td>
            <td className="px-6 py-4">
              <div className="flex justify-center gap-2">
                <button onClick={() => openModal('receipt', 'view', receipt)} className="p-2 hover:bg-cyber-primary/20 rounded-lg transition-colors" title="ดูรายละเอียด"><Eye className="w-4 h-4 text-cyber-primary" /></button>
                {receipt.status === 'DRAFT' && <button onClick={() => handleConfirmReceipt(receipt.id)} className="p-2 hover:bg-cyber-green/20 rounded-lg transition-colors" title="ยืนยันการรับ"><Check className="w-4 h-4 text-cyber-green" /></button>}
              </div>
            </td>
          </tr>
        )}
      />
    </div>
  )

  const InvoicesContent = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex gap-4 items-center">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="ค้นหาใบแจ้งหนี้..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-cyber-primary w-64" />
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-gray-300 hover:border-cyber-primary transition-colors">
            <Filter className="w-4 h-4" />กรอง
          </button>
        </div>
        <button onClick={() => openModal('invoice', 'create')} className="flex items-center gap-2 px-4 py-2 bg-cyber-primary text-cyber-dark font-semibold rounded-lg hover:bg-cyber-primary/80 transition-colors">
          <Plus className="w-4 h-4" />สร้างใบแจ้งหนี้
        </button>
      </div>

      <DataTable
        columns={[{ key: 'number', label: 'เลขที่ PI' }, { key: 'supplier', label: 'ผู้ขาย' }, { key: 'po', label: 'ใบสั่งซื้อ' }, { key: 'amount', label: 'ยอดรวม', align: 'text-right' }, { key: 'balance', label: 'คงค้าง', align: 'text-right' }, { key: 'journal', label: 'สมุดรายวัน' }, { key: 'status', label: 'สถานะ', align: 'text-center' }, { key: 'actions', label: 'จัดการ', align: 'text-center' }]}
        data={invoices.filter(i => i.pi_number?.toLowerCase().includes(searchQuery.toLowerCase()) || i.supplier_name?.toLowerCase().includes(searchQuery.toLowerCase()))}
        renderRow={(invoice) => (
          <tr key={invoice.id} className="border-b border-cyber-border/50 hover:bg-cyber-dark/50 transition-colors">
            <td className="px-6 py-4"><span className="font-medium text-cyber-primary">{invoice.pi_number}</span><p className="text-xs text-gray-500">PO: {invoice.po_number}</p></td>
            <td className="px-6 py-4"><div><p className="font-medium text-white">{invoice.supplier_name}</p><p className="text-sm text-gray-500">{invoice.supplier_code}</p></div></td>
            <td className="px-6 py-4 text-gray-300">{invoice.po_number}</td>
            <td className="px-6 py-4 text-right font-medium text-white">{formatCurrency(invoice.total_amount)}</td>
            <td className="px-6 py-4 text-right"><span className={invoice.balance_amount > 0 ? 'text-red-400 font-medium' : 'text-green-400'}>{formatCurrency(invoice.balance_amount)}</span></td>
            <td className="px-6 py-4">
              {invoice.journal_entry_number ? (
                <a href={`/accounting/journal?entry=${invoice.journal_entry_id}`} className="text-cyber-primary hover:underline" target="_blank" rel="noopener noreferrer">
                  {invoice.journal_entry_number}
                </a>
              ) : (
                <span className="text-gray-500">-</span>
              )}
            </td>
            <td className="px-6 py-4 text-center"><span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium text-white ${getStatusColor(invoice.payment_status)}`}>{getStatusText(invoice.payment_status)}</span></td>
            <td className="px-6 py-4">
              <div className="flex justify-center gap-2">
                <button onClick={() => openModal('invoice', 'view', invoice)} className="p-2 hover:bg-cyber-primary/20 rounded-lg transition-colors" title="ดูรายละเอียด"><Eye className="w-4 h-4 text-cyber-primary" /></button>
                {invoice.payment_status !== 'PAID' && <button onClick={() => openModal('payment', 'create', { purchase_invoice_id: invoice.id, supplier_id: invoice.supplier_id, amount: invoice.balance_amount })} className="p-2 hover:bg-cyber-green/20 rounded-lg transition-colors" title="จ่ายเงิน"><DollarSign className="w-4 h-4 text-cyber-green" /></button>}
              </div>
            </td>
          </tr>
        )}
      />
    </div>
  )

  const PaymentsContent = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex gap-4 items-center">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="ค้นหาการจ่ายเงิน..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-cyber-primary w-64" />
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-gray-300 hover:border-cyber-primary transition-colors">
            <Filter className="w-4 h-4" />กรอง
          </button>
        </div>
        <button onClick={() => openModal('payment', 'create')} className="flex items-center gap-2 px-4 py-2 bg-cyber-primary text-cyber-dark font-semibold rounded-lg hover:bg-cyber-primary/80 transition-colors">
          <Plus className="w-4 h-4" />บันทึกจ่ายเงิน
        </button>
      </div>

      <DataTable
        columns={[{ key: 'number', label: 'เลขที่' }, { key: 'supplier', label: 'ผู้ขาย' }, { key: 'date', label: 'วันที่จ่าย' }, { key: 'method', label: 'วิธีการ' }, { key: 'amount', label: 'จำนวนเงิน', align: 'text-right' }, { key: 'journal', label: 'สมุดรายวัน' }, { key: 'actions', label: 'จัดการ', align: 'text-center' }]}
        data={payments.filter(p => p.payment_number?.toLowerCase().includes(searchQuery.toLowerCase()) || p.supplier_name?.toLowerCase().includes(searchQuery.toLowerCase()))}
        renderRow={(payment) => (
          <tr key={payment.id} className="border-b border-cyber-border/50 hover:bg-cyber-dark/50 transition-colors">
            <td className="px-6 py-4"><span className="font-medium text-cyber-primary">{payment.payment_number}</span></td>
            <td className="px-6 py-4 text-white">{payment.supplier_name}</td>
            <td className="px-6 py-4 text-gray-300">{formatDate(payment.payment_date)}</td>
            <td className="px-6 py-4 text-gray-300">{payment.payment_method}</td>
            <td className="px-6 py-4 text-right font-medium text-cyber-green">{formatCurrency(payment.amount)}</td>
            <td className="px-6 py-4">
              {payment.journal_entry_number ? (
                <a href={`/accounting/journal?entry=${payment.journal_entry_id}`} className="text-cyber-primary hover:underline" target="_blank" rel="noopener noreferrer">
                  {payment.journal_entry_number}
                </a>
              ) : (
                <span className="text-gray-500">-</span>
              )}
            </td>
            <td className="px-6 py-4"><div className="flex justify-center gap-2"><button onClick={() => openModal('payment', 'view', payment)} className="p-2 hover:bg-cyber-primary/20 rounded-lg transition-colors" title="ดูรายละเอียด"><Eye className="w-4 h-4 text-cyber-primary" /></button></div></td>
          </tr>
        )}
      />
    </div>
  )

  const ReturnsContent = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex gap-4 items-center">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="ค้นหาการคืนสินค้า..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-cyber-primary w-64" />
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-gray-300 hover:border-cyber-primary transition-colors">
            <Filter className="w-4 h-4" />กรอง
          </button>
        </div>
        <button onClick={() => openModal('return', 'create')} className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white font-semibold rounded-lg hover:bg-red-600 transition-colors">
          <Plus className="w-4 h-4" />สร้างใบคืนสินค้า
        </button>
      </div>

      <DataTable
        columns={[{ key: 'number', label: 'เลขที่ RT' }, { key: 'supplier', label: 'ผู้ขาย' }, { key: 'po', label: 'ใบสั่งซื้อ' }, { key: 'reason', label: 'เหตุผล' }, { key: 'amount', label: 'จำนวนเงิน', align: 'text-right' }, { key: 'status', label: 'สถานะ', align: 'text-center' }, { key: 'actions', label: 'จัดการ', align: 'text-center' }]}
        data={returns.filter(r => r.pr_number?.toLowerCase().includes(searchQuery.toLowerCase()) || r.supplier_name?.toLowerCase().includes(searchQuery.toLowerCase()))}
        renderRow={(ret) => (
          <tr key={ret.id} className="border-b border-cyber-border/50 hover:bg-cyber-dark/50 transition-colors">
            <td className="px-6 py-4"><span className="font-medium text-red-400">{ret.pr_number}</span></td>
            <td className="px-6 py-4"><div><p className="font-medium text-white">{ret.supplier_name}</p><p className="text-sm text-gray-500">{ret.supplier_code}</p></div></td>
            <td className="px-6 py-4 text-gray-300">{ret.po_number}</td>
            <td className="px-6 py-4 text-gray-300">{ret.reason}</td>
            <td className="px-6 py-4 text-right font-medium text-red-400">{formatCurrency(ret.total_amount)}</td>
            <td className="px-6 py-4 text-center"><span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium text-white ${getStatusColor(ret.status)}`}>{getStatusText(ret.status)}</span></td>
            <td className="px-6 py-4">
              <div className="flex justify-center gap-2">
                <button onClick={() => openModal('return', 'view', ret)} className="p-2 hover:bg-cyber-primary/20 rounded-lg transition-colors" title="ดูรายละเอียด"><Eye className="w-4 h-4 text-cyber-primary" /></button>
                {ret.status === 'DRAFT' && <button onClick={() => handleConfirmReturn(ret.id)} className="p-2 hover:bg-cyber-green/20 rounded-lg transition-colors" title="ยืนยัน"><Check className="w-4 h-4 text-cyber-green" /></button>}
              </div>
            </td>
          </tr>
        )}
      />
    </div>
  )

  const tabs = [
    { id: 'overview', label: 'ภาพรวม', icon: TrendingUp },
    { id: 'requests', label: 'ใบขอซื้อ', icon: FileText },
    { id: 'orders', label: 'ใบสั่งซื้อ', icon: ShoppingCart },
    { id: 'receipts', label: 'รับสินค้า', icon: Package },
    { id: 'invoices', label: 'ใบแจ้งหนี้', icon: Receipt },
    { id: 'payments', label: 'จ่ายเงิน', icon: CreditCard },
    { id: 'returns', label: 'คืนสินค้า', icon: RotateCcw },
  ]

  return (
    <div className="p-6 space-y-6">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <ShoppingCart className="w-8 h-8 text-cyber-primary" />
            การจัดซื้อ
          </h1>
          <p className="text-gray-400 mt-1">จัดการใบขอซื้อ ใบสั่งซื้อ รับสินค้า และการจ่ายเงิน</p>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap gap-2 bg-cyber-card p-2 rounded-xl border border-cyber-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-4 py-3 rounded-lg font-medium transition-all ${activeTab === tab.id ? 'bg-cyber-primary text-cyber-dark' : 'text-gray-400 hover:text-white hover:bg-cyber-dark'}`}
          >
            <tab.icon className="w-4 h-4" />
            <span className="hidden md:inline">{tab.label}</span>
          </button>
        ))}
      </motion.div>

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyber-primary" />
        </div>
      ) : (
        <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
          {activeTab === 'overview' && <OverviewContent />}
          {activeTab === 'requests' && <RequestsContent />}
          {activeTab === 'orders' && <OrdersContent />}
          {activeTab === 'receipts' && <ReceiptsContent />}
          {activeTab === 'invoices' && <InvoicesContent />}
          {activeTab === 'payments' && <PaymentsContent />}
          {activeTab === 'returns' && <ReturnsContent />}
        </motion.div>
      )}

      {/* Modals */}
      <AnimatePresence>
        {modalOpen === 'request' && <RequestModal />}
        {modalOpen === 'order' && <OrderModal />}
        {modalOpen === 'receipt' && <ReceiptModal />}
        {modalOpen === 'invoice' && <InvoiceModal />}
        {modalOpen === 'payment' && <PaymentModal />}
        {modalOpen === 'return' && <ReturnModal />}
      </AnimatePresence>
    </div>
  )
}

export default Purchase
