import { describe, expect, it } from 'vitest'
import { cleanSeries } from '../series'
import { kick, KICK_T, run, shots, type KickSpec } from '../testing/moves'
import { detectKicks, kickCandidates } from './kick'

const detect = (spec: KickSpec = {}) => detectKicks(cleanSeries(kick(spec)))

describe('golpeo de fútbol', () => {
  it('encuentra el golpeo, la pierna que golpea y el instante del contacto', () => {
    const [k] = detect()
    expect(k).toBeDefined()
    expect(k.side).toBe('right')
    expect(k.view).toBe('side')
    expect(Math.abs(k.t - KICK_T)).toBeLessThan(0.06)
  })

  it('de lado mide apoyo, rodilla de apoyo, tronco y final', () => {
    const [k] = detect({ plant: 0.3, knee: 150, lean: -8, follow: 60 })
    expect(k.m.plant.value).toBeCloseTo(0.3, 1)
    expect(k.m.knee.value).toBeGreaterThan(144)
    expect(k.m.knee.value).toBeLessThan(156)
    expect(k.m.lean.value).toBeGreaterThan(-12)
    expect(k.m.lean.value).toBeLessThan(-4)
    expect(k.m.follow.value).toBeGreaterThan(50)
  })

  it('distingue el cuerpo hacia atrás, la pierna tiesa, el pie atrasado y la pierna que se frena', () => {
    expect(detect({ lean: -35 })[0].m.lean.value).toBeLessThan(-28)
    expect(detect({ knee: 176 })[0].m.knee.value).toBeGreaterThan(170)
    expect(detect({ plant: 1.2 })[0].m.plant.value).toBeGreaterThan(0.9)
    expect(detect({ follow: 15 })[0].m.follow.value).toBeLessThan(25)
  })

  it('el sentido del golpeo no cambia las medidas', () => {
    const s = kick({ lean: -35, plant: 0.3 })
    for (const f of s.frames) {
      for (const p of Object.values(f.pose)) p.x = 1280 - p.x
      if (f.ball) f.ball.x = 1280 - f.ball.x
    }
    const [k] = detectKicks(cleanSeries(s))
    expect(k.m.lean.value).toBeLessThan(-28)
    expect(k.m.plant.value).toBeCloseTo(0.3, 1)
  })

  it('un pase corto visto de lado se sigue midiendo como visto de lado', () => {
    const [k] = detect({ follow: 15, knee: 150 })
    expect(k.view).toBe('side')
    expect(k.m.knee.value).toBeGreaterThan(144)
    expect(k.m.knee.value).toBeLessThan(156)
  })

  it('sin balón a la vista no hay golpeo', () => {
    expect(detect({ noBall: true })).toHaveLength(0)
  })

  it('no confunde un balón que pasa de largo, una carrera o un tiro con un golpeo', () => {
    const still = kick({})
    // La persona quieta mientras el balón pasa rodando por sus pies.
    const frozen = still.frames[0].pose
    for (const f of still.frames) f.pose = frozen
    expect(detectKicks(cleanSeries(still))).toHaveLength(0)
    expect(detectKicks(cleanSeries(run({})))).toHaveLength(0)
    expect(detectKicks(cleanSeries(shots([{}])))).toHaveLength(0)
  })

  it('a pocos fotogramas por segundo al menos avisa de dónde mirar de cerca', () => {
    const sparse = cleanSeries(kick({ fps: 8 }))
    const where = kickCandidates(sparse)
    expect(where.length).toBeGreaterThan(0)
    expect(Math.abs(where[0] - KICK_T)).toBeLessThan(0.2)
  })
})
