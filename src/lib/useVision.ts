import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { detectLocal, type LocalEngine } from './localVision'
import { analyzeFrame, trackPersons, VisionError, type FrameAnalysis, type Person, type VisionErrorCode } from './vision'

export type VisionStatus = 'idle' | 'loading' | 'loading_model' | 'ok' | VisionErrorCode
export type LiveEngine = LocalEngine | 'cloud'

const ENGINE_KEY = 'kora.liveEngine'
const isEngine = (v: unknown): v is LiveEngine => v === 'pose' || v === 'team' || v === 'cloud'

function storedEngine(): LiveEngine {
  try {
    const v = localStorage.getItem(ENGINE_KEY)
    return isEngine(v) ? v : 'pose'
  } catch {
    return 'pose'
  }
}

const LIVE_INTERVAL_MS = 800
const LOCAL_MIN_INTERVAL_MS = 50 // hasta ~20 detecciones por segundo

/** Análisis real de fotogramas del video cargado, bajo demanda o en continuo. */
export function useVision(videoRef: RefObject<HTMLVideoElement | null>, enabled: boolean, pos: number) {
  const [analysis, setAnalysis] = useState<FrameAnalysis | null>(null)
  const [status, setStatus] = useState<VisionStatus>('idle')
  const [message, setMessage] = useState('')
  const [live, setLive] = useState(false)
  const [ball, setBall] = useState(false)
  const [engine, setEngineState] = useState<LiveEngine>(storedEngine)
  const setEngine = useCallback((e: LiveEngine) => {
    setEngineState(e)
    try {
      localStorage.setItem(ENGINE_KEY, e)
    } catch {
      /* sin almacenamiento: la elección dura lo que la sesión */
    }
  }, [])
  const busy = useRef(false)
  const prev = useRef<Person[]>([])
  const nextId = useRef(1)
  const ballRef = useRef(ball)
  ballRef.current = ball

  const analyze = useCallback(async () => {
    const video = videoRef.current
    if (!video || busy.current) return
    busy.current = true
    setStatus((s) => (s === 'ok' ? s : 'loading'))
    try {
      const res = await analyzeFrame(video, { ball: ballRef.current })
      const persons = trackPersons(prev.current, res.persons, nextId)
      prev.current = persons
      setAnalysis({ ...res, persons, source: 'cloud' })
      setStatus('ok')
      setMessage('')
    } catch (e) {
      const err = e instanceof VisionError ? e : new VisionError('failed', 'Error inesperado al analizar el fotograma.')
      setStatus(err.code)
      setMessage(err.message)
      setLive(false)
    } finally {
      busy.current = false
    }
  }, [videoRef])

  // Modo continuo en el navegador: el modelo corre en un worker, sin red.
  useEffect(() => {
    if (!live || !enabled || engine === 'cloud') return
    let stopped = false
    let lastTime = -1
    let lastRun = 0
    setStatus((s) => (s === 'ok' ? s : 'loading_model'))
    prev.current = []

    const frame = () => new Promise<number>((r) => requestAnimationFrame(r))
    void (async () => {
      try {
        while (!stopped) {
          const now = await frame()
          const video = videoRef.current
          if (stopped) break
          // En pausa el fotograma no cambia: no hace falta volver a detectar.
          if (!video || video.readyState < 2 || video.currentTime === lastTime || now - lastRun < LOCAL_MIN_INTERVAL_MS) continue
          lastRun = now
          lastTime = video.currentTime
          const res = await detectLocal(video, engine, now)
          if (stopped) break
          const aspect = video.videoWidth / video.videoHeight || 16 / 9
          const persons = trackPersons(
            prev.current,
            res.persons.map((p, i) => ({ ...p, id: i + 1 })),
            nextId,
            aspect,
          )
          prev.current = persons
          setAnalysis({ persons, ball: res.ball, ms: res.ms, model: `MediaPipe · ${res.delegate}`, source: 'local' })
          setStatus('ok')
          setMessage('')
        }
      } catch (e) {
        if (stopped) return
        console.error('Fallo del modelo local:', e)
        setStatus('failed')
        setMessage('No se pudo ejecutar el modelo del navegador. Prueba el modo continuo con Roboflow.')
        setLive(false)
      }
    })()
    return () => {
      stopped = true
    }
  }, [live, enabled, engine, videoRef])

  useEffect(() => {
    if (!live || !enabled || engine !== 'cloud') return
    void analyze()
    const id = setInterval(() => void analyze(), LIVE_INTERVAL_MS)
    return () => clearInterval(id)
  }, [live, enabled, engine, analyze])

  // Sin análisis continuo, las detecciones dejan de valer en cuanto cambia el fotograma.
  const analyzedAt = useRef(pos)
  useEffect(() => {
    if (live) return
    if (analysis && Math.abs(pos - analyzedAt.current) > 1e-6) {
      setAnalysis(null)
      setStatus('idle')
    }
  }, [pos, live, analysis])
  useEffect(() => {
    if (analysis) analyzedAt.current = pos
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis])

  return { analysis, status, message, live, setLive, ball, setBall, engine, setEngine, analyze }
}
