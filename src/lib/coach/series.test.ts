import { describe, expect, it } from 'vitest'
import { kneeAngle } from './geometry'
import { argExtreme, cleanSeries, estimateStature, median3, robustExtreme, signal } from './series'
import { series, track, type FigureSpec } from './testing/synth'

const base: FigureSpec = {
  height: 420,
  x: 640,
  groundY: 660,
  lean: 0,
  legs: { left: { lift: 0, bend: 0 }, right: { lift: 0, bend: 0 } },
  arms: { left: { lift: 10, bend: 10 }, right: { lift: 10, bend: 10 } },
}

/** Una sentadilla: la rodilla pasa de 180° a 110° y vuelve. */
const squat = (noise = 0) => {
  const bend = track([
    [0, 0],
    [0.6, 70],
    [1.2, 0],
  ])
  return series({
    fps: 15,
    duration: 1.2,
    noise,
    at: (t) => ({ ...base, legs: { left: { lift: bend(t) / 2, bend: bend(t) }, right: { lift: bend(t) / 2, bend: bend(t) } } }),
  })
}

describe('series de poses', () => {
  it('estima la estatura con menos de un 5 % de error, también agachado', () => {
    const s = squat(0.006)
    const stature = estimateStature(s.frames)!
    expect(Math.abs(stature - 420) / 420).toBeLessThan(0.05)
  })

  it('quita el salto de un punto en un solo fotograma y lo rellena', () => {
    const s = squat()
    const i = 9
    const before = kneeAngle(s.frames[i].pose, 'left')!
    s.frames[i].pose.left_knee = { x: s.frames[i].pose.left_knee!.x + 180, y: s.frames[i].pose.left_knee!.y - 150, c: 0.9 }
    expect(Math.abs(kneeAngle(s.frames[i].pose, 'left')! - before)).toBeGreaterThan(30)
    const cleaned = cleanSeries(s)
    expect(kneeAngle(cleaned.frames[i].pose, 'left')!).toBeCloseTo(before, -1)
    expect(cleaned.frames[i].pose.left_knee!.c).toBeLessThan(0.9)
  })

  it('descarta puntos de baja confianza y no inventa huecos largos', () => {
    const s = squat()
    for (let i = 5; i <= 12; i++) s.frames[i].pose.right_ankle = { ...s.frames[i].pose.right_ankle!, c: 0.1 }
    const cleaned = cleanSeries(s)
    expect(cleaned.frames[8].pose.right_ankle).toBeUndefined()
    expect(cleaned.frames[3].pose.right_ankle).toBeDefined()
  })

  it('no toca un movimiento real rápido: el mínimo de la sentadilla se conserva', () => {
    const s = cleanSeries(squat(0.004))
    const knees = signal(s.frames, (p) => kneeAngle(p, 'left'))
    const i = argExtreme(knees, 0, knees.length - 1, 'min')!
    expect(s.frames[i].t).toBeCloseTo(0.6, 1)
    expect(knees[i]!).toBeGreaterThan(102)
    expect(knees[i]!).toBeLessThan(118)
  })

  it('el extremo robusto ignora un único valor disparatado', () => {
    const values = [170, 165, 120, 118, 60, 119, 150]
    expect(robustExtreme(values, 0, 6, 'min')).toBe(118)
    expect(median3([10, 10, 90, 10, 10])[2]).toBe(10)
  })
})
