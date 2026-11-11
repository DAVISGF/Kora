// Piezas del informe del AI Coach: la foto con el cuerpo marcado y las tarjetas
// de cada hallazgo. Lo usan la página del Coach, el visor y la ficha de persona.

import { Check, Dumbbell, Eye, Lightbulb, Play, Target } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Evidence, Finding, Joint, Status } from '../lib/coach/types'
import { cx, fmtClock } from '../lib/util'
import { card } from './ui'

const BONES: [Joint, Joint][] = [
  ['left_shoulder', 'right_shoulder'],
  ['left_shoulder', 'left_elbow'],
  ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'],
  ['right_elbow', 'right_wrist'],
  ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'],
  ['left_hip', 'left_knee'],
  ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'],
  ['right_knee', 'right_ankle'],
]
const MIN_CONF = 0.35

export const STATUS_COLOR: Record<Status, string> = { fix: 'var(--color-lime)', polish: 'var(--color-warn)', good: 'var(--color-ok)' }
const STATUS_LABEL: Record<Status, string> = { fix: 'Para corregir', polish: 'Para pulir', good: 'Bien hecho' }

/** La foto del instante con el cuerpo dibujado encima y la parte que importa resaltada. */
export function EvidencePhoto({ evidence, status, alt, className }: { evidence: Evidence; status: Status; alt: string; className?: string }) {
  const { crop, pose } = evidence
  if (!evidence.image) return null
  const u = Math.max(crop.w, crop.h) / 100
  const at = (j: Joint) => {
    const p = pose[j]
    return p && p.c >= MIN_CONF ? p : null
  }
  const marked = new Set(evidence.highlight)
  const tone = STATUS_COLOR[status]
  const bones = BONES.map(([a, b]) => ({ a: at(a), b: at(b), on: marked.has(a) && marked.has(b) })).filter((x) => x.a && x.b)
  const dots = evidence.highlight.map(at).filter((p) => !!p)
  // Dos puntos sueltos (los pies, las manos) se unen con una línea para que se vea qué se compara.
  const pair = evidence.highlight.length === 2 && !bones.some((x) => x.on) ? dots : []
  return (
    <svg
      viewBox={`${crop.x} ${crop.y} ${crop.w} ${crop.h}`}
      role="img"
      aria-label={alt}
      className={cx('block w-full rounded-lg bg-black', className)}
      style={{ aspectRatio: `${crop.w} / ${crop.h}` }}
    >
      {evidence.image && <image href={evidence.image} x={crop.x} y={crop.y} width={crop.w} height={crop.h} preserveAspectRatio="none" />}
      {bones.filter((x) => !x.on).map((x, i) => (
        <line key={`b${i}`} x1={x.a!.x} y1={x.a!.y} x2={x.b!.x} y2={x.b!.y} stroke="#fff" strokeOpacity={0.55} strokeWidth={u * 0.7} strokeLinecap="round" />
      ))}
      {bones.filter((x) => x.on).map((x, i) => (
        <line key={`h${i}`} x1={x.a!.x} y1={x.a!.y} x2={x.b!.x} y2={x.b!.y} stroke={tone} strokeWidth={u * 1.5} strokeLinecap="round" />
      ))}
      {pair.length === 2 && <line x1={pair[0]!.x} y1={pair[0]!.y} x2={pair[1]!.x} y2={pair[1]!.y} stroke={tone} strokeWidth={u * 1.1} strokeDasharray={`${u * 2} ${u * 2}`} strokeLinecap="round" />}
      {dots.map((p, i) => (
        <circle key={`d${i}`} cx={p!.x} cy={p!.y} r={u * 1.7} fill={tone} stroke="#090d10" strokeWidth={u * 0.5} />
      ))}
    </svg>
  )
}

/** Dos instantes más cercanos que esto son el mismo gesto. */
const SAME_MOMENT_S = 2.5

const jumpBtn = 'inline-flex h-11 items-center gap-1.5 rounded-lg border border-line-strong bg-raised px-3 font-mono text-[13px] text-ink no-underline'

/** Enlaces al visor en los instantes donde se vio el hallazgo. */
export function Moments({ finding, max = 3 }: { finding: Finding; max?: number }) {
  // Primero el instante de la foto; después, las otras repeticiones (no el mismo gesto dos veces).
  const times: number[] = []
  for (const t of [finding.evidence?.t, ...finding.moments]) {
    if (t === undefined || times.some((k) => Math.abs(k - t) < SAME_MOMENT_S)) continue
    times.push(Math.max(0, Math.round(t * 10) / 10))
  }
  times.splice(max)
  times.sort((x, y) => x - y)
  if (!times.length) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[13px] text-mute">Míralo en el video:</span>
      {times.map((t) => (
        <Link key={t} to={`/analisis?t=${t}`} className={jumpBtn} aria-label={`Ver en el video, minuto ${fmtClock(t)}`}>
          <Play size={12} fill="currentColor" aria-hidden="true" />
          {fmtClock(t)}
        </Link>
      ))}
    </div>
  )
}

function Tag({ status }: { status: Status }) {
  return (
    <span className="rounded border px-2 py-0.5 text-xs font-bold tracking-wider uppercase" style={{ color: STATUS_COLOR[status], borderColor: STATUS_COLOR[status] }}>
      {STATUS_LABEL[status]}
    </span>
  )
}

function Part({ icon: Icon, title, children }: { icon: typeof Eye; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <Icon size={18} className="mt-0.5 shrink-0 text-mute" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs font-semibold tracking-wider text-mute uppercase">{title}</span>
        <div className="text-[15px] leading-relaxed">{children}</div>
      </div>
    </div>
  )
}

function Measure({ finding }: { finding: Finding }) {
  if (!finding.measured) return null
  return (
    <p className="m-0 font-mono text-[13px] text-mute">
      <span className="text-ink">{finding.measured}</span>
      {finding.target ? ` · ${finding.target}` : ''}
    </p>
  )
}

const CONFIDENCE_LABEL = { alta: 'Seguridad alta', media: 'Seguridad media', baja: 'Seguridad baja' } as const

/** Alto máximo de la foto del foco, para que en el teléfono no empuje el texto fuera de la pantalla. */
const FOCUS_PHOTO_H = 440

/** La tarjeta grande: lo primero a trabajar, con foto, motivo, clave y ejercicio. */
export function FocusCard({ finding }: { finding: Finding }) {
  const e = finding.evidence
  return (
    <article className={cx(card, 'flex flex-col gap-5 p-5')} style={{ borderColor: STATUS_COLOR[finding.status] }}>
      <header className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <Tag status={finding.status} />
          <span className="text-[13px] text-mute">{finding.label}</span>
        </div>
        <h2 className="m-0 text-2xl leading-tight font-bold">{finding.title}</h2>
      </header>
      <div className="flex flex-wrap gap-x-7 gap-y-5">
        {e?.image && (
          <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-2" style={{ maxWidth: Math.round((FOCUS_PHOTO_H * e.crop.w) / e.crop.h) }}>
            <EvidencePhoto evidence={e} status={finding.status} alt={`Foto del video en ${fmtClock(e.t)}: ${finding.label.toLowerCase()} resaltado`} />
            <span className="text-xs text-mute">Tu foto en {fmtClock(e.t)}. En color, la parte del cuerpo que miramos.</span>
          </div>
        )}
        <div className="flex min-w-0 flex-[2_1_340px] flex-col gap-4">
          <Part icon={Eye} title="Qué vimos">
            {finding.seen}
            <Measure finding={finding} />
          </Part>
          {finding.why && (
            <Part icon={Lightbulb} title="Por qué importa">
              {finding.why}
            </Part>
          )}
          {finding.cue && (
            <div className="rounded-lg border border-line-strong bg-inset p-4">
              <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-mute uppercase">
                <Target size={16} aria-hidden="true" />
                La clave
              </div>
              <p className="m-0 mt-1.5 text-lg leading-snug font-semibold">{finding.cue}</p>
            </div>
          )}
          {finding.drill && <DrillBox finding={finding} />}
          <Moments finding={finding} />
          <p className="m-0 text-[13px] text-mute">
            <b className="font-semibold text-ink">{CONFIDENCE_LABEL[finding.confidence]}.</b> {finding.confidenceNote}
          </p>
        </div>
      </div>
    </article>
  )
}

function DrillBox({ finding }: { finding: Finding }) {
  const d = finding.drill
  if (!d) return null
  return (
    <Part icon={Dumbbell} title="Ejercicio">
      <span className="font-semibold">{d.name}</span> <span className="font-mono text-[13px] text-mute">· {d.dose}</span>
      <ol className="m-0 mt-1.5 flex list-decimal flex-col gap-1 pl-5">
        {d.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </Part>
  )
}

/** Tarjeta mediana: algo para pulir después del foco. */
export function PolishCard({ finding }: { finding: Finding }) {
  return (
    <article className={cx(card, 'flex flex-wrap gap-4 p-4')}>
      {finding.evidence?.image && (
        <div className="w-[120px] shrink-0">
          <EvidencePhoto evidence={finding.evidence} status={finding.status} alt={`Foto del video en ${fmtClock(finding.evidence.t)}`} />
        </div>
      )}
      <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <Tag status={finding.status} />
          <span className="text-[13px] text-mute">{finding.label}</span>
        </div>
        <h3 className="m-0 text-[17px] leading-snug font-semibold">{finding.title}</h3>
        <p className="m-0 text-[15px] leading-relaxed">{finding.seen}</p>
        <Measure finding={finding} />
        {finding.cue && (
          <p className="m-0 text-[15px] leading-relaxed">
            <b className="font-semibold">La clave:</b> {finding.cue}
          </p>
        )}
        {finding.drill && (
          <details className="rounded-lg border border-line bg-inset px-3 py-2">
            <summary className="flex min-h-11 cursor-pointer items-center text-[13px] font-semibold">Ver el ejercicio: {finding.drill.name}</summary>
            <ol className="m-0 mt-1 mb-1 flex list-decimal flex-col gap-1 pl-5 text-[15px] leading-relaxed">
              {finding.drill.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <span className="font-mono text-[13px] text-mute">{finding.drill.dose}</span>
          </details>
        )}
        <Moments finding={finding} max={2} />
        <p className="m-0 text-[13px] text-mute">
          {CONFIDENCE_LABEL[finding.confidence]}. {finding.confidenceNote}
        </p>
      </div>
    </article>
  )
}

/** Fila corta: algo que ya hace bien, con su foto. */
export function GoodRow({ finding }: { finding: Finding }) {
  return (
    <li className="flex gap-3 rounded-lg border border-line bg-inset p-3">
      {finding.evidence?.image ? (
        <div className="relative w-[72px] shrink-0 self-start">
          <EvidencePhoto evidence={finding.evidence} status="good" alt={`Foto del video en ${fmtClock(finding.evidence.t)}`} />
          <span className="absolute -top-1.5 -left-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-ok text-bg">
            <Check size={15} strokeWidth={3} aria-hidden="true" />
          </span>
        </div>
      ) : (
        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ok text-bg">
          <Check size={15} strokeWidth={3} aria-hidden="true" />
        </span>
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[15px] font-semibold">{finding.title}</span>
        <span className="text-[15px] leading-relaxed text-[#AEB7C0]">{finding.seen}</span>
        <Measure finding={finding} />
      </div>
    </li>
  )
}
