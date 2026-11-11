// Utilidades para leer fotogramas de un video fuera de pantalla.

import type { PxBox } from './coach/types'
import { VisionError } from './vision'

export function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.crossOrigin = 'anonymous'
    video.onloadeddata = () => resolve(video)
    video.onerror = () => reject(new VisionError('failed', 'No se pudo abrir el video para analizarlo.'))
    video.src = url
  })
}

export function disposeVideo(video: HTMLVideoElement) {
  video.removeAttribute('src')
  video.load()
}

export function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => {
      cleanup()
      resolve()
    }
    const fail = () => {
      cleanup()
      reject(new VisionError('failed', 'No se pudo leer el video.'))
    }
    const cleanup = () => {
      video.removeEventListener('seeked', ok)
      video.removeEventListener('error', fail)
    }
    video.addEventListener('seeked', ok)
    video.addEventListener('error', fail)
    video.currentTime = t
  })
}

let canvas: HTMLCanvasElement | null = null

/**
 * Recorta una zona del fotograma actual y la escala para que su lado mayor mida
 * `target` píxeles (sin ampliar más de `maxUpscale` veces). Devuelve un data URL JPEG.
 */
export function cropFrame(video: HTMLVideoElement, rect: PxBox, target: number, quality = 0.82, maxUpscale = 3): string | null {
  if (rect.w < 4 || rect.h < 4) return null
  const scale = Math.min(maxUpscale, target / Math.max(rect.w, rect.h))
  canvas ??= document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(rect.w * scale))
  canvas.height = Math.max(1, Math.round(rect.h * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(video, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', quality)
}
