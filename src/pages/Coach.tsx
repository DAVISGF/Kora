import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Camera, CircleHelp, Download, Play, Sparkles, Upload } from 'lucide-react'
import { EvidencePhoto, FocusCard, GoodRow, PolishCard } from '../components/CoachViews'
import { btnGhost, btnPrimary, card, eyebrow, PageHeader } from '../components/ui'
import { countNoun, DISCLAIMER, NEXT_CHALLENGE } from '../lib/coach/content'
import type { CoachReport, PersonCoach } from '../lib/coach/types'
import { coachReportMd } from '../lib/report'
import { useStore } from '../lib/store'
import { cx, downloadText, fmtClock, videoSlug } from '../lib/util'

const ACTION_LABEL: Record<string, string> = { shot: 'Tiro', kick: 'Golpeo', run: 'Carrera' }

const HOW_TO_FILM = [
  'Que se te vea el cuerpo entero, de la cabeza a los pies.',
  'Deja el celular quieto, apoyado en algo, a la altura de tu cintura.',
  'Graba tres repeticiones o más del mismo gesto: tiros, golpeos o carreras.',
]

export default function Coach() {
  const { data, video, restoring, videoAnalysis, scan, scanError, startScan, cancelScan } = useStore()
  const hasVideo = !!video?.playable
  const report = videoAnalysis?.coach ?? null

  return (
    <main className="mx-auto flex max-w-[1040px] flex-col gap-6 px-5 pt-8 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader eyebrow={`AI Coach · ${data.label}`} title="Tu técnica">
          {report && video
            ? `Medido en tu video «${video.name}». Solo decimos lo que pudimos ver.`
            : 'El Coach mira tu video y te dice, con tus propias fotos, qué haces bien y qué mejorar primero.'}
        </PageHeader>
        {report && video && report.people.length > 0 && (
          <button type="button" className={btnGhost} onClick={() => downloadText(`${videoSlug(video.name)}-coach.md`, coachReportMd(report, video.name, data.label), 'text/markdown')}>
            <Download size={16} aria-hidden="true" />
            Descargar informe
          </button>
        )}
      </div>

      {restoring ? (
        <p className="m-0 text-mute">Recuperando tu último video…</p>
      ) : !hasVideo ? (
        <NoVideo />
      ) : scan ? (
        <Scanning stage={scan.stage} done={scan.done} total={scan.total} onCancel={cancelScan} />
      ) : !videoAnalysis ? (
        <Ready name={video!.name} error={scanError} onStart={() => startScan({ startSec: 0, ball: true })} />
      ) : !report ? (
        <section className={cx(card, 'flex flex-col items-start gap-3 p-5')}>
          <h2 className="m-0 text-xl font-semibold">No pudimos medir la técnica</h2>
          <p className="m-0 max-w-[60ch] text-[15px] text-mute">{videoAnalysis.coachError ?? 'El análisis del video terminó, pero la parte de técnica no.'}</p>
          <button type="button" className={btnPrimary} onClick={() => startScan({ startSec: 0, ball: true })}>
            Volver a intentarlo
          </button>
        </section>
      ) : (
        <Report report={report} />
      )}

      <p className="m-0 border-t border-line pt-4 text-[13px] text-mute">
        {DISCLAIMER} Para analizar tu video se envían fotogramas a un servicio de visión por computadora; el video no se publica ni se comparte.
      </p>
    </main>
  )
}

function NoVideo() {
  return (
    <section className={cx(card, 'flex flex-wrap gap-x-10 gap-y-6 p-6')}>
      <div className="flex min-w-0 flex-[2_1_340px] flex-col items-start gap-3">
        <Sparkles size={28} className="text-lime" aria-hidden="true" />
        <h2 className="m-0 text-2xl leading-tight font-bold">Sube un video tuyo y te digo qué mejorar</h2>
        <p className="m-0 max-w-[52ch] text-[15px] leading-relaxed text-mute">
          Miro tus tiros, tus golpeos y cómo corres. Te muestro una foto tuya, una sola cosa para trabajar primero y un ejercicio para lograrlo.
        </p>
        <Link to="/" className={btnPrimary}>
          <Upload size={16} strokeWidth={2.2} aria-hidden="true" />
          Subir un video
        </Link>
      </div>
      <FilmTips tips={HOW_TO_FILM} className="flex-[1_1_280px]" />
    </section>
  )
}

function Ready({ name, error, onStart }: { name: string; error: string; onStart: () => void }) {
  return (
    <section className={cx(card, 'flex flex-wrap gap-x-10 gap-y-6 p-6')}>
      <div className="flex min-w-0 flex-[2_1_340px] flex-col items-start gap-3">
        <h2 className="m-0 text-2xl leading-tight font-bold">Tu video está listo para analizar</h2>
        <p className="m-0 max-w-[52ch] text-[15px] leading-relaxed text-mute">
          Primero miro el video completo. Después mido tu técnica de cerca, fotograma a fotograma. Tarda cerca de un minuto.
        </p>
        <span className="max-w-full truncate font-mono text-[13px] text-mute">{name}</span>
        <button type="button" className={btnPrimary} onClick={onStart}>
          <Sparkles size={16} strokeWidth={2.2} aria-hidden="true" />
          Analizar mi técnica
        </button>
        {error && (
          <p role="alert" className="m-0 rounded-lg border border-danger px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        )}
      </div>
      <FilmTips tips={HOW_TO_FILM} className="flex-[1_1_280px]" />
    </section>
  )
}

function Scanning({ stage, done, total, onCancel }: { stage: 'video' | 'tecnica'; done: number; total: number; onCancel: () => void }) {
  const pct = total ? Math.round((done / total) * 100) : 0
  const steps: [id: 'video' | 'tecnica', label: string][] = [
    ['video', 'Miro el video completo'],
    ['tecnica', 'Mido tu técnica de cerca'],
  ]
  return (
    <section className={cx(card, 'flex flex-col gap-4 p-6')} aria-live="polite">
      <h2 className="m-0 text-2xl leading-tight font-bold">Analizando tu video…</h2>
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {steps.map(([id, label], i) => {
          const state = id === stage ? 'now' : stage === 'tecnica' && id === 'video' ? 'done' : 'next'
          return (
            <li key={id} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <span className={cx('text-[15px] font-semibold', state === 'next' && 'text-mute')}>
                  {i + 1}. {label}
                </span>
                <span className="font-mono text-[13px] text-mute">{state === 'done' ? 'Listo' : state === 'now' ? `${pct} %` : 'En espera'}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={state === 'done' ? 100 : state === 'now' ? pct : 0}>
                <div className="h-full rounded-full bg-lime transition-[width] duration-300" style={{ width: `${state === 'done' ? 100 : state === 'now' ? pct : 0}%` }} />
              </div>
            </li>
          )
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btnGhost} onClick={onCancel}>
          Cancelar
        </button>
        <span className="text-[13px] text-mute">Puedes cambiar de pantalla: el análisis sigue.</span>
      </div>
    </section>
  )
}

function FilmTips({ tips, className }: { tips: string[]; className?: string }) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-2.5', className)}>
      <span className={cx(eyebrow, 'flex items-center gap-2')}>
        <Camera size={15} aria-hidden="true" />
        Para grabar mejor
      </span>
      <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[15px] leading-relaxed">
        {tips.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  )
}

function Report({ report }: { report: CoachReport }) {
  const [index, setIndex] = useState(0)
  const person = report.people[Math.min(index, report.people.length - 1)]

  if (!person) {
    return (
      <section className={cx(card, 'flex flex-wrap gap-x-10 gap-y-6 p-6')}>
        <div className="flex min-w-0 flex-[2_1_340px] flex-col items-start gap-3">
          <h2 className="m-0 text-xl leading-snug font-semibold">{report.empty ?? 'No reconocimos ningún gesto para analizar en este video.'}</h2>
          <p className="m-0 max-w-[52ch] text-[15px] text-mute">Prueba con otro video siguiendo estos consejos.</p>
          <Link to="/" className={btnPrimary}>
            <Upload size={16} strokeWidth={2.2} aria-hidden="true" />
            Subir otro video
          </Link>
        </div>
        <FilmTips tips={report.tips.length ? report.tips : HOW_TO_FILM} className="flex-[1_1_280px]" />
      </section>
    )
  }

  return (
    <>
      {report.people.length > 1 && (
        <div role="group" aria-label="Jugador" className="flex flex-wrap gap-2">
          {report.people.map((p, i) => (
            <button
              key={p.personId}
              type="button"
              aria-pressed={i === index}
              onClick={() => setIndex(i)}
              className={cx('flex h-14 items-center gap-2.5 rounded-xl border bg-card pr-4 pl-1.5 text-[15px] font-semibold', i === index ? 'border-lime text-ink' : 'border-line text-mute')}
            >
              {p.thumb ? <img src={p.thumb} alt="" className="h-11 w-11 rounded-lg object-cover object-top" /> : <span className="h-11 w-11 rounded-lg bg-raised" />}
              Jugador {i + 1}
            </button>
          ))}
        </div>
      )}
      <PersonReport person={person} key={person.personId} />
      {report.tips.length > 0 && (
        <section className={cx(card, 'p-5')}>
          <FilmTips tips={report.tips} />
        </section>
      )}
      <p className="m-0 font-mono text-xs text-mute">
        {report.frames.measured} fotogramas de técnica medidos de {report.frames.requested} revisados.
      </p>
    </>
  )
}

function PersonReport({ person }: { person: PersonCoach }) {
  // Sin nada que corregir, la cabecera enseña su mejor momento y propone un reto.
  const best = !person.focus ? person.good.find((f) => f.evidence?.image) : undefined
  return (
    <>
      <section aria-label="Resumen" className={cx('flex flex-wrap items-start gap-x-7 gap-y-4', best && cx(card, 'p-5'))}>
        {best?.evidence && (
          <div className="w-full max-w-[220px] shrink-0">
            <EvidencePhoto evidence={best.evidence} status="good" alt={`Tu foto en ${fmtClock(best.evidence.t)}`} />
          </div>
        )}
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-3">
          <p className="m-0 max-w-[40ch] text-[22px] leading-snug font-semibold">{person.headline}</p>
          <div className="flex flex-wrap gap-2">
            {person.actions.map((a) => (
              <Link key={a.kind} to={`/analisis?t=${Math.max(0, Math.round(a.times[0] * 10) / 10)}`} className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-card px-3 text-[13px] font-semibold text-ink no-underline">
                <Play size={12} fill="currentColor" aria-hidden="true" />
                {countNoun(a.kind, a.count)} · {a.times.slice(0, 4).map((t) => fmtClock(t)).join(', ')}
              </Link>
            ))}
          </div>
          {person.extras.map((e) => (
            <p key={e} className="m-0 text-[15px] text-mute">
              {e}
            </p>
          ))}
          {best && person.actions[0] && (
            <p className="m-0 max-w-[52ch] rounded-lg border border-line-strong bg-inset px-3.5 py-3 text-[15px] leading-relaxed">
              <b className="font-semibold text-lime">Tu siguiente reto.</b> {NEXT_CHALLENGE[person.actions[0].kind]}
            </p>
          )}
        </div>
      </section>

      {person.focus && (
        <section aria-labelledby="coach-focus" className="flex flex-col gap-3">
          <h2 id="coach-focus" className={eyebrow}>
            {person.focus.status === 'fix' ? 'Tu foco: lo primero a trabajar' : 'Tu foco: algo para probar'}
          </h2>
          <FocusCard finding={person.focus} />
        </section>
      )}

      {person.polish.length > 0 && (
        <section aria-labelledby="coach-polish" className="flex flex-col gap-3">
          <h2 id="coach-polish" className={eyebrow}>
            Para después
          </h2>
          {person.polish.map((f) => (
            <PolishCard key={f.id} finding={f} />
          ))}
        </section>
      )}

      {person.good.length > 0 && (
        <section aria-labelledby="coach-good" className="flex flex-col gap-3">
          <h2 id="coach-good" className={eyebrow}>
            Lo que ya haces bien
          </h2>
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3 p-0">
            {person.good.map((f) => (
              <GoodRow key={f.id} finding={f} />
            ))}
          </ul>
        </section>
      )}

      {person.unmeasured.length > 0 && (
        <section aria-labelledby="coach-unmeasured" className="flex flex-col gap-3">
          <h2 id="coach-unmeasured" className={cx(eyebrow, 'flex items-center gap-2')}>
            <CircleHelp size={15} aria-hidden="true" />
            Lo que no pudimos ver
          </h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {person.unmeasured.map((u) => (
              <li key={u.id} className="flex flex-wrap gap-x-2 rounded-lg border border-dashed border-line-strong px-3 py-2.5 text-[15px]">
                <span className="font-semibold">
                  {person.actions.length > 1 ? `${ACTION_LABEL[u.id.split('.')[0]] ?? ''} · ` : ''}
                  {u.label}.
                </span>
                <span className="text-mute">{u.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
