/// <reference lib="webworker" />
// Detección en un hilo aparte, para que la interfaz no se frene mientras corre el modelo.
// Dos métodos: «pose» (esqueleto de pocas personas) y «team» (cajas de todo el equipo y balón).

import { FilesetResolver, ObjectDetector, PoseLandmarker } from '@mediapipe/tasks-vision'

declare const self: DedicatedWorkerGlobalScope

export type LocalEngine = 'pose' | 'team'

export interface WorkerRequest {
  id: number
  engine: LocalEngine
  bitmap: ImageBitmap
  timestamp: number
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

interface RawPerson {
  box: Box
  conf: number
  keypoints: { name: string; x: number; y: number; conf: number }[]
}

export type WorkerResponse =
  | { id: number; ok: true; persons: RawPerson[]; ball: { box: Box; conf: number } | null; ms: number; delegate: 'GPU' | 'CPU' }
  | { id: number; ok: false; error: string }

const MODELS = 'https://storage.googleapis.com/mediapipe-models'
const POSE_MODEL = `${MODELS}/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task`
const OBJECT_MODEL = `${MODELS}/object_detector/efficientdet_lite0/float16/latest/efficientdet_lite0.tflite`
const MAX_POSES = 6
const MAX_OBJECTS = 30
const MIN_VISIBILITY = 0.3

/** Índice de cada punto COCO dentro de los 33 puntos de MediaPipe. */
const COCO_FROM_BLAZE: [name: string, index: number][] = [
  ['nose', 0], ['left_eye', 2], ['right_eye', 5], ['left_ear', 7], ['right_ear', 8],
  ['left_shoulder', 11], ['right_shoulder', 12], ['left_elbow', 13], ['right_elbow', 14],
  ['left_wrist', 15], ['right_wrist', 16], ['left_hip', 23], ['right_hip', 24],
  ['left_knee', 25], ['right_knee', 26], ['left_ankle', 27], ['right_ankle', 28],
]

let delegate: 'GPU' | 'CPU' = 'GPU'
let filesetPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null
let posePromise: Promise<PoseLandmarker> | null = null
let objectsPromise: Promise<ObjectDetector> | null = null

// En un worker de tipo módulo no existe importScripts: hace falta la variante ES del runtime.
const WASM_BASE = `${self.location.origin}/mediapipe/wasm`
const fileset = () => (filesetPromise ??= FilesetResolver.forVisionTasks(WASM_BASE, true))

/**
 * MediaPipe borra `ModuleFactory` tras crear una tarea y no vuelve a cargarla,
 * así que la segunda tarea (o el reintento en CPU) fallaría con
 * «ModuleFactory not set». Se repone antes de cada creación.
 */
async function restoreFactory() {
  const mod = (await import(/* @vite-ignore */ `${WASM_BASE}/vision_wasm_module_internal.js`)) as { default: unknown }
  ;(self as unknown as { ModuleFactory?: unknown }).ModuleFactory = mod.default
}

/** Intenta con GPU y, si el equipo no la ofrece dentro del worker, cae a CPU. */
async function withFallback<T>(create: (d: 'GPU' | 'CPU') => Promise<T>): Promise<T> {
  if (delegate === 'GPU') {
    try {
      await restoreFactory()
      return await create('GPU')
    } catch {
      delegate = 'CPU'
    }
  }
  await restoreFactory()
  return create('CPU')
}

const getPose = () =>
  (posePromise ??= fileset().then((fs) =>
    withFallback((d) =>
      PoseLandmarker.createFromOptions(fs, {
        baseOptions: { modelAssetPath: POSE_MODEL, delegate: d },
        runningMode: 'VIDEO',
        numPoses: MAX_POSES,
        minPoseDetectionConfidence: 0.4,
        minPosePresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
      }),
    ),
  ))

const getObjects = () =>
  (objectsPromise ??= fileset().then((fs) =>
    withFallback((d) =>
      ObjectDetector.createFromOptions(fs, {
        baseOptions: { modelAssetPath: OBJECT_MODEL, delegate: d },
        runningMode: 'VIDEO',
        maxResults: MAX_OBJECTS,
        scoreThreshold: 0.3,
        categoryAllowlist: ['person', 'sports ball'],
      }),
    ),
  ))

const clamp = (n: number) => Math.max(0, Math.min(1, n))

function detectPoses(pose: PoseLandmarker, bitmap: ImageBitmap, timestamp: number): RawPerson[] {
  return pose.detectForVideo(bitmap, timestamp).landmarks.map((points) => {
    const seen = points.filter((p) => (p.visibility ?? 0) >= MIN_VISIBILITY)
    const src = seen.length >= 4 ? seen : points
    const xs = src.map((p) => p.x)
    const ys = src.map((p) => p.y)
    // MediaPipe no devuelve caja: se toma el contorno de los puntos con un margen.
    const padX = (Math.max(...xs) - Math.min(...xs)) * 0.1
    const padY = (Math.max(...ys) - Math.min(...ys)) * 0.08
    const x1 = clamp(Math.min(...xs) - padX)
    const y1 = clamp(Math.min(...ys) - padY)
    const keypoints = COCO_FROM_BLAZE.map(([name, i]) => ({ name, x: points[i].x, y: points[i].y, conf: points[i].visibility ?? 0 }))
    return {
      box: { x: x1, y: y1, w: clamp(Math.max(...xs) + padX) - x1, h: clamp(Math.max(...ys) + padY) - y1 },
      conf: keypoints.reduce((s, k) => s + k.conf, 0) / keypoints.length,
      keypoints,
    }
  })
}

function iou(a: Box, b: Box): number {
  const inter = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  const union = a.w * a.h + b.w * b.h - inter
  return union > 0 ? inter / union : 0
}

async function run(req: WorkerRequest): Promise<Omit<Extract<WorkerResponse, { ok: true }>, 'id' | 'ok'>> {
  const { bitmap, timestamp, engine } = req
  const pose = await getPose()
  if (engine === 'pose') {
    const started = performance.now()
    const persons = detectPoses(pose, bitmap, timestamp)
    return { persons, ball: null, ms: Math.round(performance.now() - started), delegate }
  }

  const objects = await getObjects()
  const started = performance.now()
  const w = bitmap.width
  const h = bitmap.height
  const found = objects.detectForVideo(bitmap, timestamp).detections.flatMap((d) => {
    const cat = d.categories[0]
    const bb = d.boundingBox
    if (!cat || !bb) return []
    return [{ name: cat.categoryName, conf: cat.score, box: { x: clamp(bb.originX / w), y: clamp(bb.originY / h), w: bb.width / w, h: bb.height / h } }]
  })
  const persons: RawPerson[] = found.filter((f) => f.name === 'person').map((f) => ({ box: f.box, conf: f.conf, keypoints: [] }))
  const ball = found.filter((f) => f.name === 'sports ball').sort((a, b) => b.conf - a.conf)[0]

  // El esqueleto solo sale para unas pocas personas: se asigna a la caja con la que más se solapa.
  for (const posed of detectPoses(pose, bitmap, timestamp)) {
    let best: RawPerson | null = null
    let score = 0.2
    for (const p of persons) {
      const s = iou(p.box, posed.box)
      if (s > score && p.keypoints.length === 0) {
        best = p
        score = s
      }
    }
    if (best) best.keypoints = posed.keypoints
  }

  return { persons, ball: ball ? { box: ball.box, conf: ball.conf } : null, ms: Math.round(performance.now() - started), delegate }
}

/** Suelta los modelos cargados para que la próxima detección los cree de nuevo. */
async function reset() {
  const loaded = await Promise.allSettled([posePromise, objectsPromise])
  posePromise = null
  objectsPromise = null
  for (const task of loaded) {
    try {
      if (task.status === 'fulfilled') task.value?.close()
    } catch {
      /* un modelo que ya falló puede no dejarse cerrar */
    }
  }
}

/**
 * Hay equipos en los que el modelo se crea bien con GPU pero falla al detectar
 * (controladores, WebGL limitado dentro de un worker). Ahí no basta con el
 * respaldo de la creación: se rehace todo en CPU y se repite el fotograma.
 */
async function runResilient(req: WorkerRequest) {
  try {
    return await run(req)
  } catch (err) {
    const wasGpu = delegate === 'GPU'
    await reset()
    if (!wasGpu) throw err
    delegate = 'CPU'
    return run(req)
  }
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data
  let res: WorkerResponse
  try {
    res = { id: req.id, ok: true, ...(await runResilient(req)) }
  } catch (err) {
    res = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    req.bitmap.close()
  }
  self.postMessage(res)
}
