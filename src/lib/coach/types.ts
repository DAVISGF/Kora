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

/** La pose de una persona en un instante del video. */
export interface PoseFrame {
  t: number
  pose: Pose
  box: PxBox
  /** Confianza de la detección de la persona, 0–1 */
  conf: number
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
