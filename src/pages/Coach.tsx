import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Play, Share2 } from 'lucide-react'
import { Measured } from '../components/Diag'
import { btnGhost, btnPrimary, card, eyebrow, PageHeader, SevTag } from '../components/ui'
import { SEV_COLOR, type Severity } from '../data/sports'
import { analysisReportMd } from '../lib/report'
import { useStore } from '../lib/store'
import { copyText, downloadText, fmtTime, slug } from '../lib/util'

const GROUPS: [Severity, string][] = [
  ['Crítico', 'Críticos'],
  ['Alerta', 'Alertas'],
  ['Correcto', 'Correctos'],
]

export default function Coach() {
  const { data } = useStore()
  const [copied, setCopied] = useState(false)
  const secsAt = (ev: number) => Math.round((data.secs * data.events[ev].pct) / 100)

  return (
    <main className="mx-auto flex max-w-[1040px] flex-col gap-6 px-5 pt-8 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader eyebrow="AI Coach · datos de ejemplo" title="Diagnóstico técnico">
          {data.match} · {data.diags.length} hallazgos detectados en el video
        </PageHeader>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={btnGhost}
            onClick={async () => {
              setCopied(await copyText(`${location.origin}/coach`))
            }}
          >
            <Share2 size={16} aria-hidden="true" />
            {copied ? 'Enlace copiado' : 'Compartir'}
          </button>
          <button type="button" className={btnPrimary} onClick={() => downloadText(`${slug(data.match)}-coach.md`, analysisReportMd(data, data.secs), 'text/markdown')}>
            <Download size={16} strokeWidth={2.2} aria-hidden="true" />
            Descargar informe
          </button>
        </div>
      </div>

      <section aria-label="Hallazgos por severidad" className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        {GROUPS.map(([sev, label]) => (
          <div key={sev} className={`${card} flex items-center justify-between gap-3 px-4 py-3.5`}>
            <span className="text-xs font-bold tracking-wider uppercase" style={{ color: SEV_COLOR[sev] }}>
              {label}
            </span>
            <span className="font-mono text-[28px] font-bold">{data.diags.filter((d) => d.sev === sev).length}</span>
          </div>
        ))}
      </section>

      {data.diags.map((d) => (
        <article key={d.id} className={`${card} flex flex-wrap gap-x-8 gap-y-5 p-5`}>
          <div className="flex min-w-0 flex-[3_1_380px] flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <SevTag sev={d.sev} />
              <span className="text-mute">{d.who}</span>
              <Link
                to={`/analisis?t=${secsAt(d.ev)}`}
                className="inline-flex h-11 items-center gap-1.5 rounded-md border border-line-strong bg-raised px-2.5 font-mono text-xs text-ink no-underline"
              >
                <Play size={12} fill="currentColor" aria-hidden="true" />
                Ver en {fmtTime(secsAt(d.ev))}
              </Link>
            </div>
            <h2 className="m-0 text-[19px] leading-snug font-semibold">{d.title}</h2>
            <Measured d={d} />
            <p className="m-0 max-w-[60ch] text-[#AEB7C0]">{d.detail}</p>
          </div>
          <div className="flex min-w-0 flex-[2_1_280px] flex-col gap-2">
            <span className={eyebrow}>Ejercicios correctivos</span>
            {d.drills.map(([name, dose]) => (
              <div key={name} className="flex justify-between gap-3 rounded-lg border border-line bg-inset px-3 py-2.5">
                <span>{name}</span>
                <span className="font-mono whitespace-nowrap text-mute">{dose}</span>
              </div>
            ))}
          </div>
        </article>
      ))}
    </main>
  )
}
