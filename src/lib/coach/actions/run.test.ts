import { describe, expect, it } from 'vitest'
import { cleanSeries } from '../series'
import { run, shots, type RunSpec } from '../testing/moves'
import { detectRuns } from './run'

const detect = (spec: RunSpec = {}) => detectRuns(cleanSeries(run(spec)))

describe('carrera', () => {
  it('reconoce la carrera y cuenta los pasos por segundo', () => {
    const [r] = detect({ cadence: 3.6 })
    expect(r).toBeDefined()
    expect(r.view).toBe('side')
    expect(r.info.cadence).toBeGreaterThan(3.3)
    expect(r.info.cadence).toBeLessThan(3.9)
  })

  it('de lado mide codos, rodillas y tronco', () => {
    const [r] = detect({ elbow: 90, knee: 62, lean: 8 })
    expect(r.m.arms.value).toBeGreaterThan(80)
    expect(r.m.arms.value).toBeLessThan(100)
    expect(r.m.knees.value).toBeGreaterThan(54)
    expect(r.m.knees.value).toBeLessThan(70)
    expect(r.m.lean.value).toBeGreaterThan(4)
    expect(r.m.lean.value).toBeLessThan(12)
    expect(r.missing.cross).toBe('view')
  })

  it('distingue los brazos estirados y el cuerpo echado hacia atrás', () => {
    expect(detect({ elbow: 160 })[0].m.arms.value).toBeGreaterThan(145)
    expect(detect({ lean: -10 })[0].m.lean.value).toBeLessThan(-6)
  })

  it('el sentido de la carrera no cambia la medida del tronco', () => {
    const left = run({ lean: 8 })
    // La misma carrera reflejada: corre hacia la izquierda de la imagen.
    for (const f of left.frames) for (const p of Object.values(f.pose)) p.x = 1280 - p.x
    const [r] = detectRuns(cleanSeries(left))
    expect(r.m.lean.value).toBeGreaterThan(4)
  })

  it('en diagonal corrige el ángulo de cámara antes de medir', () => {
    const [r] = detect({ elbow: 90, lean: 8, yaw: 40 })
    expect(r.m.arms.value).toBeGreaterThan(78)
    expect(r.m.arms.value).toBeLessThan(102)
    expect(r.m.lean.value).toBeGreaterThan(4)
    expect(r.m.lean.value).toBeLessThan(13)
  })

  it('de frente mide las rodillas por altura y no opina de codos ni tronco', () => {
    const [r] = detect({ yaw: 90, knee: 62 })
    expect(r.view).toBe('front')
    expect(r.m.knees.value).toBeGreaterThan(54)
    expect(r.missing.arms).toBe('view')
    expect(r.missing.lean).toBe('view')
    expect(r.m.cross.value).toBeLessThan(0)
  })

  it('aguanta pocos fotogramas por segundo', () => {
    const [r] = detect({ fps: 10 })
    expect(r).toBeDefined()
    expect(r.m.arms.value).toBeGreaterThan(78)
    expect(r.m.arms.value).toBeLessThan(102)
  })

  it('a cámara lenta no inventa la cadencia', () => {
    const [r] = detect({ cadence: 1.2, duration: 6 })
    expect(r).toBeDefined()
    expect(r.info.cadence).toBeUndefined()
    expect(r.info.slow).toBe(1)
  })

  it('no confunde un tiro con una carrera', () => {
    expect(detectRuns(cleanSeries(shots([{}, {}])))).toHaveLength(0)
  })
})
