// Notificaciones salientes al equipo de soporte: alerta en la consola (tiempo real vía SSE)
// y WhatsApp a los agentes de guardia. Patrón outbox: se encola primero y se despacha después,
// así un fallo de Meta no pierde la alerta y el cron puede reintentarla.
import { PRIORITY_LABEL } from './status'
import { REASON_LABEL } from './escalation'
import type { HelpdeskRepository } from './repository'
import type { ConsoleAlert, EscalationReason, ExecutiveSummary, Ticket } from './types'
import type { WhatsAppSender } from './whatsapp'

export interface NotifierConfig {
  /** URL pública de la consola, p. ej. https://admin.kilora.cl */
  consoleBaseUrl: string
  /** Teléfonos E.164 del equipo de soporte. */
  teamPhones: string[]
  /** Plantilla aprobada por Meta para alertas (mensaje iniciado por la empresa). Sin ella se envía texto. */
  teamTemplate?: { name: string; language: string }
}

export const ticketLink = (base: string, code: string) => `${base.replace(/\/$/, '')}/admin/soporte/${code}`

export function requesterLabel(t: Ticket): string {
  return t.requesterType === 'USER'
    ? `Cliente${t.contactEmail ? ` · ${t.contactEmail}` : ''}`
    : `Lead · ${t.leadName ? `${t.leadName} ` : ''}${t.leadPhone}`
}

export function escalationText(t: Ticket, s: ExecutiveSummary, reasons: EscalationReason[], link: string): string {
  return [
    `🚨 *Caso escalado ${t.code}*`,
    `👤 ${requesterLabel(t)}`,
    `⚡ Prioridad: ${PRIORITY_LABEL[t.priority]} · Canal: ${t.activeChannel === 'WHATSAPP' ? 'WhatsApp' : 'Web'}`,
    `❓ Motivo: ${reasons.map((r) => REASON_LABEL[r]).join(', ')}`,
    `📝 ${s.headline}`,
    s.problem && `${s.problem}`,
    `➡️ ${s.suggested_next_step}`,
    `🔗 ${link}`,
  ]
    .filter(Boolean)
    .join('\n')
}

export class Notifier {
  constructor(
    private repo: HelpdeskRepository,
    private wa: WhatsAppSender | null,
    private cfg: NotifierConfig,
    private log: (msg: string, err?: unknown) => void = (m, e) => console.error(m, e ?? ''),
  ) {}

  async escalation(t: Ticket, summary: ExecutiveSummary, reasons: EscalationReason[]) {
    const link = ticketLink(this.cfg.consoleBaseUrl, t.code)
    const payload: ConsoleAlert['payload'] = {
      code: t.code,
      summary: summary.headline,
      requesterType: t.requesterType,
      requesterLabel: requesterLabel(t),
      priority: t.priority,
      link,
      reasons,
    }
    await this.repo.enqueueNotification({ ticketId: t.id, kind: 'escalation', channel: 'console', recipient: null, payload })
    const ids: number[] = []
    for (const phone of this.cfg.teamPhones) {
      ids.push(await this.repo.enqueueNotification({ ticketId: t.id, kind: 'escalation', channel: 'whatsapp_team', recipient: phone, payload }))
    }
    // Despacho inmediato; lo que falle queda PENDING para el cron (/api/helpdesk/cron/notifications).
    if (ids.length) await this.dispatch(50, { text: escalationText(t, summary, reasons, link), ticket: t, summary })
  }

  /** Aviso en consola cuando el cliente responde un caso que lleva un humano. */
  async customerReplied(t: Ticket, preview: string) {
    await this.repo.enqueueNotification({
      ticketId: t.id,
      kind: 'customer_reply',
      channel: 'console',
      recipient: null,
      payload: {
        code: t.code,
        summary: preview.slice(0, 140),
        requesterType: t.requesterType,
        requesterLabel: requesterLabel(t),
        priority: t.priority,
        link: ticketLink(this.cfg.consoleBaseUrl, t.code),
      },
    })
  }

  /** Envía las notificaciones de WhatsApp pendientes (inmediato o desde el cron con reintentos). */
  async dispatch(limit = 50, ctx?: { text: string; ticket: Ticket; summary: ExecutiveSummary }) {
    const pending = await this.repo.pendingNotifications(limit || 50)
    let sent = 0
    for (const n of pending) {
      if (!this.wa || !n.recipient) {
        await this.repo.markNotification(n.id, 'FAILED', 'WhatsApp no configurado')
        continue
      }
      try {
        const p = n.payload
        if (this.cfg.teamTemplate) {
          // Plantilla sugerida (5 variables): {{1}} código · {{2}} solicitante · {{3}} prioridad · {{4}} resumen · {{5}} link
          await this.wa.sendTemplate(n.recipient, this.cfg.teamTemplate.name, this.cfg.teamTemplate.language, [
            p.code,
            p.requesterLabel,
            PRIORITY_LABEL[p.priority],
            p.summary,
            p.link,
          ])
        } else {
          const text =
            ctx && ctx.ticket.code === p.code
              ? ctx.text
              : `🚨 *Caso ${p.code}* (${PRIORITY_LABEL[p.priority]})\n👤 ${p.requesterLabel}\n📝 ${p.summary}\n🔗 ${p.link}`
          await this.wa.sendText(n.recipient, text)
        }
        await this.repo.markNotification(n.id, 'SENT')
        sent++
      } catch (e) {
        this.log(`[helpdesk] no se pudo notificar a ${n.recipient}`, e)
        await this.repo.markNotification(n.id, 'FAILED', e instanceof Error ? e.message : String(e))
      }
    }
    return { attempted: pending.length, sent }
  }
}
