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
  | { status: 'UNAVAILABLE'; errorCode: 'NO_API_KEY' }
  | { status: 'FAILED'; errorCode: string }

const GOOGLE_ROUTES_ENDPOINT =
  'https://routes.googleapis.com/directions/v2:computeRoutes'

function toWaypoint(pt: RoutePoint) {
  return {
    location: {
      latLng: {
        latitude: pt.lat,
        longitude: pt.lng,
      },
    },
  }
}

/**
 * Compute road distance and duration via Google Routes API v2.
 * Never falls back to straight-line/haversine distance and never logs API keys or coordinates.
 */
export async function computeRoadRoute(
  origin: RoutePoint,
  destination: RoutePoint,
  intermediates: RoutePoint[],
  opts?: { apiKey?: string; timeoutMs?: number; fetchFn?: typeof fetch }
): Promise<RouteComputeResult> {
  const apiKey = (
    opts?.apiKey ??
    process.env.GOOGLE_ROUTES_API_KEY ??
    ''
  ).trim()

  if (!apiKey) {
    return { status: 'UNAVAILABLE', errorCode: 'NO_API_KEY' }
  }

  const parsedTimeout = Number(process.env.GOOGLE_ROUTES_TIMEOUT_MS || 5000)
  const timeoutMs =
    opts?.timeoutMs ??
    (Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 5000)

  const fetchImpl = opts?.fetchFn ?? globalThis.fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const payload: Record<string, unknown> = {
      origin: toWaypoint(origin),
      destination: toWaypoint(destination),
      ...(intermediates.length > 0
        ? { intermediates: intermediates.map(toWaypoint) }
        : {}),
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
    }

    const res = await fetchImpl(GOOGLE_ROUTES_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!res.ok) {
      return { status: 'FAILED', errorCode: `HTTP_${res.status}` }
    }

    const data = (await res.json()) as any
    const firstRoute = Array.isArray(data?.routes) ? data.routes[0] : null
    const distanceMeters = firstRoute?.distanceMeters
    const durationRaw = firstRoute?.duration

    if (
      typeof distanceMeters !== 'number' ||
      !Number.isFinite(distanceMeters) ||
      distanceMeters < 0 ||
      typeof durationRaw !== 'string'
    ) {
      return { status: 'FAILED', errorCode: 'NO_ROUTE' }
    }

    const durationMatch = /^(\d+(?:\.\d+)?)s$/.exec(durationRaw)
    if (!durationMatch) {
      return { status: 'FAILED', errorCode: 'NO_ROUTE' }
    }

    const roundedMeters = Math.round(distanceMeters)
    return {
      status: 'OK',
      distanceMeters: roundedMeters,
      distanceKm: roundedMeters / 1000,
      durationSec: Math.round(parseFloat(durationMatch[1])),
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
