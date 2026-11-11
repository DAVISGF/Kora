import { useEffect, useRef } from 'react'
import { Play, X } from 'lucide-react'
import { EVENT_COLOR } from '../data/sports'
import { SPRINT_THRESHOLD, type PersonStats } from '../lib/videoAnalysis'
import { comma, fmtShort, fmtTime } from '../lib/util'
import { eyebrow } from './ui'

interface Props {
  person: PersonStats
  /** Salta el visor a ese segundo del video */
  onSeek: (t: number) => void
  onClose: () => void
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line bg-inset p-2.5">
      <span className="text-[11px] tracking-wide text-mute uppercase">{label}</span>
      <span className="font-mono text-lg font-bold">{value}</span>
      {note && <span className="text-xs text-mute">{note}</span>}
    </div>
  )
}

/** Ficha de una persona seguida en el video: foto, estadísticas y lo detectado sobre ella. */
export default function PersonModal({ person, onSeek, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  const peak = Math.max(SPRINT_THRESHOLD * 1.2, ...person.speeds.map((s) => s.v))
  const jump = (t: number) => {
    onSeek(t)
    ref.current?.close()
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="person-title"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
      className="m-auto max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-[900px] overflow-y-auto rounded-xl border border-line-strong bg-card p-0 text-ink backdrop:bg-black/75"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div className="flex min-w-0 flex-col">
          <h2 id="person-title" className="m-0 text-xl font-semibold">
            Persona #{person.id}
          </h2>
          <span className="text-xs text-mute">Identificador del seguimiento, no el dorsal · en cuadro del {fmtTime(person.firstT)} al {fmtTime(person.lastT)}</span>
        </div>
        <button type="button" aria-label="Cerrar" onClick={() => ref.current?.close()} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-raised text-ink">
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-wrap gap-5 p-5">
        <div className="flex flex-[1_1_220px] flex-col gap-2">
          <div className="flex min-h-[220px] items-center justify-center overflow-hidden rounded-lg border border-line bg-bg">
            {person.thumb ? (
              <img src={person.thumb} alt={`Recorte de la persona #${person.id} en el segundo ${fmtTime(person.thumbT)}`} className="max-h-[420px] w-full object-contain" />
            ) : (
              <span className="p-4 text-center text-[13px] text-mute">No se pudo recortar la imagen de esta persona.</span>
            )}
          </div>
          <button type="button" onClick={() => jump(person.thumbT)} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-line-strong bg-raised px-3 text-[13px] font-semibold text-ink">
            <Play size={12} fill="currentColor" aria-hidden="true" />
            Ver este momento · {fmtTime(person.thumbT)}
          </button>
        </div>

        <div className="flex min-w-0 flex-[2_1_380px] flex-col gap-4">
          <section aria-label="Estadísticas" className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
            <Stat label="Distancia (est.)" value={`${Math.round(person.meters)} m`} />
            <Stat label="Vel. máxima (est.)" value={`${comma(person.topSpeed)} m/s`} />
            <Stat label="Vel. media (est.)" value={`${comma(person.avgSpeed)} m/s`} />
            <Stat label="Sprints" value={String(person.sprints)} note={`sobre ${SPRINT_THRESHOLD} m/s`} />
            <Stat label="En cuadro" value={fmtShort(person.lastT - person.firstT)} note={`${person.samples} muestras`} />
            <Stat label="Confianza media" value={`${Math.round(person.conf * 100)} %`} />
          </section>

          <section className="flex flex-col gap-2">
            <span className={eyebrow}>Velocidad en el tiempo</span>
            {person.speeds.length > 1 ? (
              <svg role="img" aria-label={`Velocidad estimada, con máximo de ${comma(person.topSpeed)} metros por segundo`} viewBox="0 0 400 80" preserveAspectRatio="none" className="h-20 w-full rounded-lg border border-line bg-inset">
                {person.speeds.map((s, i) => {
                  const w = 400 / person.speeds.length
                  const h = Math.max(1, (s.v / peak) * 72)
                  return <rect key={s.t} x={i * w + 0.5} y={80 - h} width={Math.max(1, w - 1)} height={h} fill={s.v >= SPRINT_THRESHOLD ? EVENT_COLOR.S : '#CBF62E'} />
                })}
                <line x1="0" x2="400" y1={80 - (SPRINT_THRESHOLD / peak) * 72} y2={80 - (SPRINT_THRESHOLD / peak) * 72} stroke="#8A95A0" strokeDasharray="4 4" strokeWidth="1" />
              </svg>
            ) : (
              <span className="text-[13px] text-mute">No hay muestras consecutivas suficientes para medir su velocidad.</span>
            )}
            <span className="text-xs text-mute">La línea punteada marca el umbral de sprint. Las barras ámbar lo superan.</span>
          </section>

          <section className="flex flex-col gap-2">
            <span className={eyebrow}>Eventos detectados</span>
            {person.events.length === 0 && <span className="text-[13px] text-mute">Ningún sprint ni posible tiro en el tramo analizado.</span>}
            {person.events.map((e) => (
              <div key={`${e.t}-${e.type}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-inset px-3 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="font-mono font-bold" style={{ color: EVENT_COLOR[e.code] }}>
                    {e.code}
                  </span>
                  <span className="font-semibold">{e.type}</span>
                  <span className="text-[13px] text-mute">{e.desc.split(' — ')[1] ?? ''}</span>
                </span>
                <button type="button" onClick={() => jump(e.t)} className="inline-flex h-11 items-center gap-1.5 rounded-md border border-line-strong bg-raised px-2.5 font-mono text-xs text-ink">
                  <Play size={12} fill="currentColor" aria-hidden="true" />
                  {fmtTime(e.t)}
                </button>
              </div>
            ))}
          </section>

          <div className="flex flex-wrap gap-4">
            <section className="flex min-w-0 flex-[1_1_180px] flex-col gap-2">
              <span className={eyebrow}>Pose en la foto</span>
              {person.angles.length === 0 && <span className="text-[13px] text-mute">Sin articulaciones con confianza suficiente en ese fotograma.</span>}
              {person.angles.map((a) => (
                <div key={a.label} className="flex items-baseline justify-between gap-2 border-t border-line pt-1.5">
                  <span className="text-[13px]">{a.label}</span>
                  <span className="font-mono font-bold">{a.degrees}°</span>
                </div>
              ))}
            </section>
            <section className="flex min-w-0 flex-[1_1_180px] flex-col gap-2">
              <span className={eyebrow}>Dónde estuvo en el encuadre</span>
              <div className="relative aspect-video overflow-hidden rounded-lg border border-line bg-bg">
                {person.points.map((p, i) => (
                  <div
                    key={i}
                    aria-hidden="true"
                    className="absolute aspect-square w-[9%] -translate-x-1/2 -translate-y-1/2 rounded-full mix-blend-screen"
                    style={{
                      left: `${(p.x * 100).toFixed(1)}%`,
                      top: `${(p.y * 100).toFixed(1)}%`,
                      background: 'radial-gradient(circle, rgba(255,194,55,0.5) 0%, rgba(254,121,2,0.3) 40%, rgba(255,80,101,0) 70%)',
                    }}
                  />
                ))}
              </div>
            </section>
          </div>

          <p className="m-0 text-xs text-mute">
            Distancias y velocidades son estimaciones: usan la altura de la persona (1,75 m) como escala y no descuentan el movimiento de la cámara. Los ángulos se miden en el plano de la imagen.
          </p>
        </div>
      </div>
    </dialog>
  )
}
