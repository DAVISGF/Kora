// Tiro de baloncesto. Se reconoce porque las manos suben desde el pecho hasta
// por encima de la cabeza y el brazo termina estirado; después se mide lo que
// un entrenador miraría: piernas, base, codo, brazo y final del tiro.

import { ballAt, bodyOf, elbowSeen, frontalness, kneeSeen, legHeight, percentile, rate, reach, span, thighLift, viewOf, type Body } from '../body'
import { center, dist, joint, opposite, pt, SIDES, trunkLean, width } from '../geometry'
import { median3 } from '../series'
import type { Measure, Missing, PoseSeries, Rep, Side } from '../types'

/** Manos arriba: la muñeca más alta supera los hombros en esta fracción del tronco (≈ altura de la frente). */
const UP = 0.6
/** Manos abajo: a la altura del pecho o más abajo. */
const LOW = 0.3
/** El punto más alto del gesto debe pasar de aquí (≈ por encima de la cabeza). */
const PEAK_MIN = 0.8
const RISE_MAX_S = 1.8
/** Tiempo máximo entre que las manos pasan la frente y sale el balón (con margen para video a cámara lenta). */
const PUSH_MAX_S = 1.2
const GAP_S = 0.2
const MIN_BETWEEN_S = 1
/** Velocidad mínima de subida de la mano, en troncos por segundo, para hablar de un tiro. */
const MIN_RISE_SPEED = 0.5
/** Al salir el balón la rodilla sube mucho en una entrada a canasta; en un tiro las dos piernas cuelgan. */
const LAYUP_KNEE_DRIVE = 50
const LAYUP_ASYMMETRY = 30
/** Diferencia de altura entre los tobillos, en troncos, a partir de la cual el tiro es en movimiento. */
const UNEVEN_FEET = 0.45
/** Lo que se alarga la medida cadera–tobillo con el cuerpo estirado y los brazos arriba respecto a estar de pie. */
const STRETCH = 0.94
const HOLD_GOOD_S = 0.6
/** De la carga a soltar el balón, a velocidad normal. */
const NORMAL_PUSH_S = 0.35
/** Ángulo de codo por debajo del cual el brazo está doblado se mire desde donde se mire. */
const EXTENSION_SURE = 150

export interface ShotRep extends Rep {
  kind: 'shot'
  side: Side
}

interface Episode {
  from: number
  to: number
}

function episodes(frames: Body['frames'], top: (number | null)[]): Episode[] {
  const out: Episode[] = []
  let cur: Episode | null = null
  for (let i = 0; i < top.length; i++) {
    const v = top[i]
    if (v !== null && v >= UP) {
      if (cur && frames[i].t - frames[cur.to].t <= GAP_S) cur.to = i
      else {
        if (cur) out.push(cur)
        cur = { from: i, to: i }
      }
    }
  }
  if (cur) out.push(cur)
  return out
}


function robust(values: number[], kind: 'min' | 'max'): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => (kind === 'min' ? a - b : b - a))
  return s.length >= 3 ? s[1] : s[0]
}

/** Detecta y mide los tiros de una serie limpia. */
export function detectShots(series: PoseSeries, opts: { needBall?: boolean } = {}): { shots: ShotRep[]; layups: number[] } {
  const body = bodyOf(series.frames)
  if (!body) return { shots: [], layups: [] }
  const f = body.frames
  const bySide = { left: f.map((_, i) => reach(body, i, 'left')), right: f.map((_, i) => reach(body, i, 'right')) }
  const top = median3(f.map((_, i) => {
    const l = bySide.left[i]
    const r = bySide.right[i]
    return l === null ? r : r === null ? l : Math.max(l, r)
  }))

  const shots: ShotRep[] = []
  const layups: number[] = []
  let last = -Infinity

  for (const ep of episodes(f, top)) {
    const peak = Math.max(...top.slice(ep.from, ep.to + 1).map((v) => v ?? -Infinity))
    if (peak < PEAK_MIN) continue

    // Las manos tienen que venir de abajo: si ya estaban arriba no es un tiro (o es el final del anterior).
    let low = -1
    for (let i = ep.from; i >= 0 && f[ep.from].t - f[i].t <= RISE_MAX_S; i--) {
      if (top[i] !== null && top[i]! <= LOW) {
        low = i
        break
      }
    }
    if (low < 0) continue

    // El gesto de tirar se resuelve poco después de que las manos pasen la frente; lo que
    // venga más tarde (la mano que sigue arriba, que baja y vuelve a subir) ya no es el tiro.
    let stop = ep.from
    while (stop < ep.to && f[stop + 1].t - f[ep.from].t <= PUSH_MAX_S) stop++

    // Brazo de tiro: el que llega más alto al terminar de subir; la otra mano solo acompaña.
    const highest = (s: Side) => Math.max(...bySide[s].slice(ep.from, stop + 1).map((x) => x ?? -Infinity))
    const side: Side = highest('right') >= highest('left') ? 'right' : 'left'
    const r = median3(bySide[side])
    const v = rate(f, r)

    // Soltar el balón: el final de la última subida rápida de la mano.
    let vmax = 0
    for (let i = low; i <= stop; i++) vmax = Math.max(vmax, v[i] ?? 0)
    if (vmax < MIN_RISE_SPEED) continue
    let release = -1
    let runStart = -1
    for (let i = low; i <= stop + 1; i++) {
      const fast = i <= stop && (v[i] ?? 0) >= 0.4 * vmax
      if (fast && runStart < 0) runStart = i
      if (!fast && runStart >= 0) {
        const end = i - 1
        // La velocidad se calcula con los vecinos, así que la subida real empieza y acaba un fotograma más allá.
        const rise = (r[Math.min(f.length - 1, end + 1)] ?? r[end] ?? 0) - (r[Math.max(0, runStart - 1)] ?? r[runStart] ?? 0)
        if (rise >= 0.15 && (r[end] ?? 0) >= UP - 0.1) release = end
        runStart = -1
      }
    }
    if (release < 0) continue
    const tRel = f[release].t
    if ((r[release] ?? 0) < 0.55 || tRel - last < MIN_BETWEEN_S) continue

    // Tiro en movimiento (entrada, bandeja, mate): al saltar, una rodilla sube mucho más que la
    // otra, o un pie va mucho más alto que el otro. En un tiro las dos piernas van a la par.
    const around = span(f, tRel - 0.35, tRel + 0.1)
    const lifts = SIDES.map((s) => Math.max(...around.map((i) => thighLift(body, i, s) ?? 0)))
    const uneven = robust(
      around
        .map((i) => {
          const l = pt(f[i].pose, 'left_ankle')
          const rr = pt(f[i].pose, 'right_ankle')
          return l && rr ? Math.abs(l.y - rr.y) / body.scale[i] : null
        })
        .filter((x): x is number => x !== null),
      'max',
    )
    if ((Math.max(...lifts) >= LAYUP_KNEE_DRIVE && Math.abs(lifts[0] - lifts[1]) >= LAYUP_ASYMMETRY) || (uneven !== null && uneven >= UNEVEN_FEET)) {
      layups.push(tRel)
      last = tRel
      continue
    }

    // ¿Se vio el balón cerca de las manos antes de soltarlo?
    const searched = f.some((fr) => fr.ball !== undefined)
    const ball = span(f, tRel - 0.7, tRel + 0.05).some((i) => {
      const b = ballAt(body, i)
      if (!b) return false
      return SIDES.some((s) => {
        const w = pt(f[i].pose, joint(s, 'wrist'))
        return !!w && Math.hypot(w.x - b.x, w.y - b.y) <= 0.7 * body.scale[i] + b.r
      })
    })
    // Con más gente alrededor, unos brazos arriba sin balón son un tapón o un rebote, no un tiro.
    if (opts.needBall && searched && !ball) continue
    last = tRel

    const m: Record<string, Measure> = {}
    const missing: Record<string, Missing> = {}
    const info: Record<string, number> = {}

    // Vista: se mira antes de que suban los brazos.
    const before = span(f, tRel - 1.6, tRel)
    const frontal = frontalness(body, before)
    const view = viewOf(frontal)

    // ── Piernas: cuánto se doblan antes de subir ──
    const legs = f.map((_, i) => legHeight(body, i))
    const window = span(f, tRel - 1.4, tRel - 0.08).filter((i) => legs[i] !== null)
    if (window.length < 3) missing.legs = 'hidden'
    else {
      const load = window.reduce((a, i) => (legs[i]! < legs[a]! ? i : a))
      const tLoad = f[load].t
      const stand = percentile(span(f, tLoad - 2, tLoad - 0.2).map((i) => legs[i]).filter((x): x is number => x !== null), 0.9)
      const tall = percentile(span(f, tLoad + 0.05, tRel + 0.35).map((i) => legs[i]).filter((x): x is number => x !== null), 0.9)
      const ref = Math.max(stand ?? 0, (tall ?? 0) * STRETCH)
      const low3 = robust(span(f, tLoad - 0.13, tLoad + 0.13).map((i) => legs[i]).filter((x): x is number => x !== null), 'min')
      // De lado se ve el ángulo de la rodilla tal cual; desde cualquier otro sitio se deduce de lo que bajan las caderas.
      const direct =
        view === 'side'
          ? robust(
              span(f, tLoad - 0.13, tLoad + 0.13)
                .map((i) => {
                  const ks = SIDES.map((s) => kneeSeen(body, i, s)).filter((x): x is number => x !== null)
                  return ks.length ? ks.reduce((a, c) => a + c, 0) / ks.length : null
                })
                .filter((x): x is number => x !== null),
              'min',
            )
          : null
      if (direct !== null) m.legs = { value: direct, t: tLoad, method: 'angle' }
      else if (!ref || low3 === null) missing.legs = 'unclear'
      else m.legs = { value: (2 * Math.asin(Math.min(1, low3 / ref)) * 180) / Math.PI, t: tLoad, method: 'vertical' }
      if (m.legs) info.load = tLoad

      // ── Base: separación de los pies al cargar, solo si se ve de frente ──
      if (view !== 'front') missing.base = 'view'
      else {
        const feet: number[] = []
        for (const i of span(f, tLoad - 0.15, tLoad + 0.15)) {
          const w = width(f[i].pose, 'ankle')
          const l = pt(f[i].pose, 'left_ankle')
          const rr = pt(f[i].pose, 'right_ankle')
          if (w !== null && l && rr) feet.push(Math.abs(l.x - rr.x) / body.scale[i])
        }
        const shoulders = percentile(
          span(f, tRel - 2.5, tLoad).map((i) => {
            const w = width(f[i].pose, 'shoulder')
            return w === null ? null : w / body.scale[i]
          }).filter((x): x is number => x !== null),
          0.75,
        )
        if (feet.length < 2 || !shoulders) missing.base = 'hidden'
        else m.base = { value: percentile(feet, 0.5)! / shoulders, t: tLoad }
      }
    }

    // ── Final del tiro: cuánto tiempo se queda la mano arriba ──
    const floor = Math.max(UP, (r[release] ?? 0) - 0.25)
    let end = release
    let below = 0
    for (let i = release + 1; i < f.length; i++) {
      const val = r[i]
      if (val === null) continue
      if (val < floor) {
        if (++below >= 2) break
      } else {
        below = 0
        end = i
      }
    }
    // En un video a cámara lenta todo dura más: se toma como reloj lo que tarda en subir desde
    // la carga hasta soltar (unos 0,35 s a velocidad normal) y se descuenta la lentitud.
    // Solo vale si de verdad bajó: sin carga clara, el instante de la carga es arbitrario.
    const push = info.load !== undefined && m.legs && m.legs.value < 155 ? tRel - info.load : null
    const slow = push !== null ? Math.max(1, push / NORMAL_PUSH_S) : 1
    if (slow > 1.3) info.slow = slow
    const hold = (f[end].t - tRel) / slow
    const cut = end >= f.length - 2
    if (cut && hold < HOLD_GOOD_S) missing.follow = 'cut'
    else m.follow = { value: hold, t: Math.min(f[end].t, tRel + 0.3) }

    // ── Brazo: cuánto se estira al soltar ──
    const ext = span(f, tRel - 0.1, tRel + 0.3).map((i) => ({ i, a: elbowSeen(body, i, side) })).filter((x): x is { i: number; a: number } => x.a !== null)
    const after = span(f, tRel, tRel + 0.3)
    const lost = after.filter((i) => !pt(f[i].pose, joint(side, 'wrist'))).length
    if (after.length && lost * 2 > after.length) missing.extension = 'hidden'
    else if (ext.length < 2) missing.extension = pt(f[release].pose, joint(side, 'elbow')) ? 'view' : 'hidden'
    else {
      const value = robust(ext.map((x) => x.a), 'max')!
      const at = ext.reduce((a, x) => (Math.abs(x.a - value) < Math.abs(a.a - value) ? x : a))
      // El brazo se dobla hacia el aro. Si la cámara no está de lado, ese doblez se ve aplastado y
      // el codo parece más estirado de lo que está: un codo que aun así se ve doblado lo está de
      // verdad, pero uno que se ve estirado solo se da por bueno visto de lado.
      if (view === 'side' || value <= EXTENSION_SURE) m.extension = { value, t: f[at.i].t, method: 'angle' }
      else missing.extension = 'view'
    }

    // ── Codo: cuánto se abre hacia fuera justo antes de soltar, solo de frente ──
    if (view !== 'front') missing.flare = 'view'
    else {
      const out: number[] = []
      let tAt = tRel
      for (const i of span(f, tRel - 0.4, tRel - 0.05)) {
        const pose = f[i].pose
        const shoulder = pt(pose, joint(side, 'shoulder'))
        const elbow = pt(pose, joint(side, 'elbow'))
        const mid = center(pose, 'shoulder')
        const other = pt(pose, joint(opposite(side), 'shoulder'))
        if (!shoulder || !elbow || !mid || !other || dist(shoulder, other) < 1) continue
        const outward = Math.sign(shoulder.x - other.x)
        out.push(((elbow.x - shoulder.x) * outward) / (body.k.upperArm * body.scale[i]))
        tAt = f[i].t
      }
      const flare = percentile(out, 0.5)
      if (out.length < 2 || flare === null) missing.flare = 'hidden'
      // El codo muy metido hacia el otro hombro no existe en un tiro visto de frente: la vista no era la que parecía.
      else if (flare < -0.35) missing.flare = 'view'
      else m.flare = { value: flare, t: tAt }
    }

    // ── Tronco: inclinación al soltar ──
    const leans = span(f, tRel - 0.08, tRel + 0.08).map((i) => trunkLean(f[i].pose)).filter((x): x is number => x !== null)
    if (leans.length) m.trunk = { value: Math.abs(percentile(leans, 0.5)!), t: tRel }
    else missing.trunk = 'hidden'

    info.ball = ball ? 1 : 0
    info.peak = peak

    shots.push({
      kind: 'shot',
      personId: series.personId,
      t: tRel,
      start: info.load ?? f[low].t,
      end: f[end].t,
      side,
      view,
      m,
      missing,
      info,
    })
  }
  return { shots, layups }
}
