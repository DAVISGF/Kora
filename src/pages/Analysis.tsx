import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Download, Gauge, Pause, Play, Plus, ScanSearch, Scissors, Share2, SkipBack, SkipForward } from 'lucide-react'
import { Biomech, Compare, Heatmap, ImageHeatmap, KpiGrid, PerfBars } from '../components/Charts'
import { DiagSummary } from '../components/Diag'
import type { LayerState } from '../components/Scene'
import Viewer, { CAMERAS, type Orbit, type ViewId } from '../components/Viewer'
import { btnGhost, btnPrimary, card, input, Segmented } from '../components/ui'
import { EVENT_COLOR, trendColor, type EvCode, type GameEvent, type SportData } from '../data/sports'
import { analysisReportMd, eventsCsv } from '../lib/report'
import { useStore, type Clip } from '../lib/store'
import { usePlayback } from '../lib/usePlayback'
import { useVision, type VisionStatus } from '../lib/useVision'
import { jointAngles, mainPerson, VisionError, type FrameAnalysis } from '../lib/vision'
import { frameAt, MAX_FRAMES, runVideoAnalysis, SAMPLE_STEP, toGameEvents } from '../lib/videoAnalysis'
import { comma, copyText, cx, downloadText, fmtShort, fmtTime, slug } from '../lib/util'

const LAYERS: { id: keyof LayerState; label: string; color: string }[] = [
  { id: 'track', label: 'Tracking', color: '#CBF62E' },
  { id: 'skel', label: 'Esqueleto', color: '#30C0F8' },
  { id: 'vec', label: 'Vectores', color: '#FFC237' },
  { id: 'zone', label: 'Zonas', color: '#A78BFA' },
]

const DEFAULT_ORBIT: Orbit = { yaw: -18, tilt: 58, zoom: 1 }
type Tab = 'stats' | 'bio' | 'coach'
type Panel = 'share' | 'download' | null

const pill = 'inline-flex h-11 items-center gap-2 rounded-lg border bg-raised px-3 text-[13px] font-semibold text-ink'
const square = 'inline-flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-raised text-ink'

export default function Analysis() {
  const { sport } = useStore()
  // Al cambiar de deporte se reinicia el visor completo.
  return <AnalysisView key={sport} />
}

function AnalysisView() {
  const { data, sport, video, cams, setCams, addClip, videoAnalysis, setVideoAnalysis } = useStore()
  const hasVideo = !!video?.playable
  const [params] = useSearchParams()
  const startSecs = Number(params.get('t'))
  const [meta, setMeta] = useState<{ secs: number; width: number; height: number } | null>(null)
  const secs = meta?.secs || data.secs
  // Con un video real, la línea de tiempo y los KPIs solo muestran lo medido en él.
  const events: GameEvent[] = useMemo(
    () => (hasVideo ? (videoAnalysis ? toGameEvents(videoAnalysis, secs) : []) : data.events),
    [hasVideo, videoAnalysis, secs, data.events],
  )
  const legend: [EvCode, string][] = hasVideo ? (videoAnalysis?.legend ?? []) : data.legend
  const anchor = hasVideo ? 0 : data.events[2].pct

  const pb = usePlayback(startSecs > 0 ? Math.min(100, (startSecs / data.secs) * 100) : anchor)
  const { pos, playing, speed, seek } = pb
  const time = (pct: number) => fmtTime((secs * pct) / 100)

  const [layers, setLayers] = useState<LayerState>({ track: true, skel: true, vec: true, zone: false })
  const [view, setView] = useState<ViewId>('c0')
  const [orbit, setOrbit] = useState<Orbit>(DEFAULT_ORBIT)
  const [tab, setTab] = useState<Tab>('stats')
  const [panel, setPanel] = useState<Panel>(null)
  const [slow, setSlow] = useState(false)
  const [phase, setPhase] = useState(2)
  const [clipOn, setClipOn] = useState(false)
  const [range, setRange] = useState<[number, number]>(hasVideo ? [0, 10] : [Math.max(0, anchor - 0.5), Math.min(100, anchor + 0.5)])
  const [clipName, setClipName] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!video?.playable) setMeta(null)
  }, [video])

  const vision = useVision(pb.videoRef, hasVideo, pos)

  // Análisis del video completo: KPIs y eventos reales.
  const [scan, setScan] = useState<{ done: number; total: number } | null>(null)
  const [scanError, setScanError] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => () => abortRef.current?.abort(), [])

  const runScan = async () => {
    if (!video?.playable) return
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setScanError('')
    setScan({ done: 0, total: 0 })
    try {
      const startSec = secs > MAX_FRAMES * SAMPLE_STEP ? (secs * pos) / 100 : 0
      setVideoAnalysis(await runVideoAnalysis(video.url, sport, { startSec, ball: vision.ball, onProgress: setScan, signal: ctrl.signal }))
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setScanError(e instanceof VisionError ? e.message : 'No se pudo analizar el video.')
    } finally {
      setScan(null)
    }
  }

  // Fuera del análisis en vivo, el visor reproduce las detecciones guardadas del video.
  const stored = videoAnalysis ? frameAt(videoAnalysis, (secs * pos) / 100) : null
  const shownAnalysis: FrameAnalysis | null = vision.analysis ?? (stored ? { persons: stored.persons, ball: stored.ball, ms: 0, model: '' } : null)
  const windowSecs = MAX_FRAMES * SAMPLE_STEP

  const evIdx = useMemo(() => {
    let idx = -1
    events.forEach((e, i) => {
      if (e.pct <= pos + 0.01) idx = i
    })
    return idx
  }, [events, pos])
  const current = evIdx >= 0 ? events[evIdx] : null
  const jump = (i: number) => seek(events[Math.max(0, Math.min(events.length - 1, i))].pct)

  const activeLayers = LAYERS.filter((l) => layers[l.id]).map((l) => l.label)
  const inRange = events.filter((e) => e.pct >= range[0] && e.pct <= range[1])
  const diagsIn = hasVideo ? [] : data.diags.filter((d) => inRange.includes(data.events[d.ev]))
  const clipSecs = (secs * (range[1] - range[0])) / 100
  const framePct = 100 / (secs * 30)

  const toggleSlow = () => {
    pb.setSpeed(slow ? 1 : 0.25)
    setSlow(!slow)
  }

  const saveClip = () => {
    const d = diagsIn[0]
    const clip: Clip = {
      id: `clip-${Date.now()}`,
      name: clipName.trim() || `Recorte ${time(range[0])}`,
      sport,
      source: video?.name ?? data.match,
      range: `${time(range[0])} – ${time(range[1])}`,
      dur: fmtShort(clipSecs),
      sizeMb: Math.max(1, Math.round(clipSecs * 1.3)),
      slow,
      sev: d?.sev ?? 'Correcto',
      who: d?.who ?? 'Sin jugador destacado',
      diag: d?.title ?? 'Sin hallazgos en el tramo',
      meas: d?.meas ?? '—',
      ideal: d?.ideal ?? '—',
      drill: d?.drills[0] ?? ['Sin ejercicio asignado', '—'],
      kpis: [
        ['Duración', fmtShort(clipSecs)],
        ['Eventos', String(inRange.length)],
        ['Capas', String(activeLayers.length)],
      ],
      phases: data.phases,
      events: inRange.map((e) => e.type),
      layers: activeLayers,
    }
    addClip(clip)
    setSaved(true)
  }

  const availableViews = [
    ...CAMERAS.slice(0, cams).map((c) => ({ id: c.id, label: `${c.name} · ${c.pos}` })),
    { id: '3d' as ViewId, label: 'Vista 3D' },
  ]
  const shownView = availableViews.some((v) => v.id === view) ? view : 'c0'

  return (
    <div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-b border-line bg-inset px-5 py-2.5">
        <button
          type="button"
          aria-expanded={panel === 'share'}
          onClick={() => setPanel(panel === 'share' ? null : 'share')}
          className={cx(btnGhost, panel === 'share' && 'border-ink')}
        >
          <Share2 size={16} aria-hidden="true" />
          Compartir
        </button>
        <button
          type="button"
          aria-expanded={panel === 'download'}
          onClick={() => setPanel(panel === 'download' ? null : 'download')}
          className={cx(btnGhost, panel === 'download' && 'border-ink')}
        >
          <Download size={16} aria-hidden="true" />
          Descargar
        </button>
      </div>
      {panel === 'share' && <SharePanel url={`${location.origin}/analisis?t=${Math.round((secs * pos) / 100)}`} />}
      {panel === 'download' && (
        <DownloadPanel data={hasVideo ? { ...data, match: video?.name ?? data.match, events, kpis: videoAnalysis?.kpis ?? [], diags: [] } : data} secs={secs} />
      )}

      <div className="flex flex-wrap">
        <main className="flex min-w-0 flex-[999_1_600px] flex-col gap-4 p-5">
          <section aria-label="Visor de video" className={`${card} overflow-hidden`}>
            <Viewer
              data={data}
              layers={layers}
              tick={pb.tick}
              view={shownView}
              orbit={orbit}
              cams={cams}
              timecode={time(pos)}
              video={video}
              videoRef={pb.videoRef}
              onMeta={setMeta}
              real={shownAnalysis}
              videoSize={meta}
              visionStatus={scan ? `ANALIZANDO VIDEO · ${scan.done}/${scan.total || '…'}` : !vision.analysis && stored ? `IA REAL · ${stored.persons.length} personas · guardado` : visionLabel(vision.status, vision.analysis)}
            />

            <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
              <span className="mr-1 text-[13px] text-mute">Vista</span>
              {availableViews.map((v) => {
                const on = v.id === shownView
                return (
                  <button
                    key={v.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setView(v.id)}
                    className={cx('h-11 rounded-lg border px-3 font-mono text-xs font-bold', on ? 'border-lime bg-raised text-lime' : 'border-line text-ink')}
                  >
                    {v.label}
                  </button>
                )
              })}
              {cams < CAMERAS.length && (
                <button type="button" onClick={() => setCams(cams + 1)} className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-dashed border-line-strong px-3 text-[13px] font-semibold">
                  <Plus size={14} strokeWidth={2.4} aria-hidden="true" />
                  Añadir ángulo
                </button>
              )}
              <span className="min-w-0 flex-[1_1_200px] text-right text-xs text-mute">
                {cams === 1
                  ? 'Con 1 cámara la vista 3D es una estimación; más ángulos la afinan.'
                  : `${cams} ángulos sincronizados · la vista 3D gana precisión.`}
              </span>
            </div>

            {shownView === '3d' && <OrbitControls orbit={orbit} onChange={setOrbit} />}

            <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
              <span className="mr-1 text-[13px] text-mute">Capas</span>
              {LAYERS.map((l) => {
                const on = layers[l.id]
                return (
                  <button
                    key={l.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setLayers({ ...layers, [l.id]: !on })}
                    className={cx('inline-flex h-11 items-center gap-2 rounded-full border px-3 text-[13px] font-semibold', on ? 'bg-raised text-ink' : 'border-line text-mute')}
                    style={on ? { borderColor: l.color } : undefined}
                  >
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: on ? l.color : '#5B6677' }} />
                    {l.label}
                  </button>
                )
              })}
            </div>

            {hasVideo && (
              <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
                <span className="mr-1 text-[13px] text-mute">IA real</span>
                <button type="button" onClick={() => void vision.analyze()} disabled={vision.status === 'loading'} className={cx(pill, 'border-lime text-lime')}>
                  <ScanSearch size={16} aria-hidden="true" />
                  {vision.status === 'loading' ? 'Analizando…' : 'Analizar fotograma'}
                </button>
                {scan ? (
                  <button type="button" onClick={() => abortRef.current?.abort()} className={cx(pill, 'border-danger text-danger')}>
                    Cancelar ({scan.done}/{scan.total || '…'})
                  </button>
                ) : (
                  <button type="button" onClick={() => void runScan()} className="inline-flex h-11 items-center gap-2 rounded-lg bg-lime px-3 text-[13px] font-semibold text-lime-ink">
                    {videoAnalysis ? 'Volver a analizar el video' : 'Analizar video'}
                  </button>
                )}
                <button type="button" aria-pressed={vision.live} onClick={() => vision.setLive(!vision.live)} className={cx(pill, vision.live ? 'border-ink' : 'border-line')}>
                  Análisis continuo
                </button>
                <button type="button" aria-pressed={vision.ball} onClick={() => vision.setBall(!vision.ball)} className={cx(pill, vision.ball ? 'border-ink' : 'border-line')}>
                  Detectar balón
                </button>
                {vision.live && (
                  <Segmented
                    label="Motor del análisis continuo"
                    value={vision.engine}
                    onChange={vision.setEngine}
                    options={[
                      { id: 'local', label: 'En el navegador' },
                      { id: 'cloud', label: 'Roboflow' },
                    ]}
                  />
                )}
                <span className="min-w-0 flex-[1_1_220px] text-right text-xs text-mute">
                  {!vision.live
                    ? 'Cada análisis envía el fotograma actual al servicio de visión.'
                    : vision.engine === 'local'
                      ? 'Corre en tu equipo: no envía fotogramas ni gasta créditos. Hasta 6 personas, sin balón.'
                      : 'Envía un fotograma cada 0,8 s al servicio de visión.'}
                </span>
                {scanError && (
                  <p role="alert" className="m-0 w-full text-[13px] text-danger">
                    {scanError}
                  </p>
                )}
                {vision.message && (
                  <p role="alert" className="m-0 w-full text-[13px] text-danger">
                    {vision.message}
                    {vision.status === 'not_configured' && ' Añádela en el proyecto de Vercel y vuelve a desplegar.'}
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
              <button type="button" aria-label="Evento anterior" onClick={() => jump(evIdx - 1)} className={square}>
                <SkipBack size={18} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={playing ? 'Pausar' : 'Reproducir'}
                onClick={pb.toggle}
                className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-lime text-lime-ink"
              >
                {playing ? <Pause size={18} fill="currentColor" aria-hidden="true" /> : <Play size={18} fill="currentColor" aria-hidden="true" />}
              </button>
              <button type="button" aria-label="Evento siguiente" onClick={() => jump(evIdx + 1)} className={square}>
                <SkipForward size={18} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Cambiar velocidad de reproducción"
                onClick={pb.cycleSpeed}
                className="h-11 min-w-[60px] rounded-lg border border-line bg-raised px-3 font-mono text-[13px]"
              >
                {String(speed).replace('.', ',')}x
              </button>
              <button type="button" aria-pressed={slow} onClick={toggleSlow} className={cx(pill, slow ? 'border-ink' : 'border-line')}>
                <Gauge size={16} aria-hidden="true" />
                Cámara lenta
              </button>
              <button
                type="button"
                aria-pressed={clipOn}
                onClick={() => {
                  setClipOn(!clipOn)
                  setSaved(false)
                }}
                className={cx(pill, clipOn ? 'border-ink' : 'border-line')}
              >
                <Scissors size={16} aria-hidden="true" />
                Recortar
              </button>
              <div className="ml-2 font-mono text-[15px]">
                <span className="font-bold">{time(pos)}</span>
                <span className="text-mute"> / {time(100)}</span>
              </div>
              <div className="min-w-0 flex-[1_1_200px] text-right text-[13px] text-mute">
                {hasVideo ? (
                  current ? (
                    <>
                      Evento: <span className="font-semibold text-ink">{`${current.type} · ${current.desc}`}</span>
                    </>
                  ) : videoAnalysis ? (
                    'Sin eventos antes de este punto.'
                  ) : (
                    'Pulsa Analizar video para detectar eventos y calcular KPIs.'
                  )
                ) : (
                  <>
                    Evento: <span className="font-semibold text-ink">{current ? `${current.type} · ${current.desc}` : 'Sin evento'}</span>
                  </>
                )}
              </div>
            </div>

            {slow && (
              <div aria-label="Análisis en cámara lenta" className="mx-4 mb-3 flex flex-col gap-3 rounded-[10px] border border-line-strong bg-inset p-3.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="font-semibold">Análisis en cámara lenta · {data.slowTitle}</span>
                  <span className="font-mono text-xs text-mute">
                    Fotograma {Math.round(((secs * pos) / 100) * 30).toLocaleString('es-ES')} · origen 30 fps
                  </span>
                  <div className="grow" />
                  <button type="button" onClick={() => seek(pos - framePct)} className="h-11 rounded-lg border border-line bg-raised px-3 font-mono text-[13px]">
                    −1 fotograma
                  </button>
                  <button type="button" onClick={() => seek(pos + framePct)} className="h-11 rounded-lg border border-line bg-raised px-3 font-mono text-[13px]">
                    +1 fotograma
                  </button>
                </div>
                <div role="group" aria-label="Fases del gesto" className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
                  {data.phases.map((f, i) => (
                    <button
                      key={f.name}
                      type="button"
                      aria-pressed={i === phase}
                      onClick={() => setPhase(i)}
                      className={cx('flex flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-left', i === phase ? 'border-ink bg-raised' : 'border-line bg-card')}
                    >
                      <span className="text-xs text-mute">
                        Fase {i + 1} · {f.dur}
                      </span>
                      <span className="font-semibold">{f.name}</span>
                      <span className="font-mono text-[13px]" style={{ color: trendColor(f.state) }}>
                        {f.metric}
                      </span>
                    </button>
                  ))}
                </div>
                <span className="text-[13px] text-mute">
                  {data.phases[phase].name}: {data.phases[phase].note}
                </span>
              </div>
            )}

            {clipOn && (
              <div aria-label="Recortar video" className="mx-4 mb-3 flex flex-col gap-3 rounded-[10px] border border-line-strong bg-inset p-3.5">
                <div className="flex flex-wrap items-end gap-3">
                  <RangeEnd label="Inicio" value={time(range[0])} onMark={() => { setRange([Math.min(pos, range[1] - 0.05), range[1]]); setSaved(false) }} />
                  <RangeEnd label="Fin" value={time(range[1])} onMark={() => { setRange([range[0], Math.max(pos, range[0] + 0.05)]); setSaved(false) }} />
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-mute">Duración</span>
                    <span className="flex h-11 items-center font-mono text-[15px] font-bold">{fmtShort(clipSecs)}</span>
                  </div>
                  <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-1">
                    <label htmlFor="clip-name" className="text-xs text-mute">
                      Nombre del recorte
                    </label>
                    <input id="clip-name" value={clipName} onChange={(e) => setClipName(e.target.value)} placeholder="Ej.: Tiro libre del #23" className={input} />
                  </div>
                  <button type="button" onClick={saveClip} disabled={saved} className={btnPrimary}>
                    {saved ? 'Guardado' : 'Guardar recorte'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-mute">
                  <span>
                    El recorte incluye su análisis:{' '}
                    <b className="text-ink">
                      {inRange.length ? `${inRange.length} ${inRange.length === 1 ? 'evento' : 'eventos'} (${inRange.map((e) => e.type).join(', ')})` : 'sin eventos en el tramo'}
                    </b>
                  </span>
                  <span>
                    Diagnósticos del AI Coach: <b className="text-ink">{diagsIn.length}</b>
                  </span>
                  <span>
                    Capas activas: <b className="text-ink">{activeLayers.join(', ') || 'ninguna'}</b>
                  </span>
                </div>
                {saved && (
                  <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-ok px-3 py-2">
                    <span className="font-semibold text-ok">Recorte guardado con su análisis</span>
                    <Link to="/recortes" className="flex min-h-11 items-center font-semibold text-ink">
                      Ver en Recortes y exportar
                    </Link>
                  </div>
                )}
              </div>
            )}

            <Timeline sport={data.id} events={events} legend={legend} pos={pos} evIdx={evIdx} time={time} onSeek={seek} range={clipOn ? range : null} />
          </section>

          {!hasVideo && (
            <>
              <KpiGrid data={data} />
              <PerfBars data={data} />
            </>
          )}
          {hasVideo && videoAnalysis && (
            <>
              <p className="m-0 text-[13px] text-mute">
                KPIs y eventos medidos en este video, del {time((videoAnalysis.start / secs) * 100)} al {time((videoAnalysis.end / secs) * 100)}. Las distancias y
                velocidades son estimaciones: usan la altura de cada persona (1,75 m) como escala y no descuentan el movimiento de la cámara.
              </p>
              <KpiGrid data={videoAnalysis} />
              {videoAnalysis.perf.length > 0 && (
                <PerfBars
                  data={{ perf: videoAnalysis.perf.map(([who, pct]) => [who, pct]), perfMetric: 'Distancia estimada' }}
                  values={videoAnalysis.perf.map((r) => r[2])}
                  unit="m"
                  who="Persona"
                />
              )}
            </>
          )}
          {hasVideo && !videoAnalysis && (
            <div className="rounded-xl border border-dashed border-line-strong px-5 py-10 text-center text-mute">
              Aún no hay KPIs ni eventos de este video. Pulsa <b className="text-ink">Analizar video</b>:{' '}
              {secs > windowSecs
                ? `se analizan ${windowSecs} s a partir del punto actual, con un fotograma por segundo y uno más donde hay movimiento.`
                : 'se analiza completo, con un fotograma por segundo y uno más donde hay movimiento.'}
            </div>
          )}
        </main>

        <aside aria-label="Panel de análisis" className="flex min-w-0 flex-[1_1_380px] flex-col gap-4 border-l border-line bg-inset p-5">
          {hasVideo && (
            <p className="m-0 rounded-lg border border-dashed border-line-strong px-3 py-2 text-xs text-mute">
              De este video salen el mapa de calor y la medición de pose. La comparativa, los rangos ideales y los diagnósticos del AI Coach siguen siendo de ejemplo.
            </p>
          )}
          <Segmented
            label="Vista del panel"
            value={tab}
            onChange={setTab}
            options={[
              { id: 'stats', label: 'Stats' },
              { id: 'bio', label: 'Biomecánica' },
              { id: 'coach', label: 'AI Coach' },
            ]}
          />
          {tab === 'stats' && (
            <>
              {hasVideo && videoAnalysis ? <ImageHeatmap points={videoAnalysis.points} /> : <Heatmap data={data} />}
              <Compare data={data} />
            </>
          )}
          {tab === 'bio' && (
            <>
              {hasVideo && <RealPose analysis={shownAnalysis} aspect={meta ? meta.width / meta.height : 16 / 9} />}
              <Biomech data={data} />
            </>
          )}
          {tab === 'coach' && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="m-0 text-[15px] font-semibold">AI Coach · resumen</h2>
                <Link to="/coach" className="flex min-h-11 items-center text-[13px] font-semibold text-lime">
                  Ver todo
                </Link>
              </div>
              {data.diags.map((d) => (
                <DiagSummary
                  key={d.id}
                  d={d}
                  time={time(data.events[d.ev].pct)}
                  onJump={() => {
                    seek(data.events[d.ev].pct)
                    setLayers((l) => ({ ...l, skel: true }))
                  }}
                />
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function visionLabel(status: VisionStatus, analysis: FrameAnalysis | null): string {
  if (status === 'loading') return 'ANALIZANDO…'
  if (status === 'loading_model') return 'CARGANDO MODELO…'
  if (status === 'ok' && analysis) return `${analysis.source === 'local' ? 'IA LOCAL' : 'IA REAL'} · ${analysis.persons.length} personas · ${analysis.ms} ms`
  if (status === 'not_configured') return 'IA SIN CONFIGURAR'
  if (status === 'unauthorized') return 'CLAVE RECHAZADA'
  if (status === 'failed') return 'ERROR DE VISIÓN'
  return 'IA REAL · SIN ANALIZAR'
}

/** Ángulos medidos de verdad sobre el fotograma analizado. */
function RealPose({ analysis, aspect }: { analysis: FrameAnalysis | null; aspect: number }) {
  const person = analysis ? mainPerson(analysis.persons) : null
  const angles = person ? jointAngles(person, aspect) : []
  return (
    <section className={`${card} flex flex-col gap-3 border-lime p-4`}>
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 text-[15px] font-semibold">Medición real del fotograma</h2>
        <span className="text-xs text-mute">
          {person ? `Persona #${person.id}, la de mayor tamaño · ángulos en el plano de la imagen` : 'Pulsa Analizar fotograma para medir la pose.'}
        </span>
      </div>
      {person && angles.length === 0 && <span className="text-[13px] text-mute">No hay articulaciones con confianza suficiente en este fotograma.</span>}
      {angles.map((a) => (
        <div key={a.label} className="flex items-baseline justify-between gap-2 border-t border-line pt-2">
          <span className="text-[13px]">{a.label}</span>
          <span className="font-mono text-base font-bold">{a.degrees}°</span>
        </div>
      ))}
    </section>
  )
}

function RangeEnd({ label, value, onMark }: { label: string; value: string; onMark: () => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-mute">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[15px] font-bold">{value}</span>
        <button type="button" onClick={onMark} className="h-11 rounded-lg border border-line bg-raised px-3 text-[13px]">
          Marcar aquí
        </button>
      </div>
    </div>
  )
}

function OrbitControls({ orbit, onChange }: { orbit: Orbit; onChange: (o: Orbit) => void }) {
  const { yaw, tilt, zoom } = orbit
  const actions: [string, Orbit][] = [
    ['Girar izq.', { ...orbit, yaw: yaw - 15 }],
    ['Girar der.', { ...orbit, yaw: yaw + 15 }],
    ['Subir', { ...orbit, tilt: Math.max(0, tilt - 10) }],
    ['Bajar', { ...orbit, tilt: Math.min(75, tilt + 10) }],
    ['Acercar', { ...orbit, zoom: Math.min(1.8, zoom + 0.15) }],
    ['Alejar', { ...orbit, zoom: Math.max(0.6, zoom - 0.15) }],
    ['Cenital', { yaw: 0, tilt: 0, zoom: 1 }],
    ['Lateral', { yaw: 0, tilt: 62, zoom: 1 }],
    ['Fondo', { yaw: -90, tilt: 62, zoom: 1 }],
    ['Reiniciar', DEFAULT_ORBIT],
  ]
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
      <span className="mr-1 text-[13px] text-mute">Navegar</span>
      {actions.map(([label, next]) => (
        <button key={label} type="button" onClick={() => onChange(next)} className="h-11 rounded-lg border border-line bg-raised px-3 text-[13px]">
          {label}
        </button>
      ))}
      <span className="font-mono text-xs text-mute">
        giro {yaw}° · inclinación {tilt}° · zoom {comma(zoom, 2)}x
      </span>
    </div>
  )
}

interface TimelineProps {
  sport: SportData['id']
  events: GameEvent[]
  legend: [EvCode, string][]
  pos: number
  evIdx: number
  time: (pct: number) => string
  onSeek: (pct: number) => void
  range: [number, number] | null
}

function Timeline({ sport, events, legend, pos, evIdx, time, onSeek, range }: TimelineProps) {
  return (
    <div className="px-7 pb-3.5">
      <div
        className="relative h-11"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          onSeek(((e.clientX - r.left) / r.width) * 100)
        }}
      >
        <div className="absolute inset-x-0 top-5 h-1 rounded-sm bg-line" />
        <div className="absolute top-5 left-0 h-1 rounded-sm bg-lime" style={{ width: `${pos}%` }} />
        {range && (
          <div
            className="absolute top-1.5 h-8 min-w-2 border-x-[3px] border-ink bg-ink/20"
            style={{ left: `${range[0]}%`, width: `${range[1] - range[0]}%` }}
          />
        )}
        {events.map((e, i) => {
          const on = i === evIdx
          const color = EVENT_COLOR[e.code]
          const label = `${time(e.pct)} · ${e.type} · ${e.desc}`
          return (
            <button
              key={`${e.pct}-${i}`}
              type="button"
              aria-label={label}
              title={label}
              aria-pressed={on}
              onClick={(ev) => {
                ev.stopPropagation()
                onSeek(e.pct)
              }}
              className="absolute top-0 h-11 w-[26px] -translate-x-1/2 rounded-md border-[1.5px] p-0 font-mono text-xs font-bold"
              style={{ left: `${e.pct}%`, borderColor: color, background: on ? color : '#10151B', color: on ? '#090D10' : color }}
            >
              {e.code === 'G' && sport === 'basket' ? 'C' : e.code}
            </button>
          )
        })}
        <div className="pointer-events-none absolute top-3 -ml-px h-5 w-0.5 bg-ink" style={{ left: `${pos}%` }} />
      </div>
      <div className="mt-2.5 flex flex-wrap gap-4 text-xs text-mute">
        {legend.map(([code, label]) => (
          <span key={code} className="flex items-center gap-1.5">
            <span className="font-mono font-bold" style={{ color: EVENT_COLOR[code] }}>
              {code === 'G' && sport === 'basket' ? 'C' : code}
            </span>
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

function SharePanel({ url }: { url: string }) {
  const [copied, setCopied] = useState<boolean | null>(null)
  return (
    <section aria-label="Compartir análisis" className="flex flex-wrap items-end gap-5 border-b border-line bg-inset px-5 py-4">
      <div className="flex min-w-0 flex-[2_1_320px] flex-col gap-1.5">
        <label htmlFor="share-link" className="text-xs text-mute">
          Enlace a este instante del análisis
        </label>
        <div className="flex flex-wrap gap-2">
          <input id="share-link" readOnly value={url} className={`${input} flex-[1_1_200px] font-mono text-[13px]`} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className={btnPrimary} onClick={async () => setCopied(await copyText(url))}>
            {copied === null ? 'Copiar enlace' : copied ? 'Enlace copiado' : 'No se pudo copiar'}
          </button>
        </div>
      </div>
      <p className="m-0 flex-[1_1_260px] text-[13px] text-mute">
        El enlace abre el visor en el mismo momento del video. Los permisos y las invitaciones por correo necesitan cuentas de usuario, que esta versión aún no tiene.
      </p>
    </section>
  )
}

function DownloadPanel({ data, secs }: { data: SportData; secs: number }) {
  const base = slug(data.match)
  const tile = 'flex flex-col gap-1 rounded-[10px] border border-line-strong bg-card px-4 py-3.5 text-left text-ink'
  return (
    <section aria-label="Descargar análisis" className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3 border-b border-line bg-inset px-5 py-4">
      <button type="button" className={tile} onClick={() => downloadText(`${base}-informe.md`, analysisReportMd(data, secs), 'text/markdown')}>
        <span className="flex justify-between gap-2">
          <span className="text-[15px] font-semibold">Informe</span>
          <span className="font-mono text-xs text-mute">MD</span>
        </span>
        <span className="text-[13px] text-mute">KPIs, eventos y diagnósticos del AI Coach.</span>
      </button>
      <button type="button" className={tile} onClick={() => downloadText(`${base}-eventos.csv`, eventsCsv(data, secs), 'text/csv')}>
        <span className="flex justify-between gap-2">
          <span className="text-[15px] font-semibold">Datos</span>
          <span className="font-mono text-xs text-mute">CSV</span>
        </span>
        <span className="text-[13px] text-mute">Eventos de la línea de tiempo.</span>
      </button>
      <button type="button" className={tile} disabled>
        <span className="flex justify-between gap-2">
          <span className="text-[15px] font-semibold">Clip con capas</span>
          <span className="font-mono text-xs text-mute">MP4</span>
        </span>
        <span className="text-[13px] text-mute">Requiere el servicio de render de video, aún no conectado.</span>
      </button>
    </section>
  )
}
