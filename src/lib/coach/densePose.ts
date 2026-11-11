// Muestreo denso de la pose de UNA persona. En cada instante recorta su zona del
// fotograma, la amplía y la envía al modelo preciso; los puntos vuelven en
// píxeles del video original. Así un jugador pequeño en un plano abierto se
// mide casi igual de bien que uno en primer plano.

import { cropFrame, seekTo } from '../videoFrames'
import { requestVision, VisionError, type Box, type RawFrame } from '../vision'
import { JOINTS, type BallObs, type Joint, type Pose, type PoseFrame, type PxBox } from './types'
import type { Capture } from './windows'

/** Dónde estaba la persona en la pasada gruesa: caja normalizada a 0–1 del fotograma. */
export interface TrackObs {
  t: number
  box: Box
}

export const CROP_TARGET_PX = 512
const CONCURRENCY = 8
const RETRIES = 2
/** Distancia máxima, en alturas de cuerpo, entre donde se esperaba a la persona y donde aparece. */
const MAX_OFFSET_HEIGHTS = 0.7
const MAX_SIZE_RATIO = 1.9
/** Fracción de la caja de la persona tapada por otra a partir de la cual no se confía en su pose. */
const CROWD_OVERLAP = 0.25
const JOINT_SET = new Set<string>(JOINTS)

export interface Expected {
  /** Caja esperada en píxeles del video */
  box: PxBox
  /** Cuánto pudo apartarse de esa caja (se movía entre las dos muestras vecinas), en píxeles */
  slack: number
}

/**
 * Dónde se espera a la persona en el instante `t`: la caja interpolada entre las
 * dos muestras vecinas de la pasada gruesa. Si entre ellas se desplazó mucho,
 * la trayectoria real puede no ser recta: `slack` crece hacia la mitad del tramo.
 */
export function expectedAt(obs: TrackObs[], t: number, vw: number, vh: number): Expected {
  const px = (b: Box): PxBox => ({ x: b.x * vw, y: b.y * vh, w: b.w * vw, h: b.h * vh })
  if (t <= obs[0].t) return { box: px(obs[0].box), slack: 0 }
  const last = obs[obs.length - 1]
  if (t >= last.t) return { box: px(last.box), slack: 0 }
  let i = 1
  while (obs[i].t < t) i++
  const a = px(obs[i - 1].box)
  const b = px(obs[i].box)
  const k = (t - obs[i - 1].t) / (obs[i].t - obs[i - 1].t || 1)
  const lerp = (p: number, q: number) => p + (q - p) * k
  const move = Math.hypot(b.x + b.w / 2 - a.x - a.w / 2, b.y + b.h - a.y - a.h)
  return { box: { x: lerp(a.x, b.x), y: lerp(a.y, b.y), w: lerp(a.w, b.w), h: lerp(a.h, b.h) }, slack: 2 * k * (1 - k) * move }
}

/**
 * Zona a recortar alrededor de la caja esperada: deja sitio para los brazos por
 * encima de la cabeza, la pierna que golpea y lo que la persona pudo desplazarse.
 */
export function cropRect(e: Expected, vw: number, vh: number): PxBox {
  const { box, slack } = e
  const side = Math.max(box.w * 0.6, box.h * 0.3) + slack
  const x1 = Math.max(0, box.x - side)
  const y1 = Math.max(0, box.y - box.h * 0.4 - slack * 0.5)
  const x2 = Math.min(vw, box.x + box.w + side)
  const y2 = Math.min(vh, box.y + box.h * 1.15 + slack * 0.5)
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

/** De las personas detectadas en el recorte, la que se está siguiendo: la más cercana a donde se la esperaba. */
export function pickPerson(raw: RawFrame, e: Expected, rect: PxBox, t: number): PoseFrame | null {
  let best: PoseFrame | null = null
  let bestCost = Infinity
  const ex = e.box.x + e.box.w / 2
  const ey = e.box.y + e.box.h / 2
  for (const p of raw.persons) {
    const box: PxBox = { x: rect.x + p.box.x * rect.w, y: rect.y + p.box.y * rect.h, w: p.box.w * rect.w, h: p.box.h * rect.h }
    const ratio = Math.max(box.h, e.box.h) / (Math.min(box.h, e.box.h) || 1e-6)
    if (ratio > MAX_SIZE_RATIO) continue
    const offset = Math.hypot(box.x + box.w / 2 - ex, box.y + box.h / 2 - ey)
    if (offset > MAX_OFFSET_HEIGHTS * e.box.h + e.slack) continue
    const cost = offset / (e.box.h || 1) + (ratio - 1) * 0.5 - 0.1 * p.conf
    if (cost >= bestCost) continue
    const pose: Pose = {}
    for (const k of p.keypoints) {
      if (JOINT_SET.has(k.name)) pose[k.name as Joint] = { x: rect.x + k.x * rect.w, y: rect.y + k.y * rect.h, c: k.conf }
    }
    best = { t, pose, box, conf: p.conf }
    bestCost = cost
  }
  if (best) {
    // ¿Alguien más se le echa encima? Parte de su caja queda tapada por la de otra persona.
    const mine = best.box
    best.crowd = raw.persons.some((p) => {
      const other: PxBox = { x: rect.x + p.box.x * rect.w, y: rect.y + p.box.y * rect.h, w: p.box.w * rect.w, h: p.box.h * rect.h }
      if (Math.abs(other.x - mine.x) < 1 && Math.abs(other.y - mine.y) < 1) return false
      const inter = Math.max(0, Math.min(mine.x + mine.w, other.x + other.w) - Math.max(mine.x, other.x)) * Math.max(0, Math.min(mine.y + mine.h, other.y + other.h) - Math.max(mine.y, other.y))
      return p.conf >= 0.4 && other.h >= mine.h * 0.5 && inter / (mine.w * mine.h || 1) >= CROWD_OVERLAP
    })
  }
  return best
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** El balón del recorte, llevado a píxeles del video. */
export function ballIn(raw: RawFrame, rect: PxBox): BallObs | null {
  if (!raw.ball) return null
  const b = raw.ball.box
  return { x: rect.x + (b.x + b.w / 2) * rect.w, y: rect.y + (b.y + b.h / 2) * rect.h, r: (b.w * rect.w + b.h * rect.h) / 4, c: raw.ball.conf }
}

async function requestPose(image: string, ball: boolean, signal: AbortSignal): Promise<RawFrame | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await requestVision(image, ball, signal, 'precise')
    } catch (e) {
      // Sin clave o con la clave rechazada no tiene sentido seguir; un fallo pasajero solo pierde este fotograma.
      if (!(e instanceof VisionError) || e.code !== 'failed') throw e
      if (attempt >= RETRIES || signal.aborted) return null
      await wait(600 * (attempt + 1))
    }
  }
}

/**
 * Mide la pose de varias personas siguiendo un plan de capturas. El video se
 * recorre una sola vez (la captura es secuencial: hay un único <video>) y de
 * cada fotograma se recorta a cada persona pedida; las peticiones van en
 * paralelo. Los fotogramas donde no se encuentra a la persona simplemente faltan.
 */
export async function samplePoses(
  video: HTMLVideoElement,
  tracks: Map<number, TrackObs[]>,
  plan: Capture[],
  opts: { signal: AbortSignal; onFrame: () => void; ball?: boolean },
): Promise<Map<number, PoseFrame[]>> {
  const vw = video.videoWidth
  const vh = video.videoHeight
  const out = new Map<number, PoseFrame[]>([...tracks.keys()].map((id) => [id, []]))
  const pending = new Set<Promise<void>>()
  let fatal: unknown = null

  for (const shot of plan) {
    if (fatal || opts.signal.aborted) break
    await seekTo(video, shot.t)
    for (const id of shot.ids) {
      const obs = tracks.get(id)
      const expected = obs && expectedAt(obs, shot.t, vw, vh)
      const rect = expected && cropRect(expected, vw, vh)
      const image = rect && cropFrame(video, rect, CROP_TARGET_PX, 0.8)?.split(',')[1]
      if (!expected || !rect || !image) {
        opts.onFrame()
        continue
      }
      const job = requestPose(image, !!opts.ball, opts.signal)
        .then((raw) => {
          const frame = raw && pickPerson(raw, expected, rect, shot.t)
          if (!frame) return
          if (opts.ball) frame.ball = ballIn(raw, rect)
          out.get(id)!.push(frame)
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
  }
  await Promise.all(pending)
  if (opts.signal.aborted) throw new DOMException('Análisis cancelado', 'AbortError')
  if (fatal) throw fatal
  for (const frames of out.values()) frames.sort((a, b) => a.t - b.t)
  return out
}
