// Orquestación del helpdesk: entrada omnicanal, triaje con Kilo IA, handoff a humano,
// respuestas de agentes y entrega por el canal activo del cliente.
import type { AccountProvider } from './accounts'
import { decideEscalation, detectConfirmation, detectHumanRequest, POLICY } from './escalation'
import { subjectFrom, type AccountSnapshot, type KiloAI } from './kiloAI'
import type { Notifier } from './notifications'
import type { HelpdeskRepository, NewAttachment } from './repository'
import { assertTransition, CUSTOMER_STATUS, isTerminal, PRIORITY_RANK, statusOnCustomerMessage } from './status'
import { findTicketCode } from './ticketCode'
import type {
  Channel,
  EscalationReason,
  InboxFilters,
  OriginSource,
  PublicTicket,
  Requester,
  Ticket,
  TicketMessage,
  TicketPriority,
  TicketStatus,
} from './types'
import { WhatsAppError, type WhatsAppSender } from './whatsapp'

export const BTN_RESOLVED = 'KILO_RESOLVED'
export const BTN_HUMAN = 'KILO_HUMAN'
const WINDOW_MS = 24 * 60 * 60 * 1000

export interface Agent {
  id: string
  name: string
}

export interface InboundInput {
  channel: Exclude<Channel, 'CONSOLE'>
  source: OriginSource
  requester: Requester
  text: string
  /** wamid u otro id externo: idempotencia ante reintentos del webhook. */
  externalId?: string | null
  buttonId?: string | null
  /** Web: agregar al caso indicado (validado contra el solicitante). */
  ticketId?: string | null
  /** Web: forzar caso nuevo («Nueva consulta»). */
  forceNew?: boolean
  attachments?: Omit<NewAttachment, 'ticketId' | 'messageId' | 'uploadedBy'>[]
}

export interface InboundResult {
  ticket: Ticket | null
  created: boolean
  duplicate?: boolean
  outcome: 'ai_replied' | 'resolved_by_ai' | 'escalated' | 'routed_to_agent' | 'noop'
}

export interface ReplyOptions {
  body: string
  internal?: boolean
  /** auto = canal activo del cliente; web = sólo panel; whatsapp/both fuerzan WhatsApp. */
  deliverVia?: 'auto' | 'web' | 'whatsapp' | 'both'
  /** Estado después de responder (por defecto «Esperando tu respuesta»). */
  nextStatus?: Extract<TicketStatus, 'WAITING_CUSTOMER' | 'IN_REVIEW' | 'RESOLVED'>
  attachments?: Omit<NewAttachment, 'ticketId' | 'messageId' | 'uploadedBy'>[]
}

export interface ServiceConfig {
  replyTemplate?: { name: string; language: string } // reabrir conversación >24 h
  now?: () => Date
}

export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}

export class HelpdeskService {
  private now: () => Date
  constructor(
    private repo: HelpdeskRepository,
    private ai: KiloAI,
    private wa: WhatsAppSender | null,
    private notifier: Notifier,
    private accounts: AccountProvider,
    private cfg: ServiceConfig = {},
  ) {
    this.now = cfg.now ?? (() => new Date())
  }

  private iso = () => this.now().toISOString()

  // =============================================================================== entrada

  async handleInbound(input: InboundInput): Promise<InboundResult> {
    if (input.externalId && (await this.repo.messageExists(input.externalId))) {
      const t = input.ticketId ? await this.repo.getTicket(input.ticketId) : null
      return { ticket: t, created: false, duplicate: true, outcome: 'noop' }
    }
    const text = cleanInbound(input.text)
    let { ticket, created } = await this.resolveTicket(input, text)

    // Mensaje del cliente al hilo
    const msg = await this.repo.addMessage({
      ticketId: ticket.id,
      authorType: 'CUSTOMER',
      authorId: input.requester.type === 'USER' ? input.requester.userId : null,
      authorName: input.requester.name,
      channel: input.channel,
      body: text,
      externalId: input.externalId ?? null,
      metadata: input.buttonId ? { buttonId: input.buttonId } : {},
    })
    for (const a of input.attachments ?? []) {
      await this.repo.addAttachment({ ...a, ticketId: ticket.id, messageId: msg.id, uploadedBy: 'CUSTOMER' })
    }
    const at = this.iso()
    ticket = await this.repo.updateTicket(ticket.id, {
      activeChannel: input.channel,
      lastCustomerMessageAt: at,
      lastMessageAt: at,
      ...(input.requester.type === 'LEAD' && input.requester.name && !ticket.leadName ? { leadName: input.requester.name } : {}),
    })

    // Caso en manos de un humano: Kilo IA no interviene, se avisa al agente.
    if (ticket.handledBy === 'HUMAN') {
      const next = statusOnCustomerMessage(ticket.status, 'HUMAN')
      ticket = await this.setStatus(ticket, next, 'CUSTOMER', null)
      await this.notifier.customerReplied(ticket, text)
      return { ticket, created, outcome: 'routed_to_agent' }
    }
    const turn = await this.aiTurn(ticket, input, text)
    return { ticket: turn.ticket, created, outcome: turn.outcome }
  }

  private async resolveTicket(input: InboundInput, text: string): Promise<{ ticket: Ticket; created: boolean }> {
    const r = input.requester
    const phone = r.phone

    if (input.ticketId) {
      const t = await this.repo.getTicket(input.ticketId)
      if (!t || !ownsTicket(r, t)) throw new NotFoundError('Caso no encontrado')
      return { ticket: await this.reopenIfNeeded(t), created: false }
    }
    if (!input.forceNew) {
      // ¿Menciona un caso suyo? («sobre el KIL-2026-0042…»)
      const code = findTicketCode(text)
      if (code) {
        const t = await this.repo.getTicketByCode(code)
        if (t && ownsTicket(r, t) && !(phone && (await this.repo.findOpenTicketByPhone(phone)))) {
          return { ticket: await this.reopenIfNeeded(t), created: false }
        }
      }
      const open = phone && input.channel === 'WHATSAPP' ? await this.repo.findOpenTicketByPhone(phone) : null
      if (open && ownsTicket(r, open)) return { ticket: open, created: false }
      // Cliente registrado con un caso vigente (p. ej. abierto en la web y continuado por WhatsApp):
      // se sigue en el mismo hilo, que queda sincronizado entre ambos canales.
      if (r.type === 'USER') {
        const mine = await this.repo.findOpenTicketForUser(r.userId)
        if (mine && ownsTicket(r, mine)) {
          const linked = input.channel === 'WHATSAPP' && phone && !mine.contactPhone ? await this.repo.updateTicket(mine.id, { contactPhone: phone }) : mine
          return { ticket: linked, created: false }
        }
      }
    }

    const ticket = await this.repo.createTicket({
      requesterType: r.type,
      userId: r.type === 'USER' ? r.userId : null,
      tenantId: r.type === 'USER' ? r.tenantId : null,
      leadPhone: r.type === 'LEAD' ? r.phone : null,
      leadName: r.type === 'LEAD' ? r.name : null,
      // Un caso web no ocupa el «caso abierto por teléfono»: el WhatsApp del cliente se ata a su caso de WhatsApp.
      contactPhone: input.channel === 'WHATSAPP' ? phone : null,
      contactEmail: r.type === 'USER' ? r.email : null,
      subject: subjectFrom(text),
      originChannel: input.channel,
      originSource: input.source,
    })
    await this.repo.addEvent({ ticketId: ticket.id, type: 'created', toValue: ticket.code, actorType: 'CUSTOMER', detail: { source: input.source } })
    if (r.type === 'LEAD') {
      await this.repo.enqueueNotification({
        ticketId: ticket.id,
        kind: 'new_lead',
        channel: 'console',
        recipient: null,
        payload: {
          code: ticket.code,
          summary: subjectFrom(text),
          requesterType: 'LEAD',
          requesterLabel: `Lead · ${r.name ?? ''} ${r.phone}`.trim(),
          priority: ticket.priority,
          link: `/admin/soporte/${ticket.code}`,
        },
      })
    }
    return { ticket, created: true }
  }

  private async reopenIfNeeded(t: Ticket) {
    if (!isTerminal(t.status)) return t
    const to: TicketStatus = t.handledBy === 'HUMAN' ? 'IN_REVIEW' : t.status === 'RESOLVED_BY_AI' ? 'OPEN' : 'IN_REVIEW'
    const reopened = await this.setStatus(t, to, 'CUSTOMER', null, { reopened: true })
    return this.repo.updateTicket(reopened.id, { resolvedAt: null, ...(to === 'IN_REVIEW' ? { handledBy: 'HUMAN' as const } : {}) })
  }

  // =============================================================================== Kilo IA

  private async aiTurn(ticket: Ticket, input: InboundInput, text: string): Promise<{ ticket: Ticket; outcome: InboundResult['outcome'] }> {
    const confirmation = input.buttonId === BTN_RESOLVED ? 'yes' : input.buttonId === BTN_HUMAN ? 'human' : detectConfirmation(text)

    // Botón explícito «Sí, resuelto» o un «sí» en respuesta a «¿Esto resolvió tu consulta?».
    if (confirmation === 'yes' && (ticket.status === 'WAITING_CUSTOMER' || (input.buttonId === BTN_RESOLVED && ticket.aiAttempts > 0))) {
      return { ticket: await this.resolveByAI(ticket), outcome: 'resolved_by_ai' }
    }
    if (confirmation === 'human') {
      return { ticket: await this.escalate(ticket, ['HUMAN_REQUESTED'], 'NORMAL'), outcome: 'escalated' }
    }
    if (ticket.status === 'WAITING_CUSTOMER' && confirmation === 'no') {
      return { ticket: await this.escalate(ticket, ['AI_NOT_RESOLVED'], 'NORMAL'), outcome: 'escalated' }
    }

    // Atajo determinista: pedir una persona no necesita al modelo.
    if (detectHumanRequest(text)) {
      return { ticket: await this.escalate(ticket, ['HUMAN_REQUESTED'], 'NORMAL'), outcome: 'escalated' }
    }

    const history = (await this.repo.listMessages(ticket.id)).slice(0, -1)
    const requester = input.requester
    const [knowledge, account] = await Promise.all([
      this.repo.searchKnowledge(text, requester.type === 'USER' ? 'customer' : 'lead', 4),
      this.snapshotFor(ticket),
    ])
    const triage = await this.ai.triage({ ticketCode: ticket.code, requester, history, message: text, knowledge, account })

    const decision = decideEscalation({
      confidence: triage.confidence,
      sentiment: triage.sentiment,
      intent: triage.intent,
      category: triage.category,
      requiresIntervention: triage.requires_human_intervention,
      requesterType: ticket.requesterType,
      aiAttempts: ticket.aiAttempts,
      text,
    })
    // Un saludo no es una consulta con baja confianza.
    const greetingOnly = triage.intent === 'greeting' && decision.reasons.every((r) => r === 'LOW_CONFIDENCE')

    ticket = await this.repo.updateTicket(ticket.id, {
      category: ticket.category ?? triage.category,
      aiConfidence: triage.confidence,
      priority: maxPriority(ticket.priority, decision.priority),
      ...(ticket.aiAttempts === 0 && triage.intent !== 'greeting' && triage.subject ? { subject: triage.subject } : {}),
    })

    if (decision.escalate && !greetingOnly) {
      // Si la IA tenía algo útil (p. ej. frustración pero respuesta correcta) lo dejamos en el hilo antes del handoff.
      if (triage.confidence >= POLICY.minConfidence && triage.reply && !decision.reasons.includes('HUMAN_REQUESTED')) {
        await this.postAI(ticket, triage.reply, { confidence: triage.confidence, intent: triage.intent, articles: triage.used_articles })
      }
      return { ticket: await this.escalate(ticket, decision.reasons, decision.priority), outcome: 'escalated' }
    }

    const ask = triage.intent !== 'greeting'
    await this.postAI(ticket, triage.reply, { confidence: triage.confidence, intent: triage.intent, articles: triage.used_articles, askConfirmation: ask })
    const at = this.iso()
    ticket = await this.repo.updateTicket(ticket.id, {
      aiAttempts: ask ? ticket.aiAttempts + 1 : ticket.aiAttempts,
      firstResponseAt: ticket.firstResponseAt ?? at,
      lastMessageAt: at,
    })
    if (ask) ticket = await this.setStatus(ticket, 'WAITING_CUSTOMER', 'AI', null)
    return { ticket, outcome: 'ai_replied' }
  }

  private async snapshotFor(t: Ticket): Promise<AccountSnapshot | null> {
    return t.userId && t.tenantId ? this.accounts.snapshot(t.userId, t.tenantId) : null
  }

  private async postAI(t: Ticket, body: string, meta: Record<string, unknown> & { askConfirmation?: boolean }) {
    const msg = await this.repo.addMessage({ ticketId: t.id, authorType: 'AI', authorName: 'Kilo IA', channel: t.activeChannel, body, metadata: meta })
    await this.deliver(t, msg, 'auto', meta.askConfirmation ? 'confirm' : undefined)
    return msg
  }

  private async resolveByAI(t: Ticket) {
    const resolved = await this.setStatus(t, 'RESOLVED_BY_AI', 'CUSTOMER', null)
    const at = this.iso()
    const ticket = await this.repo.updateTicket(t.id, { resolvedAt: at, lastMessageAt: at })
    await this.postAI(resolved, `¡Genial! Marqué tu caso ${t.code} como resuelto. Si necesitas algo más, escríbenos cuando quieras. 🙌`, { closing: true })
    return ticket
  }

  // =============================================================================== handoff

  async escalate(t: Ticket, reasons: EscalationReason[], priority: TicketPriority, by: Agent | null = null): Promise<Ticket> {
    if (t.status === 'ESCALATED_TO_HUMAN' || t.status === 'IN_REVIEW') return t
    assertTransition(t.status, 'ESCALATED_TO_HUMAN')
    const history = await this.repo.listMessages(t.id)
    const requester = requesterOf(t)
    const summary = await this.ai.summarize({ ticketCode: t.code, requester, history, account: await this.snapshotFor(t), reasons })
    const at = this.iso()
    let ticket = await this.repo.updateTicket(t.id, {
      status: 'ESCALATED_TO_HUMAN',
      handledBy: 'HUMAN',
      escalatedAt: at,
      escalationReasons: [...new Set([...t.escalationReasons, ...reasons])],
      aiSummary: summary,
      priority: maxPriority(t.priority, priority),
      lastMessageAt: at,
    })
    await this.repo.addEvent({
      ticketId: t.id,
      type: 'escalated',
      fromValue: t.status,
      toValue: 'ESCALATED_TO_HUMAN',
      actorType: by ? 'AGENT' : 'AI',
      actorId: by?.id ?? null,
      detail: { reasons },
    })
    // Nota interna con el resumen para el agente + aviso al cliente.
    await this.repo.addMessage({
      ticketId: t.id,
      authorType: 'SYSTEM',
      authorName: 'Kilo IA',
      channel: 'CONSOLE',
      visibility: 'INTERNAL',
      body: `Resumen para el agente: ${summary.headline}. ${summary.problem}`,
      metadata: { summary, reasons },
    })
    const lead = t.requesterType === 'LEAD'
    await this.postAI(
      ticket,
      lead
        ? `Te estoy conectando con una persona de nuestro equipo comercial. Tu número de caso es ${t.code}; te escribiremos por aquí muy pronto.`
        : `Te estoy derivando con una persona del equipo de soporte de Kilora. Tu número de caso es ${t.code}. Puedes seguirlo en «Mis casos de soporte» o por este mismo chat.`,
      { handoff: true },
    )
    ticket = (await this.repo.getTicket(t.id))!
    await this.notifier.escalation(ticket, summary, reasons)
    return ticket
  }

  // =============================================================================== agentes

  async agentReply(ticketId: string, agent: Agent, opts: ReplyOptions): Promise<{ ticket: Ticket; message: TicketMessage }> {
    let t = await this.mustGet(ticketId)
    if (!opts.body.trim() && !opts.attachments?.length) throw new Error('El mensaje está vacío')
    const msg = await this.repo.addMessage({
      ticketId,
      authorType: 'AGENT',
      authorId: agent.id,
      authorName: agent.name,
      channel: opts.internal ? 'CONSOLE' : this.targetChannel(t, opts.deliverVia ?? 'auto'),
      visibility: opts.internal ? 'INTERNAL' : 'PUBLIC',
      body: opts.body.trim(),
    })
    for (const a of opts.attachments ?? []) await this.repo.addAttachment({ ...a, ticketId, messageId: msg.id, uploadedBy: 'AGENT' })
    if (opts.internal) return { ticket: t, message: msg }

    // Tomar el caso: un humano responde → el caso es suyo.
    if (t.handledBy === 'AI') t = await this.repo.updateTicket(t.id, { handledBy: 'HUMAN' })
    if (!t.assigneeId) t = await this.assign(t.id, agent, agent)
    if (t.status === 'ESCALATED_TO_HUMAN' || isTerminal(t.status) || t.status === 'OPEN') t = await this.setStatus(t, 'IN_REVIEW', 'AGENT', agent.id)
    const next = opts.nextStatus ?? 'WAITING_CUSTOMER'
    t = await this.setStatus(t, next, 'AGENT', agent.id)
    const at = this.iso()
    t = await this.repo.updateTicket(t.id, { lastMessageAt: at, firstResponseAt: t.firstResponseAt ?? at, ...(next === 'RESOLVED' ? { resolvedAt: at } : {}) })

    const delivered = await this.deliver(t, msg, opts.deliverVia ?? 'auto')
    return { ticket: t, message: delivered }
  }

  async assign(ticketId: string, assignee: Agent | null, by: Agent) {
    const t = await this.mustGet(ticketId)
    const updated = await this.repo.updateTicket(ticketId, { assigneeId: assignee?.id ?? null, assigneeName: assignee?.name ?? null })
    await this.repo.addEvent({ ticketId, type: 'assigned', fromValue: t.assigneeName, toValue: assignee?.name ?? null, actorType: 'AGENT', actorId: by.id })
    return updated
  }

  async changeStatus(ticketId: string, to: TicketStatus, by: Agent) {
    let t = await this.mustGet(ticketId)
    if (to === 'ESCALATED_TO_HUMAN') return this.escalate(t, ['HUMAN_REQUESTED'], t.priority, by)
    t = await this.setStatus(t, to, 'AGENT', by.id)
    if (to === 'IN_REVIEW' && t.handledBy === 'AI') t = await this.repo.updateTicket(t.id, { handledBy: 'HUMAN' })
    if (isTerminal(to)) t = await this.repo.updateTicket(t.id, { resolvedAt: this.iso() })
    return t
  }

  async changePriority(ticketId: string, priority: TicketPriority, by: Agent) {
    const t = await this.mustGet(ticketId)
    const updated = await this.repo.updateTicket(ticketId, { priority })
    await this.repo.addEvent({ ticketId, type: 'priority_changed', fromValue: t.priority, toValue: priority, actorType: 'AGENT', actorId: by.id })
    return updated
  }

  /** Devuelve el caso a Kilo IA (p. ej. el agente resolvió el bloqueo y la IA puede seguir). */
  async handBackToAI(ticketId: string, by: Agent) {
    const t = await this.mustGet(ticketId)
    const next = await this.repo.updateTicket(ticketId, { handledBy: 'AI', aiAttempts: 0 })
    await this.repo.addEvent({ ticketId, type: 'handed_back_to_ai', fromValue: t.handledBy, toValue: 'AI', actorType: 'AGENT', actorId: by.id })
    return next
  }

  // =============================================================================== entrega

  private targetChannel(t: Ticket, via: NonNullable<ReplyOptions['deliverVia']>): Channel {
    if (via === 'web') return 'WEB'
    if (via === 'whatsapp' || via === 'both') return 'WHATSAPP'
    return t.requesterType === 'LEAD' || t.activeChannel === 'WHATSAPP' ? 'WHATSAPP' : 'WEB'
  }

  private async phoneOf(t: Ticket) {
    return t.contactPhone ?? t.leadPhone ?? (t.userId ? await this.repo.phoneForUser(t.userId) : null)
  }

  /**
   * Web: el mensaje ya quedó en el hilo (el panel lo muestra). WhatsApp: se envía si el canal
   * activo es WhatsApp (o se fuerza). Fuera de la ventana de 24 h se usa la plantilla aprobada.
   */
  private async deliver(t: Ticket, msg: TicketMessage, via: NonNullable<ReplyOptions['deliverVia']>, mode?: 'confirm'): Promise<TicketMessage> {
    const target = this.targetChannel(t, via)
    if (target !== 'WHATSAPP') return msg
    const phone = await this.phoneOf(t)
    if (!phone || !this.wa) {
      await this.repo.setMessageDelivery(msg.id, 'FAILED', null, phone ? 'WhatsApp no configurado' : 'Sin teléfono de contacto')
      return { ...msg, deliveryStatus: 'FAILED' }
    }
    const inWindow = !!t.lastCustomerMessageAt && this.now().getTime() - Date.parse(t.lastCustomerMessageAt) < WINDOW_MS
    try {
      let id: string
      if (!inWindow) id = await this.sendTemplateReply(phone, t, msg.body)
      else if (mode === 'confirm')
        id = await this.wa.sendButtons(phone, `${msg.body}\n\n¿Esto resolvió tu consulta?`, [
          { id: BTN_RESOLVED, title: 'Sí, resuelto' },
          { id: BTN_HUMAN, title: 'Hablar con persona' },
        ])
      else id = await this.wa.sendText(phone, prefix(msg) + msg.body)
      await this.repo.setMessageDelivery(msg.id, 'SENT', id)
      return { ...msg, deliveryStatus: 'SENT', externalId: id }
    } catch (e) {
      if (e instanceof WhatsAppError && e.outsideWindow) {
        try {
          const id = await this.sendTemplateReply(phone, t, msg.body)
          await this.repo.setMessageDelivery(msg.id, 'SENT', id)
          return { ...msg, deliveryStatus: 'SENT', externalId: id }
        } catch (e2) {
          e = e2
        }
      }
      const err = e instanceof Error ? e.message : String(e)
      await this.repo.setMessageDelivery(msg.id, 'FAILED', null, err)
      return { ...msg, deliveryStatus: 'FAILED', deliveryError: err }
    }
  }

  private async sendTemplateReply(phone: string, t: Ticket, body: string) {
    if (!this.wa) throw new Error('WhatsApp no configurado')
    if (!this.cfg.replyTemplate) throw new WhatsAppError('Ventana de 24 h cerrada y sin plantilla configurada', 131047)
    // Plantilla sugerida: «Hay una respuesta en tu caso {{1}} de Kilora: {{2}}»
    return this.wa.sendTemplate(phone, this.cfg.replyTemplate.name, this.cfg.replyTemplate.language, [t.code, body.slice(0, 900)])
  }

  // =============================================================================== lecturas

  async listForUser(userId: string, tenantId: string): Promise<PublicTicket[]> {
    const rows = await this.repo.listTicketsForUser(userId, tenantId)
    return Promise.all(rows.map((t) => this.toPublic(t)))
  }

  async getForUser(userId: string, tenantId: string, idOrCode: string) {
    const t = (await this.repo.getTicket(idOrCode).catch(() => null)) ?? (await this.repo.getTicketByCode(idOrCode))
    if (!t || t.userId !== userId || t.tenantId !== tenantId) throw new NotFoundError('Caso no encontrado')
    const messages = await this.repo.listMessages(t.id)
    return { ticket: await this.toPublic(t, messages), messages: messages.map(publicMessage) }
  }

  async inbox(filters: InboxFilters) {
    const [page, counts] = await Promise.all([this.repo.listInbox(filters), this.repo.inboxCounts()])
    return { ...page, counts }
  }

  async detailForAgent(idOrCode: string) {
    const t = (await this.repo.getTicketByCode(idOrCode)) ?? (await this.repo.getTicket(idOrCode).catch(() => null))
    if (!t) throw new NotFoundError('Caso no encontrado')
    const [messages, account, directory] = await Promise.all([
      this.repo.listMessages(t.id, { includeInternal: true }),
      this.snapshotFor(t),
      t.contactPhone ? this.repo.lookupPhone(t.contactPhone) : Promise.resolve(null),
    ])
    const phone = await this.phoneOf(t)
    const inWindow = !!t.lastCustomerMessageAt && this.now().getTime() - Date.parse(t.lastCustomerMessageAt) < WINDOW_MS
    return {
      ticket: t,
      messages,
      requester:
        t.requesterType === 'USER'
          ? { type: 'USER' as const, userId: t.userId, tenantId: t.tenantId, name: directory?.name ?? null, email: t.contactEmail, phone, account }
          : { type: 'LEAD' as const, name: t.leadName, phone: t.leadPhone },
      delivery: { whatsappAvailable: !!phone && !!this.wa, whatsappWindowOpen: inWindow, defaultChannel: this.targetChannel(t, 'auto') },
    }
  }

  private async toPublic(t: Ticket, messages?: TicketMessage[]): Promise<PublicTicket> {
    const last = (messages ?? []).filter((m) => m.authorType === 'AI').at(-1)
    return {
      id: t.id,
      code: t.code,
      subject: t.subject,
      status: t.status,
      statusLabel: CUSTOMER_STATUS[t.status],
      originChannel: t.originChannel,
      activeChannel: t.activeChannel,
      awaitingConfirmation: t.status === 'WAITING_CUSTOMER' && t.handledBy === 'AI' && (messages ? !!last?.metadata.askConfirmation : true),
      lastMessageAt: t.lastMessageAt,
      createdAt: t.createdAt,
      resolvedAt: t.resolvedAt,
    }
  }

  // =============================================================================== util

  private async mustGet(id: string) {
    const t = (await this.repo.getTicket(id).catch(() => null)) ?? (await this.repo.getTicketByCode(id))
    if (!t) throw new NotFoundError('Caso no encontrado')
    return t
  }

  private async setStatus(t: Ticket, to: TicketStatus, actorType: 'CUSTOMER' | 'AI' | 'AGENT', actorId: string | null, detail: Record<string, unknown> = {}) {
    if (t.status === to) return t
    assertTransition(t.status, to)
    const next = await this.repo.updateTicket(t.id, { status: to })
    await this.repo.addEvent({ ticketId: t.id, type: 'status_changed', fromValue: t.status, toValue: to, actorType, actorId, detail })
    return next
  }
}

// ----------------------------------------------------------------------------------- helpers

function ownsTicket(r: Requester, t: Ticket) {
  return r.type === 'USER' ? t.userId === r.userId && t.tenantId === r.tenantId : t.requesterType === 'LEAD' && t.leadPhone === r.phone
}

function requesterOf(t: Ticket): Requester {
  return t.requesterType === 'USER'
    ? { type: 'USER', userId: t.userId!, tenantId: t.tenantId!, name: null, phone: t.contactPhone, email: t.contactEmail }
    : { type: 'LEAD', phone: t.leadPhone!, name: t.leadName }
}

const maxPriority = (a: TicketPriority, b: TicketPriority) => (PRIORITY_RANK[a] >= PRIORITY_RANK[b] ? a : b)

/** Quita la marca de origen de la landing y espacios sobrantes. */
export function cleanInbound(text: string) {
  return text
    .replace(/\(?ref:LANDING[^\s)]*\)?/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function prefix(m: TicketMessage) {
  return m.authorType === 'AGENT' && m.authorName ? `*${m.authorName} · Kilora*\n` : ''
}

/** Vista del cliente: sin notas internas ni metadatos de triaje. */
function publicMessage(m: TicketMessage) {
  return {
    id: m.id,
    authorType: m.authorType,
    authorName: m.authorType === 'AGENT' ? m.authorName : m.authorType === 'AI' ? 'Kilo IA' : m.authorName,
    channel: m.channel,
    body: m.body,
    askConfirmation: !!m.metadata.askConfirmation,
    createdAt: m.createdAt,
    attachments: m.attachments ?? [],
  }
}
export type PublicMessage = ReturnType<typeof publicMessage>
