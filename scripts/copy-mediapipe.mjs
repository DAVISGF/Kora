// Copia el runtime WASM de MediaPipe a public/ para servirlo desde el propio dominio.
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const from = join(root, 'node_modules/@mediapipe/tasks-vision/wasm')
const to = join(root, 'public/mediapipe/wasm')

mkdirSync(to, { recursive: true })
for (const file of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) copyFileSync(join(from, file), join(to, file))
console.log('MediaPipe WASM copiado a public/mediapipe/wasm')
