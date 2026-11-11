// Función de Vercel: recibe un fotograma, consulta la API serverless de Roboflow
// y devuelve las detecciones normalizadas. La clave vive solo en el servidor.

const BASE = 'https://serverless.roboflow.com'
const MAX_IMAGE_CHARS = 2_800_000 // ~2 MB de JPEG en base64
const MAX_PERSONS = 30

const COCO_KEYPOINTS = [
  'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear', 'left_shoulder', 'right_shoulder', 'left_elbow',
  'right_elbow', 'left_wrist', 'right_wrist', 'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
]

interface RfKeypoint {
  x: number
  y: number
  confidence: number
  class_id?: number
  class?: string
  class_name?: string
}

interface RfPrediction {
  x: number
  y: number
  width: number
  height: number
  confidence: number
  class: string
  keypoints?: RfKeypoint[]
}

interface RfResponse {
  predictions?: RfPrediction[]
  image?: { width: number; height: number }
}

class UpstreamError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

const round = (n: number) => Math.round(n * 10000) / 10000

async function infer(model: string, image: string, key: string, confidence: number): Promise<RfResponse> {
  const res = await fetch(`${BASE}/${model}?confidence=${confidence}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: image,
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new UpstreamError(res.status, (await res.text()).slice(0, 300))
  return (await res.json()) as RfResponse
}

/** Roboflow da el centro de la caja en píxeles; aquí pasa a esquina superior izquierda en 0–1. */
function box(p: RfPrediction, w: number, h: number) {
  return { x: round((p.x - p.width / 2) / w), y: round((p.y - p.height / 2) / h), w: round(p.width / w), h: round(p.height / h) }
}

export async function POST(request: Request): Promise<Response> {
  const key = process.env.ROBOFLOW_API_KEY
  if (!key) return json(501, { error: 'Falta la variable ROBOFLOW_API_KEY en el servidor.' })

  const body = (await request.json().catch(() => null)) as { image?: unknown; ball?: unknown; pose?: unknown } | null
  const image = body?.image
  if (typeof image !== 'string' || image.length < 100 || image.length > MAX_IMAGE_CHARS || !/^[A-Za-z0-9+/=]+$/.test(image)) {
    return json(400, { error: 'Se esperaba un fotograma JPEG en base64 de hasta 2 MB.' })
  }

  // «precise» se usa en los recortes de una sola persona del análisis de técnica: menos volumen, más exactitud.
  const precise = body?.pose === 'precise'
  const poseModel = precise
    ? process.env.ROBOFLOW_POSE_MODEL_PRECISE || 'coco-pose-detection/3'
    : process.env.ROBOFLOW_POSE_MODEL || 'coco-pose-detection/1'
  const objectModel = process.env.ROBOFLOW_OBJECT_MODEL || 'coco/25'

  try {
    const [pose, objects] = await Promise.all([
      infer(poseModel, image, key, precise ? 30 : 40),
      body?.ball === true ? infer(objectModel, image, key, 20) : Promise.resolve(null),
    ])

    const w = pose.image?.width || 1
    const h = pose.image?.height || 1
    const persons = (pose.predictions ?? [])
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, MAX_PERSONS)
      .map((p) => ({
        box: box(p, w, h),
        conf: round(p.confidence),
        keypoints: (p.keypoints ?? []).map((k, i) => ({
          name: COCO_KEYPOINTS[k.class_id ?? i] ?? k.class ?? k.class_name ?? `kp_${i}`,
          x: round(k.x / w),
          y: round(k.y / h),
          conf: round(k.confidence),
        })),
      }))

    let ball: { box: ReturnType<typeof box>; conf: number } | null = null
    if (objects) {
      const ow = objects.image?.width || w
      const oh = objects.image?.height || h
      const best = (objects.predictions ?? []).filter((p) => p.class === 'sports ball').sort((a, b) => b.confidence - a.confidence)[0]
      if (best) ball = { box: box(best, ow, oh), conf: round(best.confidence) }
    }

    return json(200, { persons, ball, model: objects ? `${poseModel} + ${objectModel}` : poseModel })
  } catch (e) {
    if (e instanceof UpstreamError) {
      console.error('Roboflow respondió', e.status, e.message)
      if (e.status === 401 || e.status === 403) return json(401, { error: 'Roboflow rechazó la clave de API.' })
      if (e.status === 402 || e.status === 429) return json(429, { error: 'Se agotaron los créditos o el límite de peticiones de Roboflow.' })
      return json(502, { error: `Roboflow respondió ${e.status}.` })
    }
    console.error('Fallo al consultar Roboflow', e)
    return json(502, { error: 'No se pudo contactar con Roboflow.' })
  }
}
