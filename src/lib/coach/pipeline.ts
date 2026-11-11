// Orquesta el análisis de técnica en el navegador: elige a los protagonistas,
// les mide la pose en los tramos que interesan y entrega las series al motor.

import type { SportId } from '../../data/sports'
import { cropFrame, seekTo } from '../videoFrames'
import { kickCandidates } from './actions/kick'
import { samplePoses } from './densePose'
import { buildReport, type PersonInput } from './report'
import { cleanSeries } from './series'
import type { CoachReport, Finding, PoseFrame, PoseSeries } from './types'
import {
  buildTracks,
  captures,
  countCaptures,
  DENSE_BUDGET,
  FPS_MAX,
  pickProtagonists,
  planWindows,
  type CoarseEvent,
  type CoarseFrame,
  type Track,
  type Window,
} from './windows'

export interface Coarse {
  sport: SportId
  start: number
  end: number
  frames: CoarseFrame[]
  events: CoarseEvent[]
}

export interface Collected {
  /** Personas a las que se les midió la técnica, de más a menos protagonismo */
  tracks: Track[]
  series: PoseSeries[]
  /** Personas que se ven demasiado pequeñas para medirles la técnica */
  tooSmall: number
  requested: number
}

export interface CollectOptions {
  signal: AbortSignal
  onProgress: (done: number, total: number) => void
  budget?: number
  /** Buscar también el balón en cada recorte */
  ball?: boolean
  /**
   * Instantes que merecen verse fotograma a fotograma (un golpeo dura décimas de
   * segundo). Se llama con las series ya medidas a la cadencia base.
   */
  refine?: (series: PoseSeries[]) => { personId: number; t: number }[]
}

/** Fotogramas reservados para afinar alrededor de los instantes clave. */
const REFINE_SHARE = 0.25
const REFINE_HALF_S = 0.45

/** Mide la pose densa de los protagonistas del video. */
export async function collectSeries(video: HTMLVideoElement, coarse: Coarse, opts: CollectOptions): Promise<Collected> {
  const { chosen, tooSmall } = pickProtagonists(buildTracks(coarse.frames))
  const budget = opts.budget ?? DENSE_BUDGET
  const tracks = new Map(chosen.map((t) => [t.id, t.samples]))
  const base = planWindows(chosen, coarse.events, coarse.sport, { budget: Math.round(budget * (1 - REFINE_SHARE)), start: coarse.start, end: coarse.end })
  const plan = captures(base.windows, base.fps)
  let total = countCaptures(plan)
  let done = 0
  const sampling = { signal: opts.signal, ball: opts.ball, onFrame: () => opts.onProgress(++done, total) }
  const frames = await samplePoses(video, tracks, plan, sampling)

  const build = (): PoseSeries[] =>
    chosen.flatMap((track) =>
      (base.windows.get(track.id) ?? []).map((w: Window) => {
        const mine = (frames.get(track.id) ?? []).filter((f: PoseFrame) => f.t >= w.start - 1e-6 && f.t <= w.end + 1e-6)
        return {
          personId: track.id,
          reason: w.reason,
          start: w.start,
          end: w.end,
          fps: base.fps,
          width: video.videoWidth,
          height: video.videoHeight,
          frames: mine,
          requested: Math.max(mine.length, Math.round((w.end - w.start) * base.fps) + 1),
        }
      }),
    )

  // Segunda pasada: alrededor de cada instante clave, todos los fotogramas del video.
  if (opts.refine && base.fps < FPS_MAX - 2) {
    const extra = new Map<number, Window[]>()
    let left = budget - total
    for (const c of opts.refine(build())) {
      const cost = Math.ceil(2 * REFINE_HALF_S * FPS_MAX)
      if (left < cost || !tracks.has(c.personId)) continue
      left -= cost
      const list = extra.get(c.personId) ?? []
      list.push({ start: Math.max(coarse.start, c.t - REFINE_HALF_S), end: Math.min(coarse.end, c.t + REFINE_HALF_S), reason: 'kick' })
      extra.set(c.personId, list)
    }
    const have = new Map([...frames.entries()].map(([id, fs]) => [id, fs.map((f) => f.t)]))
    const more = captures(extra, FPS_MAX, have)
    if (more.length) {
      total += countCaptures(more)
      const added = await samplePoses(video, tracks, more, sampling)
      for (const [id, fs] of added) frames.set(id, [...(frames.get(id) ?? []), ...fs].sort((a, b) => a.t - b.t))
    }
  }

  return { tracks: chosen, series: build(), tooSmall, requested: total }
}

/** Lado mayor de las fotos de evidencia, en píxeles. */
const PHOTO_PX = 460
/** Presencia de otras personas de tamaño parecido a partir de la cual se considera que no está sola. */
const CROWDED_SHARE = 0.3

/** ¿Comparte el cuadro con otras personas de tamaño parecido buena parte del tiempo? */
function crowded(track: Track, frames: CoarseFrame[]): boolean {
  let withOthers = 0
  let present = 0
  for (const f of frames) {
    const me = f.persons.find((p) => p.id === track.id)
    if (!me) continue
    present++
    if (f.persons.some((p) => p.id !== track.id && p.box.h >= me.box.h * 0.5)) withOthers++
  }
  return present > 0 && withOthers / present >= CROWDED_SHARE
}

/**
 * El análisis de técnica completo: mide la pose de los protagonistas, reconoce
 * sus gestos, los califica y saca la foto de cada hallazgo.
 */
export async function runCoach(
  video: HTMLVideoElement,
  coarse: Coarse,
  opts: { signal: AbortSignal; onProgress: (done: number, total: number) => void },
): Promise<CoachReport> {
  const collected = await collectSeries(video, coarse, {
    signal: opts.signal,
    onProgress: opts.onProgress,
    ball: true,
    // Un golpeo dura décimas de segundo: alrededor de cada uno se miran todos los fotogramas.
    refine: coarse.sport === 'futbol' ? (series) => series.flatMap((s) => kickCandidates(cleanSeries(s)).map((t) => ({ personId: s.personId, t }))) : undefined,
  })
  const people: PersonInput[] = collected.tracks.map((track) => ({
    personId: track.id,
    series: collected.series.filter((s) => s.personId === track.id),
    height: track.height,
    crowded: crowded(track, coarse.frames),
  }))
  const report = buildReport({
    sport: coarse.sport,
    people,
    tooSmall: collected.tooSmall,
    frames: { requested: collected.requested, measured: collected.series.reduce((sum, s) => sum + s.frames.length, 0) },
  })

  // La foto de cada hallazgo: se vuelve a su instante y se recorta a la persona.
  const findings = report.people.flatMap((p) => [p.focus, ...p.polish, ...p.good]).filter((f): f is Finding => !!f?.evidence)
  findings.sort((a, b) => a.evidence!.t - b.evidence!.t)
  for (const f of findings) {
    if (opts.signal.aborted) throw new DOMException('Análisis cancelado', 'AbortError')
    try {
      await seekTo(video, f.evidence!.t)
      f.evidence!.image = cropFrame(video, f.evidence!.crop, PHOTO_PX, 0.8, 2)
    } catch {
      f.evidence!.image = null
    }
  }
  return report
}
