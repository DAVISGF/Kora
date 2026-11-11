import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Share2, Sparkles, Upload } from 'lucide-react'
import { btnGhost, btnPrimary, card, input, PageHeader, SampleBadge, Segmented } from '../components/ui'
import { SPORT_LIST } from '../data/sports'
import { playsReportMd } from '../lib/report'
import { useStore } from '../lib/store'
import { copyText, downloadText, fmtTime, slug } from '../lib/util'

type Status = 'idle' | 'running' | 'done'

export default function Plays() {
  const { sport, setSport, data, addHistory } = useStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [copied, setCopied] = useState(false)
  const title = name.trim() || data.match

  // No hay modelo conectado: el informe es el de ejemplo del deporte elegido.
  useEffect(() => {
    if (status !== 'running') return
    const id = setTimeout(() => {
      addHistory({
        id: `h-${Date.now()}`,
        name: title,
        sport,
        kind: 'Jugadas IA',
        when: 'Ahora',
        dur: fmtTime(data.secs),
        findings: `${data.plays.length} jugadas clave`,
      })
      setStatus('done')
    }, 1200)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  return (
    <main className="mx-auto flex max-w-[1160px] flex-col gap-6 px-5 pt-8 pb-10">
      <PageHeader eyebrow="Jugadas IA" title="Jugadas clave y ejercicios">
        Sube el video del partido y recibe un informe con las jugadas que decidieron el juego y los ejercicios para trabajarlas. Cada informe se guarda en tu historial.
      </PageHeader>

      <div className="flex flex-wrap items-start gap-5">
        <section aria-label="Nuevo informe" className={`${card} flex min-w-0 flex-[1_1_320px] flex-col gap-4 p-5`}>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-mute">Deporte</span>
            <Segmented
              label="Deporte"
              accent
              value={sport}
              onChange={(s) => {
                setSport(s)
                setStatus('idle')
              }}
              options={SPORT_LIST.map((s) => ({ id: s.id, label: s.label }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="match-name" className="text-xs text-mute">
              Nombre del partido (opcional)
            </label>
            <input id="match-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Final regional, 2.º tiempo" className={input} />
          </div>
          <div className="flex flex-col items-center gap-2.5 rounded-xl border-2 border-dashed border-line-strong bg-inset px-4 py-6 text-center">
            <Upload size={28} strokeWidth={1.8} aria-hidden="true" />
            <span className="font-semibold">{fileName ?? 'Elige el video del partido'}</span>
            <span className="text-xs text-mute">MP4, MOV o WebM</span>
            <input ref={fileRef} type="file" accept="video/*" className="sr-only" aria-label="Video del partido" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)} />
            <button type="button" className={btnGhost} onClick={() => fileRef.current?.click()}>
              {fileName ? 'Cambiar archivo' : 'Seleccionar archivo'}
            </button>
          </div>
          <button type="button" className={`${btnPrimary} h-12 text-[15px]`} disabled={status === 'running'} onClick={() => setStatus('running')}>
            <Sparkles size={18} aria-hidden="true" />
            {status === 'running' ? 'Analizando…' : 'Analizar con IA'}
          </button>
          <p className="m-0 text-xs text-mute">Aún no hay un modelo conectado: se genera el informe de ejemplo del deporte elegido.</p>
        </section>

        <section aria-label="Informe" aria-live="polite" className="flex min-w-0 flex-[2_1_480px] flex-col gap-4">
          {status !== 'done' ? (
            <div className="rounded-xl border border-dashed border-line-strong px-5 py-12 text-center text-mute">
              {status === 'running' ? 'Analizando el video…' : 'Aquí aparecerá el informe cuando termine el análisis.'}
            </div>
          ) : (
            <>
              <div className={`${card} flex flex-col gap-4 p-5`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="m-0 text-[19px] font-semibold">{title}</h2>
                      <SampleBadge>Informe de ejemplo</SampleBadge>
                    </div>
                    <Link to="/historial" className="text-[13px] text-ok">
                      Guardado en el historial
                    </Link>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={btnGhost} onClick={async () => setCopied(await copyText(`${location.origin}/jugadas`))}>
                      <Share2 size={16} aria-hidden="true" />
                      {copied ? 'Enlace copiado' : 'Compartir'}
                    </button>
                    <button type="button" className={btnGhost} onClick={() => downloadText(`${slug(title)}-jugadas.md`, playsReportMd(data, title), 'text/markdown')}>
                      <Download size={16} aria-hidden="true" />
                      Descargar
                    </button>
                  </div>
                </div>
                <p className="m-0 max-w-[68ch] text-[#AEB7C0]">{data.summary}</p>
              </div>

              <div className={`${card} flex flex-col p-5`}>
                <h3 className="m-0 mb-2 text-[15px] font-semibold">Jugadas clave</h3>
                {data.plays.map(([time, play, why]) => (
                  <div key={time} className="flex flex-wrap gap-x-4 gap-y-2 border-t border-line py-3">
                    <span className="w-[76px] shrink-0 font-mono text-[13px] font-bold text-lime">{time}</span>
                    <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-0.5">
                      <span className="font-semibold">{play}</span>
                      <span className="text-[13px] text-mute">{why}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className={`${card} flex flex-col gap-2.5 p-5`}>
                <h3 className="m-0 text-[15px] font-semibold">Ejercicios recomendados</h3>
                {data.drills.map(([drill, goal, dose]) => (
                  <div key={drill} className="flex flex-wrap justify-between gap-x-4 gap-y-1.5 rounded-lg border border-line bg-inset p-3">
                    <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-0.5">
                      <span className="font-semibold">{drill}</span>
                      <span className="text-[13px] text-mute">{goal}</span>
                    </div>
                    <span className="font-mono text-[13px] whitespace-nowrap">{dose}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  )
}
