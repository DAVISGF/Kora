// Modelo del cuerpo de una persona a lo largo de una serie: su escala en cada
// instante y el largo real de sus segmentos. Con eso se puede saber cuándo un
// ángulo medido en la imagen es de fiar y cuándo el segmento apunta hacia la
// cámara y engaña.

import { angleAt, center, dist, joint, pt, SIDES, torsoLength, width } from './geometry'
import type { BallObs, Joint, PoseFrame, Pt, Side, View } from './types'

export interface Body {
  frames: PoseFrame[]
  /** Largo del tronco en cada fotograma (mediana móvil): la escala local de la persona, en píxeles */
  scale: number[]
  /** Largo real de cada segmento, como fracción del tronco */
  k: { thigh: number; shank: number; upperArm: number; forearm: number }
}

/** Ventana de la mediana móvil del tronco. */
const SCALE_WINDOW_S = 0.4
/** Un segmento visto a menos de esta fracción de su largo real apunta demasiado hacia la cámara. */
export const MIN_SEEN = 0.8

// Proporciones respecto al tronco medidas con el modelo de pose en personas reales.
// Sirven de suelo y techo: el largo real se toma de la propia serie.
const RATIO = {
  thigh: [0.74, 0.86, 1.08],
  shank: [0.76, 0.88, 1.1],
  upperArm: [0.46, 0.56, 0.78],
  forearm: [0.44, 0.54, 0.74],
} as const

/** Ancho de hombros y de caderas, respecto al tronco, de una persona vista de frente con los brazos abajo. */
const FRONT_SHOULDERS = 0.58
const FRONT_HIPS = 0.38
export const VIEW_SIDE_MAX = 0.42
export const VIEW_FRONT_MIN = 0.85

export function percentile(values: number[], q: number): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]
}

export function bodyOf(frames: PoseFrame[]): Body | null {
  const torso = frames.map((f) => torsoLength(f.pose))
  const all = torso.filter((v): v is number => v !== null)
  const global = percentile(all, 0.5)
  if (!global || all.length < 3) return null
  const scale = frames.map((f, i) => {
    const near: number[] = []
    for (let j = i; j >= 0 && f.t - frames[j].t <= SCALE_WINDOW_S; j--) if (torso[j] !== null) near.push(torso[j]!)
    for (let j = i + 1; j < frames.length && frames[j].t - f.t <= SCALE_WINDOW_S; j++) if (torso[j] !== null) near.push(torso[j]!)
    return near.length >= 3 ? percentile(near, 0.5)! : global
  })

  const ratio = (a: 'hip' | 'knee' | 'shoulder' | 'elbow', b: 'knee' | 'ankle' | 'elbow' | 'wrist', [lo, typical, hi]: readonly [number, number, number]) => {
    const seen: number[] = []
    frames.forEach((f, i) => {
      for (const side of SIDES) {
        const p = pt(f.pose, joint(side, a))
        const q = pt(f.pose, joint(side, b))
        if (p && q) seen.push(dist(p, q) / scale[i])
      }
    })
    // El escorzo solo acorta: el largo real está en la parte alta de lo observado.
    const top = seen.length >= 8 ? percentile(seen, 0.9)! : typical
    return Math.max(lo, Math.min(hi, top))
  }

  return {
    frames,
    scale,
    k: {
      thigh: ratio('hip', 'knee', RATIO.thigh),
      shank: ratio('knee', 'ankle', RATIO.shank),
      upperArm: ratio('shoulder', 'elbow', RATIO.upperArm),
      forearm: ratio('elbow', 'wrist', RATIO.forearm),
    },
  }
}

/** Índices de los fotogramas con t dentro de [t0, t1]. */
export function span(frames: PoseFrame[], t0: number, t1: number): number[] {
  const out: number[] = []
  for (let i = 0; i < frames.length; i++) if (frames[i].t >= t0 - 1e-6 && frames[i].t <= t1 + 1e-6) out.push(i)
  return out
}

export function nearest(frames: PoseFrame[], t: number): number {
  let best = 0
  for (let i = 1; i < frames.length; i++) if (Math.abs(frames[i].t - t) < Math.abs(frames[best].t - t)) best = i
  return best
}

const P = (b: Body, i: number, name: Joint): Pt | null => pt(b.frames[i].pose, name)

/** Altura de la muñeca sobre la línea de hombros, en largos de tronco. Negativa por debajo de los hombros. */
export function reach(b: Body, i: number, side: Side): number | null {
  const shoulders = center(b.frames[i].pose, 'shoulder')
  const wrist = P(b, i, joint(side, 'wrist'))
  return shoulders && wrist ? (shoulders.y - wrist.y) / b.scale[i] : null
}

/** Altura de las caderas sobre los tobillos, en píxeles (media de las piernas que se ven). */
export function legHeight(b: Body, i: number): number | null {
  const hs: number[] = []
  for (const side of SIDES) {
    const hip = P(b, i, joint(side, 'hip'))
    const ankle = P(b, i, joint(side, 'ankle'))
    if (hip && ankle) hs.push(ankle.y - hip.y)
  }
  return hs.length ? hs.reduce((a, c) => a + c, 0) / hs.length : null
}

/** ¿Se ve el segmento a casi todo su largo, es decir, más o menos paralelo a la cámara? */
function seen(b: Body, i: number, a: Joint, c: Joint, k: number, min = MIN_SEEN): boolean {
  const p = P(b, i, a)
  const q = P(b, i, c)
  return !!p && !!q && dist(p, q) / (k * b.scale[i]) >= min
}

/** Ángulo de la rodilla, solo si muslo y pierna se ven sin escorzo. */
export function kneeSeen(b: Body, i: number, side: Side): number | null {
  const hip = joint(side, 'hip')
  const knee = joint(side, 'knee')
  const ankle = joint(side, 'ankle')
  if (!seen(b, i, hip, knee, b.k.thigh) || !seen(b, i, knee, ankle, b.k.shank)) return null
  return angleAt(P(b, i, hip)!, P(b, i, knee)!, P(b, i, ankle)!)
}

/** Ángulo del codo, solo si brazo y antebrazo se ven sin escorzo. */
export function elbowSeen(b: Body, i: number, side: Side): number | null {
  const shoulder = joint(side, 'shoulder')
  const elbow = joint(side, 'elbow')
  const wrist = joint(side, 'wrist')
  if (!seen(b, i, shoulder, elbow, b.k.upperArm) || !seen(b, i, elbow, wrist, b.k.forearm)) return null
  return angleAt(P(b, i, shoulder)!, P(b, i, elbow)!, P(b, i, wrist)!)
}

/**
 * Elevación del muslo: 0° colgando hacia el suelo, 90° horizontal. Sale de la
 * altura de la rodilla respecto a la cadera, así que vale desde cualquier ángulo de cámara.
 */
export function thighLift(b: Body, i: number, side: Side): number | null {
  const hip = P(b, i, joint(side, 'hip'))
  const knee = P(b, i, joint(side, 'knee'))
  if (!hip || !knee) return null
  const c = Math.max(-1, Math.min(1, (knee.y - hip.y) / (b.k.thigh * b.scale[i])))
  return (Math.acos(c) * 180) / Math.PI
}

/**
 * Cuánto se ve el cuerpo de frente en un tramo: ~1 de frente o de espaldas,
 * ~0 de perfil. Con los brazos en alto los hombros se juntan, así que se
 * prefieren los fotogramas con las manos por debajo de los hombros.
 */
export function frontalness(b: Body, indices: number[], q = 0.75): number | null {
  const low: number[] = []
  const any: number[] = []
  for (const i of indices) {
    const pose = b.frames[i].pose
    const sw = width(pose, 'shoulder')
    const hw = width(pose, 'hip')
    const cues: number[] = []
    if (sw !== null) cues.push(sw / b.scale[i] / FRONT_SHOULDERS)
    if (hw !== null) cues.push(hw / b.scale[i] / FRONT_HIPS)
    if (!cues.length) continue
    const v = Math.max(...cues)
    any.push(v)
    const up = SIDES.some((s) => (reach(b, i, s) ?? -1) > 0.1)
    if (!up) low.push(v)
  }
  const pool = low.length >= 3 ? low : any
  return percentile(pool, q)
}

export function viewOf(frontal: number | null): View {
  if (frontal === null) return 'oblique'
  return frontal < VIEW_SIDE_MAX ? 'side' : frontal > VIEW_FRONT_MIN ? 'front' : 'oblique'
}

/** Velocidad de una señal por diferencias centradas, en unidades por segundo. */
export function rate(frames: PoseFrame[], values: (number | null)[]): (number | null)[] {
  return values.map((v, i) => {
    const a = values[i - 1] ?? null
    const c = values[i + 1] ?? null
    if (a !== null && c !== null) return (c - a) / (frames[i + 1].t - frames[i - 1].t || 1)
    if (v !== null && c !== null) return (c - v) / (frames[i + 1].t - frames[i].t || 1)
    if (a !== null && v !== null) return (v - a) / (frames[i].t - frames[i - 1].t || 1)
    return null
  })
}

/** Radio del balón respecto al tronco: un balón de fútbol o de baloncesto ronda 0,25. */
const BALL_RADIUS = [0.1, 0.7] as const
const BALL_MIN_CONF = 0.25

/** El balón del fotograma, si lo que se detectó tiene el tamaño de un balón de verdad. */
export function ballAt(b: Body, i: number): BallObs | null {
  const ball = b.frames[i].ball
  if (!ball || ball.c < BALL_MIN_CONF) return null
  const r = ball.r / b.scale[i]
  return r >= BALL_RADIUS[0] && r <= BALL_RADIUS[1] ? ball : null
}
