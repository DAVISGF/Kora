// Cliente del worker de detección local. No envía nada a ningún servidor.

import type { Person } from './vision'
import type { LocalEngine, WorkerRequest, WorkerResponse } from './vision.worker'

export type { LocalEngine }

export interface LocalResult {
  persons: Omit<Person, 'id'>[]
  ball: { box: Person['box']; conf: number } | null
  ms: number
  delegate: 'GPU' | 'CPU'
}

const MAX_WIDTH = 640

let worker: Worker | null = null
let nextId = 1
const waiting = new Map<number, { resolve: (r: LocalResult) => void; reject: (e: Error) => void }>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./vision.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const res = e.data
    const pending = waiting.get(res.id)
    if (!pending) return
    waiting.delete(res.id)
    if (res.ok) pending.resolve({ persons: res.persons, ball: res.ball, ms: res.ms, delegate: res.delegate })
    else pending.reject(new Error(res.error))
  }
  worker.onerror = (e) => {
    for (const p of waiting.values()) p.reject(new Error(e.message || 'El worker de visión falló.'))
    waiting.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

/** Detecta en el fotograma actual del video. La primera llamada descarga el modelo. */
export async function detectLocal(video: HTMLVideoElement, engine: LocalEngine, timestamp: number): Promise<LocalResult> {
  const scale = Math.min(1, MAX_WIDTH / video.videoWidth)
  const bitmap = await createImageBitmap(video, {
    resizeWidth: Math.round(video.videoWidth * scale),
    resizeHeight: Math.round(video.videoHeight * scale),
  })
  const id = nextId++
  const request: WorkerRequest = { id, engine, bitmap, timestamp }
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    getWorker().postMessage(request, [bitmap])
  })
}
