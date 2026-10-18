import * as THREE from 'three'
import { block, cyl, flat, getMat, createCanvasTexture } from './kit'
import type { TwinData, TwinPick } from './twin'

// ═══════════════════════════════════════════════════════════════
// ฉากคลังสินค้าแบบ isometric — ส่วนคงที่ (พื้น ถนน อาคาร ต้นไม้) สร้างครั้งเดียว
// ส่วนที่มาจากข้อมูลจริงสร้างใหม่ทุกครั้งที่ setData():
//   ท่าโหลด 3 ช่อง = ใบส่งของ READY (รถถอยเข้าท่า + พาเลทมีหมุด)
//   รถบนถนน      = ใบส่งของ SHIPPED (วิ่งวน)
//   รถจอดรอหน้าประตูข้าง = PO ที่อนุมัติแล้วรอรับของ
//   ชั้นวางกลางแจ้ง = สัดส่วน SKU ที่มีของ
//   ไฟบนอาคารผลิต = มีใบผลิตกำลังทำอยู่ไหม
// แกน: +x ไปทางขวา, +z เข้าหากล้อง (ถนนอยู่ด้านหน้า)
// ═══════════════════════════════════════════════════════════════

export interface AnimatedItem {
  update: (delta: number, elapsed: number) => void
}

const BLUE = 0x2d5be3
const BLUE_LIGHT = 0x3f6ef0
const WHITE = 0xf8fafc
const CARTON = 0xd6a76a
const CARTON_DARK = 0xc08d52
const PALLET = 0xb98a55
const GROUND = 0xeef1f6
const ROAD = 0xd6ddea

const DOCK_COUNT = 3
const DOCK_X = [-12, -6, 0]
const FACADE_Z = 4
const ROAD_Z_OUT = 15.6
const ROAD_HALF = 36
const MAX_ROAD_TRUCKS = 3
const MAX_INBOUND_TRUCKS = 2

const pickOf = (obj: THREE.Object3D, pick: TwinPick) => { obj.userData.pick = pick; return obj }

// ── textures ─────────────────────────────────────────────────────
function corrugated(base: string, line: string, repeat: number): THREE.MeshStandardMaterial {
  const tex = createCanvasTexture(64, 64, (ctx, w, h) => {
    ctx.fillStyle = base
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = line
    for (let x = 0; x < w; x += 8) ctx.fillRect(x, 0, 3, h)
  })
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(repeat, 1)
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.1 })
}

function logoTexture(brand: string, dark = false): THREE.CanvasTexture {
  return createCanvasTexture(512, 128, (ctx) => {
    ctx.clearRect(0, 0, 512, 128)
    ctx.fillStyle = '#2D5BE3'
    ctx.beginPath()
    ctx.roundRect(16, 24, 80, 80, 18)
    ctx.fill()
    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold 52px "Plus Jakarta Sans", "Noto Sans Thai", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText((brand.trim()[0] || 'P').toUpperCase(), 56, 66)
    ctx.fillStyle = dark ? '#FFFFFF' : '#1E3A8A'
    ctx.textAlign = 'left'
    ctx.font = 'bold 54px "Plus Jakarta Sans", "Noto Sans Thai", sans-serif'
    ctx.fillText(brand.slice(0, 14), 116, 66)
  })
}

function shaded(m: THREE.Mesh, x: number, y: number, z: number): THREE.Mesh {
  m.position.set(x, y, z)
  m.castShadow = m.receiveShadow = true
  return m
}

function signPlane(tex: THREE.Texture, w: number, h: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6 }),
  )
  return mesh
}

// ── props ────────────────────────────────────────────────────────
function tree(x: number, z: number, s = 1): THREE.Group {
  const g = new THREE.Group()
  g.position.set(x, 0, z)
  g.scale.setScalar(s)
  g.add(cyl(0.14, 0.2, 1.4, 0x8b6b4a, { y: 0.7, segs: 8 }))
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 1), getMat(0x74c07a, { roughness: 0.8 }))
  crown.position.y = 2.2
  crown.scale.set(1, 1.15, 1)
  crown.castShadow = true
  g.add(crown)
  return g
}

function cartonStack(layers: number): THREE.Group {
  const g = new THREE.Group()
  g.add(block(1.5, 0.16, 1.5, PALLET, { y: 0.08 }))
  for (let l = 0; l < layers; l++) {
    ;[[-0.36, -0.36], [0.36, -0.36], [-0.36, 0.36], [0.36, 0.36]].forEach(([x, z], i) => {
      g.add(block(0.68, 0.5, 0.68, (i + l) % 2 ? CARTON : CARTON_DARK, { x, y: 0.42 + l * 0.52, z }))
    })
  }
  return g
}

function mapPin(): THREE.Group {
  const g = new THREE.Group()
  const mat = getMat(BLUE, { roughness: 0.35, emissive: BLUE, emissiveIntensity: 0.15 })
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 16), mat)
  head.position.y = 0.95
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.33, 0.8, 20), mat)
  tip.rotation.x = Math.PI
  tip.position.y = 0.48
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), getMat(0xffffff))
  dot.position.set(0, 0.97, 0.3)
  ;[head, tip].forEach(m => { m.castShadow = true })
  g.add(head, tip, dot)
  return g
}

function truck(brand: THREE.Texture): THREE.Group {
  const g = new THREE.Group() // หน้ารถชี้ +x
  const wheel = (x: number, z: number) => {
    g.add(cyl(0.45, 0.45, 0.34, 0x1e293b, { x, y: 0.45, z, rx: Math.PI / 2, segs: 18 }))
    g.add(cyl(0.22, 0.22, 0.36, 0xcbd5e1, { x, y: 0.45, z, rx: Math.PI / 2, segs: 12 }))
  }
  ;[-2.7, -1.8, 2.5].forEach(x => { wheel(x, 1.0); wheel(x, -1.0) })
  g.add(block(7.2, 0.3, 1.9, 0x334155, { x: 0, y: 0.75 }))
  // ตู้สินค้า + แถบน้ำเงิน + โลโก้
  g.add(block(5.2, 2.5, 2.3, WHITE, { x: -1.0, y: 2.15, roughness: 0.4 }))
  g.add(block(5.22, 0.32, 2.32, BLUE, { x: -1.0, y: 1.05 }))
  ;[1, -1].forEach(side => {
    const logo = signPlane(brand, 3.6, 0.9)
    logo.position.set(-1.0, 2.3, side * 1.16)
    if (side < 0) logo.rotation.y = Math.PI
    g.add(logo)
  })
  // หัวรถ
  g.add(block(1.7, 2.1, 2.2, WHITE, { x: 2.75, y: 1.75, roughness: 0.35 }))
  g.add(block(0.08, 0.85, 1.9, 0x1e3a5f, { x: 3.62, y: 2.15, roughness: 0.1, metalness: 0.6 }))
  g.add(block(0.1, 0.5, 1.6, 0x1e293b, { x: 3.63, y: 1.1 }))
  g.add(block(1.72, 0.22, 2.22, BLUE, { x: 2.75, y: 0.95 }))
  return g
}

function forkliftMesh(): { group: THREE.Group; load: THREE.Group } {
  const g = new THREE.Group() // งาชี้ +x
  g.add(block(1.4, 0.7, 1.0, BLUE, { y: 0.55 }))
  g.add(block(0.8, 0.9, 0.9, WHITE, { x: -0.25, y: 1.3 }))
  g.add(block(0.9, 0.06, 0.95, 0x1e293b, { x: -0.1, y: 1.95 }))
  g.add(block(0.1, 1.9, 0.8, 0x334155, { x: 0.72, y: 1.05 }))
  ;[[0.45, 0.42], [0.45, -0.42], [-0.45, 0.42], [-0.45, -0.42]].forEach(([x, z]) =>
    g.add(cyl(0.22, 0.22, 0.18, 0x0f172a, { x, y: 0.22, z, rx: Math.PI / 2, segs: 12 })))
  const load = new THREE.Group()
  load.position.set(1.25, 0.25, 0)
  load.add(block(0.9, 0.06, 0.12, 0x64748b, { z: -0.25 }), block(0.9, 0.06, 0.12, 0x64748b, { z: 0.25 }))
  load.add(block(0.9, 0.1, 0.9, PALLET, { y: 0.08 }), block(0.75, 0.6, 0.75, CARTON, { y: 0.45 }))
  g.add(load)
  return { group: g, load }
}

// ── static world ─────────────────────────────────────────────────
function buildGround(root: THREE.Group) {
  root.add(block(76, 0.8, 54, 0xdde3ee, { y: -0.4, receiveShadow: true, castShadow: false }))
  root.add(flat(74, 52, GROUND, { y: 0.001 }))
  // ลานหน้าท่าโหลด + ลานจอดด้านข้าง
  root.add(flat(30, 8.6, 0xe3e8f0, { x: -6, y: 0.004, z: 8.6 }))
  root.add(flat(9, 22, 0xe3e8f0, { x: -23, y: 0.004, z: 0 }))
  // ถนน 2 เลน + เส้นประ + ขอบทาง
  root.add(flat(ROAD_HALF * 2, 7, ROAD, { y: 0.006, z: 17 }))
  for (let x = -ROAD_HALF + 2; x < ROAD_HALF; x += 4.5) root.add(block(2.2, 0.02, 0.18, 0xffffff, { x, y: 0.02, z: 17, castShadow: false }))
  ;[13.6, 20.4].forEach(z => root.add(block(ROAD_HALF * 2, 0.03, 0.12, 0xffffff, { y: 0.02, z, castShadow: false })))
  // เส้นเหลืองช่องจอดหน้าท่า
  DOCK_X.forEach(x => [-1.6, 1.6].forEach(dx =>
    root.add(block(0.1, 0.02, 7.6, 0xf5b942, { x: x + dx, y: 0.012, z: 8.4, castShadow: false }))))
}

function buildWarehouse(root: THREE.Group, brand: THREE.Texture): THREE.Group {
  const g = new THREE.Group()
  pickOf(g, { kind: 'site' })
  const W = 22, D = 16, H = 5.5, cx = -6, cz = -4
  const wall = corrugated('#2D5BE3', '#264FD0', 12)
  g.add(shaded(new THREE.Mesh(new THREE.BoxGeometry(W, H, D), wall), cx, H / 2, cz))
  // ผนังหน้าสีขาวช่วงประตู + ประตูท่าโหลด (เห็นกล่องข้างใน)
  g.add(block(W - 3, 4.2, 0.3, 0xe9eef7, { x: cx - 0.5, y: 2.1, z: FACADE_Z + 0.05 }))
  DOCK_X.forEach(x => {
    g.add(block(3.2, 3.3, 0.34, 0x1b2540, { x, y: 1.75, z: FACADE_Z + 0.08 }))
    g.add(block(3.6, 0.18, 0.5, WHITE, { x, y: 3.5, z: FACADE_Z + 0.2 }))
    g.add(block(3.8, 0.12, 1.1, BLUE, { x, y: 3.9, z: FACADE_Z + 0.5 }))
    g.add(block(0.8, 0.7, 0.6, CARTON, { x: x - 0.6, y: 0.45, z: FACADE_Z - 0.1 }))
    g.add(block(0.8, 0.7, 0.6, CARTON_DARK, { x: x + 0.5, y: 0.45, z: FACADE_Z - 0.1 }))
    g.add(block(0.7, 0.6, 0.6, CARTON, { x: x - 0.1, y: 1.1, z: FACADE_Z - 0.1 }))
    g.add(block(3.4, 0.3, 1.2, 0x9aa6b8, { x, y: 0.15, z: FACADE_Z + 0.75 })) // แท่นปรับระดับ
  })
  // ป้ายชื่อเหนือประตู
  const sign = signPlane(brand, 7, 1.75)
  sign.position.set(cx + 5, 4.75, FACADE_Z + 0.12)
  g.add(sign)
  // หลังคาจั่ว + ปลายจั่ว
  const roofMat = corrugated('#3F6EF0', '#3561DE', 14)
  const pitch = 0.24
  const rise = (D / 2) * Math.tan(pitch)
  const slope = new THREE.BoxGeometry(W + 0.8, 0.28, D / 2 / Math.cos(pitch) + 0.5)
  ;[1, -1].forEach(side => {
    const p = new THREE.Mesh(slope, roofMat)
    p.position.set(cx, H + rise / 2 + 0.14, cz + side * D / 4)
    p.rotation.x = side * pitch
    p.castShadow = p.receiveShadow = true
    g.add(p)
  })
  g.add(block(W + 0.9, 0.3, 0.5, WHITE, { x: cx, y: H + rise + 0.2, z: cz }))
  const gable = new THREE.Shape([new THREE.Vector2(-D / 2, 0), new THREE.Vector2(D / 2, 0), new THREE.Vector2(0, rise)])
  const gableGeo = new THREE.ExtrudeGeometry(gable, { depth: 0.3, bevelEnabled: false })
  ;[cx - W / 2, cx + W / 2 - 0.3].forEach(x => {
    const m = new THREE.Mesh(gableGeo, getMat(BLUE))
    m.rotation.y = Math.PI / 2
    m.position.set(x, H, cz)
    m.castShadow = true
    g.add(m)
  })
  // โลโก้บนหลังคาด้านหน้า
  const badge = new THREE.Mesh(new THREE.CircleGeometry(1.5, 40), new THREE.MeshStandardMaterial({
    map: createCanvasTexture(256, 256, (ctx) => {
      ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(128, 128, 120, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#2D5BE3'; ctx.beginPath(); ctx.roundRect(78, 78, 100, 100, 22); ctx.fill()
    }),
  }))
  badge.position.set(cx - 4, H + rise / 2 + 0.31, cz + D / 4)
  badge.rotation.x = -Math.PI / 2 + pitch
  g.add(badge)
  // ประตูข้างฝั่งตะวันตก (ขาเข้า)
  g.add(block(0.34, 3.3, 3.4, 0x1b2540, { x: cx - W / 2 - 0.05, y: 1.75, z: 0 }))
  g.add(block(0.5, 0.12, 3.8, BLUE, { x: cx - W / 2 - 0.3, y: 3.6, z: 0 }))
  root.add(g)
  return g
}

function buildAnnex(root: THREE.Group): { group: THREE.Group; beacon: THREE.Mesh } {
  const g = new THREE.Group()
  pickOf(g, { kind: 'production' })
  g.position.set(11, 0, -8)
  g.add(shaded(new THREE.Mesh(new THREE.BoxGeometry(9, 4.2, 8), corrugated('#2D5BE3', '#264FD0', 6)), 0, 2.1, 0))
  g.add(block(9.4, 0.3, 8.4, BLUE_LIGHT, { y: 4.35 }))
  g.add(block(6, 2.6, 0.2, 0xe9eef7, { y: 1.5, z: 4.05 }))
  g.add(block(2.4, 2.4, 0.22, 0x1b2540, { x: -1.4, y: 1.25, z: 4.12 }))
  ;[1.4, 2.6].forEach(x => g.add(block(0.9, 0.9, 0.22, 0x9cc3ff, { x, y: 1.9, z: 4.12, emissive: 0x9cc3ff, emissiveIntensity: 0.25 })))
  // ปล่องระบายอากาศ
  ;[-2.5, 0, 2.5].forEach(x => g.add(cyl(0.35, 0.35, 0.6, 0xcbd5e1, { x, y: 4.8, z: -1.5 })))
  const beacon = cyl(0.22, 0.22, 0.4, 0x94a3b8, { x: 3.6, y: 4.7, z: 3.4, emissive: 0x000000 })
  beacon.material = (beacon.material as THREE.MeshStandardMaterial).clone()
  g.add(beacon)
  root.add(g)
  return { group: g, beacon }
}

function buildOffice(root: THREE.Group) {
  const tex = createCanvasTexture(128, 256, (ctx) => {
    ctx.fillStyle = '#E8ECF3'; ctx.fillRect(0, 0, 128, 256)
    ctx.fillStyle = '#9DB4E8'
    for (let y = 18; y < 250; y += 34) for (let x = 12; x < 120; x += 28) ctx.fillRect(x, y, 18, 20)
  })
  const m = new THREE.Mesh(new THREE.BoxGeometry(8, 10, 7), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }))
  m.position.set(25, 5, -14)
  m.castShadow = m.receiveShadow = true
  root.add(m)
  root.add(block(8.3, 0.3, 7.3, 0xcfd6e2, { x: 25, y: 10.15, z: -14 }))
}

function buildRack(root: THREE.Group): THREE.Group {
  const g = new THREE.Group()
  pickOf(g, { kind: 'rack' })
  g.position.set(12, 0, 3)
  ;[-3.3, -1.1, 1.1, 3.3].forEach(x => [-0.7, 0.7].forEach(z => g.add(block(0.14, 4.3, 0.14, BLUE, { x, y: 2.15, z }))))
  ;[0.25, 1.65, 3.05].forEach(y => [-0.7, 0.7].forEach(z => g.add(block(6.8, 0.12, 0.1, 0xf59e0b, { y, z }))))
  root.add(g)
  return g
}

// ── public builder ───────────────────────────────────────────────
export interface WarehouseScene {
  root: THREE.Group
  animated: AnimatedItem[]
  interactive: THREE.Object3D[]
  setData: (d: TwinData) => void
  setSelected: (id: string | null) => void
}

export function buildWarehouseScene(brandName: string): WarehouseScene {
  const root = new THREE.Group()
  const animated: AnimatedItem[] = []
  const brand = logoTexture(brandName || 'Phopy')
  buildGround(root)
  const warehouse = buildWarehouse(root, brand)
  const annex = buildAnnex(root)
  buildOffice(root)
  const rack = buildRack(root)
  ;[[-30, -20], [-24, -21], [-14, -19], [-4, -20], [6, -19], [18, -20], [31, -6], [31, 2], [30, 9], [-31, -10], [-31, 8], [20, 8], [24, 5]]
    .forEach(([x, z], i) => root.add(tree(x, z, 0.85 + (i % 3) * 0.15)))

  const forklift = forkliftMesh()
  forklift.group.position.set(3, 0, 10.8)
  root.add(forklift.group)
  animated.push({
    update: (_, t) => {
      // วิ่งไป-กลับระหว่างท่าโหลดกับชั้นวาง ยกงาขึ้นลงตอนถึงปลายทาง
      const phase = (Math.sin(t * 0.45) + 1) / 2
      forklift.group.position.x = 3 + phase * 5.5
      forklift.group.rotation.y = Math.cos(t * 0.45) > 0 ? 0 : Math.PI
      forklift.load.position.y = 0.25 + Math.max(0, Math.abs(Math.cos(t * 0.45)) - 0.85) * 6
    },
  })

  // ── dynamic layer ──
  const dynamic = new THREE.Group()
  root.add(dynamic)
  let dynAnimated: AnimatedItem[] = []
  animated.push({ update: (dt, t) => dynAnimated.forEach(a => a.update(dt, t)) })
  const byId = new Map<string, THREE.Object3D>()
  const interactive: THREE.Object3D[] = [warehouse, annex.group, rack]

  const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.55, 48), getMat(BLUE, {
    emissive: BLUE, emissiveIntensity: 0.6, transparent: true, opacity: 0.75, side: THREE.DoubleSide,
  }))
  ring.rotation.x = -Math.PI / 2
  ring.visible = false
  root.add(ring)
  let selected: THREE.Object3D | null = null
  let selectedId: string | null = null
  animated.push({
    update: (_, t) => {
      if (!selected) return
      const p = new THREE.Vector3()
      selected.getWorldPosition(p)
      ring.position.set(p.x, 0.05, p.z)
      ring.scale.setScalar(1 + Math.sin(t * 4) * 0.06)
    },
  })

  function setData(d: TwinData) {
    dynamic.clear()
    byId.clear()
    dynAnimated = []
    interactive.length = 3

    // ท่าโหลด: ใบส่งของที่พร้อมขึ้นรถ
    const ready = d.outbound.list.filter(x => x.status === 'READY').slice(0, DOCK_COUNT)
    ready.forEach((doc, i) => {
      const t = pickOf(truck(brand), { kind: 'shipment', id: doc.id })
      t.rotation.y = -Math.PI / 2
      t.position.set(DOCK_X[i], 0, FACADE_Z + 4.3)
      dynamic.add(t)
      interactive.push(t)
      byId.set(doc.id, t)
      const stack = pickOf(cartonStack(2), { kind: 'shipment', id: doc.id })
      stack.position.set(DOCK_X[i] + 2.6, 0, FACADE_Z + 2)
      const pin = mapPin()
      pin.position.y = 1.4
      stack.add(pin)
      dynamic.add(stack)
      interactive.push(stack)
      const phase = i * 1.3
      dynAnimated.push({ update: (_, el) => { pin.position.y = 1.5 + Math.sin(el * 2.4 + phase) * 0.15 } })
    })

    // รถที่ออกไปส่งแล้ว วิ่งบนถนน
    d.outbound.list.filter(x => x.status === 'SHIPPED').slice(0, MAX_ROAD_TRUCKS).forEach((doc, i) => {
      const t = pickOf(truck(brand), { kind: 'shipment', id: doc.id })
      t.position.set(0, 0, ROAD_Z_OUT)
      dynamic.add(t)
      interactive.push(t)
      byId.set(doc.id, t)
      const offset = (i * ROAD_HALF * 2) / MAX_ROAD_TRUCKS
      dynAnimated.push({
        update: (_, el) => { t.position.x = ((el * 2.2 + offset) % (ROAD_HALF * 2)) - ROAD_HALF },
      })
    })

    // ใบสั่งซื้อรอรับของ = รถจอดรอที่ประตูข้าง
    d.inbound.list.slice(0, MAX_INBOUND_TRUCKS).forEach((po, i) => {
      const t = pickOf(truck(brand), { kind: 'inbound', id: po.id })
      t.rotation.y = Math.PI / 2
      t.position.set(-21.5 - i * 3.2, 0, 1)
      dynamic.add(t)
      interactive.push(t)
      byId.set(po.id, t)
    })

    // ชั้นวาง: 3 ชั้น × 3 ช่อง เติมตามสัดส่วน SKU ที่มีของ
    const slots = 9
    const ratio = d.stock.sku ? d.stock.inStock / d.stock.sku : 0
    const filled = Math.round(slots * Math.min(1, ratio))
    for (let s = 0; s < filled; s++) {
      const stack = cartonStack(s % 3 === 2 ? 1 : 2)
      stack.scale.setScalar(0.85)
      stack.position.set(rack.position.x - 2.2 + (s % 3) * 2.2, [0.31, 1.71, 3.11][Math.floor(s / 3)], rack.position.z)
      dynamic.add(stack)
    }

    // ไฟบนอาคารผลิต: เขียว = มีใบผลิตกำลังทำ
    const beaconMat = annex.beacon.material as THREE.MeshStandardMaterial
    const on = d.production.active > 0
    beaconMat.color.set(on ? 0x22c55e : 0x94a3b8)
    beaconMat.emissive.set(on ? 0x22c55e : 0x000000)
    beaconMat.emissiveIntensity = on ? 1.4 : 0

    setSelected(selectedId) // วัตถุถูกสร้างใหม่ทุกรอบ — ชี้วงแหวนไปที่ตัวใหม่ของเอกสารเดิม
  }

  function setSelected(id: string | null) {
    selectedId = id
    selected = id ? byId.get(id) ?? null : null
    ring.visible = !!selected
  }

  return { root, animated, interactive, setData, setSelected }
}
