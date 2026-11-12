import { Printer, ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export const PRINT_KEY = 'hr_document_print'

export default function DocumentPrint() {
  const navigate = useNavigate()
  let text = ''
  try {
    text = sessionStorage.getItem(PRINT_KEY) || ''
  } catch { /* ignore */ }

  return (
    <div className="p-4">
      <div className="print:hidden flex gap-2 mb-4">
        <button className="phopy-btn" onClick={() => navigate('/hr/documents')}>
          <ArrowLeft size={16} /> กลับ
        </button>
        <button className="phopy-btn" onClick={() => window.print()}>
          <Printer size={16} /> พิมพ์
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
