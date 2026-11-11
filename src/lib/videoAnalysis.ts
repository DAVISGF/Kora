// Análisis del video completo: muestrea fotogramas, los envía al servicio de
// visión y deriva KPIs y eventos de las detecciones. Sin calibración de cámara,
// las distancias se estiman tomando la altura de cada persona como regla.

import type { EvCode, GameEvent, Kpi, SportId } from '../data/sports'
import { runCoach } from './coach/pipeline'
import type { CoachReport } from './coach/types'
import { comma, fmtTime } from './util'
import { disposeVideo, loadVideo, seekTo } from './videoFrames'
import { grabFrame, jointAngles, MIN_KEYPOINT_CONF, requestVision, trackPersons, VisionError, type Box, type JointAngle, type Person } from './vision'

/** Versión del formato de `VideoAnalysis`; al cambiarla se descartan los análisis guardados antiguos. */
export const ANALYSIS_VERSION = 3

export const SAMPLE_STEP = 0.5 // segundos entre fotogramas
export const MAX_FRAMES = 160 // 80 s de video por análisis
const COARSE_STEP = 1 // primera pasada; la segunda rellena a SAMPLE_STEP donde hay movimiento
const CONCURRENCY = 8
const FRAME_WIDTH = 640
const RETRIES = 2
/** Desplazamiento entre dos muestras, en alturas de cuerpo, a partir del cual se afina el tramo */
const REFINE_MOVE_HEIGHTS = 0.8
const PERSON_HEIGHT_M = 1.75
const SPRINT_MS = 5 // m/s estimados (mismo valor que SPRINT_THRESHOLD)
const MAX_PLAUSIBLE_MS = 11 // por encima se asume un cambio de identidad
const BALL_FAST_MS = 12
const REFRACTORY_S = 2
/** Tiempo que se recuerda a una persona que dejó de detectarse, para no darle otra identidad al reaparecer */
const TRACK_MEMORY_S = 2.6

export interface AnalyzedFrame {
  t: number
  persons: Person[]
  ball: { box: Box; conf: number } | null
  /** Si en este fotograma se buscó el balón */
  ballChecked: boolean
}

export interface RealEvent {
  t: number
  code: EvCode
  type: string
  desc: string
  /** Persona del seguimiento a la que pertenece el evento, si la hay */
  personId?: number
}

/** Todo lo medido de una persona a lo largo del tramo analizado. */
export interface PersonStats {
  id: number
  /** Recorte de la persona en su mejor fotograma, como data URL */
  thumb: string | null
  thumbT: number
  thumbBox: Box
  conf: number
  meters: number
  topSpeed: number
  avgSpeed: number
  firstT: number
  lastT: number
  samples: number
  sprints: number
  events: RealEvent[]
  /** Ángulos articulares en el fotograma de la foto */
  angles: JointAngle[]
  points: { x: number; y: number }[]
  speeds: { t: number; v: number }[]
}

export const MAX_PEOPLE = 20
export const SPRINT_THRESHOLD = 5

export interface VideoAnalysis {
  /** Deporte con el que se analizó; los eventos y el Coach dependen de él */
  sport: SportId
  start: number
  end: number
  step: number
  frames: AnalyzedFrame[]
  withBall: boolean
  kpis: Kpi[]
  events: RealEvent[]
  legend: [EvCode, string][]
  /** Distancia estimada por persona seguida, de mayor a menor */
  perf: [player: string, pct: number, meters: number][]
  /** Ficha de cada persona seguida, de mayor a menor distancia */
  people: PersonStats[]
  /** Posición de los pies de cada detección, normalizada a la imagen */
  points: { x: number; y: number }[]
  /** Informe de técnica del AI Coach; null si esa parte del análisis falló */
  coach: CoachReport | null
  /** Por qué no hay informe de técnica, si falló */
  coachError?: string
}

/** Avance del análisis: primero el video completo, después la técnica de cada jugador. */
export interface ScanProgress {
  stage: 'video' | 'tecnica'
  done: number
  total: number
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Reintenta los fallos pasajeros (límite de peticiones, cortes de red). */
async function requestWithRetry(image: string, ball: boolean, signal: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await requestVision(image, ball, signal)
    } catch (e) {
      const transient = e instanceof VisionError && e.code === 'failed'
      if (!transient || attempt >= RETRIES || signal.aborted) throw e
      await wait(600 * (attempt + 1))
    }
  }
}

/** ¿Se mueve alguien lo bastante entre dos muestras como para mirar el fotograma intermedio? */
function needsRefine(a: AnalyzedFrame, b: AnalyzedFrame, aspect: number, sport: SportId): boolean {
  if (a.persons.length !== b.persons.length) return true
  for (const p of a.persons) {
    let best = Infinity
    for (const q of b.persons) {
      const dx = (q.box.x + q.box.w / 2 - p.box.x - p.box.w / 2) * aspect
      const dy = q.box.y + q.box.h - p.box.y - p.box.h
      best = Math.min(best, Math.hypot(dx, dy) / ((p.box.h + q.box.h) / 2 || 1))
    }
    if (best > REFINE_MOVE_HEIGHTS) return true
  }
  if (sport === 'basket') {
    // Un brazo levantado puede ser el inicio de un tiro: se afina para no perderlo.
    for (const p of [...a.persons, ...b.persons]) {
      const kp = new Map(p.keypoints.filter((k) => k.conf >= MIN_KEYPOINT_CONF).map((k) => [k.name, k]))
      const raised = (wrist: string, shoulder: string) => {
        const w = kp.get(wrist)
        const s = kp.get(shoulder)
        return !!w && !!s && w.y < s.y
      }
      if (raised('left_wrist', 'left_shoulder') || raised('right_wrist', 'right_shoulder')) return true
    }
  }
  return false
}

/**
 * Analiza hasta 80 s de video a partir de `startSec`, en dos pasadas: una
 * muestra por segundo y, después, las intermedias solo donde hay movimiento.
 */
export async function runVideoAnalysis(
  url: string,
  sport: SportId,
  opts: { startSec: number; ball: boolean; onProgress: (p: ScanProgress) => void; signal: AbortSignal },
): Promise<VideoAnalysis> {
  const video = await loadVideo(url)
  const duration = video.duration
  const aspect = video.videoWidth / video.videoHeight || 16 / 9
  const start = Math.max(0, Math.min(opts.startSec, Math.max(0, duration - COARSE_STEP)))
  const limit = Math.min(duration, start + MAX_FRAMES * SAMPLE_STEP)
  const coarse: number[] = []
  for (let t = start; t < limit; t += COARSE_STEP) coarse.push(t)
  if (coarse.length < 2) throw new VisionError('failed', 'El video es demasiado corto para analizarlo.')

  const byTime = new Map<number, AnalyzedFrame>()
  let done = 0
  let total = coarse.length
  let failure: unknown = null

  const pass = async (times: number[], ball: boolean) => {
    const pending = new Set<Promise<void>>()
    for (const t of times) {
      if (failure || opts.signal.aborted) break
      // La captura es secuencial (un solo <video>); las peticiones van en paralelo.
      await seekTo(video, t)
      const image = grabFrame(video, FRAME_WIDTH, 0.7)
      if (!image) continue
      const job = requestWithRetry(image, ball, opts.signal)
        .then((raw) => {
          byTime.set(t, { t, persons: raw.persons.map((p, n) => ({ ...p, id: n + 1 })), ball: raw.ball, ballChecked: ball })
        })
        .catch((e) => {
          failure ??= e
        })
        .finally(() => {
          pending.delete(job)
          opts.onProgress({ stage: 'video', done: ++done, total })
        })
      pending.add(job)
      if (pending.size >= CONCURRENCY) await Promise.race(pending)
    }
    await Promise.all(pending)
  }

  // El balón solo se busca en la primera pasada: basta una muestra por segundo.
  await pass(coarse, opts.ball)

  if (!failure && !opts.signal.aborted) {
    const mid: number[] = []
    for (let i = 0; i + 1 < coarse.length; i++) {
      const a = byTime.get(coarse[i])
      const b = byTime.get(coarse[i + 1])
      if (a && b && needsRefine(a, b, aspect, sport)) mid.push(coarse[i] + SAMPLE_STEP)
    }
    total += mid.length
    await pass(mid, false)
  }

  const dispose = () => disposeVideo(video)
  if (opts.signal.aborted || failure) {
    dispose()
    if (opts.signal.aborted) throw new DOMException('Análisis cancelado', 'AbortError')
    throw failure
  }

  // El seguimiento se hace al final, en orden temporal.
  const frames = [...byTime.values()].sort((x, y) => x.t - y.t)
  const nextId = { current: 1 }
  const lastSeen = new Map<number, { t: number; p: Person }>()
  let prevT = -Infinity
  for (const f of frames) {
    // Quien falta en una muestra suelta (un desenfoque, un cruce) conserva su identidad si reaparece pronto y cerca.
    const recent = [...lastSeen.values()].filter((o) => f.t - o.t <= TRACK_MEMORY_S)
    const stale = new Set(recent.filter((o) => o.t < prevT).map((o) => o.p.id))
    f.persons = trackPersons(recent.map((o) => o.p), f.persons, nextId, aspect, stale)
    for (const p of f.persons) lastSeen.set(p.id, { t: f.t, p })
    prevT = f.t
  }
  const analysis = summarize(frames, sport, aspect, opts.ball, start)

  // Foto de cada persona: se vuelve a su mejor fotograma y se recorta su caja.
  for (const person of analysis.people) {
    if (opts.signal.aborted) break
    try {
      await seekTo(video, person.thumbT)
      person.thumb = cropPerson(video, person.thumbBox)
    } catch {
      person.thumb = null
    }
  }

  // Técnica: se mide de cerca a los protagonistas. Si falla, el resto del análisis se conserva.
  if (!opts.signal.aborted) {
    try {
      const coarse = { sport, start, end: Math.min(duration, analysis.end + COARSE_STEP), frames: analysis.frames, events: analysis.events }
      analysis.coach = await runCoach(video, coarse, {
        signal: opts.signal,
        onProgress: (n, of) => opts.onProgress({ stage: 'tecnica', done: n, total: of }),
      })
      for (const p of analysis.coach.people) p.thumb = analysis.people.find((x) => x.id === p.personId)?.thumb ?? null
    } catch (e) {
      if ((e as Error).name !== 'AbortError') analysis.coachError = e instanceof VisionError ? e.message : 'No se pudo medir la técnica en este video.'
    }
  }
  dispose()
  if (opts.signal.aborted) throw new DOMException('Análisis cancelado', 'AbortError')
  return analysis
}

let cropCanvas: HTMLCanvasElement | null = null

function cropPerson(video: HTMLVideoElement, box: Box): string | null {
  const vw = video.videoWidth
  const vh = video.videoHeight
  const padX = box.w * 0.18
  const padY = box.h * 0.1
  const x = Math.max(0, (box.x - padX) * vw)
  const y = Math.max(0, (box.y - padY) * vh)
  const w = Math.min(vw - x, (box.w + padX * 2) * vw)
  const h = Math.min(vh - y, (box.h + padY * 2) * vh)
  if (w < 4 || h < 4) return null
  const scale = Math.min(1, 420 / h)
  cropCanvas ??= document.createElement('canvas')
  cropCanvas.width = Math.round(w * scale)
  cropCanvas.height = Math.round(h * scale)
  const ctx = cropCanvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(video, x, y, w, h, 0, 0, cropCanvas.width, cropCanvas.height)
  return cropCanvas.toDataURL('image/jpeg', 0.82)
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

const feet = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h })

function summarize(frames: AnalyzedFrame[], sport: SportId, aspect: number, withBall: boolean, start: number): VideoAnalysis {
  const events: RealEvent[] = []
  const tracks = new Map<number, { t: number; p: Person }[]>()
  const points: { x: number; y: number }[] = []
  for (const f of frames) {
    for (const p of f.persons) {
      if (!tracks.has(p.id)) tracks.set(p.id, [])
      tracks.get(p.id)!.push({ t: f.t, p })
      points.push(feet(p.box))
    }
  }

  let topSpeed = 0
  let topSpeedId = 0
  let sprints = 0
  const distance = new Map<number, number>()
  const people: PersonStats[] = []

  for (const [id, obs] of tracks) {
    // La altura mediana de la caja es la regla: equivale a ~1,75 m.
    const height = median(obs.map((o) => o.p.box.h))
    if (!height) continue
    let meters = 0
    let moving = 0
    let best = 0
    let own = 0
    const speeds: { t: number; v: number }[] = []
    const mine: RealEvent[] = []
    let sprinting = false
    let lastSprint = -Infinity
    let lastArms = -Infinity
    for (let i = 0; i < obs.length; i++) {
      const cur = obs[i]
      if (i > 0) {
        const before = obs[i - 1]
        const dt = cur.t - before.t
        if (dt > 0 && dt <= COARSE_STEP * 1.25) {
          const a = feet(before.p.box)
          const b = feet(cur.p.box)
          const d = (Math.hypot((b.x - a.x) * aspect, b.y - a.y) / height) * PERSON_HEIGHT_M
          const speed = d / dt
          if (speed <= MAX_PLAUSIBLE_MS) {
            meters += d
            moving += dt
            best = Math.max(best, speed)
            speeds.push({ t: cur.t, v: speed })
            if (speed > topSpeed) {
              topSpeed = speed
              topSpeedId = id
            }
            if (speed >= SPRINT_MS && !sprinting && cur.t - lastSprint >= REFRACTORY_S) {
              sprints++
              own++
              lastSprint = cur.t
              mine.push({ t: cur.t, code: 'S', type: 'Sprint', desc: `Persona #${id} — ${comma(speed)} m/s estimados`, personId: id })
            }
            sprinting = speed >= SPRINT_MS
          }
        }
      }
      if (sport === 'basket') {
        const kp = new Map(cur.p.keypoints.filter((k) => k.conf >= MIN_KEYPOINT_CONF).map((k) => [k.name, k]))
        const lw = kp.get('left_wrist')
        const rw = kp.get('right_wrist')
        const head = kp.get('nose') ?? kp.get('left_eye') ?? kp.get('right_eye')
        if (lw && rw && head && lw.y < head.y && rw.y < head.y && cur.t - lastArms >= REFRACTORY_S) {
          lastArms = cur.t
          mine.push({ t: cur.t, code: 'T', type: 'Posible tiro', desc: `Persona #${id} — ambas manos sobre la cabeza`, personId: id })
        }
      }
    }
    if (meters > 0) distance.set(id, meters)
    events.push(...mine)

    // La foto sale de la observación más nítida: caja grande y detección segura.
    const shot = obs.reduce((a, b) => (b.p.conf * b.p.box.w * b.p.box.h > a.p.conf * a.p.box.w * a.p.box.h ? b : a))
    people.push({
      id,
      thumb: null,
      thumbT: shot.t,
      thumbBox: shot.p.box,
      conf: obs.reduce((sum, o) => sum + o.p.conf, 0) / obs.length,
      meters,
      topSpeed: best,
      avgSpeed: moving > 0 ? meters / moving : 0,
      firstT: obs[0].t,
      lastT: obs[obs.length - 1].t,
      samples: obs.length,
      sprints: own,
      events: mine,
      angles: jointAngles(shot.p, aspect),
      points: obs.map((o) => feet(o.p.box)),
      speeds,
    })
  }

  // Balón rápido: desplazamiento entre muestras consecutivas, con la altura mediana de las personas como escala.
  const scale = median(frames.flatMap((f) => f.persons.map((p) => p.box.h)))
  let ballFrames = 0
  let ballChecked = 0
  let lastBallEvent = -Infinity
  let lastBall: AnalyzedFrame | null = null
  for (const cur of frames) {
    if (cur.ballChecked) ballChecked++
    if (!cur.ball) continue
    ballFrames++
    const before = lastBall
    lastBall = cur
    if (!before?.ball || !scale) continue
    const dt = cur.t - before.t
    if (dt <= 0 || dt > COARSE_STEP * 1.25) continue
    const a = before.ball.box
    const b = cur.ball.box
    const d = (Math.hypot((b.x + b.w / 2 - a.x - a.w / 2) * aspect, b.y + b.h / 2 - a.y - a.h / 2) / scale) * PERSON_HEIGHT_M
    if (d / dt >= BALL_FAST_MS && cur.t - lastBallEvent >= REFRACTORY_S) {
      lastBallEvent = cur.t
      events.push({
        t: cur.t,
        code: 'T',
        type: sport === 'basket' ? 'Balón rápido' : 'Golpeo de balón',
        desc: `Balón a ${comma(d / dt)} m/s estimados`,
      })
    }
  }
  events.sort((x, y) => x.t - y.t)

  const counts = frames.map((f) => f.persons.length)
  const avg = counts.reduce((s, n) => s + n, 0) / (counts.length || 1)
  const total = [...distance.values()].reduce((s, m) => s + m, 0)
  const ranked = [...distance.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5)
  const best = ranked[0]?.[1] || 1
  const end = frames[frames.length - 1].t

  const kpis: Kpi[] = [
    { label: 'Personas en cuadro', value: `máx. ${Math.max(0, ...counts)}`, delta: `media ${comma(avg)} por fotograma`, trend: 0 },
    { label: 'Vel. máxima (est.)', value: `${comma(topSpeed)} m/s`, delta: topSpeedId ? `Persona #${topSpeedId}` : 'Sin desplazamientos', trend: 0 },
    { label: 'Distancia total (est.)', value: `${Math.round(total)} m`, delta: `${distance.size} personas seguidas`, trend: 0 },
    { label: 'Sprints', value: String(sprints), delta: `Umbral ${SPRINT_MS} m/s estimados`, trend: 0 },
    {
      label: 'Balón detectado',
      value: withBall && ballChecked ? `${Math.round((ballFrames / ballChecked) * 100)} %` : '—',
      delta: withBall ? `${ballFrames} de ${ballChecked} fotogramas revisados` : 'Activa "Detectar balón"',
      trend: 0,
    },
    { label: 'Fotogramas analizados', value: String(frames.length), delta: `${fmtTime(start)} – ${fmtTime(end)} · cada ${comma(SAMPLE_STEP)}–${COARSE_STEP} s`, trend: 0 },
  ]

  return {
    sport,
    start,
    end,
    step: COARSE_STEP,
    frames,
    withBall,
    kpis,
    events,
    legend: [
      ['S', 'Sprint'],
      ['T', sport === 'basket' ? 'Posible tiro o balón rápido' : 'Golpeo de balón'],
    ],
    perf: ranked.map(([id, m]) => [`#${id}`, Math.round((m / best) * 100), Math.round(m)]),
    people: people.sort((a, b) => b.meters - a.meters || b.samples - a.samples).slice(0, MAX_PEOPLE),
    points,
    coach: null,
  }
}

/** Fotograma analizado más cercano al instante `t`, si está dentro del paso de muestreo. */
export function frameAt(va: VideoAnalysis, t: number): AnalyzedFrame | null {
  let best: AnalyzedFrame | null = null
  for (const f of va.frames) {
    if (!best || Math.abs(f.t - t) < Math.abs(best.t - t)) best = f
  }
  return best && Math.abs(best.t - t) <= va.step ? best : null
}

export function toGameEvents(va: VideoAnalysis, secs: number): GameEvent[] {
  return va.events.map((e) => ({ pct: (e.t / secs) * 100, code: e.code, type: e.type, desc: e.desc }))
}
