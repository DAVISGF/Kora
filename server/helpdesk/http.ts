// Router HTTP del helpdesk (Web Request/Response). Lo sirven api/helpdesk/[...route].ts en Vercel
// y el middleware de vite.config.ts en desarrollo.
//
//  Cliente (JWT role=customer)
//    GET    /api/helpdesk/me/tickets                     Mis casos
//    POST   /api/helpdesk/me/tickets                     Nueva consulta (widget Kilo IA)
//    GET    /api/helpdesk/me/tickets/:id                 Detalle + hilo público
//    POST   /api/helpdesk/me/tickets/:id/messages        Comentario / adjuntos
//    POST   /api/helpdesk/me/tickets/:id/confirm         ¿Resolvió Kilo IA? {resolved}
//  WhatsApp Cloud API
//    GET    /api/helpdesk/webhooks/whatsapp              Verificación del webhook
//    POST   /api/helpdesk/webhooks/whatsapp              Mensajes entrantes y estados
//  Consola (JWT role=agent|admin)
//    GET    /api/helpdesk/admin/tickets                  Bandeja unificada (filtros)
//    GET    /api/helpdesk/admin/tickets/:idOrCode        Detalle completo
//    POST   /api/helpdesk/admin/tickets/:id/messages     Respuesta omnicanal / nota interna
//    PATCH  /api/helpdesk/admin/tickets/:id              Estado, prioridad, asignación, devolver a IA
//    GET    /api/helpdesk/admin/stream                   Alertas en tiempo real (SSE)
//    GET    /api/helpdesk/admin/alerts                   Alertas (polling)
//    POST   /api/helpdesk/admin/alerts/read              Marcar alertas vistas
//  Comunes
//    GET    /api/helpdesk/attachments/:id                Descarga de adjunto
//    GET    /api/helpdesk/cron/notifications             Reintento del outbox (Vercel Cron)
import { waitUntil } from '@vercel/functions'
import { principalFrom, type Principal } from './auth'
import type { Helpdesk } from './container'
import { InvalidTransitionError } from './status'
import { ForbiddenError, NotFoundError, type Agent, type ReplyOptions } from './service'
import type { Channel, InboxFilters, Requester, TicketPriority, TicketStatus } from './types'
import { normalizePhone, parseWebhook, RecordingWhatsApp, verifySignature, verifySubscription, type InboundWhatsApp } from './whatsapp'

const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_FILES = 5
const STATUSES: TicketStatus[] = ['OPEN', 'WAITING_CUSTOMER', 'RESOLVED_BY_AI', 'ESCALATED_TO_HUMAN', 'IN_REVIEW', 'RESOLVED', 'CLOSED']
const PRIORITIES: TicketPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT']
const CHANNELS: Channel[] = ['WEB', 'WHATSAPP', 'EMAIL', 'CONSOLE']

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } })

const list = <T extends string>(v: string | null, allowed: readonly T[]) =>
  v ? (v.split(',').filter((x) => (allowed as readonly string[]).includes(x)) as T[]) : undefined

async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    throw new HttpError(400, 'JSON inválido')
  }
}

interface UploadIn {
  fileName?: unknown
  mimeType?: unknown
  dataBase64?: unknown
}

function decodeUploads(raw: unknown) {
  if (raw == null) return []
  if (!Array.isArray(raw) || raw.length > MAX_FILES) throw new HttpError(400, `Hasta ${MAX_FILES} adjuntos por mensaje`)
  return (raw as UploadIn[]).map((u) => {
    if (typeof u.fileName !== 'string' || typeof u.mimeType !== 'string' || typeof u.dataBase64 !== 'string') {
      throw new HttpError(400, 'Adjunto inválido: se espera {fileName, mimeType, dataBase64}')
    }
    if (!/^[\w.+-]+\/[\w.+-]+$/.test(u.mimeType)) throw new HttpError(400, 'Tipo de archivo inválido')
    const bytes = new Uint8Array(Buffer.from(u.dataBase64, 'base64'))
    if (bytes.byteLength > MAX_FILE_BYTES) throw new HttpError(413, 'Cada adjunto puede pesar hasta 10 MB')
    return {
      fileName: u.fileName.replace(/[\\/\r\n"]/g, '_').slice(0, 180) || 'archivo',
      mimeType: u.mimeType,
      sizeBytes: bytes.byteLength,
      storageProvider: 'db' as const,
      content: bytes,
    }
  })
}

const requireCustomer = (p: Principal | null) => {
  if (!p) throw new HttpError(401, 'Sesión requerida')
  if (p.kind !== 'customer') throw new HttpError(403, 'Sólo para clientes')
  return p
}
const requireAgent = (p: Principal | null): Agent => {
  if (!p) throw new HttpError(401, 'Sesión requerida')
  if (p.kind !== 'agent') throw new HttpError(403, 'Sólo para agentes de Kilora')
  return { id: p.agentId, name: p.name }
}

export async function handle(req: Request, hd: Helpdesk): Promise<Response> {
  await hd.ready
  const url = new URL(req.url)
  const path = url.pathname.replace(/^\/api\/helpdesk\/?/, '').replace(/\/$/, '')
  const seg = path.split('/').filter(Boolean)
  const m = req.method.toUpperCase()

  try {
    // ------------------------------------------------------------------ WhatsApp
    if (seg[0] === 'webhooks' && seg[1] === 'whatsapp') {
      if (m === 'GET') {
        const challenge = verifySubscription(url, hd.webhook.verifyToken)
        return challenge ? new Response(challenge, { status: 200 }) : json(403, { error: 'Token de verificación inválido' })
      }
      if (m === 'POST') return whatsappInbound(req, hd)
    }

    // ------------------------------------------------------------------ cron
    if (seg[0] === 'cron' && seg[1] === 'notifications') {
      if (hd.cronSecret && req.headers.get('authorization') !== `Bearer ${hd.cronSecret}`) throw new HttpError(401, 'No autorizado')
      return json(200, await hd.notifier.dispatch(100))
    }

    const principal = principalFrom(req, hd.auth)

    // ------------------------------------------------------------------ cliente
    if (seg[0] === 'me' && seg[1] === 'tickets') {
      const me = requireCustomer(principal)
      const requester: Requester = {
        type: 'USER',
        userId: me.userId,
        tenantId: me.tenantId,
        name: me.name,
        email: me.email,
        phone: await hd.repo.phoneForUser(me.userId),
      }
      if (seg.length === 2 && m === 'GET') return json(200, { items: await hd.service.listForUser(me.userId, me.tenantId) })
      if (seg.length === 2 && m === 'POST') {
        const b = await body<{ message?: string; attachments?: unknown }>(req)
        const text = String(b.message ?? '').trim()
        if (!text) throw new HttpError(400, 'Escribe tu consulta')
        const r = await hd.service.handleInbound({
          channel: 'WEB',
          source: 'in_app_widget',
          requester,
          text: text.slice(0, 4000),
          forceNew: true,
          attachments: decodeUploads(b.attachments),
        })
        return json(201, await hd.service.getForUser(me.userId, me.tenantId, r.ticket!.id))
      }
      const id = seg[2]
      if (seg.length === 3 && m === 'GET') return json(200, await hd.service.getForUser(me.userId, me.tenantId, id))
      if (seg.length === 4 && seg[3] === 'messages' && m === 'POST') {
        const b = await body<{ message?: string; attachments?: unknown }>(req)
        const files = decodeUploads(b.attachments)
        const text = String(b.message ?? '').trim()
        if (!text && !files.length) throw new HttpError(400, 'El mensaje está vacío')
        const t = await hd.service.getForUser(me.userId, me.tenantId, id)
        await hd.service.handleInbound({
          channel: 'WEB',
          source: 'in_app_widget',
          requester,
          text: text.slice(0, 4000) || `📎 ${files.map((f) => f.fileName).join(', ')}`,
          ticketId: t.ticket.id,
          attachments: files,
        })
        return json(200, await hd.service.getForUser(me.userId, me.tenantId, t.ticket.id))
      }
      if (seg.length === 4 && seg[3] === 'confirm' && m === 'POST') {
        const b = await body<{ resolved?: boolean }>(req)
        const t = await hd.service.getForUser(me.userId, me.tenantId, id)
        await hd.service.handleInbound({
          channel: 'WEB',
          source: 'in_app_widget',
          requester,
          text: b.resolved ? 'Sí, se resolvió mi consulta.' : 'No se resolvió. Quiero hablar con una persona.',
          buttonId: b.resolved ? 'KILO_RESOLVED' : 'KILO_HUMAN',
          ticketId: t.ticket.id,
        })
        return json(200, await hd.service.getForUser(me.userId, me.tenantId, t.ticket.id))
      }
    }

    // ------------------------------------------------------------------ adjuntos
    if (seg[0] === 'attachments' && seg.length === 2 && m === 'GET') {
      if (!principal) throw new HttpError(401, 'Sesión requerida')
      const a = await hd.repo.getAttachment(seg[1])
      if (!a) throw new HttpError(404, 'Adjunto no encontrado')
      if (principal.kind === 'customer') {
        const t = await hd.repo.getTicket(a.meta.ticketId)
        if (!t || t.userId !== principal.userId || t.tenantId !== principal.tenantId) throw new HttpError(404, 'Adjunto no encontrado')
      }
      let bytes = a.content
      let mime = a.meta.mimeType
      if (!bytes && a.meta.storageProvider === 'whatsapp' && a.meta.storageKey && hd.wa) {
        const media = await hd.wa.downloadMedia(a.meta.storageKey)
        bytes = media.bytes
        mime = media.mimeType
      }
      if (!bytes) throw new HttpError(404, 'Contenido no disponible')
      const inline = /^image\/|^application\/pdf$/.test(mime)
      return new Response(Buffer.from(bytes), {
        headers: {
          'Content-Type': mime,
          'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${a.meta.fileName}"`,
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
          'Cache-Control': 'private, max-age=300',
        },
      })
    }

    // ------------------------------------------------------------------ consola
    if (seg[0] === 'admin') {
      const agent = requireAgent(principal)
      if (seg[1] === 'health' && m === 'GET') return json(200, { mode: hd.mode })

      if (seg[1] === 'tickets' && seg.length === 2 && m === 'GET') {
        const q = url.searchParams
        const filters: InboxFilters = {
          status: list(q.get('status'), STATUSES),
          priority: list(q.get('priority'), PRIORITIES),
          channel: list(q.get('channel'), CHANNELS),
          requesterType: q.get('requester') === 'USER' || q.get('requester') === 'LEAD' ? (q.get('requester') as 'USER' | 'LEAD') : undefined,
          assigneeId: q.get('assignee') === 'me' ? agent.id : undefined,
          q: q.get('q')?.slice(0, 100) || undefined,
          cursor: q.get('cursor') || undefined,
          limit: Number(q.get('limit')) || 50,
        }
        return json(200, await hd.service.inbox(filters))
      }
      if (seg[1] === 'tickets' && seg.length === 3 && m === 'GET') return json(200, await hd.service.detailForAgent(seg[2]))
      if (seg[1] === 'tickets' && seg.length === 4 && seg[3] === 'messages' && m === 'POST') {
        const b = await body<{ body?: string; internal?: boolean; deliverVia?: ReplyOptions['deliverVia']; nextStatus?: ReplyOptions['nextStatus']; attachments?: unknown }>(req)
        const via = ['auto', 'web', 'whatsapp', 'both'].includes(String(b.deliverVia)) ? b.deliverVia : 'auto'
        const next = ['WAITING_CUSTOMER', 'IN_REVIEW', 'RESOLVED'].includes(String(b.nextStatus)) ? b.nextStatus : undefined
        await hd.service.agentReply(seg[2], agent, {
          body: String(b.body ?? '').slice(0, 4000),
          internal: !!b.internal,
          deliverVia: via,
          nextStatus: next,
          attachments: decodeUploads(b.attachments),
        })
        return json(200, await hd.service.detailForAgent(seg[2]))
      }
      if (seg[1] === 'tickets' && seg.length === 3 && m === 'PATCH') {
        const b = await body<{ status?: string; priority?: string; assignee?: 'me' | null; handBackToAI?: boolean }>(req)
        const id = seg[2]
        if (b.status) {
          if (!STATUSES.includes(b.status as TicketStatus)) throw new HttpError(400, 'Estado inválido')
          await hd.service.changeStatus(id, b.status as TicketStatus, agent)
        }
        if (b.priority) {
          if (!PRIORITIES.includes(b.priority as TicketPriority)) throw new HttpError(400, 'Prioridad inválida')
          await hd.service.changePriority(id, b.priority as TicketPriority, agent)
        }
        if (b.assignee !== undefined) await hd.service.assign(id, b.assignee === 'me' ? agent : null, agent)
        if (b.handBackToAI) await hd.service.handBackToAI(id, agent)
        return json(200, await hd.service.detailForAgent(id))
      }
      if (seg[1] === 'alerts' && seg.length === 2 && m === 'GET') {
        return json(200, { items: await hd.repo.consoleAlertsSince(Number(url.searchParams.get('after')) || 0) })
      }
      if (seg[1] === 'alerts' && seg[2] === 'read' && m === 'POST') {
        const b = await body<{ ids?: number[] }>(req)
        await hd.repo.markAlertsRead((b.ids ?? []).filter(Number.isInteger).slice(0, 500))
        return json(200, { ok: true })
      }
      if (seg[1] === 'stream' && m === 'GET') return alertStream(req, hd, Number(req.headers.get('last-event-id')) || Number(url.searchParams.get('after')) || 0)
    }

    // ------------------------------------------------------------------ desarrollo
    if (seg[0] === 'dev' && hd.wa instanceof RecordingWhatsApp && hd.auth.devAuth) {
      if (seg[1] === 'whatsapp' && seg[2] === 'outbox' && m === 'GET') return json(200, { sent: hd.wa.sent.slice(-50) })
      if (seg[1] === 'whatsapp' && seg[2] === 'simulate' && m === 'POST') {
        // Simula un mensaje entrante de WhatsApp sin Meta: {from, name?, text, buttonId?}
        const b = await body<{ from?: string; name?: string; text?: string; buttonId?: string }>(req)
        const from = normalizePhone(String(b.from ?? ''))
        if (!from || !b.text) throw new HttpError(400, 'Se espera {from, text}')
        const results = await processWhatsApp(hd, [
          {
            waMessageId: `wamid.sim.${Date.now()}`,
            from,
            profileName: b.name ?? null,
            timestamp: new Date().toISOString(),
            type: b.buttonId ? 'interactive' : 'text',
            text: b.text,
            buttonId: b.buttonId ?? null,
            media: null,
            fromLanding: b.text.includes('ref:LANDING'),
          },
        ])
        return json(200, { results, outbox: hd.wa.sent.slice(-5) })
      }
    }

    return json(404, { error: 'Ruta no encontrada' })
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message })
    if (e instanceof NotFoundError) return json(404, { error: e.message })
    if (e instanceof ForbiddenError) return json(403, { error: e.message })
    if (e instanceof InvalidTransitionError) return json(409, { error: e.message })
    console.error('[helpdesk]', e)
    return json(500, { error: 'Error interno del helpdesk' })
  }
}

// ------------------------------------------------------------------------------- WhatsApp entrante

async function whatsappInbound(req: Request, hd: Helpdesk): Promise<Response> {
  const raw = await req.text()
  if (hd.webhook.appSecret) {
    if (!verifySignature(raw, req.headers.get('x-hub-signature-256'), hd.webhook.appSecret)) return json(401, { error: 'Firma inválida' })
  } else if (!hd.auth.devAuth) {
    return json(503, { error: 'Falta WHATSAPP_APP_SECRET' })
  }
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return json(400, { error: 'JSON inválido' })
  }
  const { messages, statuses } = parseWebhook(payload)
  // Respondemos 200 de inmediato (Meta reintenta si tardamos) y procesamos en segundo plano.
  // La idempotencia por wamid evita duplicados si Meta reintenta igual.
  const work = (async () => {
    for (const s of statuses) await hd.repo.updateDelivery(s.waMessageId, s.status, s.error)
    await processWhatsApp(hd, messages)
  })().catch((e) => console.error('[helpdesk] webhook', e))
  waitUntil(work)
  return json(200, { received: messages.length, statuses: statuses.length })
}

async function processWhatsApp(hd: Helpdesk, messages: InboundWhatsApp[]) {
  const results = []
  for (const msg of messages) {
    const entry = await hd.repo.lookupPhone(msg.from)
    const requester: Requester = entry
      ? { type: 'USER', userId: entry.userId, tenantId: entry.tenantId, name: entry.name ?? msg.profileName, phone: msg.from, email: entry.email }
      : { type: 'LEAD', phone: msg.from, name: msg.profileName }
    const attachments = []
    if (msg.media) {
      let content: Uint8Array | null = null
      if (hd.wa && !(hd.wa instanceof RecordingWhatsApp)) {
        try {
          const media = await hd.wa.downloadMedia(msg.media.id)
          if (media.bytes.byteLength <= MAX_FILE_BYTES) content = media.bytes
        } catch (e) {
          console.error('[helpdesk] media', e) // queda la referencia para descargarla después
        }
      }
      const ext = msg.media.mimeType.split('/')[1]?.split(';')[0] ?? 'bin'
      attachments.push({
        fileName: msg.media.fileName ?? `whatsapp-${msg.type}.${ext}`,
        mimeType: msg.media.mimeType,
        sizeBytes: content?.byteLength ?? 0,
        storageProvider: content ? ('db' as const) : ('whatsapp' as const),
        storageKey: content ? null : msg.media.id,
        content,
      })
    }
    const r = await hd.service.handleInbound({
      channel: 'WHATSAPP',
      source: msg.fromLanding ? 'landing' : 'whatsapp',
      requester,
      text: msg.text || (msg.media ? `📎 ${msg.type}` : '(mensaje sin texto)'),
      externalId: msg.waMessageId,
      buttonId: msg.buttonId,
      attachments,
    })
    results.push({ code: r.ticket?.code ?? null, status: r.ticket?.status ?? null, outcome: r.outcome, created: r.created })
  }
  return results
}

// ------------------------------------------------------------------------------- SSE

function alertStream(req: Request, hd: Helpdesk, after: number): Response {
  const enc = new TextEncoder()
  let last = after
  let closed = false
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => {
        if (!closed) controller.enqueue(enc.encode(s))
      }
      send('retry: 3000\n\n')
      const started = Date.now()
      req.signal.addEventListener('abort', () => (closed = true))
      // Sondea el outbox de consola; cada ~55 s cierra y el EventSource del navegador reconecta solo.
      while (!closed && Date.now() - started < 55_000) {
        try {
          const alerts = await hd.repo.consoleAlertsSince(last)
          for (const a of alerts) {
            last = a.id
            send(`id: ${a.id}\nevent: alert\ndata: ${JSON.stringify(a)}\n\n`)
          }
          if (!alerts.length) send(': ping\n\n')
        } catch (e) {
          console.error('[helpdesk] sse', e)
        }
        await new Promise((r) => setTimeout(r, 2000))
      }
      closed = true
      controller.close()
    },
    cancel() {
      closed = true
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
  })
}
