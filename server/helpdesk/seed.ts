// Datos de demostración para desarrollo local con MemoryRepository.
// Los artículos son los mismos de db/seeds/001_kb.sql.
import { StaticAccountProvider } from './accounts'
import { DEV_CUSTOMER } from './auth'
import type { MemoryRepository } from './memoryRepository'
import type { HelpdeskService } from './service'

export const KB_ARTICLES = [
  {
    slug: 'exportar-reporte-recorridos',
    title: 'Cómo exportar el reporte de recorridos',
    body: 'Ve a Reportes > Recorridos, elige el rango de fechas y los vehículos, y pulsa Exportar. Puedes descargarlo en Excel o PDF. Los reportes de más de 90 días se envían por correo cuando están listos. Para programar un envío automático usa el botón Programar.',
    audience: 'customer' as const,
  },
  {
    slug: 'gps-sin-senal',
    title: 'Un vehículo aparece sin señal GPS',
    body: 'Si un vehículo aparece como Sin señal, revisa primero que tenga contacto encendido y cobertura móvil. El dispositivo reporta cada 60 segundos en movimiento y cada 30 minutos detenido. Si lleva más de 24 horas sin reportar con el motor en uso, puede ser una falla de instalación o del equipo y requiere revisión técnica.',
    audience: 'customer' as const,
  },
  {
    slug: 'agregar-usuarios',
    title: 'Agregar usuarios y permisos a la cuenta',
    body: 'Los administradores pueden invitar usuarios en Configuración > Usuarios > Invitar. Cada usuario recibe un correo para crear su contraseña. Los roles disponibles son Administrador, Supervisor y Conductor. El rol Supervisor ve sólo las flotas asignadas.',
    audience: 'customer' as const,
  },
  {
    slug: 'restablecer-contrasena',
    title: 'Restablecer la contraseña',
    body: 'En la pantalla de ingreso pulsa ¿Olvidaste tu contraseña? e ingresa tu correo. Recibirás un enlace válido por 30 minutos. Si no llega, revisa la carpeta de spam. Kilora nunca te pedirá tu contraseña por WhatsApp ni por correo.',
    audience: 'all' as const,
  },
  {
    slug: 'que-es-kilora',
    title: 'Qué es Kilora y para quién es',
    body: 'Kilora es una plataforma de gestión de flotas: ubicación en tiempo real, rutas, consumo de combustible, mantenciones y conducta de conducción. La usan empresas de transporte, distribución y servicios con desde 5 vehículos. Los planes se cotizan según el tamaño de la flota; el equipo comercial agenda una demo sin costo.',
    audience: 'all' as const,
  },
]

export const DEMO_LEAD_PHONE = '+56987654321'
export const DEMO_CUSTOMER_PHONE = '+56911112222'

export const demoAccounts = new StaticAccountProvider({
  [DEV_CUSTOMER.tenantId]: {
    companyName: 'Transportes Andes SpA',
    plan: 'Pro',
    billingStatus: 'al_dia',
    fleetSize: 48,
    activeVehicles: 45,
    devicesOffline: 3,
    openInvoices: 0,
  },
})

export function seedReference(repo: MemoryRepository) {
  repo.kb = KB_ARTICLES.map((a) => ({ ...a }))
  repo.directory.set(DEMO_CUSTOMER_PHONE, {
    phone: DEMO_CUSTOMER_PHONE,
    userId: DEV_CUSTOMER.userId,
    tenantId: DEV_CUSTOMER.tenantId,
    name: DEV_CUSTOMER.name,
    email: DEV_CUSTOMER.email,
  })
}

/** Algunos casos para que la consola y el panel no partan vacíos. */
export async function seedDemoTickets(svc: HelpdeskService) {
  const customer = { type: 'USER' as const, userId: DEV_CUSTOMER.userId, tenantId: DEV_CUSTOMER.tenantId, name: DEV_CUSTOMER.name, phone: DEMO_CUSTOMER_PHONE, email: DEV_CUSTOMER.email }

  // 1) Cliente web: Kilo IA responde y el cliente confirma → RESOLVED_BY_AI
  const a = await svc.handleInbound({ channel: 'WEB', source: 'in_app_widget', requester: customer, text: '¿Cómo exporto el reporte de recorridos del mes pasado?', forceNew: true })
  await svc.handleInbound({ channel: 'WEB', source: 'in_app_widget', requester: customer, text: 'Sí, gracias', ticketId: a.ticket!.id })

  // 2) Lead desde la landing por WhatsApp pidiendo cotización → escalado al equipo comercial
  await svc.handleInbound({
    channel: 'WHATSAPP',
    source: 'landing',
    requester: { type: 'LEAD', phone: DEMO_LEAD_PHONE, name: 'Jorge Muñoz' },
    text: 'Hola Kilora 👋 Quiero una cotización para 25 camiones y agendar una demo (ref:LANDING)',
    externalId: 'wamid.seed.lead.1',
  })

  // 3) Cliente por WhatsApp con un vehículo sin señal y frustrado → escalado con prioridad alta
  await svc.handleInbound({
    channel: 'WHATSAPP',
    source: 'whatsapp',
    requester: customer,
    text: 'El camión patente KLRS-21 lleva 3 días sin señal GPS y nadie me responde, esto es inaceptable!!!',
    externalId: 'wamid.seed.cust.1',
  })
}
