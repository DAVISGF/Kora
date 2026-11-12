// Función de Vercel: todas las rutas /api/helpdesk/* del Sistema de Soporte Omnicanal de Kilora.
// La lógica vive en server/helpdesk/; aquí sólo se conecta al runtime.
import { getHelpdesk } from '../../server/helpdesk/container'
import { handle } from '../../server/helpdesk/http'

const run = (request: Request) => handle(request, getHelpdesk())

export const GET = run
export const POST = run
export const PATCH = run

// El webhook de WhatsApp y el stream SSE pueden tardar más que una petición normal.
export const maxDuration = 60
