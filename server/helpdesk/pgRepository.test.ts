// Integración contra PostgreSQL real. Se ejecuta sólo con HELPDESK_TEST_DATABASE_URL apuntando a una
// base con db/migrations/001_helpdesk.sql y db/seeds/001_kb.sql aplicadas (se trunca al empezar).
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { StaticAccountProvider } from './accounts'
import { HeuristicKiloAI } from './kiloAI'
import { Notifier } from './notifications'
import { PgRepository } from './pgRepository'
import { HelpdeskService } from './service'
import { RecordingWhatsApp } from './whatsapp'

const url = process.env.HELPDESK_TEST_DATABASE_URL
const USER_ID = '00000000-0000-4000-8000-000000000001'
const TENANT_ID = '00000000-0000-4000-8000-0000000000a1'

describe.skipIf(!url)('PgRepository (PostgreSQL)', () => {
  let pool: pg.Pool
  let repo: PgRepository
  let svc: HelpdeskService
  let wa: RecordingWhatsApp

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url })
    await pool.query(`TRUNCATE support_tickets, support_notifications, support_user_directory, support_ticket_counters RESTART IDENTITY CASCADE`)
    await pool.query(`INSERT INTO support_user_directory (phone_e164, user_id, tenant_id, full_name, email) VALUES ('+56911112222', $1, $2, 'Camila', 'c@x.cl')`, [USER_ID, TENANT_ID])
    repo = new PgRepository(pool)
    wa = new RecordingWhatsApp()
    const notifier = new Notifier(repo, wa, { consoleBaseUrl: 'https://admin.test', teamPhones: ['+56900000001'] }, () => {})
    svc = new HelpdeskService(repo, new HeuristicKiloAI(), wa, notifier, new StaticAccountProvider())
  })
  afterAll(async () => pool?.end())

  it('flujo completo: IA, handoff, consola, agente y bandeja', async () => {
    const user = { type: 'USER' as const, userId: USER_ID, tenantId: TENANT_ID, name: 'Camila', phone: '+56911112222', email: 'c@x.cl' }
    const a = await svc.handleInbound({ channel: 'WEB', source: 'in_app_widget', requester: user, text: '¿Cómo exporto el reporte de recorridos?', forceNew: true })
    expect(a.ticket!.code).toMatch(/^KIL-\d{4}-0001$/)
    expect(a.ticket!.status).toBe('WAITING_CUSTOMER')

    // continúa por WhatsApp en el mismo hilo y pide una persona
    const b = await svc.handleInbound({ channel: 'WHATSAPP', source: 'whatsapp', requester: user, text: 'quiero hablar con una persona', externalId: 'wamid.pg.1' })
    expect(b.ticket!.id).toBe(a.ticket!.id)
    expect(b.ticket!).toMatchObject({ status: 'ESCALATED_TO_HUMAN', handledBy: 'HUMAN', contactPhone: '+56911112222' })
    expect(b.ticket!.aiSummary?.headline).toBeTruthy()

    // idempotencia por wamid (índice único)
    const dup = await svc.handleInbound({ channel: 'WHATSAPP', source: 'whatsapp', requester: user, text: 'quiero hablar con una persona', externalId: 'wamid.pg.1' })
    expect(dup.duplicate).toBe(true)

    // lead en paralelo
    const lead = await svc.handleInbound({ channel: 'WHATSAPP', source: 'landing', requester: { type: 'LEAD', phone: '+56987654321', name: 'Jorge' }, text: 'Quiero cotizar 20 camiones', externalId: 'wamid.pg.2' })
    expect(lead.ticket!.code).toMatch(/-0002$/)
    expect(lead.ticket!.requesterType).toBe('LEAD')

    const alerts = await repo.consoleAlertsSince(0)
    expect(alerts.filter((x) => x.kind === 'escalation').length).toBe(2)
    expect((await pool.query(`SELECT count(*)::int n FROM support_notifications WHERE channel = 'whatsapp_team' AND status = 'SENT'`)).rows[0].n).toBe(2)

    const r = await svc.agentReply(a.ticket!.id, { id: '00000000-0000-4000-8000-0000000000f1', name: 'Paula' }, { body: 'Hola, te ayudo.' })
    expect(r.message.deliveryStatus).toBe('SENT')
    expect(r.ticket.status).toBe('WAITING_CUSTOMER')
    await repo.updateDelivery(r.message.externalId!, 'READ')
    await repo.updateDelivery(r.message.externalId!, 'DELIVERED') // llega tarde: no retrocede
    const msgs = await repo.listMessages(a.ticket!.id, { includeInternal: true })
    expect(msgs.find((m) => m.id === r.message.id)!.deliveryStatus).toBe('READ')
    expect(msgs.map((m) => m.channel)).toContain('WHATSAPP')

    const inbox = await svc.inbox({ requesterType: 'LEAD', status: ['ESCALATED_TO_HUMAN'], q: 'cotizar' })
    expect(inbox.items.map((t) => t.code)).toEqual([lead.ticket!.code])
    expect(inbox.counts.escalated).toBe(1)

    const kb = await repo.searchKnowledge('no puedo exportar el reporte de recorridos', 'customer')
    expect(kb[0]?.slug).toBe('exportar-reporte-recorridos')

    const view = await svc.listForUser(USER_ID, TENANT_ID)
    expect(view[0].statusLabel).toBe('Esperando tu respuesta')
  })

  it('la base rechaza tickets USER sin tenant y LEAD sin teléfono', async () => {
    await expect(pool.query(`INSERT INTO support_tickets (requester_type, user_id, origin_channel, active_channel) VALUES ('USER', $1, 'WEB', 'WEB')`, [USER_ID])).rejects.toThrow(/requester_ck/)
    await expect(pool.query(`INSERT INTO support_tickets (requester_type, origin_channel, active_channel) VALUES ('LEAD', 'WHATSAPP', 'WHATSAPP')`)).rejects.toThrow(/requester_ck/)
  })
})
