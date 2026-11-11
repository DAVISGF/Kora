import type { ReactNode, RefObject } from 'react'
import type { SportData } from '../data/sports'
import type { VideoSource } from '../lib/store'
import { comma } from '../lib/util'
import type { FrameAnalysis } from '../lib/vision'
import RealOverlay from './RealOverlay'
import Scene, { PitchLines, type LayerState } from './Scene'

export type ViewId = 'c0' | 'c1' | 'c2' | '3d'

export interface Orbit {
  yaw: number
  tilt: number
  zoom: number
}

export const CAMERAS: { id: ViewId; name: string; pos: string; transform: string }[] = [
  { id: 'c0', name: 'CAM 01', pos: 'Lateral', transform: 'none' },
  // Las cámaras 2 y 3 reencuadran el mismo fotograma: no hay otro ángulo real.
  { id: 'c1', name: 'CAM 02', pos: 'Fondo', transform: 'scale(1.45) translate(-9%, -4%)' },
  { id: 'c2', name: 'CAM 03', pos: 'Elevada', transform: 'scale(1.2) translate(5%, 7%)' },
]

interface ViewerProps {
  data: SportData
  layers: LayerState
  /** Fase de la animación; avanza con la reproducción */
  tick: number
  view: ViewId
  orbit: Orbit
  cams: number
  timecode: string
  video: VideoSource | null
  videoRef: RefObject<HTMLVideoElement | null>
  onMeta: (meta: { secs: number; width: number; height: number }) => void
  /** Detecciones reales del fotograma actual, si el servicio de visión respondió */
  real: FrameAnalysis | null
  videoSize: { width: number; height: number } | null
  /** Estado del servicio de visión, visible sobre el video */
  visionStatus: string
  /** El navegador no pudo decodificar el video (formato o códec no admitido) */
  onVideoError?: () => void
  /** Aviso a pantalla completa del visor: demostración, recuperación del video, errores */
  overlay?: ReactNode
}

const AMP: [number, number][] = [
  [0, 0],
  [0, 0],
  [16, 5],
  [7, 3],
  [14, 6],
  [10, 4],
]
const BASE_SPEED = [0.8, 1.2, 6.4, 4.1, 5.2, 3.0]

export default function Viewer({ data, layers, tick, view, orbit, cams, timecode, video, videoRef, onMeta, real, videoSize, visionStatus, onVideoError, overlay }: ViewerProps) {
  const ph = tick * 0.3
  const is3d = view === '3d'
  const cam = CAMERAS.find((c) => c.id === view) ?? CAMERAS[0]
  const hasVideo = !!video?.playable

  const offsets = AMP.map(([ax, ay], i) => `${(ax * Math.sin(ph + i)).toFixed(1)},${(ay * Math.cos(ph * 0.7 + i)).toFixed(1)}`)
  const labels = data.nums.map((n, i) => {
    const v = i < 2 ? BASE_SPEED[i] : BASE_SPEED[i] + 1.6 * Math.abs(Math.sin(ph + i))
    return `${n} · ${comma(v)} m/s`
  })

  return (
    <div className="relative aspect-video overflow-hidden bg-[#0B0F15]">
      <div
        className="absolute inset-0 origin-[60%_60%] transition-transform duration-300"
        style={{ transform: cam.transform, display: is3d ? 'none' : 'block' }}
      >
        {hasVideo && (
          <video
            ref={videoRef}
            src={video.url}
            muted
            playsInline
            className="absolute inset-0 h-full w-full object-contain"
            onError={onVideoError}
            onLoadedMetadata={(e) => onMeta({ secs: e.currentTarget.duration, width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight })}
          />
        )}
        {!hasVideo && <Scene sport={data.id} accent={data.accent} layers={layers} offsets={offsets} labels={labels} />}
        {hasVideo && real && videoSize && <RealOverlay analysis={real} layers={layers} width={videoSize.width} height={videoSize.height} />}
      </div>

      {is3d && (
        <div aria-label="Vista 3D reconstruida" className="absolute inset-0 overflow-hidden" style={{ perspective: 1100 }}>
          <div
            className="absolute top-[10%] left-[11%] aspect-[8/5] w-[78%] rounded transition-transform duration-300"
            style={{
              transform: `rotateX(${orbit.tilt}deg) rotateZ(${orbit.yaw}deg) scale(${orbit.zoom})`,
              transformStyle: 'preserve-3d',
              background: data.pitch,
            }}
          >
            <PitchLines sport={data.id} />
            {data.pins.map(([x, y, own], i) => {
              const moving = i >= 2
              const left = `${(x + (moving ? 3 * Math.sin(ph + i) : 0)).toFixed(1)}%`
              const top = `${(y + (moving ? 4 * Math.cos(ph * 0.7 + i) : 0)).toFixed(1)}%`
              const color = own ? '#CBF62E' : data.accent
              return (
                <div key={i} className="absolute" style={{ left, top, transformStyle: 'preserve-3d' }}>
                  <div className="absolute -top-[7px] -left-[7px] h-3.5 w-3.5 rounded-full opacity-45" style={{ background: color }} />
                  {/* Marcador vertical: deshace el giro del plano para quedar de cara a la cámara */}
                  <div className="absolute h-0 w-0" style={{ transform: `rotateZ(${-orbit.yaw}deg) rotateX(${-orbit.tilt}deg)` }}>
                    <div className="absolute bottom-0 -left-px h-[30px] w-0.5" style={{ background: color }} />
                    <div
                      className="absolute bottom-[30px] left-0 -translate-x-1/2 rounded-[3px] px-1.5 py-px font-mono text-xs font-bold whitespace-nowrap text-lime-ink"
                      style={{ background: color }}
                    >
                      {data.nums[i]}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="absolute top-3 right-3 rounded-md border border-line bg-bg px-2 py-1 font-mono text-xs">
            3D estimado · {cams === 1 ? '1 cámara' : `${cams} cámaras`}
          </div>
        </div>
      )}

      <div className="absolute top-3 left-3 flex items-center gap-2 rounded-md border border-line bg-bg px-2 py-1 font-mono text-xs">
        <span className="h-2 w-2 rounded-full bg-ok" />
        <span>
          {is3d ? 'VISTA 3D' : `${cam.name} ${cam.pos.toUpperCase()}`} · {timecode} · {hasVideo ? (real ? `${real.persons.length} personas` : 'sin analizar') : '6 objetivos'}
        </span>
      </div>
      {hasVideo && !is3d && (
        <div role="status" className="absolute right-3 bottom-3 rounded-md border border-line-strong bg-bg px-2 py-1 font-mono text-xs text-ink">
          {visionStatus}
        </div>
      )}
      {overlay}
    </div>
  )
}
