// Los chequeos del Coach: qué se mira en cada gesto y a partir de qué valor se
// considera que hay que corregirlo o que ya está bien. Los umbrales dejan a
// propósito una franja ancha «normal» en medio: solo se comenta lo que se
// aparta con claridad, porque la medida sobre un video tiene varios grados de error.

import { FAST_CADENCE } from './actions/run'
import type { ActionKind, Joint, Rep, Side } from './types'

export type Grade = 'fix' | 'good' | 'ok'

export interface Check {
  id: string
  action: ActionKind
  /** Clave de la medida dentro de la repetición */
  measure: string
  /** Orden en que un entrenador lo trabajaría: primero la base, después los detalles */
  priority: number
  /** Como mucho «para pulir»: nunca se propone como lo primero a corregir */
  minor?: boolean
  grade: (value: number, rep: Rep) => Grade
  /** Variante del texto, cuando el fallo puede ser por exceso o por defecto */
  variant?: (value: number) => string
  /** Puntos del cuerpo a resaltar en la foto */
  highlight: (side: Side | null) => Joint[]
  /** Cuál de dos valores marcados es peor */
  worse: (a: number, b: number) => boolean
}

const both = (part: 'hip' | 'knee' | 'ankle' | 'shoulder' | 'elbow' | 'wrist'): Joint[] => [`left_${part}`, `right_${part}`]
const arm = (side: Side | null): Joint[] => (side ? [`${side}_shoulder`, `${side}_elbow`, `${side}_wrist`] : [...both('shoulder'), ...both('elbow'), ...both('wrist')])
const leg = (side: Side | null): Joint[] => (side ? [`${side}_hip`, `${side}_knee`, `${side}_ankle`] : [...both('hip'), ...both('knee'), ...both('ankle')])
const other = (side: Side | null): Side | null => (side === 'left' ? 'right' : side === 'right' ? 'left' : null)
const trunk: Joint[] = ['left_shoulder', 'left_hip', 'right_hip', 'right_shoulder']

export const CHECKS: Check[] = [
  // ───── Tiro de baloncesto ─────
  {
    id: 'shot.base',
    action: 'shot',
    measure: 'base',
    priority: 1,
    // Separación de los pies entre ancho de hombros (medido en los puntos de la pose, algo más estrecho que el real).
    grade: (v) => (v < 0.45 || v > 2.1 ? 'fix' : v >= 0.6 && v <= 1.7 ? 'good' : 'ok'),
    variant: (v) => (v < 1 ? 'narrow' : 'wide'),
    highlight: () => both('ankle'),
    worse: (a, b) => Math.abs(Math.log(a)) > Math.abs(Math.log(b)),
  },
  {
    id: 'shot.legs',
    action: 'shot',
    measure: 'legs',
    priority: 2,
    // Ángulo de rodilla al cargar (180 = pierna recta). Los buenos tiradores rondan 110–130.
    grade: (v) => (v >= 150 ? 'fix' : v <= 135 ? 'good' : 'ok'),
    highlight: () => leg(null),
    worse: (a, b) => a > b,
  },
  {
    id: 'shot.flare',
    action: 'shot',
    measure: 'flare',
    priority: 3,
    // Cuánto se sale el codo hacia fuera del hombro, en largos de brazo.
    grade: (v) => (v >= 0.85 ? 'fix' : v <= 0.45 ? 'good' : 'ok'),
    highlight: (side) => arm(side),
    worse: (a, b) => a > b,
  },
  {
    id: 'shot.extension',
    action: 'shot',
    measure: 'extension',
    priority: 4,
    // Ángulo del codo al soltar (180 = brazo estirado).
    grade: (v) => (v <= 150 ? 'fix' : v >= 160 ? 'good' : 'ok'),
    highlight: (side) => arm(side),
    worse: (a, b) => a < b,
  },
  {
    id: 'shot.follow',
    action: 'shot',
    measure: 'follow',
    priority: 5,
    // Segundos con la mano arriba después de soltar (bajar el brazo ya lleva un par de décimas).
    grade: (v) => (v < 0.35 ? 'fix' : v >= 0.6 ? 'good' : 'ok'),
    highlight: (side) => arm(side),
    worse: (a, b) => a < b,
  },
  {
    id: 'shot.trunk',
    action: 'shot',
    measure: 'trunk',
    priority: 6,
    minor: true,
    // Grados que el tronco se aparta de la vertical al soltar.
    grade: (v) => (v >= 20 ? 'fix' : 'ok'),
    highlight: () => trunk,
    worse: (a, b) => a > b,
  },

  // ───── Golpeo de fútbol ─────
  {
    id: 'kick.plant',
    action: 'kick',
    measure: 'plant',
    priority: 1,
    // Cuánto queda el balón por delante del tobillo de apoyo, en troncos. Con el pie al lado, entre 0 y 0,5.
    grade: (v) => (v >= 0.9 ? 'fix' : v >= -0.2 && v <= 0.6 ? 'good' : 'ok'),
    highlight: (side) => leg(other(side)),
    worse: (a, b) => a > b,
  },
  {
    id: 'kick.knee',
    action: 'kick',
    measure: 'knee',
    priority: 2,
    // Ángulo de la rodilla de apoyo al golpear (180 = pierna tiesa). Lo habitual: 135–160.
    grade: (v) => (v >= 170 ? 'fix' : v >= 120 && v <= 160 ? 'good' : 'ok'),
    highlight: (side) => leg(other(side)),
    worse: (a, b) => a > b,
  },
  {
    id: 'kick.lean',
    action: 'kick',
    measure: 'lean',
    priority: 3,
    // Inclinación del tronco al golpear: negativa = hacia atrás. Algo hacia atrás es normal en un golpeo fuerte.
    grade: (v) => (v <= -28 ? 'fix' : v >= -10 ? 'good' : 'ok'),
    highlight: () => trunk,
    worse: (a, b) => a < b,
  },
  {
    id: 'kick.follow',
    action: 'kick',
    measure: 'follow',
    priority: 4,
    // Hasta dónde sube el muslo después de golpear (90 = horizontal).
    grade: (v) => (v < 25 ? 'fix' : v >= 45 ? 'good' : 'ok'),
    highlight: (side) => leg(side),
    worse: (a, b) => a < b,
  },

  // ───── Carrera ─────
  {
    id: 'run.arms',
    action: 'run',
    measure: 'arms',
    priority: 1,
    // Ángulo típico del codo durante el braceo (90 = en «L»).
    grade: (v) => (v >= 140 ? 'fix' : v >= 65 && v <= 115 ? 'good' : 'ok'),
    highlight: () => arm(null),
    worse: (a, b) => a > b,
  },
  {
    id: 'run.knees',
    action: 'run',
    measure: 'knees',
    priority: 2,
    // Elevación del muslo (90 = horizontal). Solo se exige cuando se corre rápido de verdad.
    grade: (v, rep) => (v < 40 && (rep.info.cadence ?? 0) >= FAST_CADENCE ? 'fix' : v >= 55 ? 'good' : 'ok'),
    highlight: () => leg(null),
    worse: (a, b) => a < b,
  },
  {
    id: 'run.lean',
    action: 'run',
    measure: 'lean',
    priority: 3,
    // Inclinación del tronco hacia donde se corre: negativa = hacia atrás.
    grade: (v) => (v <= -5 ? 'fix' : v >= 2 && v <= 25 ? 'good' : 'ok'),
    highlight: () => trunk,
    worse: (a, b) => a < b,
  },
  {
    id: 'run.cross',
    action: 'run',
    measure: 'cross',
    priority: 4,
    // Cuánto pasa la mano de la mitad del pecho, en anchos de hombros (negativo = no llega).
    grade: (v) => (v >= 0.25 ? 'fix' : v <= -0.1 ? 'good' : 'ok'),
    highlight: () => both('wrist'),
    worse: (a, b) => a > b,
  },
]

export const checksFor = (action: ActionKind) => CHECKS.filter((c) => c.action === action)
