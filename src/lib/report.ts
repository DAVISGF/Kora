import type { SportData } from '../data/sports'
import type { Clip } from './store'
import { fmtTime, toCsv } from './util'

const NOTE = '> Informe generado con datos de ejemplo de Kora.'

export function analysisReportMd(data: SportData, secs: number, title = data.match): string {
  return [
    `# ${title}`,
    `${data.label} · duración ${fmtTime(secs)}`,
    NOTE,
    '',
    '## Indicadores',
    ...data.kpis.map((k) => `- **${k.label}:** ${k.value} (${k.delta})`),
    '',
    '## Eventos',
    ...data.events.map((e) => `- ${fmtTime((secs * e.pct) / 100)} · ${e.type} · ${e.desc}`),
    '',
    '## Diagnósticos del AI Coach',
    ...data.diags.flatMap((d) => [
      `### [${d.sev}] ${d.title}`,
      `${d.who} · medido ${d.meas} · ideal ${d.ideal}`,
      '',
      d.detail,
      '',
      ...d.drills.map(([name, dose]) => `- ${name} (${dose})`),
      '',
    ]),
  ].join('\n')
}

export function eventsCsv(data: SportData, secs: number): string {
  return toCsv([
    ['tiempo', 'segundos', 'tipo', 'detalle'],
    ...data.events.map((e) => [fmtTime((secs * e.pct) / 100), Math.round((secs * e.pct) / 100), e.type, e.desc]),
  ])
}

export function playsReportMd(data: SportData, title: string): string {
  return [
    `# Jugadas clave · ${title}`,
    NOTE,
    '',
    data.summary,
    '',
    '## Jugadas clave',
    ...data.plays.map(([time, name, why]) => `- **${time} · ${name}.** ${why}`),
    '',
    '## Ejercicios recomendados',
    ...data.drills.map(([name, goal, dose]) => `- **${name}** (${dose}). ${goal}`),
  ].join('\n')
}

export function clipReportMd(clip: Clip): string {
  return [
    `# Recorte · ${clip.name}`,
    `${clip.source} · ${clip.range} · ${clip.dur}`,
    NOTE,
    '',
    '## Indicadores del tramo',
    ...clip.kpis.map(([label, value]) => `- **${label}:** ${value}`),
    '',
    '## Análisis en cámara lenta',
    ...clip.phases.map((p) => `- **${p.name}** (${p.dur}): ${p.metric}. ${p.note}`),
    '',
    `## Diagnóstico [${clip.sev}]`,
    `${clip.diag} — ${clip.who}`,
    `Medido ${clip.meas} · ideal ${clip.ideal}`,
    '',
    `Ejercicio: ${clip.drill[0]} (${clip.drill[1]})`,
    '',
    `Capas incluidas: ${clip.layers.join(', ') || 'ninguna'}`,
  ].join('\n')
}

export function clipCsv(clip: Clip): string {
  return toCsv([['fase', 'duracion', 'metrica', 'estado'], ...clip.phases.map((p) => [p.name, p.dur, p.metric, p.state > 0 ? 'en rango' : p.state < 0 ? 'fuera' : 'justo'])])
}
