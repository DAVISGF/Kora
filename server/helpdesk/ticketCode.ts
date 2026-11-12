// Identificador legible KIL-YYYY-XXXX. En Postgres lo genera next_ticket_code();
// estas utilidades sirven al repositorio en memoria, a validaciones y al parser de WhatsApp.

export const TICKET_CODE_RE = /^KIL-(\d{4})-(\d{4,})$/
const TICKET_CODE_IN_TEXT = /\bKIL-\d{4}-\d{4,}\b/i

export function formatTicketCode(year: number, seq: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new RangeError('Año inválido')
  if (!Number.isInteger(seq) || seq < 1) throw new RangeError('Correlativo inválido')
  return `KIL-${year}-${String(seq).padStart(4, '0')}`
}

export function parseTicketCode(code: string): { year: number; seq: number } | null {
  const m = TICKET_CODE_RE.exec(code.trim().toUpperCase())
  return m ? { year: Number(m[1]), seq: Number(m[2]) } : null
}

export const isTicketCode = (s: string) => parseTicketCode(s) !== null

/** Busca un código de caso mencionado en un mensaje libre («sobre el KIL-2026-0042…»). */
export function findTicketCode(text: string): string | null {
  const m = TICKET_CODE_IN_TEXT.exec(text)
  return m ? m[0].toUpperCase() : null
}

/** Año del código según la zona horaria de operación de Kilora. */
export function ticketYear(at: Date, timeZone = 'America/Santiago'): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(at))
}
