import { describe, expect, it } from 'vitest'
import { armElevation, classifyView, elbowAngle, facing, frontalRatio, kneeAngle, median, thighAngle, trunkLean } from './geometry'
import { figure, type FigureSpec } from './testing/synth'

const standing: FigureSpec = {
  height: 400,
  x: 600,
  groundY: 650,
  lean: 0,
  legs: { left: { lift: 0, bend: 0 }, right: { lift: 0, bend: 0 } },
  arms: { left: { lift: 0, bend: 0 }, right: { lift: 0, bend: 0 } },
}
const with_ = (over: Partial<FigureSpec>): FigureSpec => ({ ...standing, ...over })

describe('geometría de la pose', () => {
  it('mide rodilla y codo estirados como 180°', () => {
    const pose = figure(standing)
    expect(kneeAngle(pose, 'right')).toBeCloseTo(180, 0)
    expect(elbowAngle(pose, 'right')).toBeCloseTo(180, 0)
  })

  it('recupera la flexión de rodilla y de codo en vista de perfil', () => {
    const pose = figure(with_({ legs: { left: { lift: 30, bend: 60 }, right: { lift: 30, bend: 60 } }, arms: { left: { lift: 90, bend: 90 }, right: { lift: 90, bend: 90 } } }))
    expect(kneeAngle(pose, 'left')).toBeCloseTo(120, 0)
    expect(elbowAngle(pose, 'left')).toBeCloseTo(90, 0)
    expect(armElevation(pose, 'left')).toBeCloseTo(90, 0)
  })

  it('la inclinación del tronco lleva el signo de la dirección en la imagen', () => {
    expect(trunkLean(figure(with_({ lean: 20, dir: 1 })))).toBeCloseTo(20, 0)
    expect(trunkLean(figure(with_({ lean: 20, dir: -1 })))).toBeCloseTo(-20, 0)
    expect(trunkLean(figure(standing))).toBeCloseTo(0, 0)
  })

  it('el ángulo del muslo es 0 con la pierna vertical y 90 con el muslo horizontal', () => {
    expect(thighAngle(figure(standing), 'left')).toBeCloseTo(0, 0)
    const pose = figure(with_({ legs: { left: { lift: 90, bend: 90 }, right: { lift: 0, bend: 0 } } }))
    expect(thighAngle(pose, 'left')).toBeCloseTo(90, 0)
  })

  it('distingue perfil, oblicuo y de frente por el ancho de hombros', () => {
    const ratio = (yaw: number) => frontalRatio(figure(with_({ yaw })))!
    expect(classifyView(ratio(0))).toBe('side')
    expect(classifyView(ratio(15))).toBe('side')
    expect(classifyView(ratio(40))).toBe('oblique')
    expect(classifyView(ratio(80))).toBe('front')
    expect(ratio(90)).toBeCloseTo(0.9, 1)
  })

  it('un ángulo medido de frente se deforma: por eso hay que comprobar la vista', () => {
    const spec = with_({ legs: { left: { lift: 40, bend: 80 }, right: { lift: 40, bend: 80 } } })
    const side = kneeAngle(figure({ ...spec, yaw: 0 }), 'left')!
    const front = kneeAngle(figure({ ...spec, yaw: 85 }), 'left')!
    expect(side).toBeCloseTo(100, 0)
    expect(front).toBeGreaterThan(165)
  })

  it('sabe hacia dónde mira la persona de perfil', () => {
    expect(facing(figure(with_({ dir: 1 })))).toBe(1)
    expect(facing(figure(with_({ dir: -1 })))).toBe(-1)
    expect(facing(figure(with_({ yaw: 90 })))).toBe(0)
  })

  it('la mediana ignora un valor disparatado', () => {
    expect(median([10, 11, 12, 13, 500])).toBe(12)
    expect(median([])).toBeNull()
  })
})
