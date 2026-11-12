// Tipos de dominio del helpdesk de Kilora. Reflejan db/migrations/001_helpdesk.sql.

export type TicketStatus =
  | 'OPEN'
  | 'WAITING_CUSTOMER'
  | 'RESOLVED_BY_AI'
  | 'ESCALATED_TO_HUMAN'
  | 'IN_REVIEW'
  | 'RESOLVED'
  | 'CLOSED'

export type TicketPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
export type Channel = 'WEB' | 'WHATSAPP' | 'EMAIL' | 'CONSOLE'
export type RequesterType = 'USER' | 'LEAD'
export type Handler = 'AI' | 'HUMAN'
export type AuthorType = 'CUSTOMER' | 'AI' | 'AGENT' | 'SYSTEM'
export type Visibility = 'PUBLIC' | 'INTERNAL'
export type DeliveryStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'NOT_APPLICABLE'
export type TicketCategory = 'billing' | 'technical' | 'account' | 'commercial' | 'how_to' | 'other'
export type OriginSource = 'in_app_widget' | 'whatsapp' | 'landing' | 'console'

export type EscalationReason =
  | 'HUMAN_REQUESTED'
  | 'LOW_CONFIDENCE'
  | 'FRUSTRATION'
  | 'REQUIRES_INTERVENTION'
  | 'COMMERCIAL_LEAD'
  | 'AI_NOT_RESOLVED'
  | 'MAX_AI_ATTEMPTS'
  | 'AI_UNAVAILABLE'

export interface ExecutiveSummary {
  headline: string
  problem: string
  customer_context: string
  ai_attempts: string
  sentiment: 'calm' | 'confused' | 'frustrated' | 'angry'
  suggested_next_step: string
}

export interface Ticket {
  id: string
  code: string
  requesterType: RequesterType
  userId: string | null
  tenantId: string | null
  leadPhone: string | null
  leadName: string | null
  contactPhone: string | null
  contactEmail: string | null
  subject: string
  category: TicketCategory | null
  status: TicketStatus
  priority: TicketPriority
  handledBy: Handler
  originChannel: Channel
  activeChannel: Channel
  originSource: OriginSource
  assigneeId: string | null
  assigneeName: string | null
  aiConfidence: number | null
  aiAttempts: number
  escalationReasons: EscalationReason[]
  aiSummary: ExecutiveSummary | null
  lastCustomerMessageAt: string | null
  lastMessageAt: string
  escalatedAt: string | null
  firstResponseAt: string | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface TicketMessage {
  id: string
  ticketId: string
  authorType: AuthorType
  authorId: string | null
  authorName: string | null
  channel: Channel
  visibility: Visibility
  body: string
  metadata: Record<string, unknown>
  externalId: string | null
  deliveryStatus: DeliveryStatus
  deliveryError: string | null
  createdAt: string
  attachments?: AttachmentMeta[]
}

export interface AttachmentMeta {
  id: string
  ticketId: string
  messageId: string | null
  fileName: string
  mimeType: string
  sizeBytes: number
  storageProvider: 'db' | 'whatsapp' | 's3' | 'blob'
  storageKey: string | null
  uploadedBy: AuthorType
  createdAt: string
}

export interface ConsoleAlert {
  id: number
  ticketId: string | null
  kind: 'escalation' | 'customer_reply' | 'new_lead'
  payload: {
    code: string
    summary: string
    requesterType: RequesterType
    requesterLabel: string
    priority: TicketPriority
    link: string
    reasons?: EscalationReason[]
  }
  readAt: string | null
  createdAt: string
}

/** Identidad resuelta del solicitante de un mensaje entrante. */
export type Requester =
  | { type: 'USER'; userId: string; tenantId: string; name: string | null; phone: string | null; email: string | null }
  | { type: 'LEAD'; phone: string; name: string | null }

export interface DirectoryEntry {
  phone: string
  userId: string
  tenantId: string
  name: string | null
  email: string | null
}

export interface InboxFilters {
  status?: TicketStatus[]
  priority?: TicketPriority[]
  channel?: Channel[]
  requesterType?: RequesterType
  assigneeId?: string
  q?: string
  limit?: number
  cursor?: string // last_message_at|id de la última fila
}

/** Vista pública (para el cliente) de un ticket. Nunca incluye notas internas ni resumen IA. */
export interface PublicTicket {
  id: string
  code: string
  subject: string
  status: TicketStatus
  statusLabel: string
  originChannel: Channel
  activeChannel: Channel
  awaitingConfirmation: boolean
  lastMessageAt: string
  createdAt: string
  resolvedAt: string | null
}
