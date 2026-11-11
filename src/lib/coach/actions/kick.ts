// Golpeo de fútbol. Se reconoce por el balón: está junto a un pie y, de un
// fotograma al siguiente, sale disparado. Alrededor de ese instante se mide lo
// que un entrenador miraría: pie de apoyo, rodilla de apoyo, tronco y final.

import { ballAt, bodyOf, frontalness, percentile, span, thighLift, type Body } from '../body'
import { angleAt, center, joint, opposite, pt, SIDES, trunkLean } from '../geometry'
import type { BallObs, Measure, Missing, PoseSeries, Rep, Side, View } from '../types'

/** Distancia máxima del balón a un tobillo, en troncos, para decir que está en el pie. */
const AT_FOOT = 1.15
/** Cambio de velocidad del balón, en troncos por segundo, con el que empieza a contar un golpe. */
const ONSET = 2.5
/** Cambio total de velocidad del balón, en troncos por segundo, que delata el golpe. */
const KICK_JUMP = 5
/** Velocidad mínima con la que sale el balón, en troncos por segundo (un pase firme; un toque de conducción es menos). */
const LEAVE_SPEED = 6
/** Lo que el balón debe alejarse del jugador tras el golpe, en troncos. */
const LEAVE_DISTANCE = 1
const BALL_GAP_S = 0.26
const MIN_BETWEEN_S = 0.8
/** Recorrido del pie que golpea, de atrás adelante, en troncos, cuando se ve justo de lado. */
const SWING_SPAN = 2.2
/** Velocidad mínima del pie que golpea respecto a la cadera, en troncos por segundo. */
const SWING_SPEED = 5
/** Velocidad máxima del pie de apoyo respecto a la cadera (la cadera sí avanza sobre él). */
const PLANT_SPEED_MAX = 4
/** Fracción del gesto que debe verse a lo ancho de la imagen para medir apoyo, rodilla y tronco. */
const SIDE_MIN = 0.6
/** Ancho de hombros y caderas con el que el cuerpo se ve del todo de frente (o de espaldas). */
const FULL_FRONT = 1.05
/** Distancia máxima del balón al pie de apoyo, en troncos. */
const REACH_MAX = 1.7

export interface KickRep extends Rep {
  kind: 'kick'
  side: Side
}

interface Seen {
  i: number
  t: number
  ball: BallObs
}

const median = (xs: number[]) => percentile(xs, 0.5)

/** Distancia del balón al tobillo más cercano, en troncos; null si el balón no está a la altura de los pies. */
function footDistance(body: Body, i: number, ball: BallObs): number | null {
  let best: number | null = null
  for (const side of SIDES) {
    const a = pt(body.frames[i].pose, joint(side, 'ankle'))
    if (!a) continue
    // Un balón a la altura de la cintura no se está golpeando con el pie.
    if (ball.y < a.y - 0.7 * body.scale[i]) continue
    const d = Math.max(0, Math.hypot(a.x - ball.x, a.y - ball.y) - ball.r) / body.scale[i]
    if (best === null || d < best) best = d
  }
  return best
}

/**
 * Instantes en los que el balón sale golpeado desde un pie. `lenient` relaja los
 * umbrales: sirve para decidir dónde mirar fotograma a fotograma.
 */
export function ballDepartures(body: Body, lenient = false): { i: number; t: number; dirX: number }[] {
  const f = body.frames
  const seen: Seen[] = []
  f.forEach((fr, i) => {
    const ball = ballAt(body, i)
    if (ball) seen.push({ i, t: fr.t, ball })
  })
  const out: { i: number; t: number; dirX: number }[] = []
  const k = lenient ? 0.6 : 1

  for (let n = 1; n < seen.length; n++) {
    const a = seen[n - 1]
    const b = seen[n]
    if (b.t - a.t > BALL_GAP_S) continue
    const near = footDistance(body, a.i, a.ball)
    if (near === null || near > AT_FOOT) continue
    const scale = body.scale[a.i]

    // Posición del balón en la imagen, en troncos. No se mide respecto al cuerpo: un punto de la
    // pose mal puesto en un fotograma parecería un acelerón del balón.
    const rel = (s: Seen) => ({ x: s.ball.x / scale, y: s.ball.y / scale })
    const velocity = (p: Seen, q: Seen) => {
      const pp = rel(p)
      const pq = rel(q)
      const dt = q.t - p.t
      return pp && pq && dt > 0 && dt <= BALL_GAP_S ? { x: (pq.x - pp.x) / dt, y: (pq.y - pp.y) / dt } : null
    }
    const after = velocity(a, b)
    if (!after) continue
    const before = (n >= 2 ? velocity(seen[n - 2], a) : null) ?? { x: 0, y: 0 }
    // El golpe empieza aquí si el balón, que iba a su ritmo, cambia de golpe de velocidad…
    if (Math.hypot(after.x - before.x, after.y - before.y) < ONSET * k) continue
    // …y en este tramo o en el siguiente ya sale disparado.
    const next = n + 1 < seen.length ? velocity(b, seen[n + 1]) : null
    const peak = next && Math.hypot(next.x, next.y) > Math.hypot(after.x, after.y) ? next : after
    if (Math.hypot(peak.x - before.x, peak.y - before.y) < KICK_JUMP * k || Math.hypot(peak.x, peak.y) < LEAVE_SPEED * k) continue
    // Tiene que alejarse del jugador (o salir del recorte), no quedarse en sus pies: eso es conducir el balón.
    if (!lenient) {
      const start = rel(a)
      const later = seen.filter((s) => s.t > a.t && s.t <= a.t + 0.3)
      const far = later.some((s) => {
        const p = rel(s)
        return !!start && !!p && Math.hypot(p.x - start.x, p.y - start.y) >= LEAVE_DISTANCE
      })
      const gone = !seen.some((s) => s.t > a.t + 0.15 && s.t <= a.t + 0.4) && f[f.length - 1].t - a.t >= 0.3
      if (!far && !gone) continue
    }
    if (out.length && a.t - out[out.length - 1].t < MIN_BETWEEN_S) continue
    out.push({ i: a.i, t: (a.t + Math.min(b.t, a.t + 0.09)) / 2, dirX: peak.x })
  }

  // El balón estaba en el pie y deja de verse de golpe: salió del recorte.
  for (let n = 0; n < seen.length; n++) {
    const a = seen[n]
    const next = seen[n + 1]
    if (next && next.t - a.t <= 0.45) continue
    if (f[f.length - 1].t - a.t < 0.2) continue
    const near = footDistance(body, a.i, a.ball)
    if (near === null || near > AT_FOOT * 0.8) continue
    const recent = seen.filter((s) => s.t <= a.t && a.t - s.t <= 0.3).length
    if (recent < 3) continue
    if (out.some((o) => Math.abs(o.t - a.t) < MIN_BETWEEN_S)) continue
    out.push({ i: a.i, t: a.t + 0.03, dirX: 0 })
  }
  return out.sort((x, y) => x.t - y.t)
}

/** Dónde conviene mirar fotograma a fotograma por si hay un golpeo. */
export function kickCandidates(series: PoseSeries): number[] {
  const body = bodyOf(series.frames)
  return body ? ballDepartures(body, true).map((d) => d.t) : []
}

/** Detecta y mide los golpeos de una serie limpia. */
export function detectKicks(series: PoseSeries): KickRep[] {
  const body = bodyOf(series.frames)
  if (!body) return []
  const f = body.frames
  const kicks: KickRep[] = []

  for (const dep of ballDepartures(body)) {
    const tC = dep.t
    const swing = span(f, tC - 0.14, tC + 0.06)
    if (swing.length < 2) continue
    const info: Record<string, number> = {}

    // Pierna que golpea: la que más rápido se mueve respecto a la cadera alrededor del contacto.
    const relAnkle = (i: number, side: Side) => {
      const a = pt(f[i].pose, joint(side, 'ankle'))
      const hip = center(f[i].pose, 'hip')
      return a && hip ? { x: (a.x - hip.x) / body.scale[i], y: (a.y - hip.y) / body.scale[i] } : null
    }
    // Desplazamiento neto del pie en el tramo del golpe (los saltos de un fotograma suelto no cuentan).
    const sweepSpeed = (side: Side) => {
      const ps = swing.map((i) => ({ p: relAnkle(i, side), t: f[i].t })).filter((x): x is { p: { x: number; y: number }; t: number } => !!x.p)
      if (ps.length < 2) return null
      const a = ps[0]
      const b = ps[ps.length - 1]
      return Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y) / (b.t - a.t || 1)
    }
    const vl = sweepSpeed('left')
    const vr = sweepSpeed('right')
    if (vl === null || vr === null) continue
    const side: Side = vr >= vl ? 'right' : 'left'
    const plant = opposite(side)
    // Un golpeo de verdad: un pie barre rápido mientras el otro aguanta en el suelo.
    // Si se mueven los dos es una conducción o una carrera; si ninguno, el balón pasó de largo.
    const kickSpeed = Math.max(vl, vr)
    const plantSpeed = Math.min(vl, vr)
    if (kickSpeed < SWING_SPEED || plantSpeed > Math.min(PLANT_SPEED_MAX, 0.6 * kickSpeed)) continue
    info.swing = kickSpeed

    const m: Record<string, Measure> = {}
    const missing: Record<string, Missing> = {}

    // Vista. Dos pistas tienen que coincidir en que se le ve de lado: el pie cruza la imagen
    // al golpear, y los hombros y las caderas se ven estrechos. Una sola engaña: un pase corto
    // barre poco aunque se vea de lado, y quien viene hacia la cámara cruza la imagen por la perspectiva.
    const xs = span(f, tC - 0.3, tC + 0.2).map((i) => relAnkle(i, side)?.x).filter((x): x is number => x !== undefined)
    const sweep = xs.length >= 3 ? Math.min(1, (Math.max(...xs) - Math.min(...xs)) / SWING_SPAN) : null
    const facing = frontalness(body, span(f, tC - 0.35, tC + 0.1), 0.5)
    const narrow = facing === null ? null : Math.sqrt(Math.max(0, 1 - Math.min(1, facing / FULL_FRONT) ** 2))
    const strong = kickSpeed >= SWING_SPEED * 2
    // Con un golpeo fuerte el pie tiene que cruzar la imagen; en un pase corto basta con el cuerpo.
    const across = narrow === null ? sweep : sweep === null || !strong ? narrow : Math.min(sweep, narrow)
    const view: View = across === null ? 'oblique' : across >= SIDE_MIN ? 'side' : across >= 0.35 ? 'oblique' : 'front'
    if (across !== null) info.across = across
    // Sentido del golpeo en la imagen: hacia donde sale el balón o, si no se vio, hacia donde va el pie.
    const late = span(f, tC - 0.02, tC + 0.15).map((i) => relAnkle(i, side)?.x).filter((x): x is number => x !== undefined)
    const early = span(f, tC - 0.25, tC - 0.08).map((i) => relAnkle(i, side)?.x).filter((x): x is number => x !== undefined)
    const footDir = late.length && early.length ? Math.sign(median(late)! - median(early)!) : 0
    const dir = Math.abs(dep.dirX) >= 2 ? Math.sign(dep.dirX) : footDir
    const sideways = view === 'side' && dir !== 0

    // ── Pie de apoyo: dónde queda respecto al balón, en el sentido del golpeo ──
    const ball = ballAt(body, dep.i)
    const support = pt(f[dep.i].pose, joint(plant, 'ankle'))
    const striker = pt(f[dep.i].pose, joint(side, 'ankle'))
    // Quien golpea está de pie y con el balón a su alcance; si no, el balón era de otro.
    if (ball && support && Math.hypot(ball.x - support.x, ball.y - support.y) / body.scale[dep.i] > REACH_MAX) continue
    if (support && striker && Math.hypot(striker.x - support.x, striker.y - support.y) / body.scale[dep.i] > REACH_MAX * 1.3) continue
    const upright = center(f[dep.i].pose, 'shoulder')
    const hips = center(f[dep.i].pose, 'hip')
    if (upright && hips && upright.y > hips.y - 0.5 * body.scale[dep.i]) continue
    if (!sideways) missing.plant = 'view'
    else if (!ball || !support) missing.plant = 'hidden'
    else m.plant = { value: ((ball.x - support.x) * dir) / body.scale[dep.i], t: f[dep.i].t }

    // ── Rodilla de apoyo: algo doblada para aguantar el cuerpo ──
    if (view !== 'side') missing.knee = 'view'
    else {
      const angles: number[] = []
      for (const i of span(f, tC - 0.07, tC + 0.07)) {
        const hip = pt(f[i].pose, joint(plant, 'hip'))
        const knee = pt(f[i].pose, joint(plant, 'knee'))
        const ankle = pt(f[i].pose, joint(plant, 'ankle'))
        const angle = hip && knee && ankle ? angleAt(hip, knee, ankle) : null
        if (angle !== null) angles.push(angle)
      }
      if (!angles.length) missing.knee = 'hidden'
      else m.knee = { value: median(angles)!, t: f[dep.i].t, method: 'angle' }
    }

    // ── Tronco: echado hacia atrás (negativo) o sobre el balón (positivo) ──
    if (!sideways) missing.lean = 'view'
    else {
      const leans = span(f, tC - 0.1, tC + 0.03).map((i) => trunkLean(f[i].pose)).filter((x): x is number => x !== null)
      if (!leans.length) missing.lean = 'hidden'
      else m.lean = { value: median(leans)! * dir, t: f[dep.i].t, method: 'angle' }
    }

    // ── Final: hasta dónde sube la pierna después de golpear ──
    const after = span(f, tC, tC + 0.4)
    const lifts = after.map((i) => ({ v: thighLift(body, i, side), t: f[i].t })).filter((x): x is { v: number; t: number } => x.v !== null)
    const last = f[f.length - 1].t
    if (lifts.length < 2) missing.follow = last - tC < 0.25 ? 'cut' : 'hidden'
    else {
      const top = lifts.reduce((a, l) => (l.v > a.v ? l : a))
      // Un solo fotograma muy por encima del resto suele ser un punto mal puesto.
      const sorted = lifts.map((l) => l.v).sort((a, b) => b - a)
      const value = sorted.length >= 3 ? sorted[1] : sorted[0]
      m.follow = { value, t: top.t, method: 'vertical' }
    }

    info.ballSpeed = Math.abs(dep.dirX)
    kicks.push({ kind: 'kick', personId: series.personId, t: tC, start: Math.max(f[0].t, tC - 0.6), end: Math.min(last, tC + 0.5), side, view, m, missing, info })
  }
  return kicks
}
