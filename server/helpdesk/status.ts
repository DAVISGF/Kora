// Máquina de estados del ticket y etiquetas visibles. Módulo puro: lo usan backend y frontend.
import type { Handler, TicketPriority, TicketStatus } from './types'

/** Estado tal como lo ve el cliente en «Mis Casos de Soporte». */
export type CustomerStatus = 'Abierto' | 'En Revisión' | 'Esperando tu respuesta' | 'Resuelto'

export const CUSTOMER_STATUS: Record<TicketStatus, CustomerStatus> = {
  OPEN: 'Abierto',
  WAITING_CUSTOMER: 'Esperando tu respuesta',
  ESCALATED_TO_HUMAN: 'En Revisión',
  IN_REVIEW: 'En Revisión',
  RESOLVED_BY_AI: 'Resuelto',
  RESOLVED: 'Resuelto',
  CLOSED: 'Resuelto',
}

/** Etiquetas internas de la consola. */
export const AGENT_STATUS: Record<TicketStatus, string> = {
  OPEN: 'Kilo IA atendiendo',
  WAITING_CUSTOMER: 'Esperando cliente',
  ESCALATED_TO_HUMAN: 'Escalado · sin tomar',
  IN_REVIEW: 'En revisión',
  RESOLVED_BY_AI: 'Resuelto por IA',
  RESOLVED: 'Resuelto',
  CLOSED: 'Cerrado',
}

export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  LOW: 'Baja',
  NORMAL: 'Normal',
  HIGH: 'Alta',
  URGENT: 'Urgente',
}

export const PRIORITY_RANK: Record<TicketPriority, number> = { LOW: 0, NORMAL: 1, HIGH: 2, URGENT: 3 }

export const TERMINAL: readonly TicketStatus[] = ['RESOLVED_BY_AI', 'RESOLVED', 'CLOSED']
export const isTerminal = (s: TicketStatus) => TERMINAL.includes(s)

/**
 * Transiciones permitidas. Cualquier estado no terminal puede escalar a humano;
 * un caso resuelto puede reabrirse (vuelve a revisión si lo atendía un humano).
 */
const TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  OPEN: ['WAITING_CUSTOMER', 'ESCALATED_TO_HUMAN', 'RESOLVED_BY_AI', 'IN_REVIEW', 'RESOLVED', 'CLOSED'],
  WAITING_CUSTOMER: ['OPEN', 'RESOLVED_BY_AI', 'ESCALATED_TO_HUMAN', 'IN_REVIEW', 'RESOLVED', 'CLOSED'],
  ESCALATED_TO_HUMAN: ['IN_REVIEW', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED'],
  IN_REVIEW: ['WAITING_CUSTOMER', 'ESCALATED_TO_HUMAN', 'RESOLVED', 'CLOSED'],
  RESOLVED_BY_AI: ['OPEN', 'ESCALATED_TO_HUMAN', 'CLOSED'],
  RESOLVED: ['IN_REVIEW', 'CLOSED'],
  CLOSED: ['IN_REVIEW'],
}

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to)
}

export class InvalidTransitionError extends Error {
  constructor(from: TicketStatus, to: TicketStatus) {
    super(`Transición no permitida: ${from} → ${to}`)
  }
}

export function assertTransition(from: TicketStatus, to: TicketStatus) {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to)
}

/** Estado al que vuelve un caso cuando el cliente escribe de nuevo. */
export function statusOnCustomerMessage(current: TicketStatus, handledBy: Handler): TicketStatus {
  if (handledBy === 'HUMAN') {
    // Un humano lleva el caso: vuelve a su bandeja como «En revisión».
    return current === 'ESCALATED_TO_HUMAN' ? 'ESCALATED_TO_HUMAN' : 'IN_REVIEW'
  }
  return 'OPEN'
}
