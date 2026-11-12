// Kilora Admin Console · Helpdesk: bandeja unificada, detalle del caso con el hilo completo
// de Kilo IA, datos del cliente/flota o del lead, y respuesta omnicanal. Alertas en tiempo real (SSE).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  Bot,
  Building2,
  Filter,
  Headset,
  Inbox,
  MessageCircle,
  Phone,
  RefreshCw,
  Search,
  Sparkles,
  Truck,
  UserRound,
} from 'lucide-react'
import { REASON_LABEL } from '../../../server/helpdesk/escalation'
import { AGENT_STATUS, PRIORITY_LABEL } from '../../../server/helpdesk/status'
import type { EscalationReason } from '../../../server/helpdesk/types'
import { card, eyebrow, input } from '../../components/ui'
import { agentApi, type AgentTicketView, type Channel, type ConsoleAlert, type InboxCounts, type InboxQuery, type Ticket, type TicketPriority, type TicketStatus } from '../../helpdesk/api'
import { AgentStatusBadge, ChannelTag, Composer, EmptyState, fmtDate, PriorityTag, relTime, Thread } from '../../helpdesk/ui'
import { cx } from '../../lib/util'

const STATUS_FILTERS: { id: string; label: string; status: TicketStatus[] }[] = [
  { id: 'needs', label: 'Requieren humano', status: ['ESCALATED_TO_HUMAN', 'IN_REVIEW'] },
  { id: 'escalated', label: 'Escalados', status: ['ESCALATED_TO_HUMAN'] },
  { id: 'review', label: 'En revisión', status: ['IN_REVIEW'] },
  { id: 'waiting', label: 'Esperando cliente', status: ['WAITING_CUSTOMER'] },
  { id: 'ai', label: 'Kilo IA atendiendo', status: ['OPEN'] },
  { id: 'resolved', label: 'Resueltos', status: ['RESOLVED_BY_AI', 'RESOLVED', 'CLOSED'] },
  { id: 'all', label: 'Todos', status: [] },
]
const PRIORITIES: TicketPriority[] = ['URGENT', 'HIGH', 'NORMAL', 'LOW']

export default function HelpdeskConsole() {
  const { code } = useParams()
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState('needs')
  const [priority, setPriority] = useState<TicketPriority[]>([])
  const [channel, setChannel] = useState<Channel | ''>('')
  const [requester, setRequester] = useState<'' | 'USER' | 'LEAD'>('')
  const [mine, setMine] = useState(false)
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [items, setItems] = useState<Ticket[] | null>(null)
  const [counts, setCounts] = useState<InboxCounts | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [alerts, setAlerts] = useState<ConsoleAlert[]>([])
  const [toasts, setToasts] = useState<ConsoleAlert[]>([])
  const [refreshKey, setRefreshKey] = useState(0)
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])

  const query: InboxQuery = useMemo(
    () => ({
      status: STATUS_FILTERS.find((s) => s.id === statusFilter)?.status,
      priority,
      channel: channel ? [channel] : [],
      requester,
      assignee: mine ? 'me' : '',
      q: debouncedQ,
    }),
    [statusFilter, priority, channel, requester, mine, debouncedQ],
  )

  const load = useCallback(async () => {
    try {
      const r = await agentApi.inbox(query)
      setItems(r.items)
      setCounts(r.counts)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la bandeja')
    }
  }, [query])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  // Alertas en tiempo real
  const lastId = useRef(0)
  useEffect(() => {
    let es: EventSource | null = null
    let first = true
    const connect = () => {
      es = new EventSource(agentApi.streamUrl(lastId.current))
      es.addEventListener('alert', (ev) => {
        const a = JSON.parse((ev as MessageEvent).data) as ConsoleAlert
        lastId.current = Math.max(lastId.current, a.id)
        setAlerts((xs) => (xs.some((x) => x.id === a.id) ? xs : [a, ...xs].slice(0, 50)))
        // Al conectar llegan las alertas antiguas: sólo se anuncian las nuevas.
        if (!first && !a.readAt) {
          setToasts((xs) => [a, ...xs].slice(0, 3))
          setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== a.id)), 9000)
        }
        setRefreshKey((k) => k + 1)
      })
      es.addEventListener('open', () => setTimeout(() => (first = false), 1500))
    }
    connect()
    return () => es?.close()
  }, [])

  const unread = alerts.filter((a) => !a.readAt).length
  useEffect(() => {
    document.title = unread ? `(${unread}) Helpdesk · Kilora` : 'Helpdesk · Kilora'
  }, [unread])

  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-card px-5 py-3">
        <span className="grid size-8 place-items-center rounded-lg bg-lime text-lime-ink">
          <Headset size={18} aria-hidden="true" />
        </span>
        <div className="flex flex-col leading-tight">
          <span className="text-xs tracking-widest text-mute uppercase">Kilora Admin Console</span>
          <span className="font-bold">Helpdesk</span>
        </div>
        {counts && (
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0 text-xs">
            <Counter label="Escalados" n={counts.escalated} tone="text-danger" onClick={() => setStatusFilter('escalated')} />
            <Counter label="En revisión" n={counts.inReview} tone="text-zone" onClick={() => setStatusFilter('review')} />
            <Counter label="Esperando cliente" n={counts.waiting} tone="text-warn" onClick={() => setStatusFilter('waiting')} />
            <Counter label="Kilo IA" n={counts.aiHandling} tone="text-info" onClick={() => setStatusFilter('ai')} />
            {counts.unassignedUrgent > 0 && <Counter label="Urgentes sin asignar" n={counts.unassignedUrgent} tone="text-danger" onClick={() => setPriority(['URGENT'])} />}
          </ul>
        )}
        <div className="grow" />
        <AlertsMenu
          alerts={alerts}
          unread={unread}
          onOpen={(a) => navigate(`/admin/soporte/${a.payload.code}`)}
          onReadAll={async () => {
            const ids = alerts.filter((a) => !a.readAt).map((a) => a.id)
            if (!ids.length) return
            await agentApi.markRead(ids)
            setAlerts((xs) => xs.map((a) => ({ ...a, readAt: a.readAt ?? new Date().toISOString() })))
          }}
        />
        <Link to="/" className="text-sm text-mute">
          Volver a la app
        </Link>
      </header>

      <div className="grid flex-1 gap-0 lg:grid-cols-[minmax(320px,420px)_1fr]">
        {/* ------------------------------------------------------------ Bandeja */}
        <section aria-label="Bandeja de entrada" className={cx('flex min-w-0 flex-col border-line lg:border-r', code && 'hidden lg:flex')}>
          <div className="flex flex-col gap-2 border-b border-line p-3">
            <div className="flex gap-2">
              <label className="relative flex-1">
                <span className="sr-only">Buscar casos</span>
                <Search size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-mute" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código, asunto, teléfono, email…" className={cx(input, 'w-full pl-9')} />
              </label>
              <button
                type="button"
                aria-expanded={showFilters}
                aria-controls="inbox-filters"
                onClick={() => setShowFilters((v) => !v)}
                className={cx('inline-flex h-11 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold', showFilters ? 'border-lime text-lime' : 'border-line-strong')}
              >
                <Filter size={16} aria-hidden="true" /> Filtros
              </button>
            </div>
            <div role="group" aria-label="Estado" className="flex gap-1 overflow-x-auto pb-1">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={statusFilter === s.id}
                  onClick={() => setStatusFilter(s.id)}
                  className={cx('h-8 shrink-0 rounded-full border px-3 text-xs font-semibold', statusFilter === s.id ? 'border-lime bg-lime/10 text-lime' : 'border-line-strong text-mute')}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {showFilters && (
              <div id="inbox-filters" className="grid grid-cols-2 gap-2 text-sm">
                <fieldset className="col-span-2 m-0 flex flex-wrap gap-1 border-0 p-0">
                  <legend className={cx(eyebrow, 'mb-1')}>Prioridad</legend>
                  {PRIORITIES.map((p) => (
                    <label key={p} className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-line-strong px-2">
                      <input type="checkbox" checked={priority.includes(p)} onChange={(e) => setPriority(e.target.checked ? [...priority, p] : priority.filter((x) => x !== p))} />
                      {PRIORITY_LABEL[p]}
                    </label>
                  ))}
                </fieldset>
                <label className="flex flex-col gap-1">
                  <span className={eyebrow}>Canal de origen</span>
                  <select value={channel} onChange={(e) => setChannel(e.target.value as Channel | '')} className={cx(input, 'h-10')}>
                    <option value="">Todos</option>
                    <option value="WHATSAPP">WhatsApp</option>
                    <option value="WEB">Web / App</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className={eyebrow}>Solicitante</span>
                  <select value={requester} onChange={(e) => setRequester(e.target.value as '' | 'USER' | 'LEAD')} className={cx(input, 'h-10')}>
                    <option value="">Clientes y leads</option>
                    <option value="USER">Clientes</option>
                    <option value="LEAD">Leads</option>
                  </select>
                </label>
                <label className="col-span-2 inline-flex items-center gap-2">
                  <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Sólo asignados a mí
                </label>
              </div>
            )}
          </div>

          {error && (
            <p role="alert" className="m-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          {items === null ? (
            <p className="m-0 p-5 text-mute">Cargando…</p>
          ) : items.length === 0 ? (
            <EmptyState icon={<Inbox size={36} />} title="No hay casos con estos filtros" />
          ) : (
            <ul className="m-0 flex-1 list-none divide-y divide-line overflow-y-auto p-0">
              {items.map((t) => (
                <li key={t.id}>
                  <Link
                    to={`/admin/soporte/${t.code}`}
                    aria-current={t.code === code ? 'page' : undefined}
                    className={cx(
                      'flex flex-col gap-1.5 border-l-[3px] px-4 py-3 text-ink no-underline hover:bg-raised',
                      t.code === code ? 'bg-raised' : '',
                      t.status === 'ESCALATED_TO_HUMAN' ? 'border-l-danger' : t.priority === 'URGENT' ? 'border-l-warn' : 'border-l-transparent',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-mute">{t.code}</span>
                      <RequesterChip type={t.requesterType} />
                      <span className="ml-auto text-xs text-mute">{relTime(t.lastMessageAt)}</span>
                    </div>
                    <span className="font-semibold [overflow-wrap:anywhere]">{t.subject}</span>
                    <span className="truncate text-xs text-mute">
                      {t.requesterType === 'LEAD' ? `${t.leadName ?? 'Lead'} · ${t.leadPhone}` : (t.contactEmail ?? t.contactPhone ?? 'Cliente')}
                    </span>
                    <div className="flex flex-wrap items-center gap-3">
                      <AgentStatusBadge status={t.status} />
                      <PriorityTag priority={t.priority} />
                      <ChannelTag channel={t.originChannel} />
                      {t.assigneeName && <span className="text-xs text-mute">· {t.assigneeName}</span>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ------------------------------------------------------------ Detalle */}
        <section aria-label="Detalle del caso" className={cx('min-w-0', !code && 'hidden lg:block')}>
          {code ? (
            <TicketDetail key={code} code={code} refreshKey={refreshKey} onChanged={() => setRefreshKey((k) => k + 1)} onBack={() => navigate('/admin/soporte')} />
          ) : (
            <EmptyState icon={<Headset size={40} />} title="Selecciona un caso de la bandeja">
              Los casos escalados por Kilo IA aparecen primero, con su resumen listo.
            </EmptyState>
          )}
        </section>
      </div>

      <div aria-live="assertive" className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(380px,calc(100vw-32px))] flex-col gap-2">
        {toasts.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => navigate(`/admin/soporte/${a.payload.code}`)}
            className={cx(card, 'pointer-events-auto flex gap-3 border-l-4 p-3 text-left shadow-xl shadow-black/50', a.kind === 'escalation' ? 'border-l-danger' : 'border-l-info')}
          >
            {a.kind === 'escalation' ? <AlertTriangle size={20} className="shrink-0 text-danger" aria-hidden="true" /> : <MessageCircle size={20} className="shrink-0 text-info" aria-hidden="true" />}
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-semibold">{alertTitle(a)}</span>
              <span className="truncate text-xs text-mute">{a.payload.requesterLabel}</span>
              <span className="line-clamp-2 text-sm">{a.payload.summary}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

const alertTitle = (a: ConsoleAlert) =>
  a.kind === 'escalation' ? `Escalado ${a.payload.code} · ${PRIORITY_LABEL[a.payload.priority]}` : a.kind === 'new_lead' ? `Nuevo lead ${a.payload.code}` : `El cliente respondió ${a.payload.code}`

function Counter({ label, n, tone, onClick }: { label: string; n: number; tone: string; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line-strong px-3">
        <span className={cx('font-bold tabular-nums', tone)}>{n}</span>
        <span className="text-mute">{label}</span>
      </button>
    </li>
  )
}

function RequesterChip({ type }: { type: 'USER' | 'LEAD' }) {
  return type === 'LEAD' ? (
    <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-warn uppercase">Lead</span>
  ) : (
    <span className="rounded bg-info/15 px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-info uppercase">Cliente</span>
  )
}

function AlertsMenu({ alerts, unread, onOpen, onReadAll }: { alerts: ConsoleAlert[]; unread: number; onOpen: (a: ConsoleAlert) => void; onReadAll: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button type="button" aria-expanded={open} aria-label={`Alertas${unread ? `, ${unread} sin leer` : ''}`} onClick={() => setOpen((v) => !v)} className="relative grid size-10 place-items-center rounded-lg border border-line-strong">
        <Bell size={18} />
        {unread > 0 && <span className="absolute -top-1 -right-1 min-w-5 rounded-full bg-danger px-1 text-center text-[11px] leading-5 font-bold text-white">{unread}</span>}
      </button>
      {open && (
        <div className={cx(card, 'absolute right-0 z-40 mt-2 w-[min(380px,calc(100vw-32px))] shadow-xl shadow-black/50')}>
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="font-semibold">Alertas</span>
            <button type="button" onClick={onReadAll} className="text-xs text-lime">
              Marcar todas como leídas
            </button>
          </div>
          {alerts.length === 0 ? (
            <p className="m-0 p-4 text-sm text-mute">Sin alertas.</p>
          ) : (
            <ul className="m-0 max-h-[60vh] list-none divide-y divide-line overflow-y-auto p-0">
              {alerts.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false)
                      onOpen(a)
                    }}
                    className={cx('flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-raised', !a.readAt && 'bg-raised/40')}
                  >
                    <span className="text-sm font-semibold">{alertTitle(a)}</span>
                    <span className="truncate text-xs text-mute">{a.payload.summary}</span>
                    <span className="text-xs text-mute">{relTime(a.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------

function TicketDetail({ code, refreshKey, onChanged, onBack }: { code: string; refreshKey: number; onChanged: () => void; onBack: () => void }) {
  const [view, setView] = useState<AgentTicketView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'reply' | 'note'>('reply')
  const [via, setVia] = useState<'auto' | 'web' | 'whatsapp' | 'both'>('auto')
  const [next, setNext] = useState<'WAITING_CUSTOMER' | 'IN_REVIEW' | 'RESOLVED'>('WAITING_CUSTOMER')

  const load = useCallback(async () => {
    try {
      setView(await agentApi.get(code))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el caso')
    }
  }, [code])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  async function act(fn: () => Promise<AgentTicketView>) {
    setBusy(true)
    try {
      setView(await fn())
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo completar la acción')
    } finally {
      setBusy(false)
    }
  }

  if (error && !view) return <p className="m-0 p-5 text-danger">{error}</p>
  if (!view) return <p className="m-0 p-5 text-mute">Cargando…</p>
  const { ticket: t, messages, requester, delivery } = view
  const s = t.aiSummary
  const resolvedTarget = via === 'auto' ? delivery.defaultChannel : via === 'web' ? 'WEB' : 'WHATSAPP'

  return (
    <div className="flex flex-col">
      <header className="flex flex-col gap-3 border-b border-line p-4">
        <button type="button" onClick={onBack} className="inline-flex w-fit items-center gap-1 text-sm text-mute lg:hidden">
          <ArrowLeft size={16} aria-hidden="true" /> Bandeja
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-mute">{t.code}</span>
          <RequesterChip type={t.requesterType} />
          <AgentStatusBadge status={t.status} />
          <PriorityTag priority={t.priority} />
          <ChannelTag channel={t.originChannel} />
          <span className="text-xs text-mute">Creado {fmtDate(t.createdAt)}</span>
          <button type="button" onClick={() => void load()} aria-label="Actualizar" className="ml-auto grid size-9 place-items-center rounded-md text-mute hover:text-ink">
            <RefreshCw size={16} />
          </button>
        </div>
        <h1 className="m-0 text-xl font-bold [overflow-wrap:anywhere]">{t.subject}</h1>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className={eyebrow}>Estado</span>
            <select value={t.status} disabled={busy} onChange={(e) => act(() => agentApi.patch(t.id, { status: e.target.value as TicketStatus }))} className={cx(input, 'h-10')}>
              {(['ESCALATED_TO_HUMAN', 'IN_REVIEW', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED', 'OPEN', 'RESOLVED_BY_AI'] as TicketStatus[]).map((st) => (
                <option key={st} value={st}>
                  {AGENT_STATUS[st]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={eyebrow}>Prioridad</span>
            <select value={t.priority} disabled={busy} onChange={(e) => act(() => agentApi.patch(t.id, { priority: e.target.value as TicketPriority }))} className={cx(input, 'h-10')}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1">
            <span className={eyebrow}>Asignado</span>
            <div className="flex h-10 items-center gap-2">
              <span className="text-sm">{t.assigneeName ?? 'Sin asignar'}</span>
              {t.assigneeId ? (
                <button type="button" disabled={busy} onClick={() => act(() => agentApi.patch(t.id, { assignee: null }))} className="text-xs text-mute underline">
                  Liberar
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={() => act(() => agentApi.patch(t.id, { assignee: 'me' }))} className="h-8 rounded-md border border-line-strong px-2 text-xs font-semibold">
                  Tomar caso
                </button>
              )}
            </div>
          </div>
          {t.handledBy === 'HUMAN' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => act(() => agentApi.patch(t.id, { handBackToAI: true }))}
              className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-sm"
              title="Kilo IA vuelve a responder los próximos mensajes del cliente"
            >
              <Bot size={16} aria-hidden="true" /> Devolver a Kilo IA
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="m-0 text-sm text-danger">
            {error}
          </p>
        )}
      </header>

      <div className="grid gap-4 p-4 xl:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          {s && (
            <section aria-label="Resumen de Kilo IA" className={cx(card, 'flex flex-col gap-2 border-zone/40 p-4')}>
              <h2 className="m-0 flex items-center gap-2 text-sm font-bold">
                <Sparkles size={16} className="text-zone" aria-hidden="true" /> Resumen ejecutivo de Kilo IA
              </h2>
              <p className="m-0 font-semibold">{s.headline}</p>
              <dl className="m-0 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[max-content_1fr]">
                <dt className="text-mute">Problema</dt>
                <dd className="m-0">{s.problem}</dd>
                <dt className="text-mute">Contexto</dt>
                <dd className="m-0">{s.customer_context}</dd>
                <dt className="text-mute">Qué intentó la IA</dt>
                <dd className="m-0">{s.ai_attempts}</dd>
                <dt className="text-mute">Ánimo</dt>
                <dd className="m-0">{{ calm: 'Tranquilo', confused: 'Confundido', frustrated: 'Frustrado', angry: 'Molesto' }[s.sentiment]}</dd>
                <dt className="text-mute">Siguiente paso</dt>
                <dd className="m-0 font-semibold">{s.suggested_next_step}</dd>
              </dl>
              {t.escalationReasons.length > 0 && (
                <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                  {t.escalationReasons.map((r) => (
                    <li key={r} className="rounded-full border border-line-strong px-2 py-0.5 text-xs">
                      {REASON_LABEL[r as EscalationReason]}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section aria-label="Historial completo" className={cx(card, 'p-4')}>
            <h2 className="m-0 mb-3 text-sm font-bold">Historial completo · Kilo IA, cliente y agentes</h2>
            <Thread
              viewer="agent"
              agentLinks
              items={messages.map((m) => ({
                id: m.id,
                authorType: m.authorType,
                authorName: m.authorName,
                channel: m.channel,
                body: m.body,
                createdAt: m.createdAt,
                internal: m.visibility === 'INTERNAL',
                deliveryStatus: m.authorType === 'CUSTOMER' ? undefined : m.deliveryStatus,
                attachments: m.attachments,
              }))}
            />
          </section>

          <section aria-label="Responder" className={cx(card, 'flex flex-col gap-3 p-4')}>
            <div role="tablist" aria-label="Tipo de mensaje" className="flex gap-1 self-start rounded-lg border border-line p-1">
              {(
                [
                  ['reply', 'Responder al cliente'],
                  ['note', 'Nota interna'],
                ] as const
              ).map(([k, label]) => (
                <button key={k} role="tab" type="button" aria-selected={mode === k} onClick={() => setMode(k)} className={cx('h-8 rounded-md px-3 text-sm font-semibold', mode === k ? 'bg-raised text-ink' : 'text-mute')}>
                  {label}
                </button>
              ))}
            </div>
            {mode === 'reply' && (
              <div className="flex flex-wrap gap-3 text-sm">
                <label className="flex flex-col gap-1">
                  <span className={eyebrow}>Enviar por</span>
                  <select value={via} onChange={(e) => setVia(e.target.value as typeof via)} className={cx(input, 'h-10')}>
                    <option value="auto">Canal activo ({delivery.defaultChannel === 'WHATSAPP' ? 'WhatsApp' : 'panel web'})</option>
                    {t.requesterType === 'USER' && <option value="web">Sólo panel web</option>}
                    <option value="whatsapp" disabled={!delivery.whatsappAvailable}>
                      WhatsApp{t.requesterType === 'USER' ? ' + panel' : ''}
                    </option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className={eyebrow}>Después de enviar</span>
                  <select value={next} onChange={(e) => setNext(e.target.value as typeof next)} className={cx(input, 'h-10')}>
                    <option value="WAITING_CUSTOMER">Esperar respuesta del cliente</option>
                    <option value="IN_REVIEW">Seguir en revisión</option>
                    <option value="RESOLVED">Marcar como resuelto</option>
                  </select>
                </label>
              </div>
            )}
            {mode === 'reply' && resolvedTarget === 'WHATSAPP' && !delivery.whatsappWindowOpen && (
              <p className="m-0 flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp exige plantilla. Se enviará la plantilla aprobada con tu respuesta.
              </p>
            )}
            <Composer
              key={mode}
              label={mode === 'note' ? 'Nota interna' : 'Respuesta'}
              busy={busy}
              submitLabel={mode === 'note' ? 'Guardar nota' : 'Enviar respuesta'}
              placeholder={mode === 'note' ? 'Sólo la ve el equipo de Kilora…' : 'Escribe tu respuesta al cliente…'}
              onSend={(text, files) =>
                act(() =>
                  agentApi.reply(t.id, {
                    body: text,
                    internal: mode === 'note',
                    deliverVia: via,
                    nextStatus: next,
                    attachments: files,
                  }),
                )
              }
            />
          </section>
        </div>

        <aside className="flex flex-col gap-4">
          <RequesterPanel view={view} />
          <section className={cx(card, 'flex flex-col gap-1.5 p-4 text-sm')}>
            <h2 className="m-0 mb-1 text-sm font-bold">Seguimiento</h2>
            <Row k="Atiende" v={t.handledBy === 'AI' ? 'Kilo IA' : 'Equipo humano'} />
            <Row k="Canal activo" v={t.activeChannel === 'WHATSAPP' ? 'WhatsApp' : 'Web'} />
            <Row k="Origen" v={{ in_app_widget: 'Widget en la app', whatsapp: 'WhatsApp', landing: 'Landing comercial', console: 'Consola' }[t.originSource]} />
            <Row k="Confianza IA" v={t.aiConfidence == null ? '—' : `${Math.round(t.aiConfidence * 100)} %`} />
            <Row k="Respuestas IA" v={String(t.aiAttempts)} />
            {t.escalatedAt && <Row k="Escalado" v={fmtDate(t.escalatedAt)} />}
            {t.firstResponseAt && <Row k="1ª respuesta" v={fmtDate(t.firstResponseAt)} />}
            {t.resolvedAt && <Row k="Resuelto" v={fmtDate(t.resolvedAt)} />}
            {requester && (
              <p className="m-0 mt-1 text-xs text-mute">
                WhatsApp: {delivery.whatsappAvailable ? (delivery.whatsappWindowOpen ? 'ventana de 24 h abierta' : 'requiere plantilla') : 'no disponible'}
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-mute">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  )
}

function RequesterPanel({ view }: { view: AgentTicketView }) {
  const r = view.requester
  if (r.type === 'LEAD') {
    return (
      <section className={cx(card, 'flex flex-col gap-2 p-4 text-sm')}>
        <h2 className="m-0 flex items-center gap-2 text-sm font-bold">
          <UserRound size={16} aria-hidden="true" /> Prospecto (lead)
        </h2>
        <Row k="Nombre" v={r.name ?? 'Sin nombre'} />
        <Row k="Teléfono" v={r.phone ?? '—'} />
        <p className="m-0 text-xs text-mute">Sin cuenta en Kilora. Califica la oportunidad y, si corresponde, créale una cuenta.</p>
        {r.phone && (
          <a href={`https://wa.me/${r.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-ok">
            <Phone size={14} aria-hidden="true" /> Abrir en WhatsApp
          </a>
        )}
      </section>
    )
  }
  const a = r.account
  return (
    <section className={cx(card, 'flex flex-col gap-2 p-4 text-sm')}>
      <h2 className="m-0 flex items-center gap-2 text-sm font-bold">
        <Building2 size={16} aria-hidden="true" /> Cliente
      </h2>
      {r.name && <Row k="Nombre" v={r.name} />}
      <Row k="Email" v={r.email ?? '—'} />
      <Row k="Teléfono" v={r.phone ?? '—'} />
      <Row k="Tenant" v={r.tenantId ? `${r.tenantId.slice(0, 8)}…` : '—'} />
      {a ? (
        <>
          <h3 className="m-0 mt-2 flex items-center gap-2 text-xs tracking-wider text-mute uppercase">
            <Truck size={14} aria-hidden="true" /> Cuenta y flota
          </h3>
          {a.companyName && <Row k="Empresa" v={a.companyName} />}
          {a.plan && <Row k="Plan" v={a.plan} />}
          {a.billingStatus && <Row k="Facturación" v={a.billingStatus.replace('_', ' ')} />}
          {a.fleetSize != null && <Row k="Vehículos" v={`${a.activeVehicles ?? '—'} activos de ${a.fleetSize}`} />}
          {a.devicesOffline != null && <Row k="Equipos sin señal" v={String(a.devicesOffline)} />}
          {a.openInvoices != null && <Row k="Facturas abiertas" v={String(a.openInvoices)} />}
        </>
      ) : (
        <p className="m-0 text-xs text-mute">Sin datos de cuenta disponibles.</p>
      )}
    </section>
  )
}
