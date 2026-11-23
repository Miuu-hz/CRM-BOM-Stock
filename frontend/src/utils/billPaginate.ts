// ============================================================
// แบ่งหน้าเอกสาร A4/A5 เองก่อนสั่งพิมพ์ (เรียกจาก printBill หลังหน้าต่างพิมพ์วาดเสร็จ)
//
// เดิมปล่อยให้เบราว์เซอร์ตัดหน้าเอง มีแค่กฎ "ห้ามตัดกลางก้อน" — บิลเกินหนึ่งหน้า
// ก้อนลายเซ็นทั้งก้อนเลยหล่นไปอยู่หน้า 2 คนเดียว ไม่มีหัวกระดาษ ไม่มีเลขที่ ไม่มีเลขหน้า
//
// ตอนนี้: ทุกแผ่นมีหัวกระดาษเต็ม (โลโก้/ชื่อเอกสาร/ผู้ขาย/ลูกค้า/เลขที่) + ป้าย "หน้า x / y (ต่อ)"
// หัวตารางซ้ำ · แถว ยอดยกไป/ยอดยกมา · ยอดรวม+ชำระเงิน+ลายเซ็นเป็นก้อนเดียว
// และต้องมีรายการตามไปอย่างน้อย KEEP_WITH_CLOSING แถว · ลายเซ็นชิดท้ายหน้าสุดท้ายเสมอ
//
// ponytail: วัดความสูงจริงจาก DOM (ฟอนต์/รูปโหลดแล้ว) ทีละแถว — O(rows) reflow ต่อหน้า พอสำหรับบิลหลักร้อยแถว
// ถ้าวันไหนบิลยาวหลักพันแถวค่อยเปลี่ยนเป็นวัดความสูงแถวครั้งเดียวแล้วคำนวณ
// ============================================================

const KEEP_WITH_CLOSING = 2
const PAGE_MM: Record<string, [number, number]> = { 'bill-a4': [210, 296.5], 'bill-a5': [148, 209.5] }

const money = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const amountOf = (tr: Element): number | null => {
  const cell = tr.querySelector('td.col-total')
  if (!cell) return null
  const v = Number((cell.textContent || '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(v) ? v : null
}

/** แบ่งหน้าเอกสารในหน้าต่างพิมพ์ — คืนจำนวนหน้า (0 = ไม่ได้แบ่ง ใช้ของเดิม) */
export function paginateBill(doc: Document): number {
  const paper = doc.querySelector<HTMLElement>('.unified-bill-paper.bill-a4, .unified-bill-paper.bill-a5')
  if (!paper) return 0
  const sizeCls = paper.classList.contains('bill-a5') ? 'bill-a5' : 'bill-a4'
  const [wMm, hMm] = PAGE_MM[sizeCls]

  const kids = Array.from(paper.children) as HTMLElement[]
  const tableSection = kids.find(k => k.querySelector('table.bill-items-table, table.wo-materials-table'))
  const table = tableSection?.querySelector<HTMLTableElement>('table.bill-items-table, table.wo-materials-table')
  const header = kids.find(k => k.classList.contains('bill-header'))
  const headGrid = kids.find(k => k.classList.contains('bill-head-grid'))
  if (!tableSection || !table || !header || !headGrid) return 0

  const ti = kids.indexOf(tableSection)
  const intro = kids.slice(kids.indexOf(headGrid) + 1, ti)               // เช่น การ์ดสรุปใบสั่งผลิต — หน้าแรกเท่านั้น
  const footInfo = kids.find(k => k.classList.contains('bill-footer-info'))
  const closing = kids.slice(ti + 1).filter(k => k !== footInfo)        // ยอดรวม/ชำระเงิน/หมายเหตุ/ลายเซ็น
  // ทำงานบนสำเนาทั้งหมด — ถ้าพังกลางทาง ของเดิมยังอยู่ครบ พิมพ์แบบเดิมได้
  const rows = Array.from(table.tBodies[0]?.rows || []).map(x => x.cloneNode(true) as HTMLTableRowElement)
  const cols = table.tHead?.rows[0]?.cells.length || 1
  // ยอดยกไป/ยกมา เฉพาะเอกสารที่ทุกแถวมีจำนวนเงิน (ใบสั่งผลิต/ใบส่งของไม่มีราคาก็ไม่ต้องมี)
  const amounts = rows.map(amountOf)
  const withCarry = rows.length > 0 && amounts.every(a => a !== null)

  // กรอบหน้าใหม่: ระยะขอบเท่ากับกระดาษเดิม (ตั้งได้ใน Settings) แต่ขนาดตายตัวต่อแผ่น
  const cs = doc.defaultView!.getComputedStyle(paper)
  const pad = `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`
  const root = doc.createElement('div')
  root.className = 'bill-pages'
  const container = paper.parentElement!
  container.insertBefore(root, paper)
  container.classList.add('is-paged')
  const pages: HTMLElement[] = []
  try {
    let body!: HTMLElement, tbody!: HTMLTableSectionElement

    const newPage = () => {
      const page = doc.createElement('div')
      page.className = `unified-bill-paper ${sizeCls} bill-page`   // คงคลาสขนาดไว้ สไตล์เฉพาะ A5 จะได้ยังทำงาน
      page.setAttribute('style', `${paper.getAttribute('style') || ''};width:${wMm}mm;max-width:none;height:${hMm}mm;min-height:0;padding:${pad}`)
      body = doc.createElement('div')
      body.className = 'bill-page-body'
      const h = header.cloneNode(true) as HTMLElement
      const badge = doc.createElement('div')
      badge.className = 'bill-page-badge'
      h.querySelector('.bill-title-block')?.appendChild(badge)
      body.append(h, headGrid.cloneNode(true))
      if (pages.length === 0) intro.forEach(n => body.appendChild(n.cloneNode(true)))
      const sec = tableSection.cloneNode(true) as HTMLElement
      const t = sec.querySelector('table')!
      tbody = t.tBodies[0]
      tbody.replaceChildren()
      if (pages.length > 0) sec.querySelectorAll('h3').forEach(x => x.remove())   // หัวข้อตารางใบสั่งผลิตไม่ต้องซ้ำ
      body.appendChild(sec)
      const foot = doc.createElement('div')
      foot.className = 'bill-page-foot'
      foot.innerHTML = `<div class="bill-page-foot-info"></div><div class="bill-page-no"></div>`
      if (footInfo) foot.firstElementChild!.appendChild(footInfo.cloneNode(true))
      page.append(body, foot)
      root.appendChild(page)
      pages.push(page)
    }
    const overflow = () => body.scrollHeight > body.clientHeight + 1
    const placedTotal = () => pages.reduce((s, p) => s + Array.from(p.querySelectorAll('tr[data-row]'))
      .reduce((a, tr) => a + (amounts[Number((tr as HTMLElement).dataset.row)] ?? 0), 0), 0)
    const carryRow = (label: string, amt: number) => {
      const tr = doc.createElement('tr')
      tr.className = 'bill-carry-row'
      tr.innerHTML = `<td colspan="${cols - 1}">${label}</td><td>${money(amt)}</td>`
      return tr
    }
    const dataRows = () => Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr[data-row]'))

    /** ปิดหน้าปัจจุบัน (ยอดยกไป) แล้วเปิดหน้าใหม่ (ยอดยกมา) — คืนแถวที่ต้องย้ายตามไป */
    const breakPage = (moving: HTMLTableRowElement[]) => {
      moving.forEach(r => r.remove())
      if (withCarry) {
        let c = carryRow('ยอดยกไป', placedTotal())
        tbody.appendChild(c)
        while (overflow() && dataRows().length > 1) {             // ยอดยกไปต้องพอที่ — ไม่พอก็ดันแถวท้ายตามไปด้วย
          const last = dataRows().pop()!
          last.remove(); moving.unshift(last); c.remove()
          c = carryRow('ยอดยกไป', placedTotal()); tbody.appendChild(c)
        }
      }
      const carried = placedTotal()
      newPage()
      if (withCarry) tbody.appendChild(carryRow('ยอดยกมา', carried))
      moving.forEach(r => tbody.appendChild(r))
    }

    newPage()
    rows.forEach((r, i) => {
      r.dataset.row = String(i)
      tbody.appendChild(r)
      if (overflow() && dataRows().length > 1) breakPage([r])
    })

    // ก้อนปิดท้าย — ลายเซ็น (footer) ดันไปชิดท้ายหน้า
    const closingBox = doc.createElement('div')
    closingBox.className = 'bill-closing'
    closing.forEach(n => closingBox.appendChild(n.cloneNode(true)))
    body.appendChild(closingBox)
    if (overflow()) {
      closingBox.remove()
      const onPage = dataRows()
      const take = Math.min(KEEP_WITH_CLOSING, Math.max(onPage.length - 1, 0))
      breakPage(onPage.slice(onPage.length - take))
      body.appendChild(closingBox)
    }
    // ก้อนท้ายยาวเกินหนึ่งหน้าเอง (หมายเหตุยาวมาก) — ยอมล้นดีกว่าโดนตัดหาย
    if (overflow()) body.style.overflow = 'visible'

    pages.forEach((p, i) => {
      p.querySelector('.bill-page-no')!.textContent = `หน้า ${i + 1} / ${pages.length}`
      p.querySelector('.bill-page-badge')!.textContent = pages.length > 1 ? `หน้า ${i + 1} / ${pages.length}${i ? ' (ต่อ)' : ''}` : ''
    })
  } catch (e) {
    root.remove(); container.classList.remove('is-paged')   // คืนสภาพเดิม แล้วให้ผู้เรียกพิมพ์แบบไม่แบ่งหน้า
    throw e
  }
  paper.remove()
  return pages.length
}
