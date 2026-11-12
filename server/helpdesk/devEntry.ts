// Entrada para el servidor de desarrollo de Vite. Guarda la instancia en globalThis para que
// el estado en memoria sobreviva a las recargas de módulos (HMR).
import { createHelpdesk, type Helpdesk } from './container'
import { handle } from './http'

const g = globalThis as { __kiloraHelpdesk?: Helpdesk }

export function run(request: Request) {
  g.__kiloraHelpdesk ??= createHelpdesk()
  return handle(request, g.__kiloraHelpdesk)
}
