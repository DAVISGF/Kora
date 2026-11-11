import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { loadLocalPose } from './localPose'
import { analyzeFrame, trackPersons, VisionError, type FrameAnalysis, type Person, type VisionErrorCode } from './vision'

export type VisionStatus = 'idle' | 'loading' | 'loading_model' | 'ok' | VisionErrorCode
export type LiveEngine = 'local' | 'cloud'

const LIVE_INTERVAL_MS = 800
const LOCAL_MIN_INTERVAL_MS = 80 // ~12 detecciones por segundo como máximo

/** Análisis real de fotogramas del video cargado, bajo demanda o en continuo. */
export function useVision(videoRef: RefObject<HTMLVideoElement | null>, enabled: boolean, pos: number) {
  const [analysis, setAnalysis] = useState<FrameAnalysis | null>(null)
  const [status, setStatus] = useState<VisionStatus>('idle')
  const [message, setMessage] = useState('')
  const [live, setLive] = useState(false)
  const [ball, setBall] = useState(false)
  const [engine, setEngine] = useState<LiveEngine>('local')
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

  // Modo continuo en el navegador: sin red, tantas detecciones por segundo como dé el equipo.
  useEffect(() => {
    if (!live || !enabled || engine !== 'local') return
    let stopped = false
    let raf = 0
    let last = 0
    let lastTime = -1
    let cost = 0
    setStatus((s) => (s === 'ok' ? s : 'loading_model'))
    loadLocalPose()
      .then((pose) => {
        if (stopped) return
        const loop = (now: number) => {
          if (stopped) return
          raf = requestAnimationFrame(loop)
          const video = videoRef.current
          if (!video || video.readyState < 2 || now - last < Math.max(LOCAL_MIN_INTERVAL_MS, cost * 1.5)) return
          // La detección bloquea la página mientras corre: en equipos lentos se espacia para que la interfaz respire.
          // En pausa el fotograma no cambia: no hace falta volver a detectar.
          if (video.currentTime === lastTime) return
          last = now
          lastTime = video.currentTime
          const started = performance.now()
          const found = pose.detect(video, now)
          const aspect = video.videoWidth / video.videoHeight || 16 / 9
          const persons = trackPersons(
            prev.current,
            found.map((p, i) => ({ ...p, id: i + 1 })),
            nextId,
            aspect,
          )
          prev.current = persons
          cost = performance.now() - started
          setAnalysis({ persons, ball: null, ms: Math.round(cost), model: `MediaPipe Pose · ${pose.delegate}`, source: 'local' })
          setStatus('ok')
          setMessage('')
        }
        raf = requestAnimationFrame(loop)
      })
      .catch(() => {
        if (stopped) return
        setStatus('failed')
        setMessage('No se pudo cargar el modelo del navegador. Prueba el modo continuo con Roboflow.')
        setLive(false)
      })
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
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
