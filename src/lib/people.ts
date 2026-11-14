// Cómo se nombra a cada persona seguida en el video. El seguimiento solo da un
// número propio; el nombre y el dorsal los pone quien usa la app.

export interface Labeled {
  id: number
  name?: string
  number?: string
}

export const MAX_NAME = 30
export const MAX_NUMBER = 3

const tidy = (s: string | undefined, max: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** Deja el nombre y el dorsal listos para guardar: sin espacios de más y el dorsal solo con cifras. */
export function cleanLabel(name: string, number: string): { name?: string; number?: string } {
  const n = tidy(name, MAX_NAME)
  const d = number.replace(/\D/g, '').slice(0, MAX_NUMBER)
  return { name: n || undefined, number: d || undefined }
}

export const isLabeled = (p: Labeled) => !!(tidy(p.name, MAX_NAME) || p.number)

/** «#10 L. Vidal», «L. Vidal», «Dorsal 10» o, sin etiqueta, «Persona #3». */
export function personLabel(p: Labeled): string {
  const name = tidy(p.name, MAX_NAME)
  if (name && p.number) return `#${p.number} ${name}`
  if (name) return name
  if (p.number) return `Dorsal ${p.number}`
  return `Persona #${p.id}`
}

/** Etiqueta corta para dibujar sobre el video. */
export function personTag(p: Labeled): string {
  const name = tidy(p.name, MAX_NAME)
  if (p.number && name) return `${p.number} ${name}`
  return name || (p.number ? `Dorsal ${p.number}` : `#${p.id}`)
}
