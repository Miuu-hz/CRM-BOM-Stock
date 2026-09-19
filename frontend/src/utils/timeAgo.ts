// "เมื่อ 2 ชม.ที่แล้ว" — ใช้ Intl.RelativeTimeFormat ที่มีในเบราว์เซอร์อยู่แล้ว ไม่ต้องลง lib
// ใช้ร่วมกันระหว่างฟีดความเคลื่อนไหวของจัดซื้อกับของขาย
export const timeAgo = (iso: string) => {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return ''
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['day', 86400000], ['hour', 3600000], ['minute', 60000],
  ]
  const rtf = new Intl.RelativeTimeFormat('th-TH', { numeric: 'auto', style: 'narrow' })
  for (const [unit, size] of units) {
    if (Math.abs(ms) >= size) return rtf.format(-Math.round(ms / size), unit)
  }
  return rtf.format(0, 'minute')
}
