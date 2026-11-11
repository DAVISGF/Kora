// Golpeo de fútbol. Se reconoce por el balón: está junto a un pie y, de un
// fotograma al siguiente, sale disparado. Alrededor de ese instante se mide lo
// que un entrenador miraría: pie de apoyo, rodilla de apoyo, tronco y final.

import { ballAt, bodyOf, frontalness, percentile, span, thighLift, type Body } from '../body'
import { angleAt, center, joint, pt, SIDES, trunkLean } from '../geometry'
import type { BallObs, Measure, Missing, PoseSeries, Rep, Side, View } from '../types'

/** Distancia máxima del balón a un tobillo, en troncos, para decir que está en el pie. */
const AT_FOOT = 1.15
/** Cambio de velocidad del balón, en troncos por segundo, con el que empieza a contar un golpe. */
const ONSET = 2.5
/** Lo que puede bailar la detección del balón de un fotograma a otro sin haberse movido, en troncos. */
const JITTER = 0.15
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
/** Velocidad mínima del pie que golpea, en troncos por segundo. */
const SWING_SPEED = 5
/** Recorrido mínimo del pie que golpea alrededor del contacto, en troncos. */
const SWING_RANGE = 0.9
/** Radio, en troncos, dentro del cual el pie de apoyo se da por quieto (con algo de margen si la cámara se mueve). */
const PLANT_RADIUS = 0.4
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
    // El golpe empieza aquí si el balón, que iba a su ritmo, cambia de golpe de velocidad
    // (y se mueve más de lo que tiembla su detección de un fotograma a otro)…
    const moved = Math.hypot(after.x, after.y) * (b.t - a.t)
    if (Math.hypot(after.x - before.x, after.y - before.y) < ONSET * k || moved < JITTER) continue
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

interface Foot {
  i: number
  side: Side
  x: number
  y: number
}

/** Detecta y mide los golpeos de una serie limpia. */
export function detectKicks(series: PoseSeries): KickRep[] {
  const body = bodyOf(series.frames)
  if (!body) return []
  const f = body.frames
  const kicks: KickRep[] = []

  for (const dep of ballDepartures(body)) {
    const tC = dep.t
    const scale = body.scale[dep.i]
    const info: Record<string, number> = {}

    // Los dos tobillos de cada fotograma, en la imagen y medidos en troncos. No se confía en cuál
    // es el izquierdo y cuál el derecho: cuando las piernas se cruzan, el modelo los intercambia.
    const feetIn = (indices: number[]): Foot[] =>
      indices.flatMap((i) =>
        SIDES.flatMap((side) => {
          const a = pt(f[i].pose, joint(side, 'ankle'))
          return a ? [{ i, side, x: a.x / scale, y: a.y / scale }] : []
        }),
      )
    const win = span(f, tC - 0.17, tC + 0.1)
    const feet = feetIn(win)
    if (feet.length < 4) continue

    // El pie de apoyo es el que no se mueve: el sitio de la imagen con más tobillos cerca.
    let anchor = feet[0]
    let most = 0
    for (const p of feet) {
      const n = feet.filter((q) => Math.hypot(q.x - p.x, q.y - p.y) <= PLANT_RADIUS).length
      if (n > most) {
        most = n
        anchor = p
      }
    }
    const off = (p: Foot) => Math.hypot(p.x - anchor.x, p.y - anchor.y)
    /** De los dos tobillos de un fotograma, el que está en el apoyo y el otro. */
    const split = (i: number, all: Foot[]): { planted: Foot; swinging: Foot } | null => {
      const here = all.filter((p) => p.i === i)
      if (here.length < 2) return null
      const [p, q] = off(here[0]) <= off(here[1]) ? here : [here[1], here[0]]
      return off(p) <= PLANT_RADIUS ? { planted: p, swinging: q } : null
    }
    const pairs = win.map((i) => split(i, feet)).filter((x): x is { planted: Foot; swinging: Foot } => !!x)
    const complete = win.filter((i) => feet.filter((p) => p.i === i).length === 2).length
    // Un golpeo de verdad: un pie barre rápido mientras el otro aguanta en el suelo. Si se mueven
    // los dos es una conducción o una carrera; si no se mueve ninguno, el balón pasó de largo.
    if (pairs.length < 2 || pairs.length < complete * 0.6) continue
    const sx = pairs.map((p) => p.swinging.x)
    const sy = pairs.map((p) => p.swinging.y)
    const range = Math.hypot(Math.max(...sx) - Math.min(...sx), Math.max(...sy) - Math.min(...sy))
    const kickSpeed = range / (f[win[win.length - 1]].t - f[win[0]].t || 1)
    if (range < SWING_RANGE || kickSpeed < SWING_SPEED) continue
    const rights = pairs.filter((p) => p.swinging.side === 'right').length
    const side: Side = rights * 2 >= pairs.length ? 'right' : 'left'
    info.swing = kickSpeed

    const m: Record<string, Measure> = {}
    const missing: Record<string, Missing> = {}

    // Vista. Dos pistas tienen que coincidir en que se le ve de lado: el pie cruza la imagen
    // al golpear, y los hombros y las caderas se ven estrechos. Una sola engaña: un pase corto
    // barre poco aunque se vea de lado, y quien viene hacia la cámara cruza la imagen por la perspectiva.
    const wide = span(f, tC - 0.3, tC + 0.2)
    const wideFeet = feetIn(wide)
    const path = wide.map((i) => split(i, wideFeet)).filter((x): x is { planted: Foot; swinging: Foot } => !!x)
    const xs = path.map((p) => p.swinging.x)
    const sweep = xs.length >= 3 ? Math.min(1, (Math.max(...xs) - Math.min(...xs)) / SWING_SPAN) : null
    const facing = frontalness(body, span(f, tC - 0.35, tC + 0.1), 0.5)
    const narrow = facing === null ? null : Math.sqrt(Math.max(0, 1 - Math.min(1, facing / FULL_FRONT) ** 2))
    const strong = kickSpeed >= SWING_SPEED * 2
    // Con un golpeo fuerte el pie tiene que cruzar la imagen; en un pase corto basta con el cuerpo.
    const across = narrow === null ? sweep : sweep === null || !strong ? narrow : Math.min(sweep, narrow)
    const view: View = across === null ? 'oblique' : across >= SIDE_MIN ? 'side' : across >= 0.35 ? 'oblique' : 'front'
    if (across !== null) info.across = across
    // Sentido del golpeo en la imagen: hacia donde sale el balón o, si no se vio, hacia donde va el pie.
    const early = path.filter((p) => f[p.swinging.i].t <= tC - 0.06).map((p) => p.swinging.x)
    const late = path.filter((p) => f[p.swinging.i].t >= tC).map((p) => p.swinging.x)
    const footDir = late.length && early.length ? Math.sign(median(late)! - median(early)!) : 0
    const dir = Math.abs(dep.dirX) >= 2 ? Math.sign(dep.dirX) : footDir
    const sideways = view === 'side' && dir !== 0

    // Quien golpea está de pie y con el balón a su alcance; si no, el balón era de otro.
    const ball = ballAt(body, dep.i)
    const now = split(dep.i, feetIn([dep.i]))
    if (ball && Math.hypot(ball.x / scale - anchor.x, ball.y / scale - anchor.y) > REACH_MAX) continue
    const shoulders = center(f[dep.i].pose, 'shoulder')
    const hips = center(f[dep.i].pose, 'hip')
    if (shoulders && hips && shoulders.y > hips.y - 0.5 * scale) continue

    // ── Pie de apoyo: dónde queda respecto al balón, en el sentido del golpeo ──
    if (!sideways) missing.plant = 'view'
    else if (!ball) missing.plant = 'hidden'
    else m.plant = { value: (ball.x / scale - (now?.planted.x ?? anchor.x)) * dir, t: f[dep.i].t }

    // ── Rodilla de apoyo: algo doblada para aguantar el cuerpo ──
    if (view !== 'side') missing.knee = 'view'
    else {
      const near = span(f, tC - 0.07, tC + 0.07)
      const nearFeet = feetIn(near)
      const angles: number[] = []
      for (const i of near) {
        const leg = split(i, nearFeet)?.planted.side
        if (!leg) continue
        const hip = pt(f[i].pose, joint(leg, 'hip'))
        const knee = pt(f[i].pose, joint(leg, 'knee'))
        const ankle = pt(f[i].pose, joint(leg, 'ankle'))
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

    // ── Final: hasta dónde sube la pierna después de golpear (la de apoyo apenas se levanta) ──
    const lifts = span(f, tC, tC + 0.4)
      .map((i) => ({ v: Math.max(...SIDES.map((sd) => thighLift(body, i, sd) ?? -1)), t: f[i].t }))
      .filter((x) => x.v >= 0)
    const last = f[f.length - 1].t
    if (lifts.length < 2) missing.follow = last - tC < 0.25 ? 'cut' : 'hidden'
    else {
      // Un solo fotograma muy por encima del resto suele ser un punto mal puesto.
      const sorted = [...lifts].sort((x, y) => y.v - x.v)
      const pick = sorted.length >= 3 ? sorted[1] : sorted[0]
      m.follow = { value: pick.v, t: pick.t, method: 'vertical' }
    }

    info.ballSpeed = Math.abs(dep.dirX)
    kicks.push({ kind: 'kick', personId: series.personId, t: tC, start: Math.max(f[0].t, tC - 0.6), end: Math.min(last, tC + 0.5), side, view, m, missing, info })
  }
  return kicks
}
