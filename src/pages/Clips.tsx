import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Play, Share2, Trash2 } from 'lucide-react'
import { Measured } from '../components/Diag'
import { btnGhost, btnPrimary, card, PageHeader, SevTag } from '../components/ui'
import { SEV_COLOR, SPORTS, trendColor } from '../data/sports'
import { clipCsv, clipReportMd } from '../lib/report'
import { useStore, type Clip } from '../lib/store'
import { comma, copyText, cx, downloadText, slug } from '../lib/util'

const QUOTA_GB = 10

interface ExportOptions {
  report: boolean
  csv: boolean
  video: boolean
  layers: boolean
  slow: boolean
}

export default function Clips() {
  const { clips, removeClip, setSport } = useStore()
  const [selectedId, setSelectedId] = useState<string | null>(clips[0]?.id ?? null)
  const selected = clips.find((c) => c.id === selectedId) ?? clips[0] ?? null
  const usedGb = clips.reduce((sum, c) => sum + c.sizeMb, 0) / 1024
  const usedPct = Math.min(100, (usedGb / QUOTA_GB) * 100)

  return (
    <main className="mx-auto flex max-w-[1360px] flex-col gap-5 px-5 pt-7 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader eyebrow="Recortes · datos de ejemplo" title="Recortes guardados">
          Cada recorte conserva su tramo de video y el análisis de ese tramo.
        </PageHeader>
        <div className="flex min-w-60 flex-[0_1_320px] flex-col gap-1.5">
          <div className="flex justify-between gap-2 text-[13px]">
            <span className="text-mute">Almacenamiento</span>
            <span className="font-mono">
              {comma(usedGb, 2)} GB de {QUOTA_GB} GB
            </span>
          </div>
          <div role="img" aria-label={`${Math.round(usedPct)} % del almacenamiento usado`} className="h-2 rounded bg-raised">
            <div className="h-2 rounded bg-lime" style={{ width: `${Math.max(1, usedPct)}%` }} />
          </div>
          <span className="text-xs text-mute">
            {clips.length} {clips.length === 1 ? 'recorte' : 'recortes'} · guardados en este navegador
          </span>
        </div>
      </div>

      {!selected ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line-strong px-5 py-14 text-center">
          <span className="text-mute">Aún no hay recortes. Marca un tramo en el visor con el botón Recortar.</span>
          <Link to="/analisis" className={btnPrimary}>
            Ir al visor
          </Link>
        </div>
      ) : (
        <div className="flex flex-wrap items-start gap-5">
          <section aria-label="Biblioteca de recortes" className="grid min-w-0 flex-[3_1_420px] grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
            {clips.map((c) => {
              const on = c.id === selected.id
              const s = SPORTS[c.sport]
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setSelectedId(c.id)}
                  className={cx('flex flex-col overflow-hidden rounded-xl border-2 bg-card p-0 text-left text-ink', on ? 'border-lime' : 'border-line')}
                >
                  <span className="relative block aspect-video w-full" style={{ background: s.pitch }}>
                    <span className="absolute top-2 left-2 rounded border bg-bg px-1.5 py-px text-[11px] font-bold" style={{ color: s.accent, borderColor: s.accent }}>
                      {s.label}
                    </span>
                    <span className="absolute right-2 bottom-2 rounded bg-bg px-1.5 py-px font-mono text-xs">{c.dur}</span>
                    {c.slow && <span className="absolute bottom-2 left-2 rounded bg-bg px-1.5 py-px font-mono text-[11px]">0,25x</span>}
                    <Play size={32} fill="currentColor" aria-hidden="true" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                  </span>
                  <span className="flex flex-col gap-1 p-3">
                    <span className="text-[15px] font-semibold">{c.name}</span>
                    <span className="text-xs text-mute">{c.source}</span>
                    <span className="font-mono text-xs text-mute">
                      {c.range} · {c.sizeMb} MB
                    </span>
                    <span className="text-xs font-semibold" style={{ color: SEV_COLOR[c.sev] }}>
                      {c.sev} · {c.diag}
                    </span>
                  </span>
                </button>
              )
            })}
          </section>

          <ClipDetail
            key={selected.id}
            clip={selected}
            onOpen={() => setSport(selected.sport)}
            onDelete={() => {
              removeClip(selected.id)
              setSelectedId(null)
            }}
          />
        </div>
      )}
    </main>
  )
}

function ClipDetail({ clip, onOpen, onDelete }: { clip: Clip; onOpen: () => void; onDelete: () => void }) {
  const [opts, setOpts] = useState<ExportOptions>({ report: true, csv: false, video: false, layers: false, slow: false })
  const [status, setStatus] = useState('')
  const [confirming, setConfirming] = useState(false)
  const base = slug(clip.name)
  const set = (k: keyof ExportOptions) => setOpts({ ...opts, [k]: !opts[k] })

  const runExport = () => {
    const done: string[] = []
    if (opts.report) {
      downloadText(`${base}-analisis.md`, clipReportMd(clip), 'text/markdown')
      done.push('informe')
    }
    if (opts.csv) {
      downloadText(`${base}-fases.csv`, clipCsv(clip), 'text/csv')
      done.push('datos')
    }
    setStatus(done.length ? `Descargado: ${done.join(' y ')}.` : 'Elige al menos el informe o los datos.')
  }

  const check = 'flex min-h-11 items-center gap-2.5'
  const fmt = 'font-mono text-xs text-mute'

  return (
    <section aria-label="Recorte seleccionado" className="flex min-w-0 flex-[2_1_400px] flex-col gap-3.5">
      <div className={`${card} flex flex-col gap-3 p-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="m-0 text-[19px] font-semibold">{clip.name}</h2>
            <span className="text-[13px] text-mute">
              {clip.source} · {clip.range}
            </span>
          </div>
          <div className="flex gap-2">
            <Link to="/analisis" onClick={onOpen} className={btnGhost}>
              Abrir en el visor
            </Link>
            {confirming ? (
              <button type="button" className={`${btnGhost} border-danger text-danger`} onClick={onDelete} onBlur={() => setConfirming(false)}>
                Confirmar
              </button>
            ) : (
              <button type="button" aria-label="Eliminar recorte" className={`${btnGhost} w-11 px-0`} onClick={() => setConfirming(true)}>
                <Trash2 size={18} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {clip.kpis.map(([label, value]) => (
            <div key={label} className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line bg-inset p-2.5">
              <span className="text-[11px] tracking-wide text-mute uppercase">{label}</span>
              <span className="font-mono text-lg font-bold">{value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={`${card} flex flex-col p-4`}>
        <h3 className="m-0 mb-2.5 text-[15px] font-semibold">Análisis en cámara lenta</h3>
        {clip.phases.map((f) => (
          <div key={f.name} className="grid grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)] items-center gap-2.5 border-t border-line py-2">
            <span className="font-semibold">{f.name}</span>
            <span className="font-mono text-[13px] text-mute">{f.dur}</span>
            <span className="text-right font-mono text-[13px]" style={{ color: trendColor(f.state) }}>
              {f.metric} · {f.state > 0 ? 'en rango' : f.state < 0 ? 'fuera' : 'justo'}
            </span>
          </div>
        ))}
      </div>

      <div className={`${card} flex flex-col gap-2.5 p-4`}>
        <div className="flex flex-wrap items-center gap-2">
          <SevTag sev={clip.sev} />
          <span className="text-[13px] text-mute">AI Coach · {clip.who}</span>
        </div>
        <h3 className="m-0 text-base leading-snug font-semibold">{clip.diag}</h3>
        <Measured d={clip} small />
        <div className="flex justify-between gap-3 rounded-lg border border-line bg-inset px-3 py-2.5">
          <span>{clip.drill[0]}</span>
          <span className="font-mono whitespace-nowrap text-mute">{clip.drill[1]}</span>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-line-strong bg-card p-4">
        <h3 className="m-0 text-[15px] font-semibold">Exportar recorte con su análisis</h3>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-4 gap-y-1">
          <label className={check}>
            <input type="checkbox" checked={opts.report} onChange={() => set('report')} />
            <span>
              Informe del análisis <span className={fmt}>MD</span>
            </span>
          </label>
          <label className={check}>
            <input type="checkbox" checked={opts.csv} onChange={() => set('csv')} />
            <span>
              Datos de fases y ángulos <span className={fmt}>CSV</span>
            </span>
          </label>
          <label className={cx(check, 'text-mute')}>
            <input type="checkbox" checked={opts.video} onChange={() => set('video')} disabled />
            <span>
              Video del recorte <span className={fmt}>MP4</span>
            </span>
          </label>
          <label className={cx(check, 'text-mute')}>
            <input type="checkbox" checked={opts.layers} onChange={() => set('layers')} disabled />
            <span>Capas superpuestas en el video</span>
          </label>
          <label className={cx(check, 'text-mute')}>
            <input type="checkbox" checked={opts.slow} onChange={() => set('slow')} disabled />
            <span>
              Versión en cámara lenta <span className={fmt}>0,25x</span>
            </span>
          </label>
        </div>
        <p className="m-0 text-xs text-mute">Las opciones de video necesitan el servicio de render, aún no conectado.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${btnPrimary} h-12 flex-[1_1_200px] text-[15px]`} onClick={runExport}>
            <Download size={18} strokeWidth={2.2} aria-hidden="true" />
            Exportar recorte
          </button>
          <button
            type="button"
            className={`${btnGhost} h-12 text-[15px]`}
            onClick={async () => setStatus((await copyText(`${location.origin}/recortes`)) ? 'Enlace copiado.' : 'No se pudo copiar el enlace.')}
          >
            <Share2 size={16} aria-hidden="true" />
            Compartir enlace
          </button>
        </div>
        <span role="status" className="min-h-5 text-[13px] text-ok">
          {status}
        </span>
      </div>
    </section>
  )
}
