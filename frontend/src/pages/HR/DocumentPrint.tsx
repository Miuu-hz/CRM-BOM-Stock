import { useState } from 'react'
import { Printer, ArrowLeft, Download } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import hrDocumentService from '../../services/hrDocument.service'

export const PRINT_KEY = 'hr_document_print'

export default function DocumentPrint() {
  const navigate = useNavigate()
  const [downloading, setDownloading] = useState(false)
  let text = ''
  let tplId = ''
  let empId = ''
  try {
    text = sessionStorage.getItem(PRINT_KEY) || ''
    tplId = sessionStorage.getItem('hr_document_print_tpl') || ''
    empId = sessionStorage.getItem('hr_document_print_emp') || ''
  } catch { /* ignore */ }

  const handleDownload = async () => {
    if (!tplId || !empId) {
      toast.error('ไม่พบข้อมูลเอกสารสำหรับดาวน์โหลด PDF')
      return
    }
    try {
      setDownloading(true)
      await hrDocumentService.downloadTemplatePdf(tplId, empId)
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'ดาวน์โหลด PDF ไม่สำเร็จ')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="p-4">
      <div className="print:hidden flex gap-2 mb-4">
        <button className="phopy-btn" onClick={() => navigate('/hr/documents')}>
          <ArrowLeft size={16} /> กลับ
        </button>
        <button className="phopy-btn" onClick={() => window.print()}>
          <Printer size={16} /> พิมพ์
        </button>
        <button className="phopy-btn" onClick={handleDownload} disabled={downloading || !text}>
          <Download size={16} /> ดาวน์โหลด PDF
        </button>
      </div>
      {text ? (
        <div className="bg-white text-black p-8 max-w-3xl mx-auto" style={{ whiteSpace: 'pre-wrap' }} data-testid="print-text">
          {text}
        </div>
      ) : (
        <div className="phopy-card p-6">ไม่มีเอกสารให้พิมพ์ กรุณาสร้างเอกสารจากหน้าแม่แบบ</div>
      )}
    </div>
  )
}
