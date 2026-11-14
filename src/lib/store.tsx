import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cleanLabel } from './people'
import { ANALYSIS_VERSION, runCoachFor, runVideoAnalysis, type ScanProgress, type VideoAnalysis } from './videoAnalysis'
import { VisionError } from './vision'
import { clearAnalysis, clearStoredVideo, getAnalysis, getVideo, putAnalysis, putVideo } from './videoStore'
import { SPORTS, type Phase, type Severity, type SportData, type SportId } from '../data/sports'

export interface Clip {
  id: string
  name: string
  sport: SportId
  source: string
  range: string
  dur: string
  sizeMb: number
  slow: boolean
  sev: Severity
  who: string
  diag: string
  meas: string
  ideal: string
  drill: [name: string, dose: string]
  kpis: [label: string, value: string][]
  phases: Phase[]
  events: string[]
  layers: string[]
}

export interface HistoryItem {
  id: string
  name: string
  sport: SportId
  kind: 'Análisis de video' | 'Jugadas IA'
  when: string
  dur: string
  findings: string
}

export interface VideoSource {
  url: string
  name: string
  /** true si es un archivo local reproducible en el visor */
  playable: boolean
  /** Huella del origen; cambia cuando cambia el video */
  key: string
}

interface Store {
  sport: SportId
  data: SportData
  setSport: (s: SportId) => void
  video: VideoSource | null
  /** true mientras se recupera el último video guardado en este navegador */
  restoring: boolean
  /** Para enlaces externos o para quitar el video (null) */
  setVideo: (v: VideoSource | null) => void
  /** Carga un archivo local y lo guarda en este navegador para que sobreviva a una recarga */
  loadVideoFile: (file: File) => void
  /** KPIs y eventos medidos en el video cargado; se pierde al cambiar de video */
  videoAnalysis: VideoAnalysis | null
  setVideoAnalysis: (v: VideoAnalysis | null) => void
  /** Avance del análisis en curso, o null si no hay ninguno */
  scan: ScanProgress | null
  scanError: string
  /** Analiza el video cargado: KPIs, eventos y técnica. Sigue aunque se cambie de pantalla. */
  startScan: (opts: { startSec: number; ball: boolean }) => void
  cancelScan: () => void
  /** Pone nombre y dorsal a una persona seguida en el video; vacíos, se los quita */
  labelPerson: (id: number, name: string, number: string) => void
  /** Vuelve a medir la técnica, solo de la persona elegida. Conserva el resto del análisis. */
  analyzePerson: (id: number) => void
  cams: number
  setCams: (n: number) => void
  clips: Clip[]
  addClip: (c: Clip) => void
  removeClip: (id: string) => void
  history: HistoryItem[]
  addHistory: (h: HistoryItem) => void
}

const B = SPORTS.basket
const F = SPORTS.futbol

const recvPhases: Phase[] = [
  { name: 'Escaneo previo', dur: '0,90 s', metric: '0 giros de cabeza', state: -1, note: 'No mira alrededor antes de recibir.' },
  { name: 'Perfilación', dur: '0,35 s', metric: 'Cadera 38°', state: -1, note: 'Recibe de espaldas al juego.' },
  { name: 'Control', dur: '0,10 s', metric: 'Pie interior', state: 1, note: 'Primer toque limpio.' },
  { name: 'Salida', dur: '0,45 s', metric: '1 toque', state: 0, note: 'Tarda en soltar el balón.' },
]

const SEED_CLIPS: Clip[] = [
  {
    id: 'seed-1', name: 'Tiro libre del #23', sport: 'basket', source: B.match, range: '00:12:17 – 00:12:46', dur: '00:29', sizeMb: 38, slow: true,
    sev: 'Crítico', who: '#23 M. Ortega', diag: 'Ángulo de codo en tiro libre inferior a 85°', meas: '82°', ideal: '85–95°',
    drill: ['Tiro a una mano frente a la pared', '3 × 15'], kpis: [['Ángulo salida', '47°'], ['Tiempo gesto', '1,16 s'], ['Resultado', 'Fallo']],
    phases: B.phases, events: ['Tiro libre'], layers: ['Tracking', 'Esqueleto', 'Vectores'],
  },
  {
    id: 'seed-2', name: 'Pérdida ante presión', sport: 'basket', source: B.match, range: '00:08:22 – 00:08:58', dur: '00:36', sizeMb: 47, slow: false,
    sev: 'Alerta', who: '#7 D. Rivera', diag: 'Recepción de espaldas a la presión', meas: '0 escaneos', ideal: '≥ 1',
    drill: ['Salida de presión 3 contra 2', '4 × 4 min'], kpis: [['Vel. máxima', '6,9 m/s'], ['Pases', '2'], ['Resultado', 'Pérdida']],
    phases: recvPhases, events: ['Pérdida'], layers: ['Tracking', 'Vectores'],
  },
  {
    id: 'seed-3', name: 'Triple en transición', sport: 'basket', source: B.match, range: '00:42:10 – 00:42:31', dur: '00:21', sizeMb: 28, slow: true,
    sev: 'Correcto', who: '#7 D. Rivera', diag: 'Mecánica de tiro estable en carrera', meas: '88°', ideal: '85–95°',
    drill: ['Mantener la rutina actual de tiro', '—'], kpis: [['Ángulo salida', '49°'], ['Tiempo gesto', '0,98 s'], ['Resultado', '+3']],
    phases: B.phases, events: ['Canasta'], layers: ['Tracking', 'Esqueleto', 'Vectores'],
  },
  {
    id: 'seed-4', name: 'Recepción de espaldas del #10', sport: 'futbol', source: F.match, range: '00:25:11 – 00:25:44', dur: '00:33', sizeMb: 44, slow: true,
    sev: 'Crítico', who: '#10 L. Vidal', diag: 'Perfilación corporal deficiente en recepción', meas: '38°', ideal: '60–90°',
    drill: ['Rondo 4 v 2 con recepción orientada', '4 × 3 min'], kpis: [['Perfil', '38°'], ['Toques', '3'], ['Resultado', 'Pérdida']],
    phases: recvPhases, events: ['Pérdida'], layers: ['Tracking', 'Esqueleto'],
  },
  {
    id: 'seed-5', name: 'Golpeo elevado del #10', sport: 'futbol', source: F.match, range: '00:48:50 – 00:49:12', dur: '00:22', sizeMb: 30, slow: true,
    sev: 'Alerta', who: '#10 L. Vidal', diag: 'Pie de apoyo retrasado en el golpeo', meas: '31 cm', ideal: '15–25 cm',
    drill: ['Golpeo estático con marca de apoyo', '3 × 10'], kpis: [['Vel. balón', '84 km/h'], ['Distancia', '21 m'], ['Resultado', 'Fuera']],
    phases: F.phases, events: ['Tiro'], layers: ['Tracking', 'Esqueleto', 'Vectores'],
  },
]

const SEED_HISTORY: HistoryItem[] = [
  { id: 'h-1', name: B.match, sport: 'basket', kind: 'Análisis de video', when: 'Hoy', dur: '00:48:10', findings: '1 crítico · 1 alerta' },
  { id: 'h-2', name: B.match, sport: 'basket', kind: 'Jugadas IA', when: 'Hoy', dur: '00:48:10', findings: '4 jugadas clave' },
  { id: 'h-3', name: F.match, sport: 'futbol', kind: 'Análisis de video', when: 'Hace 3 días', dur: '01:34:20', findings: '1 crítico · 1 alerta' },
  { id: 'h-4', name: 'Entrenamiento de tiros libres', sport: 'basket', kind: 'Análisis de video', when: 'Hace 5 días', dur: '00:12:45', findings: '2 alertas' },
  { id: 'h-5', name: 'Partido de ejemplo · Jornada 8', sport: 'futbol', kind: 'Jugadas IA', when: 'Hace 10 días', dur: '01:31:02', findings: '5 jugadas clave' },
]

function usePersisted<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* almacenamiento no disponible: se mantiene solo en memoria */
    }
  }, [key, value])
  return [value, setValue] as const
}

const Ctx = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [sport, setSportState] = usePersisted<SportId>('kora.sport', 'basket')
  const [video, setVideoState] = useState<VideoSource | null>(null)
  const [videoAnalysis, setVideoAnalysisState] = useState<VideoAnalysis | null>(null)
  const [restoring, setRestoring] = useState(true)
  const current = useRef<VideoSource | null>(null)

  const [scan, setScan] = useState<ScanProgress | null>(null)
  const [scanError, setScanError] = useState('')
  const scanCtrl = useRef<AbortController | null>(null)
  const cancelScan = useCallback(() => scanCtrl.current?.abort(), [])

  const replaceVideo = useCallback((v: VideoSource | null) => {
    scanCtrl.current?.abort()
    setScanError('')
    const old = current.current
    if (old?.url.startsWith('blob:') && old.url !== v?.url) URL.revokeObjectURL(old.url)
    current.current = v
    setVideoState(v)
    setVideoAnalysisState(null)
  }, [])

  const setVideo = useCallback(
    (v: VideoSource | null) => {
      replaceVideo(v)
      // Un enlace no se guarda como archivo; quitar el video borra también lo guardado.
      void clearStoredVideo()
    },
    [replaceVideo],
  )

  const loadVideoFile = useCallback(
    (file: File) => {
      const key = `${file.name}:${file.size}:${file.lastModified}`
      replaceVideo({ url: URL.createObjectURL(file), name: file.name, playable: true, key })
      void clearAnalysis()
      void putVideo({ blob: file, name: file.name, key })
    },
    [replaceVideo],
  )

  const setVideoAnalysis = useCallback((a: VideoAnalysis | null) => {
    setVideoAnalysisState(a)
    const key = current.current?.key
    if (a && key) void putAnalysis({ version: ANALYSIS_VERSION, videoKey: key, analysis: a })
    else void clearAnalysis()
  }, [])

  const sportRef = useRef(sport)
  sportRef.current = sport
  const analysisRef = useRef(videoAnalysis)
  analysisRef.current = videoAnalysis

  const labelPerson = useCallback(
    (id: number, name: string, number: string) => {
      const a = analysisRef.current
      if (!a) return
      const label = cleanLabel(name, number)
      setVideoAnalysis({ ...a, people: a.people.map((p) => (p.id === id ? { ...p, ...label } : p)) })
    },
    [setVideoAnalysis],
  )

  const analyzePerson = useCallback(
    (id: number) => {
      const v = current.current
      const a = analysisRef.current
      if (!v?.playable || !a || scanCtrl.current) return
      const ctrl = new AbortController()
      scanCtrl.current = ctrl
      setScanError('')
      setScan({ stage: 'tecnica', done: 0, total: 0 })
      runCoachFor(v.url, a, [id], { onProgress: setScan, signal: ctrl.signal })
        .then((next) => {
          if (current.current !== v || ctrl.signal.aborted) return
          // Los nombres puestos mientras se medía no se pierden: mandan las fichas actuales.
          const now = analysisRef.current
          setVideoAnalysis(now ? { ...next, people: now.people } : next)
        })
        .catch((e: unknown) => {
          if ((e as Error).name !== 'AbortError') setScanError('No se pudo medir la técnica de esa persona.')
        })
        .finally(() => {
          if (scanCtrl.current === ctrl) scanCtrl.current = null
          setScan(null)
        })
    },
    [setVideoAnalysis],
  )

  const startScan = useCallback(
    (opts: { startSec: number; ball: boolean }) => {
      const v = current.current
      if (!v?.playable || scanCtrl.current) return
      const ctrl = new AbortController()
      scanCtrl.current = ctrl
      setScanError('')
      setScan({ stage: 'video', done: 0, total: 0 })
      runVideoAnalysis(v.url, sportRef.current, { ...opts, onProgress: setScan, signal: ctrl.signal })
        .then((a) => {
          if (current.current === v && !ctrl.signal.aborted) setVideoAnalysis(a)
        })
        .catch((e: unknown) => {
          if ((e as Error).name !== 'AbortError') setScanError(e instanceof VisionError ? e.message : 'No se pudo analizar el video.')
        })
        .finally(() => {
          if (scanCtrl.current === ctrl) scanCtrl.current = null
          setScan(null)
        })
    },
    [setVideoAnalysis],
  )

  // Los eventos y el Coach dependen del deporte: al cambiarlo, el análisis anterior deja de valer.
  const setSport = useCallback(
    (s: SportId) => {
      if (s === sportRef.current) return
      scanCtrl.current?.abort()
      setSportState(s)
      setVideoAnalysis(null)
    },
    [setSportState, setVideoAnalysis],
  )

  // Al abrir la app se recupera el último video y, si sigue siendo válido, su análisis.
  useEffect(() => {
    let alive = true
    void (async () => {
      const stored = await getVideo()
      if (!alive) return
      if (stored && !current.current) {
        const v: VideoSource = { url: URL.createObjectURL(stored.blob), name: stored.name, playable: true, key: stored.key }
        current.current = v
        setVideoState(v)
        const saved = await getAnalysis()
        const analysis = saved?.analysis as VideoAnalysis | undefined
        if (alive && current.current === v && saved?.videoKey === stored.key && saved.version === ANALYSIS_VERSION && analysis?.sport === sportRef.current) {
          setVideoAnalysisState(analysis)
        }
      }
      if (alive) setRestoring(false)
    })()
    return () => {
      alive = false
    }
  }, [])
  const [cams, setCams] = useState(1)
  const [clips, setClips] = usePersisted<Clip[]>('kora.clips.v1', SEED_CLIPS)
  const [history, setHistory] = usePersisted<HistoryItem[]>('kora.history.v1', SEED_HISTORY)

  const addClip = useCallback((c: Clip) => setClips((prev) => [c, ...prev]), [setClips])
  const removeClip = useCallback((id: string) => setClips((prev) => prev.filter((c) => c.id !== id)), [setClips])
  const addHistory = useCallback((h: HistoryItem) => setHistory((prev) => [h, ...prev]), [setHistory])

  const value = useMemo<Store>(
    () => ({ sport, data: SPORTS[sport], setSport, video, restoring, setVideo, loadVideoFile, videoAnalysis, setVideoAnalysis, scan, scanError, startScan, cancelScan, labelPerson, analyzePerson, cams, setCams, clips, addClip, removeClip, history, addHistory }),
    [sport, setSport, video, restoring, setVideo, loadVideoFile, videoAnalysis, setVideoAnalysis, scan, scanError, startScan, cancelScan, labelPerson, analyzePerson, cams, clips, addClip, removeClip, history, addHistory],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore debe usarse dentro de <StoreProvider>')
  return s
}
