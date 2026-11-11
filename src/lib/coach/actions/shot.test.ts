import { describe, expect, it } from 'vitest'
import { cleanSeries } from '../series'
import { releaseOf, shots, type ShotSpec } from '../testing/moves'
import { detectShots } from './shot'

const detect = (specs: ShotSpec[], opts: Parameters<typeof shots>[1] = {}) => detectShots(cleanSeries(shots(specs, opts)))

describe('tiro de baloncesto', () => {
  it('encuentra cada tiro, el brazo que tira y el instante de soltar', () => {
    const specs: ShotSpec[] = [{}, {}, {}]
    const { shots: found, layups } = detect(specs)
    expect(found).toHaveLength(3)
    expect(layups).toHaveLength(0)
    found.forEach((s, n) => {
      expect(s.side).toBe('right')
      expect(Math.abs(s.t - releaseOf(specs, n))).toBeLessThan(0.15)
    })
  })

  it('de lado mide rodillas, brazo y final del tiro', () => {
    const [shot] = detect([{ knee: 120, elbow: 172, hold: 0.8 }]).shots
    expect(shot.view).toBe('side')
    expect(shot.m.legs.value).toBeGreaterThan(112)
    expect(shot.m.legs.value).toBeLessThan(128)
    expect(shot.m.legs.method).toBe('angle')
    expect(shot.m.extension.value).toBeGreaterThan(165)
    expect(shot.m.follow.value).toBeGreaterThan(0.7)
    // De lado no se ven ni la separación de los pies ni el codo abierto.
    expect(shot.missing.base).toBe('view')
    expect(shot.missing.flare).toBe('view')
  })

  it('distingue un tiro con poca pierna, brazo doblado y mano que baja enseguida', () => {
    const [shot] = detect([{ knee: 168, elbow: 138, hold: 0.1 }]).shots
    expect(shot.m.legs.value).toBeGreaterThan(160)
    expect(shot.m.extension.value).toBeLessThan(150)
    expect(shot.m.follow.value).toBeLessThan(0.35)
  })

  it('de frente deduce las rodillas de lo que bajan las caderas, no del ángulo que se ve', () => {
    const [deep] = detect([{ knee: 115 }], { yaw: 90 }).shots
    const [stiff] = detect([{ knee: 170 }], { yaw: 90 }).shots
    expect(deep.view).toBe('front')
    expect(deep.m.legs.method).toBe('vertical')
    expect(deep.m.legs.value).toBeGreaterThan(105)
    expect(deep.m.legs.value).toBeLessThan(125)
    expect(stiff.m.legs.value).toBeGreaterThan(150)
  })

  it('de frente no da por estirado un brazo que no puede ver doblarse', () => {
    const [bent] = detect([{ elbow: 152 }], { yaw: 90 }).shots
    expect(bent.m.extension).toBeUndefined()
    expect(bent.missing.extension).toBe('view')
  })

  it('de frente mide la separación de los pies', () => {
    const base = (spread: number) => detect([{ spread }], { yaw: 90 }).shots[0].m.base.value
    expect(base(0.5)).toBeLessThan(0.45)
    expect(base(1.6)).toBeGreaterThan(0.7)
    expect(base(1.6)).toBeLessThan(1.4)
    expect(base(3.8)).toBeGreaterThan(2.1)
  })

  it('en diagonal no opina de lo que solo se ve de frente o de lado', () => {
    const [shot] = detect([{}], { yaw: 45 }).shots
    expect(shot.view).toBe('oblique')
    expect(shot.missing.base).toBe('view')
    expect(shot.missing.flare).toBe('view')
    expect(shot.missing.extension).toBe('view')
    // Lo que se mide por altura sí vale desde cualquier sitio.
    expect(shot.m.legs.value).toBeGreaterThan(110)
    expect(shot.m.legs.value).toBeLessThan(130)
    expect(shot.m.follow).toBeDefined()
  })

  it('mide la inclinación del cuerpo al soltar', () => {
    const [shot] = detect([{ lean: 25 }]).shots
    expect(shot.m.trunk.value).toBeGreaterThan(18)
  })

  it('no cuenta como tiro una entrada al aro', () => {
    const { shots: found, layups } = detect([{ layup: true }])
    expect(found).toHaveLength(0)
    expect(layups).toHaveLength(1)
  })

  it('sigue funcionando con pocos fotogramas por segundo', () => {
    const [shot] = detect([{ knee: 125 }], { fps: 10 }).shots
    expect(shot).toBeDefined()
    expect(shot.m.legs.value).toBeGreaterThan(112)
    expect(shot.m.legs.value).toBeLessThan(138)
  })

  it('si el video se corta al soltar, no inventa el final del tiro', () => {
    const series = shots([{ hold: 1 }])
    const cut = { ...series, frames: series.frames.filter((f) => f.t <= 1.45), end: 1.45 }
    const [shot] = detectShots(cleanSeries(cut)).shots
    expect(shot.m.follow).toBeUndefined()
    expect(shot.missing.follow).toBe('cut')
  })

  it('con más gente alrededor exige ver el balón en las manos', () => {
    const series = shots([{}])
    for (const f of series.frames) f.ball = null
    expect(detectShots(cleanSeries(series), { needBall: true }).shots).toHaveLength(0)
    expect(detectShots(cleanSeries(series)).shots).toHaveLength(1)
    // Con el balón junto a la mano de tiro antes de soltar, sí cuenta.
    for (const f of series.frames) {
      const w = f.pose.right_wrist
      if (w && f.t > 0.8 && f.t < 1.3) f.ball = { x: w.x, y: w.y - 20, r: 28, c: 0.8 }
    }
    expect(detectShots(cleanSeries(series), { needBall: true }).shots).toHaveLength(1)
  })
})
