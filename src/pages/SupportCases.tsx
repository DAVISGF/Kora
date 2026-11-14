// Panel del usuario: «Mis Casos de Soporte». Casos activos e históricos, hilo sincronizado
// (web + WhatsApp), confirmación de la respuesta de Kilo IA, comentarios y adjuntos.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Inbox, LifeBuoy, MessageCircle, Plus, RefreshCw, UserRound } from 'lucide-react'
import { isTerminal } from '../../server/helpdesk/status'
import { btnGhost, btnPrimary, card, PageHeader } from '../components/ui'
import { customerApi, type CustomerTicketView, type PublicTicket } from '../helpdesk/api'
import { openKiloWidget } from '../helpdesk/KiloWidget'
import { ChannelTag, Composer, CustomerStatusBadge, EmptyState, relTime, Thread } from '../helpdesk/ui'
import { cx } from '../lib/util'

const STATUS_HELP: Record<string, string> = {
  Abierto: 'Kilo IA está atendiendo tu consulta.',
  'En Revisión': 'Una persona del equipo de Kilora está revisando tu caso. Te responderemos aquí y por WhatsApp si escribiste por ahí.',
  'Esperando tu respuesta': 'Necesitamos que nos respondas para continuar.',
  Resuelto: 'Este caso está resuelto. Si vuelves a escribir, lo reabrimos.',
}

export default function SupportCases() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [items, setItems] = useState<PublicTicket[] | null>(null)
  const [tab, setTab] = useState<'active' | 'history'>('active')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setItems((await customerApi.list()).items)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar tus casos')
    }
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(load, 15_000)
    const onChange = () => void load()
    window.addEventListener('kilora:tickets-changed', onChange)
    return () => {
      clearInterval(t)
      window.removeEventListener('kilora:tickets-changed', onChange)
    }
  }, [load])

  const visible = useMemo(() => (items ?? []).filter((t) => (tab === 'active' ? !isTerminal(t.status) : isTerminal(t.status))), [items, tab])
  const activeCount = (items ?? []).filter((t) => !isTerminal(t.status)).length

  return (
    <div className="flex flex-col gap-5 p-5 md:p-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader eyebrow="Soporte" title="Mis casos de soporte">
          Sigue tus consultas con Kilo IA y con nuestro equipo. Lo que escribas por WhatsApp aparece aquí también.
        </PageHeader>
        <button type="button" className={btnPrimary} onClick={() => openKiloWidget()}>
          <Plus size={18} strokeWidth={2.4} aria-hidden="true" />
          Nueva consulta
        </button>
      </div>

      {error && (
        <p role="alert" className="m-0 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(280px,380px)_1fr]">
        <section aria-label="Lista de casos" className={cx(card, 'flex min-h-[420px] flex-col', id && 'hidden lg:flex')}>
          <div role="tablist" aria-label="Filtrar casos" className="flex gap-1 border-b border-line p-2">
            {(
              [
                ['active', `Activos${items ? ` (${activeCount})` : ''}`],
                ['history', 'Históricos'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                type="button"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={cx('h-9 flex-1 rounded-md text-sm font-semibold', tab === k ? 'bg-raised text-ink' : 'text-mute')}
              >
                {label}
              </button>
            ))}
          </div>
          {items === null ? (
            <p className="m-0 p-5 text-mute">Cargando…</p>
          ) : visible.length === 0 ? (
            <EmptyState icon={<Inbox size={36} />} title={tab === 'active' ? 'No tienes casos abiertos' : 'Aún no tienes casos resueltos'}>
              {tab === 'active' && 'Si tienes una duda, pregúntale a Kilo IA. Si hace falta, te deriva con una persona.'}
            </EmptyState>
          ) : (
            <ul className="m-0 list-none divide-y divide-line p-0">
              {visible.map((t) => (
                <li key={t.id}>
                  <Link
                    to={`/soporte/${t.id}`}
                    aria-current={t.id === id ? 'page' : undefined}
                    className={cx('flex flex-col gap-1.5 px-4 py-3 text-ink no-underline hover:bg-raised', t.id === id && 'bg-raised')}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-mute">{t.code}</span>
                      <CustomerStatusBadge status={t.status} />
                    </div>
                    <span className="font-semibold [overflow-wrap:anywhere]">{t.subject}</span>
                    <div className="flex items-center gap-3 text-xs text-mute">
                      <ChannelTag channel={t.activeChannel} />
                      <span>{relTime(t.lastMessageAt)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Detalle del caso" className={cx(card, 'min-h-[420px]', !id && 'hidden lg:block')}>
          {id ? (
            <CaseDetail id={id} onBack={() => navigate('/soporte')} onChanged={load} />
          ) : (
            <EmptyState icon={<LifeBuoy size={40} />} title="Elige un caso para ver la conversación" />
          )}
        </section>
      </div>
    </div>
  )
}

function CaseDetail({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const [view, setView] = useState<CustomerTicketView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setView(await customerApi.get(id))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el caso')
    }
  }, [id])

  useEffect(() => {
    setView(null)
    void load()
    // Sincroniza respuestas que llegan desde la consola o desde WhatsApp.
    const t = setInterval(load, 8_000)
    return () => clearInterval(t)
  }, [load])

  async function act(fn: () => Promise<CustomerTicketView>) {
    setBusy(true)
    try {
      setView(await fn())
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  if (error) return <p className="m-0 p-5 text-danger">{error}</p>
  if (!view) return <p className="m-0 p-5 text-mute">Cargando…</p>
  const { ticket, messages } = view

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-2 border-b border-line p-4">
        <button type="button" onClick={onBack} className="inline-flex w-fit items-center gap-1 text-sm text-mute lg:hidden">
          <ArrowLeft size={16} aria-hidden="true" /> Volver a mis casos
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-mute">{ticket.code}</span>
          <CustomerStatusBadge status={ticket.status} />
          <ChannelTag channel={ticket.originChannel} />
          <button type="button" onClick={() => void load()} aria-label="Actualizar" className="ml-auto grid size-9 place-items-center rounded-md text-mute hover:text-ink">
            <RefreshCw size={16} />
          </button>
        </div>
        <h2 className="m-0 text-lg font-bold [overflow-wrap:anywhere]">{ticket.subject}</h2>
        <p className="m-0 text-sm text-mute">{STATUS_HELP[ticket.statusLabel]}</p>
      </header>

      <div className="flex-1 overflow-y-auto p-4" aria-live="polite">
        <Thread
          viewer="customer"
          items={messages.map((m) => ({ ...m, authorType: m.authorType }))}
        />
      </div>

      {ticket.awaitingConfirmation && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-raised/40 px-4 py-3">
          <span className="mr-auto text-sm font-semibold">¿Kilo IA resolvió tu consulta?</span>
          <button type="button" disabled={busy} className={cx(btnPrimary, 'h-10 text-sm')} onClick={() => act(() => customerApi.confirm(ticket.id, true))}>
            <CheckCircle2 size={16} aria-hidden="true" /> Sí, resuelto
          </button>
          <button type="button" disabled={busy} className={cx(btnGhost, 'h-10 text-sm')} onClick={() => act(() => customerApi.confirm(ticket.id, false))}>
            <UserRound size={16} aria-hidden="true" /> No, hablar con una persona
          </button>
        </div>
      )}

      <div className="border-t border-line p-4">
        {isTerminal(ticket.status) && (
          <p className="m-0 mb-2 flex items-center gap-1.5 text-xs text-mute">
            <MessageCircle size={14} aria-hidden="true" /> Si escribes, el caso se reabre.
          </p>
        )}
        <Composer
          label="Comentario"
          busy={busy}
          placeholder="Escribe un comentario o adjunta un archivo…"
          onSend={(text, files) => act(() => customerApi.reply(ticket.id, text, files))}
        />
      </div>
    </div>
  )
}
