// Cliente HTTP del helpdesk para la app y la consola.
import type { PublicMessage } from '../../server/helpdesk/service'
import type {
  AttachmentMeta,
  Channel,
  ConsoleAlert,
  PublicTicket,
  Ticket,
  TicketMessage,
  TicketPriority,
  TicketStatus,
} from '../../server/helpdesk/types'
import type { AccountSnapshot } from '../../server/helpdesk/kiloAI'

export type { PublicMessage, PublicTicket, Ticket, TicketMessage, ConsoleAlert, TicketPriority, TicketStatus, Channel, AttachmentMeta }

export interface UploadFile {
  fileName: string
  mimeType: string
  dataBase64: string
}

export interface CustomerTicketView {
  ticket: PublicTicket
  messages: PublicMessage[]
}

export interface InboxCounts {
  escalated: number
  inReview: number
  waiting: number
  aiHandling: number
  unassignedUrgent: number
}

export interface AgentTicketView {
  ticket: Ticket
  messages: TicketMessage[]
  requester:
    | { type: 'USER'; userId: string | null; tenantId: string | null; name: string | null; email: string | null; phone: string | null; account: AccountSnapshot | null }
    | { type: 'LEAD'; name: string | null; phone: string | null }
  delivery: { whatsappAvailable: boolean; whatsappWindowOpen: boolean; defaultChannel: Channel }
}

/** Token emitido por la app de Kilora (JWT). Sin token, el servidor de desarrollo usa una identidad demo. */
export function sessionToken(): string | null {
  try {
    return localStorage.getItem('kilora.token')
  } catch {
    return null
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

async function call<T>(path: string, init: RequestInit & { agent?: boolean } = {}): Promise<T> {
  const token = sessionToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  else if (init.agent) headers['x-dev-role'] = 'agent'
  const res = await fetch(`/api/helpdesk/${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Error ${res.status}`)
  return data
}

export const customerApi = {
  list: () => call<{ items: PublicTicket[] }>('me/tickets'),
  get: (id: string) => call<CustomerTicketView>(`me/tickets/${encodeURIComponent(id)}`),
  create: (message: string, attachments: UploadFile[] = []) =>
    call<CustomerTicketView>('me/tickets', { method: 'POST', body: JSON.stringify({ message, attachments }) }),
  reply: (id: string, message: string, attachments: UploadFile[] = []) =>
    call<CustomerTicketView>(`me/tickets/${id}/messages`, { method: 'POST', body: JSON.stringify({ message, attachments }) }),
  confirm: (id: string, resolved: boolean) => call<CustomerTicketView>(`me/tickets/${id}/confirm`, { method: 'POST', body: JSON.stringify({ resolved }) }),
}

export interface InboxQuery {
  status?: TicketStatus[]
  priority?: TicketPriority[]
  channel?: Channel[]
  requester?: 'USER' | 'LEAD' | ''
  assignee?: 'me' | ''
  q?: string
  cursor?: string
}

export const agentApi = {
  inbox: (f: InboxQuery) => {
    const p = new URLSearchParams()
    if (f.status?.length) p.set('status', f.status.join(','))
    if (f.priority?.length) p.set('priority', f.priority.join(','))
    if (f.channel?.length) p.set('channel', f.channel.join(','))
    if (f.requester) p.set('requester', f.requester)
    if (f.assignee) p.set('assignee', f.assignee)
    if (f.q) p.set('q', f.q)
    if (f.cursor) p.set('cursor', f.cursor)
    return call<{ items: Ticket[]; nextCursor: string | null; counts: InboxCounts }>(`admin/tickets?${p}`, { agent: true })
  },
  get: (idOrCode: string) => call<AgentTicketView>(`admin/tickets/${encodeURIComponent(idOrCode)}`, { agent: true }),
  reply: (
    id: string,
    body: { body: string; internal?: boolean; deliverVia?: 'auto' | 'web' | 'whatsapp' | 'both'; nextStatus?: 'WAITING_CUSTOMER' | 'IN_REVIEW' | 'RESOLVED'; attachments?: UploadFile[] },
  ) => call<AgentTicketView>(`admin/tickets/${id}/messages`, { method: 'POST', body: JSON.stringify(body), agent: true }),
  patch: (id: string, body: { status?: TicketStatus; priority?: TicketPriority; assignee?: 'me' | null; handBackToAI?: boolean }) =>
    call<AgentTicketView>(`admin/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(body), agent: true }),
  markRead: (ids: number[]) => call<{ ok: true }>('admin/alerts/read', { method: 'POST', body: JSON.stringify({ ids }), agent: true }),
  /** EventSource no admite cabeceras: el token (si hay) va como parámetro. */
  streamUrl: (after: number) => {
    const p = new URLSearchParams({ after: String(after) })
    const token = sessionToken()
    if (token) p.set('access_token', token)
    else p.set('dev_role', 'agent')
    return `/api/helpdesk/admin/stream?${p}`
  },
}

export const attachmentUrl = (id: string, agent = false) => {
  const token = sessionToken()
  const p = new URLSearchParams()
  if (token) p.set('access_token', token)
  else if (agent) p.set('dev_role', 'agent')
  return `/api/helpdesk/attachments/${id}${p.size ? `?${p}` : ''}`
}

const MAX_BYTES = 10 * 1024 * 1024

export async function readFiles(files: FileList | File[]): Promise<UploadFile[]> {
  const list = [...files].slice(0, 5)
  const tooBig = list.find((f) => f.size > MAX_BYTES)
  if (tooBig) throw new Error(`«${tooBig.name}» pesa más de 10 MB`)
  return Promise.all(
    list.map(
      (f) =>
        new Promise<UploadFile>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve({ fileName: f.name, mimeType: f.type || 'application/octet-stream', dataBase64: String(r.result).split(',')[1] ?? '' })
          r.onerror = () => reject(new Error(`No se pudo leer «${f.name}»`))
          r.readAsDataURL(f)
        }),
    ),
  )
}
