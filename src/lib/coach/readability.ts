// Legibilidad en español: índice de perspicuidad de Szigriszt-Pazos, leído con
// la escala INFLESZ. Se usa en las pruebas para que ningún texto del Coach
// quede por encima del nivel de un lector de 12 años.

const STRONG = 'aeoáéóíú'
const WEAK = 'iuü'
const VOWELS = STRONG + WEAK

/** Sílabas de una palabra española (aproximación por grupos de vocales, con diptongos e hiatos). */
export function syllables(word: string): number {
  let w = word.toLowerCase().replace(/[^a-záéíóúüñ]/g, '')
  if (!w) return 0
  // La «u» muda de «que», «qui», «gue», «gui» no es una vocal.
  w = w.replace(/qu/g, 'q').replace(/gu([eiéí])/g, 'g$1')
  // La «y» final suena como «i»: «muy», «hoy».
  w = w.replace(/y$/, 'i')
  if (w === 'i') return 1
  let count = 0
  let prev = ''
  for (const ch of w) {
    if (!VOWELS.includes(ch)) {
      prev = ''
      continue
    }
    // Dos vocales fuertes seguidas van en sílabas distintas; cualquier otra pareja forma diptongo.
    if (!prev || (STRONG.includes(prev) && STRONG.includes(ch))) count++
    prev = ch
  }
  return Math.max(1, count)
}

export interface Readability {
  /** Índice Szigriszt-Pazos: de 0 (muy difícil) a 100 (muy fácil) */
  score: number
  words: number
  sentences: number
  /** Palabras por frase */
  wordsPerSentence: number
  level: 'muy difícil' | 'algo difícil' | 'normal' | 'bastante fácil' | 'muy fácil'
}

export function readability(text: string): Readability {
  const sentences = text.split(/[.!?;:…\n]+/).map((s) => s.trim()).filter((s) => /[a-záéíóúüñ0-9]/i.test(s))
  // Un número cuenta como una palabra de dos sílabas («diez», «ocho», «ciento…» de media).
  const tokens = text.match(/[a-záéíóúüñ]+|\d+(?:[.,]\d+)?/gi) ?? []
  const words = tokens.length
  const syll = tokens.reduce((s, t) => s + (/\d/.test(t) ? 2 : syllables(t)), 0)
  const f = Math.max(1, sentences.length)
  const score = words ? 206.835 - 62.3 * (syll / words) - words / f : 0
  const level = score < 40 ? 'muy difícil' : score < 55 ? 'algo difícil' : score < 65 ? 'normal' : score < 80 ? 'bastante fácil' : 'muy fácil'
  return { score, words, sentences: f, wordsPerSentence: words / f, level }
}
