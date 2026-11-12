// Ensambla el helpdesk según las variables de entorno. Una instancia por proceso (Fluid Compute la reutiliza).
import { HttpAccountProvider, type AccountProvider } from './accounts'
import type { AuthConfig } from './auth'
import { ClaudeKiloAI, HeuristicKiloAI, ResilientKiloAI, type KiloAI } from './kiloAI'
import { MemoryRepository } from './memoryRepository'
import { Notifier } from './notifications'
import { PgRepository } from './pgRepository'
import type { HelpdeskRepository } from './repository'
import { demoAccounts, seedDemoTickets, seedReference } from './seed'
import { HelpdeskService } from './service'
import { CloudWhatsApp, RecordingWhatsApp, normalizePhone, type WhatsAppSender } from './whatsapp'

export interface Helpdesk {
  repo: HelpdeskRepository
  service: HelpdeskService
  notifier: Notifier
  wa: WhatsAppSender | null
  auth: AuthConfig
  webhook: { appSecret?: string; verifyToken?: string }
  cronSecret?: string
  mode: { db: 'postgres' | 'memory'; ai: 'claude' | 'heuristic'; whatsapp: 'cloud' | 'recording' }
  ready: Promise<void>
}

type Env = Record<string, string | undefined>

const template = (env: Env, key: string) => (env[key] ? { name: env[key]!, language: env.WHATSAPP_TEMPLATE_LANG || 'es' } : undefined)

export function createHelpdesk(env: Env = process.env): Helpdesk {
  const production = env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production'

  const memory = env.DATABASE_URL ? null : new MemoryRepository()
  const repo: HelpdeskRepository = env.DATABASE_URL ? PgRepository.fromUrl(env.DATABASE_URL) : memory!
  if (production && memory) console.warn('[helpdesk] DATABASE_URL no definida: usando memoria (los datos no persisten).')

  const ai: KiloAI = env.ANTHROPIC_API_KEY ? new ResilientKiloAI(new ClaudeKiloAI(env.ANTHROPIC_API_KEY, env.KILO_AI_MODEL || 'claude-opus-5-5')) : new HeuristicKiloAI()

  const wa: WhatsAppSender | null =
    env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID
      ? new CloudWhatsApp(env.WHATSAPP_TOKEN, env.WHATSAPP_PHONE_NUMBER_ID, env.WHATSAPP_API_VERSION || 'v21.0')
      : production
        ? null
        : new RecordingWhatsApp()

  const accounts: AccountProvider =
    env.KILORA_ACCOUNTS_API_URL && env.KILORA_SERVICE_TOKEN ? new HttpAccountProvider(env.KILORA_ACCOUNTS_API_URL, env.KILORA_SERVICE_TOKEN) : demoAccounts

  const notifier = new Notifier(repo, wa, {
    consoleBaseUrl: env.KILORA_CONSOLE_URL || 'http://localhost:5173',
    teamPhones: (env.SUPPORT_TEAM_WHATSAPP ?? '')
      .split(',')
      .map((p) => normalizePhone(p.trim()))
      .filter((p): p is string => !!p),
    teamTemplate: template(env, 'WHATSAPP_TEAM_TEMPLATE'),
  })

  const service = new HelpdeskService(repo, ai, wa, notifier, accounts, { replyTemplate: template(env, 'WHATSAPP_REPLY_TEMPLATE') })

  const ready = memory
    ? (async () => {
        seedReference(memory)
        if (env.HELPDESK_SEED_DEMO !== '0') await seedDemoTickets(service)
      })().catch((e) => console.error('[helpdesk] seed', e))
    : Promise.resolve()

  return {
    repo,
    service,
    notifier,
    wa,
    auth: { secret: env.HELPDESK_JWT_SECRET, devAuth: !env.HELPDESK_JWT_SECRET && (!production || env.HELPDESK_DEV_AUTH === '1') },
    webhook: { appSecret: env.WHATSAPP_APP_SECRET, verifyToken: env.WHATSAPP_VERIFY_TOKEN },
    cronSecret: env.CRON_SECRET,
    mode: {
      db: memory ? 'memory' : 'postgres',
      ai: env.ANTHROPIC_API_KEY ? 'claude' : 'heuristic',
      whatsapp: wa instanceof CloudWhatsApp ? 'cloud' : 'recording',
    },
    ready,
  }
}

let instance: Helpdesk | null = null
export function getHelpdesk(): Helpdesk {
  return (instance ??= createHelpdesk())
}
