import { useCallback, useEffect, useRef, useState } from 'react'

export const SPEEDS = [0.1, 0.25, 0.5, 1, 2]

/**
 * Reloj de reproducción del visor. Sin video real avanza un reloj simulado;
 * con un <video> cargado, sigue su tiempo y le aplica play, pausa, velocidad y saltos.
 */
export function usePlayback(initialPos: number) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [pos, setPos] = useState(initialPos)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => {
      const v = videoRef.current
      if (v && v.duration) {
        setPos((v.currentTime / v.duration) * 100)
        if (v.ended) setPlaying(false)
      } else {
        setPos((p) => (p + 0.25 * speed > 100 ? 0 : p + 0.25 * speed))
      }
      setTick((t) => t + speed)
    }, 200)
    return () => clearInterval(id)
  }, [playing, speed])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.playbackRate = speed
    if (playing) void v.play().catch(() => setPlaying(false))
    else v.pause()
  }, [playing, speed])

  const seek = useCallback((p: number) => {
    const next = Math.max(0, Math.min(100, p))
    setPos(next)
    const v = videoRef.current
    if (v && v.duration) v.currentTime = (next / 100) * v.duration
  }, [])

  const toggle = useCallback(() => setPlaying((p) => !p), [])
  const play = useCallback(() => setPlaying(true), [])
  const pause = useCallback(() => setPlaying(false), [])

  return { videoRef, pos, playing, speed, tick, seek, toggle, play, pause, setSpeed }
}
