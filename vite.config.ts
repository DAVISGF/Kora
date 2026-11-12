import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const SERVER_ENV = ['ROBOFLOW_', 'HELPDESK_', 'WHATSAPP_', 'ANTHROPIC_', 'KILO', 'SUPPORT_', 'DATABASE_URL', 'CRON_SECRET']

/** Pasa una petición de Connect a un handler Web (Request → Response), con streaming (SSE). */
async function toWebHandler(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  handler: (r: Request) => Promise<Response>,
) {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
  const abort = new AbortController()
  res.on('close', () => abort.abort())
  const method = req.method ?? 'GET'
  const out = await handler(
    new Request(`http://localhost${url}`, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks),
      signal: abort.signal,
    }),
  )
  res.statusCode = out.status
  out.headers.forEach((v, k) => res.setHeader(k, v))
  if (!out.body) return res.end()
  const reader = out.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(value)
    }
  } catch {
    // cliente desconectado
  }
  res.end()
}

/** En desarrollo sirve /api/vision y /api/helpdesk/* con el mismo código que desplegará Vercel. */
function devApi(): Plugin {
  return {
    name: 'kora-dev-api',
    configureServer(server) {
      Object.assign(process.env, { ...loadEnv(server.config.mode, process.cwd(), SERVER_ENV), ...process.env })
      server.middlewares.use('/api/vision', async (req, res) => {
        const { POST } = (await server.ssrLoadModule('/api/vision.ts')) as { POST: (r: Request) => Promise<Response> }
        await toWebHandler(req, res, '/api/vision', POST)
      })
      server.middlewares.use('/api/helpdesk', async (req, res) => {
        const mod = (await server.ssrLoadModule('/server/helpdesk/devEntry.ts')) as { run: (r: Request) => Promise<Response> }
        await toWebHandler(req, res, `/api/helpdesk${req.url ?? ''}`, mod.run)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devApi()],
})
