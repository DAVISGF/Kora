import type { ReactNode } from 'react'
import { SEV_COLOR, type Severity } from '../data/sports'
import { cx } from '../lib/util'

export const btnPrimary =
  'inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-lime px-4 font-semibold text-lime-ink no-underline'
export const btnGhost =
  'inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-line-strong bg-raised px-3.5 font-semibold text-ink no-underline'
export const btnDashed =
  'inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong px-3.5 font-semibold text-ink'
export const card = 'rounded-xl border border-line bg-card'
export const eyebrow = 'text-xs uppercase tracking-wider text-mute'
export const input =
  'h-11 min-w-0 rounded-lg border border-line-strong bg-bg px-3 text-ink'

interface SegmentedProps<T extends string> {
  label: string
  options: { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
  /** Usa el color del deporte en la opción activa */
  accent?: boolean
  className?: string
}

export function Segmented<T extends string>({ label, options, value, onChange, accent, className }: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={label} className={cx('flex gap-1 rounded-[10px] border border-line bg-bg p-1', className)}>
      {options.map((o) => {
        const on = o.id === value
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.id)}
            className={cx(
              'h-9 flex-1 rounded-[7px] px-3.5 text-sm font-semibold whitespace-nowrap',
              on ? (accent ? 'bg-accent text-bg' : 'bg-line text-ink') : 'text-mute',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function SevTag({ sev }: { sev: Severity }) {
  const c = SEV_COLOR[sev]
  return (
    <span className="rounded border px-2 py-0.5 text-xs font-bold tracking-wider uppercase" style={{ color: c, borderColor: c }}>
      {sev}
    </span>
  )
}

export function SampleBadge({ children = 'Datos de ejemplo' }: { children?: ReactNode }) {
  return (
    <span className="rounded-md border border-dashed border-line-strong px-2 py-1 font-mono text-xs text-mute uppercase">
      {children}
    </span>
  )
}

export function PageHeader({ eyebrow: e, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-xs tracking-widest text-mute uppercase">{e}</span>
      <h1 className="m-0 text-[28px] leading-tight font-bold">{title}</h1>
      {children && <p className="m-0 max-w-[64ch] text-mute">{children}</p>}
    </div>
  )
}
