// WhatsApp Business Cloud API (Meta): verificación del webhook, firma, parseo de entrada y envío.
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { DeliveryStatus } from './types'

export const LANDING_REF = 'ref:LANDING'

/** Normaliza a E.164 (+56912345678). WhatsApp entrega «56912345678» sin «+». */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, '')
  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return null
  return `+${digits}`
}

// ------------------------------------------------------------------ verificación

export function verifySubscription(url: URL, verifyToken: string | undefined): string | null {
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')
  if (mode === 'subscribe' && verifyToken && token === verifyToken && challenge) return challenge
  return null
}

/** Valida X-Hub-Signature-256 = sha256=HMAC(app_secret, raw_body). */
export function verifySignature(rawBody: string | Uint8Array, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false
  const expected = createHmac('sha256', appSecret).update(rawBody).digest()
  const got = Buffer.from(header.slice(7), 'hex')
  return got.length === expected.length && timingSafeEqual(got, expected)
}

// ------------------------------------------------------------------ parseo

export interface InboundWhatsApp {
  waMessageId: string
  from: string // E.164
  profileName: string | null
  timestamp: string
  type: string
  text: string
  buttonId: string | null
  media: { id: string; mimeType: string; fileName: string | null } | null
  fromLanding: boolean
}

export interface WhatsAppStatus {
  waMessageId: string
  status: DeliveryStatus
  error: string | null
}

interface WaPayload {
  object?: string
  entry?: {
    changes?: {
      field?: string
      value?: {
        contacts?: { wa_id: string; profile?: { name?: string } }[]
        messages?: WaMessage[]
        statuses?: { id: string; status: string; errors?: { title?: string; code?: number }[] }[]
      }
    }[]
  }[]
}

interface WaMedia {
  id: string
  mime_type: string
  filename?: string
  caption?: string
}

interface WaMessage {
  id: string
  from: string
  timestamp: string
  type: string
  text?: { body: string }
  button?: { payload?: string; text?: string }
  interactive?: { type: string; button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } }
  image?: WaMedia
  document?: WaMedia
  audio?: WaMedia
  video?: WaMedia
  sticker?: WaMedia
  location?: { latitude: number; longitude: number; name?: string }
}

const STATUS_MAP: Record<string, DeliveryStatus> = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' }

export function parseWebhook(body: unknown): { messages: InboundWhatsApp[]; statuses: WhatsAppStatus[] } {
  const p = body as WaPayload
  const messages: InboundWhatsApp[] = []
  const statuses: WhatsAppStatus[] = []
  if (p?.object !== 'whatsapp_business_account') return { messages, statuses }

  for (const entry of p.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value
      if (!v) continue
      const names = new Map((v.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? null]))
      for (const m of v.messages ?? []) {
        const from = normalizePhone(m.from)
        if (!from) continue
        const media = m.image ?? m.document ?? m.audio ?? m.video ?? m.sticker ?? null
        const buttonId = m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id ?? m.button?.payload ?? null
        const text =
          m.text?.body ??
          m.interactive?.button_reply?.title ??
          m.interactive?.list_reply?.title ??
          m.button?.text ??
          media?.caption ??
          (m.location ? `📍 Ubicación: ${m.location.latitude},${m.location.longitude}${m.location.name ? ` (${m.location.name})` : ''}` : '')
        messages.push({
          waMessageId: m.id,
          from,
          profileName: names.get(m.from) ?? null,
          timestamp: new Date(Number(m.timestamp) * 1000).toISOString(),
          type: m.type,
          text: text.trim(),
          buttonId,
          media: media ? { id: media.id, mimeType: media.mime_type, fileName: media.filename ?? null } : null,
          fromLanding: text.includes(LANDING_REF),
        })
      }
      for (const s of v.statuses ?? []) {
        const status = STATUS_MAP[s.status]
        if (status) statuses.push({ waMessageId: s.id, status, error: s.errors?.[0]?.title ?? null })
      }
    }
  }
  return { messages, statuses }
}

// ------------------------------------------------------------------ envío

export interface WaButton {
  id: string
  title: string // máx. 20 caracteres
}

export interface WhatsAppSender {
  sendText(to: string, body: string): Promise<string>
  sendButtons(to: string, body: string, buttons: WaButton[]): Promise<string>
  sendTemplate(to: string, name: string, language: string, params: string[]): Promise<string>
  downloadMedia(mediaId: string): Promise<{ bytes: Uint8Array; mimeType: string }>
}

export class WhatsAppError extends Error {
  constructor(
    message: string,
    public code: number | null,
  ) {
    super(message)
  }
  /** 131047: fuera de la ventana de 24 h → hay que usar plantilla. */
  get outsideWindow() {
    return this.code === 131047
  }
}

export class CloudWhatsApp implements WhatsAppSender {
  private base: string
  constructor(
    private token: string,
    phoneNumberId: string,
    version = 'v21.0',
  ) {
    this.base = `https://graph.facebook.com/${version}/${phoneNumberId}`
    this.graph = `https://graph.facebook.com/${version}`
  }
  private graph: string

  private async post(payload: Record<string, unknown>): Promise<string> {
    const res = await fetch(`${this.base}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...payload }),
      signal: AbortSignal.timeout(15_000),
    })
    const data = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } }
    if (!res.ok || !data.messages?.[0]?.id) {
      throw new WhatsAppError(data.error?.message ?? `WhatsApp HTTP ${res.status}`, data.error?.code ?? null)
    }
    return data.messages[0].id
  }

  sendText(to: string, body: string) {
    return this.post({ to: to.replace('+', ''), type: 'text', text: { body: body.slice(0, 4096), preview_url: true } })
  }

  sendButtons(to: string, body: string, buttons: WaButton[]) {
    return this.post({
      to: to.replace('+', ''),
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: body.slice(0, 1024) },
        action: { buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title.slice(0, 20) } })) },
      },
    })
  }

  sendTemplate(to: string, name: string, language: string, params: string[]) {
    return this.post({
      to: to.replace('+', ''),
      type: 'template',
      template: {
        name,
        language: { code: language },
        components: params.length ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text: text.slice(0, 1000) })) }] : [],
      },
    })
  }

  async downloadMedia(mediaId: string) {
    const meta = await fetch(`${this.graph}/${mediaId}`, { headers: { Authorization: `Bearer ${this.token}` } })
    if (!meta.ok) throw new WhatsAppError(`No se pudo leer el medio ${mediaId}`, null)
    const { url, mime_type } = (await meta.json()) as { url: string; mime_type: string }
    const file = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } })
    if (!file.ok) throw new WhatsAppError(`No se pudo descargar el medio ${mediaId}`, null)
    return { bytes: new Uint8Array(await file.arrayBuffer()), mimeType: mime_type }
  }
}

/** Emisor de desarrollo/pruebas: registra lo enviado sin salir a la red. */
export class RecordingWhatsApp implements WhatsAppSender {
  sent: { to: string; kind: 'text' | 'buttons' | 'template'; body: string; buttons?: WaButton[]; template?: string; params?: string[]; id: string }[] = []
  /** Teléfonos con ventana de 24 h cerrada (simula el error 131047). */
  closedWindow = new Set<string>()
  private n = 0
  private id = () => `wamid.dev.${++this.n}`

  async sendText(to: string, body: string) {
    if (this.closedWindow.has(to)) throw new WhatsAppError('Re-engagement message', 131047)
    const id = this.id()
    this.sent.push({ to, kind: 'text', body, id })
    return id
  }
  async sendButtons(to: string, body: string, buttons: WaButton[]) {
    if (this.closedWindow.has(to)) throw new WhatsAppError('Re-engagement message', 131047)
    const id = this.id()
    this.sent.push({ to, kind: 'buttons', body, buttons, id })
    return id
  }
  async sendTemplate(to: string, name: string, _language: string, params: string[]) {
    const id = this.id()
    this.sent.push({ to, kind: 'template', body: params.join(' | '), template: name, params, id })
    return id
  }
  async downloadMedia() {
    return { bytes: new Uint8Array(), mimeType: 'application/octet-stream' }
  }
}
