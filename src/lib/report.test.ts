import { describe, expect, it } from 'vitest'
import { buildReport } from './coach/report'
import { kick, run, shots } from './coach/testing/moves'
import { coachReportMd } from './report'

const frames = { requested: 100, measured: 98 }

describe('informe descargable del Coach', () => {
  it('lleva el foco con su clave y su ejercicio, lo que hace bien y lo que no se vio', () => {
    const stiff = { knee: 170 }
    const report = buildReport({ sport: 'basket', people: [{ personId: 1, series: [shots([stiff, stiff, stiff], { yaw: 90 })], height: 0.5 }], tooSmall: 0, frames })
    const md = coachReportMd(report, 'mi-video.mp4', 'Baloncesto')
    expect(md).toContain('# AI Coach · mi-video.mp4')
    expect(md).toContain('## Tu foco')
    expect(md).toContain('### Dobla más las rodillas antes de tirar')
    expect(md).toContain('**La clave:**')
    expect(md).toContain('**Ejercicio: Tiro desde la silla**')
    expect(md).toContain('## Lo que ya haces bien')
    expect(md).toContain('## Lo que no pudimos ver')
    expect(md).toContain('## Para grabar mejor')
    expect(md).not.toMatch(/undefined|null|NaN|\[object/)
  })

  it('con dos personas separa a cada una y no deja secciones vacías', () => {
    const report = buildReport({
      sport: 'futbol',
      people: [
        { personId: 4, series: [kick({})], height: 0.5 },
        { personId: 9, series: [run({})], height: 0.5 },
      ],
      tooSmall: 0,
      frames,
    })
    const md = coachReportMd(report, 'partido.mp4', 'Fútbol')
    expect(md).toContain('# Jugador 1')
    expect(md).toContain('# Jugador 2')
    // Quien tiene etiqueta sale con su nombre; el resto conserva su número de orden.
    const named = coachReportMd(report, 'partido.mp4', 'Fútbol', new Map([[9, '#10 L. Vidal']]))
    expect(named).toContain('# Jugador 1')
    expect(named).toContain('# #10 L. Vidal')
    expect(named).not.toContain('# Jugador 2')
    expect(md).not.toMatch(/undefined|null|NaN|\[object/)
    // Ningún título de sección queda sin contenido debajo.
    expect(md).not.toMatch(/## [^\n]+\n+(## |# |$)/)
  })

  it('si no hubo nada que analizar, lo explica', () => {
    const report = buildReport({ sport: 'basket', people: [], tooSmall: 2, frames: { requested: 0, measured: 0 } })
    const md = coachReportMd(report, 'lejos.mp4', 'Baloncesto')
    expect(md).toContain('muy lejos')
    expect(md).toContain('## Para grabar mejor')
    expect(md).not.toMatch(/undefined|null|NaN/)
  })
})
