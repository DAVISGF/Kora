// Muestreo denso de la pose de UNA persona. En cada instante recorta su zona del
// fotograma, la amplía y la envía al modelo preciso; los puntos vuelven en
// píxeles del video original. Así un jugador pequeño en un plano abierto se
// mide casi igual de bien que uno en primer plano.

import { cropFrame, seekTo } from '../videoFrames'
import { requestVision, VisionError, type Box, type RawFrame } from '../vision'
import { JOINTS, type Joint, type Pose, type PoseFrame, type PxBox } from './types'

/** Dónde estaba la persona en la pasada gruesa: caja normalizada a 0–1 del fotograma. */
export interface TrackObs {
  t: number
  box: Box
}

export const CROP_TARGET_PX = 512
const CONCURRENCY = 8
const RETRIES = 2
const MIN_OVERLAP = 0.15
const JOINT_SET = new Set<string>(JOINTS)

/** Caja de la persona en el instante `t`, interpolada entre las observaciones de la pasada gruesa. */
export function boxAt(obs: TrackObs[], t: number): Box {
  if (t <= obs[0].t) return obs[0].box
  const last = obs[obs.length - 1]
  if (t >= last.t) return last.box
  let i = 1
  while (obs[i].t < t) i++
  const a = obs[i - 1]
  const b = obs[i]
  const k = (t - a.t) / (b.t - a.t || 1)
  const lerp = (p: number, q: number) => p + (q - p) * k
  return { x: lerp(a.box.x, b.box.x), y: lerp(a.box.y, b.box.y), w: lerp(a.box.w, b.box.w), h: lerp(a.box.h, b.box.h) }
}

/**
 * Zona a recortar alrededor de la caja: deja sitio para los brazos por encima de
 * la cabeza, la pierna que golpea y lo que la persona se desplaza entre muestras.
 */
export function cropRect(box: Box, vw: number, vh: number): PxBox {
  const bw = box.w * vw
  const bh = box.h * vh
  const side = Math.max(bw * 0.6, bh * 0.3)
  const x1 = Math.max(0, box.x * vw - side)
  const y1 = Math.max(0, box.y * vh - bh * 0.4)
  const x2 = Math.min(vw, box.x * vw + bw + side)
  const y2 = Math.min(vh, box.y * vh + bh * 1.15)
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

function iou(a: PxBox, b: PxBox): number {
  const inter = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  const union = a.w * a.h + b.w * b.h - inter
  return union > 0 ? inter / union : 0
}

/** De las personas detectadas en el recorte, la que coincide con la que se está siguiendo. */
export function pickPerson(raw: RawFrame, expected: PxBox, rect: PxBox, t: number): PoseFrame | null {
  let best: PoseFrame | null = null
  let bestScore = MIN_OVERLAP
  for (const p of raw.persons) {
    const box: PxBox = { x: rect.x + p.box.x * rect.w, y: rect.y + p.box.y * rect.h, w: p.box.w * rect.w, h: p.box.h * rect.h }
    const score = iou(box, expected) + 0.1 * p.conf
    if (score <= bestScore) continue
    const pose: Pose = {}
    for (const k of p.keypoints) {
      if (JOINT_SET.has(k.name)) pose[k.name as Joint] = { x: rect.x + k.x * rect.w, y: rect.y + k.y * rect.h, c: k.conf }
    }
    best = { t, pose, box, conf: p.conf }
    bestScore = score
  }
  return best
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function requestPose(image: string, signal: AbortSignal): Promise<RawFrame | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await requestVision(image, false, signal, 'precise')
    } catch (e) {
      // Sin clave o con la clave rechazada no tiene sentido seguir; un fallo pasajero solo pierde este fotograma.
      if (!(e instanceof VisionError) || e.code !== 'failed') throw e
      if (attempt >= RETRIES || signal.aborted) return null
      await wait(600 * (attempt + 1))
    }
  }
}

/**
 * Mide la pose de la persona en cada instante de `times`. La captura es
 * secuencial (un solo <video>) y las peticiones van en paralelo. Los fotogramas
 * donde no se la encuentra simplemente faltan en el resultado.
 */
export async function samplePoses(
  video: HTMLVideoElement,
  obs: TrackObs[],
  times: number[],
  opts: { signal: AbortSignal; onFrame: () => void },
): Promise<PoseFrame[]> {
  const vw = video.videoWidth
  const vh = video.videoHeight
  const out: PoseFrame[] = []
  const pending = new Set<Promise<void>>()
  let fatal: unknown = null

  for (const t of times) {
    if (fatal || opts.signal.aborted) break
    await seekTo(video, t)
    const box = boxAt(obs, t)
    const rect = cropRect(box, vw, vh)
    const image = cropFrame(video, rect, CROP_TARGET_PX, 0.8)?.split(',')[1]
    if (!image) {
      opts.onFrame()
      continue
    }
    const expected: PxBox = { x: box.x * vw, y: box.y * vh, w: box.w * vw, h: box.h * vh }
    const job = requestPose(image, opts.signal)
      .then((raw) => {
        const frame = raw && pickPerson(raw, expected, rect, t)
        if (frame) out.push(frame)
      })
      .catch((e) => {
        fatal ??= e
      })
      .finally(() => {
        pending.delete(job)
        opts.onFrame()
      })
    pending.add(job)
    if (pending.size >= CONCURRENCY) await Promise.race(pending)
  }
  await Promise.all(pending)
  if (opts.signal.aborted) throw new DOMException('Análisis cancelado', 'AbortError')
  if (fatal) throw fatal
  return out.sort((a, b) => a.t - b.t)
}
