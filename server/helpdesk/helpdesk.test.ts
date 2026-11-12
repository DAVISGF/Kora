import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { StaticAccountProvider } from './accounts'
import { signJwt, verifyJwt } from './auth'
import type { Helpdesk } from './container'
import { decideEscalation, detectConfirmation, detectHumanRequest, frustrationScore } from './escalation'
import { handle } from './http'
import { HeuristicKiloAI } from './kiloAI'
import { MemoryRepository } from './memoryRepository'
import { Notifier } from './notifications'
import { KB_ARTICLES } from './seed'
import { HelpdeskService, cleanInbound } from './service'
import { canTransition, CUSTOMER_STATUS } from './status'
import { findTicketCode, formatTicketCode, parseTicketCode } from './ticketCode'
import type { Requester } from './types'
import { normalizePhone, parseWebhook, RecordingWhatsApp, verifySignature } from './whatsapp'
import { buildWhatsAppLink } from './whatsappLink'

const USER: Requester = { type: 'USER', userId: 'u-1', tenantId: 't-1', name: 'Camila Rojas', phone: '+56911112222', email: 'camila@example.com' }
const LEAD: Requester = { type: 'LEAD', phone: '+56987654321', name: 'Jorge' }
const TEAM = '+56900000001'
const AGENT = { id: 'a-1', name: 'Paula' }

function setup(now = () => new Date('2026-03-10T12:00:00Z')) {
  const repo = new MemoryRepository(now)
  repo.kb = KB_ARTICLES.map((a) => ({ ...a }))
  repo.directory.set(USER.phone!, { phone: USER.phone!, userId: 'u-1', tenantId: 't-1', name: 'Camila Rojas', email: 'camila@example.com' })
  const wa = new RecordingWhatsApp()
  const notifier = new Notifier(repo, wa, { consoleBaseUrl: 'https://admin.kilora.test', teamPhones: [TEAM] }, () => {})
  const accounts = new StaticAccountProvider({ 't-1': { companyName: 'Transportes Andes', plan: 'Pro', fleetSize: 48, billingStatus: 'al_dia' } })
  const svc = new HelpdeskService(repo, new HeuristicKiloAI(), wa, notifier, accounts, { replyTemplate: { name: 'kilora_case_reply', language: 'es' }, now })
  return { repo, wa, svc }
}

describe('código de caso KIL-YYYY-XXXX', () => {
  it('formatea, valida y encuentra el código en texto libre', () => {
    expect(formatTicketCode(2026, 7)).toBe('KIL-2026-0007')
    expect(formatTicketCode(2026, 12345)).toBe('KIL-2026-12345')
    expect(parseTicketCode('kil-2026-0042')).toEqual({ year: 2026, seq: 42 })
    expect(parseTicketCode('KIL-26-0042')).toBeNull()
    expect(findTicketCode('hola, sigo con el kil-2026-0042 por favor')).toBe('KIL-2026-0042')
  })

  it('genera correlativos únicos por año', async () => {
    const { repo } = setup()
    const base = { requesterType: 'LEAD' as const, userId: null, tenantId: null, leadName: null, contactEmail: null, subject: 's', originChannel: 'WHATSAPP' as const, originSource: 'whatsapp' as const }
    const a = await repo.createTicket({ ...base, leadPhone: '+56900000010', contactPhone: '+56900000010' })
    const b = await repo.createTicket({ ...base, leadPhone: '+56900000011', contactPhone: '+56900000011' })
    expect([a.code, b.code]).toEqual(['KIL-2026-0001', 'KIL-2026-0002'])
  })
})

describe('estados', () => {
  it('mapea al lenguaje del cliente', () => {
    expect(CUSTOMER_STATUS.ESCALATED_TO_HUMAN).toBe('En Revisión')
    expect(CUSTOMER_STATUS.WAITING_CUSTOMER).toBe('Esperando tu respuesta')
    expect(CUSTOMER_STATUS.RESOLVED_BY_AI).toBe('Resuelto')
  })
  it('no permite saltos inválidos', () => {
    expect(canTransition('OPEN', 'ESCALATED_TO_HUMAN')).toBe(true)
    expect(canTransition('ESCALATED_TO_HUMAN', 'RESOLVED_BY_AI')).toBe(false)
    expect(canTransition('RESOLVED', 'OPEN')).toBe(false)
  })
})

describe('reglas de escalamiento', () => {
  it('detecta pedido de persona, frustración y confirmaciones', () => {
    expect(detectHumanRequest('Quiero hablar con una persona')).toBe(true)
    expect(detectHumanRequest('necesito un agente humano ya')).toBe(true)
    expect(detectHumanRequest('¿cómo agrego una persona a mi cuenta?')).toBe(false)
    expect(frustrationScore('ESTO ES INACEPTABLE, NADIE RESPONDE!!!')).toBeGreaterThanOrEqual(0.9)
    expect(frustrationScore('Hola, una consulta')).toBe(0)
    expect(detectConfirmation('Sí, gracias!')).toBe('yes')
    expect(detectConfirmation('no me sirvió')).toBe('no')
    expect(detectConfirmation('¿y cómo hago para exportar a PDF?')).toBeNull()
  })

  it('escala por baja confianza y por intentos agotados', () => {
    const base = { sentiment: 'calm' as const, intent: 'question', category: 'how_to' as const, requiresIntervention: false, requesterType: 'USER' as const, text: 'x' }
    expect(decideEscalation({ ...base, confidence: 0.9, aiAttempts: 0 }).escalate).toBe(false)
    expect(decideEscalation({ ...base, confidence: 0.4, aiAttempts: 0 }).reasons).toContain('LOW_CONFIDENCE')
    expect(decideEscalation({ ...base, confidence: 0.9, aiAttempts: 3 }).reasons).toContain('MAX_AI_ATTEMPTS')
    expect(decideEscalation({ ...base, confidence: 0.9, aiAttempts: 0, category: 'billing' }).reasons).toContain('REQUIRES_INTERVENTION')
  })
})

describe('flujo omnicanal', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => {
    ctx = setup()
  })

  it('Nivel 1: Kilo IA resuelve en la web y el cliente confirma → RESOLVED_BY_AI', async () => {
    const r = await ctx.svc.handleInbound({ channel: 'WEB', source: 'in_app_widget', requester: USER, text: '¿Cómo exporto el reporte de recorridos?', forceNew: true })
    expect(r.created).toBe(true)
    expect(r.ticket!.code).toMatch(/^KIL-2026-\d{4}$/)
    expect(r.ticket!).toMatchObject({ status: 'WAITING_CUSTOMER', userId: 'u-1', tenantId: 't-1', requesterType: 'USER', aiAttempts: 1 })
    const view = await ctx.svc.getForUser('u-1', 't-1', r.ticket!.id)
    expect(view.ticket.statusLabel).toBe('Esperando tu respuesta')
    expect(view.ticket.awaitingConfirmation).toBe(true)
    expect(view.messages.at(-1)).toMatchObject({ authorType: 'AI', askConfirmation: true })

    const done = await ctx.svc.handleInbound({ channel: 'WEB', source: 'in_app_widget', requester: USER, text: 'x', buttonId: 'KILO_RESOLVED', ticketId: r.ticket!.id })
    expect(done.ticket!.status).toBe('RESOLVED_BY_AI')
    expect(done.ticket!.resolvedAt).not.toBeNull()
    expect(ctx.wa.sent).toHaveLength(0) // conversación web: nada sale por WhatsApp
  })

  it('Nivel 2: lead de la landing pide cotización → escalado con resumen y aviso al equipo por WhatsApp', async () => {
    const r = await ctx.svc.handleInbound({
      channel: 'WHATSAPP',
      source: 'landing',
      requester: LEAD,
      text: 'Hola, quiero una cotización para 25 camiones (ref:LANDING)',
      externalId: 'wamid.1',
    })
    const t = r.ticket!
    expect(r.outcome).toBe('escalated')
    expect(t).toMatchObject({ status: 'ESCALATED_TO_HUMAN', handledBy: 'HUMAN', requesterType: 'LEAD', leadPhone: LEAD.phone, userId: null, originSource: 'landing' })
    expect(t.escalationReasons).toContain('COMMERCIAL_LEAD')
    expect(t.aiSummary?.headline).toBeTruthy()

    const team = ctx.wa.sent.find((s) => s.to === TEAM)!
    expect(team.body).toContain(t.code)
    expect(team.body).toContain('Lead')
    expect(team.body).toContain(`https://admin.kilora.test/admin/soporte/${t.code}`)
    const toLead = ctx.wa.sent.find((s) => s.to === LEAD.phone)!
    expect(toLead.body).toContain(t.code)

    const alerts = await ctx.repo.consoleAlertsSince(0)
    expect(alerts.map((a) => a.kind)).toEqual(['new_lead', 'escalation'])
    // la marca de origen no queda en el hilo
    const msgs = await ctx.repo.listMessages(t.id)
    expect(msgs[0].body).not.toContain('ref:LANDING')
  })

  it('handoff → agente responde por WhatsApp → el cliente contesta y vuelve a la bandeja del agente', async () => {
    const r = await ctx.svc.handleInbound({ channel: 'WHATSAPP', source: 'whatsapp', requester: USER, text: 'Necesito hablar con una persona', externalId: 'wamid.2' })
    expect(r.ticket!.status).toBe('ESCALATED_TO_HUMAN')
    const internal = (await ctx.repo.listMessages(r.ticket!.id, { includeInternal: true })).filter((m) => m.visibility === 'INTERNAL')
    expect(internal[0].body).toContain('Resumen para el agente')

    const { ticket, message } = await ctx.svc.agentReply(r.ticket!.id, AGENT, { body: 'Hola Camila, ya reviso tu cuenta.' })
    expect(ticket).toMatchObject({ status: 'WAITING_CUSTOMER', assigneeId: 'a-1' })
    expect(message.deliveryStatus).toBe('SENT')
    expect(ctx.wa.sent.at(-1)).toMatchObject({ to: USER.phone, kind: 'text' })
    expect(ctx.wa.sent.at(-1)!.body).toContain('Paula')

    const back = await ctx.svc.handleInbound({ channel: 'WHATSAPP', source: 'whatsapp', requester: USER, text: 'Gracias, quedo atenta', externalId: 'wamid.3' })
    expect(back.outcome).toBe('routed_to_agent')
    expect(back.ticket!.status).toBe('IN_REVIEW')
    expect((await ctx.repo.consoleAlertsSince(0)).at(-1)!.kind).toBe('customer_reply')
  })

  it('el caso abierto en la web continúa por WhatsApp en el mismo hilo', async () => {
    const r = await ctx.svc.handleInbound({ channel: 'WEB', source: 'in_app_widget', requester: USER, text: '¿Cómo agrego usuarios a mi cuenta?', forceNew: true })
    const wa = await ctx.svc.handleInbound({ channel: 'WHATSAPP', source: 'whatsapp', requester: USER, text: 'Sigo por acá, no encuentro el botón invitar', externalId: 'wamid.4' })
    expect(wa.created).toBe(false)
    expect(wa.ticket!.id).toBe(r.ticket!.id)
    expect(wa.ticket!.activeChannel).toBe('WHATSAPP')
    const channels = (await ctx.repo.listMessages(r.ticket!.id)).filter((m) => m.authorType === 'CUSTOMER').map((m) => m.channel)
    expect(channels).toEqual(['WEB', 'WHATSAPP'])
  })

  it('es idempotente ante reintentos del webhook', async () => {
    const input = { channel: 'WHATSAPP' as const, source: 'whatsapp' as const, requester: LEAD, text: '¿Qué es Kilora?', externalId: 'wamid.dup' }
    await ctx.svc.handleInbound(input)
    const again = await ctx.svc.handleInbound(input)
    expect(again.duplicate).toBe(true)
    expect(ctx.repo.messages.filter((m) => m.externalId === 'wamid.dup')).toHaveLength(1)
  })

  it('sin certeza, Kilo IA no inventa: escala por baja confianza', async () => {
    const r = await ctx.svc.handleInbound({ channel: 'WEB', source: 'in_app_widget', requester: USER, text: 'Mi integración SAP devuelve un código raro 9981', forceNew: true })
    expect(r.ticket!.status).toBe('ESCALATED_TO_HUMAN')
    expect(r.ticket!.escalationReasons).toContain('LOW_CONFIDENCE')
  })

  it('fuera de la ventana de 24 h la respuesta del agente sale como plantilla', async () => {
    let now = new Date('2026-03-10T12:00:00Z')
    const c = setup(() => now)
    const r = await c.svc.handleInbound({ channel: 'WHATSAPP', source: 'whatsapp', requester: LEAD, text: 'quiero hablar con un humano', externalId: 'wamid.5' })
    now = new Date('2026-03-12T12:00:00Z')
    const { message } = await c.svc.agentReply(r.ticket!.id, AGENT, { body: 'Disculpa la demora, te escribo por la demo.' })
    expect(message.deliveryStatus).toBe('SENT')
    expect(c.wa.sent.at(-1)).toMatchObject({ kind: 'template', template: 'kilora_case_reply' })
    expect(c.wa.sent.at(-1)!.params![0]).toBe(r.ticket!.code)
  })

  it('las notas internas nunca llegan al cliente', async () => {
    const r = await ctx.svc.handleInbound({ channel: 'WEB', source: 'in_app_widget', requester: USER, text: 'Quiero hablar con una persona', forceNew: true })
    await ctx.svc.agentReply(r.ticket!.id, AGENT, { body: 'Cliente VIP, revisar contrato', internal: true })
    const view = await ctx.svc.getForUser('u-1', 't-1', r.ticket!.id)
    expect(view.messages.some((m) => m.body.includes('VIP'))).toBe(false)
    expect(view.messages.some((m) => m.body.includes('Resumen para el agente'))).toBe(false)
  })
})

describe('WhatsApp', () => {
  it('parsea texto, botones, medios y estados', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ wa_id: '56987654321', profile: { name: 'Jorge' } }],
                messages: [
                  { id: 'wamid.a', from: '56987654321', timestamp: '1760000000', type: 'text', text: { body: 'Hola (ref:LANDING)' } },
                  { id: 'wamid.b', from: '56987654321', timestamp: '1760000001', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'KILO_HUMAN', title: 'Hablar con persona' } } },
                  { id: 'wamid.c', from: '56987654321', timestamp: '1760000002', type: 'image', image: { id: 'media-1', mime_type: 'image/jpeg', caption: 'foto del equipo' } },
                ],
                statuses: [{ id: 'wamid.out', status: 'read' }],
              },
            },
          ],
        },
      ],
    }
    const { messages, statuses } = parseWebhook(payload)
    expect(messages[0]).toMatchObject({ from: '+56987654321', profileName: 'Jorge', fromLanding: true })
    expect(messages[1]).toMatchObject({ buttonId: 'KILO_HUMAN' })
    expect(messages[2]).toMatchObject({ text: 'foto del equipo', media: { id: 'media-1', mimeType: 'image/jpeg' } })
    expect(statuses).toEqual([{ waMessageId: 'wamid.out', status: 'READ', error: null }])
  })

  it('valida la firma X-Hub-Signature-256', () => {
    const body = '{"a":1}'
    const sig = `sha256=${createHmac('sha256', 's3cret').update(body).digest('hex')}`
    expect(verifySignature(body, sig, 's3cret')).toBe(true)
    expect(verifySignature(body, sig, 'otro')).toBe(false)
    expect(verifySignature(body, null, 's3cret')).toBe(false)
  })

  it('el enlace de la landing lleva la marca de origen y se limpia al entrar', () => {
    const link = buildWhatsAppLink({ phone: '+56 9 2222 3333', campaign: 'home-hero' })
    expect(link.startsWith('https://wa.me/56922223333?text=')).toBe(true)
    const text = decodeURIComponent(link.split('text=')[1])
    expect(text).toContain('ref:LANDING/home-hero')
    expect(cleanInbound(text)).not.toContain('ref:')
    expect(normalizePhone('56 9 2222-3333')).toBe('+56922223333')
  })
})

describe('autenticación y HTTP', () => {
  it('firma y verifica JWT HS256', () => {
    const tok = signJwt({ sub: 'u-1', tenant_id: 't-1', role: 'customer' }, 'k')
    expect(verifyJwt(tok, 'k')?.sub).toBe('u-1')
    expect(verifyJwt(tok, 'otra')).toBeNull()
    expect(verifyJwt(signJwt({ sub: 'x' }, 'k', -10), 'k')).toBeNull()
  })

  function hd(): Helpdesk {
    const c = setup()
    return {
      repo: c.repo,
      service: c.svc,
      notifier: new Notifier(c.repo, c.wa, { consoleBaseUrl: 'x', teamPhones: [] }),
      wa: c.wa,
      auth: { secret: 'k', devAuth: false },
      webhook: { appSecret: 'app', verifyToken: 'verify' },
      mode: { db: 'memory', ai: 'heuristic', whatsapp: 'recording' },
      ready: Promise.resolve(),
    }
  }
  const req = (path: string, init: RequestInit & { token?: string } = {}) =>
    new Request(`http://x/api/helpdesk/${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.headers as Record<string, string>) } })

  it('exige sesión y separa clientes de agentes', async () => {
    const h = hd()
    expect((await handle(req('me/tickets'), h)).status).toBe(401)
    const customer = signJwt({ sub: 'u-1', tenant_id: 't-1', role: 'customer' }, 'k')
    expect((await handle(req('admin/tickets', { token: customer }), h)).status).toBe(403)
    const created = await handle(req('me/tickets', { method: 'POST', token: customer, body: JSON.stringify({ message: '¿Cómo restablezco mi contraseña?' }) }), h)
    expect(created.status).toBe(201)
    const { ticket } = (await created.json()) as { ticket: { id: string; code: string } }
    // Otro cliente no puede ver el caso
    const other = signJwt({ sub: 'u-2', tenant_id: 't-1', role: 'customer' }, 'k')
    expect((await handle(req(`me/tickets/${ticket.id}`, { token: other }), h)).status).toBe(404)
    // El agente sí, por código
    const agent = signJwt({ sub: 'a-1', name: 'Paula', role: 'agent' }, 'k')
    const detail = await handle(req(`admin/tickets/${ticket.code}`, { token: agent }), h)
    expect(detail.status).toBe(200)
  })

  it('verifica el webhook de WhatsApp (suscripción y firma)', async () => {
    const h = hd()
    const ok = await handle(req('webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=123'), h)
    expect(await ok.text()).toBe('123')
    const bad = await handle(req('webhooks/whatsapp', { method: 'POST', body: '{}', headers: { 'x-hub-signature-256': 'sha256=00' } }), h)
    expect(bad.status).toBe(401)
  })
})

describe('regresiones', () => {
  it('un saludo con pregunta no se trata como saludo: la IA pide confirmación', async () => {
    const { svc } = setup()
    const r = await svc.handleInbound({ channel: 'WHATSAPP', source: 'landing', requester: LEAD, text: 'Hola, ¿qué es Kilora?', externalId: 'wamid.g1' })
    expect(r.ticket!.status).toBe('WAITING_CUSTOMER')
    const ok = await svc.handleInbound({ channel: 'WHATSAPP', source: 'whatsapp', requester: LEAD, text: 'Sí, resuelto', buttonId: 'KILO_RESOLVED', externalId: 'wamid.g2' })
    expect(ok.ticket!.status).toBe('RESOLVED_BY_AI')
  })
  it('un saludo solo no consume intentos ni escala', async () => {
    const { svc } = setup()
    const r = await svc.handleInbound({ channel: 'WEB', source: 'in_app_widget', requester: USER, text: 'Hola!', forceNew: true })
    expect(r.ticket!).toMatchObject({ status: 'OPEN', aiAttempts: 0 })
  })
})
