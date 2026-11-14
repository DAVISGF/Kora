// Botón de soporte para la landing comercial: abre WhatsApp con un mensaje preconfigurado.
// El visitante no necesita cuenta; el webhook lo registra como Lead por su número.
//
//   <WhatsAppSupportButton phone={import.meta.env.VITE_KILORA_WHATSAPP} campaign="home-hero" />
import { MessageCircle } from 'lucide-react'
import { buildWhatsAppLink } from '../../server/helpdesk/whatsappLink'
import { cx } from '../lib/util'

export default function WhatsAppSupportButton({
  phone,
  message,
  campaign,
  floating = true,
  label = 'Habla con nosotros',
}: {
  phone: string
  message?: string
  campaign?: string
  floating?: boolean
  label?: string
}) {
  return (
    <a
      href={buildWhatsAppLink({ phone, message, campaign })}
      target="_blank"
      rel="noopener noreferrer"
      className={cx(
        'inline-flex h-12 items-center gap-2 rounded-full bg-[#25D366] px-5 font-semibold text-[#06260f] no-underline shadow-lg shadow-black/30',
        floating && 'fixed right-4 bottom-4 z-40',
      )}
    >
      <MessageCircle size={20} aria-hidden="true" />
      {label}
    </a>
  )
}
