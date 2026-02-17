import { useState, useRef } from 'react'
import { motion } from 'framer-motion'
import { Upload, FileSpreadsheet, X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import * as XLSX from 'xlsx'
import importApi from '../../services/import'
import toast from 'react-hot-toast'

interface ImportModalProps {
  isOpen: boolean
  onClose: () => void
  type: 'customers' | 'stock'
  onSuccess: () => void
}

const ImportModal = ({ isOpen, onClose, type, onSuccess }: ImportModalProps) => {
  const [file, setFile] = useState<File | null>(null)
  const [previewData, setPreviewData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [validation, setValidation] = useState<any>(null)
  const [result, setResult] = useState<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return

    // Check file type
    const validTypes = ['.xlsx', '.xls', '.csv']
    const fileExt = selectedFile.name.substring(selectedFile.name.lastIndexOf('.')).toLowerCase()
    if (!validTypes.includes(fileExt)) {
      toast.error('กรุณาเลือกไฟล์ Excel (.xlsx, .xls) หรือ CSV')
      return
    }

    setFile(selectedFile)
    setLoading(true)

    try {
      const data = await readFile(selectedFile)
      console.log('Parsed data sample:', data.slice(0, 3)) // Debug
      setPreviewData(data.slice(0, 10)) // Preview first 10 rows
      
      // Validate data
      const validationRes = await importApi.validate(type, data)
      setValidation(validationRes.data.data)
      
      toast.success(`อ่านไฟล์สำเร็จ: ${data.length} แถว`)
    } catch (error) {
      toast.error('ไม่สามารถอ่านไฟล์ได้')
    } finally {
      setLoading(false)
    }
  }

  const readFile = (file: File): Promise<any[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const data = e.target?.result
          const workbook = XLSX.read(data, { type: 'binary' })
          const sheetName = workbook.SheetNames[0]
          const worksheet = workbook.Sheets[sheetName]
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 })
          
          if (jsonData.length < 2) {
            resolve([])
            return
          }

          // Check if it's FlowAccount Thai format (has specific Thai headers)
          const firstRow = jsonData[0] as string[]
          const isFlowAccountFormat = firstRow.some(h => 
            h && typeof h === 'string' && 
            (h.includes('ข้อมูลผู้ติดต่อ') || h.includes('ที่อยู่จดทะเบียน') || h.includes('ช่องทางติดต่อ'))
          )
          
          console.log('Format detection:', { isFlowAccountFormat, type, firstRowHeaders: firstRow.slice(0, 5) })

          if (isFlowAccountFormat && type === 'customers') {
            // FlowAccount format: use row 2 (index 1) as headers, data starts at row 3 (index 2)
            const parsed = parseFlowAccountCustomerFormat(jsonData)
            console.log('FlowAccount parsed sample:', parsed.slice(0, 3))
            resolve(parsed)
          } else {
            // Standard format: first row as headers
            resolve(parseStandardFormat(jsonData))
          }
        } catch (error) {
          reject(error)
        }
      }
      reader.onerror = reject
      reader.readAsBinaryString(file)
    })
  }

  // Parse standard format (first row = headers)
  const parseStandardFormat = (jsonData: any[]): any[] => {
    const headers = jsonData[0] as string[]
    const rows = jsonData.slice(1).map((row: any) => {
      const obj: any = {}
      headers.forEach((header, index) => {
        if (header) {
          const key = String(header).toLowerCase().replace(/\s+/g, '_')
          obj[key] = row[index] || ''
        }
      })
      return obj
    })
    return rows.filter(row => Object.values(row).some(v => v !== ''))
  }

  // Parse FlowAccount Thai format for customers
  const parseFlowAccountCustomerFormat = (jsonData: any[]): any[] => {
    // Row 2 (index 1) contains actual column headers
    const headers = jsonData[1] as string[]
    const dataRows = jsonData.slice(2) // Data starts from row 3

    return dataRows
      .filter((row: any) => row[1]) // Must have customer code (column B)
      .map((row: any) => {
        // Extract company name from column J (index 9)
        const companyName = row[9] || ''
        
        // Extract contact person from column L (index 11) or from columns 40-42
        let contactName = row[11] || ''
        if (!contactName && (row[40] || row[41])) {
          const title = row[40] || ''
          const firstName = row[41] || ''
          const lastName = row[42] || ''
          contactName = `${title} ${firstName} ${lastName}`.trim()
        }

        // Derive customer type from company name or use column C
        let customerType = 'general'
        const typeFromFile = row[2] // ประเภทผู้ติดต่อ
        if (typeFromFile && typeFromFile !== 'ไม่ระบุ') {
          customerType = mapCustomerType(typeFromFile)
        } else if (companyName) {
          customerType = detectCustomerTypeFromName(companyName)
        }

        return {
          code: String(row[1] || ''), // รหัสผู้ติดต่อ
          name: companyName, // ชื่อบริษัท/ลูกค้า
          type: customerType,
          contact_name: contactName,
          email: row[26] || '', // อีเมล
          phone: row[25] || '', // เบอร์โทร
          address: row[12] || '', // ที่อยู่
          city: row[15] || row[22] || '', // จังหวัด (from registered or shipping)
          country: row[16] || row[23] || 'Thailand', // ประเทศ
          postal_code: row[17] || row[24] || '', // รหัสไปรษณีย์
          tax_id: row[4] || '', // เลขทะเบียนภาษี
          branch: row[5] || '', // สาขา
          business_type: row[7] || '', // ประเภทกิจการ
        }
      })
      .filter(row => row.name || row.code) // Must have name or code
  }

  // Map Thai customer type to system type
  const mapCustomerType = (thaiType: string): string => {
    const typeMap: Record<string, string> = {
      'ลูกค้า': 'customer',
      'ผู้จำหน่าย': 'supplier',
      'ทั้งลูกค้าและผู้จำหน่าย': 'both',
      'ไม่ระบุ': 'general',
    }
    return typeMap[thaiType] || 'general'
  }

  // Detect customer type from company name prefix
  const detectCustomerTypeFromName = (name: string): string => {
    if (!name) return 'general'
    const lowerName = name.toLowerCase()
    if (lowerName.includes('โรงแรม') || lowerName.includes('hotel')) return 'hotel'
    if (lowerName.includes('รพ.') || lowerName.includes('hospital')) return 'hospital'
    if (lowerName.includes('ห้าง') || lowerName.includes('ร้าน')) return 'retail'
    return 'general'
  }

  const handleImport = async () => {
    if (!file || previewData.length === 0) return

    setImporting(true)
    try {
      const data = await readFile(file)
      
      if (type === 'customers') {
        const res = await importApi.importCustomers(data)
        setResult(res.data.data)
        toast.success(`นำเข้าสำเร็จ: ${res.data.data.success} รายการ`)
      } else {
        const res = await importApi.importStock(data)
        setResult(res.data.data)
        toast.success(`นำเข้าสำเร็จ: ${res.data.data.success} รายการ`)
      }
      
      onSuccess()
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'นำเข้าไม่สำเร็จ')
    } finally {
      setImporting(false)
    }
  }

  const resetState = () => {
    setFile(null)
    setPreviewData([])
    setValidation(null)
    setResult(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleClose = () => {
    resetState()
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="cyber-card w-full max-w-3xl max-h-[90vh] overflow-auto"
      >
        {/* Header */}
        <div className="p-6 border-b border-cyber-border flex justify-between items-center">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Upload className="w-6 h-6 text-cyber-primary" />
            นำเข้า{type === 'customers' ? 'ลูกค้า' : 'สินค้า'}
          </h2>
          <button onClick={handleClose} className="p-2 hover:bg-cyber-dark rounded-lg">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* File Upload */}
          {!result && (
            <div
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                file ? 'border-cyber-primary bg-cyber-primary/10' : 'border-cyber-border hover:border-cyber-primary/50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileChange}
                className="hidden"
              />
              <FileSpreadsheet className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              {file ? (
                <>
                  <p className="text-white font-medium">{file.name}</p>
                  <p className="text-sm text-gray-400">คลิกเพื่อเปลี่ยนไฟล์</p>
                </>
              ) : (
                <>
                  <p className="text-gray-300 font-medium">คลิกเพื่อเลือกไฟล์</p>
                  <p className="text-sm text-gray-500 mt-2">รองรับ .xlsx, .xls, .csv</p>
                  <p className="text-xs text-gray-600 mt-1">
                    {type === 'customers' 
                      ? 'รองรับไฟล์จาก FlowAccount (Thai) หรือคอลัมน์: name, type, contact_name, email, phone'
                      : 'คอลัมน์: name, category, unit, quantity, min_stock, max_stock, location'
                    }
                  </p>
                </>
              )}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 text-cyber-primary animate-spin" />
              <span className="ml-2 text-gray-400">กำลังอ่านไฟล์...</span>
            </div>
          )}

          {/* Validation Result */}
          {validation && !result && (
            <div className={`p-4 rounded-lg ${validation.invalid > 0 ? 'bg-yellow-500/10 border border-yellow-500/30' : 'bg-green-500/10 border border-green-500/30'}`}>
              <div className="flex items-center gap-2 mb-2">
                {validation.invalid > 0 ? (
                  <AlertCircle className="w-5 h-5 text-yellow-400" />
                ) : (
                  <CheckCircle className="w-5 h-5 text-green-400" />
                )}
                <span className={validation.invalid > 0 ? 'text-yellow-400' : 'text-green-400'}>
                  ตรวจสอบข้อมูล: {validation.valid} ถูกต้อง, {validation.invalid} มีปัญหา
                </span>
              </div>
              {validation.errors.length > 0 && (
                <div className="mt-2 text-sm text-gray-400 max-h-32 overflow-auto">
                  {validation.errors.slice(0, 5).map((err: string, i: number) => (
                    <div key={i} className="py-1">• {err}</div>
                  ))}
                  {validation.errors.length > 5 && (
                    <div className="py-1 text-gray-500">...และอีก {validation.errors.length - 5} รายการ</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Preview Data */}
          {previewData.length > 0 && !result && (
            <div>
              <h3 className="text-sm font-medium text-gray-400 mb-2">ตัวอย่างข้อมูล ({previewData.length} แถวแรก)</h3>
              <div className="overflow-x-auto">
                <table className="cyber-table w-full text-sm">
                  <thead>
                    <tr>
                      {Object.keys(previewData[0]).map((key) => (
                        <th key={key} className="text-left">{key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.map((row, i) => (
                      <tr key={i}>
                        {Object.values(row).map((val: any, j) => (
                          <td key={j} className="truncate max-w-xs">{String(val)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Import Result */}
          {result && (
            <div className={`p-6 rounded-lg ${result.failed > 0 ? 'bg-yellow-500/10' : 'bg-green-500/10'} border ${result.failed > 0 ? 'border-yellow-500/30' : 'border-green-500/30'}`}>
              <div className="flex items-center gap-3 mb-4">
                <CheckCircle className={`w-8 h-8 ${result.failed > 0 ? 'text-yellow-400' : 'text-green-400'}`} />
                <div>
                  <h3 className="text-lg font-bold text-white">นำเข้าเสร็จสิ้น</h3>
                  <p className="text-gray-400">{result.success} สำเร็จ, {result.failed} ล้มเหลว</p>
                </div>
              </div>
              
              {result.errors.length > 0 && (
                <div className="mt-4 p-4 bg-black/30 rounded-lg max-h-48 overflow-auto">
                  <h4 className="text-sm font-medium text-yellow-400 mb-2">ข้อผิดพลาด:</h4>
                  {result.errors.map((err: string, i: number) => (
                    <div key={i} className="text-sm text-gray-400 py-1">• {err}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-cyber-border flex justify-end gap-3">
          <button
            onClick={handleClose}
            className="px-4 py-2 border border-cyber-border rounded-lg text-gray-300 hover:bg-cyber-dark"
          >
            {result ? 'ปิด' : 'ยกเลิก'}
          </button>
          
          {!result && (
            <button
              onClick={handleImport}
              disabled={!file || loading || importing || (validation && validation.invalid > 0)}
              className="cyber-btn-primary flex items-center gap-2 disabled:opacity-50"
            >
              {importing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  กำลังนำเข้า...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  นำเข้าข้อมูล
                </>
              )}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  )
}

export default ImportModal
