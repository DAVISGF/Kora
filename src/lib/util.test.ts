import { describe, expect, it } from 'vitest'
import { videoSlug } from './util'

describe('videoSlug', () => {
  it('quita la extensión del video para nombrar lo que se descarga', () => {
    expect(videoSlug('Tiros Baloncesto.webm')).toBe('tiros-baloncesto')
    expect(videoSlug('partido.final.MP4')).toBe('partido-final')
    expect(videoSlug('entreno')).toBe('entreno')
  })

  it('nunca deja el nombre vacío', () => {
    expect(videoSlug('.mov')).toBe('video')
  })
})
