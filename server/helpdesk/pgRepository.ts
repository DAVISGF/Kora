// Repositorio PostgreSQL (node-postgres). Requiere db/migrations/001_helpdesk.sql aplicada.
import pg from 'pg'
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

type Row = Record<string, unknown>
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))

const toTicket = (r: Row): Ticket => ({
  id: r.id as string,
  code: r.code as string,
  requesterType: r.requester_type as Ticket['requesterType'],
  userId: (r.user_id as string) ?? null,
  tenantId: (r.tenant_id as string) ?? null,
  leadPhone: (r.lead_phone as string) ?? null,
  leadName: (r.lead_name as string) ?? null,
  contactPhone: (r.contact_phone as string) ?? null,
  contactEmail: (r.contact_email as string) ?? null,
  subject: r.subject as string,
  category: (r.category as Ticket['category']) ?? null,
  status: r.status as Ticket['status'],
  priority: r.priority as Ticket['priority'],
  handledBy: r.handled_by as Ticket['handledBy'],
  originChannel: r.origin_channel as Ticket['originChannel'],
  activeChannel: r.active_channel as Ticket['activeChannel'],
  originSource: (r.origin_source as Ticket['originSource']) ?? 'whatsapp',
  assigneeId: (r.assignee_id as string) ?? null,
  assigneeName: (r.assignee_name as string) ?? null,
  aiConfidence: r.ai_confidence == null ? null : Number(r.ai_confidence),
  aiAttempts: Number(r.ai_attempts ?? 0),
  escalationReasons: (r.escalation_reasons as Ticket['escalationReasons']) ?? [],
  aiSummary: (r.ai_summary as Ticket['aiSummary']) ?? null,
  lastCustomerMessageAt: iso(r.last_customer_message_at),
  lastMessageAt: iso(r.last_message_at)!,
  escalatedAt: iso(r.escalated_at),
  firstResponseAt: iso(r.first_response_at),
  resolvedAt: iso(r.resolved_at),
  createdAt: iso(r.created_at)!,
  updatedAt: iso(r.updated_at)!,
})

const toMessage = (r: Row): TicketMessage => ({
  id: r.id as string,
  ticketId: r.ticket_id as string,
  authorType: r.author_type as TicketMessage['authorType'],
  authorId: (r.author_id as string) ?? null,
  authorName: (r.author_name as string) ?? null,
  channel: r.channel as TicketMessage['channel'],
  visibility: r.visibility as TicketMessage['visibility'],
  body: r.body as string,
  metadata: (r.metadata as Record<string, unknown>) ?? {},
  externalId: (r.external_id as string) ?? null,
  deliveryStatus: r.delivery_status as DeliveryStatus,
  deliveryError: (r.delivery_error as string) ?? null,
  createdAt: iso(r.created_at)!,
})

const toAttachment = (r: Row): AttachmentMeta => ({
  id: r.id as string,
  ticketId: r.ticket_id as string,
  messageId: (r.message_id as string) ?? null,
  fileName: r.file_name as string,
  mimeType: r.mime_type as string,
  sizeBytes: Number(r.size_bytes),
  storageProvider: r.storage_provider as AttachmentMeta['storageProvider'],
  storageKey: (r.storage_key as string) ?? null,
  uploadedBy: r.uploaded_by as AttachmentMeta['uploadedBy'],
  createdAt: iso(r.created_at)!,
})

/** camelCase de TicketPatch -> columna. Lista blanca: nunca se interpola nada que venga del cliente. */
const PATCH_COLUMNS: Record<keyof TicketPatch, string> = {
  subject: 'subject',
  category: 'category',
  status: 'status',
  priority: 'priority',
  handledBy: 'handled_by',
  activeChannel: 'active_channel',
  assigneeId: 'assignee_id',
  assigneeName: 'assignee_name',
  aiConfidence: 'ai_confidence',
  aiAttempts: 'ai_attempts',
  escalationReasons: 'escalation_reasons',
  aiSummary: 'ai_summary',
  lastCustomerMessageAt: 'last_customer_message_at',
  lastMessageAt: 'last_message_at',
  escalatedAt: 'escalated_at',
  firstResponseAt: 'first_response_at',
  resolvedAt: 'resolved_at',
  contactPhone: 'contact_phone',
  leadName: 'lead_name',
}

const TICKET_COLS = `id, code, requester_type, user_id, tenant_id, lead_phone, lead_name, contact_phone, contact_email,
  subject, category, status, priority, handled_by, origin_channel, active_channel, origin_source, assignee_id,
  assignee_name, ai_confidence, ai_attempts, escalation_reasons, ai_summary, last_customer_message_at,
  last_message_at, escalated_at, first_response_at, resolved_at, created_at, updated_at`
const OPEN = `status NOT IN ('RESOLVED_BY_AI','RESOLVED','CLOSED')`

export class PgRepository implements HelpdeskRepository {
  constructor(private pool: pg.Pool) {}

  static fromUrl(url: string) {
    return new PgRepository(
      new pg.Pool({ connectionString: url, max: 5, idleTimeoutMillis: 10_000, ssl: /sslmode=disable/.test(url) ? false : { rejectUnauthorized: false } }),
    )
  }

  private async one(sql: string, params: unknown[] = []) {
    const { rows } = await this.pool.query(sql, params)
    return (rows[0] as Row) ?? null
  }

  async createTicket(t: NewTicket) {
    const r = await this.one(
      `INSERT INTO support_tickets (requester_type, user_id, tenant_id, lead_phone, lead_name, contact_phone, contact_email,
         subject, origin_channel, active_channel, origin_source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10) RETURNING ${TICKET_COLS}`,
      [t.requesterType, t.userId, t.tenantId, t.leadPhone, t.leadName, t.contactPhone, t.contactEmail, t.subject, t.originChannel, t.originSource],
    )
    return toTicket(r!)
  }

  async getTicket(id: string) {
    const r = await this.one(`SELECT ${TICKET_COLS} FROM support_tickets WHERE id = $1`, [id])
    return r ? toTicket(r) : null
  }

  async getTicketByCode(code: string) {
    const r = await this.one(`SELECT ${TICKET_COLS} FROM support_tickets WHERE code = upper($1)`, [code])
    return r ? toTicket(r) : null
  }

  async findOpenTicketByPhone(phone: string) {
    const r = await this.one(
      `SELECT ${TICKET_COLS} FROM support_tickets WHERE contact_phone = $1 AND ${OPEN} ORDER BY last_message_at DESC LIMIT 1`,
      [phone],
    )
    return r ? toTicket(r) : null
  }

  async findOpenTicketForUser(userId: string) {
    const r = await this.one(
      `SELECT ${TICKET_COLS} FROM support_tickets WHERE user_id = $1 AND ${OPEN} ORDER BY last_message_at DESC LIMIT 1`,
      [userId],
    )
    return r ? toTicket(r) : null
  }

  async updateTicket(id: string, patch: TicketPatch) {
    const sets: string[] = []
    const params: unknown[] = []
    for (const [k, v] of Object.entries(patch)) {
      const col = PATCH_COLUMNS[k as keyof TicketPatch]
      if (!col || v === undefined) continue
      params.push(k === 'aiSummary' && v != null ? JSON.stringify(v) : v)
      sets.push(`${col} = $${params.length}`)
    }
    if (!sets.length) return (await this.getTicket(id))!
    params.push(id)
    const r = await this.one(`UPDATE support_tickets SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${TICKET_COLS}`, params)
    if (!r) throw new Error('Ticket no encontrado')
    return toTicket(r)
  }

  async listTicketsForUser(userId: string, tenantId: string) {
    const { rows } = await this.pool.query(
      `SELECT ${TICKET_COLS} FROM support_tickets WHERE user_id = $1 AND tenant_id = $2 ORDER BY last_message_at DESC LIMIT 200`,
      [userId, tenantId],
    )
    return rows.map(toTicket)
  }

  async listInbox(f: InboxFilters) {
    const where: string[] = []
    const p: unknown[] = []
    const add = (sql: (i: number) => string, v: unknown) => {
      p.push(v)
      where.push(sql(p.length))
    }
    if (f.status?.length) add((i) => `status = ANY($${i}::ticket_status[])`, f.status)
    if (f.priority?.length) add((i) => `priority = ANY($${i}::ticket_priority[])`, f.priority)
    if (f.channel?.length) add((i) => `origin_channel = ANY($${i}::support_channel[])`, f.channel)
    if (f.requesterType) add((i) => `requester_type = $${i}`, f.requesterType)
    if (f.assigneeId) add((i) => `assignee_id = $${i}`, f.assigneeId)
    if (f.q) {
      add(
        (i) =>
          `(code ILIKE $${i} OR subject ILIKE $${i} OR lead_name ILIKE $${i} OR contact_phone ILIKE $${i} OR contact_email ILIKE $${i})`,
        `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`,
      )
    }
    if (f.cursor) {
      const [at, id] = f.cursor.split('|')
      p.push(at, id)
      // El cursor viaja con precisión de milisegundos (ISO de JS); se compara con la misma precisión.
      where.push(`(date_trunc('milliseconds', last_message_at), id) < ($${p.length - 1}::timestamptz, $${p.length}::uuid)`)
    }
    const limit = Math.min(f.limit ?? 50, 200)
    p.push(limit + 1)
    const { rows } = await this.pool.query(
      `SELECT ${TICKET_COLS} FROM support_tickets ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY date_trunc('milliseconds', last_message_at) DESC, id DESC LIMIT $${p.length}`,
      p,
    )
    const items = rows.slice(0, limit).map(toTicket)
    const last = items.at(-1)
    return { items, nextCursor: rows.length > limit && last ? `${last.lastMessageAt}|${last.id}` : null }
  }

  async inboxCounts(): Promise<InboxCounts> {
    const r = await this.one(`SELECT
      count(*) FILTER (WHERE status = 'ESCALATED_TO_HUMAN')::int AS escalated,
      count(*) FILTER (WHERE status = 'IN_REVIEW')::int AS in_review,
      count(*) FILTER (WHERE status = 'WAITING_CUSTOMER')::int AS waiting,
      count(*) FILTER (WHERE status = 'OPEN' AND handled_by = 'AI')::int AS ai_handling,
      count(*) FILTER (WHERE assignee_id IS NULL AND priority = 'URGENT' AND ${OPEN})::int AS unassigned_urgent
      FROM support_tickets`)
    return {
      escalated: Number(r?.escalated ?? 0),
      inReview: Number(r?.in_review ?? 0),
      waiting: Number(r?.waiting ?? 0),
      aiHandling: Number(r?.ai_handling ?? 0),
      unassignedUrgent: Number(r?.unassigned_urgent ?? 0),
    }
  }

  async addMessage(m: NewMessage) {
    const r = await this.one(
      `INSERT INTO ticket_messages (ticket_id, author_type, author_id, author_name, channel, visibility, body, metadata, external_id, delivery_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        m.ticketId,
        m.authorType,
        m.authorId ?? null,
        m.authorName ?? null,
        m.channel,
        m.visibility ?? 'PUBLIC',
        m.body,
        JSON.stringify(m.metadata ?? {}),
        m.externalId ?? null,
        m.deliveryStatus ?? 'NOT_APPLICABLE',
      ],
    )
    return toMessage(r!)
  }

  async messageExists(externalId: string) {
    return !!(await this.one(`SELECT 1 FROM ticket_messages WHERE external_id = $1`, [externalId]))
  }

  async listMessages(ticketId: string, opts?: { includeInternal?: boolean }) {
    const { rows } = await this.pool.query(
      `SELECT * FROM ticket_messages WHERE ticket_id = $1 ${opts?.includeInternal ? '' : `AND visibility = 'PUBLIC'`} ORDER BY created_at, id`,
      [ticketId],
    )
    const { rows: att } = await this.pool.query(
      `SELECT id, ticket_id, message_id, file_name, mime_type, size_bytes, storage_provider, storage_key, uploaded_by, created_at
       FROM ticket_attachments WHERE ticket_id = $1`,
      [ticketId],
    )
    const byMsg = new Map<string, AttachmentMeta[]>()
    for (const a of att.map(toAttachment)) if (a.messageId) byMsg.set(a.messageId, [...(byMsg.get(a.messageId) ?? []), a])
    return rows.map((r) => ({ ...toMessage(r), attachments: byMsg.get(r.id as string) ?? [] }))
  }

  async updateDelivery(externalId: string, status: DeliveryStatus, error?: string | null) {
    // Los estados de WhatsApp llegan desordenados: nunca retroceder de READ a DELIVERED, etc.
    await this.pool.query(
      `UPDATE ticket_messages SET delivery_status = $2::delivery_status, delivery_error = $3
       WHERE external_id = $1 AND (
         $2::text = 'FAILED' OR coalesce(array_position(ARRAY['PENDING','SENT','DELIVERED','READ']::text[], delivery_status::text), 0)
           < array_position(ARRAY['PENDING','SENT','DELIVERED','READ']::text[], $2::text))`,
      [externalId, status, error ?? null],
    )
  }

  async setMessageDelivery(messageId: string, status: DeliveryStatus, externalId?: string | null, error?: string | null) {
    await this.pool.query(
      `UPDATE ticket_messages SET delivery_status = $2, external_id = coalesce($3, external_id), delivery_error = $4 WHERE id = $1`,
      [messageId, status, externalId ?? null, error ?? null],
    )
  }

  async addAttachment(a: NewAttachment) {
    const r = await this.one(
      `INSERT INTO ticket_attachments (ticket_id, message_id, file_name, mime_type, size_bytes, storage_provider, storage_key, content, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, ticket_id, message_id, file_name, mime_type, size_bytes, storage_provider, storage_key, uploaded_by, created_at`,
      [a.ticketId, a.messageId, a.fileName, a.mimeType, a.sizeBytes, a.storageProvider, a.storageKey ?? null, a.content ? Buffer.from(a.content) : null, a.uploadedBy],
    )
    return toAttachment(r!)
  }

  async getAttachment(id: string) {
    const r = await this.one(`SELECT * FROM ticket_attachments WHERE id = $1`, [id])
    return r ? { meta: toAttachment(r), content: r.content ? new Uint8Array(r.content as Buffer) : null } : null
  }

  async addEvent(e: TicketEvent) {
    await this.pool.query(
      `INSERT INTO support_ticket_events (ticket_id, type, from_value, to_value, actor_type, actor_id, detail) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [e.ticketId, e.type, e.fromValue ?? null, e.toValue ?? null, e.actorType, e.actorId ?? null, JSON.stringify(e.detail ?? {})],
    )
  }

  async enqueueNotification(n: NewNotification) {
    const r = await this.one(
      `INSERT INTO support_notifications (ticket_id, kind, channel, recipient, payload, status, sent_at)
       VALUES ($1,$2,$3,$4,$5, CASE WHEN $3 = 'console' THEN 'SENT' ELSE 'PENDING' END, CASE WHEN $3 = 'console' THEN now() END)
       RETURNING id`,
      [n.ticketId, n.kind, n.channel, n.recipient, JSON.stringify(n.payload)],
    )
    return Number(r!.id)
  }

  async markNotification(id: number, status: 'SENT' | 'FAILED', error?: string | null) {
    await this.pool.query(
      `UPDATE support_notifications SET status = $2, attempts = attempts + 1, last_error = $3,
         sent_at = CASE WHEN $2 = 'SENT' THEN now() ELSE sent_at END WHERE id = $1`,
      [id, status, error ?? null],
    )
  }

  async pendingNotifications(limit: number): Promise<PendingNotification[]> {
    const { rows } = await this.pool.query(
      `SELECT id, ticket_id, kind, channel, recipient, payload, attempts FROM support_notifications
       WHERE channel = 'whatsapp_team' AND status <> 'SENT' AND attempts < 5 ORDER BY created_at LIMIT $1`,
      [limit],
    )
    return rows.map((r) => ({
      id: Number(r.id),
      ticketId: r.ticket_id,
      kind: r.kind,
      channel: r.channel,
      recipient: r.recipient,
      payload: r.payload,
      attempts: Number(r.attempts),
    }))
  }

  async consoleAlertsSince(afterId: number, limit = 50): Promise<ConsoleAlert[]> {
    const { rows } = await this.pool.query(
      `SELECT id, ticket_id, kind, payload, read_at, created_at FROM support_notifications
       WHERE channel = 'console' AND id > $1 ORDER BY id DESC LIMIT $2`,
      [afterId, limit],
    )
    return rows.reverse().map((r) => ({
      id: Number(r.id),
      ticketId: r.ticket_id,
      kind: r.kind,
      payload: r.payload,
      readAt: iso(r.read_at),
      createdAt: iso(r.created_at)!,
    }))
  }

  async markAlertsRead(ids: number[]) {
    if (ids.length) await this.pool.query(`UPDATE support_notifications SET read_at = now() WHERE id = ANY($1::bigint[])`, [ids])
  }

  async lookupPhone(phone: string): Promise<DirectoryEntry | null> {
    const r = await this.one(`SELECT phone_e164, user_id, tenant_id, full_name, email FROM support_user_directory WHERE phone_e164 = $1`, [phone])
    return r
      ? { phone: r.phone_e164 as string, userId: r.user_id as string, tenantId: r.tenant_id as string, name: (r.full_name as string) ?? null, email: (r.email as string) ?? null }
      : null
  }

  async phoneForUser(userId: string) {
    const r = await this.one(`SELECT phone_e164 FROM support_user_directory WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`, [userId])
    return (r?.phone_e164 as string) ?? null
  }

  async searchKnowledge(query: string, audience: 'customer' | 'lead', limit = 3): Promise<KbArticle[]> {
    const { rows } = await this.pool.query(
      `SELECT slug, title, body, ts_rank(search, q) AS score
       FROM support_kb_articles,
         -- OR entre términos: una pregunta larga no debe exigir que el artículo contenga todas las palabras
         CAST(nullif(replace(plainto_tsquery('spanish', $1)::text, '&', '|'), '') AS tsquery) AS q
       WHERE published AND audience IN ('all', $2) AND search @@ q
       ORDER BY score DESC LIMIT $3`,
      [query.slice(0, 500), audience, limit],
    )
    return rows.map((r) => ({ slug: r.slug, title: r.title, body: r.body, score: Number(r.score) }))
  }
}
