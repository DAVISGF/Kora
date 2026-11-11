import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, MonitorPlay, Plus, Upload } from 'lucide-react'
import { btnDashed, btnGhost, btnPrimary, card, input, SampleBadge, Segmented } from '../components/ui'
import { SPORT_LIST } from '../data/sports'
import { useStore } from '../lib/store'
import { cx } from '../lib/util'

type Source = 'file' | 'url'

const STEPS = ['Subida', 'Normalización', 'Detección', 'Tracking', 'Biomecánica']
const ANGLES = [
  { cam: 'CAM 02', pos: 'Fondo, detrás de la portería o el aro' },
  { cam: 'CAM 03', pos: 'Elevada o cenital' },
]

const SPORT_DESC = {
  basket: 'Mecánica de tiro, pérdidas, canastas y sprints sobre media cancha o cancha completa.',
  futbol: 'Perfilación en recepción, pases, tiros, goles y desmarques sobre el campo completo.',
}

/** Reconoce el tipo de enlace. Solo los archivos directos se pueden reproducir sin backend. */
function detectUrl(raw: string): { ok: boolean; kind: string; playable: boolean } {
  const url = raw.trim()
  if (!/^(https?|rtmps?):\/\/\S+\.\S+/i.test(url)) return { ok: false, kind: 'El enlace no es válido', playable: false }
  if (/youtu\.?be/i.test(url)) return { ok: true, kind: 'YouTube', playable: false }
  if (/vimeo\.com/i.test(url)) return { ok: true, kind: 'Vimeo', playable: false }
  if (/\.m3u8(\?|$)/i.test(url)) return { ok: true, kind: 'Stream HLS', playable: false }
  if (/^rtmps?:/i.test(url)) return { ok: true, kind: 'Stream RTMP', playable: false }
  if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) return { ok: true, kind: 'Archivo de video directo', playable: true }
  return { ok: true, kind: 'Enlace genérico', playable: false }
}

const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1).replace('.', ',')} MB`

function StepTitle({ n, children }: { n: string; children: string }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span className="font-mono text-[13px] text-mute">{n}</span>
      <h2 className="m-0 text-xl font-semibold">{children}</h2>
    </div>
  )
}

export default function Ingest() {
  const { sport, setSport, data, video, setVideo, setCams } = useStore()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [source, setSource] = useState<Source>('file')
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [url, setUrl] = useState('')
  const [urlInfo, setUrlInfo] = useState<ReturnType<typeof detectUrl> | null>(null)
  const [demo, setDemo] = useState<number | null>(null)
  const [angleSlots, setAngleSlots] = useState(1)
  const [angleFiles, setAngleFiles] = useState<(string | null)[]>([null, null])
  const [step, setStep] = useState<number | null>(null)

  const takeFile = (f: File | undefined) => {
    if (!f) return
    if (!f.type.startsWith('video/')) return
    if (video?.url.startsWith('blob:')) URL.revokeObjectURL(video.url)
    setFile(f)
    setDemo(null)
    setVideo({ url: URL.createObjectURL(f), name: f.name, playable: true })
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    takeFile(e.dataTransfer.files[0])
  }

  const validateUrl = () => {
    const info = detectUrl(url)
    setUrlInfo(info)
    if (info.ok) {
      setDemo(null)
      setFile(null)
      setVideo({ url: url.trim(), name: url.trim(), playable: info.playable })
    }
  }

  const pickDemo = (i: number) => {
    setDemo(demo === i ? null : i)
    setFile(null)
    setVideo(null)
  }

  const hasSource = !!file || demo !== null || !!urlInfo?.ok
  const running = step !== null

  // Simula el pipeline de procesamiento y abre el visor al terminar.
  useEffect(() => {
    if (step === null) return
    if (step >= STEPS.length) {
      navigate('/analisis')
      return
    }
    const id = setTimeout(() => setStep(step + 1), 650)
    return () => clearTimeout(id)
  }, [step, navigate])

  const start = () => {
    setCams(1 + angleFiles.filter(Boolean).length)
    setStep(0)
  }

  const progress = step === null ? 0 : Math.round((Math.min(step, STEPS.length) / STEPS.length) * 100)
  const sourceName = file?.name ?? (demo !== null ? data.demos[demo][0] : urlInfo?.ok ? url.trim() : '')

  return (
    <main className="mx-auto flex max-w-[920px] flex-col gap-7 px-5 pt-8 pb-10">
      <section className="flex flex-col gap-3">
        <StepTitle n="01">Elige el deporte</StepTitle>
        <div role="group" aria-label="Deporte" className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
          {SPORT_LIST.map((s) => {
            const on = s.id === sport
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setSport(s.id)
                  setDemo(null)
                }}
                className="flex flex-col gap-1.5 rounded-xl border-2 bg-card p-4 text-left text-ink"
                style={{ borderColor: on ? s.accent : '#20272F' }}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[17px] font-semibold">{s.label}</span>
                  <span
                    className="rounded px-2 py-0.5 font-mono text-xs font-bold"
                    style={on ? { background: s.accent, color: '#090D10' } : { background: '#1C222A', color: '#8A95A0' }}
                  >
                    {on ? 'ACTIVO' : 'ELEGIR'}
                  </span>
                </span>
                <span className="text-[13px] text-mute">{SPORT_DESC[s.id]}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <StepTitle n="02">Carga el video</StepTitle>
        <div className={`${card} flex flex-col gap-4 p-4`}>
          <Segmented
            label="Origen del video"
            className="max-w-[360px]"
            value={source}
            onChange={setSource}
            options={[
              { id: 'file', label: 'Subir video' },
              { id: 'url', label: 'URL externa' },
            ]}
          />

          {source === 'file' ? (
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cx(
                'flex flex-col items-center gap-3 rounded-xl border-2 border-dashed bg-inset px-5 py-9 text-center',
                dragging ? 'border-lime' : 'border-line-strong',
              )}
            >
              <Upload size={36} strokeWidth={1.8} aria-hidden="true" />
              <div className="text-base font-semibold">{file ? file.name : 'Arrastra tu video aquí'}</div>
              <div className="text-[13px] text-mute">
                {file ? `${mb(file.size)} · listo para analizar` : 'MP4, MOV, MKV o WebM · de 480p a 4K · cualquier relación de aspecto'}
              </div>
              <input ref={fileRef} type="file" accept="video/*" className="sr-only" aria-label="Archivo de video" onChange={(e) => takeFile(e.target.files?.[0])} />
              <button type="button" className={btnPrimary} onClick={() => fileRef.current?.click()}>
                {file ? 'Cambiar archivo' : 'Seleccionar archivo'}
              </button>
              <div className="text-xs text-mute">El video se reproduce en tu navegador; no se sube a ningún servidor.</div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <label htmlFor="video-url" className="text-[13px] text-mute">
                Enlace del video o del stream
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  id="video-url"
                  type="url"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value)
                    setUrlInfo(null)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && validateUrl()}
                  placeholder="https://youtube.com/watch?v=…"
                  className={`${input} flex-[1_1_280px] font-mono`}
                />
                <button type="button" className={btnPrimary} onClick={validateUrl} disabled={!url.trim()}>
                  Validar enlace
                </button>
              </div>
              {urlInfo && (
                <p role="status" className={cx('m-0 text-[13px]', urlInfo.ok ? 'text-ok' : 'text-danger')}>
                  {urlInfo.ok
                    ? `${urlInfo.kind} reconocido. ${urlInfo.playable ? 'Se reproducirá en el visor.' : 'Para reproducirlo hace falta el servicio de ingesta; el visor usará el fotograma de ejemplo.'}`
                    : `${urlInfo.kind}. Usa una dirección que empiece por https://`}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 text-xs text-mute">
                <span>Fuentes admitidas</span>
                {['YouTube', 'Vimeo', 'HLS .m3u8', 'RTMP', 'MP4 directo'].map((s) => (
                  <span key={s} className="rounded border border-line px-2 py-0.5 font-mono text-ink">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2.5 border-t border-line pt-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-semibold">Otros ángulos de cámara (opcional)</span>
                <span className="text-[13px] text-mute">
                  Sube el mismo partido grabado desde otras posiciones. Con un solo ángulo la vista 3D se estima; con más, gana precisión.
                </span>
              </div>
              {angleSlots < ANGLES.length && (
                <button type="button" className={btnDashed} onClick={() => setAngleSlots(angleSlots + 1)}>
                  <Plus size={16} strokeWidth={2.4} aria-hidden="true" />
                  Añadir ángulo
                </button>
              )}
            </div>
            <AngleRow cam="CAM 01" pos="Principal · lateral" status={sourceName || 'Pendiente de video'} done={hasSource} />
            {ANGLES.slice(0, angleSlots).map((a, i) => (
              <AngleRow
                key={a.cam}
                cam={a.cam}
                pos={a.pos}
                status={angleFiles[i] ?? 'Pendiente de archivo'}
                done={!!angleFiles[i]}
                onFile={(name) => setAngleFiles(angleFiles.map((f, j) => (j === i ? name : f)))}
              />
            ))}
          </div>

          <div className="flex flex-col gap-2.5 border-t border-line pt-3.5">
            <span className="text-[13px] text-mute">¿Sin video a mano? Prueba con una demostración</span>
            <div role="group" aria-label="Videos de demostración" className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-2">
              {data.demos.map(([name, meta], i) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={demo === i}
                  onClick={() => pickDemo(i)}
                  className={cx('flex min-h-14 items-center gap-3 rounded-lg border bg-inset px-3 py-2.5 text-left text-ink', demo === i ? 'border-accent' : 'border-line')}
                >
                  <MonitorPlay size={20} aria-hidden="true" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-semibold">{name}</span>
                    <span className="font-mono text-xs text-mute">{meta}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <StepTitle n="03">Procesamiento</StepTitle>
          <SampleBadge>Simulado</SampleBadge>
        </div>
        <div className={`${card} flex flex-col gap-4 p-4`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-mono">{sourceName || 'Elige un video o una demostración'}</span>
              <span className="text-xs text-mute">Cada video se normaliza a 1080p y 30 fps antes del análisis.</span>
            </div>
            <span className="font-mono font-bold">{progress} %</span>
          </div>
          <div role="progressbar" aria-label="Progreso del procesamiento" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} className="h-1.5 rounded-[3px] bg-raised">
            <div className="h-1.5 rounded-[3px] bg-lime transition-[width] duration-500" style={{ width: `${progress}%` }} />
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
            {STEPS.map((s, i) => {
              const state = step === null ? 'idle' : i < step ? 'done' : i === step ? 'run' : 'idle'
              return (
                <div key={s} className={cx('flex flex-col gap-1 rounded-lg border bg-inset px-3 py-2.5', state === 'run' ? 'border-lime' : 'border-line')}>
                  <span className={cx('text-[13px] font-semibold', state === 'idle' && 'text-mute')}>{s}</span>
                  <span className={cx('font-mono text-xs', state === 'done' ? 'text-ok' : state === 'run' ? 'text-lime' : 'text-mute')}>
                    {state === 'done' ? 'Listo' : state === 'run' ? 'En curso' : 'En cola'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <div className="flex flex-wrap justify-end gap-3">
        <button type="button" className={btnGhost} onClick={() => navigate('/analisis')}>
          Ir al visor sin procesar
        </button>
        <button type="button" className={`${btnPrimary} h-12 px-5 text-[15px]`} disabled={!hasSource || running} onClick={start}>
          {running ? 'Analizando…' : 'Analizar'}
          <ArrowRight size={16} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>
    </main>
  )
}

function AngleRow({ cam, pos, status, done, onFile }: { cam: string; pos: string; status: string; done: boolean; onFile?: (name: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-inset px-3 py-2.5">
      <span className="font-mono text-[13px] font-bold text-lime">{cam}</span>
      <span className="min-w-0 flex-[1_1_160px]">{pos}</span>
      <span className={cx('min-w-0 truncate text-xs', done ? 'text-ok' : 'text-mute')}>{status}</span>
      {onFile && (
        <>
          <input ref={ref} type="file" accept="video/*" className="sr-only" aria-label={`Video de ${cam}`} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0].name)} />
          <button type="button" className={`${btnGhost} text-[13px]`} onClick={() => ref.current?.click()}>
            {done ? 'Cambiar' : 'Seleccionar archivo'}
          </button>
        </>
      )}
    </div>
  )
}
