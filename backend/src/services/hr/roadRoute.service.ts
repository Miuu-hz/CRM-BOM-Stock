export interface RoutePoint {
  lat: number
  lng: number
}

export type RouteComputeResult =
  | {
      status: 'OK'
      distanceMeters: number
      distanceKm: number
      durationSec: number
    }
  | { status: 'UNAVAILABLE'; errorCode: 'ROUTING_DISABLED' }
  | { status: 'FAILED'; errorCode: string }

export const DEFAULT_OSRM_URL = 'https://router.project-osrm.org'

export function getOsrmBaseUrl(override?: string): string | null {
  const raw = (override ?? process.env.OSRM_URL ?? DEFAULT_OSRM_URL).trim()
  if (raw.toLowerCase() === 'off') {
    return null
  }
  return (raw || DEFAULT_OSRM_URL).replace(/\/+$/, '')
}

export function isRoadRoutingEnabled(override?: string): boolean {
  return getOsrmBaseUrl(override) !== null
}

export function buildOsrmRouteUrl(
  baseUrl: string,
  origin: RoutePoint,
  destination: RoutePoint,
  intermediates: RoutePoint[]
): string {
  const points = [origin, ...intermediates, destination]
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(';')
  return `${baseUrl.replace(/\/+$/, '')}/route/v1/driving/${coords}?overview=false`
}

/**
 * Compute road distance and duration via OSRM (OpenStreetMap).
 * Never falls back to straight-line/haversine distance and never logs coordinates or response messages.
 */
export async function computeRoadRoute(
  origin: RoutePoint,
  destination: RoutePoint,
  intermediates: RoutePoint[],
  opts?: { baseUrl?: string; timeoutMs?: number; fetchFn?: typeof fetch }
): Promise<RouteComputeResult> {
  const baseUrl = getOsrmBaseUrl(opts?.baseUrl)
  if (!baseUrl) {
    return { status: 'UNAVAILABLE', errorCode: 'ROUTING_DISABLED' }
  }

  const parsedTimeout = Number(process.env.ROUTE_TIMEOUT_MS || 5000)
  const envTimeout =
    Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 5000
  const timeoutMs =
    opts?.timeoutMs !== undefined &&
    Number.isFinite(opts.timeoutMs) &&
    opts.timeoutMs > 0
      ? opts.timeoutMs
      : envTimeout

  const fetchImpl = opts?.fetchFn ?? globalThis.fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const url = buildOsrmRouteUrl(baseUrl, origin, destination, intermediates)
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'phopy-erp-trips',
      },
      signal: controller.signal,
    })

    if (!res.ok) {
      return { status: 'FAILED', errorCode: `HTTP_${res.status}` }
    }

    let data: any
    try {
      data = await res.json()
    } catch {
      return { status: 'FAILED', errorCode: 'INVALID_JSON' }
    }

    if (data?.code !== 'Ok') {
      const code =
        typeof data?.code === 'string' &&
        /^[A-Za-z0-9_-]{1,40}$/.test(data.code)
          ? data.code
          : 'NO_ROUTE'
      return { status: 'FAILED', errorCode: code }
    }

    const firstRoute = Array.isArray(data?.routes) ? data.routes[0] : null
    const distance = firstRoute?.distance
    const duration = firstRoute?.duration

    if (
      typeof distance !== 'number' ||
      !Number.isFinite(distance) ||
      distance < 0 ||
      typeof duration !== 'number' ||
      !Number.isFinite(duration) ||
      duration < 0
    ) {
      return { status: 'FAILED', errorCode: 'NO_ROUTE' }
    }

    const roundedMeters = Math.round(distance)
    return {
      status: 'OK',
      distanceMeters: roundedMeters,
      distanceKm: roundedMeters / 1000,
      durationSec: Math.round(duration),
    }
  } catch (err: any) {
    if (err?.name === 'AbortError' || controller.signal.aborted) {
      return { status: 'FAILED', errorCode: 'TIMEOUT' }
    }
    return { status: 'FAILED', errorCode: 'NETWORK_ERROR' }
  } finally {
    clearTimeout(timer)
  }
}
