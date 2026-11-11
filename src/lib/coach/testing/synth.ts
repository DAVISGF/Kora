// Figura articulada sintética para las pruebas del motor. Genera poses COCO-17
// a partir de ángulos articulares, con la cámara girada el ángulo que se pida,
// para comprobar que las mediciones y los controles de vista hacen lo que deben.
// No se usa en la aplicación.

import { JOINTS, type Joint, type Pose, type PoseFrame, type PoseSeries, type WindowReason } from '../types'

/** Proporciones del cuerpo respecto a la estatura (Winter, 2009). */
const K = {
  torso: 0.288,
  thigh: 0.245,
  shank: 0.246,
  ankle: 0.039,
  upperArm: 0.186,
  forearm: 0.146,
  halfShoulders: 0.1295,
  halfHips: 0.0955,
  neckToNose: 0.107,
  noseForward: 0.045,
  eyeUp: 0.016,
  halfEyes: 0.016,
  halfEars: 0.04,
  earBack: 0.045,
}

export interface Limb {
  /** Pierna: flexión de cadera (muslo hacia delante +, hacia atrás −). Brazo: elevación (0 colgando, 180 arriba). */
  lift: number
  /** Flexión de la articulación media: 0 = estirada. Rodilla o codo. */
  bend: number
}

export interface FigureSpec {
  /** Estatura en píxeles */
  height: number
  /** Posición de los pies en el suelo (centro), en píxeles */
  x: number
  groundY: number
  /** Inclinación del tronco hacia delante, en grados */
  lean: number
  legs: { left: Limb; right: Limb }
  arms: { left: Limb; right: Limb }
  /** Altura extra del cuerpo sobre el suelo, en estaturas (salto) */
  air?: number
  /** Giro de la cámara: 0 = perfil exacto, 90 = de frente */
  yaw?: number
  /** Hacia dónde mira en la imagen cuando yaw = 0: 1 derecha, −1 izquierda */
  dir?: 1 | -1
}

const rad = (d: number) => (d * Math.PI) / 180

type V3 = [x: number, y: number, z: number]

/**
 * Pose de la figura. En el cuerpo: x hacia delante, y hacia arriba, z hacia la
 * izquierda de la persona. La cámara mira perpendicular al plano x–y cuando yaw = 0.
 */
export function figure(spec: FigureSpec): Pose {
  const H = spec.height
  const pts: Partial<Record<Joint, V3>> = {}

  // Piernas: la cadera queda a la altura que deja la pierna más estirada apoyada en el suelo.
  const leg = (l: Limb) => {
    const a = rad(l.lift)
    const b = rad(l.lift - l.bend)
    const knee: [number, number] = [K.thigh * Math.sin(a), -K.thigh * Math.cos(a)]
    const ankle: [number, number] = [knee[0] + K.shank * Math.sin(b), knee[1] - K.shank * Math.cos(b)]
    return { knee, ankle }
  }
  const L = leg(spec.legs.left)
  const R = leg(spec.legs.right)
  const hipY = K.ankle + Math.max(-L.ankle[1], -R.ankle[1]) + (spec.air ?? 0)
  const put = (name: Joint, x: number, y: number, z: number) => {
    pts[name] = [x, y, z]
  }
  put('left_hip', 0, hipY, K.halfHips)
  put('right_hip', 0, hipY, -K.halfHips)
  put('left_knee', L.knee[0], hipY + L.knee[1], K.halfHips)
  put('right_knee', R.knee[0], hipY + R.knee[1], -K.halfHips)
  put('left_ankle', L.ankle[0], hipY + L.ankle[1], K.halfHips)
  put('right_ankle', R.ankle[0], hipY + R.ankle[1], -K.halfHips)

  // Tronco y cabeza, inclinados `lean` hacia delante.
  const le = rad(spec.lean)
  const up: [number, number] = [Math.sin(le), Math.cos(le)]
  const fwd: [number, number] = [Math.cos(le), -Math.sin(le)]
  const sx = K.torso * up[0]
  const sy = hipY + K.torso * up[1]
  put('left_shoulder', sx, sy, K.halfShoulders)
  put('right_shoulder', sx, sy, -K.halfShoulders)
  const nx = sx + K.neckToNose * up[0] + K.noseForward * fwd[0]
  const ny = sy + K.neckToNose * up[1] + K.noseForward * fwd[1]
  put('nose', nx, ny, 0)
  put('left_eye', nx - 0.015 * fwd[0] + K.eyeUp * up[0], ny - 0.015 * fwd[1] + K.eyeUp * up[1], K.halfEyes)
  put('right_eye', nx - 0.015 * fwd[0] + K.eyeUp * up[0], ny - 0.015 * fwd[1] + K.eyeUp * up[1], -K.halfEyes)
  put('left_ear', nx - K.earBack * fwd[0], ny - K.earBack * fwd[1], K.halfEars)
  put('right_ear', nx - K.earBack * fwd[0], ny - K.earBack * fwd[1], -K.halfEars)

  // Brazos: la elevación se mide desde el tronco; el codo dobla el antebrazo hacia delante y arriba.
  const arm = (l: Limb, z: number, shoulder: Joint, elbow: Joint, wrist: Joint) => {
    const a = rad(l.lift) + le
    const b = a + rad(l.bend)
    const ex = sx + K.upperArm * Math.sin(a)
    const ey = sy - K.upperArm * Math.cos(a)
    put(elbow, ex, ey, z)
    put(wrist, ex + K.forearm * Math.sin(b), ey - K.forearm * Math.cos(b), z)
    void shoulder
  }
  arm(spec.arms.left, K.halfShoulders, 'left_shoulder', 'left_elbow', 'left_wrist')
  arm(spec.arms.right, -K.halfShoulders, 'right_shoulder', 'right_elbow', 'right_wrist')

  // Proyección ortográfica con la cámara girada `yaw` alrededor de la vertical.
  const yaw = rad(spec.yaw ?? 0)
  const dir = spec.dir ?? 1
  const pose: Pose = {}
  for (const name of JOINTS) {
    const p = pts[name]
    if (!p) continue
    const u = p[0] * Math.cos(yaw) + p[2] * Math.sin(yaw)
    pose[name] = { x: spec.x + dir * u * H, y: spec.groundY - p[1] * H, c: 0.92 }
  }
  return pose
}

/** Generador pseudoaleatorio con semilla, para que las pruebas sean repetibles. */
export function rng(seed: number) {
  let s = seed >>> 0
  const next = () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
  return { next, gauss: () => (next() + next() + next() + next() - 2) * 1.2247 }
}

/** Añade ruido gaussiano a cada punto, en fracción de la estatura. */
export function jitter(pose: Pose, height: number, sigma: number, r: { gauss: () => number }): Pose {
  const out: Pose = {}
  for (const name of JOINTS) {
    const p = pose[name]
    if (p) out[name] = { x: p.x + r.gauss() * sigma * height, y: p.y + r.gauss() * sigma * height, c: p.c }
  }
  return out
}

function boxOf(pose: Pose) {
  const ps = Object.values(pose)
  const xs = ps.map((p) => p.x)
  const ys = ps.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x: x - 10, y: y - 20, w: Math.max(...xs) - x + 20, h: Math.max(...ys) - y + 30 }
}

export interface SeriesSpec {
  fps: number
  duration: number
  /** Figura en el instante t (segundos desde el inicio) */
  at: (t: number) => FigureSpec
  /** Ruido de los puntos, en fracción de la estatura (0,008 ≈ modelo bueno en un recorte nítido) */
  noise?: number
  seed?: number
  reason?: WindowReason
  start?: number
}

export function series(spec: SeriesSpec): PoseSeries {
  const r = rng(spec.seed ?? 7)
  const frames: PoseFrame[] = []
  const n = Math.round(spec.duration * spec.fps)
  const t0 = spec.start ?? 0
  for (let i = 0; i <= n; i++) {
    const t = i / spec.fps
    const fig = spec.at(t)
    const clean = figure(fig)
    const pose = spec.noise ? jitter(clean, fig.height, spec.noise, r) : clean
    frames.push({ t: t0 + t, pose, box: boxOf(pose), conf: 0.9 })
  }
  return { personId: 1, reason: spec.reason ?? 'clip', start: t0, end: t0 + spec.duration, fps: spec.fps, width: 1280, height: 720, frames, requested: frames.length }
}

/** Interpolación suave entre puntos clave [t, valor]. */
export function track(keys: [t: number, value: number][]): (t: number) => number {
  return (t) => {
    if (t <= keys[0][0]) return keys[0][1]
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) {
        const [t0, v0] = keys[i - 1]
        const [t1, v1] = keys[i]
        const k = (t - t0) / (t1 - t0 || 1)
        const s = k * k * (3 - 2 * k)
        return v0 + (v1 - v0) * s
      }
    }
    return keys[keys.length - 1][1]
  }
}
