import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Share2 } from 'lucide-react'
import { btnGhost, card, input, PageHeader, Segmented } from '../components/ui'
import { SPORTS, type SportId } from '../data/sports'
import { analysisReportMd, playsReportMd } from '../lib/report'
import { useStore, type HistoryItem } from '../lib/store'
import { copyText, downloadText, slug } from '../lib/util'

type Filter = 'all' | SportId

const iconBtn = 'inline-flex h-11 w-11 items-center justify-center rounded-lg border border-line-strong bg-raised text-ink'

export default function HistoryPage() {
  const { history, setSport } = useStore()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const q = query.trim().toLowerCase()
  const rows = history.filter((h) => (filter === 'all' || h.sport === filter) && (!q || h.name.toLowerCase().includes(q)))
  const path = (h: HistoryItem) => (h.kind === 'Jugadas IA' ? '/jugadas' : '/analisis')

  const open = (h: HistoryItem) => {
    setSport(h.sport)
    navigate(path(h))
  }

  const download = (h: HistoryItem) => {
    const data = SPORTS[h.sport]
    const md = h.kind === 'Jugadas IA' ? playsReportMd(data, h.name) : analysisReportMd(data, data.secs, h.name)
    downloadText(`${slug(h.name)}-${h.kind === 'Jugadas IA' ? 'jugadas' : 'informe'}.md`, md, 'text/markdown')
  }

  return (
    <main className="mx-auto flex max-w-[1160px] flex-col gap-5 px-5 pt-8 pb-10">
      <PageHeader eyebrow="Historial · datos de ejemplo" title="Análisis guardados" />

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Filtrar por deporte"
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'all', label: 'Todos' },
            { id: 'basket', label: 'Baloncesto' },
            { id: 'futbol', label: 'Fútbol' },
          ]}
        />
        <label htmlFor="history-search" className="sr-only">
          Buscar por nombre del partido
        </label>
        <input
          id="history-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre del partido"
          className={`${input} flex-[1_1_240px]`}
        />
        <span className="text-[13px] text-mute">{rows.length} análisis</span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-strong px-5 py-12 text-center text-mute">
          Ningún análisis coincide con el filtro. Prueba con otro nombre o deporte.
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((h) => {
            const color = SPORTS[h.sport].accent
            return (
              <article key={h.id} className={`${card} flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3.5`}>
                <div className="flex min-w-0 flex-[3_1_280px] flex-col gap-1">
                  <span className="text-base font-semibold">{h.name}</span>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded border px-2 py-px font-bold" style={{ color, borderColor: color }}>
                      {SPORTS[h.sport].label}
                    </span>
                    <span className="rounded border border-line-strong px-2 py-px">{h.kind}</span>
                    <span className="text-mute">{h.when}</span>
                  </div>
                </div>
                <div className="flex flex-[1_1_110px] flex-col gap-0.5">
                  <span className="text-xs text-mute">Duración</span>
                  <span className="font-mono">{h.dur}</span>
                </div>
                <div className="flex flex-[1_1_150px] flex-col gap-0.5">
                  <span className="text-xs text-mute">Hallazgos</span>
                  <span className="font-mono">{h.findings}</span>
                </div>
                <div className="flex gap-2">
                  <button type="button" className={btnGhost} onClick={() => open(h)}>
                    Abrir
                  </button>
                  <button
                    type="button"
                    className={iconBtn}
                    aria-label={`Copiar enlace de ${h.name}`}
                    title={copiedId === h.id ? 'Enlace copiado' : 'Copiar enlace'}
                    onClick={async () => {
                      if (await copyText(`${location.origin}${path(h)}`)) setCopiedId(h.id)
                    }}
                  >
                    <Share2 size={18} aria-hidden="true" className={copiedId === h.id ? 'text-ok' : undefined} />
                  </button>
                  <button type="button" className={iconBtn} aria-label={`Descargar informe de ${h.name}`} title="Descargar informe" onClick={() => download(h)}>
                    <Download size={18} aria-hidden="true" />
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </main>
  )
}
