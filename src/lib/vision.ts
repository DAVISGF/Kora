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
export function grabFrame(video: HTMLVideoElement): string | null {
  if (!video.videoWidth || !video.videoHeight) return null
  const scale = Math.min(1, MAX_WIDTH / video.videoWidth)
  canvas ??= document.createElement('canvas')
  canvas.width = Math.round(video.videoWidth * scale)
  canvas.height = Math.round(video.videoHeight * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.72).split(',')[1] ?? null
}

export async function analyzeFrame(video: HTMLVideoElement, opts: { ball: boolean }, signal?: AbortSignal): Promise<FrameAnalysis> {
  const image = grabFrame(video)
  if (!image) throw new VisionError('failed', 'No se pudo leer el fotograma del video.')
  const started = performance.now()
  let res: Response
  try {
    res = await fetch('/api/vision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, ball: opts.ball }),
      signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new VisionError('failed', 'No se pudo contactar con el servicio de visión.')
  }
  const body = (await res.json().catch(() => null)) as (Omit<FrameAnalysis, 'ms' | 'persons'> & { persons: Omit<Person, 'id'>[]; error?: string }) | null
  if (!res.ok || !body) {
    const code: VisionErrorCode = res.status === 501 ? 'not_configured' : res.status === 401 || res.status === 403 ? 'unauthorized' : 'failed'
    throw new VisionError(code, body?.error ?? `El servicio de visión respondió ${res.status}.`)
  }
  return {
    persons: body.persons.map((p, i) => ({ ...p, id: i + 1 })),
    ball: body.ball,
    model: body.model,
    ms: Math.round(performance.now() - started),
  }
}

function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = a.w * a.h + b.w * b.h - inter
  return union > 0 ? inter / union : 0
}

/**
 * Seguimiento simple entre fotogramas: cada persona hereda el identificador de
 * la detección anterior con la que más se solapa; las nuevas reciben uno nuevo.
 */
export function trackPersons(prev: Person[], next: Person[], nextId: { current: number }): Person[] {
  const free = new Set(prev.map((p) => p.id))
  const pairs = next
    .flatMap((n, ni) => prev.map((p) => ({ ni, id: p.id, score: iou(p.box, n.box) })))
    .filter((m) => m.score > 0.25)
    .sort((a, b) => b.score - a.score)
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
