import type { SportData } from '../data/sports'
import { DISCLAIMER } from './coach/content'
import type { CoachReport, Finding } from './coach/types'
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

function findingMd(f: Finding): string[] {
  const out = [`### ${f.title}`, `${f.label} · ${f.seen}`]
  if (f.measured) out.push(`${f.measured}${f.target ? ` · ${f.target}` : ''}`)
  if (f.why) out.push('', `**Por qué importa:** ${f.why}`)
  if (f.cue) out.push('', `**La clave:** ${f.cue}`)
  if (f.drill) out.push('', `**Ejercicio: ${f.drill.name}** (${f.drill.dose})`, ...f.drill.steps.map((s, i) => `${i + 1}. ${s}`))
  const times = [...new Set(f.moments.map((t) => fmtTime(t)))]
  if (times.length) out.push('', `Míralo en el video: ${times.join(', ')}`)
  out.push('', `_${f.confidenceNote}_`, '')
  return out
}

/** El informe del AI Coach medido en el video, en Markdown. */
/** `names` lleva la etiqueta que se le puso a cada persona (nombre o dorsal), si tiene. */
export function coachReportMd(report: CoachReport, name: string, sportLabel: string, names?: Map<number, string>): string {
  const lines = [`# AI Coach · ${name}`, sportLabel, `> ${DISCLAIMER}`, '']
  if (report.empty) lines.push(report.empty, '')
  report.people.forEach((p, i) => {
    const who = names?.get(p.personId)
    if (who || report.people.length > 1) lines.push(`# ${who ?? `Jugador ${i + 1}`}`, '')
    lines.push(p.headline, '', ...p.extras, '')
    if (p.focus) lines.push('## Tu foco', ...findingMd(p.focus))
    if (p.polish.length) lines.push('## Para después', ...p.polish.flatMap(findingMd))
    if (p.good.length) lines.push('## Lo que ya haces bien', ...p.good.map((f) => `- **${f.title}.** ${f.seen}`), '')
    if (p.unmeasured.length) lines.push('## Lo que no pudimos ver', ...p.unmeasured.map((u) => `- **${u.label}.** ${u.text}`), '')
  })
  if (report.tips.length) lines.push('## Para grabar mejor', ...report.tips.map((t) => `- ${t}`), '')
  return lines.join('\n')
}
