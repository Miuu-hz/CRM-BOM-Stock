import * as THREE from 'three'

// Material & Geometry cache to prevent duplicate WebGL programs and GPU memory bloat
const matCache = new Map<string, THREE.MeshStandardMaterial>()
const boxGeomCache = new Map<string, THREE.BoxGeometry>()
const cylGeomCache = new Map<string, THREE.CylinderGeometry>()
const planeGeomCache = new Map<string, THREE.PlaneGeometry>()

export function getMat(
  color: THREE.ColorRepresentation,
  options: {
    roughness?: number
    metalness?: number
    emissive?: THREE.ColorRepresentation
    emissiveIntensity?: number
    transparent?: boolean
    opacity?: number
    side?: THREE.Side
  } = {}
): THREE.MeshStandardMaterial {
  const key = `${color}_${options.roughness ?? 0.45}_${options.metalness ?? 0.15}_${options.emissive ?? '0'}_${options.emissiveIntensity ?? 1}_${options.opacity ?? 1}_${options.side ?? THREE.FrontSide}`
  if (matCache.has(key)) {
    return matCache.get(key)!
  }

  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.45,
    metalness: options.metalness ?? 0.15,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 1,
    transparent: options.transparent ?? (options.opacity !== undefined && options.opacity < 1),
    opacity: options.opacity ?? 1,
    side: options.side ?? THREE.FrontSide,
  })

  matCache.set(key, material)
  return material
}

export interface BlockOptions {
  x?: number
  y?: number
  z?: number
  rx?: number
  ry?: number
  rz?: number
  castShadow?: boolean
  receiveShadow?: boolean
  roughness?: number
  metalness?: number
  emissive?: THREE.ColorRepresentation
  emissiveIntensity?: number
  transparent?: boolean
  opacity?: number
  material?: THREE.Material
}

export function block(
  w: number,
  h: number,
  d: number,
  color: THREE.ColorRepresentation,
  opt: BlockOptions = {}
): THREE.Mesh {
  const gKey = `${w}_${h}_${d}`
  let geom = boxGeomCache.get(gKey)
  if (!geom) {
    geom = new THREE.BoxGeometry(w, h, d)
    boxGeomCache.set(gKey, geom)
  }

  const material = opt.material ?? getMat(color, opt)
  const mesh = new THREE.Mesh(geom, material)

  mesh.position.set(opt.x ?? 0, opt.y ?? 0, opt.z ?? 0)
  if (opt.rx) mesh.rotation.x = opt.rx
  if (opt.ry) mesh.rotation.y = opt.ry
  if (opt.rz) mesh.rotation.z = opt.rz

  mesh.castShadow = opt.castShadow ?? true
  mesh.receiveShadow = opt.receiveShadow ?? true
  return mesh
}

export interface CylOptions {
  segs?: number
  x?: number
  y?: number
  z?: number
  rx?: number
  ry?: number
  rz?: number
  castShadow?: boolean
  receiveShadow?: boolean
  roughness?: number
  metalness?: number
  emissive?: THREE.ColorRepresentation
  emissiveIntensity?: number
  transparent?: boolean
  opacity?: number
  material?: THREE.Material
}

export function cyl(
  rt: number,
  rb: number,
  h: number,
  color: THREE.ColorRepresentation,
  opt: CylOptions = {}
): THREE.Mesh {
  const segs = opt.segs ?? 16
  const gKey = `${rt}_${rb}_${h}_${segs}`
  let geom = cylGeomCache.get(gKey)
  if (!geom) {
    geom = new THREE.CylinderGeometry(rt, rb, h, segs)
    cylGeomCache.set(gKey, geom)
  }

  const material = opt.material ?? getMat(color, opt)
  const mesh = new THREE.Mesh(geom, material)

  mesh.position.set(opt.x ?? 0, opt.y ?? 0, opt.z ?? 0)
  if (opt.rx) mesh.rotation.x = opt.rx
  if (opt.ry) mesh.rotation.y = opt.ry
  if (opt.rz) mesh.rotation.z = opt.rz

  mesh.castShadow = opt.castShadow ?? true
  mesh.receiveShadow = opt.receiveShadow ?? true
  return mesh
}

export function flat(
  w: number,
  d: number,
  color: THREE.ColorRepresentation,
  opt: {
    x?: number
    y?: number
    z?: number
    rx?: number
    ry?: number
    rz?: number
    receiveShadow?: boolean
    roughness?: number
  } = {}
): THREE.Mesh {
  const gKey = `${w}_${d}`
  let geom = planeGeomCache.get(gKey)
  if (!geom) {
    geom = new THREE.PlaneGeometry(w, d)
    planeGeomCache.set(gKey, geom)
  }

  const material = getMat(color, { roughness: opt.roughness ?? 0.8 })
  const mesh = new THREE.Mesh(geom, material)

  mesh.rotation.x = opt.rx ?? -Math.PI / 2
  mesh.position.set(opt.x ?? 0, opt.y ?? 0, opt.z ?? 0)
  if (opt.ry) mesh.rotation.y = opt.ry
  if (opt.rz) mesh.rotation.z = opt.rz
  mesh.receiveShadow = opt.receiveShadow ?? true
  return mesh
}

/**
 * Creates dynamic high-res Canvas textures for signage, digital screens, and labels
 */
export function createCanvasTexture(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (ctx) {
    draw(ctx, w, h)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.anisotropy = 4
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * Billboard floating label with icon / badge / text and subtle border
 */
export function createLabelSprite(
  title: string,
  badgeText: string,
  badgeColor: string = '#5B5CF0',
  subtitle?: string
): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 420
  canvas.height = 108
  const ctx = canvas.getContext('2d')

  if (ctx) {
    // Soft rounded pill background
    ctx.fillStyle = 'rgba(255, 255, 255, 0.96)'
    ctx.shadowColor = 'rgba(15, 23, 42, 0.16)'
    ctx.shadowBlur = 14
    ctx.shadowOffsetY = 5

    const r = 26
    const w = 404
    const h = 92
    const ox = 8
    const oy = 6

    ctx.beginPath()
    ctx.moveTo(ox + r, oy)
    ctx.lineTo(ox + w - r, oy)
    ctx.quadraticCurveTo(ox + w, oy, ox + w, oy + r)
    ctx.lineTo(ox + w, oy + h - r)
    ctx.quadraticCurveTo(ox + w, oy + h, ox + w - r, oy + h)
    ctx.lineTo(ox + r, oy + h)
    ctx.quadraticCurveTo(ox, oy + h, ox, oy + h - r)
    ctx.lineTo(ox, oy + r)
    ctx.quadraticCurveTo(ox, oy, ox + r, oy)
    ctx.closePath()
    ctx.fill()

    // Subtle border
    ctx.shadowColor = 'transparent'
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.9)'
    ctx.lineWidth = 2
    ctx.stroke()

    // Badge pill
    ctx.fillStyle = badgeColor
    const br = 14
    const bx = ox + 16
    const by = oy + 20
    const bw = 82
    const bh = 52
    ctx.beginPath()
    ctx.moveTo(bx + br, by)
    ctx.lineTo(bx + bw - br, by)
    ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + br)
    ctx.lineTo(bx + bw, by + bh - br)
    ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - br, by + bh)
    ctx.lineTo(bx + br, by + bh)
    ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - br)
    ctx.lineTo(bx, by + br)
    ctx.quadraticCurveTo(bx, by, bx + br, by)
    ctx.closePath()
    ctx.fill()

    // Badge Text
    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold 20px "Plus Jakarta Sans", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(badgeText, bx + bw / 2, by + bh / 2)

    // Title Text
    ctx.fillStyle = '#0F172A'
    ctx.font = 'bold 22px "Plus Jakarta Sans", "Noto Sans Thai", sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(title, bx + bw + 16, subtitle ? oy + 36 : oy + h / 2)

    if (subtitle) {
      ctx.fillStyle = '#64748B'
      ctx.font = '600 15px "Plus Jakarta Sans", "Noto Sans Thai", sans-serif'
      ctx.fillText(subtitle, bx + bw + 16, oy + 62)
    }
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(4.1, 1.05, 1)
  sprite.renderOrder = 999
  return sprite
}