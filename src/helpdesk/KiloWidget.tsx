// Widget flotante de Kilo IA dentro de la plataforma. Crea el caso en el primer mensaje
// (KIL-YYYY-XXXX), conversa con la IA y, si hace falta, muestra el handoff a una persona.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bot, CheckCircle2, ExternalLink, Minus, Sparkles, UserRound } from 'lucide-react'
import { isTerminal } from '../../server/helpdesk/status'
import { cx } from '../lib/util'
import { customerApi, type CustomerTicketView } from './api'
import { Composer, CustomerStatusBadge, Thread } from './ui'

const OPEN_EVENT = 'kilora:open-widget'
const KEY = 'kilora.widget.ticket'

export function openKiloWidget(fresh = true) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { fresh } }))
}

const store = {
  get: () => {
    try {
      return sessionStorage.getItem(KEY)
    } catch {
      return null
    }
  },
  set: (v: string | null) => {
    try {
      if (v) sessionStorage.setItem(KEY, v)
      else sessionStorage.removeItem(KEY)
    } catch {
      /* almacenamiento no disponible */
    }
  },
}

export default function KiloWidget() {
  const [open, setOpen] = useState(false)
  const [ticketId, setTicketId] = useState<string | null>(() => store.get())
  const [view, setView] = useState<CustomerTicketView | null>(null)
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onOpen = (e: Event) => {
      if ((e as CustomEvent<{ fresh?: boolean }>).detail?.fresh) {
        setTicketId(null)
        setView(null)
        store.set(null)
      }
      setOpen(true)
    }
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  }, [])

  const load = useCallback(async () => {
    if (!ticketId) return
    try {
      setView(await customerApi.get(ticketId))
    } catch {
      store.set(null)
      setTicketId(null)
    }
  }, [ticketId])

  useEffect(() => {
    if (!open || !ticketId) return
    void load()
    const t = setInterval(load, 8_000)
    return () => clearInterval(t)
  }, [open, ticketId, load])

  useEffect(() => {
    // Llaves: scrollIntoView puede devolver una promesa y React la tomaría como limpieza.
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [view?.messages.length])

  async function run(fn: () => Promise<CustomerTicketView>) {
    setBusy(true)
    try {
      const v = await fn()
      setView(v)
      setTicketId(v.ticket.id)
      store.set(v.ticket.id)
      window.dispatchEvent(new Event('kilora:tickets-changed'))
    } finally {
      setBusy(false)
    }
  }

  const t = view?.ticket

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed right-4 bottom-4 z-40 inline-flex h-12 items-center gap-2 rounded-full bg-lime px-5 font-semibold text-lime-ink shadow-lg shadow-black/40"
        >
          <Sparkles size={18} aria-hidden="true" />
          Ayuda · Kilo IA
        </button>
      )}
      {open && (
        <section
          role="dialog"
          aria-label="Asistente Kilo IA"
          className="fixed inset-x-2 bottom-2 z-50 flex max-h-[min(640px,calc(100vh-16px))] flex-col overflow-hidden rounded-2xl border border-line-strong bg-card shadow-2xl shadow-black/60 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[400px]"
        >
          <header className="flex items-center gap-2 border-b border-line px-4 py-3">
            <span className="grid size-8 place-items-center rounded-full bg-lime text-lime-ink">
              <Bot size={18} aria-hidden="true" />
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="font-semibold">Kilo IA</span>
              <span className="truncate text-xs text-mute">{t ? `Caso ${t.code}` : 'Asistente de soporte de Kilora'}</span>
            </div>
            {t && <CustomerStatusBadge status={t.status} />}
            <button type="button" aria-label="Minimizar" onClick={() => setOpen(false)} className="ml-auto grid size-9 place-items-center rounded-md text-mute hover:text-ink">
              <Minus size={18} />
            </button>
          </header>

          <div className="min-h-[200px] flex-1 overflow-y-auto p-4" aria-live="polite">
            {!view ? (
              <div className="flex flex-col gap-2 text-sm">
                <p className="m-0 rounded-2xl border border-line bg-raised px-3.5 py-2.5">
                  ¡Hola! Soy Kilo IA. Pregúntame lo que necesites sobre tu cuenta o la plataforma. Si no puedo resolverlo, te paso con una persona del equipo.
                </p>
                <p className="m-0 text-xs text-mute">Tu consulta queda registrada con un número de caso para que puedas seguirla.</p>
              </div>
            ) : (
              <Thread viewer="customer" items={view.messages} />
            )}
            <div ref={endRef} />
          </div>

          {t?.awaitingConfirmation && (
            <div className="flex flex-wrap gap-2 border-t border-line px-4 py-2.5">
              <button type="button" disabled={busy} onClick={() => run(() => customerApi.confirm(t.id, true))} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-lime px-3 text-sm font-semibold text-lime-ink">
                <CheckCircle2 size={15} aria-hidden="true" /> Sí, resuelto
              </button>
              <button type="button" disabled={busy} onClick={() => run(() => customerApi.confirm(t.id, false))} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-sm font-semibold">
                <UserRound size={15} aria-hidden="true" /> Hablar con una persona
              </button>
            </div>
          )}

          <div className="border-t border-line p-3">
            {t && isTerminal(t.status) ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-mute">Caso resuelto.</span>
                <button type="button" onClick={() => openKiloWidget(true)} className="font-semibold text-lime">
                  Nueva consulta
                </button>
              </div>
            ) : (
              <Composer
                label="Consulta a Kilo IA"
                busy={busy}
                placeholder={view ? 'Escribe tu respuesta…' : 'Escribe tu consulta…'}
                onSend={(text, files) => run(() => (ticketId && view ? customerApi.reply(ticketId, text, files) : customerApi.create(text, files)))}
                allowEmptyWithFiles={!!view}
              />
            )}
            {t && (
              <Link to={`/soporte/${t.id}`} onClick={() => setOpen(false)} className={cx('mt-2 inline-flex items-center gap-1 text-xs text-mute')}>
                <ExternalLink size={12} aria-hidden="true" /> Ver en Mis casos de soporte
              </Link>
            )}
          </div>
        </section>
      )}
    </>
  )
}
