import { describe, expect, it } from 'vitest'
import { buildTracks, captures, countCaptures, FPS_MAX, FPS_MIN, pickProtagonists, planWindows, type CoarseFrame } from './windows'

const box = (x: number, h: number) => ({ x, y: 0.2, w: h * 0.4, h })
const frames = (secs: number, people: { id: number; h: number; from?: number; to?: number }[]): CoarseFrame[] =>
  Array.from({ length: secs + 1 }, (_, t) => ({
    t,
    persons: people.filter((p) => t >= (p.from ?? 0) && t <= (p.to ?? secs)).map((p) => ({ id: p.id, box: box(0.1 * p.id, p.h), conf: 0.8 })),
  }))

describe('qué mirar de cerca', () => {
  it('elige a quien más se ve y descarta a los pequeños y a los de fondo', () => {
    const tracks = buildTracks(frames(10, [{ id: 1, h: 0.6 }, { id: 2, h: 0.5 }, { id: 3, h: 0.08 }, { id: 4, h: 0.3, from: 4, to: 6 }]))
    const { chosen, tooSmall } = pickProtagonists(tracks)
    expect(chosen.map((t) => t.id)).toEqual([1, 2])
    expect(tooSmall).toBe(1)
  })

  it('si se elige a alguien a mano, se le mide aunque no sea protagonista', () => {
    const tracks = buildTracks(frames(10, [{ id: 1, h: 0.6 }, { id: 2, h: 0.5 }, { id: 3, h: 0.08 }, { id: 4, h: 0.3, from: 4, to: 6 }]))
    // El 4 queda fuera por su cuenta: se ve poco al lado del principal.
    expect(pickProtagonists(tracks, undefined, [4]).chosen.map((t) => t.id)).toEqual([4])
    // Elegir no arregla un cuerpo demasiado pequeño para medirlo: se avisa en vez de inventar.
    const small = pickProtagonists(tracks, undefined, [3])
    expect(small.chosen).toHaveLength(0)
    expect(small.tooSmall).toBe(1)
    expect(pickProtagonists(tracks, undefined, [99]).chosen).toHaveLength(0)
  })

  it('un clip corto se mira entero a la mayor cadencia que permite el presupuesto', () => {
    const { chosen } = pickProtagonists(buildTracks(frames(8, [{ id: 1, h: 0.6 }])))
    const plan = planWindows(chosen, [], 'basket', { budget: 240, start: 0, end: 8.5 })
    expect(plan.fps).toBe(FPS_MAX)
    expect(plan.windows.get(1)).toHaveLength(1)
    const shots = captures(plan.windows, plan.fps)
    expect(countCaptures(shots)).toBeGreaterThan(8 * FPS_MAX - 5)
    expect(countCaptures(shots)).toBeLessThanOrEqual(8.5 * FPS_MAX + 1)
  })

  it('con dos personas cada instante del video se lee una sola vez', () => {
    const { chosen } = pickProtagonists(buildTracks(frames(8, [{ id: 1, h: 0.6 }, { id: 2, h: 0.5 }])))
    const plan = planWindows(chosen, [], 'futbol', { budget: 240, start: 0, end: 8.5 })
    const shots = captures(plan.windows, plan.fps)
    expect(shots.every((c) => c.ids.length === 2)).toBe(true)
    expect(countCaptures(shots)).toBe(shots.length * 2)
    expect(countCaptures(shots)).toBeLessThanOrEqual(245)
    expect(new Set(shots.map((c) => c.t)).size).toBe(shots.length)
  })

  it('un video largo no pasa del presupuesto: mira primero lo que la pasada gruesa marcó', () => {
    const { chosen } = pickProtagonists(buildTracks(frames(70, [{ id: 1, h: 0.6 }])))
    const events = [
      { t: 30, code: 'T', personId: 1 },
      { t: 55, code: 'S', personId: 1 },
    ]
    const plan = planWindows(chosen, events, 'basket', { budget: 240, start: 0, end: 70 })
    expect(plan.fps).toBe(FPS_MIN)
    const ws = plan.windows.get(1)!
    expect(ws.some((w) => w.reason === 'shot' && w.start <= 29 && w.end >= 31)).toBe(true)
    expect(ws.some((w) => w.reason === 'sprint' && w.start <= 54.5 && w.end >= 55.5)).toBe(true)
    expect(countCaptures(captures(plan.windows, plan.fps))).toBeLessThanOrEqual(240 + ws.length)
  })

  it('al afinar no repite los instantes ya medidos', () => {
    const windows = new Map([[1, [{ start: 1, end: 2, reason: 'kick' as const }]]])
    const first = captures(windows, 12)
    const have = new Map([[1, first.map((c) => c.t)]])
    const more = captures(windows, 24, have)
    expect(more.length).toBeGreaterThan(8)
    for (const c of more) expect(first.some((d) => Math.abs(d.t - c.t) < 0.012)).toBe(false)
  })
})
