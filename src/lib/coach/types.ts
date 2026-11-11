// Tipos del motor del Coach. Todo lo que hay aquí se mide en el video real;
// las coordenadas van en píxeles del video original (x a la derecha, y hacia abajo).

export const JOINTS = [
  'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear', 'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
] as const

export type Joint = (typeof JOINTS)[number]
export type Side = 'left' | 'right'

export interface Pt {
  x: number
  y: number
  /** Confianza del modelo en este punto, 0–1 */
  c: number
}

export type Pose = Partial<Record<Joint, Pt>>

export interface PxBox {
  x: number
  y: number
  w: number
  h: number
}

/** El balón visto cerca de la persona: centro y radio en píxeles del video. */
export interface BallObs {
  x: number
  y: number
  r: number
  c: number
}

/** La pose de una persona en un instante del video. */
export interface PoseFrame {
  t: number
  pose: Pose
  box: PxBox
  /** Confianza de la detección de la persona, 0–1 */
  conf: number
  /** El balón, si se buscó en este fotograma y apareció dentro del recorte */
  ball?: BallObs | null
  /** Hay otra persona encima o pegada: el modelo puede confundir de quién es cada punto */
  crowd?: boolean
}

/** Por qué se muestreó este tramo: el clip entero o una ventana alrededor de un evento. */
export type WindowReason = 'clip' | 'shot' | 'kick' | 'sprint'

/** Serie densa de poses de una persona en un tramo del video. */
export interface PoseSeries {
  personId: number
  reason: WindowReason
  start: number
  end: number
  /** Cadencia base del muestreo; alrededor de los instantes clave puede ser mayor */
  fps: number
  /** Tamaño del video, en píxeles */
  width: number
  height: number
  frames: PoseFrame[]
  /** Fotogramas pedidos; frames.length / requested es la cobertura */
  requested: number
}

// ───────────── Lo que el motor mide ─────────────

export type ActionKind = 'shot' | 'kick' | 'run'

/** Por qué no se pudo tomar una medida. */
export type Missing =
  /** La cámara está en un ángulo desde el que esa parte del gesto no se aprecia */
  | 'view'
  /** La parte del cuerpo no sale en el video o no se distingue */
  | 'hidden'
  /** El video se corta antes de que termine el gesto */
  | 'cut'
  /** Hay muy pocos fotogramas buenos para estar seguros */
  | 'unclear'

export interface Measure {
  value: number
  /** Instante del video donde mejor se ve */
  t: number
  /** Cómo se obtuvo: ángulo directo en la imagen o altura (vale desde cualquier ángulo de cámara) */
  method?: 'angle' | 'vertical'
}

export type View = 'side' | 'oblique' | 'front'

/** Una repetición de un gesto: un tiro, un golpeo, un tramo de carrera. */
export interface Rep {
  kind: ActionKind
  personId: number
  /** Instante clave: soltar el balón, golpearlo, o el centro del tramo de carrera */
  t: number
  start: number
  end: number
  /** Brazo de tiro o pierna de golpeo */
  side: Side | null
  view: View
  /** Medidas tomadas, por identificador de chequeo */
  m: Record<string, Measure>
  missing: Record<string, Missing>
  /** Datos sueltos del gesto que no se califican (cadencia, si se vio el balón…) */
  info: Record<string, number>
}

// ───────────── El informe del Coach ─────────────

/** «fix»: lo vimos varias veces, conviene corregirlo. «polish»: para pulir. «good»: ya lo hace bien. */
export type Status = 'fix' | 'polish' | 'good'
export type Confidence = 'alta' | 'media' | 'baja'

/** La prueba de un hallazgo: el instante del video donde mejor se ve. */
export interface Evidence {
  t: number
  /** Foto del instante, como data URL; la pone la aplicación al terminar el análisis */
  image: string | null
  /** Zona del video que muestra la foto, en píxeles */
  crop: PxBox
  pose: Pose
  /** Puntos del cuerpo que se resaltan sobre la foto, en orden */
  highlight: Joint[]
  ball: BallObs | null
}

export interface Drill {
  name: string
  steps: string[]
  dose: string
}

export interface Finding {
  /** Identificador del chequeo, p. ej. «shot.legs» */
  id: string
  action: ActionKind
  status: Status
  /** Nombre corto de lo que se mira: «Piernas», «Codo»… */
  label: string
  title: string
  /** Qué vimos */
  seen: string
  /** Por qué importa */
  why: string | null
  /** La clave para acordarse */
  cue: string | null
  drill: Drill | null
  /** La medida, en palabras */
  measured: string | null
  target: string | null
  reps: { flagged: number; measured: number }
  confidence: Confidence
  confidenceNote: string
  evidence: Evidence | null
  /** Instantes del video para ir a verlo */
  moments: number[]
}

export interface Unmeasured {
  id: string
  label: string
  reason: Missing
  text: string
}

export interface PersonCoach {
  personId: number
  /** Foto de la persona, como data URL; la pone la aplicación */
  thumb: string | null
  actions: { kind: ActionKind; count: number; times: number[] }[]
  /** Cosas que vimos pero todavía no analizamos */
  extras: string[]
  headline: string
  focus: Finding | null
  polish: Finding[]
  good: Finding[]
  unmeasured: Unmeasured[]
}

export interface CoachReport {
  people: PersonCoach[]
  /** Por qué no hay nada que mostrar, si es el caso */
  empty: string | null
  /** Consejos para grabar mejor la próxima vez */
  tips: string[]
  frames: { requested: number; measured: number }
}
