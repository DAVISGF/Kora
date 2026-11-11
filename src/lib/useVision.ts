import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { analyzeFrame, trackPersons, VisionError, type FrameAnalysis, type Person, type VisionErrorCode } from './vision'

export type VisionStatus = 'idle' | 'loading' | 'ok' | VisionErrorCode

const LIVE_INTERVAL_MS = 800

/** Análisis real de fotogramas del video cargado, bajo demanda o en continuo. */
export function useVision(videoRef: RefObject<HTMLVideoElement | null>, enabled: boolean, pos: number) {
  const [analysis, setAnalysis] = useState<FrameAnalysis | null>(null)
  const [status, setStatus] = useState<VisionStatus>('idle')
  const [message, setMessage] = useState('')
  const [live, setLive] = useState(false)
  const [ball, setBall] = useState(false)
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
      setAnalysis({ ...res, persons })
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

  useEffect(() => {
    if (!live || !enabled) return
    void analyze()
    const id = setInterval(() => void analyze(), LIVE_INTERVAL_MS)
    return () => clearInterval(id)
  }, [live, enabled, analyze])

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

  return { analysis, status, message, live, setLive, ball, setBall, analyze }
}
