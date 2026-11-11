// Limpieza y utilidades sobre una serie temporal de poses. El modelo de pose
// falla a veces en un fotograma suelto (un punto salta a otro sitio); aquí se
// quitan esos saltos y se rellenan los huecos cortos, sin suavizar de más para
// no aplanar justo los instantes que interesa medir (soltar el balón, golpear).

import { center, dist, joint, MIN_CONF, pt, SIDES, torsoLength } from './geometry'
import { JOINTS, type Joint, type Pose, type PoseFrame, type PoseSeries, type Pt } from './types'

/** Suma de tronco, muslo y pierna como fracción de la estatura, con los puntos que da el modelo de pose. */
const TRUNK_LEG_FRACTION = 0.73
/** Un punto que se aparta más de esto (en estaturas) de sus dos vecinos, que sí coinciden entre sí, es un fallo del modelo. */
const SPIKE_HEIGHTS = 0.12
/** Los vecinos solo sirven de referencia si están cerca en el tiempo. */
const NEIGHBOR_MAX_S = 0.26
/** Hueco máximo que se rellena interpolando. */
const FILL_MAX_S = 0.22
/** Franja junto al borde del video, como fracción de su lado menor, donde un punto no es de fiar. */
const EDGE_FRACTION = 0.012

function percentile(values: number[], q: number): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]
}

/**
 * Estatura aproximada de la persona en píxeles, a partir de los segmentos que
 * no cambian de largo al moverse (tronco, muslo y pierna). Se toma un percentil
 * alto porque el escorzo solo puede acortarlos, nunca alargarlos.
 */
export function estimateStature(frames: PoseFrame[]): number | null {
  const sums: number[] = []
  for (const f of frames) {
    const torso = torsoLength(f.pose)
    if (!torso) continue
    let leg = 0
    for (const side of SIDES) {
      const hip = pt(f.pose, joint(side, 'hip'))
      const knee = pt(f.pose, joint(side, 'knee'))
      const ankle = pt(f.pose, joint(side, 'ankle'))
      if (hip && knee && ankle) leg = Math.max(leg, dist(hip, knee) + dist(knee, ankle))
    }
    if (leg) sums.push(torso + leg)
  }
  const p = percentile(sums, 0.75)
  if (p !== null) return p / TRUNK_LEG_FRACTION
  // Sin piernas visibles: la caja de la persona como último recurso.
  const boxes = percentile(frames.map((f) => f.box.h), 0.75)
  return boxes
}

const lerpPt = (a: Pt, b: Pt, k: number, c: number): Pt => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, c })

/**
 * Devuelve una copia de la serie sin puntos de baja confianza, sin saltos de un
 * solo fotograma y con los huecos cortos rellenados por interpolación.
 */
export function cleanSeries(series: PoseSeries): PoseSeries {
  const src = series.frames
  const stature = estimateStature(src) ?? 1
  const frames: PoseFrame[] = src.map((f) => ({ ...f, pose: {} as Pose }))
  // Un punto pegado al borde del video suele ser una parte del cuerpo que se salió del cuadro:
  // el modelo la coloca en el borde, pero no está ahí.
  const edge = EDGE_FRACTION * Math.min(series.width, series.height)
  const inFrame = (p: Pt | null) => (p && p.x >= edge && p.y >= edge && p.x <= series.width - edge && p.y <= series.height - edge ? p : null)

  for (const name of JOINTS) {
    // 1. Solo los puntos vistos con confianza y dentro del cuadro.
    const pts: (Pt | null)[] = src.map((f) => inFrame(pt(f.pose, name)))

    // 2. Saltos: el punto se aparta de sus vecinos, que entre sí coinciden.
    for (let i = 1; i + 1 < pts.length; i++) {
      const a = pts[i - 1]
      const p = pts[i]
      const b = pts[i + 1]
      if (!a || !p || !b) continue
      if (src[i + 1].t - src[i - 1].t > NEIGHBOR_MAX_S * 2) continue
      const k = (src[i].t - src[i - 1].t) / (src[i + 1].t - src[i - 1].t || 1)
      const expected = lerpPt(a, b, k, 1)
      const limit = SPIKE_HEIGHTS * stature
      if (dist(p, expected) > limit && dist(a, b) < limit) pts[i] = null
    }

    // 3. Huecos cortos entre dos puntos buenos.
    for (let i = 0; i < pts.length; i++) {
      if (pts[i]) continue
      let lo = i - 1
      while (lo >= 0 && !pts[lo]) lo--
      let hi = i + 1
      while (hi < pts.length && !pts[hi]) hi++
      if (lo < 0 || hi >= pts.length) continue
      const a = pts[lo]!
      const b = pts[hi]!
      if (src[hi].t - src[lo].t > FILL_MAX_S) continue
      const k = (src[i].t - src[lo].t) / (src[hi].t - src[lo].t || 1)
      // La confianza baja a propósito: es un punto supuesto, no visto.
      frames[i].pose[name] = lerpPt(a, b, k, Math.max(MIN_CONF, Math.min(a.c, b.c) * 0.8))
    }

    pts.forEach((p, i) => {
      if (p) frames[i].pose[name as Joint] = p
    })
  }
  return { ...series, frames }
}

/** Valor de una medida en cada fotograma (null donde no se puede medir). */
export function signal(frames: PoseFrame[], measure: (pose: Pose) => number | null): (number | null)[] {
  return frames.map((f) => measure(f.pose))
}

/** Mediana móvil de 3: quita un valor suelto disparatado sin retrasar la señal. */
export function median3(values: (number | null)[]): (number | null)[] {
  return values.map((v, i) => {
    const w = [values[i - 1], v, values[i + 1]].filter((x): x is number => x !== null && x !== undefined)
    if (v === null || w.length < 2) return v
    w.sort((a, b) => a - b)
    return w.length === 3 ? w[1] : v
  })
}

/** Índice del mínimo (o del máximo) de una señal dentro de [from, to], ignorando nulos. */
export function argExtreme(values: (number | null)[], from: number, to: number, kind: 'min' | 'max'): number | null {
  let best: number | null = null
  for (let i = Math.max(0, from); i <= Math.min(values.length - 1, to); i++) {
    const v = values[i]
    if (v === null) continue
    if (best === null || (kind === 'min' ? v < values[best]! : v > values[best]!)) best = i
  }
  return best
}

/**
 * Extremo robusto: el segundo valor más extremo del tramo, para que un único
 * fotograma mal medido no decida el resultado. Con menos de 3 valores usa el extremo.
 */
export function robustExtreme(values: (number | null)[], from: number, to: number, kind: 'min' | 'max'): number | null {
  const vs: number[] = []
  for (let i = Math.max(0, from); i <= Math.min(values.length - 1, to); i++) {
    const v = values[i]
    if (v !== null) vs.push(v)
  }
  if (!vs.length) return null
  vs.sort((a, b) => (kind === 'min' ? a - b : b - a))
  return vs.length >= 3 ? vs[1] : vs[0]
}

/** Primer índice con t ≥ el instante dado. */
export function indexAt(frames: PoseFrame[], t: number): number {
  let i = 0
  while (i < frames.length - 1 && frames[i].t < t) i++
  return i
}

/** Velocidad de un punto en píxeles por segundo, por diferencias centradas. */
export function speedOf(frames: PoseFrame[], get: (pose: Pose) => Pt | null): (number | null)[] {
  const ps = frames.map((f) => get(f.pose))
  return ps.map((p, i) => {
    const a = ps[i - 1] ?? null
    const b = ps[i + 1] ?? null
    if (a && b) return dist(a, b) / (frames[i + 1].t - frames[i - 1].t || 1)
    if (p && b) return dist(p, b) / (frames[i + 1].t - frames[i].t || 1)
    if (a && p) return dist(a, p) / (frames[i].t - frames[i - 1].t || 1)
    return null
  })
}

/** Centro de las caderas, o de los hombros si las caderas no se ven. */
export const bodyCenter = (pose: Pose): Pt | null => center(pose, 'hip') ?? center(pose, 'shoulder')
