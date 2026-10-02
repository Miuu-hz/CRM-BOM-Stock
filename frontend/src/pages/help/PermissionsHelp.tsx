import { useEffect } from 'react'

const TOC = [
  { id: 'overview', label: 'สิทธิ์ทำงานอย่างไร' },
  { id: 'roles', label: 'ระดับสิทธิ์' },
  { id: 'departments', label: 'แผนก' },
  { id: 'presets', label: 'ตำแหน่งสำเร็จรูป' },
  { id: 'approval', label: 'การขออนุมัติ' },
  { id: 'custom', label: 'สิทธิ์รายคน' },
  { id: 'examples', label: 'ตัวอย่างการตั้งค่า' },
  { id: 'limits', label: 'ข้อควรรู้ (ตามจริง)' },
]

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 sm:p-6 scroll-mt-4">
      <h2 className="text-base font-bold text-[var(--fg-1)] mb-3">{title}</h2>
      <div className="space-y-3 text-sm text-[var(--fg-2)] leading-relaxed">{children}</div>
    </section>
  )
}

function Table({ head, rows }: { head: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="phopy-table w-full text-sm">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className="text-left">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) =>
                j === 0
                  ? <th key={j} scope="row" className="text-left font-medium text-[var(--fg-1)] whitespace-nowrap">{c}</th>
                  : <td key={j} className="text-[var(--fg-2)]">{c}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ExampleCard({ title, setting }: { title: string; setting: string }) {
  return (
    <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4">
      <h3 className="text-sm font-semibold text-[var(--fg-1)] mb-1">{title}</h3>
      <p className="text-xs text-[var(--fg-3)]">{setting}</p>
    </div>
  )
}

export default function PermissionsHelp() {
  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (id) document.getElementById(id)?.scrollIntoView()
  }, [])

  return (
    <div className="min-h-screen bg-[var(--bg)] px-4 py-8 sm:px-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="space-y-2">
          <h1 className="text-xl sm:text-2xl font-bold text-[var(--fg-1)]">ระบบสิทธิ์ผู้ใช้ — อธิบายแบบเข้าใจง่าย</h1>
          <p className="text-sm text-[var(--fg-3)] leading-relaxed">
            แต่ละคนในระบบเข้าถึงงานได้มากน้อยต่างกันตามสามอย่างประกอบกัน: ระดับสิทธิ์, แผนก และสิทธิ์พิเศษรายคน
            บวกกับการขออนุมัติสำหรับงานที่เกินวงเงิน หน้านี้อธิบายว่าแต่ละอย่างคืออะไร ปลดล็อกอะไร และควรตั้งอย่างไรให้เหมาะกับหน้าที่จริงของพนักงาน
          </p>
        </header>

        <nav aria-label="สารบัญ" className="bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl p-4">
          <h2 className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wide mb-2">สารบัญ</h2>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-sm">
            {TOC.map(item => (
              <li key={item.id}>
                <a href={`#${item.id}`} className="text-[var(--primary)] hover:underline">{item.label}</a>
              </li>
            ))}
          </ul>
        </nav>

        <Section id="overview" title="สิทธิ์ทำงานอย่างไร (3 อย่างประกอบกัน)">
          <ol className="list-decimal list-inside space-y-1.5">
            <li><strong className="text-[var(--fg-1)]">ระดับสิทธิ์ (role)</strong> = มีอำนาจแค่ไหน</li>
            <li><strong className="text-[var(--fg-1)]">แผนก</strong> = รับผิดชอบงานส่วนไหน</li>
            <li><strong className="text-[var(--fg-1)]">สิทธิ์รายคน (custom)</strong> = เปิด/ปิดพิเศษเฉพาะคน</li>
          </ol>
          <p>บวกกับ <strong className="text-[var(--fg-1)]">การขออนุมัติ</strong> — งานบางอย่างที่เกินวงเงินที่ร้านตั้งไว้ต้องมีคนอนุมัติก่อนถึงจะทำสำเร็จ</p>
          <p className="text-xs text-[var(--fg-4)] bg-[var(--surface-2)] border border-[var(--border)] rounded-lg p-3">
            หมายเหตุ: <strong>&quot;ตำแหน่ง (Preset)&quot;</strong> เป็นแค่ทางลัดที่ติ๊กแผนกให้อัตโนมัติ ไม่ได้เปลี่ยนระดับสิทธิ์ให้ — ต้องเลือกระดับสิทธิ์เองแยกต่างหาก
          </p>
        </Section>

        <Section id="roles" title="ระดับสิทธิ์">
          <Table
            head={['ระดับสิทธิ์', 'ทำอะไรได้']}
            rows={[
              ['Admin (ผู้ดูแลระบบ)', 'ทำได้ทุกอย่างในบริษัท — จัดการผู้ใช้, ตั้งค่าบริษัท/VAT/แม่แบบเอกสาร/เลขที่เอกสาร, MCP, อนุมัติทุกคำขอ, เปิด PO ที่ปิดแล้วกลับมา ไม่ถูกล็อกด้วยแผนก'],
              ['ผู้จัดการ', 'จัดการบัญชีธนาคาร, ลบลูกค้า, ยกเลิกใบแจ้งหนี้ขาย/ใบเสร็จ/ใบสั่งขาย, ยกเลิก/เปลี่ยนสถานะเอกสารจัดซื้อ, นำเงินเข้า-ออกลิ้นชัก POS งานอื่นขึ้นกับแผนก'],
              ['ผู้ใช้ระดับสูง', 'ยกเลิก/เปลี่ยนสถานะเอกสารจัดซื้อ (PR/PO/ใบรับสินค้า/ใบแจ้งหนี้ซื้อ/จ่ายเงิน/คืนของ), นำเงินเข้า-ออกลิ้นชัก POS, ลงบัญชีได้โดยไม่ต้องมีแผนก'],
              ['ผู้ใช้งาน', 'ใช้งานตามแผนกที่ได้รับ ปรับสต็อก/ยกเลิกบิล POS/แก้เอกสาร อาจต้องขออนุมัติตามที่ร้านตั้ง (เช่น เกิน ฿500)'],
            ]}
          />
          <p className="text-xs text-[var(--fg-4)]">
            <strong className="text-[var(--fg-3)]">Master</strong> — บัญชีเจ้าของระบบ Phopy ดูแลหลายบริษัท ไม่ต้องตั้งเอง
          </p>
        </Section>

        <Section id="departments" title="แผนก">
          <Table
            head={['แผนก', 'ปลดล็อกอะไร']}
            rows={[
              ['ขาย (SALES)', 'ออกใบแจ้งหนี้ขาย, รับชำระ, ออกใบกำกับเต็มรูปจากบิล POS'],
              ['จัดซื้อ (PURCHASE)', 'บันทึกใบแจ้งหนี้ซื้อ, จ่ายเงินผู้ขาย, แปลงใบขอซื้อเป็นใบสั่งซื้อ'],
              ['บัญชี (ACCOUNTING)', 'ลง/แก้/ลบสมุดรายวัน, แก้ผังบัญชี, ออกบิลได้ทั้งฝั่งขายและซื้อ'],
              ['แคชเชียร์ (POS)', 'ใช้ได้เฉพาะหน้าแคชเชียร์และจอครัว (เปิดบิล รับเงิน ค้นหา/สมัครสมาชิก เปิด-ปิดกะ ออกใบกำกับจากบิล) — ถ้ามีแผนกนี้แผนกเดียว ระบบจะซ่อนเมนูอื่นและกันการเข้าหน้าอื่นทั้งหมด'],
              ['CEO / IT', 'ทำได้เหมือนผู้ดูแลในงานที่ขึ้นกับแผนก (แต่จัดการผู้ใช้/ตั้งค่าบริษัทยังต้องเป็น Admin)'],
              ['คลัง / ผลิต / QC / การตลาด', 'ตอนนี้ใช้เป็นป้ายบอกหน้าที่ ยังไม่จำกัดสิทธิ์ (กำลังทยอยเพิ่ม)'],
            ]}
          />
        </Section>

        <Section id="presets" title="ตำแหน่งสำเร็จรูป">
          <Table
            head={['ตำแหน่ง', 'แผนกที่ติ๊กให้', 'ใช้กับใคร']}
            rows={[
              ['พนักงานขาย', 'ขาย', 'คนเปิดใบเสนอราคา/ใบสั่งขาย/ออกบิล'],
              ['แคชเชียร์', 'แคชเชียร์ (POS)', 'พนักงานหน้าร้าน ใช้แค่ POS'],
              ['นักบัญชี', 'บัญชี + จัดซื้อ', 'คนทำบัญชี/ออกบิลทั้งสองฝั่ง'],
              ['ผู้จัดการคลัง', 'คลัง + จัดซื้อ', 'คนดูแลของเข้า-ออกและสั่งซื้อ'],
              ['ผู้จัดการโรงงาน', 'ผลิต + QC + คลัง', 'หัวหน้าฝ่ายผลิต'],
              ['CEO / เจ้าของ', 'CEO', 'เจ้าของ/ผู้บริหาร (แนะนำตั้งระดับเป็น Admin)'],
            ]}
          />
          <p className="text-xs text-[var(--fg-4)] bg-[var(--surface-2)] border border-[var(--border)] rounded-lg p-3">
            เคล็ดลับ: เลือกระดับสิทธิ์ก่อน แล้วค่อยกดตำแหน่ง ติ๊กแผนกเพิ่มเองได้ภายหลัง
          </p>
        </Section>

        <Section id="approval" title="การขออนุมัติ">
          <p>งานที่อาจต้องขออนุมัติก่อนทำสำเร็จ:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>ปรับสต็อก</li>
            <li>ยกเลิกบิล POS</li>
            <li>แก้ไขเอกสารที่ออกแล้ว</li>
            <li>ยืนยันใบสั่งขาย</li>
            <li>ออกใบกำกับจาก POS</li>
          </ul>
          <p>
            ตั้งค่าได้ที่ <strong className="text-[var(--fg-1)]">ตั้งค่า &gt; การอนุมัติ</strong> (ตามระดับสิทธิ์ + วงเงินอนุมัติอัตโนมัติ)
            ผู้อนุมัติคือ Admin หรือคนที่ได้สิทธิ์อนุมัติรายคน คำขอที่รออนุมัติดูได้ที่เมนู &quot;อนุมัติ&quot;
          </p>
        </Section>

        <Section id="custom" title="สิทธิ์รายคน">
          <p>
            ใช้เปิด/ปิดพิเศษเฉพาะคน โดยทับค่าที่มาจากแผนก เช่นให้พนักงานขายคนหนึ่งลงบัญชีได้เป็นกรณีพิเศษ — แนะนำใช้เท่าที่จำเป็นเท่านั้น
          </p>
        </Section>

        <Section id="examples" title="ตัวอย่างการตั้งค่า">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ExampleCard title="แคชเชียร์หน้าร้าน" setting="ระดับสิทธิ์: ผู้ใช้งาน + ตำแหน่ง: แคชเชียร์" />
            <ExampleCard title="พนักงานขาย" setting="ระดับสิทธิ์: ผู้ใช้งาน + ตำแหน่ง: พนักงานขาย" />
            <ExampleCard title="คนทำบัญชี" setting="ระดับสิทธิ์: ผู้ใช้งาน + ตำแหน่ง: นักบัญชี" />
            <ExampleCard title="หัวหน้าร้าน/ผู้จัดการ" setting="ระดับสิทธิ์: ผู้จัดการ + แผนก: ขาย + จัดซื้อ" />
          </div>
        </Section>

        <Section id="limits" title="ข้อควรรู้ (ตามจริง)">
          <p>
            บางหน้ายังเปิดให้ทุกคนที่ล็อกอินใช้งานได้ (เช่น จัดซื้อ สต็อก ผลิต ข้อมูลลูกค้า/ผู้ขาย) — ถ้าต้องการให้พนักงานเห็นเฉพาะงานตัวเอง
            ให้ใช้ตำแหน่งแคชเชียร์สำหรับหน้าร้าน ส่วนแผนกอื่นกำลังทยอยจำกัดสิทธิ์เพิ่มเติม
          </p>
          <p>เปลี่ยนสิทธิ์แล้ว ให้ผู้ใช้ออกจากระบบแล้วเข้าใหม่ เมนูจึงจะอัปเดตตามสิทธิ์ล่าสุด</p>
        </Section>

        <footer className="text-xs text-[var(--fg-4)] text-center pt-2">
          อัปเดตล่าสุด: 29 ก.ย. 2569
        </footer>
      </div>
    </div>
  )
}
