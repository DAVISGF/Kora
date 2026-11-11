import { describe, expect, it } from 'vitest'
import { TIPS } from './content'
import { buildReport, type PersonInput } from './report'
import { kick, run, shots, type ShotSpec } from './testing/moves'
import type { Finding, PoseSeries } from './types'

const person = (series: PoseSeries[], over: Partial<PersonInput> = {}): PersonInput => ({ personId: 1, series, height: 0.55, ...over })
const report = (sport: 'basket' | 'futbol', people: PersonInput[], tooSmall = 0) => buildReport({ sport, people, tooSmall, frames: { requested: 100, measured: 100 } })
const all = (p: { focus: Finding | null; polish: Finding[]; good: Finding[] }) => [p.focus, ...p.polish, ...p.good].filter((f): f is Finding => !!f)
const stiff: ShotSpec = { knee: 170, elbow: 172, hold: 0.9 }

describe('informe del Coach', () => {
  it('con un fallo repetido lo pone como foco, con su prueba y su ejercicio', () => {
    const r = report('basket', [person([shots([stiff, stiff, stiff])])])
    const p = r.people[0]
    expect(p.actions).toEqual([{ kind: 'shot', count: 3, times: expect.any(Array) }])
    expect(p.focus?.id).toBe('shot.legs')
    expect(p.focus?.status).toBe('fix')
    expect(p.focus?.seen).toBe('En tus 3 tiros casi no doblaste las rodillas.')
    expect(p.focus?.reps).toEqual({ flagged: 3, measured: 3 })
    expect(p.focus?.confidence).toBe('alta')
    expect(p.focus?.drill?.steps.length).toBeGreaterThan(0)
    expect(p.headline).toBe('Vimos 3 tiros. Lo primero: dobla más las rodillas antes de tirar.')
    // La foto es del momento de bajar, enmarca a la persona y resalta las piernas.
    const e = p.focus!.evidence!
    expect(e.highlight).toContain('left_knee')
    expect(e.crop.w).toBeGreaterThan(50)
    expect(e.crop.h).toBeGreaterThan(200)
    for (const pt of Object.values(e.pose)) {
      expect(pt.x).toBeGreaterThanOrEqual(e.crop.x)
      expect(pt.x).toBeLessThanOrEqual(e.crop.x + e.crop.w)
      expect(pt.y).toBeGreaterThanOrEqual(e.crop.y)
      expect(pt.y).toBeLessThanOrEqual(e.crop.y + e.crop.h)
    }
    // Lo que sí hace bien también se dice.
    expect(p.good.map((f) => f.id)).toEqual(expect.arrayContaining(['shot.extension', 'shot.follow']))
  })

  it('un fallo visto una sola vez nunca es «para corregir»: queda como algo para probar', () => {
    const r = report('basket', [person([shots([stiff])])])
    const p = r.people[0]
    expect(p.focus?.id).toBe('shot.legs')
    expect(p.focus?.status).toBe('polish')
    expect(p.focus?.confidence).toBe('baja')
    expect(p.focus?.seen).toBe('En tu tiro casi no doblaste las rodillas.')
    expect(p.headline).toContain('Algo para probar')
    expect(r.tips).toContain(TIPS.more)
  })

  it('si falla en una de varias repeticiones, es para pulir y dice en cuántas', () => {
    const r = report('basket', [person([shots([stiff, {}, {}])])])
    const p = r.people[0]
    expect(p.focus?.status).toBe('polish')
    expect(p.focus?.seen).toBe('En 1 de tus 3 tiros casi no doblaste las rodillas.')
  })

  it('elige un solo foco, en el orden en que lo trabajaría un entrenador', () => {
    const bad: ShotSpec = { knee: 170, elbow: 138, hold: 0.1 }
    const p = report('basket', [person([shots([bad, bad, bad])])]).people[0]
    expect(p.focus?.id).toBe('shot.legs')
    expect(p.polish.map((f) => f.id)).toEqual(['shot.extension', 'shot.follow'])
    expect(p.polish.every((f) => f.status === 'fix')).toBe(true)
  })

  it('sin nada que corregir, lo dice y celebra lo que hace bien', () => {
    const p = report('basket', [person([shots([{}, {}, {}])])]).people[0]
    expect(p.focus).toBeNull()
    expect(p.polish).toHaveLength(0)
    expect(p.good.length).toBeGreaterThanOrEqual(3)
    expect(p.headline).toBe('Vimos 3 tiros. No vimos nada importante que corregir. ¡Buen trabajo!')
  })

  it('lo que la cámara no deja ver se avisa, con el consejo para grabarlo', () => {
    const r = report('basket', [person([shots([{}, {}], { yaw: 90 })])])
    const p = r.people[0]
    expect(p.unmeasured.map((u) => u.id)).toContain('shot.extension')
    expect(p.unmeasured.find((u) => u.id === 'shot.extension')?.text).toBe('Para verlo hay que grabar de lado.')
    expect(r.tips).toContain(TIPS.side)
    // De lado, lo que falta es lo que solo se ve de frente.
    const side = report('basket', [person([shots([{}, {}])])])
    expect(side.people[0].unmeasured.map((u) => u.id)).toEqual(expect.arrayContaining(['shot.base', 'shot.flare']))
    expect(side.tips).toContain(TIPS.front)
  })

  it('en fútbol analiza golpeos y carreras', () => {
    const r = report('futbol', [person([kick({ lean: -35 }), run({ elbow: 160 })])])
    const p = r.people[0]
    expect(p.actions.map((a) => a.kind)).toEqual(['kick', 'run'])
    const found = all(p)
    expect(found.find((f) => f.id === 'kick.lean')?.status).toBe('polish')
    expect(found.find((f) => f.id === 'run.arms')?.status).toBe('polish')
    expect(found.find((f) => f.id === 'kick.knee')?.status).toBe('good')
    expect(p.headline).toContain('Vimos 1 golpeo y 1 carrera.')
  })

  it('las rodillas bajas solo se señalan cuando de verdad se corre rápido', () => {
    const slow = all(report('futbol', [person([run({ knee: 30, cadence: 2.8 })])]).people[0])
    const fast = all(report('futbol', [person([run({ knee: 30, cadence: 4 })])]).people[0])
    expect(slow.find((f) => f.id === 'run.knees')).toBeUndefined()
    expect(fast.find((f) => f.id === 'run.knees')?.status).toBe('polish')
  })

  it('con otro jugador encima no califica el gesto', () => {
    const s = shots([stiff, stiff])
    for (const f of s.frames) f.crowd = true
    const r = report('basket', [person([s])])
    const p = r.people[0]
    expect(p.actions).toHaveLength(0)
    expect(p.focus).toBeNull()
    expect(p.extras.join(' ')).toContain('había alguien muy cerca')
  })

  it('a una persona pequeña en la imagen le baja la seguridad', () => {
    const big = report('basket', [person([shots([stiff, stiff, stiff])])]).people[0]
    const small = report('basket', [person([shots([stiff, stiff, stiff])], { height: 0.15 })])
    expect(big.focus?.confidence).toBe('alta')
    expect(small.people[0].focus?.confidence).toBe('media')
    expect(small.tips).toContain(TIPS.closer)
  })

  it('explica por qué no hay informe cuando no hay nada que analizar', () => {
    const nobody = report('basket', [], 3)
    expect(nobody.people).toHaveLength(0)
    expect(nobody.empty).toContain('muy lejos')
    const still = shots([{}])
    const idle = report('futbol', [person([{ ...still, frames: still.frames.slice(0, 8) }])])
    expect(idle.people).toHaveLength(0)
    expect(idle.empty).toContain('no reconocimos ningún golpeo')
    expect(idle.tips).toContain(TIPS.ball)
  })

  it('nunca da más de tres consejos de grabación ni más de dos cosas para después', () => {
    const bad: ShotSpec = { knee: 170, elbow: 138, hold: 0.1, lean: 28 }
    const r = report('basket', [person([shots([bad, bad, bad], { yaw: 0 })], { height: 0.15 })])
    expect(r.tips.length).toBeLessThanOrEqual(3)
    expect(r.people[0].polish.length).toBeLessThanOrEqual(2)
  })
})
