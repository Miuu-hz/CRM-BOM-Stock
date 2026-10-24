import * as THREE from 'three'
import { block, cyl, flat, getMat, createCanvasTexture, createLabelSprite } from './kit'

export interface ZoneTrendPoint {
  day: string
  value: number
}

export interface ZoneData {
  id: string
  name: string
  badge: string
  badgeColor: string
  kpi: string
  description: string
  cameraPosition: [number, number, number]
  cameraTarget: [number, number, number]
  zoneCenter: [number, number, number]
  zoneRadius: number
  details: {
    status: string
    activeItems: string
    capacity: string
    capacityPercent: number
    operator: string
    progressLabel?: string
    progressPercent?: number
    chartTitle: string
    chartUnit: string
    chartData: ZoneTrendPoint[]
    stats: Array<{ label: string; value: string; color?: string }>
    quickAction: { label: string; route: string }
  }
}

export const ZONES_DATA: Record<string, ZoneData> = {
  all: {
    id: 'all',
    name: 'ศูนย์ปฏิบัติการทั้งหมด (Full SME Campus)',
    badge: 'ALL',
    badgeColor: '#5B5CF0',
    kpi: '5 โซนปฏิบัติการทำงานพร้อมกัน',
    description:
      'ภาพรวมระบบบริหารจัดการห่วงโซ่อุปทานครบวงจร ตั้งแต่สั่งซื้อ ตรวจรับ ผลิต เก็บสต็อก ไลฟ์สดขาย และกระจายสินค้า',
    cameraPosition: [28, 25, 28],
    cameraTarget: [0, 1, 0],
    zoneCenter: [0, 0.05, 0],
    zoneRadius: 18,
    details: {
      status: 'ระบบปฏิบัติการปกติ 100% (Live Connected)',
      activeItems: 'ใบงานทั้งหมด: 6 งาน | 1,480 SKU ในคลัง',
      capacity: 'ความจุพื้นที่รวม: 78.4%',
      capacityPercent: 78.4,
      operator: 'ศูนย์กระจายสินค้าบางนา-ตราด (WH-01)',
      progressLabel: 'เป้าหมายคำสั่งซื้อรายวัน (1,280 / 1,500 ออเดอร์)',
      progressPercent: 85,
      chartTitle: 'แนวโน้มยอดขายรวม 7 วัน (พันบาท)',
      chartUnit: '฿k',
      chartData: [
        { day: 'จ.', value: 310 },
        { day: 'อ.', value: 345 },
        { day: 'พ.', value: 328 },
        { day: 'พฤ.', value: 392 },
        { day: 'ศ.', value: 420 },
        { day: 'ส.', value: 465 },
        { day: 'อา.', value: 389 },
      ],
      stats: [
        { label: 'ยอดจัดซื้อเข้าวันนี้', value: '฿142,500' },
        { label: 'ยอดขาย Multi-Channel', value: '฿389,400', color: '#16A34A' },
        { label: 'พัสดุรอส่งมอบ', value: '325 ชิ้น', color: '#F5A524' },
      ],
      quickAction: { label: 'ดูภาพรวมแดชบอร์ด ERP', route: '/' },
    },
  },
  procurement: {
    id: 'procurement',
    name: 'โซนจัดซื้อ & ตรวจรับสินค้า (Inbound & GR)',
    badge: 'GR',
    badgeColor: '#10B981',
    kpi: 'ตรวจรับแล้ว 4 คัน (PO-2026-089)',
    description:
      'ชานชาลาเทียบรถขนส่งวัตถุดิบและบรรจุภัณฑ์ มีจุดสแกนบาร์โค้ด ตรวจนับสต็อก และอนุมัติใบรับสินค้า (Goods Receipt)',
    cameraPosition: [-18, 12, -2],
    cameraTarget: [-11.5, 1.2, -10.5],
    zoneCenter: [-11.5, 0.05, -10.5],
    zoneRadius: 5.2,
    details: {
      status: 'กำลังตรวจรับสินค้า PO-2026-089',
      activeItems: 'ขวดแก้วเซรั่ม 30ml (5,000 ชิ้น), กล่องลูกฟูก (2,000 กล่อง)',
      capacity: 'ชานชาลารับเข้า: มีรถเทียบ 1 คัน (รอเข้า 2 คัน)',
      capacityPercent: 66,
      operator: 'นายนพดล มั่นคง (เจ้าหน้าที่ตรวจรับ GR/QC)',
      progressLabel: 'ความคืบหน้าตรวจรับ PO วันนี้ (4 / 5 ใบสั่งซื้อ)',
      progressPercent: 80,
      chartTitle: 'ความตรงเวลาของซัพพลายเออร์ (%)',
      chartUnit: '%',
      chartData: [
        { day: 'จ.', value: 96 },
        { day: 'อ.', value: 98 },
        { day: 'พ.', value: 95 },
        { day: 'พฤ.', value: 99 },
        { day: 'ศ.', value: 97 },
        { day: 'ส.', value: 98 },
        { day: 'อา.', value: 100 },
      ],
      stats: [
        { label: 'ใบสั่งซื้อวันนี้', value: '4 POs (รอตรวจ 1)' },
        { label: 'ซัพพลายเออร์', value: 'ไทยแพ็คเกจจิ้ง แอนด์ กลาส จำกัด' },
        { label: 'สถานะ QC วัตถุดิบ', value: 'ผ่านเกณฑ์ 100%', color: '#16A34A' },
      ],
      quickAction: { label: 'เปิดหน้าระบบจัดซื้อ (Purchase)', route: '/purchase' },
    },
  },
  production: {
    id: 'production',
    name: 'สายการผลิต & ประกอบบรรจุ (Production & BOM)',
    badge: 'WO',
    badgeColor: '#6366F1',
    kpi: 'ใบงาน #WO-2026-042 (ความคืบหน้า 76%)',
    description:
      'สายพานผลิตสแตนเลส พร้อมเครื่องซีลความร้อน แขนกลช่วยบรรจุขวด จอคิวงานผลิต และจุดตรวจสอบคุณภาพตามสูตร BOM',
    cameraPosition: [-18, 12, 16],
    cameraTarget: [-11.5, 1.2, 8],
    zoneCenter: [-11.5, 0.05, 8],
    zoneRadius: 5.5,
    details: {
      status: 'กำลังผลิต: เซรั่มบำรุงผิวสูตร 01 (Batch B-2610)',
      activeItems: 'เป้าหมาย 2,000 ชิ้น | บรรจุแล้ว 1,520 ชิ้น (76%)',
      capacity: 'ประสิทธิภาพสายพาน (OEE): 94.2%',
      capacityPercent: 94.2,
      operator: 'นายสมชาย มีสุข (Supervisor ฝ่ายผลิต)',
      progressLabel: 'Work Order #WO-2026-042 (1,520 / 2,000 ชิ้น)',
      progressPercent: 76,
      chartTitle: 'ผลผลิตต่อวัน (ชิ้น/วัน)',
      chartUnit: 'ชิ้น',
      chartData: [
        { day: 'จ.', value: 1850 },
        { day: 'อ.', value: 1920 },
        { day: 'พ.', value: 1780 },
        { day: 'พฤ.', value: 2050 },
        { day: 'ศ.', value: 2100 },
        { day: 'ส.', value: 1980 },
        { day: 'อา.', value: 1520 },
      ],
      stats: [
        { label: 'สูตรการผลิต (BOM)', value: 'BOM-SRM-01 (Ver 2.1)' },
        { label: 'การใช้ส่วนผสมหลัก', value: 'วิตามินบี 3, ไฮยาลูรอนิก' },
        { label: 'อัตราของเสีย (Scrap)', value: '0.4% (ต่ำกว่าเกณฑ์)', color: '#16A34A' },
      ],
      quickAction: { label: 'เปิดดูใบงานผลิต (Work Orders)', route: '/work-orders' },
    },
  },
  stock: {
    id: 'stock',
    name: 'คลังสินค้าพาเลท & สต็อก (Smart Racks)',
    badge: 'STOCK',
    badgeColor: '#F59E0B',
    kpi: 'ความจุแร็ค 78% (1,480 SKU)',
    description:
      'ชั้นวางพาเลทเหล็กอุตสาหกรรม 3 ชั้น จัดเรียงสต็อกสินค้าสำเร็จรูปและวัตถุดิบ พร้อมรถโฟล์กลิฟต์และหุ่นยนต์ AGV',
    cameraPosition: [10, 13, -1],
    cameraTarget: [3.5, 2, -10.5],
    zoneCenter: [3.5, 0.05, -10.5],
    zoneRadius: 5.5,
    details: {
      status: 'คลังสินค้าพร้อมจ่าย 92% (12 SKU ใกล้จุดสั่งซื้อ)',
      activeItems: 'พาเลทรวม 48 ตัว | พร้อมหยิบส่ง 32 พาเลท',
      capacity: 'ความจุพื้นที่จัดเก็บ: 78.0% (ว่าง 14 พาเลท)',
      capacityPercent: 78.0,
      operator: 'นายอนุชา พึ่งพา (หัวหน้าคลังสินค้า)',
      progressLabel: 'ความแม่นยำสต็อกจากการสแกน (Inventory Health)',
      progressPercent: 92,
      chartTitle: 'อัตราความพร้อมจ่ายสินค้า (%)',
      chartUnit: '%',
      chartData: [
        { day: 'จ.', value: 89 },
        { day: 'อ.', value: 91 },
        { day: 'พ.', value: 90 },
        { day: 'พฤ.', value: 93 },
        { day: 'ศ.', value: 94 },
        { day: 'ส.', value: 91 },
        { day: 'อา.', value: 92 },
      ],
      stats: [
        { label: 'จำนวน SKU ทั้งหมด', value: '1,480 รายการ' },
        { label: 'สินค้าใกล้จุด Reorder', value: '12 รายการ', color: '#F59E0B' },
        { label: 'การหมุนเวียน (Turnover)', value: '4.8 รอบ/ปี' },
      ],
      quickAction: { label: 'เปิดระบบสต็อกสินค้า (Stock)', route: '/stock' },
    },
  },
  sales: {
    id: 'sales',
    name: 'สตูดิโอไลฟ์สด & หน้าร้าน POS (Live & Retail)',
    badge: 'SALES',
    badgeColor: '#EC4899',
    kpi: 'ยอดขายวันนี้ ฿389,400 (TikTok 38%, Shopee 43%)',
    description:
      'ศูนย์รวมการขาย Omnichannel สตูดิโอไลฟ์สด TikTok/Shopee พร้อมจอ Command Wall โต๊ะแพ็กพัสดุ และเคาน์เตอร์ POS',
    cameraPosition: [11, 11, 17],
    cameraTarget: [3.5, 1.5, 8],
    zoneCenter: [3.5, 0.05, 8],
    zoneRadius: 5.5,
    details: {
      status: 'กำลังไลฟ์สด: ช่องหลัก TikTok Live (ผู้ชม 4.2k)',
      activeItems: 'ยอดสั่งซื้อในตะกร้า 185 ออเดอร์ | หน้าร้าน POS 48 บิล',
      capacity: 'โต๊ะแพ็กเกจจิ้ง: กำลังแพ็กกล่องที่ 240/325',
      capacityPercent: 73.8,
      operator: 'นางสาวสุดารัตน์ ใจดี (Host Live & หัวหน้าฝ่ายขาย)',
      progressLabel: 'แพ็กออเดอร์ไลฟ์สดวันนี้ (240 / 325 กล่อง)',
      progressPercent: 74,
      chartTitle: 'ยอดขายแยกตามวัน (พันบาท)',
      chartUnit: '฿k',
      chartData: [
        { day: 'จ.', value: 280 },
        { day: 'อ.', value: 310 },
        { day: 'พ.', value: 295 },
        { day: 'พฤ.', value: 350 },
        { day: 'ศ.', value: 410 },
        { day: 'ส.', value: 445 },
        { day: 'อา.', value: 389 },
      ],
      stats: [
        { label: 'ยอดขาย Shopee', value: '฿168,200 (43%)', color: '#EA580C' },
        { label: 'ยอดขาย TikTok Shop', value: '฿147,900 (38%)', color: '#EC4899' },
        { label: 'ยอดขายหน้าร้าน POS', value: '฿73,300 (19%)', color: '#16A34A' },
      ],
      quickAction: { label: 'เปิดหน้าการขาย (Sales & POS)', route: '/sales' },
    },
  },
  logistics: {
    id: 'logistics',
    name: 'ชานชาลาขนส่ง & กระจายพัสดุ (Outbound Logistics)',
    badge: 'SHIP',
    badgeColor: '#06B6D4',
    kpi: 'รอขนส่งเข้ารับ 325 กล่อง (Flash & SPX)',
    description:
      'จุดส่งมอบสินค้าและขนถ่ายพัสดุขึ้นรถตู้ขนส่งเอกชน มีสายพานคัดแยก แท่นปรับระดับ และกรงพัสดุแยกตามพื้นที่ปลายทาง',
    cameraPosition: [24, 11, 8],
    cameraTarget: [13.5, 1.2, 0],
    zoneCenter: [13.5, 0.05, 0],
    zoneRadius: 5.2,
    details: {
      status: 'รถขนส่ง Flash Express เทียบชานชาลา Bay 02',
      activeItems: 'รถตู้ทะเบียน 3ฒข-8821 | โหลดแล้ว 140/180 ชิ้น',
      capacity: 'รอบขนส่งเข้ารับ: รอบเย็น 16:30 น. (ตรงเวลา)',
      capacityPercent: 77.7,
      operator: 'นายประวิทย์ รวดเร็ว (เจ้าหน้าที่คัดแยก & จัดส่ง)',
      progressLabel: 'โหลดพัสดุขึ้นรถรอบเย็น (140 / 180 กล่อง)',
      progressPercent: 78,
      chartTitle: 'อัตราจัดส่งทันกำหนด On-Time Dispatch (%)',
      chartUnit: '%',
      chartData: [
        { day: 'จ.', value: 98 },
        { day: 'อ.', value: 99 },
        { day: 'พ.', value: 97 },
        { day: 'พฤ.', value: 99 },
        { day: 'ศ.', value: 98 },
        { day: 'ส.', value: 99 },
        { day: 'อา.', value: 99 },
      ],
      stats: [
        { label: 'Flash Express', value: '180 กล่อง (กำลังขึ้นของ)', color: '#F59E0B' },
        { label: 'SPX Express', value: '145 กล่อง (รอรับรอบ 17:00)', color: '#EA580C' },
        { label: 'On-time Dispatch', value: '98.8%', color: '#16A34A' },
      ],
      quickAction: { label: 'ดูรายงานการส่งมอบสินค้า', route: '/accounting/platform-settlement' },
    },
  },
}

export interface AnimatedItem {
  update: (delta: number, elapsed: number) => void
}

/**
 * Builds the entire SME 3D Digital Twin environment with Cutaway Isometric Architecture
 */
export function buildSmeCampus(): {
  group: THREE.Group
  animatedItems: AnimatedItem[]
  interactiveObjects: THREE.Object3D[]
  selectionRing: THREE.Mesh
} {
  const root = new THREE.Group()
  const animatedItems: AnimatedItem[] = []
  const interactiveObjects: THREE.Object3D[] = []

  // -------------------------------------------------------------
  // 1. ARCHITECTURAL CUTAWAY DIORAMA SLAB & WALLS
  // -------------------------------------------------------------
  // Outer dark-slate architectural pedestal base
  root.add(block(40, 0.9, 34, 0xCBD5E1, { x: 0, y: -0.5, z: 0, roughness: 0.7 }))
  // Main clean epoxy warehouse floor
  const mainFloor = flat(38, 32, 0xF1F5F9, { y: 0, roughness: 0.85 })
  root.add(mainFloor)

  // Back-North Cutaway Wall (z = -16) & Back-West Cutaway Wall (x = -19)
  const wallGroup = new THREE.Group()
  const wallColor = 0xFFFFFF
  const wallTrim = 0xE2E8F0

  // North Perimeter Wall
  wallGroup.add(block(38.4, 5.2, 0.45, wallColor, { x: 0, y: 2.6, z: -16, roughness: 0.6 }))
  wallGroup.add(block(38.4, 0.25, 0.55, wallTrim, { x: 0, y: 5.2, z: -16 })) // Top cap

  // High Industrial Clerestory Windows on North Wall
  ;[-12, -3, 6, 14].forEach((wx) => {
    wallGroup.add(block(4.6, 0.9, 0.5, 0x334155, { x: wx, y: 4.0, z: -16 }))
    wallGroup.add(
      block(4.4, 0.7, 0.52, 0xBAE6FD, {
        x: wx,
        y: 4.0,
        z: -16,
        emissive: 0x38BDF8,
        emissiveIntensity: 0.25,
      })
    )
  })

  // West Perimeter Wall (with Roll-up Bay Door cutout for Inbound)
  wallGroup.add(block(0.45, 5.2, 32.4, wallColor, { x: -19, y: 2.6, z: 0, roughness: 0.6 }))
  wallGroup.add(block(0.55, 0.25, 32.4, wallTrim, { x: -19, y: 5.2, z: 0 }))
  // Roll-up steel shutter door frame on West Wall (for Inbound Bay)
  wallGroup.add(block(0.55, 3.6, 4.8, 0x94A3B8, { x: -18.9, y: 1.8, z: -10.5 }))
  wallGroup.add(block(0.6, 0.8, 4.6, 0x64748B, { x: -18.85, y: 3.3, z: -10.5 })) // Rolled up hood

  // Interior Partition Cutaway Walls (Separating Production, Stock, and Live Studio)
  wallGroup.add(block(16, 3.0, 0.3, 0xF8FAFC, { x: -11, y: 1.5, z: -1.5 }))
  wallGroup.add(block(0.3, 3.0, 14, 0xF8FAFC, { x: -3, y: 1.5, z: 7.5 }))
  root.add(wallGroup)

  // Floor Safety Lane Striping
  const borderGroup = new THREE.Group()
  borderGroup.add(block(36, 0.02, 0.12, 0xF59E0B, { x: 0, y: 0.015, z: -1.5 }))
  borderGroup.add(block(0.12, 0.02, 30, 0xF59E0B, { x: -3, y: 0.015, z: 0 }))
  borderGroup.add(block(0.12, 0.02, 30, 0xF59E0B, { x: 9.5, y: 0.015, z: 0 }))
  root.add(borderGroup)

  // Dynamic Selection Ring (Highlights currently active zone)
  const ringGeom = new THREE.RingGeometry(4.6, 5.0, 48)
  const ringMat = getMat(0x5B5CF0, {
    emissive: 0x5B5CF0,
    emissiveIntensity: 0.8,
    transparent: true,
    opacity: 0.65,
    side: THREE.DoubleSide,
  })
  const selectionRing = new THREE.Mesh(ringGeom, ringMat)
  selectionRing.rotation.x = -Math.PI / 2
  selectionRing.position.set(0, 0.04, 0)
  selectionRing.visible = false
  root.add(selectionRing)

  animatedItems.push({
    update: (_, elapsed) => {
      if (selectionRing.visible) {
        const s = 1 + Math.sin(elapsed * 3.5) * 0.03
        selectionRing.scale.set(s, s, 1)
      }
    },
  })

  // -------------------------------------------------------------
  // 2. ZONE 1: PROCUREMENT & GOODS RECEIPT (Inbound & GR)
  // x: -11.5, z: -10.5
  // -------------------------------------------------------------
  const grGroup = new THREE.Group()
  grGroup.position.set(-11.5, 0, -10.5)
  grGroup.userData = { zoneId: 'procurement' }
  interactiveObjects.push(grGroup)

  // Concrete Loading Platform
  grGroup.add(block(8.5, 0.35, 7, 0xE2E8F0, { x: 0, y: 0.175, z: 0 }))
  // Rubber Dock Bumpers
  grGroup.add(block(0.35, 0.3, 0.9, 0x1E293B, { x: 4.25, y: 0.22, z: 1.5 }))
  grGroup.add(block(0.35, 0.3, 0.9, 0x1E293B, { x: 4.25, y: 0.22, z: -1.5 }))

  // Commercial Thai Pickup Box Truck
  const truck = new THREE.Group()
  truck.position.set(-4.2, 0.35, 0)
  truck.rotation.y = 0

  const wheelColor = 0x1E293B
  const rimColor = 0x94A3B8
  const wheelPositions = [
    [-1.4, 0.4, 1.0],
    [1.4, 0.4, 1.0],
    [-1.4, 0.4, -1.0],
    [1.4, 0.4, -1.0],
  ]
  wheelPositions.forEach(([wx, wy, wz]) => {
    truck.add(cyl(0.42, 0.42, 0.3, wheelColor, { x: wx, y: wy, z: wz, rx: Math.PI / 2 }))
    truck.add(cyl(0.24, 0.24, 0.32, rimColor, { x: wx, y: wy, z: wz, rx: Math.PI / 2 }))
  })

  truck.add(block(4.2, 0.25, 1.8, 0x334155, { x: 0, y: 0.5, z: 0 }))
  truck.add(block(1.5, 1.2, 1.85, 0xF8FAFC, { x: -1.2, y: 1.2, z: 0 }))
  truck.add(block(0.6, 0.55, 1.7, 0x38BDF8, { x: -1.6, y: 1.4, z: 0, roughness: 0.1, metalness: 0.8 }))
  truck.add(block(2.5, 1.75, 1.9, 0xFFFFFF, { x: 0.8, y: 1.48, z: 0 }))
  // Open rear cargo showing boxes inside
  truck.add(block(0.6, 0.55, 0.6, 0xCD853F, { x: 1.6, y: 0.95, z: -0.35 }))
  truck.add(block(0.6, 0.55, 0.6, 0xD29B63, { x: 1.6, y: 0.95, z: 0.35 }))
  grGroup.add(truck)

  // Inbound QC & GR Checkpoint Desk
  const qcDesk = new THREE.Group()
  qcDesk.position.set(1.2, 0.35, -1.6)
  qcDesk.add(block(1.6, 0.8, 0.8, 0x475569, { x: 0, y: 0.4, z: 0 }))
  const grScreenTex = createCanvasTexture(128, 96, (ctx) => {
    ctx.fillStyle = '#0F172A'
    ctx.fillRect(0, 0, 128, 96)
    ctx.fillStyle = '#10B981'
    ctx.fillRect(8, 8, 112, 28)
    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold 13px sans-serif'
    ctx.fillText('GR PASS ✓', 16, 26)
    ctx.fillStyle = '#94A3B8'
    ctx.font = '10px sans-serif'
    ctx.fillText('PO-2026-089', 16, 52)
    ctx.fillText('5,000 / 5,000 pcs', 16, 72)
  })
  qcDesk.add(
    block(0.55, 0.38, 0.05, 0x000000, {
      x: 0,
      y: 0.98,
      z: 0,
      rx: -0.3,
      material: new THREE.MeshStandardMaterial({ map: grScreenTex }),
    })
  )
  qcDesk.add(block(0.12, 0.22, 0.12, 0xF59E0B, { x: 0.5, y: 0.9, z: 0.1 }))
  grGroup.add(qcDesk)

  // Inbound Inspector Worker scanning boxes
  const grWorker = new THREE.Group()
  grWorker.position.set(0.2, 0.35, 0.2)
  grWorker.rotation.y = -Math.PI / 3
  grWorker.add(block(0.16, 0.65, 0.16, 0x1E293B, { x: -0.1, y: 0.32, z: 0 }))
  grWorker.add(block(0.16, 0.65, 0.16, 0x1E293B, { x: 0.1, y: 0.32, z: 0 }))
  grWorker.add(block(0.44, 0.6, 0.26, 0x4F46E5, { y: 0.92 }))
  grWorker.add(cyl(0.15, 0.15, 0.3, 0xFDE68A, { y: 1.4 }))
  grWorker.add(block(0.34, 0.12, 0.34, 0x4F46E5, { y: 1.54 }))
  grGroup.add(grWorker)

  // Pallet of Raw Material Cartons
  const grPallet = new THREE.Group()
  grPallet.position.set(1.5, 0.35, 1.3)
  grPallet.add(block(1.6, 0.15, 1.6, 0xD97706, { y: 0.075 }))
  grPallet.add(block(0.7, 0.6, 0.7, 0xCD853F, { x: -0.38, y: 0.45, z: -0.38 }))
  grPallet.add(block(0.7, 0.6, 0.7, 0xCD853F, { x: 0.38, y: 0.45, z: -0.38 }))
  grPallet.add(block(0.7, 0.6, 0.7, 0xD29B63, { x: -0.38, y: 0.45, z: 0.38 }))
  grPallet.add(block(0.7, 0.6, 0.7, 0xD29B63, { x: 0.38, y: 0.45, z: 0.38 }))
  grPallet.add(block(0.7, 0.5, 0.7, 0xCD853F, { x: 0, y: 0.95, z: 0 }))
  grGroup.add(grPallet)

  const grSprite = createLabelSprite('จัดซื้อ & ตรวจรับ GR', 'GR', '#10B981', 'PO-2026-089 • 4 คัน')
  grSprite.position.set(0, 4.3, 0)
  grGroup.add(grSprite)
  root.add(grGroup)

  // -------------------------------------------------------------
  // 3. ZONE 2: PRODUCTION & ASSEMBLY (SME Factory & BOM)
  // x: -11.5, z: 8
  // -------------------------------------------------------------
  const prodGroup = new THREE.Group()
  prodGroup.position.set(-11.5, 0, 8)
  prodGroup.userData = { zoneId: 'production' }
  interactiveObjects.push(prodGroup)

  prodGroup.add(flat(10.5, 9.5, 0xE0E7FF, { y: 0.01, roughness: 0.7 }))

  // Stainless Steel Conveyor Belt Assembly Line
  const conveyor = new THREE.Group()
  conveyor.add(block(6.2, 0.6, 1.1, 0xCBD5E1, { y: 0.65, metalness: 0.8, roughness: 0.2 }))
  conveyor.add(block(6.0, 0.05, 0.95, 0x1E293B, { y: 0.98 }))
  ;[
    [-2.7, -0.4],
    [0, -0.4],
    [2.7, -0.4],
    [-2.7, 0.4],
    [0, 0.4],
    [2.7, 0.4],
  ].forEach(([lx, lz]) => {
    conveyor.add(cyl(0.04, 0.04, 0.65, 0x94A3B8, { x: lx, y: 0.35, z: lz, metalness: 0.9 }))
  })

  // Moving Product Cartons on Conveyor
  const conveyorParcels: THREE.Mesh[] = []
  for (let i = 0; i < 6; i++) {
    const item = block(0.32, 0.42, 0.32, 0x5B5CF0, {
      x: -2.5 + i * 1.0,
      y: 1.22,
      z: 0,
      metalness: 0.25,
      roughness: 0.35,
    })
    conveyor.add(item)
    conveyorParcels.push(item)
  }
  prodGroup.add(conveyor)

  // Packaging / Heat Sealing Tunnel + Optical QC Scanner Arch
  const sealer = new THREE.Group()
  sealer.position.set(-0.5, 0, 0)
  sealer.add(block(1.2, 1.4, 1.35, 0xF8FAFC, { y: 1.65 }))
  sealer.add(block(0.9, 0.6, 1.38, 0x38BDF8, { y: 1.5, transparent: true, opacity: 0.45 }))
  // Status Beacon Light on top of machine (Green glowing)
  sealer.add(
    cyl(0.08, 0.08, 0.22, 0x10B981, {
      x: 0,
      y: 2.45,
      z: 0,
      emissive: 0x10B981,
      emissiveIntensity: 1.5,
    })
  )
  prodGroup.add(sealer)

  // New QC Vision Inspection Arch at end of line
  const qcArch = new THREE.Group()
  qcArch.position.set(1.8, 0, 0)
  qcArch.add(block(0.5, 1.2, 1.3, 0x334155, { y: 1.5 }))
  const qcLaser = block(0.04, 0.5, 0.9, 0x10B981, {
    y: 1.3,
    transparent: true,
    opacity: 0.35,
    emissive: 0x10B981,
    emissiveIntensity: 1.2,
  })
  qcArch.add(qcLaser)
  prodGroup.add(qcArch)

  // Articulated Robotic Pick-and-Place Arm beside conveyor
  const robotArm = new THREE.Group()
  robotArm.position.set(-1.8, 0, -1.1)
  robotArm.add(cyl(0.35, 0.42, 0.25, 0x334155, { y: 0.12 }))
  const armPivot = new THREE.Group()
  armPivot.position.set(0, 0.25, 0)
  armPivot.add(cyl(0.2, 0.2, 0.6, 0xF8FAFC, { y: 0.3 }))
  armPivot.add(block(0.18, 0.9, 0.18, 0x6366F1, { x: 0, y: 0.85, z: 0.2, rx: 0.4 }))
  armPivot.add(block(0.14, 0.65, 0.14, 0xF8FAFC, { x: 0, y: 1.25, z: 0.65, rx: 1.1 }))
  robotArm.add(armPivot)
  prodGroup.add(robotArm)

  animatedItems.push({
    update: (delta, elapsed) => {
      conveyorParcels.forEach((mesh) => {
        mesh.position.x += delta * 1.05
        if (mesh.position.x > 2.7) {
          mesh.position.x = -2.7
        }
      })
      armPivot.rotation.y = Math.sin(elapsed * 2.2) * 0.45
    },
  })

  // Wall-mounted Work Order Dashboard Monitor (WO-2026-042 - 76%)
  const woTex = createCanvasTexture(256, 128, (ctx) => {
    ctx.fillStyle = '#1E1B4B'
    ctx.fillRect(0, 0, 256, 128)
    ctx.fillStyle = '#818CF8'
    ctx.font = 'bold 20px sans-serif'
    ctx.fillText('WO #2026-042', 20, 34)
    ctx.fillStyle = '#FFFFFF'
    ctx.font = '15px sans-serif'
    ctx.fillText('เซรั่มบำรุงผิวสูตร 01 (BOM Verified)', 20, 64)
    ctx.fillStyle = '#312E81'
    ctx.fillRect(20, 82, 216, 22)
    ctx.fillStyle = '#10B981'
    ctx.fillRect(20, 82, 216 * 0.76, 22)
    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold 13px sans-serif'
    ctx.fillText('76% (1,520 / 2,000)', 68, 98)
  })
  prodGroup.add(
    block(2.4, 1.25, 0.08, 0x0F172A, {
      x: 0,
      y: 3.1,
      z: -3.2,
      material: new THREE.MeshStandardMaterial({ map: woTex }),
    })
  )

  // 2 Cleanroom Production Operators (Teal / Cyan hygiene suits matching Image 3)
  ;[-1.2, 1.1].forEach((ox) => {
    const worker = new THREE.Group()
    worker.position.set(ox, 0, 1.25)
    worker.rotation.y = Math.PI
    worker.add(block(0.16, 0.7, 0.16, 0x0F766E, { x: -0.12, y: 0.35, z: 0 }))
    worker.add(block(0.16, 0.7, 0.16, 0x0F766E, { x: 0.12, y: 0.35, z: 0 }))
    worker.add(block(0.46, 0.65, 0.28, 0x2DD4BF, { y: 0.98 }))
    worker.add(cyl(0.16, 0.16, 0.3, 0xFDE68A, { y: 1.48 }))
    worker.add(block(0.36, 0.14, 0.36, 0x99F6E4, { y: 1.62 }))
    prodGroup.add(worker)
  })

  const prodSprite = createLabelSprite('สายการผลิต & BOM', 'WO', '#6366F1', 'WO #2026-042 • 76%')
  prodSprite.position.set(0, 4.5, 0)
  prodGroup.add(prodSprite)
  root.add(prodGroup)

  // -------------------------------------------------------------
  // 4. ZONE 3: SMART STORAGE RACKS & WAREHOUSE (Stock)
  // x: 3.5, z: -10.5
  // -------------------------------------------------------------
  const stockGroup = new THREE.Group()
  stockGroup.position.set(3.5, 0, -10.5)
  stockGroup.userData = { zoneId: 'stock' }
  interactiveObjects.push(stockGroup)

  const rackBlue = 0x1D4ED8
  const beamOrange = 0xEA580C
  const palletWood = 0xD97706
  const boxCardboard = 0xCD853F

  function buildPalletRack(rx: number, rz: number): THREE.Group {
    const rack = new THREE.Group()
    rack.position.set(rx, 0, rz)

    const postHeight = 4.2
    const postPositions = [
      [-2.2, -0.6],
      [2.2, -0.6],
      [-2.2, 0.6],
      [2.2, 0.6],
      [0, -0.6],
      [0, 0.6],
    ]
    postPositions.forEach(([px, pz]) => {
      rack.add(block(0.12, postHeight, 0.12, rackBlue, { x: px, y: postHeight / 2, z: pz }))
    })

    const tiers = [0.5, 1.8, 3.1]
    tiers.forEach((ty) => {
      rack.add(block(4.52, 0.12, 0.08, beamOrange, { x: 0, y: ty, z: 0.6 }))
      rack.add(block(4.52, 0.12, 0.08, beamOrange, { x: 0, y: ty, z: -0.6 }))
      ;[-1.1, 1.1].forEach((px) => {
        rack.add(block(1.5, 0.1, 1.1, palletWood, { x: px, y: ty + 0.1, z: 0 }))
        rack.add(block(0.62, 0.52, 0.48, boxCardboard, { x: px - 0.34, y: ty + 0.42, z: -0.22 }))
        rack.add(block(0.62, 0.52, 0.48, boxCardboard, { x: px + 0.34, y: ty + 0.42, z: -0.22 }))
        rack.add(block(0.62, 0.52, 0.48, boxCardboard, { x: px - 0.34, y: ty + 0.42, z: 0.22 }))
        rack.add(block(0.62, 0.52, 0.48, boxCardboard, { x: px + 0.34, y: ty + 0.42, z: 0.22 }))
        rack.add(block(0.62, 0.4, 0.48, boxCardboard, { x: px, y: ty + 0.88, z: 0 }))
      })
    })
    return rack
  }

  stockGroup.add(buildPalletRack(0.5, -2.2))
  stockGroup.add(buildPalletRack(0.5, 0.8))
  stockGroup.add(buildPalletRack(0.5, 3.8))

  // Electric Compact Forklift (Orange/Black industrial style)
  const forklift = new THREE.Group()
  forklift.position.set(-3.2, 0, 1.2)
  forklift.rotation.y = Math.PI / 4
  forklift.add(block(1.6, 0.8, 1.1, 0xEA580C, { y: 0.55 }))
  forklift.add(cyl(0.04, 0.04, 1.2, 0x1E293B, { x: -0.6, y: 1.45, z: -0.45 }))
  forklift.add(cyl(0.04, 0.04, 1.2, 0x1E293B, { x: 0.4, y: 1.45, z: -0.45 }))
  forklift.add(cyl(0.04, 0.04, 1.2, 0x1E293B, { x: -0.6, y: 1.45, z: 0.45 }))
  forklift.add(cyl(0.04, 0.04, 1.2, 0x1E293B, { x: 0.4, y: 1.45, z: 0.45 }))
  forklift.add(block(1.1, 0.06, 1.0, 0x1E293B, { x: -0.1, y: 2.05, z: 0 }))
  forklift.add(block(0.12, 1.9, 0.9, 0x334155, { x: 0.85, y: 1.0, z: 0 }))

  const forkCarriage = new THREE.Group()
  forkCarriage.add(block(0.85, 0.05, 0.14, 0x64748B, { x: 1.25, y: 0.25, z: -0.25 }))
  forkCarriage.add(block(0.85, 0.05, 0.14, 0x64748B, { x: 1.25, y: 0.25, z: 0.25 }))
  forkCarriage.add(block(0.85, 0.08, 0.85, palletWood, { x: 1.3, y: 0.33, z: 0 }))
  forkCarriage.add(block(0.7, 0.55, 0.7, boxCardboard, { x: 1.3, y: 0.65, z: 0 }))
  forklift.add(forkCarriage)

  forklift.add(cyl(0.24, 0.24, 0.2, 0x0F172A, { x: 0.6, y: 0.24, z: 0.55, rx: Math.PI / 2 }))
  forklift.add(cyl(0.24, 0.24, 0.2, 0x0F172A, { x: 0.6, y: 0.24, z: -0.55, rx: Math.PI / 2 }))
  forklift.add(cyl(0.2, 0.2, 0.2, 0x0F172A, { x: -0.6, y: 0.2, z: 0, rx: Math.PI / 2 }))
  stockGroup.add(forklift)

  // Autonomous Mobile Robot (AGV) carrying parcel tote
  const agv = new THREE.Group()
  agv.position.set(-4.2, 0, 5.2)
  agv.add(cyl(0.55, 0.58, 0.28, 0x1E293B, { y: 0.16 }))
  agv.add(
    cyl(0.57, 0.57, 0.05, 0x06B6D4, {
      y: 0.18,
      emissive: 0x06B6D4,
      emissiveIntensity: 1.4,
    })
  )
  agv.add(block(0.65, 0.45, 0.65, 0xCD853F, { y: 0.52 }))
  stockGroup.add(agv)

  animatedItems.push({
    update: (_, elapsed) => {
      forkCarriage.position.y = (Math.sin(elapsed * 1.8) + 1) * 0.35
      agv.position.x = -4.2 + Math.sin(elapsed * 0.9) * 1.6
    },
  })

  const stockSprite = createLabelSprite('คลังพาเลท & สต็อก', 'STOCK', '#F59E0B', '1,480 SKU • ความจุ 78%')
  stockSprite.position.set(0.5, 4.9, 0.8)
  stockGroup.add(stockSprite)
  root.add(stockGroup)

  // -------------------------------------------------------------
  // 5. ZONE 4: LIVE COMMERCE STUDIO & POS STOREFRONT (Sales & POS)
  // x: 3.5, z: 8
  // -------------------------------------------------------------
  const salesGroup = new THREE.Group()
  salesGroup.position.set(3.5, 0, 8)
  salesGroup.userData = { zoneId: 'sales' }
  interactiveObjects.push(salesGroup)

  // Mint-green studio & retail zone flooring (matching Image 3 reference)
  salesGroup.add(flat(11.0, 9.5, 0xD1FAE5, { y: 0.01, roughness: 0.65 }))

  // Omnichannel Live Sales Command Wall on Partition
  const commandWallTex = createCanvasTexture(384, 160, (ctx) => {
    ctx.fillStyle = '#0F172A'
    ctx.fillRect(0, 0, 384, 160)
    ctx.fillStyle = '#38BDF8'
    ctx.font = 'bold 18px sans-serif'
    ctx.fillText('OMNICHANNEL LIVE SALES COMMAND', 20, 32)
    // Shopee Box
    ctx.fillStyle = '#EA580C'
    ctx.fillRect(20, 50, 105, 86)
    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold 14px sans-serif'
    ctx.fillText('Shopee 43%', 32, 78)
    ctx.font = 'bold 16px sans-serif'
    ctx.fillText('฿168,200', 32, 108)
    // TikTok Box
    ctx.fillStyle = '#EC4899'
    ctx.fillRect(138, 50, 105, 86)
    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold 14px sans-serif'
    ctx.fillText('TikTok 38%', 150, 78)
    ctx.font = 'bold 16px sans-serif'
    ctx.fillText('฿147,900', 150, 108)
    // POS Box
    ctx.fillStyle = '#10B981'
    ctx.fillRect(256, 50, 105, 86)
    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold 14px sans-serif'
    ctx.fillText('POS 19%', 268, 78)
    ctx.font = 'bold 16px sans-serif'
    ctx.fillText('฿73,300', 268, 108)
  })
  salesGroup.add(
    block(3.8, 1.6, 0.1, 0x0F172A, {
      x: -6.3,
      y: 2.1,
      z: -0.5,
      ry: Math.PI / 2,
      material: new THREE.MeshStandardMaterial({ map: commandWallTex }),
    })
  )

  // Sub-zone A: TikTok / Shopee Live Studio Corner
  const liveCorner = new THREE.Group()
  liveCorner.position.set(-2.5, 0, 1.2)

  // Vertical Shopee / TikTok Smartphone Standee Banner (from Image 3)
  const standeeTex = createCanvasTexture(128, 256, (ctx) => {
    ctx.fillStyle = '#0F172A'
    ctx.fillRect(0, 0, 128, 256)
    ctx.fillStyle = '#EC4899'
    ctx.fillRect(10, 14, 108, 228)
    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold 20px sans-serif'
    ctx.fillText('LIVE', 40, 60)
    ctx.font = 'bold 16px sans-serif'
    ctx.fillText('FLASH SALE', 18, 110)
    ctx.fillText('4.2K Views', 22, 150)
  })
  liveCorner.add(
    block(0.85, 1.75, 0.08, 0x1E293B, {
      x: -1.4,
      y: 1.0,
      z: 0.4,
      ry: Math.PI / 6,
      material: new THREE.MeshStandardMaterial({ map: standeeTex }),
    })
  )

  // Dual Ring Lights on Tripods
  const ringLightMat = getMat(0xFFFFFF, {
    emissive: 0xFEF08A,
    emissiveIntensity: 1.8,
    roughness: 0.2,
  })
  ;[-0.3, 0.5].forEach((rx, idx) => {
    const tripod = new THREE.Group()
    tripod.position.set(rx, 0, 0.6 - idx * 0.5)
    tripod.add(cyl(0.02, 0.02, 1.3, 0x1E293B, { y: 0.7 }))
    const ringGeom = new THREE.TorusGeometry(0.26, 0.035, 12, 24)
    const ringMesh = new THREE.Mesh(ringGeom, ringLightMat)
    ringMesh.position.set(0, 1.45, 0)
    ringMesh.rotation.y = -Math.PI / 4
    tripod.add(ringMesh)
    tripod.add(block(0.11, 0.22, 0.02, 0x0F172A, { x: 0, y: 1.45, z: 0, ry: -Math.PI / 4 }))
    liveCorner.add(tripod)
  })

  animatedItems.push({
    update: (_, elapsed) => {
      ringLightMat.emissiveIntensity = 1.6 + Math.sin(elapsed * 3.2) * 0.4
    },
  })
  salesGroup.add(liveCorner)

  // Sub-zone B: E-Commerce Packing Station & Bubble Wrap Dispenser
  const packStation = new THREE.Group()
  packStation.position.set(0.2, 0, -1.6)
  packStation.add(block(2.0, 0.78, 0.95, 0xCBD5E1, { y: 0.39, metalness: 0.5 }))
  packStation.add(
    cyl(0.35, 0.35, 1.4, 0xF8FAFC, {
      x: -0.3,
      y: 1.15,
      z: -0.2,
      rz: Math.PI / 2,
      transparent: true,
      opacity: 0.82,
    })
  )
  packStation.add(block(0.35, 0.26, 0.35, 0x1E293B, { x: 0.65, y: 0.9, z: 0.15 }))
  packStation.add(block(0.2, 0.01, 0.35, 0xFFFFFF, { x: 0.65, y: 1.04, z: 0.35, rx: 0.25 }))
  salesGroup.add(packStation)

  // Sub-zone C: Retail POS Cashier Counter
  const posCounter = new THREE.Group()
  posCounter.position.set(2.4, 0, 1.2)
  posCounter.add(block(2.1, 0.85, 0.85, 0x10B981, { y: 0.425 }))
  posCounter.add(block(2.15, 0.08, 0.9, 0xFFFFFF, { y: 0.88 }))
  const posScreenTex = createCanvasTexture(128, 96, (ctx) => {
    ctx.fillStyle = '#0F172A'
    ctx.fillRect(0, 0, 128, 96)
    ctx.fillStyle = '#38BDF8'
    ctx.font = 'bold 12px sans-serif'
    ctx.fillText('PHOPY POS', 12, 22)
    ctx.fillStyle = '#10B981'
    ctx.font = 'bold 16px sans-serif'
    ctx.fillText('฿1,250.00', 12, 48)
    ctx.fillStyle = '#94A3B8'
    ctx.font = '10px sans-serif'
    ctx.fillText('QR PromptPay ✓', 12, 72)
  })
  posCounter.add(
    block(0.48, 0.36, 0.06, 0x0F172A, {
      x: 0,
      y: 1.16,
      z: 0,
      rx: -0.25,
      material: new THREE.MeshStandardMaterial({ map: posScreenTex }),
    })
  )
  salesGroup.add(posCounter)

  const salesSprite = createLabelSprite('ไลฟ์สดขาย & หน้าร้าน POS', 'SALES', '#EC4899', '฿389,400 วันนี้')
  salesSprite.position.set(0, 4.3, 0)
  salesGroup.add(salesSprite)
  root.add(salesGroup)

  // -------------------------------------------------------------
  // 6. ZONE 5: OUTBOUND LOGISTICS & COURIER DISPATCH
  // x: 13.5, z: 0
  // -------------------------------------------------------------
  const shipGroup = new THREE.Group()
  shipGroup.position.set(13.5, 0, 0)
  shipGroup.userData = { zoneId: 'logistics' }
  interactiveObjects.push(shipGroup)

  shipGroup.add(block(5.8, 0.35, 12, 0xE2E8F0, { x: -0.6, y: 0.175, z: 0 }))

  function buildCourierVan(vz: number, brandColor: number, brandText: string): THREE.Group {
    const van = new THREE.Group()
    van.position.set(2.6, 0, vz)
    van.rotation.y = -Math.PI / 2

    const vanWheelPos = [
      [-1.4, 0.42, 1.05],
      [1.4, 0.42, 1.05],
      [-1.4, 0.42, -1.05],
      [1.4, 0.42, -1.05],
    ]
    vanWheelPos.forEach(([wx, wy, wz]) => {
      van.add(cyl(0.42, 0.42, 0.3, wheelColor, { x: wx, y: wy, z: wz, rx: Math.PI / 2 }))
      van.add(cyl(0.24, 0.24, 0.32, rimColor, { x: wx, y: wy, z: wz, rx: Math.PI / 2 }))
    })

    van.add(block(4.5, 0.28, 2.0, 0x1E293B, { y: 0.5 }))
    van.add(block(4.3, 1.8, 2.05, 0xFFFFFF, { x: 0, y: 1.5, z: 0 }))
    van.add(block(0.8, 0.7, 1.9, 0x38BDF8, { x: 1.75, y: 1.6, z: 0, roughness: 0.1, metalness: 0.8 }))

    const vanLogoTex = createCanvasTexture(256, 96, (ctx) => {
      ctx.fillStyle = `#${brandColor.toString(16).padStart(6, '0')}`
      ctx.fillRect(0, 0, 256, 96)
      ctx.fillStyle = '#FFFFFF'
      ctx.font = 'bold 34px "Plus Jakarta Sans", sans-serif'
      ctx.fillText(brandText, 22, 60)
    })
    van.add(
      block(2.1, 0.75, 0.05, 0xFFFFFF, {
        x: -0.4,
        y: 1.6,
        z: 1.04,
        material: new THREE.MeshStandardMaterial({ map: vanLogoTex }),
      })
    )
    // Open Rear Doors + Loaded Parcels inside
    van.add(block(0.06, 1.6, 0.95, 0xF8FAFC, { x: -2.2, y: 1.5, z: -0.6, ry: -0.7 }))
    van.add(block(0.06, 1.6, 0.95, 0xF8FAFC, { x: -2.2, y: 1.5, z: 0.6, ry: 0.7 }))
    van.add(block(0.7, 0.65, 0.7, 0xCD853F, { x: -1.6, y: 1.0, z: -0.35 }))
    van.add(block(0.7, 0.65, 0.7, 0xF59E0B, { x: -1.6, y: 1.0, z: 0.35 }))
    return van
  }

  shipGroup.add(buildCourierVan(-2.2, 0xF59E0B, 'FLASH EXP'))
  shipGroup.add(buildCourierVan(2.6, 0xEA580C, 'SPX EXPRESS'))

  // Parcel Staging Pallets
  shipGroup.add(block(1.3, 0.1, 1.3, palletWood, { x: -1.6, y: 0.4, z: -1.5 }))
  shipGroup.add(block(1.1, 0.75, 1.1, boxCardboard, { x: -1.6, y: 0.82, z: -1.5 }))
  shipGroup.add(block(1.3, 0.1, 1.3, palletWood, { x: -1.6, y: 0.4, z: 1.5 }))
  shipGroup.add(block(1.1, 0.75, 1.1, boxCardboard, { x: -1.6, y: 0.82, z: 1.5 }))

  const shipSprite = createLabelSprite('ขนส่ง & กระจายพัสดุ', 'SHIP', '#06B6D4', 'รอส่งมอบ 325 กล่อง')
  shipSprite.position.set(0, 4.3, 0)
  shipGroup.add(shipSprite)
  root.add(shipGroup)

  return {
    group: root,
    animatedItems,
    interactiveObjects,
    selectionRing,
  }
}