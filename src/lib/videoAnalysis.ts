// Análisis del video completo: muestrea fotogramas, los envía al servicio de
// visión y deriva KPIs y eventos de las detecciones. Sin calibración de cámara,
// las distancias se estiman tomando la altura de cada persona como regla.

import type { EvCode, GameEvent, Kpi, SportId } from '../data/sports'
import { comma, fmtTime } from './util'
import { grabFrame, MIN_KEYPOINT_CONF, requestVision, trackPersons, VisionError, type Box, type Person } from './vision'

export const SAMPLE_STEP = 0.5 // segundos entre fotogramas
export const MAX_FRAMES = 160 // 80 s de video por análisis
const CONCURRENCY = 3
const PERSON_HEIGHT_M = 1.75
const SPRINT_MS = 5 // m/s estimados
const MAX_PLAUSIBLE_MS = 11 // por encima se asume un cambio de identidad
const BALL_FAST_MS = 12
const REFRACTORY_S = 2

export interface AnalyzedFrame {
  t: number
  persons: Person[]
  ball: { box: Box; conf: number } | null
}

export interface RealEvent {
  t: number
  code: EvCode
  type: string
  desc: string
}

export interface VideoAnalysis {
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
  /** Posición de los pies de cada detección, normalizada a la imagen */
  points: { x: number; y: number }[]
}

interface Progress {
  done: number
  total: number
}

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => {
      cleanup()
      resolve()
    }
    const fail = () => {
      cleanup()
      reject(new VisionError('failed', 'No se pudo leer el video.'))
    }
    const cleanup = () => {
      video.removeEventListener('seeked', ok)
      video.removeEventListener('error', fail)
    }
    video.addEventListener('seeked', ok)
    video.addEventListener('error', fail)
    video.currentTime = t
  })
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.crossOrigin = 'anonymous'
    video.onloadeddata = () => resolve(video)
    video.onerror = () => reject(new VisionError('failed', 'No se pudo abrir el video para analizarlo.'))
    video.src = url
  })
}

/** Analiza hasta 80 s de video a partir de `startSec`. */
export async function runVideoAnalysis(
  url: string,
  sport: SportId,
  opts: { startSec: number; ball: boolean; onProgress: (p: Progress) => void; signal: AbortSignal },
): Promise<VideoAnalysis> {
  const video = await loadVideo(url)
  const duration = video.duration
  const aspect = video.videoWidth / video.videoHeight || 16 / 9
  const start = Math.max(0, Math.min(opts.startSec, Math.max(0, duration - SAMPLE_STEP)))
  const times: number[] = []
  for (let t = start; t < duration && times.length < MAX_FRAMES; t += SAMPLE_STEP) times.push(t)
  if (times.length < 2) throw new VisionError('failed', 'El video es demasiado corto para analizarlo.')

  const results: (AnalyzedFrame | null)[] = times.map(() => null)
  let done = 0
  let failure: unknown = null
  const pending = new Set<Promise<void>>()

  for (let i = 0; i < times.length; i++) {
    if (failure || opts.signal.aborted) break
    // La captura es secuencial (un solo <video>); las peticiones van en paralelo.
    await seekTo(video, times[i])
    const image = grabFrame(video)
    if (!image) continue
    const job = requestVision(image, opts.ball, opts.signal)
      .then((raw) => {
        results[i] = { t: times[i], persons: raw.persons.map((p, n) => ({ ...p, id: n + 1 })), ball: raw.ball }
      })
      .catch((e) => {
        failure ??= e
      })
      .finally(() => {
        pending.delete(job)
        opts.onProgress({ done: ++done, total: times.length })
      })
    pending.add(job)
    if (pending.size >= CONCURRENCY) await Promise.race(pending)
  }
  await Promise.all(pending)
  video.removeAttribute('src')
  video.load()
  if (opts.signal.aborted) throw new DOMException('Análisis cancelado', 'AbortError')
  if (failure) throw failure

  // El seguimiento se hace al final, en orden temporal.
  const frames = results.filter((f): f is AnalyzedFrame => f !== null)
  const nextId = { current: 1 }
  let prev: Person[] = []
  for (const f of frames) {
    f.persons = trackPersons(prev, f.persons, nextId, aspect)
    prev = f.persons
  }
  return summarize(frames, sport, aspect, opts.ball, start)
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

  for (const [id, obs] of tracks) {
    // La altura mediana de la caja es la regla: equivale a ~1,75 m.
    const height = median(obs.map((o) => o.p.box.h))
    if (!height) continue
    let meters = 0
    let sprinting = false
    let lastSprint = -Infinity
    let lastArms = -Infinity
    for (let i = 0; i < obs.length; i++) {
      const cur = obs[i]
      if (i > 0) {
        const before = obs[i - 1]
        const dt = cur.t - before.t
        if (dt > 0 && dt <= SAMPLE_STEP * 2.5) {
          const a = feet(before.p.box)
          const b = feet(cur.p.box)
          const d = (Math.hypot((b.x - a.x) * aspect, b.y - a.y) / height) * PERSON_HEIGHT_M
          const speed = d / dt
          if (speed <= MAX_PLAUSIBLE_MS) {
            meters += d
            if (speed > topSpeed) {
              topSpeed = speed
              topSpeedId = id
            }
            if (speed >= SPRINT_MS && !sprinting && cur.t - lastSprint >= REFRACTORY_S) {
              sprints++
              lastSprint = cur.t
              events.push({ t: cur.t, code: 'S', type: 'Sprint', desc: `Persona #${id} — ${comma(speed)} m/s estimados` })
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
          events.push({ t: cur.t, code: 'T', type: 'Posible tiro', desc: `Persona #${id} — ambas manos sobre la cabeza` })
        }
      }
    }
    if (meters > 0) distance.set(id, meters)
  }

  // Balón rápido: desplazamiento entre muestras consecutivas, con la altura mediana de las personas como escala.
  const scale = median(frames.flatMap((f) => f.persons.map((p) => p.box.h)))
  let ballFrames = 0
  let lastBallEvent = -Infinity
  for (let i = 0; i < frames.length; i++) {
    const cur = frames[i]
    if (!cur.ball) continue
    ballFrames++
    const before = frames[i - 1]
    if (!before?.ball || !scale) continue
    const dt = cur.t - before.t
    const a = before.ball.box
    const b = cur.ball.box
    const d = (Math.hypot((b.x + b.w / 2 - a.x - a.w / 2) * aspect, b.y + b.h / 2 - a.y - a.h / 2) / scale) * PERSON_HEIGHT_M
    if (dt > 0 && d / dt >= BALL_FAST_MS && cur.t - lastBallEvent >= REFRACTORY_S) {
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
      value: withBall ? `${Math.round((ballFrames / frames.length) * 100)} %` : '—',
      delta: withBall ? `${ballFrames} de ${frames.length} fotogramas` : 'Activa "Detectar balón"',
      trend: 0,
    },
    { label: 'Fotogramas analizados', value: String(frames.length), delta: `${fmtTime(start)} – ${fmtTime(end)} · cada ${comma(SAMPLE_STEP)} s`, trend: 0 },
  ]

  return {
    start,
    end,
    step: SAMPLE_STEP,
    frames,
    withBall,
    kpis,
    events,
    legend: [
      ['S', 'Sprint'],
      ['T', sport === 'basket' ? 'Posible tiro o balón rápido' : 'Golpeo de balón'],
    ],
    perf: ranked.map(([id, m]) => [`#${id}`, Math.round((m / best) * 100), Math.round(m)]),
    points,
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
