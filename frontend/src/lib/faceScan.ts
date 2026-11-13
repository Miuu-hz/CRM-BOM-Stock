let humanInstance: any = null

async function getHuman(): Promise<any> {
  if (humanInstance) return humanInstance

  // Dynamic import so it stays out of the main bundle
  const humanModule: any = await import('@vladmandic/human')
  const HumanClass = humanModule.default?.Human || humanModule.Human || humanModule.default || humanModule

  const baseConfig = {
    modelBasePath: '/human-models/',
    backend: 'webgl',
    face: {
      enabled: true,
      detector: { rotation: false, maxDetected: 2 },
      mesh: { enabled: true },
      description: { enabled: true },
      iris: { enabled: false },
      emotion: { enabled: false },
      antispoof: { enabled: false },
      liveness: { enabled: false },
    },
    body: { enabled: false },
    hand: { enabled: false },
    object: { enabled: false },
    gesture: { enabled: false },
  }

  try {
    humanInstance = new HumanClass(baseConfig)
  } catch {
    // Fallback to default backend
    const { backend, ...fallbackConfig } = baseConfig
    humanInstance = new HumanClass(fallbackConfig)
  }

  return humanInstance
}

export async function captureFaceDescriptor(video: HTMLVideoElement): Promise<number[]> {
  const human = await getHuman()
  const result = await human.detect(video)

  if (!result || !result.face || result.face.length === 0) {
    throw new Error('ไม่พบใบหน้า กรุณาหันหน้าเข้ากล้อง')
  }

  if (result.face.length > 1) {
    throw new Error('พบมากกว่า 1 ใบหน้า')
  }

  const face = result.face[0]
  if (!face.embedding) {
    throw new Error('ไม่พบใบหน้า กรุณาหันหน้าเข้ากล้อง')
  }

  return Array.from(face.embedding)
}

export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
  if (!navigator?.mediaDevices?.getUserMedia) {
    throw new Error('เบราว์เซอร์ไม่รองรับการเปิดกล้อง')
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user' },
  })

  video.srcObject = stream
  if (typeof video.play === 'function') {
    await video.play().catch(() => {})
  }

  return stream
}

export function stopCamera(video: HTMLVideoElement): void {
  if (!video) return
  const stream = video.srcObject as MediaStream | null
  if (stream && typeof stream.getTracks === 'function') {
    stream.getTracks().forEach((track) => {
      if (typeof track.stop === 'function') {
        track.stop()
      }
    })
  }
  video.srcObject = null
}
