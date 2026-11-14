// Enlace wa.me con mensaje preconfigurado para la landing comercial. Módulo puro (cliente y servidor).
// La marca «ref:LANDING» permite al webhook etiquetar el caso con origen «landing».

export interface WhatsAppLinkOptions {
  /** Número oficial de Kilora en E.164 o solo dígitos. */
  phone: string
  /** Texto inicial; se le agrega la marca de origen. */
  message?: string
  /** Página o campaña de origen (utm), se incluye en la marca. */
  campaign?: string
}

export function buildWhatsAppLink({ phone, message, campaign }: WhatsAppLinkOptions): string {
  const digits = phone.replace(/[^\d]/g, '')
  const base = message?.trim() || 'Hola Kilora 👋 Quiero más información sobre la plataforma.'
  const ref = campaign ? `ref:LANDING/${campaign.replace(/[^\w-]/g, '').slice(0, 30)}` : 'ref:LANDING'
  return `https://wa.me/${digits}?text=${encodeURIComponent(`${base}\n\n(${ref})`)}`
}
