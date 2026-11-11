// Carrera. Se reconoce por la alternancia de los pies: mientras uno apoya, el
// otro sube por detrás. Con eso se cuentan los pasos y se mide lo que un
// entrenador miraría: brazos, rodillas y tronco.

import { bodyOf, percentile, span, thighLift, type Body } from '../body'
import { angleAt, center, joint, pt, SIDES, width } from '../geometry'
import { median3 } from '../series'
import type { Measure, Missing, PoseSeries, Rep, Side, View } from '../types'

/** Diferencia de altura entre los tobillos, en troncos, para contar un pie como «arriba». */
const SWING_MIN = 0.3
/** Al correr el pie de atrás sube bastante más que al caminar. */
const RUN_SWING = 0.42
const MIN_STEPS = 4
const MAX_GAP_S = 0.5
/** Pasos por segundo a partir de los cuales se considera carrera rápida. */
export const FAST_CADENCE = 3.4
/** Por debajo de esto, con zancada de carrera, el video está a cámara lenta. */
const SLOW_CADENCE = 2.2
/** Irregularidad máxima del ritmo de los pasos (desviación entre la media) para hablar de carrera. */
const UNEVEN_MAX = 0.4
/** A cámara lenta se exige más: zancada amplia y ritmo muy regular. */
const SLOW_RUN_SWING = 0.6
const SLOW_UNEVEN_MAX = 0.25
/** Fracción mínima del avance que debe verse a lo ancho de la imagen para medir brazos y tronco. */
const MIN_ACROSS = 0.4

export interface RunRep extends Rep {
  kind: 'run'
}

interface Swing {
  i: number
  t: number
  amp: number
  /** Pierna que está en el aire */
  side: Side
}

function swings(body: Body): Swing[][] {
  const f = body.frames
  const g = median3(
    f.map((fr, i) => {
      const l = pt(fr.pose, 'left_ankle')
      const r = pt(fr.pose, 'right_ankle')
      return l && r ? (r.y - l.y) / body.scale[i] : null
    }),
  )
  const chains: Swing[][] = []
  let chain: Swing[] = []
  let cur: Swing | null = null
  let lastSeen = -Infinity
  const close = () => {
    if (cur) {
      // Con pocos fotogramas por paso, la muestra más alta queda por debajo del pico real:
      // se estima con la parábola que pasa por ella y sus dos vecinas.
      const a = g[cur.i - 1]
      const b = g[cur.i]
      const c = g[cur.i + 1]
      if (a != null && b != null && c != null) {
        const curve = a - 2 * b + c
        if (Math.abs(curve) > 1e-9) cur.amp = Math.max(cur.amp, Math.abs(b - (a - c) ** 2 / (8 * curve)))
      }
      chain.push(cur)
    }
    cur = null
  }
  const cut = () => {
    close()
    if (chain.length) chains.push(chain)
    chain = []
  }
  for (let i = 0; i < f.length; i++) {
    const v = g[i]
    if (v === null) continue
    if (f[i].t - lastSeen > MAX_GAP_S) cut()
    lastSeen = f[i].t
    if (Math.abs(v) < SWING_MIN) continue
    const side: Side = v > 0 ? 'left' : 'right'
    if (cur && cur.side === side) {
      if (Math.abs(v) > cur.amp) cur = { i, t: f[i].t, amp: Math.abs(v), side }
    } else {
      close()
      cur = { i, t: f[i].t, amp: Math.abs(v), side }
    }
  }
  cut()
  return chains
}

const median = (xs: number[]) => percentile(xs, 0.5) ?? 0

/** Parte una cadena de pasos donde el ritmo se rompe. */
function steady(chain: Swing[]): Swing[][] {
  if (chain.length < MIN_STEPS) return []
  const gaps = chain.slice(1).map((s, n) => s.t - chain[n].t)
  const typical = median(gaps)
  const out: Swing[][] = []
  let cur: Swing[] = [chain[0]]
  gaps.forEach((gap, n) => {
    if (gap > typical * 2.2) {
      out.push(cur)
      cur = []
    }
    cur.push(chain[n + 1])
  })
  out.push(cur)
  return out.filter((c) => c.length >= MIN_STEPS)
}

/** Detecta y mide los tramos de carrera de una serie limpia. */
export function detectRuns(series: PoseSeries): RunRep[] {
  const body = bodyOf(series.frames)
  if (!body) return []
  const f = body.frames
  const runs: RunRep[] = []

  for (const bout of swings(body).flatMap(steady)) {
    if (median(bout.map((s) => s.amp)) < RUN_SWING) continue
    const first = bout[0]
    const last = bout[bout.length - 1]
    const step = (last.t - first.t) / (bout.length - 1)
    const start = Math.max(f[0].t, first.t - step / 2)
    const end = Math.min(f[f.length - 1].t, last.t + step / 2)
    const frames = span(f, start, end)
    const m: Record<string, Measure> = {}
    const missing: Record<string, Missing> = {}
    const info: Record<string, number> = { steps: bout.length }
    const gaps = bout.slice(1).map((sw, n) => sw.t - bout[n].t)
    const meanGap = gaps.reduce((a, c) => a + c, 0) / gaps.length
    info.amp = median(bout.map((sw) => sw.amp))
    info.uneven = Math.sqrt(gaps.reduce((a, c) => a + (c - meanGap) ** 2, 0) / gaps.length) / meanGap

    const cadence = 1 / step
    if (cadence >= SLOW_CADENCE) {
      if (info.uneven > UNEVEN_MAX) continue
      info.cadence = cadence
    } else {
      // Pasos lentos: o es una carrera grabada a cámara lenta, o alguien que no corre (camina, amaga,
      // conduce el balón). Solo se toma por carrera si la zancada es amplia y muy regular.
      if (info.amp < SLOW_RUN_SWING || info.uneven > SLOW_UNEVEN_MAX || bout.length < 5) continue
      info.slow = 1
    }

    // ── Rodillas: hasta dónde sube el muslo en cada paso ──
    const lifts: { v: number; t: number; i: number; side: Side }[] = []
    for (const s of bout) {
      let best: { v: number; t: number; i: number; side: Side } | null = null
      for (const i of span(f, s.t - step / 2, s.t + step / 2)) {
        for (const side of SIDES) {
          const v = thighLift(body, i, side)
          if (v !== null && (!best || v > best.v)) best = { v, t: f[i].t, i, side }
        }
      }
      if (best) lifts.push(best)
    }
    if (lifts.length < 3) missing.knees = 'hidden'
    else {
      const value = percentile(lifts.map((l) => l.v), 0.75)!
      const at = lifts.reduce((a, l) => (Math.abs(l.v - value) < Math.abs(a.v - value) ? l : a))
      m.knees = { value, t: at.t, method: 'vertical' }
    }

    // ── Vista y sentido de la carrera: en el punto más alto, la rodilla va por delante de la cadera ──
    const ahead: number[] = []
    for (const l of lifts) {
      if (l.v < 30) continue
      const hip = pt(f[l.i].pose, joint(l.side, 'hip'))
      const knee = pt(f[l.i].pose, joint(l.side, 'knee'))
      if (!hip || !knee) continue
      const reachable = body.k.thigh * body.scale[l.i] * Math.sin((l.v * Math.PI) / 180)
      if (reachable > 1) ahead.push((knee.x - hip.x) / reachable)
    }
    const across = ahead.length >= 2 ? median(ahead) : null
    const view: View = across === null ? 'oblique' : Math.abs(across) >= 0.75 ? 'side' : Math.abs(across) >= MIN_ACROSS ? 'oblique' : 'front'
    const dir = across !== null && Math.abs(across) >= MIN_ACROSS ? Math.sign(across) : 0
    if (across !== null) info.across = Math.abs(across)

    // Brazos y tronco se mueven en el plano de la carrera. Si la cámara no está justo de lado,
    // ese plano se ve estrechado a lo ancho en la proporción `across`: se deshace antes de medir.
    const widen = across !== null && Math.abs(across) >= MIN_ACROSS ? 1 / Math.min(1, Math.abs(across)) : 0

    // ── Brazos: ángulo del codo durante el braceo ──
    if (!widen) missing.arms = 'view'
    else {
      const elbows: { v: number; t: number }[] = []
      for (const i of frames) {
        for (const side of SIDES) {
          const sh = pt(f[i].pose, joint(side, 'shoulder'))
          const el = pt(f[i].pose, joint(side, 'elbow'))
          const wr = pt(f[i].pose, joint(side, 'wrist'))
          if (!sh || !el || !wr) continue
          const v = angleAt({ ...sh, x: sh.x * widen }, { ...el, x: el.x * widen }, { ...wr, x: wr.x * widen })
          if (v !== null) elbows.push({ v, t: f[i].t })
        }
      }
      if (elbows.length < Math.max(6, frames.length * 0.5)) missing.arms = 'hidden'
      else {
        const value = median(elbows.map((e) => e.v))
        const at = elbows.reduce((a, e) => (Math.abs(e.v - value) < Math.abs(a.v - value) ? e : a))
        m.arms = { value, t: at.t, method: 'angle' }
      }
    }

    // ── Tronco: inclinación hacia donde se corre ──
    if (!widen || !dir) missing.lean = 'view'
    else {
      const leans: number[] = []
      for (const i of frames) {
        const shoulders = center(f[i].pose, 'shoulder')
        const hips = center(f[i].pose, 'hip')
        if (shoulders && hips) leans.push((Math.atan2((shoulders.x - hips.x) * widen, hips.y - shoulders.y) * 180) / Math.PI)
      }
      if (leans.length < 4) missing.lean = 'hidden'
      else m.lean = { value: median(leans) * dir, t: (start + end) / 2, method: 'angle' }
    }

    // ── Braceo cruzado: solo si viene de frente o se aleja de espaldas ──
    if (view !== 'front') missing.cross = 'view'
    else {
      const perArm: number[] = []
      let tAt = (start + end) / 2
      for (const side of SIDES) {
        const vs: { v: number; t: number }[] = []
        for (const i of frames) {
          const pose = f[i].pose
          const wrist = pt(pose, joint(side, 'wrist'))
          const shoulder = pt(pose, joint(side, 'shoulder'))
          const mid = center(pose, 'shoulder')
          const sw = width(pose, 'shoulder')
          if (!wrist || !shoulder || !mid || !sw || sw < 0.25 * body.scale[i]) continue
          vs.push({ v: ((mid.x - wrist.x) * Math.sign(shoulder.x - mid.x)) / sw, t: f[i].t })
        }
        if (vs.length < 6) continue
        const p90 = percentile(vs.map((x) => x.v), 0.9)!
        perArm.push(p90)
        tAt = vs.reduce((a, x) => (Math.abs(x.v - p90) < Math.abs(a.v - p90) ? x : a)).t
      }
      // Solo cuenta si cruzan los dos brazos: uno solo puede ser el giro del cuerpo o el ángulo de la cámara.
      if (perArm.length < 2) missing.cross = 'hidden'
      else m.cross = { value: Math.min(...perArm), t: tAt }
    }

    runs.push({ kind: 'run', personId: series.personId, t: (start + end) / 2, start, end, side: null, view, m, missing, info })
  }
  return runs
}
