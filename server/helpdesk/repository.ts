// Puerto de persistencia. Implementaciones: PgRepository (producción) y MemoryRepository (dev/pruebas).
import type {
  AttachmentMeta,
  AuthorType,
  Channel,
  ConsoleAlert,
  DeliveryStatus,
  DirectoryEntry,
  InboxFilters,
  OriginSource,
  Ticket,
  TicketMessage,
  Visibility,
} from './types'

export interface NewTicket {
  requesterType: Ticket['requesterType']
  userId: string | null
  tenantId: string | null
  leadPhone: string | null
  leadName: string | null
  contactPhone: string | null
  contactEmail: string | null
  subject: string
  originChannel: Channel
  originSource: OriginSource
}

export interface NewMessage {
  ticketId: string
  authorType: AuthorType
  authorId?: string | null
  authorName?: string | null
  channel: Channel
  visibility?: Visibility
  body: string
  metadata?: Record<string, unknown>
  externalId?: string | null
  deliveryStatus?: DeliveryStatus
}

export interface NewAttachment {
  ticketId: string
  messageId: string | null
  fileName: string
  mimeType: string
  sizeBytes: number
  storageProvider: AttachmentMeta['storageProvider']
  storageKey?: string | null
  content?: Uint8Array | null
  uploadedBy: AuthorType
}

export type TicketPatch = Partial<
  Pick<
    Ticket,
    | 'subject'
    | 'category'
    | 'status'
    | 'priority'
    | 'handledBy'
    | 'activeChannel'
    | 'assigneeId'
    | 'assigneeName'
    | 'aiConfidence'
    | 'aiAttempts'
    | 'escalationReasons'
    | 'aiSummary'
    | 'lastCustomerMessageAt'
    | 'lastMessageAt'
    | 'escalatedAt'
    | 'firstResponseAt'
    | 'resolvedAt'
    | 'contactPhone'
    | 'leadName'
  >
>

export interface TicketEvent {
  ticketId: string
  type: string
  fromValue?: string | null
  toValue?: string | null
  actorType: AuthorType
  actorId?: string | null
  detail?: Record<string, unknown>
}

export interface NewNotification {
  ticketId: string | null
  kind: ConsoleAlert['kind']
  channel: 'whatsapp_team' | 'console'
  recipient: string | null
  payload: ConsoleAlert['payload']
}

export interface PendingNotification extends NewNotification {
  id: number
  attempts: number
}

export interface KbArticle {
  slug: string
  title: string
  body: string
  score: number
}

export interface InboxCounts {
  escalated: number
  inReview: number
  waiting: number
  aiHandling: number
  unassignedUrgent: number
}

export interface HelpdeskRepository {
  // Tickets
  createTicket(t: NewTicket): Promise<Ticket>
  getTicket(id: string): Promise<Ticket | null>
  getTicketByCode(code: string): Promise<Ticket | null>
  /** Caso vigente (no terminal) para un teléfono de contacto, si existe. */
  findOpenTicketByPhone(phone: string): Promise<Ticket | null>
  /** Caso vigente de un usuario autenticado iniciado desde el widget. */
  findOpenTicketForUser(userId: string): Promise<Ticket | null>
  updateTicket(id: string, patch: TicketPatch): Promise<Ticket>
  listTicketsForUser(userId: string, tenantId: string): Promise<Ticket[]>
  listInbox(filters: InboxFilters): Promise<{ items: Ticket[]; nextCursor: string | null }>
  inboxCounts(): Promise<InboxCounts>

  // Mensajes
  addMessage(m: NewMessage): Promise<TicketMessage>
  /** Idempotencia de webhooks: ¿ya procesamos este wamid? */
  messageExists(externalId: string): Promise<boolean>
  listMessages(ticketId: string, opts?: { includeInternal?: boolean }): Promise<TicketMessage[]>
  updateDelivery(externalId: string, status: DeliveryStatus, error?: string | null): Promise<void>
  setMessageDelivery(messageId: string, status: DeliveryStatus, externalId?: string | null, error?: string | null): Promise<void>

  // Adjuntos
  addAttachment(a: NewAttachment): Promise<AttachmentMeta>
  getAttachment(id: string): Promise<{ meta: AttachmentMeta; content: Uint8Array | null } | null>

  // Auditoría
  addEvent(e: TicketEvent): Promise<void>

  // Notificaciones (outbox)
  enqueueNotification(n: NewNotification): Promise<number>
  markNotification(id: number, status: 'SENT' | 'FAILED', error?: string | null): Promise<void>
  pendingNotifications(limit: number): Promise<PendingNotification[]>
  consoleAlertsSince(afterId: number, limit?: number): Promise<ConsoleAlert[]>
  markAlertsRead(ids: number[]): Promise<void>

  // Identidad y conocimiento
  lookupPhone(phone: string): Promise<DirectoryEntry | null>
  phoneForUser(userId: string): Promise<string | null>
  searchKnowledge(query: string, audience: 'customer' | 'lead', limit?: number): Promise<KbArticle[]>
}
