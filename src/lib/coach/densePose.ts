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

/** Un recorte ya tomado, a la espera de que el modelo le mida la pose. */
interface Shot {
  id: number
  t: number
  image: string
  expected: Expected
  rect: PxBox
}

/** Recorta del fotograma actual a cada persona pedida. */
function grab(video: HTMLVideoElement, tracks: Map<number, TrackObs[]>, ids: number[], t: number): (Shot | null)[] {
  const vw = video.videoWidth
  const vh = video.videoHeight
  return ids.map((id) => {
    const obs = tracks.get(id)
    if (!obs) return null
    const expected = expectedAt(obs, t, vw, vh)
    const rect = cropRect(expected, vw, vh)
    const image = cropFrame(video, rect, CROP_TARGET_PX, 0.8)?.split(',')[1]
    return image ? { id, t, image, expected, rect } : null
  })
}

/** Separación máxima entre dos capturas para leerlas de corrido, reproduciendo el video. */
const RUN_GAP_S = 0.6
/** Si el video deja de entregar fotogramas este tiempo (pestaña en segundo plano, navegador sin soporte), se pasa a buscar uno a uno. */
const STALL_MS = 1500

type FrameCallback = (now: number, meta: { mediaTime: number }) => void
type FrameVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: FrameCallback) => number }

/**
 * Toma las capturas de un tramo reproduciendo el video: los fotogramas llegan
 * en orden, sin tener que buscar cada uno (que obliga al navegador a decodificar
 * desde el fotograma clave anterior). Devuelve las capturas que no pudo tomar.
 */
function playRun(video: FrameVideo, run: Capture[], step: number, take: (c: Capture, t: number) => void, signal: AbortSignal): Promise<Capture[]> {
  return new Promise((resolve) => {
    let idx = 0
    let lastT = -1
    let lastSeen = performance.now()
    let finished = false
    const missed: Capture[] = []
    const tolerance = Math.min(step / 2, 0.03)
    const finish = () => {
      if (finished) return
      finished = true
      clearInterval(watchdog)
      video.removeEventListener('ended', finish)
      video.pause()
      resolve([...missed, ...run.slice(idx)])
    }
    const watchdog = setInterval(() => {
      if (signal.aborted || performance.now() - lastSeen > STALL_MS) finish()
    }, 250)
    const onFrame: FrameCallback = (_now, meta) => {
      if (finished) return
      lastSeen = performance.now()
      const t = meta.mediaTime
      while (idx < run.length && run[idx].t <= t + tolerance) {
        // Un fotograma sirve para la captura que le toca; si el navegador se saltó fotogramas, esa captura se pierde.
        if (t - run[idx].t <= step && t !== lastT) {
          take(run[idx], t)
          lastT = t
        } else missed.push(run[idx])
        idx++
      }
      if (idx >= run.length) finish()
      else video.requestVideoFrameCallback!(onFrame)
    }
    video.addEventListener('ended', finish)
    // Cuanto más espaciadas las capturas, más rápido se puede pasar el video.
    video.playbackRate = step <= 1 / 20 ? 1 : step <= 1 / 13 ? 1.5 : 2.5
    video.requestVideoFrameCallback!(onFrame)
    video.play().catch(finish)
  })
}

/** Instante del fotograma que el video acaba de mostrar tras una búsqueda, o null si el navegador no lo dice a tiempo. */
function shownTime(video: FrameVideo): Promise<number | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 120)
    video.requestVideoFrameCallback!((_now, meta) => {
      clearTimeout(timer)
      resolve(meta.mediaTime)
    })
  })
}

/**
 * Mide la pose de varias personas siguiendo un plan de capturas. Primero toma
 * los recortes (reproduciendo el video de corrido y, donde eso no alcance,
 * buscando fotograma a fotograma) y, a la vez, los va enviando al modelo en
 * paralelo. Los fotogramas donde no se encuentra a la persona simplemente faltan.
 */
export async function samplePoses(
  video: HTMLVideoElement,
  tracks: Map<number, TrackObs[]>,
  plan: Capture[],
  opts: { signal: AbortSignal; onFrame: () => void; ball?: boolean },
): Promise<Map<number, PoseFrame[]>> {
  const out = new Map<number, PoseFrame[]>([...tracks.keys()].map((id) => [id, []]))
  const queue: Shot[] = []
  const active = new Set<Promise<void>>()
  let fatal: unknown = null

  const pump = () => {
    while (!fatal && !opts.signal.aborted && active.size < CONCURRENCY && queue.length) {
      const shot = queue.shift()!
      const job = requestPose(shot.image, !!opts.ball, opts.signal)
        .then((raw) => {
          const frame = raw && pickPerson(raw, shot.expected, shot.rect, shot.t)
          if (!frame) return
          if (opts.ball) frame.ball = ballIn(raw, shot.rect)
          out.get(shot.id)!.push(frame)
        })
        .catch((e) => {
          fatal ??= e
        })
        .finally(() => {
          active.delete(job)
          opts.onFrame()
          pump()
        })
      active.add(job)
    }
  }
  const take = (c: Capture, t: number) => {
    for (const shot of grab(video, tracks, c.ids, t)) {
      if (shot) queue.push(shot)
      else opts.onFrame()
    }
    pump()
  }

  // 1. De corrido, por tramos de capturas seguidas.
  let pending = plan
  const player = video as FrameVideo
  if (typeof player.requestVideoFrameCallback === 'function') {
    const missed: Capture[] = []
    let from = 0
    while (from < plan.length && !fatal && !opts.signal.aborted) {
      let to = from
      while (to + 1 < plan.length && plan[to + 1].t - plan[to].t <= RUN_GAP_S) to++
      const run = plan.slice(from, to + 1)
      from = to + 1
      if (run.length < 4) {
        missed.push(...run)
        continue
      }
      const step = (run[run.length - 1].t - run[0].t) / (run.length - 1)
      try {
        await seekTo(video, Math.max(0, run[0].t - 0.02))
        missed.push(...(await playRun(player, run, step, take, opts.signal)))
      } catch {
        missed.push(...run)
      }
    }
    video.playbackRate = 1
    pending = missed.sort((x, y) => x.t - y.t)
  }

  // 2. Lo que falte, buscando cada fotograma.
  let exact = typeof player.requestVideoFrameCallback === 'function'
  for (const c of pending) {
    if (fatal || opts.signal.aborted) break
    try {
      await seekTo(video, c.t)
      // El fotograma que queda en pantalla no empieza justo en el instante pedido: se anota el suyo.
      const shown = exact ? await shownTime(player) : null
      if (exact && shown === null) exact = false
      take(c, shown !== null && Math.abs(shown - c.t) < 0.08 ? shown : c.t)
    } catch {
      for (let n = 0; n < c.ids.length; n++) opts.onFrame()
    }
    // Sin prisa por acumular recortes si el modelo va más lento que la captura.
    if (queue.length > CONCURRENCY * 4) await Promise.race(active)
  }

  while ((active.size || queue.length) && !fatal && !opts.signal.aborted) {
    pump()
    if (active.size) await Promise.race(active)
  }
  await Promise.all(active)
  if (opts.signal.aborted) throw new DOMException('Análisis cancelado', 'AbortError')
  if (fatal) throw fatal
  for (const frames of out.values()) frames.sort((x, y) => x.t - y.t)
  return out
}
