import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Store,
  Plus,
  Search,
  Edit2,
  Trash2,
  ToggleRight,
  ToggleLeft,
  Package,
  Tag,
  DollarSign,
  Clock,
  ChevronRight,
  X,
  Save,
  Utensils,
  Grid,
} from 'lucide-react'
import toast from 'react-hot-toast'
import posService from '../../services/pos.service'

// ==================== Types ====================

interface POSCategory {
  id: string
  name: string
  color: string
  icon?: string
  sort_order: number
}

interface POSMenu {
  id: string
  product_id: string
  product_name: string
  product_code: string
  bom_id?: string
  bom_version?: string
  category_id?: string
  category_name?: string
  category_color?: string
  pos_price: number
  cost_price: number
  is_available: boolean
  is_pos_enabled: boolean
  display_order: number
  quick_code?: string
  preparation_time: number
  description?: string
}

interface BOM {
  id: string
  product_id: string
  version: string
  status: string
}

interface Product {
  id: string
  code: string
  name: string
  category: string
}

// ==================== Components ====================

export default function POSMenuSettings() {
  const [activeTab, setActiveTab] = useState<'menus' | 'categories'>('menus')
  const [menus, setMenus] = useState<POSMenu[]>([])
  const [categories, setCategories] = useState<POSCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  
  const [showMenuModal, setShowMenuModal] = useState(false)
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [editingMenu, setEditingMenu] = useState<POSMenu | null>(null)
  const [editingCategory, setEditingCategory] = useState<POSCategory | null>(null)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const [menusRes, categoriesRes] = await Promise.all([
        posService.getMenuConfigs(),
        posService.getCategories(),
      ])
      
      if (menusRes.success) setMenus(menusRes.data || [])
      if (categoriesRes.success) setCategories(categoriesRes.data || [])
    } catch (error) {
      toast.error('Failed to load POS data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const filteredMenus = menus.filter(menu => {
    const matchesSearch = 
      menu.product_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      menu.product_code?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      menu.quick_code?.toLowerCase().includes(searchQuery.toLowerCase())
    
    const matchesCategory = selectedCategory === 'all' || menu.category_id === selectedCategory
    
    return matchesSearch && matchesCategory
  })

  const toggleAvailability = async (menu: POSMenu) => {
    try {
      const newStatus = !menu.is_available
      const res = await posService.toggleMenuAvailability(menu.id, newStatus)
      
      if (res.success) {
        setMenus(prev => prev.map(m => 
          m.id === menu.id ? { ...m, is_available: newStatus } : m
        ))
        toast.success(newStatus ? 'Menu enabled' : 'Menu disabled')
      }
    } catch (error) {
      toast.error('Failed to update menu')
    }
  }

  const deleteMenu = async (menuId: string) => {
    if (!confirm('Are you sure you want to remove this menu from POS?')) return
    
    try {
      const res = await posService.deleteMenuConfig(menuId)
      if (res.success) {
        setMenus(prev => prev.filter(m => m.id !== menuId))
        toast.success('Menu removed from POS')
      }
    } catch (error) {
      toast.error('Failed to delete menu')
    }
  }

  const deleteCategory = async (categoryId: string) => {
    if (!confirm('Are you sure? Menus in this category will be uncategorized.')) return
    
    try {
      const res = await posService.deleteCategory(categoryId)
      if (res.success) {
        setCategories(prev => prev.filter(c => c.id !== categoryId))
        toast.success('Category deleted')
      }
    } catch (error) {
      toast.error('Failed to delete category')
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">POS Menu Management</h1>
          <p className="text-gray-400 mt-1">Configure which products are available for sale in POS</p>
        </div>
        
        <div className="flex bg-cyber-card rounded-lg p-1">
          <button
            onClick={() => setActiveTab('menus')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md transition-all ${
              activeTab === 'menus'
                ? 'bg-cyber-primary/20 text-cyber-primary'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Utensils className="w-4 h-4" />
            Menus
          </button>
          <button
            onClick={() => setActiveTab('categories')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md transition-all ${
              activeTab === 'categories'
                ? 'bg-cyber-primary/20 text-cyber-primary'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Grid className="w-4 h-4" />
            Categories
          </button>
        </div>
      </div>

      {/* Menus Tab */}
      {activeTab === 'menus' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search menus..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-cyber-card border border-cyber-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-cyber-primary"
              />
            </div>
            
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-4 py-2 bg-cyber-card border border-cyber-border rounded-lg text-white focus:outline-none focus:border-cyber-primary"
            >
              <option value="all">All Categories</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
            
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                setEditingMenu(null)
                setShowMenuModal(true)
              }}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-cyber-primary to-cyber-purple text-white rounded-lg hover:opacity-90"
            >
              <Plus className="w-4 h-4" />
              Add Menu
            </motion.button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-4 bg-cyber-card border border-cyber-border rounded-xl">
              <p className="text-sm text-gray-400">Total Menus</p>
              <p className="text-2xl font-bold text-white">{menus.length}</p>
            </div>
            <div className="p-4 bg-cyber-card border border-cyber-border rounded-xl">
              <p className="text-sm text-gray-400">Available</p>
              <p className="text-2xl font-bold text-cyber-green">
                {menus.filter(m => m.is_available).length}
              </p>
            </div>
            <div className="p-4 bg-cyber-card border border-cyber-border rounded-xl">
              <p className="text-sm text-gray-400">Unavailable</p>
              <p className="text-2xl font-bold text-red-400">
                {menus.filter(m => !m.is_available).length}
              </p>
            </div>
            <div className="p-4 bg-cyber-card border border-cyber-border rounded-xl">
              <p className="text-sm text-gray-400">Categories</p>
              <p className="text-2xl font-bold text-cyber-primary">{categories.length}</p>
            </div>
          </div>

          {/* Menus Grid */}
          {loading ? (
            <div className="text-center py-12">
              <div className="w-8 h-8 border-2 border-cyber-primary border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-gray-400 mt-2">Loading...</p>
            </div>
          ) : filteredMenus.length === 0 ? (
            <div className="text-center py-12 bg-cyber-card border border-cyber-border rounded-xl">
              <Store className="w-12 h-12 mx-auto text-gray-500 mb-3" />
              <p className="text-gray-400">No menus found</p>
              <p className="text-sm text-gray-500 mt-1">
                {searchQuery ? 'Try different search terms' : 'Add your first menu to POS'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredMenus.map((menu) => (
                <motion.div
                  key={menu.id}
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 bg-cyber-card border border-cyber-border rounded-xl hover:border-cyber-primary/50 transition-all group"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span 
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: menu.category_color || '#00f0ff' }}
                        />
                        <span className="text-xs text-gray-400">
                          {menu.category_name || 'Uncategorized'}
                        </span>
                        {menu.bom_id && (
                          <span className="text-xs px-1.5 py-0.5 bg-cyber-primary/20 text-cyber-primary rounded">
                            BOM v{menu.bom_version}
                          </span>
                        )}
                      </div>
                      <h3 className="font-semibold text-white mt-1 truncate">
                        {menu.product_name}
                      </h3>
                      <p className="text-xs text-gray-500">{menu.product_code}</p>
                    </div>
                    
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => toggleAvailability(menu)}
                        className={`p-2 rounded-lg transition-colors ${
                          menu.is_available 
                            ? 'text-cyber-green hover:bg-cyber-green/10' 
                            : 'text-gray-500 hover:bg-gray-500/10'
                        }`}
                        title={menu.is_available ? 'Enabled' : 'Disabled'}
                      >
                        {menu.is_available ? (
                          <ToggleRight className="w-5 h-5" />
                        ) : (
                          <ToggleLeft className="w-5 h-5" />
                        )}
                      </button>
                      <button
                        onClick={() => {
                          setEditingMenu(menu)
                          setShowMenuModal(true)
                        }}
                        className="p-2 rounded-lg text-gray-400 hover:text-cyber-primary hover:bg-cyber-primary/10"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deleteMenu(menu.id)}
                        className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  
                  <div className="mt-4 pt-4 border-t border-cyber-border">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1 text-cyber-green">
                          <DollarSign className="w-4 h-4" />
                          {menu.pos_price?.toLocaleString()}
                        </span>
                        {menu.preparation_time > 0 && (
                          <span className="flex items-center gap-1 text-gray-400">
                            <Clock className="w-4 h-4" />
                            {menu.preparation_time}m
                          </span>
                        )}
                      </div>
                      {menu.quick_code && (
                        <span className="px-2 py-1 bg-cyber-dark rounded text-xs text-gray-400">
                          {menu.quick_code}
                        </span>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Categories Tab */}
      {activeTab === 'categories' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                setEditingCategory(null)
                setShowCategoryModal(true)
              }}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-cyber-primary to-cyber-purple text-white rounded-lg hover:opacity-90"
            >
              <Plus className="w-4 h-4" />
              Add Category
            </motion.button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {categories.map((category) => {
              const menuCount = menus.filter(m => m.category_id === category.id).length
              
              return (
                <motion.div
                  key={category.id}
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 bg-cyber-card border border-cyber-border rounded-xl hover:border-cyber-primary/50 transition-all"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div 
                        className="w-10 h-10 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: `${category.color}20` }}
                      >
                        <div 
                          className="w-4 h-4 rounded-full"
                          style={{ backgroundColor: category.color }}
                        />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white">{category.name}</h3>
                        <p className="text-sm text-gray-400">{menuCount} menus</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setEditingCategory(category)
                          setShowCategoryModal(true)
                        }}
                        className="p-2 rounded-lg text-gray-400 hover:text-cyber-primary hover:bg-cyber-primary/10"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deleteCategory(category.id)}
                        className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>
      )}

      {/* Modals */}
      <MenuModal
        isOpen={showMenuModal}
        onClose={() => setShowMenuModal(false)}
        menu={editingMenu}
        categories={categories}
        onSaved={fetchData}
      />

      <CategoryModal
        isOpen={showCategoryModal}
        onClose={() => setShowCategoryModal(false)}
        category={editingCategory}
        onSaved={fetchData}
      />
    </div>
  )
}

// ==================== Menu Modal ====================

interface MenuModalProps {
  isOpen: boolean
  onClose: () => void
  menu: POSMenu | null
  categories: POSCategory[]
  onSaved: () => void
}

function MenuModal({ isOpen, onClose, menu, categories, onSaved }: MenuModalProps) {
  const [step, setStep] = useState<1 | 2>(1)
  const [products, setProducts] = useState<Product[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [boms, setBoms] = useState<BOM[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  
  // Fetch BOMs when product is selected
  useEffect(() => {
    if (selectedProduct?.id) {
      fetchBOMs(selectedProduct.id)
    } else {
      setBoms([])
    }
  }, [selectedProduct?.id])
  
  const fetchBOMs = async (productId: string) => {
    try {
      const res = await posService.getAvailableBOMs(productId)
      if (res.success) {
        // กรองเฉพาะ BOM ที่ ACTIVE หรือ APPROVED
        const activeBOMs = (res.data || []).filter((b: BOM) => 
          b.status === 'ACTIVE' || b.status === 'APPROVED'
        )
        setBoms(activeBOMs)
      }
    } catch (error) {
      console.error('Failed to fetch BOMs:', error)
    }
  }
  
  const [formData, setFormData] = useState({
    category_id: '',
    bom_id: '',
    pos_price: '',
    cost_price: '',
    is_available: true,
    display_order: 0,
    quick_code: '',
    preparation_time: 10,
    description: '',
  })

  useEffect(() => {
    if (!isOpen) return
    
    if (menu) {
      setStep(2)
      setSelectedProduct({
        id: menu.product_id,
        code: menu.product_code,
        name: menu.product_name,
        category: '',
      })
      setFormData({
        category_id: menu.category_id || '',
        bom_id: menu.bom_id || '',
        pos_price: menu.pos_price?.toString() || '',
        cost_price: menu.cost_price?.toString() || '',
        is_available: menu.is_available,
        display_order: menu.display_order || 0,
        quick_code: menu.quick_code || '',
        preparation_time: menu.preparation_time || 10,
        description: menu.description || '',
      })
    } else {
      setStep(1)
      setSelectedProduct(null)
      setFormData({
        category_id: '',
        bom_id: '',
        pos_price: '',
        cost_price: '',
        is_available: true,
        display_order: 0,
        quick_code: '',
        preparation_time: 10,
        description: '',
      })
      fetchProducts()
    }
  }, [isOpen, menu])

  const fetchProducts = async () => {
    try {
      setLoading(true)
      const res = await posService.getAvailableProducts(productSearch)
      if (res.success) setProducts(res.data || [])
    } catch (error) {
      toast.error('Failed to load products')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!menu && isOpen) fetchProducts()
    }, 300)
    return () => clearTimeout(timeout)
  }, [productSearch, isOpen, menu])

  const handleSave = async () => {
    if (!formData.pos_price || (!menu && !selectedProduct)) {
      toast.error('Please fill in all required fields')
      return
    }

    try {
      setSaving(true)
      
      const data = {
        ...formData,
        pos_price: parseFloat(formData.pos_price),
        cost_price: formData.cost_price ? parseFloat(formData.cost_price) : 0,
        bom_id: formData.bom_id || undefined,
      }

      if (menu) {
        const res = await posService.updateMenuConfig(menu.id, data)
        if (res.success) {
          toast.success('Menu updated successfully')
          onSaved()
          onClose()
        }
      } else {
        const res = await posService.createMenuConfig({
          ...data,
          product_id: selectedProduct!.id,
        })
        if (res.success) {
          toast.success('Menu added to POS successfully')
          onSaved()
          onClose()
        }
      }
    } catch (error) {
      toast.error('Failed to save menu')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-cyber-card border border-cyber-border rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        <div className="flex items-center justify-between p-6 border-b border-cyber-border">
          <h2 className="text-xl font-bold text-white">
            {menu ? 'Edit Menu' : 'Add Menu to POS'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-cyber-dark text-gray-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {step === 1 && !menu ? (
            <div className="space-y-4">
              <p className="text-gray-400">Select a product to add to POS</p>
              
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search products..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-cyber-dark border border-cyber-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-cyber-primary"
                />
              </div>

              {loading ? (
                <div className="text-center py-8">
                  <div className="w-8 h-8 border-2 border-cyber-primary border-t-transparent rounded-full animate-spin mx-auto" />
                </div>
              ) : products.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No available products found</p>
                  <p className="text-sm mt-1">All products may already be in POS</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-auto">
                  {products.map((product) => (
                    <button
                      key={product.id}
                      onClick={() => {
                        setSelectedProduct(product)
                        setStep(2)
                      }}
                      className="w-full p-4 bg-cyber-dark border border-cyber-border rounded-lg text-left hover:border-cyber-primary/50 transition-all flex items-center justify-between group"
                    >
                      <div>
                        <p className="font-medium text-white group-hover:text-cyber-primary">
                          {product.name}
                        </p>
                        <p className="text-sm text-gray-500">{product.code}</p>
                      </div>
                      <ChevronRight className="w-5 h-5 text-gray-500 group-hover:text-cyber-primary" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 bg-cyber-dark rounded-lg">
                <p className="text-sm text-gray-400">Product</p>
                <p className="font-semibold text-white">{selectedProduct?.name}</p>
                <p className="text-sm text-gray-500">{selectedProduct?.code}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Category</label>
                  <select
                    value={formData.category_id}
                    onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
                    className="w-full px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white focus:outline-none focus:border-cyber-primary"
                  >
                    <option value="">Select category...</option>
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    BOM (Bill of Materials)
                    {boms.length > 0 && (
                      <span className="text-cyber-primary ml-1">({boms.length} available)</span>
                    )}
                  </label>
                  <select
                    value={formData.bom_id}
                    onChange={(e) => setFormData({ ...formData, bom_id: e.target.value })}
                    className="w-full px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white focus:outline-none focus:border-cyber-primary"
                  >
                    <option value="">
                      {boms.length === 0 ? 'No BOM available' : 'Select BOM (optional)...'}
                    </option>
                    {boms.map(bom => (
                      <option key={bom.id} value={bom.id}>
                        Version {bom.version} {bom.status !== 'ACTIVE' ? `(${bom.status})` : ''}
                      </option>
                    ))}
                  </select>
                  {formData.bom_id && (
                    <p className="text-xs text-cyber-green mt-1">
                      ✓ Stock will be deducted from BOM ingredients
                    </p>
                  )}
                  {!formData.bom_id && boms.length > 0 && (
                    <p className="text-xs text-gray-500 mt-1">
                      Tip: Link a BOM to auto-deduct stock from production recipe
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    POS Price <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                      type="number"
                      value={formData.pos_price}
                      onChange={(e) => setFormData({ ...formData, pos_price: e.target.value })}
                      className="w-full pl-9 pr-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white focus:outline-none focus:border-cyber-primary"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">Cost Price</label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                      type="number"
                      value={formData.cost_price}
                      onChange={(e) => setFormData({ ...formData, cost_price: e.target.value })}
                      className="w-full pl-9 pr-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white focus:outline-none focus:border-cyber-primary"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">Quick Code</label>
                  <div className="relative">
                    <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                      type="text"
                      value={formData.quick_code}
                      onChange={(e) => setFormData({ ...formData, quick_code: e.target.value })}
                      className="w-full pl-9 pr-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white focus:outline-none focus:border-cyber-primary"
                      placeholder="e.g., A01"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">Prep Time (min)</label>
                  <div className="relative">
                    <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                      type="number"
                      value={formData.preparation_time}
                      onChange={(e) => setFormData({ ...formData, preparation_time: parseInt(e.target.value) || 0 })}
                      className="w-full pl-9 pr-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white focus:outline-none focus:border-cyber-primary"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">Display Order</label>
                  <input
                    type="number"
                    value={formData.display_order}
                    onChange={(e) => setFormData({ ...formData, display_order: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white focus:outline-none focus:border-cyber-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white focus:outline-none focus:border-cyber-primary resize-none"
                  placeholder="Menu description..."
                />
              </div>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.is_available}
                  onChange={(e) => setFormData({ ...formData, is_available: e.target.checked })}
                  className="w-5 h-5 rounded border-cyber-border bg-cyber-dark text-cyber-primary focus:ring-cyber-primary"
                />
                <span className="text-white">Available for sale</span>
              </label>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between p-6 border-t border-cyber-border">
          {step === 2 && !menu ? (
            <button
              onClick={() => setStep(1)}
              className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
            >
              Back
            </button>
          ) : (
            <div />
          )}
          
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            {step === 2 && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-cyber-primary to-cyber-purple text-white rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Save
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  )
}

// ==================== Category Modal ====================

interface CategoryModalProps {
  isOpen: boolean
  onClose: () => void
  category: POSCategory | null
  onSaved: () => void
}

function CategoryModal({ isOpen, onClose, category, onSaved }: CategoryModalProps) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('#00f0ff')
  const [icon, setIcon] = useState('')
  const [saving, setSaving] = useState(false)

  const colors = [
    '#00f0ff', '#00ff88', '#9d00ff', '#ff00ff', '#ff4757',
    '#ffa502', '#2ed573', '#1e90ff', '#ff6348', '#a4b0be',
  ]

  useEffect(() => {
    if (category) {
      setName(category.name)
      setColor(category.color)
      setIcon(category.icon || '')
    } else {
      setName('')
      setColor('#00f0ff')
      setIcon('')
    }
  }, [category, isOpen])

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Category name is required')
      return
    }

    try {
      setSaving(true)
      
      const data = { name, color, icon }
      
      if (category) {
        const res = await posService.updateCategory(category.id, data)
        if (res.success) {
          toast.success('Category updated')
          onSaved()
          onClose()
        }
      } else {
        const res = await posService.createCategory(data)
        if (res.success) {
          toast.success('Category created')
          onSaved()
          onClose()
        }
      }
    } catch (error) {
      toast.error('Failed to save category')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-cyber-card border border-cyber-border rounded-2xl w-full max-w-md"
      >
        <div className="flex items-center justify-between p-6 border-b border-cyber-border">
          <h2 className="text-xl font-bold text-white">
            {category ? 'Edit Category' : 'Add Category'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-cyber-dark text-gray-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white focus:outline-none focus:border-cyber-primary"
              placeholder="e.g., Main Course"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">Color</label>
            <div className="flex flex-wrap gap-2">
              {colors.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-lg transition-all ${
                    color === c ? 'ring-2 ring-white scale-110' : 'hover:scale-105'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Icon (optional)</label>
            <input
              type="text"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              className="w-full px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white focus:outline-none focus:border-cyber-primary"
              placeholder="Icon name"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 p-6 border-t border-cyber-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-cyber-primary to-cyber-purple text-white rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {saving ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  )
}
