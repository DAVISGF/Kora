import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** En desarrollo sirve /api/vision con el mismo código que desplegará Vercel. */
function devApi(): Plugin {
  return {
    name: 'kora-dev-api',
    configureServer(server) {
      Object.assign(process.env, { ...loadEnv(server.config.mode, process.cwd(), 'ROBOFLOW_'), ...process.env })
      server.middlewares.use('/api/vision', async (req, res) => {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk as Buffer)
        const { POST } = (await server.ssrLoadModule('/api/vision.ts')) as { POST: (r: Request) => Promise<Response> }
        const out = await POST(
          new Request('http://localhost/api/vision', {
            method: req.method ?? 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
          }),
        )
        res.statusCode = out.status
        res.setHeader('Content-Type', 'application/json')
        res.end(await out.text())
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devApi()],
})
