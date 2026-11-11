// Del video medido al informe: reúne las repeticiones de cada persona, califica
// cada chequeo y elige qué decir. Reglas de honestidad: solo se afirma lo que
// se midió, un fallo visto una sola vez nunca es «lo primero a corregir», y lo
// que no se pudo medir se dice junto con cómo grabarlo mejor.

import type { SportId } from '../../data/sports'
import { detectKicks } from './actions/kick'
import { detectRuns } from './actions/run'
import { detectShots } from './actions/shot'
import { checksFor, type Check, type Grade } from './checks'
import { CONFIDENCE_NOTE, COPY, countNoun, inReps, missingText, TIPS } from './content'
import { cleanSeries } from './series'
import type {
  ActionKind,
  CoachReport,
  Confidence,
  Evidence,
  Finding,
  Missing,
  PersonCoach,
  PoseFrame,
  PoseSeries,
  PxBox,
  Rep,
  Status,
  Unmeasured,
} from './types'

/** Por debajo de esta altura (fracción del alto del video) la persona se ve pequeña y se confía menos. */
const SMALL_PERSON = 0.2
const MAX_POLISH = 2
/** Fracción de fotogramas de un gesto con otro jugador encima a partir de la cual no se califica. */
const CROWDED_SHARE = 0.3
const MAX_TIPS = 3

export interface PersonInput {
  personId: number
  series: PoseSeries[]
  /** Altura mediana de la persona, como fracción del alto del video */
  height: number
  /** Hay más gente en el video junto a esta persona */
  crowded?: boolean
}

export interface PersonReps {
  personId: number
  reps: Rep[]
  /** Gestos que no se califican porque había otro jugador encima */
  contested: number
  layups: number[]
  frames: PoseFrame[]
  width: number
  height: number
  small: boolean
}

const ACTIONS: Record<SportId, ActionKind[]> = { basket: ['shot', 'run'], futbol: ['kick', 'run'] }

/** Detecta y mide los gestos de una persona en todas sus series. */
export function analyzePerson(input: PersonInput, sport: SportId): PersonReps {
  const reps: Rep[] = []
  const layups: number[] = []
  const frames: PoseFrame[] = []
  for (const raw of input.series) {
    const series = cleanSeries(raw)
    frames.push(...series.frames)
    if (sport === 'basket') {
      // Unos brazos arriba sin balón (defensa, celebración) no son un tiro.
      const found = detectShots(series, { needBall: true })
      reps.push(...found.shots)
      layups.push(...found.layups)
    } else reps.push(...detectKicks(series))
    reps.push(...detectRuns(series))
  }
  frames.sort((a, b) => a.t - b.t)
  // Con otro jugador encima, el modelo mezcla los puntos de los dos: ese gesto no se califica.
  const clear = reps.filter((rep) => {
    const during = frames.filter((f) => f.t >= rep.start - 0.05 && f.t <= rep.end + 0.05)
    return !during.length || during.filter((f) => f.crowd).length / during.length < CROWDED_SHARE
  })
  clear.sort((a, b) => a.t - b.t)
  const first = input.series[0]
  return {
    personId: input.personId,
    reps: clear,
    contested: reps.length - clear.length,
    layups,
    frames,
    width: first?.width ?? 0,
    height: first?.height ?? 0,
    small: input.height < SMALL_PERSON,
  }
}

function evidenceAt(person: PersonReps, t: number, check: Check, rep: Rep): Evidence | null {
  if (!person.frames.length) return null
  const frame = person.frames.reduce((a, f) => (Math.abs(f.t - t) < Math.abs(a.t - t) ? f : a))
  // La foto abarca la caja de la persona y todos sus puntos, con algo de aire alrededor.
  let x1 = frame.box.x
  let y1 = frame.box.y
  let x2 = frame.box.x + frame.box.w
  let y2 = frame.box.y + frame.box.h
  for (const p of Object.values(frame.pose)) {
    x1 = Math.min(x1, p.x)
    y1 = Math.min(y1, p.y)
    x2 = Math.max(x2, p.x)
    y2 = Math.max(y2, p.y)
  }
  const pad = Math.max(x2 - x1, y2 - y1) * 0.12
  const crop: PxBox = { x: Math.max(0, x1 - pad), y: Math.max(0, y1 - pad), w: 0, h: 0 }
  crop.w = Math.min(person.width || x2 + pad, x2 + pad) - crop.x
  crop.h = Math.min(person.height || y2 + pad, y2 + pad) - crop.y
  return { t: frame.t, image: null, crop, pose: frame.pose, highlight: check.highlight(rep.side), ball: frame.ball ?? null }
}

interface Graded {
  rep: Rep
  value: number
  grade: Grade
}

function confidenceOf(graded: Graded[], check: Check, small: boolean): Confidence {
  const order: Confidence[] = ['baja', 'media', 'alta']
  let level = graded.length >= 3 ? 2 : graded.length === 2 ? 1 : 0
  // Un ángulo medido desde un punto de vista oblicuo se corrige, pero queda menos fino.
  const oblique = graded.every((g) => g.rep.view === 'oblique' && g.rep.m[check.measure]?.method === 'angle')
  if (oblique) level = Math.min(level, 1)
  if (small) level = Math.max(0, level - 1)
  return order[level]
}

function findingOf(person: PersonReps, check: Check, reps: Rep[]): { finding: Finding | null; unmeasured: Unmeasured | null } {
  const copy = COPY[check.id]
  const graded: Graded[] = []
  for (const rep of reps) {
    const m = rep.m[check.measure]
    if (m) graded.push({ rep, value: m.value, grade: check.grade(m.value, rep) })
  }
  if (!graded.length) {
    const reasons = reps.map((r) => r.missing[check.measure]).filter((x): x is Missing => !!x)
    if (!reasons.length) return { finding: null, unmeasured: null }
    const count = (r: Missing) => reasons.filter((x) => x === r).length
    const reason = reasons.reduce((a, r) => (count(r) > count(a) ? r : a))
    return { finding: null, unmeasured: { id: check.id, label: copy.label, reason, text: missingText(reason, copy.needs) } }
  }

  const flagged = graded.filter((g) => g.grade === 'fix')
  const good = graded.filter((g) => g.grade === 'good')
  let status: Status | null = null
  if (flagged.length >= 2 && flagged.length * 2 >= graded.length) status = check.minor ? 'polish' : 'fix'
  else if (flagged.length >= 1) status = 'polish'
  else if (copy.good && good.length >= Math.max(1, Math.ceil(graded.length * 0.6))) status = 'good'
  if (!status) return { finding: null, unmeasured: null }

  const confidence = confidenceOf(status === 'good' ? good : flagged, check, person.small)
  const median = [...graded].sort((a, b) => a.value - b.value)[graded.length >> 1]
  const base = {
    id: check.id,
    action: check.action,
    label: copy.label,
    reps: { flagged: flagged.length, measured: graded.length },
    confidence,
    confidenceNote: CONFIDENCE_NOTE[confidence],
    target: copy.target,
  }

  if (status === 'good') {
    const m = median.rep.m[check.measure]
    return {
      unmeasured: null,
      finding: {
        ...base,
        status,
        title: copy.good!.title,
        seen: copy.good!.seen,
        why: null,
        cue: null,
        drill: null,
        measured: copy.measured?.(median.value) ?? null,
        evidence: evidenceAt(person, m.t, check, median.rep),
        moments: good.map((g) => g.rep.t),
      },
    }
  }

  // La prueba es la repetición donde más se nota.
  const worst = flagged.reduce((a, g) => (check.worse(g.value, a.value) ? g : a))
  const variant = check.variant?.(worst.value) ?? 'default'
  const fix = copy.fix[variant] ?? Object.values(copy.fix)[0]
  return {
    unmeasured: null,
    finding: {
      ...base,
      status,
      title: fix.title,
      seen: `${inReps(check.action, flagged.length, graded.length)} ${fix.seen}`,
      why: fix.why,
      cue: fix.cue,
      drill: fix.drill,
      measured: copy.measured?.(worst.value) ?? null,
      evidence: evidenceAt(person, worst.rep.m[check.measure].t, check, worst.rep),
      moments: flagged.map((g) => g.rep.t),
    },
  }
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

function list(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`
}

/** El informe de una persona, o null si no se le reconoció ningún gesto. */
export function coachPerson(person: PersonReps, sport: SportId): PersonCoach | null {
  const actions = ACTIONS[sport]
    .map((kind) => {
      const reps = person.reps.filter((r) => r.kind === kind)
      return { kind, count: reps.length, times: reps.map((r) => r.t) }
    })
    .filter((a) => a.count > 0)
  if (!actions.length && !person.layups.length && !person.contested) return null

  const findings: Finding[] = []
  const unmeasured: Unmeasured[] = []
  for (const { kind } of actions) {
    const reps = person.reps.filter((r) => r.kind === kind)
    for (const check of checksFor(kind)) {
      const out = findingOf(person, check, reps)
      if (out.finding) findings.push(out.finding)
      if (out.unmeasured) unmeasured.push(out.unmeasured)
    }
  }
  const priority = (f: Finding) => checksFor(f.action).find((c) => c.id === f.id)?.priority ?? 9
  const byPriority = (a: Finding, b: Finding) => actions.findIndex((x) => x.kind === a.action) - actions.findIndex((x) => x.kind === b.action) || priority(a) - priority(b)
  const fixes = findings.filter((f) => f.status === 'fix').sort(byPriority)
  const polish = findings.filter((f) => f.status === 'polish').sort(byPriority)
  const good = findings.filter((f) => f.status === 'good').sort(byPriority)
  // Un solo foco: lo primero que un entrenador trabajaría. El resto queda «para pulir».
  const focus = fixes[0] ?? polish[0] ?? null
  const rest = [...fixes, ...polish].filter((f) => f !== focus).slice(0, MAX_POLISH)

  const extras: string[] = []
  if (person.contested) {
    const n = person.contested
    extras.push(`En ${n === 1 ? 'una jugada' : `${n} jugadas`} había alguien muy cerca y no pudimos ver bien tu técnica.`)
  }
  if (person.layups.length) {
    const n = person.layups.length
    extras.push(`También vimos ${n === 1 ? 'una entrada' : `${n} entradas`} al aro. Esa jugada todavía no la analizamos.`)
  }
  if (person.reps.some((r) => r.kind === 'run' && r.info.slow)) extras.push('El video parece estar en cámara lenta, así que no contamos tus pasos por segundo.')
  const cadence = person.reps.filter((r) => r.kind === 'run' && r.info.cadence).map((r) => r.info.cadence)
  if (cadence.length) extras.push(`Tu ritmo al correr: unos ${(Math.round(Math.max(...cadence) * 10) / 10).toString().replace('.', ',')} pasos por segundo.`)

  const saw = actions.length ? `Vimos ${list(actions.map((a) => countNoun(a.kind, a.count)))}.` : ''
  const total = actions.reduce((sum, a) => sum + a.count, 0)
  let headline: string
  if (focus?.status === 'fix') headline = `${saw} Lo primero: ${lower(focus.title)}.`
  else if (focus) headline = `${saw} Algo para probar: ${lower(focus.title)}.`
  else if (good.length && total === 1) headline = `${saw} En lo que pudimos medir, no vimos nada importante que corregir.`
  else if (good.length) headline = `${saw} No vimos nada importante que corregir. ¡Buen trabajo!`
  else if (actions.length) headline = `${saw} No pudimos medir lo suficiente para darte un consejo.`
  else headline = extras[0] ?? ''

  return { personId: person.personId, thumb: null, actions, extras, headline: headline.trim(), focus, polish: rest, good, unmeasured }
}

export interface ReportInput {
  sport: SportId
  people: PersonInput[]
  /** Personas que se ven demasiado pequeñas para medirles la técnica */
  tooSmall: number
  frames: { requested: number; measured: number }
}

export function buildReport(input: ReportInput): CoachReport {
  const analyzed = input.people.map((p) => analyzePerson(p, input.sport))
  const people = analyzed.map((p) => coachPerson(p, input.sport)).filter((p): p is PersonCoach => !!p)

  const tips = new Set<string>()
  let empty: string | null = null
  if (!input.people.length) {
    empty = input.tooSmall
      ? 'En el video apareces muy lejos de la cámara. No pudimos ver bien tu técnica.'
      : 'No pudimos seguirte bien en este video para medir tu técnica.'
    tips.add(TIPS.closer)
    tips.add(TIPS.whole)
  } else if (!people.length) {
    empty =
      input.sport === 'basket'
        ? 'Te vimos, pero no reconocimos ningún tiro ni ninguna carrera en este video.'
        : 'Te vimos, pero no reconocimos ningún golpeo ni ninguna carrera en este video.'
    tips.add(TIPS.whole)
    if (input.sport === 'futbol') tips.add(TIPS.ball)
    tips.add(TIPS.still)
  }

  for (const p of people) {
    const all = [p.focus, ...p.polish, ...p.good].filter((f): f is Finding => !!f)
    for (const u of p.unmeasured) {
      if (u.reason === 'hidden') tips.add(TIPS.whole)
      else if (u.reason === 'cut') tips.add(TIPS.longer)
      else if (u.reason === 'view') tips.add(COPY[u.id].needs === 'frente' ? TIPS.front : TIPS.side)
    }
    if (all.some((f) => f.reps.measured === 1)) tips.add(TIPS.more)
  }
  if (analyzed.some((p) => p.small)) tips.add(TIPS.closer)
  if (input.sport === 'futbol' && people.length && !people.some((p) => p.actions.some((a) => a.kind === 'kick'))) tips.add(TIPS.ball)

  return { people, empty, tips: [...tips].slice(0, MAX_TIPS), frames: input.frames }
}
