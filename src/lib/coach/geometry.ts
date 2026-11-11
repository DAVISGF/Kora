// Geometría sobre una pose 2D. Los ángulos se miden en el plano de la imagen,
// así que solo son fiables cuando el segmento se mueve más o menos paralelo a
// la cámara; quien use estas funciones debe comprobar antes la vista.

import type { Joint, Pose, Pt, Side } from './types'

/** Confianza mínima para dar un punto por visto. */
export const MIN_CONF = 0.35

export type Part = 'eye' | 'ear' | 'shoulder' | 'elbow' | 'wrist' | 'hip' | 'knee' | 'ankle'

export const joint = (side: Side, part: Part): Joint => `${side}_${part}` as Joint
export const opposite = (side: Side): Side => (side === 'left' ? 'right' : 'left')
export const SIDES: Side[] = ['left', 'right']

const deg = (rad: number) => (rad * 180) / Math.PI
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

/** El punto, si se ve con confianza suficiente. */
export function pt(pose: Pose, name: Joint, min = MIN_CONF): Pt | null {
  const p = pose[name]
  return p && p.c >= min ? p : null
}

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
export const midpoint = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, c: Math.min(a.c, b.c) })

/** Centro entre el lado izquierdo y el derecho; si solo se ve uno (vista de perfil), ese. */
export function center(pose: Pose, part: Part, min = MIN_CONF): Pt | null {
  const l = pt(pose, joint('left', part), min)
  const r = pt(pose, joint('right', part), min)
  return l && r ? midpoint(l, r) : (l ?? r)
}

/** Ángulo interior en el vértice `v`, en grados (0–180). */
export function angleAt(a: Pt, v: Pt, c: Pt): number | null {
  const ax = a.x - v.x
  const ay = a.y - v.y
  const cx = c.x - v.x
  const cy = c.y - v.y
  const d = Math.hypot(ax, ay) * Math.hypot(cx, cy)
  if (d < 1e-9) return null
  return deg(Math.acos(clamp((ax * cx + ay * cy) / d, -1, 1)))
}

export function jointAngle(pose: Pose, a: Joint, v: Joint, c: Joint): number | null {
  const pa = pt(pose, a)
  const pv = pt(pose, v)
  const pc = pt(pose, c)
  return pa && pv && pc ? angleAt(pa, pv, pc) : null
}

/** Codo: 180° con el brazo estirado, 90° en forma de L. */
export const elbowAngle = (pose: Pose, side: Side) => jointAngle(pose, joint(side, 'shoulder'), joint(side, 'elbow'), joint(side, 'wrist'))
/** Rodilla: 180° con la pierna recta; baja al doblarla. */
export const kneeAngle = (pose: Pose, side: Side) => jointAngle(pose, joint(side, 'hip'), joint(side, 'knee'), joint(side, 'ankle'))
/** Cadera: 180° con tronco y muslo alineados. */
export const hipAngle = (pose: Pose, side: Side) => jointAngle(pose, joint(side, 'shoulder'), joint(side, 'hip'), joint(side, 'knee'))

/** Elevación del brazo respecto al tronco: 0° colgando junto al cuerpo, 90° horizontal, 180° recto hacia arriba. */
export function armElevation(pose: Pose, side: Side): number | null {
  const shoulder = pt(pose, joint(side, 'shoulder'))
  const elbow = pt(pose, joint(side, 'elbow'))
  const hip = pt(pose, joint(side, 'hip')) ?? center(pose, 'hip')
  return shoulder && elbow && hip ? angleAt(elbow, shoulder, hip) : null
}

/**
 * Inclinación del tronco respecto a la vertical, en grados. 0 = erguido.
 * El signo sigue al eje x: positivo si los hombros quedan hacia la derecha de la imagen.
 */
export function trunkLean(pose: Pose): number | null {
  const shoulders = center(pose, 'shoulder')
  const hips = center(pose, 'hip')
  if (!shoulders || !hips || dist(shoulders, hips) < 1e-9) return null
  return deg(Math.atan2(shoulders.x - hips.x, hips.y - shoulders.y))
}

/**
 * Ángulo del muslo respecto a la vertical, con signo según x: 0° apunta al suelo,
 * ±90° horizontal. Positivo si la rodilla queda hacia la derecha de la imagen.
 */
export function thighAngle(pose: Pose, side: Side): number | null {
  const hip = pt(pose, joint(side, 'hip'))
  const knee = pt(pose, joint(side, 'knee'))
  if (!hip || !knee || dist(hip, knee) < 1e-9) return null
  return deg(Math.atan2(knee.x - hip.x, knee.y - hip.y))
}

export function torsoLength(pose: Pose): number | null {
  const shoulders = center(pose, 'shoulder')
  const hips = center(pose, 'hip')
  return shoulders && hips ? dist(shoulders, hips) : null
}

export function width(pose: Pose, part: 'shoulder' | 'hip' | 'ankle' | 'knee'): number | null {
  const l = pt(pose, joint('left', part))
  const r = pt(pose, joint('right', part))
  return l && r ? dist(l, r) : null
}

/**
 * Cuánto se ve el cuerpo de frente: ancho de hombros entre largo del tronco.
 * De frente o de espaldas ronda 0,9; de perfil los hombros casi se superponen y baja de 0,4.
 */
export function frontalRatio(pose: Pose): number | null {
  const w = width(pose, 'shoulder')
  const torso = torsoLength(pose)
  return w !== null && torso ? w / torso : null
}

export type View = 'side' | 'oblique' | 'front'

/** Umbrales de vista sobre `frontalRatio`. «front» incluye de espaldas. */
export const VIEW_SIDE_MAX = 0.4
export const VIEW_FRONT_MIN = 0.7

export function classifyView(ratio: number): View {
  return ratio < VIEW_SIDE_MAX ? 'side' : ratio > VIEW_FRONT_MIN ? 'front' : 'oblique'
}

/**
 * Hacia dónde mira la persona en la imagen: +1 a la derecha, −1 a la izquierda,
 * 0 si mira a la cámara, está de espaldas o no se puede saber.
 */
export function facing(pose: Pose): 1 | -1 | 0 {
  const nose = pt(pose, 'nose')
  const ref = center(pose, 'ear') ?? center(pose, 'shoulder')
  const torso = torsoLength(pose)
  if (!nose || !ref || !torso) return 0
  const dx = (nose.x - ref.x) / torso
  return dx > 0.12 ? 1 : dx < -0.12 ? -1 : 0
}

/** Mediana; devuelve null si no hay datos. */
export function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
