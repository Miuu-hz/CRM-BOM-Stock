import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { buildWarehouseScene, type WarehouseScene } from './warehouse-scene'
import type { TwinData, TwinPick } from './twin'

export interface TwinSceneHandle {
  zoom: (factor: number) => void
  rotate: (radians: number) => void
  reset: () => void
}

interface Props {
  data: TwinData | null
  brandName: string
  selectedId: string | null
  onPick: (pick: TwinPick) => void
}

const VIEW_HEIGHT = 46 // หน่วยโลกที่เห็นในแนวตั้งตอนซูม 1
const HOME = new THREE.Vector3(48, 42, 48)
const CLICK_SLOP_PX = 6

// กล้อง orthographic มุม isometric — หน้าตาแบบเกมวางแผน ไม่มีภาพบิดตามระยะ
export const DigitalTwinScene = forwardRef<TwinSceneHandle, Props>(({ data, brandName, selectedId, onPick }, ref) => {
  const mountRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<WarehouseScene | null>(null)
  const onPickRef = useRef(onPick)
  const handleRef = useRef<TwinSceneHandle | null>(null)
  onPickRef.current = onPick

  useImperativeHandle(ref, () => ({
    zoom: f => handleRef.current?.zoom(f),
    rotate: r => handleRef.current?.rotate(r),
    reset: () => handleRef.current?.reset(),
  }), [])

  useEffect(() => {
    const container = mountRef.current
    if (!container) return
    const aspect = () => (container.clientWidth || 1) / (container.clientHeight || 1)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xeef1f6)

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400)
    const fit = () => {
      const a = aspect()
      camera.left = (-VIEW_HEIGHT * a) / 2
      camera.right = (VIEW_HEIGHT * a) / 2
      camera.top = VIEW_HEIGHT / 2
      camera.bottom = -VIEW_HEIGHT / 2
      camera.updateProjectionMatrix()
    }
    camera.position.copy(HOME)
    fit()

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    container.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minZoom = 0.6
    controls.maxZoom = 3.2
    controls.minPolarAngle = 0.5
    controls.maxPolarAngle = 1.15
    controls.screenSpacePanning = true
    controls.target.set(-2, 0, 2)

    scene.add(new THREE.HemisphereLight(0xffffff, 0xdbe3f0, 1.1))
    const sun = new THREE.DirectionalLight(0xffffff, 2.1)
    sun.position.set(30, 50, 22)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 40, bottom: -40, near: 1, far: 140 })
    sun.shadow.bias = -0.0004
    sun.shadow.radius = 4
    scene.add(sun)

    const world = buildWarehouseScene(brandName)
    sceneRef.current = world
    scene.add(world.root)

    handleRef.current = {
      zoom: f => {
        camera.zoom = THREE.MathUtils.clamp(camera.zoom * f, controls.minZoom, controls.maxZoom)
        camera.updateProjectionMatrix()
      },
      rotate: r => {
        const offset = camera.position.clone().sub(controls.target)
        offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), r)
        camera.position.copy(controls.target).add(offset)
      },
      reset: () => {
        controls.target.set(-2, 0, 2)
        camera.position.copy(HOME)
        camera.zoom = 1
        camera.updateProjectionMatrix()
      },
    }

    // คลิก (ไม่ใช่ลาก) → หา userData.pick ไล่ขึ้นไปหาพ่อ
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const hit = (e: PointerEvent): TwinPick | null => {
      const r = renderer.domElement.getBoundingClientRect()
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      for (const h of raycaster.intersectObjects(world.interactive, true)) {
        for (let o: THREE.Object3D | null = h.object; o; o = o.parent) if (o.userData.pick) return o.userData.pick
      }
      return null
    }
    let down = { x: 0, y: 0 }
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY } }
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP_PX) return
      const p = hit(e)
      if (p) onPickRef.current(p)
    }
    const onMove = (e: PointerEvent) => {
      if (e.buttons) return
      renderer.domElement.style.cursor = hit(e) ? 'pointer' : 'grab'
    }
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)
    renderer.domElement.addEventListener('pointermove', onMove)

    const ro = new ResizeObserver(() => {
      if (!container.clientWidth || !container.clientHeight) return
      renderer.setSize(container.clientWidth, container.clientHeight)
      fit()
    })
    ro.observe(container)

    const clock = new THREE.Clock()
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const dt = clock.getDelta()
      const t = clock.getElapsedTime()
      controls.update()
      world.animated.forEach(a => a.update(dt, t))
      renderer.render(scene, camera)
    }
    tick()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointerup', onUp)
      renderer.domElement.removeEventListener('pointermove', onMove)
      controls.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      sceneRef.current = null
      handleRef.current = null
    }
  }, [brandName])

  useEffect(() => { if (data) sceneRef.current?.setData(data) }, [data, brandName])
  useEffect(() => { sceneRef.current?.setSelected(selectedId) }, [selectedId, data])

  return <div ref={mountRef} className="absolute inset-0 touch-none select-none" />
})

DigitalTwinScene.displayName = 'DigitalTwinScene'
