// Reglas de escalamiento Human-in-the-Loop. Son deterministas y se aplican SIEMPRE sobre la
// salida de Kilo IA: el modelo aporta señales (confianza, intención, sentimiento), pero la
// decisión de derivar a una persona la toma esta política, auditable y testeable.
import type { EscalationReason, RequesterType, TicketCategory, TicketPriority } from './types'

export const POLICY = {
  /** Bajo este umbral Kilo IA no responde como si supiera: deriva. */
  minConfidence: 0.65,
  /** Respuestas de IA sin resolver antes de derivar sí o sí. */
  maxAiAttempts: 3,
  /** Categorías que siempre requieren a una persona (intervención técnica/comercial). */
  humanOnlyCategories: ['billing'] as TicketCategory[],
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

const HUMAN_PATTERNS = [
  /\b(hablar|conversar|comunicar(me)?|contactar)\s+(con\s+)?(una?\s+)?(persona|humano|agente|ejecutiv[oa]|asesor[a]?|alguien|operador[a]?)\b/,
  /\b(quiero|necesito|pasame|paseme|derivame|comunicame)\s+(con\s+)?(una?\s+)?(persona|humano|agente|ejecutiv[oa]|asesor[a]?|soporte)\b/,
  /\b(persona real|ser humano|no (quiero|me sirve) (hablar con )?(un )?(bot|robot|ia|maquina))\b/,
  /\bagente humano\b/,
]

const FRUSTRATION_PATTERNS = [
  /\b(pesim[oa]|horrible|vergonzoso|inaceptable|indignad[oa]|harto|harta|cansad[oa] de|una burla|estafa|ridiculo)\b/,
  /\b(no funciona nada|nadie (me )?responde|otra vez lo mismo|ya (lo )?(dije|explique)|cuantas veces)\b/,
  /\b(cancelar (el|mi) (servicio|contrato|plan)|me voy a (ir|cambiar)|demanda|sernac|abogado)\b/,
  /\b(mierda|weon|wea|ctm|conchetumare|puta)\b/,
]

const YES = /^(si|sii+|sí|ok|okey|okay|listo|perfecto|genial|gracias|resuelto|solucionado|funciono|ya funciona|eso era|excelente|de acuerdo|vale)\b/
const NO = /^(no|nop|tampoco|sigue (igual|sin)|no (me )?(sirvio|funciono|resolvio)|aun no|todavia no)\b/

export function detectHumanRequest(text: string): boolean {
  const t = norm(text)
  return HUMAN_PATTERNS.some((re) => re.test(t))
}

/** 0–1: puntaje de frustración por señales léxicas (mayúsculas sostenidas, exclamaciones, insultos). */
export function frustrationScore(text: string): number {
  const t = norm(text)
  let score = 0
  if (FRUSTRATION_PATTERNS.some((re) => re.test(t))) score += 0.6
  const letters = text.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '')
  if (letters.length >= 12 && letters === letters.toUpperCase()) score += 0.3
  if (/[!?]{3,}/.test(text)) score += 0.2
  return Math.min(1, score)
}

/** Respuesta libre a «¿Esto resolvió tu consulta?». */
export function detectConfirmation(text: string): 'yes' | 'no' | null {
  const t = norm(text).trim().replace(/[¡!.,]+/g, ' ').trim()
  if (!t || t.length > 80) return null
  if (NO.test(t)) return 'no'
  if (YES.test(t)) return 'yes'
  return null
}

export interface EscalationSignals {
  confidence: number
  sentiment: 'calm' | 'confused' | 'frustrated' | 'angry'
  intent: string
  category: TicketCategory
  requiresIntervention: boolean
  requesterType: RequesterType
  aiAttempts: number
  text: string
}

export interface EscalationDecision {
  escalate: boolean
  reasons: EscalationReason[]
  priority: TicketPriority
}

export function decideEscalation(s: EscalationSignals): EscalationDecision {
  const reasons: EscalationReason[] = []
  const frustration = Math.max(frustrationScore(s.text), s.sentiment === 'angry' ? 0.9 : s.sentiment === 'frustrated' ? 0.7 : 0)

  if (s.intent === 'human_request' || detectHumanRequest(s.text)) reasons.push('HUMAN_REQUESTED')
  if (frustration >= 0.6) reasons.push('FRUSTRATION')
  if (s.requiresIntervention || POLICY.humanOnlyCategories.includes(s.category)) reasons.push('REQUIRES_INTERVENTION')
  if (s.requesterType === 'LEAD' && s.category === 'commercial' && s.requiresIntervention) reasons.push('COMMERCIAL_LEAD')
  if (s.confidence < POLICY.minConfidence) reasons.push('LOW_CONFIDENCE')
  if (s.aiAttempts >= POLICY.maxAiAttempts) reasons.push('MAX_AI_ATTEMPTS')

  return { escalate: reasons.length > 0, reasons: dedupe(reasons), priority: priorityFor(s, frustration) }
}

export function priorityFor(
  s: Pick<EscalationSignals, 'category' | 'requesterType' | 'sentiment'>,
  frustration = 0,
): TicketPriority {
  if (s.sentiment === 'angry' || frustration >= 0.9) return 'URGENT'
  if (frustration >= 0.6 || s.category === 'billing' || s.category === 'technical') return 'HIGH'
  if (s.requesterType === 'LEAD' && s.category === 'commercial') return 'HIGH' // oportunidad comercial: responder rápido
  if (s.category === 'how_to') return 'LOW'
  return 'NORMAL'
}

const dedupe = <T,>(xs: T[]) => [...new Set(xs)]

export const REASON_LABEL: Record<EscalationReason, string> = {
  HUMAN_REQUESTED: 'Pidió hablar con una persona',
  LOW_CONFIDENCE: 'Kilo IA sin certeza suficiente',
  FRUSTRATION: 'Frustración detectada',
  REQUIRES_INTERVENTION: 'Requiere intervención técnica/comercial',
  COMMERCIAL_LEAD: 'Oportunidad comercial (lead)',
  AI_NOT_RESOLVED: 'El cliente indicó que no se resolvió',
  MAX_AI_ATTEMPTS: 'Máximo de intentos de IA',
  AI_UNAVAILABLE: 'Kilo IA no disponible',
}
