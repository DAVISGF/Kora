// Estado de la cuenta/flota del cliente que consulta Kilo IA y que ve el agente en la consola.
// Kilora expone un endpoint interno; aquí sólo se define el contrato y un cliente HTTP.
import type { AccountSnapshot } from './kiloAI'

export interface AccountProvider {
  snapshot(userId: string, tenantId: string): Promise<AccountSnapshot | null>
}

/** GET {baseUrl}/internal/support/tenants/{tenantId}/snapshot?user_id=… con token de servicio. */
export class HttpAccountProvider implements AccountProvider {
  constructor(
    private baseUrl: string,
    private token: string,
  ) {}
  async snapshot(userId: string, tenantId: string) {
    try {
      const url = `${this.baseUrl.replace(/\/$/, '')}/internal/support/tenants/${encodeURIComponent(tenantId)}/snapshot?user_id=${encodeURIComponent(userId)}`
      const res = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(4_000) })
      return res.ok ? ((await res.json()) as AccountSnapshot) : null
    } catch {
      return null // el soporte no se bloquea si la API de cuentas no responde
    }
  }
}

/** Datos fijos para desarrollo local. */
export class StaticAccountProvider implements AccountProvider {
  constructor(private data: Record<string, AccountSnapshot> = {}) {}
  async snapshot(_userId: string, tenantId: string) {
    return this.data[tenantId] ?? null
  }
}
