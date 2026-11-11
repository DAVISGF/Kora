// Qué mirar de cerca: a partir de la pasada gruesa del video (una muestra por
// segundo) decide a qué personas se les mide la técnica y en qué tramos, sin
// pasarse del presupuesto de fotogramas del análisis.

import type { SportId } from '../../data/sports'
import type { Box } from '../vision'
import type { WindowReason } from './types'

/** Fotogramas de técnica por análisis, entre todas las personas. */
export const DENSE_BUDGET = 320
/** Cadencia máxima de la pasada base: de sobra para un tiro o una carrera. */
export const FPS_MAX = 16
/** Cadencia con la que se afina alrededor de un golpeo, que dura décimas de segundo. */
export const FPS_REFINE = 24
/** Por debajo de esta cadencia un tiro o un golpeo quedan mal resueltos: se pasa a mirar solo tramos. */
export const FPS_MIN = 10
/** Altura mínima de la persona, como fracción del alto del video, para medirle la técnica. */
export const MIN_HEIGHT = 0.12
export const MAX_PROTAGONISTS = 2
const MIN_SAMPLES = 3
const GAP_S = 1.6
const PAD_S = 0.45

export interface TrackSample {
  t: number
  box: Box
  conf: number
}

export interface Track {
  id: number
  samples: TrackSample[]
  /** Presencia × tamaño: cuánto protagonismo tiene en el video */
  score: number
  /** Altura mediana, como fracción del alto del video */
  height: number
}

export interface CoarseFrame {
  t: number
  persons: { id: number; box: Box; conf: number }[]
}

export interface CoarseEvent {
  t: number
  code: string
  personId?: number
}

export interface Window {
  start: number
  end: number
  reason: WindowReason
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[s.length >> 1] : 0
}

export function buildTracks(frames: CoarseFrame[]): Track[] {
  const byId = new Map<number, TrackSample[]>()
  for (const f of frames) {
    for (const p of f.persons) {
      if (!byId.has(p.id)) byId.set(p.id, [])
      byId.get(p.id)!.push({ t: f.t, box: p.box, conf: p.conf })
    }
  }
  return [...byId.entries()].map(([id, samples]) => ({
    id,
    samples,
    score: samples.reduce((s, o) => s + o.conf * o.box.w * o.box.h, 0),
    height: median(samples.map((o) => o.box.h)),
  }))
}

export interface Selection {
  chosen: Track[]
  /** Personas que se ven, pero demasiado pequeñas para medirles la técnica */
  tooSmall: number
}

/**
 * Las personas a las que se les mide la técnica: las que más se ven. Una
 * persona de fondo, con mucho menos protagonismo que la principal, se deja fuera.
 */
export function pickProtagonists(tracks: Track[], max = MAX_PROTAGONISTS): Selection {
  const present = tracks.filter((t) => t.samples.length >= MIN_SAMPLES)
  const big = present.filter((t) => t.height >= MIN_HEIGHT).sort((a, b) => b.score - a.score)
  const top = big[0]?.score ?? 0
  return { chosen: big.filter((t) => t.score >= top * 0.3).slice(0, max), tooSmall: present.length - big.length }
}

function merge(windows: Window[]): Window[] {
  const sorted = [...windows].sort((a, b) => a.start - b.start)
  const out: Window[] = []
  for (const w of sorted) {
    const last = out[out.length - 1]
    if (last && w.start <= last.end + 0.05) last.end = Math.max(last.end, w.end)
    else out.push({ ...w })
  }
  return out
}

const length = (ws: Window[]) => ws.reduce((s, w) => s + (w.end - w.start), 0)

/** Tramos seguidos en los que la persona aparece en la pasada gruesa. */
export function presence(track: Track, lo: number, hi: number): Window[] {
  const out: Window[] = []
  for (const s of track.samples) {
    const last = out[out.length - 1]
    if (last && s.t - last.end <= GAP_S) last.end = s.t
    else out.push({ start: s.t, end: s.t, reason: 'clip' })
  }
  return out.map((w) => ({ ...w, start: Math.max(lo, w.start - PAD_S), end: Math.min(hi, w.end + PAD_S) })).filter((w) => w.end - w.start >= 0.8)
}

/** Recorta la lista de tramos, en orden, para que no pase de `seconds`. */
function fit(windows: Window[], seconds: number): Window[] {
  const out: Window[] = []
  let left = seconds
  for (const w of windows) {
    if (left < 0.8) break
    const take = Math.min(left, w.end - w.start)
    out.push({ ...w, end: w.start + take })
    left -= take
  }
  return out
}

export interface Plan {
  /** Cadencia común a todas las personas: así cada fotograma del video se lee una sola vez */
  fps: number
  windows: Map<number, Window[]>
}

/**
 * Tramos a muestrear de cada persona y a qué cadencia. Si el presupuesto alcanza
 * para verlas enteras a buena cadencia se mira todo; si no, primero los momentos
 * que la pasada gruesa marcó (un posible tiro, un sprint, un golpeo) y después,
 * con lo que sobre, el resto en orden.
 */
export function planWindows(tracks: Track[], events: CoarseEvent[], sport: SportId, opts: { budget: number; start: number; end: number }): Plan {
  const seen = tracks.map((t) => presence(t, opts.start, opts.end))
  const total = seen.reduce((s, ws) => s + length(ws), 0)
  const windows = new Map<number, Window[]>()
  if (total <= 0) return { fps: FPS_MIN, windows }
  if (opts.budget / total >= FPS_MIN) {
    tracks.forEach((t, n) => windows.set(t.id, seen[n]))
    return { fps: Math.min(FPS_MAX, Math.floor(opts.budget / total)), windows }
  }

  const seconds = opts.budget / FPS_MIN / tracks.length
  const clamp = (w: Window): Window => ({ ...w, start: Math.max(opts.start, w.start), end: Math.min(opts.end, w.end) })
  tracks.forEach((track, n) => {
    const mine = seen[n]
    const inside = (t: number) => mine.some((w) => t >= w.start - 0.5 && t <= w.end + 0.5)
    const around: Window[] = []
    for (const e of events) {
      if (!inside(e.t)) continue
      if (e.personId === track.id && e.code === 'S') around.push({ start: e.t - 1.5, end: e.t + 1, reason: 'sprint' })
      else if (e.personId === track.id && e.code === 'T') around.push({ start: e.t - 1.6, end: e.t + 1.2, reason: 'shot' })
      // El balón rápido no tiene dueño: se mira a los protagonistas justo antes, por si fue su golpeo.
      else if (e.personId === undefined && e.code === 'T' && sport === 'futbol') around.push({ start: e.t - 1.7, end: e.t + 0.5, reason: 'kick' })
    }
    const marked = fit(merge(around.map(clamp)), seconds)
    // Lo que sobre del presupuesto se dedica al resto de su presencia, en orden.
    const rest: Window[] = []
    for (const w of mine) {
      let from = w.start
      for (const m of marked) {
        if (m.end <= from || m.start >= w.end) continue
        if (m.start - from >= 0.8) rest.push({ start: from, end: m.start, reason: 'clip' })
        from = Math.max(from, m.end)
      }
      if (w.end - from >= 0.8) rest.push({ start: from, end: w.end, reason: 'clip' })
    }
    windows.set(track.id, [...marked, ...fit(rest, seconds - length(marked))].sort((a, b) => a.start - b.start))
  })
  return { fps: FPS_MIN, windows }
}

export interface Capture {
  t: number
  ids: number[]
}

/**
 * Instantes a capturar, en una rejilla común de `fps`, con las personas a medir
 * en cada uno. `skip` evita repetir los instantes que ya se midieron.
 */
export function captures(windows: Map<number, Window[]>, fps: number, skip?: Map<number, number[]>): Capture[] {
  const byTick = new Map<number, number[]>()
  for (const [id, ws] of windows) {
    const done = skip?.get(id) ?? []
    for (const w of ws) {
      for (let k = Math.ceil(w.start * fps - 1e-6); k / fps <= w.end + 1e-6; k++) {
        const t = k / fps
        if (done.some((d) => Math.abs(d - t) < 0.012)) continue
        const ids = byTick.get(k) ?? []
        if (!ids.includes(id)) ids.push(id)
        byTick.set(k, ids)
      }
    }
  }
  return [...byTick.entries()].sort((a, b) => a[0] - b[0]).map(([k, ids]) => ({ t: Math.round((k / fps) * 1000) / 1000, ids }))
}

export const countCaptures = (plan: Capture[]) => plan.reduce((s, c) => s + c.ids.length, 0)
