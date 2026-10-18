import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

// Header ส่ง { openType, openId, openItem } มาทาง location.state ตอนคลิกผลค้นหา
// → หน้าปลายทางเปิดรายการนั้นทันที แล้วล้าง state ทิ้ง กัน back/refresh เปิดซ้ำ
export function useOpenFromSearch(open: (type: string, id: string, item: any) => void) {
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    const s = location.state as { openType?: string; openId?: string; openItem?: any } | null
    if (!s?.openId) return
    open(s.openType || '', s.openId, s.openItem)
    navigate(location.pathname + location.search, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])
}
