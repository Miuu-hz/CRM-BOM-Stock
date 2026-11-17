import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export interface LocationPickerMapProps {
  lat?: number | null
  lng?: number | null
  radius?: number | null
  onChange: (lat: number, lng: number) => void
}

const BKK_CENTER: [number, number] = [13.7563, 100.5018]
const BKK_ZOOM = 12
const PIN_ZOOM = 17

const isValidNum = (v: any): v is number => typeof v === 'number' && !isNaN(v)

// ponytail: standard 6 decimal places (~0.1m precision) for GPS coordinates
const round6 = (num: number): number => parseFloat(num.toFixed(6))

// ponytail: SVG divIcon avoids broken png marker assets from leaflet bundler
const PIN_SVG = `
<svg width="30" height="38" viewBox="0 0 30 38" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.35)); cursor: grab;">
  <path d="M15 0C6.716 0 0 6.716 0 15C0 26.25 15 38 15 38C15 38 30 26.25 30 15C30 6.716 23.284 0 15 0Z" fill="#2563eb" stroke="#ffffff" stroke-width="2"/>
  <circle cx="15" cy="15" r="5.5" fill="#ffffff"/>
</svg>
`.trim()

const createPinIcon = () =>
  L.divIcon({
    className: '!bg-transparent !border-0',
    html: PIN_SVG,
    iconSize: [30, 38],
    iconAnchor: [15, 38],
  })

export function LocationPickerMap({ lat, lng, radius, onChange }: LocationPickerMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const circleRef = useRef<L.Circle | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Map initialization
  useEffect(() => {
    if (!containerRef.current) return

    // ponytail: clear stale leaflet id on fast remount / strict mode
    const el = containerRef.current
    if ((el as any)._leaflet_id) {
      delete (el as any)._leaflet_id
    }

    const hasInitialCoords = isValidNum(lat) && isValidNum(lng)
    const initialCenter: [number, number] = hasInitialCoords ? [lat, lng] : BKK_CENTER
    const initialZoom = hasInitialCoords ? PIN_ZOOM : BKK_ZOOM

    const map = L.map(el, {
      center: initialCenter,
      zoom: initialZoom,
    })

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map)

    map.on('click', (e: L.LeafletMouseEvent) => {
      onChangeRef.current(round6(e.latlng.lat), round6(e.latlng.lng))
    })

    mapRef.current = map

    // ponytail: invalidateSize after mount when inside a card that may render late
    const timer = setTimeout(() => {
      map.invalidateSize()
    }, 100)

    // ponytail: ResizeObserver auto-invalidates size when container resizes or unhides
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
      map.invalidateSize()
    }) : null
    ro?.observe(el)

    return () => {
      clearTimeout(timer)
      ro?.disconnect()
      map.remove()
      mapRef.current = null
      markerRef.current = null
      circleRef.current = null
    }
  }, [])

  // Sync coords and radius
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const hasCoords = isValidNum(lat) && isValidNum(lng)
    const effectiveRadius = isValidNum(radius) && radius > 0 ? radius : 150

    if (!hasCoords) {
      if (markerRef.current) {
        markerRef.current.remove()
        markerRef.current = null
      }
      if (circleRef.current) {
        circleRef.current.remove()
        circleRef.current = null
      }
      map.setView(BKK_CENTER, BKK_ZOOM)
      return
    }

    const targetLatLng = L.latLng(lat, lng)

    if (!markerRef.current) {
      const marker = L.marker(targetLatLng, {
        icon: createPinIcon(),
        draggable: true,
      }).addTo(map)

      marker.on('drag', () => {
        const pos = marker.getLatLng()
        circleRef.current?.setLatLng(pos)
      })

      marker.on('dragend', () => {
        const pos = marker.getLatLng()
        onChangeRef.current(round6(pos.lat), round6(pos.lng))
      })

      markerRef.current = marker

      // ponytail: interactive: false lets clicks inside circle pass through to map
      const circle = L.circle(targetLatLng, {
        radius: effectiveRadius,
        color: '#2563eb',
        fillColor: '#3b82f6',
        fillOpacity: 0.15,
        weight: 2,
        interactive: false,
      }).addTo(map)

      circleRef.current = circle
      map.setView(targetLatLng, PIN_ZOOM)
    } else {
      const cur = markerRef.current.getLatLng()
      if (Math.abs(cur.lat - lat) > 1e-6 || Math.abs(cur.lng - lng) > 1e-6) {
        markerRef.current.setLatLng(targetLatLng)
        circleRef.current?.setLatLng(targetLatLng)
        if (map.getZoom() < 15) {
          map.setView(targetLatLng, PIN_ZOOM)
        } else {
          map.panTo(targetLatLng)
        }
      }

      if (circleRef.current) {
        circleRef.current.setRadius(effectiveRadius)
      }
    }
  }, [lat, lng, radius])

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative z-0"
      style={{ minHeight: '100%' }}
    />
  )
}

export default LocationPickerMap
