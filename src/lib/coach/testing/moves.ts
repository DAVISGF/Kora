// Gestos sintéticos para las pruebas del motor: un tiro, un golpeo y una carrera
// hechos con la figura articulada, con los defectos que se quieran.
// No se usa en la aplicación.

import type { BallObs, PoseSeries } from '../types'
import { series, TORSO, track, type FigureSpec } from './synth'

const HEIGHT = 420
const GROUND = 660

const base: FigureSpec = {
  height: HEIGHT,
  x: 640,
  groundY: GROUND,
  lean: 0,
  legs: { left: { lift: 0, bend: 0 }, right: { lift: 0, bend: 0 } },
  arms: { left: { lift: 0, bend: 0 }, right: { lift: 0, bend: 0 } },
}

/** Largo del tronco de la figura de pruebas, en píxeles. */
export const T = TORSO * HEIGHT

export interface ShotSpec {
  /** Ángulo de rodilla al cargar (180 = sin doblar) */
  knee?: number
  /** Segundos con la mano arriba después de soltar */
  hold?: number
  /** Ángulo del codo al soltar (180 = estirado) */
  elbow?: number
  /** Inclinación del tronco al soltar, en grados */
  lean?: number
  /** Separación de los pies (1 = bajo las caderas) */
  spread?: number
  /** Tiro en movimiento: una rodilla sube al saltar */
  layup?: boolean
}

/** Duración de un tiro sintético con ese final. */
export const shotLength = (spec: ShotSpec = {}) => 1.3 + (spec.hold ?? 0.8) + 0.9

/** La figura durante un tiro que empieza en t = 0: de pie, baja, sube y suelta en t ≈ 1,3 s. */
export function shotAt(spec: ShotSpec, t: number): FigureSpec {
  const flex = 180 - (spec.knee ?? 120)
  const bent = 180 - (spec.elbow ?? 172)
  const hold = spec.hold ?? 0.8
  const down = 1.32 + hold
  const legs = track([
    [0, 0],
    [0.55, 0],
    [0.95, flex],
    [1.25, 0],
  ])(t)
  const lift = track([
    [0, 35],
    [0.7, 35],
    [1.05, 100],
    [1.3, 158],
    [down, 158],
    [down + 0.3, 20],
  ])(t)
  const bend = track([
    [0, 115],
    [0.7, 115],
    [1.05, 95],
    [1.3, bent],
    [down, bent],
    [down + 0.3, 20],
  ])(t)
  const air = track([
    [0, 0],
    [1.2, 0],
    [1.4, 0.05],
    [1.6, 0],
  ])(t)
  const lean = track([
    [0, 0],
    [1.0, 0],
    [1.3, spec.lean ?? 0],
    [down, spec.lean ?? 0],
    [down + 0.3, 0],
  ])(t)
  const drive = spec.layup ? track([[0, 0], [0.9, 0], [1.2, 75], [1.5, 0]])(t) : 0
  return {
    ...base,
    lean,
    air,
    spread: spec.spread,
    legs: { left: { lift: legs / 2 + drive, bend: legs + drive }, right: { lift: legs / 2, bend: legs } },
    // La mano de tiro (derecha) termina más alta; la otra solo acompaña.
    arms: { left: { lift: Math.max(20, lift - 18), bend: Math.max(bend, 25) }, right: { lift, bend } },
  }
}

/** Serie con varios tiros seguidos. */
export function shots(specs: ShotSpec[], opts: { yaw?: number; fps?: number; noise?: number; seed?: number } = {}): PoseSeries {
  const starts: number[] = []
  let total = 0
  for (const s of specs) {
    starts.push(total)
    total += shotLength(s)
  }
  return series({
    fps: opts.fps ?? 20,
    duration: total,
    noise: opts.noise ?? 0.004,
    seed: opts.seed,
    at: (t) => {
      let n = specs.length - 1
      while (n > 0 && t < starts[n]) n--
      return { ...shotAt(specs[n], t - starts[n]), yaw: opts.yaw ?? 0 }
    },
  })
}

/** Instante en que se suelta el balón en el tiro número `n` de `shots`. */
export function releaseOf(specs: ShotSpec[], n: number): number {
  let total = 0
  for (let i = 0; i < n; i++) total += shotLength(specs[i])
  return total + 1.3
}

export interface RunSpec {
  /** Ángulo del codo durante el braceo (90 = en «L») */
  elbow?: number
  /** Elevación máxima del muslo, en grados */
  knee?: number
  /** Inclinación del tronco: positiva hacia delante */
  lean?: number
  /** Pasos por segundo */
  cadence?: number
  yaw?: number
  fps?: number
  duration?: number
  noise?: number
}

/** Serie de una carrera vista con la cámara siguiendo al corredor. */
export function run(spec: RunSpec = {}): PoseSeries {
  const stride = (spec.cadence ?? 3.6) / 2
  const top = spec.knee ?? 62
  const elbow = 180 - (spec.elbow ?? 90)
  const leg = (phase: number) => {
    const s = Math.sin(phase)
    // El muslo va de atrás (−15°) adelante (elevación máxima); la rodilla se dobla al recoger la pierna.
    const lift = (top - 15) / 2 + ((top + 15) / 2) * s
    const fold = Math.max(0, Math.sin(phase + 1.1))
    return { lift, bend: 15 + 95 * fold }
  }
  return series({
    fps: spec.fps ?? 20,
    duration: spec.duration ?? 3,
    noise: spec.noise ?? 0.004,
    at: (t) => {
      const phase = 2 * Math.PI * stride * t
      const swing = 32 * Math.sin(phase)
      return {
        ...base,
        yaw: spec.yaw ?? 0,
        lean: spec.lean ?? 8,
        air: 0.02 * Math.abs(Math.sin(phase)),
        legs: { left: leg(phase), right: leg(phase + Math.PI) },
        arms: { left: { lift: -swing, bend: elbow }, right: { lift: swing, bend: elbow } },
      }
    },
  })
}

export interface KickSpec {
  /** Inclinación del tronco al golpear: negativa = hacia atrás */
  lean?: number
  /** Ángulo de la rodilla de apoyo (180 = tiesa) */
  knee?: number
  /** Hasta dónde sube el muslo después de golpear */
  follow?: number
  /** Cuánto queda el balón por delante del tobillo de apoyo, en troncos */
  plant?: number
  yaw?: number
  fps?: number
  /** Sin balón a la vista */
  noBall?: boolean
}

/** Instante del golpe en un golpeo sintético. */
export const KICK_T = 0.8

/** Serie de un golpeo con la pierna derecha, con el balón parado y saliendo en el contacto. */
export function kick(spec: KickSpec = {}): PoseSeries {
  const flex = 180 - (spec.knee ?? 150)
  const after = spec.follow ?? 60
  const lift = track([
    [0, 0],
    [0.5, -10],
    [0.7, -45],
    [KICK_T, 12],
    [0.95, after],
    [1.3, 10],
  ])
  const bend = track([
    [0, 5],
    [0.5, 30],
    [0.7, 95],
    [KICK_T, 12],
    [0.95, 20],
    [1.3, 10],
  ])
  const lean = track([
    [0, 0],
    [0.5, (spec.lean ?? -8) / 2],
    [KICK_T, spec.lean ?? -8],
    [1.0, 5],
  ])
  const s = series({
    fps: spec.fps ?? 24,
    duration: 1.5,
    noise: 0.003,
    at: (t) => ({
      ...base,
      yaw: spec.yaw ?? 0,
      lean: lean(t),
      // La pierna de apoyo queda clavada, algo doblada.
      legs: { left: { lift: flex / 2, bend: flex }, right: { lift: lift(t), bend: bend(t) } },
      arms: { left: { lift: 35, bend: 30 }, right: { lift: -20, bend: 30 } },
    }),
  })
  if (spec.noBall) return s
  const radius = 0.25 * T
  for (const f of s.frames) {
    const support = f.pose.left_ankle!
    const rest = { x: support.x + (spec.plant ?? 0.3) * T * Math.cos(((spec.yaw ?? 0) * Math.PI) / 180), y: GROUND - radius }
    const dt = f.t - KICK_T
    // Antes del golpe el balón está quieto; después sale a 14 troncos por segundo, algo hacia arriba.
    const ball: BallObs = dt <= 0 ? { ...rest, r: radius, c: 0.9 } : { x: rest.x + 14 * T * dt * Math.cos(((spec.yaw ?? 0) * Math.PI) / 180), y: rest.y - 3 * T * dt, r: radius, c: 0.85 }
    // El recorte solo alcanza a ver el balón cerca de la persona.
    f.ball = Math.abs(ball.x - support.x) < 5 * T ? ball : null
  }
  return s
}
