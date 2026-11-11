import { describe, expect, it } from 'vitest'
import { ACTION_NOUN, CONFIDENCE_NOTE, COPY, DISCLAIMER, inReps, missingText, NEXT_CHALLENGE, TIPS } from './content'
import { readability, syllables } from './readability'
import type { ActionKind } from './types'

describe('sílabas', () => {
  it.each([
    ['balón', 2],
    ['rodillas', 3],
    ['que', 1],
    ['aire', 2],
    ['fuerza', 2],
    ['caer', 2],
    ['equilibrio', 4],
    ['muy', 1],
    ['guía', 2],
    ['después', 2],
    ['puntería', 4],
    ['y', 1],
    ['aro', 2],
    ['pie', 1],
    ['golpeo', 3],
    ['cuerpo', 2],
  ])('%s → %i', (word, n) => {
    expect(syllables(word)).toBe(n)
  })
})

describe('índice de legibilidad', () => {
  it('distingue un texto fácil de uno difícil', () => {
    const easy = readability('Dobla las rodillas. Baja un poco y sube al tirar.')
    const hard = readability('La insuficiente flexión de las articulaciones de las extremidades inferiores compromete la transferencia de energía cinética durante la ejecución del lanzamiento.')
    expect(easy.score).toBeGreaterThan(80)
    expect(hard.score).toBeLessThan(40)
  })
})

// Bastante fácil en la escala INFLESZ: el nivel de la educación primaria.
const MIN_SCORE = 65
const MAX_WORDS_PER_SENTENCE = 16
const JARGON = /flexi[oó]n|extensi[oó]n|biomec|cinem|articulaci|[aá]ngulo|postura corporal|estabili|propuls|trayectoria|ejecuci[oó]n|\bfase\b|optimiz|t[eé]cnicamente/i

describe('los textos del Coach se entienden a los 12 años', () => {
  for (const [id, copy] of Object.entries(COPY)) {
    const action = id.split('.')[0] as ActionKind
    for (const [variant, fix] of Object.entries(copy.fix)) {
      it(`${id} (${variant}): corregir`, () => {
        const seen = `${inReps(action, 2, 3)} ${fix.seen}`
        const text = [`${fix.title}.`, seen, fix.why, fix.cue, ...fix.drill.steps].join(' ')
        const r = readability(text)
        expect(r.score, `${text} → ${r.score.toFixed(0)}`).toBeGreaterThanOrEqual(MIN_SCORE)
        for (const part of [seen, fix.why, fix.cue, ...fix.drill.steps]) {
          const pr = readability(part)
          expect(pr.wordsPerSentence, part).toBeLessThanOrEqual(MAX_WORDS_PER_SENTENCE)
          expect(pr.score, `${part} → ${pr.score.toFixed(0)}`).toBeGreaterThanOrEqual(55)
        }
        expect(text).not.toMatch(JARGON)
        // El título es una orden corta que se puede recordar.
        expect(fix.title.split(' ').length).toBeLessThanOrEqual(9)
        expect(fix.drill.steps.length).toBeLessThanOrEqual(3)
      })
    }
    if (copy.good) {
      it(`${id}: bien hecho`, () => {
        const text = `${copy.good!.title}. ${copy.good!.seen}`
        const r = readability(text)
        expect(r.score, `${text} → ${r.score.toFixed(0)}`).toBeGreaterThanOrEqual(MIN_SCORE)
        expect(text).not.toMatch(JARGON)
      })
    }
    it(`${id}: medida y motivo`, () => {
      expect(copy.label.length).toBeLessThanOrEqual(26)
      const bits = [copy.measured?.(152.4), copy.target, missingText('view', copy.needs), missingText('hidden', copy.needs), missingText('cut', copy.needs), missingText('unclear', copy.needs)]
      for (const b of bits) if (b) expect(b).not.toMatch(JARGON)
    })
  }

  it('avisos y consejos de grabación', () => {
    for (const text of [...Object.values(TIPS), ...Object.values(CONFIDENCE_NOTE), ...Object.values(NEXT_CHALLENGE), DISCLAIMER]) {
      const r = readability(text)
      expect(r.score, `${text} → ${r.score.toFixed(0)}`).toBeGreaterThanOrEqual(60)
      expect(r.wordsPerSentence, text).toBeLessThanOrEqual(18)
    }
  })

  it('cuenta las repeticiones con naturalidad', () => {
    expect(inReps('shot', 2, 3)).toBe('En 2 de tus 3 tiros')
    expect(inReps('shot', 3, 3)).toBe('En tus 3 tiros')
    expect(inReps('kick', 1, 1)).toBe('En tu golpeo')
    expect(inReps('run', 1, 2)).toBe('En 1 de tus 2 carreras')
    expect(Object.keys(ACTION_NOUN)).toHaveLength(3)
  })
})
