// Lo que el Coach dice. Está escrito para que lo entienda un jugador de 12 años:
// frases cortas, palabras de la cancha, una sola idea por frase y una imagen fácil
// de recordar. Las pruebas miden la legibilidad de cada texto (readability.ts).

import type { ActionKind, Confidence, Drill, Missing } from './types'

export interface FixCopy {
  title: string
  /** Lo que se vio; va detrás de «En 2 de tus 3 tiros » y empieza en minúscula */
  seen: string
  why: string
  cue: string
  drill: Drill
}

export interface CheckCopy {
  label: string
  /** Un texto por variante del fallo; «default» si solo hay una */
  fix: Record<string, FixCopy>
  good: { title: string; seen: string } | null
  /** La medida en palabras, o null si el número no ayuda a entenderlo */
  measured: ((value: number) => string) | null
  target: string | null
  /** Desde dónde hay que grabar para poder medirlo */
  needs: 'lado' | 'frente' | null
}

const round = (v: number) => Math.round(v)
const tenths = (v: number) => (Math.round(v * 10) / 10).toString().replace('.', ',')

export const COPY: Record<string, CheckCopy> = {
  // ───── Tiro de baloncesto ─────
  'shot.base': {
    label: 'Pies',
    fix: {
      narrow: {
        title: 'Separa un poco más los pies',
        seen: 'tenías los pies muy juntos.',
        why: 'Con los pies juntos es fácil perder el equilibrio. Y sin equilibrio, el tiro se va hacia un lado.',
        cue: 'Pon los pies al ancho de tus hombros.',
        drill: {
          name: 'Base firme',
          steps: ['Párate con los pies al ancho de los hombros.', 'Pide a alguien que te empuje suave en el hombro.', 'Si no te mueves, esa es tu base. Tira desde ahí.'],
          dose: '10 tiros cerca del aro',
        },
      },
      wide: {
        title: 'Junta un poco los pies',
        seen: 'tenías los pies muy separados.',
        why: 'Con los pies muy abiertos cuesta saltar recto. El tiro pierde fuerza.',
        cue: 'Pon los pies al ancho de tus hombros.',
        drill: {
          name: 'Base firme',
          steps: ['Párate con los pies al ancho de los hombros.', 'Da un salto corto hacia arriba.', 'Si caes en el mismo lugar, esa es tu base. Tira desde ahí.'],
          dose: '10 tiros cerca del aro',
        },
      },
    },
    good: { title: 'Buena base', seen: 'Tus pies quedan más o menos al ancho de los hombros. Eso te da equilibrio.' },
    measured: null,
    target: null,
    needs: 'frente',
  },
  'shot.legs': {
    label: 'Piernas',
    fix: {
      default: {
        title: 'Dobla más las rodillas antes de tirar',
        seen: 'casi no doblaste las rodillas.',
        why: 'La fuerza del tiro sale de las piernas. Si no las doblas, el brazo hace todo el trabajo y el balón se queda corto.',
        cue: 'Baja un poco, como si te fueras a sentar, y sube mientras tiras.',
        drill: {
          name: 'Tiro desde la silla',
          steps: ['Ponte cerca del aro, a dos pasos.', 'Baja hasta casi sentarte en una silla.', 'Sube y tira en un solo movimiento.'],
          dose: '3 series de 8 tiros',
        },
      },
    },
    good: { title: 'Usas bien las piernas', seen: 'Doblas las rodillas antes de tirar. De ahí sale la fuerza del tiro.' },
    measured: (v) => `Tus rodillas al bajar: unos ${round(v)}°`,
    target: 'Como guía: menos de 140°',
    needs: null,
  },
  'shot.flare': {
    label: 'Codo',
    fix: {
      default: {
        title: 'Mete el codo debajo del balón',
        seen: 'el codo se abrió hacia afuera.',
        why: 'Si el codo se abre, el balón sale torcido. Con el codo debajo, el balón va recto al aro.',
        cue: 'Apunta con el codo al aro, como si fuera una flecha.',
        drill: {
          name: 'Tiro con una mano',
          steps: ['Ponte muy cerca del aro.', 'Sostén el balón solo con tu mano de tiro.', 'Pon el codo debajo del balón y tira.'],
          dose: '3 series de 10 tiros',
        },
      },
    },
    good: { title: 'Codo bien colocado', seen: 'Tu codo queda debajo del balón. Así el tiro sale recto.' },
    measured: null,
    target: null,
    needs: 'frente',
  },
  'shot.extension': {
    label: 'Brazo',
    fix: {
      default: {
        title: 'Estira el brazo hasta el final',
        seen: 'soltaste el balón con el brazo doblado.',
        why: 'Si el brazo se queda doblado, empujas el balón en vez de lanzarlo. Sale bajo y sin fuerza.',
        cue: 'Estira el brazo hacia arriba hasta que el codo quede más alto que tus ojos.',
        drill: {
          name: 'Tiro acostado',
          steps: ['Acuéstate boca arriba con el balón.', 'Tira el balón hacia arriba y estira todo el brazo.', 'Tiene que volver a tu mano sin que te muevas.'],
          dose: '2 series de 15 tiros',
        },
      },
    },
    good: { title: 'Estiras bien el brazo', seen: 'Sueltas el balón con el brazo estirado. Así sale alto.' },
    measured: (v) => `Tu codo al soltar: unos ${round(v)}°`,
    target: 'Como guía: más de 160°, casi recto',
    needs: 'lado',
  },
  'shot.follow': {
    label: 'Final del tiro',
    fix: {
      default: {
        title: 'Deja la mano arriba después de tirar',
        seen: 'bajaste la mano enseguida.',
        why: 'Si bajas la mano rápido, el tiro se corta y cada uno sale distinto. Terminar siempre igual te da puntería.',
        cue: 'Termina con la mano arriba, como si la metieras dentro del aro.',
        drill: {
          name: 'Foto final',
          steps: ['Tira y quédate quieto, como en una foto.', 'Cuenta «uno, dos» con la mano arriba.', 'Baja la mano solo cuando el balón toque el aro.'],
          dose: '10 tiros',
        },
      },
    },
    good: { title: 'Terminas bien el tiro', seen: 'Dejas la mano arriba después de soltar el balón. Eso te da puntería.' },
    measured: (v) => `Tu mano se quedó arriba ${tenths(v)} s`,
    target: 'Como guía: más de medio segundo',
    needs: null,
  },
  'shot.trunk': {
    label: 'Cuerpo',
    fix: {
      default: {
        title: 'Sube recto al tirar',
        seen: 'tu cuerpo se inclinó mucho.',
        why: 'Si el cuerpo se va hacia un lado o hacia atrás, el balón también se desvía.',
        cue: 'Salta y cae en el mismo lugar, recto como un cohete.',
        drill: {
          name: 'Salta y cae',
          steps: ['Haz una marca en el suelo.', 'Tira saltando desde la marca.', 'Tienes que caer encima de ella.'],
          dose: '10 tiros',
        },
      },
    },
    good: null,
    measured: (v) => `Tu cuerpo se inclinó unos ${round(v)}°`,
    target: 'Como guía: menos de 10°',
    needs: null,
  },

  // ───── Golpeo de fútbol ─────
  'kick.plant': {
    label: 'Pie de apoyo',
    fix: {
      default: {
        title: 'Pon el pie de apoyo al lado del balón',
        seen: 'tu pie de apoyo quedó muy atrás del balón.',
        why: 'Si el pie queda atrás, llegas estirado al balón. El cuerpo se va hacia atrás y el balón sale alto.',
        cue: 'Planta el pie junto al balón, apuntando a donde quieres que vaya.',
        drill: {
          name: 'Paso y planta',
          steps: ['Deja el balón quieto.', 'Da dos pasos y planta el pie al lado del balón, sin golpear.', 'Cuando te salga cinco veces seguidas, golpea.'],
          dose: '10 repeticiones',
        },
      },
    },
    good: { title: 'Buen pie de apoyo', seen: 'Plantas el pie al lado del balón. Así golpeas con control.' },
    measured: null,
    target: null,
    needs: 'lado',
  },
  'kick.knee': {
    label: 'Pierna de apoyo',
    fix: {
      default: {
        title: 'Dobla un poco la rodilla de apoyo',
        seen: 'tu pierna de apoyo estaba tiesa.',
        why: 'Con la pierna tiesa pierdes equilibrio y fuerza. Con la rodilla un poco doblada, tu cuerpo aguanta mejor el golpe.',
        cue: 'Pisa fuerte junto al balón y dobla un poco esa rodilla, como un resorte.',
        drill: {
          name: 'Equilibrio en un pie',
          steps: ['Párate sobre tu pierna de apoyo, con la rodilla un poco doblada.', 'Con la otra pierna haz el gesto de golpear, sin balón.', 'Aguanta sin caerte.'],
          dose: '3 series de 10',
        },
      },
    },
    good: { title: 'Buena pierna de apoyo', seen: 'Doblas un poco la rodilla de apoyo. Eso te da equilibrio.' },
    measured: (v) => `Tu rodilla de apoyo: unos ${round(v)}°`,
    target: 'Como guía: entre 120° y 160° (pierna recta: 180°)',
    needs: 'lado',
  },
  'kick.lean': {
    label: 'Cuerpo',
    fix: {
      default: {
        title: 'Lleva el cuerpo sobre el balón',
        seen: 'te echaste mucho hacia atrás.',
        why: 'Si el cuerpo se va hacia atrás, el balón sale hacia arriba. Con el cuerpo encima, sale raso y con fuerza.',
        cue: 'Al golpear, lleva el pecho hacia adelante, encima del balón.',
        drill: {
          name: 'Golpeo raso',
          steps: ['Pon dos conos a diez pasos.', 'Golpea para que el balón pase entre ellos sin levantarse.', 'Fíjate en que tu pecho quede sobre el balón.'],
          dose: '10 golpeos con cada pierna',
        },
      },
    },
    good: { title: 'Cuerpo bien colocado', seen: 'No te echas hacia atrás al golpear. Así controlas la altura del balón.' },
    measured: (v) => (v < 0 ? `Tu cuerpo: unos ${round(-v)}° hacia atrás` : `Tu cuerpo: unos ${round(v)}° hacia adelante`),
    target: 'Como guía: casi recto, no más de 10° hacia atrás',
    needs: 'lado',
  },
  'kick.follow': {
    label: 'Final del golpeo',
    fix: {
      default: {
        title: 'En los tiros fuertes, deja que la pierna siga',
        seen: 'tu pierna siguió muy poco después de tocar el balón.',
        why: 'En un pase corto eso está bien. En un tiro fuerte, si la pierna sigue, el balón lleva más fuerza.',
        cue: 'Golpea a través del balón: tu pie sigue hacia donde quieres que vaya.',
        drill: {
          name: 'Golpea y cae',
          steps: ['Golpea el balón.', 'Deja que la pierna siga hacia adelante.', 'Cae sobre el pie con el que golpeaste.'],
          dose: '10 golpeos',
        },
      },
    },
    good: { title: 'Buen final del golpeo', seen: 'Tu pierna sigue hacia adelante después de golpear. Eso da fuerza y puntería.' },
    measured: null,
    target: null,
    needs: null,
  },

  // ───── Carrera ─────
  'run.arms': {
    label: 'Brazos',
    fix: {
      default: {
        title: 'Dobla los codos al correr',
        seen: 'llevabas los brazos casi estirados.',
        why: 'Los brazos marcan el ritmo de las piernas. Estirados se mueven lento y te frenan.',
        cue: 'Dobla los codos como una «L» y mueve las manos del bolsillo a la barbilla.',
        drill: {
          name: 'Braceo en el lugar',
          steps: ['Párate con un pie adelante del otro.', 'Mueve los brazos rápido, con los codos en «L».', 'No muevas las piernas ni los hombros.'],
          dose: '4 series de 10 segundos',
        },
      },
    },
    good: { title: 'Buen braceo', seen: 'Llevas los codos doblados. Eso te ayuda a correr rápido.' },
    measured: (v) => `Tus codos al correr: unos ${round(v)}°`,
    target: 'Como guía: cerca de 90°, en forma de «L»',
    needs: 'lado',
  },
  'run.knees': {
    label: 'Rodillas',
    fix: {
      default: {
        title: 'Sube más las rodillas',
        seen: 'tus rodillas subieron poco.',
        why: 'Cuando la rodilla sube, el pie empuja el suelo con más fuerza. Si sube poco, das pasos cortos.',
        cue: 'Sube la rodilla hasta la cadera, como si subieras un escalón alto.',
        drill: {
          name: 'Rodillas arriba',
          steps: ['Corre en el lugar subiendo las rodillas hasta la cadera.', 'Pisa con la parte de adelante del pie.', 'Mantén el cuerpo recto.'],
          dose: '4 series de 10 metros',
        },
      },
    },
    good: { title: 'Subes bien las rodillas', seen: 'Tus rodillas suben alto al correr. Eso alarga tu zancada.' },
    measured: null,
    target: null,
    needs: null,
  },
  'run.lean': {
    label: 'Cuerpo',
    fix: {
      default: {
        title: 'No corras echado hacia atrás',
        seen: 'corrías con el cuerpo echado hacia atrás.',
        why: 'Si el cuerpo va hacia atrás, cada paso te frena. Un poco hacia adelante, cada paso te empuja.',
        cue: 'Inclina todo el cuerpo un poco hacia adelante, como si te fueras a caer.',
        drill: {
          name: 'Caída y salida',
          steps: ['Párate recto con los pies juntos.', 'Échate un poco hacia adelante, recto como una tabla.', 'Justo antes de caer, sal corriendo diez metros.'],
          dose: '5 salidas',
        },
      },
    },
    good: { title: 'Buena postura', seen: 'Corres con el cuerpo un poco hacia adelante. Así cada paso te empuja.' },
    measured: null,
    target: null,
    needs: 'lado',
  },
  'run.cross': {
    label: 'Brazos, vistos de frente',
    fix: {
      default: {
        title: 'Mueve los brazos hacia adelante, no hacia los lados',
        seen: 'tus manos cruzaban por delante del cuerpo.',
        why: 'Si los brazos cruzan, tu cuerpo gira de lado a lado. Pierdes fuerza para ir hacia adelante.',
        cue: 'Tus manos van de atrás hacia adelante, como las ruedas de un tren.',
        drill: {
          name: 'Braceo en pasillo',
          steps: ['Párate entre dos conos, muy cerca de tus hombros.', 'Mueve los brazos rápido sin tocar los conos.', 'Después hazlo corriendo.'],
          dose: '4 series de 10 segundos',
        },
      },
    },
    good: { title: 'Brazos rectos', seen: 'Tus brazos van hacia adelante y hacia atrás, sin cruzarse.' },
    measured: null,
    target: null,
    needs: 'frente',
  },
}

export const ACTION_NOUN: Record<ActionKind, [one: string, many: string]> = {
  shot: ['tiro', 'tiros'],
  kick: ['golpeo', 'golpeos'],
  run: ['carrera', 'carreras'],
}

/** «En 2 de tus 3 tiros», «En tus 2 tiros», «En tu tiro». */
export function inReps(action: ActionKind, flagged: number, measured: number): string {
  const [one, many] = ACTION_NOUN[action]
  if (measured === 1) return `En tu ${one}`
  if (flagged >= measured) return `En tus ${measured} ${many}`
  return `En ${flagged} de tus ${measured} ${many}`
}

/** «3 tiros», «1 carrera». */
export function countNoun(action: ActionKind, n: number): string {
  const [one, many] = ACTION_NOUN[action]
  return `${n} ${n === 1 ? one : many}`
}

export const CONFIDENCE_NOTE: Record<Confidence, string> = {
  alta: 'Lo vimos varias veces y con claridad.',
  media: 'Lo vimos pocas veces, o no se veía del todo bien.',
  baja: 'Lo vimos una sola vez, o desde muy lejos. Graba otra vez para confirmarlo.',
}

/** Por qué no se pudo medir algo, y qué hacer la próxima vez. */
export function missingText(reason: Missing, needs: CheckCopy['needs']): string {
  if (reason === 'view') return needs === 'frente' ? 'Para verlo hay que grabar de frente.' : 'Para verlo hay que grabar de lado.'
  if (reason === 'hidden') return 'Esa parte del cuerpo no se ve bien en el video.'
  if (reason === 'cut') return 'El video se corta justo después. Graba un segundo más.'
  return 'No se ve con claridad en este video.'
}

export const TIPS = {
  whole: 'Que se te vea el cuerpo entero, de la cabeza a los pies.',
  side: 'Graba también de lado. Así vemos lo que ahora no se pudo ver.',
  front: 'Graba también de frente. Así vemos lo que ahora no se pudo ver.',
  longer: 'Sigue grabando un segundo más después de cada tiro o golpeo.',
  more: 'Graba tres repeticiones o más del mismo gesto. Así estamos más seguros.',
  closer: 'Acerca la cámara. Debes ocupar al menos la mitad del alto de la pantalla.',
  still: 'Deja el celular quieto, apoyado en algo, a la altura de tu cintura.',
  ball: 'Que se vea el balón durante todo el golpeo.',
} as const

/** Un reto para seguir cuando no hay nada importante que corregir. */
export const NEXT_CHALLENGE: Record<ActionKind, string> = {
  shot: 'Da un paso atrás y tira igual que ahora. Graba otra vez y compara.',
  kick: 'Prueba el mismo golpeo con la otra pierna. Graba otra vez y compara.',
  run: 'Corre un poco más rápido sin perder la técnica. Graba otra vez y compara.',
}

export const DISCLAIMER = 'Esto es una ayuda para entrenar. No reemplaza a tu entrenador ni es un consejo médico. Si algo te duele, para y avisa a un adulto.'
