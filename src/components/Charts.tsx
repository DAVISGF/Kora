import { useMemo, useState } from 'react'
import { RADAR_AXES, type SportData } from '../data/sports'
import { seeded } from '../lib/util'
import { PitchLines } from './Scene'
import { card, Segmented } from './ui'

const LIME = '#CBF62E'

export function KpiGrid({ data }: { data: Pick<SportData, 'kpis'> }) {
  return (
    <section aria-label="Indicadores clave" className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
      {data.kpis.map((k) => (
        <div key={k.label} className={`${card} flex flex-col gap-1 px-4 py-3.5`}>
          <span className="text-xs tracking-wider text-mute uppercase">{k.label}</span>
          <span className="font-mono text-[28px] leading-tight font-bold">{k.value}</span>
          <span className="text-xs" style={{ color: k.trend > 0 ? '#36DA90' : k.trend < 0 ? '#FFC237' : '#8A95A0' }}>
            {k.delta}
          </span>
        </div>
      ))}
    </section>
  )
}

interface PerfBarsProps {
  data: Pick<SportData, 'perf' | 'perfMetric'>
  values?: number[]
  unit?: string
  who?: string
  /** Si se pasa, cada fila es un botón que abre el detalle */
  onSelect?: (index: number) => void
}

export function PerfBars({ data, values, unit = '%', who = 'Jugador', onSelect }: PerfBarsProps) {
  const row = 'grid grid-cols-[96px_minmax(0,1fr)_56px] items-center gap-3'
  return (
    <section className={`${card} flex flex-col gap-3 p-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-[15px] font-semibold">Rendimiento por jugador</h2>
        <span className="text-xs text-mute">{onSelect ? `${data.perfMetric} · pulsa una fila para ver la ficha` : data.perfMetric}</span>
      </div>
      {data.perf.map(([player, pct], i) => {
        const cells = (
          <>
            <span className="text-left text-[13px]">
              {who} {player}
            </span>
            <div className="h-3.5 rounded bg-raised">
              <div className="h-3.5 rounded bg-lime" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-right font-mono text-[13px]">
              {values?.[i] ?? pct} {unit}
            </span>
          </>
        )
        return onSelect ? (
          <button key={player} type="button" onClick={() => onSelect(i)} className={`${row} -mx-2 min-h-11 rounded-lg px-2 text-ink hover:bg-raised`}>
            {cells}
          </button>
        ) : (
          <div key={player} className={row}>
            {cells}
          </div>
        )
      })}
    </section>
  )
}

type HeatMode = 'dots' | 'grid'

/** Posiciones reales de las personas sobre la imagen del video (sin proyección a la cancha). */
export function ImageHeatmap({ points }: { points: { x: number; y: number }[] }) {
  // Con muchas muestras se dibuja una de cada n para no saturar.
  const stride = Math.max(1, Math.ceil(points.length / 400))
  const shown = points.filter((_, i) => i % stride === 0)
  return (
    <section className={`${card} flex flex-col gap-3 border-lime p-4`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="m-0 text-[15px] font-semibold">Mapa de calor real</h2>
        <span className="text-xs text-mute">{points.length} posiciones</span>
      </div>
      <div className="relative aspect-video overflow-hidden rounded-md border border-line bg-bg">
        <div aria-hidden="true" className="absolute inset-0">
          {shown.map((p, i) => (
            <div
              key={i}
              className="absolute aspect-square w-[7%] -translate-x-1/2 -translate-y-1/2 rounded-full mix-blend-screen"
              style={{
                left: `${(p.x * 100).toFixed(1)}%`,
                top: `${(p.y * 100).toFixed(1)}%`,
                background: 'radial-gradient(circle, rgba(255,194,55,0.42) 0%, rgba(254,121,2,0.26) 40%, rgba(255,80,101,0) 70%)',
              }}
            />
          ))}
        </div>
      </div>
      <span className="text-xs text-mute">Dónde pisan las personas dentro del encuadre. No está proyectado a la cancha: haría falta calibrar la cámara.</span>
    </section>
  )
}

export function Heatmap({ data }: { data: SportData }) {
  const [mode, setMode] = useState<HeatMode>('dots')

  const blobs = useMemo(() => {
    const rnd = seeded(data.heatSeed)
    const gauss = () => (rnd() + rnd() + rnd()) / 1.5 - 1
    return data.heatClusters.flatMap(([cx, cy, sx, sy, n]) =>
      Array.from({ length: n }, () => ({
        left: `${Math.max(4, Math.min(96, cx + gauss() * sx)).toFixed(1)}%`,
        top: `${Math.max(8, Math.min(92, cy + gauss() * sy)).toFixed(1)}%`,
        width: `${(5 + rnd() * 4).toFixed(1)}%`,
      })),
    )
  }, [data])

  return (
    <section className={`${card} flex flex-col gap-3 p-4`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="m-0 text-[15px] font-semibold">Mapa de calor</h2>
        <span className="text-xs text-mute">
          {mode === 'dots' ? `Jugador ${data.compare.a} · ${blobs.length} muestras` : data.heatMetric}
        </span>
      </div>
      <Segmented
        label="Tipo de mapa de calor"
        value={mode}
        onChange={setMode}
        options={[
          { id: 'dots', label: 'Por jugador' },
          { id: 'grid', label: 'Por zonas' },
        ]}
      />

      {mode === 'dots' ? (
        <>
          <div className="relative aspect-[8/5] overflow-hidden rounded-md" style={{ background: data.pitch }}>
            <PitchLines sport={data.id} />
            <div aria-hidden="true" className="absolute inset-0">
              {blobs.map((b, i) => (
                <div
                  key={i}
                  className="absolute aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full mix-blend-screen"
                  style={{
                    ...b,
                    background:
                      'radial-gradient(circle, rgba(255,194,55,0.42) 0%, rgba(254,121,2,0.26) 40%, rgba(255,80,101,0) 70%)',
                  }}
                />
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-mute">
            <span>Menos</span>
            <div className="h-2.5 w-[118px] rounded" style={{ background: 'linear-gradient(90deg, rgba(255,80,101,0.35), #FE7902, #FFC237)' }} />
            <span>Más</span>
          </div>
        </>
      ) : (
        <>
          <div className="relative aspect-[8/5] overflow-hidden rounded-md bg-bg">
            <div className="absolute inset-0 grid grid-cols-8 grid-rows-5">
              {data.heat.map((v, i) => (
                <div key={i} className="bg-accent" style={{ opacity: v / 100 }} />
              ))}
            </div>
            <PitchLines sport={data.id} half />
          </div>
          <div className="flex items-center gap-2 text-xs text-mute">
            <span>Menos</span>
            <div className="flex gap-0.5 rounded bg-bg p-0.5">
              {[0.12, 0.32, 0.55, 0.78, 1].map((o) => (
                <div key={o} className="h-2.5 w-[22px] bg-accent" style={{ opacity: o }} />
              ))}
            </div>
            <span>Más</span>
          </div>
        </>
      )}
    </section>
  )
}

function radarPoints(values: number[]) {
  return values
    .map((v, i) => {
      const a = ((-90 + 60 * i) * Math.PI) / 180
      const r = (80 * v) / 100
      return `${(170 + r * Math.cos(a)).toFixed(1)},${(110 + r * Math.sin(a)).toFixed(1)}`
    })
    .join(' ')
}

const AXIS_LABEL: [number, number, 'start' | 'middle' | 'end'][] = [
  [170, 20, 'middle'],
  [246, 68, 'start'],
  [246, 158, 'start'],
  [170, 208, 'middle'],
  [94, 158, 'end'],
  [94, 68, 'end'],
]

export function Compare({ data }: { data: SportData }) {
  const c = data.compare
  return (
    <section className={`${card} flex flex-col gap-3.5 p-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-[15px] font-semibold">Comparativa técnica</h2>
        <div className="flex gap-3 text-xs text-mute">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-lime" />
            Jugador {c.a}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-accent" />
            Jugador {c.b}
          </span>
        </div>
      </div>

      <svg role="img" aria-label={`Radar de seis ejes que compara a los jugadores ${c.a} y ${c.b}`} viewBox="0 0 340 220" className="h-auto w-full">
        <g fill="none" stroke="#2E3742" strokeWidth="1">
          {[100, 66.6, 33.3].map((r) => (
            <polygon key={r} points={radarPoints(Array(6).fill(r))} />
          ))}
          <path d="M170 30v160M239.3 70 100.7 150M239.3 150 100.7 70" />
        </g>
        <polygon points={radarPoints(c.radarB)} fill={data.accent} fillOpacity="0.12" stroke={data.accent} strokeWidth="2" strokeDasharray="5 4" />
        <polygon points={radarPoints(c.radarA)} fill={LIME} fillOpacity="0.25" stroke={LIME} strokeWidth="2" />
        <g fontSize="11" fill="#8A95A0">
          {RADAR_AXES.map((label, i) => (
            <text key={label} x={AXIS_LABEL[i][0]} y={AXIS_LABEL[i][1]} textAnchor={AXIS_LABEL[i][2]}>
              {label}
            </text>
          ))}
        </g>
      </svg>

      {c.rows.map((r) => (
        <div key={r.label} className="flex flex-col gap-1.5">
          <span className="text-[13px] text-mute">{r.label}</span>
          <div className="grid grid-cols-[minmax(0,1fr)_76px] items-center gap-x-2.5 gap-y-1.5">
            <div className="h-2.5 rounded-[3px] bg-raised">
              <div className="h-2.5 rounded-[3px] bg-lime" style={{ width: `${r.aPct}%` }} />
            </div>
            <span className="text-right font-mono text-xs">{r.a}</span>
            <div className="h-2.5 rounded-[3px] bg-raised">
              <div className="h-2.5 rounded-[3px] bg-accent" style={{ width: `${r.bPct}%` }} />
            </div>
            <span className="text-right font-mono text-xs">{r.b}</span>
          </div>
        </div>
      ))}
    </section>
  )
}

export function Biomech({ data }: { data: SportData }) {
  return (
    <section className={`${card} flex flex-col gap-[18px] p-4`}>
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 text-[15px] font-semibold">Biomecánica · {data.bioPlayer}</h2>
        <span className="text-xs text-mute">Valor medido frente al rango ideal (banda clara)</span>
      </div>
      {data.bio.map((b) => {
        const color = b.inRange ? '#36DA90' : '#FFC237'
        return (
          <div key={b.label} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[13px]">{b.label}</span>
              <span className="font-mono text-base font-bold">{b.value}</span>
            </div>
            <div className="relative h-4">
              <div className="absolute inset-x-0 top-[5px] h-1.5 rounded-[3px] bg-raised" />
              <div className="absolute top-[5px] h-1.5 rounded-[3px] bg-[#5B6677]" style={{ left: `${b.bandL}%`, width: `${b.bandW}%` }} />
              <div className="absolute top-0 -ml-0.5 h-4 w-1 rounded-sm" style={{ left: `${b.mark}%`, background: color }} />
            </div>
            <div className="flex justify-between gap-2 text-xs">
              <span className="text-mute">Ideal {b.ideal}</span>
              <span className="font-semibold" style={{ color }}>
                {b.status}
              </span>
            </div>
          </div>
        )
      })}
    </section>
  )
}
