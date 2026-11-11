import { Play } from 'lucide-react'
import { SEV_COLOR, type Diagnosis } from '../data/sports'
import { card, eyebrow, SevTag } from './ui'

const jumpBtn =
  'inline-flex h-11 items-center gap-1.5 rounded-md border border-line-strong bg-raised px-2.5 font-mono text-xs text-ink'

/** Tarjeta resumida para el panel lateral del visor. */
export function DiagSummary({ d, time, onJump }: { d: Diagnosis; time: string; onJump: () => void }) {
  return (
    <article className={`${card} flex flex-col gap-2.5 p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SevTag sev={d.sev} />
          <span className="text-[13px] text-mute">{d.who}</span>
        </div>
        <button type="button" onClick={onJump} className={jumpBtn} aria-label={`Ver en el video, ${time}`}>
          <Play size={12} fill="currentColor" aria-hidden="true" />
          {time}
        </button>
      </div>
      <h3 className="m-0 text-[15px] leading-snug font-semibold">{d.title}</h3>
      <Measured d={d} small />
      <div className="flex flex-col gap-1.5 border-t border-line pt-2.5">
        <span className={eyebrow}>Ejercicios correctivos</span>
        {d.drills.map(([name, dose], i) => (
          <div key={name} className="flex gap-2 text-[13px]">
            <span className="font-mono text-mute">{i + 1}</span>
            <span>
              {name} <span className="font-mono text-mute">· {dose}</span>
            </span>
          </div>
        ))}
      </div>
    </article>
  )
}

export function Measured({ d, small }: { d: Pick<Diagnosis, 'sev' | 'meas' | 'ideal'>; small?: boolean }) {
  const size = small ? 'text-lg' : 'text-[22px]'
  return (
    <div className="flex flex-wrap gap-7">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs tracking-wider text-mute">MEDIDO</span>
        <span className={`font-mono font-bold ${size}`} style={{ color: SEV_COLOR[d.sev] }}>
          {d.meas}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-xs tracking-wider text-mute">IDEAL</span>
        <span className={`font-mono font-bold ${size}`}>{d.ideal}</span>
      </div>
    </div>
  )
}
