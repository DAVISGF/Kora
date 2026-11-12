// Repositorio en memoria: desarrollo local (npm run dev) y pruebas. Misma semántica que PgRepository.
import { isTerminal, PRIORITY_RANK } from './status'
import { formatTicketCode, ticketYear } from './ticketCode'
import type {
  HelpdeskRepository,
  InboxCounts,
  KbArticle,
  NewAttachment,
  NewMessage,
  NewNotification,
  NewTicket,
  PendingNotification,
  TicketEvent,
  TicketPatch,
} from './repository'
import type { AttachmentMeta, ConsoleAlert, DeliveryStatus, DirectoryEntry, InboxFilters, Ticket, TicketMessage } from './types'

interface StoredNotification extends PendingNotification {
  status: 'PENDING' | 'SENT' | 'FAILED'
  readAt: string | null
  createdAt: string
}

const uuid = () => globalThis.crypto.randomUUID()
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

export class MemoryRepository implements HelpdeskRepository {
  tickets = new Map<string, Ticket>()
  messages: TicketMessage[] = []
  attachments = new Map<string, { meta: AttachmentMeta; content: Uint8Array | null }>()
  events: (TicketEvent & { at: string })[] = []
  notifications: StoredNotification[] = []
  directory = new Map<string, DirectoryEntry>()
  kb: { slug: string; title: string; body: string; audience: 'all' | 'customer' | 'lead' }[] = []
  private counters = new Map<number, number>()
  private notifSeq = 0

  constructor(private now: () => Date = () => new Date()) {}

  private ts = () => this.now().toISOString()

  async createTicket(t: NewTicket): Promise<Ticket> {
    const now = this.now()
    const year = ticketYear(now)
    const seq = (this.counters.get(year) ?? 0) + 1
    this.counters.set(year, seq)
    if (t.requesterType === 'USER' && (!t.userId || !t.tenantId)) throw new Error('USER requiere user_id y tenant_id')
    if (t.requesterType === 'LEAD' && !t.leadPhone) throw new Error('LEAD requiere lead_phone')
    if (t.contactPhone && (await this.findOpenTicketByPhone(t.contactPhone))) {
      throw new Error('Ya existe un caso abierto para este teléfono')
    }
    const iso = now.toISOString()
    const ticket: Ticket = {
      id: uuid(),
      code: formatTicketCode(year, seq),
      ...t,
      category: null,
      status: 'OPEN',
      priority: 'NORMAL',
      handledBy: 'AI',
      activeChannel: t.originChannel,
      assigneeId: null,
      assigneeName: null,
      aiConfidence: null,
      aiAttempts: 0,
      escalationReasons: [],
      aiSummary: null,
      lastCustomerMessageAt: null,
      lastMessageAt: iso,
      escalatedAt: null,
      firstResponseAt: null,
      resolvedAt: null,
      createdAt: iso,
      updatedAt: iso,
    }
    this.tickets.set(ticket.id, ticket)
    return { ...ticket }
  }

  async getTicket(id: string) {
    const t = this.tickets.get(id)
    return t ? { ...t } : null
  }

  async getTicketByCode(code: string) {
    for (const t of this.tickets.values()) if (t.code === code.toUpperCase()) return { ...t }
    return null
  }

  async findOpenTicketByPhone(phone: string) {
    const open = [...this.tickets.values()]
      .filter((t) => t.contactPhone === phone && !isTerminal(t.status))
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
    return open[0] ? { ...open[0] } : null
  }

  async findOpenTicketForUser(userId: string) {
    const open = [...this.tickets.values()]
      .filter((t) => t.userId === userId && !isTerminal(t.status))
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
    return open[0] ? { ...open[0] } : null
  }

  async updateTicket(id: string, patch: TicketPatch) {
    const t = this.tickets.get(id)
    if (!t) throw new Error('Ticket no encontrado')
    const next = { ...t, ...patch, updatedAt: this.ts() }
    this.tickets.set(id, next)
    return { ...next }
  }

  async listTicketsForUser(userId: string, tenantId: string) {
    return [...this.tickets.values()]
      .filter((t) => t.userId === userId && t.tenantId === tenantId)
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
      .map((t) => ({ ...t }))
  }

  async listInbox(f: InboxFilters) {
    const limit = Math.min(f.limit ?? 50, 200)
    const q = f.q ? norm(f.q) : null
    let rows = [...this.tickets.values()].filter(
      (t) =>
        (!f.status?.length || f.status.includes(t.status)) &&
        (!f.priority?.length || f.priority.includes(t.priority)) &&
        (!f.channel?.length || f.channel.includes(t.originChannel)) &&
        (!f.requesterType || t.requesterType === f.requesterType) &&
        (!f.assigneeId || t.assigneeId === f.assigneeId) &&
        (!q ||
          norm(`${t.code} ${t.subject} ${t.leadName ?? ''} ${t.leadPhone ?? ''} ${t.contactPhone ?? ''} ${t.contactEmail ?? ''}`).includes(q)),
    )
    rows.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt) || b.id.localeCompare(a.id))
    if (f.cursor) {
      const [at, id] = f.cursor.split('|')
      rows = rows.filter((t) => t.lastMessageAt < at || (t.lastMessageAt === at && t.id < id))
    }
    const items = rows.slice(0, limit)
    const last = items.at(-1)
    return { items: items.map((t) => ({ ...t })), nextCursor: rows.length > limit && last ? `${last.lastMessageAt}|${last.id}` : null }
  }

  async inboxCounts(): Promise<InboxCounts> {
    const all = [...this.tickets.values()]
    return {
      escalated: all.filter((t) => t.status === 'ESCALATED_TO_HUMAN').length,
      inReview: all.filter((t) => t.status === 'IN_REVIEW').length,
      waiting: all.filter((t) => t.status === 'WAITING_CUSTOMER').length,
      aiHandling: all.filter((t) => t.status === 'OPEN' && t.handledBy === 'AI').length,
      unassignedUrgent: all.filter((t) => !t.assigneeId && !isTerminal(t.status) && PRIORITY_RANK[t.priority] >= 3).length,
    }
  }

  async addMessage(m: NewMessage): Promise<TicketMessage> {
    if (m.externalId && (await this.messageExists(m.externalId))) throw new Error('Mensaje duplicado')
    const msg: TicketMessage = {
      id: uuid(),
      ticketId: m.ticketId,
      authorType: m.authorType,
      authorId: m.authorId ?? null,
      authorName: m.authorName ?? null,
      channel: m.channel,
      visibility: m.visibility ?? 'PUBLIC',
      body: m.body,
      metadata: m.metadata ?? {},
      externalId: m.externalId ?? null,
      deliveryStatus: m.deliveryStatus ?? 'NOT_APPLICABLE',
      deliveryError: null,
      createdAt: this.ts(),
    }
    this.messages.push(msg)
    return { ...msg }
  }

  async messageExists(externalId: string) {
    return this.messages.some((m) => m.externalId === externalId)
  }

  async listMessages(ticketId: string, opts?: { includeInternal?: boolean }) {
    return this.messages
      .filter((m) => m.ticketId === ticketId && (opts?.includeInternal || m.visibility === 'PUBLIC'))
      .map((m) => ({
        ...m,
        attachments: [...this.attachments.values()].filter((a) => a.meta.messageId === m.id).map((a) => a.meta),
      }))
  }

  async updateDelivery(externalId: string, status: DeliveryStatus, error?: string | null) {
    const m = this.messages.find((x) => x.externalId === externalId)
    if (m) Object.assign(m, { deliveryStatus: status, deliveryError: error ?? null })
  }

  async setMessageDelivery(messageId: string, status: DeliveryStatus, externalId?: string | null, error?: string | null) {
    const m = this.messages.find((x) => x.id === messageId)
    if (m) Object.assign(m, { deliveryStatus: status, externalId: externalId ?? m.externalId, deliveryError: error ?? null })
  }

  async addAttachment(a: NewAttachment) {
    const meta: AttachmentMeta = {
      id: uuid(),
      ticketId: a.ticketId,
      messageId: a.messageId,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      storageProvider: a.storageProvider,
      storageKey: a.storageKey ?? null,
      uploadedBy: a.uploadedBy,
      createdAt: this.ts(),
    }
    this.attachments.set(meta.id, { meta, content: a.content ?? null })
    return { ...meta }
  }

  async getAttachment(id: string) {
    return this.attachments.get(id) ?? null
  }

  async addEvent(e: TicketEvent) {
    this.events.push({ ...e, at: this.ts() })
  }

  async enqueueNotification(n: NewNotification) {
    const id = ++this.notifSeq
    this.notifications.push({ ...n, id, attempts: 0, status: 'PENDING', readAt: null, createdAt: this.ts() })
    return id
  }

  async markNotification(id: number, status: 'SENT' | 'FAILED', _error?: string | null) {
    const n = this.notifications.find((x) => x.id === id)
    if (n) Object.assign(n, { status, attempts: n.attempts + 1 })
  }

  async pendingNotifications(limit: number) {
    return this.notifications
      .filter((n) => n.channel === 'whatsapp_team' && n.status !== 'SENT' && n.attempts < 5)
      .slice(0, limit)
      .map(({ status: _s, readAt: _r, createdAt: _c, ...n }) => n)
  }

  async consoleAlertsSince(afterId: number, limit = 50): Promise<ConsoleAlert[]> {
    return this.notifications
      .filter((n) => n.channel === 'console' && n.id > afterId)
      .slice(-limit)
      .map((n) => ({ id: n.id, ticketId: n.ticketId, kind: n.kind, payload: n.payload, readAt: n.readAt, createdAt: n.createdAt }))
  }

  async markAlertsRead(ids: number[]) {
    for (const n of this.notifications) if (ids.includes(n.id)) n.readAt = this.ts()
  }

  async lookupPhone(phone: string) {
    return this.directory.get(phone) ?? null
  }

  async phoneForUser(userId: string) {
    for (const d of this.directory.values()) if (d.userId === userId) return d.phone
    return null
  }

  async searchKnowledge(query: string, audience: 'customer' | 'lead', limit = 3): Promise<KbArticle[]> {
    const terms = norm(query)
      .split(/[^a-z0-9ñ]+/)
      .filter((w) => w.length > 3)
    if (!terms.length) return []
    return this.kb
      .filter((a) => a.audience === 'all' || a.audience === audience)
      .map((a) => {
        const title = norm(a.title)
        const hay = `${title} ${norm(a.body)}`
        const hits = terms.filter((w) => hay.includes(w)).length
        const titleHits = terms.filter((w) => title.includes(w)).length
        return { slug: a.slug, title: a.title, body: a.body, score: (hits + titleHits) / (terms.length + 1) }
      })
      .filter((a) => a.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }
}
