// Piezas de interfaz compartidas por el panel del cliente, el widget Kilo IA y la consola.
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Bot, Globe, Headset, Lock, MessageCircle, Monitor, Paperclip, Send, User, X } from 'lucide-react'
import { AGENT_STATUS, CUSTOMER_STATUS, PRIORITY_LABEL, type CustomerStatus } from '../../server/helpdesk/status'
import { cx } from '../lib/util'
import { attachmentUrl, readFiles, type AttachmentMeta, type Channel, type TicketPriority, type TicketStatus, type UploadFile } from './api'

const CUSTOMER_TONE: Record<CustomerStatus, string> = {
  Abierto: 'border-info/50 text-info',
  'En Revisión': 'border-zone/50 text-zone',
  'Esperando tu respuesta': 'border-warn/60 text-warn',
  Resuelto: 'border-ok/50 text-ok',
}

export function CustomerStatusBadge({ status }: { status: TicketStatus }) {
  const label = CUSTOMER_STATUS[status]
  return <span className={cx('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', CUSTOMER_TONE[label])}>{label}</span>
}

const AGENT_TONE: Record<TicketStatus, string> = {
  OPEN: 'border-info/50 text-info',
  WAITING_CUSTOMER: 'border-warn/60 text-warn',
  ESCALATED_TO_HUMAN: 'border-danger/60 text-danger',
  IN_REVIEW: 'border-zone/50 text-zone',
  RESOLVED_BY_AI: 'border-ok/50 text-ok',
  RESOLVED: 'border-ok/50 text-ok',
  CLOSED: 'border-line-strong text-mute',
}

export function AgentStatusBadge({ status }: { status: TicketStatus }) {
  return <span className={cx('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', AGENT_TONE[status])}>{AGENT_STATUS[status]}</span>
}

const PRIORITY_TONE: Record<TicketPriority, string> = {
  LOW: 'text-mute',
  NORMAL: 'text-ink',
  HIGH: 'text-warn',
  URGENT: 'text-danger',
}

export function PriorityTag({ priority }: { priority: TicketPriority }) {
  return (
    <span className={cx('inline-flex items-center gap-1 text-xs font-semibold', PRIORITY_TONE[priority])}>
      <span aria-hidden="true" className="inline-block size-2 rounded-full bg-current" />
      {PRIORITY_LABEL[priority]}
    </span>
  )
}

export function ChannelTag({ channel, className }: { channel: Channel; className?: string }) {
  const map = {
    WHATSAPP: { icon: MessageCircle, label: 'WhatsApp', tone: 'text-ok' },
    WEB: { icon: Globe, label: 'Web', tone: 'text-info' },
    CONSOLE: { icon: Monitor, label: 'Consola', tone: 'text-mute' },
    EMAIL: { icon: Globe, label: 'Email', tone: 'text-mute' },
  }[channel]
  const Icon = map.icon
  return (
    <span className={cx('inline-flex items-center gap-1 text-xs', map.tone, className)}>
      <Icon size={13} aria-hidden="true" />
      {map.label}
    </span>
  )
}

export const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

export function relTime(iso: string) {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return 'ahora'
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`
  return fmtDate(iso)
}

export interface ThreadItem {
  id: string
  authorType: 'CUSTOMER' | 'AI' | 'AGENT' | 'SYSTEM'
  authorName: string | null
  channel: Channel
  body: string
  createdAt: string
  internal?: boolean
  deliveryStatus?: string
  attachments?: AttachmentMeta[]
}

/** Hilo de conversación. `viewer` decide de qué lado aparece cada mensaje. */
export function Thread({ items, viewer, agentLinks = false }: { items: ThreadItem[]; viewer: 'customer' | 'agent'; agentLinks?: boolean }) {
  return (
    <ol className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Conversación">
      {items.map((m) => {
        const mine = viewer === 'customer' ? m.authorType === 'CUSTOMER' : m.authorType === 'AGENT' || m.authorType === 'AI'
        const Icon = m.authorType === 'AI' ? Bot : m.authorType === 'AGENT' ? Headset : m.authorType === 'SYSTEM' ? Lock : User
        const who =
          m.authorType === 'AI' ? 'Kilo IA' : m.authorType === 'AGENT' ? `${m.authorName ?? 'Agente'} · Kilora` : m.authorType === 'SYSTEM' ? 'Sistema' : viewer === 'customer' ? 'Tú' : m.authorName ?? 'Cliente'
        return (
          <li key={m.id} className={cx('flex max-w-[min(560px,92%)] flex-col gap-1', mine ? 'self-end items-end' : 'self-start items-start')}>
            <div className="flex flex-wrap items-center gap-2 text-xs text-mute">
              <Icon size={13} aria-hidden="true" />
              <span className="font-semibold text-ink">{who}</span>
              <ChannelTag channel={m.channel} />
              <time dateTime={m.createdAt}>{fmtDate(m.createdAt)}</time>
              {m.internal && <span className="rounded bg-warn/15 px-1.5 py-0.5 font-semibold text-warn">Nota interna</span>}
              {m.deliveryStatus === 'FAILED' && <span className="font-semibold text-danger">No entregado</span>}
              {m.deliveryStatus && ['SENT', 'DELIVERED', 'READ'].includes(m.deliveryStatus) && (
                <span>{m.deliveryStatus === 'READ' ? 'Leído' : m.deliveryStatus === 'DELIVERED' ? 'Entregado' : 'Enviado'}</span>
              )}
            </div>
            <div
              className={cx(
                'rounded-2xl px-3.5 py-2.5 whitespace-pre-wrap [overflow-wrap:anywhere]',
                m.internal
                  ? 'border border-dashed border-warn/50 bg-warn/5'
                  : mine
                    ? 'bg-lime text-lime-ink'
                    : m.authorType === 'AI'
                      ? 'border border-line bg-raised'
                      : 'border border-line bg-card',
              )}
            >
              {m.body}
              {!!m.attachments?.length && (
                <ul className="m-0 mt-2 flex list-none flex-wrap gap-2 p-0">
                  {m.attachments.map((a) => (
                    <li key={a.id}>
                      <a
                        href={attachmentUrl(a.id, agentLinks)}
                        target="_blank"
                        rel="noreferrer"
                        className={cx('inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs underline-offset-2', mine ? 'border-lime-ink/30 text-lime-ink' : 'border-line-strong text-ink')}
                      >
                        <Paperclip size={12} aria-hidden="true" />
                        {a.fileName}
                        {a.sizeBytes > 0 && <span className="opacity-70">({Math.ceil(a.sizeBytes / 1024)} KB)</span>}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** Caja de texto con adjuntos. Enter envía; Shift+Enter, salto de línea. */
export function Composer({
  onSend,
  placeholder,
  busy,
  label = 'Mensaje',
  extra,
  submitLabel = 'Enviar',
  allowEmptyWithFiles = true,
}: {
  onSend: (text: string, files: UploadFile[]) => Promise<void>
  placeholder: string
  busy?: boolean
  label?: string
  extra?: ReactNode
  submitLabel?: string
  allowEmptyWithFiles?: boolean
}) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<UploadFile[]>([])
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const canSend = !busy && (text.trim().length > 0 || (allowEmptyWithFiles && files.length > 0))

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    if (!canSend) return
    setError(null)
    try {
      await onSend(text.trim(), files)
      setText('')
      setFiles([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar')
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label className="sr-only" htmlFor={`composer-${label}`}>
        {label}
      </label>
      <textarea
        id={`composer-${label}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void submit()
          }
        }}
        rows={3}
        maxLength={4000}
        placeholder={placeholder}
        className="min-h-[76px] w-full resize-y rounded-lg border border-line-strong bg-bg px-3 py-2 text-ink placeholder:text-mute"
      />
      {files.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {files.map((f, i) => (
            <li key={`${f.fileName}-${i}`} className="inline-flex items-center gap-1 rounded-md border border-line-strong px-2 py-1 text-xs">
              <Paperclip size={12} aria-hidden="true" />
              {f.fileName}
              <button type="button" aria-label={`Quitar ${f.fileName}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="ml-1 grid size-5 place-items-center rounded text-mute hover:text-ink">
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="m-0 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          onChange={async (e) => {
            if (!e.target.files) return
            try {
              setFiles([...files, ...(await readFiles(e.target.files))].slice(0, 5))
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Adjunto inválido')
            }
            e.target.value = ''
          }}
        />
        <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-sm font-semibold">
          <Paperclip size={16} aria-hidden="true" />
          Adjuntar
        </button>
        {extra}
        <div className="grow" />
        <button type="submit" disabled={!canSend} className="inline-flex h-10 items-center gap-2 rounded-lg bg-lime px-4 text-sm font-semibold text-lime-ink">
          <Send size={16} aria-hidden="true" />
          {busy ? 'Enviando…' : submitLabel}
        </button>
      </div>
    </form>
  )
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-mute">
      <div className="text-line-strong">{icon}</div>
      <p className="m-0 font-semibold text-ink">{title}</p>
      {children && <div className="max-w-[44ch] text-sm">{children}</div>}
    </div>
  )
}
