// Detección de pose en el navegador con MediaPipe. Se usa en el modo continuo:
// no envía fotogramas a ningún servidor ni consume créditos.

import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import type { Person } from './vision'

const WASM_PATH = '/mediapipe/wasm'
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task'
export const LOCAL_MAX_PERSONS = 6
const MIN_VISIBILITY = 0.3

/** Índice de cada punto COCO dentro de los 33 puntos de MediaPipe. */
const COCO_FROM_BLAZE: [name: string, index: number][] = [
  ['nose', 0], ['left_eye', 2], ['right_eye', 5], ['left_ear', 7], ['right_ear', 8],
  ['left_shoulder', 11], ['right_shoulder', 12], ['left_elbow', 13], ['right_elbow', 14],
  ['left_wrist', 15], ['right_wrist', 16], ['left_hip', 23], ['right_hip', 24],
  ['left_knee', 25], ['right_knee', 26], ['left_ankle', 27], ['right_ankle', 28],
]

export interface LocalPose {
  /** `timestampMs` debe crecer en cada llamada. */
  detect: (video: HTMLVideoElement, timestampMs: number) => Omit<Person, 'id'>[]
  delegate: 'GPU' | 'CPU'
}

let loading: Promise<LocalPose> | null = null

async function create(): Promise<LocalPose> {
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision')
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH)
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO' as const,
    numPoses: LOCAL_MAX_PERSONS,
    minPoseDetectionConfidence: 0.4,
    minPosePresenceConfidence: 0.4,
    minTrackingConfidence: 0.4,
  })

  let landmarker: PoseLandmarker
  let delegate: 'GPU' | 'CPU' = 'GPU'
  try {
    landmarker = await PoseLandmarker.createFromOptions(fileset, options('GPU'))
  } catch {
    // Sin WebGL utilizable (equipos antiguos, navegadores sin aceleración) se cae a CPU.
    delegate = 'CPU'
    landmarker = await PoseLandmarker.createFromOptions(fileset, options('CPU'))
  }

  return {
    delegate,
    detect(video, timestampMs) {
      const result = landmarker.detectForVideo(video, timestampMs)
      return result.landmarks.map((points) => {
        const seen = points.filter((p) => (p.visibility ?? 0) >= MIN_VISIBILITY)
        const src = seen.length >= 4 ? seen : points
        const xs = src.map((p) => p.x)
        const ys = src.map((p) => p.y)
        const clamp = (n: number) => Math.max(0, Math.min(1, n))
        // MediaPipe no devuelve caja: se toma el contorno de los puntos con un margen.
        const padX = (Math.max(...xs) - Math.min(...xs)) * 0.1
        const padY = (Math.max(...ys) - Math.min(...ys)) * 0.08
        const x1 = clamp(Math.min(...xs) - padX)
        const y1 = clamp(Math.min(...ys) - padY)
        const x2 = clamp(Math.max(...xs) + padX)
        const y2 = clamp(Math.max(...ys) + padY)
        const keypoints = COCO_FROM_BLAZE.map(([name, i]) => ({ name, x: points[i].x, y: points[i].y, conf: points[i].visibility ?? 0 }))
        return {
          box: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 },
          conf: keypoints.reduce((s, k) => s + k.conf, 0) / keypoints.length,
          keypoints,
        }
      })
    },
  }
}

/** Carga el modelo una sola vez (unos 6 MB más el runtime) y lo reutiliza. */
export function loadLocalPose(): Promise<LocalPose> {
  loading ??= create().catch((e) => {
    loading = null
    throw e
  })
  return loading
}
