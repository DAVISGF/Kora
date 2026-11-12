// Autenticación del helpdesk. La app de Kilora emite un JWT HS256 (mismo secreto compartido):
//   cliente: { sub: user_id, tenant_id, name, email, role: 'customer' }
//   agente:  { sub: agent_id, name, role: 'agent' | 'admin' }
// En desarrollo (sin secreto y fuera de producción) se usa una identidad de demostración.
import { createHmac, timingSafeEqual } from 'node:crypto'

export type Principal =
  | { kind: 'customer'; userId: string; tenantId: string; name: string | null; email: string | null }
  | { kind: 'agent'; agentId: string; name: string; role: 'agent' | 'admin' }

export const DEV_CUSTOMER = {
  kind: 'customer',
  userId: '00000000-0000-4000-8000-000000000001',
  tenantId: '00000000-0000-4000-8000-0000000000a1',
  name: 'Camila Rojas',
  email: 'camila@transportesandes.cl',
} as const satisfies Principal

export const DEV_AGENT = { kind: 'agent', agentId: '00000000-0000-4000-8000-0000000000f1', name: 'Agente Kilora', role: 'admin' } as const satisfies Principal

const b64url = (b: Buffer) => b.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

export function signJwt(payload: Record<string, unknown>, secret: string, ttlSeconds = 3600): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body = b64url(Buffer.from(JSON.stringify({ iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttlSeconds, ...payload })))
  const sig = b64url(createHmac('sha256', secret).update(`${header}.${body}`).digest())
  return `${header}.${body}.${sig}`
}

export function verifyJwt(token: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [h, p, s] = parts
  try {
    const header = JSON.parse(fromB64url(h).toString()) as { alg?: string }
    if (header.alg !== 'HS256') return null
    const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest()
    const got = fromB64url(s)
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null
    const claims = JSON.parse(fromB64url(p).toString()) as Record<string, unknown>
    if (typeof claims.exp === 'number' && claims.exp < nowSec) return null
    if (typeof claims.nbf === 'number' && claims.nbf > nowSec) return null
    return claims
  } catch {
    return null
  }
}

export interface AuthConfig {
  secret?: string
  devAuth: boolean
}

export function principalFrom(request: Request, cfg: AuthConfig): Principal | null {
  const auth = request.headers.get('authorization')
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : new URL(request.url).searchParams.get('access_token')
  if (token && cfg.secret) {
    const c = verifyJwt(token, cfg.secret)
    if (!c || typeof c.sub !== 'string') return null
    if (c.role === 'agent' || c.role === 'admin') {
      return { kind: 'agent', agentId: c.sub, name: String(c.name ?? 'Agente'), role: c.role }
    }
    if (typeof c.tenant_id !== 'string') return null
    return { kind: 'customer', userId: c.sub, tenantId: c.tenant_id, name: (c.name as string) ?? null, email: (c.email as string) ?? null }
  }
  if (cfg.devAuth) {
    const role = request.headers.get('x-dev-role') ?? new URL(request.url).searchParams.get('dev_role')
    return role === 'agent' ? DEV_AGENT : DEV_CUSTOMER
  }
  return null
}
