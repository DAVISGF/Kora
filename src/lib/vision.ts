// Cliente del servicio de visión. El navegador nunca habla con el proveedor:
// envía el fotograma a /api/vision, que guarda la clave y normaliza la respuesta.

export interface Box {
  /** Esquina superior izquierda y tamaño, normalizados a 0–1 del fotograma */
  x: number
  y: number
  w: number
  h: number
}

export interface Keypoint {
  name: string
  x: number
  y: number
  conf: number
}

export interface Person {
  id: number
  box: Box
  conf: number
  keypoints: Keypoint[]
}

export interface FrameAnalysis {
  persons: Person[]
  ball: { box: Box; conf: number } | null
  /** Tiempo de respuesta del servicio, en ms */
  ms: number
  model: string
  /** 'local' si lo calculó el modelo del navegador */
  source?: 'local' | 'cloud'
}

export type VisionErrorCode = 'not_configured' | 'unauthorized' | 'failed'

export class VisionError extends Error {
  code: VisionErrorCode
  constructor(code: VisionErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

const MAX_WIDTH = 640
let canvas: HTMLCanvasElement | null = null

/** Captura el fotograma actual del video como JPEG en base64 (sin el prefijo data:). */
export function grabFrame(video: HTMLVideoElement, maxWidth = MAX_WIDTH, quality = 0.72): string | null {
  if (!video.videoWidth || !video.videoHeight) return null
  const scale = Math.min(1, maxWidth / video.videoWidth)
  canvas ??= document.createElement('canvas')
  canvas.width = Math.round(video.videoWidth * scale)
  canvas.height = Math.round(video.videoHeight * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', quality).split(',')[1] ?? null
}

export interface RawFrame {
  persons: Omit<Person, 'id'>[]
  ball: FrameAnalysis['ball']
  model: string
}

/** Envía un fotograma ya capturado al servicio de visión. */
export async function requestVision(image: string, ball: boolean, signal?: AbortSignal): Promise<RawFrame> {
  let res: Response
  try {
    res = await fetch('/api/vision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, ball }),
      signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new VisionError('failed', 'No se pudo contactar con el servicio de visión.')
  }
  const body = (await res.json().catch(() => null)) as (RawFrame & { error?: string }) | null
  if (!res.ok || !body) {
    const code: VisionErrorCode = res.status === 501 ? 'not_configured' : res.status === 401 || res.status === 403 ? 'unauthorized' : 'failed'
    throw new VisionError(code, body?.error ?? `El servicio de visión respondió ${res.status}.`)
  }
  return body
}

export async function analyzeFrame(video: HTMLVideoElement, opts: { ball: boolean }, signal?: AbortSignal): Promise<FrameAnalysis> {
  const image = grabFrame(video)
  if (!image) throw new VisionError('failed', 'No se pudo leer el fotograma del video.')
  const started = performance.now()
  const body = await requestVision(image, opts.ball, signal)
  return {
    persons: body.persons.map((p, i) => ({ ...p, id: i + 1 })),
    ball: body.ball,
    model: body.model,
    ms: Math.round(performance.now() - started),
  }
}

/** Salto máximo entre muestras, en alturas de cuerpo (~4,5 m con 1,75 m por persona). */
const MAX_JUMP_HEIGHTS = 2.6

/**
 * Seguimiento simple entre fotogramas: cada persona hereda el identificador de
 * la detección anterior más cercana, siempre que el salto sea verosímil; las
 * nuevas reciben uno nuevo. Se mide en alturas de cuerpo para que no dependa
 * de lo lejos que esté de la cámara.
 */
export function trackPersons(prev: Person[], next: Person[], nextId: { current: number }, aspect = 16 / 9): Person[] {
  const free = new Set(prev.map((p) => p.id))
  const pairs = next
    .flatMap((n, ni) =>
      prev.map((p) => {
        const dx = (n.box.x + n.box.w / 2 - p.box.x - p.box.w / 2) * aspect
        const dy = n.box.y + n.box.h - p.box.y - p.box.h
        const height = (n.box.h + p.box.h) / 2 || 1
        const sizeRatio = Math.max(n.box.h, p.box.h) / (Math.min(n.box.h, p.box.h) || 1e-6)
        return { ni, id: p.id, cost: Math.hypot(dx, dy) / height, sizeRatio }
      }),
    )
    .filter((m) => m.cost <= MAX_JUMP_HEIGHTS && m.sizeRatio <= 2)
    .sort((a, b) => a.cost - b.cost)
  const assigned = new Map<number, number>()
  for (const m of pairs) {
    if (assigned.has(m.ni) || !free.has(m.id)) continue
    assigned.set(m.ni, m.id)
    free.delete(m.id)
  }
  return next.map((n, ni) => ({ ...n, id: assigned.get(ni) ?? nextId.current++ }))
}

export const SKELETON: [string, string][] = [
  ['left_shoulder', 'right_shoulder'],
  ['left_shoulder', 'left_elbow'],
  ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'],
  ['right_elbow', 'right_wrist'],
  ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'],
  ['left_hip', 'left_knee'],
  ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'],
  ['right_knee', 'right_ankle'],
]

export const MIN_KEYPOINT_CONF = 0.3

const JOINTS: [label: string, a: string, vertex: string, c: string][] = [
  ['Codo derecho', 'right_shoulder', 'right_elbow', 'right_wrist'],
  ['Codo izquierdo', 'left_shoulder', 'left_elbow', 'left_wrist'],
  ['Rodilla derecha', 'right_hip', 'right_knee', 'right_ankle'],
  ['Rodilla izquierda', 'left_hip', 'left_knee', 'left_ankle'],
  ['Cadera derecha', 'right_shoulder', 'right_hip', 'right_knee'],
  ['Cadera izquierda', 'left_shoulder', 'left_hip', 'left_knee'],
]

export interface JointAngle {
  label: string
  degrees: number
  /** Posición del vértice, normalizada */
  at: { x: number; y: number }
}

/**
 * Ángulos articulares en el plano de la imagen. `aspect` (ancho/alto del video)
 * corrige que las coordenadas normalizadas no sean cuadradas.
 */
export function jointAngles(person: Person, aspect: number): JointAngle[] {
  const kp = new Map(person.keypoints.filter((k) => k.conf >= MIN_KEYPOINT_CONF).map((k) => [k.name, k]))
  const out: JointAngle[] = []
  for (const [label, a, v, c] of JOINTS) {
    const pa = kp.get(a)
    const pv = kp.get(v)
    const pc = kp.get(c)
    if (!pa || !pv || !pc) continue
    const ax = (pa.x - pv.x) * aspect
    const ay = pa.y - pv.y
    const cx = (pc.x - pv.x) * aspect
    const cy = pc.y - pv.y
    const denom = Math.hypot(ax, ay) * Math.hypot(cx, cy)
    if (!denom) continue
    const cos = Math.max(-1, Math.min(1, (ax * cx + ay * cy) / denom))
    out.push({ label, degrees: Math.round((Math.acos(cos) * 180) / Math.PI), at: { x: pv.x, y: pv.y } })
  }
  return out
}

/** La persona principal del fotograma: la de mayor área. */
export function mainPerson(persons: Person[]): Person | null {
  return persons.reduce<Person | null>((best, p) => (!best || p.box.w * p.box.h > best.box.w * best.box.h ? p : best), null)
}
